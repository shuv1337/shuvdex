import { useState, useEffect, useCallback } from "react";
import {
  fetchOpenApiSources,
  getOpenApiSource,
  inspectOpenApiSource,
  compileOpenApiSource,
  updateOpenApiSource,
  refreshOpenApiSource,
  testOpenApiAuth,
  deleteOpenApiSource,
  type OpenApiSource,
  type OpenApiInspectionResult,
  type OpenApiCompileResult,
} from "@/api/client";

export interface UseOpenApiSourcesResult {
  sources: OpenApiSource[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  getSource: (sourceId: string) => Promise<OpenApiSource | null>;
  inspect: (params: {
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    packageIdOverride?: string;
    selectedServerUrl: string;
    credentialId?: string;
    operationFilter?: Record<string, unknown>;
    defaultTimeoutMs?: number;
    defaultRiskLevel?: "low" | "medium" | "high";
    companionPackageId?: string;
  }) => Promise<OpenApiInspectionResult | null>;
  compile: (params: {
    sourceId?: string;
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    packageIdOverride?: string;
    selectedServerUrl: string;
    credentialId?: string;
    operationFilter?: Record<string, unknown>;
    defaultTimeoutMs?: number;
    defaultRiskLevel?: "low" | "medium" | "high";
    companionPackageId?: string;
  }) => Promise<OpenApiCompileResult | null>;
  update: (sourceId: string, updates: Partial<OpenApiSource>) => Promise<OpenApiSource | null>;
  refresh: (sourceId: string) => Promise<OpenApiSource | null>;
  testAuth: (sourceId: string) => Promise<{ success: boolean; message?: string } | null>;
  remove: (sourceId: string) => Promise<boolean>;
}

export function useOpenApiSources(): UseOpenApiSourcesResult {
  const [sources, setSources] = useState<OpenApiSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOpenApiSources();
      setSources(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch OpenAPI sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getSource = useCallback(async (sourceId: string) => {
    try {
      return await getOpenApiSource(sourceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get OpenAPI source");
      return null;
    }
  }, []);

  const inspect = useCallback(async (params: {
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    packageIdOverride?: string;
    selectedServerUrl: string;
    credentialId?: string;
    operationFilter?: Record<string, unknown>;
    defaultTimeoutMs?: number;
    defaultRiskLevel?: "low" | "medium" | "high";
    companionPackageId?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      return await inspectOpenApiSource(params);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to inspect OpenAPI source");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const compile = useCallback(async (params: {
    sourceId?: string;
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    packageIdOverride?: string;
    selectedServerUrl: string;
    credentialId?: string;
    operationFilter?: Record<string, unknown>;
    defaultTimeoutMs?: number;
    defaultRiskLevel?: "low" | "medium" | "high";
    companionPackageId?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await compileOpenApiSource(params);
      await load();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to compile OpenAPI source");
      return null;
    } finally {
      setLoading(false);
    }
  }, [load]);

  const update = useCallback(async (sourceId: string, updates: Partial<OpenApiSource>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await updateOpenApiSource(sourceId, updates);
      setSources((prev) => prev.map((s) => (s.sourceId === sourceId ? result : s)));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update OpenAPI source");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSource = useCallback(async (sourceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await refreshOpenApiSource(sourceId);
      setSources((prev) => prev.map((s) => (s.sourceId === sourceId ? result : s)));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh OpenAPI source");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const testAuth = useCallback(async (sourceId: string) => {
    setLoading(true);
    setError(null);
    try {
      return await testOpenApiAuth(sourceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to test auth");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (sourceId: string) => {
    setLoading(true);
    setError(null);
    try {
      await deleteOpenApiSource(sourceId);
      setSources((prev) => prev.filter((s) => s.sourceId !== sourceId));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete OpenAPI source");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    sources,
    loading,
    error,
    reload: () => void load(),
    getSource,
    inspect,
    compile,
    update,
    refresh: refreshSource,
    testAuth,
    remove,
  };
}
