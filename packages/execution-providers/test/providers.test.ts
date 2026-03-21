import { describe, expect, it } from "vitest";
import { Effect, Layer, Ref } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeExecutionProvidersLive, ExecutionProviders } from "../src/index.js";
import { CollectedSpans, TelemetryTest } from "@codex-fleet/telemetry";

describe("ExecutionProviders", () => {
  it("executes module_runtime targets and records telemetry", async () => {
    const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-runtime-provider-"));
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

    const layer = Layer.mergeAll(makeExecutionProvidersLive(), TelemetryTest);
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
  });

  it("returns a structured error when module_runtime target is missing", async () => {
    const capability = {
      id: "test.missing",
      packageId: "skill.test_missing",
      version: "1.0.0",
      kind: "tool" as const,
      title: "Missing target",
      description: "Missing module runtime target",
      enabled: true,
      visibility: "public" as const,
      executorRef: {
        executorType: "module_runtime" as const,
        target: "/tmp/does-not-exist.mjs",
        timeoutMs: 1_000,
      },
      tool: {
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        sideEffectLevel: "read" as const,
      },
    };

    const layer = Layer.mergeAll(makeExecutionProvidersLive(), TelemetryTest);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* ExecutionProviders;
        return yield* providers.executeTool(capability, {});
      }).pipe(Effect.provide(layer)),
    );

    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({
      capabilityId: "test.missing",
    });
  });
});
