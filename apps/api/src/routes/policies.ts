import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import type { CapabilitySubjectPolicy } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

export function policiesRouter(runtime: Runtime.Runtime<PolicyEngine>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const policies = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.listPolicies();
        }),
      );
      return c.json(policies);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.put("/:policyId", async (c) => {
    try {
      const body = (await c.req.json()) as Partial<CapabilitySubjectPolicy>;
      const policyId = c.req.param("policyId");
      const policy = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.upsertPolicy({
            id: policyId,
            description: body.description ?? policyId,
            scopes: body.scopes ?? [],
            hostTags: body.hostTags ?? [],
            clientTags: body.clientTags ?? [],
            allowPackages: body.allowPackages ?? [],
            denyPackages: body.denyPackages ?? [],
            allowCapabilities: body.allowCapabilities ?? [],
            denyCapabilities: body.denyCapabilities ?? [],
            maxRiskLevel: body.maxRiskLevel,
          });
        }),
      );
      return c.json(policy);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.delete("/:policyId", async (c) => {
    try {
      await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          yield* engine.deletePolicy(c.req.param("policyId"));
        }),
      );
      return c.json({ deleted: true });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
