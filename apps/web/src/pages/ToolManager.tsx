import { useState, useMemo } from "react";
import { useTools } from "@/hooks/useTools";
import { ToolCard } from "@/components/ToolCard";
import { SlideOver } from "@/components/SlideOver";
import { SchemaEditor } from "@/components/SchemaEditor";
import { Badge } from "@/components/Badge";
import { Toggle } from "@/components/Toggle";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { Tool, ToolParam } from "@/api/client";

// ---------------------------------------------------------------------------
// Category badge variant
// ---------------------------------------------------------------------------
const categoryVariant = (cat: string): "cyan" | "green" | "amber" | "purple" | "slate" => {
  switch (cat.toLowerCase()) {
    case "gateway":     return "cyan";
    case "integration": return "green";
    case "skill":       return "amber";
    case "system":      return "purple";
    default:       return "slate";
  }
};

// ---------------------------------------------------------------------------
// Tool form (used for add + edit)
// ---------------------------------------------------------------------------
interface ToolFormState {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  params: ToolParam[];
}

const defaultFormState = (): ToolFormState => ({
  name: "",
  description: "",
  category: "gateway",
  enabled: true,
  params: [],
});

interface ToolFormProps {
  initial?: ToolFormState;
  onSubmit: (state: ToolFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

function ToolForm({ initial, onSubmit, onCancel, submitLabel = "Create Tool" }: ToolFormProps) {
  const [form, setForm] = useState<ToolFormState>(initial ?? defaultFormState());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ToolFormState>(k: K, v: ToolFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Tool name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tool");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Name <span className="text-rose-400">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="echo"
          className="input-base mono text-xs px-3 py-2 w-full"
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What this tool does..."
          rows={3}
          className="input-base text-xs px-3 py-2 w-full resize-none"
        />
      </div>

      {/* Category */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Category
        </label>
        <select
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          className="input-base mono text-xs px-3 py-2 w-full appearance-none"
        >
          {["gateway", "integration", "skill", "system", "other"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Enabled */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] mono uppercase tracking-wider text-slate-400">
          Enabled by default
        </label>
        <Toggle
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
          size="sm"
        />
      </div>

      {/* Schema / parameters */}
      <div className="space-y-2">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Input Parameters
        </label>
        <div className="bg-slate-950/40 border border-slate-700/30 rounded-sm p-3">
          <SchemaEditor
            params={form.params}
            onChange={(p) => set("params", p)}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          {submitting && (
            <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
          )}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tool detail panel
// ---------------------------------------------------------------------------
function ToolDetail({
  tool,
  onEdit,
  onDelete,
  onToggle,
  toggling,
}: {
  tool: Tool;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onToggle: (enabled: boolean) => Promise<void>;
  toggling: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm(`Delete tool "${tool.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {deleteError && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {deleteError}
        </div>
      )}

      {/* Meta */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={categoryVariant(tool.category)}>{tool.category}</Badge>
          {tool.builtIn && <Badge variant="slate">built-in</Badge>}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">{tool.description || "—"}</p>

        <div className="flex items-center justify-between py-2 border-t border-slate-700/30">
          <span className="text-xs text-slate-400">Enabled</span>
          <Toggle
            checked={tool.enabled}
            onChange={(v) => void onToggle(v)}
            disabled={toggling}
            size="sm"
          />
        </div>
      </div>

      {/* Schema */}
      <div className="space-y-2">
        <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">
          Input Parameters ({tool.schema.params.length})
        </h3>
        <div className="bg-slate-950/40 border border-slate-700/30 rounded-sm p-3">
          {tool.schema.params.length === 0 ? (
            <p className="text-xs text-slate-600 mono italic">No parameters defined</p>
          ) : (
            <SchemaEditor
              params={tool.schema.params}
              onChange={() => {/* read-only */}}
              readOnly
            />
          )}
        </div>
      </div>

      {/* Tool ID */}
      <div className="space-y-1">
        <span className="text-[10px] mono uppercase tracking-wider text-slate-500">ID</span>
        <p className="text-xs mono text-slate-400">{tool.id}</p>
      </div>

      {/* Actions */}
      {!tool.builtIn && (
        <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30">
          <button
            type="button"
            onClick={onEdit}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 border border-slate-700/40"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            {deleting ? (
              <span className="w-3 h-3 border border-rose-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            )}
            Delete
          </button>
        </div>
      )}
      {tool.builtIn && (
        <p className="text-xs text-slate-600 mono italic">Built-in tools cannot be edited or deleted.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolManager page
// ---------------------------------------------------------------------------
type Panel =
  | { type: "add" }
  | { type: "detail"; tool: Tool }
  | { type: "edit"; tool: Tool }
  | null;

export function ToolManager() {
  const { tools, loading, error, refresh, addTool, editTool, removeTool, toggleEnabled } = useTools();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [panel, setPanel] = useState<Panel>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(tools.map((t) => t.category))).sort()],
    [tools],
  );

  const filtered = useMemo(
    () =>
      tools.filter(
        (t) =>
          (categoryFilter === "all" || t.category === categoryFilter) &&
          (search === "" ||
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            t.description.toLowerCase().includes(search.toLowerCase())),
      ),
    [tools, categoryFilter, search],
  );

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      await toggleEnabled(id, enabled);
    } finally {
      setTogglingId(null);
    }
  };

  const handleAdd = async (form: ToolFormState) => {
    await addTool({
      name: form.name,
      description: form.description,
      category: form.category,
      enabled: form.enabled,
      schema: { params: form.params },
    });
    setPanel(null);
  };

  const handleEdit = async (id: string, form: ToolFormState) => {
    await editTool(id, {
      name: form.name,
      description: form.description,
      category: form.category,
      enabled: form.enabled,
      schema: { params: form.params },
    });
    setPanel(null);
  };

  const handleDelete = async (id: string) => {
    await removeTool(id);
    setPanel(null);
  };

  // Panel title / subtitle
  const panelTitle =
    panel?.type === "add"
      ? "Add Tool"
      : panel?.type === "edit"
      ? "Edit Tool"
      : panel?.type === "detail"
      ? panel.tool.name
      : "";

  const panelSubtitle =
    panel?.type === "detail"
      ? `${panel.tool.category} • ${panel.tool.schema.params.length} param${panel.tool.schema.params.length !== 1 ? "s" : ""}`
      : undefined;

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Tool Manager
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {tools.length} tools · {tools.filter((t) => t.enabled).length} enabled
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPanel({ type: "add" })}
          className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Tool
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            className="input-base text-xs pl-8 pr-3 py-1.5 w-full"
          />
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-1">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                "text-[10px] mono uppercase tracking-wider px-2 py-1 rounded-[2px] border transition-colors",
                categoryFilter === cat
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "border-slate-700/40 text-slate-500 hover:text-slate-300 hover:border-slate-600/40",
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="btn-ghost text-xs px-2 py-1.5 ml-auto flex items-center gap-1"
        >
          <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Tool grid */}
      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse h-28">
              <div className="h-3 bg-slate-700/50 rounded w-3/4" />
              <div className="h-3 bg-slate-700/40 rounded w-full" />
              <div className="h-3 bg-slate-700/30 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || categoryFilter !== "all" ? "No tools match your filters" : "No tools configured"}
          description={
            search || categoryFilter !== "all"
              ? "Try adjusting your search or category filter."
              : "Add your first tool to get started."
          }
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
            </svg>
          }
          action={
            <button
              type="button"
              onClick={() => setPanel({ type: "add" })}
              className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
            >
              Add Tool →
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {filtered.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onClick={() => setPanel({ type: "detail", tool })}
              onToggle={(enabled) => void handleToggle(tool.id, enabled)}
              toggling={togglingId === tool.id}
            />
          ))}
        </div>
      )}

      {/* Slide-over panel */}
      <SlideOver
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panelTitle}
        subtitle={panelSubtitle}
      >
        {panel?.type === "add" && (
          <ToolForm
            onSubmit={handleAdd}
            onCancel={() => setPanel(null)}
            submitLabel="Create Tool"
          />
        )}
        {panel?.type === "edit" && (
          <ToolForm
            initial={{
              name: panel.tool.name,
              description: panel.tool.description,
              category: panel.tool.category,
              enabled: panel.tool.enabled,
              params: panel.tool.schema.params,
            }}
            onSubmit={(form) => handleEdit(panel.tool.id, form)}
            onCancel={() => setPanel({ type: "detail", tool: panel.tool })}
            submitLabel="Save Changes"
          />
        )}
        {panel?.type === "detail" && (
          <ToolDetail
            tool={panel.tool}
            onEdit={() => setPanel({ type: "edit", tool: panel.tool })}
            onDelete={() => handleDelete(panel.tool.id)}
            onToggle={(enabled) => handleToggle(panel.tool.id, enabled)}
            toggling={togglingId === panel.tool.id}
          />
        )}
      </SlideOver>
    </div>
  );
}

