import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Database, Download, Eye, MessageSquare, Pause, Pencil, Play, RotateCcw, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";
import { industryLabel, MODE_LABELS } from "./industryLabels";

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
  if (pct >= 90) return "bg-(--ui-danger)";
  if (pct >= 70) return "bg-(--ui-warning-fg)";
  return "bg-(--ui-success-fg)";
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
  const [paymentForm, setPaymentForm] = useState({ plan: "pro", cycle: "monthly", amount: "", payment_method: "bank_transfer", reference_note: "" });
  const [upgradeReqs, setUpgradeReqs] = useState([]);
  const [featureUsage, setFeatureUsage] = useState(null);
  const [featureFlags, setFeatureFlags] = useState([]);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);
  const [editingPricing, setEditingPricing] = useState(null); // { id, price, cycle, plan }
  const [verticalUsage, setVerticalUsage] = useState(null);

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
      adminFetch(`/api/admin/tenants/${id}/feature-usage`).then(r => r.json()).then(setFeatureUsage).catch(() => {});
      adminFetch("/api/admin/upgrade-requests").then(r => r.json()).then(reqs => {
        setUpgradeReqs(reqs.filter(r => r.tenant_id === Number(id)));
      }).catch(() => {});
      adminFetch(`/api/admin/tenants/${id}/feature-flags`).then(r => r.json()).then(setFeatureFlags).catch(() => {});
      adminFetch(`/api/admin/tenants/${id}/notes`).then(r => r.json()).then(setNotes).catch(() => {});
      adminFetch(`/api/admin/tenants/${id}/vertical-usage`).then(r => r.json()).then(setVerticalUsage).catch(() => {});
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

  const toggleFlag = async (key, currentEnabled) => {
    setFlagsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/tenants/${id}/feature-flags`, {
        method: "PUT",
        body: JSON.stringify({ key, enabled: !currentEnabled }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setFeatureFlags(prev => prev.map(f => f.key === key ? { ...f, enabled: !currentEnabled } : f));
    } catch (err) {
      alert(err.message);
    } finally {
      setFlagsLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setNotesLoading(true);
    try {
      const res = await adminFetch(`/api/admin/tenants/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: newNote.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const created = await res.json();
      setNotes(prev => [created, ...prev]);
      setNewNote("");
    } catch (err) {
      alert(err.message);
    } finally {
      setNotesLoading(false);
    }
  };

  const deleteNote = async (noteId) => {
    if (!confirm("Delete this note?")) return;
    try {
      const res = await adminFetch(`/api/admin/tenants/${id}/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) {
      alert(err.message);
    }
  };

  const savePricing = async () => {
    if (!editingPricing) return;
    try {
      const res = await adminFetch(`/api/admin/plan-pricing/${editingPricing.id}`, {
        method: "PUT",
        body: JSON.stringify({ price: Number(editingPricing.price) }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setPlanPricing(prev => prev.map(p => p.id === editingPricing.id ? { ...p, price: Number(editingPricing.price) } : p));
      setEditingPricing(null);
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <p className="py-8 text-center text-sm text-(--ui-text-muted)">Loading...</p>;
  }

  if (error) {
    return (
      <div className="rounded-(--ui-radius-sm) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
        <p className="text-sm text-(--ui-danger-fg)">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate("/admin/tenants")}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-(--ui-text-muted) hover:text-(--ui-text)"
      >
        <ArrowLeft size={14} /> Back to Tenants
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--ui-text)">{tenant.name}</h1>
          <p className="text-sm text-(--ui-text-muted)">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
            tenant.status === "active" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" :
            tenant.status === "suspended" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
            "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
          }`}>{tenant.status}</span>
          <span className="rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text)">
            {tenant.plan}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Info + Edit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tenant details */}
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Details</h2>
              {!editMode ? (
                <button onClick={() => setEditMode(true)} className="text-xs font-medium text-(--ui-link) hover:underline">
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setEditMode(false)} className="text-xs font-medium text-(--ui-text-muted) hover:text-(--ui-text)">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={actionLoading === "save"} className="text-xs font-semibold text-(--ui-link) hover:underline">
                    {actionLoading === "save" ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {editMode ? (
                <>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Name</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Email</span>
                    <input value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Plan</span>
                    <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)">
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Timezone</span>
                    <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Max Employees</span>
                    <input type="number" value={form.max_employees} onChange={(e) => setForm({ ...form, max_employees: Number(e.target.value) })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Max Products</span>
                    <input type="number" value={form.max_products} onChange={(e) => setForm({ ...form, max_products: Number(e.target.value) })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-(--ui-text-muted)">Max Outlets</span>
                    <input type="number" value={form.max_outlets} onChange={(e) => setForm({ ...form, max_outlets: Number(e.target.value) })}
                      className="mt-1 w-full ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)" />
                  </label>
                </>
              ) : (
                <>
                  <div><p className="text-xs text-(--ui-text-muted)">Owner Email</p><p className="font-medium text-(--ui-text)">{tenant.owner_email}</p></div>
                  <div><p className="text-xs text-(--ui-text-muted)">Timezone</p><p className="font-medium text-(--ui-text)">{tenant.timezone}</p></div>
                  <div><p className="text-xs text-(--ui-text-muted)">Max Employees</p><p className="font-medium text-(--ui-text)">{tenant.max_employees}</p></div>
                  <div><p className="text-xs text-(--ui-text-muted)">Max Products</p><p className="font-medium text-(--ui-text)">{tenant.max_products}</p></div>
                  <div><p className="text-xs text-(--ui-text-muted)">Max Outlets</p><p className="font-medium text-(--ui-text)">{tenant.max_outlets}</p></div>
                  <div><p className="text-xs text-(--ui-text-muted)">Created</p><p className="font-medium text-(--ui-text)">{safeDateParse(tenant.created_at)?.toLocaleString() ?? "\u2014"}</p></div>
                </>
              )}
            </div>
          </div>

          {/* Setup Status */}
          {setupInfo && (
            <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Setup Status</h2>
              {setupInfo.setup_complete ? (
                <span className="rounded-full bg-(--ui-success-bg) px-3 py-1 text-xs font-semibold text-(--ui-success-fg)">Setup Complete</span>
              ) : (
                <div className="space-y-3">
                  <span className="rounded-full bg-(--ui-warning-bg) px-3 py-1 text-xs font-semibold text-(--ui-warning-fg)">Pending Setup</span>
                  {setupInfo.setup_url && (
                    <div className="mt-2 flex items-center gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-3">
                      <input
                        readOnly
                        value={setupInfo.setup_url}
                        className="flex-1 bg-transparent text-xs text-(--ui-text) outline-none"
                        onClick={(e) => e.target.select()}
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(setupInfo.setup_url)}
                        className="shrink-0 rounded-full bg-(--ui-primary) px-2 py-1 text-xs font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
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
                    className="text-xs font-medium text-(--ui-link) hover:underline"
                  >
                    Regenerate Token
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {tenant.status === "active" ? (
                <button
                  onClick={() => { if (confirm("Suspend this tenant?")) doAction("/suspend"); }}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-full bg-(--ui-warning-bg) px-3 py-2 text-xs font-semibold text-(--ui-warning-fg) hover:opacity-80 disabled:opacity-50"
                >
                  <Pause size={14} /> {actionLoading === "/suspend" ? "Suspending..." : "Suspend"}
                </button>
              ) : tenant.status === "suspended" ? (
                <button
                  onClick={() => doAction("/activate")}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-full bg-(--ui-success-bg) px-3 py-2 text-xs font-semibold text-(--ui-success-fg) hover:opacity-80 disabled:opacity-50"
                >
                  <Play size={14} /> {actionLoading === "/activate" ? "Activating..." : "Activate"}
                </button>
              ) : null}

              <button
                onClick={() => doAction("/migrate")}
                disabled={!!actionLoading || tenant.status !== "active"}
                className="flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-3 py-2 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-border-strong) disabled:opacity-50"
              >
                <Database size={14} /> {actionLoading === "/migrate" ? "Migrating..." : "Run Migrations"}
              </button>

              <button
                onClick={() => { if (confirm("Reset admin PIN to 0000?")) doAction("/reset-pin"); }}
                disabled={!!actionLoading || tenant.status !== "active"}
                className="flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-3 py-2 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-border-strong) disabled:opacity-50"
              >
                <RotateCcw size={14} /> {actionLoading === "/reset-pin" ? "Resetting..." : "Reset PIN"}
              </button>

              <button
                onClick={async () => {
                  setActionLoading("impersonate");
                  try {
                    const res = await adminFetch(`/api/admin/impersonate/${id}`, { method: "POST" });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    const frontendUrl = window.location.origin;
                    const params = new URLSearchParams({
                      impersonate_token: data.token,
                      impersonate_session: String(data.sessionId),
                      tenant_slug: data.tenantSlug,
                      tenant_name: data.tenantName,
                    });
                    window.open(`${frontendUrl}/context-select?${params.toString()}`, "_blank");
                  } catch (err) {
                    alert(err.message);
                  } finally {
                    setActionLoading("");
                  }
                }}
                disabled={!!actionLoading || tenant.status !== "active"}
                className="flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-3 py-2 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-border-strong) disabled:opacity-50"
              >
                <Eye size={14} /> {actionLoading === "impersonate" ? "Opening..." : "Log in as Tenant"}
              </button>

              <button
                onClick={() => { if (confirm("Soft-delete this tenant? This cannot be easily undone.")) doAction("", "DELETE"); }}
                disabled={!!actionLoading}
                className="flex items-center gap-1.5 rounded-full bg-(--ui-danger-bg) px-3 py-2 text-xs font-semibold text-(--ui-danger-fg) hover:opacity-80 disabled:opacity-50"
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>

          {/* Billing */}
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Billing</h2>
              <button
                onClick={() => {
                  const match = planPricing.find(p => p.plan === paymentForm.plan && p.cycle === paymentForm.cycle);
                  setPaymentForm(f => ({ ...f, amount: match ? String(match.price) : "" }));
                  setShowPaymentModal(true);
                }}
                className="rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) transition-colors"
              >
                Record Payment
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <p className="text-(--ui-text-muted)">Plan</p>
                <p className="font-semibold text-(--ui-text) capitalize">{tenant?.plan || "free"}</p>
              </div>
              <div>
                <p className="text-(--ui-text-muted)">Billing Cycle</p>
                <p className="font-semibold text-(--ui-text) capitalize">{tenant?.billing_cycle || "\u2014"}</p>
              </div>
              <div>
                <p className="text-(--ui-text-muted)">Expires</p>
                <p className="font-semibold text-(--ui-text)">{tenant?.plan_expires_at ? new Date(tenant.plan_expires_at).toLocaleDateString() : "\u2014"}</p>
              </div>
              <div>
                <p className="text-(--ui-text-muted)">Payment Status</p>
                <p className={`font-semibold capitalize ${
                  tenant?.payment_status === "active" ? "text-(--ui-success-fg)" :
                  tenant?.payment_status === "overdue" ? "text-(--ui-danger-fg)" :
                  "text-(--ui-text)"
                }`}>{tenant?.payment_status || "active"}</p>
              </div>
            </div>

            {/* Pending Upgrade Requests */}
            {upgradeReqs.length > 0 && (
              <div className="mb-4 rounded-(--ui-radius-sm) bg-(--ui-muted-surface) border border-(--ui-border) p-3">
                <p className="text-sm font-semibold text-(--ui-text) mb-2">Pending Upgrade Requests</p>
                {upgradeReqs.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm mb-1">
                    <span className="text-(--ui-text)">{"\u2192"} {r.requested_plan} ({r.requested_cycle}){r.message ? `: "${r.message}"` : ""}</span>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await adminFetch(`/api/admin/upgrade-requests/${r.id}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "approved" }) });
                        setUpgradeReqs(prev => prev.filter(x => x.id !== r.id));
                      }} className="text-xs font-semibold text-(--ui-success-fg) hover:underline">Approve</button>
                      <button onClick={async () => {
                        await adminFetch(`/api/admin/upgrade-requests/${r.id}`, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "dismissed" }) });
                        setUpgradeReqs(prev => prev.filter(x => x.id !== r.id));
                      }} className="text-xs font-semibold text-(--ui-danger-fg) hover:underline">Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Payment History */}
            {payments.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase text-(--ui-text-muted)">Payment History</p>
                  <button
                    onClick={() => {
                      const headers = [
                        { key: "recorded_at", label: "Date" },
                        { key: "amount", label: "Amount" },
                        { key: "plan", label: "Plan" },
                        { key: "payment_method", label: "Method" },
                        { key: "reference_note", label: "Reference" },
                      ];
                      downloadCsv(headers, payments, "tenant-payments.csv");
                    }}
                    className="flex items-center gap-1 rounded-full bg-(--ui-muted-surface) px-2 py-1 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-border-strong)"
                  >
                    <Download size={12} /> Export
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                      <th className="pb-1">Date</th>
                      <th className="pb-1">Amount</th>
                      <th className="pb-1">Plan</th>
                      <th className="pb-1">Method</th>
                      <th className="pb-1">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id} className="border-b border-(--ui-border)">
                        <td className="py-1.5">{new Date(p.recorded_at).toLocaleDateString()}</td>
                        <td className="py-1.5 font-semibold">PKR {Number(p.amount).toLocaleString()}</td>
                        <td className="py-1.5 capitalize">{p.plan}/{p.cycle}</td>
                        <td className="py-1.5 capitalize">{(p.payment_method || "").replace(/_/g, " ")}</td>
                        <td className="py-1.5 text-(--ui-text-muted)">{p.reference_note || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Verticals */}
          {verticalUsage && (
            <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Verticals</h2>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-(--ui-text)">{industryLabel(verticalUsage.industry_type)}</span>
                {verticalUsage.business_model && (
                  <span className="rounded-full bg-(--ui-muted-surface) px-2 py-0.5 text-xs font-semibold text-(--ui-text-muted)">
                    {verticalUsage.business_model.replace(/_/g, " ")}
                  </span>
                )}
                {(verticalUsage.modes || []).map((m) => (
                  <span key={m} className="rounded-full bg-(--ui-success-bg) px-2 py-0.5 text-xs font-semibold text-(--ui-success-fg)">
                    {MODE_LABELS[m] || m}
                  </span>
                ))}
                {(verticalUsage.modes || []).length === 0 && (
                  <span className="text-xs text-(--ui-text-muted)">No modes enabled (core retail spine)</span>
                )}
              </div>
              {(verticalUsage.usage || []).filter((u) => u.count > 0).length === 0 ? (
                <p className="text-xs text-(--ui-text-muted)">No vertical activity recorded yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {verticalUsage.usage.filter((u) => u.count > 0).map((u) => (
                    <div key={u.key} className="rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-3">
                      <p className="text-lg font-bold text-(--ui-text)">{u.count.toLocaleString()}</p>
                      <p className="text-xs font-medium text-(--ui-text-muted)">{u.label}</p>
                      {u.last_activity && (
                        <p className="mt-0.5 text-xs text-(--ui-text-muted)">last {timeAgo(u.last_activity)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Feature Flags */}
          {featureFlags.length > 0 && (
            <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Feature Flags</h2>
              <div className="space-y-3">
                {featureFlags.map(flag => (
                  <div key={flag.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-(--ui-text)">{flag.key.replace(/_/g, " ")}</p>
                      {flag.description && <p className="text-xs text-(--ui-text-muted)">{flag.description}</p>}
                    </div>
                    <button
                      onClick={() => toggleFlag(flag.key, flag.enabled)}
                      disabled={flagsLoading}
                      className="shrink-0 disabled:opacity-50"
                      title={flag.enabled ? "Disable" : "Enable"}
                    >
                      {flag.enabled ? (
                        <ToggleRight size={28} className="text-(--ui-primary)" />
                      ) : (
                        <ToggleLeft size={28} className="text-(--ui-border-strong)" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tenant Notes */}
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
              <MessageSquare size={14} /> Notes
            </h2>
            <div className="flex gap-2 mb-4">
              <input
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addNote()}
                placeholder="Add a note..."
                className="flex-1 ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)"
              />
              <button
                onClick={addNote}
                disabled={notesLoading || !newNote.trim()}
                className="shrink-0 rounded-full bg-(--ui-primary) px-3 py-1.5 text-xs font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
              >
                {notesLoading ? "Adding..." : "Add Note"}
              </button>
            </div>
            {notes.length > 0 ? (
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {notes.map(n => (
                  <div key={n.id} className="flex items-start justify-between gap-2 rounded-(--ui-radius-sm) bg-(--ui-muted-surface) p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-(--ui-text) whitespace-pre-wrap">{n.note}</p>
                      <p className="mt-1 text-xs text-(--ui-text-muted)">
                        {n.admin_email} — {safeDateParse(n.created_at)?.toLocaleString() ?? "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteNote(n.id)}
                      className="shrink-0 text-(--ui-text-muted) hover:text-(--ui-danger)"
                      title="Delete note"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">No notes yet.</p>
            )}
          </div>

          {/* Plan Pricing Editor */}
          {planPricing.length > 0 && (
            <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Plan Pricing</h2>
              <div className="space-y-3">
                {planPricing.map(p => (
                  <div key={p.id} className="flex items-center justify-between rounded-(--ui-radius-sm) bg-(--ui-muted-surface) p-3">
                    {editingPricing?.id === p.id ? (
                      <div className="flex flex-1 items-center gap-3">
                        <span className="text-sm font-medium capitalize text-(--ui-text)">{p.plan} / {p.cycle}</span>
                        <input
                          type="number"
                          value={editingPricing.price}
                          onChange={(e) => setEditingPricing({ ...editingPricing, price: e.target.value })}
                          className="w-28 ui-focus-ring rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-(--ui-surface) px-2 py-1 text-sm text-(--ui-text)"
                        />
                        <button onClick={savePricing} className="text-xs font-semibold text-(--ui-success-fg) hover:text-(--ui-success-fg)">Save</button>
                        <button onClick={() => setEditingPricing(null)} className="text-xs font-medium text-(--ui-text-muted) hover:text-(--ui-text)">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="text-sm font-medium capitalize text-(--ui-text)">{p.plan} / {p.cycle}</p>
                          <p className="text-xs text-(--ui-text-muted)">PKR {Number(p.price).toLocaleString()}</p>
                        </div>
                        <button
                          onClick={() => setEditingPricing({ id: p.id, price: String(p.price), cycle: p.cycle, plan: p.plan })}
                          className="shrink-0 text-(--ui-text-muted) hover:text-(--ui-text)"
                          title="Edit pricing"
                        >
                          <Pencil size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit log */}
          {auditLog.length > 0 && (
            <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Audit Log</h2>
              <div className="max-h-60 space-y-2 overflow-y-auto">
                {auditLog.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-(--ui-border) py-1.5 last:border-0">
                    <div>
                      <span className="text-sm font-medium text-(--ui-text)">{entry.action}</span>
                      {entry.actor && <span className="ml-2 text-xs text-(--ui-text-muted)">by {entry.actor}</span>}
                    </div>
                    <span className="text-xs text-(--ui-text-muted)">
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
          <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Health Dashboard</h2>
            {stats && !stats.message ? (
              <div className="space-y-6">
                {/* Activity */}
                <div>
                  <h3 className="text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-3">Activity</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Last Login</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_login)}</p>
                    </div>
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Last Sale</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_sale)}</p>
                    </div>
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Last Shift</p>
                      <p className="text-sm font-semibold">{timeAgo(stats.last_shift_opened)}</p>
                    </div>
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Active Staff (7d / 30d)</p>
                      <p className="text-sm font-semibold">{stats.active_employees_7d} / {stats.active_employees_30d}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    {[
                      { label: "Today", sales: stats.sales_today, rev: stats.revenue_today },
                      { label: "This Week", sales: stats.sales_this_week, rev: stats.revenue_this_week },
                      { label: "This Month", sales: stats.sales_this_month, rev: stats.revenue_this_month },
                    ].map((p) => (
                      <div key={p.label} className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                        <p className="text-xs text-(--ui-text-muted)">{p.label}</p>
                        <p className="text-sm font-bold">{p.sales} sales</p>
                        <p className="text-xs text-(--ui-text-muted)">{p.rev?.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Plan Usage */}
                <div>
                  <h3 className="text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-3">Plan Usage</h3>
                  {[
                    { label: "Employees", used: stats.employees, max: stats.max_employees },
                    { label: "Products", used: stats.products, max: stats.max_products },
                    { label: "Outlets", used: stats.outlets, max: stats.max_outlets },
                  ].map((d) => {
                    const pct = usagePct(d.used, d.max);
                    return (
                      <div key={d.label} className="mb-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-(--ui-text)">{d.label}</span>
                          <span className="font-semibold">{d.used} / {d.max || "\u221E"} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-(--ui-muted-surface) rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${usageColor(pct)} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Storage & Totals */}
                <div>
                  <h3 className="text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-3">Storage & Totals</h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Schema Size</p>
                      <p className="text-sm font-bold">{stats.schema_size_mb} MB</p>
                    </div>
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Total Sales</p>
                      <p className="text-sm font-bold">{stats.total_sales?.toLocaleString()}</p>
                    </div>
                    <div className="bg-(--ui-muted-surface) rounded-(--ui-radius-sm) p-3">
                      <p className="text-xs text-(--ui-text-muted)">Customers</p>
                      <p className="text-sm font-bold">{stats.customers?.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Feature Usage */}
                {featureUsage?.last_30_days?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-3">Feature Usage (30d)</h3>
                    <div className="space-y-2">
                      {featureUsage.last_30_days.map(item => {
                        const maxVal = featureUsage.last_30_days[0]?.total || 1;
                        return (
                          <div key={item.action_type}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-(--ui-text)">{item.action_type.replace(/_/g, " ")}</span>
                              <span className="font-semibold text-(--ui-text)">{item.total}</span>
                            </div>
                            <div className="h-2 bg-(--ui-muted-surface) rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-(--ui-primary) transition-all" style={{ width: `${Math.round((item.total / maxVal) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {featureUsage.top_users?.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-(--ui-text-muted) mb-1.5">Top Users (30d)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {featureUsage.top_users.map(u => (
                            <span key={u.user_name} className="inline-flex items-center gap-1 bg-(--ui-muted-surface) text-(--ui-text) text-xs px-2 py-0.5 rounded-full">
                              {u.user_name} <span className="font-semibold">{u.total}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">{stats?.message || "Stats unavailable"}</p>
            )}
          </div>
        </div>
      </div>

          {/* Record Payment Modal */}
          {showPaymentModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
              <div className="bg-(--ui-surface) rounded-(--ui-radius-lg) shadow-(--ui-shadow-lg) w-full max-w-md p-6">
                <h3 className="text-lg font-semibold text-(--ui-text) mb-4">Record Payment</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Plan</label>
                    <select value={paymentForm.plan} onChange={e => {
                      const plan = e.target.value;
                      const match = planPricing.find(p => p.plan === plan && p.cycle === paymentForm.cycle);
                      setPaymentForm(f => ({ ...f, plan, amount: match ? String(match.price) : f.amount }));
                    }} className="ui-focus-ring w-full border border-(--ui-border-strong) bg-(--ui-surface) rounded-(--ui-radius-sm) px-3 py-2 text-sm text-(--ui-text)">
                      <option value="pro">Pro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Billing Cycle</label>
                    <select value={paymentForm.cycle} onChange={e => {
                      const cycle = e.target.value;
                      const match = planPricing.find(p => p.plan === paymentForm.plan && p.cycle === cycle);
                      setPaymentForm(f => ({ ...f, cycle, amount: match ? String(match.price) : f.amount }));
                    }} className="ui-focus-ring w-full border border-(--ui-border-strong) bg-(--ui-surface) rounded-(--ui-radius-sm) px-3 py-2 text-sm text-(--ui-text)">
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Amount (PKR)</label>
                    <input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                      className="ui-focus-ring w-full border border-(--ui-border-strong) bg-(--ui-surface) rounded-(--ui-radius-sm) px-3 py-2 text-sm text-(--ui-text)" placeholder="3000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Payment Method</label>
                    <select value={paymentForm.payment_method} onChange={e => setPaymentForm(f => ({ ...f, payment_method: e.target.value }))}
                      className="ui-focus-ring w-full border border-(--ui-border-strong) bg-(--ui-surface) rounded-(--ui-radius-sm) px-3 py-2 text-sm text-(--ui-text)">
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="jazzcash">JazzCash</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Reference Note</label>
                    <input type="text" value={paymentForm.reference_note} onChange={e => setPaymentForm(f => ({ ...f, reference_note: e.target.value }))}
                      className="ui-focus-ring w-full border border-(--ui-border-strong) bg-(--ui-surface) rounded-(--ui-radius-sm) px-3 py-2 text-sm text-(--ui-text)" placeholder="Receipt #, transaction ID, etc." />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-5">
                  <button onClick={() => setShowPaymentModal(false)} className="px-4 py-2 text-sm text-(--ui-text) hover:text-(--ui-text)">Cancel</button>
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
                  }} className="px-4 py-2 text-sm font-semibold bg-(--ui-primary) text-(--ui-on-primary) rounded-full hover:bg-(--ui-primary-strong)">
                    Record Payment
                  </button>
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
