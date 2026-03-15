/**
 * Typed errors for git operations.
 *
 * Uses Data.TaggedError for structured, discriminated error types
 * that are distinct from each other for pattern matching.
 */
import { Data } from "effect";

/**
 * Error returned when a git command fails on a remote host.
 * Contains the raw stderr and exit code for diagnostics.
 */
export class GitCommandFailed extends Data.TaggedError("GitCommandFailed")<{
  readonly host: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
}> {
  get message(): string {
    return `Git command failed on ${this.host} (exit ${this.exitCode}): ${this.stderr}`;
  }
}

/**
 * Error returned when a git operation is attempted on a directory
 * that is not a git repository.
 */
export class NotARepository extends Data.TaggedError("NotARepository")<{
  readonly host: string;
  readonly path: string;
}> {
  get message(): string {
    return `Not a git repository on ${this.host}: ${this.path}`;
  }
}

/**
 * Error returned when a git pull results in merge conflicts.
 * Contains the list of conflicted files.
 */
export class MergeConflict extends Data.TaggedError("MergeConflict")<{
  readonly host: string;
  readonly files: ReadonlyArray<string>;
  readonly stderr: string;
}> {
  get message(): string {
    return `Merge conflict on ${this.host}: ${this.files.join(", ")}`;
  }
}

/**
 * Error returned when a git push is rejected by the remote.
 * Contains the rejection reason from the remote.
 */
export class PushRejected extends Data.TaggedError("PushRejected")<{
  readonly host: string;
  readonly reason: string;
  readonly stderr: string;
}> {
  get message(): string {
    return `Push rejected on ${this.host}: ${this.reason}`;
  }
}

/**
 * Error returned when a git remote operation fails due to
 * authentication failure (e.g., invalid SSH key, permission denied).
 * Distinct from network errors to allow targeted handling.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly host: string;
  readonly stderr: string;
}> {
  get message(): string {
    return `Authentication failed for git remote on ${this.host}`;
  }
}

/**
 * Error returned when a git remote operation (pull, push, fetch)
 * times out due to network issues. The local repository state
 * is not corrupted by a timeout.
 */
export class NetworkTimeout extends Data.TaggedError("NetworkTimeout")<{
  readonly host: string;
  readonly operation: string;
  readonly stderr: string;
}> {
  get message(): string {
    return `Network timeout during ${this.operation} on ${this.host}`;
  }
}

/**
 * Union of all git operation error types.
 */
export type GitOpsError =
  | GitCommandFailed
  | NotARepository
  | MergeConflict
  | PushRejected
  | AuthError
  | NetworkTimeout;
