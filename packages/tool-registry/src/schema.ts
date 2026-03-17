/**
 * Effect Schema definitions for tool registry types.
 *
 * All schemas follow the same pattern as @codex-fleet/core:
 * - Schema value (e.g. `ToolParam`) for decoding/encoding
 * - Type alias (e.g. `type ToolParam`) for TypeScript consumers
 */
import { Schema } from "effect";

/**
 * The set of primitive types a tool parameter can have.
 */
export const ToolParamType = Schema.Literal("string", "number", "boolean", "array");
export type ToolParamType = typeof ToolParamType.Type;

/**
 * Items descriptor for array-typed parameters.
 * Describes the element type when `type` is "array".
 */
export const ToolParamItems = Schema.Struct({
  type: Schema.String,
});
export type ToolParamItems = typeof ToolParamItems.Type;

/**
 * Schema for a single tool input parameter definition.
 *
 * Required fields:
 * - type: the parameter's primitive type
 *
 * Optional fields:
 * - description: human-readable description shown in the MCP tool schema
 * - optional: whether the parameter may be omitted by callers (default: required)
 * - items: element type descriptor for array parameters
 * - enum: allowlist of string values (for string-typed enum parameters)
 * - default: default value when the parameter is omitted
 */
export const ToolParam = Schema.Struct({
  type: ToolParamType,
  description: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
  items: Schema.optional(ToolParamItems),
  enum: Schema.optional(Schema.Array(Schema.String)),
  default: Schema.optional(Schema.Unknown),
});
export type ToolParam = typeof ToolParam.Type;

/**
 * Schema for a complete tool definition.
 *
 * Required fields:
 * - name: unique tool identifier (e.g. "fleet_status")
 * - description: human-readable tool description shown in the MCP listing
 * - enabled: whether the tool is currently registered and callable
 * - builtIn: true for core fleet tools; false for custom/user-added tools
 * - category: logical grouping key (e.g. "fleet", "git", "custom")
 * - schema: map of parameter names to their ToolParam definitions
 *
 * Optional fields:
 * - handler: module reference for custom tool handlers
 * - createdAt: ISO 8601 timestamp when the definition was first created
 * - updatedAt: ISO 8601 timestamp of the last modification
 */
export const ToolDefinition = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  builtIn: Schema.Boolean,
  category: Schema.NonEmptyString,
  schema: Schema.Record({ key: Schema.String, value: ToolParam }),
  handler: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type ToolDefinition = typeof ToolDefinition.Type;
