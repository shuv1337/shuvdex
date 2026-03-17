import { useState, useCallback } from "react";
import { useSkills } from "@/hooks/useSkills";
import { useHosts } from "@/hooks/useHosts";
import { SkillMatrix } from "@/components/SkillMatrix";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Drift report display
// ---------------------------------------------------------------------------
import type { DriftReport } from "@/api/client";

function DriftPanel({ report, onDismiss }: { report: DriftReport; onDismiss: () => void }) {
  const inSync = report.hosts.filter((h) => h.status === "in-sync").length;
  const drifted = report.hosts.filter((h) => h.status === "drifted").length;
  const errors = report.hosts.filter((h) => h.status === "error").length;

  return (
    <div className="card overflow-hidden">
      {/* Drift header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/40 bg-slate-800/30">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mono">
            Drift Report
          </h3>
          <div className="flex items-center gap-2 text-[10px] mono">
            <span className="text-slate-500">reference:</span>
            <span className="text-slate-300">{report.referenceHost}</span>
            <span className="text-slate-600">@</span>
            <span className="text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-[2px] border border-slate-700/50">
              {report.referenceHead.slice(0, 7)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-[10px] mono">
            <span className="text-emerald-400">{inSync} in-sync</span>
            {drifted > 0 && <span className="text-amber-400">{drifted} drifted</span>}
            {errors > 0 && <span className="text-rose-400">{errors} error{errors !== 1 ? "s" : ""}</span>}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            dismiss
          </button>
        </div>
      </div>

      {/* Drift rows */}
      <div className="divide-y divide-slate-800/40">
        {report.hosts.map((h) => (
          <div key={h.name} className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <StatusDot
                status={
                  h.status === "in-sync"
                    ? "online"
                    : h.status === "drifted"
                    ? "degraded"
                    : "error"
                }
                size="sm"
              />
              <span className="text-xs mono text-slate-300">{h.name}</span>
              <span className="text-xs mono text-slate-500">{h.hostname}</span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              {h.head && (
                <span className="text-xs mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-[2px] border border-slate-700/50">
                  {h.head.slice(0, 7)}
                </span>
              )}
              {h.status === "in-sync" && (
                <span className="text-[10px] mono uppercase tracking-wider text-emerald-400">
                  in sync
                </span>
              )}
              {h.status === "drifted" && (
                <span className="text-[10px] mono uppercase tracking-wider text-amber-400">
                  {h.commitsBehind !== undefined ? `${h.commitsBehind} behind` : "drifted"}
                </span>
              )}
              {h.status === "error" && (
                <span
                  className="text-[10px] mono uppercase tracking-wider text-rose-400 truncate max-w-[200px]"
                  title={h.error}
                >
                  {h.error ?? "error"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillOps page
// ---------------------------------------------------------------------------
export function SkillOps() {
  const {
    skills,
    driftReport,
    loading,
    driftLoading,
    error,
    refresh,
    activate,
    deactivate,
    sync,
    pull,
    loadDrift,
  } = useSkills();

  const { hosts, loading: hostsLoading } = useHosts();

  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedHosts, setSelectedHosts] = useState<string[]>([]);
  const [drift, setDrift] = useState(driftReport);

  // Keep drift in sync with hook
  if (driftReport !== null && drift === null) {
    setDrift(driftReport);
  }

  const hostNames = hosts.map((h) => h.name);

  const handleCellToggle = useCallback(
    async (skill: string, host: string, current: boolean) => {
      const key = `${skill}:${host}`;
      setToggling((prev) => new Set([...prev, key]));
      try {
        if (current) {
          await deactivate(skill, [host]);
        } else {
          await activate(skill, [host]);
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Operation failed");
      } finally {
        setToggling((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [activate, deactivate],
  );

  const handleSyncAll = async () => {
    setActionLoading("sync");
    setActionError(null);
    try {
      await sync(selectedHosts.length > 0 ? selectedHosts : undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePullAll = async () => {
    setActionLoading("pull");
    setActionError(null);
    try {
      await pull(selectedHosts.length > 0 ? selectedHosts : undefined);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Pull failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckDrift = async () => {
    setActionError(null);
    await loadDrift();
    setDrift(driftReport);
  };

  const toggleHostFilter = (name: string) => {
    setSelectedHosts((prev) =>
      prev.includes(name) ? prev.filter((h) => h !== name) : [...prev, name],
    );
  };

  // Stats
  const totalSkills = skills.length;
  const allHosts = Array.from(
    new Set(skills.flatMap((s) => Object.keys(s.hosts))),
  );
  const activeCount = skills.reduce(
    (acc, s) => acc + Object.values(s.hosts).filter(Boolean).length,
    0,
  );

  return (
    <div className="px-6 py-5 space-y-6 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Skill Operations
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {totalSkills} skills · {activeCount} activations across {allHosts.length} host
              {allHosts.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePullAll()}
            disabled={actionLoading === "pull"}
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
            onClick={() => void handleSyncAll()}
            disabled={actionLoading === "sync"}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 border border-slate-700/40 disabled:opacity-50"
          >
            {actionLoading === "sync" ? (
              <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 004.5 9.75v7.5a2.25 2.25 0 002.25 2.25h7.5a2.25 2.25 0 002.25-2.25v-7.5a2.25 2.25 0 00-2.25-2.25h-.75m0-3l-3-3m0 0l-3 3m3-3v11.25m6-2.25h.75a2.25 2.25 0 012.25 2.25v7.5a2.25 2.25 0 01-2.25 2.25h-7.5a2.25 2.25 0 01-2.25-2.25v-.75" />
              </svg>
            )}
            Sync All
          </button>

          <button
            type="button"
            onClick={() => void handleCheckDrift()}
            disabled={driftLoading}
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
            className="btn-ghost p-1.5 border border-slate-700/40"
          >
            <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
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
          <button type="button" onClick={() => setActionError(null)} className="ml-auto">×</button>
        </div>
      )}

      {/* Host filter */}
      {!hostsLoading && hostNames.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500 shrink-0">
            Target hosts:
          </span>
          <button
            type="button"
            onClick={() => setSelectedHosts([])}
            className={cn(
              "text-[10px] mono uppercase tracking-wider px-2 py-1 rounded-[2px] border transition-colors",
              selectedHosts.length === 0
                ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                : "border-slate-700/40 text-slate-500 hover:text-slate-300",
            )}
          >
            all
          </button>
          {hostNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleHostFilter(name)}
              className={cn(
                "text-[10px] mono px-2 py-1 rounded-[2px] border transition-colors",
                selectedHosts.includes(name)
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "border-slate-700/40 text-slate-500 hover:text-slate-300",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Skill matrix */}
      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
          Skill Activation Matrix
        </h2>

        {loading ? (
          <div className="card p-8 animate-pulse">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-4 bg-slate-700/40 rounded w-full" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="card p-4 text-xs text-rose-400 mono">{error}</div>
        ) : skills.length === 0 ? (
          <EmptyState
            title="No skills discovered"
            description="Skills will appear here once the fleet API is connected and skills are available on configured hosts."
            icon={
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
            }
          />
        ) : (
          <div className="card overflow-hidden px-4 py-3">
            <SkillMatrix
              skills={skills}
              onToggle={(skill, host, current) =>
                void handleCellToggle(skill, host, current)
              }
              toggling={toggling}
            />
          </div>
        )}
      </section>

      {/* Drift report */}
      {drift && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mono">
            Drift Report
          </h2>
          <DriftPanel report={drift} onDismiss={() => setDrift(null)} />
        </section>
      )}

      {/* Legend */}
      <section className="flex items-center gap-6 text-[10px] mono text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-[2px]">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </span>
          active
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 bg-slate-800/60 text-slate-600 border border-slate-700/30 rounded-[2px]">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
          inactive
        </div>
        <span>click any cell to toggle activation</span>
      </section>
    </div>
  );
}
