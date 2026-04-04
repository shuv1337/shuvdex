/**
 * @shuvdex/api
 *
 * HTTP API server (Hono + @hono/node-server) that exposes capability
 * management, policy/auth administration, source/credential management, and
 * compatibility tool endpoints for the existing web UI.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CapabilityRegistry,
  makeCapabilityRegistryLive,
} from "@shuvdex/capability-registry";
import { makePolicyEngineLive } from "@shuvdex/policy-engine";
import { makeSkillImporterLive } from "@shuvdex/skill-importer";
import { SkillIndexer, SkillIndexerLive } from "@shuvdex/skill-indexer";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeOpenApiSourceLive } from "@shuvdex/openapi-source";
import { makeTenantManagerLive } from "@shuvdex/tenant-manager";
import { auditRouter } from "./routes/audit.js";
import { toolsRouter } from "./routes/tools.js";
import { packagesRouter } from "./routes/packages.js";
import { policiesRouter } from "./routes/policies.js";
import { skillsRouter } from "./routes/skills.js";
import { tokensRouter } from "./routes/tokens.js";
import { credentialsRouter } from "./routes/credentials.js";
import { openapiSourcesRouter } from "./routes/openapi-sources.js";
import { upstreamsRouter } from "./routes/upstreams.js";
import { syncRouter } from "./routes/sync.js";
import { approvalsRouter, breakGlassRouter } from "./routes/approvals.js";
import { tenantsRouter, templatesRouter } from "./routes/tenants.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { reportingRouter } from "./routes/reporting.js";
import { requireAuth } from "./middleware/auth.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const HOST = process.env["HOST"] ?? "0.0.0.0";
const PORT = Number(process.env["PORT"] ?? 3847);

function resolveCorsAllowedOrigins(): Set<string> {
  const configured = process.env["CORS_ALLOWED_ORIGINS"]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(
    configured && configured.length > 0
      ? configured
      : [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://shuvdev:5173",
        ],
  );
}

async function main(): Promise<void> {
  const allowedOrigins = resolveCorsAllowedOrigins();
  const capabilitiesDir = process.env["CAPABILITIES_DIR"]
    ? path.resolve(process.env["CAPABILITIES_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "packages");
  const policyDir = process.env["POLICY_DIR"]
    ? path.resolve(process.env["POLICY_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "policy");
  const importsDir = process.env["IMPORTS_DIR"]
    ? path.resolve(process.env["IMPORTS_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "imports");
  const localRepoPath = process.env["LOCAL_REPO_PATH"]
    ? path.resolve(process.env["LOCAL_REPO_PATH"])
    : process.cwd();

  const upstreamsDir = process.env["UPSTREAMS_DIR"]
    ? path.resolve(process.env["UPSTREAMS_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "upstreams");
  const capabilitiesRootDir = process.env["CAPABILITIES_ROOT_DIR"]
    ? path.resolve(process.env["CAPABILITIES_ROOT_DIR"])
    : path.resolve(process.cwd(), ".capabilities");
  const credentialsDir = process.env["CREDENTIALS_DIR"]
    ? path.resolve(process.env["CREDENTIALS_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "credentials");
  const credentialKeyPath = process.env["CREDENTIAL_KEY_PATH"]
    ? path.resolve(process.env["CREDENTIAL_KEY_PATH"])
    : path.resolve(process.cwd(), ".capabilities", ".credential-key");
  const openApiRootDir = process.env["OPENAPI_ROOT"]
    ? path.resolve(process.env["OPENAPI_ROOT"])
    : path.resolve(process.cwd(), ".capabilities");
  const tenantDir = process.env["TENANT_DIR"]
    ? path.resolve(process.env["TENANT_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "tenants");

  const capabilityRegistryLayer = makeCapabilityRegistryLive(capabilitiesDir);
  const credentialStoreLayer = makeCredentialStoreLive({
    rootDir: credentialsDir,
    keyPath: credentialKeyPath,
  });
  const httpExecutorLayer = Layer.provide(makeHttpExecutorLive(), credentialStoreLayer);
  const openApiSourceLayer = Layer.provide(
    makeOpenApiSourceLive({ rootDir: openApiRootDir }),
    Layer.mergeAll(capabilityRegistryLayer, credentialStoreLayer, httpExecutorLayer),
  );
  const liveLayer = Layer.mergeAll(
    capabilityRegistryLayer,
    credentialStoreLayer,
    httpExecutorLayer,
    makePolicyEngineLive({ policyDir }),
    Layer.provide(makeSkillImporterLive({ importsDir }), capabilityRegistryLayer),
    SkillIndexerLive,
    openApiSourceLayer,
    makeTenantManagerLive({ rootDir: tenantDir }),
  );
  const managedRuntime = ManagedRuntime.make(liveLayer);
  const runtime = await managedRuntime.runtime();

  // Ensure upstream registration directory exists on startup
  const { mkdirSync } = await import("node:fs");
  mkdirSync(upstreamsDir, { recursive: true });

  await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* CapabilityRegistry;
      const indexer = yield* SkillIndexer;
      const indexed = yield* indexer.indexRepository(localRepoPath);
      for (const artifact of indexed.artifacts) {
        const existing = yield* Effect.either(registry.getPackage(artifact.package.id));
        if (existing._tag === "Right" && existing.right.source?.type === "imported_archive") {
          continue;
        }
        yield* registry.upsertPackage(artifact.package);
      }
    }).pipe(Effect.provide(liveLayer)),
  ).catch(() => undefined);

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "";
        return allowedOrigins.has(origin) ? origin : "";
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  // ---------------------------------------------------------------------------
  // Control-plane auth — applied to all /api/* routes.
  // The /health endpoint is intentionally excluded (it stays public).
  // Set DEV_MODE=true to bypass auth for local development.
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/api/*", requireAuth(runtime as any));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/tools", toolsRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/skills", skillsRouter(runtime as any, localRepoPath));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/packages", packagesRouter(runtime as any, localRepoPath, importsDir));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/policies", policiesRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/tokens", tokensRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/audit", auditRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/credentials", credentialsRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/sources/openapi", openapiSourcesRouter(runtime as any));
  app.route("/api/upstreams", upstreamsRouter(upstreamsDir));
  app.route("/api/sync", syncRouter(upstreamsDir, capabilitiesRootDir));
  app.route("/api/approvals", approvalsRouter(policyDir));
  app.route("/api/break-glass", breakGlassRouter(policyDir));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/dashboard", dashboardRouter(runtime as any, upstreamsDir));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/reports", reportingRouter(runtime as any, policyDir));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/tenants", tenantsRouter(runtime as any));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route("/api/templates", templatesRouter(runtime as any));

  // ---------------------------------------------------------------------------
  // Dashboard HTML — served at GET /dashboard
  // Resolves relative to the compiled JS location so it works in both
  // tsx dev mode (src/index.ts) and compiled production (dist/index.js).
  // ---------------------------------------------------------------------------
  const __currentFile = fileURLToPath(import.meta.url);
  const __packageRoot = path.dirname(path.dirname(__currentFile)); // apps/api/
  const dashboardHtmlPath = process.env["DASHBOARD_HTML_PATH"]
    ? path.resolve(process.env["DASHBOARD_HTML_PATH"])
    : path.resolve(__packageRoot, "public", "dashboard.html");

  app.get("/dashboard", (c) => {
    if (!fs.existsSync(dashboardHtmlPath)) {
      return c.text(
        `Dashboard not found. Expected: ${dashboardHtmlPath}`,
        404,
      );
    }
    const html = fs.readFileSync(dashboardHtmlPath, "utf-8");
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: "0.0.0",
      capabilitiesDir,
      importsDir,
      policyDir,
      credentialsDir,
      openApiRootDir,
      upstreamsDir,
      tenantDir,
      localRepoPath,
    }),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    process.stderr.write(
      `[shuvdex/api] listening on http://${HOST}:${info.port}\n`,
    );
    process.stderr.write(`[shuvdex/api] capabilities dir: ${capabilitiesDir}\n`);
    process.stderr.write(`[shuvdex/api] local repo: ${localRepoPath}\n`);
  });

  const shutdown = async (): Promise<void> => {
    process.stderr.write("[shuvdex/api] shutting down...\n");
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
  process.stderr.write(`[shuvdex/api] fatal: ${String(err)}\n`);
  process.exit(1);
});
