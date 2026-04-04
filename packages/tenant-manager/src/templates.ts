import type { PolicyTemplate } from "./types.js";

/**
 * Built-in policy templates per spec.
 *
 * core     — $99/mo:   2 integrations, read-only,         20 users
 * standard — $179/mo:  5 integrations, selective write,   50 users
 * custom   — POA:      unlimited,      bespoke,           full governance
 */
export const BUILT_IN_TEMPLATES: ReadonlyArray<PolicyTemplate> = [
  {
    templateId: "core",
    name: "Core",
    tier: "core",
    description:
      "Entry-level plan ($99/mo). Up to 2 integrations, read-only access, 20 users. " +
      "Suitable for teams that need structured read access to internal knowledge and tooling.",
    maxConnectors: 2,
    maxUsers: 20,
    allowedUpstreams: [],
    roleMappings: [
      {
        groupId: "core-users",
        groupName: "Core Users",
        allowedPackages: ["*"],
        maxActionClass: "read",
        maxRiskLevel: "low",
      },
    ],
    defaultReadOnly: true,
    auditRetentionDays: 30,
    reviewCadenceDays: 90,
  },
  {
    templateId: "standard",
    name: "Standard",
    tier: "standard",
    description:
      "Standard plan ($179/mo). Up to 5 integrations, selective write operations, 50 users. " +
      "Ideal for teams that need write-capable automations with a governed approval process.",
    maxConnectors: 5,
    maxUsers: 50,
    allowedUpstreams: [],
    roleMappings: [
      {
        groupId: "standard-users",
        groupName: "Standard Users",
        allowedPackages: ["*"],
        maxActionClass: "read",
        maxRiskLevel: "medium",
      },
      {
        groupId: "standard-approvers",
        groupName: "Standard Approvers",
        allowedPackages: ["*"],
        maxActionClass: "write",
        maxRiskLevel: "medium",
      },
    ],
    defaultReadOnly: false,
    auditRetentionDays: 90,
    reviewCadenceDays: 30,
  },
  {
    templateId: "custom",
    name: "Custom",
    tier: "custom",
    description:
      "Custom plan (Price on application). Unlimited integrations and users, bespoke configuration, " +
      "full governance controls. Tailored for enterprise deployments with advanced security requirements.",
    maxConnectors: -1,
    maxUsers: -1,
    allowedUpstreams: ["*"],
    roleMappings: [
      {
        groupId: "custom-users",
        groupName: "Custom Users",
        allowedPackages: ["*"],
        maxActionClass: "read",
        maxRiskLevel: "high",
      },
      {
        groupId: "custom-operators",
        groupName: "Custom Operators",
        allowedPackages: ["*"],
        maxActionClass: "write",
        maxRiskLevel: "high",
      },
      {
        groupId: "custom-admins",
        groupName: "Custom Admins",
        allowedPackages: ["*"],
        maxActionClass: "admin",
        maxRiskLevel: "restricted",
      },
    ],
    defaultReadOnly: false,
    auditRetentionDays: 365,
    reviewCadenceDays: 14,
  },
];

/** Look up a built-in template by ID. */
export function findTemplate(templateId: string): PolicyTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId);
}
