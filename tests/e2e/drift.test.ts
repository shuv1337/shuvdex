/**
 * E2E Test: Drift detection and resolution — detect drift, resolve via pull,
 * verify convergence across all hosts.
 *
 * Tests the full drift detection and resolution workflow using real SSH
 * connections to test hosts (shuvtest and shuvbot).
 *
 * Covers:
 * - VAL-CROSS-002: Drift Detection and Resolution
 *   Evidence: Pre/post HEAD maps, drifted host list, resolution verification
 *
 * Flow:
 * 1. Pull on both hosts to establish a baseline (both in sync)
 * 2. Verify initial drift check shows no drift
 * 3. Create drift by resetting one host to an older commit
 * 4. Detect drift — should identify the drifted host
 * 5. Resolve drift via pull on the drifted host
 * 6. Verify convergence — all hosts have the same HEAD
 * 7. Cleanup: restore both hosts to their original branch
 */
import { layer } from "@effect/vitest";
import { describe, expect, afterAll } from "vitest";
import { Effect, Layer, Ref } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutorLive, SshExecutor } from "@codex-fleet/ssh";
import { GitOpsLive, GitOps } from "@codex-fleet/git-ops";
import { SkillOpsLive, SkillOps } from "@codex-fleet/skill-ops";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";

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

/**
 * Host tuples for checkDrift.
 * [name, config] — the name is the key used for identification in drift reports.
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
// VAL-CROSS-002: Drift Detection and Resolution
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-002: Drift Detection and Resolution (E2E)", () => {
  /**
   * Track the original branch/HEAD on each host so we can restore
   * state after tests, even on failure.
   */
  let originalBranch: string | undefined;

  /**
   * Safety cleanup: restore both hosts to their original branch
   * and pull to get back to latest. This ensures we don't leave
   * hosts in a drifted state after the test suite.
   */
  afterAll(async () => {
    try {
      const cleanup = Effect.gen(function* () {
        const gitOps = yield* GitOps;

        // Restore both hosts to the original branch and pull latest
        for (const [, config] of allHosts) {
          if (originalBranch) {
            yield* gitOps.checkoutRef(config, repoPath, originalBranch).pipe(
              Effect.catchAll(() => Effect.void),
            );
          }
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

  layer(E2ELayer)(
    "detect drift, resolve via pull, verify convergence",
    (it) => {
      /**
       * Step 1: Pull on both hosts to establish baseline.
       * After pull, both hosts should be at the same HEAD commit.
       */
      it.effect(
        "Step 1: pull on both hosts to establish in-sync baseline",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // Record the original branch for cleanup
            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            originalBranch = branch;

            // Pull on both hosts
            for (const [, config] of allHosts) {
              // Ensure we're on the main branch first
              yield* gitOps.checkoutRef(config, repoPath, branch).pipe(
                Effect.catchAll(() => Effect.void),
              );
              const pullResult = yield* gitOps.pull(config, repoPath);
              expect(pullResult).toBeDefined();
              expect(typeof pullResult.updated).toBe("boolean");
            }

            // Verify both hosts have valid HEAD SHAs
            const head1 = yield* gitOps.getHead(shuvtestHost, repoPath);
            const head2 = yield* gitOps.getHead(shuvbotHost, repoPath);
            expect(head1).toMatch(/^[0-9a-f]{40}$/);
            expect(head2).toMatch(/^[0-9a-f]{40}$/);

            // Both should be at the same commit after pulling
            expect(head1).toBe(head2);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 2: Verify initial drift check shows no drift.
       * When both hosts have the same HEAD, checkDrift should report
       * all hosts as in_sync.
       */
      it.effect(
        "Step 2: drift check shows all hosts in sync after pull",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

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
            expect(driftReport.referenceHost).toBe("shuvtest");

            // Both hosts should be in_sync
            for (const hostInfo of driftReport.hosts) {
              expect(hostInfo.status).toBe("in_sync");
              expect(hostInfo.sha).toBe(driftReport.referenceSha);
            }
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 3: Create drift by resetting shuvbot to an older commit.
       * We use `git checkout HEAD~1` to move shuvbot one commit behind,
       * creating a drift scenario.
       */
      it.effect(
        "Step 3: create drift by resetting shuvbot to an older commit",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const ssh = yield* SshExecutor;

            // Record current HEAD on shuvbot before creating drift
            const headBefore = yield* gitOps.getHead(shuvbotHost, repoPath);
            expect(headBefore).toMatch(/^[0-9a-f]{40}$/);

            // Move shuvbot to HEAD~1 (one commit behind)
            // Use a direct SSH command to `git checkout HEAD~1` which
            // puts the host in detached HEAD state at the parent commit.
            yield* ssh.executeCommand(
              shuvbotHost,
              `cd ${repoPath} && git checkout HEAD~1`,
            );

            // Verify shuvbot is now at a different commit
            const headAfter = yield* gitOps.getHead(shuvbotHost, repoPath);
            expect(headAfter).toMatch(/^[0-9a-f]{40}$/);
            expect(headAfter).not.toBe(headBefore);

            // Verify shuvtest hasn't changed
            const shuvtestHead = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(shuvtestHead).toBe(headBefore);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 4: Detect drift — should identify shuvbot as drifted.
       * The drift report should show shuvbot as behind the reference
       * (shuvtest), with SHA details.
       */
      it.effect(
        "Step 4: drift check detects shuvbot as drifted behind reference",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;
            const gitOps = yield* GitOps;

            const driftReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );

            // Drift should be detected
            expect(driftReport.hasDrift).toBe(true);
            expect(driftReport.driftedCount).toBe(1);
            expect(driftReport.inSyncCount).toBe(1);
            expect(driftReport.unreachableCount).toBe(0);

            // shuvtest (reference) should be in_sync
            const shuvtestInfo = driftReport.hosts.find(
              (h) => h.host === "shuvtest",
            );
            expect(shuvtestInfo).toBeDefined();
            expect(shuvtestInfo!.status).toBe("in_sync");

            // shuvbot should be drifted
            const shuvbotInfo = driftReport.hosts.find(
              (h) => h.host === "shuvbot",
            );
            expect(shuvbotInfo).toBeDefined();
            expect(shuvbotInfo!.status).toBe("drifted");
            expect(shuvbotInfo!.sha).toMatch(/^[0-9a-f]{40}$/);
            expect(shuvbotInfo!.sha).not.toBe(driftReport.referenceSha);

            // shuvbot should have drift direction info
            expect(shuvbotInfo!.direction).toBeDefined();

            // Verify the reference SHA matches shuvtest's actual HEAD
            const shuvtestHead = yield* gitOps.getHead(
              shuvtestHost,
              repoPath,
            );
            expect(driftReport.referenceSha).toBe(shuvtestHead);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 5: Resolve drift by restoring shuvbot to the original branch
       * and pulling. This should bring shuvbot back in sync with shuvtest.
       */
      it.effect(
        "Step 5: resolve drift via checkout + pull on drifted host",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // First, restore shuvbot to the original branch (it's in detached HEAD)
            expect(originalBranch).toBeDefined();
            yield* gitOps.checkoutRef(
              shuvbotHost,
              repoPath,
              originalBranch!,
            );

            // Now pull to get the latest
            const pullResult = yield* gitOps.pull(shuvbotHost, repoPath);
            expect(pullResult).toBeDefined();
            expect(typeof pullResult.summary).toBe("string");

            // Verify shuvbot is now at the same HEAD as shuvtest
            const shuvtestHead = yield* gitOps.getHead(
              shuvtestHost,
              repoPath,
            );
            const shuvbotHead = yield* gitOps.getHead(
              shuvbotHost,
              repoPath,
            );
            expect(shuvbotHead).toBe(shuvtestHead);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 6: Verify convergence — drift check should now show
       * all hosts in sync again.
       */
      it.effect(
        "Step 6: post-resolution drift check confirms all hosts converged",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            const driftReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );

            // No drift after resolution
            expect(driftReport.hasDrift).toBe(false);
            expect(driftReport.driftedCount).toBe(0);
            expect(driftReport.inSyncCount).toBe(2);
            expect(driftReport.unreachableCount).toBe(0);

            // All hosts should have the same SHA
            const shas = driftReport.hosts
              .filter((h) => h.sha !== undefined)
              .map((h) => h.sha);
            expect(shas.length).toBe(2);
            expect(new Set(shas).size).toBe(1);

            // All hosts should be in_sync
            for (const hostInfo of driftReport.hosts) {
              expect(hostInfo.status).toBe("in_sync");
            }
          }),
        { timeout: 30_000 },
      );
    },
  );

  layer(E2ELayer)(
    "OTEL tracing for drift detection workflow",
    (it) => {
      /**
       * Step 7: Verify that the drift detection and resolution
       * workflow produces OTEL spans for all operations.
       */
      it.effect(
        "drift detection and resolution flow produces OTEL spans",
        () =>
          Effect.gen(function* () {
            // Clear collected spans
            const spansRef = yield* CollectedSpans;
            yield* Ref.set(spansRef, []);

            const gitOps = yield* GitOps;
            const skillOps = yield* SkillOps;
            const ssh = yield* SshExecutor;

            // 1. Check drift (should be in sync from previous test)
            yield* skillOps.checkDrift(allHosts, repoPath, "shuvtest");

            // 2. Create drift on shuvbot
            yield* ssh.executeCommand(
              shuvbotHost,
              `cd ${repoPath} && git checkout HEAD~1`,
            );

            // 3. Check drift again (should detect drift)
            const driftReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );
            expect(driftReport.hasDrift).toBe(true);

            // 4. Resolve drift
            yield* gitOps.checkoutRef(
              shuvbotHost,
              repoPath,
              originalBranch!,
            );
            yield* gitOps.pull(shuvbotHost, repoPath);

            // 5. Verify convergence
            const postReport = yield* skillOps.checkDrift(
              allHosts,
              repoPath,
              "shuvtest",
            );
            expect(postReport.hasDrift).toBe(false);

            // Verify spans were created
            const spans = yield* Ref.get(spansRef);
            const spanNames = spans.map((s) => s.name);

            // checkDrift should produce spans
            expect(spanNames).toContain("skill.checkDrift");

            // Git operations should produce spans
            expect(spanNames).toContain("git.getHead");
            expect(spanNames).toContain("git.checkoutRef");
            expect(spanNames).toContain("git.pull");

            // SSH operations underpin everything
            const sshSpans = spans.filter(
              (s) => s.name === "ssh.executeCommand",
            );
            expect(sshSpans.length).toBeGreaterThan(0);

            // checkDrift spans should have relevant attributes
            const driftSpans = spans.filter(
              (s) => s.name === "skill.checkDrift",
            );
            expect(driftSpans.length).toBeGreaterThanOrEqual(2);
            for (const span of driftSpans) {
              expect(span.attributes.operation).toBe("checkDrift");
            }
          }),
        { timeout: 60_000 },
      );
    },
  );
});
