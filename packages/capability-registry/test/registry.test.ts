import { describe, expect, it } from "vitest";
import { Effect, Ref } from "effect";
import {
  CapabilityPackage,
  CapabilityRegistry,
  CapabilityRegistryTest,
  MockCapabilityStore,
  makeCapabilityRegistryLive,
} from "../src/index.js";
import { Schema } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

  it("accepts imported_archive sources and preserves them across persistence", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capability-registry-imported-"));
    const pkg = Schema.decodeUnknownSync(CapabilityPackage)({
      id: "skill.visual_explainer",
      version: "0.4.3",
      title: "Visual Explainer",
      description: "Imported skill package",
      builtIn: false,
      enabled: true,
      source: {
        type: "imported_archive",
        path: "/tmp/imports/skill.visual_explainer/0.4.3",
        skillName: "visual-explainer",
        archiveName: "visual-explainer.skill",
        importedAt: "2026-03-19T00:00:00.000Z",
        checksum: "abc123",
        importMode: "upload",
      },
      annotations: {
        "frontmatter.compatibility": "browser",
        "package.keywords": ["pi-package"],
      },
      capabilities: [],
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* CapabilityRegistry;
        yield* registry.upsertPackage(pkg);
        return yield* registry.listPackages();
      }).pipe(Effect.provide(makeCapabilityRegistryLive(dir))),
    );

    const reloaded = await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* CapabilityRegistry;
        return yield* registry.listPackages();
      }).pipe(Effect.provide(makeCapabilityRegistryLive(dir))),
    );

    expect(reloaded[0]?.source).toMatchObject({
      type: "imported_archive",
      archiveName: "visual-explainer.skill",
      checksum: "abc123",
    });
    expect(reloaded[0]?.annotations).toMatchObject({
      "frontmatter.compatibility": "browser",
      "package.keywords": ["pi-package"],
    });
  });
});
