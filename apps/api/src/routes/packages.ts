import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CapabilityRegistry } from "@codex-fleet/capability-registry";
import { SkillIndexer } from "@codex-fleet/skill-indexer";
import { handleError } from "../middleware/error-handler.js";

export function packagesRouter(
  runtime: Runtime.Runtime<CapabilityRegistry | SkillIndexer>,
  localRepoPath: string,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  const refreshRegistry = async () =>
    run(
      Effect.gen(function* () {
        const registry = yield* CapabilityRegistry;
        const indexer = yield* SkillIndexer;
        const indexed = yield* indexer.indexRepository(localRepoPath);
        for (const artifact of indexed.artifacts) {
          yield* registry.upsertPackage(artifact.package);
        }
        return indexed;
      }),
    );

  app.get("/", async (c) => {
    try {
      if (c.req.query("refresh") === "1") {
        await refreshRegistry();
      }
      const result = await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          return yield* registry.listPackages();
        }),
      );
      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.post("/reindex", async (c) => {
    try {
      const indexed = await refreshRegistry();
      return c.json(indexed);
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
