import { useState } from "react";
import { useOpenApiSources } from "@/hooks/useOpenApiSources";
import { SlideOver } from "@/components/SlideOver";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { OpenApiSource, OpenApiInspectionResult } from "@/api/client";

// ============================================================================
// Source Card
// ============================================================================

interface SourceCardProps {
  source: OpenApiSource;
  onClick?: () => void;
}

function SourceCard({ source, onClick }: SourceCardProps) {
  return (
    <div
      className={cn(
        "card p-4 hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150 cursor-pointer",
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-100 truncate">{source.title}</span>
          {source.description && (
            <p className="text-xs text-slate-400 leading-relaxed mt-1 line-clamp-2">{source.description}</p>
          )}
        </div>
        <Badge variant="amber" size="sm">OpenAPI</Badge>
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700/30">
        <span className="text-xs mono text-slate-500 truncate flex-1">{source.specUrl}</span>
      </div>
      
      <div className="flex items-center gap-2 mt-2">
        {source.lastSyncedAt ? (
          <span className="text-[10px] mono text-slate-500">
            Synced {new Date(source.lastSyncedAt).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-[10px] mono text-amber-400">Never synced</span>
        )}
        {source.operationCount !== undefined && (
          <span className="text-[10px] mono text-slate-500">
            {source.operationCount} operations
          </span>
        )}
      </div>
      
      {source.tags && source.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {source.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
          {source.tags.length > 3 && (
            <span className="text-[10px] text-slate-500">+{source.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Inspection Result Panel
// ============================================================================

function InspectionResult({ result }: { result: OpenApiInspectionResult }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-emerald-400">Inspection Results</h3>
        <p className="text-xs text-slate-400">{result.title}</p>
        {result.description && <p className="text-xs text-slate-500">{result.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3 text-center">
          <p className="text-lg font-semibold text-slate-100">{result.operations.length}</p>
          <p className="text-[10px] mono uppercase text-slate-500">Operations</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-semibold text-slate-100">{result.estimatedCapabilityCount}</p>
          <p className="text-[10px] mono uppercase text-slate-500">Est. Capabilities</p>
        </div>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] mono uppercase tracking-wider text-slate-500">Warnings</h4>
          {result.warnings.map((warning, i) => (
            <div key={i} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-sm px-3 py-2">
              {warning}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-[10px] mono uppercase tracking-wider text-slate-500">Operations</h4>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {result.operations.slice(0, 20).map((op) => (
            <div key={op.operationId} className="flex items-center gap-2 text-xs border border-slate-700/30 rounded-sm px-2 py-1">
              <Badge variant={op.method === "get" ? "cyan" : op.method === "post" ? "green" : op.method === "delete" ? "red" : "amber"} size="sm">
                {op.method.toUpperCase()}
              </Badge>
              <span className="text-slate-400 truncate flex-1">{op.path}</span>
              <span className="text-slate-500 truncate">{op.operationId}</span>
            </div>
          ))}
          {result.operations.length > 20 && (
            <p className="text-xs text-slate-500 text-center">
              +{result.operations.length - 20} more operations
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Add Source Form
// ============================================================================

interface AddSourceFormProps {
  onInspect: (params: {
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    selectedServerUrl: string;
    credentialId?: string;
  }) => Promise<OpenApiInspectionResult | null>;
  onCompile: (params: {
    specUrl: string;
    title: string;
    description?: string;
    tags?: string[];
    selectedServerUrl: string;
    credentialId?: string;
    defaultRiskLevel?: "low" | "medium" | "high";
  }) => Promise<unknown>;
  onCancel: () => void;
}

function AddSourceForm({ onInspect, onCompile, onCancel }: AddSourceFormProps) {
  const [form, setForm] = useState({
    specUrl: "",
    title: "",
    description: "",
    tags: "",
    selectedServerUrl: "",
    credentialId: "",
    defaultRiskLevel: "medium" as "low" | "medium" | "high",
  });
  const [inspection, setInspection] = useState<OpenApiInspectionResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseTags = (value: string): string[] =>
    value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.specUrl || !form.title) {
      setError("Spec URL and title are required");
      return;
    }
    setInspecting(true);
    setError(null);
    try {
      const result = await onInspect({
        specUrl: form.specUrl,
        title: form.title,
        description: form.description || undefined,
        tags: parseTags(form.tags),
        selectedServerUrl: form.selectedServerUrl || form.specUrl.replace(/\/spec.*$/, "").replace(/\/openapi.*$/, ""),
        credentialId: form.credentialId || undefined,
      });
      if (result) {
        setInspection(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspection failed");
    } finally {
      setInspecting(false);
    }
  };

  const handleCompile = async () => {
    setCompiling(true);
    setError(null);
    try {
      await onCompile({
        specUrl: form.specUrl,
        title: form.title,
        description: form.description || undefined,
        tags: parseTags(form.tags),
        selectedServerUrl: form.selectedServerUrl || form.specUrl.replace(/\/spec.*$/, "").replace(/\/openapi.*$/, ""),
        credentialId: form.credentialId || undefined,
        defaultRiskLevel: form.defaultRiskLevel,
      });
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  };

  if (inspection) {
    return (
      <div className="space-y-5">
        <InspectionResult result={inspection} />
        
        {error && (
          <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
            {error}
          </div>
        )}
        
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-700/30">
          <button
            type="button"
            onClick={() => setInspection(null)}
            className="btn-ghost text-xs px-3 py-1.5"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void handleCompile()}
            disabled={compiling}
            className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
          >
            {compiling && (
              <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
            )}
            Compile to Package
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleInspect(e)} className="space-y-5">
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Spec URL <span className="text-rose-400">*</span>
        </label>
        <input
          type="url"
          value={form.specUrl}
          onChange={(e) => setForm({ ...form, specUrl: e.target.value })}
          placeholder="https://api.example.com/openapi.json"
          className="input-base mono text-xs px-3 py-2 w-full"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Title <span className="text-rose-400">*</span>
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="My API"
          className="input-base text-xs px-3 py-2 w-full"
          required
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Description of the API..."
          rows={2}
          className="input-base text-xs px-3 py-2 w-full resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Tags (comma or newline separated)
        </label>
        <textarea
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
          placeholder="api, production, v1"
          rows={2}
          className="input-base text-xs px-3 py-2 w-full resize-none"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Credential ID (optional)
        </label>
        <input
          type="text"
          value={form.credentialId}
          onChange={(e) => setForm({ ...form, credentialId: e.target.value })}
          placeholder="my-credential"
          className="input-base mono text-xs px-3 py-2 w-full"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Default Risk Level
        </label>
        <select
          value={form.defaultRiskLevel}
          onChange={(e) => setForm({ ...form, defaultRiskLevel: e.target.value as "low" | "medium" | "high" })}
          className="input-base mono text-xs px-3 py-2 w-full appearance-none"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-700/30">
        <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={inspecting}
          className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          {inspecting && (
            <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
          )}
          Inspect
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Source Detail
// ============================================================================

function SourceDetail({
  source,
  onRefresh,
  onTestAuth,
  onDelete,
}: {
  source: OpenApiSource;
  onRefresh: () => Promise<OpenApiSource | null>;
  onTestAuth: () => Promise<{ success: boolean; message?: string } | null>;
  onDelete: () => Promise<boolean>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  const handleTest = async () => {
    setTesting(true);
    const result = await onTestAuth();
    if (result) setTestResult(result);
    setTesting(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete source "${source.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    await onDelete();
    setDeleting(false);
  };

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="space-y-2">
        <Badge variant="amber" size="sm">OpenAPI</Badge>
        {source.description && <p className="text-xs text-slate-400 leading-relaxed">{source.description}</p>}
      </div>

      {/* Details */}
      <div className="space-y-2">
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Source ID</span>
          <code className="text-[10px] mono text-slate-400 block">{source.sourceId}</code>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Spec URL</span>
          <code className="text-[10px] mono text-slate-400 block break-all">{source.specUrl}</code>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Server URL</span>
          <code className="text-[10px] mono text-slate-400 block break-all">{source.selectedServerUrl}</code>
        </div>
        {source.credentialId && (
          <div className="space-y-1">
            <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Credential</span>
            <code className="text-[10px] mono text-slate-400 block">{source.credentialId}</code>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3 text-center">
          <p className="text-lg font-semibold text-slate-100">{source.operationCount ?? "—"}</p>
          <p className="text-[10px] mono uppercase text-slate-500">Operations</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-lg font-semibold text-slate-100">
            {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleDateString() : "—"}
          </p>
          <p className="text-[10px] mono uppercase text-slate-500">Last Sync</p>
        </div>
      </div>

      {/* Risk Level */}
      <div className="flex items-center justify-between py-2 border-t border-slate-700/30">
        <span className="text-xs text-slate-400">Default Risk Level</span>
        <Badge
          variant={source.defaultRiskLevel === "low" ? "green" : source.defaultRiskLevel === "medium" ? "amber" : "red"}
          size="sm"
        >
          {source.defaultRiskLevel}
        </Badge>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={cn(
          "text-xs px-3 py-2 rounded-sm",
          testResult.success
            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
            : "text-rose-400 bg-rose-500/10 border border-rose-500/20"
        )}>
          {testResult.success ? "Authentication successful" : `Authentication failed: ${testResult.message}`}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30 flex-wrap">
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          {refreshing ? (
            <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          )}
          Refresh
        </button>
        
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          {testing ? (
            <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Test Auth
        </button>
        
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 ml-auto"
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
// Sources Page
// ============================================================================

export function Sources() {
  const { sources, loading, error, reload, inspect, compile, refresh, testAuth, remove } = useOpenApiSources();
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<OpenApiSource | null>(null);

  const filtered = sources.filter(
    (s) =>
      search === "" ||
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.sourceId.toLowerCase().includes(search.toLowerCase()) ||
      s.specUrl.toLowerCase().includes(search.toLowerCase()),
  );

  const handleDelete = async (sourceId: string) => {
    const success = await remove(sourceId);
    if (success) {
      setSelectedSource(null);
    }
    return success;
  };

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            OpenAPI Sources
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {sources.length} sources registered
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => reload()}
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
            onClick={() => setPanelOpen(true)}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Source
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
          placeholder="Search sources..."
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
            <div key={i} className="card p-4 space-y-3 animate-pulse h-32" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? "No sources match your search" : "No OpenAPI sources"}
          description={search ? "Try adjusting your search." : "Add your first OpenAPI source to generate capabilities."}
          action={
            !search && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
              >
                Add Source →
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {filtered.map((source) => (
            <SourceCard
              key={source.sourceId}
              source={source}
              onClick={() => setSelectedSource(source)}
            />
          ))}
        </div>
      )}

      {/* Add Slide-over */}
      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Add OpenAPI Source"
        width="md"
      >
        <AddSourceForm
          onInspect={inspect}
          onCompile={compile}
          onCancel={() => setPanelOpen(false)}
        />
      </SlideOver>

      {/* Detail Slide-over */}
      <SlideOver
        open={selectedSource !== null}
        onClose={() => setSelectedSource(null)}
        title={selectedSource?.title ?? ""}
        subtitle={selectedSource?.sourceId}
        width="md"
      >
        {selectedSource && (
          <SourceDetail
            source={selectedSource}
            onRefresh={() => refresh(selectedSource.sourceId)}
            onTestAuth={() => testAuth(selectedSource.sourceId)}
            onDelete={() => handleDelete(selectedSource.sourceId)}
          />
        )}
      </SlideOver>
    </div>
  );
}
