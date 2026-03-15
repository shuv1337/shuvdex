/**
 * Live implementation of the SkillOps service.
 *
 * Executes commands on remote hosts via the SshExecutor service to discover
 * skills and check their activation status. All operations are traced
 * with OTEL spans via @codex-fleet/telemetry.
 */
import { Effect, Layer } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutor, CommandFailed } from "@codex-fleet/ssh";
import { withSpan } from "@codex-fleet/telemetry";
import { SkillOps } from "./types.js";
import type { SkillInfo, SkillStatus } from "./types.js";
import { SkillCommandFailed, SkillRepoNotFound } from "./errors.js";

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
