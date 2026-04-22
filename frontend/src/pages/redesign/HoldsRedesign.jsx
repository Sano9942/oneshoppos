import { useEffect, useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { Package, RefreshCw, X } from "lucide-react";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Badge,
  Button,
  EmptyState,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const STATUS_TONES = {
  active: "amber",
  paid: "emerald",
  completed: "slate",
  cancelled: "slate",
  forfeit: "rose",
};

export default function HoldsRedesign() {
  const { fmt } = useCurrency();
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [rows, setRows] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [outletFilter, setOutletFilter] = useState("");
  const [expiringDays, setExpiringDays] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (outletFilter) params.outlet_id = outletFilter;
      if (expiringDays) params.expiring_within_days = expiringDays;
      const data = await api.get("/api/holds", params);
      setRows(data.holds || []);
    } catch (e) {
      setError(e.message || "Failed to load holds");
    } finally {
      setLoading(false);
    }
  };

  const loadOutlets = async () => {
    try {
      const data = await api.get("/api/outlets");
      setOutlets(data.outlets || []);
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    if (!flagsLoading && flags.phase2g_holds) {
      load();
      loadOutlets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagsLoading, flags.phase2g_holds, statusFilter, outletFilter, expiringDays]);

  const openDetail = async (id) => {
    setBusy(true);
    try {
      const data = await api.get(`/api/holds/${id}`);
      setDetail(data);
    } catch (e) {
      setError(e.message || "Failed to load hold detail");
    } finally {
      setBusy(false);
    }
  };

  const cancelHold = async (id, forfeit = false) => {
    const reason = window.prompt("Reason for cancellation? (optional)") || "";
    setBusy(true);
    try {
      await api.post(`/api/holds/${id}/cancel`, { reason, forfeit_deposit: forfeit });
      setDetail(null);
      await load();
    } catch (e) {
      setError(e.message || "Failed to cancel hold");
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        count: acc.count + 1,
        total: acc.total + Number(r.total_amount || 0),
        balance: acc.balance + Number(r.balance_due || 0),
      }),
      { count: 0, total: 0, balance: 0 },
    );
  }, [rows]);

  if (flagsLoading) return null;
  if (!flags.phase2g_holds) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Holds & Layaway"
      subtitle="Reservations with deposits waiting for pickup"
      right={
        <Button onClick={load} disabled={loading} tone="primary" size="sm">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      }
    >
      <SectionCard>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="paid">Paid (awaiting pickup)</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="forfeit">Forfeit</option>
          </Select>
          <Select label="Outlet" value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
            <option value="">All outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
          <Select label="Expiring" value={expiringDays} onChange={(e) => setExpiringDays(e.target.value)}>
            <option value="">—</option>
            <option value="3">Next 3 days</option>
            <option value="7">Next 7 days</option>
            <option value="14">Next 14 days</option>
          </Select>
        </div>

        {error && <div className="text-rose-600 text-sm mb-2">{error}</div>}

        <div className="grid grid-cols-3 gap-2 mb-3 text-xs">
          <div className="bg-slate-50 rounded px-3 py-2">
            <div className="text-slate-500">Count</div>
            <div className="text-lg font-bold">{totals.count}</div>
          </div>
          <div className="bg-slate-50 rounded px-3 py-2">
            <div className="text-slate-500">Total held</div>
            <div className="text-lg font-bold">{fmt(totals.total)}</div>
          </div>
          <div className="bg-slate-50 rounded px-3 py-2">
            <div className="text-slate-500">Balance outstanding</div>
            <div className="text-lg font-bold">{fmt(totals.balance)}</div>
          </div>
        </div>

        {rows.length === 0 && !loading && (
          <EmptyState
            icon={Package}
            title="No holds"
            description="Customer holds will appear here once created from the POS."
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto border border-(--ui-border) rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-(--ui-muted-surface) text-(--ui-muted) text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Hold #</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-left px-3 py-2">Outlet</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-right px-3 py-2">Balance</th>
                  <th className="text-left px-3 py-2">Expires</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-(--ui-border) hover:bg-slate-50">
                    <td className="px-3 py-2 font-semibold">{r.hold_number}</td>
                    <td className="px-3 py-2">
                      {r.customer_name_full || r.customer_name || "Walk-in"}
                      {r.customer_phone && <div className="text-xs text-slate-400">{r.customer_phone}</div>}
                    </td>
                    <td className="px-3 py-2">{r.outlet_name || r.outlet_id}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.total_amount)}</td>
                    <td className="px-3 py-2 text-right font-bold">{fmt(r.balance_due)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{fmtUtcDateTime(r.hold_until)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONES[r.status] || "slate"}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => openDetail(r.id)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {detail && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div
            className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <div className="text-xl font-black">{detail.hold.hold_number}</div>
                <div className="text-xs text-slate-500">
                  {detail.hold.customer_name_full || detail.hold.customer_name || "Walk-in"}
                  {detail.hold.customer_phone && <span> · {detail.hold.customer_phone}</span>}
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-slate-500">Status</div><Badge tone={STATUS_TONES[detail.hold.status]}>{detail.hold.status}</Badge></div>
                <div><div className="text-xs text-slate-500">Total</div><div className="font-bold">{fmt(detail.hold.total_amount)}</div></div>
                <div><div className="text-xs text-slate-500">Paid</div><div className="font-bold text-emerald-600">{fmt(detail.hold.deposit_paid)}</div></div>
                <div><div className="text-xs text-slate-500">Balance</div><div className="font-bold text-[#8066FF]">{fmt(detail.hold.balance_due)}</div></div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Items</h4>
                <table className="w-full text-sm border border-slate-100 rounded">
                  <tbody>
                    {detail.items.map((it) => (
                      <tr key={it.id} className="border-t first:border-t-0 border-slate-100">
                        <td className="px-3 py-2">{it.product_name}</td>
                        <td className="px-3 py-2 text-right">Qty {it.quantity}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(Number(it.price_at_hold) * Number(it.quantity))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Payment history</h4>
                  <table className="w-full text-sm border border-slate-100 rounded">
                    <tbody>
                      {detail.payments.map((p) => (
                        <tr key={p.id} className="border-t first:border-t-0 border-slate-100">
                          <td className="px-3 py-2 text-xs text-slate-500">{fmtUtcDateTime(p.paid_at)}</td>
                          <td className="px-3 py-2">{p.method}</td>
                          <td className="px-3 py-2 text-right font-semibold">{fmt(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail.hold.notes && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-slate-400 mb-1">Notes</h4>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap">{detail.hold.notes}</div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
              {["active", "paid"].includes(detail.hold.status) && (
                <>
                  <Button size="sm" onClick={() => cancelHold(detail.hold.id, false)} disabled={busy}>
                    Cancel & refund
                  </Button>
                  <Button size="sm" tone="danger" onClick={() => cancelHold(detail.hold.id, true)} disabled={busy}>
                    Cancel & forfeit deposit
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
