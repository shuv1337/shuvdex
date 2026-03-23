import { Context, Effect } from "effect";
import type { CapabilityPackage, CapabilityDefinition } from "@shuvdex/capability-registry";
import type { OpenApiSourceFetchError, OpenApiSourceIOError, OpenApiSourceNotFound } from "./errors.js";

export interface PackageLink {
  readonly packageId: string;
  readonly relation: "composes_with" | "depends_on" | "documents" | "augments";
  readonly reason?: string;
  readonly capabilityIds?: readonly string[];
}

export interface OperationFilter {
  readonly includeTags?: readonly string[];
  readonly excludeTags?: readonly string[];
  readonly includeOperationIds?: readonly string[];
  readonly excludeOperationIds?: readonly string[];
  readonly includePathPrefixes?: readonly string[];
  readonly excludePathPrefixes?: readonly string[];
  readonly includeMethodsOnly?: readonly string[];
}

export interface OpenApiSourceConfig {
  readonly sourceId?: string;
  readonly specUrl: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly packageIdOverride?: string;
  readonly selectedServerUrl: string;
  readonly credentialId?: string;
  readonly operationFilter?: OperationFilter;
  readonly defaultTimeoutMs?: number;
  readonly defaultRiskLevel?: "low" | "medium" | "high";
  readonly companionPackageId?: string;
}

export interface OpenApiSourceRecord {
  readonly sourceId: string;
  readonly packageId: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly specUrl: string;
  readonly selectedServerUrl: string;
  readonly specChecksum?: string;
  readonly specEtag?: string;
  readonly specLastModified?: string;
  readonly credentialId?: string;
  readonly operationFilter?: OperationFilter;
  readonly defaultTimeoutMs?: number;
  readonly defaultRiskLevel?: "low" | "medium" | "high";
  readonly importedOperationCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastInspectedAt?: string;
  readonly lastSyncedAt?: string;
  readonly companionPackageId?: string;
}

export interface OpenApiInspectOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly tags: readonly string[];
  readonly included: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high";
}

export interface OpenApiInspectResult {
  readonly title: string;
  readonly description?: string;
  readonly sourceUrl: string;
  readonly selectedServerUrl: string;
  readonly totalOperations: number;
  readonly includedOperations: number;
  readonly availableServers: readonly string[];
  readonly securitySchemes: readonly string[];
  readonly operations: readonly OpenApiInspectOperation[];
  readonly warnings: readonly string[];
  readonly specChecksum?: string;
  readonly specEtag?: string;
  readonly specLastModified?: string;
}

export interface OpenApiRefreshDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
}

export interface OpenApiSourceService {
  readonly inspect: (config: OpenApiSourceConfig) => Effect.Effect<OpenApiInspectResult, OpenApiSourceFetchError>;
  readonly compile: (config: OpenApiSourceConfig) => Effect.Effect<{ record: OpenApiSourceRecord; package: CapabilityPackage; diff?: OpenApiRefreshDiff }, unknown>;
  readonly listSources: () => Effect.Effect<readonly OpenApiSourceRecord[], unknown>;
  readonly getSource: (sourceId: string) => Effect.Effect<OpenApiSourceRecord, unknown>;
  readonly updateSource: (sourceId: string, patch: Partial<OpenApiSourceConfig>) => Effect.Effect<OpenApiSourceRecord, unknown>;
  readonly deleteSource: (sourceId: string) => Effect.Effect<void, unknown>;
  readonly refreshSource: (sourceId: string) => Effect.Effect<{ record: OpenApiSourceRecord; package: CapabilityPackage; diff: OpenApiRefreshDiff }, unknown>;
  readonly testAuth: (sourceId: string) => Effect.Effect<{ ok: boolean; status?: number; message: string }, unknown>;
}

export class OpenApiSource extends Context.Tag("OpenApiSource")<
  OpenApiSource,
  OpenApiSourceService
>() {}
