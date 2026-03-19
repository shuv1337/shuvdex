import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { SkillIndexer, SkillIndexerLive } from "../src/index.js";

describe("SkillIndexer", () => {
  it("compiles markdown-only skills into packages", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-indexer-test-"));
    const skillDir = path.join(root, "example-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "# Example Skill\n\nUse this skill to do something helpful.\n",
      "utf-8",
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const indexer = yield* SkillIndexer;
        return yield* indexer.indexRepository(root);
      }).pipe(Effect.provide(SkillIndexerLive)),
    );

    expect(result.failures).toHaveLength(0);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.package.capabilities.map((item) => item.kind)).toEqual([
      "resource",
      "resource",
      "prompt",
    ]);
  });
});
