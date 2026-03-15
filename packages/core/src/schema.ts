/**
 * Effect Schema definitions for host configuration.
 */
import { Schema } from "effect";

/**
 * Connection type for a host - either SSH or local execution.
 */
export const ConnectionType = Schema.Literal("ssh", "local");
export type ConnectionType = typeof ConnectionType.Type;

/**
 * Schema for a single host configuration entry.
 *
 * Required fields:
 * - hostname: The hostname or IP address
 *
 * Optional fields with defaults:
 * - connectionType: "ssh" | "local" (default: "ssh")
 * - port: SSH port number (default: 22)
 * - user: SSH username (default: current user from env)
 * - keyPath: Path to SSH private key (optional)
 * - timeout: Connection timeout in seconds (default: 30)
 */
export const HostConfig = Schema.Struct({
  hostname: Schema.NonEmptyString,
  connectionType: Schema.optionalWith(ConnectionType, {
    default: () => "ssh" as const,
  }),
  port: Schema.optionalWith(
    Schema.Int.pipe(Schema.between(1, 65535)),
    { default: () => 22 },
  ),
  user: Schema.optional(Schema.NonEmptyString),
  keyPath: Schema.optional(Schema.NonEmptyString),
  timeout: Schema.optionalWith(
    Schema.Int.pipe(Schema.positive()),
    { default: () => 30 },
  ),
});

export type HostConfig = typeof HostConfig.Type;

/**
 * Schema for the full host registry configuration file.
 * Maps host names to their configuration.
 */
export const HostRegistryConfig = Schema.Record({
  key: Schema.NonEmptyString,
  value: HostConfig,
});

export type HostRegistryConfig = typeof HostRegistryConfig.Type;
