import { cn } from "@/lib/cn";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  label,
  className,
  onClick,
}: ToggleProps) {
  const trackSize = size === "sm" ? "w-7 h-4" : "w-9 h-5";
  const thumbSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  const thumbTranslate = size === "sm"
    ? (checked ? "translate-x-3.5" : "translate-x-0.5")
    : (checked ? "translate-x-4.5" : "translate-x-0.5");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => { onClick?.(e); if (!disabled) onChange(!checked); }}
      disabled={disabled}
      className={cn(
        "relative inline-flex items-center rounded-full transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        trackSize,
        checked
          ? "bg-cyan-500/80 border border-cyan-400/50"
          : "bg-slate-700 border border-slate-600/50",
        disabled && "opacity-40 cursor-not-allowed",
        !disabled && "cursor-pointer",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow-sm transition-transform duration-200",
          thumbSize,
          thumbTranslate,
        )}
      />
    </button>
  );
}
