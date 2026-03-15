import { it, expect, layer } from "@effect/vitest";
import { describe } from "vitest";
import { Effect, Ref } from "effect";
import {
  Telemetry,
  TelemetryTest,
  withSpan,
  recordError,
  CollectedSpans,
  DEFAULT_COLLECTOR_URL,
} from "../src/index.js";

describe("Telemetry", () => {
  describe("TelemetryLive", () => {
    it("exports DEFAULT_COLLECTOR_URL pointing to localhost:4318", () => {
      expect(DEFAULT_COLLECTOR_URL).toBe("http://localhost:4318");
    });
  });

  layer(TelemetryTest)("withSpan", (it) => {
    it.effect("creates a span with the given name", () =>
      Effect.gen(function* () {
        yield* withSpan("test.operation", {
          attributes: { host: "shuvtest" },
        })(Effect.succeed("ok"));

        const spans = yield* CollectedSpans;
        const collected = yield* Ref.get(spans);
        expect(collected.length).toBeGreaterThanOrEqual(1);
        const span = collected.find((s) => s.name === "test.operation");
        expect(span).toBeDefined();
      }),
    );

    it.effect("records span attributes (host, operation)", () =>
      Effect.gen(function* () {
        yield* withSpan("ssh.execute", {
          attributes: {
            host: "shuvtest",
            operation: "git status",
          },
        })(Effect.succeed("ok"));

        const spans = yield* CollectedSpans;
        const collected = yield* Ref.get(spans);
        const span = collected.find((s) => s.name === "ssh.execute");
        expect(span).toBeDefined();
        expect(span!.attributes["host"]).toBe("shuvtest");
        expect(span!.attributes["operation"]).toBe("git status");
      }),
    );

    it.effect(
      "records exitCode and durationMs attributes on success",
      () =>
        Effect.gen(function* () {
          yield* withSpan("command.run", {
            attributes: {
              host: "shuvtest",
              operation: "echo hello",
              exitCode: 0,
            },
          })(Effect.succeed("hello"));

          const spans = yield* CollectedSpans;
          const collected = yield* Ref.get(spans);
          const span = collected.find((s) => s.name === "command.run");
          expect(span).toBeDefined();
          expect(span!.attributes["exitCode"]).toBe(0);
          expect(span!.status).toBe("ok");
        }),
    );

    it.effect("records ERROR status when effect fails", () =>
      Effect.gen(function* () {
        const result = yield* withSpan("failing.operation", {
          attributes: { host: "shuvtest" },
        })(Effect.fail(new Error("connection refused"))).pipe(
          Effect.either,
        );

        expect(result._tag).toBe("Left");

        const spans = yield* CollectedSpans;
        const collected = yield* Ref.get(spans);
        const span = collected.find((s) => s.name === "failing.operation");
        expect(span).toBeDefined();
        expect(span!.status).toBe("error");
      }),
    );

    it.effect("records exception details in span on failure", () =>
      Effect.gen(function* () {
        yield* withSpan("error.details", {
          attributes: { host: "shuvbot" },
        })(Effect.fail(new Error("timeout after 30s"))).pipe(
          Effect.either,
        );

        const spans = yield* CollectedSpans;
        const collected = yield* Ref.get(spans);
        const span = collected.find((s) => s.name === "error.details");
        expect(span).toBeDefined();
        expect(span!.error).toBeDefined();
        expect(span!.error).toContain("timeout after 30s");
      }),
    );

    it.effect(
      "maintains parent-child relationships across nested spans",
      () =>
        Effect.gen(function* () {
          yield* withSpan("parent.op", {
            attributes: { host: "shuvtest" },
          })(
            withSpan("child.op", {
              attributes: { host: "shuvtest", operation: "git status" },
            })(Effect.succeed("result")),
          );

          const spans = yield* CollectedSpans;
          const collected = yield* Ref.get(spans);
          const parent = collected.find((s) => s.name === "parent.op");
          const child = collected.find((s) => s.name === "child.op");
          expect(parent).toBeDefined();
          expect(child).toBeDefined();
          // Child should have the parent's span as its parent
          expect(child!.parentSpanId).toBeDefined();
          expect(child!.parentSpanId).toBe(parent!.spanId);
        }),
    );
  });

  layer(TelemetryTest)("recordError", (it) => {
    it.effect("records error details in the current span", () =>
      Effect.gen(function* () {
        yield* withSpan("manual.error", {
          attributes: { host: "shuvtest" },
        })(
          Effect.gen(function* () {
            yield* recordError(new Error("manual error recorded"));
            return "done";
          }),
        );

        const spans = yield* CollectedSpans;
        const collected = yield* Ref.get(spans);
        const span = collected.find((s) => s.name === "manual.error");
        expect(span).toBeDefined();
        expect(span!.error).toContain("manual error recorded");
      }),
    );
  });

  layer(TelemetryTest)("Telemetry service", (it) => {
    it.effect("Telemetry service is accessible in the layer", () =>
      Effect.gen(function* () {
        const telemetry = yield* Telemetry;
        expect(telemetry).toBeDefined();
        expect(typeof telemetry.serviceName).toBe("string");
      }),
    );

    it.effect("Telemetry service has correct service name", () =>
      Effect.gen(function* () {
        const telemetry = yield* Telemetry;
        expect(telemetry.serviceName).toBe("codex-fleet");
      }),
    );
  });
});
