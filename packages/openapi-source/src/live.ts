import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parse as yamlParse } from "yaml";
import {
  CapabilityRegistry,
  type CapabilityPackage,
  type CapabilityDefinition,
} from "@shuvdex/capability-registry";
import { CredentialStore } from "@shuvdex/credential-store";
import { HttpExecutor } from "@shuvdex/http-executor";
import {
  OpenApiSource,
  type OpenApiSourceConfig,
  type OpenApiSourceRecord,
  type OpenApiInspectResult,
  type OpenApiRefreshDiff,
  type OperationFilter,
  type PackageLink,
} from "./types.js";
import {
  OpenApiSourceFetchError,
  OpenApiSourceIOError,
  OpenApiSourceNotFound,
} from "./errors.js";

export interface OpenApiSourceConfigOptions {
  readonly rootDir?: string;
}

interface LoadedSpec {
  readonly text: string;
  readonly doc: Record<string, unknown>;
  readonly checksum: string;
  readonly etag?: string;
  readonly lastModified?: string;
}

interface ExtractedOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly sideEffectLevel: "read" | "write" | "admin";
  readonly riskLevel: "low" | "medium" | "high";
  readonly included: boolean;
  readonly reason?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly httpBinding: Record<string, unknown>;
  readonly subjectScopes: readonly string[];
}

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".") || "item";
}

function stableSourceId(specUrl: string, selectedServerUrl: string, title: string): string {
  return `openapi.${slugify(title)}.${sha256(`${specUrl}|${selectedServerUrl}`).slice(0, 10)}`;
}

function defaultPackageId(title: string): string {
  return `openapi.${slugify(title)}`;
}

function sourceDir(rootDir: string): string {
  return path.join(rootDir, "sources", "openapi");
}

function sourcePath(rootDir: string, sourceId: string): string {
  return path.join(sourceDir(rootDir), `${sourceId}.json`);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readYamlOrJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const parsed = yamlParse(text);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("OpenAPI document must parse to an object");
  }
}

function resolveSourceUrl(specUrl: string): { text: string; etag?: string; lastModified?: string } {
  if (specUrl.startsWith("file://")) {
    const filePath = new URL(specUrl);
    return { text: fs.readFileSync(filePath, "utf-8") };
  }
  if (/^[a-zA-Z]:[\\/]/.test(specUrl) || path.isAbsolute(specUrl)) {
    return { text: fs.readFileSync(specUrl, "utf-8") };
  }
  throw new Error("Only file URLs or local file paths are supported in this environment");
}

async function loadSpec(specUrl: string): Promise<LoadedSpec> {
  const loaded = resolveSourceUrl(specUrl);
  const doc = readYamlOrJson(loaded.text);
  return {
    text: loaded.text,
    doc,
    checksum: sha256(loaded.text),
    etag: loaded.etag,
    lastModified: loaded.lastModified,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function operationSideEffectLevel(method: string): "read" | "write" | "admin" {
  switch (method) {
    case "post":
    case "put":
    case "patch":
      return "write";
    case "delete":
      return "admin";
    default:
      return "read";
  }
}

function operationRiskLevel(method: string): "low" | "medium" | "high" {
  switch (method) {
    case "delete":
      return "high";
    case "post":
    case "put":
    case "patch":
      return "medium";
    default:
      return "low";
  }
}

function scopeFor(method: string, packageId: string): string[] {
  switch (operationSideEffectLevel(method)) {
    case "admin":
      return [`${packageId}.admin`];
    case "write":
      return [`${packageId}.write`];
    default:
      return [`${packageId}.read`];
  }
}

function methodFromPathEntry(entry: [string, unknown]): string[] {
  return Object.keys(entry[1] as Record<string, unknown>).filter((key) => METHODS.has(key));
}

function schemaFromParameter(param: Record<string, unknown>): Record<string, unknown> {
  const schema = param.schema as Record<string, unknown> | undefined;
  if (schema) return schema;
  const type = param.type;
  return typeof type === "string" ? { type } : { type: "string" };
}

function makeBucketSchema(fields: Record<string, Record<string, unknown>>, required: Set<string>): Record<string, unknown> {
  return {
    type: "object",
    properties: fields,
    ...(required.size > 0 ? { required: Array.from(required).sort() } : {}),
    additionalProperties: false,
  };
}

function normalizePath(pathTemplate: string): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9.]+/g, ".").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "") || "operation";
}

function deriveOperationId(
  packageId: string,
  pathTemplate: string,
  method: string,
  operation: Record<string, unknown>,
  collisionIndex: number,
): string {
  const raw =
    typeof operation.operationId === "string" && operation.operationId.trim().length > 0
      ? operation.operationId
      : `${method}.${pathTemplate}`
          .replace(/\{([^}]+)\}/g, "$1")
          .split("/")
          .filter(Boolean)
          .map((part) => part.replace(/[^a-zA-Z0-9]+/g, "."))
          .join(".");
  const base = sanitizeIdentifier(raw).replace(/^\.+|\.+$/g, "");
  return `${packageId}.${base}${collisionIndex > 0 ? `.${sha256(`${packageId}|${method}|${pathTemplate}`).slice(0, 6)}` : ""}`;
}

function extractOperations(
  doc: Record<string, unknown>,
  selectedServerUrl: string,
  filter?: OperationFilter,
  packageId = "openapi.package",
): { operations: ExtractedOperation[]; warnings: string[]; servers: string[]; securitySchemes: string[] } {
  const warnings: string[] = [];
  const servers = Array.isArray(doc.servers)
    ? doc.servers
        .map((server) => (server && typeof server === "object" ? (server as Record<string, unknown>).url : undefined))
        .filter((value): value is string => typeof value === "string")
    : [];
  const securitySchemes = Object.keys(((doc.components ?? {}) as Record<string, unknown>).securitySchemes ?? {});
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const operations: ExtractedOperation[] = [];
  const seenIds = new Map<string, number>();

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    const methods = methodFromPathEntry([pathTemplate, pathItem]);
    for (const method of methods) {
      const operation = pathItem[method] as Record<string, unknown>;
      const tags = stringList(operation.tags);
      const collisionKey = `${method}:${pathTemplate}`;
      const operationIdBase = deriveOperationId(packageId, pathTemplate, method, operation, seenIds.get(collisionKey) ?? 0);
      seenIds.set(collisionKey, (seenIds.get(collisionKey) ?? 0) + 1);
      const reason = (() => {
        if (filter?.includeMethodsOnly?.length && !filter.includeMethodsOnly.includes(method.toUpperCase())) return `Method ${method.toUpperCase()} excluded by filter`;
        if (filter?.includeOperationIds?.length && typeof operation.operationId === "string" && !filter.includeOperationIds.includes(operation.operationId)) return `operationId ${operation.operationId} not included`;
        if (filter?.excludeOperationIds?.length && typeof operation.operationId === "string" && filter.excludeOperationIds.includes(operation.operationId)) return `operationId ${operation.operationId} excluded`;
        if (filter?.includePathPrefixes?.length && !filter.includePathPrefixes.some((prefix) => pathTemplate.startsWith(prefix))) return `Path ${pathTemplate} excluded by filter`;
        if (filter?.excludePathPrefixes?.length && filter.excludePathPrefixes.some((prefix) => pathTemplate.startsWith(prefix))) return `Path ${pathTemplate} excluded by filter`;
        if (filter?.includeTags?.length && !tags.some((tag) => filter.includeTags!.includes(tag))) return `Tags ${tags.join(", ")} not included`;
        if (filter?.excludeTags?.length && tags.some((tag) => filter.excludeTags!.includes(tag))) return `Tags ${tags.join(", ")} excluded`;
        return undefined;
      })();
      const included = reason === undefined;
      const parameters = Array.isArray(operation.parameters) ? (operation.parameters as Record<string, unknown>[]) : [];
      const buckets: Record<string, Record<string, Record<string, unknown>>> = { path: {}, query: {}, headers: {}, cookies: {} };
      const requiredByBucket: Record<string, Set<string>> = { path: new Set(), query: new Set(), headers: new Set(), cookies: new Set() };
      for (const param of parameters) {
        const location = String(param.in ?? "query");
        if (!("path,query,header,cookie".split(",") as string[]).includes(location)) continue;
        const bucket = location === "header" ? "headers" : location === "cookie" ? "cookies" : location;
        const name = String(param.name ?? "param");
        buckets[bucket][name] = schemaFromParameter(param);
        if (param.required === true || location === "path") requiredByBucket[bucket].add(name);
      }
      const bodyContent = (operation.requestBody as Record<string, unknown> | undefined)?.content as Record<string, Record<string, unknown>> | undefined;
      const bodyContentType = bodyContent ? Object.keys(bodyContent).find((type) => type === "application/json" || type === "application/x-www-form-urlencoded") : undefined;
      const bodySchema = bodyContentType ? bodyContent?.[bodyContentType]?.schema ?? { type: "object" } : undefined;
      const bodyRequired = (operation.requestBody as Record<string, unknown> | undefined)?.required === true;
      const inputProperties: Record<string, unknown> = {};
      if (Object.keys(buckets.path).length > 0) inputProperties.path = makeBucketSchema(buckets.path, requiredByBucket.path);
      if (Object.keys(buckets.query).length > 0) inputProperties.query = makeBucketSchema(buckets.query, requiredByBucket.query);
      if (Object.keys(buckets.headers).length > 0) inputProperties.headers = makeBucketSchema(buckets.headers, requiredByBucket.headers);
      if (Object.keys(buckets.cookies).length > 0) inputProperties.cookies = makeBucketSchema(buckets.cookies, requiredByBucket.cookies);
      if (bodySchema) inputProperties.body = bodySchema;

      operations.push({
        operationId: operationIdBase,
        method,
        path: pathTemplate,
        tags,
        title: typeof operation.summary === "string" ? operation.summary : operationIdBase.split(".").at(-1) ?? operationIdBase,
        description: typeof operation.description === "string" ? operation.description : `${method.toUpperCase()} ${pathTemplate}`,
        sideEffectLevel: operationSideEffectLevel(method),
        riskLevel: operationRiskLevel(method),
        included,
        reason,
        inputSchema: {
          type: "object",
          properties: inputProperties,
          ...(Object.keys(inputProperties).length > 0 ? { required: Object.keys(inputProperties) } : {}),
        },
        httpBinding: {
          method,
          baseUrl: selectedServerUrl,
          pathTemplate: normalizePath(pathTemplate),
          parameters: parameters.map((param) => ({
            name: String(param.name ?? "param"),
            in: String(param.in ?? "query"),
            required: param.required === true,
            style: param.style,
            explode: param.explode,
            allowReserved: param.allowReserved,
            schema: schemaFromParameter(param),
          })),
          requestBody: bodySchema ? { required: bodyRequired, contentType: bodyContentType ?? "application/json", schema: bodySchema } : undefined,
          securityRequirements: Array.isArray(operation.security)
            ? operation.security.flatMap((requirement) => Object.entries(requirement as Record<string, string[]>).map(([schemeId, scopes]) => ({ schemeId, scopes })))
            : undefined,
        },
        subjectScopes: scopeFor(method, packageId),
      });
    }
  }

  return { operations, warnings, servers, securitySchemes };
}

function packageIdFor(config: OpenApiSourceConfig, title: string): string {
  return config.packageIdOverride ?? defaultPackageId(title);
}

function opToCapability(record: OpenApiSourceRecord, op: ExtractedOperation): CapabilityDefinition {
  return {
    id: op.operationId,
    packageId: record.packageId,
    version: "1.0.0",
    kind: "tool",
    title: op.title,
    description: op.description,
    enabled: op.included,
    visibility: "scoped",
    tags: [...(record.tags ?? []), ...op.tags].filter(Boolean),
    riskLevel: op.riskLevel,
    subjectScopes: op.subjectScopes,
    executorRef: {
      executorType: "http_api",
      timeoutMs: record.defaultTimeoutMs,
      credentialId: record.credentialId,
      httpBinding: op.httpBinding as never,
    },
    provenance: {
      derivedBy: "openapi",
      generatedFrom: record.specUrl,
      sourceSection: `${op.method.toUpperCase()} ${op.path}`,
    },
    certification: {
      status: "untested",
    },
    tool: {
      inputSchema: op.inputSchema,
      outputSchema: { type: "object" },
      sideEffectLevel: op.sideEffectLevel,
      timeoutMs: record.defaultTimeoutMs,
    },
    annotations: {
      "openapi.method": op.method,
      "openapi.path": op.path,
      "openapi.operationId": op.operationId,
      "openapi.server": record.selectedServerUrl,
      ...(record.credentialId ? { "openapi.credentialId": record.credentialId } : {}),
    },
  };
}

function assemblePackage(record: OpenApiSourceRecord, operations: ExtractedOperation[]): CapabilityPackage {
  const linkedPackages: PackageLink[] | undefined = record.companionPackageId
    ? [
        {
          packageId: record.companionPackageId,
          relation: "composes_with",
          reason: "Companion workflow guidance for generated OpenAPI tools",
        },
      ]
    : undefined;

  return {
    id: record.packageId,
    version: "1.0.0",
    title: record.title,
    description: record.description ?? `OpenAPI tools for ${record.title}`,
    builtIn: false,
    enabled: true,
    tags: record.tags ? [...record.tags] : undefined,
    source: {
      type: "openapi",
      sourceId: record.sourceId,
      specUrl: record.specUrl,
      selectedServerUrl: record.selectedServerUrl,
      specChecksum: record.specChecksum,
      credentialId: record.credentialId,
      lastSyncedAt: record.lastSyncedAt,
      operationCount: operations.length,
    },
    linkedPackages,
    capabilities: operations.map((op) => opToCapability(record, op)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildOpenApiRecord(config: OpenApiSourceConfig, checksum?: string, etag?: string, lastModified?: string, importedOperationCount?: number): OpenApiSourceRecord {
  const now = new Date().toISOString();
  return {
    sourceId: config.sourceId ?? stableSourceId(config.specUrl, config.selectedServerUrl, config.title),
    packageId: packageIdFor(config, config.title),
    title: config.title,
    description: config.description,
    tags: config.tags ? [...config.tags] : undefined,
    specUrl: config.specUrl,
    selectedServerUrl: config.selectedServerUrl,
    specChecksum: checksum,
    specEtag: etag,
    specLastModified: lastModified,
    credentialId: config.credentialId,
    operationFilter: config.operationFilter,
    defaultTimeoutMs: config.defaultTimeoutMs,
    defaultRiskLevel: config.defaultRiskLevel,
    importedOperationCount,
    createdAt: now,
    updatedAt: now,
    lastInspectedAt: now,
    lastSyncedAt: now,
    companionPackageId: config.companionPackageId,
  };
}

function mergePreservedCapability(existing: CapabilityDefinition | undefined, generated: CapabilityDefinition): CapabilityDefinition {
  if (!existing) return generated;
  return {
    ...generated,
    enabled: existing.enabled,
    annotations: existing.annotations ?? generated.annotations,
    certification: existing.certification ?? generated.certification,
    riskLevel: existing.riskLevel ?? generated.riskLevel,
    subjectScopes: existing.subjectScopes ?? generated.subjectScopes,
  };
}

function refreshDiff(existing: CapabilityPackage | undefined, next: CapabilityPackage): OpenApiRefreshDiff {
  const previousIds = new Set(existing?.capabilities.map((item) => item.id) ?? []);
  const nextIds = new Set(next.capabilities.map((item) => item.id));
  const added = next.capabilities.filter((item) => !previousIds.has(item.id)).map((item) => item.id);
  const removed = Array.from(previousIds).filter((id) => !nextIds.has(id));
  const changed = next.capabilities
    .filter((item) => previousIds.has(item.id))
    .filter((item) => {
      const prev = existing?.capabilities.find((capability) => capability.id === item.id);
      return JSON.stringify(prev) !== JSON.stringify(item);
    })
    .map((item) => item.id);
  const unchanged = next.capabilities.filter((item) => previousIds.has(item.id) && !changed.includes(item.id)).map((item) => item.id);
  return { added, changed, removed, unchanged };
}

function capabilitiesWithRemovals(existing: CapabilityPackage | undefined, next: CapabilityPackage, removedIds: readonly string[]): CapabilityPackage {
  if (!existing) return next;
  const removedCapabilities = existing.capabilities
    .filter((capability) => removedIds.includes(capability.id))
    .map((capability) => ({
      ...capability,
      enabled: false,
      certification: {
        status: "stale" as const,
        notes: "operation removed from latest spec",
      },
      annotations: {
        ...(capability.annotations ?? {}),
        "openapi.removed": true,
      },
    }));
  return {
    ...next,
    capabilities: [...next.capabilities, ...removedCapabilities],
  };
}

function listSourceRecords(rootDir: string): OpenApiSourceRecord[] {
  const dir = sourceDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJson<OpenApiSourceRecord>(path.join(dir, entry)))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function writeSourceRecord(rootDir: string, record: OpenApiSourceRecord): void {
  writeJson(sourcePath(rootDir, record.sourceId), record);
}

function readSourceRecord(rootDir: string, sourceId: string): OpenApiSourceRecord {
  const filePath = sourcePath(rootDir, sourceId);
  if (!fs.existsSync(filePath)) {
    throw new OpenApiSourceNotFound({ sourceId });
  }
  return readJson<OpenApiSourceRecord>(filePath);
}

function patchRecord(record: OpenApiSourceRecord, patch: Partial<OpenApiSourceConfig>): OpenApiSourceRecord {
  return {
    ...record,
    title: patch.title ?? record.title,
    description: patch.description ?? record.description,
    tags: patch.tags ? [...patch.tags] : record.tags,
    specUrl: patch.specUrl ?? record.specUrl,
    selectedServerUrl: patch.selectedServerUrl ?? record.selectedServerUrl,
    credentialId: patch.credentialId ?? record.credentialId,
    operationFilter: patch.operationFilter ?? record.operationFilter,
    defaultTimeoutMs: patch.defaultTimeoutMs ?? record.defaultTimeoutMs,
    defaultRiskLevel: patch.defaultRiskLevel ?? record.defaultRiskLevel,
    companionPackageId: patch.companionPackageId ?? record.companionPackageId,
    updatedAt: new Date().toISOString(),
  };
}

export function makeOpenApiSourceLive(
  options?: OpenApiSourceConfigOptions,
): Layer.Layer<OpenApiSource, never, CapabilityRegistry | CredentialStore | HttpExecutor> {
  const rootDir = options?.rootDir ?? path.resolve(process.cwd(), ".capabilities");
  ensureDir(sourceDir(rootDir));
  ensureDir(path.join(rootDir, "packages"));

  return Layer.effect(
    OpenApiSource,
    Effect.gen(function* () {
      const registry = yield* CapabilityRegistry;
      const credentialStore = yield* CredentialStore;
      const httpExecutor = yield* HttpExecutor;

      const service = {
        inspect: (config: OpenApiSourceConfig) =>
          Effect.tryPromise({
            try: async () => {
              const spec = await loadSpec(config.specUrl);
              const packageId = packageIdFor(config, config.title);
              const extracted = extractOperations(spec.doc, config.selectedServerUrl, config.operationFilter, packageId);
              return {
                title: config.title,
                description: config.description,
                sourceUrl: config.specUrl,
                selectedServerUrl: config.selectedServerUrl,
                totalOperations: extracted.operations.length,
                includedOperations: extracted.operations.filter((op) => op.included).length,
                availableServers: extracted.servers.length > 0 ? extracted.servers : [config.selectedServerUrl],
                securitySchemes: extracted.securitySchemes,
                operations: extracted.operations.map((op) => ({
                  operationId: op.operationId,
                  method: op.method,
                  path: op.path,
                  tags: op.tags,
                  included: op.included,
                  reason: op.reason,
                  riskLevel: op.riskLevel,
                })),
                warnings: extracted.warnings,
                specChecksum: spec.checksum,
                specEtag: spec.etag,
                specLastModified: spec.lastModified,
              } satisfies OpenApiInspectResult;
            },
            catch: (cause) =>
              new OpenApiSourceFetchError({
                sourceUrl: config.specUrl,
                cause: cause instanceof Error ? cause.message : String(cause),
              }),
          }),
        compile: (config: OpenApiSourceConfig) =>
          Effect.gen(function* () {
            const spec = yield* Effect.tryPromise({
              try: () => loadSpec(config.specUrl),
              catch: (cause) =>
                new OpenApiSourceFetchError({
                  sourceUrl: config.specUrl,
                  cause: cause instanceof Error ? cause.message : String(cause),
                }),
            });
            const extracted = extractOperations(spec.doc, config.selectedServerUrl, config.operationFilter, packageIdFor(config, config.title));
            const source = buildOpenApiRecord(
              config,
              spec.checksum,
              spec.etag,
              spec.lastModified,
              extracted.operations.filter((op) => op.included).length,
            );
            writeSourceRecord(rootDir, source);
            const existing = yield* Effect.either(registry.getPackage(source.packageId));
            const existingPackage = existing._tag === "Right" ? existing.right : undefined;
            const generated = assemblePackage(source, extracted.operations.filter((op) => op.included));
            const preserved = existingPackage
              ? {
                  ...generated,
                  capabilities: generated.capabilities.map((capability) =>
                    mergePreservedCapability(
                      existingPackage.capabilities.find((item) => item.id === capability.id),
                      capability,
                    ),
                  ),
                }
              : generated;
            const removedIds = existingPackage
              ? existingPackage.capabilities
                  .filter((capability) => !preserved.capabilities.some((item) => item.id === capability.id))
                  .map((capability) => capability.id)
              : [];
            const nextPackage = capabilitiesWithRemovals(existingPackage, preserved, removedIds);
            const saved = yield* registry.upsertPackage(nextPackage);
            return { record: source, package: saved, diff: refreshDiff(existingPackage, nextPackage) };
          }),
        listSources: () => Effect.sync(() => listSourceRecords(rootDir)),
        getSource: (sourceId: string) => Effect.sync(() => readSourceRecord(rootDir, sourceId)),
        updateSource: (sourceId: string, patch: Partial<OpenApiSourceConfig>) =>
          Effect.gen(function* () {
            const current = readSourceRecord(rootDir, sourceId);
            const next = patchRecord(current, patch);
            writeSourceRecord(rootDir, next);
            return next;
          }),
        deleteSource: (sourceId: string) =>
          Effect.gen(function* () {
            const current = readSourceRecord(rootDir, sourceId);
            yield* Effect.either(registry.deletePackage(current.packageId));
            yield* Effect.try({
              try: () => fs.rmSync(sourcePath(rootDir, sourceId), { force: true }),
              catch: (cause) => new OpenApiSourceIOError({ path: rootDir, cause: String(cause) }),
            });
          }),
        refreshSource: (sourceId: string) =>
          Effect.gen(function* () {
            const current = readSourceRecord(rootDir, sourceId);
            const spec = yield* Effect.tryPromise({
              try: () => loadSpec(current.specUrl),
              catch: (cause) =>
                new OpenApiSourceFetchError({
                  sourceId,
                  sourceUrl: current.specUrl,
                  cause: cause instanceof Error ? cause.message : String(cause),
                }),
            });
            const extracted = extractOperations(spec.doc, current.selectedServerUrl, current.operationFilter, current.packageId);
            const nextRecord: OpenApiSourceRecord = {
              ...current,
              specChecksum: spec.checksum,
              specEtag: spec.etag,
              specLastModified: spec.lastModified,
              importedOperationCount: extracted.operations.filter((op) => op.included).length,
              updatedAt: new Date().toISOString(),
              lastSyncedAt: new Date().toISOString(),
            };
            const nextGenerated = assemblePackage(nextRecord, extracted.operations.filter((op) => op.included));
            const existing = yield* Effect.either(registry.getPackage(current.packageId));
            const existingPackage = existing._tag === "Right" ? existing.right : undefined;
            const merged = existingPackage
              ? {
                  ...nextGenerated,
                  capabilities: nextGenerated.capabilities.map((capability) =>
                    mergePreservedCapability(existingPackage.capabilities.find((item) => item.id === capability.id), capability),
                  ),
                }
              : nextGenerated;
            const removedIds = existingPackage
              ? existingPackage.capabilities
                  .filter((capability) => !merged.capabilities.some((item) => item.id === capability.id))
                  .map((capability) => capability.id)
              : [];
            const nextPackage = capabilitiesWithRemovals(existingPackage, merged, removedIds);
            const saved = yield* registry.upsertPackage(nextPackage);
            writeSourceRecord(rootDir, nextRecord);
            return { record: nextRecord, package: saved, diff: refreshDiff(existingPackage, nextPackage) };
          }),
        testAuth: (sourceId: string) =>
          Effect.gen(function* () {
            const source = readSourceRecord(rootDir, sourceId);
            if (!source.credentialId) {
              return {
                ok: true,
                status: 204,
                message: "No credential configured",
              };
            }

            yield* credentialStore.getCredential(source.credentialId);
            const pkg = yield* registry.getPackage(source.packageId);
            const candidate = pkg.capabilities.find((capability) => capability.enabled && capability.executorRef?.executorType === "http_api");
            if (!candidate) {
              return {
                ok: false,
                status: 404,
                message: "No enabled HTTP capability available for auth probe",
              };
            }

            const probeResult = yield* httpExecutor.executeHttp(candidate, {});
            return {
              ok: probeResult.isError !== true,
              status: probeResult.payload.status,
              message: probeResult.isError === true ? `Auth probe failed with status ${probeResult.payload.status}` : "Auth probe succeeded",
            };
          }),
      };

      return service;
    }),
  );
}

export const OpenApiSourceLive = makeOpenApiSourceLive();
