/**
 * Upstream MCP server registry routes — /api/upstreams
 *
 * CRUD for upstream MCP server registrations.
 * Registrations are stored as JSON files in .capabilities/upstreams/
 *
 * Actual capability sync and live health checking will be handled by the
 * mcp_proxy adapter (packages/mcp-proxy) when it is available.  Until then,
 * these routes manage the registration data and return stub sync/health
 * responses.
 */
import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpstreamRegistration {
  upstreamId: string;
  name: string;
  description?: string;
  transport: "stdio" | "streamable-http" | "sse";
  endpoint: string;
  args?: string[];
  env?: Record<string, string>;
  credentialId?: string;
  namespace: string;
  owner?: string;
  purpose?: string;
  trustState: "trusted" | "untrusted" | "suspended" | "pending_review";
  healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastCapabilitySync?: string;
  toolCount?: number;
  defaultActionClass?: "read" | "write" | "admin" | "external";
  defaultRiskLevel?: "low" | "medium" | "high" | "restricted";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function upstreamFilePath(upstreamsDir: string, upstreamId: string): string {
  return path.join(upstreamsDir, `${upstreamId}.json`);
}

function readUpstreamFromDisk(
  upstreamsDir: string,
  upstreamId: string,
): UpstreamRegistration | null {
  const filePath = upstreamFilePath(upstreamsDir, upstreamId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as UpstreamRegistration;
  } catch {
    return null;
  }
}

function writeUpstreamToDisk(upstreamsDir: string, upstream: UpstreamRegistration): void {
  fs.mkdirSync(upstreamsDir, { recursive: true });
  fs.writeFileSync(
    upstreamFilePath(upstreamsDir, upstream.upstreamId),
    JSON.stringify(upstream, null, 2),
    "utf-8",
  );
}

/** List all upstream registrations (excludes .tools.json, .pins.json sidecars). */
export function listUpstreamRegistrations(upstreamsDir: string): UpstreamRegistration[] {
  if (!fs.existsSync(upstreamsDir)) return [];
  const upstreams: UpstreamRegistration[] = [];
  for (const entry of fs.readdirSync(upstreamsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    // Only process plain <id>.json files — skip .tools.json, .pins.json, etc.
    if (!entry.name.endsWith(".json")) continue;
    if (entry.name.includes(".tools.") || entry.name.includes(".pins.")) continue;
    try {
      const content = fs.readFileSync(path.join(upstreamsDir, entry.name), "utf-8");
      upstreams.push(JSON.parse(content) as UpstreamRegistration);
    } catch {
      // ignore malformed entries
    }
  }
  return upstreams.sort((a, b) => a.upstreamId.localeCompare(b.upstreamId));
}

function generateUpstreamId(): string {
  return `upstream_${randomBytes(8).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;
const VALID_TRUST_STATES = ["trusted", "untrusted", "suspended", "pending_review"] as const;
const VALID_ACTION_CLASSES = ["read", "write", "admin", "external"] as const;
const VALID_RISK_LEVELS = ["low", "medium", "high", "restricted"] as const;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with all upstream registry routes.
 *
 * @param upstreamsDir  Absolute path to the upstreams storage directory
 *                      (e.g. .capabilities/upstreams).
 */
export function upstreamsRouter(upstreamsDir: string): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/upstreams — list all registrations with health status
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      return c.json(listUpstreamRegistrations(upstreamsDir));
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upstreams — register a new upstream
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

      if (!body["name"] || typeof body["name"] !== "string") {
        return c.json({ error: "name is required" }, 400);
      }
      if (!isOneOf(body["transport"], VALID_TRANSPORTS)) {
        return c.json(
          { error: `transport must be one of: ${VALID_TRANSPORTS.join(", ")}` },
          400,
        );
      }
      if (!body["endpoint"] || typeof body["endpoint"] !== "string") {
        return c.json({ error: "endpoint is required" }, 400);
      }
      if (!body["namespace"] || typeof body["namespace"] !== "string") {
        return c.json({ error: "namespace is required" }, 400);
      }

      const now = new Date().toISOString();
      const upstream: UpstreamRegistration = {
        upstreamId:
          typeof body["upstreamId"] === "string" && body["upstreamId"]
            ? body["upstreamId"]
            : generateUpstreamId(),
        name: body["name"],
        description: typeof body["description"] === "string" ? body["description"] : undefined,
        transport: body["transport"],
        endpoint: body["endpoint"],
        args: Array.isArray(body["args"]) ? (body["args"] as string[]) : undefined,
        env:
          typeof body["env"] === "object" && body["env"] !== null
            ? (body["env"] as Record<string, string>)
            : undefined,
        credentialId:
          typeof body["credentialId"] === "string" ? body["credentialId"] : undefined,
        namespace: body["namespace"],
        owner: typeof body["owner"] === "string" ? body["owner"] : undefined,
        purpose: typeof body["purpose"] === "string" ? body["purpose"] : undefined,
        trustState: isOneOf(body["trustState"], VALID_TRUST_STATES)
          ? body["trustState"]
          : "pending_review",
        healthStatus: "unknown",
        defaultActionClass: isOneOf(body["defaultActionClass"], VALID_ACTION_CLASSES)
          ? body["defaultActionClass"]
          : undefined,
        defaultRiskLevel: isOneOf(body["defaultRiskLevel"], VALID_RISK_LEVELS)
          ? body["defaultRiskLevel"]
          : undefined,
        createdAt: now,
        updatedAt: now,
      };

      writeUpstreamToDisk(upstreamsDir, upstream);
      return c.json(upstream, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/upstreams/:id — get upstream details
  // -------------------------------------------------------------------------
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }
      return c.json(upstream);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/upstreams/:id — partial update
  // -------------------------------------------------------------------------
  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const existing = readUpstreamFromDisk(upstreamsDir, id);
      if (!existing) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

      const updated: UpstreamRegistration = {
        ...existing,
        name: typeof body["name"] === "string" ? body["name"] : existing.name,
        description:
          "description" in body
            ? typeof body["description"] === "string"
              ? body["description"]
              : undefined
            : existing.description,
        transport: isOneOf(body["transport"], VALID_TRANSPORTS)
          ? body["transport"]
          : existing.transport,
        endpoint: typeof body["endpoint"] === "string" ? body["endpoint"] : existing.endpoint,
        args: "args" in body
          ? Array.isArray(body["args"])
            ? (body["args"] as string[])
            : undefined
          : existing.args,
        env:
          "env" in body
            ? typeof body["env"] === "object" && body["env"] !== null
              ? (body["env"] as Record<string, string>)
              : undefined
            : existing.env,
        credentialId:
          "credentialId" in body
            ? typeof body["credentialId"] === "string"
              ? body["credentialId"]
              : undefined
            : existing.credentialId,
        namespace:
          typeof body["namespace"] === "string" ? body["namespace"] : existing.namespace,
        owner:
          "owner" in body
            ? typeof body["owner"] === "string"
              ? body["owner"]
              : undefined
            : existing.owner,
        purpose:
          "purpose" in body
            ? typeof body["purpose"] === "string"
              ? body["purpose"]
              : undefined
            : existing.purpose,
        trustState: isOneOf(body["trustState"], VALID_TRUST_STATES)
          ? body["trustState"]
          : existing.trustState,
        healthStatus: isOneOf(
          body["healthStatus"],
          ["healthy", "degraded", "unhealthy", "unknown"] as const,
        )
          ? body["healthStatus"]
          : existing.healthStatus,
        toolCount:
          typeof body["toolCount"] === "number" ? body["toolCount"] : existing.toolCount,
        defaultActionClass: isOneOf(body["defaultActionClass"], VALID_ACTION_CLASSES)
          ? body["defaultActionClass"]
          : existing.defaultActionClass,
        defaultRiskLevel: isOneOf(body["defaultRiskLevel"], VALID_RISK_LEVELS)
          ? body["defaultRiskLevel"]
          : existing.defaultRiskLevel,
        updatedAt: new Date().toISOString(),
      };

      writeUpstreamToDisk(upstreamsDir, updated);
      return c.json(updated);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/upstreams/:id — remove upstream registration
  // -------------------------------------------------------------------------
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const filePath = upstreamFilePath(upstreamsDir, id);
      if (!fs.existsSync(filePath)) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }
      fs.rmSync(filePath, { force: true });
      // Also clean up sidecar files if they exist
      fs.rmSync(path.join(upstreamsDir, `${id}.tools.json`), { force: true });
      fs.rmSync(path.join(upstreamsDir, `${id}.pins.json`), { force: true });
      return c.json({ deleted: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upstreams/:id/sync — trigger capability sync
  // -------------------------------------------------------------------------
  app.post("/:id/sync", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      // Mark sync timestamp now; actual sync is performed by mcp_proxy adapter
      const syncedAt = new Date().toISOString();
      const updated: UpstreamRegistration = {
        ...upstream,
        lastCapabilitySync: syncedAt,
        updatedAt: syncedAt,
      };
      writeUpstreamToDisk(upstreamsDir, updated);

      return c.json({
        upstreamId: id,
        syncedAt,
        status: "sync_requested",
        note: "Capability sync will be processed by the mcp_proxy adapter",
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/upstreams/:id/health — check health
  // -------------------------------------------------------------------------
  app.get("/:id/health", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      return c.json({
        upstreamId: id,
        name: upstream.name,
        healthStatus: upstream.healthStatus,
        lastCapabilitySync: upstream.lastCapabilitySync ?? null,
        trustState: upstream.trustState,
        note: "Live health checking requires the mcp_proxy adapter",
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/upstreams/:id/tools — list cached tools from upstream
  // -------------------------------------------------------------------------
  app.get("/:id/tools", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      const cacheFile = path.join(upstreamsDir, `${id}.tools.json`);
      let tools: unknown[] = [];
      if (fs.existsSync(cacheFile)) {
        try {
          tools = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as unknown[];
        } catch {
          tools = [];
        }
      }

      return c.json({
        upstreamId: id,
        toolCount: tools.length,
        cachedAt: upstream.lastCapabilitySync ?? null,
        tools,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/upstreams/:id/pin — pin a tool description
  // Body: { toolId: string; description?: string }
  //   - Providing a description sets/replaces the pin.
  //   - Omitting description removes the pin.
  // -------------------------------------------------------------------------
  app.post("/:id/pin", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const toolId = typeof body["toolId"] === "string" ? body["toolId"] : undefined;
      const description =
        typeof body["description"] === "string" ? body["description"] : undefined;

      if (!toolId) {
        return c.json({ error: "toolId is required" }, 400);
      }

      const pinFile = path.join(upstreamsDir, `${id}.pins.json`);
      let pins: Record<string, string> = {};
      if (fs.existsSync(pinFile)) {
        try {
          pins = JSON.parse(fs.readFileSync(pinFile, "utf-8")) as Record<string, string>;
        } catch {
          pins = {};
        }
      }

      if (description !== undefined) {
        pins[toolId] = description;
      } else {
        delete pins[toolId];
      }

      fs.writeFileSync(pinFile, JSON.stringify(pins, null, 2), "utf-8");
      return c.json({ upstreamId: id, toolId, pinned: description !== undefined, description });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/upstreams/:id/mutations — detect description mutations vs pinned
  // -------------------------------------------------------------------------
  app.get("/:id/mutations", async (c) => {
    const id = c.req.param("id");
    try {
      const upstream = readUpstreamFromDisk(upstreamsDir, id);
      if (!upstream) {
        return c.json({ error: `Upstream '${id}' not found` }, 404);
      }

      const cacheFile = path.join(upstreamsDir, `${id}.tools.json`);
      const pinFile = path.join(upstreamsDir, `${id}.pins.json`);

      let tools: Array<{ id: string; description?: string }> = [];
      let pins: Record<string, string> = {};

      if (fs.existsSync(cacheFile)) {
        try {
          tools = JSON.parse(fs.readFileSync(cacheFile, "utf-8")) as Array<{
            id: string;
            description?: string;
          }>;
        } catch {
          tools = [];
        }
      }

      if (fs.existsSync(pinFile)) {
        try {
          pins = JSON.parse(fs.readFileSync(pinFile, "utf-8")) as Record<string, string>;
        } catch {
          pins = {};
        }
      }

      // A mutation is when the live cached description differs from the pinned one
      const mutations = tools
        .filter((tool) => tool.id in pins && tool.description !== pins[tool.id])
        .map((tool) => ({
          toolId: tool.id,
          pinnedDescription: pins[tool.id],
          currentDescription: tool.description ?? null,
          mutated: true,
        }));

      return c.json({
        upstreamId: id,
        mutationCount: mutations.length,
        mutations,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
