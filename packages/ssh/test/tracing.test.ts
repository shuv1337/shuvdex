import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import {
  SshExecutor,
  SshExecutorLive,
} from "../src/index.js";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

/**
 * Host config pointing to a real SSH host for tracing tests.
 * Uses shuvtest which is confirmed accessible.
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/**
 * Live SSH executor + test telemetry for integration tests.
 */
const IntegrationLayer = Layer.merge(SshExecutorLive, TelemetryTest);

/**
 * Helper to get the most recently added span with a given name.
 */
function findLatestSpan(
  spans: Array<{ name: string; [key: string]: unknown }>,
  name: string,
) {
  // Return the last matching span (most recent)
  for (let i = spans.length - 1; i >= 0; i--) {
    if (spans[i].name === name) return spans[i];
  }
  return undefined;
}

describe("SSH OTEL Tracing (integration)", () => {
  layer(IntegrationLayer)("span creation", (it) => {
    it.effect("creates a span for successful command execution", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const executor = yield* SshExecutor;
        yield* executor.executeCommand(shuvtestHost, "echo traced");

        const spansAfter = yield* Ref.get(spansRef);
        expect(spansAfter.length).toBeGreaterThan(countBefore);

        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "ssh.executeCommand");

        expect(span).toBeDefined();
        expect(span!.status).toBe("ok");
        expect(span!.attributes["host"]).toBe("shuvtest");
        expect(span!.attributes["command"]).toBe("echo traced");
        expect(span!.attributes["exitCode"]).toBe(0);
      }),
    );

    it.effect("records host, command, port, and timeout as span attributes", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const executor = yield* SshExecutor;
        yield* executor.executeCommand(shuvtestHost, "hostname");

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "ssh.executeCommand");

        expect(span).toBeDefined();
        expect(span!.attributes["host"]).toBe("shuvtest");
        expect(span!.attributes["command"]).toBe("hostname");
        expect(span!.attributes["port"]).toBe(22);
        expect(span!.attributes["ssh.timeout_ms"]).toBeDefined();
      }),
    );

    it.effect("records ERROR status when command fails", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const executor = yield* SshExecutor;
        const result = yield* executor
          .executeCommand(shuvtestHost, "exit 42")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "ssh.executeCommand");

        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );

    it.effect("records exit code attribute even for failed commands", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        const spansBefore = yield* Ref.get(spansRef);
        const countBefore = spansBefore.length;

        const executor = yield* SshExecutor;
        yield* executor
          .executeCommand(shuvtestHost, "exit 1")
          .pipe(Effect.either);

        const spansAfter = yield* Ref.get(spansRef);
        const newSpans = spansAfter.slice(countBefore);
        const span = newSpans.find((s) => s.name === "ssh.executeCommand");

        expect(span).toBeDefined();
        expect(span!.attributes["exitCode"]).toBe(1);
      }),
    );
  });
});
