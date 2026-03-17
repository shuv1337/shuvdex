import { cn } from "@/lib/cn";
import type { ToolParam, ToolParamType } from "@/api/client";

interface SchemaEditorProps {
  params: ToolParam[];
  onChange: (params: ToolParam[]) => void;
  readOnly?: boolean;
}

const PARAM_TYPES: ToolParamType[] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
];

export function SchemaEditor({
  params,
  onChange,
  readOnly = false,
}: SchemaEditorProps) {
  const updateParam = (index: number, updates: Partial<ToolParam>) => {
    const next = params.map((p, i) => (i === index ? { ...p, ...updates } : p));
    onChange(next);
  };

  const removeParam = (index: number) => {
    onChange(params.filter((_, i) => i !== index));
  };

  const addParam = () => {
    onChange([
      ...params,
      { name: "", type: "string", description: "", optional: false },
    ]);
  };

  return (
    <div className="space-y-3">
      {/* Column headers */}
      {params.length > 0 && (
        <div className="grid grid-cols-[1fr_100px_1fr_auto_auto] gap-2 px-1">
          {["name", "type", "description", "opt", ""].map((h) => (
            <span key={h} className="text-[10px] mono uppercase tracking-wider text-slate-500">
              {h}
            </span>
          ))}
        </div>
      )}

      {/* Param rows */}
      <div className="space-y-2">
        {params.map((param, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_100px_1fr_auto_auto] gap-2 items-center"
          >
            {/* Name */}
            <input
              type="text"
              value={param.name}
              placeholder="param_name"
              disabled={readOnly}
              onChange={(e) => updateParam(i, { name: e.target.value })}
              className={cn(
                "input-base text-xs mono px-2 py-1.5 w-full",
                readOnly && "opacity-60 cursor-default",
              )}
            />

            {/* Type */}
            <select
              value={param.type}
              disabled={readOnly}
              onChange={(e) =>
                updateParam(i, { type: e.target.value as ToolParamType })
              }
              className={cn(
                "input-base text-xs mono px-2 py-1.5 w-full appearance-none",
                readOnly && "opacity-60 cursor-default",
              )}
            >
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {/* Description */}
            <input
              type="text"
              value={param.description}
              placeholder="Description"
              disabled={readOnly}
              onChange={(e) => updateParam(i, { description: e.target.value })}
              className={cn(
                "input-base text-xs px-2 py-1.5 w-full",
                readOnly && "opacity-60 cursor-default",
              )}
            />

            {/* Optional */}
            <label className="flex items-center justify-center cursor-pointer">
              <input
                type="checkbox"
                checked={param.optional}
                disabled={readOnly}
                onChange={(e) => updateParam(i, { optional: e.target.checked })}
                className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                title="Optional"
              />
            </label>

            {/* Remove */}
            {!readOnly ? (
              <button
                type="button"
                onClick={() => removeParam(i)}
                className="text-slate-600 hover:text-rose-400 transition-colors p-1 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
                aria-label="Remove parameter"
              >
                <svg
                  className="w-3.5 h-3.5"
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
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>

      {/* Add button */}
      {!readOnly && (
        <button
          type="button"
          onClick={addParam}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors mt-1 py-1 px-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded-sm"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Add parameter
        </button>
      )}

      {/* Schema preview */}
      {params.length > 0 && (
        <details className="group">
          <summary className="text-[10px] mono uppercase tracking-wider text-slate-500 hover:text-slate-400 cursor-pointer select-none transition-colors">
            schema preview
          </summary>
          <pre className="mt-2 text-[11px] mono text-slate-400 bg-slate-950/60 border border-slate-700/30 rounded-sm p-3 overflow-x-auto leading-relaxed">
            {JSON.stringify(
              {
                type: "object",
                properties: Object.fromEntries(
                  params
                    .filter((p) => p.name)
                    .map((p) => [
                      p.name,
                      {
                        type: p.type,
                        description: p.description || undefined,
                      },
                    ]),
                ),
                required: params
                  .filter((p) => p.name && !p.optional)
                  .map((p) => p.name),
              },
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </div>
  );
}
