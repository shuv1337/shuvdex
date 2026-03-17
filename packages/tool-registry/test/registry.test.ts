/**
 * Tests for the tool registry package.
 *
 * Covers:
 * - Typed errors (structure and messages)
 * - Schema decoding (ToolParam and ToolDefinition)
 * - In-memory CRUD operations via ToolRegistryTest layer
 * - File I/O (loadFromDirectory / saveToDirectory) via ToolRegistryLive layer
 */
import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Schema, Either } from "effect";
import { Layer } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ToolRegistry,
  ToolRegistryTest,
  ToolRegistryLive,
  MockToolStore,
  ToolNotFound,
  ToolAlreadyExists,
  CannotRemoveBuiltIn,
  ToolValidationError,
  ToolRegistryIOError,
  ToolParam,
  ToolDefinition,
} from "../src/index.js";
import type { ToolDefinition as ToolDefinitionType } from "../src/index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.join(__dirname, "..", "tools");

const customTool: ToolDefinitionType = {
  name: "custom_greet",
  description: "Greet a user by name.",
  enabled: true,
  builtIn: false,
  category: "custom",
  schema: {
    name: {
      type: "string",
      description: "Name to greet",
    },
    loud: {
      type: "boolean",
      description: "Whether to shout",
      optional: true,
    },
  },
};

const builtInTool: ToolDefinitionType = {
  name: "builtin_op",
  description: "A core built-in operation.",
  enabled: true,
  builtIn: true,
  category: "fleet",
  schema: {
    hosts: {
      type: "array",
      description: "Target hosts",
      optional: true,
      items: { type: "string" },
    },
  },
};

// ---------------------------------------------------------------------------
// Error type tests (no layer needed)
// ---------------------------------------------------------------------------

describe("ToolNotFound", () => {
  it("has correct _tag", () => {
    const err = new ToolNotFound({ name: "missing_tool" });
    expect(err._tag).toBe("ToolNotFound");
  });

  it("includes tool name in message", () => {
    const err = new ToolNotFound({ name: "missing_tool" });
    expect(err.message).toContain("missing_tool");
  });

  it("stores name field", () => {
    const err = new ToolNotFound({ name: "fleet_status" });
    expect(err.name).toBe("fleet_status");
  });
});

describe("ToolAlreadyExists", () => {
  it("has correct _tag", () => {
    const err = new ToolAlreadyExists({ name: "fleet_status" });
    expect(err._tag).toBe("ToolAlreadyExists");
  });

  it("includes tool name in message", () => {
    const err = new ToolAlreadyExists({ name: "fleet_status" });
    expect(err.message).toContain("fleet_status");
  });
});

describe("CannotRemoveBuiltIn", () => {
  it("has correct _tag", () => {
    const err = new CannotRemoveBuiltIn({ name: "fleet_pull" });
    expect(err._tag).toBe("CannotRemoveBuiltIn");
  });

  it("includes tool name in message", () => {
    const err = new CannotRemoveBuiltIn({ name: "fleet_pull" });
    expect(err.message).toContain("fleet_pull");
  });
});

describe("ToolValidationError", () => {
  it("has correct _tag", () => {
    const err = new ToolValidationError({ name: "bad.yaml", issues: "missing name" });
    expect(err._tag).toBe("ToolValidationError");
  });

  it("includes name and issues in message", () => {
    const err = new ToolValidationError({ name: "bad.yaml", issues: "missing name" });
    expect(err.message).toContain("bad.yaml");
    expect(err.message).toContain("missing name");
  });
});

describe("ToolRegistryIOError", () => {
  it("has correct _tag", () => {
    const err = new ToolRegistryIOError({ path: "/tools", cause: "ENOENT" });
    expect(err._tag).toBe("ToolRegistryIOError");
  });

  it("includes path and cause in message", () => {
    const err = new ToolRegistryIOError({ path: "/tools", cause: "ENOENT" });
    expect(err.message).toContain("/tools");
    expect(err.message).toContain("ENOENT");
  });
});

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe("ToolParam schema", () => {
  it("accepts minimal param with only type", () => {
    const result = Schema.decodeUnknownSync(ToolParam)({ type: "string" });
    expect(result.type).toBe("string");
  });

  it("accepts all valid types", () => {
    for (const type of ["string", "number", "boolean", "array"] as const) {
      const result = Schema.decodeUnknownSync(ToolParam)({ type });
      expect(result.type).toBe(type);
    }
  });

  it("rejects unknown type", () => {
    expect(() =>
      Schema.decodeUnknownSync(ToolParam)({ type: "object" }),
    ).toThrow();
  });

  it("accepts full param with all optional fields", () => {
    const result = Schema.decodeUnknownSync(ToolParam)({
      type: "array",
      description: "List of hosts",
      optional: true,
      items: { type: "string" },
      enum: ["a", "b"],
      default: ["host1"],
    });
    expect(result.type).toBe("array");
    expect(result.description).toBe("List of hosts");
    expect(result.optional).toBe(true);
    expect(result.items).toEqual({ type: "string" });
    expect(result.enum).toEqual(["a", "b"]);
    expect(result.default).toEqual(["host1"]);
  });

  it("leaves optional fields undefined when absent", () => {
    const result = Schema.decodeUnknownSync(ToolParam)({ type: "boolean" });
    expect(result.description).toBeUndefined();
    expect(result.optional).toBeUndefined();
    expect(result.items).toBeUndefined();
    expect(result.enum).toBeUndefined();
    expect(result.default).toBeUndefined();
  });
});

describe("ToolDefinition schema", () => {
  it("accepts a valid full definition", () => {
    const result = Schema.decodeUnknownSync(ToolDefinition)({
      name: "fleet_status",
      description: "Get fleet status.",
      enabled: true,
      builtIn: true,
      category: "fleet",
      schema: {
        hosts: { type: "array", optional: true, items: { type: "string" } },
      },
    });
    expect(result.name).toBe("fleet_status");
    expect(result.enabled).toBe(true);
    expect(result.builtIn).toBe(true);
    expect(result.category).toBe("fleet");
    expect(result.schema.hosts.type).toBe("array");
  });

  it("accepts definition with empty schema record", () => {
    const result = Schema.decodeUnknownSync(ToolDefinition)({
      name: "my_tool",
      description: "Does something.",
      enabled: false,
      builtIn: false,
      category: "custom",
      schema: {},
    });
    expect(result.schema).toEqual({});
  });

  it("accepts optional handler, createdAt, updatedAt", () => {
    const result = Schema.decodeUnknownSync(ToolDefinition)({
      name: "my_tool",
      description: "Does something.",
      enabled: true,
      builtIn: false,
      category: "custom",
      schema: {},
      handler: "./handlers/my_tool.js",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-06-01T00:00:00.000Z",
    });
    expect(result.handler).toBe("./handlers/my_tool.js");
    expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(result.updatedAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(ToolDefinition)({
        name: "my_tool",
        // missing description, enabled, etc.
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    const result = Schema.decodeUnknownEither(ToolDefinition)({
      name: "",
      description: "desc",
      enabled: true,
      builtIn: false,
      category: "custom",
      schema: {},
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// In-memory CRUD operations (ToolRegistryTest layer)
//
// NOTE: @effect/vitest's layer() shares one layer instance across all
// it.effect() calls within the same layer() block. Tests that mutate
// registry state must reset the store via MockToolStore at the start.
// ---------------------------------------------------------------------------

const TestLayer = ToolRegistryTest;

/**
 * Reset helper: clears all entries from the shared in-memory store.
 * Call at the start of any test that needs an isolated empty registry.
 */
const resetStore: Effect.Effect<void, never, MockToolStore> = Effect.gen(
  function* () {
    const storeRef = yield* MockToolStore;
    yield* Ref.set(storeRef, new Map());
  },
);

describe("ToolRegistry - in-memory operations", () => {
  layer(TestLayer)("listTools", (it) => {
    it.effect("returns empty list initially", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const tools = yield* registry.listTools();
        expect(tools).toHaveLength(0);
      }),
    );

    it.effect("returns all added tools", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        yield* registry.addTool(builtInTool);
        const tools = yield* registry.listTools();
        expect(tools).toHaveLength(2);
        const names = tools.map((t) => t.name);
        expect(names).toContain("custom_greet");
        expect(names).toContain("builtin_op");
      }),
    );
  });

  layer(TestLayer)("getTool", (it) => {
    it.effect("returns a tool by name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const tool = yield* registry.getTool("custom_greet");
        expect(tool.name).toBe("custom_greet");
        expect(tool.description).toBe("Greet a user by name.");
        expect(tool.builtIn).toBe(false);
      }),
    );

    it.effect("fails with ToolNotFound for unknown name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .getTool("nonexistent")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
          expect((result.left as ToolNotFound).name).toBe("nonexistent");
        }
      }),
    );
  });

  layer(TestLayer)("addTool", (it) => {
    it.effect("adds a new tool and returns it", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const added = yield* registry.addTool(customTool);
        expect(added.name).toBe("custom_greet");
        expect(added.enabled).toBe(true);
      }),
    );

    it.effect("fails with ToolAlreadyExists on duplicate name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const result = yield* registry.addTool(customTool).pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolAlreadyExists);
          expect((result.left as ToolAlreadyExists).name).toBe("custom_greet");
        }
      }),
    );

    it.effect("persists tool so getTool can retrieve it", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const retrieved = yield* registry.getTool("custom_greet");
        expect(retrieved).toEqual(customTool);
      }),
    );
  });

  layer(TestLayer)("updateTool", (it) => {
    it.effect("updates tool description", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const updated = yield* registry.updateTool("custom_greet", {
          description: "Updated description.",
        });
        expect(updated.description).toBe("Updated description.");
        expect(updated.name).toBe("custom_greet"); // name preserved
      }),
    );

    it.effect("sets updatedAt timestamp automatically", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const updated = yield* registry.updateTool("custom_greet", {
          enabled: false,
        });
        expect(updated.updatedAt).toBeDefined();
        // Should be a valid ISO date
        expect(() => new Date(updated.updatedAt!)).not.toThrow();
      }),
    );

    it.effect("preserves name even if name is passed in updates", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        const updated = yield* registry.updateTool("custom_greet", {
          name: "different_name" as never, // attempt to rename
        });
        expect(updated.name).toBe("custom_greet");
      }),
    );

    it.effect("fails with ToolNotFound for unknown name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .updateTool("nonexistent", { enabled: false })
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
        }
      }),
    );
  });

  layer(TestLayer)("removeTool", (it) => {
    it.effect("removes a custom tool", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        yield* registry.removeTool("custom_greet");
        const result = yield* registry
          .getTool("custom_greet")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
        }
      }),
    );

    it.effect("fails with CannotRemoveBuiltIn for built-in tools", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(builtInTool);
        const result = yield* registry
          .removeTool("builtin_op")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(CannotRemoveBuiltIn);
          expect((result.left as CannotRemoveBuiltIn).name).toBe("builtin_op");
        }
      }),
    );

    it.effect("fails with ToolNotFound for unknown name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .removeTool("nonexistent")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
        }
      }),
    );
  });

  layer(TestLayer)("enableTool / disableTool", (it) => {
    it.effect("enableTool sets enabled to true", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const disabled: ToolDefinitionType = { ...customTool, enabled: false };
        yield* registry.addTool(disabled);
        const updated = yield* registry.enableTool("custom_greet");
        expect(updated.enabled).toBe(true);
      }),
    );

    it.effect("disableTool sets enabled to false", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool); // enabled: true
        const updated = yield* registry.disableTool("custom_greet");
        expect(updated.enabled).toBe(false);
      }),
    );

    it.effect("enableTool fails with ToolNotFound for unknown name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .enableTool("nonexistent")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
        }
      }),
    );

    it.effect("disableTool fails with ToolNotFound for unknown name", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .disableTool("nonexistent")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolNotFound);
        }
      }),
    );

    it.effect("toggle updates the in-store value", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        yield* registry.disableTool("custom_greet");
        const disabled = yield* registry.getTool("custom_greet");
        expect(disabled.enabled).toBe(false);

        yield* registry.enableTool("custom_greet");
        const enabled = yield* registry.getTool("custom_greet");
        expect(enabled.enabled).toBe(true);
      }),
    );
  });

  layer(TestLayer)("MockToolStore pre-population", (it) => {
    it.effect("can pre-populate store via MockToolStore ref", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const storeRef = yield* MockToolStore;
        yield* Ref.update(storeRef, (s) =>
          new Map(s).set(customTool.name, customTool),
        );

        const registry = yield* ToolRegistry;
        const tool = yield* registry.getTool("custom_greet");
        expect(tool.name).toBe("custom_greet");
      }),
    );

    it.effect("can inspect store contents via MockToolStore ref", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);

        const storeRef = yield* MockToolStore;
        const store = yield* Ref.get(storeRef);
        expect(store.has("custom_greet")).toBe(true);
        expect(store.get("custom_greet")?.enabled).toBe(true);
      }),
    );
  });

  layer(TestLayer)("loadFromDirectory (test layer no-op)", (it) => {
    it.effect("returns empty array without reading files", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const loaded = yield* registry.loadFromDirectory("/any/path");
        expect(loaded).toHaveLength(0);
      }),
    );
  });

  layer(TestLayer)("saveToDirectory (test layer no-op)", (it) => {
    it.effect("returns void without writing files", () =>
      Effect.gen(function* () {
        yield* resetStore;
        const registry = yield* ToolRegistry;
        yield* registry.addTool(customTool);
        // Should not throw
        yield* registry.saveToDirectory("/any/path");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// File I/O operations (ToolRegistryLive layer)
// ---------------------------------------------------------------------------

describe("ToolRegistry - file I/O (live layer)", () => {
  layer(ToolRegistryLive)("loadFromDirectory with package tools/", (it) => {
    it.effect("loads all 7 built-in fleet tools from tools/ directory", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const loaded = yield* registry.loadFromDirectory(toolsDir);
        expect(loaded).toHaveLength(7);
        const names = loaded.map((t) => t.name).sort();
        expect(names).toEqual([
          "fleet_activate",
          "fleet_deactivate",
          "fleet_drift",
          "fleet_pull",
          "fleet_rollback",
          "fleet_status",
          "fleet_sync",
        ]);
      }),
    );

    it.effect("all loaded tools have builtIn: true", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const loaded = yield* registry.loadFromDirectory(toolsDir);
        for (const tool of loaded) {
          expect(tool.builtIn).toBe(true);
        }
      }),
    );

    it.effect("all loaded tools are enabled by default", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const loaded = yield* registry.loadFromDirectory(toolsDir);
        for (const tool of loaded) {
          expect(tool.enabled).toBe(true);
        }
      }),
    );

    it.effect("all loaded tools have category: fleet", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const loaded = yield* registry.loadFromDirectory(toolsDir);
        for (const tool of loaded) {
          expect(tool.category).toBe("fleet");
        }
      }),
    );

    it.effect("makes loaded tools queryable via getTool", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        yield* registry.loadFromDirectory(toolsDir);
        const status = yield* registry.getTool("fleet_status");
        expect(status.name).toBe("fleet_status");
        expect(status.schema.hosts).toBeDefined();
        expect(status.schema.hosts.type).toBe("array");
      }),
    );

    it.effect("fleet_sync has required skill parameter", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        yield* registry.loadFromDirectory(toolsDir);
        const sync = yield* registry.getTool("fleet_sync");
        expect(sync.schema.skill).toBeDefined();
        expect(sync.schema.skill.type).toBe("string");
        // skill is required (optional field absent or false)
        expect(sync.schema.skill.optional).toBeFalsy();
      }),
    );

    it.effect("fleet_rollback has required ref parameter", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        yield* registry.loadFromDirectory(toolsDir);
        const rollback = yield* registry.getTool("fleet_rollback");
        expect(rollback.schema.ref).toBeDefined();
        expect(rollback.schema.ref.type).toBe("string");
      }),
    );

    it.effect("fleet_drift has optional referenceHost parameter", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        yield* registry.loadFromDirectory(toolsDir);
        const drift = yield* registry.getTool("fleet_drift");
        expect(drift.schema.referenceHost).toBeDefined();
        expect(drift.schema.referenceHost.optional).toBe(true);
      }),
    );

    it.effect("fails with ToolRegistryIOError for missing directory", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const result = yield* registry
          .loadFromDirectory("/nonexistent/directory/xyz")
          .pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ToolRegistryIOError);
        }
      }),
    );
  });

  layer(ToolRegistryLive)("saveToDirectory", (it) => {
    it.effect("writes one YAML file per tool to the output directory", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-reg-test-"));

        try {
          yield* registry.loadFromDirectory(toolsDir);
          yield* registry.saveToDirectory(tmpDir);

          const written = fs.readdirSync(tmpDir).sort();
          expect(written).toHaveLength(7);
          expect(written).toContain("fleet_status.yaml");
          expect(written).toContain("fleet_drift.yaml");
        } finally {
          fs.rmSync(tmpDir, { recursive: true });
        }
      }),
    );

    it.effect("written YAML files can be re-loaded successfully", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-reg-test-"));

        try {
          // Load from tools/, save to tmpDir
          const original = yield* registry.loadFromDirectory(toolsDir);
          yield* registry.saveToDirectory(tmpDir);

          // Use a second registry instance to reload from tmpDir
          const registry2 = yield* ToolRegistry;
          const reloaded = yield* registry2.loadFromDirectory(tmpDir);

          expect(reloaded).toHaveLength(original.length);
          const origNames = original.map((t) => t.name).sort();
          const reloadNames = reloaded.map((t) => t.name).sort();
          expect(reloadNames).toEqual(origNames);
        } finally {
          fs.rmSync(tmpDir, { recursive: true });
        }
      }),
    );

    it.effect("creates output directory if it does not exist", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry;
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "tool-reg-test-"));
        const newDir = path.join(base, "nested", "output");

        try {
          yield* registry.addTool(customTool);
          yield* registry.saveToDirectory(newDir);

          expect(fs.existsSync(newDir)).toBe(true);
          expect(fs.existsSync(path.join(newDir, "custom_greet.yaml"))).toBe(true);
        } finally {
          fs.rmSync(base, { recursive: true });
        }
      }),
    );
  });
});
