/**
 * @codex-fleet/git-ops
 *
 * Git operations on remote hosts for the fleet skills management system.
 *
 * Provides:
 * - `GitOps` - Service tag for git operations on remote repositories
 * - `GitOpsLive` - Live layer backed by SshExecutor (requires SshExecutor in context)
 * - Typed errors: `GitCommandFailed`
 * - All operations traced with OTEL spans
 */

// Types and service
export type { GitOpsService } from "./types.js";
export { GitOps } from "./types.js";

// Errors
export { GitCommandFailed } from "./errors.js";
export type { GitOpsError } from "./errors.js";

// Layers
export { GitOpsLive } from "./live.js";
export { GitOpsTest } from "./test.js";
