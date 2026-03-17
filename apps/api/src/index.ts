/**
 * @codex-fleet/api
 *
 * HTTP API server (Hono + @hono/node-server) that exposes fleet operations
 * and tool management as REST endpoints for the web UI.
 *
 * Startup sequence
 * ────────────────
 * 1. Build the Effect live layer (SSH, GitOps, SkillOps, Telemetry, ToolRegistry)
 * 2. Eagerly initialise the managed runtime so the tools directory is seeded
 * 3. Load fleet.yaml (non-fatal — fleet endpoints return 503 if absent)
 * 4. Register Hono routes with CORS for the Vite dev server
 * 5. Start @hono/node-server on PORT (default 3847)
 *
 * All log output goes to stderr so it does not interfere with any piped
 * stdout consumers (cf. MCP server stdio transport).
 *
 * Environment variables
 * ─────────────────────
 * PORT              HTTP port (default: 3847)
 * TOOLS_DIR         Directory for tool JSON files (default: .tools in cwd)
 * LOCAL_REPO_PATH   Local skills repository root (default: cwd)
 * REMOTE_REPO_PATH  Remote skills repository path on hosts
 *                   (default: ~/repos/shuvbot-skills)
 * ACTIVE_DIR        Active-skills symlink directory on remote hosts
 *                   (default: ~/.codex/skills)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { Effect, Layer, ManagedRuntime } from "effect";
import { loadConfig } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { makeToolRegistryLive } from "@codex-fleet/tool-registry";
import { toolsRouter } from "./routes/tools.js";
import { hostsRouter } from "./routes/hosts.js";
import { fleetRouter } from "./routes/fleet.js";
import { skillsRouter } from "./routes/skills.js";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 3847);
const DEFAULT_REMOTE_REPO_PATH = "~/repos/shuvbot-skills";
const DEFAULT_ACTIVE_DIR = "~/.codex/skills";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Resolve paths from environment or safe defaults
  const toolsDir = process.env["TOOLS_DIR"]
    ? path.resolve(process.env["TOOLS_DIR"])
    : path.resolve(process.cwd(), ".tools");

  const localRepoPath = process.env["LOCAL_REPO_PATH"]
    ? path.resolve(process.env["LOCAL_REPO_PATH"])
    : process.cwd();

  const remoteRepoPath =
    process.env["REMOTE_REPO_PATH"] ?? DEFAULT_REMOTE_REPO_PATH;

  const activeDir = process.env["ACTIVE_DIR"] ?? DEFAULT_ACTIVE_DIR;
  const configPath = path.resolve(process.cwd(), "fleet.yaml");

  // -------------------------------------------------------------------------
  // Build the Effect live layer
  // -------------------------------------------------------------------------
  const toolRegistryLayer = makeToolRegistryLive(toolsDir);

  const liveLayer = Layer.mergeAll(
    SshExecutorLive,
    TelemetryLive,
    toolRegistryLayer,
  ).pipe(
    (base) => Layer.provideMerge(GitOpsLive, base),
    (base) => Layer.provideMerge(SkillOpsLive, base),
  );

  const managedRuntime = ManagedRuntime.make(liveLayer);

  // Eagerly build the runtime — this seeds the tools directory
  const runtime = await managedRuntime.runtime();

  // -------------------------------------------------------------------------
  // Announce host count (informational only)
  // -------------------------------------------------------------------------
  try {
    const registry = await Effect.runPromise(loadConfig(configPath));
    process.stderr.write(
      `[codex-fleet/api] loaded ${registry.size} host(s) from ${configPath}\n`,
    );
  } catch {
    process.stderr.write(
      `[codex-fleet/api] fleet.yaml not found at ${configPath} — host/fleet endpoints will return 503\n`,
    );
  }

  // -------------------------------------------------------------------------
  // Hono application
  // -------------------------------------------------------------------------
  const app = new Hono();

  // CORS — allow the Vite dev server and any explicit origins in production
  app.use(
    "*",
    cors({
      origin: (origin) => {
        // Allow the Vite dev server and same-origin requests
        if (!origin || origin === "http://localhost:5173") return origin ?? "";
        // In production the UI is served from the same origin, so reflect it
        return origin;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/tools", toolsRouter(runtime as any));
  app.route("/api/hosts", hostsRouter(configPath));
  app.route(
    "/api/fleet",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fleetRouter(runtime as any, configPath, localRepoPath, remoteRepoPath, activeDir),
  );
  app.route("/api/skills", skillsRouter(localRepoPath));

  // Health / readiness probe
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: "0.0.0",
      toolsDir,
      localRepoPath,
      remoteRepoPath,
      configPath,
    }),
  );

  // 404 fallback
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // -------------------------------------------------------------------------
  // Start server
  // -------------------------------------------------------------------------
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    process.stderr.write(
      `[codex-fleet/api] listening on http://localhost:${info.port}\n`,
    );
    process.stderr.write(`[codex-fleet/api] tools dir: ${toolsDir}\n`);
    process.stderr.write(`[codex-fleet/api] local repo: ${localRepoPath}\n`);
    process.stderr.write(`[codex-fleet/api] remote repo: ${remoteRepoPath}\n`);
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------
  const shutdown = async (): Promise<void> => {
    process.stderr.write("[codex-fleet/api] shutting down...\n");
    await managedRuntime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((err) => {
  process.stderr.write(`[codex-fleet/api] fatal: ${String(err)}\n`);
  process.exit(1);
});
