import { useState, useEffect, useCallback } from "react";
import {
  fetchTools,
  createTool,
  updateTool,
  deleteTool,
  setToolEnabled,
  type Tool,
} from "@/api/client";

export interface UseToolsResult {
  tools: Tool[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addTool: (tool: Omit<Tool, "id" | "builtIn">) => Promise<Tool>;
  editTool: (id: string, tool: Partial<Omit<Tool, "id" | "builtIn">>) => Promise<Tool>;
  removeTool: (id: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => Promise<Tool>;
}

export function useTools(): UseToolsResult {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTools();
      setTools(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch tools");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addTool = useCallback(async (tool: Omit<Tool, "id" | "builtIn">) => {
    const created = await createTool(tool);
    setTools((prev) => [...prev, created]);
    return created;
  }, []);

  const editTool = useCallback(
    async (id: string, updates: Partial<Omit<Tool, "id" | "builtIn">>) => {
      const updated = await updateTool(id, updates);
      setTools((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [],
  );

  const removeTool = useCallback(async (id: string) => {
    await deleteTool(id);
    setTools((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleEnabled = useCallback(async (id: string, enabled: boolean) => {
    const updated = await setToolEnabled(id, enabled);
    setTools((prev) => prev.map((t) => (t.id === id ? updated : t)));
    return updated;
  }, []);

  return {
    tools,
    loading,
    error,
    refresh: () => void load(),
    addTool,
    editTool,
    removeTool,
    toggleEnabled,
  };
}
