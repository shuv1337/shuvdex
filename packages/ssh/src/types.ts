/**
 * Types and service definitions for the SSH executor.
 */
import { Context, Effect } from "effect";
import type { HostConfig } from "@shuvdex/core";
import type { ConnectionFailed, ConnectionTimeout, CommandFailed, CommandTimeout } from "./errors.js";

/**
 * Result of executing a command on a remote host.
 */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Options for executing a command on a remote host.
 */
export interface ExecuteCommandOptions {
  /**
   * Timeout in milliseconds for the SSH connection establishment only
   * (overrides host config timeout). This is passed to SSH -o ConnectTimeout
   * and does NOT affect command runtime.
   */
  readonly timeoutMs?: number;

  /**
   * Optional timeout in milliseconds for the command execution itself.
   * If set, the command process will be killed after this duration.
   * If not set (default), commands can run indefinitely once the connection
   * is established.
   */
  readonly commandTimeoutMs?: number;
}

/**
 * SSH executor service interface.
 *
 * Provides the ability to execute shell commands on remote hosts via SSH.
 * All operations return Effect values with typed errors.
 */
export interface SshExecutorService {
  /**
   * Execute a shell command on a remote host.
   *
   * @param host - The host configuration to connect to
   * @param command - The shell command to execute
   * @param options - Optional execution options (e.g., timeout override)
   * @returns Effect yielding CommandResult or failing with an SSH error
   */
  readonly executeCommand: (
    host: HostConfig,
    command: string,
    options?: ExecuteCommandOptions,
  ) => Effect.Effect<CommandResult, ConnectionFailed | ConnectionTimeout | CommandFailed | CommandTimeout>;
}

/**
 * Context.Tag for the SshExecutor service.
 */
export class SshExecutor extends Context.Tag("SshExecutor")<
  SshExecutor,
  SshExecutorService
>() {}
