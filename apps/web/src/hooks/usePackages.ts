import { useState, useEffect, useCallback } from "react";
import {
  fetchPackages,
  reindexPackages,
  cleanupPackages,
  deletePackage,
  type CapabilityPackage,
} from "@/api/client";

export interface UsePackagesResult {
  packages: CapabilityPackage[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  reindex: () => Promise<unknown>;
  cleanup: (force?: boolean) => Promise<{ orphans: string[]; removed: string[] }>;
  removePackage: (packageId: string) => Promise<void>;
}

export function usePackages(): UsePackagesResult {
  const [packages, setPackages] = useState<CapabilityPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPackages();
      setPackages(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch packages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reindex = useCallback(async () => {
    const result = await reindexPackages();
    await load();
    return result;
  }, [load]);

  const cleanup = useCallback(async (force = false) => {
    const result = await cleanupPackages(force);
    await load();
    return result;
  }, [load]);

  const removePackage = useCallback(async (packageId: string) => {
    await deletePackage(packageId);
    setPackages((prev) => prev.filter((p) => p.id !== packageId));
  }, []);

  return {
    packages,
    loading,
    error,
    refresh: () => void load(),
    reindex,
    cleanup,
    removePackage,
  };
}
