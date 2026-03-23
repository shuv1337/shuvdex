import { describe, expect, it } from "vitest";
import { Effect, Layer, Ref } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "node:http";
import { makeExecutionProvidersLive, ExecutionProviders } from "../src/index.js";
import { CollectedSpans, TelemetryTest } from "@shuvdex/telemetry";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";

describe("ExecutionProviders", () => {
  it("executes module_runtime targets and records telemetry", async () => {
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-runtime-provider-"));
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-mod-creds-"));
    const scriptPath = path.join(scriptDir, "tool.mjs");
    fs.writeFileSync(
      scriptPath,
      [
        'let input = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => { input += chunk; });',
        'process.stdin.on("end", () => {',
        '  const request = JSON.parse(input || "{}");',
        '  process.stdout.write(JSON.stringify({ payload: { echoed: request.args.message, capabilityId: request.capabilityId } }));',
        '});',
      ].join("\n"),
      "utf-8",
    );

    const capability = {
      id: "test.echo",
      packageId: "skill.test_echo",
      version: "1.0.0",
      kind: "tool" as const,
      title: "Test echo",
      description: "Echo test runner",
      enabled: true,
      visibility: "public" as const,
      executorRef: {
        executorType: "module_runtime" as const,
        target: scriptPath,
        timeoutMs: 2_000,
      },
      tool: {
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
        outputSchema: { type: "object" },
        sideEffectLevel: "read" as const,
      },
    };

    const credentialLayer = makeCredentialStoreLive({
      rootDir: credsDir,
      keyPath: path.join(credsDir, ".key"),
    });
    const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
    const providersLayer = Layer.provide(makeExecutionProvidersLive(), httpLayer);
    const layer = Layer.mergeAll(credentialLayer, httpLayer, providersLayer, TelemetryTest);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ExecutionProviders;
        const spansRef = yield* CollectedSpans;
        const execution = yield* providers.executeTool(capability, { message: "hello" });
        const spans = yield* Ref.get(spansRef);
        return { execution, spans };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.execution.isError).not.toBe(true);
    expect(result.execution.payload).toMatchObject({
      echoed: "hello",
      capabilityId: "test.echo",
    });
    expect(result.spans.some((span) => span.name === "execution.module_runtime")).toBe(true);
    fs.rmSync(scriptDir, { recursive: true, force: true });
    fs.rmSync(credsDir, { recursive: true, force: true });
  });

  it("executes http_api-backed tools through the runtime", async () => {
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-http-creds-"));
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;

    const capability = {
      id: "test.http",
      packageId: "openapi.test",
      version: "1.0.0",
      kind: "tool" as const,
      title: "Test http",
      description: "HTTP test runner",
      enabled: true,
      visibility: "public" as const,
      executorRef: {
        executorType: "http_api" as const,
        timeoutMs: 2_000,
        httpBinding: {
          method: "get",
          baseUrl: `http://127.0.0.1:${port}`,
          pathTemplate: "/items/{id}",
        },
      },
      tool: {
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        sideEffectLevel: "read" as const,
      },
    };

    const credentialLayer = makeCredentialStoreLive({
      rootDir: credsDir,
      keyPath: path.join(credsDir, ".key"),
    });
    const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
    const providersLayer = Layer.provide(makeExecutionProvidersLive(), httpLayer);
    const layer = Layer.mergeAll(credentialLayer, httpLayer, providersLayer);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ExecutionProviders;
        return yield* providers.executeTool(capability, { path: { id: "abc" }, query: { page: 1 } });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.isError).toBe(false);
    expect(seen[0]).toContain("/items/abc?page=1");
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    fs.rmSync(credsDir, { recursive: true, force: true });
  });
});
