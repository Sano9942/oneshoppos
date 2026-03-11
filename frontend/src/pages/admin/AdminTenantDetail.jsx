import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Database, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { adminFetch } from "./AdminLogin";

export default function AdminTenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});
  const [setupInfo, setSetupInfo] = useState(null);

  const loadTenant = async () => {
    try {
      const [detailRes, statsRes] = await Promise.all([
        adminFetch(`/api/admin/tenants/${id}`),
        adminFetch(`/api/admin/tenants/${id}/stats`),
      ]);

      if (detailRes.status === 401) { navigate("/admin/login", { replace: true }); return; }

      const detail = await detailRes.json();
      if (!detailRes.ok) throw new Error(detail.error);

      setTenant(detail.tenant);
      setAuditLog(detail.audit_log || []);
      setForm({
        name: detail.tenant.name,
        owner_email: detail.tenant.owner_email,
        plan: detail.tenant.plan,
        timezone: detail.tenant.timezone,
        max_employees: detail.tenant.max_employees,
        max_outlets: detail.tenant.max_outlets,
        max_products: detail.tenant.max_products,
      });

      if (statsRes.status === 401) { navigate("/admin/login", { replace: true }); return; }
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s.stats);
      }

      try {
        const setupRes = await adminFetch(`/api/admin/tenants/${id}/setup-token`);
        if (setupRes.ok) {
          const setupData = await setupRes.json();
          setSetupInfo(setupData);
        }
      } catch {}
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTenant(); }, [id]);

  const doAction = async (actionPath, method = "POST", body = null) => {
    setActionLoading(actionPath);
    try {
      const res = await adminFetch(`/api/admin/tenants/${id}${actionPath}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadTenant();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleSave = async () => {
    setActionLoading("save");
    try {
      const res = await adminFetch(`/api/admin/tenants/${id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditMode(false);
      await loadTenant();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading("");
    }
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-slate-500">Loading...</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate("/admin/tenants")}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={14} /> Back to Tenants
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{tenant.name}</h1>
          <p className="text-sm text-slate-500">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
            tenant.status === "active" ? "bg-emerald-100 text-emerald-700" :
            tenant.status === "suspended" ? "bg-amber-100 text-amber-700" :
            "bg-red-100 text-red-700"
          }`}>{tenant.status}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {tenant.plan}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Info + Edit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tenant details */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h2>
              {!editMode ? (
                <button onClick={() => setEditMode(true)} className="text-xs font-medium text-violet-600 hover:text-violet-500">
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditMode(false)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={actionLoading === "save"} className="text-xs font-semibold text-violet-600 hover:text-violet-500">
                    {actionLoading === "save" ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {editMode ? (
                <>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Name</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Email</span>
                    <input value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Plan</span>
                    <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none">
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Timezone</span>
                    <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Max Employees</span>
                    <input type="number" value={form.max_employees} onChange={(e) => setForm({ ...form, max_employees: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Max Products</span>
                    <input type="number" value={form.max_products} onChange={(e) => setForm({ ...form, max_products: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-slate-400">Max Outlets</span>
                    <input type="number" value={form.max_outlets} onChange={(e) => setForm({ ...form, max_outlets: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none" />
                  </label>
                </>
              ) : (
                <>
                  <div><p className="text-xs text-slate-400">Owner Email</p><p className="font-medium text-slate-700">{tenant.owner_email}</p></div>
                  <div><p className="text-xs text-slate-400">Timezone</p><p className="font-medium text-slate-700">{tenant.timezone}</p></div>
                  <div><p className="text-xs text-slate-400">Max Employees</p><p className="font-medium text-slate-700">{tenant.max_employees}</p></div>
                  <div><p className="text-xs text-slate-400">Max Products</p><p className="font-medium text-slate-700">{tenant.max_products}</p></div>
                  <div><p className="text-xs text-slate-400">Max Outlets</p><p className="font-medium text-slate-700">{tenant.max_outlets}</p></div>
                  <div><p className="text-xs text-slate-400">Created</p><p className="font-medium text-slate-700">{tenant.created_at ? new Date(tenant.created_at + "Z").toLocaleString() : "—"}</p></div>
                </>
              )}
            </div>
          </div>

          {/* Setup Status */}
          {setupInfo && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Setup Status</h2>
              {setupInfo.setup_complete ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Setup Complete</span>
              ) : (
                <div className="space-y-3">
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending Setup</span>
                  {setupInfo.setup_url && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <input
                        readOnly
                        value={setupInfo.setup_url}
                        className="flex-1 bg-transparent text-xs text-slate-600 outline-none"
                        onClick={(e) => e.target.select()}
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(setupInfo.setup_url)}
                        className="shrink-0 rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-500"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      const res = await adminFetch(`/api/admin/tenants/${id}/regenerate-setup-token`, { method: "POST" });
                      if (res.ok) {
                        const data = await res.json();
                        setSetupInfo({ setup_complete: false, ...data });
                      }
                    }}
                    className="text-xs font-medium text-violet-600 hover:text-violet-500"
                  >
                    Regenerate Token
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {tenant.status === "active" ? (
                <button
                  onClick={() => { if (confirm("Suspend this tenant?")) doAction("/suspend"); }}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Pause size={14} /> {actionLoading === "/suspend" ? "Suspending..." : "Suspend"}
                </button>
              ) : tenant.status === "suspended" ? (
                <button
                  onClick={() => doAction("/activate")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  <Play size={14} /> {actionLoading === "/activate" ? "Activating..." : "Activate"}
                </button>
              ) : null}

              <button
                onClick={() => doAction("/migrate")}
                disabled={!!actionLoading || tenant.status !== "active"}
                className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                <Database size={14} /> {actionLoading === "/migrate" ? "Migrating..." : "Run Migrations"}
              </button>

              <button
                onClick={() => { if (confirm("Reset admin PIN to 0000?")) doAction("/reset-pin"); }}
                disabled={!!actionLoading || tenant.status !== "active"}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                <RotateCcw size={14} /> {actionLoading === "/reset-pin" ? "Resetting..." : "Reset PIN"}
              </button>

              <button
                onClick={() => { if (confirm("Soft-delete this tenant? This cannot be easily undone.")) doAction("", "DELETE"); }}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>

          {/* Audit log */}
          {auditLog.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Audit Log</h2>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {auditLog.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-slate-50 py-1.5 last:border-0">
                    <div>
                      <span className="text-sm font-medium text-slate-700">{entry.action}</span>
                      {entry.actor && <span className="ml-2 text-xs text-slate-400">by {entry.actor}</span>}
                    </div>
                    <span className="text-xs text-slate-400">
                      {entry.created_at ? new Date(entry.created_at + "Z").toLocaleString() : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Stats */}
        <div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Usage Stats</h2>
            {stats && !stats.message ? (
              <div className="space-y-3">
                {[
                  { label: "Employees", value: stats.employees, limit: tenant.max_employees },
                  { label: "Products", value: stats.products, limit: tenant.max_products },
                  { label: "Outlets", value: stats.outlets, limit: tenant.max_outlets },
                  { label: "Total Sales", value: stats.total_sales },
                  { label: "Customers", value: stats.customers },
                ].map((s) => (
                  <div key={s.label} className="flex items-center justify-between border-b border-slate-50 pb-2 last:border-0">
                    <span className="text-sm text-slate-500">{s.label}</span>
                    <span className="text-sm font-semibold text-slate-700">
                      {s.value}
                      {s.limit != null && <span className="text-slate-400"> / {s.limit}</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">{stats?.message || "Stats unavailable"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
