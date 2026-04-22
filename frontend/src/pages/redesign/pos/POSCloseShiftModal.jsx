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
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">
              Close Shift
            </p>
            <h2 className="mt-1 text-2xl font-black text-slate-900">
              Shift #{activeShift.id}
            </h2>
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {result ? (
            <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="font-bold text-slate-900">Expected: {money(result.expected_cash)}</p>
              <p className="font-bold text-slate-900">Counted: {money(result.closing_cash)}</p>
              <p className="font-black text-slate-900">Variance: {money(result.variance)}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={closeShift}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                  <Calculator size={16} />
                  Closing Denominations
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {denoms.map((row, index) => (
                    <label key={row.denomination} className="rounded-xl border border-slate-200 bg-white p-3">
                      <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">
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
                        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 focus:border-[#8066FF] focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-4 text-base font-black text-slate-900">
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
                    ? "border-rose-300 focus:border-rose-500"
                    : "border-slate-300 focus:border-[#8066FF]"
                }`}
              />
              <input
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                placeholder="Approved by (optional)"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium focus:border-[#8066FF] focus:outline-none"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium focus:border-[#8066FF] focus:outline-none"
              />
              {needsThresholdApproval && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-amber-900">
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
                    className="w-full rounded-xl border border-amber-400 px-4 py-3 text-sm font-medium tracking-widest focus:border-amber-500 focus:outline-none"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-50"
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
