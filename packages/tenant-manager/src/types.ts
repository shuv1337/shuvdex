import { Context, Effect } from "effect";
import type {
  EnvironmentNotFound,
  GatewayNotFound,
  PolicyTemplateNotFound,
  TenantManagerIOError,
  TenantNotFound,
} from "./errors.js";

export type TenantStatus = "active" | "suspended" | "archived";
export type SubscriptionTier = "core" | "standard" | "custom";
export type EnvironmentType = "production" | "staging" | "development";
export type IdPType = "entra" | "google";

/** Core tenant entity per spec §9.1 */
export interface Tenant {
  readonly tenantId: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly tier: SubscriptionTier;
  readonly idpType: IdPType;
  readonly idpConfig: {
    readonly entraId?: { tenantId: string; audience: string; groupMapping?: Record<string, string[]> };
    readonly googleWorkspace?: { audience: string; allowedDomains?: string[] };
  };
  readonly owner: { name: string; email: string };
  readonly dataResidency?: string;
  readonly maxConnectors: number;  // core=2, standard=5, custom=unlimited(-1)
  readonly maxUsers: number;       // core=20, standard=50, custom=unlimited(-1)
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Environment per spec §9.2 */
export interface Environment {
  readonly environmentId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: EnvironmentType;
  readonly gatewayId?: string;
  readonly credentialNamespace: string;
  readonly policyBundleId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Gateway per spec §9.3 */
export interface Gateway {
  readonly gatewayId: string;
  readonly tenantId: string;
  readonly environmentId: string;
  readonly endpointUrl: string;
  readonly transport: "streamable-http" | "sse";
  readonly authMode: "entra" | "google" | "internal";
  readonly enabledPackages: ReadonlyArray<string>;
  readonly healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  readonly deploymentMetadata?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Per-tenant package approval */
export type PackageApprovalState =
  | "discovered"
  | "pending_review"
  | "approved"
  | "active"
  | "restricted"
  | "rejected"
  | "deprecated"
  | "disabled";

/** Per-capability certification */
export type CertificationState =
  | "unknown"
  | "reviewed"
  | "approved"
  | "restricted"
  | "deprecated";

export interface TenantPackageApproval {
  readonly tenantId: string;
  readonly packageId: string;
  readonly state: PackageApprovalState;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly notes?: string;
}

export interface CapabilityCertification {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly state: CertificationState;
  readonly certifiedBy?: string;
  readonly certifiedAt?: string;
  readonly notes?: string;
}

/** Role mapping for a tenant */
export interface TenantRoleMapping {
  readonly tenantId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly allowedPackages: ReadonlyArray<string>;
  readonly allowedCapabilities?: ReadonlyArray<string>;
  readonly maxActionClass: "read" | "write" | "admin" | "external";
  readonly maxRiskLevel: "low" | "medium" | "high" | "restricted";
}

/** Policy template */
export interface PolicyTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly tier: SubscriptionTier;
  readonly description: string;
  readonly maxConnectors: number;
  readonly maxUsers: number;
  readonly allowedUpstreams: ReadonlyArray<string>;
  readonly roleMappings: ReadonlyArray<Omit<TenantRoleMapping, "tenantId">>;
  readonly defaultReadOnly: boolean;
  readonly auditRetentionDays: number;
  readonly reviewCadenceDays: number;
}

/** Tenant Manager service */
export interface TenantManagerService {
  // Tenant CRUD
  readonly createTenant: (
    input: Omit<Tenant, "createdAt" | "updatedAt">,
  ) => Effect.Effect<Tenant, TenantManagerIOError>;
  readonly getTenant: (tenantId: string) => Effect.Effect<Tenant, TenantNotFound>;
  readonly listTenants: () => Effect.Effect<Tenant[]>;
  readonly updateTenant: (
    tenantId: string,
    patch: Partial<Tenant>,
  ) => Effect.Effect<Tenant, TenantNotFound | TenantManagerIOError>;
  readonly suspendTenant: (
    tenantId: string,
  ) => Effect.Effect<Tenant, TenantNotFound | TenantManagerIOError>;
  readonly archiveTenant: (
    tenantId: string,
  ) => Effect.Effect<Tenant, TenantNotFound | TenantManagerIOError>;

  // Environment CRUD
  readonly createEnvironment: (
    input: Omit<Environment, "createdAt" | "updatedAt">,
  ) => Effect.Effect<Environment, TenantManagerIOError>;
  readonly getEnvironment: (
    envId: string,
  ) => Effect.Effect<Environment, EnvironmentNotFound>;
  readonly listEnvironments: (tenantId: string) => Effect.Effect<Environment[]>;

  // Gateway CRUD
  readonly createGateway: (
    input: Omit<Gateway, "createdAt" | "updatedAt">,
  ) => Effect.Effect<Gateway, TenantManagerIOError>;
  readonly getGateway: (gwId: string) => Effect.Effect<Gateway, GatewayNotFound>;
  readonly listGateways: (tenantId: string) => Effect.Effect<Gateway[]>;

  // Package approvals
  readonly setPackageApproval: (
    approval: TenantPackageApproval,
  ) => Effect.Effect<TenantPackageApproval, TenantManagerIOError>;
  readonly getPackageApproval: (
    tenantId: string,
    packageId: string,
  ) => Effect.Effect<TenantPackageApproval | null>;
  readonly listPackageApprovals: (
    tenantId: string,
  ) => Effect.Effect<TenantPackageApproval[]>;

  // Capability certifications
  readonly setCertification: (
    cert: CapabilityCertification,
  ) => Effect.Effect<CapabilityCertification, TenantManagerIOError>;
  readonly listCertifications: (
    tenantId: string,
  ) => Effect.Effect<CapabilityCertification[]>;

  // Role mappings
  readonly setRoleMapping: (
    mapping: TenantRoleMapping,
  ) => Effect.Effect<TenantRoleMapping, TenantManagerIOError>;
  readonly listRoleMappings: (tenantId: string) => Effect.Effect<TenantRoleMapping[]>;

  // Policy templates
  readonly listPolicyTemplates: () => Effect.Effect<PolicyTemplate[]>;
  readonly applyTemplate: (
    tenantId: string,
    templateId: string,
  ) => Effect.Effect<void, TenantNotFound | PolicyTemplateNotFound | TenantManagerIOError>;

  // Resolve tenant context from IdP token
  readonly resolveTenantFromToken: (
    claims: { issuer: string; email: string; groups?: string[]; domain?: string },
  ) => Effect.Effect<{ tenant: Tenant; roleMappings: TenantRoleMapping[] } | null>;
}

export class TenantManager extends Context.Tag("TenantManager")<
  TenantManager,
  TenantManagerService
>() {}
