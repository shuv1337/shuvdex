/**
 * Live telemetry layer that exports spans to an OTLP/HTTP collector.
 *
 * Uses @effect/opentelemetry's NodeSdk with @opentelemetry/sdk-trace-node
 * and the BatchSpanProcessor + OTLPTraceExporter for production use.
 *
 * For the Effect-native approach, we use the Otlp module from
 * @effect/opentelemetry which provides built-in OTLP/HTTP export
 * via @effect/platform's HttpClient.
 */
import { Layer } from "effect";
import { Otlp } from "@effect/opentelemetry";
import { FetchHttpClient } from "@effect/platform";
import { Telemetry } from "./types.js";

/**
 * Default OTEL collector URL for the maple stack.
 */
export const DEFAULT_COLLECTOR_URL = "http://localhost:4318";

/**
 * Creates a live Telemetry service layer.
 */
export const TelemetryServiceLive = (
  collectorUrl: string = DEFAULT_COLLECTOR_URL,
): Layer.Layer<Telemetry> =>
  Layer.succeed(Telemetry, {
    serviceName: "codex-fleet",
    collectorUrl,
  });

/**
 * Creates the OTLP tracing layer that exports spans to the collector.
 *
 * This layer provides the Effect Tracer backed by OTLP/HTTP export.
 * Spans are exported as JSON to the collector's /v1/traces endpoint.
 */
export const OtlpTracingLive = (
  collectorUrl: string = DEFAULT_COLLECTOR_URL,
): Layer.Layer<never> =>
  Otlp.layerJson({
    baseUrl: collectorUrl,
    resource: {
      serviceName: "codex-fleet",
      serviceVersion: "0.0.0",
      attributes: {
        "deployment.environment": "development",
        // maple_org_id is required by the maple OTEL collector pipeline
        // for traces to be routed to the primary traces table (not quarantine).
        "maple_org_id": "default",
      },
    },
    tracerExportInterval: "5 seconds",
    shutdownTimeout: "10 seconds",
  }).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * Complete live telemetry layer combining the service + OTLP tracing.
 *
 * Provides:
 * - Telemetry service tag for accessing config
 * - Effect Tracer backed by OTLP/HTTP to localhost:4318
 */
export const TelemetryLive: Layer.Layer<Telemetry> = Layer.merge(
  TelemetryServiceLive(),
  OtlpTracingLive(),
);
