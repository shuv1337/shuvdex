/**
 * Control-plane authentication middleware for @shuvdex/api.
 *
 * Provides:
 * - `requireAuth(runtime)` — Bearer token verification + claims injection.
 *   Uses `resolveExternalToken` which accepts both internal HMAC JWTs and
 *   external IdP JWTs (Entra ID, Google Workspace).
 * - `requireRole(roles)` — RBAC gate that must follow `requireAuth`.
 *
 * ## Environment
 * - `DEV_MODE=true` — Bypasses all auth checks; injects default claims.
 *   **Only for local development. Never set in production.**
 */
import type { MiddlewareHandler } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import type { TokenClaims } from "@shuvdex/policy-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEV_MODE = process.env["DEV_MODE"] === "true";

/**
 * Hono context variable key for resolved token claims.
 *
 * After `requireAuth` runs successfully, downstream handlers can read the
 * authenticated caller's claims via:
 * ```ts
 * const claims = c.get(CLAIMS_KEY) as TokenClaims;
 * ```
 */
export const CLAIMS_KEY = "claims" as const;

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

/**
 * Returns a Hono middleware that authenticates every request using a Bearer
 * token in the `Authorization` header.
 *
 * Token resolution order (via `PolicyEngine.resolveExternalToken`):
 * 1. Internal HMAC JWT (issued by `issueToken`) — verified with the shared secret.
 * 2. Microsoft Entra ID JWT — verified via tenant JWKS if configured.
 * 3. Google Workspace OIDC JWT — verified via Google certs if configured.
 *
 * On success, resolved `TokenClaims` are stored on the Hono context under
 * `CLAIMS_KEY` so downstream handlers and `requireRole` can access them.
 *
 * On failure, responds with `401 Unauthorized`.
 *
 * @param runtime - Effect `Runtime` that provides `PolicyEngine`.
 *                  In the API server this is the full managed runtime cast to `any`.
 */
export function requireAuth(
  runtime: Runtime.Runtime<PolicyEngine>,
): MiddlewareHandler {
  const run = Runtime.runPromise(runtime);

  return async (c, next) => {
    // -----------------------------------------------------------------------
    // DEV_MODE bypass — inject default claims, skip verification entirely
    // -----------------------------------------------------------------------
    if (DEV_MODE) {
      const defaultClaims = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return engine.defaultClaims();
        }),
      );
      c.set(CLAIMS_KEY, defaultClaims);
      await next();
      return;
    }

    // -----------------------------------------------------------------------
    // Extract Bearer token from Authorization header
    // -----------------------------------------------------------------------
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        { error: "Unauthorized", detail: "Missing or malformed Bearer token" },
        401,
      );
    }

    const token = authHeader.slice(7).trim();
    if (token.length === 0) {
      return c.json({ error: "Unauthorized", detail: "Empty token" }, 401);
    }

    // -----------------------------------------------------------------------
    // Resolve token → claims (handles both internal and external IdP tokens)
    // -----------------------------------------------------------------------
    let claims: TokenClaims;
    try {
      claims = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.resolveExternalToken(token);
        }),
      );
    } catch {
      return c.json(
        { error: "Unauthorized", detail: "Invalid or expired token" },
        401,
      );
    }

    c.set(CLAIMS_KEY, claims);
    await next();
  };
}

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

/**
 * Returns a Hono middleware that enforces role-based access control.
 *
 * Must be applied **after** `requireAuth` in the middleware chain, because it
 * reads claims from the Hono context set by that middleware.
 *
 * Acceptance criteria (either is sufficient):
 * - `claims.role` is one of the allowed `roles`, **or**
 * - `claims.subjectType` is one of the allowed `roles` (backward-compat for
 *   tokens issued before the `role` field was added).
 *
 * In `DEV_MODE` the role check is skipped.
 *
 * @param roles - Allowed role/subjectType values.
 */
export function requireRole(roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    // DEV_MODE — skip role enforcement
    if (DEV_MODE) {
      await next();
      return;
    }

    const claims = c.get(CLAIMS_KEY) as TokenClaims | undefined;
    if (claims === undefined) {
      return c.json(
        { error: "Forbidden", detail: "No authenticated claims found — apply requireAuth first" },
        403,
      );
    }

    const effectiveRole = claims.role ?? claims.subjectType;
    if (!roles.includes(effectiveRole)) {
      return c.json(
        {
          error: "Forbidden",
          detail: "Insufficient role for this endpoint",
          required: roles,
          actual: effectiveRole,
        },
        403,
      );
    }

    await next();
  };
}
