/**
 * Types for the telemetry package.
 */
import { Context, Ref } from "effect";

/**
 * Represents a collected span for testing purposes.
 */
export interface CollectedSpan {
  readonly name: string;
  readonly attributes: Record<string, unknown>;
  readonly status: "ok" | "error" | "unset";
  readonly error?: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTime: number;
  readonly endTime?: number;
}

/**
 * Tag for the collected spans ref used in testing.
 */
export class CollectedSpans extends Context.Tag("CollectedSpans")<
  CollectedSpans,
  Ref.Ref<Array<CollectedSpan>>
>() {}

/**
 * Telemetry service interface.
 */
export interface TelemetryService {
  readonly serviceName: string;
  readonly collectorUrl: string;
}

/**
 * Tag for the Telemetry service.
 */
export class Telemetry extends Context.Tag("Telemetry")<
  Telemetry,
  TelemetryService
>() {}

/**
 * Options for withSpan.
 */
export interface WithSpanOptions {
  readonly attributes?: Record<string, unknown>;
}
