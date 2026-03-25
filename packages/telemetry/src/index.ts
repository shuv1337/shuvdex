/**
 * @shuvdex/telemetry
 *
 * OTEL instrumentation for the shuvdex capability gateway.
 *
 * Provides:
 * - `TelemetryLive` - Production layer exporting spans via OTLP/HTTP to localhost:4318
 * - `TelemetryTest` - Test layer capturing spans in memory for assertions
 * - `withSpan` - Wrapper for Effect operations that creates OTEL spans with execution attributes
 * - `recordError` - Records error details in the current span
 * - `Telemetry` - Service tag for accessing telemetry configuration
 */

// Types
export type { CollectedSpan, TelemetryService, WithSpanOptions } from "./types.js";
export { Telemetry, CollectedSpans } from "./types.js";

// Span helpers
export { withSpan, recordError } from "./span.js";

// Layers
export { TelemetryLive, DEFAULT_COLLECTOR_URL } from "./live.js";
export { TelemetryTest } from "./test.js";
