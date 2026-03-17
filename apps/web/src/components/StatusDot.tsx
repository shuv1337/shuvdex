import { cn } from "@/lib/cn";

export type Status = "online" | "degraded" | "error" | "unknown";

interface StatusDotProps {
  status: Status;
  pulse?: boolean;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const statusConfig: Record<Status, { dot: string; label: string; ring: string }> = {
  online: {
    dot: "bg-emerald-400",
    ring: "ring-emerald-400/30",
    label: "online",
  },
  degraded: {
    dot: "bg-amber-400",
    ring: "ring-amber-400/30",
    label: "degraded",
  },
  error: {
    dot: "bg-rose-400",
    ring: "ring-rose-400/30",
    label: "error",
  },
  unknown: {
    dot: "bg-slate-500",
    ring: "ring-slate-500/30",
    label: "unknown",
  },
};

const sizeMap = {
  sm: "w-1.5 h-1.5",
  md: "w-2 h-2",
  lg: "w-2.5 h-2.5",
};

export function StatusDot({
  status,
  pulse = false,
  size = "md",
  showLabel = false,
  className,
}: StatusDotProps) {
  const cfg = statusConfig[status];

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative inline-flex">
        <span
          className={cn(
            "rounded-full ring-2",
            sizeMap[size],
            cfg.dot,
            cfg.ring,
          )}
        />
        {pulse && status === "online" && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-60",
              cfg.dot,
            )}
          />
        )}
      </span>
      {showLabel && (
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider mono">
          {cfg.label}
        </span>
      )}
    </span>
  );
}
