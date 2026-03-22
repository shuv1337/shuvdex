import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { CapabilityRegistry, makeCapabilityRegistryLive } from "@shuvdex/capability-registry";
import { makeSkillImporterLive, SkillImporter } from "../src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function makeRuntime(importsDir: string, packagesDir: string) {
  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  return Layer.mergeAll(
    registryLayer,
    Layer.provide(makeSkillImporterLive({ importsDir }), registryLayer),
  );
}

function zipDirectory(sourceDir: string, outputPath: string): void {
  execFileSync("zip", ["-qr", outputPath, "."], { cwd: sourceDir });
}

describe("SkillImporter", () => {
  it("inspects standalone markdown skills and warns about missing local files", async () => {
    const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-pkgs-"));
    const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-assets-"));
    const layer = makeRuntime(importsDir, packagesDir);
    const filePath = path.join(os.tmpdir(), `standalone-skill-${Date.now()}.md`);
    fs.writeFileSync(
      filePath,
      [
        "---",
        "name: standalone-skill",
        "description: Use when testing markdown import previews.",
        "---",
        "# Standalone Skill",
        "",
        "Read ./references/guide.md before proceeding.",
      ].join("\n"),
      "utf-8",
    );

    const inspection = await Effect.runPromise(
      Effect.gen(function* () {
        const importer = yield* SkillImporter;
        return yield* importer.inspectMarkdownFile(filePath, "standalone-skill.md");
      }).pipe(Effect.provide(layer)),
    );

    expect(inspection.packageId).toBe("skill.standalone_skill");
    expect(inspection.warnings.some((warning) => warning.includes("local files not included"))).toBe(true);
    expect(inspection.metadataSources.description).toBe("frontmatter.description");
  });

  it("imports archive skills into managed storage and persists imported metadata", async () => {
    const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-pkgs-"));
    const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-assets-"));
    const layer = makeRuntime(importsDir, packagesDir);
    const zipPath = path.join(os.tmpdir(), `visual-explainer-${Date.now()}.zip`);

    zipDirectory(path.join(REPO_ROOT, "examples", "visual-explainer"), zipPath);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const importer = yield* SkillImporter;
        const registry = yield* CapabilityRegistry;
        const imported = yield* importer.importFile(zipPath, "visual-explainer.zip");
        const persisted = yield* registry.getPackage(imported.package.id);
        return { imported, persisted };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.imported.package.id).toBe("skill.visual_explainer");
    expect(result.imported.package.capabilities.length).toBeGreaterThan(10);
    expect(result.persisted.source).toMatchObject({
      type: "imported_archive",
      archiveName: "visual-explainer.zip",
      importMode: "upload",
    });
    expect(fs.existsSync(path.join(importsDir, result.imported.package.id, result.imported.package.version, "SKILL.md"))).toBe(true);
    expect(result.imported.extractedAssets.some((asset) => asset.includes("banner.png"))).toBe(true);
  });

  it("treats same-checksum archive re-import as a no-op without rewriting managed files", async () => {
    const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-pkgs-"));
    const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-importer-assets-"));
    const layer = makeRuntime(importsDir, packagesDir);
    const zipPath = path.join(os.tmpdir(), `visual-explainer-${Date.now()}.zip`);

    zipDirectory(path.join(REPO_ROOT, "examples", "visual-explainer"), zipPath);

    const result = await Effect.runPromise(
      Effect.promise(async () => {
        const importer = await Effect.runPromise(
          Effect.gen(function* () {
            return yield* SkillImporter;
          }).pipe(Effect.provide(layer)),
        );
        const first = await Effect.runPromise(importer.importFile(zipPath, "visual-explainer.zip"));
        const skillMdPath = path.join(importsDir, first.package.id, first.package.version, "SKILL.md");
        const beforeStat = fs.statSync(skillMdPath);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const second = await Effect.runPromise(importer.importFile(zipPath, "visual-explainer.zip"));
        const afterStat = fs.statSync(skillMdPath);
        return { first, second, beforeStat, afterStat };
      }),
    );

    expect(result.second.replaced).toBe(false);
    expect(result.second.warnings).toContain("Same checksum already imported.");
    expect(result.afterStat.mtimeMs).toBe(result.beforeStat.mtimeMs);
  });
});
