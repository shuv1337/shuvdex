/**
 * Span creation helpers for fleet operations.
 *
 * Provides `withSpan` wrapper for Effect operations and `recordError` for
 * manually recording errors in the current span.
 */
import { Effect } from "effect";
import type { WithSpanOptions } from "./types.js";

/**
 * Wraps an Effect operation with an OTEL span.
 *
 * Creates a span with the given name and optional attributes. On success,
 * the span is marked as "ok". On failure, the span is marked as "error"
 * with exception details recorded.
 *
 * Attributes commonly include:
 * - `host` - The target host name
 * - `operation` - The operation being performed
 * - `exitCode` - The command exit code
 * - `durationMs` - The operation duration in milliseconds
 *
 * @example
 * ```ts
 * import { withSpan } from "@codex-fleet/telemetry";
 *
 * const traced = withSpan("ssh.execute", {
 *   attributes: { host: "shuvtest", operation: "git status" },
 * })(Effect.succeed("ok"));
 * ```
 */
export const withSpan =
  (name: string, options?: WithSpanOptions) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const attributes: Record<string, unknown> = options?.attributes ?? {};

    return Effect.gen(function* () {
      const startTime = Date.now();
      const result = yield* Effect.either(effect);
      const durationMs = Math.round(Date.now() - startTime);
      yield* Effect.annotateCurrentSpan("durationMs", durationMs);

      if (result._tag === "Left") {
        return yield* Effect.fail(result.left);
      }
      return result.right;
    }).pipe(
      Effect.withSpan(name, {
        attributes,
      }),
    ) as Effect.Effect<A, E, R>;
  };

/**
 * Records an error in the current span without failing the effect.
 *
 * This is useful for recording non-fatal errors or additional error context
 * in the current span.
 */
export const recordError = (
  error: Error | string,
): Effect.Effect<void> => {
  const message = typeof error === "string" ? error : error.message;
  return Effect.annotateCurrentSpan("error", message);
};
