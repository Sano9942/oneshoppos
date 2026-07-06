import { AlertTriangle, X, Scale, PackageX, Check, PackagePlus } from "lucide-react";
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
 *  - prompt:      { product_id, variant_id, product_name, available, requested,
 *                   backorder_available?, price? }
 *  - canOverride: boolean  (hide Oversell button if false)
 *  - onAdjust:    (product_id, variant_id, available) => void
 *  - onOversell:  () => void
 *  - onBackorder: (prompt) => void  (V02 wholesale — fulfill available now,
 *                 backorder the remainder at the order-time price; only shown
 *                 when prompt.backorder_available)
 *  - onClose:     () => void
 */
export default function POSInsufficientStockModal({
  open,
  prompt,
  canOverride = false,
  onAdjust,
  onOversell,
  onBackorder,
  onClose,
}) {
  if (!open || !prompt) return null;

  const remainder = Math.max(0, Number(prompt.requested || 0) - Number(prompt.available || 0));
  const canBackorder =
    prompt.backorder_available === true && remainder > 0 && Number(prompt.available || 0) > 0 && !!onBackorder;

  const handleBackorder = () => {
    logErrorState(
      "pos_insufficient_stock_backorder",
      `Backorder offer accepted for product ${prompt.product_id}: fulfill ${prompt.available}, backorder ${remainder}`,
      prompt,
    );
    onBackorder?.(prompt);
    onClose?.();
  };

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-md p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-(--ui-warning-fg)" />
            <h3 className="text-lg font-semibold">Not enough stock</h3>
          </div>
          <button type="button" onClick={handleCancel} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-3">
          Only <span className="font-semibold text-(--ui-text)">{Number(prompt.available || 0)}</span> left
          for <span className="font-semibold text-(--ui-text)">{prompt.product_name}</span>
          {prompt.requested != null && (
            <> — you're trying to sell <span className="font-semibold text-(--ui-text)">{Number(prompt.requested)}</span>.</>
          )}
        </p>

        <div className="space-y-2 mt-4">
          {canBackorder && (
            <button
              type="button"
              onClick={handleBackorder}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong) px-3 py-3 text-sm font-semibold transition"
            >
              <PackagePlus className="h-4 w-4" />
              Sell {Number(prompt.available)} now, backorder {remainder}
            </button>
          )}
          <button
            type="button"
            onClick={handleAdjust}
            disabled={Number(prompt.available || 0) <= 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong) disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
          >
            <Scale className="h-4 w-4" />
            Adjust to {Number(prompt.available || 0)}
          </button>
          {canOverride && (
            <button
              type="button"
              onClick={handleOversell}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-(--ui-warning-fg) text-(--ui-warning-fg) hover:bg-(--ui-warning-bg) px-3 py-3 text-sm font-semibold transition"
            >
              <Check className="h-4 w-4" />
              Oversell anyway
            </button>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
          >
            <PackageX className="h-4 w-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
