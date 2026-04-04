/**
 * Live layer for AuditService.
 *
 * Storage layout:
 *   {auditDir}/runtime.jsonl   – one RuntimeAuditRecord per line
 *   {auditDir}/admin.jsonl     – one AdminAuditRecord per line
 *
 * Behaviour:
 * - Events are appended to disk on every write (best-effort; IO errors are
 *   swallowed so audit failures never break the caller).
 * - The most-recent 5 000 runtime events are kept in an in-memory ring
 *   buffer for fast queries.
 * - queryEvents merges the in-memory buffer with a file scan for events
 *   that overflowed the buffer, deduplicating by eventId.
 * - Metrics (totalEvents, eventsByAction, etc.) are tracked in-memory and
 *   reset on process restart.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Layer, Ref } from "effect";
import { AuditService } from "./audit-service.js";
import type { AuditServiceInterface, AdminAuditInput, RuntimeAuditInput } from "./audit-service.js";
import type {
  AdminAuditRecord,
  AuditExportFilter,
  AuditMetrics,
  AuditQueryFilter,
  AuditQueryResult,
  RuntimeAuditRecord,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const MAX_BUFFER = 5_000;

interface AuditState {
  runtimeEvents: RuntimeAuditRecord[];
  adminEvents: AdminAuditRecord[];
  // session-local metrics (reset on restart)
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByDecision: Record<string, number>;
  eventsByActionClass: Record<string, number>;
  totalLatencyMs: number;
  latencyCount: number;
  errorCount: number;
}

function initialState(): AuditState {
  return {
    runtimeEvents: [],
    adminEvents: [],
    totalEvents: 0,
    eventsByAction: {},
    eventsByDecision: {},
    eventsByActionClass: {},
    totalLatencyMs: 0,
    latencyCount: 0,
    errorCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function increment(map: Record<string, number>, key: string): Record<string, number> {
  return { ...map, [key]: (map[key] ?? 0) + 1 };
}

function applyRuntimeFilter(
  events: RuntimeAuditRecord[],
  filter: AuditQueryFilter,
): RuntimeAuditRecord[] {
  return events.filter((e) => {
    if (filter.tenantId !== undefined && e.tenantId !== filter.tenantId) return false;
    if (filter.actorId !== undefined && e.actor.subjectId !== filter.actorId) return false;
    if (filter.action !== undefined && e.action !== filter.action) return false;
    if (filter.actionClass !== undefined && e.actionClass !== filter.actionClass) return false;
    if (filter.decision !== undefined && e.decision !== filter.decision) return false;
    if (filter.from !== undefined && e.timestamp < filter.from) return false;
    if (filter.to !== undefined && e.timestamp > filter.to) return false;
    return true;
  });
}

function safeParseJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function safeAppend(filePath: string, record: unknown): void {
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Audit persistence is best-effort; swallow IO errors.
  }
}

// ---------------------------------------------------------------------------
// Core implementation builder
// ---------------------------------------------------------------------------

/**
 * Build an AuditServiceInterface backed by the given file paths and a
 * shared in-memory Ref.  Used by both makeAuditServiceLive (which wraps the
 * result in a Layer) and makeAuditServiceImpl (which returns it directly for
 * internal use by PolicyEngineLive).
 */
function buildAuditImpl(
  runtimePath: string,
  adminPath: string,
): AuditServiceInterface {
  const stateRef = Ref.unsafeMake<AuditState>(initialState());

  return {
    // -----------------------------------------------------------------------
    recordRuntimeEvent: (input: RuntimeAuditInput) =>
      Effect.gen(function* () {
        const now = new Date().toISOString();
        const event: RuntimeAuditRecord = {
          ...input,
          eventId: input.eventId ?? randomUUID(),
          timestamp: input.timestamp ?? now,
        };

        yield* Ref.update(stateRef, (state) => {
          const runtimeEvents = [event, ...state.runtimeEvents].slice(0, MAX_BUFFER);
          const latencyMs = event.outcome?.latencyMs;
          return {
            ...state,
            runtimeEvents,
            totalEvents: state.totalEvents + 1,
            eventsByAction: increment(state.eventsByAction, event.action),
            eventsByDecision: increment(state.eventsByDecision, event.decision),
            eventsByActionClass: increment(state.eventsByActionClass, event.actionClass),
            totalLatencyMs:
              latencyMs !== undefined
                ? state.totalLatencyMs + latencyMs
                : state.totalLatencyMs,
            latencyCount:
              latencyMs !== undefined ? state.latencyCount + 1 : state.latencyCount,
            errorCount:
              event.outcome?.status === "error"
                ? state.errorCount + 1
                : state.errorCount,
          };
        });

        yield* Effect.sync(() => safeAppend(runtimePath, event));
      }),

    // -----------------------------------------------------------------------
    recordAdminEvent: (input: AdminAuditInput) =>
      Effect.gen(function* () {
        const now = new Date().toISOString();
        const event: AdminAuditRecord = {
          ...input,
          eventId: input.eventId ?? randomUUID(),
          timestamp: input.timestamp ?? now,
          effectiveAt: input.effectiveAt ?? now,
        };

        yield* Ref.update(stateRef, (state) => ({
          ...state,
          adminEvents: [event, ...state.adminEvents].slice(0, MAX_BUFFER),
        }));

        yield* Effect.sync(() => safeAppend(adminPath, event));
      }),

    // -----------------------------------------------------------------------
    queryEvents: (filter: AuditQueryFilter) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;

        // In-memory ring buffer covers the most-recent events.
        const inMemory = applyRuntimeFilter(state.runtimeEvents, filter);
        const inMemoryIds = new Set(inMemory.map((e) => e.eventId));

        // File scan covers overflowed events.
        const fileEvents = yield* Effect.sync(() =>
          safeParseJsonl<RuntimeAuditRecord>(runtimePath),
        );
        const uniqueFromFile = applyRuntimeFilter(
          fileEvents.filter((e) => !inMemoryIds.has(e.eventId)),
          filter,
        );

        const allEvents = [...inMemory, ...uniqueFromFile].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp),
        );

        const total = allEvents.length;
        const paged = allEvents.slice(offset, offset + limit);

        return {
          events: paged,
          total,
          hasMore: offset + limit < total,
        } satisfies AuditQueryResult;
      }),

    // -----------------------------------------------------------------------
    exportEvents: (filter: AuditExportFilter) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const inMemoryIds = new Set(state.runtimeEvents.map((e) => e.eventId));

        const fileEvents = yield* Effect.sync(() =>
          safeParseJsonl<RuntimeAuditRecord>(runtimePath),
        );
        const uniqueFromFile = fileEvents.filter((e) => !inMemoryIds.has(e.eventId));

        const allEvents = [...state.runtimeEvents, ...uniqueFromFile]
          .filter((e) => {
            if (filter.tenantId !== undefined && e.tenantId !== filter.tenantId) return false;
            if (filter.from !== undefined && e.timestamp < filter.from) return false;
            if (filter.to !== undefined && e.timestamp > filter.to) return false;
            return true;
          })
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return allEvents.map((e) => JSON.stringify(e)).join("\n");
      }),

    // -----------------------------------------------------------------------
    getMetrics: () =>
      Ref.get(stateRef).pipe(
        Effect.map(
          (state): AuditMetrics => ({
            totalEvents: state.totalEvents,
            eventsByAction: { ...state.eventsByAction },
            eventsByDecision: { ...state.eventsByDecision },
            eventsByActionClass: { ...state.eventsByActionClass },
            avgLatencyMs:
              state.latencyCount > 0
                ? state.totalLatencyMs / state.latencyCount
                : 0,
            errorRate:
              state.totalEvents > 0
                ? state.errorCount / state.totalEvents
                : 0,
          }),
        ),
      ),
  };
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Build an AuditServiceInterface directly (not wrapped in a Layer).
 *
 * Used by PolicyEngineLive to embed the audit service without adding
 * AuditService as an explicit layer dependency.
 */
export function makeAuditServiceImpl(options: { auditDir: string }): AuditServiceInterface {
  const { auditDir } = options;
  fs.mkdirSync(auditDir, { recursive: true });
  const runtimePath = path.join(auditDir, "runtime.jsonl");
  const adminPath = path.join(auditDir, "admin.jsonl");
  return buildAuditImpl(runtimePath, adminPath);
}

/**
 * Build a standalone `Layer<AuditService>` backed by JSONL files in
 * `auditDir`.  Suitable for callers that want to inject AuditService as an
 * Effect dependency directly (e.g. custom API routes or tests).
 */
export function makeAuditServiceLive(options: {
  auditDir: string;
}): Layer.Layer<AuditService> {
  const impl = makeAuditServiceImpl(options);
  return Layer.succeed(AuditService, impl);
}
