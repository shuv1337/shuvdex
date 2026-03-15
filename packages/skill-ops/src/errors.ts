/**
 * Typed errors for skill operations.
 *
 * Uses Data.TaggedError for structured, discriminated error types
 * that are distinct from each other for pattern matching.
 */
import { Data } from "effect";

/**
 * Error returned when a skill-related command fails on a remote host.
 * Contains the raw stderr and exit code for diagnostics.
 */
export class SkillCommandFailed extends Data.TaggedError("SkillCommandFailed")<{
  readonly host: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
}> {
  get message(): string {
    return `Skill command failed on ${this.host} (exit ${this.exitCode}): ${this.stderr}`;
  }
}

/**
 * Error returned when the skill repository path does not exist
 * on the remote host.
 */
export class SkillRepoNotFound extends Data.TaggedError("SkillRepoNotFound")<{
  readonly host: string;
  readonly path: string;
}> {
  get message(): string {
    return `Skill repository not found on ${this.host}: ${this.path}`;
  }
}

/**
 * Error returned when a skill cannot be found in the local source directory
 * before attempting to sync.
 */
export class SkillNotFound extends Data.TaggedError("SkillNotFound")<{
  readonly skillName: string;
  readonly sourcePath: string;
}> {
  get message(): string {
    return `Skill "${this.skillName}" not found at ${this.sourcePath}`;
  }
}

/**
 * Error returned when skill sync (rsync/scp transfer) fails.
 * Contains the host, skill name, and underlying error details.
 */
export class SyncFailed extends Data.TaggedError("SyncFailed")<{
  readonly host: string;
  readonly skillName: string;
  readonly cause: string;
}> {
  get message(): string {
    return `Sync of skill "${this.skillName}" to ${this.host} failed: ${this.cause}`;
  }
}

/**
 * Error returned when file integrity verification fails after sync.
 * Contains the mismatched files for diagnostics.
 */
export class ChecksumMismatch extends Data.TaggedError("ChecksumMismatch")<{
  readonly host: string;
  readonly skillName: string;
  readonly mismatched: ReadonlyArray<string>;
}> {
  get message(): string {
    return `Checksum mismatch for skill "${this.skillName}" on ${this.host}: ${this.mismatched.length} file(s) differ`;
  }
}

/**
 * Error returned when skill activation or deactivation fails on a remote host.
 * Contains the host, skill name, desired operation, and underlying cause.
 */
export class ActivationFailed extends Data.TaggedError("ActivationFailed")<{
  readonly host: string;
  readonly skillName: string;
  readonly operation: "activate" | "deactivate";
  readonly cause: string;
}> {
  get message(): string {
    return `Failed to ${this.operation} skill "${this.skillName}" on ${this.host}: ${this.cause}`;
  }
}

/**
 * Error returned when drift detection itself fails (e.g., the reference host
 * is unreachable so no baseline can be established).
 */
export class DriftCheckFailed extends Data.TaggedError("DriftCheckFailed")<{
  readonly referenceHost: string;
  readonly cause: string;
}> {
  get message(): string {
    return `Drift check failed: could not get reference HEAD from ${this.referenceHost}: ${this.cause}`;
  }
}

/**
 * Union of all skill operation error types.
 */
export type SkillOpsError =
  | SkillCommandFailed
  | SkillRepoNotFound
  | SkillNotFound
  | SyncFailed
  | ChecksumMismatch
  | ActivationFailed
  | DriftCheckFailed;
