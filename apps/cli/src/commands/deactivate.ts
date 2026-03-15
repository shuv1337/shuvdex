/**
 * Fleet deactivate command implementation.
 *
 * Deactivates a skill on specified hosts (or all) by removing symlinks
 * via skill-ops deactivateSkill. Handles already-inactive idempotently.
 * Reports per-host deactivation status.
 *
 * Exit codes:
 * - 0: All hosts deactivated successfully (or already inactive)
 * - 1: All hosts failed or missing skill argument
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { SkillOps } from "@codex-fleet/skill-ops";
import type { SkillStatus } from "@codex-fleet/skill-ops";
import { withSpan } from "@codex-fleet/telemetry";
import { validateHostFilters } from "./validate-hosts.js";

/**
 * Result of a deactivate operation on a single host.
 */
export type HostDeactivateResult =
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "ok";
      readonly alreadyInState: boolean;
      readonly skillStatus: SkillStatus;
    }
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "fail";
      readonly error: string;
    };

/**
 * Aggregated result of the deactivate command across all hosts.
 */
export interface DeactivateCommandResult {
  readonly skillName: string;
  readonly hosts: ReadonlyArray<HostDeactivateResult>;
  readonly allSucceeded: boolean;
  readonly unknownHosts?: ReadonlyArray<string>;
}

/**
 * Deactivate skill on a single host, catching all errors so the operation never fails.
 */
const deactivateHost = (
  name: string,
  config: HostConfig,
  skillName: string,
  activeDir: string,
): Effect.Effect<HostDeactivateResult, never, SkillOps> =>
  Effect.gen(function* () {
    const skillOps = yield* SkillOps;
    const result = yield* skillOps
      .deactivateSkill(config, skillName, activeDir)
      .pipe(
        Effect.map(
          (activationResult): HostDeactivateResult => ({
            name,
            hostname: config.hostname,
            status: "ok",
            alreadyInState: activationResult.alreadyInState,
            skillStatus: activationResult.status,
          }),
        ),
        Effect.catchAll(
          (err: { readonly message: string }) =>
            Effect.succeed<HostDeactivateResult>({
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
 * Run the deactivate command: deactivate skill on specified hosts (or all)
 * and return results.
 *
 * @param registry - The host registry
 * @param skillName - Name of the skill to deactivate
 * @param activeDir - Path to the active skills directory on remote hosts
 * @param filterHosts - Optional list of host names to deactivate on (default: all)
 */
export const runDeactivate = (
  registry: HostRegistry,
  skillName: string,
  activeDir: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<DeactivateCommandResult, never, SkillOps> =>
  withSpan("cli.deactivate")(
    Effect.gen(function* () {
      // Validate host filters before attempting any operations
      const validationError = validateHostFilters(registry, filterHosts);
      if (validationError) {
        return {
          skillName,
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

      // Deactivate on all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) =>
          deactivateHost(name, config, skillName, activeDir),
        ),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { skillName, hosts: results, allSucceeded };
    }),
  );

/**
 * Format deactivate result as a human-readable table.
 */
export const formatDeactivateTable = (
  result: DeactivateCommandResult,
): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS          DETAIL");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      const detail = host.alreadyInState ? "not active" : "deactivated";
      lines.push(
        `${host.name.padEnd(15)}${"[OK]  ok".padEnd(20)}${detail}`,
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
 * Format deactivate result as JSON.
 */
export const formatDeactivateJson = (
  result: DeactivateCommandResult,
): string =>
  JSON.stringify(
    {
      skillName: result.skillName,
      hosts: result.hosts.map((h) =>
        h.status === "ok"
          ? {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              alreadyInState: h.alreadyInState,
              skillStatus: h.skillStatus,
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
