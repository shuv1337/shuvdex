import { useState, useMemo } from "react";
import { useAudit } from "@/hooks/useAudit";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { AuditEvent, AuditDecision, ActionClass } from "@/api/client";

// ============================================================================
// Decision Badge
// ============================================================================

function DecisionBadge({ decision }: { decision: AuditDecision }) {
  const variant =
    decision === "allow" ? "green" :
    decision === "deny" ? "red" : "amber";
  return <Badge variant={variant} size="sm">{decision}</Badge>;
}

// ============================================================================
// Action Class Badge
// ============================================================================

function ActionClassBadge({ actionClass }: { actionClass: ActionClass }) {
  const variant =
    actionClass === "read" ? "cyan" :
    actionClass === "write" ? "amber" :
    actionClass === "admin" ? "red" : "purple";
  return <Badge variant={variant} size="sm">{actionClass}</Badge>;
}

// ============================================================================
// Event Row
// ============================================================================

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-slate-700/30 last:border-0">
      <div
        className="flex items-center gap-3 px-3 py-2 hover:bg-slate-800/40 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <DecisionBadge decision={event.decision} />
        <ActionClassBadge actionClass={event.actionClass} />
        <span className="text-xs text-slate-200 flex-1 truncate">{event.action}</span>
        <span className="text-xs mono text-slate-500 w-32 truncate">{event.actorId}</span>
        <span className="text-xs mono text-slate-500 w-36">
          {new Date(event.timestamp).toLocaleString()}
        </span>
      </div>
      
      {expanded && (
        <div className="px-3 py-3 bg-slate-950/40 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Event ID</span>
              <code className="text-[10px] mono text-slate-400 block">{event.id}</code>
            </div>
            {event.tenantId && (
              <div className="space-y-1">
                <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Tenant</span>
                <code className="text-[10px] mono text-slate-400 block">{event.tenantId}</code>
              </div>
            )}
          </div>
          
          {event.targetId && (
            <div className="space-y-1">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Target</span>
              <span className="text-xs text-slate-400">{event.targetType}: {event.targetId}</span>
            </div>
          )}
          
          {event.policyId && (
            <div className="space-y-1">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Policy</span>
              <code className="text-[10px] mono text-slate-400 block">{event.policyId}</code>
            </div>
          )}
          
          {event.reason && (
            <div className="space-y-1">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Reason</span>
              <p className="text-xs text-slate-400">{event.reason}</p>
            </div>
          )}
          
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Metadata</span>
              <pre className="text-[10px] mono text-slate-400 bg-slate-950/60 p-2 rounded overflow-auto max-h-32">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Audit Page
// ============================================================================

export function Audit() {
  const { events, metrics, loading, error, hasMore, total, refresh, query, loadMore, exportEvents } = useAudit();
  const [filters, setFilters] = useState({
    action: "",
    actionClass: "" as ActionClass | "",
    decision: "" as AuditDecision | "",
    actorId: "",
  });

  const actionClasses: (ActionClass | "")[] = ["", "read", "write", "admin", "governance"];
  const decisions: (AuditDecision | "")[] = ["", "allow", "deny", "approval_required"];

  const handleApplyFilters = () => {
    query({
      action: filters.action || undefined,
      actionClass: filters.actionClass || undefined,
      decision: filters.decision || undefined,
      actorId: filters.actorId || undefined,
      limit: 100,
    });
  };

  const handleExport = async () => {
    const jsonl = await exportEvents({
      tenantId: undefined,
    });
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    if (!metrics) return null;
    return [
      { label: "Total Events", value: metrics.totalEvents },
      { label: "Allowed", value: metrics.allowCount, color: "text-emerald-400" },
      { label: "Denied", value: metrics.denyCount, color: "text-rose-400" },
      { label: "Pending", value: metrics.approvalRequiredCount, color: "text-amber-400" },
      { label: "Unique Actors", value: metrics.uniqueActors },
    ];
  }, [metrics]);

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Audit Log
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {total.toLocaleString()} events tracked
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="card p-3 text-center">
              <p className={cn("text-lg font-semibold", stat.color ?? "text-slate-100")}>{stat.value.toLocaleString()}</p>
              <p className="text-[10px] mono uppercase text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[10px] mono uppercase tracking-wider text-slate-400">Action</label>
            <input
              type="text"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              placeholder="Filter by action..."
              className="input-base text-xs px-2 py-1 w-32"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-[10px] mono uppercase tracking-wider text-slate-400">Class</label>
            <select
              value={filters.actionClass}
              onChange={(e) => setFilters({ ...filters, actionClass: e.target.value as ActionClass | "" })}
              className="input-base text-xs px-2 py-1 appearance-none"
            >
              <option value="">Any</option>
              {actionClasses.filter(Boolean).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-[10px] mono uppercase tracking-wider text-slate-400">Decision</label>
            <select
              value={filters.decision}
              onChange={(e) => setFilters({ ...filters, decision: e.target.value as AuditDecision | "" })}
              className="input-base text-xs px-2 py-1 appearance-none"
            >
              <option value="">Any</option>
              {decisions.filter(Boolean).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-[10px] mono uppercase tracking-wider text-slate-400">Actor</label>
            <input
              type="text"
              value={filters.actorId}
              onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
              placeholder="Filter by actor..."
              className="input-base text-xs px-2 py-1 w-32"
            />
          </div>
          
          <button
            type="button"
            onClick={handleApplyFilters}
            className="btn-primary text-xs px-3 py-1 ml-auto"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Events List */}
      <div className="card">
        {/* Header */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-slate-700/30 bg-slate-800/30">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 w-16">Status</span>
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 w-16">Class</span>
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 flex-1">Action</span>
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 w-32">Actor</span>
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 w-36">Timestamp</span>
        </div>
        
        {/* Rows */}
        {loading && events.length === 0 ? (
          <div className="p-8 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-slate-700/30 rounded animate-pulse" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title="No events found"
            description="Try adjusting your filters or check back later."
          />
        ) : (
          <>
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
            
            {hasMore && (
              <div className="p-3 border-t border-slate-700/30">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="btn-ghost text-xs px-3 py-1.5 w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {loading && (
                    <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  )}
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
