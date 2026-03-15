/**
 * @codex-fleet/ssh
 *
 * SSH command execution service for the fleet skills management system.
 *
 * Provides:
 * - `SshExecutor` - Service tag for SSH command execution
 * - `SshExecutorLive` - Live layer using system SSH via node:child_process
 * - `SshExecutorTest` - Test layer with configurable mock responses
 * - Typed errors: `ConnectionFailed`, `ConnectionTimeout`, `CommandFailed`
 * - All operations traced with OTEL spans
 */

// Types and service
export type { CommandResult, ExecuteCommandOptions, SshExecutorService } from "./types.js";
export { SshExecutor } from "./types.js";

// Errors
export { ConnectionFailed, ConnectionTimeout, CommandFailed } from "./errors.js";
export type { SshError } from "./errors.js";

// Layers
export { SshExecutorLive } from "./live.js";
export {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
} from "./test.js";
export type { MockResponse, RecordedCall } from "./test.js";
