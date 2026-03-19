/**
 * API client for the codex-fleet REST API.
 */

const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ??
  "http://localhost:3847";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? res.statusText,
      body,
    );
  }
  return res.json() as Promise<T>;
}

async function uploadApi<T>(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<T> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields ?? {})) {
    form.set(key, value);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? res.statusText,
      body,
    );
  }
  return res.json() as Promise<T>;
}

export type ToolParamType = "string" | "number" | "boolean" | "array" | "object";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  optional: boolean;
}

export interface ToolSchema {
  params: ToolParam[];
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  builtIn: boolean;
  provenance?: "local" | "imported_archive";
  schema: ToolSchema;
}

export interface ImportConflict {
  packageId: string;
  existingSourceType: string;
  resolution: "replaceable" | "blocked";
  reason: string;
}

export interface ArchiveInspection {
  packageId: string;
  version: string;
  title: string;
  summary: string;
  capabilities: Array<{ id: string; kind: string; title: string }>;
  assets: string[];
  warnings: string[];
  conflicts: ImportConflict[];
  checksum: string;
  originalFilename: string;
  annotations: Record<string, unknown>;
  metadataSources: {
    packageId: string;
    version: string;
    description: string;
  };
}

export interface ImportResult {
  package: {
    id: string;
    version: string;
    title: string;
  };
  extractedAssets: string[];
  replaced: boolean;
  warnings: string[];
}

export async function fetchTools(): Promise<Tool[]> {
  return api<Tool[]>("/api/tools");
}

export async function createTool(tool: Omit<Tool, "id" | "builtIn">): Promise<Tool> {
  return api<Tool>("/api/tools", {
    method: "POST",
    body: JSON.stringify(tool),
  });
}

export async function updateTool(
  id: string,
  tool: Partial<Omit<Tool, "id" | "builtIn">>,
): Promise<Tool> {
  return api<Tool>(`/api/tools/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(tool),
  });
}

export async function deleteTool(id: string): Promise<void> {
  await api<void>(`/api/tools/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function setToolEnabled(id: string, enabled: boolean): Promise<Tool> {
  return api<Tool>(`/api/tools/${encodeURIComponent(id)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export async function inspectSkillFile(file: File): Promise<ArchiveInspection> {
  return uploadApi<ArchiveInspection>("/api/packages/import/inspect", file);
}

export async function importSkillFile(file: File, force = false): Promise<ImportResult> {
  return uploadApi<ImportResult>("/api/packages/import", file, {
    ...(force ? { force: "true" } : {}),
  });
}
