import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg";
}

const widthMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "md",
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (open) {
      const el = panelRef.current?.querySelector<HTMLElement>(
        "button, input, select, textarea, [tabindex]",
      );
      el?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-full flex-col animate-slide-in">
        <div
          ref={panelRef}
          className={cn(
            "ml-auto h-full w-full flex flex-col",
            "bg-slate-900 border-l border-slate-700/50 shadow-2xl shadow-black/50",
            widthMap[width],
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-slate-700/50">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              {subtitle && (
                <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-4 mt-0.5 text-slate-500 hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm p-0.5"
              aria-label="Close panel"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="border-t border-slate-700/50 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
