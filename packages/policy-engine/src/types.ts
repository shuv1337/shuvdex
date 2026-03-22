import { Context, Effect } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import type { InvalidTokenError, PolicyEngineIOError, PolicyNotFound } from "./errors.js";

export type SubjectType = "host" | "install" | "user" | "service";

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
  readonly issueToken: (
    input: IssueTokenInput,
  ) => Effect.Effect<{ token: string; claims: TokenClaims }>;
  readonly verifyToken: (
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
