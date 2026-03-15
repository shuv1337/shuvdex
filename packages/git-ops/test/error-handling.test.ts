import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  GitOps,
  GitOpsLive,
  GitCommandFailed,
  NotARepository,
  MergeConflict,
  AuthError,
  TimeoutError,
} from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  CommandFailed,
  ConnectionTimeout,
  CommandTimeout,
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
 */
const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, GitOpsTestLayer);

// ---------------------------------------------------------------------------
// NotARepository error detection
// ---------------------------------------------------------------------------
describe("NotARepository error", () => {
  it("has correct _tag and fields", () => {
    const err = new NotARepository({
      host: "testhost",
      path: "/tmp/not-a-repo",
    });
    expect(err._tag).toBe("NotARepository");
    expect(err.host).toBe("testhost");
    expect(err.path).toBe("/tmp/not-a-repo");
    expect(err.message).toContain("testhost");
    expect(err.message).toContain("/tmp/not-a-repo");
  });

  layer(TestLayer)("getHead on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git rev-parse HEAD",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getHead(testHost, "/tmp/not-a-repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
          const err = result.left as NotARepository;
          expect(err._tag).toBe("NotARepository");
          expect(err.host).toBe("testhost");
          expect(err.path).toBe("/tmp/not-a-repo");
        }
      }),
    );
  });

  layer(TestLayer)("getBranch on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git symbolic-ref --short HEAD",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        // getBranch catches GitCommandFailed for detached HEAD, but NotARepository
        // should propagate through since it's a different error tag
        const result = yield* gitOps
          .getBranch(testHost, "/tmp/not-a-repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });

  layer(TestLayer)("isDirty on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git status --porcelain",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .isDirty(testHost, "/tmp/not-a-repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });

  layer(TestLayer)("pull on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, "/tmp/not-a-repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });

  layer(TestLayer)("push on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git push origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .push(testHost, "/tmp/not-a-repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });

  layer(TestLayer)("createTag on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git tag v1.0.0",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, "/tmp/not-a-repo", "v1.0.0")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });

  layer(TestLayer)("checkoutRef on non-git directory", (it) => {
    it.effect("produces NotARepository error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git checkout main",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, "/tmp/not-a-repo", "main")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(NotARepository);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// MergeConflict error with file list (enhanced verification)
// ---------------------------------------------------------------------------
describe("MergeConflict error with file list", () => {
  layer(TestLayer)("pull with merge conflicts", (it) => {
    it.effect("produces MergeConflict with correct file list", () =>
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
              stderr: [
                "Auto-merging src/index.ts",
                "CONFLICT (content): Merge conflict in src/index.ts",
                "CONFLICT (content): Merge conflict in config.yaml",
                "CONFLICT (content): Merge conflict in docs/README.md",
                "Automatic merge failed; fix conflicts and then commit the result.",
              ].join("\n"),
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
          expect(err._tag).toBe("MergeConflict");
          expect(err.host).toBe("testhost");
          expect(err.files).toEqual(["src/index.ts", "config.yaml", "docs/README.md"]);
          expect(err.stderr).toContain("Automatic merge failed");
        }
      }),
    );

    it.effect("produces MergeConflict for single file conflict", () =>
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
              stderr: "CONFLICT (content): Merge conflict in package.json\nAutomatic merge failed\n",
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
          expect(err.files).toEqual(["package.json"]);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// AuthError detection
// ---------------------------------------------------------------------------
describe("AuthError", () => {
  it("has correct _tag and fields", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: "Permission denied (publickey).",
    });
    expect(err._tag).toBe("AuthError");
    expect(err.host).toBe("testhost");
    expect(err.message).toContain("testhost");
    expect(err.message).toContain("Authentication failed");
  });

  layer(TestLayer)("pull with auth failure", (it) => {
    it.effect("produces AuthError for permission denied", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(AuthError);
          const err = result.left as AuthError;
          expect(err._tag).toBe("AuthError");
          expect(err.host).toBe("testhost");
          // Ensure no credentials are leaked in the error
          expect(err.stderr).not.toContain("password");
        }
      }),
    );

    it.effect("produces AuthError for authentication failed", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Authentication failed for 'https://github.com/user/repo.git'\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(AuthError);
        }
      }),
    );

    it.effect("produces AuthError for permission denied (publickey)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git push origin",
              exitCode: 128,
              stdout: "",
              stderr: "Permission denied (publickey).\nfatal: Could not read from remote repository.\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .push(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(AuthError);
          const err = result.left as AuthError;
          expect(err._tag).toBe("AuthError");
        }
      }),
    );
  });

  layer(TestLayer)("AuthError is distinct from TimeoutError", (it) => {
    it.effect("auth failure does NOT produce TimeoutError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Authentication failed for 'https://github.com/user/repo.git'\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          // Specifically NOT a TimeoutError
          expect(result.left).not.toBeInstanceOf(TimeoutError);
          expect(result.left).toBeInstanceOf(AuthError);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// TimeoutError error detection
// ---------------------------------------------------------------------------
describe("TimeoutError", () => {
  it("has correct _tag and fields", () => {
    const err = new TimeoutError({
      host: "testhost",
      operation: "git pull origin",
      stderr: "fatal: unable to access: Connection timed out",
    });
    expect(err._tag).toBe("TimeoutError");
    expect(err.host).toBe("testhost");
    expect(err.operation).toBe("git pull origin");
    expect(err.message).toContain("testhost");
    expect(err.message).toContain("git pull origin");
  });

  layer(TestLayer)("pull with connection timeout in stderr", (it) => {
    it.effect("produces TimeoutError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: unable to access 'https://github.com/user/repo.git/': Connection timed out\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
          const err = result.left as TimeoutError;
          expect(err._tag).toBe("TimeoutError");
          expect(err.host).toBe("testhost");
          expect(err.operation).toContain("git pull");
        }
      }),
    );
  });

  layer(TestLayer)("push with network unreachable", (it) => {
    it.effect("produces TimeoutError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git push origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: unable to access: Network is unreachable\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .push(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
        }
      }),
    );
  });

  layer(TestLayer)("pull with DNS resolution failure", (it) => {
    it.effect("produces TimeoutError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Could not resolve host: github.com\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
        }
      }),
    );
  });

  layer(TestLayer)("SSH-level ConnectionTimeout maps to TimeoutError", (it) => {
    it.effect("produces TimeoutError from SSH ConnectionTimeout", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionTimeout({
              host: "testhost",
              timeoutMs: 10000,
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getHead(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
          const err = result.left as TimeoutError;
          expect(err._tag).toBe("TimeoutError");
          expect(err.host).toBe("testhost");
          expect(err.stderr).toContain("timed out");
          expect(err.stderr).toContain("10000");
        }
      }),
    );
  });

  layer(TestLayer)("SSH-level CommandTimeout maps to TimeoutError", (it) => {
    it.effect("produces TimeoutError from SSH CommandTimeout", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandTimeout({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              timeoutMs: 30000,
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
          const err = result.left as TimeoutError;
          expect(err.host).toBe("testhost");
          expect(err.stderr).toContain("timed out");
          expect(err.stderr).toContain("30000");
        }
      }),
    );
  });

  layer(TestLayer)("timeout does not corrupt repository", (it) => {
    it.effect("TimeoutError does not include repo-modifying side effects", () =>
      Effect.gen(function* () {
        // Verify that when a timeout occurs, no partial write happened.
        // We simulate a timeout and check that no SSH calls beyond the
        // failing one are made (no cleanup needed = no corruption).
        const responsesRef = yield* MockSshResponses;
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandTimeout({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              timeoutMs: 5000,
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        yield* gitOps.pull(testHost, testRepoPath).pipe(Effect.either);

        // Only one SSH call was made (the pull that timed out)
        const callsAfter = yield* Ref.get(callsRef);
        expect(callsAfter.length - countBefore).toBe(1);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error discrimination (distinct types)
// ---------------------------------------------------------------------------
describe("Error type discrimination", () => {
  it("all error types have unique _tag values", () => {
    const tags = new Set([
      new GitCommandFailed({ host: "h", command: "c", exitCode: 1, stderr: "" })._tag,
      new NotARepository({ host: "h", path: "p" })._tag,
      new MergeConflict({ host: "h", files: [], stderr: "" })._tag,
      new AuthError({ host: "h", stderr: "" })._tag,
      new TimeoutError({ host: "h", operation: "op", stderr: "" })._tag,
    ]);
    expect(tags.size).toBe(5);
  });

  it("errors can be discriminated by _tag", () => {
    const errors = [
      new GitCommandFailed({ host: "h", command: "c", exitCode: 1, stderr: "" }),
      new NotARepository({ host: "h", path: "p" }),
      new MergeConflict({ host: "h", files: ["a.txt"], stderr: "" }),
      new AuthError({ host: "h", stderr: "" }),
      new TimeoutError({ host: "h", operation: "op", stderr: "" }),
    ];

    for (const err of errors) {
      switch (err._tag) {
        case "GitCommandFailed":
          expect(err.exitCode).toBe(1);
          break;
        case "NotARepository":
          expect(err.path).toBe("p");
          break;
        case "MergeConflict":
          expect(err.files).toEqual(["a.txt"]);
          break;
        case "AuthError":
          expect(err.host).toBe("h");
          break;
        case "TimeoutError":
          expect(err.operation).toBe("op");
          break;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: getBranch propagates non-detached-HEAD errors
// ---------------------------------------------------------------------------
describe("getBranch error propagation", () => {
  layer(TestLayer)("getBranch propagates GitCommandFailed for non-detached-HEAD errors", (it) => {
    it.effect("propagates GitCommandFailed when stderr does not indicate detached HEAD", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Simulate a generic git failure that is NOT detached HEAD
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git symbolic-ref --short HEAD",
              exitCode: 1,
              stdout: "",
              stderr: "error: some unexpected git error\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getBranch(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
          const err = result.left as GitCommandFailed;
          expect(err._tag).toBe("GitCommandFailed");
          expect(err.stderr).toContain("some unexpected git error");
        }
      }),
    );

    it.effect("propagates GitCommandFailed for ambiguous argument errors", () =>
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
              stderr: "fatal: ambiguous argument 'HEAD': unknown revision\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getBranch(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(GitCommandFailed);
        }
      }),
    );

    it.effect("still returns 'HEAD' for actual detached HEAD (ref is not a symbolic ref)", () =>
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

    it.effect("propagates AuthError through getBranch", () =>
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
              stderr: "Permission denied (publickey).\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getBranch(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(AuthError);
        }
      }),
    );

    it.effect("propagates TimeoutError through getBranch", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new ConnectionTimeout({
              host: "testhost",
              timeoutMs: 5000,
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .getBranch(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(TimeoutError);
          const err = result.left as TimeoutError;
          expect(err._tag).toBe("TimeoutError");
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: TimeoutError export and backward compatibility
// ---------------------------------------------------------------------------
describe("TimeoutError contract compliance", () => {
  it("TimeoutError is exported and has _tag 'TimeoutError'", () => {
    const err = new TimeoutError({
      host: "testhost",
      operation: "git pull",
      stderr: "timed out",
    });
    expect(err._tag).toBe("TimeoutError");
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it("TimeoutError can be used with Effect.catchTag", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(
        new TimeoutError({ host: "h", operation: "op", stderr: "timeout" }),
      ).pipe(
        Effect.catchTag("TimeoutError", (err) =>
          Effect.succeed(`caught: ${err.operation}`),
        ),
      );
      const result = yield* effect;
      expect(result).toBe("caught: op");
    }).pipe(Effect.runPromise),
  );
});

// ---------------------------------------------------------------------------
// OTEL span recording for new error types
// ---------------------------------------------------------------------------
describe("OTEL spans for error handling", () => {
  layer(TestLayer)("span error status", (it) => {
    it.effect("records error status for NotARepository", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd /tmp/not-a-repo && git rev-parse HEAD",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: not a git repository\n",
            }),
          },
        ]);

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getHead(testHost, "/tmp/not-a-repo").pipe(Effect.either);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getHead");

        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );

    it.effect("records error status for AuthError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Authentication failed for 'https://github.com/user/repo.git'\n",
            }),
          },
        ]);

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.pull(testHost, testRepoPath).pipe(Effect.either);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.pull");

        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );

    it.effect("records error status for TimeoutError", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git push origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: unable to access: Connection timed out\n",
            }),
          },
        ]);

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.push(testHost, testRepoPath).pipe(Effect.either);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.push");

        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );
  });
});
