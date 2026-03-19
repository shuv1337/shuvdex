import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { SkillIndexer } from "./types.js";
import type {
  CompiledSkillArtifact,
  IndexSkillsResult,
  SkillIndexFailure,
} from "./types.js";
import { compileSkillDirectory } from "./compiler.js";

export const SkillIndexerLive: Layer.Layer<SkillIndexer> = Layer.succeed(
  SkillIndexer,
  SkillIndexer.of({
    compileSkillDirectory: (skillPath) =>
      Effect.try({
        try: () => compileSkillDirectory(skillPath),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    indexRepository: (repoPath) =>
      Effect.sync(() => {
        const artifacts: CompiledSkillArtifact[] = [];
        const failures: SkillIndexFailure[] = [];
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(repoPath, { withFileTypes: true });
        } catch {
          return { artifacts, failures } satisfies IndexSkillsResult;
        }

        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
            continue;
          }
          const skillPath = path.join(repoPath, entry.name);
          if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
            continue;
          }
          try {
            artifacts.push(compileSkillDirectory(skillPath));
          } catch (cause) {
            failures.push({
              skillName: entry.name,
              sourcePath: skillPath,
              message: cause instanceof Error ? cause.message : String(cause),
            });
          }
        }

        return { artifacts, failures } satisfies IndexSkillsResult;
      }),
  }),
);
