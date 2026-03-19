/**
 * Tool management routes — /api/tools
 *
 * Compatibility API that exposes tool capabilities from the capability registry
 * in the flat shape the existing UI expects.
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CapabilityRegistry } from "@codex-fleet/capability-registry";
import type { CapabilityDefinition, CapabilityPackage } from "@codex-fleet/capability-registry";
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
  runtime: Runtime.Runtime<CapabilityRegistry>,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  const toLegacyTool = (pkg: CapabilityPackage, capability: CapabilityDefinition) => ({
    id: capability.id,
    name: capability.id,
    description: capability.description,
    category: pkg.tags?.[0] ?? capability.tags?.[0] ?? capability.kind,
    enabled: capability.enabled,
    builtIn: pkg.builtIn,
    schema: {
      params:
        capability.tool &&
        capability.tool.inputSchema &&
        typeof capability.tool.inputSchema === "object" &&
        capability.tool.inputSchema !== null &&
        "properties" in capability.tool.inputSchema
          ? Object.entries(
              (capability.tool.inputSchema as {
                properties?: Record<string, { type?: string; description?: string }>;
                required?: string[];
              }).properties ?? {},
            ).map(([name, value]) => ({
              name,
              type: value.type ?? "string",
              description: value.description ?? "",
              optional: !(
                (
                  capability.tool?.inputSchema as {
                    required?: string[];
                  }
                ).required ?? []
              ).includes(name),
            }))
          : [],
    },
  });

  const makeToolPackage = (name: string, body: Record<string, unknown>): CapabilityPackage => ({
    id: `custom.${name}`,
    version: "1.0.0",
    title: String(body["title"] ?? name),
    description: String(body["description"] ?? ""),
    builtIn: false,
    enabled: body["enabled"] !== false,
    tags: [String(body["category"] ?? "custom")],
    source: { type: "generated" },
    capabilities: [
      {
        id: name,
        packageId: `custom.${name}`,
        version: "1.0.0",
        kind: "tool",
        title: String(body["title"] ?? name),
        description: String(body["description"] ?? ""),
        enabled: body["enabled"] !== false,
        visibility: "scoped",
        tags: [String(body["category"] ?? "custom")],
        subjectScopes: ["admin"],
        riskLevel: "medium",
        executorRef: { executorType: "module_runtime" },
        tool: {
          inputSchema: {
            type: "object",
            properties: Object.fromEntries(
              (((body["schema"] as { params?: Array<Record<string, unknown>> } | undefined)?.params ??
                []) as Array<Record<string, unknown>>).map((param) => [
                String(param["name"]),
                {
                  type: param["type"] ?? "string",
                  description: param["description"] ?? "",
                },
              ]),
            ),
            required: (((body["schema"] as { params?: Array<Record<string, unknown>> } | undefined)?.params ??
              []) as Array<Record<string, unknown>>)
              .filter((param) => !param["optional"])
              .map((param) => String(param["name"])),
          },
          outputSchema: { type: "object" },
          sideEffectLevel: "write",
        },
      },
    ],
  });

  // -------------------------------------------------------------------------
  // GET /api/tools[?enabled=true|false]
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const tools = await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          const packages = yield* registry.listPackages();
          const capabilities = yield* registry.listCapabilities({ kind: "tool" });
          return capabilities.map((capability) =>
            toLegacyTool(
              packages.find((pkg) => pkg.id === capability.packageId)!,
              capability,
            ),
          );
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
          const registry = yield* CapabilityRegistry;
          const capability = yield* registry.getCapability(name);
          const pkg = yield* registry.getPackage(capability.packageId);
          return toLegacyTool(pkg, capability);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/tools  — create a new custom tool package
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
          const registry = yield* CapabilityRegistry;
          const packageDef = makeToolPackage(
            String((body as Record<string, unknown>)["name"]),
            body as Record<string, unknown>,
          );
          const created = yield* registry.createPackage(packageDef);
          return toLegacyTool(created, created.capabilities[0]!);
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
          const registry = yield* CapabilityRegistry;
          const capability = yield* registry.getCapability(name);
          const pkg = yield* registry.getPackage(capability.packageId);
          const nextPackage: CapabilityPackage = {
            ...pkg,
            description: String((body as Record<string, unknown>)["description"] ?? pkg.description),
            enabled: (body as Record<string, unknown>)["enabled"] === false ? false : pkg.enabled,
            tags: [String((body as Record<string, unknown>)["category"] ?? pkg.tags?.[0] ?? "custom")],
            capabilities: pkg.capabilities.map((item) =>
              item.id !== name
                ? item
                : {
                    ...item,
                    title: String((body as Record<string, unknown>)["name"] ?? item.title),
                    description: String(
                      (body as Record<string, unknown>)["description"] ?? item.description,
                    ),
                    enabled:
                      (body as Record<string, unknown>)["enabled"] === false
                        ? false
                        : item.enabled,
                  },
            ),
          };
          const updated = yield* registry.upsertPackage(nextPackage);
          return toLegacyTool(
            updated,
            updated.capabilities.find((item) => item.id === name)!,
          );
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
          const registry = yield* CapabilityRegistry;
          const capability = yield* registry.getCapability(name);
          yield* registry.deletePackage(capability.packageId);
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
          const registry = yield* CapabilityRegistry;
          const capability = yield* registry.enableCapability(name);
          const pkg = yield* registry.getPackage(capability.packageId);
          return toLegacyTool(pkg, capability);
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
          const registry = yield* CapabilityRegistry;
          const capability = yield* registry.disableCapability(name);
          const pkg = yield* registry.getPackage(capability.packageId);
          return toLegacyTool(pkg, capability);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.put("/:name/enabled", async (c) => {
    const name = c.req.param("name");
    const body = (await c.req.json().catch(() => ({ enabled: true }))) as {
      enabled?: boolean;
    };
    try {
      const tool = await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          const capability = body.enabled === false
            ? yield* registry.disableCapability(name)
            : yield* registry.enableCapability(name);
          const pkg = yield* registry.getPackage(capability.packageId);
          return toLegacyTool(pkg, capability);
        }),
      );
      return c.json(tool);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
