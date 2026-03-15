/**
 * Fleet pull command implementation.
 *
 * Pulls latest changes from the remote origin on specified hosts (or all).
 * Uses git-ops pull() for each host and aggregates results.
 *
 * Exit codes:
 * - 0: All hosts pulled successfully
 * - 1: All hosts failed
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { GitOps } from "@codex-fleet/git-ops";
import type { SshError } from "@codex-fleet/ssh";
import { withSpan } from "@codex-fleet/telemetry";

/**
 * Result of a pull operation on a single host.
 */
export type HostPullResult =
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "ok";
      readonly updated: boolean;
      readonly summary: string;
    }
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "fail";
      readonly error: string;
    };

/**
 * Aggregated result of the pull command across all hosts.
 */
export interface PullCommandResult {
  readonly hosts: ReadonlyArray<HostPullResult>;
  readonly allSucceeded: boolean;
}

/**
 * Pull on a single host, catching all errors so the operation never fails.
 */
const pullHost = (
  name: string,
  config: HostConfig,
  repoPath: string,
): Effect.Effect<HostPullResult, never, GitOps> =>
  Effect.gen(function* () {
    const gitOps = yield* GitOps;
    const result = yield* gitOps.pull(config, repoPath).pipe(
      Effect.map(
        (pullResult): HostPullResult => ({
          name,
          hostname: config.hostname,
          status: "ok",
          updated: pullResult.updated,
          summary: pullResult.summary,
        }),
      ),
      Effect.catchAll((err: SshError | { readonly message: string }) =>
        Effect.succeed<HostPullResult>({
          name,
          hostname: config.hostname,
          status: "fail",
          error: err.message,
        }),
      ),
    );
    return result;
  });

/**
 * Run the pull command: pull on specified hosts (or all) and return results.
 *
 * @param registry - The host registry
 * @param repoPath - Path to the git repository on remote hosts
 * @param filterHosts - Optional list of host names to pull on (default: all)
 */
export const runPull = (
  registry: HostRegistry,
  repoPath: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<PullCommandResult, never, GitOps> =>
  withSpan("cli.pull")(
    Effect.gen(function* () {
      const allHosts = registry.getAllHosts();

      // Filter to specified hosts if provided
      const targetHosts =
        filterHosts && filterHosts.length > 0
          ? allHosts.filter(([name]) => filterHosts.includes(name))
          : allHosts;

      // Pull all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) => pullHost(name, config, repoPath)),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { hosts: results, allSucceeded };
    }),
  );

/**
 * Format pull result as a human-readable table.
 */
export const formatPullTable = (result: PullCommandResult): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS          SUMMARY");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      const detail = host.updated ? "updated" : "up to date";
      lines.push(
        `${host.name.padEnd(15)}${`[OK]  ${detail}`.padEnd(20)}${host.summary}`,
      );
    } else {
      lines.push(
        `${host.name.padEnd(15)}${"[FAIL] failed".padEnd(20)}${host.error}`,
      );
    }
  }

  lines.push("─".repeat(60));
  const okCount = result.hosts.filter((h) => h.status === "ok").length;
  const failCount = result.hosts.length - okCount;
  lines.push(
    `${okCount} succeeded, ${failCount} failed`,
  );

  return lines.join("\n");
};

/**
 * Format pull result as JSON.
 */
export const formatPullJson = (result: PullCommandResult): string =>
  JSON.stringify(
    {
      hosts: result.hosts.map((h) =>
        h.status === "ok"
          ? {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              updated: h.updated,
              summary: h.summary,
            }
          : {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              error: h.error,
            },
      ),
      allSucceeded: result.allSucceeded,
    },
    null,
    2,
  );
