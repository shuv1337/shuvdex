/**
 * Session security tests (Phase 4D)
 *
 * Verifies session lifecycle security:
 *  - Expired sessions (token TTL exhausted) are rejected
 *  - The audit service correctly tracks event counts and metrics
 *  - Token revocation takes effect immediately in the same session
 *  - Circuit-breaker pattern: multiple auth failures in a row are all rejected
 *    (no back-door that opens after N attempts)
 *  - Rate-limiting analog: verify the policy engine consistently denies
 *    after every revocation, not just the first attempt
 *
 * Uses the real PolicyEngineLive service throughout.
 */
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-session-test-"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Session security", () => {
  describe("expired session handling", () => {
    it("expired token is rejected — analogous to 404 on expired session", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Issue a token that expires immediately (ttlSeconds = 0 → expiresAt == issuedAt)
          const { token } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "session-expiry-user",
            scopes: ["capabilities:read"],
            ttlSeconds: 0,
          });

          // Attempt to verify → must fail
          return yield* Effect.either(engine.verifyToken(token));
        }).pipe(Effect.provide(layer)),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.reason.toLowerCase()).toContain("expired");
      }
    });

    it("a short-lived token cannot be re-used after issue + expire cycle", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Issue a valid 30-minute token
          const { token: validToken } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "session-cycle-user",
            scopes: ["capabilities:read"],
            ttlSeconds: 1800,
          });

          // Issue an already-expired token
          const { token: expiredToken } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "session-cycle-user",
            scopes: ["capabilities:read"],
            ttlSeconds: -1,
          });

          const validResult = yield* Effect.either(engine.verifyToken(validToken));
          const expiredResult = yield* Effect.either(engine.verifyToken(expiredToken));

          return { validResult, expiredResult };
        }).pipe(Effect.provide(layer)),
      );

      // Valid token should be accepted
      expect(outcomes.validResult._tag).toBe("Right");
      // Expired token must be rejected
      expect(outcomes.expiredResult._tag).toBe("Left");
    });
  });

  describe("revocation is immediate and persistent", () => {
    it("revoked token is rejected on every subsequent verification attempt", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          const { token, claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "persistent-revoke-user",
            scopes: ["capabilities:read"],
            ttlSeconds: 3600,
          });

          // Revoke once
          yield* engine.revokeToken(claims.jti);

          // Attempt 1 → must fail
          const attempt1 = yield* Effect.either(engine.verifyToken(token));
          // Attempt 2 → must also fail (no reset after first rejection)
          const attempt2 = yield* Effect.either(engine.verifyToken(token));
          // Attempt 3 → still fails
          const attempt3 = yield* Effect.either(engine.verifyToken(token));

          return [attempt1, attempt2, attempt3];
        }).pipe(Effect.provide(layer)),
      );

      // All three attempts must be rejected
      for (const result of results) {
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left.reason.toLowerCase()).toContain("revoked");
        }
      }
    });

    it("revoking one token does not invalidate other tokens from the same subject", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const { revokedResult, validResult } = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Issue two separate tokens for the same subject
          const { token: tokenA, claims: claimsA } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "multi-token-user",
            scopes: ["capabilities:read"],
            ttlSeconds: 3600,
          });
          const { token: tokenB } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "multi-token-user",
            scopes: ["capabilities:read"],
            ttlSeconds: 3600,
          });

          // Revoke only token A
          yield* engine.revokeToken(claimsA.jti);

          const revokedResult = yield* Effect.either(engine.verifyToken(tokenA));
          const validResult = yield* Effect.either(engine.verifyToken(tokenB));

          return { revokedResult, validResult };
        }).pipe(Effect.provide(layer)),
      );

      expect(revokedResult._tag).toBe("Left");  // token A is revoked
      expect(validResult._tag).toBe("Right");   // token B is still valid
    });
  });

  describe("repeated failure behavior (circuit-breaker analog)", () => {
    it("consistently rejects all invalid tokens — no back-door after N failures", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      // Simulate an attacker making 10 rapid attempts with garbage tokens
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const outcomes: boolean[] = [];

          for (let i = 0; i < 10; i++) {
            const result = yield* Effect.either(
              engine.verifyToken(`garbage-token-attempt-${i}`),
            );
            outcomes.push(result._tag === "Left");
          }

          return outcomes;
        }).pipe(Effect.provide(layer)),
      );

      // Every single attempt must be rejected — no "successful" attempt among them
      expect(results.every((rejected) => rejected)).toBe(true);
      expect(results).toHaveLength(10);
    });

    it("consecutive expired token attempts are all rejected", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const allRejected = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Issue 5 expired tokens and attempt to verify each
          const tokens: string[] = [];
          for (let i = 0; i < 5; i++) {
            const { token } = yield* engine.issueToken({
              subjectType: "user",
              subjectId: `expired-user-${i}`,
              scopes: ["capabilities:read"],
              ttlSeconds: -60,
            });
            tokens.push(token);
          }

          const results = yield* Effect.all(
            tokens.map((t) => Effect.either(engine.verifyToken(t))),
          );

          return results.every((r) => r._tag === "Left");
        }).pipe(Effect.provide(layer)),
      );

      expect(allRejected).toBe(true);
    });
  });

  describe("audit metrics track session events", () => {
    it("records and counts audit events correctly", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const metrics = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const audit = engine.audit;

          // Record 3 tool calls and 1 token verification
          for (let i = 0; i < 3; i++) {
            yield* audit.recordRuntimeEvent({
              actor: { subjectId: `user-${i}`, subjectType: "user" },
              action: "tool_call",
              actionClass: "read",
              decision: "allow",
              decisionReason: "authorized",
            });
          }
          yield* audit.recordRuntimeEvent({
            actor: { subjectId: "service", subjectType: "service" },
            action: "token_verify",
            actionClass: "read",
            decision: "allow",
            decisionReason: "valid token",
          });

          return yield* audit.getMetrics();
        }).pipe(Effect.provide(layer)),
      );

      expect(metrics.totalEvents).toBe(4);
      expect(metrics.eventsByAction["tool_call"]).toBe(3);
      expect(metrics.eventsByAction["token_verify"]).toBe(1);
      expect(metrics.eventsByDecision["allow"]).toBe(4);
      expect(metrics.errorRate).toBe(0);
    });

    it("error rate increases when outcome.status is error", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const metrics = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const audit = engine.audit;

          // 1 success, 1 error
          yield* audit.recordRuntimeEvent({
            actor: { subjectId: "user-ok", subjectType: "user" },
            action: "tool_call",
            actionClass: "read",
            decision: "allow",
            decisionReason: "ok",
            outcome: { status: "success", latencyMs: 42 },
          });
          yield* audit.recordRuntimeEvent({
            actor: { subjectId: "user-err", subjectType: "user" },
            action: "tool_call",
            actionClass: "external",
            decision: "allow",
            decisionReason: "attempted",
            outcome: { status: "error", latencyMs: 500, errorClass: "UpstreamTimeout" },
          });

          return yield* audit.getMetrics();
        }).pipe(Effect.provide(layer)),
      );

      expect(metrics.totalEvents).toBe(2);
      expect(metrics.errorRate).toBe(0.5); // 1 error out of 2 total
      expect(metrics.avgLatencyMs).toBe(271); // (42 + 500) / 2
    });
  });
});
