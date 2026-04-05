import { useState } from "react";
import { usePolicies } from "@/hooks/usePolicies";
import { SlideOver } from "@/components/SlideOver";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { CapabilitySubjectPolicy } from "@/api/client";

// ============================================================================
// Risk Level Badge
// ============================================================================

function RiskBadge({ level }: { level?: "low" | "medium" | "high" }) {
  if (!level) return <Badge variant="slate" size="sm">any</Badge>;
  const variant = level === "low" ? "green" : level === "medium" ? "amber" : "red";
  return <Badge variant={variant} size="sm">{level}</Badge>;
}

// ============================================================================
// Policy Card
// ============================================================================

interface PolicyCardProps {
  policy: CapabilitySubjectPolicy;
  onClick?: () => void;
}

function PolicyCard({ policy, onClick }: PolicyCardProps) {
  return (
    <div
      className={cn(
        "card p-4 hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150 cursor-pointer",
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-100">{policy.id}</span>
          <p className="text-xs text-slate-400 leading-relaxed mt-1">{policy.description}</p>
        </div>
        <RiskBadge level={policy.maxRiskLevel} />
      </div>
      
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-700/30 flex-wrap">
        {policy.scopes.length > 0 && (
          <span className="text-[10px] mono text-slate-500">
            {policy.scopes.length} scope{policy.scopes.length !== 1 ? "s" : ""}
          </span>
        )}
        {policy.allowPackages.length > 0 && (
          <span className="text-[10px] mono text-slate-500">
            {policy.allowPackages.length} allowed
          </span>
        )}
        {policy.denyPackages.length > 0 && (
          <span className="text-[10px] mono text-rose-400">
            {policy.denyPackages.length} denied
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Policy Form
// ============================================================================

interface PolicyFormProps {
  initial?: CapabilitySubjectPolicy;
  onSubmit: (policy: CapabilitySubjectPolicy) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}

function PolicyForm({ initial, onSubmit, onCancel, submitLabel = "Save Policy" }: PolicyFormProps) {
  const [form, setForm] = useState<CapabilitySubjectPolicy>(
    initial ?? {
      id: "",
      description: "",
      scopes: [],
      hostTags: [],
      clientTags: [],
      allowPackages: [],
      denyPackages: [],
      allowCapabilities: [],
      denyCapabilities: [],
    }
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CapabilitySubjectPolicy>(k: K, v: CapabilitySubjectPolicy[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const parseList = (value: string): string[] =>
    value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id.trim()) {
      setError("Policy ID is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
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

      {/* ID */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Policy ID <span className="text-rose-400">*</span>
        </label>
        <input
          type="text"
          value={form.id}
          onChange={(e) => set("id", e.target.value)}
          placeholder="my-policy"
          disabled={!!initial}
          className="input-base mono text-xs px-3 py-2 w-full disabled:opacity-50"
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
          placeholder="What this policy controls..."
          rows={2}
          className="input-base text-xs px-3 py-2 w-full resize-none"
        />
      </div>

      {/* Max Risk Level */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Max Risk Level
        </label>
        <select
          value={form.maxRiskLevel ?? ""}
          onChange={(e) => set("maxRiskLevel", (e.target.value || undefined) as "low" | "medium" | "high" | undefined)}
          className="input-base mono text-xs px-3 py-2 w-full appearance-none"
        >
          <option value="">Any (no limit)</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      {/* Scopes */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Scopes (one per line or comma-separated)
        </label>
        <textarea
          value={form.scopes.join("\n")}
          onChange={(e) => set("scopes", parseList(e.target.value))}
          placeholder="read&#10;write&#10;admin"
          rows={3}
          className="input-base text-xs px-3 py-2 w-full resize-none mono"
        />
      </div>

      {/* Allowed Packages */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Allowed Packages (one per line or comma-separated)
        </label>
        <textarea
          value={form.allowPackages.join("\n")}
          onChange={(e) => set("allowPackages", parseList(e.target.value))}
          placeholder="package-id-1&#10;package-id-2"
          rows={3}
          className="input-base text-xs px-3 py-2 w-full resize-none mono"
        />
      </div>

      {/* Denied Packages */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Denied Packages (one per line or comma-separated)
        </label>
        <textarea
          value={form.denyPackages.join("\n")}
          onChange={(e) => set("denyPackages", parseList(e.target.value))}
          placeholder="package-id-3&#10;package-id-4"
          rows={3}
          className="input-base text-xs px-3 py-2 w-full resize-none mono"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-700/30">
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

// ============================================================================
// Policy Detail
// ============================================================================

function PolicyDetail({
  policy,
  onEdit,
  onDelete,
}: {
  policy: CapabilitySubjectPolicy;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete policy "${policy.id}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <RiskBadge level={policy.maxRiskLevel} />
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">{policy.description || "—"}</p>
      </div>

      {/* Scopes */}
      {policy.scopes.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">Scopes</h3>
          <div className="flex flex-wrap gap-1">
            {policy.scopes.map((scope) => (
              <Badge key={scope} variant="cyan" size="sm">{scope}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Allowed */}
      {policy.allowPackages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">Allowed Packages</h3>
          <div className="flex flex-wrap gap-1">
            {policy.allowPackages.map((pkg) => (
              <Badge key={pkg} variant="green" size="sm">{pkg}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Denied */}
      {policy.denyPackages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">Denied Packages</h3>
          <div className="flex flex-wrap gap-1">
            {policy.denyPackages.map((pkg) => (
              <Badge key={pkg} variant="red" size="sm">{pkg}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Allowed Capabilities */}
      {policy.allowCapabilities.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">Allowed Capabilities</h3>
          <div className="flex flex-wrap gap-1">
            {policy.allowCapabilities.map((cap) => (
              <Badge key={cap} variant="green" size="sm">{cap}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Denied Capabilities */}
      {policy.denyCapabilities.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">Denied Capabilities</h3>
          <div className="flex flex-wrap gap-1">
            {policy.denyCapabilities.map((cap) => (
              <Badge key={cap} variant="red" size="sm">{cap}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244-2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          )}
          Delete
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Policies Page
// ============================================================================

export function Policies() {
  const { policies, loading, error, refresh, addPolicy, editPolicy, removePolicy } = usePolicies();
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<
    | { type: "add" }
    | { type: "edit"; policy: CapabilitySubjectPolicy }
    | { type: "detail"; policy: CapabilitySubjectPolicy }
    | null
  >(null);

  const filtered = policies.filter(
    (p) =>
      search === "" ||
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = async (form: CapabilitySubjectPolicy) => {
    await addPolicy(form);
    setPanel(null);
  };

  const handleEdit = async (form: CapabilitySubjectPolicy) => {
    await editPolicy(form);
    setPanel(null);
  };

  const handleDelete = async (id: string) => {
    await removePolicy(id);
    setPanel(null);
  };

  const panelTitle =
    panel?.type === "add"
      ? "Add Policy"
      : panel?.type === "edit"
      ? "Edit Policy"
      : panel?.type === "detail"
      ? panel.policy.id
      : "";

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Policies
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {policies.length} policies defined
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setPanel({ type: "add" })}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Policy
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
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
          placeholder="Search policies..."
          className="input-base text-xs pl-8 pr-3 py-1.5 w-full"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse h-28" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? "No policies match your search" : "No policies defined"}
          description={search ? "Try adjusting your search." : "Create your first policy to control access."}
          action={
            !search && (
              <button
                type="button"
                onClick={() => setPanel({ type: "add" })}
                className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
              >
                Add Policy →
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {filtered.map((policy) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              onClick={() => setPanel({ type: "detail", policy })}
            />
          ))}
        </div>
      )}

      {/* Slide-over */}
      <SlideOver
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panelTitle}
        width="md"
      >
        {panel?.type === "add" && (
          <PolicyForm
            onSubmit={handleAdd}
            onCancel={() => setPanel(null)}
            submitLabel="Create Policy"
          />
        )}
        {panel?.type === "edit" && (
          <PolicyForm
            initial={panel.policy}
            onSubmit={handleEdit}
            onCancel={() => setPanel({ type: "detail", policy: panel.policy })}
            submitLabel="Save Changes"
          />
        )}
        {panel?.type === "detail" && (
          <PolicyDetail
            policy={panel.policy}
            onEdit={() => setPanel({ type: "edit", policy: panel.policy })}
            onDelete={() => handleDelete(panel.policy.id)}
          />
        )}
      </SlideOver>
    </div>
  );
}
