/**
 * E2E Test: Multi-platform consistency — verify operations work consistently
 * on both Linux (shuvtest) and macOS (shuvbot). Same command produces
 * equivalent results on both platforms.
 *
 * Tests the cross-platform compatibility of git-ops, skill-ops, and SSH
 * executor using real SSH connections to both test hosts.
 *
 * Covers:
 * - VAL-CROSS-004: Multi-Host Operations
 *   Evidence: Per-platform output, state comparison, normalized status
 *
 * Flow:
 * 1. Verify SSH connectivity on both platforms
 * 2. Git read operations produce consistent formats on both platforms
 * 3. Skill discovery returns consistent results on both platforms
 * 4. Skill activation/deactivation works identically on both platforms
 * 5. Drift detection correctly compares across platforms
 * 6. Platform-specific path handling is transparent
 * 7. Cleanup: restore both hosts to clean state
 */
import { layer } from "@effect/vitest";
import { describe, expect, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutorLive, SshExecutor } from "@codex-fleet/ssh";
import { GitOpsLive, GitOps } from "@codex-fleet/git-ops";
import { SkillOpsLive, SkillOps } from "@codex-fleet/skill-ops";
import { TelemetryTest } from "@codex-fleet/telemetry";

// ─── Configuration ─────────────────────────────────────────────

/**
 * Test hosts: shuvtest (Linux) and shuvbot (macOS) with real SSH access.
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

const shuvbotHost: HostConfig = {
  hostname: "shuvbot",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/** Remote skills repository path on both test hosts. */
const repoPath = "~/repos/shuvbot-skills";

/** Active skills directory on both hosts (where symlinks live). */
const activeDir = "~/.codex/skills";

/**
 * Skill to use for E2E testing.
 * "adapt" exists in the shuvbot-skills repo on BOTH hosts (Linux and macOS)
 * and is safe to activate/deactivate without affecting real functionality.
 *
 * Note: "test-skill" only exists on shuvbot (macOS), not on shuvtest (Linux),
 * so we use a skill that is present on both platforms to avoid broken symlinks.
 */
const testSkillName = "adapt";

/**
 * Host tuples for multi-host operations.
 * Includes both Linux (shuvtest) and macOS (shuvbot) platforms.
 */
const allHosts: ReadonlyArray<readonly [string, HostConfig]> = [
  ["shuvtest", shuvtestHost],
  ["shuvbot", shuvbotHost],
];

// ─── Test Layer ────────────────────────────────────────────────

const LiveSshLayer = Layer.merge(SshExecutorLive, TelemetryTest);
const LiveGitOpsLayer = Layer.provideMerge(GitOpsLive, LiveSshLayer);
const LiveSkillOpsLayer = Layer.provideMerge(
  SkillOpsLive,
  Layer.merge(LiveSshLayer, LiveGitOpsLayer),
);

const E2ELayer = Layer.mergeAll(
  LiveSshLayer,
  LiveGitOpsLayer,
  LiveSkillOpsLayer,
);

// ═══════════════════════════════════════════════════════════════
// VAL-CROSS-004: Multi-Host Operations
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-004: Multi-Platform Operations (E2E)", () => {
  /**
   * Safety cleanup: deactivate test skill on both hosts after all tests
   * and restore both to their original branch with latest state.
   */
  afterAll(async () => {
    try {
      const cleanup = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        const gitOps = yield* GitOps;

        for (const [, config] of allHosts) {
          yield* skillOps.deactivateSkill(config, testSkillName, activeDir).pipe(
            Effect.catchAll(() => Effect.void),
          );
          // Ensure both hosts are back on main branch and up to date
          yield* gitOps.pull(config, repoPath).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
      });
      await Effect.runPromise(
        cleanup.pipe(
          Effect.provide(E2ELayer),
          Effect.catchAll(() => Effect.void),
        ),
      );
    } catch {
      // Best-effort cleanup — don't fail the test suite
    }
  });

  // ─── SSH Connectivity ──────────────────────────────────────

  layer(E2ELayer)(
    "SSH connectivity on both platforms",
    (it) => {
      /**
       * Step 1a: Verify SSH connectivity to Linux host (shuvtest).
       */
      it.effect(
        "Step 1a: SSH to Linux (shuvtest) succeeds",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;
            const result = yield* ssh.executeCommand(shuvtestHost, "echo ok");
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBe("ok");
          }),
        { timeout: 10_000 },
      );

      /**
       * Step 1b: Verify SSH connectivity to macOS host (shuvbot).
       */
      it.effect(
        "Step 1b: SSH to macOS (shuvbot) succeeds",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;
            const result = yield* ssh.executeCommand(shuvbotHost, "echo ok");
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBe("ok");
          }),
        { timeout: 10_000 },
      );

      /**
       * Step 1c: Both hosts report different OS platforms.
       * Confirms we're actually testing cross-platform by checking uname.
       */
      it.effect(
        "Step 1c: hosts report different OS platforms (Linux vs Darwin)",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            const linuxResult = yield* ssh.executeCommand(
              shuvtestHost,
              "uname -s",
            );
            const macResult = yield* ssh.executeCommand(
              shuvbotHost,
              "uname -s",
            );

            expect(linuxResult.exitCode).toBe(0);
            expect(macResult.exitCode).toBe(0);

            const linuxOS = linuxResult.stdout.trim();
            const macOS = macResult.stdout.trim();

            expect(linuxOS).toBe("Linux");
            expect(macOS).toBe("Darwin");
          }),
        { timeout: 10_000 },
      );
    },
  );

  // ─── Git Read Operations ───────────────────────────────────

  layer(E2ELayer)(
    "git read operations produce consistent results on both platforms",
    (it) => {
      /**
       * Step 2a: Pull on both hosts first to establish a common baseline.
       */
      it.effect(
        "Step 2a: pull on both hosts to establish common baseline",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            for (const [, config] of allHosts) {
              const result = yield* gitOps.pull(config, repoPath);
              expect(result).toBeDefined();
              expect(typeof result.updated).toBe("boolean");
              expect(typeof result.summary).toBe("string");
              expect(result.summary.length).toBeGreaterThan(0);
            }
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 2b: getHead returns same SHA on both platforms.
       * After pulling, both hosts should be at the same HEAD commit.
       * The 40-char hex SHA format should be identical.
       */
      it.effect(
        "Step 2b: getHead returns identical SHA on Linux and macOS",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const linuxHead = yield* gitOps.getHead(shuvtestHost, repoPath);
            const macHead = yield* gitOps.getHead(shuvbotHost, repoPath);

            // Both should be valid 40-char hex SHAs
            expect(linuxHead).toMatch(/^[0-9a-f]{40}$/);
            expect(macHead).toMatch(/^[0-9a-f]{40}$/);

            // Both should be at the same commit after pull
            expect(linuxHead).toBe(macHead);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 2c: getBranch returns same branch name on both platforms.
       * Both hosts should report the same branch name.
       */
      it.effect(
        "Step 2c: getBranch returns same branch name on Linux and macOS",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const linuxBranch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            const macBranch = yield* gitOps.getBranch(shuvbotHost, repoPath);

            // Both should be on a named branch (not detached)
            expect(linuxBranch).not.toBe("HEAD");
            expect(macBranch).not.toBe("HEAD");

            // Both should report the same branch
            expect(linuxBranch).toBe(macBranch);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 2d: isDirty returns same type (boolean) on both platforms.
       * The actual dirty state may differ, but the return type and
       * format must be consistent.
       */
      it.effect(
        "Step 2d: isDirty returns boolean on both platforms",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const linuxDirty = yield* gitOps.isDirty(shuvtestHost, repoPath);
            const macDirty = yield* gitOps.isDirty(shuvbotHost, repoPath);

            expect(typeof linuxDirty).toBe("boolean");
            expect(typeof macDirty).toBe("boolean");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 2e: listTags returns same tags on both platforms.
       * After pulling, both hosts should have the same set of tags.
       */
      it.effect(
        "Step 2e: listTags returns consistent results on both platforms",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const linuxTags = yield* gitOps.listTags(shuvtestHost, repoPath);
            const macTags = yield* gitOps.listTags(shuvbotHost, repoPath);

            // Both should return arrays
            expect(Array.isArray(linuxTags)).toBe(true);
            expect(Array.isArray(macTags)).toBe(true);

            // Both should have the same tags (sorted for comparison)
            expect([...linuxTags].sort()).toEqual([...macTags].sort());
          }),
        { timeout: 15_000 },
      );
    },
  );

  // ─── Skill Discovery ──────────────────────────────────────

  layer(E2ELayer)(
    "skill discovery returns consistent results across platforms",
    (it) => {
      /**
       * Step 3a: listSkills returns same skill names on both platforms.
       * Both hosts share the same skills repo, so skill names should match.
       */
      it.effect(
        "Step 3a: listSkills returns consistent skill names on Linux and macOS",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            const linuxSkills = yield* skillOps.listSkills(
              shuvtestHost,
              repoPath,
              activeDir,
            );
            const macSkills = yield* skillOps.listSkills(
              shuvbotHost,
              repoPath,
              activeDir,
            );

            // Both should return arrays
            expect(Array.isArray(linuxSkills)).toBe(true);
            expect(Array.isArray(macSkills)).toBe(true);

            // Both should have at least one skill
            expect(linuxSkills.length).toBeGreaterThan(0);
            expect(macSkills.length).toBeGreaterThan(0);

            // Extract and sort skill names for comparison
            const linuxNames = new Set(linuxSkills.map((s) => s.name));
            const macNames = new Set(macSkills.map((s) => s.name));

            // The vast majority of skills should be shared across platforms.
            // Some platform-specific directories may differ, but the core
            // discovery mechanism should be consistent.
            const commonSkills = [...linuxNames].filter((n) => macNames.has(n));
            const totalUnique = new Set([...linuxNames, ...macNames]).size;

            // At least 90% of all skills should be common to both platforms,
            // proving the discovery mechanism is platform-agnostic.
            const commonRatio = commonSkills.length / totalUnique;
            expect(commonRatio).toBeGreaterThanOrEqual(0.9);

            // Specifically, the test skill ("adapt") should be on both
            expect(linuxNames.has(testSkillName)).toBe(true);
            expect(macNames.has(testSkillName)).toBe(true);
          }),
        // listSkills checks each skill's symlink status via individual SSH calls;
        // repos with many skills (100+) need a longer timeout
        { timeout: 120_000 },
      );

      /**
       * Step 3b: Each skill has consistent SkillInfo structure.
       * Verifies the response shape is identical across platforms.
       */
      it.effect(
        "Step 3b: SkillInfo structure is identical on both platforms",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            const linuxSkills = yield* skillOps.listSkills(
              shuvtestHost,
              repoPath,
              activeDir,
            );
            const macSkills = yield* skillOps.listSkills(
              shuvbotHost,
              repoPath,
              activeDir,
            );

            // Verify structure of each skill on both platforms
            for (const skill of linuxSkills) {
              expect(typeof skill.name).toBe("string");
              expect(skill.name.length).toBeGreaterThan(0);
              expect(["active", "inactive"]).toContain(skill.status);
            }

            for (const skill of macSkills) {
              expect(typeof skill.name).toBe("string");
              expect(skill.name.length).toBeGreaterThan(0);
              expect(["active", "inactive"]).toContain(skill.status);
            }
          }),
        // listSkills checks each skill's symlink status via individual SSH calls
        { timeout: 120_000 },
      );
    },
  );

  // ─── Skill Activation / Deactivation ──────────────────────

  layer(E2ELayer)(
    "skill activation and deactivation work identically on both platforms",
    (it) => {
      /**
       * Step 4a: Deactivate on both hosts first to establish a clean state.
       */
      it.effect(
        "Step 4a: deactivate test skill on both hosts for clean state",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [name, config] of allHosts) {
              const result = yield* skillOps.deactivateSkill(
                config,
                testSkillName,
                activeDir,
              );
              expect(result.host).toBe(name);
              expect(result.skillName).toBe(testSkillName);
              expect(result.status).toBe("inactive");
            }
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 4b: Activate the same skill on both platforms.
       * Both should succeed with equivalent ActivationResult structure.
       */
      it.effect(
        "Step 4b: activate test skill on both platforms with consistent result",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [name, config] of allHosts) {
              const result = yield* skillOps.activateSkill(
                config,
                testSkillName,
                repoPath,
                activeDir,
              );

              expect(result.host).toBe(name);
              expect(result.skillName).toBe(testSkillName);
              expect(result.status).toBe("active");
              expect(result.alreadyInState).toBe(false);
            }
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 4c: Verify getSkillStatus returns "active" on both platforms.
       */
      it.effect(
        "Step 4c: getSkillStatus returns 'active' on both platforms after activation",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [, config] of allHosts) {
              const status = yield* skillOps.getSkillStatus(
                config,
                testSkillName,
                activeDir,
              );
              expect(status).toBe("active");
            }
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 4d: Verify the symlink targets are equivalent across platforms.
       * The symlink on both hosts should point to the skill inside the repo.
       * Path format may differ (tilde vs expanded), but the logical target
       * should be the same relative path.
       */
      it.effect(
        "Step 4d: symlink targets are equivalent across platforms",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            const linuxResult = yield* ssh.executeCommand(
              shuvtestHost,
              `readlink ${activeDir}/${testSkillName}`,
            );
            const macResult = yield* ssh.executeCommand(
              shuvbotHost,
              `readlink ${activeDir}/${testSkillName}`,
            );

            const linuxTarget = linuxResult.stdout.trim();
            const macTarget = macResult.stdout.trim();

            // Both should point to the skill inside the repo
            expect(linuxTarget).toContain(testSkillName);
            expect(macTarget).toContain(testSkillName);

            // Both targets should end with the same relative path
            // (absolute prefix may differ: /home/exedev vs /Users/shuv)
            const expectedSuffix = new RegExp(`repos/shuvbot-skills/${testSkillName}$`);
            expect(linuxTarget).toMatch(expectedSuffix);
            expect(macTarget).toMatch(expectedSuffix);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 4e: Idempotent re-activation on both platforms.
       */
      it.effect(
        "Step 4e: re-activation is idempotent on both platforms",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [name, config] of allHosts) {
              const result = yield* skillOps.activateSkill(
                config,
                testSkillName,
                repoPath,
                activeDir,
              );

              expect(result.host).toBe(name);
              expect(result.skillName).toBe(testSkillName);
              expect(result.status).toBe("active");
              expect(result.alreadyInState).toBe(true);
            }
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 4f: Deactivate on both platforms and verify consistency.
       */
      it.effect(
        "Step 4f: deactivation produces consistent results on both platforms",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [name, config] of allHosts) {
              const result = yield* skillOps.deactivateSkill(
                config,
                testSkillName,
                activeDir,
              );

              expect(result.host).toBe(name);
              expect(result.skillName).toBe(testSkillName);
              expect(result.status).toBe("inactive");
              expect(result.alreadyInState).toBe(false);
            }

            // Verify status is inactive on both platforms
            for (const [, config] of allHosts) {
              const skillOps2 = yield* SkillOps;
              const status = yield* skillOps2.getSkillStatus(
                config,
                testSkillName,
                activeDir,
              );
              expect(status).toBe("inactive");
            }
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 4g: Idempotent deactivation on both platforms.
       */
      it.effect(
        "Step 4g: re-deactivation is idempotent on both platforms",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            for (const [name, config] of allHosts) {
              const result = yield* skillOps.deactivateSkill(
                config,
                testSkillName,
                activeDir,
              );

              expect(result.host).toBe(name);
              expect(result.skillName).toBe(testSkillName);
              expect(result.status).toBe("inactive");
              expect(result.alreadyInState).toBe(true);
            }
          }),
        { timeout: 15_000 },
      );
    },
  );

  // ─── Drift Detection ──────────────────────────────────────

  layer(E2ELayer)(
    "drift detection works correctly across platforms",
    (it) => {
      /**
       * Step 5a: Both hosts in sync after pull — drift check returns no drift.
       */
      it.effect(
        "Step 5a: drift check shows no drift when both platforms are in sync",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const skillOps = yield* SkillOps;

            // Pull on both hosts first
            for (const [, config] of allHosts) {
              yield* gitOps.pull(config, repoPath);
            }

            // Check drift with shuvtest as reference
            const driftReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );

            expect(driftReport.hasDrift).toBe(false);
            expect(driftReport.driftedCount).toBe(0);
            expect(driftReport.inSyncCount).toBe(2);
            expect(driftReport.unreachableCount).toBe(0);
            expect(driftReport.referenceSha).toMatch(/^[0-9a-f]{40}$/);

            // Both hosts should have same SHA
            for (const hostInfo of driftReport.hosts) {
              expect(hostInfo.status).toBe("in_sync");
              expect(hostInfo.sha).toBe(driftReport.referenceSha);
            }
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 5b: Check drift using macOS as reference produces equivalent
       * result as using Linux as reference. The reference host choice
       * should not affect the drift outcome.
       */
      it.effect(
        "Step 5b: drift check is symmetric — same result regardless of reference host platform",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            // Check with shuvtest (Linux) as reference
            const linuxRefReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );

            // Check with shuvbot (macOS) as reference
            const macRefReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvbot",
            );

            // Both should show no drift (since both are in sync)
            expect(linuxRefReport.hasDrift).toBe(false);
            expect(macRefReport.hasDrift).toBe(false);

            // Reference SHAs should be the same
            expect(linuxRefReport.referenceSha).toBe(macRefReport.referenceSha);

            // Both hosts should be in_sync in both reports
            expect(linuxRefReport.inSyncCount).toBe(2);
            expect(macRefReport.inSyncCount).toBe(2);
          }),
        { timeout: 30_000 },
      );
    },
  );

  // ─── Platform-Specific Path Handling ───────────────────────

  layer(E2ELayer)(
    "platform-specific paths handled transparently",
    (it) => {
      /**
       * Step 6a: Tilde expansion works on both platforms.
       * The ~ in repoPath is expanded to the correct home directory
       * on both Linux and macOS, despite different home directory paths.
       */
      it.effect(
        "Step 6a: tilde path expansion works on both Linux and macOS",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // Verify the repo path resolves on Linux
            const linuxCheck = yield* ssh.executeCommand(
              shuvtestHost,
              `test -d ${repoPath} && echo 'exists' || echo 'missing'`,
            );
            expect(linuxCheck.stdout.trim()).toBe("exists");

            // Verify the repo path resolves on macOS
            const macCheck = yield* ssh.executeCommand(
              shuvbotHost,
              `test -d ${repoPath} && echo 'exists' || echo 'missing'`,
            );
            expect(macCheck.stdout.trim()).toBe("exists");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 6b: Git operations succeed on both platforms despite
       * different underlying git binary versions / behaviors.
       */
      it.effect(
        "Step 6b: git operations succeed on both platforms despite different git versions",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;
            const gitOps = yield* GitOps;

            // Get git versions on both hosts
            const linuxGitVer = yield* ssh.executeCommand(
              shuvtestHost,
              "git --version",
            );
            const macGitVer = yield* ssh.executeCommand(
              shuvbotHost,
              "git --version",
            );

            expect(linuxGitVer.exitCode).toBe(0);
            expect(macGitVer.exitCode).toBe(0);

            // Git versions may differ between platforms — that's expected
            const linuxVersion = linuxGitVer.stdout.trim();
            const macVersion = macGitVer.stdout.trim();
            expect(linuxVersion).toContain("git version");
            expect(macVersion).toContain("git version");

            // Despite potentially different git versions, operations
            // should produce consistent results
            const linuxHead = yield* gitOps.getHead(shuvtestHost, repoPath);
            const macHead = yield* gitOps.getHead(shuvbotHost, repoPath);
            expect(linuxHead).toMatch(/^[0-9a-f]{40}$/);
            expect(macHead).toMatch(/^[0-9a-f]{40}$/);
            expect(linuxHead).toBe(macHead);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 6c: Active skills directory (tilde-based) resolves correctly
       * on both platforms. The ~/.codex/skills dir should exist or be
       * creatable on both.
       */
      it.effect(
        "Step 6c: active skills directory resolves on both platforms",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // Ensure the active dir exists on both platforms
            for (const [, config] of allHosts) {
              yield* ssh.executeCommand(config, `mkdir -p ${activeDir}`);

              const check = yield* ssh.executeCommand(
                config,
                `test -d ${activeDir} && echo 'exists' || echo 'missing'`,
              );
              expect(check.stdout.trim()).toBe("exists");
            }
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 6d: Hashing tools (sha256sum vs shasum) are handled
       * transparently. Both platforms can run checksum commands even
       * though the command names differ (Linux: sha256sum, macOS: shasum).
       */
      it.effect(
        "Step 6d: platform-appropriate hash command available on both hosts",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // Linux typically has sha256sum
            const linuxHash = yield* ssh.executeCommand(
              shuvtestHost,
              "echo 'test' | sha256sum || echo 'test' | shasum -a 256",
            );
            expect(linuxHash.exitCode).toBe(0);

            // macOS typically has shasum -a 256
            const macHash = yield* ssh.executeCommand(
              shuvbotHost,
              "echo 'test' | shasum -a 256 || echo 'test' | sha256sum",
            );
            expect(macHash.exitCode).toBe(0);

            // Both should produce the same hash for the same input
            const linuxHashValue = linuxHash.stdout.trim().split(/\s+/)[0];
            const macHashValue = macHash.stdout.trim().split(/\s+/)[0];
            expect(linuxHashValue).toBe(macHashValue);
          }),
        { timeout: 15_000 },
      );
    },
  );

  // ─── End-to-End Workflow Parity ────────────────────────────

  layer(E2ELayer)(
    "same workflow produces equivalent results on both platforms",
    (it) => {
      /**
       * Step 7: Execute the same pull → activate → verify → deactivate
       * workflow on both platforms and compare results structurally.
       */
      it.effect(
        "Step 7: pull → activate → verify → deactivate workflow identical on both platforms",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const skillOps = yield* SkillOps;

            type PlatformResult = {
              pullUpdated: boolean;
              pullSummaryPresent: boolean;
              head: string;
              branch: string;
              activateStatus: string;
              activateAlreadyInState: boolean;
              skillStatus: string;
              deactivateStatus: string;
              deactivateAlreadyInState: boolean;
            };

            const platformResults: Record<string, PlatformResult> = {};

            for (const [name, config] of allHosts) {
              // 1. Pull
              const pullResult = yield* gitOps.pull(config, repoPath);

              // 2. Read state
              const head = yield* gitOps.getHead(config, repoPath);
              const branch = yield* gitOps.getBranch(config, repoPath);

              // 3. Deactivate first (clean state)
              yield* skillOps.deactivateSkill(config, testSkillName, activeDir).pipe(
                Effect.catchAll(() => Effect.void),
              );

              // 4. Activate
              const activateResult = yield* skillOps.activateSkill(
                config,
                testSkillName,
                repoPath,
                activeDir,
              );

              // 5. Verify status
              const status = yield* skillOps.getSkillStatus(
                config,
                testSkillName,
                activeDir,
              );

              // 6. Deactivate
              const deactivateResult = yield* skillOps.deactivateSkill(
                config,
                testSkillName,
                activeDir,
              );

              platformResults[name] = {
                pullUpdated: pullResult.updated,
                pullSummaryPresent: pullResult.summary.length > 0,
                head,
                branch,
                activateStatus: activateResult.status,
                activateAlreadyInState: activateResult.alreadyInState,
                skillStatus: status,
                deactivateStatus: deactivateResult.status,
                deactivateAlreadyInState: deactivateResult.alreadyInState,
              };
            }

            // Compare results between platforms
            const linux = platformResults["shuvtest"]!;
            const mac = platformResults["shuvbot"]!;

            // Pull summary should be present on both
            expect(linux.pullSummaryPresent).toBe(true);
            expect(mac.pullSummaryPresent).toBe(true);

            // HEAD should be identical after pull
            expect(linux.head).toBe(mac.head);

            // Branch should be the same
            expect(linux.branch).toBe(mac.branch);

            // Activation results should match
            expect(linux.activateStatus).toBe(mac.activateStatus);
            expect(linux.activateAlreadyInState).toBe(mac.activateAlreadyInState);

            // Skill status should match
            expect(linux.skillStatus).toBe(mac.skillStatus);

            // Deactivation results should match
            expect(linux.deactivateStatus).toBe(mac.deactivateStatus);
            expect(linux.deactivateAlreadyInState).toBe(mac.deactivateAlreadyInState);
          }),
        { timeout: 60_000 },
      );
    },
  );
});
