import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  GitOps,
  GitOpsLive,
  GitCommandFailed,
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
              stderr: "fatal: not a git repository\n",
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
          expect(err.stderr).toContain("not a git repository");
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
