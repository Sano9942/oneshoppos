import React, { useEffect, useMemo, useState } from "react";
import { X, ShieldAlert } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";

// Phase 2-G Wave 3 — 2-G.5 manager price override modal.
// Opened from the per-line "⋯" menu on POSCartTable. Collects a new price,
// reason code, and manager PIN, then POSTs to /api/approvals/price-override.
// Successful response returns approval_event_id which rides with the sale.
export default function POSPriceOverrideModal() {
  const {
    cart,
    priceOverrideLineId,
    setPriceOverrideLineId,
    applyPriceOverride,
    posFlags,
  } = usePOS();

  const line = useMemo(
    () => cart.find((x) => x.id === priceOverrideLineId) || null,
    [cart, priceOverrideLineId],
  );

  const [reasons, setReasons] = useState([]);
  const [reasonId, setReasonId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load active reasons once per open.
  useEffect(() => {
    if (!priceOverrideLineId) return;
    setError("");
    setPin("");
    setNewPrice(line ? String(line.price) : "");
    setReasonId("");
    api
      .get("/api/override-reasons")
      .then((d) => {
        const list = d.reasons || [];
        setReasons(list);
        if (list.length) setReasonId(String(list[0].id));
      })
      .catch((err) => setError(err.message || "Failed to load reasons"));
  }, [priceOverrideLineId, line]);

  if (!priceOverrideLineId || !line) return null;
  if (!posFlags.phase2g_price_override) return null;

  const originalPrice = Number(line.originalPrice ?? line.price);
  const nextPrice = Number(newPrice);
  const delta = Number.isFinite(nextPrice) ? nextPrice - originalPrice : 0;

  const close = () => {
    setPriceOverrideLineId(null);
    setPin("");
    setNewPrice("");
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      setError("New price must be a non-negative number");
      return;
    }
    if (!reasonId) {
      setError("Select a reason");
      return;
    }
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      setError("Enter a valid PIN (4–8 digits)");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/api/approvals/price-override", {
        pin,
        product_id: line.original_product_id || line.id,
        variant_id: line.variant_id || null,
        original_price: originalPrice,
        new_price: nextPrice,
        reason_id: Number(reasonId),
      });
      if (!res?.authorized) {
        setError(res?.error || "Not authorized");
        return;
      }
      applyPriceOverride(line.id, {
        amount: nextPrice,
        reason_id: Number(reasonId),
        approval_event_id: res.approval_event_id,
        original_price: originalPrice,
      });
      close();
    } catch (err) {
      setError(err.message || "Approval failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface)">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-(--ui-text)" />
            <h3 className="font-bold text-(--ui-text)">Override price</h3>
          </div>
          <button
            onClick={close}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-(--ui-text-muted)">
            <div className="font-bold text-(--ui-text) text-sm">{line.name}</div>
            <div className="mt-0.5">
              Current price:{" "}
              <span className="font-semibold text-(--ui-text)">
                {originalPrice.toFixed(2)}
              </span>
            </div>
          </div>

          <label className="block text-xs font-bold uppercase text-(--ui-text-muted) tracking-wider">
            New price
            <input
              type="number"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              autoFocus
              className="mt-1 w-full border border-(--ui-border-strong) rounded-lg px-4 py-2.5 focus:border-(--ui-focus) outline-none font-bold text-(--ui-text)"
            />
          </label>

          {Number.isFinite(nextPrice) && nextPrice !== originalPrice && (
            <div
              className={`text-xs font-bold ${
                delta < 0 ? "text-(--ui-success-fg)" : "text-(--ui-warning-fg)"
              }`}
            >
              {delta < 0 ? "Discount" : "Markup"}: {Math.abs(delta).toFixed(2)}
            </div>
          )}

          <label className="block text-xs font-bold uppercase text-(--ui-text-muted) tracking-wider">
            Reason
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="mt-1 w-full border border-(--ui-border-strong) rounded-lg px-3 py-2.5 focus:border-(--ui-focus) outline-none font-semibold text-(--ui-text)"
            >
              {reasons.length === 0 && <option value="">No reasons configured</option>}
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-bold uppercase text-(--ui-text-muted) tracking-wider">
            Manager PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              className="mt-1 w-full border border-(--ui-border-strong) rounded-lg px-4 py-2.5 focus:border-(--ui-focus) outline-none font-bold text-(--ui-text) tracking-widest"
              placeholder="••••"
            />
          </label>

          {error && (
            <div className="text-xs font-bold text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={close}
              disabled={submitting}
              className="flex-1 bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) font-bold py-2.5 rounded-lg transition disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold py-2.5 rounded-lg transition disabled:opacity-60"
            >
              {submitting ? "Approving…" : "Approve override"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
