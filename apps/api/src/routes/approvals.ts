/**
 * Approval and break-glass API routes.
 *
 * Approval requests:
 *   GET  /api/approvals              — list all requests (filterable)
 *   POST /api/approvals              — create an approval request
 *   POST /api/approvals/:id/decide   — approve or reject a pending request
 *
 * Break-glass events:
 *   GET  /api/break-glass            — list all break-glass events
 *   POST /api/break-glass            — record a break-glass event
 *   POST /api/break-glass/:id/review — mark a break-glass event as reviewed
 *
 * Both sets of routes are file-backed via makeApprovalServiceImpl so no
 * Effect runtime is needed — the service is instantiated directly from
 * policyDir just like the upstreams router.
 */

import { Hono } from "hono";
import { Effect } from "effect";
import { makeApprovalServiceImpl } from "@shuvdex/policy-engine";
import type { ApprovalRequest, BreakGlassEvent } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

// Re-export for consumers that want to import from this module.
export type { ApprovalRequest, BreakGlassEvent };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_REQUEST_TYPES = [
  "package_approval",
  "capability_certification",
  "write_access",
  "credential_scope",
  "environment_deploy",
] as const;

const VALID_DECISIONS = ["approved", "rejected"] as const;

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Router factories
// ---------------------------------------------------------------------------

/**
 * Returns the Hono app for /api/approvals routes.
 */
export function approvalsRouter(policyDir: string): Hono {
  const svc = makeApprovalServiceImpl({ policyDir });
  const run = <A>(eff: Effect.Effect<A, Error>): Promise<A> =>
    Effect.runPromise(eff);

  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/approvals
  // List all approval requests with optional filters.
  //
  // Query params:
  //   tenantId, status, requestType
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const q = c.req.query();
      const requests = await run(
        svc.listApprovalRequests({
          tenantId: q["tenantId"],
          status: q["status"],
          requestType: q["requestType"],
        }),
      );
      return c.json(requests);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/approvals
  // Create an approval request.
  //
  // Body: Omit<ApprovalRequest, "requestId" | "requestedAt" | "status">
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (!body["tenantId"] || typeof body["tenantId"] !== "string") {
        return c.json({ error: "tenantId is required" }, 400);
      }
      if (!isOneOf(body["requestType"], VALID_REQUEST_TYPES)) {
        return c.json(
          {
            error: `requestType must be one of: ${VALID_REQUEST_TYPES.join(", ")}`,
          },
          400,
        );
      }
      if (!body["targetId"] || typeof body["targetId"] !== "string") {
        return c.json({ error: "targetId is required" }, 400);
      }
      if (!body["targetName"] || typeof body["targetName"] !== "string") {
        return c.json({ error: "targetName is required" }, 400);
      }
      if (!body["requestedBy"] || typeof body["requestedBy"] !== "string") {
        return c.json({ error: "requestedBy is required" }, 400);
      }
      if (
        !body["requestedState"] ||
        typeof body["requestedState"] !== "string"
      ) {
        return c.json({ error: "requestedState is required" }, 400);
      }

      const request = await run(
        svc.createApprovalRequest({
          tenantId: body["tenantId"],
          requestType: body["requestType"],
          targetId: body["targetId"],
          targetName: body["targetName"],
          requestedBy: body["requestedBy"],
          requestedState: body["requestedState"],
          justification:
            typeof body["justification"] === "string"
              ? body["justification"]
              : undefined,
        }),
      );
      return c.json(request, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/approvals/:id/decide
  // Approve or reject a pending approval request.
  //
  // Body: { decision: "approved" | "rejected", decidedBy: string, notes?: string }
  // -------------------------------------------------------------------------
  app.post("/:id/decide", async (c) => {
    try {
      const requestId = c.req.param("id");
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (!isOneOf(body["decision"], VALID_DECISIONS)) {
        return c.json(
          { error: `decision must be one of: ${VALID_DECISIONS.join(", ")}` },
          400,
        );
      }
      if (!body["decidedBy"] || typeof body["decidedBy"] !== "string") {
        return c.json({ error: "decidedBy is required" }, 400);
      }

      const updated = await run(
        svc.decideApprovalRequest(
          requestId,
          body["decision"],
          body["decidedBy"],
          typeof body["notes"] === "string" ? body["notes"] : undefined,
        ),
      );
      return c.json(updated);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}

/**
 * Returns the Hono app for /api/break-glass routes.
 */
export function breakGlassRouter(policyDir: string): Hono {
  const svc = makeApprovalServiceImpl({ policyDir });
  const run = <A>(eff: Effect.Effect<A, Error>): Promise<A> =>
    Effect.runPromise(eff);

  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/break-glass
  // List all break-glass events, optionally filtered by tenantId.
  //
  // Query params:
  //   tenantId
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const tenantId = c.req.query("tenantId");
      const events = await run(svc.listBreakGlassEvents(tenantId));
      return c.json(events);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/break-glass
  // Record a break-glass event.
  //
  // Body: Omit<BreakGlassEvent, "eventId" | "timestamp" | "requiresReview" | "reviewed">
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (!body["tenantId"] || typeof body["tenantId"] !== "string") {
        return c.json({ error: "tenantId is required" }, 400);
      }
      if (!body["actor"] || typeof body["actor"] !== "string") {
        return c.json({ error: "actor is required" }, 400);
      }
      if (!body["action"] || typeof body["action"] !== "string") {
        return c.json({ error: "action is required" }, 400);
      }
      if (!body["targetId"] || typeof body["targetId"] !== "string") {
        return c.json({ error: "targetId is required" }, 400);
      }
      if (
        !body["justification"] ||
        typeof body["justification"] !== "string"
      ) {
        return c.json({ error: "justification is required" }, 400);
      }

      const event = await run(
        svc.recordBreakGlass({
          tenantId: body["tenantId"],
          actor: body["actor"],
          action: body["action"],
          targetId: body["targetId"],
          justification: body["justification"],
        }),
      );
      return c.json(event, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/break-glass/:id/review
  // Mark a break-glass event as reviewed.
  //
  // Body: { reviewedBy: string }
  // -------------------------------------------------------------------------
  app.post("/:id/review", async (c) => {
    try {
      const eventId = c.req.param("id");
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (!body["reviewedBy"] || typeof body["reviewedBy"] !== "string") {
        return c.json({ error: "reviewedBy is required" }, 400);
      }

      const updated = await run(
        svc.reviewBreakGlass(eventId, body["reviewedBy"]),
      );
      return c.json(updated);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
