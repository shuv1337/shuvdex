/**
 * Effect service definition for the structured audit system.
 *
 * AuditService is a standalone Context.Tag so it can be injected and
 * replaced independently (e.g. swapped for a remote-logging backend in
 * tests).  In practice, PolicyEngineLive creates an implementation
 * internally and surfaces it via PolicyEngineService.audit.
 */

import { Context, Effect } from "effect";
import type {
  AdminAuditRecord,
  AuditExportFilter,
  AuditMetrics,
  AuditQueryFilter,
  AuditQueryResult,
  RuntimeAuditRecord,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Loose input types – eventId, timestamp, and effectiveAt are optional so
// the service can auto-populate them.
// ---------------------------------------------------------------------------

export type RuntimeAuditInput = Omit<RuntimeAuditRecord, "eventId" | "timestamp"> & {
  readonly eventId?: string;
  readonly timestamp?: string;
};

export type AdminAuditInput = Omit<
  AdminAuditRecord,
  "eventId" | "timestamp" | "effectiveAt"
> & {
  readonly eventId?: string;
  readonly timestamp?: string;
  readonly effectiveAt?: string;
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface AuditServiceInterface {
  /** Persist a runtime event (MCP operation, token action, etc.). */
  readonly recordRuntimeEvent: (event: RuntimeAuditInput) => Effect.Effect<void>;
  /** Persist an administrative event (policy change, package enable, etc.). */
  readonly recordAdminEvent: (event: AdminAuditInput) => Effect.Effect<void>;
  /** Query runtime events with optional filters and pagination. */
  readonly queryEvents: (filter: AuditQueryFilter) => Effect.Effect<AuditQueryResult>;
  /** Export runtime events as a JSONL string. */
  readonly exportEvents: (filter: AuditExportFilter) => Effect.Effect<string>;
  /** Return aggregated metrics for the current session. */
  readonly getMetrics: () => Effect.Effect<AuditMetrics>;
}

// ---------------------------------------------------------------------------
// Context.Tag
// ---------------------------------------------------------------------------

export class AuditService extends Context.Tag("AuditService")<
  AuditService,
  AuditServiceInterface
>() {}
