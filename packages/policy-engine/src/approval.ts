/**
 * Approval and Certification Workflows — per spec §14.2 / §14.3 / §10.3
 *
 * Implements the state machines for package approval and per-capability
 * certification, plus break-glass recording and review.
 *
 * Storage layout:
 *   {policyDir}/approvals/{requestId}.json     – one ApprovalRequest per file
 *   {policyDir}/break-glass/{eventId}.json     – one BreakGlassEvent per file
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer } from "effect";

// ---------------------------------------------------------------------------
// State transition maps
// ---------------------------------------------------------------------------

/** Valid state transitions for package approval (spec §14.2) */
const APPROVAL_TRANSITIONS: Record<string, string[]> = {
  discovered: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["active", "restricted", "deprecated", "disabled"],
  active: ["restricted", "deprecated", "disabled"],
  restricted: ["approved", "deprecated", "disabled"],
  rejected: ["pending_review"],
  deprecated: ["disabled"],
  disabled: ["pending_review", "approved"],
};

/** Valid transitions for capability certification (clean spec §10.3) */
const CERTIFICATION_TRANSITIONS: Record<string, string[]> = {
  unknown: ["reviewed"],
  reviewed: ["approved", "restricted", "deprecated"],
  approved: ["restricted", "deprecated"],
  restricted: ["approved", "deprecated"],
  deprecated: [],
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requestType:
    | "package_approval"
    | "capability_certification"
    | "write_access"
    | "credential_scope"
    | "environment_deploy";
  /** packageId or capabilityId depending on requestType */
  readonly targetId: string;
  readonly targetName: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly requestedState: string;
  readonly justification?: string;
  readonly status: "pending" | "approved" | "rejected" | "expired";
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly decisionNotes?: string;
}

export interface BreakGlassEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: string;
  readonly targetId: string;
  readonly justification: string;
  readonly timestamp: string;
  /** Always true when initially recorded — every break-glass event requires post-incident review */
  readonly requiresReview: boolean;
  readonly reviewed: boolean;
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
}

export interface ApprovalServiceInterface {
  // ── Approval requests ──────────────────────────────────────────────────────
  readonly createApprovalRequest: (
    req: Omit<ApprovalRequest, "requestId" | "requestedAt" | "status">,
  ) => Effect.Effect<ApprovalRequest, Error>;

  readonly listApprovalRequests: (filter?: {
    tenantId?: string;
    status?: string;
    requestType?: string;
  }) => Effect.Effect<ApprovalRequest[], Error>;

  readonly decideApprovalRequest: (
    requestId: string,
    decision: "approved" | "rejected",
    decidedBy: string,
    notes?: string,
  ) => Effect.Effect<ApprovalRequest, Error>;

  // ── Break-glass ────────────────────────────────────────────────────────────
  readonly recordBreakGlass: (
    event: Omit<BreakGlassEvent, "eventId" | "timestamp" | "requiresReview" | "reviewed">,
  ) => Effect.Effect<BreakGlassEvent, Error>;

  readonly listBreakGlassEvents: (
    tenantId?: string,
  ) => Effect.Effect<BreakGlassEvent[], Error>;

  readonly reviewBreakGlass: (
    eventId: string,
    reviewedBy: string,
  ) => Effect.Effect<BreakGlassEvent, Error>;

  // ── Validation ─────────────────────────────────────────────────────────────
  readonly validateTransition: (
    currentState: string,
    newState: string,
    type: "package" | "certification",
  ) => boolean;
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

export class ApprovalService extends Context.Tag("ApprovalService")<
  ApprovalService,
  ApprovalServiceInterface
>() {}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function listJsonFiles<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const results: T[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const item = readJsonFile<T>(path.join(dir, entry.name));
    if (item !== null) results.push(item);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build an ApprovalServiceInterface backed by the file system.
 *
 * Directories are created eagerly so callers don't need to pre-create them.
 */
export function makeApprovalServiceImpl(options: {
  policyDir: string;
}): ApprovalServiceInterface {
  const approvalsDir = path.join(options.policyDir, "approvals");
  const breakGlassDir = path.join(options.policyDir, "break-glass");

  fs.mkdirSync(approvalsDir, { recursive: true });
  fs.mkdirSync(breakGlassDir, { recursive: true });

  return {
    // ── createApprovalRequest ────────────────────────────────────────────────
    createApprovalRequest: (req) =>
      Effect.try({
        try: () => {
          const request: ApprovalRequest = {
            ...req,
            requestId: randomUUID(),
            requestedAt: new Date().toISOString(),
            status: "pending",
          };
          writeJsonFile(path.join(approvalsDir, `${request.requestId}.json`), request);
          return request;
        },
        catch: (cause) => new Error(`Failed to create approval request: ${String(cause)}`),
      }),

    // ── listApprovalRequests ─────────────────────────────────────────────────
    listApprovalRequests: (filter) =>
      Effect.try({
        try: () => {
          let requests = listJsonFiles<ApprovalRequest>(approvalsDir);
          if (filter?.tenantId !== undefined) {
            requests = requests.filter((r) => r.tenantId === filter.tenantId);
          }
          if (filter?.status !== undefined) {
            requests = requests.filter((r) => r.status === filter.status);
          }
          if (filter?.requestType !== undefined) {
            requests = requests.filter((r) => r.requestType === filter.requestType);
          }
          return requests.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        },
        catch: (cause) => new Error(`Failed to list approval requests: ${String(cause)}`),
      }),

    // ── decideApprovalRequest ────────────────────────────────────────────────
    decideApprovalRequest: (requestId, decision, decidedBy, notes) =>
      Effect.try({
        try: () => {
          const filePath = path.join(approvalsDir, `${requestId}.json`);
          const existing = readJsonFile<ApprovalRequest>(filePath);
          if (!existing) {
            throw new Error(`Approval request '${requestId}' not found`);
          }
          if (existing.status !== "pending") {
            throw new Error(
              `Approval request '${requestId}' is already ${existing.status} and cannot be re-decided`,
            );
          }
          const updated: ApprovalRequest = {
            ...existing,
            status: decision,
            decidedBy,
            decidedAt: new Date().toISOString(),
            ...(notes !== undefined ? { decisionNotes: notes } : {}),
          };
          writeJsonFile(filePath, updated);
          return updated;
        },
        catch: (cause) => new Error(`Failed to decide approval request: ${String(cause)}`),
      }),

    // ── recordBreakGlass ─────────────────────────────────────────────────────
    recordBreakGlass: (event) =>
      Effect.try({
        try: () => {
          const breakGlass: BreakGlassEvent = {
            ...event,
            eventId: randomUUID(),
            timestamp: new Date().toISOString(),
            requiresReview: true,
            reviewed: false,
          };
          writeJsonFile(
            path.join(breakGlassDir, `${breakGlass.eventId}.json`),
            breakGlass,
          );
          return breakGlass;
        },
        catch: (cause) => new Error(`Failed to record break-glass event: ${String(cause)}`),
      }),

    // ── listBreakGlassEvents ─────────────────────────────────────────────────
    listBreakGlassEvents: (tenantId) =>
      Effect.try({
        try: () => {
          let events = listJsonFiles<BreakGlassEvent>(breakGlassDir);
          if (tenantId !== undefined) {
            events = events.filter((e) => e.tenantId === tenantId);
          }
          return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        },
        catch: (cause) => new Error(`Failed to list break-glass events: ${String(cause)}`),
      }),

    // ── reviewBreakGlass ─────────────────────────────────────────────────────
    reviewBreakGlass: (eventId, reviewedBy) =>
      Effect.try({
        try: () => {
          const filePath = path.join(breakGlassDir, `${eventId}.json`);
          const existing = readJsonFile<BreakGlassEvent>(filePath);
          if (!existing) {
            throw new Error(`Break-glass event '${eventId}' not found`);
          }
          const updated: BreakGlassEvent = {
            ...existing,
            reviewed: true,
            reviewedBy,
            reviewedAt: new Date().toISOString(),
          };
          writeJsonFile(filePath, updated);
          return updated;
        },
        catch: (cause) => new Error(`Failed to review break-glass event: ${String(cause)}`),
      }),

    // ── validateTransition ───────────────────────────────────────────────────
    validateTransition: (currentState, newState, type) => {
      const transitions =
        type === "package" ? APPROVAL_TRANSITIONS : CERTIFICATION_TRANSITIONS;
      const allowed = transitions[currentState];
      return Array.isArray(allowed) && allowed.includes(newState);
    },
  };
}

/**
 * Build a `Layer<ApprovalService>` backed by file-system storage.
 * Suitable for injecting ApprovalService as an Effect dependency.
 */
export function makeApprovalServiceLive(options: {
  policyDir: string;
}): Layer.Layer<ApprovalService> {
  const impl = makeApprovalServiceImpl(options);
  return Layer.succeed(ApprovalService, impl);
}
