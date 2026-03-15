/**
 * Live implementation of the GitOps service.
 *
 * Executes git commands on remote hosts via the SshExecutor service.
 * All operations are traced with OTEL spans via @codex-fleet/telemetry.
 */
import { Effect, Layer } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutor, CommandFailed } from "@codex-fleet/ssh";
import type { SshError } from "@codex-fleet/ssh";
import { withSpan } from "@codex-fleet/telemetry";
import { GitOps } from "./types.js";
import { GitCommandFailed } from "./errors.js";

/**
 * Execute a git command in a repository on a remote host.
 *
 * Wraps the SSH execution so that CommandFailed errors from non-zero
 * exit codes are re-mapped to GitCommandFailed for clearer error typing
 * at the git-ops layer.
 */
const execGit = (
  ssh: SshExecutor["Type"],
  host: HostConfig,
  repoPath: string,
  gitCommand: string,
): Effect.Effect<
  { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  SshError | GitCommandFailed
> => {
  const fullCommand = `cd ${repoPath} && ${gitCommand}`;
  return ssh.executeCommand(host, fullCommand).pipe(
    Effect.catchTag("CommandFailed", (err: CommandFailed) =>
      Effect.fail(
        new GitCommandFailed({
          host: err.host,
          command: gitCommand,
          exitCode: err.exitCode,
          stderr: err.stderr,
        }),
      ),
    ),
  );
};

/**
 * Live GitOps layer backed by SshExecutor.
 *
 * All operations create OTEL spans with host, operation, and repoPath attributes.
 */
export const GitOpsLive: Layer.Layer<GitOps, never, SshExecutor> = Layer.effect(
  GitOps,
  Effect.gen(function* () {
    const ssh = yield* SshExecutor;

    return GitOps.of({
      getHead: (host: HostConfig, repoPath: string) =>
        withSpan("git.getHead", {
          attributes: { host: host.hostname, operation: "getHead", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* execGit(ssh, host, repoPath, "git rev-parse HEAD");
            const sha = result.stdout.trim();
            yield* Effect.annotateCurrentSpan("git.sha", sha);
            return sha;
          }),
        ),

      getBranch: (host: HostConfig, repoPath: string) =>
        withSpan("git.getBranch", {
          attributes: { host: host.hostname, operation: "getBranch", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* execGit(
              ssh,
              host,
              repoPath,
              "git symbolic-ref --short HEAD",
            ).pipe(
              Effect.catchTag("GitCommandFailed", () =>
                // Detached HEAD: symbolic-ref fails, return sentinel value
                Effect.succeed({ stdout: "HEAD\n", stderr: "", exitCode: 0 }),
              ),
            );
            const branch = result.stdout.trim();
            yield* Effect.annotateCurrentSpan("git.branch", branch);
            return branch;
          }),
        ),

      isDirty: (host: HostConfig, repoPath: string) =>
        withSpan("git.isDirty", {
          attributes: { host: host.hostname, operation: "isDirty", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* ssh
              .executeCommand(host, `cd ${repoPath} && git status --porcelain`)
              .pipe(
                Effect.catchTag("CommandFailed", (err: CommandFailed) =>
                  Effect.fail(
                    new GitCommandFailed({
                      host: err.host,
                      command: "git status --porcelain",
                      exitCode: err.exitCode,
                      stderr: err.stderr,
                    }),
                  ),
                ),
              );
            const dirty = result.stdout.trim().length > 0;
            yield* Effect.annotateCurrentSpan("git.dirty", dirty);
            return dirty;
          }),
        ),

      listTags: (host: HostConfig, repoPath: string) =>
        withSpan("git.listTags", {
          attributes: { host: host.hostname, operation: "listTags", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* execGit(ssh, host, repoPath, "git tag");
            const output = result.stdout.trim();
            const tags = output.length === 0 ? [] : output.split("\n");
            yield* Effect.annotateCurrentSpan("git.tagCount", tags.length);
            return tags;
          }),
        ),
    });
  }),
);
