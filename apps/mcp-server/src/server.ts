/**
 * MCP Server factory.
 *
 * Creates an McpServer instance with all 7 fleet tools registered.
 * When a `ServerConfig` is supplied (with host registry, repo path, and
 * an Effect runtime) the fleet_status and fleet_sync tools execute real
 * service logic.  Without a config the tools return "Not implemented" stubs
 * so that protocol-level tests continue to work unchanged.
 */
import { Effect, Runtime } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { HostConfig, HostRegistry } from "@codex-fleet/core";
import { SshExecutor } from "@codex-fleet/ssh";
import type { SshError } from "@codex-fleet/ssh";
import { GitOps } from "@codex-fleet/git-ops";
import { SkillOps } from "@codex-fleet/skill-ops";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The set of Effect services required by tool handlers.
 */
export type ServerServices = SshExecutor | GitOps | SkillOps;

/**
 * Configuration needed by tool handlers that interact with fleet services.
 */
export interface ServerConfig {
  /** Host registry for resolving host names to configs. */
  readonly registry: HostRegistry;
  /** Absolute path to the skills repository on remote hosts. */
  readonly repoPath: string;
  /**
   * Effect runtime that provides SshExecutor, GitOps, SkillOps, etc.
   * Used to bridge MCP's async callbacks to Effect-based service calls.
   */
  readonly runtime: Runtime.Runtime<ServerServices>;
  /**
   * Local path to the skills repository (for sync operations).
   * Defaults to process.cwd() if not provided.
   */
  readonly localRepoPath?: string;
}

/**
 * Optional hosts filter schema, shared across several tools.
 */
const hostsFilter = {
  hosts: z
    .array(z.string())
    .optional()
    .describe("Subset of host names to target (defaults to all)"),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the target hosts from the registry, optionally filtered by name.
 */
function resolveHosts(
  registry: HostRegistry,
  filter?: string[],
): ReadonlyArray<readonly [string, HostConfig]> {
  const all = registry.getAllHosts();
  if (!filter || filter.length === 0) return all;
  return all.filter(([name]) => filter.includes(name));
}

/**
 * MCP CallToolResult helper – success.
 */
function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * MCP CallToolResult helper – error.
 */
function err(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * Per-host status record returned by fleet_status.
 */
interface HostStatusRecord {
  name: string;
  hostname: string;
  status: "online" | "error";
  head?: string;
  branch?: string;
  dirty?: boolean;
  error?: string;
}

/**
 * Check a single host's connectivity and git state.
 * Errors are caught so the result is always a HostStatusRecord.
 */
const checkHostStatus = (
  name: string,
  config: HostConfig,
  repoPath: string,
): Effect.Effect<HostStatusRecord, never, SshExecutor | GitOps> =>
  Effect.gen(function* () {
    const ssh = yield* SshExecutor;
    const gitOps = yield* GitOps;

    // 1. Connectivity check
    const connResult = yield* ssh
      .executeCommand(config, "echo ok", { timeoutMs: config.timeout * 1000 })
      .pipe(
        Effect.map(() => true),
        Effect.catchAll((_err: SshError) => Effect.succeed(false)),
      );

    if (!connResult) {
      return {
        name,
        hostname: config.hostname,
        status: "error" as const,
        error: "Host unreachable",
      };
    }

    // 2. Git state (each may fail independently)
    const head = yield* gitOps.getHead(config, repoPath).pipe(
      Effect.map((sha) => sha.trim()),
      Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
    );

    const branch = yield* gitOps.getBranch(config, repoPath).pipe(
      Effect.map((b) => b.trim()),
      Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
    );

    const dirty = yield* gitOps.isDirty(config, repoPath).pipe(
      Effect.catchAll(() => Effect.succeed(undefined as boolean | undefined)),
    );

    return {
      name,
      hostname: config.hostname,
      status: "online" as const,
      ...(head !== undefined ? { head } : {}),
      ...(branch !== undefined ? { branch } : {}),
      ...(dirty !== undefined ? { dirty } : {}),
    };
  });

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a configured McpServer with all 7 fleet tools.
 *
 * @param config Optional configuration. When supplied, fleet_status and
 *               fleet_sync tools use real service implementations.
 */
export function createServer(config?: ServerConfig): McpServer {
  const server = new McpServer(
    { name: "codex-fleet", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  // --- fleet_status ---
  server.tool(
    "fleet_status",
    "Get fleet status: connectivity, HEAD commit, branch, and dirty state for each host.",
    hostsFilter,
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime } = config;
      const hosts = resolveHosts(registry, args.hosts);

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", hosts: [] });
      }

      const program = Effect.gen(function* () {
        const results: HostStatusRecord[] = [];
        for (const [name, hostConfig] of hosts) {
          const status = yield* checkHostStatus(name, hostConfig, repoPath);
          results.push(status);
        }
        return results;
      });

      try {
        const results = await Runtime.runPromise(runtime)(program);
        const allError = results.every((r) => r.status === "error");
        const payload = { hosts: results };

        return allError ? err(payload) : ok(payload);
      } catch (e) {
        return err({
          error: e instanceof Error ? e.message : String(e),
          hosts: [],
        });
      }
    },
  );

  // --- fleet_sync ---
  server.tool(
    "fleet_sync",
    "Sync a skill from local repository to remote hosts.",
    {
      skill: z.string().describe("Name of the skill directory to sync"),
      ...hostsFilter,
    },
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime, localRepoPath } = config;
      const hosts = resolveHosts(registry, args.hosts);
      const localRepo = localRepoPath ?? process.cwd();

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", results: [] });
      }

      const program = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        const gitOps = yield* GitOps;

        interface HostSyncResult {
          name: string;
          hostname: string;
          status: "ok" | "fail";
          filesTransferred?: number;
          head?: string;
          error?: string;
        }

        const results: HostSyncResult[] = [];

        for (const [name, hostConfig] of hosts) {
          // Sync skill to this host
          const syncResult = yield* skillOps
            .syncSkill(hostConfig, args.skill, localRepo, repoPath)
            .pipe(
              Effect.map((r) => ({
                ok: true as const,
                filesTransferred: r.filesTransferred,
              })),
              Effect.catchAll((syncErr) =>
                Effect.succeed({
                  ok: false as const,
                  error:
                    syncErr instanceof Error
                      ? syncErr.message
                      : String(syncErr),
                }),
              ),
            );

          if (!syncResult.ok) {
            results.push({
              name,
              hostname: hostConfig.hostname,
              status: "fail",
              error: syncResult.error,
            });
            continue;
          }

          // Get HEAD commit after sync for verification
          const head = yield* gitOps
            .getHead(hostConfig, repoPath)
            .pipe(
              Effect.map((sha) => sha.trim()),
              Effect.catchAll(() =>
                Effect.succeed(undefined as string | undefined),
              ),
            );

          results.push({
            name,
            hostname: hostConfig.hostname,
            status: "ok",
            filesTransferred: syncResult.filesTransferred,
            ...(head !== undefined ? { head } : {}),
          });
        }

        return results;
      });

      try {
        const results = await Runtime.runPromise(runtime)(program);
        const allFailed = results.every((r) => r.status === "fail");
        const payload = { skill: args.skill, results };

        return allFailed ? err(payload) : ok(payload);
      } catch (e) {
        return err({
          error: e instanceof Error ? e.message : String(e),
          skill: args.skill,
          results: [],
        });
      }
    },
  );

  // --- fleet_activate ---
  server.tool(
    "fleet_activate",
    "Activate a skill on remote hosts by creating a symlink in the active skills directory.",
    {
      skill: z.string().describe("Name of the skill to activate"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_deactivate ---
  server.tool(
    "fleet_deactivate",
    "Deactivate a skill on remote hosts by removing its activation symlink.",
    {
      skill: z.string().describe("Name of the skill to deactivate"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_pull ---
  server.tool(
    "fleet_pull",
    "Pull latest changes from the remote origin on each host's skills repository.",
    hostsFilter,
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_drift ---
  server.tool(
    "fleet_drift",
    "Detect commit drift across fleet hosts by comparing HEAD commits to a reference.",
    {
      referenceHost: z
        .string()
        .optional()
        .describe(
          "Host to use as the reference (defaults to first configured host)",
        ),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_rollback ---
  server.tool(
    "fleet_rollback",
    "Rollback hosts to a specific git ref (branch, tag, or SHA).",
    {
      ref: z.string().describe("Git ref to checkout (branch, tag, or SHA)"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  return server;
}
