#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stringify as yamlStringify } from "yaml";
import { compileSkillDirectory } from "../packages/skill-indexer/dist/compiler.js";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const skillPath = path.resolve(process.argv[3] ?? path.join(repoRoot, "examples", "module-runtime-skill-template"));
const importsDir = path.resolve(process.argv[4] ?? path.join(repoRoot, ".capabilities", "imports"));
const packagesDir = path.resolve(process.argv[5] ?? path.join(repoRoot, ".capabilities", "packages"));

if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
  console.error(`SKILL.md not found at ${skillPath}`);
  process.exit(1);
}

const initial = compileSkillDirectory(skillPath).package;
const stagedRoot = path.join(importsDir, initial.id, initial.version);
fs.rmSync(stagedRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(stagedRoot), { recursive: true });
fs.cpSync(skillPath, stagedRoot, { recursive: true });

if (fs.existsSync(path.join(stagedRoot, "package.json"))) {
  execFileSync("npm", ["install", "--omit=dev"], { cwd: stagedRoot, stdio: "inherit" });
}

const compiled = compileSkillDirectory(stagedRoot).package;
const now = new Date().toISOString();
const pkg = {
  ...compiled,
  source: {
    ...(compiled.source ?? {}),
    type: "imported_archive",
    path: stagedRoot,
    importedAt: now,
    archiveName: `${path.basename(skillPath)}.zip`,
  },
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
      importsDir,
      packagesDir,
      stagedRoot,
      outPath,
      packageId: pkg.id,
      capabilityIds: pkg.capabilities.map((capability) => capability.id),
    },
    null,
    2,
  ),
);
