import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeCapabilityRegistryLive, CapabilityRegistry } from "@shuvdex/capability-registry";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeExecutionProvidersLive, ExecutionProviders } from "@shuvdex/execution-providers";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
import { SkillIndexer, SkillIndexerLive } from "@shuvdex/skill-indexer";
import { McpProxy } from "@shuvdex/mcp-proxy";
import { createServer } from "../src/server.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const McpProxyStub = Layer.succeed(McpProxy, {
  registerUpstream: () => Effect.fail(new Error("stub")),
  listUpstreams: () => Effect.succeed([]),
  getUpstream: () => Effect.fail(new Error("stub")),
  updateUpstream: () => Effect.fail(new Error("stub")),
  deleteUpstream: () => Effect.succeed(undefined),
  syncUpstream: () => Effect.fail(new Error("stub")),
  checkHealth: () => Effect.succeed("unknown" as const),
  callUpstreamTool: () => Effect.fail(new Error("stub")),
  getCachedTools: () => Effect.succeed(null),
  pinToolDescriptions: () => Effect.succeed(undefined),
  checkMutations: () => Effect.succeed({ mutated: [], clean: [] }),
});

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function buildRuntime() {
  const root = makeTempDir("shuvdex-http-");
  const repoRoot = makeTempDir("shuvdex-http-repo-");
  const skillDir = join(repoRoot, "demo-skill");
  const scriptPath = join(skillDir, "echo.mcp.mjs");

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "# Demo Skill\n\nSimple HTTP MCP test skill.\n", "utf-8");
  writeFileSync(
    join(skillDir, "capability.yaml"),
    [
      "id: skill.demo_http",
      "title: Demo HTTP Skill",
      "description: HTTP-exposed demo tool.",
      "version: 1.0.0",
      "visibility: public",
      "capabilities:",
      "  - id: skill.demo_http.echo",
      "    packageId: skill.demo_http",
      "    version: 1.0.0",
      "    kind: tool",
      "    title: Echo",
      "    description: Echo the supplied message.",
      "    enabled: true",
      "    visibility: public",
      "    executorRef:",
      "      executorType: module_runtime",
      `      target: ${scriptPath}`,
      "      timeoutMs: 2000",
      "    tool:",
      "      inputSchema:",
      "        type: object",
      "        required:",
      "          - message",
      "        properties:",
      "          message:",
      "            type: string",
      "      outputSchema:",
      "        type: object",
      "      sideEffectLevel: read",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    scriptPath,
    [
      'let input = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const request = JSON.parse(input || "{}");',
      '  process.stdout.write(JSON.stringify({ payload: { echoed: request.args.message } }));',
      '});',
    ].join("\n"),
    "utf-8",
  );

  const capabilitiesDir = join(root, "packages");
  const policyDir = join(root, "policy");
  const credentialDir = join(root, "credentials");

  const registryLayer = makeCapabilityRegistryLive(capabilitiesDir);
  const credentialLayer = makeCredentialStoreLive({ rootDir: credentialDir, keyPath: join(root, ".credential-key") });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const executionLayer = Layer.provide(makeExecutionProvidersLive(), Layer.merge(httpLayer, McpProxyStub));
  const liveLayer = Layer.mergeAll(
    registryLayer,
    credentialLayer,
    httpLayer,
    executionLayer,
    makePolicyEngineLive({ policyDir }),
    SkillIndexerLive,
    McpProxyStub,
  );

  const managedRuntime = ManagedRuntime.make(liveLayer);
  const runtime = await managedRuntime.runtime();

  const packages = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* CapabilityRegistry;
      const indexer = yield* SkillIndexer;
      const indexed = yield* indexer.indexRepository(repoRoot);
      for (const artifact of indexed.artifacts) {
        yield* registry.upsertPackage(artifact.package);
      }
      return yield* registry.listPackages();
    }).pipe(Effect.provide(runtime)),
  );

  const executors = await Effect.runPromise(Effect.gen(function* () {
    return yield* ExecutionProviders;
  }).pipe(Effect.provide(runtime)));

  const policy = await Effect.runPromise(Effect.gen(function* () {
    return yield* PolicyEngine;
  }).pipe(Effect.provide(runtime)));

  return {
    managedRuntime,
    serverConfig: {
      capabilities: packages,
      claims: policy.defaultClaims(),
      policy,
      executors,
    },
  };
}

function makeApp(serverConfig: Parameters<typeof createServer>[0]) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "shuvdex-mcp-server",
      transport: "streamable-http",
      version: "0.0.0",
      packageCount: serverConfig?.capabilities?.length ?? 0,
    }),
  );

  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(serverConfig);
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
            data: { requestId: randomUUID(), error: message },
          },
          id: null,
        },
        500,
      );
    } finally {
      await Promise.allSettled([transport.close(), server.close()]);
    }
  });

  return app;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("HTTP MCP server", () => {
  it("serves health and handles initialize + tools/list over /mcp", async () => {
    const runtime = await buildRuntime();
    const app = makeApp(runtime.serverConfig as never);

    try {
      const health = await app.request("http://localhost/health");
      expect(health.ok).toBe(true);
      const healthJson = (await health.json()) as Record<string, unknown>;
      expect(healthJson.status).toBe("ok");
      expect(healthJson.transport).toBe("streamable-http");
      expect(healthJson.packageCount).toBe(1);

      const init = await app.request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.1" },
          },
        }),
      });

      expect(init.ok).toBe(true);
      const initJson = (await init.json()) as Record<string, unknown>;
      expect(initJson).toMatchObject({ jsonrpc: "2.0", id: 1 });

      const tools = await app.request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });

      expect(tools.ok).toBe(true);
      const toolsJson = (await tools.json()) as {
        result?: { tools?: Array<{ name?: string }> };
      };
      expect(toolsJson.result?.tools?.some((tool) => tool.name === "skill.demo_http.echo")).toBe(true);
    } finally {
      await runtime.managedRuntime.dispose();
    }
  });
});
