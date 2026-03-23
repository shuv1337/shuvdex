import { Effect, Layer } from "effect";
import { ExecutionProviders } from "./types.js";
import type { ExecutionProvidersService, ExecutionResult } from "./types.js";
import { executeModuleRuntime } from "./module-runtime.js";
import { HttpExecutor } from "@shuvdex/http-executor";

export function makeExecutionProvidersLive(): Layer.Layer<ExecutionProviders, never, HttpExecutor> {
  return Layer.effect(
    ExecutionProviders,
    Effect.gen(function* () {
      const http = yield* HttpExecutor;
      const service: ExecutionProvidersService = {
        executeTool: (capability, args) => {
          if (capability.executorRef?.executorType === "module_runtime") {
            return executeModuleRuntime(capability, args) as Effect.Effect<ExecutionResult, unknown, never>;
          }
          if (capability.executorRef?.executorType === "http_api") {
            return http.executeHttp(capability, args) as Effect.Effect<ExecutionResult, unknown, never>;
          }

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
