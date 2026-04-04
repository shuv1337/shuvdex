/**
 * Capability sync management routes — /api/sync
 *
 * Controls on-demand and scheduled capability syncing across all registered
 * upstream MCP servers.  Actual sync execution is delegated to the mcp_proxy
 * adapter (packages/mcp-proxy).  Until that adapter is available, these routes
 * manage the sync state and schedule configuration.
 *
 * Sync config is persisted to .capabilities/sync-config.json.
 */
import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import { handleError } from "../middleware/error-handler.js";
import { listUpstreamRegistrations, type UpstreamRegistration } from "./upstreams.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncConfig {
  autoSyncIntervalMinutes: number;
  autoSyncEnabled: boolean;
  lastFullSync: string | null;
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  autoSyncIntervalMinutes: 60,
  autoSyncEnabled: false,
  lastFullSync: null,
};

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function readSyncConfig(syncConfigPath: string): SyncConfig {
  if (!fs.existsSync(syncConfigPath)) {
    return { ...DEFAULT_SYNC_CONFIG };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(syncConfigPath, "utf-8")) as Partial<SyncConfig>;
    return { ...DEFAULT_SYNC_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

function writeSyncConfig(syncConfigPath: string, config: SyncConfig): void {
  fs.mkdirSync(path.dirname(syncConfigPath), { recursive: true });
  fs.writeFileSync(syncConfigPath, JSON.stringify(config, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with all sync management routes.
 *
 * @param upstreamsDir       Absolute path to the upstreams storage directory.
 * @param capabilitiesRootDir  Root .capabilities directory (sync-config.json lives here).
 */
export function syncRouter(upstreamsDir: string, capabilitiesRootDir: string): Hono {
  const syncConfigPath = path.join(capabilitiesRootDir, "sync-config.json");
  const app = new Hono();

  // -------------------------------------------------------------------------
  // POST /api/sync/all — trigger capability sync for all upstreams
  // -------------------------------------------------------------------------
  app.post("/all", async (c) => {
    try {
      const upstreams = listUpstreamRegistrations(upstreamsDir);
      const now = new Date().toISOString();

      const results = upstreams.map((upstream) => {
        const updated: UpstreamRegistration = {
          ...upstream,
          lastCapabilitySync: now,
          updatedAt: now,
        };
        try {
          fs.writeFileSync(
            path.join(upstreamsDir, `${upstream.upstreamId}.json`),
            JSON.stringify(updated, null, 2),
            "utf-8",
          );
        } catch {
          // best-effort — don't abort the whole sync if one file write fails
        }
        return {
          upstreamId: upstream.upstreamId,
          name: upstream.name,
          syncedAt: now,
          status: "sync_requested" as const,
        };
      });

      // Record last full sync timestamp in config
      const config = readSyncConfig(syncConfigPath);
      writeSyncConfig(syncConfigPath, { ...config, lastFullSync: now });

      return c.json({
        syncedAt: now,
        upstreamCount: results.length,
        results,
        note: "Capability sync will be processed by the mcp_proxy adapter",
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/sync/status — last sync status for all upstreams + config
  // -------------------------------------------------------------------------
  app.get("/status", async (c) => {
    try {
      const upstreams = listUpstreamRegistrations(upstreamsDir);
      const config = readSyncConfig(syncConfigPath);

      return c.json({
        lastFullSync: config.lastFullSync,
        autoSyncEnabled: config.autoSyncEnabled,
        autoSyncIntervalMinutes: config.autoSyncIntervalMinutes,
        upstreamCount: upstreams.length,
        upstreams: upstreams.map((u) => ({
          upstreamId: u.upstreamId,
          name: u.name,
          healthStatus: u.healthStatus,
          lastCapabilitySync: u.lastCapabilitySync ?? null,
          toolCount: u.toolCount ?? null,
          trustState: u.trustState,
        })),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/sync/schedule — update auto-sync schedule
  // Body: { autoSyncEnabled?: boolean; autoSyncIntervalMinutes?: number }
  // -------------------------------------------------------------------------
  app.post("/schedule", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const current = readSyncConfig(syncConfigPath);

      const nextInterval =
        typeof body["autoSyncIntervalMinutes"] === "number" &&
        Number.isFinite(body["autoSyncIntervalMinutes"]) &&
        (body["autoSyncIntervalMinutes"] as number) > 0
          ? (body["autoSyncIntervalMinutes"] as number)
          : current.autoSyncIntervalMinutes;

      const updated: SyncConfig = {
        ...current,
        autoSyncEnabled:
          typeof body["autoSyncEnabled"] === "boolean"
            ? body["autoSyncEnabled"]
            : current.autoSyncEnabled,
        autoSyncIntervalMinutes: nextInterval,
      };

      writeSyncConfig(syncConfigPath, updated);
      return c.json(updated);
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
