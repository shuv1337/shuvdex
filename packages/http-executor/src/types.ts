import { Context, Effect } from "effect";
import type { CapabilityDefinition } from "@shuvdex/capability-registry";

export interface HttpExecutionResult {
  readonly payload: {
    readonly data?: unknown;
    readonly error?: unknown;
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly truncated?: boolean;
  };
  readonly isError: boolean;
}

export interface HttpExecutorService {
  readonly executeHttp: (capability: CapabilityDefinition, args: Record<string, unknown>) => Effect.Effect<HttpExecutionResult, unknown>;
}

export class HttpExecutor extends Context.Tag("HttpExecutor")<HttpExecutor, HttpExecutorService>() {}
