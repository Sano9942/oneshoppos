import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Modal, ModalFooter } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function ApproveConfirmModal({ open, batch, busy, onCancel, onConfirm }) {
  const { fmt } = useCurrency();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const expected = batch ? (batch.batch_ref || `#${batch.id}`) : "";
  const enabled = typed.trim() === expected.trim() && !busy;
  const shortCount = batch ? (batch.unmatched_count || 0) : 0;
  const shortAmount = batch ? Number(batch.short_amount || 0) : 0;
  const showWarning = shortAmount > 0 || shortCount > 0;

  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title="Approve settlement batch" size="sm">
      {batch ? (
        <>
          <div className="space-y-4">
            {showWarning && (
              <div className="flex items-start gap-2 rounded-lg bg-(--ui-warning-bg) p-3 text-xs text-(--ui-warning-fg)">
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
              <label className="mb-1 block text-sm text-(--ui-text-muted)">
                Type the batch reference to confirm:
              </label>
              <div className="mb-1 font-mono text-xs text-(--ui-text-muted)">{expected}</div>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) text-(--ui-text) px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <ModalFooter>
            <Button tone="plain" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={onConfirm} disabled={!enabled}>
              {busy ? "Approving…" : "Confirm approval"}
            </Button>
          </ModalFooter>
        </>
      ) : null}
    </Modal>
  );
}
