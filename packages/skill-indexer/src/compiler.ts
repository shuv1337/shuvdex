import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  CapabilityDefinitionType,
  CapabilityPackageType,
} from "@shuvdex/capability-registry";
import { parseFrontmatter } from "./frontmatter.js";
import type { CompiledSkillArtifact } from "./types.js";

interface ManifestShape {
  id?: string;
  title?: string;
  description?: string;
  version?: string;
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

interface PackageJsonShape {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  keywords?: string[];
  pi?: {
    prompts?: string[];
    skills?: string[];
  };
}

interface MarkdownFileContent {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly raw: string;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const pathSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function extractSummary(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstParagraph = lines.find((line) => !line.startsWith("#"));
  return firstParagraph ?? "No summary available.";
}

function extractTitle(fallback: string, markdown: string): string {
  const heading = markdown
    .split("\n")
    .find((line) => line.trim().startsWith("# "));
  return heading?.replace(/^#\s+/, "").trim() || fallback;
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function collectFiles(root: string): string[] {
  const results: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        results.push(absolute);
      }
    }
  };

  walk(root);
  return results.sort();
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function mimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".html":
      return "text/html";
    case ".json":
      return "application/json";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".ts":
      return "text/typescript";
    case ".py":
      return "text/x-python";
    case ".css":
      return "text/css";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function readMarkdownFile(filePath: string): MarkdownFileContent {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(raw);
  return { ...parsed, raw };
}

function readPackageJson(skillPath: string): PackageJsonShape | undefined {
  const raw = readOptionalFile(path.join(skillPath, "package.json"));
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as PackageJsonShape;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAnnotationValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAnnotationValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeAnnotationValue(item),
      ]),
    );
  }
  return String(value);
}

function toAnnotations(
  frontmatter: Record<string, unknown>,
  packageJson: PackageJsonShape | undefined,
): CapabilityPackageType["annotations"] {
  const entries: Array<[string, unknown]> = Object.entries(frontmatter)
    .filter(([key]) => key !== "name" && key !== "description")
    .map(([key, value]) => [`frontmatter.${key}`, normalizeAnnotationValue(value)] as const);

  if (packageJson?.license) {
    entries.push(["package.license", packageJson.license]);
  }
  if (packageJson?.keywords) {
    entries.push(["package.keywords", normalizeAnnotationValue(packageJson.keywords)]);
  }

  return entries.length > 0
    ? (Object.fromEntries(entries) as NonNullable<CapabilityPackageType["annotations"]>)
    : undefined;
}

function findRelativeResourceIds(
  content: string,
  fileDir: string,
  resourceIdByPath: Map<string, string>,
): string[] {
  const ids = new Set<string>();
  const regex = /\.\.?\/[A-Za-z0-9._/-]+/g;
  for (const match of content.match(regex) ?? []) {
    const normalized = path
      .normalize(path.join(fileDir, match))
      .split(path.sep)
      .join("/");
    const resourceId = resourceIdByPath.get(normalized);
    if (resourceId) {
      ids.add(resourceId);
    }
  }
  return [...ids];
}

function resolveCapabilityPaths(
  capability: CapabilityDefinitionType,
  skillPath: string,
): CapabilityDefinitionType {
  const resolveIfRelative = (value: string | undefined): string | undefined => {
    if (!value) return value;
    return path.isAbsolute(value) ? value : path.resolve(skillPath, value);
  };

  return {
    ...capability,
    sourceRef: resolveIfRelative(capability.sourceRef),
    executorRef: capability.executorRef
      ? {
          ...capability.executorRef,
          target: resolveIfRelative(capability.executorRef.target),
        }
      : capability.executorRef,
  };
}

export function compileSkillDirectory(skillPath: string): CompiledSkillArtifact {
  const inferredSkillName = path.basename(skillPath);
  const skillMdPath = path.join(skillPath, "SKILL.md");
  const manifestRaw =
    readOptionalFile(path.join(skillPath, "capability.yaml")) ??
    readOptionalFile(path.join(skillPath, "capability.yml"));
  const manifest = manifestRaw ? (yamlParse(manifestRaw) as ManifestShape) : undefined;
  const packageJson = readPackageJson(skillPath);
  const skillDoc = readMarkdownFile(skillMdPath);

  const skillName =
    asString(skillDoc.frontmatter["name"]) ??
    asString(packageJson?.name) ??
    inferredSkillName;
  const title =
    asString(manifest?.title) ??
    extractTitle(skillName, skillDoc.body);
  const summary =
    asString(manifest?.description) ??
    asString(skillDoc.frontmatter["description"]) ??
    asString(packageJson?.description) ??
    extractSummary(skillDoc.body);
  const packageId =
    asString(manifest?.id) ??
    (asString(skillDoc.frontmatter["name"]) ? `skill.${slugify(asString(skillDoc.frontmatter["name"])!)}` : undefined) ??
    (asString(packageJson?.name) ? `skill.${slugify(asString(packageJson?.name)!)}` : undefined) ??
    `skill.${slugify(inferredSkillName)}`;
  const version =
    asString(packageJson?.version) ??
    asString(manifest?.version) ??
    buildVersion(skillDoc.raw, manifestRaw ?? "", packageId);
  const annotations = toAnnotations(skillDoc.frontmatter, packageJson);
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
        contents: skillDoc.body,
      },
      sourceRef: skillMdPath,
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

  const resourceIdByPath = new Map<string, string>();
  const promptFiles = new Set<string>();
  const promptDirectories = new Set<string>();

  for (const promptDir of packageJson?.pi?.prompts ?? []) {
    const absolute = path.resolve(skillPath, promptDir);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      promptDirectories.add(absolute);
    }
  }
  const defaultPromptsDir = path.join(skillPath, "prompts");
  if (fs.existsSync(defaultPromptsDir) && fs.statSync(defaultPromptsDir).isDirectory()) {
    promptDirectories.add(defaultPromptsDir);
  }

  const recognizedRoots = ["references", "templates", "examples"];
  const files = collectFiles(skillPath);

  for (const filePath of files) {
    if (filePath === skillMdPath) continue;

    const rel = relativePath(skillPath, filePath);
    const relDir = path.dirname(rel);
    const isPromptFile = [...promptDirectories].some((dir) =>
      filePath === dir || filePath.startsWith(`${dir}${path.sep}`),
    );
    const topLevel = rel.split("/")[0] ?? "";
    const isRecognized =
      isPromptFile ||
      recognizedRoots.includes(topLevel) ||
      rel === "LICENSE" ||
      rel === "package.json" ||
      rel.startsWith("assets/");

    if (!isRecognized) {
      continue;
    }

    const ext = path.extname(filePath).toLowerCase();
    const uri = `${resourceBase}/${rel}`;
    const fileTitle = `${title} ${rel}`;
    const capabilityIdBase = `${packageId}.${pathSlug(rel.replace(/\.[^.]+$/, ""))}`;

    if (ext === ".md") {
      const markdown = readMarkdownFile(filePath);
      const description = asString(markdown.frontmatter["description"]) ?? extractSummary(markdown.body);
      if (isPromptFile && asString(markdown.frontmatter["description"])) {
        promptFiles.add(filePath);
        capabilities.push({
          id: `${capabilityIdBase}.prompt`,
          packageId,
          version,
          kind: "prompt",
          title: extractTitle(rel, markdown.body),
          description,
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
                name: "input",
                description,
                required: false,
              },
            ],
            attachedResourceIds: [instructionsResourceId],
            toolAllowlist: manifest?.prompt?.toolAllowlist ?? [],
            preferredDisclosure: ["summary", "resource", "prompt"],
            messages: [
              {
                role: "user",
                content: markdown.body,
              },
            ],
          },
          sourceRef: filePath,
        });
      } else {
        const resourceId = `${capabilityIdBase}.resource`;
        resourceIdByPath.set(filePath.split(path.sep).join("/"), resourceId);
        capabilities.push({
          id: resourceId,
          packageId,
          version,
          kind: "resource",
          title: extractTitle(rel, markdown.body),
          description,
          enabled: true,
          visibility,
          tags,
          riskLevel: "low",
          subjectScopes: scopeDefaults,
          hostTags: manifest?.hostTags,
          clientTags: manifest?.clientTags,
          resource: {
            uri,
            mimeType: "text/markdown",
            summary: description,
            contents: markdown.body,
          },
          sourceRef: filePath,
        });
      }
      continue;
    }

    const resourceId = `${capabilityIdBase}.resource`;
    resourceIdByPath.set(filePath.split(path.sep).join("/"), resourceId);
    capabilities.push({
      id: resourceId,
      packageId,
      version,
      kind: "resource",
      title: fileTitle,
      description: `Resource for ${rel}.`,
      enabled: true,
      visibility,
      tags,
      riskLevel: "low",
      subjectScopes: scopeDefaults,
      hostTags: manifest?.hostTags,
      clientTags: manifest?.clientTags,
      resource: {
        uri,
        mimeType: mimeTypeForFile(filePath),
        summary: `Resource file ${rel}`,
        contents: mimeTypeForFile(filePath).startsWith("text/") ||
          mimeTypeForFile(filePath) === "application/json"
          ? fs.readFileSync(filePath, "utf-8")
          : undefined,
      },
      sourceRef: filePath,
    });
  }

  for (const [index, capability] of capabilities.entries()) {
    if (capability.kind !== "prompt" || capability.id === promptId || !capability.prompt) {
      continue;
    }
    const sourceRef = capability.sourceRef;
    if (!sourceRef || !promptFiles.has(sourceRef)) {
      continue;
    }
    const attached = findRelativeResourceIds(
      capability.prompt.messages?.[0]?.content ?? "",
      path.dirname(sourceRef),
      resourceIdByPath,
    );
    capabilities[index] = {
      ...capability,
      prompt: {
        ...capability.prompt,
        attachedResourceIds: [instructionsResourceId, ...attached],
      },
    };
  }

  for (const capability of manifest?.capabilities ?? []) {
    capabilities.push(
      resolveCapabilityPaths(
        {
          ...capability,
          packageId,
          version,
          enabled: capability.enabled ?? true,
          visibility: capability.visibility ?? visibility,
          hostTags: capability.hostTags ?? manifest?.hostTags,
          clientTags: capability.clientTags ?? manifest?.clientTags,
          subjectScopes: capability.subjectScopes ?? scopeDefaults,
        },
        skillPath,
      ),
    );
  }

  const pkg: CapabilityPackageType = {
    id: packageId,
    version,
    title,
    description: summary,
    builtIn: false,
    enabled: true,
    tags,
    source: {
      type: manifestRaw ? "manifest" : "skill",
      path: skillPath,
      skillName,
    },
    sourceRef: skillMdPath,
    annotations,
    capabilities,
    assets: files.filter((entry) => entry !== skillMdPath),
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
