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
import { auditRouter } from "./routes/audit.js";
import { toolsRouter } from "./routes/tools.js";
import { packagesRouter } from "./routes/packages.js";
import { policiesRouter } from "./routes/policies.js";
import { skillsRouter } from "./routes/skills.js";
import { tokensRouter } from "./routes/tokens.js";
import { credentialsRouter } from "./routes/credentials.js";
import { openapiSourcesRouter } from "./routes/openapi-sources.js";
import * as path from "node:path";

const PORT = Number(process.env["PORT"] ?? 3847);

async function main(): Promise<void> {
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

  const capabilityRegistryLayer = makeCapabilityRegistryLive(capabilitiesDir);
  const credentialStoreLayer = makeCredentialStoreLive({
    rootDir: path.resolve(process.cwd(), ".capabilities", "credentials"),
    keyPath: path.resolve(process.cwd(), ".capabilities", ".credential-key"),
  });
  const httpExecutorLayer = Layer.provide(makeHttpExecutorLive(), credentialStoreLayer);
  const openApiSourceLayer = Layer.provide(
    makeOpenApiSourceLive({ rootDir: path.resolve(process.cwd(), ".capabilities") }),
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
  );
  const managedRuntime = ManagedRuntime.make(liveLayer);
  const runtime = await managedRuntime.runtime();

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
        if (!origin || origin === "http://localhost:5173") return origin ?? "";
        return origin;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

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

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      version: "0.0.0",
      capabilitiesDir,
      importsDir,
      policyDir,
      localRepoPath,
    }),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    process.stderr.write(
      `[shuvdex/api] listening on http://localhost:${info.port}\n`,
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
