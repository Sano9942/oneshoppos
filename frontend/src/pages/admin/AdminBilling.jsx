import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreditCard, Download } from "lucide-react";
import { adminFetch } from "./AdminLogin";
import { downloadCsv } from "../../utils/csvExport";

function Pill({ children, tone = "muted" }) {
  const cls = {
    danger: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
    warning: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    success: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    muted: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function TenantMiniTable({ rows, dateKey, dateLabel }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-(--ui-border) text-left text-xs text-(--ui-text-muted)">
          <th className="py-2 pr-3 font-medium">Tenant</th>
          <th className="py-2 pr-3 font-medium">Plan</th>
          <th className="py-2 font-medium">{dateLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-b border-(--ui-border) last:border-0">
            <td className="py-2 pr-3">
              <Link to={`/admin/tenants/${t.id}`} className="font-medium text-(--ui-text) hover:underline">{t.name}</Link>
              <span className="ml-1 text-xs text-(--ui-text-muted)">({t.slug})</span>
            </td>
            <td className="py-2 pr-3 text-xs text-(--ui-text-muted)">{t.plan}</td>
            <td className="py-2 text-xs text-(--ui-text-muted)">{t[dateKey] ? new Date(t[dateKey]).toLocaleDateString() : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminBilling() {
  const navigate = useNavigate();
  const [attention, setAttention] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [upgradeReqs, setUpgradeReqs] = useState([]);
  const [payments, setPayments] = useState(null);
  const [editingPrice, setEditingPrice] = useState(null); // { id, price }
  const [savingPrice, setSavingPrice] = useState(false);
  const [actingReq, setActingReq] = useState(null);
  const [error, setError] = useState("");

  const loadAll = () => {
    adminFetch("/api/admin/billing-attention")
      .then((r) => { if (r.status === 401) { navigate("/admin/login", { replace: true }); return null; } return r.json(); })
      .then((d) => { if (d) setAttention(d); })
      .catch((e) => setError(e.message));
    adminFetch("/api/admin/plan-pricing").then((r) => r.json()).then((d) => setPricing(Array.isArray(d) ? d : [])).catch(() => {});
    adminFetch("/api/admin/upgrade-requests").then((r) => r.json()).then((d) => setUpgradeReqs(Array.isArray(d) ? d : [])).catch(() => {});
    adminFetch("/api/admin/payments?limit=50").then((r) => r.json()).then(setPayments).catch(() => {});
  };

  useEffect(() => { loadAll(); }, []);

  const savePrice = async () => {
    if (!editingPrice) return;
    setSavingPrice(true);
    try {
      const res = await adminFetch(`/api/admin/plan-pricing/${editingPrice.id}`, {
        method: "PUT",
        body: JSON.stringify({ price: Number(editingPrice.price) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setPricing((prev) => prev.map((p) => (p.id === d.id ? d : p)));
      setEditingPrice(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingPrice(false);
    }
  };

  const actOnUpgrade = async (id, status) => {
    setActingReq(id);
    try {
      const res = await adminFetch(`/api/admin/upgrade-requests/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setUpgradeReqs((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (err) {
      alert(err.message);
    } finally {
      setActingReq(null);
    }
  };

  const pendingReqs = upgradeReqs.filter((r) => r.status === "pending");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-(--ui-text)">Billing</h1>
        <Link
          to="/admin/stuck-payments"
          className="ui-focus-ring flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-2 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
        >
          <CreditCard size={15} /> Stuck Payments
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3">
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}

      {/* Attention lists */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { key: "due_soon", title: "Due within 7 days", tone: "warning", dateKey: "plan_expires_at", dateLabel: "Expires" },
          { key: "overdue", title: "Overdue (in grace)", tone: "warning", dateKey: "grace_ends_at", dateLabel: "Grace ends" },
          { key: "past_grace", title: "Past grace", tone: "danger", dateKey: "grace_ends_at", dateLabel: "Grace ended" },
        ].map((section) => (
          <div key={section.key} className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">{section.title}</h2>
              <Pill tone={(attention?.[section.key] || []).length > 0 ? section.tone : "success"}>
                {(attention?.[section.key] || []).length}
              </Pill>
            </div>
            {!attention ? (
              <p className="text-xs text-(--ui-text-muted)">Loading...</p>
            ) : (attention[section.key] || []).length === 0 ? (
              <p className="text-xs text-(--ui-text-muted)">Nothing here.</p>
            ) : (
              <TenantMiniTable rows={attention[section.key]} dateKey={section.dateKey} dateLabel={section.dateLabel} />
            )}
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Plan pricing editor */}
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Plan Pricing</h2>
          {pricing.length === 0 ? (
            <p className="text-xs text-(--ui-text-muted)">No pricing rows.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-xs text-(--ui-text-muted)">
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Cycle</th>
                  <th className="py-2 pr-3 font-medium text-right">Price</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {pricing.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border) last:border-0">
                    <td className="py-2 pr-3 font-medium capitalize text-(--ui-text)">{p.plan}</td>
                    <td className="py-2 pr-3 text-xs capitalize text-(--ui-text-muted)">{p.cycle}</td>
                    <td className="py-2 pr-3 text-right">
                      {editingPrice?.id === p.id ? (
                        <input
                          type="number"
                          value={editingPrice.price}
                          onChange={(e) => setEditingPrice({ ...editingPrice, price: e.target.value })}
                          className="ui-focus-ring w-24 rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-2 py-1 text-right text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="text-(--ui-text)">{Number(p.price).toLocaleString()} {p.currency_code || ""}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {editingPrice?.id === p.id ? (
                        <span className="flex justify-end gap-1">
                          <button onClick={savePrice} disabled={savingPrice} className="ui-focus-ring rounded-full bg-(--ui-primary) px-3 py-1 text-xs font-semibold text-(--ui-on-primary) disabled:opacity-50">
                            {savingPrice ? "..." : "Save"}
                          </button>
                          <button onClick={() => setEditingPrice(null)} className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text)">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => setEditingPrice({ id: p.id, price: p.price })} className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Upgrade requests */}
        <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">Upgrade Requests</h2>
            <Pill tone={pendingReqs.length > 0 ? "warning" : "success"}>{pendingReqs.length} pending</Pill>
          </div>
          {upgradeReqs.length === 0 ? (
            <p className="text-xs text-(--ui-text-muted)">No upgrade requests.</p>
          ) : (
            <div className="space-y-2">
              {upgradeReqs.slice(0, 20).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-(--ui-radius-sm) border border-(--ui-border) px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-(--ui-text)">
                      {r.tenant_name || r.tenant_slug || `Tenant #${r.tenant_id}`}
                      <span className="ml-1.5 text-xs font-normal text-(--ui-text-muted)">
                        {r.requested_plan || r.plan} / {r.requested_cycle || r.cycle}
                      </span>
                    </p>
                    <p className="text-xs text-(--ui-text-muted)">{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</p>
                  </div>
                  {r.status === "pending" ? (
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        disabled={actingReq === r.id}
                        onClick={() => actOnUpgrade(r.id, "approved")}
                        className="ui-focus-ring rounded-full bg-(--ui-primary) px-3 py-1 text-xs font-semibold text-(--ui-on-primary) disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={actingReq === r.id}
                        onClick={() => actOnUpgrade(r.id, "dismissed")}
                        className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text) disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </span>
                  ) : (
                    <Pill tone={r.status === "approved" ? "success" : "muted"}>{r.status}</Pill>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payments */}
      <div className="rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Recent Payments {payments ? `(${payments.total} total)` : ""}
          </h2>
          {payments?.payments?.length > 0 && (
            <button
              onClick={() => downloadCsv(
                [
                  { key: "recorded_at", label: "Date" },
                  { key: "tenant_slug", label: "Tenant" },
                  { key: "plan", label: "Plan" },
                  { key: "cycle", label: "Cycle" },
                  { key: "amount", label: "Amount" },
                  { key: "payment_method", label: "Method" },
                  { key: "reference_note", label: "Reference" },
                ],
                payments.payments,
                "admin-payments.csv"
              )}
              className="ui-focus-ring flex items-center gap-1 rounded-full bg-(--ui-muted-surface) px-3 py-1.5 text-xs font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)"
            >
              <Download size={13} /> Export
            </button>
          )}
        </div>
        {!payments ? (
          <p className="text-xs text-(--ui-text-muted)">Loading...</p>
        ) : payments.payments.length === 0 ? (
          <p className="text-xs text-(--ui-text-muted)">No payments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-xs text-(--ui-text-muted)">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Tenant</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium text-right">Amount</th>
                  <th className="py-2 pr-3 font-medium">Method</th>
                  <th className="py-2 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody>
                {payments.payments.map((p) => (
                  <tr key={p.id} className="border-b border-(--ui-border) last:border-0">
                    <td className="py-2 pr-3 text-xs text-(--ui-text-muted) whitespace-nowrap">{p.recorded_at ? new Date(p.recorded_at).toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3">
                      {p.tenant_id ? (
                        <Link to={`/admin/tenants/${p.tenant_id}`} className="font-medium text-(--ui-text) hover:underline">{p.tenant_name || p.tenant_slug}</Link>
                      ) : (
                        <span className="text-(--ui-text-muted)">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs capitalize text-(--ui-text-muted)">{p.plan} / {p.cycle}</td>
                    <td className="py-2 pr-3 text-right text-(--ui-text)">{Number(p.amount).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-xs text-(--ui-text-muted)">{p.payment_method || "—"}</td>
                    <td className="py-2 text-xs text-(--ui-text-muted)">{p.reference_note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
