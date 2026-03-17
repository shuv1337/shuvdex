/**
 * @codex-fleet/tool-registry
 *
 * File-backed CRUD registry for fleet tool definitions.
 *
 * Provides:
 * - `ToolRegistry`            – Context.Tag for the service
 * - `makeToolRegistryLive`    – Layer factory (takes a `toolsDir` path)
 * - `ToolRegistryTest`        – In-memory layer for testing (no disk I/O)
 * - `MockToolStore`           – Ref tag for pre-populating the test store
 * - Schema types: `ToolDefinition`, `ToolParam`, `ToolParamType`
 * - Input types: `CreateToolInput`, `UpdateToolInput`, `ListToolsFilter`
 * - Errors: `ToolNotFound`, `ToolAlreadyExists`, `CannotRemoveBuiltIn`,
 *            `ToolValidationError`, `ToolRegistryIOError`
 */

// ---- Schema types ----
export {
  ToolDefinition,
  ToolParam,
  ToolParamType,
  ToolParamItems,
} from "./schema.js";

// ---- Service interface & tag ----
export type {
  ToolRegistryService,
  CreateToolInput,
  UpdateToolInput,
  ListToolsFilter,
} from "./types.js";
export { ToolRegistry } from "./types.js";

// ---- Errors ----
export {
  ToolNotFound,
  ToolAlreadyExists,
  CannotRemoveBuiltIn,
  ToolValidationError,
  ToolRegistryIOError,
} from "./errors.js";
export type { ToolRegistryError } from "./errors.js";

// ---- Live layer ----
export { makeToolRegistryLive, ToolRegistryLive } from "./live.js";

// ---- Test layer ----
export { ToolRegistryTest, MockToolStore } from "./test.js";
