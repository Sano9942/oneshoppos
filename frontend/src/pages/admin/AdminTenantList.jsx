import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Plus, Search, Server, Trash2 } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";
import { industryLabel } from "./industryLabels";

function safeDateParse(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function healthDot(t) {
  if (!t.setup_complete) return { color: "bg-(--ui-text-muted)", label: "Setup pending" };
  const lastLogin = safeDateParse(t.last_login);
  if (!lastLogin) return { color: "bg-(--ui-danger)", label: "Never logged in" };
  const days = (Date.now() - lastLogin.getTime()) / 86400000;
  if (days < 1) return { color: "bg-(--ui-success-fg)", label: "Active today" };
  if (days < 7) return { color: "bg-(--ui-warning-fg)", label: `${Math.floor(days)}d ago` };
  return { color: "bg-(--ui-danger)", label: `${Math.floor(days)}d ago` };
}

function timeAgo(ts) {
  const d = safeDateParse(ts);
  if (!d) return "—";
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
  const [filterIndustry, setFilterIndustry] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [form, setForm] = useState({ slug: "", name: "", owner_email: "", timezone: "UTC", pin: "", plan: "free" });
  const [createdSetupUrl, setCreatedSetupUrl] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [fleet, setFleet] = useState(null);
  const [showFleetDelete, setShowFleetDelete] = useState(false);
  const [fleetDeleteConfirm, setFleetDeleteConfirm] = useState("");
  const [fleetActing, setFleetActing] = useState(false);

  const loadTenants = () => {
    adminFetch("/api/admin/tenants")
      .then((r) => {
        if (r.status === 401) { navigate("/admin/login", { replace: true }); return null; }
        return r.json();
      })
      .then((data) => { if (data) setTenants(data.tenants || []); })
      .finally(() => setLoading(false));
    adminFetch("/api/admin/test-fleet").then((r) => r.json()).then(setFleet).catch(() => {});
  };

  useEffect(() => { loadTenants(); }, []);

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkLifecycle = async (tenantIds, action, days) => {
    setBulkActing(true);
    try {
      const res = await adminFetch("/api/admin/tenants/bulk-lifecycle", {
        method: "POST",
        body: JSON.stringify({ tenant_ids: tenantIds, action, days }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setSelected(new Set());
      loadTenants();
      return d;
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkActing(false);
    }
  };

  const deleteFleet = async () => {
    setFleetActing(true);
    try {
      const res = await adminFetch("/api/admin/test-fleet/delete", {
        method: "POST",
        body: JSON.stringify({ prefix: fleet.prefix, confirm: fleetDeleteConfirm }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setShowFleetDelete(false);
      setFleetDeleteConfirm("");
      loadTenants();
      alert(`Deleted ${d.count} test tenants${d.errors?.length ? ` (${d.errors.length} errors)` : ""}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setFleetActing(false);
    }
  };

  const filtered = tenants.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    const matchIndustry = filterIndustry === "all" || (t.industry_type || "unknown") === filterIndustry;
    return matchSearch && matchStatus && matchIndustry;
  });

  // Industry filter options from the data actually present (not all 23 presets).
  const industryOptions = [...new Set(tenants.map((t) => t.industry_type).filter(Boolean))].sort();

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
        <h1 className="text-2xl font-bold text-(--ui-text)">Tenants</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const headers = [
                { key: "name", label: "Name" },
                { key: "slug", label: "Slug" },
                { key: "industry_type", label: "Industry" },
                { key: "plan", label: "Plan" },
                { key: "status", label: "Status" },
                { key: "created_at", label: "Created" },
              ];
              downloadCsv(headers, filtered, "admin-tenants.csv");
            }}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
          >
            <Download size={15} /> Export
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
          >
            <Plus size={16} /> New Tenant
          </button>
        </div>
      </div>

      {/* Test fleet card */}
      {fleet?.count > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3">
          <div className="text-sm text-(--ui-text)">
            <span className="font-semibold">Test fleet</span>
            <span className="ml-2 text-(--ui-text-muted)">
              {fleet.count} tenants matching <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">{fleet.prefix}*</code>
              {(() => {
                const soonest = fleet.tenants
                  .map((t) => safeDateParse(t.trial_ends_at))
                  .filter(Boolean)
                  .sort((a, b) => a - b)[0];
                return soonest ? ` · soonest trial expiry ${soonest.toLocaleDateString()}` : "";
              })()}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              disabled={bulkActing}
              onClick={async () => {
                const d = await bulkLifecycle(fleet.tenants.map((t) => t.id), "extend_trial", 30);
                if (d) alert(`Extended trial for ${d.updated} test tenants by 30 days`);
              }}
              className="ui-focus-ring rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {bulkActing ? "Working..." : "Extend all +30d"}
            </button>
            <button
              disabled={fleetActing}
              onClick={() => { setFleetDeleteConfirm(""); setShowFleetDelete(true); }}
              className="ui-focus-ring rounded-full bg-(--ui-danger) px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Delete fleet
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-(--ui-surface) px-4 py-2.5">
          <span className="text-sm font-semibold text-(--ui-text)">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              disabled={bulkActing}
              onClick={async () => {
                const d = await bulkLifecycle([...selected], "extend_trial", 30);
                if (d) alert(`Extended trial for ${d.updated} tenants by 30 days`);
              }}
              className="ui-focus-ring rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              Extend trial +30d
            </button>
            <button
              disabled={bulkActing}
              onClick={async () => {
                if (!confirm(`Expire ${selected.size} tenant(s) now? Writes will be blocked until payment (free-plan tenants are unaffected).`)) return;
                const d = await bulkLifecycle([...selected], "expire_now");
                if (d) alert(`Expired ${d.updated} tenants`);
              }}
              className="ui-focus-ring rounded-full bg-(--ui-danger) px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Expire now
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1.5 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-(--ui-text-muted)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or slug..."
            className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white py-2 pl-9 pr-3 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={filterIndustry}
          onChange={(e) => setFilterIndustry(e.target.value)}
          className="ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
        >
          <option value="all">All Industries</option>
          {industryOptions.map((key) => (
            <option key={key} value={key}>{industryLabel(key)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <p className="py-8 text-center text-sm text-(--ui-text-muted)">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) py-12">
          <Server size={32} className="mb-2 text-(--ui-text-muted)" />
          <p className="text-sm text-(--ui-text-muted)">No tenants found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) bg-(--ui-muted-surface) text-left">
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((t) => selected.has(t.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((t) => t.id)) : new Set())}
                    title="Select all (filtered)"
                  />
                </th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Name</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Slug</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Industry</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Health</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Plan</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Revenue</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Status</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Payment</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Expires</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Last Activity</th>
                <th className="px-4 py-3 font-semibold text-(--ui-text-muted)">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer border-b border-(--ui-border) transition hover:bg-(--ui-muted-surface)"
                  onClick={() => navigate(`/admin/tenants/${t.id}`)}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelected(t.id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-(--ui-text)">{t.name}</td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">{t.slug}</td>
                  <td className="px-4 py-3">
                    <span className="text-(--ui-text)">{industryLabel(t.industry_type)}</span>
                    {t.modes?.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-(--ui-muted-surface) px-1.5 py-0.5 text-xs font-semibold text-(--ui-text-muted)" title={t.modes.join(", ")}>
                        {t.modes.length} {t.modes.length === 1 ? "mode" : "modes"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${healthDot(t).color}`} title={healthDot(t).label} />
                      <span className="text-xs text-(--ui-text-muted)">{healthDot(t).label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-xs font-semibold text-(--ui-text-muted)">
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-(--ui-text)">
                    {t.revenue_this_month != null ? Number(t.revenue_this_month).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.status === "active" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" :
                      t.status === "suspended" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
                      "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t.plan !== "free" ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        t.payment_status === "active" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" :
                        t.payment_status === "overdue" ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)" :
                        t.payment_status === "due" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
                        "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                      }`}>{t.payment_status || "active"}</span>
                    ) : (
                      <span className="text-xs text-(--ui-text-muted)">{"—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                    {t.plan_expires_at ? new Date(t.plan_expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">{timeAgo(t.last_login)}</td>
                  <td className="px-4 py-3 text-(--ui-text-muted)">
                    {safeDateParse(t.created_at)?.toLocaleDateString() ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(t); setDeleteConfirm(""); }}
                      className="ui-focus-ring rounded-full p-1.5 text-(--ui-text-muted) transition hover:bg-(--ui-danger-bg) hover:text-(--ui-danger-fg)"
                      title="Delete tenant"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-lg rounded-(--ui-radius-lg) bg-white p-6 shadow-(--ui-shadow-lg)" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-(--ui-text)">Provision New Tenant</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Slug *</span>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                    placeholder="my_shop"
                    pattern="^[a-z0-9_]{3,40}$"
                    title="3-40 characters: lowercase letters, numbers, underscores only"
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                    required
                  />
                  <span className="mt-1 block text-xs text-(--ui-text-muted)">Lowercase letters, numbers, underscores only (3-40 chars)</span>
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Name *</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="My Shop"
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Owner Email</span>
                  <input
                    type="email"
                    value={form.owner_email}
                    onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                    placeholder="owner@example.com"
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Admin PIN *</span>
                  <input
                    type="password"
                    value={form.pin}
                    onChange={(e) => setForm({ ...form, pin: e.target.value })}
                    placeholder="0000"
                    maxLength={8}
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Timezone</span>
                  <input
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    placeholder="UTC"
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Plan</span>
                  <select
                    value={form.plan}
                    onChange={(e) => setForm({ ...form, plan: e.target.value })}
                    className="ui-focus-ring mt-1 w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm text-(--ui-text)"
                  >
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                  </select>
                </label>
              </div>

              {createError && <p className="text-sm font-medium text-(--ui-danger)">{createError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong) disabled:opacity-60"
                >
                  {creating ? "Provisioning..." : "Create Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {createdSetupUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" onClick={() => setCreatedSetupUrl("")}>
          <div className="w-full max-w-lg rounded-(--ui-radius-lg) bg-white p-6 shadow-(--ui-shadow-lg)" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-(--ui-success-fg)">Tenant Created!</h2>
            <p className="mb-3 text-sm text-(--ui-text-muted)">Send this setup URL to the tenant owner so they can configure their store:</p>
            <div className="flex items-center gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-3">
              <input
                readOnly
                value={createdSetupUrl}
                className="flex-1 bg-transparent text-sm text-(--ui-text) outline-none"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(createdSetupUrl); }}
                className="ui-focus-ring shrink-0 rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
              >
                Copy
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setCreatedSetupUrl("")}
                className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fleet Delete Confirmation Modal */}
      {showFleetDelete && fleet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" onClick={() => { if (!fleetActing) setShowFleetDelete(false); }}>
          <div className="w-full max-w-md rounded-(--ui-radius-lg) bg-white p-6 shadow-(--ui-shadow-lg)" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-(--ui-danger)">Delete Test Fleet</h2>
            <p className="mb-4 text-sm text-(--ui-text-muted)">
              This permanently drops <span className="font-semibold text-(--ui-danger)">{fleet.count} tenant schemas</span> matching{" "}
              <code className="rounded bg-(--ui-muted-surface) px-1.5 py-0.5 font-mono text-sm">{fleet.prefix}*</code>.
              Type <code className="rounded bg-(--ui-muted-surface) px-1.5 py-0.5 font-mono text-sm font-semibold text-(--ui-danger)">{fleet.prefix}</code> to confirm.
            </p>
            <input
              value={fleetDeleteConfirm}
              onChange={(e) => setFleetDeleteConfirm(e.target.value)}
              placeholder={fleet.prefix}
              className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 font-mono text-sm text-(--ui-text)"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFleetDelete(false)}
                disabled={fleetActing}
                className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                disabled={fleetDeleteConfirm !== fleet.prefix || fleetActing}
                onClick={deleteFleet}
                className="ui-focus-ring rounded-full bg-(--ui-danger) px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {fleetActing ? "Deleting..." : `Delete ${fleet.count} tenants`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" onClick={() => { if (!deleting) setDeleteTarget(null); }}>
          <div className="w-full max-w-md rounded-(--ui-radius-lg) bg-white p-6 shadow-(--ui-shadow-lg)" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-(--ui-danger)">Delete Tenant</h2>
            <p className="mb-4 text-sm text-(--ui-text-muted)">
              Type <code className="rounded bg-(--ui-muted-surface) px-1.5 py-0.5 font-mono text-sm font-semibold text-(--ui-danger)">{deleteTarget.slug}</code> to confirm deletion. This will permanently drop all data.
            </p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={deleteTarget.slug}
              className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 text-sm font-mono text-(--ui-text)"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong) disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                disabled={deleteConfirm !== deleteTarget.slug || deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await adminFetch(`/api/admin/tenants/${deleteTarget.id}`, { method: "DELETE" });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error || "Failed to delete tenant");
                    }
                    setDeleteTarget(null);
                    loadTenants();
                  } catch (err) {
                    alert(err.message);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="ui-focus-ring rounded-full bg-(--ui-danger) px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
