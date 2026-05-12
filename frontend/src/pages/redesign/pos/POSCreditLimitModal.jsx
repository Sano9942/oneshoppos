import { useState, useEffect } from "react";
import { X, ShieldCheck, ShieldAlert, Receipt } from "lucide-react";

/**
 * POS Credit Limit Modal (Tier 0.1 wholesale).
 *
 * Shown inline when POST /api/sales rejects a Credit-tender sale with
 *   { code: "CREDIT_LIMIT_EXCEEDED", limit, outstanding, attempted, deficit }
 *
 * The salePayload is already parked inside useCheckout's pendingSaleRef. This
 * modal collects a manager PIN and calls onSubmit(pin); the parent calls
 * retryWithManagerPin(pin) which re-posts the payload with `manager_pin`
 * stamped on. A failed PIN keeps the modal open so a different one can be
 * tried; cancel discards the parked payload via onClose.
 *
 * Mirrors POSRefundThresholdModal's prop pattern.
 *
 * Props:
 *  - open: boolean
 *  - prompt: { limit, outstanding, attempted, deficit, message } | null
 *  - currency: string — display only
 *  - error: string | null
 *  - loading: boolean
 *  - onSubmit: (pin) => void
 *  - onClose: () => void
 */
export default function POSCreditLimitModal({
  open,
  prompt,
  currency = "",
  error,
  loading,
  onSubmit,
  onClose,
}) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (open) setPin("");
  }, [open]);

  if (!open || !prompt) return null;

  const fmt = (n) => `${currency}${Number(n || 0).toLocaleString()}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!pin.trim() || loading) return;
    onSubmit(pin);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-semibold">Credit Limit Exceeded</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-slate-900/50 border border-slate-700 p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Current outstanding</span>
            <span className="font-mono">{fmt(prompt.outstanding)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">This sale</span>
            <span className="font-mono">{fmt(prompt.attempted)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-700 pt-1.5">
            <span className="text-slate-400">Credit limit</span>
            <span className="font-mono">{fmt(prompt.limit)}</span>
          </div>
          <div className="flex justify-between text-rose-400 font-semibold">
            <span>Over by</span>
            <span className="font-mono">{fmt(prompt.deficit)}</span>
          </div>
        </div>

        <p className="text-sm text-slate-300 mb-4">
          A manager PIN with <span className="font-mono">override_credit_limit</span>{" "}
          permission is required to push this sale through.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-slate-300 mb-1">Manager PIN</label>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter manager PIN"
            autoFocus
            className="w-full rounded-lg bg-slate-700 border border-slate-600 px-4 py-3 text-lg text-center tracking-widest placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {error && (
            <div className="mt-2 flex items-center gap-1 text-sm text-rose-400">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !pin.trim()}
            className="mt-4 w-full rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 py-2.5 font-semibold text-slate-900 transition-colors"
          >
            {loading ? "Verifying…" : "Approve Credit Sale"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full rounded-lg bg-slate-700 hover:bg-slate-600 py-2 font-semibold text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
