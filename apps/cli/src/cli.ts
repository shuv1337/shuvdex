/**
 * CLI entry point — parses arguments and dispatches to commands.
 *
 * Uses a minimal hand-rolled parser (no external deps like commander/yargs)
 * to keep the dependency tree small. The CLI supports:
 *
 *   fleet status [--json] [--config <path>]
 *   fleet --help
 *   fleet <command> --help
 */
import { Effect, Layer } from "effect";
import { loadConfig } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { runStatus, formatTable, formatJson } from "./commands/status.js";

/**
 * Default config path if not specified.
 */
const DEFAULT_CONFIG_PATH = "fleet.yaml";

/**
 * Parse CLI arguments into a structured command object.
 */
export interface ParsedArgs {
  readonly command: string | undefined;
  readonly flags: {
    readonly json: boolean;
    readonly help: boolean;
    readonly config: string;
  };
  readonly positional: ReadonlyArray<string>;
}

export const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  let command: string | undefined;
  let json = false;
  let help = false;
  let config = DEFAULT_CONFIG_PATH;
  const positional: Array<string> = [];

  const args = argv.slice(2); // skip node + script
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--config" || arg === "-c") {
      i++;
      config = args[i] ?? DEFAULT_CONFIG_PATH;
    } else if (!arg.startsWith("-") && command === undefined) {
      command = arg;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  return { command, flags: { json, help, config }, positional };
};

/**
 * Show main help text.
 */
export const mainHelp = (): string =>
  `Usage: fleet <command> [options]

Commands:
  status      Show all hosts with connection status
  pull        Pull latest changes on hosts
  sync        Sync a skill to hosts
  activate    Activate a skill on hosts
  deactivate  Deactivate a skill on hosts
  rollback    Checkout a specific git ref on hosts
  tag         Create a git tag on all hosts

Options:
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help
`;

/**
 * Show status command help text.
 */
export const statusHelp = (): string =>
  `Usage: fleet status [options]

Show all configured hosts with their connection status.

Options:
  --json               Output as JSON
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts online
  1  One or more hosts unreachable
`;

/**
 * Run the CLI with the given argv.
 * Returns the exit code.
 */
export const run = (
  argv: ReadonlyArray<string>,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const parsed = parseArgs(argv);

    // --help with no command
    if (parsed.flags.help && !parsed.command) {
      yield* Effect.sync(() => process.stdout.write(mainHelp()));
      return 0;
    }

    // No command given
    if (!parsed.command) {
      yield* Effect.sync(() => process.stderr.write(mainHelp()));
      return 1;
    }

    // Dispatch to command
    switch (parsed.command) {
      case "status": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(statusHelp()));
          return 0;
        }
        return yield* runStatusCommand(parsed);
      }

      default: {
        yield* Effect.sync(() =>
          process.stderr.write(
            `Unknown command: ${parsed.command}\n\n${mainHelp()}`,
          ),
        );
        return 1;
      }
    }
  });

/**
 * Execute the status subcommand end-to-end.
 */
const runStatusCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Load config
    const registry = yield* loadConfig(parsed.flags.config).pipe(
      Effect.catchAll((err) =>
        Effect.gen(function* () {
          yield* Effect.sync(() =>
            process.stderr.write(`Error: ${err.message}\n`),
          );
          return yield* Effect.fail("config-error" as const);
        }),
      ),
    );

    // Run status with live SSH + telemetry
    const liveLayer = Layer.merge(SshExecutorLive, TelemetryLive);

    const result = yield* runStatus(registry).pipe(
      Effect.provide(liveLayer),
    );

    // Format and print output
    const output = parsed.flags.json
      ? formatJson(result)
      : formatTable(result);

    yield* Effect.sync(() => process.stdout.write(output + "\n"));

    return result.allOnline ? 0 : 1;
  }).pipe(
    Effect.catchAll(() => Effect.succeed(1)),
  );
