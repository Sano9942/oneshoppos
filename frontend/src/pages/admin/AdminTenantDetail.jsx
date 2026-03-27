import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Database, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { adminFetch } from "./AdminLogin";

function safeDateParse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function timeAgo(ts) {
  const d = safeDateParse(ts);
  if (!d) return "Never";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function usagePct(used, max) {
  if (!max) return 0;
  return Math.round((used / max) * 100);
}

function usageColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

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
  const [payments, setPayments] = useState([]);
  const [planPricing, setPlanPricing] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ plan: "starter", cycle: "monthly", amount: "", payment_method: "bank_transfer", reference_note: "" });
  const [upgradeReqs, setUpgradeReqs] = useState([]);

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

      adminFetch(`/api/admin/tenants/${id}/payments`).then(r => r.json()).then(setPayments).catch(() => {});
      adminFetch("/api/admin/plan-pricing").then(r => r.json()).then(setPlanPricing).catch(() => {});
      adminFetch("/api/admin/upgrade-requests").then(r => r.json()).then(reqs => {
        setUpgradeReqs(reqs.filter(r => r.tenant_id === Number(id)));
      }).catch(() => {});
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
                  <div><p className="text-xs text-slate-400">Created</p><p className="font-medium text-slate-700">{safeDateParse(tenant.created_at)?.toLocaleString() ?? "\u2014"}</p></div>
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

          {/* Billing */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Billing</h2>
              <button
                onClick={() => {
                  const match = planPricing.find(p => p.plan === paymentForm.plan && p.cycle === paymentForm.cycle);
                  setPaymentForm(f => ({ ...f, amount: match ? String(match.price) : "" }));
                  setShowPaymentModal(true);
                }}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Record Payment
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <p className="text-slate-500">Plan</p>
                <p className="font-semibold text-slate-800 capitalize">{tenant?.plan || "free"}</p>
              </div>
              <div>
                <p className="text-slate-500">Billing Cycle</p>
                <p className="font-semibold text-slate-800 capitalize">{tenant?.billing_cycle || "\u2014"}</p>
              </div>
              <div>
                <p className="text-slate-500">Expires</p>
                <p className="font-semibold text-slate-800">{tenant?.plan_expires_at ? new Date(tenant.plan_expires_at).toLocaleDateString() : "\u2014"}</p>
              </div>
              <div>
                <p className="text-slate-500">Payment Status</p>
                <p className={`font-semibold capitalize ${
                  tenant?.payment_status === "active" ? "text-emerald-600" :
                  tenant?.payment_status === "overdue" ? "text-red-600" :
                  "text-slate-800"
                }`}>{tenant?.payment_status || "active"}</p>
              </div>
            </div>

            {/* Pending Upgrade Requests */}
            {upgradeReqs.length > 0 && (
              <div className="mb-4 rounded-lg bg-purple-50 border border-purple-200 p-3">
                <p className="text-sm font-semibold text-purple-700 mb-2">Pending Upgrade Requests</p>
                {upgradeReqs.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm mb-1">
                    <span className="text-purple-600">{"\u2192"} {r.requested_plan} ({r.requested_cycle}){r.message ? `: "${r.message}"` : ""}</span>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await adminFetch(`/api/admin/upgrade-requests/${r.id}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "approved" }) });
                        setUpgradeReqs(prev => prev.filter(x => x.id !== r.id));
                      }} className="text-xs font-semibold text-emerald-600 hover:underline">Approve</button>
                      <button onClick={async () => {
                        await adminFetch(`/api/admin/upgrade-requests/${r.id}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "dismissed" }) });
                        setUpgradeReqs(prev => prev.filter(x => x.id !== r.id));
                      }} className="text-xs font-semibold text-red-600 hover:underline">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Payment History */}
            {payments.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 mb-2">Payment History</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b">
                      <th className="pb-1">Date</th>
                      <th className="pb-1">Amount</th>
                      <th className="pb-1">Plan</th>
                      <th className="pb-1">Method</th>
                      <th className="pb-1">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-slate-100">
                        <td className="py-1.5">{new Date(p.recorded_at).toLocaleDateString()}</td>
                        <td className="py-1.5 font-semibold">PKR {Number(p.amount).toLocaleString()}</td>
                        <td className="py-1.5 capitalize">{p.plan}/{p.cycle}</td>
                        <td className="py-1.5 capitalize">{(p.payment_method || "").replace(/_/g, " ")}</td>
                        <td className="py-1.5 text-slate-500">{p.reference_note || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                      {safeDateParse(entry.created_at)?.toLocaleString() ?? "\u2014"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Health Dashboard */}
        <div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Health Dashboard</h2>
            {stats && !stats.message ? (
              <div className="space-y-6">
                {/* Activity */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Activity</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Last Login</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_login)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Last Sale</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_sale)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Last Shift</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_shift_opened)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Active Staff (7d / 30d)</p>
                      <p className="text-sm font-semibold">{stats.active_employees_7d} / {stats.active_employees_30d}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    {[
                      { label: "Today", sales: stats.sales_today, rev: stats.revenue_today },
                      { label: "This Week", sales: stats.sales_this_week, rev: stats.revenue_this_week },
                      { label: "This Month", sales: stats.sales_this_month, rev: stats.revenue_this_month },
                    ].map((p) => (
                      <div key={p.label} className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-500">{p.label}</p>
                        <p className="text-sm font-bold">{p.sales} sales</p>
                        <p className="text-xs text-slate-400">{p.rev?.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Plan Usage */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Plan Usage</h3>
                  {[
                    { label: "Employees", used: stats.employees, max: stats.max_employees },
                    { label: "Products", used: stats.products, max: stats.max_products },
                    { label: "Outlets", used: stats.outlets, max: stats.max_outlets },
                  ].map((d) => {
                    const pct = usagePct(d.used, d.max);
                    return (
                      <div key={d.label} className="mb-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600">{d.label}</span>
                          <span className="font-semibold">{d.used} / {d.max || "\u221E"} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${usageColor(pct)} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Storage & Totals */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Storage & Totals</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Schema Size</p>
                      <p className="text-sm font-bold">{stats.schema_size_mb} MB</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Total Sales</p>
                      <p className="text-sm font-bold">{stats.total_sales?.toLocaleString()}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Customers</p>
                      <p className="text-sm font-bold">{stats.customers?.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">{stats?.message || "Stats unavailable"}</p>
            )}
          </div>
        </div>
      </div>

          {/* Record Payment Modal */}
          {showPaymentModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <h3 className="text-lg font-semibold text-slate-800 mb-4">Record Payment</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Plan</label>
                    <select value={paymentForm.plan} onChange={e => {
                      const plan = e.target.value;
                      const match = planPricing.find(p => p.plan === plan && p.cycle === paymentForm.cycle);
                      setPaymentForm(f => ({ ...f, plan, amount: match ? String(match.price) : f.amount }));
                    }} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Billing Cycle</label>
                    <select value={paymentForm.cycle} onChange={e => {
                      const cycle = e.target.value;
                      const match = planPricing.find(p => p.plan === paymentForm.plan && p.cycle === cycle);
                      setPaymentForm(f => ({ ...f, cycle, amount: match ? String(match.price) : f.amount }));
                    }} className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Amount (PKR)</label>
                    <input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="3000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Payment Method</label>
                    <select value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="jazzcash">JazzCash</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Reference Note</label>
                    <input type="text" value={paymentForm.reference_note} onChange={e => setPaymentForm(f => ({ ...f, reference_note: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Receipt #, transaction ID, etc." />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-5">
                  <button onClick={() => setShowPaymentModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
                  <button onClick={async () => {
                    try {
                      const r = await adminFetch(`/api/admin/tenants/${id}/record-payment`, {
                        method: "POST", headers: {"Content-Type":"application/json"},
                        body: JSON.stringify(paymentForm),
                      });
                      if (r.ok) {
                        setShowPaymentModal(false);
                        // Refresh data
                        adminFetch(`/api/admin/tenants/${id}`).then(r => r.json()).then(setTenant).catch(() => {});
                        adminFetch(`/api/admin/tenants/${id}/payments`).then(r => r.json()).then(setPayments).catch(() => {});
                      }
                    } catch {}
                  }} className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                    Record Payment
                  </button>
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
