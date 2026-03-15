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
 * Union of all git operation error types.
 */
export type GitOpsError = GitCommandFailed;
