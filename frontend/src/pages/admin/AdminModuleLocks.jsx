import { useState, useEffect } from "react";
import { adminFetch } from "./AdminLogin";

/**
 * Platform module locks — the Business Modules super-admin backstop.
 * A lock means the tenant cannot self-ENABLE that module from the
 * Business Modules page (disable stays allowed; force-off remains the
 * per-tenant flag editor on the tenant detail page).
 */
export default function AdminModuleLocks() {
  const [locks, setLocks] = useState([]);
  const [moduleKeys, setModuleKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ module_key: "", tenant_id: "", reason: "" });

  const load = async () => {
    try {
      const res = await adminFetch(`/api/admin/module-locks`);
      const data = await res.json();
      setLocks(data.locks || []);
      setModuleKeys(data.module_keys || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const addLock = async () => {
    if (!form.module_key) { setMsg("Pick a module"); return; }
    try {
      const body = { reason: form.reason || null };
      if (form.tenant_id) body.tenant_id = Number(form.tenant_id);
      const res = await adminFetch(`/api/admin/module-locks/${form.module_key}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || "Failed"); return; }
      setForm({ module_key: "", tenant_id: "", reason: "" });
      setMsg("Lock saved");
      load();
    } catch (err) { setMsg(err.message); }
  };

  const removeLock = async (lock) => {
    if (!confirm(`Remove ${lock.tenant_id ? "per-tenant" : "GLOBAL"} lock on "${lock.module_key}"?`)) return;
    const qs = lock.tenant_id ? `?tenant_id=${lock.tenant_id}` : "";
    const res = await adminFetch(`/api/admin/module-locks/${lock.module_key}${qs}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setMsg(d.error || "Failed"); return; }
    load();
  };

  if (loading) return <div className="p-6 text-center text-(--ui-text-muted)">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-(--ui-text) mb-1">Module Locks</h1>
      <p className="text-sm text-(--ui-text-muted) mb-4">
        A locked module cannot be self-enabled by tenants on their Business Modules page.
        Leave Tenant ID empty for a platform-wide (global) lock. Locking never disables
        the module for tenants that already have it on.
      </p>

      {msg && (
        <div className="mb-3 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm text-(--ui-text)">
          {msg}
          <button onClick={() => setMsg("")} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
        <h3 className="text-lg font-bold text-(--ui-text) mb-3">Add / Refresh Lock</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Module</label>
            <select
              className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)"
              value={form.module_key}
              onChange={(e) => setForm({ ...form, module_key: e.target.value })}
            >
              <option value="">Select module…</option>
              {moduleKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Tenant ID (empty = global)</label>
            <input
              className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)"
              type="number"
              value={form.tenant_id}
              onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              placeholder="Global"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted)">Reason</label>
            <input
              className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Why is this locked?"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addLock}
              className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
            >
              Save Lock
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-auto rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
        {locks.length === 0 ? (
          <p className="p-6 text-center text-(--ui-text-muted)">No module locks — every module is self-service enableable.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border) text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Module</th>
                <th className="px-3 py-2 text-left font-medium">Scope</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
                <th className="px-3 py-2 text-left font-medium">Locked By</th>
                <th className="px-3 py-2 text-left font-medium">Locked At</th>
                <th className="px-3 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {locks.map((l) => (
                <tr key={l.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="px-3 py-2 font-mono text-(--ui-text)">{l.module_key}</td>
                  <td className="px-3 py-2">
                    {l.tenant_id ? (
                      <span className="rounded-full bg-(--ui-muted-surface) border border-(--ui-border) px-2 py-0.5 text-xs text-(--ui-text)">
                        {l.tenant_name || l.tenant_slug || `tenant #${l.tenant_id}`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-xs font-semibold text-(--ui-warning-fg)">
                        GLOBAL
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{l.reason || "-"}</td>
                  <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{l.locked_by || "-"}</td>
                  <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{l.locked_at ? new Date(l.locked_at).toLocaleString() : "-"}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => removeLock(l)} className="text-(--ui-danger) hover:underline text-xs font-semibold">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
