/**
 * Types and service definitions for git operations on remote hosts.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import type { SshError } from "@codex-fleet/ssh";
import type { GitCommandFailed } from "./errors.js";

/**
 * Git operations service interface.
 *
 * Provides read-only git operations that can be executed on remote hosts
 * via SSH. All operations return Effect values with typed errors and
 * are traced with OTEL spans.
 */
export interface GitOpsService {
  /**
   * Get the current HEAD commit SHA (40-char hex string).
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding a 40-character hex SHA string
   */
  readonly getHead: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<string, SshError | GitCommandFailed>;

  /**
   * Get the current branch name, or "HEAD" if in detached HEAD state.
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding the branch name or "HEAD" for detached state
   */
  readonly getBranch: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<string, SshError | GitCommandFailed>;

  /**
   * Check whether the repository has uncommitted changes
   * (staged, unstaged, or untracked files).
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding true if there are uncommitted changes
   */
  readonly isDirty: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<boolean, SshError | GitCommandFailed>;

  /**
   * List all tag names in the repository.
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding an array of tag name strings (empty if no tags)
   */
  readonly listTags: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<Array<string>, SshError | GitCommandFailed>;
}

/**
 * Context.Tag for the GitOps service.
 */
export class GitOps extends Context.Tag("GitOps")<
  GitOps,
  GitOpsService
>() {}
