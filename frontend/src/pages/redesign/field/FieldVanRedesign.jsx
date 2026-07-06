import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Truck, Play, ClipboardCheck, ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import useFeatureFlags from "../../../hooks/useFeatureFlags";

/**
 * V02 wholesale van sales — the rep's van screen (mobile PWA).
 *
 * A van IS an outlet, so this page is thin: show my van's stock, open the
 * selling day (cash shift — sales require one), and submit the day-end count
 * (draft reconciliation; a manager confirms from the back office). Selling
 * from the van is the normal order-capture flow with the van as the outlet.
 */
export default function FieldVanRedesign() {
  const navigate = useNavigate();
  const { hasPerm, authHeaders } = useAuth();
  const { fmt } = useCurrency();
  const { success: toastOk, error: toastErr } = useToast();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeadersMemo);

  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(null); // { van, stock, open_shift, today }
  const [openingFloat, setOpeningFloat] = useState("");
  const [busy, setBusy] = useState(false);

  // Day-end reconcile
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState({}); // product_id -> counted string
  const [cashCounted, setCashCounted] = useState("");
  const [varianceReason, setVarianceReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/van/mine");
      setMine(data);
    } catch (e) {
      toastErr(e.message || "Failed to load van");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (flagsLoading || !flags.wholesale_van_sales) return;
    load();
  }, [flagsLoading, flags.wholesale_van_sales, load]);

  const openDay = async () => {
    if (!mine?.van) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/van/${mine.van.id}/open-day`, {
        opening_float: Number(openingFloat || 0),
      });
      toastOk(res.already_open ? "Day already open" : "Selling day opened");
      await load();
    } catch (e) {
      toastErr(e.message || "Could not open the day");
    } finally {
      setBusy(false);
    }
  };

  const submitCount = async () => {
    if (!mine?.van) return;
    const lines = (mine.stock || []).map((s) => ({
      product_id: s.product_id,
      counted: Number(counts[s.product_id] ?? s.quantity),
    }));
    if (lines.some((l) => !Number.isFinite(l.counted) || l.counted < 0)) {
      return toastErr("Enter a valid count for every item");
    }
    setBusy(true);
    try {
      await api.post(`/api/van/${mine.van.id}/reconcile`, {
        lines,
        cash_counted: cashCounted !== "" ? Number(cashCounted) : null,
        variance_reason: varianceReason || null,
      });
      toastOk("Day-end count submitted — awaiting manager confirmation");
      setCounting(false);
      setCounts({});
      setCashCounted("");
      setVarianceReason("");
    } catch (e) {
      toastErr(e.message || "Could not submit the count");
    } finally {
      setBusy(false);
    }
  };

  if (flagsLoading) return null;
  if (!flags.wholesale_van_sales || !hasPerm("manage_field_sales")) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-(--ui-bg) pb-24">
      <div className="sticky top-0 z-10 bg-(--ui-surface) border-b border-(--ui-border) px-4 py-3 flex items-center gap-3">
        <button type="button" onClick={() => navigate("/field/today")} className="text-(--ui-text-muted)">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Truck className="h-5 w-5 text-(--ui-text)" />
        <h1 className="text-base font-semibold text-(--ui-text) grow">My Van</h1>
        <button type="button" onClick={load} className="text-(--ui-text-muted)">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="animate-pulse h-32 bg-(--ui-muted-surface) rounded-xl" />
        ) : !mine?.van ? (
          <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-6 text-center text-sm text-(--ui-text-muted)">
            No van is assigned to you yet. Ask your manager to create a van outlet and assign you as its rep.
          </div>
        ) : (
          <>
            <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-(--ui-text)">{mine.van.name}</p>
                  <p className="text-xs text-(--ui-text-muted)">
                    Today: {mine.today.sale_count} sale{mine.today.sale_count === 1 ? "" : "s"} · {fmt(Number(mine.today.sales_total))}
                  </p>
                </div>
                {mine.open_shift ? (
                  <span className="text-xs font-semibold rounded-full px-2 py-1 bg-(--ui-success-bg) text-(--ui-success-fg)">Day open</span>
                ) : (
                  <span className="text-xs font-semibold rounded-full px-2 py-1 bg-(--ui-muted-surface) text-(--ui-text-muted)">Day closed</span>
                )}
              </div>

              {!mine.open_shift && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Opening float"
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(e.target.value)}
                    className="w-36 rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
                  />
                  <button
                    type="button"
                    onClick={openDay}
                    disabled={busy}
                    className="flex items-center gap-2 rounded-full bg-(--ui-primary) text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" /> Open day
                  </button>
                </div>
              )}
            </div>

            <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between">
                <p className="text-sm font-semibold text-(--ui-text)">Van stock ({mine.stock.length})</p>
                {!counting && mine.stock.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCounting(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-(--ui-text) rounded-full border border-(--ui-border-strong) px-3 py-1.5"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Day-end count
                  </button>
                )}
              </div>
              {mine.stock.length === 0 ? (
                <p className="px-4 py-6 text-sm text-(--ui-text-muted) text-center">
                  Van is empty — ask the depot for a load-out transfer.
                </p>
              ) : (
                <ul className="divide-y divide-(--ui-border)">
                  {mine.stock.map((s) => (
                    <li key={s.product_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-(--ui-text) truncate">{s.name}</p>
                        {s.sku ? <p className="text-xs text-(--ui-text-muted)">{s.sku}</p> : null}
                      </div>
                      {counting ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={counts[s.product_id] ?? String(Number(s.quantity))}
                          onChange={(e) => setCounts((c) => ({ ...c, [s.product_id]: e.target.value }))}
                          className="w-20 rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) px-2 py-1.5 text-sm text-right text-(--ui-text)"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-(--ui-text)">{Number(s.quantity)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {counting && (
              <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-(--ui-text)">Cash + notes</p>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="Cash counted (incl. float)"
                  value={cashCounted}
                  onChange={(e) => setCashCounted(e.target.value)}
                  className="w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
                />
                <textarea
                  placeholder="Variance reason (damage, shortage…)"
                  value={varianceReason}
                  onChange={(e) => setVarianceReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCounting(false)}
                    disabled={busy}
                    className="grow rounded-full border border-(--ui-border-strong) text-(--ui-text) px-4 py-2.5 text-sm font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitCount}
                    disabled={busy}
                    className="grow rounded-full bg-(--ui-primary) text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Submit count
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
