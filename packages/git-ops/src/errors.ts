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
 * Union of all git operation error types.
 */
export type GitOpsError = GitCommandFailed | MergeConflict | PushRejected;
