/**
 * @shuvdex/mcp-server — Circuit breaker for upstream MCP servers
 *
 * Implements the standard three-state circuit breaker pattern to prevent
 * cascading failures when upstream MCP proxy targets are unhealthy.
 *
 * ## States
 *
 * ```
 *   [closed] ──(failures ≥ threshold)──► [open]
 *      ▲                                    │
 *      │                                    │ (resetTimeoutMs elapsed)
 *      │                                    ▼
 *      └──(success)───────────────── [half-open]
 *           half-open probe passes           │
 *                                           │ (probe fails OR max probes hit)
 *                                           ▼
 *                                         [open]
 * ```
 *
 * - **Closed**: Normal operation.  Failures are counted; when `failureThreshold`
 *   is reached the circuit opens.
 * - **Open**: All calls immediately throw `CircuitOpenError` without calling the
 *   wrapped function.  After `resetTimeoutMs` has elapsed, transitions to half-open.
 * - **Half-open**: At most `halfOpenMax` probe calls are permitted.  A successful
 *   probe resets the circuit to closed.  A failure returns it to open.
 *
 * ## Usage
 * ```typescript
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeoutMs:   30_000,
 *   halfOpenMax:      2,
 * });
 *
 * const result = await breaker.execute(() => callUpstreamMcp(tool, args));
 * ```
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Current state of a circuit breaker. */
export type CircuitState = "closed" | "open" | "half-open";

/** Thrown when a call is blocked because the circuit is open. */
export class CircuitOpenError extends Error {
  constructor() {
    super("Circuit breaker is open — upstream is unavailable");
    this.name = "CircuitOpenError";
  }
}

/**
 * Circuit breaker interface for upstream MCP server calls.
 */
export interface CircuitBreaker {
  /**
   * Execute `fn` through the circuit breaker.
   *
   * - If the circuit is **closed** or in a **half-open** probe slot, `fn` is called.
   * - If the circuit is **open** (and the reset timeout hasn't elapsed), throws
   *   `CircuitOpenError` without calling `fn`.
   *
   * A successful `fn` call resets the failure counter (and closes the circuit
   * if it was half-open).  A failing call increments the counter and may open
   * the circuit.
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Return the current circuit state.
   * Lazily transitions from `open` → `half-open` when the reset timeout elapses.
   */
  getState(): CircuitState;

  /** Manually reset the circuit to closed (e.g. after an operator confirms the upstream is healthy). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a circuit breaker.
 *
 * @param options.failureThreshold - Number of consecutive failures before the circuit opens.
 * @param options.resetTimeoutMs   - Time (ms) to wait in the open state before allowing probes.
 * @param options.halfOpenMax      - Maximum number of probe requests allowed in the half-open state.
 */
export function createCircuitBreaker(options: {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMax: number;
}): CircuitBreaker {
  const { failureThreshold, resetTimeoutMs, halfOpenMax } = options;

  let state: CircuitState = "closed";
  let failureCount = 0;
  let openedAt = 0; // ms timestamp when the circuit last opened
  let halfOpenProbes = 0;

  // ---------------------------------------------------------------------------
  // Internal state transitions
  // ---------------------------------------------------------------------------

  /** Transition to open state. */
  function open(): void {
    state = "open";
    failureCount = 0;
    halfOpenProbes = 0;
    openedAt = Date.now();
  }

  /** Transition to closed state (successful probe or normal close). */
  function close(): void {
    state = "closed";
    failureCount = 0;
    halfOpenProbes = 0;
  }

  /**
   * Lazily promote open → half-open when the reset timeout has elapsed.
   * Called on every `getState()` and at the start of `execute()`.
   */
  function maybePromoteToHalfOpen(): void {
    if (state === "open" && Date.now() - openedAt >= resetTimeoutMs) {
      state = "half-open";
      halfOpenProbes = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // CircuitBreaker implementation
  // ---------------------------------------------------------------------------

  return {
    execute<T>(fn: () => Promise<T>): Promise<T> {
      maybePromoteToHalfOpen();

      if (state === "open") {
        return Promise.reject(new CircuitOpenError());
      }

      if (state === "half-open") {
        if (halfOpenProbes >= halfOpenMax) {
          // Max probes already in-flight; treat as open
          return Promise.reject(new CircuitOpenError());
        }
        halfOpenProbes++;
      }

      return fn().then(
        (result) => {
          // Success: reset circuit
          close();
          return result;
        },
        (err: unknown) => {
          // Failure: increment counter, possibly open
          failureCount++;
          if (state === "half-open" || failureCount >= failureThreshold) {
            open();
          }
          throw err;
        },
      );
    },

    getState() {
      maybePromoteToHalfOpen();
      return state;
    },

    reset() {
      close();
      openedAt = 0;
    },
  };
}
