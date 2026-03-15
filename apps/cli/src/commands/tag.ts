/**
 * Fleet tag command implementation.
 *
 * Creates a git tag at HEAD on specified hosts (or all). Uses git-ops
 * createTag() for each host and aggregates results. Duplicate tags
 * produce clear error messages per host.
 *
 * Exit codes:
 * - 0: All hosts tagged successfully
 * - 1: All hosts failed
 * - 2: Partial success (some hosts succeeded, some failed)
 */
import { Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { HostRegistry } from "@codex-fleet/core";
import { GitOps } from "@codex-fleet/git-ops";
import { withSpan } from "@codex-fleet/telemetry";

/**
 * Result of a tag operation on a single host.
 */
export type HostTagResult =
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "ok";
      readonly tagName: string;
    }
  | {
      readonly name: string;
      readonly hostname: string;
      readonly status: "fail";
      readonly error: string;
    };

/**
 * Aggregated result of the tag command across all hosts.
 */
export interface TagCommandResult {
  readonly tagName: string;
  readonly hosts: ReadonlyArray<HostTagResult>;
  readonly allSucceeded: boolean;
}

/**
 * Tag on a single host, catching all errors so the operation never fails.
 */
const tagHost = (
  name: string,
  config: HostConfig,
  tagName: string,
  repoPath: string,
): Effect.Effect<HostTagResult, never, GitOps> =>
  Effect.gen(function* () {
    const gitOps = yield* GitOps;
    const result = yield* gitOps
      .createTag(config, repoPath, tagName)
      .pipe(
        Effect.map(
          (): HostTagResult => ({
            name,
            hostname: config.hostname,
            status: "ok",
            tagName,
          }),
        ),
        Effect.catchAll(
          (err: { readonly message: string }) =>
            Effect.succeed<HostTagResult>({
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
 * Run the tag command: create tag on specified hosts (or all)
 * and return results.
 *
 * @param registry - The host registry
 * @param tagName - The tag name to create
 * @param repoPath - Path to the git repository on remote hosts
 * @param filterHosts - Optional list of host names to tag on (default: all)
 */
export const runTag = (
  registry: HostRegistry,
  tagName: string,
  repoPath: string,
  filterHosts?: ReadonlyArray<string>,
): Effect.Effect<TagCommandResult, never, GitOps> =>
  withSpan("cli.tag")(
    Effect.gen(function* () {
      const allHosts = registry.getAllHosts();

      // Filter to specified hosts if provided
      const targetHosts =
        filterHosts && filterHosts.length > 0
          ? allHosts.filter(([name]) => filterHosts.includes(name))
          : allHosts;

      // Tag on all hosts concurrently
      const results = yield* Effect.all(
        targetHosts.map(([name, config]) =>
          tagHost(name, config, tagName, repoPath),
        ),
        { concurrency: "unbounded" },
      );

      const allSucceeded = results.every((r) => r.status === "ok");

      return { tagName, hosts: results, allSucceeded };
    }),
  );

/**
 * Format tag result as a human-readable table.
 */
export const formatTagTable = (result: TagCommandResult): string => {
  const lines: Array<string> = [];

  // Header
  lines.push("HOST           STATUS          DETAIL");
  lines.push("─".repeat(60));

  for (const host of result.hosts) {
    if (host.status === "ok") {
      lines.push(
        `${host.name.padEnd(15)}${"[OK]  ok".padEnd(20)}tag '${host.tagName}' created`,
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
 * Format tag result as JSON.
 */
export const formatTagJson = (result: TagCommandResult): string =>
  JSON.stringify(
    {
      tagName: result.tagName,
      hosts: result.hosts.map((h) =>
        h.status === "ok"
          ? {
              name: h.name,
              hostname: h.hostname,
              status: h.status,
              tagName: h.tagName,
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
