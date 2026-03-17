import { cn } from "@/lib/cn";

type BadgeVariant =
  | "default"
  | "cyan"
  | "green"
  | "amber"
  | "red"
  | "slate"
  | "purple";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  className?: string;
}

const variantMap: Record<BadgeVariant, string> = {
  default: "bg-slate-700/60 text-slate-300 border-slate-600/40",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  slate: "bg-slate-800/60 text-slate-400 border-slate-700/40",
  purple: "bg-violet-500/10 text-violet-400 border-violet-500/30",
};

const sizeMap = {
  sm: "px-1.5 py-0.5 text-[10px] leading-none",
  md: "px-2 py-0.5 text-xs",
};

export function Badge({
  children,
  variant = "default",
  size = "md",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium border rounded-[2px] mono tracking-wide uppercase",
        variantMap[variant],
        sizeMap[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
