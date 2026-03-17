import { useState } from "react";
import { useHosts } from "@/hooks/useHosts";
import { SlideOver } from "@/components/SlideOver";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";
import type { HostConfig, ConnectionType } from "@/api/client";

// ---------------------------------------------------------------------------
// Host form
// ---------------------------------------------------------------------------
type HostFormState = Omit<HostConfig, "name"> & { name: string };

const defaultHostForm = (): HostFormState => ({
  name: "",
  hostname: "",
  connectionType: "ssh",
  port: 22,
  user: "",
  keyPath: "",
  timeout: 30,
});

interface HostFormProps {
  initial?: HostFormState;
  onSubmit: (state: HostFormState) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  editMode?: boolean;
}

function HostForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = "Add Host",
  editMode = false,
}: HostFormProps) {
  const [form, setForm] = useState<HostFormState>(initial ?? defaultHostForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof HostFormState>(k: K, v: HostFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Host name is required.");
      return;
    }
    if (!form.hostname.trim()) {
      setError("Hostname is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save host");
    } finally {
      setSubmitting(false);
    }
  };

  const LabelRow = ({ label, required }: { label: string; required?: boolean }) => (
    <label className="block text-[10px] mono uppercase tracking-wider text-slate-400">
      {label} {required && <span className="text-rose-400">*</span>}
    </label>
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1">
        <LabelRow label="Name" required />
        <input
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="shuvbot"
          disabled={editMode}
          className={cn(
            "input-base mono text-xs px-3 py-2 w-full",
            editMode && "opacity-60 cursor-default",
          )}
        />
        {editMode && (
          <p className="text-[10px] text-slate-600 mono">Host name cannot be changed.</p>
        )}
      </div>

      {/* Hostname */}
      <div className="space-y-1">
        <LabelRow label="Hostname / IP" required />
        <input
          type="text"
          value={form.hostname}
          onChange={(e) => set("hostname", e.target.value)}
          placeholder="192.168.1.10 or hostname.local"
          className="input-base mono text-xs px-3 py-2 w-full"
        />
      </div>

      {/* Connection type + port */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <LabelRow label="Connection" />
          <select
            value={form.connectionType}
            onChange={(e) => set("connectionType", e.target.value as ConnectionType)}
            className="input-base mono text-xs px-3 py-2 w-full appearance-none"
          >
            <option value="ssh">ssh</option>
            <option value="local">local</option>
          </select>
        </div>
        <div className="space-y-1">
          <LabelRow label="Port" />
          <input
            type="number"
            value={form.port}
            onChange={(e) => set("port", parseInt(e.target.value, 10) || 22)}
            min={1}
            max={65535}
            className="input-base mono text-xs px-3 py-2 w-full"
          />
        </div>
      </div>

      {/* User + key */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <LabelRow label="SSH User" />
          <input
            type="text"
            value={form.user ?? ""}
            onChange={(e) => set("user", e.target.value || undefined)}
            placeholder="shuv"
            className="input-base mono text-xs px-3 py-2 w-full"
          />
        </div>
        <div className="space-y-1">
          <LabelRow label="Timeout (s)" />
          <input
            type="number"
            value={form.timeout}
            onChange={(e) => set("timeout", parseInt(e.target.value, 10) || 30)}
            min={1}
            className="input-base mono text-xs px-3 py-2 w-full"
          />
        </div>
      </div>

      {/* Key path */}
      <div className="space-y-1">
        <LabelRow label="Key Path" />
        <input
          type="text"
          value={form.keyPath ?? ""}
          onChange={(e) => set("keyPath", e.target.value || undefined)}
          placeholder="~/.ssh/id_ed25519"
          className="input-base mono text-xs px-3 py-2 w-full"
        />
        <p className="text-[10px] text-slate-600 mono">
          Leave blank to use the default SSH key.
        </p>
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
// HostManager page
// ---------------------------------------------------------------------------
type Panel =
  | { type: "add" }
  | { type: "edit"; host: HostConfig }
  | null;

export function HostManager() {
  const {
    hosts,
    loading,
    error,
    pingStates,
    refresh,
    addHost,
    editHost,
    removeHost,
    checkHost,
  } = useHosts();
  const [panel, setPanel] = useState<Panel>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleAdd = async (form: HostFormState) => {
    await addHost(form as HostConfig);
    setPanel(null);
  };

  const handleEdit = async (name: string, form: HostFormState) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name: _name, ...updates } = form;
    await editHost(name, updates);
    setPanel(null);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove host "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      await removeHost(name);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="px-6 py-5 space-y-5 max-w-screen-xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-200 uppercase tracking-widest mono">
            Host Manager
          </h1>
          {!loading && (
            <p className="text-xs text-slate-500 mono mt-0.5">
              {hosts.length} host{hosts.length !== 1 ? "s" : ""} configured
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="btn-ghost text-xs px-2 py-1.5 flex items-center gap-1"
          >
            <svg className={cn("w-3.5 h-3.5", loading && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setPanel({ type: "add" })}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Host
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-rose-400 mono bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-sm">
          {error}
        </div>
      )}

      {/* Host table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : hosts.length === 0 ? (
        <EmptyState
          title="No hosts configured"
          description="Add a host to manage it from the fleet console."
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
            </svg>
          }
          action={
            <button
              type="button"
              onClick={() => setPanel({ type: "add" })}
              className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
            >
              Add Host →
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/50">
                {["Status", "Name", "Hostname", "Type", "Port", "User", "Timeout", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="py-2 px-3 text-left text-[10px] mono uppercase tracking-wider text-slate-500 font-medium whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {hosts.map((host) => {
                const ping = pingStates[host.name];
                const status = ping?.status ?? "unknown";

                return (
                  <tr
                    key={host.name}
                    className="table-row-hover group"
                  >
                    {/* Status */}
                    <td className="py-2.5 px-3">
                      <StatusDot
                        status={ping?.checking ? "unknown" : status}
                        pulse={status === "online" && !ping?.checking}
                      />
                    </td>

                    {/* Name */}
                    <td className="py-2.5 px-3">
                      <span className="mono font-semibold text-slate-200">
                        {host.name}
                      </span>
                    </td>

                    {/* Hostname */}
                    <td className="py-2.5 px-3">
                      <span className="mono text-slate-400">{host.hostname}</span>
                    </td>

                    {/* Type */}
                    <td className="py-2.5 px-3">
                      <Badge variant="slate" size="sm">
                        {host.connectionType}
                      </Badge>
                    </td>

                    {/* Port */}
                    <td className="py-2.5 px-3">
                      <span className="mono text-slate-400">{host.port}</span>
                    </td>

                    {/* User */}
                    <td className="py-2.5 px-3">
                      <span className="mono text-slate-500">{host.user ?? "—"}</span>
                    </td>

                    {/* Timeout */}
                    <td className="py-2.5 px-3">
                      <span className="mono text-slate-500">{host.timeout}s</span>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1">
                        {/* Ping */}
                        <button
                          type="button"
                          title="Check status"
                          onClick={() => void checkHost(host.name)}
                          disabled={ping?.checking}
                          className="btn-ghost p-1.5 disabled:opacity-50"
                        >
                          {ping?.checking ? (
                            <span className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin block" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </button>

                        {/* Edit */}
                        <button
                          type="button"
                          title="Edit host"
                          onClick={() => setPanel({ type: "edit", host })}
                          className="btn-ghost p-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          title="Delete host"
                          onClick={() => void handleDelete(host.name)}
                          disabled={deleting === host.name}
                          className="btn-ghost p-1.5 hover:text-rose-400 disabled:opacity-50"
                        >
                          {deleting === host.name ? (
                            <span className="w-3 h-3 border border-rose-400 border-t-transparent rounded-full animate-spin block" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Ping latency display */}
      {Object.entries(pingStates).some(([, s]) => s.latencyMs !== undefined) && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(pingStates)
            .filter(([, s]) => s.latencyMs !== undefined)
            .map(([name, state]) => (
              <div
                key={name}
                className="flex items-center gap-2 text-xs mono text-slate-400"
              >
                <StatusDot status={state.status} size="sm" />
                <span className="text-slate-300">{name}</span>
                <span>{state.latencyMs}ms</span>
              </div>
            ))}
        </div>
      )}

      {/* Slide-over */}
      <SlideOver
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel?.type === "add" ? "Add Host" : `Edit: ${panel?.type === "edit" ? panel.host.name : ""}`}
        subtitle={
          panel?.type === "edit"
            ? panel.host.hostname
            : "Configure a new fleet host"
        }
      >
        {panel?.type === "add" && (
          <HostForm
            onSubmit={handleAdd}
            onCancel={() => setPanel(null)}
            submitLabel="Add Host"
          />
        )}
        {panel?.type === "edit" && (
          <HostForm
            initial={panel.host}
            onSubmit={(form) => handleEdit(panel.host.name, form)}
            onCancel={() => setPanel(null)}
            submitLabel="Save Changes"
            editMode
          />
        )}
      </SlideOver>
    </div>
  );
}
