/**
 * E2E Test: Complete sync workflow — pull → activate → verify.
 *
 * Tests the full integration across git-ops, skill-ops, and CLI/MCP layers
 * using real SSH connections to test host (shuvtest).
 *
 * Covers:
 * - VAL-CROSS-001: Full Sync Workflow
 *   Evidence: Git pull output, symlink creation, status query
 *
 * Flow:
 * 1. Pull latest changes on remote skills repo
 * 2. Activate a skill (create symlink)
 * 3. Query skill status and verify it's active
 * 4. Verify the entire flow is traced with OTEL spans
 * 5. Cleanup: deactivate the skill
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
 * Test host: shuvtest (Linux) with real SSH access.
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/** Remote skills repository path on the test host. */
const repoPath = "~/repos/shuvbot-skills";

/** Active skills directory on the test host (where symlinks live). */
const activeDir = "~/.codex/skills";

/**
 * Skill to use for E2E testing.
 * "test-skill" exists in the shuvbot-skills repo and is safe to
 * activate/deactivate without affecting real functionality.
 */
const testSkillName = "test-skill";

// ─── Test Layer ────────────────────────────────────────────────

/**
 * Full live layer stack: real SSH + test telemetry (in-memory spans)
 * + GitOps + SkillOps backed by live SSH connections.
 *
 * This exercises the entire production code path except we capture
 * OTEL spans in memory for assertions instead of exporting to the
 * collector.
 */
const LiveSshLayer = Layer.merge(SshExecutorLive, TelemetryTest);
const LiveGitOpsLayer = Layer.provideMerge(GitOpsLive, LiveSshLayer);
const LiveSkillOpsLayer = Layer.provideMerge(
  SkillOpsLive,
  Layer.merge(LiveSshLayer, LiveGitOpsLayer),
);

/**
 * Combined layer providing all services for the E2E test.
 */
const E2ELayer = Layer.mergeAll(
  LiveSshLayer,
  LiveGitOpsLayer,
  LiveSkillOpsLayer,
);

// ═══════════════════════════════════════════════════════════════
// VAL-CROSS-001: Full Sync Workflow
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-001: Full Sync Workflow (E2E)", () => {
  /**
   * Safety cleanup: ensure we deactivate the test skill after all tests
   * regardless of success/failure. This prevents leaving stale symlinks
   * on the test host.
   */
  afterAll(async () => {
    try {
      const cleanup = Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(
          shuvtestHost,
          testSkillName,
          activeDir,
        );
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
    "pull → activate → verify complete workflow",
    (it) => {
      /**
       * Step 1: Git pull completes successfully.
       * Verifies the git-ops pull operation works over real SSH.
       */
      it.effect(
        "Step 1: git pull on remote repo completes successfully",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const pullResult = yield* gitOps.pull(shuvtestHost, repoPath);

            // Pull should succeed (updated or already up to date)
            expect(pullResult).toBeDefined();
            expect(typeof pullResult.updated).toBe("boolean");
            expect(typeof pullResult.summary).toBe("string");
            expect(pullResult.summary.length).toBeGreaterThan(0);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 2: Symlink activation succeeds.
       * Verifies skill-ops activateSkill creates the symlink on the remote host.
       */
      it.effect(
        "Step 2: activate skill creates symlink on remote host",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            // First deactivate to ensure clean state
            yield* skillOps.deactivateSkill(
              shuvtestHost,
              testSkillName,
              activeDir,
            );

            // Now activate — should create fresh symlink
            const result = yield* skillOps.activateSkill(
              shuvtestHost,
              testSkillName,
              repoPath,
              activeDir,
            );

            expect(result.host).toBe("shuvtest");
            expect(result.skillName).toBe(testSkillName);
            expect(result.status).toBe("active");
            expect(result.alreadyInState).toBe(false);
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 3: Status query shows skill active.
       * Verifies that getSkillStatus reports "active" after activation.
       */
      it.effect(
        "Step 3: status query shows skill is active after activation",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;
            const status = yield* skillOps.getSkillStatus(
              shuvtestHost,
              testSkillName,
              activeDir,
            );

            expect(status).toBe("active");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 3b: Verify the symlink actually exists and points to the
       * correct target via a direct SSH command.
       */
      it.effect(
        "Step 3b: symlink points to correct repo path on remote host",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;
            const result = yield* ssh.executeCommand(
              shuvtestHost,
              `readlink ${activeDir}/${testSkillName}`,
            );

            // The symlink should point to the skill inside the repo
            const target = result.stdout.trim();
            expect(target).toContain(testSkillName);
            // Target should be under the skills repo path
            // (tilde may be expanded to /home/exedev)
            expect(target).toMatch(
              /repos\/shuvbot-skills\/test-skill$/,
            );
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 3c: Verify the host is still reachable and the git state
       * is valid after the workflow.
       */
      it.effect(
        "Step 3c: git HEAD is valid SHA after pull and activation",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const head = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(head).toMatch(/^[0-9a-f]{40}$/);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 3d: Verify the host remains reachable throughout the workflow.
       */
      it.effect(
        "Step 3d: host remains reachable throughout workflow",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;
            const result = yield* ssh.executeCommand(
              shuvtestHost,
              "echo ok",
            );

            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toBe("ok");
          }),
        { timeout: 10_000 },
      );

      /**
       * Step 4: Verify idempotent activation (already active → alreadyInState).
       */
      it.effect(
        "Step 4: re-activation is idempotent (alreadyInState=true)",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;
            const result = yield* skillOps.activateSkill(
              shuvtestHost,
              testSkillName,
              repoPath,
              activeDir,
            );

            expect(result.host).toBe("shuvtest");
            expect(result.skillName).toBe(testSkillName);
            expect(result.status).toBe("active");
            expect(result.alreadyInState).toBe(true);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 5: Deactivate the skill and verify it becomes inactive.
       */
      it.effect(
        "Step 5: deactivation removes symlink and status shows inactive",
        () =>
          Effect.gen(function* () {
            const skillOps = yield* SkillOps;

            // Deactivate
            const deactivateResult = yield* skillOps.deactivateSkill(
              shuvtestHost,
              testSkillName,
              activeDir,
            );

            expect(deactivateResult.host).toBe("shuvtest");
            expect(deactivateResult.skillName).toBe(testSkillName);
            expect(deactivateResult.status).toBe("inactive");
            expect(deactivateResult.alreadyInState).toBe(false);

            // Verify status now shows inactive
            const status = yield* skillOps.getSkillStatus(
              shuvtestHost,
              testSkillName,
              activeDir,
            );
            expect(status).toBe("inactive");
          }),
        { timeout: 15_000 },
      );
    },
  );

  layer(E2ELayer)(
    "OTEL tracing across the entire workflow",
    (it) => {
      /**
       * Step 6: Entire flow traced in OTEL.
       * Execute the complete pull → activate → status → deactivate workflow
       * and verify that spans are created for each operation.
       */
      it.effect(
        "entire pull → activate → verify → deactivate flow produces OTEL spans",
        () =>
          Effect.gen(function* () {
            // Clear collected spans
            const spansRef = yield* CollectedSpans;
            yield* Ref.set(spansRef, []);

            const gitOps = yield* GitOps;
            const skillOps = yield* SkillOps;

            // 1. Pull
            yield* gitOps.pull(shuvtestHost, repoPath);

            // 2. Activate
            yield* skillOps.activateSkill(
              shuvtestHost,
              testSkillName,
              repoPath,
              activeDir,
            );

            // 3. Verify status
            const status = yield* skillOps.getSkillStatus(
              shuvtestHost,
              testSkillName,
              activeDir,
            );
            expect(status).toBe("active");

            // 4. Deactivate (cleanup)
            yield* skillOps.deactivateSkill(
              shuvtestHost,
              testSkillName,
              activeDir,
            );

            // Verify spans were created for each operation
            const spans = yield* Ref.get(spansRef);

            // There should be spans for the git and skill operations
            const spanNames = spans.map((s) => s.name);

            // Git pull should have created a span
            expect(spanNames).toContain("git.pull");

            // Skill operations should have created spans
            expect(spanNames).toContain("skill.activateSkill");
            expect(spanNames).toContain("skill.getSkillStatus");
            expect(spanNames).toContain("skill.deactivateSkill");

            // Verify the key operation spans completed successfully
            const operationSpanNames = [
              "git.pull",
              "skill.activateSkill",
              "skill.getSkillStatus",
              "skill.deactivateSkill",
            ];
            for (const name of operationSpanNames) {
              const span = spans.find((s) => s.name === name);
              expect(span, `span ${name} should exist`).toBeDefined();
              expect(span!.status, `span ${name} should be ok`).toBe("ok");
              expect(
                span!.attributes.host,
                `span ${name} should have host attribute`,
              ).toBe("shuvtest");
            }

            // SSH executor spans should also be present
            // (child spans for the actual SSH commands)
            const sshSpans = spans.filter(
              (s) => s.name === "ssh.executeCommand",
            );
            expect(sshSpans.length).toBeGreaterThan(0);

            // SSH spans should have host attribute
            for (const sshSpan of sshSpans) {
              expect(sshSpan.attributes.host).toBe("shuvtest");
            }

            // Verify there are multiple operations traced (complete workflow)
            // Pull (1) + activate (multiple SSH calls) + status (1) + deactivate (multiple)
            expect(spans.length).toBeGreaterThanOrEqual(4);
          }),
        { timeout: 60_000 },
      );
    },
  );

  layer(E2ELayer)(
    "git state verification after pull",
    (it) => {
      /**
       * Verify that after pulling, we can read git state on the remote host.
       */
      it.effect(
        "getHead returns valid SHA after pull",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // Pull first
            yield* gitOps.pull(shuvtestHost, repoPath);

            // Then verify HEAD
            const head = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(head).toMatch(/^[0-9a-f]{40}$/);
          }),
        { timeout: 30_000 },
      );

      it.effect(
        "getBranch returns branch name after pull",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            expect(branch.length).toBeGreaterThan(0);
            // Should be a real branch, not detached HEAD
            expect(branch).not.toBe("HEAD");
          }),
        { timeout: 15_000 },
      );

      it.effect(
        "isDirty returns a boolean reflecting repo state after pull",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;
            const dirty = yield* gitOps.isDirty(shuvtestHost, repoPath);
            // isDirty should return a boolean (the actual state depends
            // on whether the repo has uncommitted changes — either value is valid)
            expect(typeof dirty).toBe("boolean");
          }),
        { timeout: 15_000 },
      );
    },
  );
});
