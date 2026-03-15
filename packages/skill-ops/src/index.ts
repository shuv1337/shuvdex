/**
 * @codex-fleet/skill-ops
 *
 * Skill sync, activation, and drift detection for the fleet skills management system.
 *
 * Provides:
 * - `SkillOps` - Service tag for skill operations on remote hosts
 * - `SkillOpsLive` - Live layer backed by SshExecutor (requires SshExecutor in context)
 * - Typed errors: `SkillCommandFailed`, `SkillRepoNotFound`
 * - All operations traced with OTEL spans
 */

// Types and service
export type {
  SkillOpsService,
  SkillInfo,
  SkillStatus,
  SyncResult,
  VerifySyncResult,
  ActivationResult,
  DriftStatus,
  DriftDirection,
  HostDriftInfo,
  DriftReport,
} from "./types.js";
export { SkillOps } from "./types.js";

// Errors
export { SkillCommandFailed, SkillRepoNotFound, SkillNotFound, SyncFailed, ChecksumMismatch, ActivationFailed, DriftCheckFailed } from "./errors.js";
export type { SkillOpsError } from "./errors.js";

// Layers
export { SkillOpsLive, _resetLocalHashCmdCache, _buildRsyncSshCmd, _remoteHashCmd } from "./live.js";
export { SkillOpsTest } from "./test.js";
