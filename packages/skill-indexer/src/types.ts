import { Context, Effect } from "effect";
import type { CapabilityPackage } from "@shuvdex/capability-registry";

export interface CompiledSkillArtifact {
  readonly skillName: string;
  readonly package: CapabilityPackage;
  readonly sourcePath: string;
  readonly warnings: ReadonlyArray<string>;
}

export interface SkillIndexFailure {
  readonly skillName: string;
  readonly sourcePath: string;
  readonly message: string;
}

export interface IndexSkillsResult {
  readonly artifacts: ReadonlyArray<CompiledSkillArtifact>;
  readonly failures: ReadonlyArray<SkillIndexFailure>;
}

export interface SkillIndexerService {
  readonly compileSkillDirectory: (
    skillPath: string,
  ) => Effect.Effect<CompiledSkillArtifact, Error>;
  readonly indexRepository: (
    repoPath: string,
  ) => Effect.Effect<IndexSkillsResult, never>;
}

export class SkillIndexer extends Context.Tag("SkillIndexer")<
  SkillIndexer,
  SkillIndexerService
>() {}
