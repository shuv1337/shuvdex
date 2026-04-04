/**
 * Audit API routes.
 *
 * GET  /api/audit           – query runtime events with optional filters
 * GET  /api/audit/metrics   – aggregated session metrics
 * GET  /api/audit/export    – download events as JSONL
 *
 * All query parameters are optional; unrecognised ones are silently ignored.
 */

import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import type { AuditDecision, ActionClass } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

export function auditRouter(runtime: Runtime.Runtime<PolicyEngine>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/audit
  // Query runtime events with optional filters and pagination.
  //
  // Query params:
  //   tenantId, actorId, action, actionClass, decision
  //   from, to      – ISO-8601 timestamps (inclusive)
  //   limit         – max results per page (default 100, max 1000)
  //   offset        – pagination cursor (default 0)
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const q = c.req.query();

      const limit = Math.min(
        Number.isFinite(Number(q["limit"])) && Number(q["limit"]) > 0
          ? Number(q["limit"])
          : 100,
        1000,
      );
      const offset =
        Number.isFinite(Number(q["offset"])) && Number(q["offset"]) >= 0
          ? Number(q["offset"])
          : 0;

      const result = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.audit.queryEvents({
            tenantId: q["tenantId"],
            actorId: q["actorId"],
            action: q["action"],
            actionClass: q["actionClass"] as ActionClass | undefined,
            decision: q["decision"] as AuditDecision | undefined,
            from: q["from"],
            to: q["to"],
            limit,
            offset,
          });
        }),
      );

      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/audit/metrics
  // Return aggregated session metrics.
  // -------------------------------------------------------------------------
  app.get("/metrics", async (c) => {
    try {
      const metrics = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.audit.getMetrics();
        }),
      );
      return c.json(metrics);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/audit/export
  // Export events as JSONL (one JSON object per line).
  //
  // Query params:
  //   tenantId, from, to  – same semantics as /api/audit
  // -------------------------------------------------------------------------
  app.get("/export", async (c) => {
    try {
      const q = c.req.query();

      const jsonl = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          return yield* engine.audit.exportEvents({
            tenantId: q["tenantId"],
            from: q["from"],
            to: q["to"],
          });
        }),
      );

      return new Response(jsonl, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.jsonl"`,
        },
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/audit/legacy
  // Backward-compatible listing of AuditEvent[] (old format).
  // -------------------------------------------------------------------------
  app.get("/legacy", async (c) => {
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
