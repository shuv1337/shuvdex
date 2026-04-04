/**
 * File-based live implementation of TenantManagerService.
 *
 * Directory layout under rootDir:
 *   tenants/          {tenantId}.json
 *   environments/     {environmentId}.json
 *   gateways/         {gatewayId}.json
 *   approvals/        {tenantId}__{packageId}.json
 *   certifications/   {tenantId}__{capabilityId}.json
 *   role-mappings/    {tenantId}__{groupId}.json
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import {
  EnvironmentNotFound,
  GatewayNotFound,
  PolicyTemplateNotFound,
  TenantManagerIOError,
  TenantNotFound,
} from "./errors.js";
import { BUILT_IN_TEMPLATES, findTemplate } from "./templates.js";
import { TenantManager } from "./types.js";
import type {
  CapabilityCertification,
  Environment,
  EnvironmentType,
  Gateway,
  PolicyTemplate,
  SubscriptionTier,
  Tenant,
  TenantManagerService,
  TenantPackageApproval,
  TenantRoleMapping,
  TenantStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function listJsonFiles<T>(dir: string): T[] {
  if (!fs.existsSync(dir)) return [];
  const results: T[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const parsed = readJson<T>(path.join(dir, entry));
    if (parsed !== undefined) results.push(parsed);
  }
  return results;
}

/** Sanitise a string for safe use as a filename component. */
function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeTenantManagerLive(options?: {
  rootDir?: string;
}): Layer.Layer<TenantManager> {
  const rootDir =
    options?.rootDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-tenants-"));

  const dirs = {
    tenants: path.join(rootDir, "tenants"),
    environments: path.join(rootDir, "environments"),
    gateways: path.join(rootDir, "gateways"),
    approvals: path.join(rootDir, "approvals"),
    certifications: path.join(rootDir, "certifications"),
    roleMappings: path.join(rootDir, "role-mappings"),
  };

  // Ensure all directories exist on startup
  for (const dir of Object.values(dirs)) {
    ensureDir(dir);
  }

  // ---------------------------------------------------------------------------
  // Service implementation
  // ---------------------------------------------------------------------------

  const service: TenantManagerService = {
    // -------------------------------------------------------------------------
    // Tenants
    // -------------------------------------------------------------------------

    createTenant: (input) =>
      Effect.try({
        try: () => {
          const now = new Date().toISOString();
          const tenant: Tenant = { ...input, createdAt: now, updatedAt: now };
          writeJson(path.join(dirs.tenants, `${safeKey(tenant.tenantId)}.json`), tenant);
          return tenant;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.tenants, cause: String(cause) }),
      }),

    getTenant: (tenantId) =>
      Effect.gen(function* () {
        const data = readJson<Tenant>(
          path.join(dirs.tenants, `${safeKey(tenantId)}.json`),
        );
        if (data === undefined) {
          return yield* Effect.fail(new TenantNotFound({ tenantId }));
        }
        return data;
      }),

    listTenants: () =>
      Effect.sync(() => listJsonFiles<Tenant>(dirs.tenants)),

    updateTenant: (tenantId, patch) =>
      Effect.gen(function* () {
        const filePath = path.join(dirs.tenants, `${safeKey(tenantId)}.json`);
        const existing = readJson<Tenant>(filePath);
        if (existing === undefined) {
          return yield* Effect.fail(new TenantNotFound({ tenantId }));
        }
        const updated: Tenant = {
          ...existing,
          ...patch,
          tenantId: existing.tenantId,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
        yield* Effect.try({
          try: () => writeJson(filePath, updated),
          catch: (cause) =>
            new TenantManagerIOError({ path: filePath, cause: String(cause) }),
        });
        return updated;
      }),

    suspendTenant: (tenantId) =>
      Effect.gen(function* () {
        const svc = service;
        return yield* svc.updateTenant(tenantId, { status: "suspended" as TenantStatus });
      }),

    archiveTenant: (tenantId) =>
      Effect.gen(function* () {
        const svc = service;
        return yield* svc.updateTenant(tenantId, { status: "archived" as TenantStatus });
      }),

    // -------------------------------------------------------------------------
    // Environments
    // -------------------------------------------------------------------------

    createEnvironment: (input) =>
      Effect.try({
        try: () => {
          const now = new Date().toISOString();
          const env: Environment = { ...input, createdAt: now, updatedAt: now };
          writeJson(
            path.join(dirs.environments, `${safeKey(env.environmentId)}.json`),
            env,
          );
          return env;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.environments, cause: String(cause) }),
      }),

    getEnvironment: (envId) =>
      Effect.gen(function* () {
        const data = readJson<Environment>(
          path.join(dirs.environments, `${safeKey(envId)}.json`),
        );
        if (data === undefined) {
          return yield* Effect.fail(new EnvironmentNotFound({ environmentId: envId }));
        }
        return data;
      }),

    listEnvironments: (tenantId) =>
      Effect.sync(() =>
        listJsonFiles<Environment>(dirs.environments).filter(
          (e) => e.tenantId === tenantId,
        ),
      ),

    // -------------------------------------------------------------------------
    // Gateways
    // -------------------------------------------------------------------------

    createGateway: (input) =>
      Effect.try({
        try: () => {
          const now = new Date().toISOString();
          const gw: Gateway = { ...input, createdAt: now, updatedAt: now };
          writeJson(path.join(dirs.gateways, `${safeKey(gw.gatewayId)}.json`), gw);
          return gw;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.gateways, cause: String(cause) }),
      }),

    getGateway: (gwId) =>
      Effect.gen(function* () {
        const data = readJson<Gateway>(
          path.join(dirs.gateways, `${safeKey(gwId)}.json`),
        );
        if (data === undefined) {
          return yield* Effect.fail(new GatewayNotFound({ gatewayId: gwId }));
        }
        return data;
      }),

    listGateways: (tenantId) =>
      Effect.sync(() =>
        listJsonFiles<Gateway>(dirs.gateways).filter((g) => g.tenantId === tenantId),
      ),

    // -------------------------------------------------------------------------
    // Package approvals
    // -------------------------------------------------------------------------

    setPackageApproval: (approval) =>
      Effect.try({
        try: () => {
          const key = `${safeKey(approval.tenantId)}__${safeKey(approval.packageId)}`;
          writeJson(path.join(dirs.approvals, `${key}.json`), approval);
          return approval;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.approvals, cause: String(cause) }),
      }),

    getPackageApproval: (tenantId, packageId) =>
      Effect.sync(() => {
        const key = `${safeKey(tenantId)}__${safeKey(packageId)}`;
        return readJson<TenantPackageApproval>(
          path.join(dirs.approvals, `${key}.json`),
        ) ?? null;
      }),

    listPackageApprovals: (tenantId) =>
      Effect.sync(() =>
        listJsonFiles<TenantPackageApproval>(dirs.approvals).filter(
          (a) => a.tenantId === tenantId,
        ),
      ),

    // -------------------------------------------------------------------------
    // Capability certifications
    // -------------------------------------------------------------------------

    setCertification: (cert) =>
      Effect.try({
        try: () => {
          const key = `${safeKey(cert.tenantId)}__${safeKey(cert.capabilityId)}`;
          writeJson(path.join(dirs.certifications, `${key}.json`), cert);
          return cert;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.certifications, cause: String(cause) }),
      }),

    listCertifications: (tenantId) =>
      Effect.sync(() =>
        listJsonFiles<CapabilityCertification>(dirs.certifications).filter(
          (c) => c.tenantId === tenantId,
        ),
      ),

    // -------------------------------------------------------------------------
    // Role mappings
    // -------------------------------------------------------------------------

    setRoleMapping: (mapping) =>
      Effect.try({
        try: () => {
          const key = `${safeKey(mapping.tenantId)}__${safeKey(mapping.groupId)}`;
          writeJson(path.join(dirs.roleMappings, `${key}.json`), mapping);
          return mapping;
        },
        catch: (cause) =>
          new TenantManagerIOError({ path: dirs.roleMappings, cause: String(cause) }),
      }),

    listRoleMappings: (tenantId) =>
      Effect.sync(() =>
        listJsonFiles<TenantRoleMapping>(dirs.roleMappings).filter(
          (m) => m.tenantId === tenantId,
        ),
      ),

    // -------------------------------------------------------------------------
    // Policy templates
    // -------------------------------------------------------------------------

    listPolicyTemplates: () =>
      Effect.sync((): PolicyTemplate[] => [...BUILT_IN_TEMPLATES]),

    applyTemplate: (tenantId, templateId) =>
      Effect.gen(function* () {
        const template = findTemplate(templateId);
        if (template === undefined) {
          return yield* Effect.fail(new PolicyTemplateNotFound({ templateId }));
        }

        const filePath = path.join(dirs.tenants, `${safeKey(tenantId)}.json`);
        const existing = readJson<Tenant>(filePath);
        if (existing === undefined) {
          return yield* Effect.fail(new TenantNotFound({ tenantId }));
        }

        // Update tenant limits from the template
        const updated: Tenant = {
          ...existing,
          tier: template.tier as SubscriptionTier,
          maxConnectors: template.maxConnectors,
          maxUsers: template.maxUsers,
          updatedAt: new Date().toISOString(),
        };
        yield* Effect.try({
          try: () => writeJson(filePath, updated),
          catch: (cause) =>
            new TenantManagerIOError({ path: filePath, cause: String(cause) }),
        });

        // Write default role mappings from the template
        for (const rm of template.roleMappings) {
          const mapping: TenantRoleMapping = { ...rm, tenantId };
          const key = `${safeKey(tenantId)}__${safeKey(rm.groupId)}`;
          yield* Effect.try({
            try: () =>
              writeJson(path.join(dirs.roleMappings, `${key}.json`), mapping),
            catch: (cause) =>
              new TenantManagerIOError({ path: dirs.roleMappings, cause: String(cause) }),
          });
        }
      }),

    // -------------------------------------------------------------------------
    // Resolve tenant from IdP token claims
    // -------------------------------------------------------------------------

    resolveTenantFromToken: (claims) =>
      Effect.gen(function* () {
        const tenants = listJsonFiles<Tenant>(dirs.tenants);

        for (const tenant of tenants) {
          if (tenant.status !== "active") continue;

          if (
            tenant.idpType === "entra" &&
            tenant.idpConfig.entraId &&
            tenant.idpConfig.entraId.tenantId === claims.issuer
          ) {
            // Match: Entra tenant ID in issuer
            const allMappings = listJsonFiles<TenantRoleMapping>(dirs.roleMappings).filter(
              (m) => m.tenantId === tenant.tenantId,
            );
            const callerMappings = allMappings.filter(
              (m) =>
                claims.groups?.includes(m.groupId) ||
                claims.groups?.includes(m.groupName),
            );
            return { tenant, roleMappings: callerMappings };
          }

          if (tenant.idpType === "google" && tenant.idpConfig.googleWorkspace) {
            // Match: caller's email domain in allowedDomains
            const domain =
              claims.domain ??
              (claims.email.includes("@")
                ? claims.email.split("@")[1]
                : undefined);
            const allowedDomains = tenant.idpConfig.googleWorkspace.allowedDomains;
            if (domain && allowedDomains?.includes(domain)) {
              const allMappings = listJsonFiles<TenantRoleMapping>(dirs.roleMappings).filter(
                (m) => m.tenantId === tenant.tenantId,
              );
              const callerMappings = allMappings.filter(
                (m) =>
                  claims.groups?.includes(m.groupId) ||
                  claims.groups?.includes(m.groupName),
              );
              return { tenant, roleMappings: callerMappings };
            }
          }
        }

        return null;
      }),
  };

  return Layer.succeed(TenantManager, service);
}

export const TenantManagerLive: Layer.Layer<TenantManager> = makeTenantManagerLive();
