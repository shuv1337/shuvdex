import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import {
  compileSkillDirectory,
  parseFrontmatter,
  SkillIndexer,
  SkillIndexerLive,
} from "../src/index.js";

describe("SkillIndexer", () => {
  it("parses frontmatter and returns the stripped body", () => {
    const parsed = parseFrontmatter(`---\nname: sample\ndescription: test\n---\n# Title\n\nBody\n`);

    expect(parsed.frontmatter).toMatchObject({
      name: "sample",
      description: "test",
    });
    expect(parsed.body).toBe("# Title\n\nBody\n");
  });

  it("compiles frontmatter-driven skills with per-file resources and prompts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-indexer-compile-"));
    const skillDir = path.join(root, "example-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.mkdirSync(path.join(skillDir, "references"));
    fs.mkdirSync(path.join(skillDir, "prompts"));
    fs.mkdirSync(path.join(skillDir, "templates"));

    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: example-skill",
        "description: Use for verifying skill imports.",
        "compatibility: test-only",
        "---",
        "# Example Skill",
        "",
        "Use this skill to verify the compiler.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(skillDir, "references", "guide.md"),
      "---\ndescription: Reference guide\n---\n# Guide\n\nReference body.\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(skillDir, "prompts", "review.md"),
      "---\ndescription: Prompt review context\n---\nReview ./../references/guide.md before answering.\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(skillDir, "templates", "layout.html"),
      "<html><body>template</body></html>",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(skillDir, "package.json"),
      JSON.stringify({
        version: "2.3.4",
        license: "MIT",
        keywords: ["pi-package"],
        pi: { prompts: ["./prompts"] },
      }),
      "utf-8",
    );

    const compiled = compileSkillDirectory(skillDir);

    expect(compiled.package.id).toBe("skill.example_skill");
    expect(compiled.package.version).toBe("2.3.4");
    expect(compiled.package.description).toBe("Use for verifying skill imports.");
    expect(compiled.package.annotations).toMatchObject({
      "frontmatter.compatibility": "test-only",
      "package.license": "MIT",
      "package.keywords": ["pi-package"],
    });

    const instructions = compiled.package.capabilities.find((cap) => cap.id.endsWith(".instructions"));
    expect(instructions?.resource?.contents).not.toContain("compatibility:");

    const guide = compiled.package.capabilities.find((cap) => cap.resource?.uri.endsWith("/references/guide.md"));
    expect(guide?.kind).toBe("resource");
    expect(guide?.resource?.contents).toContain("Reference body.");

    const prompt = compiled.package.capabilities.find((cap) => cap.id.endsWith("prompts_review.prompt"));
    expect(prompt?.kind).toBe("prompt");
    expect(prompt?.prompt?.attachedResourceIds).toContain(instructions?.id);

    const template = compiled.package.capabilities.find((cap) => cap.resource?.uri.endsWith("/templates/layout.html"));
    expect(template?.resource?.mimeType).toBe("text/html");
    expect(template?.resource?.contents).toContain("template");
  });

  it("compiles markdown-only skills into packages through the service", async () => {
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
