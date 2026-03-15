/**
 * @codex-fleet/cli
 *
 * CLI tool for fleet skills management.
 */

export { run, parseArgs, mainHelp, statusHelp } from "./cli.js";
export type { ParsedArgs } from "./cli.js";
export {
  runStatus,
  checkHost,
  formatTable,
  formatJson,
} from "./commands/status.js";
export type { HostStatus, StatusResult } from "./commands/status.js";
