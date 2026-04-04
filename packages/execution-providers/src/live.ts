import { Effect, Layer } from "effect";
import { ExecutionProviders } from "./types.js";
import type { ExecutionProvidersService, ExecutionResult } from "./types.js";
import { executeModuleRuntime } from "./module-runtime.js";
import { HttpExecutor } from "@shuvdex/http-executor";
import { McpProxy } from "@shuvdex/mcp-proxy";

/**
 * Parse an mcp_proxy executor target in the form `{upstreamId}:{toolName}`.
 * Returns null if the format is invalid.
 */
function parseMcpProxyTarget(target: string): { upstreamId: string; toolName: string } | null {
  const colonIndex = target.indexOf(":");
  if (colonIndex === -1) return null;
  const upstreamId = target.slice(0, colonIndex);
  const toolName = target.slice(colonIndex + 1);
  if (!upstreamId || !toolName) return null;
  return { upstreamId, toolName };
}

export function makeExecutionProvidersLive(): Layer.Layer<
  ExecutionProviders,
  never,
  HttpExecutor | McpProxy
> {
  return Layer.effect(
    ExecutionProviders,
    Effect.gen(function* () {
      const http = yield* HttpExecutor;
      const mcpProxy = yield* McpProxy;

      const service: ExecutionProvidersService = {
        executeTool: (capability, args) => {
          // ── module_runtime ────────────────────────────────────────────
          if (capability.executorRef?.executorType === "module_runtime") {
            return executeModuleRuntime(capability, args) as Effect.Effect<
              ExecutionResult,
              unknown,
              never
            >;
          }

          // ── http_api ──────────────────────────────────────────────────
          if (capability.executorRef?.executorType === "http_api") {
            return http.executeHttp(capability, args) as Effect.Effect<
              ExecutionResult,
              unknown,
              never
            >;
          }

          // ── mcp_proxy ─────────────────────────────────────────────────
          if (capability.executorRef?.executorType === "mcp_proxy") {
            const target = capability.executorRef.target ?? "";
            const parsed = parseMcpProxyTarget(target);

            if (!parsed) {
              return Effect.succeed({
                payload: {
                  error: `mcp_proxy executor has invalid target format (expected "upstreamId:toolName"): ${target}`,
                  capabilityId: capability.id,
                },
                isError: true,
              } satisfies ExecutionResult);
            }

            return mcpProxy
              .callUpstreamTool(parsed.upstreamId, parsed.toolName, args)
              .pipe(
                Effect.catchAll((error: unknown) =>
                  Effect.succeed({
                    payload: {
                      error: String(error),
                      capabilityId: capability.id,
                      upstreamId: parsed.upstreamId,
                      toolName: parsed.toolName,
                    },
                    isError: true,
                  } satisfies ExecutionResult),
                ),
              ) as Effect.Effect<ExecutionResult, unknown, never>;
          }

          // ── unknown / unimplemented ────────────────────────────────────
          return Effect.succeed({
            payload: {
              error: `Tool execution is not implemented for executor ${
                capability.executorRef?.executorType ?? "module_runtime"
              }`,
              capabilityId: capability.id,
              args,
            },
            isError: true,
          } satisfies ExecutionResult);
        },
      };

      return service;
    }),
  );
}
