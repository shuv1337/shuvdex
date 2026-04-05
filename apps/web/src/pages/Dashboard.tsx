import { useDashboard } from "@/hooks/useDashboard";
import { Badge } from "@/components/Badge";
import { cn } from "@/lib/cn";

function StatCard({
  label,
  value,
  subtext,
  variant = "default",
}: {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const variantStyles = {
    default: "border-slate-700/30",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
  };

  return (
    <div className={cn("card p-4", variantStyles[variant])}>
      <p className="text-[10px] mono uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-100 mt-1">{value}</p>
      {subtext && <p className="text-xs text-slate-400 mt-1">{subtext}</p>}
    </div>
  );
}

function GovernanceScore({ score }: { score: number }) {
  let variant: "green" | "amber" | "red" = "red";
  if (score >= 80) variant = "green";
  else if (score >= 60) variant = "amber";

  return (
    <div className="card p-4">
      <p className="text-[10px] mono uppercase tracking-wider text-slate-500">Governance Score</p>
      <div className="flex items-center gap-3 mt-2">
        <div className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold",
          variant === "green" && "bg-emerald-500/20 text-emerald-400",
          variant === "amber" && "bg-amber-500/20 text-amber-400",
          variant === "red" && "bg-rose-500/20 text-rose-400",
        )}>
          {score}
        </div>
        <div className="flex-1">
          <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                variant === "green" && "bg-emerald-500",
                variant === "amber" && "bg-amber-500",
                variant === "red" && "bg-rose-500",
              )}
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {score >= 80 ? "Good governance posture" : score >= 60 ? "Needs attention" : "Critical issues"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { summary, health, loading, error, refresh } = useDashboard();

  if (loading) {
    return (
      <div className="px-6 py-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-5">
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
        <button onClick={refresh} className="btn-primary text-xs px-3 py-1.5 mt-3">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Dashboard
          </h1>
          <p className="text-xs text-slate-500 mono mt-0.5">
            System overview and governance metrics
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="btn-ghost text-xs px-2 py-1.5 flex items-center gap-1"
        >
          <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Connectors"
            value={summary.activeConnectors}
            subtext={`${summary.totalPolicies} policies configured`}
          />
          <StatCard
            label="Credentials"
            value={summary.totalCredentials}
            subtext={`${summary.totalBindings} bindings`}
          />
          <StatCard
            label="Upstreams"
            value={summary.upstreamCount}
            subtext={`${summary.healthyUpstreams} healthy, ${summary.unhealthyUpstreams} unhealthy`}
            variant={summary.unhealthyUpstreams > 0 ? "warning" : "success"}
          />
          <GovernanceScore score={summary.governanceScore} />
        </div>
      )}

      {/* Upstream Health */}
      {health && health.upstreams.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Upstream Health</h2>
          <div className="space-y-2">
            {health.upstreams.slice(0, 5).map((upstream) => (
              <div key={upstream.upstreamId} className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    upstream.healthStatus === "healthy" && "bg-emerald-400",
                    upstream.healthStatus === "degraded" && "bg-amber-400",
                    upstream.healthStatus === "unhealthy" && "bg-rose-400",
                    upstream.healthStatus === "unknown" && "bg-slate-400",
                  )} />
                  <span className="text-xs text-slate-200">{upstream.name}</span>
                  <Badge
                    variant={upstream.healthStatus === "healthy" ? "green" : upstream.healthStatus === "degraded" ? "amber" : "red"}
                    size="sm"
                  >
                    {upstream.healthStatus}
                  </Badge>
                </div>
                <span className="text-xs mono text-slate-500">{upstream.toolCount} tools</span>
              </div>
            ))}
          </div>
          {health.upstreams.length > 5 && (
            <p className="text-xs text-slate-500 mt-2">
              +{health.upstreams.length - 5} more upstreams
            </p>
          )}
        </div>
      )}

      {/* Audit Metrics */}
      {summary?.auditMetrics && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Audit Activity (24h)</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-100">{summary.auditMetrics.totalEvents}</p>
              <p className="text-[10px] mono uppercase text-slate-500">Total Events</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-emerald-400">{summary.auditMetrics.allowCount}</p>
              <p className="text-[10px] mono uppercase text-slate-500">Allowed</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-rose-400">{summary.auditMetrics.denyCount}</p>
              <p className="text-[10px] mono uppercase text-slate-500">Denied</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-amber-400">{summary.auditMetrics.approvalRequiredCount}</p>
              <p className="text-[10px] mono uppercase text-slate-500">Pending</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <a href="/packages" className="card p-3 hover:bg-slate-800/80 transition-colors">
          <p className="text-xs font-medium text-slate-200">Packages</p>
          <p className="text-[10px] text-slate-500">Browse capabilities</p>
        </a>
        <a href="/policies" className="card p-3 hover:bg-slate-800/80 transition-colors">
          <p className="text-xs font-medium text-slate-200">Policies</p>
          <p className="text-[10px] text-slate-500">Manage access control</p>
        </a>
        <a href="/credentials" className="card p-3 hover:bg-slate-800/80 transition-colors">
          <p className="text-xs font-medium text-slate-200">Credentials</p>
          <p className="text-[10px] text-slate-500">API keys & tokens</p>
        </a>
        <a href="/audit" className="card p-3 hover:bg-slate-800/80 transition-colors">
          <p className="text-xs font-medium text-slate-200">Audit Log</p>
          <p className="text-[10px] text-slate-500">Review events</p>
        </a>
      </div>
    </div>
  );
}
