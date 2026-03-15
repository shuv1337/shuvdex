/**
 * @codex-fleet/git-ops
 *
 * Git operations on remote hosts for the fleet skills management system.
 *
 * Provides:
 * - `GitOps` - Service tag for git operations on remote repositories
 * - `GitOpsLive` - Live layer backed by SshExecutor (requires SshExecutor in context)
 * - Typed errors: `GitCommandFailed`, `MergeConflict`, `PushRejected`
 * - All operations traced with OTEL spans
 */

// Types and service
export type { GitOpsService, PullResult, PushResult } from "./types.js";
export { GitOps } from "./types.js";

// Errors
export {
  GitCommandFailed,
  NotARepository,
  MergeConflict,
  PushRejected,
  AuthError,
  NetworkTimeout,
} from "./errors.js";
export type { GitOpsError } from "./errors.js";

// Layers
export { GitOpsLive } from "./live.js";
export { GitOpsTest } from "./test.js";
