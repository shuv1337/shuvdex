import { Context, Effect } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";
import type { HttpExecutionResult } from "@shuvdex/http-executor";

export interface ExecutionResult {
  readonly payload: unknown;
  readonly isError?: boolean;
}

export interface ExecutionProvidersService {
  readonly executeTool: (
    capability: CapabilityDefinition,
    args: Record<string, unknown>,
  ) => Effect.Effect<ExecutionResult | HttpExecutionResult, unknown, never>;
}

export class ExecutionProviders extends Context.Tag("ExecutionProviders")<
  ExecutionProviders,
  ExecutionProvidersService
>() {}
