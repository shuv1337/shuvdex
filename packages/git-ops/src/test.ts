/**
 * Test GitOps layer that uses the mock SshExecutor from @codex-fleet/ssh.
 *
 * Combines GitOpsLive (backed by mock SSH) so that tests can control
 * SSH responses while exercising the real git-ops logic.
 */
export { GitOpsLive as GitOpsTest } from "./live.js";
