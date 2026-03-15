import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  GitOps,
  GitOpsLive,
  GitCommandFailed,
  MergeConflict,
  PushRejected,
} from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  CommandFailed,
} from "@codex-fleet/ssh";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

/**
 * Test host configuration.
 */
const testHost: HostConfig = {
  hostname: "testhost",
  connectionType: "ssh",
  port: 22,
  user: "testuser",
  timeout: 30,
};

const testRepoPath = "~/repos/test-repo";

/**
 * Combined test layer: mock SSH + test telemetry + GitOps backed by mock SSH.
 *
 * GitOpsLive requires SshExecutor in context, so we provide SshExecutorTest
 * to GitOpsLive, producing a layer that outputs GitOps. We then merge
 * all layers so tests can access MockSshResponses, RecordedSshCalls,
 * CollectedSpans, and GitOps.
 */
const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, GitOpsTestLayer);

describe("GitOps", () => {
  layer(TestLayer)("getHead", (it) => {
    it.effect("returns 40-char SHA from git rev-parse HEAD", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const sha = yield* gitOps.getHead(testHost, testRepoPath);

        expect(sha).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
        expect(sha).toHaveLength(40);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }),
    );

    it.effect("trims whitespace from output", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "  a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2  \n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const sha = yield* gitOps.getHead(testHost, testRepoPath);

        expect(sha).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
      }),
    );

    it.effect("executes correct SSH command", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getHead(testHost, testRepoPath);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("cd ~/repos/test-repo");
        expect(lastCall.command).toContain("git rev-parse HEAD");
        expect(lastCall.host).toEqual(testHost);
      }),
    );

    it.effect("fails with GitCommandFailed when git command fails", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git rev-parse HEAD",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: ambiguous argument 'HEAD': unknown revision\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getHead(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
          const err = result.left as GitCommandFailed;
          expect(err.host).toBe("testhost");
          expect(err.exitCode).toBe(128);
          expect(err.stderr).toContain("ambiguous argument");
        }
      }),
    );
  });

  layer(TestLayer)("getBranch", (it) => {
    it.effect("returns branch name for normal checkout", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "main\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(testHost, testRepoPath);

        expect(branch).toBe("main");
      }),
    );

    it.effect("returns 'HEAD' for detached HEAD state", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git symbolic-ref --short HEAD",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: ref HEAD is not a symbolic ref\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(testHost, testRepoPath);

        expect(branch).toBe("HEAD");
      }),
    );

    it.effect("trims whitespace from branch name", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "  feature/my-branch  \n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(testHost, testRepoPath);

        expect(branch).toBe("feature/my-branch");
      }),
    );

    it.effect("handles branch names with slashes", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "feature/deep/nested/branch\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(testHost, testRepoPath);

        expect(branch).toBe("feature/deep/nested/branch");
      }),
    );
  });

  layer(TestLayer)("isDirty", (it) => {
    it.effect("returns false for clean repository", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(testHost, testRepoPath);

        expect(dirty).toBe(false);
      }),
    );

    it.effect("returns true when there are uncommitted changes", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: " M src/index.ts\n?? new-file.txt\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(testHost, testRepoPath);

        expect(dirty).toBe(true);
      }),
    );

    it.effect("returns true for staged-only changes", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "M  staged-file.ts\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(testHost, testRepoPath);

        expect(dirty).toBe(true);
      }),
    );

    it.effect("returns true for untracked files only", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "?? untracked.txt\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(testHost, testRepoPath);

        expect(dirty).toBe(true);
      }),
    );

    it.effect("executes git status --porcelain command", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.isDirty(testHost, testRepoPath);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("git status --porcelain");
      }),
    );
  });

  layer(TestLayer)("listTags", (it) => {
    it.effect("returns array of tag names", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "v1.0.0\nv1.1.0\nv2.0.0\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const tags = yield* gitOps.listTags(testHost, testRepoPath);

        expect(tags).toEqual(["v1.0.0", "v1.1.0", "v2.0.0"]);
      }),
    );

    it.effect("returns empty array when no tags exist", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const tags = yield* gitOps.listTags(testHost, testRepoPath);

        expect(tags).toEqual([]);
      }),
    );

    it.effect("returns single tag", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "v1.0.0\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const tags = yield* gitOps.listTags(testHost, testRepoPath);

        expect(tags).toEqual(["v1.0.0"]);
      }),
    );

    it.effect("executes git tag command", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.listTags(testHost, testRepoPath);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("git tag");
      }),
    );
  });

  layer(TestLayer)("pull", (it) => {
    it.effect("returns updated=false when already up to date", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "Already up to date.\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps.pull(testHost, testRepoPath);

        expect(result.updated).toBe(false);
        expect(result.summary).toBe("Already up to date.");
      }),
    );

    it.effect("returns updated=true when new changes are pulled", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "Updating a1b2c3d..e4f5a6b\nFast-forward\n src/index.ts | 2 +-\n 1 file changed\n",
              stderr: "",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps.pull(testHost, testRepoPath);

        expect(result.updated).toBe(true);
        expect(result.summary).toContain("Fast-forward");
      }),
    );

    it.effect("executes git pull origin command", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.pull(testHost, testRepoPath);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("cd ~/repos/test-repo");
        expect(lastCall.command).toContain("git pull origin");
        expect(lastCall.host).toEqual(testHost);
      }),
    );

    it.effect("fails with MergeConflict when conflicts occur", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 1,
              stdout: "",
              stderr:
                "Auto-merging src/index.ts\nCONFLICT (content): Merge conflict in src/index.ts\nCONFLICT (content): Merge conflict in README.md\nAutomatic merge failed; fix conflicts and then commit the result.\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(MergeConflict);
          const err = result.left as MergeConflict;
          expect(err.host).toBe("testhost");
          expect(err.files).toEqual(["src/index.ts", "README.md"]);
          expect(err.stderr).toContain("Automatic merge failed");
        }
      }),
    );

    it.effect("fails with GitCommandFailed for non-conflict errors", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 1,
              stdout: "",
              stderr: "fatal: refusing to merge unrelated histories\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
        }
      }),
    );
  });

  layer(TestLayer)("push", (it) => {
    it.effect("returns summary on successful push", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "To github.com:user/repo.git\n   a1b2c3d..e4f5a6b  main -> main\n",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps.push(testHost, testRepoPath);

        expect(result.summary).toContain("main -> main");
      }),
    );

    it.effect("executes git push origin command", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.push(testHost, testRepoPath);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("cd ~/repos/test-repo");
        expect(lastCall.command).toContain("git push origin");
      }),
    );

    it.effect("fails with PushRejected for non-fast-forward", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git push origin",
              exitCode: 1,
              stdout: "",
              stderr:
                "To github.com:user/repo.git\n ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'github.com:user/repo.git'\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .push(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(PushRejected);
          const err = result.left as PushRejected;
          expect(err.host).toBe("testhost");
          expect(err.reason).toContain("rejected");
          expect(err.stderr).toContain("non-fast-forward");
        }
      }),
    );

    it.effect("fails with GitCommandFailed for non-rejection errors", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git push origin",
              exitCode: 1,
              stdout: "",
              stderr: "fatal: the remote end hung up unexpectedly\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .push(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
        }
      }),
    );
  });

  layer(TestLayer)("createTag", (it) => {
    it.effect("creates tag at HEAD when no ref specified", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0.0");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("cd ~/repos/test-repo");
        // Tag name is shell-quoted for safety
        expect(lastCall.command).toContain("git tag -- 'v1.0.0'");
      }),
    );

    it.effect("creates tag at specific ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0.0", "abc1234");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // Both tag name and ref are shell-quoted for safety
        expect(lastCall.command).toContain("git tag -- 'v1.0.0' 'abc1234'");
      }),
    );

    it.effect("fails with GitCommandFailed when tag already exists", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git tag v1.0.0",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: tag 'v1.0.0' already exists\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "v1.0.0")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
          const err = result.left as GitCommandFailed;
          expect(err.stderr).toContain("already exists");
        }
      }),
    );
  });

  layer(TestLayer)("checkoutRef", (it) => {
    it.effect("executes git checkout with specified ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "main");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain("cd ~/repos/test-repo");
        // Ref is shell-quoted for safety
        expect(lastCall.command).toContain("git checkout -- 'main'");
      }),
    );

    it.effect("handles branch checkout", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: {
              stdout: "",
              stderr: "Switched to branch 'feature/test'\n",
              exitCode: 0,
            },
          },
        ]);

        const gitOps = yield* GitOps;
        // Should not throw
        yield* gitOps.checkoutRef(testHost, testRepoPath, "feature/test");
      }),
    );

    it.effect("handles SHA checkout", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(
          testHost,
          testRepoPath,
          "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        );

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // SHA is shell-quoted for safety
        expect(lastCall.command).toContain(
          "git checkout -- 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'",
        );
      }),
    );

    it.effect("fails with GitCommandFailed for invalid ref", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git checkout nonexistent",
              exitCode: 1,
              stdout: "",
              stderr: "error: pathspec 'nonexistent' did not match any file(s) known to git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "nonexistent")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
          const err = result.left as GitCommandFailed;
          expect(err.stderr).toContain("did not match");
        }
      }),
    );
  });
});

describe("GitCommandFailed error", () => {
  it("has correct _tag", () => {
    const err = new GitCommandFailed({
      host: "h",
      command: "git rev-parse HEAD",
      exitCode: 128,
      stderr: "fatal: not a git repo",
    });
    expect(err._tag).toBe("GitCommandFailed");
    expect(err.host).toBe("h");
    expect(err.exitCode).toBe(128);
    expect(err.message).toContain("128");
    expect(err.message).toContain("h");
  });
});

describe("MergeConflict error", () => {
  it("has correct _tag and fields", () => {
    const err = new MergeConflict({
      host: "h",
      files: ["src/index.ts", "README.md"],
      stderr: "CONFLICT ...",
    });
    expect(err._tag).toBe("MergeConflict");
    expect(err.host).toBe("h");
    expect(err.files).toEqual(["src/index.ts", "README.md"]);
    expect(err.message).toContain("h");
    expect(err.message).toContain("src/index.ts");
    expect(err.message).toContain("README.md");
  });
});

describe("PushRejected error", () => {
  it("has correct _tag and fields", () => {
    const err = new PushRejected({
      host: "h",
      reason: "non-fast-forward",
      stderr: "! [rejected]",
    });
    expect(err._tag).toBe("PushRejected");
    expect(err.host).toBe("h");
    expect(err.reason).toBe("non-fast-forward");
    expect(err.message).toContain("h");
    expect(err.message).toContain("non-fast-forward");
  });
});
