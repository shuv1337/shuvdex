import { describe, expect, it } from "vitest";
import { Effect, Ref } from "effect";
import {
  CapabilityRegistry,
  CapabilityRegistryTest,
  MockCapabilityStore,
} from "../src/index.js";

describe("CapabilityRegistry", () => {
  it("lists packages from the backing store", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MockCapabilityStore;
        yield* Ref.update(store, (state) =>
          new Map(state).set("custom.echo", {
            id: "custom.echo",
            version: "1.0.0",
            title: "Echo",
            description: "Echo package",
            builtIn: false,
            enabled: true,
            tags: ["custom"],
            source: { type: "generated" },
            capabilities: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }),
        );
        const registry = yield* CapabilityRegistry;
        return yield* registry.listPackages();
      }).pipe(Effect.provide(CapabilityRegistryTest)),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("custom.echo");
  });

  it("flattens capabilities across packages", async () => {
    const capabilities = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* MockCapabilityStore;
        yield* Ref.update(store, (state) =>
          new Map(state).set("custom.echo", {
            id: "custom.echo",
            version: "1.0.0",
            title: "Echo",
            description: "Echo package",
            builtIn: false,
            enabled: true,
            tags: ["custom"],
            source: { type: "generated" },
            capabilities: [
              {
                id: "echo",
                packageId: "custom.echo",
                version: "1.0.0",
                kind: "tool",
                title: "Echo",
                description: "Echo text back to the caller.",
                enabled: true,
                visibility: "scoped",
                tags: ["custom"],
                riskLevel: "low",
                subjectScopes: ["admin"],
                executorRef: { executorType: "module_runtime" },
                tool: {
                  inputSchema: { type: "object" },
                  outputSchema: { type: "object" },
                  sideEffectLevel: "read",
                },
              },
            ],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          }),
        );
        const registry = yield* CapabilityRegistry;
        return yield* registry.listCapabilities({ kind: "tool" });
      }).pipe(Effect.provide(CapabilityRegistryTest)),
    );

    expect(capabilities.map((item) => item.id)).toContain("echo");
    expect(capabilities).toHaveLength(1);
  });
});
