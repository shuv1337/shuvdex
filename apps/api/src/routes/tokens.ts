import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import type { IssueTokenInput } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

export function tokensRouter(runtime: Runtime.Runtime<PolicyEngine>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  app.post("/", async (c) => {
    try {
      const body = (await c.req.json()) as IssueTokenInput;
      const token = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.issueToken(body);
        }),
      );
      return c.json(token, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.post("/verify", async (c) => {
    try {
      const body = (await c.req.json()) as { token: string };
      const claims = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.verifyToken(body.token);
        }),
      );
      return c.json(claims);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.post("/revoke", async (c) => {
    try {
      const body = (await c.req.json()) as { jti: string };
      await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          yield* engine.revokeToken(body.jti);
        }),
      );
      return c.json({ revoked: true });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
