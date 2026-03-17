/**
 * Fleet operation routes — /api/fleet
 *
 * HTTP equivalents of the MCP server fleet_* tools. Each route loads the
 * current host registry from fleet.yaml, builds an Effect program using the
 * same SSH/GitOps/SkillOps services, runs it against the shared runtime,
 * and returns a JSON response.
 *
 * Error semantics mirror the MCP server: per-host failures are captured in
 * `results[].status === "fail"` rather than rejecting the whole response,
 * unless the config itself is unavailable (503) or no hosts match (404).
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { loadConfig } from "@codex-fleet/core";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutor } from "@codex-fleet/ssh";
import type { SshError } from "@codex-fleet/ssh";
import { GitOps } from "@codex-fleet/git-ops";
import { SkillOps } from "@codex-fleet/skill-ops";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Types used across handlers
// ---------------------------------------------------------------------------

type FleetServices = SshExecutor | GitOps | SkillOps;

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

interface HostOpResult {
  name: string;
  hostname: string;
  status: "ok" | "fail";
  error?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// SSH error formatter (same as mcp-server/server.ts)
// ---------------------------------------------------------------------------

function formatSshError(error: SshError): string {
  switch (error._tag) {
    case "ConnectionTimeout":
      return `Connection timed out after ${error.timeoutMs}ms`;
    case "ConnectionFailed": {
      const cause =
        typeof error.cause === "string"
          ? error.cause
          : error.cause instanceof Error
            ? error.cause.message
            : String(error.cause);
      return `Connection failed: ${cause}`;
    }
    case "CommandFailed": {
      const detail = error.stderr || `exit code ${error.exitCode}`;
      return `Command failed (exit ${error.exitCode}): ${detail}`;
    }
    case "CommandTimeout":
      return `Command timed out after ${error.timeoutMs}ms: ${error.command}`;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Re-read fleet.yaml and return all hosts, optionally filtered by name list.
 * Throws (bubbles up) if the file is not present / invalid.
 */
async function loadHosts(
  configPath: string,
  filter?: string[],
): Promise<ReadonlyArray<readonly [string, HostConfig]>> {
  const registry = await Effect.runPromise(loadConfig(configPath));
  const all = registry.getAllHosts();
  if (!filter || filter.length === 0) return all;
  return all.filter(([name]) => filter.includes(name));
}

/**
 * Check a single host's connectivity and git repository state.
 * Always returns a HostStatusRecord — errors are captured, not thrown.
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
        Effect.map(() => ({ ok: true as const })),
        Effect.catchAll((sshErr: SshError) =>
          Effect.succeed({
            ok: false as const,
            detail: formatSshError(sshErr),
          }),
        ),
      );

    if (!connResult.ok) {
      return {
        name,
        hostname: config.hostname,
        status: "error" as const,
        error: connResult.detail,
      };
    }

    // 2. Git state — each lookup may fail independently
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
// Route factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with all fleet operation routes.
 *
 * @param runtime         Effect runtime providing SshExecutor, GitOps, SkillOps.
 * @param configPath      Absolute path to fleet.yaml.
 * @param localRepoPath   Local path to the skills repository (used for sync).
 * @param remoteRepoPath  Remote path to the skills repository on each host.
 * @param activeDir       Remote path to the active skills symlink directory.
 */
export function fleetRouter(
  runtime: Runtime.Runtime<FleetServices>,
  configPath: string,
  localRepoPath: string,
  remoteRepoPath: string,
  activeDir = "~/.codex/skills",
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Utility: parse optional hosts list from request body
  // -------------------------------------------------------------------------
  function parseHostsFilter(body: unknown): string[] | undefined {
    if (
      body !== null &&
      typeof body === "object" &&
      "hosts" in body &&
      Array.isArray((body as Record<string, unknown>)["hosts"])
    ) {
      return (body as { hosts: string[] }).hosts;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // GET /api/fleet/status[?hosts=a,b]
  // -------------------------------------------------------------------------
  app.get("/status", async (c) => {
    const hostsParam = c.req.query("hosts");
    const hostsFilter = hostsParam
      ? hostsParam.split(",").filter(Boolean)
      : undefined;

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, hostsFilter);
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }

    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", hosts: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const records: HostStatusRecord[] = [];
          for (const [name, hostConfig] of hosts) {
            const status = yield* checkHostStatus(name, hostConfig, remoteRepoPath);
            records.push(status);
          }
          return records;
        }),
      );
      return c.json({ hosts: results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/pull
  // Body: { hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/pull", async (c) => {
    let body: unknown = {};
    try { body = await c.req.json(); } catch { /* no body is OK */ }

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", results: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const gitOps = yield* GitOps;
          const records: HostOpResult[] = [];

          for (const [name, hostConfig] of hosts) {
            const pullResult = yield* gitOps
              .pull(hostConfig, remoteRepoPath)
              .pipe(
                Effect.map((r) => ({ ok: true as const, updated: r.updated, summary: r.summary })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
              );

            if (!pullResult.ok) {
              records.push({ name, hostname: hostConfig.hostname, status: "fail", error: pullResult.error });
              continue;
            }

            const headResult = yield* gitOps
              .getHead(hostConfig, remoteRepoPath)
              .pipe(
                Effect.map((sha) => ({ ok: true as const, head: sha.trim() })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: `HEAD verification failed: ${e instanceof Error ? e.message : String(e)}`,
                  }),
                ),
              );

            records.push({
              name,
              hostname: hostConfig.hostname,
              status: headResult.ok ? "ok" : "fail",
              updated: pullResult.updated,
              summary: pullResult.summary,
              ...(headResult.ok ? { head: headResult.head } : { error: headResult.error }),
            });
          }

          return records;
        }),
      );
      return c.json({ results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/sync
  // Body: { skill: string; hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/sync", async (c) => {
    let body: { skill?: unknown; hosts?: unknown } = {};
    try { body = (await c.req.json()) as typeof body; } catch { /* body required below */ }

    if (!body.skill || typeof body.skill !== "string" || body.skill.trim() === "") {
      return c.json({ error: "Field 'skill' is required" }, 400);
    }
    const skill = body.skill.trim();

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", results: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const skillOps = yield* SkillOps;
          const records: HostOpResult[] = [];

          for (const [name, hostConfig] of hosts) {
            const syncResult = yield* skillOps
              .syncSkill(hostConfig, skill, localRepoPath, remoteRepoPath)
              .pipe(
                Effect.map((r) => ({ ok: true as const, filesTransferred: r.filesTransferred })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
              );

            records.push({
              name,
              hostname: hostConfig.hostname,
              status: syncResult.ok ? "ok" : "fail",
              ...(syncResult.ok
                ? { filesTransferred: syncResult.filesTransferred }
                : { error: syncResult.error }),
            });
          }

          return records;
        }),
      );
      return c.json({ skill, source: { localRepoPath, skill }, results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/activate
  // Body: { skill: string; hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/activate", async (c) => {
    let body: { skill?: unknown; hosts?: unknown } = {};
    try { body = (await c.req.json()) as typeof body; } catch { /* fall through */ }

    if (!body.skill || typeof body.skill !== "string" || body.skill.trim() === "") {
      return c.json({ error: "Field 'skill' is required" }, 400);
    }
    const skill = body.skill.trim();

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", results: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const skillOps = yield* SkillOps;
          const records: HostOpResult[] = [];

          for (const [name, hostConfig] of hosts) {
            const result = yield* skillOps
              .activateSkill(hostConfig, skill, remoteRepoPath, activeDir)
              .pipe(
                Effect.map((r) => ({
                  ok: true as const,
                  alreadyInState: r.alreadyInState,
                  skillStatus: r.status,
                })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
              );

            records.push({
              name,
              hostname: hostConfig.hostname,
              status: result.ok ? "ok" : "fail",
              ...(result.ok
                ? {
                    alreadyInState: result.alreadyInState,
                    skillStatus: result.skillStatus,
                    symlinkPath: `${activeDir}/${skill}`,
                    targetPath: `${remoteRepoPath}/${skill}`,
                  }
                : { error: result.error }),
            });
          }

          return records;
        }),
      );
      return c.json({ skill, results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/deactivate
  // Body: { skill: string; hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/deactivate", async (c) => {
    let body: { skill?: unknown; hosts?: unknown } = {};
    try { body = (await c.req.json()) as typeof body; } catch { /* fall through */ }

    if (!body.skill || typeof body.skill !== "string" || body.skill.trim() === "") {
      return c.json({ error: "Field 'skill' is required" }, 400);
    }
    const skill = body.skill.trim();

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", results: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const skillOps = yield* SkillOps;
          const gitOps = yield* GitOps;
          const records: HostOpResult[] = [];

          for (const [name, hostConfig] of hosts) {
            const result = yield* skillOps
              .deactivateSkill(hostConfig, skill, activeDir)
              .pipe(
                Effect.map((r) => ({
                  ok: true as const,
                  alreadyInState: r.alreadyInState,
                  skillStatus: r.status,
                })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
              );

            if (!result.ok) {
              records.push({ name, hostname: hostConfig.hostname, status: "fail", error: result.error });
              continue;
            }

            // Verify repo is intact post-deactivation
            const headResult = yield* gitOps
              .getHead(hostConfig, remoteRepoPath)
              .pipe(
                Effect.map((sha) => ({ ok: true as const, head: sha.trim() })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: `HEAD verification failed: ${e instanceof Error ? e.message : String(e)}`,
                  }),
                ),
              );

            records.push({
              name,
              hostname: hostConfig.hostname,
              status: headResult.ok ? "ok" : "fail",
              alreadyInState: result.alreadyInState,
              skillStatus: result.skillStatus,
              repoIntact: headResult.ok,
              ...(headResult.ok ? { head: headResult.head } : { error: headResult.error }),
            });
          }

          return records;
        }),
      );
      return c.json({ skill, results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/drift
  // Body: { referenceHost?: string; hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/drift", async (c) => {
    let body: { referenceHost?: unknown; hosts?: unknown } = {};
    try { body = (await c.req.json()) as typeof body; } catch { /* all fields optional */ }

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found" }, 404);
    }

    const referenceHostName =
      typeof body.referenceHost === "string" ? body.referenceHost : hosts[0][0];

    try {
      const report = await run(
        Effect.gen(function* () {
          const skillOps = yield* SkillOps;
          return yield* skillOps.checkDrift(hosts, remoteRepoPath, referenceHostName);
        }),
      );
      return c.json(report);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/fleet/rollback
  // Body: { ref: string; hosts?: string[] }
  // -------------------------------------------------------------------------
  app.post("/rollback", async (c) => {
    let body: { ref?: unknown; hosts?: unknown } = {};
    try { body = (await c.req.json()) as typeof body; } catch { /* fall through */ }

    if (!body.ref || typeof body.ref !== "string" || body.ref.trim() === "") {
      return c.json({ error: "Field 'ref' is required (branch, tag, or SHA)" }, 400);
    }
    const ref = body.ref.trim();

    let hosts: ReadonlyArray<readonly [string, HostConfig]>;
    try {
      hosts = await loadHosts(configPath, parseHostsFilter(body));
    } catch (e) {
      return c.json({ error: "Fleet configuration not available", details: String(e) }, 503);
    }
    if (hosts.length === 0) {
      return c.json({ error: "No matching hosts found", ref, results: [] }, 404);
    }

    try {
      const results = await run(
        Effect.gen(function* () {
          const gitOps = yield* GitOps;
          const records: HostOpResult[] = [];

          for (const [name, hostConfig] of hosts) {
            const checkoutResult = yield* gitOps
              .checkoutRef(hostConfig, remoteRepoPath, ref)
              .pipe(
                Effect.map(() => ({ ok: true as const })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: e instanceof Error ? e.message : String(e),
                  }),
                ),
              );

            if (!checkoutResult.ok) {
              records.push({ name, hostname: hostConfig.hostname, status: "fail", error: checkoutResult.error });
              continue;
            }

            const headResult = yield* gitOps
              .getHead(hostConfig, remoteRepoPath)
              .pipe(
                Effect.map((sha) => ({ ok: true as const, head: sha.trim() })),
                Effect.catchAll((e) =>
                  Effect.succeed({
                    ok: false as const,
                    error: `HEAD verification failed: ${e instanceof Error ? e.message : String(e)}`,
                  }),
                ),
              );

            records.push({
              name,
              hostname: hostConfig.hostname,
              status: headResult.ok ? "ok" : "fail",
              ...(headResult.ok ? { head: headResult.head } : { error: headResult.error }),
            });
          }

          return records;
        }),
      );
      return c.json({ ref, results });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
