import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { GitOps, GitOpsLive } from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  CommandFailed,
} from "@codex-fleet/ssh";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

const testHost: HostConfig = {
  hostname: "testhost",
  connectionType: "ssh",
  port: 22,
  user: "testuser",
  timeout: 30,
};

const testRepoPath = "~/repos/test-repo";

/**
 * Combined test layer: mock SSH + test telemetry + GitOps.
 *
 * GitOpsLive requires SshExecutor, so we provide SshExecutorTest to it,
 * then merge all layers for test access.
 */
const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, GitOpsTestLayer);

describe("GitOps OTEL Tracing", () => {
  layer(TestLayer)("span creation", (it) => {
    it.effect("creates span for getHead", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getHead(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getHead");

        expect(span).toBeDefined();
        expect(span!.status).toBe("ok");
        expect(span!.attributes["host"]).toBe("testhost");
        expect(span!.attributes["operation"]).toBe("getHead");
        expect(span!.attributes["repoPath"]).toBe(testRepoPath);
      }),
    );

    it.effect("records SHA attribute on getHead span", () =>
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

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getHead(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getHead");

        expect(span).toBeDefined();
        expect(span!.attributes["git.sha"]).toBe(
          "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        );
      }),
    );

    it.effect("creates span for getBranch", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "main\n", stderr: "", exitCode: 0 },
          },
        ]);

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getBranch(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getBranch");

        expect(span).toBeDefined();
        expect(span!.status).toBe("ok");
        expect(span!.attributes["host"]).toBe("testhost");
        expect(span!.attributes["operation"]).toBe("getBranch");
        expect(span!.attributes["git.branch"]).toBe("main");
      }),
    );

    it.effect("creates span for isDirty", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.isDirty(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.isDirty");

        expect(span).toBeDefined();
        expect(span!.status).toBe("ok");
        expect(span!.attributes["host"]).toBe("testhost");
        expect(span!.attributes["operation"]).toBe("isDirty");
        expect(span!.attributes["git.dirty"]).toBe(false);
      }),
    );

    it.effect("creates span for listTags", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.listTags(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.listTags");

        expect(span).toBeDefined();
        expect(span!.status).toBe("ok");
        expect(span!.attributes["host"]).toBe("testhost");
        expect(span!.attributes["operation"]).toBe("listTags");
        expect(span!.attributes["git.tagCount"]).toBe(0);
      }),
    );

    it.effect("records error status when getHead fails", () =>
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

        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps
          .getHead(testHost, testRepoPath)
          .pipe(Effect.either);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getHead");

        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );

    it.effect("records durationMs on all spans", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.getHead(testHost, testRepoPath);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "git.getHead");

        expect(span).toBeDefined();
        expect(span!.attributes["durationMs"]).toBeDefined();
        expect(typeof span!.attributes["durationMs"]).toBe("number");
      }),
    );
  });
});
