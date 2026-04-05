#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { compileSkillDirectory } from "../packages/skill-indexer/dist/compiler.js";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const skillPath = path.resolve(
  process.argv[3] ?? path.join(repoRoot, "examples", "model-usage-skill"),
);
const packagesDir = path.resolve(
  process.argv[4] ?? path.join(repoRoot, ".capabilities", "packages"),
);

if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
  console.error(`SKILL.md not found at ${skillPath}`);
  process.exit(1);
}

const compiled = compileSkillDirectory(skillPath).package;
const now = new Date().toISOString();
const pkg = {
  ...compiled,
  createdAt: compiled.createdAt ?? now,
  updatedAt: now,
};

fs.mkdirSync(packagesDir, { recursive: true });
const outPath = path.join(packagesDir, `${pkg.id}.yaml`);
fs.writeFileSync(outPath, yamlStringify(pkg), "utf-8");

console.log(
  JSON.stringify(
    {
      repoRoot,
      skillPath,
      packagesDir,
      outPath,
      packageId: pkg.id,
      capabilityCount: pkg.capabilities.length,
    },
    null,
    2,
  ),
);
