import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CapabilityRegistry } from "@shuvdex/capability-registry";
import { SkillImporter } from "@shuvdex/skill-importer";
import { SkillIndexer } from "@shuvdex/skill-indexer";
import { handleError } from "../middleware/error-handler.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function writeUploadToTemp(file: File): Promise<{ path: string; cleanup: () => void }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-upload-"));
  const tempPath = path.join(tempDir, file.name || "upload.bin");
  fs.writeFileSync(tempPath, Buffer.from(await file.arrayBuffer()));
  return {
    path: tempPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

function orphanImportDirectories(importsDir: string, packageIds: ReadonlyArray<string>): string[] {
  if (!fs.existsSync(importsDir)) {
    return [];
  }
  const knownIds = new Set(packageIds);
  return fs
    .readdirSync(importsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !knownIds.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function parseForce(body: Record<string, unknown>): boolean {
  const raw = body["force"];
  return raw === true || raw === "true" || raw === "1" || raw === 1;
}

function isUploadTooLarge(file: File): boolean {
  return Number.isFinite(file.size) && file.size > MAX_UPLOAD_BYTES;
}

export function packagesRouter(
  runtime: Runtime.Runtime<CapabilityRegistry | SkillIndexer | SkillImporter>,
  localRepoPath: string,
  importsDir: string,
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
          const existing = yield* Effect.either(registry.getPackage(artifact.package.id));
          if (existing._tag === "Right" && existing.right.source?.type === "imported_archive") {
            continue;
          }
          yield* registry.upsertPackage(artifact.package);
        }
        const packageIds = (yield* registry.listPackages()).map((pkg) => pkg.id);
        const orphans = orphanImportDirectories(importsDir, packageIds);
        for (const orphan of orphans) {
          console.warn(
            `Orphaned import directory found for package '${orphan}' with no matching package definition.`,
          );
        }
        return { ...indexed, orphans };
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

  app.post("/cleanup", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          const packages = yield* registry.listPackages();
          const orphans = orphanImportDirectories(
            importsDir,
            packages.map((pkg) => pkg.id),
          );
          const removed: string[] = [];
          if (parseForce(body)) {
            for (const orphan of orphans) {
              fs.rmSync(path.join(importsDir, orphan), { recursive: true, force: true });
              removed.push(orphan);
            }
          }
          return { orphans, removed };
        }),
      );
      return c.json(result);
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.post("/import/inspect", async (c) => {
    try {
      const contentLength = Number(c.req.header("content-length") ?? "0");
      if (contentLength > MAX_UPLOAD_BYTES) {
        return c.json({ error: "Upload exceeds size limit." }, 400);
      }
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "Expected multipart field 'file'." }, 400);
      }
      if (isUploadTooLarge(file)) {
        return c.json({ error: "Upload exceeds size limit." }, 400);
      }
      const uploaded = await writeUploadToTemp(file);
      try {
        const inspection = await run(
          Effect.gen(function* () {
            const importer = yield* SkillImporter;
            const ext = path.extname(file.name).toLowerCase();
            return yield* (ext === ".md"
              ? importer.inspectMarkdownFile(uploaded.path, file.name)
              : importer.inspectArchive(uploaded.path, file.name));
          }),
        );
        return c.json(inspection);
      } finally {
        uploaded.cleanup();
      }
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.post("/import", async (c) => {
    try {
      const contentLength = Number(c.req.header("content-length") ?? "0");
      if (contentLength > MAX_UPLOAD_BYTES) {
        return c.json({ error: "Upload exceeds size limit." }, 400);
      }
      const body = (await c.req.parseBody()) as Record<string, unknown>;
      const file = body["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "Expected multipart field 'file'." }, 400);
      }
      if (isUploadTooLarge(file)) {
        return c.json({ error: "Upload exceeds size limit." }, 400);
      }
      const uploaded = await writeUploadToTemp(file);
      try {
        const result = await run(
          Effect.gen(function* () {
            const importer = yield* SkillImporter;
            return yield* importer.importFile(uploaded.path, file.name, {
              force: parseForce(body),
            });
          }),
        );
        return c.json(result);
      } finally {
        uploaded.cleanup();
      }
    } catch (e) {
      return handleError(c, e);
    }
  });

  app.delete("/:packageId", async (c) => {
    const packageId = c.req.param("packageId");
    try {
      await run(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          const pkg = yield* registry.getPackage(packageId);
          yield* registry.deletePackage(packageId);
          if (pkg.source?.type === "imported_archive") {
            fs.rmSync(path.join(importsDir, packageId), { recursive: true, force: true });
          }
        }),
      );
      return c.json({ deleted: true });
    } catch (e) {
      return handleError(c, e);
    }
  });

  return app;
}
