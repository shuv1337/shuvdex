import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { OpenApiSource } from "@shuvdex/openapi-source";
import { handleError } from "../middleware/error-handler.js";

export function openapiSourcesRouter(runtime: Runtime.Runtime<OpenApiSource>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const sources = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.listSources();
      }));
      return c.json(sources);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/inspect", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.inspect({
          sourceId: typeof body["sourceId"] === "string" ? body["sourceId"] : undefined,
          specUrl: String(body["specUrl"]),
          title: String(body["title"]),
          description: typeof body["description"] === "string" ? body["description"] : undefined,
          tags: Array.isArray(body["tags"]) ? body["tags"].filter((tag): tag is string => typeof tag === "string") : undefined,
          packageIdOverride: typeof body["packageIdOverride"] === "string" ? body["packageIdOverride"] : undefined,
          selectedServerUrl: String(body["selectedServerUrl"] ?? ""),
          credentialId: typeof body["credentialId"] === "string" ? body["credentialId"] : undefined,
          operationFilter: typeof body["operationFilter"] === "object" && body["operationFilter"] !== null ? body["operationFilter"] as never : undefined,
          defaultTimeoutMs: typeof body["defaultTimeoutMs"] === "number" ? body["defaultTimeoutMs"] : undefined,
          defaultRiskLevel: body["defaultRiskLevel"] === "low" || body["defaultRiskLevel"] === "medium" || body["defaultRiskLevel"] === "high"
            ? body["defaultRiskLevel"]
            : undefined,
          companionPackageId: typeof body["companionPackageId"] === "string" ? body["companionPackageId"] : undefined,
        });
      }));
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.compile({
          sourceId: typeof body["sourceId"] === "string" ? body["sourceId"] : undefined,
          specUrl: String(body["specUrl"]),
          title: String(body["title"]),
          description: typeof body["description"] === "string" ? body["description"] : undefined,
          tags: Array.isArray(body["tags"]) ? body["tags"].filter((tag): tag is string => typeof tag === "string") : undefined,
          packageIdOverride: typeof body["packageIdOverride"] === "string" ? body["packageIdOverride"] : undefined,
          selectedServerUrl: String(body["selectedServerUrl"] ?? ""),
          credentialId: typeof body["credentialId"] === "string" ? body["credentialId"] : undefined,
          operationFilter: typeof body["operationFilter"] === "object" && body["operationFilter"] !== null ? body["operationFilter"] as never : undefined,
          defaultTimeoutMs: typeof body["defaultTimeoutMs"] === "number" ? body["defaultTimeoutMs"] : undefined,
          defaultRiskLevel: body["defaultRiskLevel"] === "low" || body["defaultRiskLevel"] === "medium" || body["defaultRiskLevel"] === "high"
            ? body["defaultRiskLevel"]
            : undefined,
          companionPackageId: typeof body["companionPackageId"] === "string" ? body["companionPackageId"] : undefined,
        });
      }));
      return c.json(result, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get("/:sourceId", async (c) => {
    try {
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.getSource(c.req.param("sourceId"));
      }));
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.patch("/:sourceId", async (c) => {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.updateSource(c.req.param("sourceId"), body as never);
      }));
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/:sourceId/refresh", async (c) => {
    try {
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.refreshSource(c.req.param("sourceId"));
      }));
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/:sourceId/test-auth", async (c) => {
    try {
      const result = await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        return yield* service.testAuth(c.req.param("sourceId"));
      }));
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/:sourceId", async (c) => {
    try {
      await run(Effect.gen(function* () {
        const service = yield* OpenApiSource;
        yield* service.deleteSource(c.req.param("sourceId"));
      }));
      return c.json({ deleted: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
