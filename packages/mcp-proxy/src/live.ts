/**
 * Live implementation of McpProxyService.
 *
 * Upstream registrations are persisted as JSON files under
 * `{rootDir}/upstreams/`.  Tool caches are stored alongside them under
 * `{rootDir}/tool-caches/`.
 *
 * Connections to upstream MCP servers are opened per-operation (no pooling in
 * Phase 2A) using the official @modelcontextprotocol/sdk Client.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CredentialStore } from "@shuvdex/credential-store";
import { withSpan, recordError } from "@shuvdex/telemetry";
import {
  McpProxy,
  type McpProxyService,
  type UpstreamRegistration,
  type UpstreamToolCache,
  type CachedUpstreamTool,
  type CapabilitySyncResult,
  type UpstreamHealthStatus,
  type TrustState,
} from "./types.js";
import { computeDescriptionHash, checkPin } from "./hashing.js";
import { classifyActionClass, classifyRiskLevel } from "./classifier.js";
import { scanForInjection } from "./scanner.js";

// ─── config ─────────────────────────────────────────────────────────────────

export interface McpProxyConfig {
  /** Base directory for persisted state (upstreams + tool caches) */
  readonly rootDir: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function upstreamDir(rootDir: string): string {
  return path.join(rootDir, "upstreams");
}

function cacheDir(rootDir: string): string {
  return path.join(rootDir, "tool-caches");
}

function upstreamPath(rootDir: string, upstreamId: string): string {
  return path.join(upstreamDir(rootDir), `${upstreamId}.json`);
}

function cachePath(rootDir: string, upstreamId: string): string {
  return path.join(cacheDir(rootDir), `${upstreamId}.json`);
}

function readUpstream(rootDir: string, upstreamId: string): UpstreamRegistration | null {
  const p = upstreamPath(rootDir, upstreamId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as UpstreamRegistration;
}

function writeUpstream(rootDir: string, reg: UpstreamRegistration): void {
  fs.mkdirSync(upstreamDir(rootDir), { recursive: true });
  fs.writeFileSync(upstreamPath(rootDir, reg.upstreamId), JSON.stringify(reg, null, 2), "utf-8");
}

function deleteUpstreamFile(rootDir: string, upstreamId: string): void {
  fs.rmSync(upstreamPath(rootDir, upstreamId), { force: true });
}

function readCache(rootDir: string, upstreamId: string): UpstreamToolCache | null {
  const p = cachePath(rootDir, upstreamId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as UpstreamToolCache;
}

function writeCache(rootDir: string, cache: UpstreamToolCache): void {
  fs.mkdirSync(cacheDir(rootDir), { recursive: true });
  fs.writeFileSync(cachePath(rootDir, cache.upstreamId), JSON.stringify(cache, null, 2), "utf-8");
}

function listUpstreamFiles(rootDir: string): UpstreamRegistration[] {
  const dir = upstreamDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as UpstreamRegistration];
      } catch {
        return [];
      }
    });
}

function cacheChecksum(tools: CachedUpstreamTool[]): string {
  const content = JSON.stringify(tools.map((t) => t.descriptionHash).sort());
  return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16);
}

// ─── transport factory ──────────────────────────────────────────────────────

interface ExtraHeaders {
  [key: string]: string;
}

function buildTransport(reg: UpstreamRegistration, extraHeaders?: ExtraHeaders): Transport {
  switch (reg.transport) {
    case "stdio": {
      return new StdioClientTransport({
        command: reg.endpoint,
        args: reg.args ? [...reg.args] : [],
        env: reg.env ? { ...reg.env } : undefined,
        stderr: "pipe",
      });
    }
    case "streamable-http": {
      const url = new URL(reg.endpoint);
      const requestInit: RequestInit = {};
      if (extraHeaders && Object.keys(extraHeaders).length > 0) {
        requestInit.headers = extraHeaders;
      }
      return new StreamableHTTPClientTransport(url, { requestInit });
    }
    case "sse": {
      const url = new URL(reg.endpoint);
      const requestInit: RequestInit = {};
      if (extraHeaders && Object.keys(extraHeaders).length > 0) {
        requestInit.headers = extraHeaders;
      }
      return new SSEClientTransport(url, { requestInit });
    }
  }
}

async function connectClient(transport: Transport): Promise<Client> {
  const client = new Client(
    { name: "shuvdex-mcp-proxy", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

// ─── Effect wrappers ────────────────────────────────────────────────────────

function readUpstreamEffect(
  rootDir: string,
  upstreamId: string,
): Effect.Effect<UpstreamRegistration> {
  return Effect.try({
    try: () => {
      const reg = readUpstream(rootDir, upstreamId);
      if (!reg) throw new Error(`Upstream not found: ${upstreamId}`);
      return reg;
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  }).pipe(Effect.orDie);
}

function writeUpstreamEffect(
  rootDir: string,
  reg: UpstreamRegistration,
): Effect.Effect<void> {
  return Effect.try({
    try: () => writeUpstream(rootDir, reg),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  }).pipe(Effect.orDie);
}

// ─── factory ────────────────────────────────────────────────────────────────

export function makeMcpProxyLive(config: McpProxyConfig): Layer.Layer<McpProxy, never, CredentialStore> {
  const { rootDir } = config;

  return Layer.effect(
    McpProxy,
    Effect.gen(function* () {
      const credentials = yield* CredentialStore;

      // Resolve auth headers for an upstream (returns empty object if no credentialId)
      const resolveHeaders = (reg: UpstreamRegistration): Effect.Effect<ExtraHeaders> =>
        reg.credentialId
          ? Effect.gen(function* () {
              const material = yield* Effect.tryPromise({
                try: () =>
                  Effect.runPromise(credentials.resolveAuthMaterial(reg.credentialId!)),
                catch: () => new Error(`Failed to resolve credential ${reg.credentialId}`),
              });
              return (material.headers ?? {}) as ExtraHeaders;
            }).pipe(
              Effect.catchAll(() => Effect.succeed({} as ExtraHeaders)),
            )
          : Effect.succeed({} as ExtraHeaders);

      const service: McpProxyService = {
        // ── registerUpstream ─────────────────────────────────────────────
        registerUpstream: (input) =>
          withSpan("mcp_proxy.register_upstream", {
            attributes: { upstreamId: input.upstreamId, transport: input.transport },
          })(
            Effect.gen(function* () {
              const now = new Date().toISOString();
              const reg: UpstreamRegistration = {
                ...input,
                trustState: "pending_review" as const,
                healthStatus: "unknown" as const,
                createdAt: now,
                updatedAt: now,
              };
              yield* writeUpstreamEffect(rootDir, reg);
              return reg;
            }).pipe(Effect.orDie),
          ),

        // ── listUpstreams ─────────────────────────────────────────────────
        listUpstreams: () =>
          Effect.try({
            try: () => listUpstreamFiles(rootDir),
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
          }).pipe(Effect.orDie),

        // ── getUpstream ───────────────────────────────────────────────────
        getUpstream: (upstreamId) => readUpstreamEffect(rootDir, upstreamId).pipe(Effect.orDie),

        // ── updateUpstream ────────────────────────────────────────────────
        updateUpstream: (upstreamId, patch) =>
          Effect.gen(function* () {
            const existing = readUpstream(rootDir, upstreamId);
            if (!existing) throw new Error(`Upstream not found: ${upstreamId}`);
            const updated: UpstreamRegistration = {
              ...existing,
              ...patch,
              upstreamId: existing.upstreamId,
              createdAt: existing.createdAt,
              updatedAt: new Date().toISOString(),
            };
            writeUpstream(rootDir, updated);
            return updated;
          }).pipe(Effect.orDie),

        // ── deleteUpstream ────────────────────────────────────────────────
        deleteUpstream: (upstreamId) =>
          Effect.gen(function* () {
            const existing = readUpstream(rootDir, upstreamId);
            if (!existing) throw new Error(`Upstream not found: ${upstreamId}`);
            deleteUpstreamFile(rootDir, upstreamId);
            fs.rmSync(cachePath(rootDir, upstreamId), { force: true });
          }).pipe(Effect.orDie),

        // ── syncUpstream ──────────────────────────────────────────────────
        syncUpstream: (upstreamId) =>
          withSpan("mcp_proxy.sync_upstream", { attributes: { upstreamId } })(
            Effect.gen(function* () {
              const reg = yield* readUpstreamEffect(rootDir, upstreamId);
              const extraHeaders = yield* resolveHeaders(reg);

              // Connect and list tools
              const freshTools: CachedUpstreamTool[] = yield* Effect.tryPromise({
                try: async () => {
                  const transport = buildTransport(reg, extraHeaders);
                  const client = await connectClient(transport);
                  try {
                    const result = await client.listTools();
                    return result.tools.map((tool) => {
                      const schemaObj =
                        (tool.inputSchema as Record<string, unknown>) ?? {};
                      const desc = tool.description ?? "";
                      const hash = computeDescriptionHash(tool.name, desc, schemaObj);
                      const actionClass =
                        reg.defaultActionClass ??
                        classifyActionClass(tool.name, desc);
                      const riskLevel =
                        reg.defaultRiskLevel ??
                        classifyRiskLevel(actionClass, tool.name, desc);

                      return {
                        name: tool.name,
                        namespacedName: `${reg.namespace}.${tool.name}`,
                        description: desc,
                        inputSchema: schemaObj,
                        descriptionHash: hash,
                        pinnedHash: undefined,
                        actionClass,
                        riskLevel,
                      } satisfies CachedUpstreamTool;
                    });
                  } finally {
                    await client.close();
                  }
                },
                catch: (e) => (e instanceof Error ? e : new Error(String(e))),
              });

              // Scan for injection patterns (log but don't block)
              for (const tool of freshTools) {
                const scanResult = scanForInjection(tool.description);
                if (!scanResult.safe) {
                  process.stderr.write(
                    JSON.stringify({
                      level: "warn",
                      event: "mcp_proxy.injection_scan_finding",
                      upstreamId,
                      toolName: tool.name,
                      findings: scanResult.findings,
                    }) + "\n",
                  );
                }
              }

              // Load previous cache for diff
              const previous = yield* Effect.try({
                try: () => readCache(rootDir, upstreamId),
                catch: () => null,
              });

              const previousByName = new Map<string, CachedUpstreamTool>(
                (previous?.tools ?? []).map((t) => [t.name, t]),
              );
              const freshByName = new Map<string, CachedUpstreamTool>(
                freshTools.map((t) => [t.name, t]),
              );

              const added: string[] = [];
              const removed: string[] = [];
              const changed: string[] = [];
              const unchanged: string[] = [];
              const mutatedTools: string[] = [];

              // Carry over pinned hashes and detect mutations
              const mergedTools: CachedUpstreamTool[] = freshTools.map((tool) => {
                const prev = previousByName.get(tool.name);
                if (!prev) {
                  added.push(tool.name);
                  return tool;
                }
                const pinCheck = checkPin({ ...tool, pinnedHash: prev.pinnedHash });
                if (!pinCheck.matched) {
                  mutatedTools.push(tool.name);
                }
                if (tool.descriptionHash !== prev.descriptionHash) {
                  changed.push(tool.name);
                } else {
                  unchanged.push(tool.name);
                }
                // Carry forward pinnedHash from previous cache
                return { ...tool, pinnedHash: prev.pinnedHash };
              });

              for (const prevName of previousByName.keys()) {
                if (!freshByName.has(prevName)) {
                  removed.push(prevName);
                }
              }

              const mutationDetected = mutatedTools.length > 0;

              // Update trust state if mutations found
              const newTrustState: TrustState = mutationDetected ? "suspended" : reg.trustState;
              const newHealthStatus: UpstreamHealthStatus = "healthy";

              const updatedReg: UpstreamRegistration = {
                ...reg,
                trustState: newTrustState,
                healthStatus: newHealthStatus,
                lastCapabilitySync: new Date().toISOString(),
                toolCount: mergedTools.length,
                updatedAt: new Date().toISOString(),
              };
              yield* writeUpstreamEffect(rootDir, updatedReg);

              // Write updated cache
              const cache: UpstreamToolCache = {
                upstreamId,
                tools: mergedTools,
                syncedAt: new Date().toISOString(),
                checksum: cacheChecksum(mergedTools),
              };
              yield* Effect.try({
                try: () => writeCache(rootDir, cache),
                catch: (e) => (e instanceof Error ? e : new Error(String(e))),
              });

              const result: CapabilitySyncResult = {
                upstreamId,
                added,
                removed,
                changed,
                unchanged,
                mutationDetected,
                mutatedTools,
              };
              return result;
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => {
                  process.stderr.write(
                    JSON.stringify({
                      level: "error",
                      event: "mcp_proxy.sync_failure",
                      upstreamId,
                      error: error instanceof Error ? error.message : String(error),
                    }) + "\n",
                  );
                  const existing = readUpstream(rootDir, upstreamId);
                  if (existing) {
                    writeUpstream(rootDir, {
                      ...existing,
                      healthStatus: "unhealthy",
                      updatedAt: new Date().toISOString(),
                    });
                  }
                }),
              ),
              Effect.orDie,
            ),
          ),

        // ── checkHealth ───────────────────────────────────────────────────
        checkHealth: (upstreamId) =>
          withSpan("mcp_proxy.check_health", { attributes: { upstreamId } })(
            Effect.gen(function* () {
              const reg = yield* readUpstreamEffect(rootDir, upstreamId);
              const extraHeaders = yield* resolveHeaders(reg);

              const healthResult = yield* Effect.tryPromise({
                try: async () => {
                  const start = Date.now();
                  const transport = buildTransport(reg, extraHeaders);
                  const client = await connectClient(transport);
                  try {
                    await client.listTools();
                    const elapsed = Date.now() - start;
                    return elapsed < 2_000 ? ("healthy" as const) : ("degraded" as const);
                  } finally {
                    await client.close();
                  }
                },
                catch: () => new Error("health check failed"),
              }).pipe(
                Effect.catchAll(() => Effect.succeed("unhealthy" as const)),
              );
              const status: UpstreamHealthStatus = healthResult;

              // Persist updated health
              try {
                const existing = readUpstream(rootDir, upstreamId);
                if (existing) {
                  writeUpstream(rootDir, {
                    ...existing,
                    healthStatus: status,
                    updatedAt: new Date().toISOString(),
                  });
                }
              } catch { /* best-effort persist */ }

              return status;
            }),
          ),

        // ── callUpstreamTool ──────────────────────────────────────────────
        callUpstreamTool: (upstreamId, toolName, args) =>
          withSpan("mcp_proxy.call_tool", {
            attributes: { upstreamId, toolName },
          })(
            Effect.gen(function* () {
              const reg = yield* readUpstreamEffect(rootDir, upstreamId);

              if (reg.trustState === "suspended") {
                return {
                  payload: {
                    error: `Upstream ${upstreamId} is suspended due to mutation detection`,
                    upstreamId,
                    toolName,
                  },
                  isError: true,
                };
              }

              const extraHeaders = yield* resolveHeaders(reg);

              const result = yield* Effect.tryPromise({
                try: async () => {
                  const transport = buildTransport(reg, extraHeaders);
                  const client = await connectClient(transport);
                  try {
                    const callResult = await client.callTool({ name: toolName, arguments: args });
                    const isError = callResult.isError === true;
                    return { payload: callResult, isError };
                  } finally {
                    await client.close();
                  }
                },
                catch: (e) => (e instanceof Error ? e : new Error(String(e))),
              }).pipe(
                Effect.tapError((error) =>
                  Effect.sync(() => {
                    process.stderr.write(
                      JSON.stringify({
                        level: "error",
                        event: "mcp_proxy.call_failure",
                        upstreamId,
                        toolName,
                        error: error.message,
                      }) + "\n",
                    );
                  }).pipe(Effect.zipRight(recordError(error))),
                ),
                Effect.catchAll((error) =>
                  Effect.succeed({
                    payload: {
                      error: error.message,
                      upstreamId,
                      toolName,
                    },
                    isError: true,
                  }),
                ),
              );

              return result;
            }),
          ),

        // ── getCachedTools ────────────────────────────────────────────────
        getCachedTools: (upstreamId) =>
          Effect.try({
            try: () => readCache(rootDir, upstreamId),
            catch: () => null as null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null))),

        // ── pinToolDescriptions ───────────────────────────────────────────
        pinToolDescriptions: (upstreamId, toolNames) =>
          Effect.gen(function* () {
            const cache = yield* Effect.try({
              try: () => readCache(rootDir, upstreamId),
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            });
            if (!cache) throw new Error(`No cache found for upstream ${upstreamId}`);

            const targets = new Set(toolNames); // empty set = pin all
            const updated: CachedUpstreamTool[] = cache.tools.map((tool) => {
              if (targets.size === 0 || targets.has(tool.name)) {
                return { ...tool, pinnedHash: tool.descriptionHash };
              }
              return tool;
            });

            yield* Effect.try({
              try: () =>
                writeCache(rootDir, {
                  ...cache,
                  tools: updated,
                  syncedAt: cache.syncedAt,
                }),
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            });
          }).pipe(Effect.orDie),

        // ── checkMutations ────────────────────────────────────────────────
        checkMutations: (upstreamId) =>
          Effect.gen(function* () {
            const cache = yield* Effect.try({
              try: () => readCache(rootDir, upstreamId),
              catch: (e) => (e instanceof Error ? e : new Error(String(e))),
            });
            if (!cache) {
              return { mutated: [] as CachedUpstreamTool[], clean: [] as CachedUpstreamTool[] };
            }

            const mutated: CachedUpstreamTool[] = [];
            const clean: CachedUpstreamTool[] = [];

            for (const tool of cache.tools) {
              const { matched } = checkPin(tool);
              if (matched) {
                clean.push(tool);
              } else {
                mutated.push(tool);
              }
            }

            return { mutated, clean };
          }).pipe(Effect.orDie),
      };

      return service;
    }),
  );
}
