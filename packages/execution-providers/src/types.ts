import { Context, Effect } from "effect";
import type { CapabilityDefinition } from "@codex-fleet/capability-registry";

export interface ExecutionResult {
  readonly payload: unknown;
  readonly isError?: boolean;
}

export interface ExecutionProvidersService {
  readonly executeTool: (
    capability: CapabilityDefinition,
    args: Record<string, unknown>,
  ) => Effect.Effect<ExecutionResult>;
}

export class ExecutionProviders extends Context.Tag("ExecutionProviders")<
  ExecutionProviders,
  ExecutionProvidersService
>() {}
