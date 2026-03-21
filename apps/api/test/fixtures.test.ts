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

const SKILLS_ROOT = "/home/shuv/repos/shuvbot-skills";
const canonical = [
  "visual-explainer",
  "dogfood",
  "network-monitor",
  "openclaw-manager",
  "brave-search",
  "youtube-transcript",
  "make-api",
  "discord",
] as const;

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
    return { app, managed };
  });
}

describe("canonical shuvbot fixture imports", () => {
  it("browser is intentionally excluded from archive import smoke tests because its node_modules payload exceeds the API upload limit", () => {
    const browserPath = path.join(SKILLS_ROOT, "browser");
    const nodeModulesPath = path.join(browserPath, "node_modules");
    expect(fs.existsSync(nodeModulesPath)).toBe(true);
  });

  for (const skill of canonical) {
    it(`inspects ${skill} as an archive import`, async () => {
      const localRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-skill-repo-"));
      const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-capabilities-"));
      const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-imports-"));
      const archivePath = path.join(os.tmpdir(), `${skill}-${Date.now()}.zip`);
      const { app, managed } = await makeApp(localRepoPath, packagesDir, importsDir);
      try {
        const source = path.join(SKILLS_ROOT, skill);
        await Effect.runPromise(
          Effect.promise(async () => {
            const { execFileSync } = await import("node:child_process");
            execFileSync("zip", ["-qr", archivePath, "."], { cwd: source });
          }),
        );

        const form = new FormData();
        form.set("file", new File([fs.readFileSync(archivePath)], `${skill}.zip`));
        const response = await app.request("http://localhost/api/packages/import/inspect", {
          method: "POST",
          body: form,
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.packageId).toMatch(/^skill\./);
        expect(body.capabilities.length).toBeGreaterThanOrEqual(3);
      } finally {
        await managed.dispose();
        fs.rmSync(archivePath, { force: true });
      }
    });
  }
});
