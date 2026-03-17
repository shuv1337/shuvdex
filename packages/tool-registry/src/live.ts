/**
 * File-backed live implementation of the ToolRegistry service.
 *
 * Architecture
 * ────────────
 * The in-memory state is held in an Effect Ref<Map<string, ToolDefinition>>.
 * `_makeCoreOps` builds all CRUD methods against that Ref and is exported
 * so the test layer can share the same logic while substituting no-op file I/O.
 *
 * `makeToolRegistryLive` builds the full Layer:
 *  1. Creates the tools directory, seeds built-in tools if absent.
 *  2. Loads existing tools into a Map Ref.
 *  3. Wraps `_makeCoreOps` mutations to also persist the changed file.
 *  4. Provides `loadFromDirectory` / `saveToDirectory` backed by real I/O.
 *
 * Built-in tool seeding
 * ─────────────────────
 * The 7 fleet tools (fleet_status … fleet_rollback) are written to disk on
 * first run.  They can be toggled (enabled/disabled) but not deleted.
 */
import { Effect, Layer, Ref, Schema } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ToolDefinition as ToolDefinitionSchema } from "./schema.js";
import type { ToolDefinition } from "./schema.js";
import {
  ToolNotFound,
  ToolAlreadyExists,
  CannotRemoveBuiltIn,
  ToolValidationError,
  ToolRegistryIOError,
} from "./errors.js";
import type {
  CreateToolInput,
  UpdateToolInput,
  ListToolsFilter,
  ToolRegistryService,
} from "./types.js";
import { ToolRegistry } from "./types.js";

// ---------------------------------------------------------------------------
// Built-in tool seed data
// ---------------------------------------------------------------------------

/** ToolParam shorthand helpers. */
const strParam = (description: string): ToolDefinition["schema"][string] => ({
  type: "string" as const,
  description,
  optional: false,
});
const strArrayParam = (description: string): ToolDefinition["schema"][string] => ({
  type: "array" as const,
  description,
  optional: true,
  items: { type: "string" },
});

const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: "fleet_status",
    description:
      "Get fleet status: connectivity, HEAD commit, branch, and dirty state for each host.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_sync",
    description: "Sync a skill from local repository to remote hosts.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      skill: strParam("Name of the skill directory to sync"),
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_activate",
    description:
      "Activate a skill on remote hosts by creating a symlink in the active skills directory.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      skill: strParam("Name of the skill to activate"),
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_deactivate",
    description: "Deactivate a skill on remote hosts by removing its activation symlink.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      skill: strParam("Name of the skill to deactivate"),
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_pull",
    description: "Pull latest changes from the remote origin on each host's skills repository.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_drift",
    description: "Detect commit drift across fleet hosts by comparing HEAD commits to a reference.",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      referenceHost: {
        type: "string" as const,
        description: "Host to use as the reference (defaults to first configured host)",
        optional: true,
      },
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    name: "fleet_rollback",
    description: "Rollback hosts to a specific git ref (branch, tag, or SHA).",
    enabled: true,
    builtIn: true,
    category: "fleet",
    schema: {
      ref: strParam("Git ref to checkout (branch, tag, or SHA)"),
      hosts: strArrayParam("Subset of host names to target (defaults to all)"),
    },
    createdAt: "2024-01-01T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate a tool name: snake_case, starts with letter or underscore. */
function validateToolName(name: string): string | null {
  if (!name || name.trim().length === 0) return "Tool name cannot be empty";
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    return `Tool name "${name}" is invalid — must match [a-z_][a-z0-9_]*`;
  }
  return null;
}

/** Validate non-empty required string fields. */
function validateRequired(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `Field "${field}" must be a non-empty string`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// File I/O helpers (synchronous)
// ---------------------------------------------------------------------------

function toolYamlPath(dir: string, name: string): string {
  return path.join(dir, `${name}.yaml`);
}

function toolJsonPath(dir: string, name: string): string {
  return path.join(dir, `${name}.json`);
}

function writeToolFile(dir: string, tool: ToolDefinition): void {
  fs.writeFileSync(toolYamlPath(dir, tool.name), yamlStringify(tool), "utf-8");
}

function deleteToolFile(dir: string, name: string): void {
  // Try both YAML and JSON extensions for backward compatibility
  for (const ext of [".yaml", ".json"]) {
    try {
      fs.unlinkSync(path.join(dir, `${name}${ext}`));
    } catch {
      // File didn't exist with this extension — continue
    }
  }
}

/**
 * Read all `*.yaml`, `*.yml`, and `*.json` files from `dir` and decode each
 * with ToolDefinitionSchema.  Throws on directory I/O failure; individual
 * bad files are skipped with a warning.
 */
function readAllToolFiles(dir: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const isJson = file.endsWith(".json");
    const isYaml = file.endsWith(".yaml") || file.endsWith(".yml");
    if (!isJson && !isYaml) continue;
    try {
      const raw = (
        isJson
          ? JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"))
          : yamlParse(fs.readFileSync(path.join(dir, file), "utf-8"))
      ) as unknown;
      const result = Schema.decodeUnknownSync(ToolDefinitionSchema)(raw);
      tools.push(result);
    } catch {
      // Skip invalid / malformed files silently
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Core ops (shared between live and test layers)
// ---------------------------------------------------------------------------

/**
 * Build the CRUD subset of ToolRegistryService from a Ref-backed store.
 *
 * Mutations update the in-memory Map atomically via Ref.  Disk persistence is
 * **not** handled here — the live layer wraps mutations to also write files.
 * This separation allows the test layer to reuse this logic without file I/O.
 *
 * @internal Exported for use by `ToolRegistryTest` only.
 */
export function _makeCoreOps(
  storeRef: Ref.Ref<Map<string, ToolDefinition>>,
): Omit<ToolRegistryService, "loadFromDirectory" | "saveToDirectory"> {
  return {
    // ------- listTools -------
    listTools(filter?: ListToolsFilter) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        let tools = Array.from(store.values());
        if (filter?.enabled !== undefined) {
          tools = tools.filter((t) => t.enabled === filter.enabled);
        }
        return tools.sort((a, b) => a.name.localeCompare(b.name));
      });
    },

    // ------- getTool -------
    getTool(name: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const tool = store.get(name);
        if (tool === undefined) return yield* Effect.fail(new ToolNotFound({ name }));
        return tool;
      });
    },

    // ------- createTool -------
    createTool(input: CreateToolInput) {
      return Effect.gen(function* () {
        const nameErr = validateToolName(input.name);
        if (nameErr !== null) return yield* Effect.fail(new ToolValidationError({ issues: nameErr }));

        const descErr = validateRequired(input.description, "description");
        if (descErr !== null) return yield* Effect.fail(new ToolValidationError({ issues: descErr }));

        const catErr = validateRequired(input.category, "category");
        if (catErr !== null) return yield* Effect.fail(new ToolValidationError({ issues: catErr }));

        const store = yield* Ref.get(storeRef);
        if (store.has(input.name)) {
          return yield* Effect.fail(new ToolAlreadyExists({ name: input.name }));
        }

        const now = new Date().toISOString();
        const tool: ToolDefinition = {
          ...input,
          builtIn: false,
          createdAt: now,
          updatedAt: now,
        };

        yield* Ref.update(storeRef, (s) => {
          const next = new Map(s);
          next.set(tool.name, tool);
          return next;
        });

        return tool;
      });
    },

    // ------- addTool (verbatim insert) -------
    addTool(input: ToolDefinition) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        if (store.has(input.name)) {
          return yield* Effect.fail(new ToolAlreadyExists({ name: input.name }));
        }
        yield* Ref.update(storeRef, (s) => {
          const next = new Map(s);
          next.set(input.name, input);
          return next;
        });
        return input;
      });
    },

    // ------- updateTool -------
    updateTool(name: string, patch: UpdateToolInput) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(name);
        if (existing === undefined) return yield* Effect.fail(new ToolNotFound({ name }));

        // Validate any string fields being overwritten
        if (patch.description !== undefined) {
          const err = validateRequired(patch.description, "description");
          if (err !== null) return yield* Effect.fail(new ToolValidationError({ issues: err }));
        }
        if (patch.category !== undefined) {
          const err = validateRequired(patch.category, "category");
          if (err !== null) return yield* Effect.fail(new ToolValidationError({ issues: err }));
        }

        const updated: ToolDefinition = {
          ...existing,
          ...patch,
          // Immutable fields
          name: existing.name,
          builtIn: existing.builtIn,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };

        yield* Ref.update(storeRef, (s) => {
          const next = new Map(s);
          next.set(name, updated);
          return next;
        });

        return updated;
      });
    },

    // ------- deleteTool -------
    deleteTool(name: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(name);
        if (existing === undefined) return yield* Effect.fail(new ToolNotFound({ name }));
        if (existing.builtIn) return yield* Effect.fail(new CannotRemoveBuiltIn({ name }));

        yield* Ref.update(storeRef, (s) => {
          const next = new Map(s);
          next.delete(name);
          return next;
        });
      });
    },

    // ------- removeTool (alias for deleteTool) -------
    removeTool(name: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(name);
        if (existing === undefined) return yield* Effect.fail(new ToolNotFound({ name }));
        if (existing.builtIn) return yield* Effect.fail(new CannotRemoveBuiltIn({ name }));

        yield* Ref.update(storeRef, (s) => {
          const next = new Map(s);
          next.delete(name);
          return next;
        });
      });
    },

    // ------- enableTool -------
    enableTool(name: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(name);
        if (existing === undefined) return yield* Effect.fail(new ToolNotFound({ name }));

        const updated: ToolDefinition = { ...existing, enabled: true };
        yield* Ref.update(storeRef, (s) => new Map(s).set(name, updated));
        return updated;
      });
    },

    // ------- disableTool -------
    disableTool(name: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(name);
        if (existing === undefined) return yield* Effect.fail(new ToolNotFound({ name }));

        const updated: ToolDefinition = { ...existing, enabled: false };
        yield* Ref.update(storeRef, (s) => new Map(s).set(name, updated));
        return updated;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

/**
 * Create a `ToolRegistry` Layer backed by YAML files in `toolsDir`.
 *
 * If `toolsDir` is omitted a unique temporary directory is created per layer
 * evaluation (useful for the exported `ToolRegistryLive` constant).
 *
 * Built-in fleet tools are seeded on first run.  Every mutation also writes
 * (or deletes) the corresponding YAML file as a best-effort side effect —
 * errors are silently swallowed so they do not alter the typed error surface.
 *
 * @param toolsDir  Absolute path to the directory that stores tool YAML files.
 *                  Defaults to a fresh `mkdtemp` directory if not provided.
 */
export function makeToolRegistryLive(toolsDir?: string): Layer.Layer<ToolRegistry> {
  return Layer.effect(
    ToolRegistry,
    Effect.gen(function* () {
      // ---- Resolve / create the storage directory ----
      const dir =
        toolsDir ??
        (yield* Effect.sync(() =>
          fs.mkdtempSync(path.join(os.tmpdir(), "codex-fleet-tools-")),
        ));

      // ---- Initialise directory & seed built-ins ----
      fs.mkdirSync(dir, { recursive: true });

      for (const tool of BUILT_IN_TOOLS) {
        // Seed if neither YAML nor JSON exists yet
        if (!fs.existsSync(toolYamlPath(dir, tool.name)) && !fs.existsSync(toolJsonPath(dir, tool.name))) {
          writeToolFile(dir, tool);
        }
      }

      // ---- Load current state into Ref ----
      const initial = new Map<string, ToolDefinition>();
      try {
        for (const tool of readAllToolFiles(dir)) {
          initial.set(tool.name, tool);
        }
      } catch {
        // Directory unreadable — start empty; built-ins were written above
      }

      const storeRef = yield* Ref.make(initial);
      const core = _makeCoreOps(storeRef);

      // ---- File I/O helpers for loadFromDirectory / saveToDirectory ----

      /**
       * Load tools from a directory into the store (upsert by name) and return them.
       */
      const loadFromDirectory = (
        loadDir: string,
      ): Effect.Effect<ToolDefinition[], ToolRegistryIOError | ToolValidationError> =>
        Effect.gen(function* () {
          const tools = yield* Effect.try({
            try: () => readAllToolFiles(loadDir),
            catch: (e) => new ToolRegistryIOError({ path: loadDir, cause: String(e) }),
          });

          // Merge loaded tools into the in-memory store (upsert)
          yield* Ref.update(storeRef, (s) => {
            const next = new Map(s);
            for (const tool of tools) {
              next.set(tool.name, tool);
            }
            return next;
          });

          return tools;
        });

      /**
       * Persist all currently registered tools to `saveDir` as YAML files.
       */
      const saveToDirectory = (
        saveDir: string,
      ): Effect.Effect<void, ToolRegistryIOError> =>
        Effect.gen(function* () {
          const store = yield* Ref.get(storeRef);
          yield* Effect.try({
            try: () => {
              fs.mkdirSync(saveDir, { recursive: true });
              for (const [, tool] of store) {
                writeToolFile(saveDir, tool);
              }
            },
            catch: (e) => new ToolRegistryIOError({ path: saveDir, cause: String(e) }),
          });
        });

      // ---- Wrap mutations to persist to disk (best-effort) ----
      const persist = (tool: ToolDefinition): Effect.Effect<ToolDefinition> =>
        Effect.tap(Effect.succeed(tool), () =>
          Effect.sync(() => {
            try {
              writeToolFile(dir, tool);
            } catch {
              // Best-effort — do not propagate disk errors
            }
          }),
        );

      const persistVoid = (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          try {
            deleteToolFile(dir, name);
          } catch {
            // Best-effort
          }
        });

      const service: ToolRegistryService = {
        listTools: core.listTools.bind(core),
        getTool: core.getTool.bind(core),

        createTool: (input) =>
          core.createTool(input).pipe(Effect.flatMap(persist)),

        addTool: (input) =>
          core.addTool(input).pipe(Effect.flatMap(persist)),

        updateTool: (name, patch) =>
          core.updateTool(name, patch).pipe(Effect.flatMap(persist)),

        deleteTool: (name) =>
          core.deleteTool(name).pipe(Effect.tap(() => persistVoid(name))),

        removeTool: (name) =>
          core.removeTool(name).pipe(Effect.tap(() => persistVoid(name))),

        enableTool: (name) =>
          core.enableTool(name).pipe(Effect.flatMap(persist)),

        disableTool: (name) =>
          core.disableTool(name).pipe(Effect.flatMap(persist)),

        loadFromDirectory,
        saveToDirectory,
      };

      return service;
    }),
  );
}

// ---------------------------------------------------------------------------
// Pre-built layer constant (uses a fresh temp dir per layer evaluation)
// ---------------------------------------------------------------------------

/**
 * A ready-made `ToolRegistry` Layer for use in tests and default setups.
 * Uses a fresh temporary directory per layer evaluation so test suites
 * do not share on-disk state.
 */
export const ToolRegistryLive: Layer.Layer<ToolRegistry> = makeToolRegistryLive();
