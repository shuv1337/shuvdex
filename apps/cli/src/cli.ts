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
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { runStatus, formatTable, formatJson } from "./commands/status.js";
import {
  runPull,
  formatPullTable,
  formatPullJson,
} from "./commands/pull.js";
import {
  runSync,
  formatSyncTable,
  formatSyncJson,
} from "./commands/sync.js";

/**
 * Default config path if not specified.
 */
const DEFAULT_CONFIG_PATH = "fleet.yaml";

/**
 * Default skills repo path on remote hosts.
 */
const DEFAULT_REPO_PATH = "~/repos/shuvbot-skills";

/**
 * Parse CLI arguments into a structured command object.
 */
export interface ParsedArgs {
  readonly command: string | undefined;
  readonly flags: {
    readonly json: boolean;
    readonly help: boolean;
    readonly config: string;
    readonly repo: string;
  };
  readonly positional: ReadonlyArray<string>;
}

export const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  let command: string | undefined;
  let json = false;
  let help = false;
  let config = DEFAULT_CONFIG_PATH;
  let repo = DEFAULT_REPO_PATH;
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
    } else if (arg === "--repo" || arg === "-r") {
      i++;
      repo = args[i] ?? DEFAULT_REPO_PATH;
    } else if (!arg.startsWith("-") && command === undefined) {
      command = arg;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  return { command, flags: { json, help, config, repo }, positional };
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
 * Show pull command help text.
 */
export const pullHelp = (): string =>
  `Usage: fleet pull [hosts...] [options]

Pull latest changes from the remote origin on specified hosts.
If no hosts are specified, pulls on all configured hosts.

Arguments:
  hosts                Host names to pull on (default: all)

Options:
  --json               Output as JSON
  --repo, -r <path>    Path to git repo on remote hosts (default: ~/repos/shuvbot-skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts pulled successfully
  1  All hosts failed
  2  Partial success (some hosts succeeded, some failed)
`;

/**
 * Show sync command help text.
 */
export const syncHelp = (): string =>
  `Usage: fleet sync <skill> [hosts...] [options]

Sync a skill from local to remote hosts. Validates that the
skill exists locally before attempting any SSH connections.

Arguments:
  skill                Skill name to sync (required)
  hosts                Host names to sync to (default: all)

Options:
  --json               Output as JSON
  --repo, -r <path>    Path to skills repo on remote hosts (default: ~/repos/shuvbot-skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts synced successfully
  1  All hosts failed or skill missing
  2  Partial success (some hosts succeeded, some failed)
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

      case "pull": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(pullHelp()));
          return 0;
        }
        return yield* runPullCommand(parsed);
      }

      case "sync": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(syncHelp()));
          return 0;
        }
        return yield* runSyncCommand(parsed);
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

/**
 * Execute the pull subcommand end-to-end.
 *
 * Exit codes:
 * - 0: All hosts pulled successfully
 * - 1: All hosts failed or config error
 * - 2: Partial success
 */
const runPullCommand = (
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

    // Build live layer: SSH + Telemetry + GitOps
    const liveLayer = Layer.provideMerge(
      GitOpsLive,
      Layer.merge(SshExecutorLive, TelemetryLive),
    );

    // Host filter from positional args (empty = all hosts)
    const filterHosts =
      parsed.positional.length > 0 ? parsed.positional : undefined;

    const result = yield* runPull(
      registry,
      parsed.flags.repo,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatPullJson(result)
      : formatPullTable(result);

    yield* Effect.sync(() => process.stdout.write(output + "\n"));

    // Exit code: 0 = all ok, 1 = all failed, 2 = partial
    if (result.allSucceeded) {
      return 0;
    }
    const okCount = result.hosts.filter((h) => h.status === "ok").length;
    return okCount > 0 ? 2 : 1;
  }).pipe(
    Effect.catchAll(() => Effect.succeed(1)),
  );

/**
 * Execute the sync subcommand end-to-end.
 *
 * The first positional argument is the skill name (required).
 * Remaining positional arguments are host names (optional filter).
 *
 * Exit codes:
 * - 0: All hosts synced successfully
 * - 1: All hosts failed, skill missing, or config error
 * - 2: Partial success
 */
const runSyncCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Skill name is the first positional arg
    const skillName = parsed.positional[0] as string | undefined;
    if (!skillName) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `Error: missing required argument: <skill>\n\n${syncHelp()}`,
        ),
      );
      return 1;
    }

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

    // Build live layer: SSH + Telemetry + GitOps + SkillOps
    const baseLiveLayer = Layer.merge(SshExecutorLive, TelemetryLive);
    const gitOpsLayer = Layer.provideMerge(GitOpsLive, baseLiveLayer);
    const liveLayer = Layer.provideMerge(SkillOpsLive, gitOpsLayer);

    // Host filter from remaining positional args (after skill name)
    const filterHosts =
      parsed.positional.length > 1
        ? parsed.positional.slice(1)
        : undefined;

    // Use the repo flag as the remote repo path. The local repo path
    // is the same path resolved relative to the current working directory
    // (or if it starts with ~/ it's a home-relative path).
    const localRepoPath = parsed.flags.repo.startsWith("~/")
      ? `${process.env.HOME}${parsed.flags.repo.slice(1)}`
      : parsed.flags.repo;

    const result = yield* runSync(
      registry,
      skillName,
      localRepoPath,
      parsed.flags.repo,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatSyncJson(result)
      : formatSyncTable(result);

    yield* Effect.sync(() => process.stdout.write(output + "\n"));

    // Exit code: 0 = all ok, 1 = all failed / skill error, 2 = partial
    if (result.skillError) {
      return 1;
    }
    if (result.allSucceeded) {
      return 0;
    }
    const okCount = result.hosts.filter((h) => h.status === "ok").length;
    return okCount > 0 ? 2 : 1;
  }).pipe(
    Effect.catchAll(() => Effect.succeed(1)),
  );
