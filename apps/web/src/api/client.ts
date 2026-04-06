/**
 * API client for the shuvdex REST API.
 */

const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ??
  `${window.location.protocol}//${window.location.hostname}:3847`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? res.statusText,
      body,
    );
  }
  return res.json() as Promise<T>;
}

async function uploadApi<T>(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields ?? {})) {
    form.set(key, value);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? res.statusText,
      body,
    );
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// Types
// ============================================================================

export type ToolParamType = "string" | "number" | "boolean" | "array" | "object";

export interface ImportConflict {
  packageId: string;
  existingSourceType: string;
  resolution: "replaceable" | "blocked";
  reason: string;
}

export interface ArchiveInspection {
  packageId: string;
  version: string;
  title: string;
  summary: string;
  capabilities: Array<{ id: string; kind: string; title: string }>;
  assets: string[];
  warnings: string[];
  conflicts: ImportConflict[];
  checksum: string;
  originalFilename: string;
  annotations: Record<string, unknown>;
  metadataSources: {
    packageId: string;
    version: string;
    description: string;
  };
}

export interface ImportResult {
  package: {
    id: string;
    version: string;
    title: string;
  };
  extractedAssets: string[];
  replaced: boolean;
  warnings: string[];
}

// ============================================================================
// Capability Package Types
// ============================================================================

export interface CapabilityDefinition {
  id: string;
  version: string;
  kind: "tool" | "resource" | "prompt";
  title: string;
  description: string;
  enabled: boolean;
  executor: {
    type: string;
    [key: string]: unknown;
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface PackageSource {
  type: "local" | "imported_archive" | "skill_index" | "openapi" | "builtin";
  path?: string;
}

export interface CapabilityPackage {
  id: string;
  version: string;
  title: string;
  description: string;
  builtIn: boolean;
  enabled: boolean;
  tags?: string[];
  source?: PackageSource;
  sourceRef?: string;
  capabilities: CapabilityDefinition[];
  assets?: string[];
  dependencies?: string[];
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Policy Types
// ============================================================================

export interface CapabilitySubjectPolicy {
  id: string;
  description: string;
  scopes: string[];
  hostTags: string[];
  clientTags: string[];
  allowPackages: string[];
  denyPackages: string[];
  allowCapabilities: string[];
  denyCapabilities: string[];
  maxRiskLevel?: "low" | "medium" | "high";
}

// ============================================================================
// Token Types
// ============================================================================

export interface TokenClaims {
  jti: string;
  sub: string;
  subjectType: string;
  scopes: string[];
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
}

export interface IssueTokenInput {
  subjectId: string;
  subjectType: string;
  scopes: string[];
  ttlSeconds?: number;
}

export interface TokenResponse {
  token: string;
  claims: TokenClaims;
}

// ============================================================================
// Credential Types
// ============================================================================

export type CredentialScheme =
  | { type: "api_key"; in: "header" | "query"; name: string; value: string }
  | { type: "bearer"; token: string }
  | { type: "oauth_client_credentials"; tokenUrl: string; clientId: string; clientSecret: string; scope?: string }
  | { type: "oauth_authorization_code"; authorizationUrl: string; tokenUrl: string; clientId: string; clientSecret: string; scope?: string }
  | { type: "service_account"; privateKey: string; clientEmail: string; tokenUri?: string; scopes?: string[] }
  | { type: "custom_headers"; headers: Record<string, string> };

export interface CredentialRecord {
  credentialId: string;
  /** Full scheme object — present when creating, may be absent in list responses. */
  scheme?: CredentialScheme;
  /** Scheme type string — always returned by the API list endpoint. */
  schemeType?: CredentialScheme["type"];
  description?: string;
  sourceId?: string;
  packageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialBinding {
  bindingId: string;
  tenantId?: string;
  environmentId?: string;
  credentialId: string;
  credentialType: "api_key" | "oauth_client_credentials" | "oauth_authorization_code" | "bearer" | "service_account";
  allowedPackages?: string[];
  allowedCapabilities?: string[];
  scopes?: string[];
  rotation?: {
    rotatedAt: string;
    nextRotation?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Audit Types
// ============================================================================

export type AuditDecision = "allow" | "deny" | "approval_required";
export type ActionClass = "read" | "write" | "admin" | "governance";

/** Normalized audit event for UI consumption. */
export interface AuditEvent {
  id: string;
  timestamp: string;
  tenantId?: string;
  actorId: string;
  action: string;
  actionClass: ActionClass;
  targetId?: string;
  targetType?: string;
  decision: AuditDecision;
  policyId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Normalize raw API audit events to the flat UI shape. */
function normalizeAuditEvent(raw: Record<string, unknown>): AuditEvent {
  const actor = raw.actor as Record<string, unknown> | undefined;
  const target = raw.target as Record<string, unknown> | undefined;
  const outcome = raw.outcome as Record<string, unknown> | undefined;
  return {
    id: (raw.eventId ?? raw.id ?? "") as string,
    timestamp: (raw.timestamp ?? "") as string,
    tenantId: raw.tenantId as string | undefined,
    actorId: (actor?.subjectId ?? raw.actorId ?? "") as string,
    action: (raw.action ?? "") as string,
    actionClass: (raw.actionClass ?? "read") as ActionClass,
    targetId: (target?.id ?? raw.targetId) as string | undefined,
    targetType: (target?.type ?? raw.targetType) as string | undefined,
    decision: (raw.decision ?? raw.decisionReason ?? "allow") as AuditDecision,
    policyId: raw.policyId as string | undefined,
    reason: (raw.decisionReason ?? raw.reason) as string | undefined,
    metadata: outcome as Record<string, unknown> | undefined,
  };
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

export interface AuditMetrics {
  totalEvents: number;
  allowCount: number;
  denyCount: number;
  approvalRequiredCount: number;
  uniqueActors: number;
  uniqueActions: number;
  timeWindowHours: number;
}

/** Normalize raw API audit metrics to the flat UI shape. */
function normalizeAuditMetrics(raw: Record<string, unknown>): AuditMetrics {
  const byDecision = (raw.eventsByDecision ?? {}) as Record<string, number>;
  const byAction = (raw.eventsByAction ?? {}) as Record<string, number>;
  return {
    totalEvents: (raw.totalEvents ?? 0) as number,
    allowCount: byDecision.allow ?? 0,
    denyCount: byDecision.deny ?? 0,
    approvalRequiredCount: byDecision.approval_required ?? 0,
    uniqueActors: Object.keys(byAction).length,
    uniqueActions: Object.keys(byAction).length,
    timeWindowHours: (raw.timeWindowHours ?? 24) as number,
  };
}

// ============================================================================
// OpenAPI Source Types
// ============================================================================

export interface OpenApiSource {
  sourceId: string;
  specUrl: string;
  title: string;
  description?: string;
  tags?: string[];
  packageIdOverride?: string;
  selectedServerUrl: string;
  credentialId?: string;
  operationFilter?: Record<string, unknown>;
  defaultTimeoutMs?: number;
  defaultRiskLevel?: "low" | "medium" | "high";
  companionPackageId?: string;
  lastSyncedAt?: string;
  operationCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpenApiInspectionResult {
  sourceId: string;
  title: string;
  description?: string;
  serverUrls: string[];
  operations: Array<{
    operationId: string;
    method: string;
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    riskLevel?: "low" | "medium" | "high";
  }>;
  estimatedCapabilityCount: number;
  warnings?: string[];
}

export interface OpenApiCompileResult {
  source: OpenApiSource;
  package: CapabilityPackage;
  compiledOperations: number;
  warnings?: string[];
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface DashboardSummary {
  tenantCount: number;
  activeConnectors: number;
  upstreamCount: number;
  healthyUpstreams: number;
  degradedUpstreams: number;
  unhealthyUpstreams: number;
  totalPolicies: number;
  totalCredentials: number;
  totalBindings: number;
  pendingApprovals: number;
  governanceScore: number;
  auditMetrics: AuditMetrics;
  generatedAt: string;
}

export interface AuditTimelineBin {
  hour: string;
  label: string;
  count: number;
  allowCount: number;
  denyCount: number;
  approvalCount: number;
}

export interface AuditTimeline {
  timeline: AuditTimelineBin[];
  totalEvents: number;
  hasMore: boolean;
  hours: number;
  from: string;
  to: string;
  generatedAt: string;
}

export interface UpstreamHealth {
  upstreamId: string;
  name: string;
  description?: string;
  healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  trustState: "trusted" | "untrusted" | "pending_review";
  toolCount: number;
  lastCapabilitySync?: string;
  transport: string;
  namespace?: string;
  endpoint?: string;
  updatedAt: string;
}

export interface HealthOverview {
  overallStatus: "healthy" | "degraded" | "unhealthy" | "empty";
  upstreams: UpstreamHealth[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    total: number;
  };
  checkedAt: string;
}

export async function inspectSkillFile(file: File): Promise<ArchiveInspection> {
  return uploadApi<ArchiveInspection>("/api/packages/import/inspect", file);
}

export async function importSkillFile(file: File, force = false): Promise<ImportResult> {
  return uploadApi<ImportResult>("/api/packages/import", file, {
    ...(force ? { force: "true" } : {}),
  });
}

// ============================================================================
// Package API
// ============================================================================

export async function fetchPackages(refresh = false): Promise<CapabilityPackage[]> {
  return api<CapabilityPackage[]>(`/api/packages${refresh ? "?refresh=1" : ""}`);
}

export async function reindexPackages(): Promise<unknown> {
  return api<unknown>("/api/packages/reindex", { method: "POST" });
}

export async function cleanupPackages(force = false): Promise<{ orphans: string[]; removed: string[] }> {
  return api<{ orphans: string[]; removed: string[] }>("/api/packages/cleanup", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export async function deletePackage(packageId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/api/packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE",
  });
}

export async function setPackageEnabled(packageId: string, enabled: boolean): Promise<CapabilityPackage> {
  return api<CapabilityPackage>(`/api/packages/${encodeURIComponent(packageId)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export async function setCapabilityEnabled(
  packageId: string,
  capabilityId: string,
  enabled: boolean,
): Promise<CapabilityPackage> {
  return api<CapabilityPackage>(
    `/api/packages/${encodeURIComponent(packageId)}/capabilities/${encodeURIComponent(capabilityId)}/enabled`,
    {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    },
  );
}

// ============================================================================
// Policy API
// ============================================================================

export async function fetchPolicies(): Promise<CapabilitySubjectPolicy[]> {
  return api<CapabilitySubjectPolicy[]>("/api/policies");
}

export async function upsertPolicy(policy: CapabilitySubjectPolicy): Promise<CapabilitySubjectPolicy> {
  return api<CapabilitySubjectPolicy>(`/api/policies/${encodeURIComponent(policy.id)}`, {
    method: "PUT",
    body: JSON.stringify(policy),
  });
}

export async function deletePolicy(policyId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/api/policies/${encodeURIComponent(policyId)}`, {
    method: "DELETE",
  });
}

// ============================================================================
// Token API
// ============================================================================

export async function issueToken(input: IssueTokenInput): Promise<TokenResponse> {
  return api<TokenResponse>("/api/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  return api<TokenClaims>("/api/tokens/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function revokeToken(jti: string): Promise<{ revoked: boolean }> {
  return api<{ revoked: boolean }>("/api/tokens/revoke", {
    method: "POST",
    body: JSON.stringify({ jti }),
  });
}

// ============================================================================
// Credential API
// ============================================================================

export async function fetchCredentials(): Promise<CredentialRecord[]> {
  return api<CredentialRecord[]>("/api/credentials");
}

export async function createCredential(credential: Omit<CredentialRecord, "createdAt" | "updatedAt">): Promise<CredentialRecord> {
  return api<CredentialRecord>("/api/credentials", {
    method: "POST",
    body: JSON.stringify(credential),
  });
}

export async function deleteCredential(credentialId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/api/credentials/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
  });
}

export async function fetchCredentialBindings(): Promise<CredentialBinding[]> {
  return api<CredentialBinding[]>("/api/credentials/bindings");
}

export async function createCredentialBinding(binding: Omit<CredentialBinding, "createdAt" | "updatedAt">): Promise<CredentialBinding> {
  return api<CredentialBinding>("/api/credentials/bindings", {
    method: "POST",
    body: JSON.stringify(binding),
  });
}

export async function deleteCredentialBinding(bindingId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/api/credentials/bindings/${encodeURIComponent(bindingId)}`, {
    method: "DELETE",
  });
}

// ============================================================================
// Audit API
// ============================================================================

export async function queryAudit(params?: {
  tenantId?: string;
  actorId?: string;
  action?: string;
  actionClass?: ActionClass;
  decision?: AuditDecision;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditQueryResult> {
  const query = new URLSearchParams();
  if (params?.tenantId) query.set("tenantId", params.tenantId);
  if (params?.actorId) query.set("actorId", params.actorId);
  if (params?.action) query.set("action", params.action);
  if (params?.actionClass) query.set("actionClass", params.actionClass);
  if (params?.decision) query.set("decision", params.decision);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));
  const raw = await api<{ events: Record<string, unknown>[]; total: number; hasMore: boolean; limit: number; offset: number }>(`/api/audit?${query.toString()}`);
  return { ...raw, events: raw.events.map(normalizeAuditEvent) };
}

export async function fetchAuditMetrics(): Promise<AuditMetrics> {
  const raw = await api<Record<string, unknown>>("/api/audit/metrics");
  return normalizeAuditMetrics(raw);
}

export async function exportAudit(params?: { tenantId?: string; from?: string; to?: string }): Promise<string> {
  const query = new URLSearchParams();
  if (params?.tenantId) query.set("tenantId", params.tenantId);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const res = await fetch(`${API_BASE}/api/audit/export?${query.toString()}`);
  if (!res.ok) throw new ApiError(res.status, res.statusText, null);
  return res.text();
}

// ============================================================================
// OpenAPI Source API
// ============================================================================

export async function fetchOpenApiSources(): Promise<OpenApiSource[]> {
  return api<OpenApiSource[]>("/api/sources/openapi");
}

export async function getOpenApiSource(sourceId: string): Promise<OpenApiSource> {
  return api<OpenApiSource>(`/api/sources/openapi/${encodeURIComponent(sourceId)}`);
}

export async function inspectOpenApiSource(params: {
  specUrl: string;
  title: string;
  description?: string;
  tags?: string[];
  packageIdOverride?: string;
  selectedServerUrl: string;
  credentialId?: string;
  operationFilter?: Record<string, unknown>;
  defaultTimeoutMs?: number;
  defaultRiskLevel?: "low" | "medium" | "high";
  companionPackageId?: string;
}): Promise<OpenApiInspectionResult> {
  return api<OpenApiInspectionResult>("/api/sources/openapi/inspect", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function compileOpenApiSource(params: {
  sourceId?: string;
  specUrl: string;
  title: string;
  description?: string;
  tags?: string[];
  packageIdOverride?: string;
  selectedServerUrl: string;
  credentialId?: string;
  operationFilter?: Record<string, unknown>;
  defaultTimeoutMs?: number;
  defaultRiskLevel?: "low" | "medium" | "high";
  companionPackageId?: string;
}): Promise<OpenApiCompileResult> {
  return api<OpenApiCompileResult>("/api/sources/openapi", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function updateOpenApiSource(sourceId: string, updates: Partial<OpenApiSource>): Promise<OpenApiSource> {
  return api<OpenApiSource>(`/api/sources/openapi/${encodeURIComponent(sourceId)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function refreshOpenApiSource(sourceId: string): Promise<OpenApiSource> {
  return api<OpenApiSource>(`/api/sources/openapi/${encodeURIComponent(sourceId)}/refresh`, {
    method: "POST",
  });
}

export async function testOpenApiAuth(sourceId: string): Promise<{ success: boolean; message?: string }> {
  return api<{ success: boolean; message?: string }>(`/api/sources/openapi/${encodeURIComponent(sourceId)}/test-auth`, {
    method: "POST",
  });
}

export async function deleteOpenApiSource(sourceId: string): Promise<{ deleted: boolean }> {
  return api<{ deleted: boolean }>(`/api/sources/openapi/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
}

// ============================================================================
// Dashboard API
// ============================================================================

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return api<DashboardSummary>("/api/dashboard/summary");
}

export async function fetchAuditTimeline(hours = 24): Promise<AuditTimeline> {
  return api<AuditTimeline>(`/api/dashboard/audit-timeline?hours=${hours}`);
}

export async function fetchHealthOverview(): Promise<HealthOverview> {
  return api<HealthOverview>("/api/dashboard/health-overview");
}
