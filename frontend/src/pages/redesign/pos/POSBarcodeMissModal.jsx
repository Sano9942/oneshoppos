import { useState } from "react";
import { Barcode, X, Plus } from "lucide-react";
import { api } from "../../../api";
import { logErrorState } from "../../../utils/errorLog";

/**
 * Barcode miss modal (2-G.15 Day 4).
 *
 * Shown when a barcode scan returns 404 AND the cashier has manage_inventory
 * perms. Offers a minimal quick-create form (name + selling price) that
 * creates the product via POST /api/products and adds it to the cart.
 *
 * Props:
 *  - open:        boolean
 *  - barcode:     string
 *  - currencySymbol: string
 *  - onCreated:   (product) => void   // caller adds to cart
 *  - onClose:     () => void
 */
export default function POSBarcodeMissModal({
  open,
  barcode,
  currencySymbol = "$",
  onCreated,
  onClose,
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!name.trim()) { setError("Name is required"); return; }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Enter a valid price");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/api/products", {
        name: name.trim(),
        price: priceNum,
        barcode,
      });
      const product = res?.product || res;
      logErrorState("pos_barcode_quick_create", `Quick-created product from barcode ${barcode}`, {
        barcode,
        product_id: product?.id,
      });
      onCreated?.({
        id: product?.id,
        name: name.trim(),
        price: priceNum,
        barcode,
      });
      setName("");
      setPrice("");
      onClose?.();
    } catch (e2) {
      setError(e2?.message || "Failed to create product");
    } finally {
      setSubmitting(false);
    }
  };

  const dismiss = () => {
    setName("");
    setPrice("");
    setError("");
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <form onSubmit={handleSubmit} className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-md p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-(--ui-text)" />
            <h3 className="text-lg font-semibold">Barcode not found</h3>
          </div>
          <button type="button" onClick={dismiss} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-3">
          No product matches <span className="font-mono font-semibold text-(--ui-text)">{barcode}</span>. Add it now?
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-(--ui-text-muted) mb-1">Product name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full bg-(--ui-surface) border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm outline-none focus:border-(--ui-focus)"
              placeholder="e.g. Pepsi 250ml"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--ui-text-muted) mb-1">
              Selling price ({currencySymbol})
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-(--ui-surface) border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm outline-none focus:border-(--ui-focus)"
              placeholder="0.00"
            />
          </div>
        </div>

        {error && <p className="text-xs text-(--ui-danger-fg) mt-3">{error}</p>}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong) disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
          >
            <Plus className="h-4 w-4" />
            {submitting ? "Creating…" : "Add product"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex items-center justify-center gap-2 rounded-lg border border-(--ui-border-strong) text-(--ui-text) hover:bg-(--ui-muted-surface) px-3 py-3 text-sm font-semibold transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
