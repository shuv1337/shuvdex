import { parse as yamlParse } from "yaml";

export interface ParsedFrontmatter {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown };
  }

  const closingFenceIndex = normalized.indexOf("\n---\n", 4);
  if (closingFenceIndex === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const rawFrontmatter = normalized.slice(4, closingFenceIndex);
  const body = normalized.slice(closingFenceIndex + 5);
  const parsed = yamlParse(rawFrontmatter);

  return {
    frontmatter:
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    body,
  };
}
