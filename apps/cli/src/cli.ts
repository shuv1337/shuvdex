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
import {
  runActivate,
  formatActivateTable,
  formatActivateJson,
} from "./commands/activate.js";
import {
  runDeactivate,
  formatDeactivateTable,
  formatDeactivateJson,
} from "./commands/deactivate.js";
import {
  runRollback,
  formatRollbackTable,
  formatRollbackJson,
} from "./commands/rollback.js";
import {
  runTag,
  formatTagTable,
  formatTagJson,
} from "./commands/tag.js";

/**
 * Default config path if not specified.
 */
const DEFAULT_CONFIG_PATH = "fleet.yaml";

/**
 * Default skills repo path on remote hosts.
 */
const DEFAULT_REPO_PATH = "~/repos/shuvbot-skills";

/**
 * Default active skills directory on remote hosts.
 */
const DEFAULT_ACTIVE_DIR = "~/.codex/skills";

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
    readonly activeDir: string;
  };
  readonly positional: ReadonlyArray<string>;
}

export const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  let command: string | undefined;
  let json = false;
  let help = false;
  let config = DEFAULT_CONFIG_PATH;
  let repo = DEFAULT_REPO_PATH;
  let activeDir = DEFAULT_ACTIVE_DIR;
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
    } else if (arg === "--active-dir" || arg === "-a") {
      i++;
      activeDir = args[i] ?? DEFAULT_ACTIVE_DIR;
    } else if (!arg.startsWith("-") && command === undefined) {
      command = arg;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  return { command, flags: { json, help, config, repo, activeDir }, positional };
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
 * Show activate command help text.
 */
export const activateHelp = (): string =>
  `Usage: fleet activate <skill> [hosts...] [options]

Activate a skill on remote hosts by creating a symlink in the
active skills directory. If the skill is already active, it
reports "already active" and exits successfully.

Arguments:
  skill                Skill name to activate (required)
  hosts                Host names to activate on (default: all)

Options:
  --json               Output as JSON
  --repo, -r <path>    Path to skills repo on remote hosts (default: ~/repos/shuvbot-skills)
  --active-dir, -a <path>  Path to active skills directory (default: ~/.codex/skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts activated successfully (or already active)
  1  All hosts failed or missing skill argument
  2  Partial success (some hosts succeeded, some failed)
`;

/**
 * Show deactivate command help text.
 */
export const deactivateHelp = (): string =>
  `Usage: fleet deactivate <skill> [hosts...] [options]

Deactivate a skill on remote hosts by removing the symlink
from the active skills directory. The actual skill files in
the repository remain intact. If the skill is not active, it
reports "not active" and exits successfully.

Arguments:
  skill                Skill name to deactivate (required)
  hosts                Host names to deactivate on (default: all)

Options:
  --json               Output as JSON
  --active-dir, -a <path>  Path to active skills directory (default: ~/.codex/skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts deactivated successfully (or not active)
  1  All hosts failed or missing skill argument
  2  Partial success (some hosts succeeded, some failed)
`;

/**
 * Show rollback command help text.
 */
export const rollbackHelp = (): string =>
  `Usage: fleet rollback <ref> [hosts...] [options]

Checkout a specific git reference (branch, tag, or SHA) on remote hosts.
If no hosts are specified, rolls back all configured hosts.

Arguments:
  ref                  Git reference to checkout (required)
  hosts                Host names to rollback on (default: all)

Options:
  --json               Output as JSON
  --repo, -r <path>    Path to git repo on remote hosts (default: ~/repos/shuvbot-skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts rolled back successfully
  1  All hosts failed
  2  Partial success (some hosts succeeded, some failed)
`;

/**
 * Show tag command help text.
 */
export const tagHelp = (): string =>
  `Usage: fleet tag <name> [hosts...] [options]

Create a git tag at the current HEAD on remote hosts.
If no hosts are specified, tags all configured hosts.

Arguments:
  name                 Tag name to create (required)
  hosts                Host names to tag on (default: all)

Options:
  --json               Output as JSON
  --repo, -r <path>    Path to git repo on remote hosts (default: ~/repos/shuvbot-skills)
  --config, -c <path>  Path to fleet config file (default: fleet.yaml)
  --help, -h           Show help

Exit codes:
  0  All hosts tagged successfully
  1  All hosts failed or duplicate tag
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

      case "activate": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(activateHelp()));
          return 0;
        }
        return yield* runActivateCommand(parsed);
      }

      case "deactivate": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(deactivateHelp()));
          return 0;
        }
        return yield* runDeactivateCommand(parsed);
      }

      case "rollback": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(rollbackHelp()));
          return 0;
        }
        return yield* runRollbackCommand(parsed);
      }

      case "tag": {
        if (parsed.flags.help) {
          yield* Effect.sync(() => process.stdout.write(tagHelp()));
          return 0;
        }
        return yield* runTagCommand(parsed);
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

/**
 * Execute the activate subcommand end-to-end.
 *
 * The first positional argument is the skill name (required).
 * Remaining positional arguments are host names (optional filter).
 *
 * Exit codes:
 * - 0: All hosts activated successfully (or already active)
 * - 1: All hosts failed or missing skill argument
 * - 2: Partial success
 */
const runActivateCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Skill name is the first positional arg
    const skillName = parsed.positional[0] as string | undefined;
    if (!skillName) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `Error: missing required argument: <skill>\n\n${activateHelp()}`,
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

    const result = yield* runActivate(
      registry,
      skillName,
      parsed.flags.repo,
      parsed.flags.activeDir,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatActivateJson(result)
      : formatActivateTable(result);

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
 * Execute the deactivate subcommand end-to-end.
 *
 * The first positional argument is the skill name (required).
 * Remaining positional arguments are host names (optional filter).
 *
 * Exit codes:
 * - 0: All hosts deactivated successfully (or already inactive)
 * - 1: All hosts failed or missing skill argument
 * - 2: Partial success
 */
const runDeactivateCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Skill name is the first positional arg
    const skillName = parsed.positional[0] as string | undefined;
    if (!skillName) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `Error: missing required argument: <skill>\n\n${deactivateHelp()}`,
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

    const result = yield* runDeactivate(
      registry,
      skillName,
      parsed.flags.activeDir,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatDeactivateJson(result)
      : formatDeactivateTable(result);

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
 * Execute the rollback subcommand end-to-end.
 *
 * The first positional argument is the git ref (required).
 * Remaining positional arguments are host names (optional filter).
 *
 * Exit codes:
 * - 0: All hosts rolled back successfully
 * - 1: All hosts failed or missing ref argument
 * - 2: Partial success
 */
const runRollbackCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Ref is the first positional arg
    const ref = parsed.positional[0] as string | undefined;
    if (!ref) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `Error: missing required argument: <ref>\n\n${rollbackHelp()}`,
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

    // Build live layer: SSH + Telemetry + GitOps
    const liveLayer = Layer.provideMerge(
      GitOpsLive,
      Layer.merge(SshExecutorLive, TelemetryLive),
    );

    // Host filter from remaining positional args (after ref)
    const filterHosts =
      parsed.positional.length > 1
        ? parsed.positional.slice(1)
        : undefined;

    const result = yield* runRollback(
      registry,
      ref,
      parsed.flags.repo,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatRollbackJson(result)
      : formatRollbackTable(result);

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
 * Execute the tag subcommand end-to-end.
 *
 * The first positional argument is the tag name (required).
 * Remaining positional arguments are host names (optional filter).
 *
 * Exit codes:
 * - 0: All hosts tagged successfully
 * - 1: All hosts failed or missing tag name argument
 * - 2: Partial success
 */
const runTagCommand = (
  parsed: ParsedArgs,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    // Tag name is the first positional arg
    const tagName = parsed.positional[0] as string | undefined;
    if (!tagName) {
      yield* Effect.sync(() =>
        process.stderr.write(
          `Error: missing required argument: <name>\n\n${tagHelp()}`,
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

    // Build live layer: SSH + Telemetry + GitOps
    const liveLayer = Layer.provideMerge(
      GitOpsLive,
      Layer.merge(SshExecutorLive, TelemetryLive),
    );

    // Host filter from remaining positional args (after tag name)
    const filterHosts =
      parsed.positional.length > 1
        ? parsed.positional.slice(1)
        : undefined;

    const result = yield* runTag(
      registry,
      tagName,
      parsed.flags.repo,
      filterHosts,
    ).pipe(Effect.provide(liveLayer));

    // Format and print output
    const output = parsed.flags.json
      ? formatTagJson(result)
      : formatTagTable(result);

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
