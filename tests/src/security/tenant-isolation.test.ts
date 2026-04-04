/**
 * Tenant isolation security tests (Phase 4D)
 *
 * Verifies that the disclosure engine and audit system correctly isolate
 * data between tenants:
 *  - Tenant A cannot see Tenant B tools (disclosure engine)
 *  - Tenant A cannot see Tenant B credentials (package approval scoping)
 *  - Tenant A cannot see Tenant B audit events (audit tenantId filter)
 *
 * All tests use live implementations backed by temp directories.
 */
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { computeDisclosure } from "@shuvdex/tenant-manager";
import type {
  CapabilityCertification,
  DisclosureContext,
  Tenant,
  Environment,
  TenantPackageApproval,
  TenantRoleMapping,
} from "@shuvdex/tenant-manager";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

function makeTenant(id: string): Tenant {
  return {
    tenantId: id,
    name: `Tenant ${id}`,
    status: "active",
    tier: "standard",
    idpType: "entra",
    idpConfig: {},
    owner: { name: `Owner ${id}`, email: `owner@${id}.example` },
    maxConnectors: 5,
    maxUsers: 50,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeEnvironment(tenantId: string): Environment {
  return {
    environmentId: `env-${tenantId}`,
    tenantId,
    name: "production",
    type: "production",
    credentialNamespace: tenantId,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeCapability(
  id: string,
  packageId: string,
): CapabilityDefinition {
  return {
    id,
    packageId,
    version: "1.0.0",
    kind: "tool",
    title: id,
    description: `A read-only tool belonging to ${packageId}`,
    enabled: true,
    visibility: "public",
    riskLevel: "low",
    tool: { sideEffectLevel: "read" },
  };
}

function makeApproval(
  tenantId: string,
  packageId: string,
): TenantPackageApproval {
  return { tenantId, packageId, state: "active" };
}

function makeRoleMapping(tenantId: string): TenantRoleMapping {
  return {
    tenantId,
    groupId: "all-users",
    groupName: "All Users",
    allowedPackages: ["*"],
    maxActionClass: "read",
    maxRiskLevel: "medium",
  };
}

const EMPTY_CERTS: CapabilityCertification[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tenant isolation", () => {
  describe("tool disclosure isolation", () => {
    it("tenant A cannot see tenant B tools", () => {
      const tenantA = makeTenant("tenant-a");
      const tenantB = makeTenant("tenant-b");
      const envA = makeEnvironment("tenant-a");
      const envB = makeEnvironment("tenant-b");

      // Each tenant gets its own unique capability package
      const capA = makeCapability("finance.list_invoices", "pkg-finance");
      const capB = makeCapability("hr.list_employees", "pkg-hr");

      // Only pkg-finance is approved for tenant A; only pkg-hr for tenant B
      const approvalsA = [makeApproval("tenant-a", "pkg-finance")];
      const approvalsB = [makeApproval("tenant-b", "pkg-hr")];

      const roleMappingsA = [makeRoleMapping("tenant-a")];
      const roleMappingsB = [makeRoleMapping("tenant-b")];

      const allCaps: CapabilityDefinition[] = [capA, capB];

      const ctxA: DisclosureContext = {
        tenant: tenantA,
        environment: envA,
        callerGroups: ["all-users"],
        callerEmail: "user@tenant-a.example",
        tier: "standard",
      };

      const ctxB: DisclosureContext = {
        tenant: tenantB,
        environment: envB,
        callerGroups: ["all-users"],
        callerEmail: "user@tenant-b.example",
        tier: "standard",
      };

      const disclosureA = computeDisclosure(ctxA, allCaps, approvalsA, EMPTY_CERTS, roleMappingsA);
      const disclosureB = computeDisclosure(ctxB, allCaps, approvalsB, EMPTY_CERTS, roleMappingsB);

      const idsA = disclosureA.capabilities.map((c) => c.capabilityId);
      const idsB = disclosureB.capabilities.map((c) => c.capabilityId);

      // Tenant A sees their own tool
      expect(idsA).toContain("finance.list_invoices");
      // Tenant A cannot see tenant B's tool
      expect(idsA).not.toContain("hr.list_employees");

      // Tenant B sees their own tool
      expect(idsB).toContain("hr.list_employees");
      // Tenant B cannot see tenant A's tool
      expect(idsB).not.toContain("finance.list_invoices");

      // Zero overlap
      const overlap = idsA.filter((id) => idsB.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it("unapproved package tools are never disclosed regardless of shared capability list", () => {
      const tenant = makeTenant("tenant-partial");
      const env = makeEnvironment("tenant-partial");

      const capApproved = makeCapability("crm.list_contacts", "pkg-crm");
      const capUnapproved = makeCapability("billing.delete_invoice", "pkg-billing");

      // Only pkg-crm is approved; pkg-billing is not in approvals at all
      const approvals = [makeApproval("tenant-partial", "pkg-crm")];
      const roleMappings = [makeRoleMapping("tenant-partial")];

      const ctx: DisclosureContext = {
        tenant,
        environment: env,
        callerGroups: ["all-users"],
        callerEmail: "user@tenant-partial.example",
        tier: "standard",
      };

      const disclosure = computeDisclosure(
        ctx,
        [capApproved, capUnapproved],
        approvals,
        EMPTY_CERTS,
        roleMappings,
      );

      const ids = disclosure.capabilities.map((c) => c.capabilityId);
      expect(ids).toContain("crm.list_contacts");
      expect(ids).not.toContain("billing.delete_invoice");
    });

    it("tenant A cannot access tenant B credentials via package disclosure", () => {
      // Credentials are scoped by package approval.
      // Here we simulate: both tenants have a capability in the same package namespace,
      // but each tenant only approves their own package → credential access is
      // implicitly limited to the package being accessed.

      const tenantA = makeTenant("cred-tenant-a");
      const tenantB = makeTenant("cred-tenant-b");
      const envA = makeEnvironment("cred-tenant-a");
      const envB = makeEnvironment("cred-tenant-b");

      // Both tenants have a tool in the same namespace (simulates shared upstream)
      // but each only approves their own package binding
      const capForA = makeCapability("shared.get_data", "pkg-shared-a");
      const capForB = makeCapability("shared.get_data", "pkg-shared-b");

      const approvalsA = [makeApproval("cred-tenant-a", "pkg-shared-a")];
      const approvalsB = [makeApproval("cred-tenant-b", "pkg-shared-b")];

      const ctxA: DisclosureContext = {
        tenant: tenantA,
        environment: envA,
        callerGroups: ["all-users"],
        callerEmail: "user@a.example",
        tier: "standard",
      };
      const ctxB: DisclosureContext = {
        tenant: tenantB,
        environment: envB,
        callerGroups: ["all-users"],
        callerEmail: "user@b.example",
        tier: "standard",
      };

      const roleMappings = [
        makeRoleMapping("cred-tenant-a"),
        makeRoleMapping("cred-tenant-b"),
      ];

      const disclosureA = computeDisclosure(
        ctxA,
        [capForA, capForB],
        approvalsA,
        EMPTY_CERTS,
        [makeRoleMapping("cred-tenant-a")],
      );
      const disclosureB = computeDisclosure(
        ctxB,
        [capForA, capForB],
        approvalsB,
        EMPTY_CERTS,
        [makeRoleMapping("cred-tenant-b")],
      );

      // Each tenant sees only their scoped variant of the capability
      const pkgsA = disclosureA.capabilities.map((c) => c.packageId);
      const pkgsB = disclosureB.capabilities.map((c) => c.packageId);

      expect(pkgsA).toContain("pkg-shared-a");
      expect(pkgsA).not.toContain("pkg-shared-b");

      expect(pkgsB).toContain("pkg-shared-b");
      expect(pkgsB).not.toContain("pkg-shared-a");
    });
  });

  describe("audit event isolation", () => {
    it("tenant A cannot see tenant B audit events", async () => {
      const layer = makePolicyEngineLive({
        policyDir: fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-audit-isolation-")),
      });

      const [eventsForA, eventsForB] = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const audit = engine.audit;

          // Record events scoped to tenant-a
          yield* audit.recordRuntimeEvent({
            tenantId: "tenant-a",
            actor: { subjectId: "alice", subjectType: "user" },
            action: "tool_call",
            actionClass: "read",
            decision: "allow",
            decisionReason: "authorized for tenant-a",
          });
          yield* audit.recordRuntimeEvent({
            tenantId: "tenant-a",
            actor: { subjectId: "alice", subjectType: "user" },
            action: "tools_list",
            actionClass: "read",
            decision: "allow",
            decisionReason: "list request for tenant-a",
          });

          // Record events scoped to tenant-b
          yield* audit.recordRuntimeEvent({
            tenantId: "tenant-b",
            actor: { subjectId: "bob", subjectType: "user" },
            action: "tool_call",
            actionClass: "read",
            decision: "allow",
            decisionReason: "authorized for tenant-b",
          });

          // Query filtered by tenant
          const resultA = yield* audit.queryEvents({ tenantId: "tenant-a" });
          const resultB = yield* audit.queryEvents({ tenantId: "tenant-b" });

          return [resultA.events, resultB.events] as const;
        }).pipe(Effect.provide(layer)),
      );

      // Tenant A's query returns only tenant-a events
      expect(eventsForA.length).toBe(2);
      expect(eventsForA.every((e) => e.tenantId === "tenant-a")).toBe(true);

      // Tenant B's query returns only tenant-b events
      expect(eventsForB.length).toBe(1);
      expect(eventsForB.every((e) => e.tenantId === "tenant-b")).toBe(true);

      // No cross-contamination
      const tenantAIds = new Set(eventsForA.map((e) => e.eventId));
      const tenantBIds = new Set(eventsForB.map((e) => e.eventId));
      const overlap = [...tenantAIds].filter((id) => tenantBIds.has(id));
      expect(overlap).toHaveLength(0);
    });

    it("audit query without tenantId filter returns events from all tenants", async () => {
      const layer = makePolicyEngineLive({
        policyDir: fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-audit-all-")),
      });

      const totalCount = await Effect.runPromise(
        Effect.gen(function* () {
          const audit = (yield* PolicyEngine).audit;

          yield* audit.recordRuntimeEvent({
            tenantId: "multi-a",
            actor: { subjectId: "u1", subjectType: "user" },
            action: "tools_list",
            actionClass: "read",
            decision: "allow",
            decisionReason: "ok",
          });
          yield* audit.recordRuntimeEvent({
            tenantId: "multi-b",
            actor: { subjectId: "u2", subjectType: "user" },
            action: "tools_list",
            actionClass: "read",
            decision: "allow",
            decisionReason: "ok",
          });

          // No tenantId filter → sees all
          const all = yield* audit.queryEvents({});
          return all.total;
        }).pipe(Effect.provide(layer)),
      );

      expect(totalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("tier-based capability limits", () => {
    it("core-tier tenant cannot see capabilities above low risk level", () => {
      const coreTenant = makeTenant("core-client");
      coreTenant.tier; // confirm it's readable
      const tenant: Tenant = { ...coreTenant, tier: "core" };
      const env = makeEnvironment("core-client");

      const lowRiskCap = makeCapability("read.safe_data", "pkg-safe");
      const highRiskCap: CapabilityDefinition = {
        ...makeCapability("admin.delete_everything", "pkg-dangerous"),
        riskLevel: "high",
        tool: { sideEffectLevel: "admin" },
      };

      const approvals: TenantPackageApproval[] = [
        makeApproval("core-client", "pkg-safe"),
        makeApproval("core-client", "pkg-dangerous"),
      ];
      const roleMappings: TenantRoleMapping[] = [
        {
          ...makeRoleMapping("core-client"),
          maxActionClass: "admin",
          maxRiskLevel: "high",
        },
      ];

      const ctx: DisclosureContext = {
        tenant,
        environment: env,
        callerGroups: ["all-users"],
        callerEmail: "user@core.example",
        tier: "core",
      };

      const disclosure = computeDisclosure(
        ctx,
        [lowRiskCap, highRiskCap],
        approvals,
        EMPTY_CERTS,
        roleMappings,
      );

      const ids = disclosure.capabilities.map((c) => c.capabilityId);
      // Core tier max risk is "low" — high-risk tool must not appear
      expect(ids).toContain("read.safe_data");
      expect(ids).not.toContain("admin.delete_everything");
    });
  });
});
