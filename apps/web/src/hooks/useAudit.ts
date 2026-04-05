import { useState, useEffect, useCallback } from "react";
import {
  queryAudit,
  fetchAuditMetrics,
  exportAudit,
  type AuditMetrics,
  type AuditEvent,
  type ActionClass,
  type AuditDecision,
} from "@/api/client";

export interface UseAuditResult {
  events: AuditEvent[];
  metrics: AuditMetrics | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  refresh: () => void;
  query: (params: {
    tenantId?: string;
    actorId?: string;
    action?: string;
    actionClass?: ActionClass;
    decision?: AuditDecision;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => Promise<void>;
  loadMore: () => Promise<void>;
  exportEvents: (params?: { tenantId?: string; from?: string; to?: string }) => Promise<string>;
}

export function useAudit(): UseAuditResult {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [metrics, setMetrics] = useState<AuditMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [currentLimit, setCurrentLimit] = useState(100);
  const [currentQuery, setCurrentQuery] = useState<{
    tenantId?: string;
    actorId?: string;
    action?: string;
    actionClass?: ActionClass;
    decision?: AuditDecision;
    from?: string;
    to?: string;
  }>({});

  const loadMetrics = useCallback(async () => {
    try {
      const data = await fetchAuditMetrics();
      setMetrics(data);
    } catch (e) {
      // metrics are non-critical
      console.error("Failed to load audit metrics", e);
    }
  }, []);

  const query = useCallback(async (params: {
    tenantId?: string;
    actorId?: string;
    action?: string;
    actionClass?: ActionClass;
    decision?: AuditDecision;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;
      const result = await queryAudit(params);
      setEvents(result.events);
      setHasMore(result.hasMore);
      setTotal(result.total);
      setCurrentOffset(offset);
      setCurrentLimit(limit);
      setCurrentQuery({
        tenantId: params.tenantId,
        actorId: params.actorId,
        action: params.action,
        actionClass: params.actionClass,
        decision: params.decision,
        from: params.from,
        to: params.to,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to query audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    try {
      const newOffset = currentOffset + currentLimit;
      const result = await queryAudit({
        ...currentQuery,
        limit: currentLimit,
        offset: newOffset,
      });
      setEvents((prev) => [...prev, ...result.events]);
      setHasMore(result.hasMore);
      setCurrentOffset(newOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load more events");
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, currentOffset, currentLimit, currentQuery]);

  const exportEvents = useCallback(async (params?: { tenantId?: string; from?: string; to?: string }) => {
    return exportAudit(params);
  }, []);

  const refresh = useCallback(() => {
    void loadMetrics();
    void query({ limit: currentLimit });
  }, [loadMetrics, query, currentLimit]);

  useEffect(() => {
    void loadMetrics();
    void query({ limit: 100 });
  }, [loadMetrics, query]);

  return {
    events,
    metrics,
    loading,
    error,
    hasMore,
    total,
    refresh,
    query,
    loadMore,
    exportEvents,
  };
}
