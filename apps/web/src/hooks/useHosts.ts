import { useState, useEffect, useCallback } from "react";
import {
  fetchHosts,
  createHost,
  updateHost,
  deleteHost,
  pingHost,
  type HostConfig,
  type HostStatus,
} from "@/api/client";

export interface HostPingState {
  status: HostStatus;
  latencyMs?: number;
  checking: boolean;
}

export interface UseHostsResult {
  hosts: HostConfig[];
  loading: boolean;
  error: string | null;
  pingStates: Record<string, HostPingState>;
  refresh: () => void;
  addHost: (host: HostConfig) => Promise<HostConfig>;
  editHost: (name: string, updates: Partial<Omit<HostConfig, "name">>) => Promise<HostConfig>;
  removeHost: (name: string) => Promise<void>;
  checkHost: (name: string) => Promise<void>;
}

export function useHosts(): UseHostsResult {
  const [hosts, setHosts] = useState<HostConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pingStates, setPingStates] = useState<Record<string, HostPingState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHosts();
      setHosts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch hosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addHost = useCallback(async (host: HostConfig) => {
    const created = await createHost(host);
    setHosts((prev) => [...prev, created]);
    return created;
  }, []);

  const editHost = useCallback(
    async (name: string, updates: Partial<Omit<HostConfig, "name">>) => {
      const updated = await updateHost(name, updates);
      setHosts((prev) => prev.map((h) => (h.name === name ? updated : h)));
      return updated;
    },
    [],
  );

  const removeHost = useCallback(async (name: string) => {
    await deleteHost(name);
    setHosts((prev) => prev.filter((h) => h.name !== name));
  }, []);

  const checkHost = useCallback(async (name: string) => {
    setPingStates((prev) => ({
      ...prev,
      [name]: { status: "online", checking: true },
    }));
    try {
      const result = await pingHost(name);
      setPingStates((prev) => ({
        ...prev,
        [name]: { ...result, checking: false },
      }));
    } catch (_e) {
      setPingStates((prev) => ({
        ...prev,
        [name]: { status: "error", checking: false },
      }));
    }
  }, []);

  return {
    hosts,
    loading,
    error,
    pingStates,
    refresh: () => void load(),
    addHost,
    editHost,
    removeHost,
    checkHost,
  };
}
