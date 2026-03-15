/**
 * Types and service definitions for skill operations on remote hosts.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import type { SshError } from "@codex-fleet/ssh";
import type { SkillCommandFailed, SkillRepoNotFound, SkillNotFound, SyncFailed, ChecksumMismatch } from "./errors.js";

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
}

/**
 * Context.Tag for the SkillOps service.
 */
export class SkillOps extends Context.Tag("SkillOps")<
  SkillOps,
  SkillOpsService
>() {}
