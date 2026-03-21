#!/usr/bin/env node
import { compileSkillDirectory } from "../packages/skill-indexer/dist/compiler.js";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = process.cwd();
const skillsRoot = path.resolve(process.env.SKILLS_ROOT ?? "/home/shuv/repos/shuvbot-skills");
const outputPath = path.resolve(process.env.OUTPUT_PATH ?? path.join(repoRoot, "skills-matrix.json"));

const canonical = [
  "visual-explainer",
  "browser",
  "dogfood",
  "network-monitor",
  "openclaw-manager",
  "brave-search",
  "youtube-transcript",
  "make-api",
  "discord",
];

const phaseMap = new Map([
  ["visual-explainer", { phase: 1, labels: ["current-fit", "tool-first"] }],
  ["browser", { phase: 1, labels: ["current-fit"] }],
  ["dogfood", { phase: 1, labels: ["current-fit"] }],
  ["dogfood-tui", { phase: 1, labels: ["current-fit"] }],
  ["network-monitor", { phase: 1, labels: ["current-fit", "tool-first"] }],
  ["openclaw-manager", { phase: 1, labels: ["current-fit", "tool-first"] }],
  ["clarify", { phase: 1, labels: ["current-fit"] }],
  ["brave-search", { phase: 2, labels: ["tool-first"] }],
  ["youtube-transcript", { phase: 2, labels: ["tool-first"] }],
  ["upload", { phase: 2, labels: ["tool-first"] }],
  ["crawl", { phase: 2, labels: ["tool-first"] }],
  ["model-usage", { phase: 2, labels: ["tool-first"] }],
  ["ccusage", { phase: 2, labels: ["tool-first"] }],
  ["make-api", { phase: 3, labels: ["tool-first"] }],
  ["jules-api", { phase: 3, labels: ["tool-first"] }],
  ["jotform", { phase: 3, labels: ["tool-first"] }],
  ["unifi-api", { phase: 3, labels: ["tool-first"] }],
  ["uptime-robot", { phase: 3, labels: ["tool-first"] }],
  ["discord", { phase: 4, labels: ["tool-first", "later-risky"] }],
  ["signal-cli", { phase: 4, labels: ["later-risky"] }],
  ["slack-dev", { phase: 4, labels: ["tool-first", "later-risky"] }],
  ["home-assistant", { phase: 4, labels: ["later-risky"] }],
  ["cloudflare-global", { phase: 4, labels: ["tool-first", "later-risky"] }],
  ["addigy", { phase: 4, labels: ["later-risky"] }],
]);

function hasDir(skillPath, name) {
  const dirPath = path.join(skillPath, name);
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function fileFlags(skillPath) {
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 2) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  };
  walk(skillPath, 0);
  return {
    hasPackageJson: files.some((file) => file.endsWith("package.json")),
    hasPython: files.some((file) => file.endsWith(".py")),
    hasShell: files.some((file) => file.endsWith(".sh")),
    hasPackedSkill: files.some((file) => file.endsWith(".skill")),
    hasCapabilityYaml: files.some((file) => /capability\.ya?ml$/.test(file)),
    fileCount: files.length,
  };
}

function classifyCounts(capabilities) {
  return capabilities.reduce((acc, capability) => {
    acc[capability.kind] = (acc[capability.kind] || 0) + 1;
    return acc;
  }, {});
}

const directories = fs.readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(skillsRoot, name, "SKILL.md")))
  .sort();

const rows = directories.map((skill) => {
  const skillPath = path.join(skillsRoot, skill);
  const compiled = compileSkillDirectory(skillPath);
  const phaseInfo = phaseMap.get(skill) ?? { phase: null, labels: [] };
  return {
    skill,
    path: skillPath,
    packageId: compiled.package.id,
    version: compiled.package.version,
    labels: phaseInfo.labels,
    rolloutPhase: phaseInfo.phase,
    canonical: canonical.includes(skill),
    counts: classifyCounts(compiled.package.capabilities),
    warnings: [...compiled.warnings],
    assets: compiled.package.assets?.length ?? 0,
    structure: {
      hasPrompts: hasDir(skillPath, "prompts"),
      hasReferences: hasDir(skillPath, "references"),
      hasTemplates: hasDir(skillPath, "templates"),
      hasExamples: hasDir(skillPath, "examples"),
      ...fileFlags(skillPath),
    },
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  skillsRoot,
  canonical,
  totalSkills: rows.length,
  rows,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
process.stdout.write(`${outputPath}\n`);
