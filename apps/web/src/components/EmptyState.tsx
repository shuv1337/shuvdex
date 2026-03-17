import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-8 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 text-slate-600 [&>svg]:w-10 [&>svg]:h-10">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
