import { AlertTriangle, X, Scale, PackageX, Check } from "lucide-react";
import { logErrorState } from "../../../utils/errorLog";

/**
 * Insufficient stock modal (2-G.15 Day 4).
 *
 * Shown when POST /api/sales rejects with { code: "insufficient_stock",
 * available, product_id, requested }. Offers three paths:
 *  - Adjust quantity: clamp the cart line to the available number
 *  - Oversell: retry with allow_oversell (requires override_stock perm)
 *  - Cancel: dismiss
 *
 * Props:
 *  - open:        boolean
 *  - prompt:      { product_id, variant_id, product_name, available, requested }
 *  - canOverride: boolean  (hide Oversell button if false)
 *  - onAdjust:    (product_id, variant_id, available) => void
 *  - onOversell:  () => void
 *  - onClose:     () => void
 */
export default function POSInsufficientStockModal({
  open,
  prompt,
  canOverride = false,
  onAdjust,
  onOversell,
  onClose,
}) {
  if (!open || !prompt) return null;

  const handleAdjust = () => {
    logErrorState("pos_insufficient_stock_adjust", `Clamped cart for product ${prompt.product_id} to ${prompt.available}`, prompt);
    onAdjust?.(prompt.product_id, prompt.variant_id, Number(prompt.available || 0));
    onClose?.();
  };

  const handleOversell = () => {
    logErrorState("pos_insufficient_stock_oversell", `Oversell requested for product ${prompt.product_id}`, prompt);
    onOversell?.();
    onClose?.();
  };

  const handleCancel = () => {
    logErrorState("pos_insufficient_stock_cancel", `Insufficient stock dismissed for product ${prompt.product_id}`, prompt);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-semibold">Not enough stock</h3>
          </div>
          <button type="button" onClick={handleCancel} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-3">
          Only <span className="font-semibold text-white">{Number(prompt.available || 0)}</span> left
          for <span className="font-semibold text-white">{prompt.product_name}</span>
          {prompt.requested != null && (
            <> — you're trying to sell <span className="font-semibold text-white">{Number(prompt.requested)}</span>.</>
          )}
        </p>

        <div className="space-y-2 mt-4">
          <button
            type="button"
            onClick={handleAdjust}
            disabled={Number(prompt.available || 0) <= 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#8066FF] hover:bg-[#6b55d9] disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
          >
            <Scale className="h-4 w-4" />
            Adjust to {Number(prompt.available || 0)}
          </button>
          {canOverride && (
            <button
              type="button"
              onClick={handleOversell}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-amber-400 text-amber-200 hover:bg-amber-500/20 px-3 py-3 text-sm font-semibold transition"
            >
              <Check className="h-4 w-4" />
              Oversell anyway
            </button>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 px-3 py-3 text-sm font-semibold transition"
          >
            <PackageX className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
