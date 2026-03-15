/**
 * Configuration loader - reads and validates YAML host configuration files.
 */
import { Effect, Schema } from "effect";
import * as fs from "node:fs";
import * as YAML from "yaml";
import { HostConfig } from "./schema.js";
import {
  ConfigNotFound,
  ConfigParseError,
  ConfigValidationError,
} from "./errors.js";
import { HostRegistry } from "./registry.js";

/**
 * Expected shape of the YAML file after parsing:
 * A "hosts" key containing a record of name -> host config entries.
 *
 * Example:
 * ```yaml
 * hosts:
 *   shuvtest:
 *     hostname: shuvtest
 *     user: shuv
 *   shuvbot:
 *     hostname: shuvbot
 *     connectionType: ssh
 *     port: 2222
 * ```
 */
const RawConfigFile = Schema.Struct({
  hosts: Schema.Record({
    key: Schema.String,
    value: Schema.Unknown,
  }),
});

/**
 * Load a host registry from a YAML configuration file.
 *
 * Steps:
 * 1. Read file from disk (fails with ConfigNotFound)
 * 2. Parse YAML (fails with ConfigParseError)
 * 3. Validate each host entry against HostConfig schema (fails with ConfigValidationError)
 * 4. Return a HostRegistry
 */
export const loadConfig = (
  filePath: string,
): Effect.Effect<
  HostRegistry,
  ConfigNotFound | ConfigParseError | ConfigValidationError
> =>
  Effect.gen(function* () {
    // Step 1: Read file
    const content = yield* Effect.try({
      try: () => fs.readFileSync(filePath, "utf-8"),
      catch: () => new ConfigNotFound({ path: filePath }),
    });

    // Step 2: Parse YAML
    const rawData = yield* Effect.try({
      try: () => YAML.parse(content) as unknown,
      catch: (cause) => new ConfigParseError({ path: filePath, cause }),
    });

    // Step 3: Validate the top-level structure has a "hosts" key
    const parsed = yield* Schema.decodeUnknown(RawConfigFile)(rawData).pipe(
      Effect.mapError(
        (parseError) =>
          new ConfigValidationError({
            path: filePath,
            issues: formatParseError(parseError),
          }),
      ),
    );

    // Step 4: Validate each host entry against HostConfig schema
    const entries: Array<[string, typeof HostConfig.Type]> = [];

    for (const [name, rawEntry] of Object.entries(parsed.hosts)) {
      const hostConfig = yield* Schema.decodeUnknown(HostConfig)(
        rawEntry,
      ).pipe(
        Effect.mapError(
          (parseError) =>
            new ConfigValidationError({
              path: filePath,
              issues: `Host "${name}": ${formatParseError(parseError)}`,
            }),
        ),
      );
      entries.push([name, hostConfig]);
    }

    return HostRegistry.fromRecord(Object.fromEntries(entries));
  });

/**
 * Format a ParseError into a human-readable string with field paths.
 */
function formatParseError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
