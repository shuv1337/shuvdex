import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { parse as yamlParse } from "yaml";
import type {
  CapabilityDefinitionType,
  CapabilityPackageType,
} from "@codex-fleet/capability-registry";
import { SkillIndexer } from "./types.js";
import type {
  CompiledSkillArtifact,
  IndexSkillsResult,
  SkillIndexFailure,
} from "./types.js";

interface ManifestShape {
  id?: string;
  title?: string;
  description?: string;
  tags?: string[];
  subjectScopes?: string[];
  hostTags?: string[];
  clientTags?: string[];
  visibility?: "public" | "scoped" | "private";
  prompt?: {
    toolAllowlist?: string[];
  };
  capabilities?: CapabilityDefinitionType[];
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function extractSummary(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("---"));
  const firstParagraph = lines.find((line) => !line.startsWith("#"));
  return firstParagraph ?? "No summary available.";
}

function extractTitle(skillName: string, markdown: string): string {
  const heading = markdown
    .split("\n")
    .find((line) => line.trim().startsWith("# "));
  return heading?.replace(/^#\s+/, "").trim() || skillName;
}

function readOptionalFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function buildVersion(...parts: string[]): string {
  const hash = createHash("sha1");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest("hex").slice(0, 12);
}

function buildGeneratedCapabilities(
  packageId: string,
  version: string,
  skillName: string,
  title: string,
  summary: string,
  markdown: string,
  manifest: ManifestShape | undefined,
): CapabilityDefinitionType[] {
  const tags = ["skill", slugify(skillName), ...(manifest?.tags ?? [])];
  const visibility = manifest?.visibility ?? "scoped";
  const scopeDefaults = manifest?.subjectScopes ?? ["skill:read", "skill:apply", "admin"];
  const resourceBase = `skill://${slugify(skillName)}`;
  const summaryResourceId = `${packageId}.summary`;
  const instructionsResourceId = `${packageId}.instructions`;
  const promptId = `${packageId}.apply`;

  const capabilities: CapabilityDefinitionType[] = [
    {
      id: summaryResourceId,
      packageId,
      version,
      kind: "resource",
      title: `${title} Summary`,
      description: `Summary resource for ${title}.`,
      enabled: true,
      visibility,
      tags,
      riskLevel: "low",
      subjectScopes: scopeDefaults,
      hostTags: manifest?.hostTags,
      clientTags: manifest?.clientTags,
      resource: {
        uri: `${resourceBase}/summary`,
        mimeType: "text/markdown",
        summary,
        contents: `# ${title}\n\n${summary}\n`,
      },
    },
    {
      id: instructionsResourceId,
      packageId,
      version,
      kind: "resource",
      title: `${title} Instructions`,
      description: `Full skill instructions for ${title}.`,
      enabled: true,
      visibility,
      tags,
      riskLevel: "low",
      subjectScopes: scopeDefaults,
      hostTags: manifest?.hostTags,
      clientTags: manifest?.clientTags,
      resource: {
        uri: `${resourceBase}/instructions`,
        mimeType: "text/markdown",
        summary,
        contents: markdown,
      },
    },
    {
      id: promptId,
      packageId,
      version,
      kind: "prompt",
      title: `Apply ${title}`,
      description: `Prompt entrypoint for applying the ${title} skill.`,
      enabled: true,
      visibility,
      tags,
      riskLevel: "low",
      subjectScopes: manifest?.subjectScopes ?? ["skill:apply", "admin"],
      hostTags: manifest?.hostTags,
      clientTags: manifest?.clientTags,
      prompt: {
        arguments: [
          {
            name: "goal",
            description: "What the caller wants to accomplish with this skill.",
            required: false,
          },
        ],
        attachedResourceIds: [summaryResourceId, instructionsResourceId],
        toolAllowlist: manifest?.prompt?.toolAllowlist ?? [],
        preferredDisclosure: ["summary", "resource", "prompt"],
        messages: [
          {
            role: "user",
            content: `Apply the ${title} skill. Goal: {{goal}}`,
          },
          {
            role: "assistant",
            content: `Consult ${resourceBase}/summary first, then ${resourceBase}/instructions if more detail is needed.`,
          },
        ],
      },
    },
  ];

  for (const capability of manifest?.capabilities ?? []) {
    capabilities.push({
      ...capability,
      packageId,
      version,
      enabled: capability.enabled ?? true,
      visibility: capability.visibility ?? visibility,
      hostTags: capability.hostTags ?? manifest?.hostTags,
      clientTags: capability.clientTags ?? manifest?.clientTags,
      subjectScopes: capability.subjectScopes ?? scopeDefaults,
    });
  }

  return capabilities;
}

function compileSkillDirectory(skillPath: string): CompiledSkillArtifact {
  const skillName = path.basename(skillPath);
  const skillMdPath = path.join(skillPath, "SKILL.md");
  const markdown = fs.readFileSync(skillMdPath, "utf-8");
  const manifestRaw =
    readOptionalFile(path.join(skillPath, "capability.yaml")) ??
    readOptionalFile(path.join(skillPath, "capability.yml"));
  const manifest = manifestRaw ? (yamlParse(manifestRaw) as ManifestShape) : undefined;
  const title = manifest?.title ?? extractTitle(skillName, markdown);
  const summary = manifest?.description ?? extractSummary(markdown);
  const packageId = manifest?.id ?? `skill.${slugify(skillName)}`;
  const version = buildVersion(markdown, manifestRaw ?? "", packageId);
  const pkg: CapabilityPackageType = {
    id: packageId,
    version,
    title,
    description: summary,
    builtIn: false,
    enabled: true,
    tags: ["skill", slugify(skillName), ...(manifest?.tags ?? [])],
    source: {
      type: manifestRaw ? "manifest" : "skill",
      path: skillPath,
      skillName,
    },
    sourceRef: skillMdPath,
    capabilities: buildGeneratedCapabilities(
      packageId,
      version,
      skillName,
      title,
      summary,
      markdown,
      manifest,
    ),
    assets: fs
      .readdirSync(skillPath)
      .filter((entry) => entry !== "SKILL.md" && !entry.startsWith("capability.y"))
      .map((entry) => path.join(skillPath, entry)),
  };

  const warnings: string[] = [];
  if (!manifestRaw) {
    warnings.push("Compiled without capability manifest; using markdown-derived defaults.");
  }

  return {
    skillName,
    package: pkg,
    sourcePath: skillPath,
    warnings,
  };
}

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
