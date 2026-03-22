/**
 * Skills discovery routes — /api/skills
 *
 * Exposes compiled skill inventory from the skill indexer.
 */
import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CapabilityRegistry } from "@shuvdex/capability-registry";
import { SkillIndexer } from "@shuvdex/skill-indexer";
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
  runtime: Runtime.Runtime<SkillIndexer | CapabilityRegistry>,
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
          const registry = yield* CapabilityRegistry;
          const local = yield* indexer.indexRepository(localRepoPath);
          const imported = (yield* registry.listPackages()).filter(
            (pkg) => pkg.source?.type === "imported_archive",
          );
          return { local, imported };
        }),
      );
      return c.json({
        repoPath: localRepoPath,
        count: indexed.local.artifacts.length + indexed.imported.length,
        skills: [
          ...indexed.local.artifacts.map((artifact) => ({
            skill: artifact.skillName,
            packageId: artifact.package.id,
            version: artifact.package.version,
            warnings: artifact.warnings,
            hosts: {},
            source: "local_repo" as const,
          })),
          ...indexed.imported.map((pkg) => ({
            skill: pkg.source?.skillName ?? pkg.id.replace(/^skill\./, ""),
            packageId: pkg.id,
            version: pkg.version,
            warnings: [],
            hosts: {},
            source: "imported_archive" as const,
          })),
        ],
        failures: indexed.local.failures,
      });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
