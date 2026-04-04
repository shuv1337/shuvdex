import { createHmac, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer, Ref } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import { InvalidTokenError, PolicyEngineIOError, PolicyNotFound } from "./errors.js";
import { PolicyEngine } from "./types.js";
import type {
  AuditEvent,
  AuthorizationDecision,
  CapabilitySubjectPolicy,
  IdPConfig,
  IssueTokenInput,
  PolicyEngineService,
  TokenClaims,
} from "./types.js";
import { resolveIdentity } from "./idp.js";
import type { GroupMapping } from "./idp.js";
import { makeAuditServiceImpl } from "./audit-live.js";
import type { AuditServiceInterface } from "./audit-service.js";
import type { AuditDecision, RuntimeAuditAction } from "./audit-types.js";

interface PolicyEnginePaths {
  readonly rootDir: string;
  readonly policiesPath: string;
  readonly revocationsPath: string;
  /** @deprecated – kept for reference; new audit writes go to {rootDir}/audit/ */
  readonly auditPath: string;
  readonly auditDir: string;
  readonly idpConfigPath: string;
}

const DEFAULT_ISSUER = "shuvdex";
const DEFAULT_KEY_ID = "local-hs256";

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, "utf-8").toString("base64url");

const base64UrlDecode = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf-8");

const matchesPackageRule = (rules: ReadonlyArray<string>, packageId: string): boolean =>
  rules.some((rule) => rule === "*" || rule === packageId || rule.endsWith(".*") && packageId.startsWith(rule.slice(0, -1)));

function riskRank(level: CapabilityDefinition["riskLevel"]): number {
  switch (level) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function buildDefaultClaims(): TokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: "local-default",
    subjectType: "service",
    subjectId: "local-stdio",
    hostTags: [],
    clientTags: ["local"],
    scopes: ["*"],
    allowedPackages: ["*"],
    deniedPackages: [],
    issuedAt: now,
    expiresAt: now + 365 * 24 * 60 * 60,
    issuer: DEFAULT_ISSUER,
    keyId: DEFAULT_KEY_ID,
  };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function makePolicyEngineLive(
  options?: {
    policyDir?: string;
    secret?: string;
  },
): Layer.Layer<PolicyEngine> {
  const rootDir =
    options?.policyDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-policy-"));
  const paths: PolicyEnginePaths = {
    rootDir,
    policiesPath: path.join(rootDir, "policies.json"),
    revocationsPath: path.join(rootDir, "revocations.json"),
    auditPath: path.join(rootDir, "audit.jsonl"),
    auditDir: path.join(rootDir, "audit"),
    idpConfigPath: path.join(rootDir, "idp-config.json"),
  };
  const secret = options?.secret ?? "shuvdex-dev-secret";
  fs.mkdirSync(rootDir, { recursive: true });
  const policiesRef = Ref.unsafeMake<CapabilitySubjectPolicy[]>(
    readJsonFile(paths.policiesPath, []),
  );
  const revocationsRef = Ref.unsafeMake<string[]>(
    readJsonFile(paths.revocationsPath, []),
  );

  // Rich audit service – manages its own in-memory buffer and JSONL files.
  const auditSvc: AuditServiceInterface = makeAuditServiceImpl({ auditDir: paths.auditDir });

  const persistPolicies = (policies: CapabilitySubjectPolicy[]) =>
    Effect.try({
      try: () => fs.writeFileSync(paths.policiesPath, JSON.stringify(policies, null, 2)),
      catch: (cause) =>
        new PolicyEngineIOError({ path: paths.policiesPath, cause: String(cause) }),
    });

  const persistRevocations = (revocations: string[]) =>
    Effect.try({
      try: () => fs.writeFileSync(paths.revocationsPath, JSON.stringify(revocations, null, 2)),
      catch: (cause) =>
        new PolicyEngineIOError({ path: paths.revocationsPath, cause: String(cause) }),
    });

  // ---------------------------------------------------------------------------
  // Legacy AuditEvent bridge helpers
  // ---------------------------------------------------------------------------

  function legacyActionToRuntimeAction(action: AuditEvent["action"]): RuntimeAuditAction {
    switch (action) {
      case "call_tool":      return "tool_call";
      case "read_resource":  return "resource_read";
      case "get_prompt":     return "prompt_get";
      case "list_tools":     return "tools_list";
      case "list_resources": return "resources_list";
      case "list_prompts":   return "prompts_list";
    }
  }

  function runtimeDecisionToLegacy(decision: AuditDecision): "allow" | "deny" {
    return decision === "allow" ? "allow" : "deny";
  }

  /**
   * Map a set of IdP group IDs/names to shuvdex scopes using the groupMapping
   * configuration. Groups not present in the map are ignored.
   */
  function groupsToScopes(groups: string[], mapping: GroupMapping | undefined): string[] {
    if (!mapping || groups.length === 0) return [];
    const scopes = new Set<string>();
    for (const group of groups) {
      const mapped = mapping[group];
      if (mapped) {
        for (const scope of mapped) {
          scopes.add(scope);
        }
      }
    }
    return Array.from(scopes);
  }

  /** Build TokenClaims from a resolved external identity + optional IdP config. */
  function externalIdentityToClaims(
    identity: Awaited<ReturnType<typeof resolveIdentity>>,
    idpConfig: IdPConfig,
  ): TokenClaims {
    const now = Math.floor(Date.now() / 1000);
    // Derive scopes from group mapping (provider-specific)
    let scopes: string[] = [];
    if (identity.provider === "entra" && idpConfig.entra?.groupMapping) {
      scopes = groupsToScopes(identity.groups, idpConfig.entra.groupMapping);
    }
    // Fall back to read-only scope when no group mapping matches
    if (scopes.length === 0) {
      scopes = ["capabilities:read"];
    }

    return {
      jti: randomUUID(),
      subjectType: "user",
      subjectId: identity.subjectId || identity.email,
      hostTags: [],
      clientTags: [identity.provider],
      scopes,
      allowedPackages: ["*"],
      deniedPackages: [],
      issuedAt: now,
      // External tokens expire in 1 hour (the underlying token exp is already validated)
      expiresAt: now + 60 * 60,
      issuer: identity.provider === "entra" ? identity.tenantId : "google",
      keyId: `external-${identity.provider}`,
    };
  }

  const service: PolicyEngineService = {
        audit: auditSvc,
        issueToken: (input: IssueTokenInput) =>
          Effect.sync(() => {
            const now = Math.floor(Date.now() / 1000);
            const claims: TokenClaims = {
              jti: randomUUID(),
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              hostTags: [...(input.hostTags ?? [])],
              clientTags: [...(input.clientTags ?? [])],
              scopes: [...(input.scopes ?? [])],
              allowedPackages: [...(input.allowedPackages ?? ["*"])],
              deniedPackages: [...(input.deniedPackages ?? [])],
              issuedAt: now,
              expiresAt: now + (input.ttlSeconds ?? 60 * 60 * 24 * 30),
              issuer: DEFAULT_ISSUER,
              keyId: DEFAULT_KEY_ID,
            };
            const header = { alg: "HS256", typ: "JWT", kid: DEFAULT_KEY_ID };
            const payload = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
              JSON.stringify(claims),
            )}`;
            return { token: `${payload}.${sign(secret, payload)}`, claims };
          }),
        verifyToken: (token: string) =>
          Effect.gen(function* () {
            const [headerPart, claimsPart, sigPart] = token.split(".");
            if (!headerPart || !claimsPart || !sigPart) {
              return yield* Effect.fail(new InvalidTokenError({ reason: "Token is not a 3-part JWT" }));
            }
            const payload = `${headerPart}.${claimsPart}`;
            if (sign(secret, payload) !== sigPart) {
              return yield* Effect.fail(new InvalidTokenError({ reason: "Signature mismatch" }));
            }
            const claims = JSON.parse(base64UrlDecode(claimsPart)) as TokenClaims;
            const revocations = yield* Ref.get(revocationsRef);
            const now = Math.floor(Date.now() / 1000);
            if (revocations.includes(claims.jti)) {
              return yield* Effect.fail(new InvalidTokenError({ reason: "Token revoked" }));
            }
            if (claims.expiresAt <= now) {
              return yield* Effect.fail(new InvalidTokenError({ reason: "Token expired" }));
            }
            return claims;
          }),
        resolveExternalToken: (token: string) =>
          Effect.gen(function* () {
            // Detect internal tokens by checking the kid in the header part.
            // Internal tokens always use kid "local-hs256".
            const parts = token.split(".");
            if (parts.length === 3 && parts[0]) {
              try {
                const header = JSON.parse(
                  Buffer.from(parts[0], "base64url").toString("utf-8"),
                ) as { kid?: string };
                if (header.kid === DEFAULT_KEY_ID) {
                  // Delegate to the internal HMAC verifier
                  return yield* service.verifyToken(token);
                }
              } catch {
                // If header decode fails, fall through to IdP validation
              }
            }

            // External IdP token — load config and validate
            const idpConfig = readJsonFile<IdPConfig>(paths.idpConfigPath, {});

            if (!idpConfig.entra && !idpConfig.google) {
              return yield* Effect.fail(
                new InvalidTokenError({
                  reason:
                    "No IdP configured (idp-config.json not found or empty) and token is not an internal JWT",
                }),
              );
            }

            try {
              const identity = yield* Effect.tryPromise({
                try: () => resolveIdentity(token, idpConfig),
                catch: (cause) =>
                  new InvalidTokenError({ reason: `IdP validation failed: ${String(cause)}` }),
              });
              return externalIdentityToClaims(identity, idpConfig);
            } catch (cause) {
              return yield* Effect.fail(
                new InvalidTokenError({ reason: `External token resolution failed: ${String(cause)}` }),
              );
            }
          }),
        revokeToken: (jti: string) =>
          Ref.updateAndGet(revocationsRef, (revocations) =>
            revocations.includes(jti) ? revocations : [...revocations, jti],
          ).pipe(Effect.flatMap((revocations) => persistRevocations(revocations))),
        listPolicies: () => Ref.get(policiesRef),
        upsertPolicy: (policy) =>
          Ref.updateAndGet(policiesRef, (policies) => {
            const next = policies.filter((item) => item.id !== policy.id);
            next.push(policy);
            return next.sort((a, b) => a.id.localeCompare(b.id));
          }).pipe(
            Effect.flatMap((policies) => persistPolicies(policies).pipe(Effect.as(policy))),
          ),
        deletePolicy: (policyId) =>
          Effect.gen(function* () {
            const policies = yield* Ref.get(policiesRef);
            if (!policies.some((policy) => policy.id === policyId)) {
              return yield* Effect.fail(new PolicyNotFound({ policyId }));
            }
            const next = policies.filter((policy) => policy.id !== policyId);
            yield* Ref.set(policiesRef, next);
            yield* persistPolicies(next);
          }),
        authorizeCapability: (claims, capability) =>
          Effect.gen(function* () {
            const matchedPolicyIds: string[] = [];
            const policies = yield* Ref.get(policiesRef);
            const capabilityPackage = capability.packageId;
            if (claims.deniedPackages.length > 0 && matchesPackageRule(claims.deniedPackages, capabilityPackage)) {
              return {
                allowed: false,
                reason: `Package ${capabilityPackage} denied by token`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }
            if (
              claims.allowedPackages.length > 0 &&
              !matchesPackageRule(claims.allowedPackages, capabilityPackage) &&
              !claims.allowedPackages.includes("*")
            ) {
              return {
                allowed: false,
                reason: `Package ${capabilityPackage} not allowlisted by token`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }
            if (
              capability.subjectScopes &&
              capability.subjectScopes.length > 0 &&
              !claims.scopes.includes("*") &&
              !capability.subjectScopes.some((scope) => claims.scopes.includes(scope))
            ) {
              return {
                allowed: false,
                reason: `Missing required scope for ${capability.id}`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }
            if (capability.hostTags?.length && !capability.hostTags.some((tag) => claims.hostTags.includes(tag))) {
              return {
                allowed: false,
                reason: `Host tags do not match ${capability.id}`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }
            if (
              capability.clientTags?.length &&
              !capability.clientTags.some((tag) => claims.clientTags.includes(tag))
            ) {
              return {
                allowed: false,
                reason: `Client tags do not match ${capability.id}`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }

            for (const policy of policies) {
              const scopeMatch =
                !policy.scopes ||
                policy.scopes.length === 0 ||
                policy.scopes.some((scope) => claims.scopes.includes("*") || claims.scopes.includes(scope));
              if (!scopeMatch) {
                continue;
              }
              matchedPolicyIds.push(policy.id);
              if (policy.denyPackages?.includes(capabilityPackage) || policy.denyCapabilities?.includes(capability.id)) {
                return {
                  allowed: false,
                  reason: `Denied by policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
              if (
                policy.maxRiskLevel &&
                riskRank(capability.riskLevel) > riskRank(policy.maxRiskLevel)
              ) {
                return {
                  allowed: false,
                  reason: `Risk level exceeds policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
              if (
                policy.hostTags?.length &&
                !policy.hostTags.some((tag) => claims.hostTags.includes(tag))
              ) {
                return {
                  allowed: false,
                  reason: `Denied by host tag policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
              if (
                policy.clientTags?.length &&
                !policy.clientTags.some((tag) => claims.clientTags.includes(tag))
              ) {
                return {
                  allowed: false,
                  reason: `Denied by client tag policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
              if (
                policy.allowPackages?.length &&
                !policy.allowPackages.includes(capabilityPackage) &&
                !policy.allowPackages.includes("*")
              ) {
                return {
                  allowed: false,
                  reason: `Package not permitted by policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
              if (
                policy.allowCapabilities?.length &&
                !policy.allowCapabilities.includes(capability.id)
              ) {
                return {
                  allowed: false,
                  reason: `Capability not permitted by policy ${policy.id}`,
                  matchedPolicyIds,
                } satisfies AuthorizationDecision;
              }
            }

            if (capability.visibility === "private" && !claims.scopes.includes("*") && !claims.scopes.includes("admin")) {
              return {
                allowed: false,
                reason: `Capability ${capability.id} is private`,
                matchedPolicyIds,
              } satisfies AuthorizationDecision;
            }

            return {
              allowed: capability.enabled,
              reason: capability.enabled ? "Allowed" : `Capability ${capability.id} is disabled`,
              matchedPolicyIds,
            } satisfies AuthorizationDecision;
          }),
        recordAuditEvent: (event) =>
          auditSvc.recordRuntimeEvent({
            actor: {
              subjectId: event.subjectId,
              subjectType: "service",
            },
            action: legacyActionToRuntimeAction(event.action),
            actionClass:
              event.action === "call_tool" ? "external" : "read",
            decision: event.decision as AuditDecision,
            decisionReason: event.reason,
            target: event.capabilityId
              ? { type: "tool", id: event.capabilityId }
              : undefined,
            packageRef: event.packageId
              ? { packageId: event.packageId, capabilityId: event.capabilityId }
              : undefined,
          }).pipe(
            // recordAuditEvent on the public interface still carries
            // PolicyEngineIOError for backward compat – but since the
            // underlying audit service swallows IO errors, this Effect
            // can never actually fail.  Cast so callers see the old type.
            Effect.mapError(
              () => new PolicyEngineIOError({ path: paths.auditDir, cause: "audit write" }),
            ),
          ),
        listAuditEvents: () =>
          auditSvc.queryEvents({ limit: 10_000 }).pipe(
            Effect.map((result) =>
              result.events.map((record) => {
                const legacyActionMap: Partial<Record<string, AuditEvent["action"]>> = {
                  tool_call:      "call_tool",
                  resource_read:  "read_resource",
                  prompt_get:     "get_prompt",
                  tools_list:     "list_tools",
                  resources_list: "list_resources",
                  prompts_list:   "list_prompts",
                };
                return {
                  id: record.eventId,
                  timestamp: record.timestamp,
                  action: (legacyActionMap[record.action] ?? "call_tool") as AuditEvent["action"],
                  subjectId: record.actor.subjectId,
                  capabilityId: record.packageRef?.capabilityId,
                  packageId: record.packageRef?.packageId,
                  decision: runtimeDecisionToLegacy(record.decision),
                  reason: record.decisionReason,
                  executor: undefined,
                } satisfies AuditEvent;
              }),
            ),
          ),
        defaultClaims: () => buildDefaultClaims(),
  };

  return Layer.succeed(PolicyEngine, service);
}

export const PolicyEngineLive: Layer.Layer<PolicyEngine> = makePolicyEngineLive();
