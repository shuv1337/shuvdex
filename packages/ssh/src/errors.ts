/**
 * Typed errors for SSH operations.
 *
 * Uses Data.TaggedError for structured, discriminated error types
 * that are distinct from each other for pattern matching.
 */
import { Data } from "effect";

/**
 * Error returned when the SSH connection to a host fails.
 * This includes network errors, DNS resolution failures, and auth failures.
 */
export class ConnectionFailed extends Data.TaggedError("ConnectionFailed")<{
  readonly host: string;
  readonly cause: unknown;
}> {
  get message(): string {
    return `SSH connection failed to ${this.host}: ${this.cause}`;
  }
}

/**
 * Error returned when the SSH connection times out.
 * Distinct from ConnectionFailed to allow specific handling of timeout cases.
 */
export class ConnectionTimeout extends Data.TaggedError("ConnectionTimeout")<{
  readonly host: string;
  readonly timeoutMs: number;
}> {
  get message(): string {
    return `SSH connection to ${this.host} timed out after ${this.timeoutMs}ms`;
  }
}

/**
 * Error returned when a command executes but returns a non-zero exit code.
 * Distinct from connection errors - the SSH connection succeeded,
 * but the remote command itself failed.
 */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly host: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  get message(): string {
    return `Command failed on ${this.host} with exit code ${this.exitCode}: ${this.stderr}`;
  }
}

/**
 * Error returned when a command execution exceeds the configured command timeout.
 * Distinct from ConnectionTimeout - the SSH connection succeeded, but the
 * remote command took too long to complete.
 */
export class CommandTimeout extends Data.TaggedError("CommandTimeout")<{
  readonly host: string;
  readonly command: string;
  readonly timeoutMs: number;
}> {
  get message(): string {
    return `Command on ${this.host} timed out after ${this.timeoutMs}ms: ${this.command}`;
  }
}

/**
 * Union of all SSH error types for use in Effect error channels.
 */
export type SshError = ConnectionFailed | ConnectionTimeout | CommandFailed | CommandTimeout;
