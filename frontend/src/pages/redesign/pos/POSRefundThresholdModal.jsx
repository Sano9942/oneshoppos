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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-sm p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-(--ui-warning-fg)" />
            <h3 className="text-lg font-semibold">Manager Approval Required</h3>
          </div>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-4">
          Refund of{" "}
          <span className="font-semibold text-(--ui-text)">
            {currency}
            {Number(refundAmount).toLocaleString()}
          </span>{" "}
          exceeds the tenant threshold
          {threshold != null ? (
            <> of <span className="font-semibold text-(--ui-text)">{currency}{Number(threshold).toLocaleString()}</span></>
          ) : null}
          . A manager PIN is required to approve.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-(--ui-text-muted) mb-1">Manager PIN</label>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter manager PIN"
            autoFocus
            className="w-full rounded-lg bg-(--ui-surface) border border-(--ui-border-strong) px-4 py-3 text-lg text-center tracking-widest placeholder:text-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
          />
          {error && (
            <div className="mt-2 flex items-center gap-1 text-sm text-(--ui-danger-fg)">
              <ShieldAlert className="h-4 w-4" />
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !pin.trim()}
            className="mt-4 w-full rounded-lg bg-(--ui-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50 py-2.5 font-semibold text-white transition-colors"
          >
            {loading ? "Verifying…" : "Approve Refund"}
          </button>
        </form>
      </div>
    </div>
  );
}
