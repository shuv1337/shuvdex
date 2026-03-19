import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { PolicyEngine, PolicyEngineLive } from "../src/index.js";

describe("PolicyEngine", () => {
  it("issues and verifies fleet tokens", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* PolicyEngine;
        const issued = yield* engine.issueToken({
          subjectType: "service",
          subjectId: "tester",
          scopes: ["fleet:read"],
        });
        return yield* engine.verifyToken(issued.token);
      }).pipe(Effect.provide(PolicyEngineLive)),
    );

    expect(result.subjectId).toBe("tester");
    expect(result.scopes).toContain("fleet:read");
  });
});
