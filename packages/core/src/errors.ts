/**
 * Typed errors for configuration loading and validation.
 */
import { Data } from "effect";

/**
 * Error returned when the configuration file cannot be found at the specified path.
 */
export class ConfigNotFound extends Data.TaggedError("ConfigNotFound")<{
  readonly path: string;
}> {
  get message(): string {
    return `Configuration file not found: ${this.path}`;
  }
}

/**
 * Error returned when the configuration file cannot be parsed as valid YAML.
 */
export class ConfigParseError extends Data.TaggedError("ConfigParseError")<{
  readonly path: string;
  readonly cause: unknown;
}> {
  get message(): string {
    return `Failed to parse configuration file: ${this.path}`;
  }
}

/**
 * Error returned when host configuration entries fail schema validation.
 * Contains the detailed parse error with field paths.
 */
export class ConfigValidationError extends Data.TaggedError(
  "ConfigValidationError",
)<{
  readonly path: string;
  readonly issues: string;
}> {
  get message(): string {
    return `Invalid configuration in ${this.path}:\n${this.issues}`;
  }
}

/**
 * Error returned when a requested host is not found in the registry.
 */
export class HostNotFound extends Data.TaggedError("HostNotFound")<{
  readonly name: string;
}> {
  get message(): string {
    return `Host not found in registry: ${this.name}`;
  }
}

export type ConfigError =
  | ConfigNotFound
  | ConfigParseError
  | ConfigValidationError;
