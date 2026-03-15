/**
 * Types and service definitions for skill operations on remote hosts.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import type { SshError } from "@codex-fleet/ssh";
import type { SkillCommandFailed, SkillRepoNotFound, SkillNotFound, SyncFailed, ChecksumMismatch, ActivationFailed, DriftCheckFailed } from "./errors.js";

/**
 * Status of a skill on a remote host.
 */
export type SkillStatus = "active" | "inactive";

/**
 * Information about a skill discovered in a repository.
 */
export interface SkillInfo {
  /** Skill directory name (e.g., "my-skill") */
  readonly name: string;
  /** Whether the skill is active (symlink present) or inactive */
  readonly status: SkillStatus;
}

/**
 * Result of syncing a skill to a single host.
 */
export interface SyncResult {
  /** Target host name */
  readonly host: string;
  /** Skill that was synced */
  readonly skillName: string;
  /** Number of files transferred */
  readonly filesTransferred: number;
  /** Whether the sync completed successfully */
  readonly success: boolean;
}

/**
 * Result of verifying file integrity after sync.
 */
export interface VerifySyncResult {
  /** Target host name */
  readonly host: string;
  /** Skill that was verified */
  readonly skillName: string;
  /** Whether all checksums match */
  readonly match: boolean;
  /** Total number of files checked */
  readonly filesChecked: number;
  /** Files that have mismatched checksums (empty if all match) */
  readonly mismatched: ReadonlyArray<string>;
}

/**
 * Result of activating or deactivating a skill on a remote host.
 */
export interface ActivationResult {
  /** Target host name */
  readonly host: string;
  /** Skill that was activated or deactivated */
  readonly skillName: string;
  /** Whether the operation was a no-op (already in desired state) */
  readonly alreadyInState: boolean;
  /** Current status after the operation */
  readonly status: SkillStatus;
}

/**
 * Drift status of a host relative to the reference commit.
 */
export type DriftStatus = "in_sync" | "drifted" | "unreachable";

/**
 * Drift direction relative to the reference commit.
 * - "ahead" means the host has commits beyond the reference
 * - "behind" means the host is missing commits that are in the reference
 * - "diverged" means the host has both commits ahead and behind (branches diverged)
 */
export type DriftDirection = "ahead" | "behind" | "diverged";

/**
 * Per-host drift information.
 */
export interface HostDriftInfo {
  /** Host name */
  readonly host: string;
  /** Whether the host is in sync, drifted, or unreachable */
  readonly status: DriftStatus;
  /** Current HEAD SHA on the host (undefined if unreachable) */
  readonly sha?: string;
  /** Drift direction relative to reference (only present when drifted) */
  readonly direction?: DriftDirection;
  /** Number of commits the host is ahead of reference (only present when drifted) */
  readonly ahead?: number;
  /** Number of commits the host is behind reference (only present when drifted) */
  readonly behind?: number;
  /** Error message if the host is unreachable */
  readonly error?: string;
}

/**
 * Overall drift report across all hosts.
 */
export interface DriftReport {
  /** The reference commit SHA that all hosts are compared against */
  readonly referenceSha: string;
  /** The host name used as the reference source */
  readonly referenceHost: string;
  /** Per-host drift information */
  readonly hosts: ReadonlyArray<HostDriftInfo>;
  /** Whether any hosts are drifted */
  readonly hasDrift: boolean;
  /** Count of drifted hosts */
  readonly driftedCount: number;
  /** Count of in-sync hosts */
  readonly inSyncCount: number;
  /** Count of unreachable hosts */
  readonly unreachableCount: number;
}

/**
 * Skill operations service interface.
 *
 * Provides discovery, sync, and status operations for skills on remote hosts.
 * All operations return Effect values with typed errors and
 * are traced with OTEL spans.
 */
export interface SkillOpsService {
  /**
   * List all skill directories in a skill repository on a remote host.
   *
   * Enumerates top-level directories in `repoPath`, filtering out
   * non-skill directories (e.g., `.git`, `node_modules`). Returns
   * an empty array for empty repositories (does not error).
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the skills repository on the remote host
   * @param activeDir - Absolute path to the active skills directory (where symlinks live)
   * @returns Effect yielding an array of SkillInfo objects
   */
  readonly listSkills: (
    host: HostConfig,
    repoPath: string,
    activeDir: string,
  ) => Effect.Effect<
    Array<SkillInfo>,
    SshError | SkillCommandFailed | SkillRepoNotFound
  >;

  /**
   * Get the activation status of a single skill on a remote host.
   *
   * Checks whether a symlink for the skill exists in `activeDir`.
   * Broken symlinks are reported as inactive.
   *
   * @param host - The host configuration to connect to
   * @param skillName - The name of the skill to check
   * @param activeDir - Absolute path to the active skills directory
   * @returns Effect yielding the skill's status ("active" or "inactive")
   */
  readonly getSkillStatus: (
    host: HostConfig,
    skillName: string,
    activeDir: string,
  ) => Effect.Effect<
    SkillStatus,
    SshError | SkillCommandFailed
  >;

  /**
   * Sync a skill directory from a local source to a remote host.
   *
   * Transfers all files in the skill directory, preserving directory
   * structure and file permissions (including executable scripts).
   * Uses rsync when available, falls back to tar+ssh.
   *
   * @param host - The target host configuration
   * @param skillName - The name of the skill to sync
   * @param localRepoPath - Local path to the skills repository
   * @param remoteRepoPath - Remote path to the skills repository on the host
   * @returns Effect yielding a SyncResult
   */
  readonly syncSkill: (
    host: HostConfig,
    skillName: string,
    localRepoPath: string,
    remoteRepoPath: string,
  ) => Effect.Effect<
    SyncResult,
    SshError | SkillNotFound | SyncFailed
  >;

  /**
   * Verify file integrity after a skill sync by comparing checksums.
   *
   * Generates checksums (sha256) for all files in the skill directory
   * on both local and remote hosts, and compares them to ensure the
   * sync was complete and accurate.
   *
   * @param host - The target host configuration
   * @param skillName - The name of the skill to verify
   * @param localRepoPath - Local path to the skills repository
   * @param remoteRepoPath - Remote path to the skills repository on the host
   * @returns Effect yielding a VerifySyncResult
   */
  readonly verifySync: (
    host: HostConfig,
    skillName: string,
    localRepoPath: string,
    remoteRepoPath: string,
  ) => Effect.Effect<
    VerifySyncResult,
    SshError | SkillCommandFailed | ChecksumMismatch
  >;

  /**
   * Activate a skill on a remote host by creating a symlink in the active
   * skills directory that points to the skill's path in the repository.
   *
   * Idempotent: if the skill is already active (symlink already exists and
   * points to the correct target), the operation succeeds without error.
   *
   * @param host - The host configuration to connect to
   * @param skillName - The name of the skill to activate
   * @param repoPath - Absolute path to the skills repository on the remote host
   * @param activeDir - Absolute path to the active skills directory (where symlinks live)
   * @returns Effect yielding an ActivationResult
   */
  readonly activateSkill: (
    host: HostConfig,
    skillName: string,
    repoPath: string,
    activeDir: string,
  ) => Effect.Effect<
    ActivationResult,
    SshError | SkillCommandFailed | ActivationFailed
  >;

  /**
   * Deactivate a skill on a remote host by removing its symlink from the
   * active skills directory. The actual skill files in the repository
   * remain intact.
   *
   * Idempotent: if the skill is already inactive (no symlink exists),
   * the operation succeeds without error.
   *
   * @param host - The host configuration to connect to
   * @param skillName - The name of the skill to deactivate
   * @param activeDir - Absolute path to the active skills directory (where symlinks live)
   * @returns Effect yielding an ActivationResult
   */
  readonly deactivateSkill: (
    host: HostConfig,
    skillName: string,
    activeDir: string,
  ) => Effect.Effect<
    ActivationResult,
    SshError | SkillCommandFailed | ActivationFailed
  >;

  /**
   * Check for drift across multiple hosts by comparing their HEAD commits
   * to a reference host. Queries HEAD from all configured hosts in parallel,
   * compares each to the reference, and reports which hosts are drifted.
   *
   * An unreachable host does NOT cause the entire operation to fail —
   * it is reported as "unreachable" in the drift report.
   *
   * @param hosts - Array of [name, config] tuples for all hosts to check
   * @param repoPath - Absolute path to the git repository on each host
   * @param referenceHostName - Name of the host to use as the reference (its HEAD is the "truth")
   * @returns Effect yielding a DriftReport with per-host drift status
   */
  readonly checkDrift: (
    hosts: ReadonlyArray<readonly [string, HostConfig]>,
    repoPath: string,
    referenceHostName: string,
  ) => Effect.Effect<
    DriftReport,
    DriftCheckFailed
  >;
}

/**
 * Context.Tag for the SkillOps service.
 */
export class SkillOps extends Context.Tag("SkillOps")<
  SkillOps,
  SkillOpsService
>() {}
