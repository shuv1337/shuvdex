/**
 * Service interface and Context.Tag for the tool registry.
 *
 * The ToolDefinition shape comes from `./schema.ts` (Effect Schema validated).
 */
import { Context, Effect } from "effect";
import type { ToolDefinition } from "./schema.js";
import type {
  ToolNotFound,
  ToolAlreadyExists,
  CannotRemoveBuiltIn,
  ToolValidationError,
  ToolRegistryIOError,
} from "./errors.js";

// Re-export for convenience so callers don't need to reach into schema.ts
export type { ToolDefinition } from "./schema.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Input for creating a new custom tool.
 * `builtIn`, `createdAt`, and `updatedAt` are set by the registry on create.
 */
export type CreateToolInput = Omit<ToolDefinition, "builtIn" | "createdAt" | "updatedAt">;

/**
 * Partial update for an existing tool.
 * `name`, `builtIn`, `createdAt`, and `updatedAt` are immutable / server-managed.
 */
export type UpdateToolInput = Partial<
  Omit<ToolDefinition, "name" | "builtIn" | "createdAt" | "updatedAt">
>;

/**
 * Optional filter when listing tools.
 */
export interface ListToolsFilter {
  readonly enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Tool registry service — CRUD for ToolDefinition records.
 */
export interface ToolRegistryService {
  // ----- Query -----

  /**
   * List all registered tools, optionally filtered by `enabled` state.
   * Results are sorted by name.  Never fails (returns `[]` on I/O error).
   */
  readonly listTools: (
    filter?: ListToolsFilter,
  ) => Effect.Effect<ToolDefinition[]>;

  /**
   * Get a specific tool by name.  Fails with ToolNotFound if absent.
   */
  readonly getTool: (
    name: string,
  ) => Effect.Effect<ToolDefinition, ToolNotFound>;

  // ----- Mutations -----

  /**
   * Create a new custom tool.
   * Fails if the name already exists or input fails validation.
   */
  readonly createTool: (
    input: CreateToolInput,
  ) => Effect.Effect<ToolDefinition, ToolAlreadyExists | ToolValidationError>;

  /**
   * Insert a tool verbatim (no validation / timestamp injection).
   * Intended for loading pre-validated tool definitions into the registry.
   * Fails with ToolAlreadyExists if the name already exists.
   */
  readonly addTool: (
    input: ToolDefinition,
  ) => Effect.Effect<ToolDefinition, ToolAlreadyExists>;

  /**
   * Apply a partial update to an existing tool.
   * The `name` and `builtIn` fields are immutable.
   */
  readonly updateTool: (
    name: string,
    patch: UpdateToolInput,
  ) => Effect.Effect<ToolDefinition, ToolNotFound | ToolValidationError>;

  /**
   * Delete a custom tool.
   * Fails with CannotRemoveBuiltIn for built-in tools.
   */
  readonly deleteTool: (
    name: string,
  ) => Effect.Effect<void, ToolNotFound | CannotRemoveBuiltIn>;

  /**
   * Remove a custom tool (alias for deleteTool).
   * Fails with CannotRemoveBuiltIn for built-in tools.
   */
  readonly removeTool: (
    name: string,
  ) => Effect.Effect<void, ToolNotFound | CannotRemoveBuiltIn>;

  /**
   * Set a tool's `enabled` flag to `true`.
   */
  readonly enableTool: (
    name: string,
  ) => Effect.Effect<ToolDefinition, ToolNotFound>;

  /**
   * Set a tool's `enabled` flag to `false`.
   */
  readonly disableTool: (
    name: string,
  ) => Effect.Effect<ToolDefinition, ToolNotFound>;

  // ----- Persistence -----

  /**
   * Load tool definitions from a directory.
   * Reads every `*.yaml` and `*.json` file and validates each against the ToolDefinition schema.
   * Returns the validated tools AND merges them into the in-memory store (upsert by name).
   */
  readonly loadFromDirectory: (
    dir: string,
  ) => Effect.Effect<ToolDefinition[], ToolRegistryIOError | ToolValidationError>;

  /**
   * Persist all currently registered tools to `dir` as YAML files
   * (one file per tool, named `{name}.yaml`).
   */
  readonly saveToDirectory: (
    dir: string,
  ) => Effect.Effect<void, ToolRegistryIOError>;
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

/**
 * Context.Tag for the ToolRegistry service.
 */
export class ToolRegistry extends Context.Tag("ToolRegistry")<
  ToolRegistry,
  ToolRegistryService
>() {}
