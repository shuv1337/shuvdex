import { useState } from "react";
import { useTokens } from "@/hooks/useTokens";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { IssueTokenInput } from "@/api/client";

export function Tokens() {
  const { loading, error, issue, verify, revoke, lastIssued, lastVerified } = useTokens();
  const [activeTab, setActiveTab] = useState<"issue" | "verify" | "revoke">("issue");
  
  // Issue form state
  const [issueForm, setIssueForm] = useState<IssueTokenInput>({
    subjectId: "",
    subjectType: "user",
    scopes: [],
    ttlSeconds: 3600,
  });
  
  // Verify form state
  const [verifyToken, setVerifyToken] = useState("");
  
  // Revoke form state
  const [revokeJti, setRevokeJti] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await issue(issueForm);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to issue token");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await verify(verifyToken);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to verify token");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    try {
      await revoke(revokeJti);
      setRevokeJti("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to revoke token");
    } finally {
      setSubmitting(false);
    }
  };

  const parseScopes = (value: string): string[] =>
    value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

  const tabs = [
    { id: "issue", label: "Issue Token" },
    { id: "verify", label: "Verify" },
    { id: "revoke", label: "Revoke" },
  ] as const;

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div>
        <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
          Tokens
        </h1>
        <p className="text-xs text-slate-500 mono mt-0.5">
          Issue, verify, and revoke access tokens
        </p>
      </div>

      {/* Error */}
      {(error || actionError) && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error ?? actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-700/30">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setActionError(null);
            }}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Issue Token */}
      {activeTab === "issue" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={(e) => void handleIssue(e)} className="card p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Issue New Token</h2>
            
            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                Subject ID <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={issueForm.subjectId}
                onChange={(e) => setIssueForm({ ...issueForm, subjectId: e.target.value })}
                placeholder="user@example.com"
                className="input-base mono text-xs px-3 py-2 w-full"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                Subject Type
              </label>
              <select
                value={issueForm.subjectType}
                onChange={(e) => setIssueForm({ ...issueForm, subjectType: e.target.value })}
                className="input-base mono text-xs px-3 py-2 w-full appearance-none"
              >
                <option value="user">user</option>
                <option value="service">service</option>
                <option value="host">host</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                Scopes (one per line or comma-separated)
              </label>
              <textarea
                value={issueForm.scopes.join("\n")}
                onChange={(e) => setIssueForm({ ...issueForm, scopes: parseScopes(e.target.value) })}
                placeholder="read&#10;write&#10;admin"
                rows={3}
                className="input-base text-xs px-3 py-2 w-full resize-none mono"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                TTL (seconds)
              </label>
              <input
                type="number"
                value={issueForm.ttlSeconds}
                onChange={(e) => setIssueForm({ ...issueForm, ttlSeconds: Number(e.target.value) })}
                min={60}
                max={86400}
                className="input-base mono text-xs px-3 py-2 w-full"
              />
              <p className="text-[10px] text-slate-500">
                {Math.round((issueForm.ttlSeconds ?? 3600) / 60)} minutes
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="btn-primary text-xs px-4 py-2 w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting && (
                <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
              )}
              Issue Token
            </button>
          </form>

          {/* Result */}
          <div className="space-y-4">
            {lastIssued ? (
              <div className="card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-400">Token Issued Successfully</h3>
                
                <div className="space-y-1">
                  <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Token</label>
                  <div className="bg-slate-950/40 p-3 rounded-sm">
                    <code className="text-[10px] mono text-slate-300 break-all">{lastIssued.token}</code>
                  </div>
                  <p className="text-[10px] text-amber-400">Copy this now — it won&apos;t be shown again</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">JTI</label>
                    <code className="text-[10px] mono text-slate-400">{lastIssued.claims.jti}</code>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Expires</label>
                    <span className="text-xs text-slate-400">
                      {new Date(lastIssued.claims.exp * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Scopes</label>
                  <div className="flex flex-wrap gap-1">
                    {lastIssued.claims.scopes.map((scope) => (
                      <Badge key={scope} variant="cyan" size="sm">{scope}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No token issued yet"
                description="Fill out the form to issue a new access token."
              />
            )}
          </div>
        </div>
      )}

      {/* Verify Token */}
      {activeTab === "verify" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={(e) => void handleVerify(e)} className="card p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Verify Token</h2>
            
            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                Token <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                placeholder="Paste token here..."
                rows={4}
                className="input-base text-xs px-3 py-2 w-full resize-none mono"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="btn-primary text-xs px-4 py-2 w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting && (
                <span className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
              )}
              Verify
            </button>
          </form>

          {/* Result */}
          <div>
            {lastVerified ? (
              <div className="card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-emerald-400">Token Valid</h3>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">JTI</label>
                    <code className="text-[10px] mono text-slate-400">{lastVerified.jti}</code>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Subject</label>
                    <span className="text-xs text-slate-400">{lastVerified.sub}</span>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Type</label>
                    <Badge variant="slate" size="sm">{lastVerified.subjectType}</Badge>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Expires</label>
                    <span className="text-xs text-slate-400">
                      {new Date(lastVerified.exp * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] mono uppercase tracking-wider text-slate-500">Scopes</label>
                  <div className="flex flex-wrap gap-1">
                    {lastVerified.scopes.map((scope) => (
                      <Badge key={scope} variant="cyan" size="sm">{scope}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No verification result"
                description="Paste a token to verify its claims and validity."
              />
            )}
          </div>
        </div>
      )}

      {/* Revoke Token */}
      {activeTab === "revoke" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={(e) => void handleRevoke(e)} className="card p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Revoke Token</h2>
            
            <div className="space-y-1">
              <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
                Token JTI <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={revokeJti}
                onChange={(e) => setRevokeJti(e.target.value)}
                placeholder="token_..."
                className="input-base mono text-xs px-3 py-2 w-full"
                required
              />
              <p className="text-[10px] text-slate-500">The unique token identifier (jti claim)</p>
            </div>

            <button
              type="submit"
              disabled={submitting || loading}
              className="btn-danger text-xs px-4 py-2 w-full flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {submitting && (
                <span className="w-3 h-3 border border-rose-400 border-t-transparent rounded-full animate-spin" />
              )}
              Revoke Token
            </button>
          </form>

          <div className="card p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">About Token Revocation</h3>
            <ul className="text-xs text-slate-400 space-y-2 list-disc list-inside">
              <li>Revoked tokens are immediately invalidated</li>
              <li>Revocation is persistent and survives server restarts</li>
              <li>You need the token&apos;s JTI (unique identifier) to revoke it</li>
              <li>The token itself cannot be &quot;un-revoked&quot;</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
