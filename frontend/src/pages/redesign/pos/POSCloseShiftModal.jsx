import React, { useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSCloseShiftModal() {
  const { fmt: money, denominations, symbol } = useCurrency();
  const {
    closeShiftOpen,
    setCloseShiftOpen,
    activeShift,
    canOpenShift,
    authHeaders,
    refreshGateStatus,
    showNotice,
    setError,
  } = usePOS();
  const [busy, setBusy] = useState(false);
  const [varianceReason, setVarianceReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState(null);
  const [denoms, setDenoms] = useState(
    denominations.map((value) => ({ denomination: value, count: 0 })),
  );

  // 2-G.17: when the backend rejects the close because variance exceeds the
  // tenant threshold, it returns { code: "manager_pin_required" | "variance_reason_required" }.
  // We surface a manager PIN input (and require variance_reason) once the
  // server signals the threshold has been crossed.
  const [managerPin, setManagerPin] = useState("");
  const [needsThresholdApproval, setNeedsThresholdApproval] = useState(false);
  const [thresholdAmount, setThresholdAmount] = useState(null);

  const closingCash = useMemo(
    () =>
      denoms.reduce(
        (sum, row) => sum + row.denomination * Number(row.count || 0),
        0,
      ),
    [denoms],
  );

  if (!closeShiftOpen || !canOpenShift || !activeShift) return null;

  const reset = () => {
    setCloseShiftOpen(false);
    setBusy(false);
    setVarianceReason("");
    setApprovedBy("");
    setNotes("");
    setResult(null);
    setManagerPin("");
    setNeedsThresholdApproval(false);
    setThresholdAmount(null);
    setDenoms(denominations.map((value) => ({ denomination: value, count: 0 })));
  };

  const closeShift = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api.post(`/api/shifts/${activeShift.id}/close`, {
          closing_cash: Number(closingCash.toFixed(2)),
          notes: notes || null,
          variance_reason: varianceReason || null,
          variance_approved_by: approvedBy || null,
          // 2-G.17: manager PIN is only sent when the shift has flipped into
          // "threshold approval" mode. Server ignores it otherwise.
          variance_approved_by_pin: needsThresholdApproval ? managerPin : undefined,
          denominations: denoms
            .filter((row) => Number(row.count || 0) > 0)
            .map((row) => ({
              denomination: row.denomination,
              count: Number(row.count || 0),
            })),
        });
      setResult(data);
      showNotice("Shift closed successfully.");
      await refreshGateStatus(activeShift.outlet_id);
    } catch (err) {
      // 2-G.17: surface the threshold prompt on the first rejection, then
      // keep the form open so the cashier can add reason + PIN and resubmit.
      const code = err.body?.code;
      if (code === "manager_pin_required" || code === "variance_reason_required") {
        setNeedsThresholdApproval(true);
        setThresholdAmount(err.body?.threshold ?? null);
        setError(err.message || "Variance exceeds threshold — reason + manager PIN required");
      } else {
        setError(err.message || "Failed to close shift");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-(--ui-border-strong) bg-(--ui-surface) shadow-(--ui-shadow-lg)">
        <div className="flex items-center justify-between border-b border-(--ui-border) px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-(--ui-text-muted)">
              Close Shift
            </p>
            <h2 className="mt-1 text-2xl font-black text-(--ui-text)">
              Shift #{activeShift.id}
            </h2>
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-full p-2 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {result ? (
            <div className="space-y-2 rounded-2xl border border-(--ui-success-bg) bg-(--ui-success-bg) p-4 text-sm">
              <p className="font-bold text-(--ui-text)">Expected: {money(result.expected_cash)}</p>
              <p className="font-bold text-(--ui-text)">Counted: {money(result.closing_cash)}</p>
              <p className="font-black text-(--ui-text)">Variance: {money(result.variance)}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-2 rounded-xl bg-(--ui-primary) px-4 py-2 text-sm font-bold text-white hover:bg-(--ui-primary-strong)"
              >
                Done
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={closeShift}>
              <div className="rounded-2xl border border-(--ui-border-strong) bg-(--ui-muted-surface) p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-(--ui-text)">
                  <Calculator size={16} />
                  Closing Denominations
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {denoms.map((row, index) => (
                    <label key={row.denomination} className="rounded-xl border border-(--ui-border-strong) bg-(--ui-surface) p-3">
                      <span className="block text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">
                        {symbol} {row.denomination}
                      </span>
                      <input
                        type="number"
                        min="0"
                        value={row.count}
                        onChange={(e) =>
                          setDenoms((prev) =>
                            prev.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, count: Math.max(0, Number(e.target.value || 0)) }
                                : entry,
                            ),
                          )
                        }
                        className="mt-2 w-full rounded-lg border border-(--ui-border-strong) px-3 py-2 text-sm font-semibold text-(--ui-text) focus:border-(--ui-focus) focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-4 text-base font-black text-(--ui-text)">
                  Counted Total: {money(closingCash)}
                </p>
              </div>

              <input
                value={varianceReason}
                onChange={(e) => setVarianceReason(e.target.value)}
                placeholder={needsThresholdApproval
                  ? "Variance reason (required)"
                  : "Variance reason (optional)"}
                className={`w-full rounded-xl border px-4 py-3 text-sm font-medium focus:outline-none ${
                  needsThresholdApproval && !varianceReason
                    ? "border-(--ui-danger) focus:border-(--ui-danger)"
                    : "border-(--ui-border-strong) focus:border-(--ui-focus)"
                }`}
              />
              <input
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                placeholder="Approved by (optional)"
                className="w-full rounded-xl border border-(--ui-border-strong) px-4 py-3 text-sm font-medium focus:border-(--ui-focus) focus:outline-none"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full rounded-xl border border-(--ui-border-strong) px-4 py-3 text-sm font-medium focus:border-(--ui-focus) focus:outline-none"
              />
              {needsThresholdApproval && (
                <div className="rounded-2xl border border-(--ui-warning-bg) bg-(--ui-warning-bg) p-4 space-y-2">
                  <p className="text-sm font-semibold text-(--ui-warning-fg)">
                    Variance exceeds tenant threshold
                    {thresholdAmount != null ? ` (${money(thresholdAmount)})` : ""}.
                    A manager PIN is required to close.
                  </p>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    placeholder="Manager PIN"
                    autoFocus
                    className="w-full rounded-xl border border-(--ui-warning-fg) px-4 py-3 text-sm font-medium tracking-widest focus:border-(--ui-warning-fg) focus:outline-none"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-(--ui-border-strong) bg-(--ui-surface) px-4 py-3 text-sm font-bold text-(--ui-text) hover:bg-(--ui-muted-surface)"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-(--ui-danger) px-5 py-3 text-sm font-black text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Closing Shift..." : "Close Shift"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
