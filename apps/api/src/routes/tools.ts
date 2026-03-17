/**
 * Tool management routes — /api/tools
 *
 * CRUD for ToolDefinition records stored in the tool registry.
 * All business logic runs as Effect programs inside the shared runtime.
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { ToolRegistry } from "@codex-fleet/tool-registry";
import type { CreateToolInput, UpdateToolInput } from "@codex-fleet/tool-registry";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with all tool management routes mounted.
 *
 * @param runtime  Effect runtime that provides the ToolRegistry service.
 */
export function toolsRouter(
  runtime: Runtime.Runtime<ToolRegistry>,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/tools[?enabled=true|false]
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    const enabledParam = c.req.query("enabled");
    const filter =
      enabledParam !== undefined
        ? { enabled: enabledParam === "true" }
        : undefined;

    try {
      const tools = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.listTools(filter);
        }),
      );
      return c.json(tools);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/tools/:name
  // -------------------------------------------------------------------------
  app.get("/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.getTool(name);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tools  — create a new custom tool
  // -------------------------------------------------------------------------
  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    try {
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.createTool(body as CreateToolInput);
        }),
      );
      return c.json(tool, 201);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /api/tools/:name  — partial update
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
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.updateTool(name, body as UpdateToolInput);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/tools/:name
  // -------------------------------------------------------------------------
  app.delete("/:name", async (c) => {
    const name = c.req.param("name");
    try {
      await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          yield* registry.deleteTool(name);
        }),
      );
      return c.json({ deleted: true });
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tools/:name/enable
  // -------------------------------------------------------------------------
  app.post("/:name/enable", async (c) => {
    const name = c.req.param("name");
    try {
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.enableTool(name);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tools/:name/disable
  // -------------------------------------------------------------------------
  app.post("/:name/disable", async (c) => {
    const name = c.req.param("name");
    try {
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* ToolRegistry;
          return yield* registry.disableTool(name);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
