/**
 * Test SkillOps layer that uses the mock SshExecutor from @codex-fleet/ssh.
 *
 * Combines SkillOpsLive (backed by mock SSH) so that tests can control
 * SSH responses while exercising the real skill-ops logic.
 */
export { SkillOpsLive as SkillOpsTest } from "./live.js";
