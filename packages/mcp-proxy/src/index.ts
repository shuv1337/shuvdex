// Types
export type {
  UpstreamTransport,
  TrustState,
  UpstreamHealthStatus,
  UpstreamRegistration,
  UpstreamToolCache,
  CachedUpstreamTool,
  CapabilitySyncResult,
  McpProxyService,
} from "./types.js";
export { McpProxy } from "./types.js";

// Hashing
export { computeDescriptionHash, checkPin } from "./hashing.js";

// Classification
export type { ActionClass, RiskLevel } from "./classifier.js";
export { classifyActionClass, classifyRiskLevel } from "./classifier.js";

// Injection scanner
export type { ScanFinding, ScanResult } from "./scanner.js";
export { scanForInjection } from "./scanner.js";

// Live implementation
export type { McpProxyConfig } from "./live.js";
export { makeMcpProxyLive } from "./live.js";

// Capability-registry bridge
export { upstreamToCapabilityPackage } from "./upstream-to-package.js";
