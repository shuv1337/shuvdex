/**
 * Temp-repo regression tests for git-ops.
 *
 * These tests create actual local git repositories in /tmp and execute
 * real git commands to validate that the command strings produced by
 * the GitOps service work correctly with real git.
 *
 * This catches semantic issues that mock-based tests miss — e.g.,
 * `git checkout -- <ref>` treats <ref> as a pathspec (file), not a
 * branch/tag/SHA, even though the mock tests happily accept it.
 */
import { describe, expect, beforeEach, afterEach } from "vitest";
import { it, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitOps, GitOpsLive } from "../src/index.js";
import { SshExecutor, CommandFailed } from "@codex-fleet/ssh";
import type { HostConfig } from "@codex-fleet/core";
import { TelemetryTest } from "@codex-fleet/telemetry";

/**
 * Create a local SSH executor that runs commands directly via child_process
 * instead of over SSH. This lets us test against real local git repos.
 */
const LocalSshExecutor = Layer.succeed(
  SshExecutor,
  SshExecutor.of({
    executeCommand: (host, command, _options?) =>
      Effect.gen(function* () {
        try {
          const stdout = execSync(command, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 10_000,
          });
          return { stdout, stderr: "", exitCode: 0 };
        } catch (error: unknown) {
          const err = error as {
            status?: number;
            stdout?: string;
            stderr?: string;
          };
          return yield* Effect.fail(
            new CommandFailed({
              host: host.hostname,
              command,
              exitCode: err.status ?? 1,
              stdout: err.stdout ?? "",
              stderr: err.stderr ?? "",
            }),
          );
        }
      }),
  }),
);

const GitOpsLocal = GitOpsLive.pipe(Layer.provide(LocalSshExecutor));
const TestLayer = Layer.mergeAll(LocalSshExecutor, TelemetryTest, GitOpsLocal);

const localHost: HostConfig = {
  hostname: "localhost",
  connectionType: "local" as any,
  port: 22,
  timeout: 10,
};

/**
 * Helper to run git in a temp directory.
 */
const gitCmd = (repoDir: string, cmd: string): string =>
  execSync(`cd ${repoDir} && git ${cmd}`, { encoding: "utf-8" }).trim();

describe("Temp-repo regression tests", () => {
  let repoDir: string;

  beforeEach(() => {
    // Create a fresh temp git repo for each test
    repoDir = mkdtempSync(join(tmpdir(), "git-ops-test-"));
    execSync(
      `cd ${repoDir} && git init && git config user.email "test@test.com" && git config user.name "Test"`,
      { encoding: "utf-8" },
    );
    // Create an initial commit on 'main'
    execSync(
      `cd ${repoDir} && echo "initial" > file.txt && git add . && git commit -m "initial commit"`,
      { encoding: "utf-8" },
    );
    // Ensure we're on 'main' branch
    try {
      execSync(`cd ${repoDir} && git branch -M main`, { encoding: "utf-8" });
    } catch {
      // Already on main
    }
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  layer(TestLayer)("checkoutRef with real git", (it) => {
    it.effect("checks out an existing branch by name", () =>
      Effect.gen(function* () {
        // Create a second branch
        gitCmd(repoDir, "checkout -b feature-branch");
        gitCmd(repoDir, "checkout main");

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(localHost, repoDir, "feature-branch");

        // Verify we actually switched branches
        const currentBranch = gitCmd(repoDir, "symbolic-ref --short HEAD");
        expect(currentBranch).toBe("feature-branch");
      }),
    );

    it.effect("checks out a tag", () =>
      Effect.gen(function* () {
        // Create a tag at current HEAD
        gitCmd(repoDir, "tag v1.0.0");
        // Make another commit so HEAD differs from the tag
        execSync(
          `cd ${repoDir} && echo "change" >> file.txt && git add . && git commit -m "second commit"`,
          { encoding: "utf-8" },
        );

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(localHost, repoDir, "v1.0.0");

        // Verify HEAD is at the tagged commit (detached HEAD)
        const head = gitCmd(repoDir, "rev-parse HEAD");
        const tagSha = gitCmd(repoDir, "rev-parse v1.0.0");
        expect(head).toBe(tagSha);
      }),
    );

    it.effect("checks out a SHA", () =>
      Effect.gen(function* () {
        const sha = gitCmd(repoDir, "rev-parse HEAD");
        // Make another commit
        execSync(
          `cd ${repoDir} && echo "change" >> file.txt && git add . && git commit -m "second commit"`,
          { encoding: "utf-8" },
        );

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(localHost, repoDir, sha);

        // Verify HEAD is at the specified SHA
        const head = gitCmd(repoDir, "rev-parse HEAD");
        expect(head).toBe(sha);
      }),
    );

    it.effect("fails with GitCommandFailed for nonexistent ref", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(localHost, repoDir, "nonexistent-branch-xyz")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left._tag).toBe("GitCommandFailed");
        }
      }),
    );

    it.effect("checks out main after being on another branch", () =>
      Effect.gen(function* () {
        // Create and switch to a feature branch
        gitCmd(repoDir, "checkout -b other-branch");
        execSync(
          `cd ${repoDir} && echo "other" > other.txt && git add . && git commit -m "other commit"`,
          { encoding: "utf-8" },
        );

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(localHost, repoDir, "main");

        const currentBranch = gitCmd(repoDir, "symbolic-ref --short HEAD");
        expect(currentBranch).toBe("main");
      }),
    );
  });

  layer(TestLayer)("createTag with real git", (it) => {
    it.effect("creates a tag at HEAD", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.createTag(localHost, repoDir, "test-tag");

        const tags = gitCmd(repoDir, "tag");
        expect(tags).toContain("test-tag");
      }),
    );

    it.effect("creates a tag at specific ref", () =>
      Effect.gen(function* () {
        const sha = gitCmd(repoDir, "rev-parse HEAD");
        // Make another commit
        execSync(
          `cd ${repoDir} && echo "change" >> file.txt && git add . && git commit -m "second commit"`,
          { encoding: "utf-8" },
        );

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(localHost, repoDir, "old-tag", sha);

        // Verify tag points to the correct SHA
        const tagSha = gitCmd(repoDir, "rev-parse old-tag");
        expect(tagSha).toBe(sha);
      }),
    );
  });

  layer(TestLayer)("getHead / getBranch / isDirty with real git", (it) => {
    it.effect("getHead returns the correct SHA", () =>
      Effect.gen(function* () {
        const expected = gitCmd(repoDir, "rev-parse HEAD");

        const gitOps = yield* GitOps;
        const sha = yield* gitOps.getHead(localHost, repoDir);

        expect(sha).toBe(expected);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }),
    );

    it.effect("getBranch returns current branch name", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(localHost, repoDir);

        expect(branch).toBe("main");
      }),
    );

    it.effect("isDirty returns false for clean repo", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(localHost, repoDir);

        expect(dirty).toBe(false);
      }),
    );

    it.effect("isDirty returns true for dirty repo", () =>
      Effect.gen(function* () {
        execSync(`cd ${repoDir} && echo "dirty" >> file.txt`, {
          encoding: "utf-8",
        });

        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(localHost, repoDir);

        expect(dirty).toBe(true);
      }),
    );
  });

  layer(TestLayer)("pull with real merge conflict", (it) => {
    it.effect("produces MergeConflict with files array via git pull without --rebase", () =>
      Effect.gen(function* () {
        // Set up a bare "remote" repo and two clones to create a real merge conflict.
        // Uses a file name that does NOT contain the word "conflict" to prove
        // that detection relies on parsing git's "CONFLICT (content)" output
        // from stdout, not an accidental filename match in stderr.
        const bareDir = mkdtempSync(join(tmpdir(), "git-ops-bare-"));
        const cloneDir = mkdtempSync(join(tmpdir(), "git-ops-clone-"));

        try {
          // Create a bare remote repository
          execSync(`cd ${bareDir} && git init --bare`, { encoding: "utf-8" });

          // Clone the bare repo to our working clone
          execSync(`git clone ${bareDir} ${cloneDir}`, { encoding: "utf-8" });
          execSync(
            `cd ${cloneDir} && git config user.email "test@test.com" && git config user.name "Test"`,
            { encoding: "utf-8" },
          );

          // Create initial commit on main — use "data.txt" (no "conflict" in the name)
          execSync(
            `cd ${cloneDir} && echo "line1" > data.txt && git add . && git commit -m "initial" && git push origin HEAD`,
            { encoding: "utf-8" },
          );

          // Create a second clone that will push a conflicting change
          const clone2Dir = mkdtempSync(join(tmpdir(), "git-ops-clone2-"));
          try {
            execSync(`git clone ${bareDir} ${clone2Dir}`, { encoding: "utf-8" });
            execSync(
              `cd ${clone2Dir} && git config user.email "test2@test.com" && git config user.name "Test2"`,
              { encoding: "utf-8" },
            );

            // Push a conflicting change from clone2
            execSync(
              `cd ${clone2Dir} && echo "remote-change" > data.txt && git add . && git commit -m "remote change" && git push origin HEAD`,
              { encoding: "utf-8" },
            );

            // Make a conflicting change in clone1 (without pulling first)
            execSync(
              `cd ${cloneDir} && echo "local-change" > data.txt && git add . && git commit -m "local change"`,
              { encoding: "utf-8" },
            );

            // Now pull should cause a merge conflict — uses git pull origin
            // (not --rebase) so conflict messages appear on stdout
            const gitOps = yield* GitOps;
            const result = yield* gitOps
              .pull(localHost, cloneDir)
              .pipe(Effect.either);

            expect(result._tag).toBe("Left");
            if (result._tag === "Left") {
              const err = result.left;
              expect(err._tag).toBe("MergeConflict");
              if (err._tag === "MergeConflict") {
                expect(err.files).toContain("data.txt");
                expect(err.files.length).toBeGreaterThanOrEqual(1);
              }
            }
          } finally {
            rmSync(clone2Dir, { recursive: true, force: true });
          }
        } finally {
          rmSync(bareDir, { recursive: true, force: true });
          rmSync(cloneDir, { recursive: true, force: true });
        }
      }),
    );
  });
});
