/**
 * Auth failure security tests (Phase 4D)
 *
 * Exercises the policy engine token lifecycle for the full set of failure modes:
 *  - expired tokens
 *  - tokens signed with a different key (cross-key / wrong audience analog)
 *  - revoked tokens
 *  - malformed / non-JWT input
 *
 * Uses the real PolicyEngineLive service backed by temp directories so there
 * is no mocking of the authorization logic.
 */
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  makePolicyEngineLive,
  PolicyEngine,
  InvalidTokenError,
} from "@shuvdex/policy-engine";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-auth-test-"));
}

// Run an Effect that is expected to fail with InvalidTokenError.
// Returns the error so the caller can assert on the reason.
async function expectTokenFailure(
  program: Effect.Effect<unknown, InvalidTokenError>,
  layer: ReturnType<typeof makePolicyEngineLive>,
): Promise<InvalidTokenError> {
  const result = await Effect.runPromise(
    Effect.either(program).pipe(Effect.provide(layer)),
  );
  if (result._tag !== "Left") {
    throw new Error(
      `Expected token verification to fail but it succeeded: ${JSON.stringify(result.right)}`,
    );
  }
  return result.left;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth failure scenarios", () => {
  it("rejects expired tokens", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        // ttlSeconds: -10 → expiresAt is already 10 seconds in the past
        const { token } = yield* engine.issueToken({
          subjectType: "service",
          subjectId: "expiry-test-subject",
          scopes: ["capabilities:read"],
          ttlSeconds: -10,
        });
        return yield* engine.verifyToken(token);
      }),
      layer,
    );

    expect(error._tag).toBe("InvalidTokenError");
    expect(error.reason.toLowerCase()).toContain("expired");
  });

  it("rejects tokens signed with a different key (wrong audience equivalent)", async () => {
    // In this system, audience enforcement is expressed as signature key binding.
    // A token issued by one instance cannot be verified by another instance
    // with a different signing secret — the analog of "wrong audience".
    const layerAlpha = makePolicyEngineLive({
      policyDir: makeTmpDir(),
      secret: "signing-key-alpha",
    });
    const layerBeta = makePolicyEngineLive({
      policyDir: makeTmpDir(),
      secret: "signing-key-beta",
    });

    // Issue with alpha key
    const { token } = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        return yield* engine.issueToken({
          subjectType: "service",
          subjectId: "cross-key-subject",
          scopes: ["*"],
        });
      }).pipe(Effect.provide(layerAlpha)),
    );

    // Verify with beta key — must fail
    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        return yield* engine.verifyToken(token);
      }),
      layerBeta,
    );

    expect(error._tag).toBe("InvalidTokenError");
    expect(error.reason.toLowerCase()).toContain("signature");
  });

  it("rejects revoked tokens", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;

        // Issue a valid long-lived token
        const { token, claims } = yield* engine.issueToken({
          subjectType: "user",
          subjectId: "revoke-test-user",
          scopes: ["capabilities:read"],
          ttlSeconds: 3600,
        });

        // Revoke it immediately
        yield* engine.revokeToken(claims.jti);

        // Attempt to verify the now-revoked token
        return yield* engine.verifyToken(token);
      }),
      layer,
    );

    expect(error._tag).toBe("InvalidTokenError");
    expect(error.reason.toLowerCase()).toContain("revoked");
  });

  it("rejects malformed tokens — not a 3-part JWT", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        // A single string with no dots cannot be split into header.payload.sig
        return yield* engine.verifyToken("notavalidjwtatall");
      }),
      layer,
    );

    expect(error._tag).toBe("InvalidTokenError");
    expect(error.reason.toLowerCase()).toContain("3-part");
  });

  it("rejects malformed tokens — truncated JWT (two parts only)", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        // Two-part string: header.payload (missing signature)
        return yield* engine.verifyToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0");
      }),
      layer,
    );

    expect(error._tag).toBe("InvalidTokenError");
    // Either "3-part" or "signature" error is acceptable — both indicate rejection
    expect(
      error.reason.toLowerCase().includes("3-part") ||
      error.reason.toLowerCase().includes("signature"),
    ).toBe(true);
  });

  it("rejects tokens with a valid structure but tampered payload", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    // Issue a genuine token, then tamper with the claims part
    const genuineToken = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        const { token } = yield* engine.issueToken({
          subjectType: "service",
          subjectId: "tamper-test",
          scopes: ["capabilities:read"],
          ttlSeconds: 3600,
        });
        return token;
      }).pipe(Effect.provide(layer)),
    );

    // Replace the payload with a tampered one (elevated scopes)
    const [header, , sig] = genuineToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ subjectId: "attacker", scopes: ["*"], expiresAt: 9999999999 }),
    ).toString("base64url");
    const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

    const error = await expectTokenFailure(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        return yield* engine.verifyToken(tamperedToken);
      }),
      layer,
    );

    expect(error._tag).toBe("InvalidTokenError");
    expect(error.reason.toLowerCase()).toContain("signature");
  });

  it("allows valid, non-expired, non-revoked tokens", async () => {
    const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

    const claims = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        const { token } = yield* engine.issueToken({
          subjectType: "user",
          subjectId: "happy-path-user",
          scopes: ["capabilities:read", "capabilities:write"],
          ttlSeconds: 3600,
        });
        return yield* engine.verifyToken(token);
      }).pipe(Effect.provide(layer)),
    );

    expect(claims.subjectId).toBe("happy-path-user");
    expect(claims.scopes).toContain("capabilities:read");
    expect(claims.scopes).toContain("capabilities:write");
  });
});
