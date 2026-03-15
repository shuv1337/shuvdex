/**
 * Types and service definitions for git operations on remote hosts.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import type { SshError } from "@codex-fleet/ssh";
import type {
  GitCommandFailed,
  NotARepository,
  MergeConflict,
  PushRejected,
  AuthError,
  TimeoutError,
  InvalidRefError,
} from "./errors.js";

/**
 * Result of a pull operation.
 */
export interface PullResult {
  /** Whether any new changes were pulled */
  readonly updated: boolean;
  /** Summary message from git pull (e.g., "Already up to date." or file list) */
  readonly summary: string;
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /** Summary message from git push */
  readonly summary: string;
}

/**
 * Git operations service interface.
 *
 * Provides read and write git operations that can be executed on remote hosts
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
  ) => Effect.Effect<string, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError>;

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
  ) => Effect.Effect<string, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError>;

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
  ) => Effect.Effect<boolean, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError>;

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
  ) => Effect.Effect<Array<string>, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError>;

  /**
   * Fetch and merge changes from the remote origin.
   *
   * Detects merge conflicts and returns them as a typed MergeConflict error
   * with the list of conflicted files. Also detects auth failures and
   * network timeouts as distinct typed errors.
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding PullResult or failing with typed error
   */
  readonly pull: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<PullResult, SshError | GitCommandFailed | NotARepository | MergeConflict | AuthError | TimeoutError>;

  /**
   * Push local commits to the remote origin.
   *
   * Detects push rejections and returns them as a typed PushRejected error.
   * Also detects auth failures and network timeouts as distinct typed errors.
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @returns Effect yielding PushResult or failing with typed error
   */
  readonly push: (
    host: HostConfig,
    repoPath: string,
  ) => Effect.Effect<PushResult, SshError | GitCommandFailed | NotARepository | PushRejected | AuthError | TimeoutError>;

  /**
   * Create a lightweight tag at the specified ref (defaults to HEAD).
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @param name - The tag name to create
   * @param ref - Optional ref to tag (defaults to HEAD)
   * @returns Effect yielding void or failing with typed error
   */
  readonly createTag: (
    host: HostConfig,
    repoPath: string,
    name: string,
    ref?: string,
  ) => Effect.Effect<void, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError | InvalidRefError>;

  /**
   * Checkout a specific branch, tag, or SHA.
   *
   * Updates the working tree and attaches HEAD for branches.
   *
   * @param host - The host configuration to connect to
   * @param repoPath - Absolute path to the git repository on the remote host
   * @param ref - The branch, tag, or SHA to checkout
   * @returns Effect yielding void or failing with typed error
   */
  readonly checkoutRef: (
    host: HostConfig,
    repoPath: string,
    ref: string,
  ) => Effect.Effect<void, SshError | GitCommandFailed | NotARepository | AuthError | TimeoutError | InvalidRefError>;
}

/**
 * Context.Tag for the GitOps service.
 */
export class GitOps extends Context.Tag("GitOps")<
  GitOps,
  GitOpsService
>() {}
