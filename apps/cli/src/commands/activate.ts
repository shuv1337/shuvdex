/**
 * Fleet activate command implementation.
 *
 * Activates a skill on specified hosts (or all) by creating symlinks
 * via skill-ops activateSkill. Handles already-active idempotently.
 * Reports per-host activation status.
 *
 * Exit codes:
 * - 0: All hosts activated successfully (or already active)
 * - 1: All hosts failed or missing skill argument
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { SkillOps } from "@codex-fleet/skill-ops";
import type { SkillStatus } from "@codex-fleet/skill-ops";
import { withSpan } from "@codex-fleet/telemetry";

/**
 * Result of an activate operation on a single host.
 */
export type HostActivateResult =
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
 * Aggregated result of the activate command across all hosts.
 */
export interface ActivateCommandResult {
  readonly skillName: string;
  readonly hosts: ReadonlyArray<HostActivateResult>;
  readonly allSucceeded: boolean;
}

/**
 * Activate skill on a single host, catching all errors so the operation never fails.
 */
const activateHost = (
  name: string,
  config: HostConfig,
  skillName: string,
  repoPath: string,
  activeDir: string,
): Effect.Effect<HostActivateResult, never, SkillOps> =>
  Effect.gen(function* () {
    const skillOps = yield* SkillOps;
    const result = yield* skillOps
      .activateSkill(config, skillName, repoPath, activeDir)
      .pipe(
        Effect.map(
          (activationResult): HostActivateResult => ({
            name,
            hostname: config.hostname,
            status: "ok",
            alreadyInState: activationResult.alreadyInState,
            skillStatus: activationResult.status,
          }),
        ),
        Effect.catchAll(
          (err: { readonly message: string }) =>
            Effect.succeed<HostActivateResult>({
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
 * Run the activate command: activate skill on specified hosts (or all)
 * and return results.
 *
 * @param registry - The host registry
 * @param skillName - Name of the skill to activate
 * @param repoPath - Path to the skills repository on remote hosts
 * @param activeDir - Path to the active skills directory on remote hosts
 * @param filterHosts - Optional list of host names to activate on (default: all)
 */
export const runActivate = (
  registry: HostRegistry,
  skillName: string,
  repoPath: string,
  activeDir: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<ActivateCommandResult, never, SkillOps> =>
  withSpan("cli.activate")(
    Effect.gen(function* () {
      const allHosts = registry.getAllHosts();

      // Filter to specified hosts if provided
      const targetHosts =
        filterHosts && filterHosts.length > 0
          ? allHosts.filter(([name]) => filterHosts.includes(name))
          : allHosts;

      // Activate on all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) =>
          activateHost(name, config, skillName, repoPath, activeDir),
        ),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { skillName, hosts: results, allSucceeded };
    }),
  );

/**
 * Format activate result as a human-readable table.
 */
export const formatActivateTable = (result: ActivateCommandResult): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS          DETAIL");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      const detail = host.alreadyInState ? "already active" : "activated";
      lines.push(
        `${host.name.padEnd(15)}${"✓ ok".padEnd(16)}${detail}`,
      );
    } else {
      lines.push(
        `${host.name.padEnd(15)}${"✗ failed".padEnd(16)}${host.error}`,
      );
    }
  }

  lines.push("─".repeat(60));
  const okCount = result.hosts.filter((h) => h.status === "ok").length;
  lines.push(
    `${okCount}/${result.hosts.length} hosts activated successfully`,
  );

  return lines.join("\n");
};

/**
 * Format activate result as JSON.
 */
export const formatActivateJson = (result: ActivateCommandResult): string =>
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
