import { Effect, Layer } from "effect";
import { ExecutionProviders } from "./types.js";
import type { ExecutionProvidersService, ExecutionResult } from "./types.js";
import { executeModuleRuntime } from "./module-runtime.js";

export function makeExecutionProvidersLive(): Layer.Layer<ExecutionProviders> {
  const service: ExecutionProvidersService = {
    executeTool: (capability, args) => {
      if (capability.executorRef?.executorType === "module_runtime") {
        return executeModuleRuntime(capability, args);
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

  return Layer.succeed(ExecutionProviders, service);
}
