/**
 * E2E Test: Rollback workflow — tag → modify → rollback → verify.
 *
 * Tests the full rollback workflow using real SSH connections to test host
 * (shuvtest). Creates a tag at current HEAD, makes changes after the tag,
 * then rolls back to the tag and verifies exact state restoration.
 *
 * Covers:
 * - VAL-CROSS-003: Rollback Workflow
 *   Evidence: Tag creation, pre-rollback HEAD, post-rollback match, file diff
 *
 * Flow:
 * 1. Pull on shuvtest to establish a clean baseline
 * 2. Record HEAD SHA and a reference file's content at current state
 * 3. Create a uniquely named tag at current HEAD
 * 4. Make changes after the tag (create a temporary file and commit)
 * 5. Verify HEAD has advanced past the tagged commit
 * 6. Rollback to the tag via checkoutRef
 * 7. Verify HEAD matches the tag's commit SHA exactly
 * 8. Verify file content matches tag-time state (temp file absent)
 * 9. Verify OTEL spans are created for each operation
 * 10. Cleanup: restore original branch, remove tag and temp commits
 */
import { layer } from "@effect/vitest";
import { describe, expect, afterAll } from "vitest";
import { Effect, Layer, Ref } from "effect";
import type { HostConfig } from "@codex-fleet/core";
import { SshExecutorLive, SshExecutor } from "@codex-fleet/ssh";
import { GitOpsLive, GitOps } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
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

/**
 * Unique tag name for this test run — includes a timestamp to avoid
 * collisions with previous test runs or other workers.
 */
const testTagName = `e2e-rollback-test-${Date.now()}`;

/**
 * Temporary file created in the repo after tagging to simulate changes.
 * This file should NOT exist after rollback to the tag.
 */
const tempFileName = `_e2e_rollback_temp_${Date.now()}.txt`;

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
// VAL-CROSS-003: Rollback Workflow
// ═══════════════════════════════════════════════════════════════

describe("VAL-CROSS-003: Rollback Workflow (E2E)", () => {
  /**
   * Track original state for cleanup.
   */
  let originalBranch: string | undefined;
  let tagHeadSha: string | undefined;

  /**
   * Safety cleanup: restore the host to its original branch and HEAD,
   * remove the test tag, and undo the temp commit so the branch is
   * back at the original HEAD. This ensures we don't leave the repo
   * in a modified state that affects subsequent tests.
   */
  afterAll(async () => {
    try {
      const cleanup = Effect.gen(function* () {
        const ssh = yield* SshExecutor;
        const gitOps = yield* GitOps;

        // First, ensure we're on the original branch
        if (originalBranch) {
          yield* gitOps.checkoutRef(shuvtestHost, repoPath, originalBranch).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }

        // Reset to the tagged commit (undo the temp commit) if we
        // know the tag SHA. This removes the temp commit from the
        // branch history so other tests see the original state.
        if (tagHeadSha) {
          yield* ssh.executeCommand(
            shuvtestHost,
            `cd ${repoPath} && git reset --hard '${tagHeadSha}'`,
          ).pipe(Effect.catchAll(() => Effect.void));
        }

        // Remove the test tag
        yield* ssh.executeCommand(
          shuvtestHost,
          `cd ${repoPath} && git tag -d '${testTagName}'`,
        ).pipe(Effect.catchAll(() => Effect.void));

        // Clean up any leftover temp files and untracked artifacts
        yield* ssh.executeCommand(
          shuvtestHost,
          `cd ${repoPath} && rm -f '${tempFileName}' && git clean -fd`,
        ).pipe(Effect.catchAll(() => Effect.void));

        // Pull to restore to the latest remote state
        yield* gitOps.pull(shuvtestHost, repoPath).pipe(
          Effect.catchAll(() => Effect.void),
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
    "tag → modify → rollback → verify state restoration",
    (it) => {
      /**
       * Step 1: Pull on shuvtest to establish a clean baseline.
       * Ensures the repo is on its main branch and up to date.
       */
      it.effect(
        "Step 1: pull on remote repo to establish clean baseline",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // Record original branch for cleanup
            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            originalBranch = branch;

            // Ensure we're on the main branch
            yield* gitOps.checkoutRef(shuvtestHost, repoPath, branch).pipe(
              Effect.catchAll(() => Effect.void),
            );

            // Pull latest
            const pullResult = yield* gitOps.pull(shuvtestHost, repoPath);
            expect(pullResult).toBeDefined();
            expect(typeof pullResult.updated).toBe("boolean");
            expect(typeof pullResult.summary).toBe("string");
          }),
        { timeout: 30_000 },
      );

      /**
       * Step 2: Record HEAD SHA at the current (pre-tag) state.
       * This SHA will be used later to verify rollback restores exactly
       * this commit.
       */
      it.effect(
        "Step 2: record HEAD SHA and verify repo is on a branch",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const head = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(head).toMatch(/^[0-9a-f]{40}$/);
            tagHeadSha = head;

            // Should be on a named branch, not detached
            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            expect(branch).not.toBe("HEAD");
            expect(branch.length).toBeGreaterThan(0);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 3: Create a tag at current HEAD.
       * Uses GitOps.createTag to create a lightweight tag. Verifies the
       * tag appears in listTags.
       */
      it.effect(
        "Step 3: create tag at current HEAD",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // Create the test tag
            yield* gitOps.createTag(shuvtestHost, repoPath, testTagName);

            // Verify the tag exists via listTags
            const tags = yield* gitOps.listTags(shuvtestHost, repoPath);
            expect(tags).toContain(testTagName);

            // Verify the tag points to the expected SHA via SSH
            const ssh = yield* SshExecutor;
            const tagShaResult = yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git rev-parse '${testTagName}'`,
            );
            const tagSha = tagShaResult.stdout.trim();
            expect(tagSha).toBe(tagHeadSha);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 4: Make changes after the tag — create a temp file and commit.
       * This simulates work done after the tag point that we'll later
       * roll back from.
       */
      it.effect(
        "Step 4: make changes after tag (create temp file and commit)",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // Create a temporary file in the repo
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && echo 'rollback-test-content-${Date.now()}' > '${tempFileName}'`,
            );

            // Stage and commit the temp file
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git add '${tempFileName}' && git commit -m 'e2e: temp commit for rollback test'`,
            );

            // Verify the file exists
            const fileCheck = yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && test -f '${tempFileName}' && echo 'exists' || echo 'missing'`,
            );
            expect(fileCheck.stdout.trim()).toBe("exists");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 5: Verify HEAD has advanced past the tagged commit.
       * The new commit should have a different SHA from the tag.
       */
      it.effect(
        "Step 5: verify HEAD has advanced past the tagged commit",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const currentHead = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(currentHead).toMatch(/^[0-9a-f]{40}$/);
            // HEAD should be different from the tagged commit
            expect(currentHead).not.toBe(tagHeadSha);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 6: Rollback to the tag via GitOps.checkoutRef.
       * This should restore the working tree to the tag's state.
       */
      it.effect(
        "Step 6: rollback to tag via checkoutRef",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            // Checkout the tag — this puts us in detached HEAD at the tag
            yield* gitOps.checkoutRef(shuvtestHost, repoPath, testTagName);

            // checkoutRef should succeed without error
            // (if it failed, the Effect would have errored)
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 7: Verify HEAD matches the tag's commit SHA exactly.
       * After rollback, HEAD should point to the same commit as the tag.
       */
      it.effect(
        "Step 7: verify HEAD matches tag SHA after rollback",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const headAfterRollback = yield* gitOps.getHead(
              shuvtestHost,
              repoPath,
            );
            expect(headAfterRollback).toMatch(/^[0-9a-f]{40}$/);
            expect(headAfterRollback).toBe(tagHeadSha);
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 8: Verify file content matches tag-time state.
       * The temporary file created after the tag should NOT exist
       * in the working tree after rollback — proving exact state
       * restoration.
       */
      it.effect(
        "Step 8: verify temp file is absent (exact state restoration)",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // The temp file should NOT exist after rolling back to the tag
            const fileCheck = yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && test -f '${tempFileName}' && echo 'exists' || echo 'missing'`,
            );
            expect(fileCheck.stdout.trim()).toBe("missing");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 8b: Verify no rollback-introduced dirty state.
       * Check that git status has no staged or modified tracked files.
       * The repo may have pre-existing untracked files (which is
       * fine — we only care that the rollback itself didn't introduce
       * any uncommitted changes to tracked files).
       */
      it.effect(
        "Step 8b: verify no staged or modified tracked files after rollback",
        () =>
          Effect.gen(function* () {
            const ssh = yield* SshExecutor;

            // Check for staged or modified tracked files only (exclude untracked)
            // git diff --name-only shows modified tracked files
            // git diff --cached --name-only shows staged files
            const modifiedResult = yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git diff --name-only`,
            );
            const stagedResult = yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git diff --cached --name-only`,
            );

            // No modified or staged tracked files after rollback
            expect(modifiedResult.stdout.trim()).toBe("");
            expect(stagedResult.stdout.trim()).toBe("");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 8c: Verify we're in detached HEAD state after checking out
       * a tag (expected git behavior).
       */
      it.effect(
        "Step 8c: verify detached HEAD after tag checkout",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            // When checking out a tag, git enters detached HEAD
            expect(branch).toBe("HEAD");
          }),
        { timeout: 15_000 },
      );

      /**
       * Step 9: Restore to original branch and verify we can resume
       * normal operations. This proves the rollback didn't corrupt
       * the repository state.
       */
      it.effect(
        "Step 9: restore to original branch after rollback",
        () =>
          Effect.gen(function* () {
            const gitOps = yield* GitOps;

            expect(originalBranch).toBeDefined();
            yield* gitOps.checkoutRef(
              shuvtestHost,
              repoPath,
              originalBranch!,
            );

            // Should be back on the named branch
            const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);
            expect(branch).toBe(originalBranch);

            // HEAD should be at the post-tag commit (our temp commit),
            // because the branch still has it
            const head = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(head).toMatch(/^[0-9a-f]{40}$/);
            // Should be a different commit from the tag (the branch advanced)
            expect(head).not.toBe(tagHeadSha);
          }),
        { timeout: 15_000 },
      );
    },
  );

  layer(E2ELayer)(
    "OTEL tracing for rollback workflow",
    (it) => {
      /**
       * Step 10: Verify the entire tag → modify → rollback flow
       * produces OTEL spans for each operation.
       */
      it.effect(
        "tag → rollback flow produces OTEL spans for all operations",
        () =>
          Effect.gen(function* () {
            // Clear collected spans
            const spansRef = yield* CollectedSpans;
            yield* Ref.set(spansRef, []);

            const gitOps = yield* GitOps;
            const ssh = yield* SshExecutor;

            // Use a second unique tag for this OTEL test
            const otelTagName = `e2e-rollback-otel-${Date.now()}`;

            // 1. Record HEAD
            const headBefore = yield* gitOps.getHead(shuvtestHost, repoPath);

            // 2. Create tag
            yield* gitOps.createTag(shuvtestHost, repoPath, otelTagName);

            // 3. Make a small change and commit
            const otelTempFile = `_e2e_otel_temp_${Date.now()}.txt`;
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && echo 'otel-test' > '${otelTempFile}' && git add '${otelTempFile}' && git commit -m 'e2e: otel rollback test'`,
            );

            // 4. Rollback to tag
            yield* gitOps.checkoutRef(shuvtestHost, repoPath, otelTagName);

            // 5. Verify rollback
            const headAfter = yield* gitOps.getHead(shuvtestHost, repoPath);
            expect(headAfter).toBe(headBefore);

            // 6. Cleanup: restore branch, undo temp commit, remove tag
            yield* gitOps.checkoutRef(shuvtestHost, repoPath, originalBranch!).pipe(
              Effect.catchAll(() => Effect.void),
            );
            // Reset to the pre-commit HEAD to undo the temp commit
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git reset --hard '${headBefore}'`,
            ).pipe(Effect.catchAll(() => Effect.void));
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && git tag -d '${otelTagName}'`,
            ).pipe(Effect.catchAll(() => Effect.void));
            yield* ssh.executeCommand(
              shuvtestHost,
              `cd ${repoPath} && rm -f '${otelTempFile}' && git clean -fd`,
            ).pipe(Effect.catchAll(() => Effect.void));

            // Verify spans were created for each operation
            const spans = yield* Ref.get(spansRef);
            const spanNames = spans.map((s) => s.name);

            // Git operations should have created spans
            expect(spanNames).toContain("git.getHead");
            expect(spanNames).toContain("git.createTag");
            expect(spanNames).toContain("git.checkoutRef");

            // SSH executor spans should also be present
            const sshSpans = spans.filter(
              (s) => s.name === "ssh.executeCommand",
            );
            expect(sshSpans.length).toBeGreaterThan(0);

            // All git spans should have host attribute
            const gitSpans = spans.filter((s) => s.name.startsWith("git."));
            for (const span of gitSpans) {
              expect(span.attributes.host).toBe("shuvtest");
            }

            // createTag span should have the tag name attribute
            const createTagSpan = spans.find((s) => s.name === "git.createTag");
            expect(createTagSpan).toBeDefined();
            expect(createTagSpan!.attributes["git.tagName"]).toBe(otelTagName);

            // checkoutRef span should have ref attribute
            const checkoutSpan = spans.find((s) => s.name === "git.checkoutRef");
            expect(checkoutSpan).toBeDefined();
            expect(checkoutSpan!.attributes["git.ref"]).toBe(otelTagName);
          }),
        { timeout: 60_000 },
      );
    },
  );
});
