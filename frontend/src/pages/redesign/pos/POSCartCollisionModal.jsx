import { AlertTriangle, X, Eye } from "lucide-react";
import { logErrorState } from "../../../utils/errorLog";

/**
 * Refund collision modal (2-G.15 Day 3).
 *
 * Shown when the backend returns 409 { code: "duplicate_return" } from
 * POST /api/returns — the same sale + idempotency_key already has a refund.
 *
 * Props:
 *  - open:     boolean
 *  - existing: { id, timestamp, total_refund, employee_id, employee_name }
 *  - currencySymbol: string
 *  - onViewExisting: (returnId) => void   // optional — caller wires to detail view
 *  - onClose:  () => void
 */
export default function POSCartCollisionModal({
  open,
  existing,
  currencySymbol = "$",
  onViewExisting,
  onClose,
}) {
  if (!open || !existing) return null;

  const whenLabel = (() => {
    try {
      const d = new Date(existing.timestamp);
      if (Number.isNaN(d.getTime())) return "earlier";
      return d.toLocaleString();
    } catch {
      return "earlier";
    }
  })();

  const handleViewExisting = () => {
    logErrorState("pos_refund_collision_view", `View existing return #${existing.id}`, {
      return_id: existing.id,
    });
    onViewExisting?.(existing.id);
    onClose?.();
  };

  const handleClose = () => {
    logErrorState("pos_refund_collision_dismissed", `Dismissed refund collision for return #${existing.id}`, {
      return_id: existing.id,
    });
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-semibold">Refund already processed</h3>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-3">
          This refund was already recorded. Submitting again would create a duplicate.
        </p>

        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Return #</span>
            <span className="font-semibold">{existing.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Amount</span>
            <span className="font-semibold">
              {currencySymbol}
              {Number(existing.total_refund || 0).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Processed by</span>
            <span className="font-semibold">{existing.employee_name || "Unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">When</span>
            <span className="font-semibold">{whenLabel}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          {onViewExisting && (
            <button
              type="button"
              onClick={handleViewExisting}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#8066FF] hover:bg-[#6b55d9] px-3 py-3 text-sm font-semibold transition"
            >
              <Eye className="h-4 w-4" />
              View existing
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className={`flex items-center justify-center gap-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 px-3 py-3 text-sm font-semibold transition ${
              onViewExisting ? "" : "col-span-2"
            }`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
