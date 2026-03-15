/**
 * Live implementation of the SkillOps service.
 *
 * Executes commands on remote hosts via the SshExecutor service to discover
 * skills, check activation status, sync skill directories, and verify
 * file integrity. All operations are traced with OTEL spans via
 * @codex-fleet/telemetry.
 */
import { Effect, Layer } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutor, CommandFailed } from "@codex-fleet/ssh";
import { withSpan } from "@codex-fleet/telemetry";
import { SkillOps } from "./types.js";
import type { SkillInfo, SkillStatus, SyncResult, VerifySyncResult, ActivationResult } from "./types.js";
import { SkillCommandFailed, SkillRepoNotFound, SkillNotFound, SyncFailed, ActivationFailed } from "./errors.js";
import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

/**
 * Directories that should be filtered out when listing skills.
 * These are common non-skill directories that may exist in a repository.
 */
const FILTERED_DIRS = new Set([
  ".git",
  ".github",
  ".vscode",
  ".idea",
  "node_modules",
  ".DS_Store",
  "__pycache__",
  ".cache",
  ".turbo",
]);

/**
 * Execute a command on a remote host via SSH, mapping CommandFailed
 * errors to SkillCommandFailed for consistent error typing.
 */
const execSkillCmd = (
  ssh: SshExecutor["Type"],
  host: HostConfig,
  command: string,
) =>
  ssh.executeCommand(host, command).pipe(
    Effect.catchTag("CommandFailed", (err: CommandFailed) =>
      Effect.fail(
        new SkillCommandFailed({
          host: err.host,
          command,
          exitCode: err.exitCode,
          stderr: err.stderr,
        }),
      ),
    ),
  );

/**
 * Live SkillOps layer backed by SshExecutor.
 *
 * All operations create OTEL spans with host, operation, and path attributes.
 */
export const SkillOpsLive: Layer.Layer<SkillOps, never, SshExecutor> = Layer.effect(
  SkillOps,
  Effect.gen(function* () {
    const ssh = yield* SshExecutor;

    return SkillOps.of({
      listSkills: (host: HostConfig, repoPath: string, activeDir: string) =>
        withSpan("skill.listSkills", {
          attributes: { host: host.hostname, operation: "listSkills", repoPath, activeDir },
        })(
          Effect.gen(function* () {
            // First check if the repo path exists and is a directory
            const checkResult = yield* ssh.executeCommand(
              host,
              `test -d ${repoPath} && echo "exists"`,
            ).pipe(
              Effect.catchTag("CommandFailed", () =>
                Effect.fail(
                  new SkillRepoNotFound({
                    host: host.hostname,
                    path: repoPath,
                  }),
                ),
              ),
            );

            if (checkResult.stdout.trim() !== "exists") {
              return yield* Effect.fail(
                new SkillRepoNotFound({
                  host: host.hostname,
                  path: repoPath,
                }),
              );
            }

            // List only directories (not files) in the repo path.
            // Use `find` with -maxdepth 1 -mindepth 1 -type d to list
            // top-level directories. The -type d ensures we only get directories.
            // We use `basename` to get just the directory name.
            const listResult = yield* execSkillCmd(
              ssh,
              host,
              `find ${repoPath} -maxdepth 1 -mindepth 1 -type d -exec basename {} \\;`,
            );

            const output = listResult.stdout.trim();

            // Empty repo → empty list
            if (output.length === 0) {
              yield* Effect.annotateCurrentSpan("skill.count", 0);
              return [] as Array<SkillInfo>;
            }

            // Parse directory names and filter non-skill directories
            const dirNames = output
              .split("\n")
              .map((name) => name.trim())
              .filter((name) => name.length > 0 && !FILTERED_DIRS.has(name));

            // For each skill directory, check activation status via symlink
            const skills: Array<SkillInfo> = [];
            for (const name of dirNames) {
              const status = yield* checkSymlink(ssh, host, name, activeDir);
              skills.push({ name, status });
            }

            // Sort skills alphabetically for consistent output
            skills.sort((a, b) => a.name.localeCompare(b.name));

            yield* Effect.annotateCurrentSpan("skill.count", skills.length);
            return skills;
          }),
        ),

      getSkillStatus: (host: HostConfig, skillName: string, activeDir: string) =>
        withSpan("skill.getSkillStatus", {
          attributes: { host: host.hostname, operation: "getSkillStatus", skillName, activeDir },
        })(
          Effect.gen(function* () {
            const status = yield* checkSymlink(ssh, host, skillName, activeDir);
            yield* Effect.annotateCurrentSpan("skill.status", status);
            return status;
          }),
        ),

      syncSkill: (
        host: HostConfig,
        skillName: string,
        localRepoPath: string,
        remoteRepoPath: string,
      ) =>
        withSpan("skill.syncSkill", {
          attributes: {
            host: host.hostname,
            operation: "syncSkill",
            skillName,
            localRepoPath,
            remoteRepoPath,
          },
        })(
          Effect.gen(function* () {
            const localSkillPath = `${localRepoPath}/${skillName}`;

            // Verify local skill directory exists
            yield* Effect.tryPromise({
              try: () => access(localSkillPath, constants.R_OK),
              catch: () =>
                new SkillNotFound({
                  skillName,
                  sourcePath: localSkillPath,
                }),
            });

            // Build the SSH target string
            const userPrefix = host.user ? `${host.user}@` : "";
            const sshTarget = `${userPrefix}${host.hostname}`;
            const remoteSkillPath = `${remoteRepoPath}/${skillName}`;

            // Ensure remote directory parent exists.
            // Use raw SSH executor (not execSkillCmd) to keep error types aligned.
            yield* ssh.executeCommand(host, `mkdir -p ${remoteRepoPath}`).pipe(
              Effect.catchTag("CommandFailed", (err) =>
                Effect.fail(
                  new SyncFailed({
                    host: host.hostname,
                    skillName,
                    cause: `Failed to create remote directory: ${err.stderr}`,
                  }),
                ),
              ),
            );

            // Use rsync to transfer the skill directory.
            // -a = archive mode (preserves permissions, ownership, timestamps, structure)
            // --delete = remove files on dest that don't exist on source
            // -e ssh = use SSH transport with ConnectTimeout
            // Trailing / on source means "copy contents of directory"
            const timeoutSec = host.timeout || 30;
            const portOpt = host.port && host.port !== 22 ? ` -p ${host.port}` : "";
            const sshCmd = `ssh -o ConnectTimeout=${timeoutSec} -o StrictHostKeyChecking=no -o BatchMode=yes${portOpt}`;
            const rsyncCmd = `rsync -a --delete -e '${sshCmd}' ${localSkillPath}/ ${sshTarget}:${remoteSkillPath}/`;

            yield* Effect.tryPromise({
              try: () =>
                new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
                  execFile(
                    "bash",
                    ["-c", rsyncCmd],
                    { maxBuffer: 10 * 1024 * 1024 },
                    (error, stdout, stderr) => {
                      if (error) {
                        reject(error);
                      } else {
                        resolve({ stdout, stderr });
                      }
                    },
                  );
                }),
              catch: (err) =>
                new SyncFailed({
                  host: host.hostname,
                  skillName,
                  cause: String(err instanceof Error ? err.message : err),
                }),
            });

            // Count files transferred by listing files in the remote directory.
            // Use raw SSH executor and map errors to SyncFailed.
            const countResult = yield* ssh
              .executeCommand(host, `find ${remoteSkillPath} -type f | wc -l`)
              .pipe(
                Effect.catchTag("CommandFailed", (err) =>
                  Effect.fail(
                    new SyncFailed({
                      host: host.hostname,
                      skillName,
                      cause: `Failed to count transferred files: ${err.stderr}`,
                    }),
                  ),
                ),
              );
            const filesTransferred = parseInt(countResult.stdout.trim(), 10) || 0;

            yield* Effect.annotateCurrentSpan("skill.filesTransferred", filesTransferred);
            yield* Effect.annotateCurrentSpan("skill.syncSuccess", true);

            return {
              host: host.hostname,
              skillName,
              filesTransferred,
              success: true,
            } satisfies SyncResult;
          }),
        ),

      verifySync: (
        host: HostConfig,
        skillName: string,
        localRepoPath: string,
        remoteRepoPath: string,
      ) =>
        withSpan("skill.verifySync", {
          attributes: {
            host: host.hostname,
            operation: "verifySync",
            skillName,
            localRepoPath,
            remoteRepoPath,
          },
        })(
          Effect.gen(function* () {
            const localSkillPath = `${localRepoPath}/${skillName}`;
            const remoteSkillPath = `${remoteRepoPath}/${skillName}`;

            // Generate checksums locally using find + sha256sum.
            // Output format: <hash>  <relative-path>
            // We cd into the skill dir first so paths are relative.
            const localChecksumResult = yield* Effect.tryPromise({
              try: () =>
                new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
                  execFile(
                    "bash",
                    [
                      "-c",
                      `cd ${localSkillPath} && find . -type f -exec sha256sum {} \\; | sort -k2`,
                    ],
                    { maxBuffer: 10 * 1024 * 1024 },
                    (error, stdout, stderr) => {
                      if (error) {
                        reject(error);
                      } else {
                        resolve({ stdout, stderr });
                      }
                    },
                  );
                }),
              catch: (err) =>
                new SkillCommandFailed({
                  host: "localhost",
                  command: "sha256sum (local)",
                  exitCode: 1,
                  stderr: String(err instanceof Error ? err.message : err),
                }),
            });

            // Generate checksums on remote host
            const remoteChecksumResult = yield* execSkillCmd(
              ssh,
              host,
              `cd ${remoteSkillPath} && find . -type f -exec sha256sum {} \\; | sort -k2`,
            );

            // Parse checksums into maps: relative_path -> hash
            const parseChecksums = (output: string): Map<string, string> => {
              const map = new Map<string, string>();
              const lines = output.trim().split("\n").filter((l) => l.length > 0);
              for (const line of lines) {
                // sha256sum output: <hash>  <path>  (two spaces between)
                const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
                if (match) {
                  map.set(match[2], match[1]);
                }
              }
              return map;
            };

            const localChecksums = parseChecksums(localChecksumResult.stdout);
            const remoteChecksums = parseChecksums(remoteChecksumResult.stdout);

            // Compare checksums
            const mismatched: Array<string> = [];

            // Check all local files exist on remote and match
            for (const [path, hash] of localChecksums) {
              const remoteHash = remoteChecksums.get(path);
              if (remoteHash === undefined) {
                mismatched.push(path);
              } else if (remoteHash !== hash) {
                mismatched.push(path);
              }
            }

            // Check for extra files on remote that don't exist locally
            for (const [path] of remoteChecksums) {
              if (!localChecksums.has(path)) {
                mismatched.push(path);
              }
            }

            const filesChecked = Math.max(localChecksums.size, remoteChecksums.size);
            const match = mismatched.length === 0;

            yield* Effect.annotateCurrentSpan("skill.filesChecked", filesChecked);
            yield* Effect.annotateCurrentSpan("skill.checksumMatch", match);

            if (!match) {
              yield* Effect.annotateCurrentSpan("skill.mismatchCount", mismatched.length);
            }

            return {
              host: host.hostname,
              skillName,
              match,
              filesChecked,
              mismatched,
            } satisfies VerifySyncResult;
          }),
        ),

      activateSkill: (
        host: HostConfig,
        skillName: string,
        repoPath: string,
        activeDir: string,
      ) =>
        withSpan("skill.activateSkill", {
          attributes: {
            host: host.hostname,
            operation: "activateSkill",
            skillName,
            repoPath,
            activeDir,
          },
        })(
          Effect.gen(function* () {
            const symlinkPath = `${activeDir}/${skillName}`;
            const targetPath = `${repoPath}/${skillName}`;

            // Check if already active (valid symlink exists pointing to correct target)
            const currentStatus = yield* checkSymlink(ssh, host, skillName, activeDir);

            if (currentStatus === "active") {
              // Already active — idempotent success
              yield* Effect.annotateCurrentSpan("skill.alreadyActive", true);
              return {
                host: host.hostname,
                skillName,
                alreadyInState: true,
                status: "active" as const,
              } satisfies ActivationResult;
            }

            // Ensure the active directory exists
            yield* ssh.executeCommand(host, `mkdir -p ${activeDir}`).pipe(
              Effect.catchTag("CommandFailed", (err) =>
                Effect.fail(
                  new ActivationFailed({
                    host: host.hostname,
                    skillName,
                    operation: "activate",
                    cause: `Failed to create active directory: ${err.stderr}`,
                  }),
                ),
              ),
            );

            // Remove any existing broken symlink before creating a new one
            yield* ssh.executeCommand(
              host,
              `test -L ${symlinkPath} && rm ${symlinkPath} || true`,
            ).pipe(
              Effect.catchTag("CommandFailed", (err) =>
                Effect.fail(
                  new ActivationFailed({
                    host: host.hostname,
                    skillName,
                    operation: "activate",
                    cause: `Failed to remove broken symlink: ${err.stderr}`,
                  }),
                ),
              ),
            );

            // Create the symlink
            yield* ssh.executeCommand(host, `ln -s ${targetPath} ${symlinkPath}`).pipe(
              Effect.catchTag("CommandFailed", (err) =>
                Effect.fail(
                  new ActivationFailed({
                    host: host.hostname,
                    skillName,
                    operation: "activate",
                    cause: `Failed to create symlink: ${err.stderr}`,
                  }),
                ),
              ),
            );

            yield* Effect.annotateCurrentSpan("skill.alreadyActive", false);
            yield* Effect.annotateCurrentSpan("skill.activated", true);

            return {
              host: host.hostname,
              skillName,
              alreadyInState: false,
              status: "active" as const,
            } satisfies ActivationResult;
          }),
        ),

      deactivateSkill: (
        host: HostConfig,
        skillName: string,
        activeDir: string,
      ) =>
        withSpan("skill.deactivateSkill", {
          attributes: {
            host: host.hostname,
            operation: "deactivateSkill",
            skillName,
            activeDir,
          },
        })(
          Effect.gen(function* () {
            const symlinkPath = `${activeDir}/${skillName}`;

            // Check if a symlink exists at all (even broken ones should be removed)
            const symlinkExistsResult = yield* ssh
              .executeCommand(host, `test -L ${symlinkPath} && echo "exists" || echo "absent"`)
              .pipe(
                Effect.catchTag("CommandFailed", () =>
                  Effect.succeed({ stdout: "absent\n", stderr: "", exitCode: 0 }),
                ),
              );

            const symlinkExists = symlinkExistsResult.stdout.trim() === "exists";

            if (!symlinkExists) {
              // Already inactive — idempotent success
              yield* Effect.annotateCurrentSpan("skill.alreadyInactive", true);
              return {
                host: host.hostname,
                skillName,
                alreadyInState: true,
                status: "inactive" as const,
              } satisfies ActivationResult;
            }

            // Remove the symlink (rm on a symlink only removes the link, not the target)
            yield* ssh.executeCommand(host, `rm ${symlinkPath}`).pipe(
              Effect.catchTag("CommandFailed", (err) =>
                Effect.fail(
                  new ActivationFailed({
                    host: host.hostname,
                    skillName,
                    operation: "deactivate",
                    cause: `Failed to remove symlink: ${err.stderr}`,
                  }),
                ),
              ),
            );

            yield* Effect.annotateCurrentSpan("skill.alreadyInactive", false);
            yield* Effect.annotateCurrentSpan("skill.deactivated", true);

            return {
              host: host.hostname,
              skillName,
              alreadyInState: false,
              status: "inactive" as const,
            } satisfies ActivationResult;
          }),
        ),
    });
  }),
);

/**
 * Check whether a skill has an active symlink in the active directory.
 *
 * A skill is "active" if a symlink with its name exists in activeDir
 * AND the symlink target is valid (not broken). Broken symlinks are
 * reported as "inactive".
 */
const checkSymlink = (
  ssh: SshExecutor["Type"],
  host: HostConfig,
  skillName: string,
  activeDir: string,
): Effect.Effect<
  SkillStatus,
  never
> => {
  const symlinkPath = `${activeDir}/${skillName}`;

  // Use test -L to check symlink existence and test -e to check target validity.
  // `test -L` returns true for any symlink (even broken ones).
  // `test -e` returns true only if the symlink target exists.
  // So: -L && -e means "valid symlink" → active
  //     -L && !-e means "broken symlink" → inactive
  //     !-L means "no symlink" → inactive
  return ssh
    .executeCommand(
      host,
      `test -L ${symlinkPath} && test -e ${symlinkPath} && echo "active" || echo "inactive"`,
    )
    .pipe(
      Effect.map((result) => {
        const status = result.stdout.trim();
        return status === "active" ? "active" : "inactive";
      }),
      // If SSH fails for any reason, default to inactive
      Effect.catchAll(() => Effect.succeed("inactive" as SkillStatus)),
    );
};
