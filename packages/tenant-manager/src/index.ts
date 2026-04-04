// ---------------------------------------------------------------------------
// Types & service tag
// ---------------------------------------------------------------------------
export type {
  TenantStatus,
  SubscriptionTier,
  EnvironmentType,
  IdPType,
  Tenant,
  Environment,
  Gateway,
  PackageApprovalState,
  CertificationState,
  TenantPackageApproval,
  CapabilityCertification,
  TenantRoleMapping,
  PolicyTemplate,
  TenantManagerService,
} from "./types.js";
export { TenantManager } from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export {
  TenantNotFound,
  EnvironmentNotFound,
  GatewayNotFound,
  PolicyTemplateNotFound,
  TenantManagerIOError,
} from "./errors.js";
export type { TenantManagerError } from "./errors.js";

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------
export { makeTenantManagerLive, TenantManagerLive } from "./live.js";

// ---------------------------------------------------------------------------
// Policy templates
// ---------------------------------------------------------------------------
export { BUILT_IN_TEMPLATES, findTemplate } from "./templates.js";

// ---------------------------------------------------------------------------
// Disclosure engine
// ---------------------------------------------------------------------------
export type {
  DisclosureContext,
  DisclosedCapabilitySet,
  DisclosedCapability,
} from "./disclosure.js";
export { computeDisclosure } from "./disclosure.js";
