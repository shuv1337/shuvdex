import { useState } from "react";
import { useCredentials } from "@/hooks/useCredentials";
import { SlideOver } from "@/components/SlideOver";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { CredentialRecord, CredentialBinding } from "@/api/client";

// ============================================================================
// Scheme Badge
// ============================================================================

/** Resolve the scheme type string from either `scheme.type` or `schemeType`. */
function getSchemeType(credential: CredentialRecord): string {
  return credential.scheme?.type ?? credential.schemeType ?? "unknown";
}

function SchemeBadge({ credential }: { credential: CredentialRecord }) {
  const type = getSchemeType(credential);
  const variant =
    type === "api_key" ? "cyan" :
    type === "bearer" ? "green" :
    type === "oauth_client_credentials" ? "amber" :
    type === "oauth_authorization_code" ? "amber" :
    type === "service_account" ? "purple" : "slate";
  return <Badge variant={variant} size="sm">{type}</Badge>;
}

// ============================================================================
// Credential Card
// ============================================================================

interface CredentialCardProps {
  credential: CredentialRecord;
  onClick?: () => void;
}

function CredentialCard({ credential, onClick }: CredentialCardProps) {
  return (
    <div
      className={cn(
        "card p-4 hover:bg-slate-800/80 hover:border-slate-600/40 transition-colors duration-150 cursor-pointer",
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-100 truncate">{credential.credentialId}</span>
            <SchemeBadge credential={credential} />
          </div>
          {credential.description && (
            <p className="text-xs text-slate-400 leading-relaxed mt-1">{credential.description}</p>
          )}
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700/30">
        <span className="text-xs mono text-slate-500">
          Created {new Date(credential.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Credential Form
// ============================================================================

interface CredentialFormProps {
  onSubmit: (credential: Omit<CredentialRecord, "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
}

function CredentialForm({ onSubmit, onCancel }: CredentialFormProps) {
  const [schemeType, setSchemeType] = useState<CredentialScheme["type"]>("api_key");
  const [credentialId, setCredentialId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // api_key fields
  const [apiKeyIn, setApiKeyIn] = useState<"header" | "query">("header");
  const [apiKeyName, setApiKeyName] = useState("X-API-Key");
  const [apiKeyValue, setApiKeyValue] = useState("");

  // bearer fields
  const [bearerToken, setBearerToken] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentialId.trim()) {
      setError("Credential ID is required.");
      return;
    }

    let scheme: CredentialScheme;
    switch (schemeType) {
      case "api_key":
        if (!apiKeyValue.trim()) {
          setError("API key value is required.");
          return;
        }
        scheme = { type: "api_key", in: apiKeyIn, name: apiKeyName, value: apiKeyValue };
        break;
      case "bearer":
        if (!bearerToken.trim()) {
          setError("Bearer token is required.");
          return;
        }
        scheme = { type: "bearer", token: bearerToken };
        break;
      default:
        setError("This credential type is not yet supported in the UI.");
        return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        credentialId,
        scheme,
        description: description || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create credential");
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

      {/* Credential ID */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Credential ID <span className="text-rose-400">*</span>
        </label>
        <input
          type="text"
          value={credentialId}
          onChange={(e) => setCredentialId(e.target.value)}
          placeholder="my-api-key"
          className="input-base mono text-xs px-3 py-2 w-full"
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="For production API access"
          className="input-base text-xs px-3 py-2 w-full"
        />
      </div>

      {/* Scheme Type */}
      <div className="space-y-1">
        <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
          Type
        </label>
        <select
          value={schemeType}
          onChange={(e) => setSchemeType(e.target.value as CredentialScheme["type"])}
          className="input-base mono text-xs px-3 py-2 w-full appearance-none"
        >
          <option value="api_key">API Key</option>
          <option value="bearer">Bearer Token</option>
          <option value="oauth_client_credentials">OAuth Client Credentials (advanced)</option>
          <option value="custom_headers">Custom Headers (advanced)</option>
        </select>
      </div>

      {/* API Key Fields */}
      {schemeType === "api_key" && (
        <>
          <div className="space-y-1">
            <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
              Key Location
            </label>
            <select
              value={apiKeyIn}
              onChange={(e) => setApiKeyIn(e.target.value as "header" | "query")}
              className="input-base mono text-xs px-3 py-2 w-full appearance-none"
            >
              <option value="header">Header</option>
              <option value="query">Query Parameter</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
              Header/Param Name
            </label>
            <input
              type="text"
              value={apiKeyName}
              onChange={(e) => setApiKeyName(e.target.value)}
              placeholder="X-API-Key"
              className="input-base mono text-xs px-3 py-2 w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
              API Key Value <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              placeholder="••••••••••••"
              className="input-base mono text-xs px-3 py-2 w-full"
              required
            />
            <p className="text-[10px] text-amber-400">Store securely — this cannot be retrieved later</p>
          </div>
        </>
      )}

      {/* Bearer Token Fields */}
      {schemeType === "bearer" && (
        <div className="space-y-1">
          <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
            Bearer Token <span className="text-rose-400">*</span>
          </label>
          <textarea
            value={bearerToken}
            onChange={(e) => setBearerToken(e.target.value)}
            placeholder="Paste bearer token here..."
            rows={3}
            className="input-base text-xs px-3 py-2 w-full resize-none mono"
            required
          />
          <p className="text-[10px] text-amber-400">Store securely — this cannot be retrieved later</p>
        </div>
      )}

      {/* Other types warning */}
      {(schemeType === "oauth_client_credentials" || schemeType === "custom_headers" || schemeType === "oauth_authorization_code" || schemeType === "service_account") && (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-sm">
          This credential type requires additional fields. Use the API directly for advanced credential types.
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-700/30">
        <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || schemeType === "oauth_client_credentials" || schemeType === "custom_headers" || schemeType === "oauth_authorization_code" || schemeType === "service_account"}
          className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
        >
          {submitting && (
            <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
          )}
          Create Credential
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Credential Detail
// ============================================================================

function CredentialDetail({
  credential,
  bindings,
  onDelete,
}: {
  credential: CredentialRecord;
  bindings: CredentialBinding[];
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete credential "${credential.credentialId}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const relevantBindings = bindings.filter((b) => b.credentialId === credential.credentialId);

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SchemeBadge credential={credential} />
        </div>
        {credential.description && (
          <p className="text-xs text-slate-400 leading-relaxed">{credential.description}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Created</span>
          <p className="text-xs mono text-slate-400">{new Date(credential.createdAt).toLocaleString()}</p>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] mono uppercase tracking-wider text-slate-500">Updated</span>
          <p className="text-xs mono text-slate-400">{new Date(credential.updatedAt).toLocaleString()}</p>
        </div>
      </div>

      {/* Bindings */}
      <div className="space-y-2">
        <h3 className="text-[10px] mono uppercase tracking-wider text-slate-500">
          Bindings ({relevantBindings.length})
        </h3>
        {relevantBindings.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No bindings for this credential</p>
        ) : (
          <div className="space-y-2">
            {relevantBindings.map((binding) => (
              <div key={binding.bindingId} className="border border-slate-700/40 rounded-sm px-3 py-2">
                <div className="flex items-center justify-between">
                  <code className="text-xs mono text-slate-400">{binding.bindingId}</code>
                  <Badge variant="slate" size="sm">{binding.credentialType}</Badge>
                </div>
                {binding.allowedPackages && binding.allowedPackages.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] text-slate-500">Packages:</span>
                    {binding.allowedPackages.map((pkg) => (
                      <Badge key={pkg} variant="cyan" size="sm">{pkg}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/30">
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
          Delete Credential
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Credentials Page
// ============================================================================

export function Credentials() {
  const { credentials, bindings, loading, error, refresh, addCredential, removeCredential } = useCredentials();
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<CredentialRecord | null>(null);

  const filtered = credentials.filter(
    (c) =>
      search === "" ||
      c.credentialId.toLowerCase().includes(search.toLowerCase()) ||
      c.description?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = async (credential: Omit<CredentialRecord, "createdAt" | "updatedAt">) => {
    await addCredential(credential);
    setPanelOpen(false);
  };

  const handleDelete = async (credentialId: string) => {
    await removeCredential(credentialId);
    setSelectedCredential(null);
  };

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Credentials
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {credentials.length} credentials · {bindings.length} bindings
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
            onClick={() => setPanelOpen(true)}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Credential
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
          placeholder="Search credentials..."
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
          title={search ? "No credentials match your search" : "No credentials stored"}
          description={search ? "Try adjusting your search." : "Create your first credential to enable API access."}
          action={
            !search && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
              >
                Add Credential →
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {filtered.map((credential) => (
            <CredentialCard
              key={credential.credentialId}
              credential={credential}
              onClick={() => setSelectedCredential(credential)}
            />
          ))}
        </div>
      )}

      {/* Add Slide-over */}
      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Add Credential"
        width="md"
      >
        <CredentialForm
          onSubmit={handleAdd}
          onCancel={() => setPanelOpen(false)}
        />
      </SlideOver>

      {/* Detail Slide-over */}
      <SlideOver
        open={selectedCredential !== null}
        onClose={() => setSelectedCredential(null)}
        title={selectedCredential?.credentialId ?? ""}
        subtitle={selectedCredential ? getSchemeType(selectedCredential) : undefined}
        width="md"
      >
        {selectedCredential && (
          <CredentialDetail
            credential={selectedCredential}
            bindings={bindings}
            onDelete={() => handleDelete(selectedCredential.credentialId)}
          />
        )}
      </SlideOver>
    </div>
  );
}
