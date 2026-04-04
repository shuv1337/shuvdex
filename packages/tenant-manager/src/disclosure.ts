/**
 * Policy-driven disclosure engine (Phase 3B).
 *
 * Computes the visible capability set for a session by intersecting:
 *  - per-tenant package approvals
 *  - tier connector limits
 *  - caller role mappings
 *  - action-class and risk-level restrictions
 *
 * All logic is pure and synchronous; callers supply the loaded data.
 */
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import type {
  CapabilityCertification,
  CertificationState,
  PackageApprovalState,
  SubscriptionTier,
  Tenant,
  TenantPackageApproval,
  TenantRoleMapping,
} from "./types.js";
import type { Environment } from "./types.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DisclosureContext {
  readonly tenant: Tenant;
  readonly environment: Environment;
  readonly callerGroups: ReadonlyArray<string>;
  readonly callerEmail: string;
  readonly tier: SubscriptionTier;
}

export interface DisclosedCapabilitySet {
  readonly tenantId: string;
  readonly environmentId: string;
  readonly capabilities: ReadonlyArray<DisclosedCapability>;
  readonly connectorCount: number;
  readonly disclosedAt: string;
}

export interface DisclosedCapability {
  readonly capabilityId: string;
  readonly packageId: string;
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly actionClass: string;
  readonly riskLevel: string;
  readonly approvalState: PackageApprovalState;
  readonly certificationState: CertificationState;
  readonly requiresApproval: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ActionClass = "read" | "write" | "admin" | "external";
type RiskLevel = "low" | "medium" | "high" | "restricted";

const ACTION_CLASS_RANK: Record<ActionClass, number> = {
  read: 1,
  write: 2,
  admin: 3,
  external: 4,
};

const RISK_LEVEL_RANK: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  restricted: 4,
};

/** Derive the effective action class for a capability. */
function capabilityActionClass(cap: CapabilityDefinition): ActionClass {
  if (cap.kind === "tool" && cap.tool?.sideEffectLevel) {
    const level = cap.tool.sideEffectLevel;
    if (level === "write") return "write";
    if (level === "admin") return "admin";
    if (level === "external") return "external";
  }
  return "read";
}

/** Derive the effective risk level for a capability. */
function capabilityRiskLevel(cap: CapabilityDefinition): RiskLevel {
  return (cap.riskLevel as RiskLevel | undefined) ?? "low";
}

/**
 * Connector count = number of distinct packages that are connectors
 * (have at least one capability of kind "connector").
 */
function countConnectorPackages(capabilities: CapabilityDefinition[]): number {
  const connectorPackages = new Set<string>();
  for (const cap of capabilities) {
    if (cap.kind === "connector") {
      connectorPackages.add(cap.packageId);
    }
  }
  return connectorPackages.size;
}

/**
 * Maximum connector packages allowed for a tier.
 * -1 means unlimited (custom).
 */
function maxConnectorsForTier(tier: SubscriptionTier): number {
  switch (tier) {
    case "core":     return 2;
    case "standard": return 5;
    case "custom":   return -1;
  }
}

/**
 * Maximum risk level allowed for a tier.
 */
function maxRiskForTier(tier: SubscriptionTier): RiskLevel {
  switch (tier) {
    case "core":     return "low";
    case "standard": return "medium";
    case "custom":   return "high";
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute the disclosed capability set for a caller session.
 *
 * Filtering pipeline:
 *  1. Include only capabilities whose package has an `approved` or `active` approval.
 *  2. Enforce tier connector limits (core=2, standard=5, custom=unlimited).
 *  3. Enforce tier risk-level ceiling.
 *  4. Intersect with caller role mappings (group → allowed packages / capabilities).
 *  5. Apply the caller's effective max action class from role mappings.
 *  6. Apply the caller's effective max risk level from role mappings.
 *  7. Annotate with approval/certification states and requiresApproval flag.
 */
export function computeDisclosure(
  context: DisclosureContext,
  allCapabilities: CapabilityDefinition[],
  approvals: TenantPackageApproval[],
  certifications: CapabilityCertification[],
  roleMappings: TenantRoleMapping[],
): DisclosedCapabilitySet {
  const { tenant, environment, callerGroups, tier } = context;

  // -- Step 1: Build lookup maps --
  const approvalByPackage = new Map<string, TenantPackageApproval>();
  for (const a of approvals) {
    approvalByPackage.set(a.packageId, a);
  }

  const certByCapability = new Map<string, CapabilityCertification>();
  for (const c of certifications) {
    certByCapability.set(c.capabilityId, c);
  }

  // -- Step 2: Filter by package approval state --
  const approvedStates: ReadonlySet<PackageApprovalState> = new Set(["approved", "active"]);
  let filtered = allCapabilities.filter((cap) => {
    const approval = approvalByPackage.get(cap.packageId);
    // If no explicit approval record, treat as not approved
    return approval !== undefined && approvedStates.has(approval.state);
  });

  // -- Step 3: Enforce tier connector limit --
  const tierMaxConnectors = maxConnectorsForTier(tier);
  if (tierMaxConnectors >= 0) {
    // Collect connector package IDs in order they appear, capped at limit
    const connectorPackages: string[] = [];
    for (const cap of filtered) {
      if (cap.kind === "connector" && !connectorPackages.includes(cap.packageId)) {
        if (connectorPackages.length < tierMaxConnectors) {
          connectorPackages.push(cap.packageId);
        }
      }
    }
    filtered = filtered.filter(
      (cap) => cap.kind !== "connector" || connectorPackages.includes(cap.packageId),
    );
  }

  // -- Step 4: Enforce tier risk-level ceiling --
  const tierMaxRiskRank = RISK_LEVEL_RANK[maxRiskForTier(tier)];
  filtered = filtered.filter(
    (cap) => RISK_LEVEL_RANK[capabilityRiskLevel(cap)] <= tierMaxRiskRank,
  );

  // -- Step 5: Apply caller role mappings --
  const callerMappings = roleMappings.filter(
    (m) => callerGroups.includes(m.groupId) || callerGroups.includes(m.groupName),
  );

  if (callerMappings.length > 0) {
    // Build union of allowed packages and capabilities across all matched groups
    const allowsAllPackages = callerMappings.some((m) => m.allowedPackages.includes("*"));
    const allowedPackageSet = new Set<string>();
    const allowedCapabilitySet = new Set<string>();
    let effectiveMaxActionRank = 0;
    let effectiveMaxRiskRank = 0;

    for (const m of callerMappings) {
      for (const p of m.allowedPackages) {
        if (p !== "*") allowedPackageSet.add(p);
      }
      if (m.allowedCapabilities) {
        for (const c of m.allowedCapabilities) {
          allowedCapabilitySet.add(c);
        }
      }
      effectiveMaxActionRank = Math.max(
        effectiveMaxActionRank,
        ACTION_CLASS_RANK[m.maxActionClass],
      );
      effectiveMaxRiskRank = Math.max(
        effectiveMaxRiskRank,
        RISK_LEVEL_RANK[m.maxRiskLevel],
      );
    }

    filtered = filtered.filter((cap) => {
      // Package filter
      if (!allowsAllPackages && !allowedPackageSet.has(cap.packageId)) {
        // Check if there's a per-capability allow list that covers this cap
        if (allowedCapabilitySet.size === 0 || !allowedCapabilitySet.has(cap.id)) {
          return false;
        }
      }
      // Per-capability allow list overrides (if any mapping specified capabilities)
      const hasCapsFilter = callerMappings.some(
        (m) => m.allowedCapabilities && m.allowedCapabilities.length > 0,
      );
      if (hasCapsFilter && allowedCapabilitySet.size > 0) {
        if (!allowedCapabilitySet.has(cap.id) && !allowedPackageSet.has(cap.packageId) && !allowsAllPackages) {
          return false;
        }
      }
      // Action class filter
      if (ACTION_CLASS_RANK[capabilityActionClass(cap)] > effectiveMaxActionRank) {
        return false;
      }
      // Risk level filter
      if (RISK_LEVEL_RANK[capabilityRiskLevel(cap)] > effectiveMaxRiskRank) {
        return false;
      }
      return true;
    });
  } else {
    // No matching role mappings — fall back to read-only, low-risk only
    filtered = filtered.filter(
      (cap) =>
        capabilityActionClass(cap) === "read" &&
        capabilityRiskLevel(cap) === "low",
    );
  }

  // -- Step 6: Build output --
  const connectorCount = countConnectorPackages(filtered);

  const disclosedCapabilities: DisclosedCapability[] = filtered.map((cap) => {
    const approvalState = approvalByPackage.get(cap.packageId)?.state ?? "discovered";
    const certState: CertificationState = certByCapability.get(cap.id)?.state ?? "unknown";
    const actionClass = capabilityActionClass(cap);
    const riskLevel = capabilityRiskLevel(cap);

    const requiresApproval =
      actionClass !== "read" ||
      riskLevel === "high" ||
      riskLevel === "restricted" ||
      cap.visibility === "scoped";

    return {
      capabilityId: cap.id,
      packageId: cap.packageId,
      kind: cap.kind,
      title: cap.title,
      description: cap.description,
      actionClass,
      riskLevel,
      approvalState,
      certificationState: certState,
      requiresApproval,
    };
  });

  return {
    tenantId: tenant.tenantId,
    environmentId: environment.environmentId,
    capabilities: disclosedCapabilities,
    connectorCount,
    disclosedAt: new Date().toISOString(),
  };
}
