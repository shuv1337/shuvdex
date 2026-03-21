import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import yauzl from "yauzl";
import { CapabilityRegistry, type CapabilityPackage, type CapabilityRegistryIOError } from "@codex-fleet/capability-registry";
import { compileSkillDirectory, parseFrontmatter } from "@codex-fleet/skill-indexer";
import { ArchiveValidationError, ImportConflictError } from "./errors.js";
import type {
  ArchiveInspection,
  ImportConflict,
  ImportResult,
  SkillImporterService,
} from "./types.js";
import { SkillImporter } from "./types.js";

export interface SkillImporterConfig {
  readonly importsDir: string;
  readonly maxArchiveBytes?: number;
}

interface InternalInspection {
  readonly inspection: ArchiveInspection;
  readonly compiledPackage: CapabilityPackage;
  readonly skillRoot: string;
  readonly tempRoot?: string;
}

interface PackageJsonShape {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  keywords?: string[];
}

const DEFAULT_MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const STRIP_NAMES = new Set([".DS_Store"]);
const STRIP_DIRS = new Set(["__pycache__", "node_modules", ".git"]);
const SECRET_FILENAME = /(secret|credential|token)/i;
const EXECUTABLE_EXT = /\.(sh|bash|py|js|mjs|cjs)$/i;
const DOTFILE_INFO = /^\./;

function sha256ForFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function stripTempRoots(warnings: string[], tempRoot?: string): string[] {
  return warnings.map((warning) => (tempRoot ? warning.replaceAll(tempRoot, "<temp>") : warning));
}

function summarizeCapabilities(pkg: CapabilityPackage) {
  return pkg.capabilities.map((capability) => ({
    id: capability.id,
    kind: capability.kind,
    title: capability.title,
  }));
}

function metadataSourcesForSkill(skillRoot: string): ArchiveInspection["metadataSources"] {
  const skillMdPath = path.join(skillRoot, "SKILL.md");
  const { frontmatter } = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
  let packageJson: PackageJsonShape | undefined;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf-8")) as PackageJsonShape;
  } catch {
    packageJson = undefined;
  }

  const packageId = typeof frontmatter["name"] === "string" ? "frontmatter.name" : packageJson?.name ? "package.json.name" : "directory";
  const version = packageJson?.version ? "package.json.version" : "content-hash";
  const description = typeof frontmatter["description"] === "string" ? "frontmatter.description" : packageJson?.description ? "package.json.description" : "markdown.body";

  return { packageId, version, description };
}

function textWarningsForSkill(skillRoot: string, body: string, warnings: string[]): void {
  const bodyLines = body.split("\n");
  const descriptionMatch = /^description:\s*(.+)$/m.exec(fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf-8"));
  const description = descriptionMatch?.[1]?.trim() ?? "";
  const nameMatch = /^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf-8"));
  const skillName = nameMatch?.[1]?.trim() ?? path.basename(skillRoot);

  const topLevelSections = bodyLines.filter((line) => line.startsWith("## ")).length;
  if (topLevelSections >= 4) {
    warnings.push("Skill covers multiple workflows; consider splitting it into smaller skills.");
  }
  if (description.length < 20 || description.toLowerCase() === skillName.toLowerCase()) {
    warnings.push("Description is vague; include what the skill does and when to use it.");
  }
  if (/^(I|You|We)\b/.test(description) || /^[A-Z]?[a-z]+/.test(description) && !/\b(use|when|for)\b/i.test(description)) {
    warnings.push("Description should read like third-person routing guidance.");
  }
  if (!/^[a-z][a-z0-9-]*$/.test(skillName)) {
    warnings.push("Name is not lowercase-hyphenated.");
  }
  if (bodyLines.length > 500 || Buffer.byteLength(body, "utf-8") > 30 * 1024) {
    warnings.push("SKILL.md is overly long.");
  }
  const examplesDir = path.join(skillRoot, "examples");
  if (!fs.existsSync(examplesDir) && !body.includes("```") && !/##?\s+(Example|Usage)\b/i.test(body)) {
    warnings.push("No examples provided.");
  }
  if (fs.existsSync(path.join(skillRoot, "scripts"))) {
    const hasDependencies =
      fs.existsSync(path.join(skillRoot, "requirements.txt")) ||
      fs.existsSync(path.join(skillRoot, "package.json")) ||
      fs.existsSync(path.join(skillRoot, "Pipfile")) ||
      /##\s+Dependencies/i.test(body);
    if (!hasDependencies) {
      warnings.push("Scripts are present without dependency declarations.");
    }
  }
}

function scanSecurityWarnings(skillRoot: string, warnings: string[]): void {
  for (const filePath of walkFiles(skillRoot)) {
    const relative = path.relative(skillRoot, filePath).split(path.sep).join("/");
    const stat = fs.statSync(filePath);
    const isExecutable = Boolean(stat.mode & 0o111);
    const ext = path.extname(filePath).toLowerCase();

    if (DOTFILE_INFO.test(path.basename(filePath)) && path.basename(filePath) !== ".env") {
      warnings.push(`Dot-file '${relative}' preserved as an asset.`);
    }
    if (isExecutable || EXECUTABLE_EXT.test(filePath)) {
      warnings.push(`Archive bundles executable content: '${relative}'.`);
    }
    if ([".class", ".o", ".so", ".dll", ".exe"].includes(ext)) {
      warnings.push(`Archive contains compiled or binary file '${relative}'.`);
    }
    if ([".md", ".txt", ".json", ".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ""].includes(ext)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (/(API_KEY=|token:|password:|sk-|ghp_|Bearer\s+)/i.test(content)) {
        warnings.push(`Potential hardcoded credential pattern found in '${relative}'.`);
      }
    }
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  };
  walk(root);
  return files.sort();
}

function cleanupPath(target: string | undefined): void {
  if (!target) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(source, target);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      fs.chmodSync(target, fs.statSync(source).mode);
    }
  }
}

function detectSkillRoot(extractedDir: string): { skillRoot: string; flat: boolean } {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });
  if (fs.existsSync(path.join(extractedDir, "SKILL.md"))) {
    return { skillRoot: extractedDir, flat: true };
  }

  const topDirs = entries.filter((entry) => entry.isDirectory());
  if (topDirs.length === 1) {
    const candidate = path.join(extractedDir, topDirs[0]!.name);
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) {
      return { skillRoot: candidate, flat: false };
    }
  }

  if (topDirs.length > 1) {
    throw new ArchiveValidationError({
      message: "Archive contains multiple top-level directories; multi-skill archives are not supported.",
    });
  }

  throw new ArchiveValidationError({ message: "Archive is missing SKILL.md." });
}

function permissionModeFromEntry(entry: yauzl.Entry): number | undefined {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return mode > 0 ? mode : undefined;
}

async function extractArchiveToTemp(
  archivePath: string,
  maxArchiveBytes: number,
): Promise<{ tempRoot: string; warnings: string[] }> {
  const stat = fs.statSync(archivePath);
  if (stat.size > maxArchiveBytes) {
    throw new ArchiveValidationError({
      message: `Archive exceeds the ${maxArchiveBytes} byte limit.`,
    });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-import-"));
  const warnings: string[] = [];
  const seenEntries = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openErr, zipFile) => {
      if (openErr || !zipFile) {
        reject(
          new ArchiveValidationError({
            message: "Invalid zip archive.",
          }),
        );
        return;
      }

      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        const normalized = path.normalize(entry.fileName);
        const unixMode = permissionModeFromEntry(entry);
        const isSymlink = ((unixMode ?? 0) & fs.constants.S_IFMT) === fs.constants.S_IFLNK;
        const destination = path.resolve(tempRoot, normalized);

        if (entry.fileName.includes("..") || !destination.startsWith(tempRoot)) {
          zipFile.close();
          reject(new ArchiveValidationError({ message: "Archive contains path traversal entries." }));
          return;
        }
        if (isSymlink) {
          zipFile.close();
          reject(new ArchiveValidationError({ message: "Archive contains symlinks." }));
          return;
        }
        if (seenEntries.has(normalized)) {
          zipFile.close();
          reject(new ArchiveValidationError({ message: "Archive contains duplicate entries." }));
          return;
        }
        seenEntries.add(normalized);

        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(destination, { recursive: true });
          zipFile.readEntry();
          return;
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        zipFile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            zipFile.close();
            reject(new ArchiveValidationError({ message: "Failed to read archive entry." }));
            return;
          }

          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", (err) => reject(err));
          stream.on("end", () => {
            fs.writeFileSync(destination, Buffer.concat(chunks));
            const explicitMode = permissionModeFromEntry(entry);
            if (explicitMode) {
              fs.chmodSync(destination, explicitMode);
            } else {
              const textStart = fs.readFileSync(destination, { encoding: "utf-8", flag: "r" }).slice(0, 2);
              const mode = textStart === "#!" || EXECUTABLE_EXT.test(destination) ? 0o755 : 0o644;
              fs.chmodSync(destination, mode);
            }
            zipFile.readEntry();
          });
        });
      });
      zipFile.on("end", () => resolve());
      zipFile.on("error", (err) =>
        reject(
          new ArchiveValidationError({
            message: err instanceof Error ? err.message : String(err),
          }),
        ));
    });
  });

  return { tempRoot, warnings };
}

function stripArtifacts(skillRoot: string): string[] {
  const warnings: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(skillRoot, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (STRIP_DIRS.has(entry.name)) {
          fs.rmSync(absolute, { recursive: true, force: true });
          continue;
        }
        walk(absolute);
        continue;
      }

      if (STRIP_NAMES.has(entry.name) || /\.pyc$/i.test(entry.name) || /(~|\.swp)$/i.test(entry.name)) {
        fs.rmSync(absolute, { force: true });
        continue;
      }
      if (entry.name === ".env") {
        fs.rmSync(absolute, { force: true });
        warnings.push(`Credential file '${relative}' found and removed. Secrets should not be bundled in skill archives.`);
        continue;
      }
      if (SECRET_FILENAME.test(entry.name)) {
        fs.rmSync(absolute, { force: true });
        warnings.push(`Sensitive-looking file '${relative}' found and removed.`);
      }
    }
  };

  walk(skillRoot);
  return warnings;
}

function relativeAssetPaths(root: string, pkg: CapabilityPackage): string[] {
  return (pkg.assets ?? []).map((asset) => path.relative(root, asset).split(path.sep).join("/"));
}

function rewritePackagePaths(pkg: CapabilityPackage, sourceRoot: string, managedRoot: string): CapabilityPackage {
  const rewrite = (value: string | undefined): string | undefined => {
    if (!value) return value;
    if (path.isAbsolute(value) && value.startsWith(sourceRoot)) {
      return path.join(managedRoot, path.relative(sourceRoot, value));
    }
    return value;
  };

  return {
    ...pkg,
    source: pkg.source
      ? {
          ...pkg.source,
          type: "imported_archive",
          path: managedRoot,
        }
      : {
          type: "imported_archive",
          path: managedRoot,
        },
    sourceRef: rewrite(pkg.sourceRef),
    capabilities: pkg.capabilities.map((capability) => ({
      ...capability,
      sourceRef: rewrite(capability.sourceRef),
      executorRef: capability.executorRef
        ? {
            ...capability.executorRef,
            target: rewrite(capability.executorRef.target),
          }
        : capability.executorRef,
    })),
    assets: pkg.assets?.map((asset) => rewrite(asset) ?? asset),
  };
}

function ensureSkillFrontmatter(skillMdPath: string, flatArchive: boolean): void {
  const { frontmatter, body } = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
  if (typeof frontmatter["name"] !== "string" || typeof frontmatter["description"] !== "string") {
    throw new ArchiveValidationError({
      message: "SKILL.md frontmatter must include both 'name' and 'description'.",
    });
  }
  if (flatArchive && typeof frontmatter["name"] !== "string") {
    throw new ArchiveValidationError({
      message: "Flat archives require frontmatter.name.",
    });
  }
  void body;
}

function getPackageConflict(existing: CapabilityPackage | undefined, checksum: string): ImportConflict[] {
  if (!existing) return [];

  const sourceType = existing.source?.type ?? "unknown";
  if (sourceType === "imported_archive") {
    if (existing.source?.checksum === checksum) {
      return [
        {
          packageId: existing.id,
          existingSourceType: sourceType,
          resolution: "replaceable",
          reason: "Same checksum already imported.",
        },
      ];
    }
    return [
      {
        packageId: existing.id,
        existingSourceType: sourceType,
        resolution: "replaceable",
        reason: "Existing imported package can be replaced.",
      },
    ];
  }

  if (sourceType === "generated") {
    return [
      {
        packageId: existing.id,
        existingSourceType: sourceType,
        resolution: "replaceable",
        reason: "Generated package can be replaced.",
      },
    ];
  }

  return [
    {
      packageId: existing.id,
      existingSourceType: sourceType,
      resolution: "blocked",
      reason: "Package id is owned by a repo-indexed or built-in package.",
    },
  ];
}

function makeInspection(
  pkg: CapabilityPackage,
  originalFilename: string,
  checksum: string,
  warnings: string[],
  conflicts: ImportConflict[],
  metadataSources: ArchiveInspection["metadataSources"],
  skillRoot: string,
): ArchiveInspection {
  return {
    packageId: pkg.id,
    version: pkg.version,
    title: pkg.title,
    summary: pkg.description,
    capabilities: summarizeCapabilities(pkg),
    assets: relativeAssetPaths(skillRoot, pkg),
    warnings,
    conflicts,
    checksum,
    originalFilename,
    annotations: pkg.annotations ?? {},
    metadataSources,
  };
}

function createStandaloneSkillDir(filePath: string): { skillRoot: string; tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-import-md-"));
  const { frontmatter } = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
  const dirName = typeof frontmatter["name"] === "string" ? String(frontmatter["name"]) : path.basename(filePath, path.extname(filePath));
  const skillRoot = path.join(tempRoot, dirName);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.copyFileSync(filePath, path.join(skillRoot, "SKILL.md"));
  return { skillRoot, tempRoot };
}

function ensureRelativeReferenceWarnings(body: string, warnings: string[]): void {
  const refs = body.match(/\.[/\\][A-Za-z0-9._/-]+/g) ?? [];
  if (refs.length > 0) {
    warnings.push(`This skill references ${refs.length} local files not included. Consider a .zip or .skill archive.`);
  }
}

export function makeSkillImporterLive(
  config: SkillImporterConfig,
): Layer.Layer<SkillImporter, never, CapabilityRegistry> {
  const maxArchiveBytes = config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  return Layer.effect(
    SkillImporter,
    Effect.gen(function* () {
      const registry = yield* CapabilityRegistry;

      const lookupExistingPackage = async (packageId: string): Promise<CapabilityPackage | undefined> => {
        const result = await Effect.runPromise(Effect.either(registry.getPackage(packageId)));
        return result._tag === "Right" ? result.right : undefined;
      };

      const inspectMarkdownFileInternal = async (
        filePath: string,
        originalFilename: string,
      ): Promise<InternalInspection> => {
        const temp = createStandaloneSkillDir(filePath);
        try {
          const skillMdPath = path.join(temp.skillRoot, "SKILL.md");
          const { frontmatter, body } = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
          if (typeof frontmatter["name"] !== "string" || typeof frontmatter["description"] !== "string") {
            throw new ArchiveValidationError({
              message: "Standalone markdown imports require frontmatter with 'name' and 'description'.",
            });
          }

          const warnings: string[] = [];
          ensureRelativeReferenceWarnings(body, warnings);
          textWarningsForSkill(temp.skillRoot, body, warnings);
          scanSecurityWarnings(temp.skillRoot, warnings);

          const compiled = compileSkillDirectory(temp.skillRoot).package;
          const checksum = sha256ForFile(filePath);
          const existing = await lookupExistingPackage(compiled.id);
          const conflicts = getPackageConflict(existing, checksum);

          return {
            inspection: makeInspection(
              compiled,
              originalFilename,
              checksum,
              warnings,
              conflicts,
              metadataSourcesForSkill(temp.skillRoot),
              temp.skillRoot,
            ),
            compiledPackage: compiled,
            skillRoot: temp.skillRoot,
            tempRoot: temp.tempRoot,
          };
        } catch (error) {
          cleanupPath(temp.tempRoot);
          throw error;
        }
      };

      const inspectArchiveInternal = async (
        archivePath: string,
        originalFilename: string,
      ): Promise<InternalInspection> => {
        const extracted = await extractArchiveToTemp(archivePath, maxArchiveBytes);
        try {
          const rootInfo = detectSkillRoot(extracted.tempRoot);
          const skillMdPath = path.join(rootInfo.skillRoot, "SKILL.md");
          ensureSkillFrontmatter(skillMdPath, rootInfo.flat);
          const warnings = [...extracted.warnings, ...stripArtifacts(rootInfo.skillRoot)];
          const { body } = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"));
          textWarningsForSkill(rootInfo.skillRoot, body, warnings);
          scanSecurityWarnings(rootInfo.skillRoot, warnings);

          const compiled = compileSkillDirectory(rootInfo.skillRoot).package;
          const checksum = sha256ForFile(archivePath);
          const existing = await lookupExistingPackage(compiled.id);
          const conflicts = getPackageConflict(existing, checksum);
          const metadataSources = metadataSourcesForSkill(rootInfo.skillRoot);

          const skillDirName = path.basename(rootInfo.skillRoot);
          const frontmatterName = parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8")).frontmatter["name"];
          if (typeof frontmatterName === "string" && frontmatterName !== skillDirName) {
            warnings.push(
              `Package id derived from frontmatter name '${frontmatterName}' but archive directory is named '${skillDirName}'.`,
            );
          }

          return {
            inspection: makeInspection(
              compiled,
              originalFilename,
              checksum,
              stripTempRoots(warnings, extracted.tempRoot),
              conflicts,
              metadataSources,
              rootInfo.skillRoot,
            ),
            compiledPackage: compiled,
            skillRoot: rootInfo.skillRoot,
            tempRoot: extracted.tempRoot,
          };
        } catch (error) {
          cleanupPath(extracted.tempRoot);
          throw error;
        }
      };

      const importer: SkillImporterService = {
    inspectMarkdownFile: (filePath, originalFilename) =>
      Effect.tryPromise({
        try: async () => {
          const inspection = await inspectMarkdownFileInternal(filePath, originalFilename);
          cleanupPath(inspection.tempRoot);
          return inspection.inspection;
        },
        catch: (cause) =>
          cause instanceof ArchiveValidationError
            ? cause
            : new ArchiveValidationError({ message: cause instanceof Error ? cause.message : String(cause) }),
      }),

    inspectArchive: (archivePath, originalFilename) =>
      Effect.tryPromise({
        try: async () => {
          const inspection = await inspectArchiveInternal(archivePath, originalFilename);
          cleanupPath(inspection.tempRoot);
          return inspection.inspection;
        },
        catch: (cause) =>
          cause instanceof ArchiveValidationError
            ? cause
            : new ArchiveValidationError({ message: cause instanceof Error ? cause.message : String(cause) }),
      }),

    importFile: (filePath, originalFilename, options) =>
      Effect.tryPromise({
        try: async () => {
          const extension = path.extname(originalFilename).toLowerCase();
          const inspected =
            extension === ".md"
              ? await inspectMarkdownFileInternal(filePath, originalFilename)
              : await inspectArchiveInternal(filePath, originalFilename);

          try {
            const blockingConflict = inspected.inspection.conflicts.find((conflict) => conflict.resolution === "blocked");
            if (blockingConflict) {
              throw new ImportConflictError({
                packageId: blockingConflict.packageId,
                reason: blockingConflict.reason,
              });
            }

            const replaceableConflict = inspected.inspection.conflicts.find((conflict) => conflict.resolution === "replaceable");
            if (replaceableConflict && !options?.force && replaceableConflict.reason !== "Same checksum already imported.") {
              throw new ImportConflictError({
                packageId: replaceableConflict.packageId,
                reason: replaceableConflict.reason,
              });
            }

            const managedRoot = path.join(config.importsDir, inspected.compiledPackage.id, inspected.compiledPackage.version);
            const existing = await lookupExistingPackage(inspected.compiledPackage.id);
            if (existing?.source?.type === "imported_archive" && existing.source.checksum === inspected.inspection.checksum) {
              cleanupPath(inspected.tempRoot);
              return {
                package: existing,
                extractedAssets: relativeAssetPaths(existing.source.path ?? managedRoot, existing),
                replaced: false,
                warnings: [...inspected.inspection.warnings, "Same checksum already imported."],
              } satisfies ImportResult;
            }

            cleanupPath(managedRoot);
            copyDirectoryContents(inspected.skillRoot, managedRoot);

            const importedAt = new Date().toISOString();
            const nextPackage = rewritePackagePaths(inspected.compiledPackage, inspected.skillRoot, managedRoot);
            const packageToPersist: CapabilityPackage = {
              ...nextPackage,
              source: {
                ...nextPackage.source,
                type: "imported_archive",
                archiveName: originalFilename,
                importedAt,
                checksum: inspected.inspection.checksum,
                importMode: "upload",
              },
            };

            const persisted = await Effect.runPromise(registry.upsertPackage(packageToPersist));

            cleanupPath(inspected.tempRoot);
            return {
              package: persisted,
              extractedAssets: relativeAssetPaths(managedRoot, persisted),
              replaced: Boolean(existing),
              warnings: inspected.inspection.warnings,
            } satisfies ImportResult;
          } catch (error) {
            cleanupPath(inspected.tempRoot);
            throw error;
          }
        },
        catch: (cause) => {
          if (
            cause instanceof ArchiveValidationError ||
            cause instanceof ImportConflictError
          ) {
            return cause;
          }
          const tag = typeof cause === "object" && cause !== null && "_tag" in cause ? String((cause as { _tag: string })._tag) : "";
          if (tag === "CapabilityRegistryIOError") {
            return cause as CapabilityRegistryIOError;
          }
          return new ArchiveValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
          });
        },
      }),
      };

      return SkillImporter.of(importer);
    }),
  );
}
