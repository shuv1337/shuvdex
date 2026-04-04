/**
 * Correlation ID utilities.
 *
 * Uses AsyncLocalStorage to propagate a correlation ID across async
 * boundaries without explicit parameter threading.  Callers that start a
 * new logical operation (e.g. an MCP request handler) should wrap their
 * work with `withCorrelation`.  Deeper callees can retrieve the active ID
 * with `getCurrentCorrelationId`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Generate a new random correlation ID (UUID v4).
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Return the correlation ID propagated by the nearest enclosing
 * `withCorrelation` call, or `undefined` if none is active.
 */
export function getCurrentCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

/**
 * Run `fn` with `id` set as the active correlation ID.
 *
 * The ID is propagated to all async children started within `fn` via
 * AsyncLocalStorage.  The previous value (if any) is restored when `fn`
 * completes.
 *
 * @example
 * ```typescript
 * const id = generateCorrelationId();
 * const result = await withCorrelation(id, async () => {
 *   // getCurrentCorrelationId() === id here
 *   return doWork();
 * });
 * ```
 */
export function withCorrelation<T>(id: string, fn: () => T): T {
  return correlationStorage.run(id, fn);
}
