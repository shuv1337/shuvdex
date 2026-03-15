/**
 * Fleet status command implementation.
 *
 * Connects to all configured hosts and reports their connectivity status.
 * Supports text table output and --json flag for machine-readable output.
 *
 * Exit codes:
 * - 0: All hosts reachable
 * - 1: One or more hosts unreachable
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { SshExecutor } from "@codex-fleet/ssh";
import type { SshError } from "@codex-fleet/ssh";
import { withSpan } from "@codex-fleet/telemetry";

/**
 * Status of a single host after a connectivity check.
 */
export interface HostStatus {
  readonly name: string;
  readonly hostname: string;
  readonly status: "online" | "error";
  readonly error?: string;
}

/**
 * Result of the fleet status command.
 */
export interface StatusResult {
  readonly hosts: ReadonlyArray<HostStatus>;
  readonly allOnline: boolean;
}

/**
 * Check connectivity to a single host by running a simple command.
 *
 * Returns HostStatus with "online" if reachable, "error" with message if not.
 * This function catches all SSH errors so it never fails — unreachable hosts
 * are reported in the result, not as errors.
 */
export const checkHost = (
  name: string,
  config: HostConfig,
): Effect.Effect<HostStatus, never, SshExecutor> =>
  Effect.gen(function* () {
    const ssh = yield* SshExecutor;
    const result = yield* ssh
      .executeCommand(config, "echo ok", { timeoutMs: config.timeout * 1000 })
      .pipe(
        Effect.map(
          (): HostStatus => ({
            name,
            hostname: config.hostname,
            status: "online",
          }),
        ),
        Effect.catchAll((err: SshError) =>
          Effect.succeed<HostStatus>({
            name,
            hostname: config.hostname,
            status: "error",
            error: err.message,
          }),
        ),
      );
    return result;
  });

/**
 * Run the status command: check all hosts in parallel and return results.
 */
export const runStatus = (
  registry: HostRegistry,
): Effect.Effect<StatusResult, never, SshExecutor> =>
  withSpan("cli.status")(
    Effect.gen(function* () {
      const allHosts = registry.getAllHosts();

      // Check all hosts concurrently
      const statuses = yield* Effect.all(
        allHosts.map(([name, config]) => checkHost(name, config)),
        { concurrency: "unbounded" },
      );

      const allOnline = statuses.every((s) => s.status === "online");

      return { hosts: statuses, allOnline };
    }),
  );

/**
 * Format status result as a human-readable table.
 */
export const formatTable = (result: StatusResult): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS");
  lines.push("─".repeat(40));

  for (const host of result.hosts) {
    const status =
      host.status === "online"
        ? "✓ online"
        : `✗ error: ${host.error ?? "unknown"}`;
    lines.push(`${host.name.padEnd(15)}${status}`);
  }

  lines.push("─".repeat(40));
  const onlineCount = result.hosts.filter(
    (h) => h.status === "online",
  ).length;
  lines.push(
    `${onlineCount}/${result.hosts.length} hosts online`,
  );

  return lines.join("\n");
};

/**
 * Format status result as JSON.
 */
export const formatJson = (result: StatusResult): string =>
  JSON.stringify(
    {
      hosts: result.hosts.map((h) => ({
        name: h.name,
        hostname: h.hostname,
        status: h.status,
        ...(h.error ? { error: h.error } : {}),
      })),
      allOnline: result.allOnline,
    },
    null,
    2,
  );
