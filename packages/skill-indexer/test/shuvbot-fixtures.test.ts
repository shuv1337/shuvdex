import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { compileSkillDirectory } from "../src/index.js";

const SKILLS_ROOT = "/home/shuv/repos/shuvbot-skills";

const fixtures = [
  {
    name: "visual-explainer",
    packageId: "skill.visual_explainer",
    counts: { resource: 13, prompt: 9 },
  },
  {
    name: "dogfood",
    packageId: "skill.dogfood",
    counts: { resource: 4, prompt: 1 },
  },
  {
    name: "network-monitor",
    packageId: "skill.network_monitor",
    counts: { resource: 8, prompt: 1 },
  },
  {
    name: "openclaw-manager",
    packageId: "skill.openclaw_manager",
    counts: { resource: 5, prompt: 1 },
  },
  {
    name: "brave-search",
    packageId: "skill.brave_search",
    counts: { resource: 3, prompt: 1, tool: 2 },
  },
  {
    name: "youtube-transcript",
    packageId: "skill.youtube_transcript",
    counts: { resource: 3, prompt: 1, tool: 1 },
  },
  {
    name: "make-api",
    packageId: "skill.make_api",
    counts: { resource: 2, prompt: 1 },
  },
  {
    name: "discord",
    packageId: "skill.discord",
    counts: { resource: 2, prompt: 1 },
  },
] as const;

describe("shuvbot canonical fixtures", () => {
  for (const fixture of fixtures) {
    it(`compiles ${fixture.name} with expected capability counts`, () => {
      const compiled = compileSkillDirectory(path.join(SKILLS_ROOT, fixture.name));
      expect(compiled.package.id).toBe(fixture.packageId);
      const counts = compiled.package.capabilities.reduce<Record<string, number>>((acc, capability) => {
        acc[capability.kind] = (acc[capability.kind] || 0) + 1;
        return acc;
      }, {});
      expect(counts).toMatchObject(fixture.counts);
    });
  }

  it("keeps brave-search module runtime targets absolute after manifest resolution", () => {
    const compiled = compileSkillDirectory(path.join(SKILLS_ROOT, "brave-search"));
    const toolCapabilities = compiled.package.capabilities.filter((capability) => capability.kind === "tool");
    expect(toolCapabilities).toHaveLength(2);
    for (const capability of toolCapabilities) {
      expect(capability.executorRef?.executorType).toBe("module_runtime");
      expect(capability.executorRef?.target).toMatch(/\/home\/shuv\/repos\/shuvbot-skills\/brave-search\//);
    }
  });
});
