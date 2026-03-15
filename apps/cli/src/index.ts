/**
 * @codex-fleet/cli
 *
 * CLI tool for fleet skills management.
 */

export {
  run,
  parseArgs,
  mainHelp,
  statusHelp,
  pullHelp,
  syncHelp,
  activateHelp,
  deactivateHelp,
  rollbackHelp,
  tagHelp,
} from "./cli.js";
export type { ParsedArgs } from "./cli.js";
export {
  runStatus,
  checkHost,
  formatTable,
  formatJson,
} from "./commands/status.js";
export type { HostStatus, StatusResult } from "./commands/status.js";
export {
  runPull,
  formatPullTable,
  formatPullJson,
} from "./commands/pull.js";
export type { HostPullResult, PullCommandResult } from "./commands/pull.js";
export {
  runSync,
  formatSyncTable,
  formatSyncJson,
} from "./commands/sync.js";
export type { HostSyncResult, SyncCommandResult } from "./commands/sync.js";
export {
  runActivate,
  formatActivateTable,
  formatActivateJson,
} from "./commands/activate.js";
export type {
  HostActivateResult,
  ActivateCommandResult,
} from "./commands/activate.js";
export {
  runDeactivate,
  formatDeactivateTable,
  formatDeactivateJson,
} from "./commands/deactivate.js";
export type {
  HostDeactivateResult,
  DeactivateCommandResult,
} from "./commands/deactivate.js";
export {
  runRollback,
  formatRollbackTable,
  formatRollbackJson,
} from "./commands/rollback.js";
export type {
  HostRollbackResult,
  RollbackCommandResult,
} from "./commands/rollback.js";
export {
  runTag,
  formatTagTable,
  formatTagJson,
} from "./commands/tag.js";
export type {
  HostTagResult,
  TagCommandResult,
} from "./commands/tag.js";
