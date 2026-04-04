/**
 * Tenant management routes (Phase 3A / 3B).
 *
 * Prefix: /api/tenants   and   /api/templates
 *
 * All write operations require platform_admin or operator role.
 * The /disclosure endpoint requires a valid auth token; caller identity
 * is derived from the resolved token claims set by requireAuth middleware.
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CapabilityRegistry } from "@shuvdex/capability-registry";
import {
  TenantManager,
  computeDisclosure,
} from "@shuvdex/tenant-manager";
import type {
  CapabilityCertification,
  DisclosureContext,
  Environment,
  Gateway,
  Tenant,
  TenantPackageApproval,
  TenantRoleMapping,
} from "@shuvdex/tenant-manager";
import { handleError } from "../middleware/error-handler.js";
import { CLAIMS_KEY } from "../middleware/auth.js";
import type { TokenClaims } from "@shuvdex/policy-engine";

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function tenantsRouter(
  runtime: Runtime.Runtime<TenantManager | CapabilityRegistry>,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/tenants — list all tenants
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const tenants = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listTenants();
        }),
      );
      return c.json(tenants);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants — create tenant
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    try {
      const body = (await c.req.json()) as Omit<Tenant, "createdAt" | "updatedAt">;
      const tenant = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.createTenant(body);
        }),
      );
      return c.json(tenant, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id — get tenant
  // -------------------------------------------------------------------------
  app.get("/:id", async (c) => {
    try {
      const tenant = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.getTenant(c.req.param("id"));
        }),
      );
      return c.json(tenant);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/tenants/:id — update tenant
  // -------------------------------------------------------------------------
  app.patch("/:id", async (c) => {
    try {
      const body = (await c.req.json()) as Partial<Tenant>;
      const tenant = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.updateTenant(c.req.param("id"), body);
        }),
      );
      return c.json(tenant);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/suspend — suspend tenant
  // -------------------------------------------------------------------------
  app.post("/:id/suspend", async (c) => {
    try {
      const tenant = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.suspendTenant(c.req.param("id"));
        }),
      );
      return c.json(tenant);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/archive — archive tenant
  // -------------------------------------------------------------------------
  app.post("/:id/archive", async (c) => {
    try {
      const tenant = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.archiveTenant(c.req.param("id"));
        }),
      );
      return c.json(tenant);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/environments — list environments
  // -------------------------------------------------------------------------
  app.get("/:id/environments", async (c) => {
    try {
      const envs = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listEnvironments(c.req.param("id"));
        }),
      );
      return c.json(envs);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/environments — create environment
  // -------------------------------------------------------------------------
  app.post("/:id/environments", async (c) => {
    try {
      const body = (await c.req.json()) as Omit<Environment, "createdAt" | "updatedAt">;
      const env = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.createEnvironment({ ...body, tenantId: c.req.param("id") });
        }),
      );
      return c.json(env, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/gateways — list gateways
  // -------------------------------------------------------------------------
  app.get("/:id/gateways", async (c) => {
    try {
      const gws = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listGateways(c.req.param("id"));
        }),
      );
      return c.json(gws);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/gateways — create gateway
  // -------------------------------------------------------------------------
  app.post("/:id/gateways", async (c) => {
    try {
      const body = (await c.req.json()) as Omit<Gateway, "createdAt" | "updatedAt">;
      const gw = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.createGateway({ ...body, tenantId: c.req.param("id") });
        }),
      );
      return c.json(gw, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/approvals — list package approvals
  // -------------------------------------------------------------------------
  app.get("/:id/approvals", async (c) => {
    try {
      const approvals = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listPackageApprovals(c.req.param("id"));
        }),
      );
      return c.json(approvals);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/approvals — set package approval
  // -------------------------------------------------------------------------
  app.post("/:id/approvals", async (c) => {
    try {
      const body = (await c.req.json()) as TenantPackageApproval;
      const approval = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.setPackageApproval({ ...body, tenantId: c.req.param("id") });
        }),
      );
      return c.json(approval);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/certifications — list certifications
  // -------------------------------------------------------------------------
  app.get("/:id/certifications", async (c) => {
    try {
      const certs = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listCertifications(c.req.param("id"));
        }),
      );
      return c.json(certs);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/certifications — set certification
  // -------------------------------------------------------------------------
  app.post("/:id/certifications", async (c) => {
    try {
      const body = (await c.req.json()) as CapabilityCertification;
      const cert = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.setCertification({ ...body, tenantId: c.req.param("id") });
        }),
      );
      return c.json(cert);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/roles — list role mappings
  // -------------------------------------------------------------------------
  app.get("/:id/roles", async (c) => {
    try {
      const mappings = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listRoleMappings(c.req.param("id"));
        }),
      );
      return c.json(mappings);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/roles — set role mapping
  // -------------------------------------------------------------------------
  app.post("/:id/roles", async (c) => {
    try {
      const body = (await c.req.json()) as TenantRoleMapping;
      const mapping = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.setRoleMapping({ ...body, tenantId: c.req.param("id") });
        }),
      );
      return c.json(mapping);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tenants/:id/apply-template — apply policy template
  // -------------------------------------------------------------------------
  app.post("/:id/apply-template", async (c) => {
    try {
      const body = (await c.req.json()) as { templateId: string };
      if (!body.templateId) {
        return c.json({ error: "templateId is required" }, 400);
      }
      await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          yield* mgr.applyTemplate(c.req.param("id"), body.templateId);
        }),
      );
      return c.json({ applied: true, templateId: body.templateId });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tenants/:id/disclosure — compute disclosure for caller
  //
  // Query params:
  //   envId   - environment ID (required; or first environment is used)
  //   groups  - comma-separated caller group IDs/names (optional override)
  // -------------------------------------------------------------------------
  app.get("/:id/disclosure", async (c) => {
    try {
      const tenantId = c.req.param("id");
      const envIdParam = c.req.query("envId");
      const groupsParam = c.req.query("groups");

      // Derive caller identity from auth claims set by requireAuth middleware
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const claims = (c as any).get(CLAIMS_KEY) as TokenClaims | undefined;
      const callerEmail = claims?.subjectId ?? "anonymous";
      const callerIssuer = claims?.issuer ?? "";

      // Caller groups: query param takes precedence, then fall back to clientTags
      let callerGroups: string[];
      if (groupsParam) {
        callerGroups = groupsParam
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean);
      } else {
        callerGroups = [...(claims?.clientTags ?? [])];
      }

      const result = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          const registry = yield* CapabilityRegistry;

          // Load tenant
          const tenant = yield* mgr.getTenant(tenantId);

          // Load environment
          let environment: Environment;
          if (envIdParam) {
            environment = yield* mgr.getEnvironment(envIdParam);
          } else {
            const envs = yield* mgr.listEnvironments(tenantId);
            if (envs.length === 0) {
              return { error: "No environments found for tenant" };
            }
            environment = envs[0]!;
          }

          // Load tenant data
          const [approvals, certifications, roleMappings, packages] = yield* Effect.all([
            mgr.listPackageApprovals(tenantId),
            mgr.listCertifications(tenantId),
            mgr.listRoleMappings(tenantId),
            registry.listCapabilities(),
          ]);

          // Optionally match role mappings by issuer if email groups not provided
          // and issuer matches a known Entra tenant
          let effectiveGroups = callerGroups;
          if (effectiveGroups.length === 0 && callerIssuer) {
            // Auto-match: use all role mappings for the tenant when issuer aligns
            if (
              tenant.idpType === "entra" &&
              tenant.idpConfig.entraId?.tenantId === callerIssuer
            ) {
              effectiveGroups = roleMappings.map((m) => m.groupId);
            }
          }

          const context: DisclosureContext = {
            tenant,
            environment,
            callerGroups: effectiveGroups,
            callerEmail,
            tier: tenant.tier,
          };

          return computeDisclosure(context, packages, approvals, certifications, roleMappings);
        }),
      );

      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Templates router (separate prefix /api/templates)
// ---------------------------------------------------------------------------

export function templatesRouter(
  runtime: Runtime.Runtime<TenantManager>,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // GET /api/templates — list available policy templates
  app.get("/", async (c) => {
    try {
      const templates = await run(
        Effect.gen(function* () {
          const mgr = yield* TenantManager;
          return yield* mgr.listPolicyTemplates();
        }),
      );
      return c.json(templates);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
