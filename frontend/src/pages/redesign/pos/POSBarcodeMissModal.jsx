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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form onSubmit={handleSubmit} className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 text-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-[#8066FF]" />
            <h3 className="text-lg font-semibold">Barcode not found</h3>
          </div>
          <button type="button" onClick={dismiss} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-3">
          No product matches <span className="font-mono font-semibold text-white">{barcode}</span>. Add it now?
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Product name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#8066FF]"
              placeholder="e.g. Pepsi 250ml"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Selling price ({currencySymbol})
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#8066FF]"
              placeholder="0.00"
            />
          </div>
        </div>

        {error && <p className="text-xs text-rose-400 mt-3">{error}</p>}

        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#8066FF] hover:bg-[#6b55d9] disabled:opacity-50 px-3 py-3 text-sm font-semibold transition"
          >
            <Plus className="h-4 w-4" />
            {submitting ? "Creating…" : "Add product"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-700 px-3 py-3 text-sm font-semibold transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
