/**
 * Live SSH executor implementation using node:child_process.
 *
 * Spawns `ssh` as a child process for each command execution,
 * relying on the system's SSH agent and key-based authentication.
 */
import { Effect, Layer } from "effect";
import { execFile } from "node:child_process";
import type { HostConfig } from "@codex-fleet/core";
import { withSpan } from "@codex-fleet/telemetry";
import { SshExecutor } from "./types.js";
import type { CommandResult, ExecuteCommandOptions } from "./types.js";
import { ConnectionFailed, ConnectionTimeout, CommandFailed } from "./errors.js";

/**
 * Build the ssh command arguments for a given host configuration.
 */
function buildSshArgs(host: HostConfig): Array<string> {
  const args: Array<string> = [];

  // Strict host key checking disabled for automation
  args.push("-o", "StrictHostKeyChecking=accept-new");

  // Disable password auth to prevent hanging on prompts
  args.push("-o", "PasswordAuthentication=no");
  args.push("-o", "BatchMode=yes");

  // Port
  if (host.port !== 22) {
    args.push("-p", String(host.port));
  }

  // Key path
  if (host.keyPath) {
    args.push("-i", host.keyPath);
  }

  // User@hostname
  const target = host.user ? `${host.user}@${host.hostname}` : host.hostname;
  args.push(target);

  return args;
}

/**
 * Execute a command on a remote host via SSH using node:child_process.
 *
 * Returns an Effect that:
 * - Succeeds with CommandResult (stdout, stderr, exitCode) for ALL exit codes
 * - Fails with ConnectionTimeout if the SSH connection times out
 * - Fails with ConnectionFailed if the SSH connection cannot be established
 *
 * Note: Non-zero exit codes are returned in the result, NOT as errors from this
 * internal function. The service layer handles promoting non-zero exits to
 * CommandFailed errors.
 */
function execSsh(
  host: HostConfig,
  command: string,
  timeoutMs: number,
): Effect.Effect<CommandResult, ConnectionFailed | ConnectionTimeout> {
  return Effect.async<CommandResult, ConnectionFailed | ConnectionTimeout>(
    (resume) => {
      const args = [
        ...buildSshArgs(host),
        "-o",
        `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
        command,
      ];

      const child = execFile("ssh", args, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        encoding: "utf-8",
      }, (error, stdout, stderr) => {
        if (error) {
          // Check if it was killed due to timeout
          if (error.killed || error.signal === "SIGTERM") {
            resume(
              Effect.fail(
                new ConnectionTimeout({
                  host: host.hostname,
                  timeoutMs,
                }),
              ),
            );
            return;
          }

          // Check for SSH-specific connection errors
          // SSH exits with 255 for connection failures
          if (error.code === 255 || (typeof error.code === "number" && error.code === null)) {
            const stderrStr = String(stderr || "");
            // Check if this is a timeout-like error in stderr
            if (
              stderrStr.includes("Connection timed out") ||
              stderrStr.includes("Operation timed out") ||
              stderrStr.includes("connect timed out")
            ) {
              resume(
                Effect.fail(
                  new ConnectionTimeout({
                    host: host.hostname,
                    timeoutMs,
                  }),
                ),
              );
              return;
            }

            resume(
              Effect.fail(
                new ConnectionFailed({
                  host: host.hostname,
                  cause: stderrStr || String(error.message),
                }),
              ),
            );
            return;
          }

          // For other errors (non-zero exit codes), return result with exit code
          const exitCode = typeof error.code === "number" ? error.code : 1;
          resume(
            Effect.succeed({
              stdout: String(stdout || ""),
              stderr: String(stderr || ""),
              exitCode,
            }),
          );
          return;
        }

        // Success (exit code 0)
        resume(
          Effect.succeed({
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
            exitCode: 0,
          }),
        );
      });

      // Return a cleanup function that kills the child process
      return Effect.sync(() => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      });
    },
  );
}

/**
 * Live SSH executor layer.
 *
 * Uses the system's `ssh` command via node:child_process for execution.
 * All operations are traced with OTEL spans via @codex-fleet/telemetry.
 */
export const SshExecutorLive: Layer.Layer<SshExecutor> = Layer.succeed(
  SshExecutor,
  SshExecutor.of({
    executeCommand: (
      host: HostConfig,
      command: string,
      options?: ExecuteCommandOptions,
    ) => {
      const timeoutMs = options?.timeoutMs ?? host.timeout * 1000;

      return withSpan("ssh.executeCommand", {
        attributes: {
          host: host.hostname,
          command,
          port: host.port,
          "ssh.timeout_ms": timeoutMs,
        },
      })(
        Effect.gen(function* () {
          const result = yield* execSsh(host, command, timeoutMs);

          // Annotate the span with the exit code
          yield* Effect.annotateCurrentSpan("exitCode", result.exitCode);

          // If non-zero exit code, fail with CommandFailed
          if (result.exitCode !== 0) {
            return yield* Effect.fail(
              new CommandFailed({
                host: host.hostname,
                command,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
              }),
            );
          }

          return result;
        }),
      );
    },
  }),
);
