import { Context, Effect } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import type { InvalidTokenError, PolicyEngineIOError, PolicyNotFound } from "./errors.js";
import type { AuditServiceInterface } from "./audit-service.js";
import type { IdPConfig } from "./idp.js";

export type { IdPConfig } from "./idp.js";

export type SubjectType = "host" | "install" | "user" | "service";

/**
 * Operator role for fine-grained RBAC on control-plane routes.
 * "platform_admin" → full access; "operator" → read-only ops; others for scoped duties.
 */
export type OperatorRole =
  | "platform_admin"
  | "package_publisher"
  | "security_reviewer"
  | "auditor"
  | "operator";

export interface TokenClaims {
  readonly jti: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly hostTags: ReadonlyArray<string>;
  readonly clientTags: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
  readonly allowedPackages: ReadonlyArray<string>;
  readonly deniedPackages: ReadonlyArray<string>;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly issuer: string;
  readonly keyId: string;
  /** Optional operator role for RBAC on control-plane routes. Backward-compatible (optional). */
  readonly role?: OperatorRole;
}

export interface CapabilitySubjectPolicy {
  readonly id: string;
  readonly description: string;
  readonly scopes?: ReadonlyArray<string>;
  readonly hostTags?: ReadonlyArray<string>;
  readonly clientTags?: ReadonlyArray<string>;
  readonly allowPackages?: ReadonlyArray<string>;
  readonly denyPackages?: ReadonlyArray<string>;
  readonly allowCapabilities?: ReadonlyArray<string>;
  readonly denyCapabilities?: ReadonlyArray<string>;
  readonly maxRiskLevel?: "low" | "medium" | "high";
}

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly action:
    | "list_tools"
    | "list_resources"
    | "list_prompts"
    | "call_tool"
    | "read_resource"
    | "get_prompt";
  readonly subjectId: string;
  readonly capabilityId?: string;
  readonly packageId?: string;
  readonly decision: "allow" | "deny";
  readonly reason: string;
  readonly executor?: string;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly matchedPolicyIds: ReadonlyArray<string>;
}

export interface IssueTokenInput {
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly hostTags?: ReadonlyArray<string>;
  readonly clientTags?: ReadonlyArray<string>;
  readonly scopes?: ReadonlyArray<string>;
  readonly allowedPackages?: ReadonlyArray<string>;
  readonly deniedPackages?: ReadonlyArray<string>;
  readonly ttlSeconds?: number;
}

export interface PolicyEngineService {
  /**
   * Access to the rich audit service for querying, exporting, and metrics.
   * Events are also recorded via recordAuditEvent for backward compat.
   */
  readonly audit: AuditServiceInterface;
  readonly issueToken: (
    input: IssueTokenInput,
  ) => Effect.Effect<{ token: string; claims: TokenClaims }>;
  readonly verifyToken: (
    token: string,
  ) => Effect.Effect<TokenClaims, InvalidTokenError>;
  /**
   * Unified token resolver that accepts both internal HMAC JWTs (issued by
   * `issueToken`) and external IdP JWTs (Entra ID, Google Workspace).
   *
   * - Internal tokens (kid === "local-hs256"): delegated to `verifyToken`.
   * - External tokens: validated via the configured IdP and mapped to
   *   `TokenClaims` using the group → scope mapping in `idp-config.json`.
   *
   * @param token - Raw JWT string (without "Bearer " prefix)
   */
  readonly resolveExternalToken: (
    token: string,
  ) => Effect.Effect<TokenClaims, InvalidTokenError>;
  readonly revokeToken: (jti: string) => Effect.Effect<void, PolicyEngineIOError>;
  readonly listPolicies: () => Effect.Effect<CapabilitySubjectPolicy[]>;
  readonly upsertPolicy: (
    policy: CapabilitySubjectPolicy,
  ) => Effect.Effect<CapabilitySubjectPolicy, PolicyEngineIOError>;
  readonly deletePolicy: (policyId: string) => Effect.Effect<void, PolicyNotFound | PolicyEngineIOError>;
  readonly authorizeCapability: (
    claims: TokenClaims,
    capability: CapabilityDefinition,
  ) => Effect.Effect<AuthorizationDecision>;
  readonly recordAuditEvent: (
    event: AuditEvent,
  ) => Effect.Effect<void, PolicyEngineIOError>;
  readonly listAuditEvents: () => Effect.Effect<AuditEvent[]>;
  readonly defaultClaims: () => TokenClaims;
}

export class PolicyEngine extends Context.Tag("PolicyEngine")<
  PolicyEngine,
  PolicyEngineService
>() {}
