import { cn } from "@/lib/cn";
import { Badge } from "@/components/Badge";
import { Toggle } from "@/components/Toggle";
import type { Tool } from "@/api/client";

interface ToolCardProps {
  tool: Tool;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
  toggling?: boolean;
  className?: string;
}

const categoryVariant = (cat: string): "cyan" | "green" | "amber" | "purple" | "slate" => {
  switch (cat.toLowerCase()) {
    case "gateway":
      return "cyan";
    case "integration":
      return "green";
    case "skill":
      return "amber";
    case "system":
      return "purple";
    default:
      return "slate";
  }
};

export function ToolCard({
  tool,
  onClick,
  onToggle,
  toggling = false,
  className,
}: ToolCardProps) {
  return (
    <div
      className={cn(
        "card group flex flex-col gap-2 p-4",
        "hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150",
        onClick && "cursor-pointer",
        !tool.enabled && "opacity-60",
        className,
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-100 truncate">
            {tool.name}
          </span>
          {tool.builtIn && (
            <Badge variant="slate" size="sm">built-in</Badge>
          )}
        </div>

        <Toggle
          checked={tool.enabled}
          onChange={(v) => {
            onToggle?.(v);
          }}
          disabled={toggling}
          size="sm"
          label={`Toggle ${tool.name}`}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        />
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
        {tool.description}
      </p>

      {/* Footer */}
      <div className="flex items-center gap-2 mt-auto pt-1">
        <Badge variant={categoryVariant(tool.category)} size="sm">
          {tool.category}
        </Badge>
        <span className="text-xs mono text-slate-500">
          {tool.schema.params.length} param{tool.schema.params.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
