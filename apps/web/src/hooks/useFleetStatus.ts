import { useState, useEffect, useCallback } from "react";
import { fetchFleetStatus, type HostStatusRecord } from "@/api/client";

export interface UseFleetStatusResult {
  hosts: HostStatusRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
}

export function useFleetStatus(refreshInterval = 30_000): UseFleetStatusResult {
  const [hosts, setHosts] = useState<HostStatusRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFleetStatus();
      setHosts(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch fleet status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;
    const id = setInterval(() => void load(), refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval]);

  return { hosts, loading, error, refresh: load, lastUpdated };
}
