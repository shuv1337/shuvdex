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
  /**
   * Path to the active skills directory on remote hosts (where symlinks live).
   * Defaults to "~/.codex/skills" if not provided.
   */
  readonly activeDir?: string;
}

/** Default active skills directory on remote hosts. */
const DEFAULT_ACTIVE_DIR = "~/.codex/skills";

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
 *
 * `online`   – host reachable AND all repo-state lookups succeeded.
 * `degraded` – host reachable but one or more repo-state lookups failed.
 * `error`    – host unreachable (connectivity check failed).
 */
interface HostStatusRecord {
  name: string;
  hostname: string;
  status: "online" | "degraded" | "error";
  head?: string;
  branch?: string;
  dirty?: boolean;
  error?: string;
  errors?: string[];
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

    // 2. Git state (each may fail independently – capture error details)
    const errors: string[] = [];

    const head = yield* gitOps.getHead(config, repoPath).pipe(
      Effect.map((sha) => sha.trim()),
      Effect.catchAll((e) => {
        errors.push(`getHead: ${e instanceof Error ? e.message : String(e)}`);
        return Effect.succeed(undefined as string | undefined);
      }),
    );

    const branch = yield* gitOps.getBranch(config, repoPath).pipe(
      Effect.map((b) => b.trim()),
      Effect.catchAll((e) => {
        errors.push(`getBranch: ${e instanceof Error ? e.message : String(e)}`);
        return Effect.succeed(undefined as string | undefined);
      }),
    );

    const dirty = yield* gitOps.isDirty(config, repoPath).pipe(
      Effect.catchAll((e) => {
        errors.push(`isDirty: ${e instanceof Error ? e.message : String(e)}`);
        return Effect.succeed(undefined as boolean | undefined);
      }),
    );

    const status = errors.length > 0 ? ("degraded" as const) : ("online" as const);

    return {
      name,
      hostname: config.hostname,
      status,
      ...(head !== undefined ? { head } : {}),
      ...(branch !== undefined ? { branch } : {}),
      ...(dirty !== undefined ? { dirty } : {}),
      ...(errors.length > 0 ? { errors, error: errors.join("; ") } : {}),
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
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime, activeDir: cfgActiveDir } = config;
      const hosts = resolveHosts(registry, args.hosts);
      const activeDir = cfgActiveDir ?? DEFAULT_ACTIVE_DIR;

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", results: [] });
      }

      const program = Effect.gen(function* () {
        const skillOps = yield* SkillOps;

        interface HostActivateResult {
          name: string;
          hostname: string;
          status: "ok" | "fail";
          alreadyInState?: boolean;
          skillStatus?: string;
          symlinkPath?: string;
          targetPath?: string;
          error?: string;
        }

        const results: HostActivateResult[] = [];

        for (const [name, hostConfig] of hosts) {
          const activationResult = yield* skillOps
            .activateSkill(hostConfig, args.skill, repoPath, activeDir)
            .pipe(
              Effect.map((r) => ({
                ok: true as const,
                alreadyInState: r.alreadyInState,
                skillStatus: r.status,
              })),
              Effect.catchAll((activateErr) =>
                Effect.succeed({
                  ok: false as const,
                  error:
                    activateErr instanceof Error
                      ? activateErr.message
                      : String(activateErr),
                }),
              ),
            );

          if (!activationResult.ok) {
            results.push({
              name,
              hostname: hostConfig.hostname,
              status: "fail",
              error: activationResult.error,
            });
            continue;
          }

          results.push({
            name,
            hostname: hostConfig.hostname,
            status: "ok",
            alreadyInState: activationResult.alreadyInState,
            skillStatus: activationResult.skillStatus,
            symlinkPath: `${activeDir}/${args.skill}`,
            targetPath: `${repoPath}/${args.skill}`,
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

  // --- fleet_deactivate ---
  server.tool(
    "fleet_deactivate",
    "Deactivate a skill on remote hosts by removing its activation symlink.",
    {
      skill: z.string().describe("Name of the skill to deactivate"),
      ...hostsFilter,
    },
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime, activeDir: cfgActiveDir } = config;
      const hosts = resolveHosts(registry, args.hosts);
      const activeDir = cfgActiveDir ?? DEFAULT_ACTIVE_DIR;

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", results: [] });
      }

      const program = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        const gitOps = yield* GitOps;

        interface HostDeactivateResult {
          name: string;
          hostname: string;
          status: "ok" | "fail";
          alreadyInState?: boolean;
          skillStatus?: string;
          repoIntact?: boolean;
          head?: string;
          error?: string;
        }

        const results: HostDeactivateResult[] = [];

        for (const [name, hostConfig] of hosts) {
          const deactivationResult = yield* skillOps
            .deactivateSkill(hostConfig, args.skill, activeDir)
            .pipe(
              Effect.map((r) => ({
                ok: true as const,
                alreadyInState: r.alreadyInState,
                skillStatus: r.status,
              })),
              Effect.catchAll((deactivateErr) =>
                Effect.succeed({
                  ok: false as const,
                  error:
                    deactivateErr instanceof Error
                      ? deactivateErr.message
                      : String(deactivateErr),
                }),
              ),
            );

          if (!deactivationResult.ok) {
            results.push({
              name,
              hostname: hostConfig.hostname,
              status: "fail",
              error: deactivationResult.error,
            });
            continue;
          }

          // Verify repo is intact by checking HEAD is still accessible
          const headResult = yield* gitOps
            .getHead(hostConfig, repoPath)
            .pipe(
              Effect.map((sha) => ({ intact: true, head: sha.trim() })),
              Effect.catchAll(() =>
                Effect.succeed({ intact: false, head: undefined as string | undefined }),
              ),
            );

          results.push({
            name,
            hostname: hostConfig.hostname,
            status: "ok",
            alreadyInState: deactivationResult.alreadyInState,
            skillStatus: deactivationResult.skillStatus,
            repoIntact: headResult.intact,
            ...(headResult.head !== undefined ? { head: headResult.head } : {}),
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

  // --- fleet_pull ---
  server.tool(
    "fleet_pull",
    "Pull latest changes from the remote origin on each host's skills repository.",
    hostsFilter,
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime } = config;
      const hosts = resolveHosts(registry, args.hosts);

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", results: [] });
      }

      const program = Effect.gen(function* () {
        const gitOps = yield* GitOps;

        interface HostPullResult {
          name: string;
          hostname: string;
          status: "ok" | "fail";
          updated?: boolean;
          summary?: string;
          head?: string;
          error?: string;
        }

        const results: HostPullResult[] = [];

        for (const [name, hostConfig] of hosts) {
          const pullResult = yield* gitOps
            .pull(hostConfig, repoPath)
            .pipe(
              Effect.map((r) => ({
                ok: true as const,
                updated: r.updated,
                summary: r.summary,
              })),
              Effect.catchAll((pullErr) =>
                Effect.succeed({
                  ok: false as const,
                  error:
                    pullErr instanceof Error
                      ? pullErr.message
                      : String(pullErr),
                }),
              ),
            );

          if (!pullResult.ok) {
            results.push({
              name,
              hostname: hostConfig.hostname,
              status: "fail",
              error: pullResult.error,
            });
            continue;
          }

          // Get HEAD commit after pull
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
            updated: pullResult.updated,
            summary: pullResult.summary,
            ...(head !== undefined ? { head } : {}),
          });
        }

        return results;
      });

      try {
        const results = await Runtime.runPromise(runtime)(program);
        const allFailed = results.every((r) => r.status === "fail");
        const payload = { results };

        return allFailed ? err(payload) : ok(payload);
      } catch (e) {
        return err({
          error: e instanceof Error ? e.message : String(e),
          results: [],
        });
      }
    },
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
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime } = config;
      const hosts = resolveHosts(registry, args.hosts);

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found" });
      }

      // Determine reference host: use provided name or default to first host
      const referenceHostName = args.referenceHost ?? hosts[0][0];

      const program = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        return yield* skillOps.checkDrift(hosts, repoPath, referenceHostName);
      });

      try {
        const report = await Runtime.runPromise(runtime)(program);
        return ok(report);
      } catch (e) {
        return err({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
  );

  // --- fleet_rollback ---
  server.tool(
    "fleet_rollback",
    "Rollback hosts to a specific git ref (branch, tag, or SHA).",
    {
      ref: z.string().describe("Git ref to checkout (branch, tag, or SHA)"),
      ...hostsFilter,
    },
    async (args) => {
      if (!config) {
        return err({ error: "Not implemented" });
      }

      const { registry, repoPath, runtime } = config;
      const hosts = resolveHosts(registry, args.hosts);

      if (hosts.length === 0) {
        return err({ error: "No matching hosts found", ref: args.ref, results: [] });
      }

      const program = Effect.gen(function* () {
        const gitOps = yield* GitOps;

        interface HostRollbackResult {
          name: string;
          hostname: string;
          status: "ok" | "fail";
          head?: string;
          error?: string;
        }

        const results: HostRollbackResult[] = [];

        for (const [name, hostConfig] of hosts) {
          // Checkout the specified ref
          const checkoutResult = yield* gitOps
            .checkoutRef(hostConfig, repoPath, args.ref)
            .pipe(
              Effect.map(() => ({ ok: true as const })),
              Effect.catchAll((checkoutErr) =>
                Effect.succeed({
                  ok: false as const,
                  error:
                    checkoutErr instanceof Error
                      ? checkoutErr.message
                      : String(checkoutErr),
                }),
              ),
            );

          if (!checkoutResult.ok) {
            results.push({
              name,
              hostname: hostConfig.hostname,
              status: "fail",
              error: checkoutResult.error,
            });
            continue;
          }

          // Get HEAD commit after checkout for verification
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
            ...(head !== undefined ? { head } : {}),
          });
        }

        return results;
      });

      try {
        const results = await Runtime.runPromise(runtime)(program);
        const allFailed = results.every((r) => r.status === "fail");
        const payload = { ref: args.ref, results };

        return allFailed ? err(payload) : ok(payload);
      } catch (e) {
        return err({
          error: e instanceof Error ? e.message : String(e),
          ref: args.ref,
          results: [],
        });
      }
    },
  );

  return server;
}
