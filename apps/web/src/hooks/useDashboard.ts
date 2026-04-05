import { useState, useEffect, useCallback } from "react";
import {
  fetchDashboardSummary,
  fetchAuditTimeline,
  fetchHealthOverview,
  type DashboardSummary,
  type AuditTimeline,
  type HealthOverview,
} from "@/api/client";

export interface UseDashboardResult {
  summary: DashboardSummary | null;
  timeline: AuditTimeline | null;
  health: HealthOverview | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  refreshSummary: () => Promise<void>;
  refreshTimeline: (hours?: number) => Promise<void>;
  refreshHealth: () => Promise<void>;
}

export function useDashboard(): UseDashboardResult {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [timeline, setTimeline] = useState<AuditTimeline | null>(null);
  const [health, setHealth] = useState<HealthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      const data = await fetchDashboardSummary();
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch dashboard summary");
    }
  }, []);

  const refreshTimeline = useCallback(async (hours = 24) => {
    try {
      const data = await fetchAuditTimeline(hours);
      setTimeline(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch audit timeline");
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const data = await fetchHealthOverview();
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch health overview");
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([refreshSummary(), refreshTimeline(), refreshHealth()]);
    setLoading(false);
  }, [refreshSummary, refreshTimeline, refreshHealth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    summary,
    timeline,
    health,
    loading,
    error,
    refresh,
    refreshSummary,
    refreshTimeline,
    refreshHealth,
  };
}
