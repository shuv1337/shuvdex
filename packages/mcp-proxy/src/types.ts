import { Context, Effect } from "effect";

/** Transport types for upstream MCP servers */
export type UpstreamTransport = "stdio" | "streamable-http" | "sse";

/** Trust state for upstream connections */
export type TrustState = "trusted" | "untrusted" | "suspended" | "pending_review";

/** Health status of an upstream */
export type UpstreamHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

/** Upstream MCP server registration */
export interface UpstreamRegistration {
  readonly upstreamId: string;
  readonly name: string;
  readonly description?: string;
  readonly transport: UpstreamTransport;
  /** For stdio: the command. For HTTP/SSE: the URL */
  readonly endpoint: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Record<string, string>;
  /** Credential ID for authenticating to the upstream */
  readonly credentialId?: string;
  /** Namespace prefix for all tools from this upstream */
  readonly namespace: string;
  /** Owner/maintainer info */
  readonly owner?: string;
  /** Purpose description */
  readonly purpose?: string;
  /** Trust state */
  readonly trustState: TrustState;
  /** Health status */
  readonly healthStatus: UpstreamHealthStatus;
  /** Last time capabilities were synced */
  readonly lastCapabilitySync?: string;
  /** Number of tools discovered */
  readonly toolCount?: number;
  /** Action class default for tools from this upstream */
  readonly defaultActionClass?: "read" | "write" | "admin" | "external";
  /** Risk level default */
  readonly defaultRiskLevel?: "low" | "medium" | "high" | "restricted";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Cached tool metadata from an upstream */
export interface UpstreamToolCache {
  readonly upstreamId: string;
  readonly tools: ReadonlyArray<CachedUpstreamTool>;
  readonly syncedAt: string;
  readonly checksum: string;
}

export interface CachedUpstreamTool {
  readonly name: string;
  readonly namespacedName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  /** Hash of name + description + inputSchema for pinning */
  readonly descriptionHash: string;
  /** Pinned hash at approval time (null if not yet pinned) */
  readonly pinnedHash?: string;
  /** Action classification */
  readonly actionClass: "read" | "write" | "admin" | "external";
  /** Risk level */
  readonly riskLevel: "low" | "medium" | "high" | "restricted";
}

/** Result of syncing capabilities from an upstream */
export interface CapabilitySyncResult {
  readonly upstreamId: string;
  readonly added: string[];
  readonly removed: string[];
  readonly changed: string[];
  readonly unchanged: string[];
  readonly mutationDetected: boolean;
  readonly mutatedTools: string[];
}

/** MCP Proxy service interface */
export interface McpProxyService {
  /** Register a new upstream MCP server */
  readonly registerUpstream: (
    reg: Omit<UpstreamRegistration, "createdAt" | "updatedAt" | "healthStatus" | "trustState">,
  ) => Effect.Effect<UpstreamRegistration>;

  /** List all registered upstreams */
  readonly listUpstreams: () => Effect.Effect<UpstreamRegistration[]>;

  /** Get a specific upstream */
  readonly getUpstream: (upstreamId: string) => Effect.Effect<UpstreamRegistration>;

  /** Update an upstream registration */
  readonly updateUpstream: (
    upstreamId: string,
    patch: Partial<UpstreamRegistration>,
  ) => Effect.Effect<UpstreamRegistration>;

  /** Delete an upstream */
  readonly deleteUpstream: (upstreamId: string) => Effect.Effect<void>;

  /** Sync capabilities from an upstream – connect, list tools, cache, detect changes */
  readonly syncUpstream: (upstreamId: string) => Effect.Effect<CapabilitySyncResult>;

  /** Check health of an upstream */
  readonly checkHealth: (upstreamId: string) => Effect.Effect<UpstreamHealthStatus>;

  /** Execute a tool call on an upstream */
  readonly callUpstreamTool: (
    upstreamId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Effect.Effect<{ payload: unknown; isError: boolean }>;

  /** Get cached tool list for an upstream */
  readonly getCachedTools: (upstreamId: string) => Effect.Effect<UpstreamToolCache | null>;

  /** Pin tool descriptions (mark current hashes as approved) */
  readonly pinToolDescriptions: (
    upstreamId: string,
    toolNames?: string[],
  ) => Effect.Effect<void>;

  /** Check for description mutations since last pin */
  readonly checkMutations: (
    upstreamId: string,
  ) => Effect.Effect<{ mutated: CachedUpstreamTool[]; clean: CachedUpstreamTool[] }>;
}

export class McpProxy extends Context.Tag("McpProxy")<McpProxy, McpProxyService>() {}
