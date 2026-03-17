/**
 * API client for the codex-fleet REST API.
 * Talks to http://localhost:3847/api by default.
 */

const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ??
  "http://localhost:3847";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type HostStatus = "online" | "degraded" | "error";
export type ConnectionType = "ssh" | "local";
export type ToolParamType = "string" | "number" | "boolean" | "array" | "object";

export interface HostStatusRecord {
  name: string;
  hostname: string;
  status: HostStatus;
  head?: string;
  branch?: string;
  dirty?: boolean;
  error?: string;
  errors?: string[];
}

export interface HostConfig {
  name: string;
  hostname: string;
  connectionType: ConnectionType;
  port: number;
  user?: string;
  keyPath?: string;
  timeout: number;
}

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
  schema: ToolSchema;
}

export interface SkillActivation {
  skill: string;
  /** Map of hostname → activated */
  hosts: Record<string, boolean>;
}

export interface DriftReport {
  referenceHost: string;
  referenceHead: string;
  hosts: Array<{
    name: string;
    hostname: string;
    head: string;
    status: "in-sync" | "drifted" | "error";
    commitsBehind?: number;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Fleet status
// ---------------------------------------------------------------------------

export async function fetchFleetStatus(hosts?: string[]): Promise<HostStatusRecord[]> {
  const params = hosts && hosts.length > 0 ? `?hosts=${hosts.join(",")}` : "";
  const data = await api<{ hosts: HostStatusRecord[] }>(`/api/fleet/status${params}`);
  return data.hosts;
}

// ---------------------------------------------------------------------------
// Host management
// ---------------------------------------------------------------------------

export async function fetchHosts(): Promise<HostConfig[]> {
  return api<HostConfig[]>("/api/hosts");
}

export async function createHost(host: Omit<HostConfig, "name"> & { name: string }): Promise<HostConfig> {
  return api<HostConfig>("/api/hosts", {
    method: "POST",
    body: JSON.stringify(host),
  });
}

export async function updateHost(name: string, host: Partial<Omit<HostConfig, "name">>): Promise<HostConfig> {
  return api<HostConfig>(`/api/hosts/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify(host),
  });
}

export async function deleteHost(name: string): Promise<void> {
  await api<void>(`/api/hosts/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function pingHost(name: string): Promise<{ status: HostStatus; latencyMs?: number }> {
  return api(`/api/hosts/${encodeURIComponent(name)}/ping`);
}

// ---------------------------------------------------------------------------
// Tool management
// ---------------------------------------------------------------------------

export async function fetchTools(): Promise<Tool[]> {
  return api<Tool[]>("/api/tools");
}

export async function createTool(tool: Omit<Tool, "id" | "builtIn">): Promise<Tool> {
  return api<Tool>("/api/tools", {
    method: "POST",
    body: JSON.stringify(tool),
  });
}

export async function updateTool(id: string, tool: Partial<Omit<Tool, "id" | "builtIn">>): Promise<Tool> {
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

// ---------------------------------------------------------------------------
// Skill operations
// ---------------------------------------------------------------------------

export async function fetchSkills(): Promise<SkillActivation[]> {
  return api<SkillActivation[]>("/api/skills");
}

export async function activateSkill(skill: string, hosts?: string[]): Promise<void> {
  await api<void>("/api/skills/activate", {
    method: "POST",
    body: JSON.stringify({ skill, hosts }),
  });
}

export async function deactivateSkill(skill: string, hosts?: string[]): Promise<void> {
  await api<void>("/api/skills/deactivate", {
    method: "POST",
    body: JSON.stringify({ skill, hosts }),
  });
}

export async function syncSkills(hosts?: string[]): Promise<void> {
  await api<void>("/api/skills/sync", {
    method: "POST",
    body: JSON.stringify({ hosts }),
  });
}

export async function fetchDriftReport(referenceHost?: string): Promise<DriftReport> {
  const params = referenceHost ? `?referenceHost=${encodeURIComponent(referenceHost)}` : "";
  return api<DriftReport>(`/api/fleet/drift${params}`);
}

export async function pullAll(hosts?: string[]): Promise<void> {
  await api<void>("/api/fleet/pull", {
    method: "POST",
    body: JSON.stringify({ hosts }),
  });
}
