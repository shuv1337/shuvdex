import { useState, useMemo } from "react";
import { usePackages } from "@/hooks/usePackages";
import { SlideOver } from "@/components/SlideOver";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { CapabilityPackage, CapabilityDefinition } from "@/api/client";

// ============================================================================
// Capability Kind Badge
// ============================================================================

function KindBadge({ kind }: { kind: string }) {
  const variant =
    kind === "tool" ? "cyan" :
    kind === "resource" ? "green" :
    kind === "prompt" ? "amber" : "slate";
  return <Badge variant={variant} size="sm">{kind}</Badge>;
}

// ============================================================================
// Source Badge
// ============================================================================

function SourceBadge({ source }: { source?: { type: string } }) {
  if (!source) return <Badge variant="slate" size="sm">unknown</Badge>;
  
  const variant =
    source.type === "builtin" ? "purple" :
    source.type === "openapi" ? "amber" :
    source.type === "imported_archive" ? "green" :
    source.type === "skill_index" ? "cyan" : "slate";
  
  return <Badge variant={variant} size="sm">{source.type}</Badge>;
}

// ============================================================================
// Package Card
// ============================================================================

interface PackageCardProps {
  pkg: CapabilityPackage;
  onClick?: () => void;
}

function PackageCard({ pkg, onClick }: PackageCardProps) {
  const enabledCount = pkg.capabilities.filter((c) => c.enabled).length;
  
  return (
    <div
      className={cn(
        "card p-4 hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150",
        onClick && "cursor-pointer",
        !pkg.enabled && "opacity-60",
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100 truncate">{pkg.title}</span>
            {pkg.builtIn && <Badge variant="purple" size="sm">built-in</Badge>}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mt-1">{pkg.description}</p>
        </div>
        <SourceBadge source={pkg.source} />
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700/30">
        <div className="flex items-center gap-2">
          <Badge variant={pkg.enabled ? "green" : "slate"} size="sm">
            {pkg.enabled ? "enabled" : "disabled"}
          </Badge>
          <span className="text-xs mono text-slate-500">
            v{pkg.version}
          </span>
        </div>
        <span className="text-xs mono text-slate-500">
          {enabledCount}/{pkg.capabilities.length} capabilities
        </span>
      </div>
      
      {pkg.tags && pkg.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {pkg.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
          {pkg.tags.length > 3 && (
            <span className="text-[10px] text-slate-500">+{pkg.tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Capability Detail Panel
// ============================================================================

function CapabilityDetail({ capability }: { capability: CapabilityDefinition }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KindBadge kind={capability.kind} />
        <span className="text-xs mono text-slate-500">{capability.id}</span>
      </div>
      
      <p className="text-sm text-slate-200">{capability.title}</p>
      <p className="text-xs text-slate-400 leading-relaxed">{capability.description}</p>
      
      <div className="flex items-center justify-between py-2 border-t border-slate-700/30">
        <span className="text-xs text-slate-400">Enabled</span>
        <Badge variant={capability.enabled ? "green" : "slate"} size="sm">
          {capability.enabled ? "yes" : "no"}
        </Badge>
      </div>
      
      <div className="space-y-1">
        <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Executor</span>
        <p className="text-xs mono text-slate-400">{String(capability.executor?.type ?? "unknown")}</p>
      </div>
      
      {Boolean(capability.inputSchema) && (
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Input Schema</span>
          <pre className="text-[10px] mono text-slate-400 bg-slate-950/40 p-2 rounded overflow-auto max-h-32">
            {JSON.stringify(capability.inputSchema as Record<string, unknown>, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Package Detail Panel
// ============================================================================

function PackageDetail({
  pkg,
  onClose,
  onDelete,
}: {
  pkg: CapabilityPackage;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [selectedCapability, setSelectedCapability] = useState<CapabilityDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete package "${pkg.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <SourceBadge source={pkg.source} />
            {pkg.builtIn && <Badge variant="purple" size="sm">built-in</Badge>}
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{pkg.description}</p>
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Version</span>
            <p className="text-xs mono text-slate-400">{pkg.version}</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Package ID</span>
            <p className="text-xs mono text-slate-400 truncate">{pkg.id}</p>
          </div>
          {pkg.source?.path && (
            <div className="space-y-1 col-span-2">
              <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Source Path</span>
              <p className="text-xs mono text-slate-400 truncate">{pkg.source.path}</p>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center justify-between py-2 border-t border-b border-slate-700/30">
          <span className="text-xs text-slate-400">Package Status</span>
          <Badge variant={pkg.enabled ? "green" : "slate"} size="sm">
            {pkg.enabled ? "enabled" : "disabled"}
          </Badge>
        </div>

        {/* Capabilities List */}
        <div className="space-y-2">
          <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">
            Capabilities ({pkg.capabilities.length})
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {pkg.capabilities.map((capability) => (
              <div
                key={capability.id}
                onClick={() => setSelectedCapability(capability)}
                className="border border-slate-700/40 rounded-sm px-3 py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-800/60 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-xs text-slate-200 truncate">{capability.title}</p>
                  <p className="text-[10px] mono text-slate-500 truncate">{capability.id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={capability.enabled ? "green" : "slate"} size="sm">
                    {capability.enabled ? "on" : "off"}
                  </Badge>
                  <KindBadge kind={capability.kind} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        {!pkg.builtIn && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30">
            <button
              type="button"
              onClick={handleDelete}
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
              Delete Package
            </button>
          </div>
        )}
        {pkg.builtIn && (
          <p className="text-xs text-slate-600 mono italic">Built-in packages cannot be deleted.</p>
        )}
      </div>

      {/* Capability Detail Slide-over */}
      <SlideOver
        open={selectedCapability !== null}
        onClose={() => setSelectedCapability(null)}
        title={selectedCapability?.title ?? ""}
        subtitle={selectedCapability?.id}
        width="md"
      >
        {selectedCapability && <CapabilityDetail capability={selectedCapability} />}
      </SlideOver>
    </>
  );
}

// ============================================================================
// Packages Page
// ============================================================================

export function Packages() {
  const { packages, loading, error, refresh, removePackage } = usePackages();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedPackage, setSelectedPackage] = useState<CapabilityPackage | null>(null);

  const sources = useMemo(
    () => ["all", ...Array.from(new Set(packages.map((p) => p.source?.type ?? "unknown"))).sort()],
    [packages],
  );

  const filtered = useMemo(
    () =>
      packages.filter(
        (p) =>
          (sourceFilter === "all" || (p.source?.type ?? "unknown") === sourceFilter) &&
          (search === "" ||
            p.title.toLowerCase().includes(search.toLowerCase()) ||
            p.description.toLowerCase().includes(search.toLowerCase()) ||
            p.id.toLowerCase().includes(search.toLowerCase())),
      ),
    [packages, sourceFilter, search],
  );

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Packages
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {packages.length} packages · {packages.filter((p) => p.enabled).length} enabled
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
        </div>
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
            placeholder="Search packages..."
            className="input-base text-xs pl-8 pr-3 py-1.5 w-full"
          />
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-1">
          {sources.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => setSourceFilter(src)}
              className={cn(
                "text-[10px] mono uppercase tracking-wider px-2 py-1 rounded-[2px] border transition-colors",
                sourceFilter === src
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "border-slate-700/40 text-slate-500 hover:text-slate-300 hover:border-slate-600/40",
              )}
            >
              {src}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Package Grid */}
      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse h-32" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || sourceFilter !== "all" ? "No packages match your filters" : "No packages found"}
          description={
            search || sourceFilter !== "all"
              ? "Try adjusting your search or filter."
              : "Packages will appear when you import skills or sync OpenAPI sources."
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {filtered.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              onClick={() => setSelectedPackage(pkg)}
            />
          ))}
        </div>
      )}

      {/* Detail Panel */}
      <SlideOver
        open={selectedPackage !== null}
        onClose={() => setSelectedPackage(null)}
        title={selectedPackage?.title ?? ""}
        subtitle={selectedPackage?.id}
        width="md"
      >
        {selectedPackage && (
          <PackageDetail
            pkg={selectedPackage}
            onClose={() => setSelectedPackage(null)}
            onDelete={() => removePackage(selectedPackage.id)}
          />
        )}
      </SlideOver>
    </div>
  );
}
