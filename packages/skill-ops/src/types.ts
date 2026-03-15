/**
 * Types and service definitions for skill operations on remote hosts.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import type { SshError } from "@codex-fleet/ssh";
import type { SkillCommandFailed, SkillRepoNotFound } from "./errors.js";

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
 * Skill operations service interface.
 *
 * Provides discovery and status operations for skills on remote hosts.
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
}

/**
 * Context.Tag for the SkillOps service.
 */
export class SkillOps extends Context.Tag("SkillOps")<
  SkillOps,
  SkillOpsService
>() {}
