import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useFleetStatus } from "@/hooks/useFleetStatus";
import { useTools } from "@/hooks/useTools";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { HostStatusRecord } from "@/api/client";
import { pullAll, fetchDriftReport, type DriftReport } from "@/api/client";

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------
function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "green" | "amber" | "red" | "cyan";
}) {
  const accentColor = {
    green: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-rose-400",
    cyan: "text-cyan-400",
  }[accent ?? "cyan"];

  return (
    <div className="card px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] mono uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span className={cn("text-2xl font-semibold mono", accentColor)}>
        {value}
      </span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Host status card
// ---------------------------------------------------------------------------
function FleetHostCard({ host }: { host: HostStatusRecord }) {
  return (
    <div
      className={cn(
        "card flex flex-col gap-3 p-4 transition-colors duration-150",
        host.status === "online" && "hover:border-emerald-500/20",
        host.status === "degraded" && "border-amber-500/20 hover:border-amber-500/30",
        host.status === "error" && "border-rose-500/20 hover:border-rose-500/30",
      )}
    >
      {/* Name + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot
            status={host.status}
            pulse={host.status === "online"}
            size="md"
          />
          <span className="text-sm font-semibold text-slate-100 truncate">
            {host.name}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] mono uppercase tracking-wider font-medium",
            host.status === "online" && "text-emerald-400",
            host.status === "degraded" && "text-amber-400",
            host.status === "error" && "text-rose-400",
          )}
        >
          {host.status}
        </span>
      </div>

      {/* Hostname */}
      <p className="text-xs mono text-slate-400">{host.hostname}</p>

      {/* Git info */}
      <div className="flex items-center gap-2 flex-wrap">
        {host.head ? (
          <span className="text-xs mono text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded-[2px] border border-slate-700/50">
            {host.head.slice(0, 7)}
          </span>
        ) : (
          <span className="text-xs mono text-slate-600">—</span>
        )}
        {host.branch && (
          <span className="text-xs mono text-slate-400">{host.branch}</span>
        )}
        {host.dirty && (
          <span className="text-[10px] mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-[2px] uppercase tracking-wider">
            dirty
          </span>
        )}
      </div>

      {/* Error */}
      {host.error && (
        <p className="text-xs text-rose-400 mono leading-snug truncate" title={host.error}>
          ↳ {host.error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drift report
// ---------------------------------------------------------------------------
function DriftSummary({ report }: { report: DriftReport }) {
  const drifted = report.hosts.filter((h) => h.status === "drifted");
  const errors = report.hosts.filter((h) => h.status === "error");

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mono">
          Drift Report
        </h3>
        <div className="flex items-center gap-3 text-xs mono">
          <span className="text-slate-500">
            ref: <span className="text-slate-300">{report.referenceHost}</span>
          </span>
          <span className="text-slate-500">
            @ <span className="text-slate-300">{report.referenceHead.slice(0, 7)}</span>
          </span>
        </div>
      </div>

      <div className="divide-y divide-slate-800/50">
        {report.hosts.map((h) => (
          <div key={h.name} className="flex items-center justify-between py-2">
            <span className="text-xs mono text-slate-300">{h.name}</span>
            <div className="flex items-center gap-3">
              {h.head && (
                <span className="text-xs mono text-slate-500">{h.head.slice(0, 7)}</span>
              )}
              <span
                className={cn(
                  "text-[10px] mono uppercase tracking-wider font-medium",
                  h.status === "in-sync" && "text-emerald-400",
                  h.status === "drifted" && "text-amber-400",
                  h.status === "error" && "text-rose-400",
                )}
              >
                {h.status === "in-sync"
                  ? "in sync"
                  : h.status === "drifted"
                  ? `${h.commitsBehind ?? "?"} behind`
                  : "error"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {(drifted.length > 0 || errors.length > 0) && (
        <p className="text-xs text-slate-500">
          {drifted.length} host{drifted.length !== 1 ? "s" : ""} drifted
          {errors.length > 0 && `, ${errors.length} error${errors.length !== 1 ? "s" : ""}`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------
export function Dashboard() {
  const { hosts, loading, error, refresh, lastUpdated } = useFleetStatus(30_000);
  const { tools, loading: toolsLoading } = useTools();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftLoading, setDriftLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const onlineCount = hosts.filter((h) => h.status === "online").length;
  const degradedCount = hosts.filter((h) => h.status === "degraded").length;
  const errorCount = hosts.filter((h) => h.status === "error").length;

  const enabledTools = tools.filter((t) => t.enabled).length;

  const handlePullAll = useCallback(async () => {
    setActionLoading("pull");
    setActionError(null);
    try {
      await pullAll();
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const handleCheckDrift = useCallback(async () => {
    setDriftLoading(true);
    setActionError(null);
    try {
      const report = await fetchDriftReport();
      setDrift(report);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Drift check failed");
    } finally {
      setDriftLoading(false);
    }
  }, []);

  return (
    <div className="px-6 py-5 space-y-6 max-w-screen-xl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Fleet Dashboard
          </h1>
          {lastUpdated && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePullAll()}
            disabled={actionLoading === "pull" || loading}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            {actionLoading === "pull" ? (
              <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            Pull All
          </button>

          <button
            type="button"
            onClick={() => void handleCheckDrift()}
            disabled={driftLoading || loading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 border border-slate-700/40 disabled:opacity-50"
          >
            {driftLoading ? (
              <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            )}
            Check Drift
          </button>

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 border border-slate-700/40 disabled:opacity-50"
          >
            <svg
              className={cn("w-3.5 h-3.5", loading && "animate-spin")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 border border-rose-500/20 rounded-sm text-xs text-rose-400 mono">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          {actionError}
          <button type="button" onClick={() => setActionError(null)} className="ml-auto text-rose-400/60 hover:text-rose-400">×</button>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="hosts total"
          value={hosts.length}
          accent="cyan"
        />
        <StatTile
          label="online"
          value={onlineCount}
          sub={hosts.length > 0 ? `${Math.round((onlineCount / hosts.length) * 100)}%` : undefined}
          accent="green"
        />
        {degradedCount > 0 && (
          <StatTile label="degraded" value={degradedCount} accent="amber" />
        )}
        {errorCount > 0 && (
          <StatTile label="errors" value={errorCount} accent="red" />
        )}
        <StatTile
          label="tools enabled"
          value={toolsLoading ? "—" : enabledTools}
          sub={toolsLoading ? undefined : `of ${tools.length} total`}
          accent="cyan"
        />
      </div>

      {/* Fleet grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
            Host Status
          </h2>
          {error && (
            <span className="text-xs text-rose-400 mono">{error}</span>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 space-y-3 animate-pulse">
                <div className="h-4 bg-slate-700/50 rounded w-2/3" />
                <div className="h-3 bg-slate-700/40 rounded w-1/2" />
                <div className="h-3 bg-slate-700/30 rounded w-3/4" />
              </div>
            ))}
          </div>
        ) : hosts.length === 0 ? (
          <EmptyState
            title="No hosts configured"
            description="Add hosts to fleet.yaml or via the Host Manager to see status here."
            icon={
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
              </svg>
            }
            action={
              <Link to="/hosts" className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5">
                Manage Hosts →
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {hosts.map((host) => (
              <FleetHostCard key={host.name} host={host} />
            ))}
          </div>
        )}
      </section>

      {/* Drift report */}
      {drift && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
              Drift Report
            </h2>
            <button
              type="button"
              onClick={() => setDrift(null)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              dismiss
            </button>
          </div>
          <DriftSummary report={drift} />
        </section>
      )}

      {/* Tool overview */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
            Tool Overview
          </h2>
          <Link
            to="/tools"
            className="text-xs text-cyan-400/70 hover:text-cyan-400 transition-colors mono"
          >
            manage tools →
          </Link>
        </div>

        {toolsLoading ? (
          <div className="card p-4 animate-pulse h-12" />
        ) : tools.length === 0 ? (
          <EmptyState
            title="No tools configured"
            description="Add MCP tools via the Tool Manager."
            action={
              <Link to="/tools" className="btn-primary text-xs px-3 py-1.5 inline-flex">
                Add Tools →
              </Link>
            }
          />
        ) : (
          <div className="card p-4 grid grid-cols-3 divide-x divide-slate-700/30">
            {[
              { label: "Total", value: tools.length, color: "text-slate-300" },
              { label: "Enabled", value: enabledTools, color: "text-emerald-400" },
              { label: "Disabled", value: tools.length - enabledTools, color: "text-slate-500" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex flex-col items-center py-1 px-4">
                <span className={cn("text-2xl font-semibold mono", color)}>
                  {value}
                </span>
                <span className="text-[10px] mono uppercase tracking-wider text-slate-500 mt-0.5">
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity (placeholder) */}
      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
          Recent Activity
        </h2>
        <div className="card p-4 space-y-3">
          <div className="text-xs text-slate-600 mono italic">
            — activity feed will appear here when operations are performed —
          </div>
          {/* Placeholder rows */}
          {["fleet_status", "fleet_pull", "fleet_drift"].map((op, i) => (
            <div
              key={op}
              className="flex items-center gap-3 text-xs opacity-20 select-none"
            >
              <span className="mono text-slate-500 text-[10px]">
                {new Date(Date.now() - i * 300_000).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="mono text-cyan-400">{op}</span>
              <span className="text-slate-400">all hosts</span>
              <span className="ml-auto text-emerald-400">ok</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
