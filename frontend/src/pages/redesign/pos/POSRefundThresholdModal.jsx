import { useState, useEffect } from "react";
import { X, ShieldCheck, ShieldAlert } from "lucide-react";

/**
 * POS Refund Threshold Modal (2-G.17).
 *
 * Shown inline when /api/returns responds with
 *   { code: "manager_pin_required", threshold: <n> }
 *
 * The caller holds onto the original return payload + retry function — this
 * modal just collects a PIN and calls `onSubmit(pin)`. The caller merges
 * `manager_pin` into the payload and re-posts.
 *
 * Props:
 *  - open:       boolean
 *  - threshold:  number — shown in the prompt for context
 *  - refundAmount: number
 *  - currency:   string — just for display
 *  - error:      string | null — shows under the input (e.g. "Invalid PIN")
 *  - loading:    boolean
 *  - onSubmit:   (pin) => void
 *  - onClose:    () => void
 */
export default function POSRefundThresholdModal({
  open,
  threshold,
  refundAmount,
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

  if (!open) return null;

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
            <ShieldCheck className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-semibold">Manager Approval Required</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-4">
          Refund of{" "}
          <span className="font-semibold text-white">
            {currency}
            {Number(refundAmount).toLocaleString()}
          </span>{" "}
          exceeds the tenant threshold
          {threshold != null ? (
            <> of <span className="font-semibold text-white">{currency}{Number(threshold).toLocaleString()}</span></>
          ) : null}
          . A manager PIN is required to approve.
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
            {loading ? "Verifying…" : "Approve Refund"}
          </button>
        </form>
      </div>
    </div>
  );
}
