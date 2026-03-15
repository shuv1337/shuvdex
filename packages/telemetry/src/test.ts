/**
 * Test telemetry layer that captures spans in memory for assertions.
 *
 * Provides a custom Effect Tracer that stores span data in a Ref,
 * allowing tests to verify span creation, attributes, and relationships.
 */
import { Effect, Layer, Ref, Tracer, Option, Exit } from "effect";
import { Telemetry, CollectedSpans } from "./types.js";
import type { CollectedSpan } from "./types.js";

/**
 * Creates a test tracer that collects spans into a Ref.
 */
const makeTestTracer = (
  spansRef: Ref.Ref<Array<CollectedSpan>>,
): Tracer.Tracer =>
  Tracer.make({
    span: (name, parent, context, links, startTime, kind) => {
      const spanId = Math.random().toString(36).substring(2, 18);
      const spanAttributes = new Map<string, unknown>();
      let status: "ok" | "error" | "unset" = "unset";
      let error: string | undefined;

      const parentSpanId = Option.isSome(parent)
        ? parent.value.spanId
        : undefined;

      const traceId = Option.isSome(parent)
        ? parent.value.traceId
        : Math.random().toString(36).substring(2, 34);

      const span: Tracer.Span = {
        _tag: "Span",
        name,
        spanId,
        traceId,
        parent,
        context,
        links: [...links],
        sampled: true,
        status: {
          _tag: "Started",
          startTime,
        },
        attributes: spanAttributes as ReadonlyMap<string, unknown>,
        kind,
        attribute(key: string, value: unknown) {
          spanAttributes.set(key, value);
        },
        event(_name: string, _startTime: bigint, _attrs?: Record<string, unknown>) {
          // no-op for test
        },
        addLinks(_newLinks: ReadonlyArray<Tracer.SpanLink>) {
          // no-op for test
        },
        end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
          // Determine status from exit
          if (Exit.isSuccess(exit)) {
            status = "ok";
          } else {
            status = "error";
            const cause = exit.cause;
            error = extractErrorMessage(cause);
          }

          // Check for manually recorded error in attributes
          const attrError = spanAttributes.get("error");
          if (attrError && !error) {
            error = String(attrError);
          }
          // If error was manually set via attribute, also mark as having error info
          if (attrError && status === "ok") {
            error = String(attrError);
          }

          // Push to collected spans
          const collected: CollectedSpan = {
            name,
            attributes: Object.fromEntries(spanAttributes),
            status,
            error,
            spanId,
            parentSpanId,
            startTime: Number(startTime),
            endTime: Number(endTime),
          };

          Effect.runSync(
            Ref.update(spansRef, (spans) => [...spans, collected]),
          );
        },
      };

      return span;
    },
    context: (f) => f(),
  });

/**
 * Extract error message from an Effect Cause.
 */
function extractErrorMessage(cause: unknown): string {
  if (cause === null || cause === undefined) return "unknown error";

  const c = cause as {
    _tag?: string;
    error?: unknown;
    left?: unknown;
    right?: unknown;
  };

  if (c._tag === "Fail" && c.error !== undefined) {
    if (c.error instanceof Error) return c.error.message;
    if (typeof c.error === "string") return c.error;
    return String(c.error);
  }

  if (c._tag === "Die" && c.error !== undefined) {
    if (c.error instanceof Error) return c.error.message;
    return String(c.error);
  }

  if (c._tag === "Sequential" || c._tag === "Parallel") {
    const left = extractErrorMessage(c.left);
    if (left !== "unknown error") return left;
    return extractErrorMessage(c.right);
  }

  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;

  return String(cause);
}

/**
 * Test telemetry layer that captures spans in memory.
 *
 * Provides:
 * - Telemetry service with test configuration
 * - A custom Effect Tracer that records spans
 * - CollectedSpans ref for asserting on captured spans
 */
export const TelemetryTest: Layer.Layer<Telemetry | CollectedSpans> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const spansRef = yield* Ref.make<Array<CollectedSpan>>([]);
      const testTracer = makeTestTracer(spansRef);

      return Layer.mergeAll(
        Layer.succeed(Telemetry, {
          serviceName: "codex-fleet",
          collectorUrl: "http://localhost:4318",
        }),
        Layer.succeed(CollectedSpans, spansRef),
        Layer.setTracer(testTracer),
      );
    }),
  );
