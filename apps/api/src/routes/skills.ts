/**
 * Skills discovery routes — /api/skills
 *
 * Exposes compiled skill inventory from the skill indexer.
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { SkillIndexer } from "@codex-fleet/skill-indexer";
import { handleError } from "../middleware/error-handler.js";

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Returns a Hono sub-application with the skills discovery route.
 *
 * @param localRepoPath  Absolute path to the local skills repository.
 */
export function skillsRouter(
  runtime: Runtime.Runtime<SkillIndexer>,
  localRepoPath: string,
): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/skills
  // -------------------------------------------------------------------------
  app.get("/", async (c) => {
    try {
      const indexed = await run(
        Effect.gen(function* () {
          const indexer = yield* SkillIndexer;
          return yield* indexer.indexRepository(localRepoPath);
        }),
      );
      return c.json({
        repoPath: localRepoPath,
        count: indexed.artifacts.length,
        skills: indexed.artifacts.map((artifact) => ({
          skill: artifact.skillName,
          packageId: artifact.package.id,
          version: artifact.package.version,
          warnings: artifact.warnings,
          hosts: {},
        })),
        failures: indexed.failures,
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
