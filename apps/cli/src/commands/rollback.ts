/**
 * Fleet rollback command implementation.
 *
 * Checks out a specific git reference (branch, tag, or SHA) on specified
 * hosts (or all). Uses git-ops checkoutRef() for each host and aggregates
 * results. Invalid refs produce clear errors per host.
 *
 * Exit codes:
 * - 0: All hosts checked out successfully
 * - 1: All hosts failed
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { GitOps } from "@codex-fleet/git-ops";
import { withSpan } from "@codex-fleet/telemetry";
import { validateHostFilters } from "./validate-hosts.js";

/**
 * Result of a rollback operation on a single host.
 */
export type HostRollbackResult =
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "ok";
      readonly ref: string;
    }
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "fail";
      readonly error: string;
    };

/**
 * Aggregated result of the rollback command across all hosts.
 */
export interface RollbackCommandResult {
  readonly ref: string;
  readonly hosts: ReadonlyArray<HostRollbackResult>;
  readonly allSucceeded: boolean;
  readonly unknownHosts?: ReadonlyArray<string>;
}

/**
 * Rollback on a single host, catching all errors so the operation never fails.
 */
const rollbackHost = (
  name: string,
  config: HostConfig,
  ref: string,
  repoPath: string,
): Effect.Effect<HostRollbackResult, never, GitOps> =>
  Effect.gen(function* () {
    const gitOps = yield* GitOps;
    const result = yield* gitOps
      .checkoutRef(config, repoPath, ref)
      .pipe(
        Effect.map(
          (): HostRollbackResult => ({
            name,
            hostname: config.hostname,
            status: "ok",
            ref,
          }),
        ),
        Effect.catchAll(
          (err: { readonly message: string }) =>
            Effect.succeed<HostRollbackResult>({
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
 * Run the rollback command: checkout ref on specified hosts (or all)
 * and return results.
 *
 * @param registry - The host registry
 * @param ref - The git reference to checkout
 * @param repoPath - Path to the git repository on remote hosts
 * @param filterHosts - Optional list of host names to rollback on (default: all)
 */
export const runRollback = (
  registry: HostRegistry,
  ref: string,
  repoPath: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<RollbackCommandResult, never, GitOps> =>
  withSpan("cli.rollback")(
    Effect.gen(function* () {
      // Validate host filters before attempting any operations
      const validationError = validateHostFilters(registry, filterHosts);
      if (validationError) {
        return {
          ref,
          hosts: [],
          allSucceeded: false,
          unknownHosts: validationError.unknownHosts,
        };
      }

      const allHosts = registry.getAllHosts();

      // Filter to specified hosts if provided
      const targetHosts =
        filterHosts && filterHosts.length > 0
          ? allHosts.filter(([name]) => filterHosts.includes(name))
          : allHosts;

      // Rollback all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) =>
          rollbackHost(name, config, ref, repoPath),
        ),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { ref, hosts: results, allSucceeded };
    }),
  );

/**
 * Format rollback result as a human-readable table.
 */
export const formatRollbackTable = (result: RollbackCommandResult): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS          DETAIL");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      lines.push(
        `${host.name.padEnd(15)}${"[OK]  ok".padEnd(20)}checked out ${host.ref}`,
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
 * Format rollback result as JSON.
 */
export const formatRollbackJson = (result: RollbackCommandResult): string =>
  JSON.stringify(
    {
      ref: result.ref,
      hosts: result.hosts.map((h) =>
        h.status === "ok"
          ? {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              ref: h.ref,
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
