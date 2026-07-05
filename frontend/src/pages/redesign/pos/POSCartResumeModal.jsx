import { ShoppingCart, X, Trash2 } from "lucide-react";
import { logErrorState } from "../../../utils/errorLog";

/**
 * Cart resume modal (2-G.15 Day 3).
 *
 * Shown on POSProvider mount when a sessionStorage checkpoint exists and the
 * current cart is empty. Offers to restore the previous cart or discard it.
 *
 * Props:
 *  - open:           boolean
 *  - checkpoint:     { cart, selectedOutletId, customer, timestamp }
 *  - currencySymbol: string
 *  - onResume:       () => void
 *  - onDiscard:      () => void
 */
export default function POSCartResumeModal({
  open,
  checkpoint,
  currencySymbol = "$",
  onResume,
  onDiscard,
}) {
  if (!open || !checkpoint) return null;

  const cart = Array.isArray(checkpoint.cart) ? checkpoint.cart : [];
  const itemCount = cart.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
  const total = cart.reduce(
    (sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0),
    0,
  );

  const relativeTime = (() => {
    const ts = Number(checkpoint.timestamp || 0);
    if (!ts) return "earlier";
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000) return "moments ago";
    const mins = Math.round(diffMs / 60_000);
    if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
    const hours = Math.round(mins / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  })();

  const handleResume = () => {
    logErrorState("pos_cart_resumed", `Cart resumed (${itemCount} items)`, {
      item_count: itemCount,
      total,
    });
    onResume?.();
  };

  const handleDiscard = () => {
    logErrorState("pos_cart_discarded", `Cart resume discarded (${itemCount} items)`, {
      item_count: itemCount,
      total,
    });
    onDiscard?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-md p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-(--ui-text)" />
            <h3 className="text-lg font-semibold">Resume previous cart?</h3>
          </div>
          <button onClick={handleDiscard} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-3">
          You had a cart open {relativeTime}. Restore it now?
        </p>

        <div className="rounded-lg border border-(--ui-border) bg-(--ui-muted-surface) p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-(--ui-text-muted)">Items</span>
            <span className="font-semibold">{itemCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-(--ui-text-muted)">Total</span>
            <span className="font-semibold">
              {currencySymbol}
              {total.toLocaleString()}
            </span>
          </div>
          {checkpoint.customer?.name && (
            <div className="flex justify-between">
              <span className="text-(--ui-text-muted)">Customer</span>
              <span className="font-semibold">{checkpoint.customer.name}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="button"
            onClick={handleResume}
            className="flex items-center justify-center gap-2 rounded-lg bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong) px-3 py-3 text-sm font-semibold transition"
          >
            <ShoppingCart className="h-4 w-4" />
            Resume
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            className="flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
          >
            <Trash2 className="h-4 w-4" />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
