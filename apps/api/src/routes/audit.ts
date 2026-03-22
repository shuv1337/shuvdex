import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

export function auditRouter(runtime: Runtime.Runtime<PolicyEngine>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const events = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.listAuditEvents();
        }),
      );
      return c.json(events);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
