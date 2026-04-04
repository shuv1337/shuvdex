/**
 * Convert a synced upstream MCP server (registration + tool cache) into the
 * `CapabilityPackage` format used by the shuvdex capability registry.
 *
 * Package ID:   `upstream.{namespace}`
 * Capability ID: `upstream.{namespace}.{toolName}`
 * Executor type: `mcp_proxy`
 * Executor target: `{upstreamId}:{originalToolName}`  (parsed by execution-providers)
 */

import type { CapabilityPackage, CapabilityDefinition } from "@shuvdex/capability-registry";
import type { UpstreamRegistration, UpstreamToolCache, CachedUpstreamTool } from "./types.js";

// Map our internal risk levels to the registry's CapabilityRiskLevel union
// ("restricted" is not in the registry schema → downgrade to "high")
function mapRiskLevel(
  riskLevel: CachedUpstreamTool["riskLevel"],
): "low" | "medium" | "high" {
  return riskLevel === "restricted" ? "high" : riskLevel;
}

// Map action class → side-effect level used by ToolCapabilityConfig
function mapSideEffectLevel(
  actionClass: CachedUpstreamTool["actionClass"],
): "read" | "write" | "admin" | "external" {
  return actionClass;
}

/**
 * Build a `CapabilityPackage` from an upstream registration and its cached
 * tool list.  The resulting package can be upserted into the capability
 * registry so that mcp_proxy tools are surfaced through the normal MCP server
 * tool-list endpoint.
 */
export function upstreamToCapabilityPackage(
  reg: UpstreamRegistration,
  cache: UpstreamToolCache,
): CapabilityPackage {
  const packageId = `upstream.${reg.namespace}`;
  const version = "1.0.0";
  const now = new Date().toISOString();

  const capabilities: CapabilityDefinition[] = cache.tools.map((tool) => {
    const capabilityId = `upstream.${reg.namespace}.${tool.name}`;
    // Executor target encodes both the upstream to route to and the original
    // (non-namespaced) tool name expected by the upstream server.
    const target = `${reg.upstreamId}:${tool.name}`;

    const capability: CapabilityDefinition = {
      id: capabilityId,
      packageId,
      version,
      kind: "tool",
      title: tool.namespacedName,
      description: tool.description || `Tool '${tool.name}' from upstream ${reg.namespace}`,
      tags: ["mcp_proxy", reg.namespace],
      riskLevel: mapRiskLevel(tool.riskLevel),
      enabled: reg.trustState === "trusted",
      visibility: "public",
      executorRef: {
        executorType: "mcp_proxy",
        target,
        credentialId: reg.credentialId,
      },
      tool: {
        inputSchema: tool.inputSchema,
        sideEffectLevel: mapSideEffectLevel(tool.actionClass),
      },
      annotations: {
        "mcp_proxy.upstreamId": reg.upstreamId,
        "mcp_proxy.namespace": reg.namespace,
        "mcp_proxy.originalName": tool.name,
        "mcp_proxy.actionClass": tool.actionClass,
        "mcp_proxy.descriptionHash": tool.descriptionHash,
        ...(tool.pinnedHash ? { "mcp_proxy.pinnedHash": tool.pinnedHash } : {}),
      },
    };

    return capability;
  });

  const pkg: CapabilityPackage = {
    id: packageId,
    version,
    title: reg.name,
    description: reg.description ?? `MCP proxy upstream: ${reg.namespace}`,
    builtIn: false,
    enabled: reg.trustState === "trusted",
    tags: ["mcp_proxy", reg.namespace],
    source: {
      type: "connector",
      sourceId: reg.upstreamId,
      lastSyncedAt: cache.syncedAt,
      operationCount: cache.tools.length,
    },
    annotations: {
      "mcp_proxy.upstreamId": reg.upstreamId,
      "mcp_proxy.transport": reg.transport,
      "mcp_proxy.endpoint": reg.endpoint,
      "mcp_proxy.trustState": reg.trustState,
      "mcp_proxy.healthStatus": reg.healthStatus,
      "mcp_proxy.cacheChecksum": cache.checksum,
    },
    capabilities,
    createdAt: reg.createdAt,
    updatedAt: now,
  };

  return pkg;
}
