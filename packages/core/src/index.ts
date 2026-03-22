/**
 * @shuvdex/core
 *
 * Shared types, schemas, and configuration for the fleet skills management system.
 */

// Schema definitions
export {
  ConnectionType,
  HostConfig,
  HostRegistryConfig,
} from "./schema.js";

// Host registry
export { HostRegistry } from "./registry.js";

// Config loader
export { loadConfig } from "./config-loader.js";

// Typed errors
export {
  ConfigNotFound,
  ConfigParseError,
  ConfigValidationError,
  HostNotFound,
} from "./errors.js";
export type { ConfigError } from "./errors.js";
