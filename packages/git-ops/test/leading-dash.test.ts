/**
 * Regression tests for leading-dash ref rejection.
 *
 * Git refs cannot start with '-', so values like `--detach`, `-b`, etc.
 * must be rejected with InvalidRefError before reaching the git CLI.
 * This prevents flag-injection attacks (e.g., `git checkout --detach`).
 */
import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";
import {
  GitOps,
  GitOpsLive,
  InvalidRefError,
} from "../src/index.js";
import {
  SshExecutorTest,
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

const testHost: HostConfig = {
  hostname: "testhost",
  connectionType: "ssh",
  port: 22,
  user: "testuser",
  timeout: 30,
};

const testRepoPath = "~/repos/test-repo";

const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, GitOpsTestLayer);

// ---------------------------------------------------------------------------
// checkoutRef: leading-dash rejection
// ---------------------------------------------------------------------------
describe("checkoutRef rejects refs starting with dash", () => {
  layer(TestLayer)("double-dash flags", (it) => {
    it.effect("rejects --detach", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "--detach")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err._tag).toBe("InvalidRefError");
          expect(err.ref).toBe("--detach");
          expect(err.reason).toContain("must not start with '-'");
        }
      }),
    );

    it.effect("rejects --force", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "--force")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("--force");
        }
      }),
    );

    it.effect("rejects --orphan", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "--orphan")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("--orphan");
        }
      }),
    );

    it.effect("rejects --merge", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "--merge")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
        }
      }),
    );
  });

  layer(TestLayer)("single-dash flags", (it) => {
    it.effect("rejects -b", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "-b")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("-b");
          expect(err.reason).toContain("must not start with '-'");
        }
      }),
    );

    it.effect("rejects -B", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "-B")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("-B");
        }
      }),
    );

    it.effect("rejects -f", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .checkoutRef(testHost, testRepoPath, "-f")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
        }
      }),
    );
  });

  layer(TestLayer)("valid refs still work", (it) => {
    it.effect("accepts normal branch name", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        // Should not throw — normal refs are fine
        yield* gitOps.checkoutRef(testHost, testRepoPath, "main");
      }),
    );

    it.effect("accepts branch with slash", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "feature/my-branch");
      }),
    );

    it.effect("accepts SHA", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(
          testHost,
          testRepoPath,
          "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        );
      }),
    );

    it.effect("accepts tag name with inner dash", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "v1.0-beta");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createTag: leading-dash rejection for tag name
// ---------------------------------------------------------------------------
describe("createTag rejects tag names starting with dash", () => {
  layer(TestLayer)("double-dash flags in tag name", (it) => {
    it.effect("rejects --delete", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "--delete")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err._tag).toBe("InvalidRefError");
          expect(err.ref).toBe("--delete");
          expect(err.reason).toContain("must not start with '-'");
        }
      }),
    );

    it.effect("rejects --verify", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "--verify")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("--verify");
        }
      }),
    );

    it.effect("rejects --list", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "--list")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
        }
      }),
    );
  });

  layer(TestLayer)("single-dash flags in tag name", (it) => {
    it.effect("rejects -d", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "-d")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("-d");
        }
      }),
    );

    it.effect("rejects -a", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "-a")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
        }
      }),
    );
  });

  layer(TestLayer)("leading-dash in ref argument", (it) => {
    it.effect("rejects --amend as ref", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "v1.0", "--amend")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("--amend");
        }
      }),
    );

    it.effect("rejects -f as ref", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .createTag(testHost, testRepoPath, "v1.0", "-f")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(InvalidRefError);
          const err = result.left as InvalidRefError;
          expect(err.ref).toBe("-f");
        }
      }),
    );
  });

  layer(TestLayer)("valid tag names still work", (it) => {
    it.effect("accepts normal tag name", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0.0");
      }),
    );

    it.effect("accepts tag with inner dash", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "release-2024-01");
      }),
    );

    it.effect("accepts tag with ref containing inner dash", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0", "abc-123");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// InvalidRefError error shape
// ---------------------------------------------------------------------------
describe("InvalidRefError", () => {
  it("has correct _tag and fields", () => {
    const err = new InvalidRefError({
      ref: "--detach",
      reason: "ref must not start with '-'",
    });
    expect(err._tag).toBe("InvalidRefError");
    expect(err.ref).toBe("--detach");
    expect(err.reason).toBe("ref must not start with '-'");
    expect(err.message).toContain("--detach");
    expect(err.message).toContain("must not start with '-'");
  });

  it("includes the ref in error message", () => {
    const err = new InvalidRefError({
      ref: "-b",
      reason: "ref must not start with '-'",
    });
    expect(err.message).toBe("Invalid ref '-b': ref must not start with '-'");
  });
});
