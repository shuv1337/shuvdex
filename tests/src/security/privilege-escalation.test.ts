/**
 * Privilege escalation prevention tests (Phase 4D)
 *
 * Verifies that the authorization engine correctly enforces role boundaries:
 *  - Users cannot access capabilities outside their permitted packages
 *  - Read-only tokens cannot authorize write/admin tools
 *  - Private capabilities require admin scope
 *  - Non-admin tokens are denied admin-scoped capabilities
 *  - Policy deny-lists are respected
 *
 * Uses the real PolicyEngineLive with live CapabilityDefinition objects.
 */
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-privesc-test-"));
}

function makeReadTool(id: string, packageId: string): CapabilityDefinition {
  return {
    id,
    packageId,
    version: "1.0.0",
    kind: "tool",
    title: id,
    description: `Read-only tool ${id}`,
    enabled: true,
    visibility: "public",
    riskLevel: "low",
    tool: { sideEffectLevel: "read" },
  };
}

function makeWriteTool(id: string, packageId: string): CapabilityDefinition {
  return {
    id,
    packageId,
    version: "1.0.0",
    kind: "tool",
    title: id,
    description: `Write tool ${id}`,
    enabled: true,
    visibility: "public",
    riskLevel: "medium",
    tool: { sideEffectLevel: "write" },
  };
}

function makeAdminTool(id: string, packageId: string): CapabilityDefinition {
  return {
    id,
    packageId,
    version: "1.0.0",
    kind: "tool",
    title: id,
    description: `Admin-level tool ${id}`,
    enabled: true,
    visibility: "private",
    riskLevel: "high",
    subjectScopes: ["admin"],
    tool: { sideEffectLevel: "admin" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Privilege escalation prevention", () => {
  describe("package-based access control", () => {
    it("user cannot access tools outside their allowed packages", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const financeTool = makeReadTool("finance.get_report", "pkg-finance");
      const marketingTool = makeReadTool("marketing.get_campaign", "pkg-marketing");

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Token only permits pkg-finance
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "finance-user",
            scopes: ["capabilities:read"],
            allowedPackages: ["pkg-finance"],
          });

          const allowFinance = yield* engine.authorizeCapability(claims, financeTool);
          const allowMarketing = yield* engine.authorizeCapability(claims, marketingTool);

          return { allowFinance, allowMarketing };
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowFinance.allowed).toBe(true);
      expect(result.allowMarketing.allowed).toBe(false);
      expect(result.allowMarketing.reason).toMatch(/not allowlisted/i);
    });

    it("denied packages are blocked even if no allowlist restriction", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const approvedTool = makeReadTool("crm.get_contact", "pkg-crm");
      const blockedTool = makeReadTool("legacy.get_data", "pkg-legacy");

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Allow all packages EXCEPT pkg-legacy
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "standard-user",
            scopes: ["capabilities:read"],
            allowedPackages: ["*"],
            deniedPackages: ["pkg-legacy"],
          });

          const allowCrm = yield* engine.authorizeCapability(claims, approvedTool);
          const allowLegacy = yield* engine.authorizeCapability(claims, blockedTool);

          return { allowCrm, allowLegacy };
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowCrm.allowed).toBe(true);
      expect(result.allowLegacy.allowed).toBe(false);
      expect(result.allowLegacy.reason).toMatch(/denied by token/i);
    });
  });

  describe("scope-based access control", () => {
    it("read-only user cannot authorize write-scoped tools", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const readTool = makeReadTool("docs.read_document", "pkg-docs");
      // Write tool requires "capabilities:write" scope
      const writeTool: CapabilityDefinition = {
        ...makeWriteTool("docs.create_document", "pkg-docs"),
        subjectScopes: ["capabilities:write"],
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Read-only token — only capabilities:read scope
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "read-only-user",
            scopes: ["capabilities:read"],
            allowedPackages: ["*"],
          });

          const allowRead = yield* engine.authorizeCapability(claims, readTool);
          const allowWrite = yield* engine.authorizeCapability(claims, writeTool);

          return { allowRead, allowWrite };
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowRead.allowed).toBe(true);
      expect(result.allowWrite.allowed).toBe(false);
      expect(result.allowWrite.reason).toMatch(/scope/i);
    });

    it("wildcard scope token can authorize any tool", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const adminTool = makeAdminTool("sys.manage_config", "pkg-system");

      const allowed = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Platform admin token has wildcard scope
          const { claims } = yield* engine.issueToken({
            subjectType: "service",
            subjectId: "platform-admin-service",
            scopes: ["*"],
            allowedPackages: ["*"],
          });

          const decision = yield* engine.authorizeCapability(claims, adminTool);
          return decision.allowed;
        }).pipe(Effect.provide(layer)),
      );

      expect(allowed).toBe(true);
    });
  });

  describe("visibility-based access control", () => {
    it("non-admin cannot access private capabilities", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const privateTool: CapabilityDefinition = {
        ...makeReadTool("internal.debug_info", "pkg-internal"),
        visibility: "private",
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Regular user — no "admin" scope, no wildcard
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "regular-user",
            scopes: ["capabilities:read"],
            allowedPackages: ["*"],
          });

          return yield* engine.authorizeCapability(claims, privateTool);
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/private/i);
    });

    it("admin-scoped user can access private capabilities", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const privateTool: CapabilityDefinition = {
        ...makeReadTool("internal.debug_info", "pkg-internal"),
        visibility: "private",
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Token with "admin" scope
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "admin-user",
            scopes: ["admin"],
            allowedPackages: ["*"],
          });

          return yield* engine.authorizeCapability(claims, privateTool);
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("policy-based access control", () => {
    it("deny policy blocks capability even for otherwise authorized user", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const restrictedTool = makeReadTool("finance.export_payroll", "pkg-finance");

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Install a policy that explicitly denies finance.export_payroll
          yield* engine.upsertPolicy({
            id: "deny-payroll-export",
            description: "Payroll export requires special authorization",
            denyCapabilities: ["finance.export_payroll"],
          });

          // Even a user with broad access is denied
          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "finance-analyst",
            scopes: ["*"],
            allowedPackages: ["*"],
          });

          return yield* engine.authorizeCapability(claims, restrictedTool);
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/denied by policy/i);
    });

    it("risk-level ceiling policy blocks high-risk tools", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const highRiskTool: CapabilityDefinition = {
        ...makeWriteTool("data.bulk_delete", "pkg-data"),
        riskLevel: "high",
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Policy: maximum risk level is "medium"
          yield* engine.upsertPolicy({
            id: "max-medium-risk",
            description: "Standard users are limited to medium-risk tools",
            maxRiskLevel: "medium",
          });

          const { claims } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "standard-user-2",
            scopes: ["*"],
            allowedPackages: ["*"],
          });

          return yield* engine.authorizeCapability(claims, highRiskTool);
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/risk level exceeds policy/i);
    });

    it("non-admin role token is identifiable as non-admin via role field", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const claims = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;
          const { claims: c } = yield* engine.issueToken({
            subjectType: "user",
            subjectId: "regular-operator",
            scopes: ["capabilities:read"],
          });
          return c;
        }).pipe(Effect.provide(layer)),
      );

      // A token issued without an explicit role should not be platform_admin
      expect(claims.role).toBeUndefined();
    });

    it("disabled capability is denied regardless of policy", async () => {
      const layer = makePolicyEngineLive({ policyDir: makeTmpDir() });

      const disabledTool: CapabilityDefinition = {
        ...makeReadTool("legacy.disabled_tool", "pkg-legacy"),
        enabled: false,
      };

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const engine = yield* PolicyEngine;

          // Wildcard token — maximum access
          const { claims } = yield* engine.issueToken({
            subjectType: "service",
            subjectId: "admin-service",
            scopes: ["*"],
            allowedPackages: ["*"],
          });

          return yield* engine.authorizeCapability(claims, disabledTool);
        }).pipe(Effect.provide(layer)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/disabled/i);
    });
  });
});
