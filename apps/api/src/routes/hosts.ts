/**
 * Host management routes — /api/hosts
 *
 * Reads and writes fleet.yaml directly (via config-writer) so every
 * mutation is immediately persisted.  The HostConfig Schema is used for
 * validation on create/update so the same rules apply as on server start.
 */
import { Hono } from "hono";
import { Effect, Schema } from "effect";
import { HostConfig, loadConfig } from "@shuvdex/core";
import { readFleetYaml, writeFleetYaml } from "../lib/config-writer.js";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with all host management routes mounted.
 *
 * @param configPath  Absolute path to fleet.yaml.
 */
export function hostsRouter(configPath: string): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/hosts
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const registry = await Effect.runPromise(loadConfig(configPath));
      const hosts = registry
        .getAllHosts()
        .map(([name, config]) => ({ name, ...config }));
      return c.json(hosts);
    } catch {
      // Config not found or invalid → return empty list
      return c.json([]);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/hosts/:name
  // -------------------------------------------------------------------------
  app.get("/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const registry = await Effect.runPromise(loadConfig(configPath));
      const config = await Effect.runPromise(registry.getHost(name));
      return c.json({ name, ...config });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/hosts  — add a new host
  // Body: { name: string; config: HostConfig }
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    let body: { name?: unknown; config?: unknown };
    try {
      body = (await c.req.json()) as { name?: unknown; config?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json({ error: "Field 'name' is required and must be a non-empty string" }, 400);
    }
    if (body.config === undefined || body.config === null) {
      return c.json({ error: "Field 'config' is required" }, 400);
    }

    const hostName = body.name.trim();

    try {
      // Validate the supplied config against the HostConfig schema
      const hostConfig = await Effect.runPromise(
        Schema.decodeUnknown(HostConfig)(body.config),
      );

      const data = readFleetYaml(configPath);
      if (data.hosts[hostName] !== undefined) {
        return c.json({ error: `Host '${hostName}' already exists` }, 409);
      }

      data.hosts[hostName] = hostConfig;
      writeFleetYaml(configPath, data);

      return c.json({ name: hostName, ...hostConfig }, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/hosts/:name  — update host config (merged)
  // Body: partial HostConfig fields
  // -------------------------------------------------------------------------
  app.patch("/:name", async (c) => {
    const name = c.req.param("name");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const data = readFleetYaml(configPath);
      const existing = data.hosts[name];
      if (existing === undefined) {
        return c.json({ error: `Host '${name}' not found` }, 404);
      }

      // Merge incoming patch over existing config and re-validate
      const merged = { ...existing, ...(body as Record<string, unknown>) };
      const hostConfig = await Effect.runPromise(
        Schema.decodeUnknown(HostConfig)(merged),
      );

      data.hosts[name] = hostConfig;
      writeFleetYaml(configPath, data);

      return c.json({ name, ...hostConfig });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/hosts/:name
  // -------------------------------------------------------------------------
  app.delete("/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const data = readFleetYaml(configPath);
      if (data.hosts[name] === undefined) {
        return c.json({ error: `Host '${name}' not found` }, 404);
      }

      delete data.hosts[name];
      writeFleetYaml(configPath, data);

      return c.json({ deleted: true });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
