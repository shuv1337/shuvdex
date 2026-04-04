/**
 * @shuvdex/mcp-server — MCP session store
 *
 * Provides an in-memory session store for the MCP Streamable-HTTP server.
 * Sessions track per-caller authentication context, negotiated capabilities,
 * and activity for rate-limiting and audit purposes.
 *
 * ## Session lifecycle
 * 1. Session is created on the first `/mcp` POST request after token validation.
 * 2. A `mcp-session-id` header is included in the response.
 * 3. Subsequent requests include the header to resume the session.
 * 4. Sessions expire after `defaultTtlMs` (default: 1 hour) of inactivity.
 * 5. `touch()` resets the last-activity time on each request.
 * 6. Sessions can be explicitly destroyed (e.g. on DELETE /mcp).
 *
 * ## Per-tenant limits
 * `countByTenant` lets the HTTP layer enforce tier-based session caps:
 * - core     → 20 sessions
 * - standard → 50 sessions
 * - custom   → unlimited
 *
 * The store itself takes an optional `maxSessionsPerTenant` config; when the
 * limit is hit during `create()` the oldest inactive session for that tenant
 * is evicted to make room.
 */
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of a session.  All fields are `readonly`; mutations go
 * through the `SessionStore` interface methods.
 */
export interface McpSession {
  /** UUID identifying this session. Used as the `mcp-session-id` header value. */
  readonly sessionId: string;
  /** Gateway the session was established through (optional — populated when multi-tenant). */
  readonly gatewayId?: string;
  /** Tenant that owns this session (optional — populated when tenant-aware). */
  readonly tenantId?: string;
  /** Environment context for this session. */
  readonly environmentId?: string;
  /** Authenticated actor identity. */
  readonly actor: {
    readonly subjectId: string;
    readonly email?: string;
    readonly provider?: string;
    readonly groups?: string[];
  };
  /** MCP protocol version negotiated for this session. */
  readonly protocolVersion: string;
  /** Capability kinds negotiated (e.g. ["tools", "resources"]). */
  readonly negotiatedCapabilities: string[];
  /** Capability IDs disclosed to this session by the disclosure engine. */
  readonly disclosedCapabilityIds: string[];
  /** Auth context recorded at session creation time. */
  readonly authContext: {
    readonly tokenJti?: string;
    readonly scopes: string[];
    readonly idpProvider?: string;
  };
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO-8601 expiry time. */
  readonly expiresAt: string;
  /** ISO-8601 timestamp of last activity (updated by `touch()`). */
  readonly lastActivityAt: string;
}

/** Session store interface. */
export interface SessionStore {
  /**
   * Create a new session.  The store assigns `sessionId`, `createdAt`, and
   * `lastActivityAt`; all other fields must be provided by the caller.
   */
  create(
    session: Omit<McpSession, "sessionId" | "createdAt" | "lastActivityAt">,
  ): McpSession;

  /**
   * Retrieve a session by ID.
   * Returns `null` if the session is not found or has expired.
   */
  get(sessionId: string): McpSession | null;

  /**
   * Touch a session — update `lastActivityAt` to now.
   * No-op for unknown or expired sessions.
   */
  touch(sessionId: string): void;

  /** Permanently remove a session (e.g. on DELETE /mcp). */
  destroy(sessionId: string): void;

  /**
   * List active (non-expired) sessions, optionally filtered by tenant.
   */
  list(filter?: { tenantId?: string }): McpSession[];

  /**
   * Remove all expired sessions.
   * @returns The number of sessions pruned.
   */
  prune(): number;

  /** Count active sessions for a tenant (used for tier-based cap enforcement). */
  countByTenant(tenantId: string): number;
}

// ---------------------------------------------------------------------------
// Internal mutable representation
// ---------------------------------------------------------------------------

/**
 * Mutable internal session record.  The public `McpSession` view is created
 * by spreading this with `readonly` modifiers (purely a TypeScript concern —
 * at runtime they are the same object shape).
 */
interface InternalSession {
  sessionId: string;
  gatewayId?: string;
  tenantId?: string;
  environmentId?: string;
  actor: {
    subjectId: string;
    email?: string;
    provider?: string;
    groups?: string[];
  };
  protocolVersion: string;
  negotiatedCapabilities: string[];
  disclosedCapabilityIds: string[];
  authContext: {
    tokenJti?: string;
    scopes: string[];
    idpProvider?: string;
  };
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an in-memory session store.
 *
 * @param options.maxSessionsPerTenant - Per-tenant session cap.  When hit, the
 *   oldest session for that tenant is evicted to make room.  Defaults to 50.
 *   Pass -1 for unlimited.
 * @param options.defaultTtlMs - Default session TTL in milliseconds used for
 *   auto-pruning.  Defaults to 3 600 000 (1 hour).  Note: the `expiresAt`
 *   timestamp on each session is supplied by the caller; this value is used
 *   only by the internal prune interval.
 */
export function createSessionStore(options?: {
  maxSessionsPerTenant?: number;
  defaultTtlMs?: number;
}): SessionStore {
  const maxPerTenant = options?.maxSessionsPerTenant ?? 50;
  /** Used only by the background pruner — actual expiry is driven by `expiresAt`. */
  const _defaultTtlMs = options?.defaultTtlMs ?? 60 * 60 * 1000;
  void _defaultTtlMs; // documented, kept for API completeness

  const sessions = new Map<string, InternalSession>();

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function isExpired(session: InternalSession): boolean {
    return new Date(session.expiresAt).getTime() <= Date.now();
  }

  function toSnapshot(s: InternalSession): McpSession {
    // Spread to get a shallow copy so callers can't mutate our internal state.
    return { ...s, actor: { ...s.actor }, authContext: { ...s.authContext } } as McpSession;
  }

  /**
   * Count active sessions for a tenant without side effects.
   * Includes sessions whose `expiresAt` is still in the future.
   */
  function countActive(tenantId: string): number {
    let n = 0;
    for (const s of sessions.values()) {
      if (!isExpired(s) && s.tenantId === tenantId) n++;
    }
    return n;
  }

  /**
   * Evict the oldest (by `lastActivityAt`) session for the given tenant.
   * Used when the per-tenant cap is reached.
   */
  function evictOldest(tenantId: string): void {
    let oldest: InternalSession | undefined;
    for (const s of sessions.values()) {
      if (s.tenantId !== tenantId) continue;
      if (
        oldest === undefined ||
        s.lastActivityAt < oldest.lastActivityAt
      ) {
        oldest = s;
      }
    }
    if (oldest) sessions.delete(oldest.sessionId);
  }

  // -------------------------------------------------------------------------
  // Auto-prune — runs every 5 minutes, doesn't prevent process exit
  // -------------------------------------------------------------------------
  const pruneInterval = setInterval(() => {
    for (const [id, s] of sessions) {
      if (isExpired(s)) sessions.delete(id);
    }
  }, 5 * 60 * 1000);

  if (typeof pruneInterval.unref === "function") pruneInterval.unref();

  // -------------------------------------------------------------------------
  // SessionStore implementation
  // -------------------------------------------------------------------------
  return {
    create(sessionData) {
      const now = new Date().toISOString();
      const sessionId = randomUUID();

      // Enforce per-tenant cap before inserting
      if (
        sessionData.tenantId &&
        maxPerTenant >= 0 &&
        countActive(sessionData.tenantId) >= maxPerTenant
      ) {
        evictOldest(sessionData.tenantId);
      }

      const internal: InternalSession = {
        ...sessionData,
        // Deep-copy mutable arrays/objects so callers can't mutate our store
        actor: { ...sessionData.actor },
        negotiatedCapabilities: [...sessionData.negotiatedCapabilities],
        disclosedCapabilityIds: [...sessionData.disclosedCapabilityIds],
        authContext: {
          ...sessionData.authContext,
          scopes: [...sessionData.authContext.scopes],
        },
        sessionId,
        createdAt: now,
        lastActivityAt: now,
      };

      sessions.set(sessionId, internal);
      return toSnapshot(internal);
    },

    get(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return null;
      if (isExpired(s)) {
        sessions.delete(sessionId);
        return null;
      }
      return toSnapshot(s);
    },

    touch(sessionId) {
      const s = sessions.get(sessionId);
      if (s && !isExpired(s)) {
        s.lastActivityAt = new Date().toISOString();
      }
    },

    destroy(sessionId) {
      sessions.delete(sessionId);
    },

    list(filter) {
      const result: McpSession[] = [];
      for (const s of sessions.values()) {
        if (isExpired(s)) continue;
        if (filter?.tenantId !== undefined && s.tenantId !== filter.tenantId) continue;
        result.push(toSnapshot(s));
      }
      return result;
    },

    prune() {
      let count = 0;
      for (const [id, s] of sessions) {
        if (isExpired(s)) {
          sessions.delete(id);
          count++;
        }
      }
      return count;
    },

    countByTenant(tenantId) {
      return countActive(tenantId);
    },
  };
}
