import { AlertTriangle, X, Clock } from "lucide-react";
import { fmtUtcDateTime } from "../../../utils/dates";
import { logErrorState } from "../../../utils/errorLog";

/**
 * Stale-shift recovery modal (2-G.15 Day 2).
 *
 * Shown when POS bootstraps with an active shift that was opened > 20h ago
 * AND the current local time is before noon. The cashier usually left
 * yesterday's shift open by accident — the modal offers a one-click close.
 *
 * Props:
 *  - open:        boolean
 *  - shift:       { id, opened_at, opening_float, outlet_id }
 *  - money:       (amount) => string (currency formatter)
 *  - onCloseNow:  () => void — opens POSCloseShiftModal
 *  - onKeepOpen:  () => void — dismiss for this session
 *  - onQuickClose: () => void — enqueues a close with auto-reason
 */
export default function POSShiftRecoveryModal({
  open,
  shift,
  money,
  onCloseNow,
  onKeepOpen,
  onQuickClose,
}) {
  if (!open || !shift) return null;

  const openedAt = shift.opened_at ? fmtUtcDateTime(shift.opened_at) : "earlier";
  const float = shift.opening_float != null ? money?.(shift.opening_float) : null;

  const handleCloseNow = () => {
    logErrorState("pos_stale_shift_close_triggered", `User chose to close stale shift #${shift.id}`, {
      shift_id: shift.id,
      opened_at: shift.opened_at,
    });
    onCloseNow?.();
  };

  const handleKeepOpen = () => {
    logErrorState("pos_stale_shift_dismissed", `User dismissed stale-shift prompt for shift #${shift.id}`, {
      shift_id: shift.id,
      opened_at: shift.opened_at,
    });
    onKeepOpen?.();
  };

  const handleQuickClose = () => {
    logErrorState("pos_stale_shift_quick_close", `Quick-close triggered for stale shift #${shift.id}`, {
      shift_id: shift.id,
      opened_at: shift.opened_at,
    });
    onQuickClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-bold text-slate-800">Yesterday's shift is still open</h3>
          </div>
          <button onClick={handleKeepOpen} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 mb-4 text-sm text-amber-800">
          <div className="flex items-center gap-1 mb-1">
            <Clock className="h-4 w-4" />
            Shift <span className="font-semibold">#{shift.id}</span> opened {openedAt}.
          </div>
          {float && (
            <div>Opening float: <span className="font-semibold">{float}</span></div>
          )}
          <p className="mt-2 text-xs">
            Close it now to keep cash reports accurate before you ring up today's sales.
          </p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleCloseNow}
            className="w-full rounded-lg bg-[#8066FF] hover:bg-[#6b55d9] text-white font-semibold py-2.5 transition"
          >
            Close now
          </button>
          <button
            type="button"
            onClick={handleQuickClose}
            className="w-full rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-2 transition"
          >
            Quick close with auto-reason
          </button>
          <button
            type="button"
            onClick={handleKeepOpen}
            className="w-full rounded-lg text-slate-500 hover:bg-slate-50 text-sm py-2 transition"
          >
            Keep open for now
          </button>
        </div>
      </div>
    </div>
  );
}
