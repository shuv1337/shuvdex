/**
 * Dashboard aggregate API routes — /api/dashboard
 *
 * These routes provide pre-aggregated data for the governance dashboard,
 * reducing the number of round-trips the frontend needs to make.
 *
 * GET /api/dashboard/summary        – aggregate stats across all services
 * GET /api/dashboard/audit-timeline – recent audit events binned by hour
 * GET /api/dashboard/health-overview – all upstream health statuses
 */

import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine } from "@shuvdex/policy-engine";
import { CapabilityRegistry } from "@shuvdex/capability-registry";
import { CredentialStore } from "@shuvdex/credential-store";
import { listUpstreamRegistrations } from "./upstreams.js";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DashboardRuntime = Runtime.Runtime<
  PolicyEngine | CapabilityRegistry | CredentialStore
>;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function dashboardRouter(
  runtime: DashboardRuntime,
  upstreamsDir: string,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/dashboard/summary
  //
  // Aggregated dashboard summary across all services.
  // Returns:
  //   tenantCount, activeConnectors, upstreamCount, healthyUpstreams,
  //   totalPolicies, totalCredentials, pendingApprovals,
  //   uptimePercent, auditMetrics, generatedAt
  // -------------------------------------------------------------------------
  app.get("/summary", async (c) => {
    try {
      const upstreams = listUpstreamRegistrations(upstreamsDir);
      const healthyUpstreams = upstreams.filter(
        (u) => u.healthStatus === "healthy",
      ).length;
      const degradedUpstreams = upstreams.filter(
        (u) => u.healthStatus === "degraded",
      ).length;

      const result = await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          const engine = yield* PolicyEngine;
          const store = yield* CredentialStore;

          const packages = yield* registry.listPackages();
          const policies = yield* engine.listPolicies();
          const credentials = yield* store.listCredentials();
          const metrics = yield* engine.audit.getMetrics();
          const bindings = yield* store.listBindings();

          // Compute a rough compliance / governance posture score (0–100).
          // Each deduction represents a governance gap.
          let score = 100;
          if (upstreams.length > 0) {
            const unhealthy = upstreams.filter(
              (u) => u.healthStatus === "unhealthy",
            ).length;
            const untrusted = upstreams.filter(
              (u) => u.trustState === "untrusted",
            ).length;
            const pending = upstreams.filter(
              (u) => u.trustState === "pending_review",
            ).length;
            score -= unhealthy * 10;
            score -= untrusted * 5;
            score -= pending * 3;
          }
          if (policies.length === 0) score -= 15;
          if (metrics.totalEvents === 0) score -= 10;
          if (credentials.length === 0 && packages.length > 0) score -= 5;
          score = Math.max(0, Math.min(100, score));

          return {
            tenantCount: 1, // single-tenant in current deployment
            activeConnectors: packages.length,
            upstreamCount: upstreams.length,
            healthyUpstreams,
            degradedUpstreams,
            unhealthyUpstreams:
              upstreams.length - healthyUpstreams - degradedUpstreams,
            totalPolicies: policies.length,
            totalCredentials: credentials.length,
            totalBindings: bindings.length,
            pendingApprovals: 0, // placeholder — approval workflow not yet implemented
            governanceScore: score,
            auditMetrics: metrics,
            generatedAt: new Date().toISOString(),
          };
        }),
      );

      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/audit-timeline
  //
  // Recent audit events binned by hour for chart rendering.
  //
  // Query params:
  //   hours   – number of hours to look back (default 24, max 168 / 7 days)
  //   tenantId – filter by tenant
  // -------------------------------------------------------------------------
  app.get("/audit-timeline", async (c) => {
    try {
      const q = c.req.query();
      const hours = Math.max(
        1,
        Math.min(168, Number.isFinite(Number(q["hours"])) ? Number(q["hours"]) : 24),
      );

      const result = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          const now = new Date();
          const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

          const queryResult = yield* engine.audit.queryEvents({
            tenantId: q["tenantId"],
            from: from.toISOString(),
            to: now.toISOString(),
            limit: 1000,
          });

          // Build hourly bins over the requested window
          const bins = new Map<
            string,
            {
              hour: string;
              label: string;
              count: number;
              allowCount: number;
              denyCount: number;
              approvalCount: number;
            }
          >();

          for (let h = 0; h < hours; h++) {
            const hourStart = new Date(from.getTime() + h * 60 * 60 * 1000);
            const key = hourStart.toISOString().slice(0, 13); // "2024-01-01T12"
            const label = hourStart.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "UTC",
            });
            bins.set(key, {
              hour: hourStart.toISOString(),
              label,
              count: 0,
              allowCount: 0,
              denyCount: 0,
              approvalCount: 0,
            });
          }

          for (const event of queryResult.events) {
            const eventHour = event.timestamp?.slice(0, 13) ?? "";
            const bin = bins.get(eventHour);
            if (bin) {
              bin.count++;
              if (event.decision === "allow") bin.allowCount++;
              else if (event.decision === "deny") bin.denyCount++;
              else if (event.decision === "approval_required") bin.approvalCount++;
            }
          }

          return {
            timeline: Array.from(bins.values()),
            totalEvents: queryResult.total,
            hasMore: queryResult.hasMore,
            hours,
            from: from.toISOString(),
            to: now.toISOString(),
            generatedAt: now.toISOString(),
          };
        }),
      );

      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/health-overview
  //
  // All upstream health statuses, summarised.
  // -------------------------------------------------------------------------
  app.get("/health-overview", async (c) => {
    try {
      const upstreams = listUpstreamRegistrations(upstreamsDir);

      const summary = {
        healthy: upstreams.filter((u) => u.healthStatus === "healthy").length,
        degraded: upstreams.filter((u) => u.healthStatus === "degraded").length,
        unhealthy: upstreams.filter((u) => u.healthStatus === "unhealthy").length,
        unknown: upstreams.filter((u) => u.healthStatus === "unknown").length,
        total: upstreams.length,
      };

      // Overall health roll-up
      let overallStatus: "healthy" | "degraded" | "unhealthy" | "empty";
      if (upstreams.length === 0) {
        overallStatus = "empty";
      } else if (summary.unhealthy > 0) {
        overallStatus = "unhealthy";
      } else if (summary.degraded > 0) {
        overallStatus = "degraded";
      } else if (summary.unknown === upstreams.length) {
        overallStatus = "degraded"; // all unknown → treat as degraded
      } else {
        overallStatus = "healthy";
      }

      return c.json({
        overallStatus,
        upstreams: upstreams.map((u) => ({
          upstreamId: u.upstreamId,
          name: u.name,
          description: u.description,
          healthStatus: u.healthStatus,
          trustState: u.trustState,
          toolCount: u.toolCount ?? 0,
          lastCapabilitySync: u.lastCapabilitySync ?? null,
          transport: u.transport,
          namespace: u.namespace,
          endpoint: u.endpoint,
          updatedAt: u.updatedAt,
        })),
        summary,
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
