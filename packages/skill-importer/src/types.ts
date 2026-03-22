import { Context, Effect } from "effect";
import type {
  CapabilityKindType,
  CapabilityPackage,
  CapabilityRegistryIOError,
} from "@shuvdex/capability-registry";
import type { ArchiveValidationError, ImportConflictError } from "./errors.js";

export interface ArchiveInspection {
  readonly packageId: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  readonly capabilities: ReadonlyArray<{ id: string; kind: CapabilityKindType; title: string }>;
  readonly assets: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly conflicts: ReadonlyArray<ImportConflict>;
  readonly checksum: string;
  readonly originalFilename: string;
  readonly annotations: Readonly<Record<string, unknown>>;
  readonly metadataSources: {
    readonly packageId: string;
    readonly version: string;
    readonly description: string;
  };
}

export interface ImportConflict {
  readonly packageId: string;
  readonly existingSourceType: string;
  readonly resolution: "replaceable" | "blocked";
  readonly reason: string;
}

export interface ImportResult {
  readonly package: CapabilityPackage;
  readonly extractedAssets: ReadonlyArray<string>;
  readonly replaced: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export interface SkillImporterService {
  readonly inspectMarkdownFile: (
    filePath: string,
    originalFilename: string,
  ) => Effect.Effect<ArchiveInspection, ArchiveValidationError>;

  readonly inspectArchive: (
    archivePath: string,
    originalFilename: string,
  ) => Effect.Effect<ArchiveInspection, ArchiveValidationError>;

  readonly importFile: (
    filePath: string,
    originalFilename: string,
    options?: { force?: boolean },
  ) => Effect.Effect<
    ImportResult,
    ArchiveValidationError | ImportConflictError | CapabilityRegistryIOError
  >;
}

export class SkillImporter extends Context.Tag("SkillImporter")<
  SkillImporter,
  SkillImporterService
>() {}
