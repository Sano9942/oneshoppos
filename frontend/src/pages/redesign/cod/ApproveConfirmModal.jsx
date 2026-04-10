import { useEffect, useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function ApproveConfirmModal({ open, batch, busy, onCancel, onConfirm }) {
  const { fmt } = useCurrency();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  if (!open || !batch) return null;

  const expected = batch.batch_ref || `#${batch.id}`;
  const enabled = typed.trim() === expected.trim() && !busy;
  const shortCount = batch.unmatched_count || 0;
  const shortAmount = Number(batch.short_amount || 0);
  const showWarning = shortAmount > 0 || shortCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-(--bg-card) border border-(--border) rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border)">
          <h2 className="text-base font-semibold text-(--text-primary)">
            Approve settlement batch
          </h2>
          <button
            onClick={onCancel}
            className="text-(--text-muted) hover:text-(--text-primary)"
            aria-label="Close"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {showWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                This batch has <strong>{fmt(shortAmount)}</strong> in shortfall
                {shortCount > 0 && (
                  <>
                    {" "}
                    across <strong>{shortCount}</strong> unmatched line
                    {shortCount === 1 ? "" : "s"}
                  </>
                )}
                . Approval finalizes the reconciliation and cannot be undone.
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm text-(--text-secondary) mb-1">
              Type the batch reference to confirm:
            </label>
            <div className="text-xs text-(--text-muted) mb-1 font-mono">{expected}</div>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={onConfirm}
              disabled={!enabled}
            >
              {busy ? "Approving…" : "Confirm approval"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
