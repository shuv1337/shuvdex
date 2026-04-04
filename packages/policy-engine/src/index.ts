// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------
export { PolicyEngine } from "./types.js";
export type {
  SubjectType,
  TokenClaims,
  OperatorRole,
  CapabilitySubjectPolicy,
  AuditEvent,
  AuthorizationDecision,
  IssueTokenInput,
  PolicyEngineService,
  IdPConfig,
} from "./types.js";
export { PolicyEngineLive, makePolicyEngineLive } from "./live.js";
export { InvalidTokenError, PolicyNotFound, PolicyEngineIOError } from "./errors.js";
export type {
  EntraIdConfig,
  GoogleConfig,
  GroupMapping,
  NormalizedIdentity,
  EntraIdentity,
  GoogleIdentity,
} from "./idp.js";
export { resolveIdentity, validateEntraToken, validateGoogleToken } from "./idp.js";

// ---------------------------------------------------------------------------
// Audit types (spec §9.9 / §16.1 / §16.2)
// ---------------------------------------------------------------------------
export type {
  RuntimeAuditRecord,
  RuntimeAuditAction,
  AdminAuditRecord,
  AuditDecision,
  ActionClass,
  RiskLevel,
  OutcomeStatus,
  AuditQueryFilter,
  AuditQueryResult,
  AuditExportFilter,
  AuditMetrics,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Audit service
// ---------------------------------------------------------------------------
export { AuditService } from "./audit-service.js";
export type {
  AuditServiceInterface,
  RuntimeAuditInput,
  AdminAuditInput,
} from "./audit-service.js";
export { makeAuditServiceLive, makeAuditServiceImpl } from "./audit-live.js";

// ---------------------------------------------------------------------------
// Correlation utilities
// ---------------------------------------------------------------------------
export {
  generateCorrelationId,
  getCurrentCorrelationId,
  withCorrelation,
} from "./correlation.js";

// ---------------------------------------------------------------------------
// Approval and certification workflows (spec §14.2 / §14.3 / §10.3)
// ---------------------------------------------------------------------------
export { ApprovalService, makeApprovalServiceImpl, makeApprovalServiceLive } from "./approval.js";
export type { ApprovalRequest, BreakGlassEvent, ApprovalServiceInterface } from "./approval.js";
