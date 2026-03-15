/**
 * Fleet sync command implementation.
 *
 * Syncs a skill from local to remote hosts via skill-ops syncSkill.
 * Validates that the skill exists locally before attempting any SSH.
 * Reports per-host sync status.
 *
 * Exit codes:
 * - 0: All hosts synced successfully
 * - 1: All hosts failed or skill missing
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { SkillOps } from "@codex-fleet/skill-ops";
import { withSpan } from "@codex-fleet/telemetry";

/**
 * Result of a sync operation on a single host.
 */
export type HostSyncResult =
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "ok";
      readonly filesTransferred: number;
    }
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "fail";
      readonly error: string;
    };

/**
 * Aggregated result of the sync command across all hosts.
 */
export interface SyncCommandResult {
  readonly skillName: string;
  readonly hosts: ReadonlyArray<HostSyncResult>;
  readonly allSucceeded: boolean;
  readonly skillError?: string;
}

/**
 * Sync skill to a single host, catching all errors so the operation never fails.
 */
const syncHost = (
  name: string,
  config: HostConfig,
  skillName: string,
  localRepoPath: string,
  remoteRepoPath: string,
): Effect.Effect<HostSyncResult, never, SkillOps> =>
  Effect.gen(function* () {
    const skillOps = yield* SkillOps;
    const result = yield* skillOps
      .syncSkill(config, skillName, localRepoPath, remoteRepoPath)
      .pipe(
        Effect.map(
          (syncResult): HostSyncResult => ({
            name,
            hostname: config.hostname,
            status: "ok",
            filesTransferred: syncResult.filesTransferred,
          }),
        ),
        Effect.catchAll(
          (err: { readonly message: string }) =>
            Effect.succeed<HostSyncResult>({
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
 * Run the sync command: sync skill to specified hosts (or all) and return results.
 *
 * Validates skill exists locally before attempting SSH to any host. If the
 * skill does not exist, returns immediately with a skillError and empty hosts.
 *
 * @param registry - The host registry
 * @param skillName - Name of the skill to sync
 * @param localRepoPath - Local path to the skills repository
 * @param remoteRepoPath - Path to the skills repository on remote hosts
 * @param filterHosts - Optional list of host names to sync to (default: all)
 */
export const runSync = (
  registry: HostRegistry,
  skillName: string,
  localRepoPath: string,
  remoteRepoPath: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<SyncCommandResult, never, SkillOps> =>
  withSpan("cli.sync")(
    Effect.gen(function* () {
      // Validate skill exists locally before any SSH
      const { access, constants } = yield* Effect.promise(
        () => import("node:fs/promises"),
      );
      const localSkillPath = `${localRepoPath}/${skillName}`;

      const exists = yield* Effect.tryPromise({
        try: () => access(localSkillPath, constants.R_OK),
        catch: () => "not-found" as const,
      }).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      );

      if (!exists) {
        return {
          skillName,
          hosts: [],
          allSucceeded: false,
          skillError: `Skill "${skillName}" not found at ${localSkillPath}`,
        };
      }

      const allHosts = registry.getAllHosts();

      // Filter to specified hosts if provided
      const targetHosts =
        filterHosts && filterHosts.length > 0
          ? allHosts.filter(([name]) => filterHosts.includes(name))
          : allHosts;

      // Sync all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) =>
          syncHost(name, config, skillName, localRepoPath, remoteRepoPath),
        ),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { skillName, hosts: results, allSucceeded };
    }),
  );

/**
 * Format sync result as a human-readable table.
 */
export const formatSyncTable = (result: SyncCommandResult): string => {
  const lines: Array<string> = [];

  // Skill error (missing skill before SSH)
  if (result.skillError) {
    lines.push(`Error: ${result.skillError}`);
    return lines.join("\n");
  }

  // Header
  lines.push("HOST           STATUS          FILES");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      lines.push(
        `${host.name.padEnd(15)}${"✓ synced".padEnd(16)}${host.filesTransferred} file(s)`,
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
    `${okCount}/${result.hosts.length} hosts synced successfully`,
  );

  return lines.join("\n");
};

/**
 * Format sync result as JSON.
 */
export const formatSyncJson = (result: SyncCommandResult): string =>
  JSON.stringify(
    {
      skillName: result.skillName,
      hosts: result.hosts.map((h) =>
        h.status === "ok"
          ? {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              filesTransferred: h.filesTransferred,
            }
          : {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              error: h.error,
            },
      ),
      allSucceeded: result.allSucceeded,
      ...(result.skillError ? { skillError: result.skillError } : {}),
    },
    null,
    2,
  );
