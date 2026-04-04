/**
 * Rich audit schema types per spec §9.9 / §16.1 / §16.2.
 *
 * RuntimeAuditRecord is the primary record for every MCP operation (tool
 * calls, resource reads, listing, token actions, etc.).  AdminAuditRecord
 * covers administrative changes to policies, packages, and credentials.
 */

// ---------------------------------------------------------------------------
// Primitive union types
// ---------------------------------------------------------------------------

export type RuntimeAuditAction =
  | "tool_call"
  | "resource_read"
  | "prompt_get"
  | "tools_list"
  | "resources_list"
  | "prompts_list"
  | "package_approve"
  | "package_reject"
  | "package_enable"
  | "package_disable"
  | "credential_rotate"
  | "credential_create"
  | "credential_delete"
  | "policy_change"
  | "policy_create"
  | "policy_delete"
  | "token_issue"
  | "token_revoke"
  | "token_verify"
  | "session_create"
  | "session_expire"
  | "break_glass";

export type AuditDecision = "allow" | "deny" | "approval_required" | "break_glass";

export type ActionClass = "read" | "write" | "admin" | "external";

export type RiskLevel = "low" | "medium" | "high" | "restricted";

export type OutcomeStatus = "success" | "error" | "timeout";

// ---------------------------------------------------------------------------
// Core record types
// ---------------------------------------------------------------------------

/** Runtime audit record per spec §9.9 / §16.1 */
export interface RuntimeAuditRecord {
  readonly eventId: string;
  readonly timestamp: string;
  readonly tenantId?: string;
  readonly environmentId?: string;
  readonly actor: {
    readonly subjectId: string;
    readonly subjectType: string;
    readonly email?: string;
    readonly provider?: string;
    readonly groups?: ReadonlyArray<string>;
    readonly roles?: ReadonlyArray<string>;
  };
  readonly action: RuntimeAuditAction;
  readonly target?: {
    /** "tool" | "resource" | "prompt" | "package" | "credential" | "policy" | "tenant" */
    readonly type: string;
    readonly id: string;
    readonly name?: string;
  };
  readonly packageRef?: {
    readonly packageId: string;
    readonly capabilityId?: string;
    readonly sourceSystem?: string;
  };
  readonly actionClass: ActionClass;
  readonly riskLevel?: RiskLevel;
  readonly decision: AuditDecision;
  readonly decisionReason: string;
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly outcome?: {
    readonly status: OutcomeStatus;
    readonly latencyMs?: number;
    readonly errorClass?: string;
    readonly errorMessage?: string;
  };
  readonly metadata?: {
    readonly requestRedacted?: Record<string, unknown>;
    readonly responseRedacted?: Record<string, unknown>;
  };
}

/** Administrative audit record per spec §16.2 */
export interface AdminAuditRecord {
  readonly eventId: string;
  readonly timestamp: string;
  readonly actor: {
    readonly subjectId: string;
    readonly subjectType: string;
    readonly email?: string;
  };
  readonly action: string;
  readonly target: {
    readonly type: string;
    readonly id: string;
  };
  readonly change?: {
    readonly previousState?: Record<string, unknown>;
    readonly newState?: Record<string, unknown>;
    readonly justification?: string;
  };
  readonly effectiveAt: string;
  readonly tenantId?: string;
  readonly correlationId?: string;
}

// ---------------------------------------------------------------------------
// Query / export types
// ---------------------------------------------------------------------------

export interface AuditQueryFilter {
  readonly tenantId?: string;
  readonly actorId?: string;
  readonly action?: string;
  readonly actionClass?: ActionClass;
  readonly decision?: AuditDecision;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuditQueryResult {
  readonly events: ReadonlyArray<RuntimeAuditRecord>;
  readonly total: number;
  readonly hasMore: boolean;
}

export interface AuditExportFilter {
  readonly tenantId?: string;
  readonly from?: string;
  readonly to?: string;
  /** Currently only "jsonl" is supported. */
  readonly format?: "jsonl";
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface AuditMetrics {
  /** Total runtime events recorded since last restart. */
  readonly totalEvents: number;
  /** Events bucketed by RuntimeAuditAction string. */
  readonly eventsByAction: Record<string, number>;
  /** Events bucketed by AuditDecision string. */
  readonly eventsByDecision: Record<string, number>;
  /** Events bucketed by ActionClass string. */
  readonly eventsByActionClass: Record<string, number>;
  /** Average execution latency across events that carry an outcome.latencyMs. */
  readonly avgLatencyMs: number;
  /** Fraction of events where outcome.status === "error" (0–1). */
  readonly errorRate: number;
}
