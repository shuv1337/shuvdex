/**
 * Typed errors for the tool registry.
 *
 * Uses Data.TaggedError for structured, discriminated error types
 * that are distinct from each other for pattern matching.
 */
import { Data } from "effect";

/**
 * Error returned when a requested tool is not found in the registry.
 */
export class ToolNotFound extends Data.TaggedError("ToolNotFound")<{
  readonly name: string;
}> {
  get message(): string {
    return `Tool not found: ${this.name}`;
  }
}

/**
 * Error returned when trying to create a tool with a name that already exists.
 */
export class ToolAlreadyExists extends Data.TaggedError("ToolAlreadyExists")<{
  readonly name: string;
}> {
  get message(): string {
    return `Tool already exists: ${this.name}`;
  }
}

/**
 * Error returned when trying to delete a built-in tool.
 */
export class CannotRemoveBuiltIn extends Data.TaggedError("CannotRemoveBuiltIn")<{
  readonly name: string;
}> {
  get message(): string {
    return `Cannot remove built-in tool: ${this.name}`;
  }
}

/**
 * Error returned when tool input fails schema / business-rule validation.
 */
export class ToolValidationError extends Data.TaggedError("ToolValidationError")<{
  readonly name?: string;
  readonly issues: string;
}> {
  get message(): string {
    if (this.name) {
      return `Tool validation error in ${this.name}: ${this.issues}`;
    }
    return `Tool validation error: ${this.issues}`;
  }
}

/**
 * Error returned when reading from or writing to the tool registry
 * directory on the local file system fails.
 */
export class ToolRegistryIOError extends Data.TaggedError("ToolRegistryIOError")<{
  readonly path: string;
  readonly cause: string;
}> {
  get message(): string {
    return `Tool registry I/O error at ${this.path}: ${this.cause}`;
  }
}

/**
 * Union of all tool registry error types.
 */
export type ToolRegistryError =
  | ToolNotFound
  | ToolAlreadyExists
  | CannotRemoveBuiltIn
  | ToolValidationError
  | ToolRegistryIOError;
