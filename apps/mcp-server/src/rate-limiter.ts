/**
 * @shuvdex/mcp-server — Sliding-window rate limiter
 *
 * Provides per-tenant, per-user, and per-capability rate limiting for the
 * MCP HTTP endpoint.
 *
 * ## Algorithm
 * Each limiter uses a **sliding window counter**: an array of request
 * timestamps per key is maintained in memory.  On each `check()` call:
 * 1. Timestamps older than `windowMs` are pruned.
 * 2. If the remaining count is below the limit, the timestamp is recorded
 *    and `true` is returned (request allowed).
 * 3. Otherwise `false` is returned (request denied) without recording.
 *
 * `remaining()` returns the available quota without mutating state.
 *
 * ## Header conventions
 * The HTTP layer should include the following headers on every /mcp response:
 *   `X-RateLimit-Limit`      — configured max
 *   `X-RateLimit-Remaining`  — quota left in the current window
 *   `X-RateLimit-Reset`      — UNIX seconds when the window resets (approx.)
 *   `Retry-After`            — seconds to wait when 429 is returned
 *
 * ## Memory
 * Timestamps accumulate until they fall outside the window.  At high request
 * rates with a large window, memory usage scales as O(limit × windowMs / avg_rps).
 * For typical shuvdex workloads (≤500 req/min per tenant) this is negligible.
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Configuration for all three rate-limiter dimensions. */
export interface RateLimiterConfig {
  /** Maximum requests per window per tenant. */
  maxPerTenant: number;
  /** Maximum requests per window per user (subject). */
  maxPerUser: number;
  /** Maximum requests per window per capability (tool/resource/prompt ID). */
  maxPerCapability: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
}

/**
 * Single-dimension rate limiter.  Keys are opaque strings (tenantId, subjectId,
 * or capabilityId depending on which limiter is used).
 */
export interface RateLimiter {
  /**
   * Check whether the request is within the rate limit.
   *
   * - Returns `true` if allowed (and records the request).
   * - Returns `false` if the limit is exceeded (request NOT recorded).
   */
  check(key: string): boolean;

  /**
   * Return the number of requests remaining in the current window for `key`.
   * Does **not** consume quota.
   */
  remaining(key: string): number;

  /**
   * Return the approximate UNIX timestamp (seconds) when the window resets.
   * Useful for the `X-RateLimit-Reset` / `Retry-After` response headers.
   */
  resetAt(key: string): number;

  /** The configured maximum for this limiter. */
  readonly max: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a single sliding-window rate limiter with the given limit and window.
 */
function makeWindowLimiter(max: number, windowMs: number): RateLimiter {
  /** Timestamps (ms) of recorded requests, keyed by limiter key. */
  const windows = new Map<string, number[]>();

  /** Prune timestamps older than the window boundary and return the live list. */
  function live(key: string, now: number): number[] {
    const raw = windows.get(key) ?? [];
    const boundary = now - windowMs;
    const pruned = raw.filter((ts) => ts > boundary);
    if (pruned.length !== raw.length) {
      if (pruned.length === 0) {
        windows.delete(key);
      } else {
        windows.set(key, pruned);
      }
    }
    return pruned;
  }

  return {
    max,

    check(key) {
      const now = Date.now();
      const ts = live(key, now);
      if (ts.length >= max) return false;
      // Record this request
      ts.push(now);
      windows.set(key, ts);
      return true;
    },

    remaining(key) {
      const now = Date.now();
      const ts = live(key, now);
      return Math.max(0, max - ts.length);
    },

    resetAt(key) {
      const now = Date.now();
      const ts = live(key, now);
      if (ts.length === 0) {
        // No requests recorded — window has effectively already reset
        return Math.floor((now + windowMs) / 1000);
      }
      // Oldest timestamp in the window plus windowMs is when it exits the window
      const oldest = ts[0] ?? now;
      return Math.floor((oldest + windowMs) / 1000);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create three rate limiters (tenant / user / capability) sharing the same
 * window size but with independent per-dimension limits.
 *
 * @example
 * ```typescript
 * const rl = createRateLimiter({
 *   maxPerTenant:     500,
 *   maxPerUser:       100,
 *   maxPerCapability:  50,
 *   windowMs:         60_000, // 1 minute
 * });
 *
 * // In request handler:
 * if (!rl.tenant.check(tenantId)) {
 *   return c.json({ error: "Tenant rate limit exceeded" }, 429);
 * }
 * const remaining = rl.user.remaining(subjectId);
 * c.header("X-RateLimit-Remaining", String(remaining));
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig): {
  tenant: RateLimiter;
  user: RateLimiter;
  capability: RateLimiter;
} {
  return {
    tenant: makeWindowLimiter(config.maxPerTenant, config.windowMs),
    user: makeWindowLimiter(config.maxPerUser, config.windowMs),
    capability: makeWindowLimiter(config.maxPerCapability, config.windowMs),
  };
}
