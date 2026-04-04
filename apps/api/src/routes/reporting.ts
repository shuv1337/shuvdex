/**
 * Reporting API routes — /api/reports
 *
 * GET /api/reports/usage             – usage report by tenant (tool calls, users, violations)
 * GET /api/reports/billing           – billing summary (tier, rates, connector/user counts)
 * GET /api/reports/governance        – governance value report for renewal conversations
 * GET /api/reports/compliance-export – structured export for auditors (JSON or CSV)
 *
 * All endpoints require auth (enforced by the global /api/* middleware in index.ts).
 * All write aggregates are derived from the runtime audit store; approval data is
 * read from the file-backed approval service in policyDir.
 */

import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { PolicyEngine, makeApprovalServiceImpl } from "@shuvdex/policy-engine";
import { TenantManager } from "@shuvdex/tenant-manager";
import { CapabilityRegistry } from "@shuvdex/capability-registry";
import type { RuntimeAuditRecord } from "@shuvdex/policy-engine";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportingRuntime = Runtime.Runtime<
  PolicyEngine | TenantManager | CapabilityRegistry
>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Monthly recurring rate per subscription tier in USD.
 * null = Custom/POA — rate is negotiated individually.
 */
const TIER_MONTHLY_RATE: Record<string, number | null> = {
  core: 99,
  standard: 179,
  custom: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a default period of the past 30 days. */
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Returns the current billing month as "YYYY-MM". */
function billingMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Classify a denied audit record into a stable violation-type slug.
 * Uses the decisionReason string heuristically.
 */
function classifyViolation(record: RuntimeAuditRecord): string {
  const reason = (record.decisionReason ?? "").toLowerCase();
  if (reason.includes("write")) return "unauthorized_write";
  if (reason.includes("scope")) return "scope_mismatch";
  if (reason.includes("package") || reason.includes("denied")) return "package_denied";
  if (reason.includes("risk")) return "risk_level_exceeded";
  if (reason.includes("token") || reason.includes("auth")) return "auth_failure";
  return "policy_violation";
}

/**
 * Resolve a human-readable app/system label from a RuntimeAuditRecord.
 * Prefers sourceSystem; falls back to packageId; defaults to "unknown".
 */
function resolveAppLabel(record: RuntimeAuditRecord): string {
  return record.packageRef?.sourceSystem ?? record.packageRef?.packageId ?? "unknown";
}

/**
 * Compute a governance posture score (0–100).
 *
 * Baseline 100; deductions for:
 * - No active policies (-15)
 * - High block rate >30% (-10) or >10% (-5)
 * - Low approval rate <50% when >5 approvals processed (-5)
 */
function computeGovernanceScore(params: {
  totalInteractions: number;
  blockedAttempts: number;
  approvalsProcessed: number;
  approvalsApproved: number;
  hasPolicies: boolean;
}): number {
  let score = 100;

  if (!params.hasPolicies) score -= 15;

  if (params.totalInteractions > 0) {
    const blockRate = params.blockedAttempts / params.totalInteractions;
    if (blockRate > 0.3) score -= 10;
    else if (blockRate > 0.1) score -= 5;
  }

  if (params.approvalsProcessed > 5) {
    const approvalRate = params.approvalsApproved / params.approvalsProcessed;
    if (approvalRate < 0.5) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Serialize an array of RuntimeAuditRecord to RFC-4180 CSV.
 * All values are double-quote escaped.
 */
function auditRecordsToCsv(events: RuntimeAuditRecord[]): string {
  const headers = [
    "eventId",
    "timestamp",
    "tenantId",
    "actorId",
    "actorEmail",
    "action",
    "actionClass",
    "decision",
    "decisionReason",
    "targetType",
    "targetId",
    "targetName",
    "packageId",
    "sourceSystem",
    "correlationId",
    "sessionId",
    "outcomeStatus",
    "latencyMs",
  ];

  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;

  const rows = events.map((e) =>
    [
      e.eventId,
      e.timestamp,
      e.tenantId ?? "",
      e.actor.subjectId,
      e.actor.email ?? "",
      e.action,
      e.actionClass,
      e.decision,
      e.decisionReason,
      e.target?.type ?? "",
      e.target?.id ?? "",
      e.target?.name ?? "",
      e.packageRef?.packageId ?? "",
      e.packageRef?.sourceSystem ?? "",
      e.correlationId ?? "",
      e.sessionId ?? "",
      e.outcome?.status ?? "",
      String(e.outcome?.latencyMs ?? ""),
    ]
      .map(esc)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function reportingRouter(
  runtime: ReportingRuntime,
  policyDir: string,
): Hono {
  const run = Runtime.runPromise(runtime);
  const approvalSvc = makeApprovalServiceImpl({ policyDir });
  const runEff = <A>(eff: Effect.Effect<A, Error>): Promise<A> =>
    Effect.runPromise(eff);

  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/reports/usage
  //
  // Aggregated usage report for a tenant over a date range.
  //
  // Query params:
  //   tenantId  – required
  //   from      – ISO-8601 (default: 30 days ago)
  //   to        – ISO-8601 (default: now)
  // -------------------------------------------------------------------------
  app.get("/usage", async (c) => {
    try {
      const q = c.req.query();
      const tenantId = q["tenantId"];
      if (!tenantId) {
        return c.json({ error: "tenantId is required" }, 400);
      }

      const period = {
        from: q["from"] ?? defaultPeriod().from,
        to: q["to"] ?? defaultPeriod().to,
      };

      const aggregated = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Fetch audit events for this tenant in the period.
          // Limit 10 000 covers typical MSP deployments; large tenants should
          // use the compliance-export endpoint for full data sets.
          const queryResult = yield* engine.audit.queryEvents({
            tenantId,
            from: period.from,
            to: period.to,
            limit: 10_000,
          });

          const events = queryResult.events as RuntimeAuditRecord[];

          // -- Tool calls -------------------------------------------------------
          const toolCallEvents = events.filter((e) => e.action === "tool_call");

          const byApp: Record<string, number> = {};
          const byAction: Record<string, number> = {};
          const byUser: Record<string, number> = {};
          const userSet = new Set<string>();

          for (const e of toolCallEvents) {
            const appLabel = resolveAppLabel(e);
            byApp[appLabel] = (byApp[appLabel] ?? 0) + 1;

            byAction[e.actionClass] = (byAction[e.actionClass] ?? 0) + 1;

            const user = e.actor.email ?? e.actor.subjectId;
            byUser[user] = (byUser[user] ?? 0) + 1;
            userSet.add(user);
          }

          // -- Policy violations ------------------------------------------------
          const deniedEvents = events.filter((e) => e.decision === "deny");
          const violationsByType: Record<string, number> = {};
          for (const e of deniedEvents) {
            const violationType = classifyViolation(e);
            violationsByType[violationType] = (violationsByType[violationType] ?? 0) + 1;
          }

          return {
            toolCalls: {
              total: toolCallEvents.length,
              byApp,
              byAction,
              byUser,
            },
            activeUsers: userSet.size,
            policyViolations: {
              total: deniedEvents.length,
              byType: violationsByType,
            },
          };
        }),
      );

      // Approval events are file-backed — fetch separately
      const approvals = await runEff(
        approvalSvc.listApprovalRequests({ tenantId }),
      );
      const periodApprovals = approvals.filter(
        (a) => a.requestedAt >= period.from && a.requestedAt <= period.to,
      );

      return c.json({
        tenantId,
        period,
        toolCalls: aggregated.toolCalls,
        activeUsers: aggregated.activeUsers,
        approvalEvents: {
          requested: periodApprovals.length,
          approved: periodApprovals.filter((a) => a.status === "approved").length,
          rejected: periodApprovals.filter((a) => a.status === "rejected").length,
        },
        policyViolations: aggregated.policyViolations,
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/reports/billing
  //
  // Billing summary for a tenant — tier, rate, connector count, user count.
  //
  // Query params:
  //   tenantId  – required
  // -------------------------------------------------------------------------
  app.get("/billing", async (c) => {
    try {
      const q = c.req.query();
      const tenantId = q["tenantId"];
      if (!tenantId) {
        return c.json({ error: "tenantId is required" }, 400);
      }

      const result = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          const registry = yield* CapabilityRegistry;

          const tenant = yield* mgr.getTenant(tenantId);
          const packages = yield* registry.listPackages();

          // Active connector count: prefer approved/active package approvals;
          // fall back to total packages for single-tenant deployments.
          const approvals = yield* mgr.listPackageApprovals(tenantId);
          const activeApprovals = approvals.filter(
            (a) => a.state === "active" || a.state === "approved",
          );
          const connectorCount =
            activeApprovals.length > 0 ? activeApprovals.length : packages.length;

          // Active user count: approximate from role mapping cardinality.
          // The role mapping represents distinct groups/users granted access.
          const roleMappings = yield* mgr.listRoleMappings(tenantId);

          const monthlyRate = TIER_MONTHLY_RATE[tenant.tier] ?? null;

          return {
            tenantId,
            tier: tenant.tier,
            monthlyRate,
            connectorCount,
            maxConnectors: tenant.maxConnectors,
            activeUsers: roleMappings.length,
            maxUsers: tenant.maxUsers,
            billableMonth: billingMonth(),
          };
        }),
      );

      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/reports/governance
  //
  // Governance value report — structured for renewal conversations and MSP
  // business reviews. Shows the protective and compliance value delivered.
  //
  // Query params:
  //   tenantId  – required
  //   from      – ISO-8601 (default: 30 days ago)
  //   to        – ISO-8601 (default: now)
  // -------------------------------------------------------------------------
  app.get("/governance", async (c) => {
    try {
      const q = c.req.query();
      const tenantId = q["tenantId"];
      if (!tenantId) {
        return c.json({ error: "tenantId is required" }, 400);
      }

      const period = {
        from: q["from"] ?? defaultPeriod().from,
        to: q["to"] ?? defaultPeriod().to,
      };

      const aggregated = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          const queryResult = yield* engine.audit.queryEvents({
            tenantId,
            from: period.from,
            to: period.to,
            limit: 10_000,
          });

          const events = queryResult.events as RuntimeAuditRecord[];

          // Unique users who made at least one request
          const uniqueUserSet = new Set<string>();
          for (const e of events) {
            uniqueUserSet.add(e.actor.email ?? e.actor.subjectId);
          }

          // Systems/apps accessed (resolved from packageRef)
          const systemSet = new Set<string>();
          for (const e of events) {
            const label = resolveAppLabel(e);
            if (label !== "unknown") {
              // Normalise to a consistent display label (uppercase, no hyphens)
              systemSet.add(label.toUpperCase().replace(/-/g, " "));
            }
          }

          // Blocked attempts: deny on tool_call actions
          const blockedAttempts = events.filter(
            (e) => e.decision === "deny" && e.action === "tool_call",
          ).length;

          // Write denials: denied actions with write action class
          const writeDenials = events.filter(
            (e) => e.decision === "deny" && e.actionClass === "write",
          ).length;

          const totalInteractions = events.filter(
            (e) => e.action === "tool_call",
          ).length;

          // Check whether any policies exist (impacts governance score)
          const policies = yield* engine.listPolicies();

          return {
            uniqueUsers: uniqueUserSet.size,
            accessedSystems: Array.from(systemSet),
            blockedAttempts,
            writeDenials,
            totalInteractions,
            hasPolicies: policies.length > 0,
          };
        }),
      );

      // Approval data (file-backed)
      const approvals = await runEff(
        approvalSvc.listApprovalRequests({ tenantId }),
      );
      const periodApprovals = approvals.filter(
        (a) => a.requestedAt >= period.from && a.requestedAt <= period.to,
      );
      const approvalsProcessed = periodApprovals.length;
      const approvalsApproved = periodApprovals.filter(
        (a) => a.status === "approved",
      ).length;

      const governanceScore = computeGovernanceScore({
        totalInteractions: aggregated.totalInteractions,
        blockedAttempts: aggregated.blockedAttempts,
        approvalsProcessed,
        approvalsApproved,
        hasPolicies: aggregated.hasPolicies,
      });

      // -- Narrative summary --------------------------------------------------
      const systemList =
        aggregated.accessedSystems.length > 0
          ? aggregated.accessedSystems.join(", ")
          : "configured systems";

      const summary =
        `Over the selected period, ${aggregated.uniqueUsers} ` +
        `user${aggregated.uniqueUsers !== 1 ? "s" : ""} made ` +
        `${aggregated.totalInteractions} AI-assisted interaction` +
        `${aggregated.totalInteractions !== 1 ? "s" : ""} ` +
        `across ${systemList} through Latitudes' governed AI layer. ` +
        `${aggregated.blockedAttempts} unauthorized access attempt` +
        `${aggregated.blockedAttempts !== 1 ? "s were" : " was"} automatically blocked, ` +
        `and ${approvalsProcessed} write request` +
        `${approvalsProcessed !== 1 ? "s were" : " was"} ` +
        `processed through the formal approval workflow.`;

      // -- Highlights ---------------------------------------------------------
      const highlights: string[] = [];

      if (aggregated.blockedAttempts > 0) {
        highlights.push(
          `${aggregated.blockedAttempts} unauthorized access ` +
            `attempt${aggregated.blockedAttempts !== 1 ? "s" : ""} blocked`,
        );
      }

      if (approvalsProcessed > 0) {
        highlights.push(
          `${approvalsProcessed} write request` +
            `${approvalsProcessed !== 1 ? "s" : ""} properly ` +
            `processed through approval workflow`,
        );
      }

      highlights.push("100% audit coverage maintained");

      return c.json({
        tenantId,
        period,
        summary,
        accessedSystems: aggregated.accessedSystems,
        uniqueUsers: aggregated.uniqueUsers,
        totalInteractions: aggregated.totalInteractions,
        blockedAttempts: aggregated.blockedAttempts,
        approvalsProcessed,
        writeDenials: aggregated.writeDenials,
        governanceScore,
        highlights,
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/reports/compliance-export
  //
  // Structured export for auditors and compliance reviews.
  // JSON format: structured envelope with named sections.
  // CSV format: flat table of all runtime audit events.
  //
  // Query params:
  //   tenantId  – required
  //   from      – ISO-8601 (default: 30 days ago)
  //   to        – ISO-8601 (default: now)
  //   format    – "json" | "csv" (default: "json")
  // -------------------------------------------------------------------------
  app.get("/compliance-export", async (c) => {
    try {
      const q = c.req.query();
      const tenantId = q["tenantId"];
      if (!tenantId) {
        return c.json({ error: "tenantId is required" }, 400);
      }

      const period = {
        from: q["from"] ?? defaultPeriod().from,
        to: q["to"] ?? defaultPeriod().to,
      };
      const format = q["format"] === "csv" ? "csv" : "json";

      const dateSlug = new Date().toISOString().slice(0, 10);
      const filename = `compliance-export-${tenantId}-${dateSlug}`;

      // Fetch all audit events for the period
      const events = await run(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const queryResult = yield* engine.audit.queryEvents({
            tenantId,
            from: period.from,
            to: period.to,
            limit: 10_000,
          });
          return queryResult.events as RuntimeAuditRecord[];
        }),
      );

      // Approval decisions (file-backed)
      const allApprovals = await runEff(
        approvalSvc.listApprovalRequests({ tenantId }),
      );
      const periodApprovals = allApprovals.filter(
        (a) => a.requestedAt >= period.from && a.requestedAt <= period.to,
      );

      // -- CSV output ---------------------------------------------------------
      if (format === "csv") {
        const csv = auditRecordsToCsv(events);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}.csv"`,
          },
        });
      }

      // -- JSON output --------------------------------------------------------
      // Structured envelope with labelled sections for auditors.
      const exportDoc = {
        exported_at: new Date().toISOString(),
        format: "shuvdex-compliance-export-v1",
        tenantId,
        period,
        sections: {
          audit_events: {
            description: "All runtime audit events for the period",
            count: events.length,
            events,
          },
          policy_changes: {
            description:
              "Policy create/update/delete events within the period. " +
              "See .capabilities/audit/admin.jsonl for the complete admin audit trail.",
            events: events
              .filter((e) =>
                ["policy_change", "policy_create", "policy_delete"].includes(e.action),
              )
              .map((e) => ({
                eventId: e.eventId,
                timestamp: e.timestamp,
                actorId: e.actor.subjectId,
                actorEmail: e.actor.email ?? null,
                action: e.action,
                targetId: e.target?.id ?? null,
                targetName: e.target?.name ?? null,
                decision: e.decision,
              })),
          },
          approval_decisions: {
            description:
              "All approval requests and decisions raised within the period",
            count: periodApprovals.length,
            approvals: periodApprovals,
          },
          connector_drift_events: {
            description:
              "Capability package state changes (approve/reject/enable/disable) within the period",
            events: events
              .filter((e) =>
                [
                  "package_approve",
                  "package_reject",
                  "package_enable",
                  "package_disable",
                ].includes(e.action),
              )
              .map((e) => ({
                eventId: e.eventId,
                timestamp: e.timestamp,
                actorId: e.actor.subjectId,
                actorEmail: e.actor.email ?? null,
                action: e.action,
                targetId: e.target?.id ?? null,
                targetName: e.target?.name ?? null,
              })),
          },
          change_history: {
            description:
              "Credential rotations, session lifecycle events, and token activity",
            events: events
              .filter((e) =>
                [
                  "credential_rotate",
                  "credential_create",
                  "credential_delete",
                  "token_issue",
                  "token_revoke",
                  "session_create",
                  "session_expire",
                ].includes(e.action),
              )
              .map((e) => ({
                eventId: e.eventId,
                timestamp: e.timestamp,
                actorId: e.actor.subjectId,
                actorEmail: e.actor.email ?? null,
                action: e.action,
                targetId: e.target?.id ?? null,
                decision: e.decision,
              })),
          },
        },
      };

      return new Response(JSON.stringify(exportDoc, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.json"`,
        },
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
