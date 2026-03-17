import { cn } from "@/lib/cn";
import { StatusDot, type Status } from "@/components/StatusDot";
import { Badge } from "@/components/Badge";
import type { HostConfig } from "@/api/client";
import type { HostStatusRecord } from "@/api/client";

interface HostCardProps {
  host: HostConfig;
  status?: HostStatusRecord;
  onClick?: () => void;
  onPing?: () => void;
  pinging?: boolean;
  className?: string;
}

function getStatus(record?: HostStatusRecord): Status {
  if (!record) return "unknown";
  return record.status;
}

export function HostCard({
  host,
  status,
  onClick,
  onPing,
  pinging = false,
  className,
}: HostCardProps) {
  const hostStatus = getStatus(status);

  return (
    <div
      className={cn(
        "card group relative flex flex-col gap-3 p-4 cursor-pointer",
        "hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150",
        className,
      )}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={hostStatus} pulse={hostStatus === "online"} />
            <span className="text-sm font-semibold text-slate-100 truncate">
              {host.name}
            </span>
          </div>
          <p className="mt-0.5 text-xs mono text-slate-400 truncate">
            {host.hostname}
          </p>
        </div>
        <Badge variant="slate" size="sm">
          {host.connectionType}
        </Badge>
      </div>

      {/* Git info */}
      {status && (
        <div className="flex items-center gap-3 text-xs mono">
          {status.head && (
            <span
              title={status.head}
              className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded-[2px] border border-slate-700/50"
            >
              {status.head.slice(0, 7)}
            </span>
          )}
          {status.branch && (
            <span className="text-slate-400 truncate">{status.branch}</span>
          )}
          {status.dirty && (
            <span className="text-amber-400 font-medium">dirty</span>
          )}
        </div>
      )}

      {/* Connection details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5 text-slate-500">
          <span>port</span>
          <span className="mono text-slate-400">{host.port}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <span>timeout</span>
          <span className="mono text-slate-400">{host.timeout}s</span>
        </div>
        {host.user && (
          <div className="flex items-center gap-1.5 text-slate-500 col-span-2">
            <span>user</span>
            <span className="mono text-slate-400">{host.user}</span>
          </div>
        )}
      </div>

      {/* Error */}
      {status?.error && (
        <p className="text-xs text-rose-400 mono truncate">{status.error}</p>
      )}

      {/* Actions */}
      {onPing && (
        <div className="flex items-center gap-2 pt-1 border-t border-slate-700/30">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPing();
            }}
            disabled={pinging}
            className="btn-ghost text-xs px-2 py-1 flex items-center gap-1.5 disabled:opacity-50"
          >
            {pinging ? (
              <>
                <span className="w-2.5 h-2.5 border border-slate-500 border-t-slate-300 rounded-full animate-spin" />
                checking...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                check status
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
