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
 * Union of all skill operation error types.
 */
export type SkillOpsError = SkillCommandFailed | SkillRepoNotFound;
