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
import type { PullResult, PushResult } from "./types.js";
import {
  GitCommandFailed,
  NotARepository,
  MergeConflict,
  PushRejected,
  AuthError,
  TimeoutError,
} from "./errors.js";

/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 *
 * Uses POSIX-compliant single quoting: wraps the value in single quotes and
 * escapes any embedded single quotes using the `'\''` idiom (end quote,
 * escaped single quote, re-open quote).
 *
 * This prevents shell injection via metacharacters, command substitution,
 * variable expansion, pipes, semicolons, newlines, etc.
 */
const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

/**
 * Check whether the stderr indicates the directory is not a git repository.
 */
const isNotARepository = (stderr: string): boolean => {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not a git repository") ||
    lower.includes("not a git repo")
  );
};

/**
 * Check whether the stderr indicates an authentication failure on a git remote.
 */
const isAuthFailure = (stderr: string): boolean => {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("permission denied") ||
    lower.includes("authentication failed") ||
    lower.includes("could not read from remote repository") ||
    lower.includes("invalid credentials") ||
    lower.includes("fatal: authentication failed")
  );
};

/**
 * Check whether stderr indicates a network timeout during a remote git operation.
 */
const isNetworkTimeout = (stderr: string): boolean => {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("connection timed out") ||
    lower.includes("operation timed out") ||
    lower.includes("failed to connect") ||
    lower.includes("could not resolve host") ||
    lower.includes("network is unreachable") ||
    lower.includes("timed out")
  );
};

/**
 * Execute a git command in a repository on a remote host.
 *
 * Wraps the SSH execution so that CommandFailed errors from non-zero
 * exit codes are re-mapped to specific typed errors:
 * - NotARepository when the path is not a git repo
 * - AuthError when remote auth fails
 * - TimeoutError when a remote operation times out
 * - GitCommandFailed for all other failures
 *
 * SSH-level timeouts (ConnectionTimeout, CommandTimeout) are also
 * mapped to TimeoutError for remote operations.
 */
const execGit = (
  ssh: SshExecutor["Type"],
  host: HostConfig,
  repoPath: string,
  gitCommand: string,
): Effect.Effect<
  { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError
> => {
  const fullCommand = `cd ${repoPath} && ${gitCommand}`;
  return ssh.executeCommand(host, fullCommand).pipe(
    Effect.catchTag("CommandFailed", (err: CommandFailed): Effect.Effect<
      never,
      GitCommandFailed | NotARepository | AuthError | TimeoutError
    > => {
      // Detect not-a-repository from stderr
      if (isNotARepository(err.stderr)) {
        return Effect.fail(
          new NotARepository({
            host: err.host,
            path: repoPath,
          }),
        );
      }
      // Detect auth failures from stderr
      if (isAuthFailure(err.stderr)) {
        return Effect.fail(
          new AuthError({
            host: err.host,
            stderr: err.stderr,
          }),
        );
      }
      // Detect network timeouts from stderr
      if (isNetworkTimeout(err.stderr)) {
        return Effect.fail(
          new TimeoutError({
            host: err.host,
            operation: gitCommand,
            stderr: err.stderr,
          }),
        );
      }
      return Effect.fail(
        new GitCommandFailed({
          host: err.host,
          command: gitCommand,
          exitCode: err.exitCode,
          stderr: err.stderr,
        }),
      );
    }),
    // Map SSH-level connection/command timeouts to TimeoutError
    Effect.catchTag("ConnectionTimeout", (err) =>
      Effect.fail(
        new TimeoutError({
          host: err.host,
          operation: gitCommand,
          stderr: `SSH connection timed out after ${err.timeoutMs}ms`,
        }),
      ),
    ),
    Effect.catchTag("CommandTimeout", (err) =>
      Effect.fail(
        new TimeoutError({
          host: err.host,
          operation: gitCommand,
          stderr: `Command timed out after ${err.timeoutMs}ms`,
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
              Effect.catchTag("GitCommandFailed", (err) => {
                // Only catch the specific detached-HEAD case where
                // `git symbolic-ref` fails because HEAD is not a symbolic ref.
                // Propagate all other GitCommandFailed errors.
                const lower = err.stderr.toLowerCase();
                if (
                  lower.includes("not a symbolic ref") ||
                  lower.includes("ref head is not a symbolic ref")
                ) {
                  return Effect.succeed({ stdout: "HEAD\n", stderr: "", exitCode: 0 });
                }
                return Effect.fail(err);
              }),
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
            const result = yield* execGit(ssh, host, repoPath, "git status --porcelain");
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

      pull: (host: HostConfig, repoPath: string) =>
        withSpan("git.pull", {
          attributes: { host: host.hostname, operation: "pull", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* execGit(ssh, host, repoPath, "git pull origin").pipe(
              Effect.catchTag("GitCommandFailed", (err: GitCommandFailed): Effect.Effect<
                never,
                GitCommandFailed | MergeConflict
              > => {
                // Detect merge conflicts from stderr/exit code
                const stderr = err.stderr.toLowerCase();
                if (
                  stderr.includes("conflict") ||
                  stderr.includes("merge conflict") ||
                  stderr.includes("automatic merge failed")
                ) {
                  // Extract conflicted file names from stderr
                  const files = extractConflictFiles(err.stderr);
                  return Effect.fail(
                    new MergeConflict({
                      host: err.host,
                      files,
                      stderr: err.stderr,
                    }),
                  );
                }
                // Not a conflict, re-throw as GitCommandFailed
                return Effect.fail(err);
              }),
            );

            const summary = result.stdout.trim();
            const updated = !summary.includes("Already up to date");
            yield* Effect.annotateCurrentSpan("git.updated", updated);
            yield* Effect.annotateCurrentSpan("git.summary", summary);
            return { updated, summary } satisfies PullResult;
          }),
        ),

      push: (host: HostConfig, repoPath: string) =>
        withSpan("git.push", {
          attributes: { host: host.hostname, operation: "push", repoPath },
        })(
          Effect.gen(function* () {
            const result = yield* execGit(ssh, host, repoPath, "git push origin").pipe(
              Effect.catchTag("GitCommandFailed", (err: GitCommandFailed): Effect.Effect<
                never,
                GitCommandFailed | PushRejected
              > => {
                const stderr = err.stderr.toLowerCase();
                // Detect push rejections (non-fast-forward, pre-receive hook, etc.)
                if (
                  stderr.includes("rejected") ||
                  stderr.includes("non-fast-forward") ||
                  stderr.includes("failed to push")
                ) {
                  const reason = extractPushRejectionReason(err.stderr);
                  return Effect.fail(
                    new PushRejected({
                      host: err.host,
                      reason,
                      stderr: err.stderr,
                    }),
                  );
                }
                return Effect.fail(err);
              }),
            );

            // git push output goes to stderr for progress, stdout for summary
            const summary = (result.stderr.trim() || result.stdout.trim());
            yield* Effect.annotateCurrentSpan("git.summary", summary);
            return { summary } satisfies PushResult;
          }),
        ),

      createTag: (host: HostConfig, repoPath: string, name: string, ref?: string) =>
        withSpan("git.createTag", {
          attributes: { host: host.hostname, operation: "createTag", repoPath, "git.tagName": name },
        })(
          Effect.gen(function* () {
            // Use -- separator to prevent flag injection from leading dashes,
            // and shellQuote to prevent shell metacharacter injection.
            const command = ref
              ? `git tag -- ${shellQuote(name)} ${shellQuote(ref)}`
              : `git tag -- ${shellQuote(name)}`;
            yield* execGit(ssh, host, repoPath, command);
            yield* Effect.annotateCurrentSpan("git.tagName", name);
            if (ref) {
              yield* Effect.annotateCurrentSpan("git.tagRef", ref);
            }
          }),
        ),

      checkoutRef: (host: HostConfig, repoPath: string, ref: string) =>
        withSpan("git.checkoutRef", {
          attributes: { host: host.hostname, operation: "checkoutRef", repoPath, "git.ref": ref },
        })(
          Effect.gen(function* () {
            // shellQuote wraps the ref in single quotes which prevents both
            // shell metacharacter injection AND flag injection (leading dashes
            // inside single quotes are literal, not flags).
            // NOTE: Do NOT use `--` here — for `git checkout`, `--` is a
            // pathspec separator that tells git to treat the argument as a
            // file path rather than a branch/tag/SHA, which breaks checkout.
            yield* execGit(ssh, host, repoPath, `git checkout ${shellQuote(ref)}`);
            yield* Effect.annotateCurrentSpan("git.ref", ref);
          }),
        ),
    });
  }),
);

/**
 * Extract conflicted file names from git merge conflict stderr output.
 */
const extractConflictFiles = (stderr: string): Array<string> => {
  const files: Array<string> = [];
  const lines = stderr.split("\n");
  for (const line of lines) {
    // Match lines like "CONFLICT (content): Merge conflict in <file>"
    const match = line.match(/CONFLICT\s+\([^)]+\):\s+Merge conflict in\s+(.+)/);
    if (match?.[1]) {
      files.push(match[1].trim());
    }
  }
  return files;
};

/**
 * Extract the push rejection reason from git push stderr output.
 */
const extractPushRejectionReason = (stderr: string): string => {
  const lines = stderr.split("\n");
  for (const line of lines) {
    // Look for the hint/error line that explains the rejection
    if (line.includes("rejected") || line.includes("non-fast-forward")) {
      return line.trim();
    }
  }
  // Fallback: return the first non-empty line
  return lines.find((l) => l.trim().length > 0)?.trim() ?? "unknown rejection reason";
};
