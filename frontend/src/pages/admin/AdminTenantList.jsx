import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Server } from "lucide-react";
import { adminFetch } from "./AdminLogin";

function safeDateParse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function healthDot(t) {
  if (!t.setup_complete) return { color: "bg-slate-400", label: "Setup pending" };
  const lastLogin = safeDateParse(t.last_login);
  if (!lastLogin) return { color: "bg-red-500", label: "Never logged in" };
  const days = (Date.now() - lastLogin.getTime()) / 86400000;
  if (days < 1) return { color: "bg-emerald-500", label: "Active today" };
  if (days < 7) return { color: "bg-amber-500", label: `${Math.floor(days)}d ago` };
  return { color: "bg-red-500", label: `${Math.floor(days)}d ago` };
}

function timeAgo(ts) {
  const d = safeDateParse(ts);
  if (!d) return "\u2014";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AdminTenantList() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState({ slug: "", name: "", owner_email: "", timezone: "UTC", pin: "", plan: "free" });
  const [createdSetupUrl, setCreatedSetupUrl] = useState("");

  const loadTenants = () => {
    adminFetch("/api/admin/tenants")
      .then((r) => {
        if (r.status === 401) { navigate("/admin/login", { replace: true }); return null; }
        return r.json();
      })
      .then((data) => { if (data) setTenants(data.tenants || []); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTenants(); }, []);

  const filtered = tenants.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const res = await adminFetch("/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create tenant");
      setShowCreate(false);
      setForm({ slug: "", name: "", owner_email: "", timezone: "UTC", pin: "", plan: "free" });
      if (data.setup_url) setCreatedSetupUrl(data.setup_url);
      loadTenants();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Tenants</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500"
        >
          <Plus size={16} /> New Tenant
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or slug..."
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-12">
          <Server size={32} className="mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">No tenants found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left">
                <th className="px-4 py-3 font-semibold text-slate-500">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Slug</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Health</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Plan</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Revenue</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Payment</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Expires</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Last Activity</th>
                <th className="px-4 py-3 font-semibold text-slate-500">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer border-b border-slate-50 transition hover:bg-slate-50"
                  onClick={() => navigate(`/admin/tenants/${t.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-slate-700">{t.name}</td>
                  <td className="px-4 py-3 text-slate-500">{t.slug}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${healthDot(t).color}`} title={healthDot(t).label} />
                      <span className="text-xs text-slate-500">{healthDot(t).label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.revenue_this_month != null ? Number(t.revenue_this_month).toLocaleString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.status === "active" ? "bg-emerald-100 text-emerald-700" :
                      t.status === "suspended" ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-500"
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.plan !== "free" ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        t.payment_status === "active" ? "bg-emerald-100 text-emerald-700" :
                        t.payment_status === "overdue" ? "bg-red-100 text-red-700" :
                        t.payment_status === "due" ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-500"
                      }`}>{t.payment_status || "active"}</span>
                    ) : (
                      <span className="text-xs text-slate-400">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {t.plan_expires_at ? new Date(t.plan_expires_at).toLocaleDateString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{timeAgo(t.last_login)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {safeDateParse(t.created_at)?.toLocaleDateString() ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-800">Provision New Tenant</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Slug *</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                    placeholder="my_shop"
                    pattern="^[a-z0-9_]{3,40}$"
                    title="3-40 characters: lowercase letters, numbers, underscores only"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                    required
                  />
                  <span className="mt-1 block text-xs text-slate-400">Lowercase letters, numbers, underscores only (3-40 chars)</span>
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="My Shop"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Owner Email</span>
                  <input
                    type="email"
                    value={form.owner_email}
                    onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                    placeholder="owner@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Admin PIN *</span>
                  <input
                    type="password"
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value })}
                    placeholder="0000"
                    maxLength={8}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Timezone</span>
                  <input
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    placeholder="UTC"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-slate-500">Plan</span>
                  <select
                    value={form.plan}
                    onChange={(e) => setForm({ ...form, plan: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
              </div>

              {createError && <p className="text-sm font-medium text-red-600">{createError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
                >
                  {creating ? "Provisioning..." : "Create Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {createdSetupUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreatedSetupUrl("")}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-emerald-700">Tenant Created!</h2>
            <p className="mb-3 text-sm text-slate-600">Send this setup URL to the tenant owner so they can configure their store:</p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                readOnly
                value={createdSetupUrl}
                className="flex-1 bg-transparent text-sm text-slate-700 outline-none"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(createdSetupUrl); }}
                className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
              >
                Copy
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setCreatedSetupUrl("")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
