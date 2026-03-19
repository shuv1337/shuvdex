import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { CapabilityRegistry, makeCapabilityRegistryLive } from "@codex-fleet/capability-registry";
import { makeSkillImporterLive } from "@codex-fleet/skill-importer";
import { SkillIndexerLive } from "@codex-fleet/skill-indexer";
import { packagesRouter } from "../src/routes/packages.js";
import { skillsRouter } from "../src/routes/skills.js";

function makeApp(localRepoPath: string, packagesDir: string, importsDir: string) {
  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  const liveLayer = Layer.mergeAll(
    registryLayer,
    Layer.provide(makeSkillImporterLive({ importsDir }), registryLayer),
    SkillIndexerLive,
  );
  const managed = ManagedRuntime.make(liveLayer);

  return managed.runtime().then((runtime) => {
    const app = new Hono();
    app.route("/api/packages", packagesRouter(runtime as never, localRepoPath, importsDir));
    app.route("/api/skills", skillsRouter(runtime as never, localRepoPath));
    return { app, managed, runtime, liveLayer };
  });
}

describe("packagesRouter", () => {
  it("exposes imported skills, preserves them through reindex, and deletes managed assets", async () => {
    const localRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "api-skills-repo-"));
    const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-capabilities-"));
    const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-imports-"));
    const { app, managed, liveLayer } = await makeApp(localRepoPath, packagesDir, importsDir);
    try {
      fs.mkdirSync(path.join(importsDir, "skill.watchos_dev", "1.0.0"), { recursive: true });
      fs.writeFileSync(
        path.join(importsDir, "skill.watchos_dev", "1.0.0", "SKILL.md"),
        "# Imported\n",
        "utf-8",
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          yield* registry.upsertPackage({
            id: "skill.watchos_dev",
            version: "1.0.0",
            title: "WatchOS Dev",
            description: "Imported watchOS skill",
            builtIn: false,
            enabled: true,
            source: {
              type: "imported_archive",
              path: path.join(importsDir, "skill.watchos_dev", "1.0.0"),
              skillName: "watchos-dev",
              archiveName: "watchos-dev.skill",
              importedAt: "2026-03-19T00:00:00.000Z",
              checksum: "abc123",
              importMode: "upload",
            },
            capabilities: [],
            assets: [path.join(importsDir, "skill.watchos_dev", "1.0.0", "SKILL.md")],
          });
        }).pipe(Effect.provide(liveLayer)),
      );

      const skillsResponse = await app.request("http://localhost/api/skills");
      const skills = await skillsResponse.json();
      expect(skills.skills.some((skill: { packageId: string; source: string }) =>
        skill.packageId === "skill.watchos_dev" && skill.source === "imported_archive")).toBe(true);

      const reindexResponse = await app.request("http://localhost/api/packages/reindex", {
        method: "POST",
      });
      const reindex = await reindexResponse.json();
      expect(reindexResponse.status).toBe(200);
      expect(reindex.orphans).toEqual([]);

      const deleteResponse = await app.request("http://localhost/api/packages/skill.watchos_dev", {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);
      expect(fs.existsSync(path.join(importsDir, "skill.watchos_dev"))).toBe(false);
    } finally {
      await managed.dispose();
    }
  });
});
