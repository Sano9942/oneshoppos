import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Barcode } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";

// Phase 2-G Wave 3 — 2-G.6 serial entry modal.
// Opens when pendingSerialProductId is set. Fetches available serials for
// the product (and variant when applicable), presents one slot per quantity,
// and — on commit — adds a cart line stamped with `serials: [ids]` so sales.js
// can bridge + flip status + compute warranty on checkout.
export default function POSSerialEntryModal() {
  const {
    cart,
    setCart,
    addToCart,
    pendingSerialProductId,
    setPendingSerialProductId,
    pendingSerialContext,
    setPendingSerialContext,
    posFlags,
  } = usePOS();

  const [availableSerials, setAvailableSerials] = useState([]);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slots, setSlots] = useState([]); // [{ input: "", matchedId: null }]
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRefs = useRef({});

  const quantity = useMemo(() => {
    return Math.max(1, Number(pendingSerialContext?.quantity || 1));
  }, [pendingSerialContext]);

  const variantId = pendingSerialContext?.variant_id || null;

  // Initialize slots + fetch available serials on open.
  useEffect(() => {
    if (!pendingSerialProductId) return;
    setError("");
    setSlots(Array.from({ length: quantity }, () => ({ input: "", matchedId: null })));
    setFocusedIdx(0);
    setLoading(true);
    const qs = variantId ? `?status=available&variant_id=${variantId}` : `?status=available`;
    Promise.all([
      api.get(`/api/products/${pendingSerialProductId}`),
      api.get(`/api/products/${pendingSerialProductId}/serials${qs}`),
    ])
      .then(([prodRes, serialsRes]) => {
        setProduct(prodRes?.product || prodRes || null);
        setAvailableSerials(Array.isArray(serialsRes?.serials) ? serialsRes.serials : []);
      })
      .catch((err) => setError(err.message || "Failed to load serials"))
      .finally(() => setLoading(false));
  }, [pendingSerialProductId, quantity, variantId]);

  if (!pendingSerialProductId) return null;
  if (!posFlags.phase2g_serialized_inventory) return null;

  const close = () => {
    setPendingSerialProductId(null);
    setPendingSerialContext(null);
    setProduct(null);
    setAvailableSerials([]);
    setSlots([]);
    setError("");
  };

  const normaliseInput = (raw) => String(raw || "").trim();

  // When the user types a serial, match it against availableSerials. Track
  // the matched id + disallow re-using the same serial across slots.
  const updateSlot = (idx, value) => {
    setSlots((prev) => {
      const next = prev.map((s, i) => (i === idx ? { ...s, input: value } : s));
      const v = normaliseInput(value);
      const used = new Set(
        next
          .filter((_, i) => i !== idx)
          .map((s) => s.matchedId)
          .filter(Boolean),
      );
      const match = availableSerials.find(
        (s) => s.serial_number === v && !used.has(s.id),
      );
      next[idx] = {
        ...next[idx],
        matchedId: match ? match.id : null,
      };
      return next;
    });
  };

  const allFilled = slots.length > 0 && slots.every((s) => s.matchedId);

  const commit = () => {
    if (!allFilled) {
      setError("Fill in a valid serial for every slot");
      return;
    }
    const serialIds = slots.map((s) => s.matchedId);
    const existingLine = pendingSerialContext?.cartLine;
    if (existingLine) {
      // Chain from variant modal: line already added, we just tag it with serials.
      setCart((prev) =>
        prev.map((x) =>
          x.id === existingLine.id ? { ...x, serials: serialIds } : x,
        ),
      );
    } else if (product) {
      addToCart({
        ...product,
        // Carry original_product_id explicitly so sales.js sale_items insert
        // stamps the right product (item.original_product_id || item.id).
        original_product_id: product.id,
        id: product.id,
        variant_id: variantId,
        quantity,
        serials: serialIds,
      });
    }
    close();
  };

  // Keyboard: Tab advances slot, Enter commits when all filled, Esc closes.
  useEffect(() => {
    if (!pendingSerialProductId) return;
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Enter" && allFilled) {
        e.preventDefault();
        commit();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSerialProductId, allFilled, slots]);

  const advanceFocus = (idx) => {
    const next = idx + 1;
    if (next < slots.length) {
      inputRefs.current[next]?.focus?.();
      setFocusedIdx(next);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface)">
          <div className="flex items-center gap-2">
            <Barcode size={16} className="text-(--ui-text)" />
            <h3 className="font-bold text-(--ui-text)">
              Scan serial{quantity > 1 ? "s" : ""}
              {product?.name ? ` — ${product.name}` : ""}
            </h3>
          </div>
          <button onClick={close} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && (
            <div className="text-sm text-(--ui-text-muted) text-center py-6">Loading available serials…</div>
          )}

          {!loading && error && (
            <div className="text-xs font-bold text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!loading && availableSerials.length < quantity && (
            <div className="text-xs font-bold text-(--ui-warning-fg) bg-(--ui-warning-bg) border border-(--ui-warning-bg) rounded-lg px-3 py-2">
              Only {availableSerials.length} serial(s) available for this product — cannot sell {quantity} unit(s).
            </div>
          )}

          {!loading && availableSerials.length >= quantity && (
            <div className="text-xs text-(--ui-text-muted)">
              {availableSerials.length} available · scan or type exactly {quantity} serial{quantity > 1 ? "s" : ""}
            </div>
          )}

          {!loading &&
            slots.map((slot, idx) => (
              <label key={idx} className="block">
                <span className="text-[10px] font-bold uppercase text-(--ui-text-muted) tracking-wider">
                  Unit {idx + 1}
                </span>
                <input
                  ref={(el) => {
                    inputRefs.current[idx] = el;
                    if (idx === 0 && el && !slot.input) el.focus();
                  }}
                  type="text"
                  value={slot.input}
                  onChange={(e) => updateSlot(idx, e.target.value)}
                  onFocus={() => setFocusedIdx(idx)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && slot.matchedId) {
                      // Let the browser handle Tab; auto-advance is best-effort.
                      setTimeout(() => advanceFocus(idx), 0);
                    }
                  }}
                  placeholder="Scan or type serial / IMEI"
                  className={`mt-1 w-full border rounded-lg px-3 py-2.5 outline-none font-semibold text-(--ui-text) ${
                    slot.input && !slot.matchedId
                      ? "border-(--ui-danger) focus:border-(--ui-danger)"
                      : slot.matchedId
                      ? "border-(--ui-success-fg) focus:border-(--ui-success-fg)"
                      : "border-(--ui-border-strong) focus:border-(--ui-focus)"
                  }`}
                />
                {slot.input && !slot.matchedId && (
                  <p className="text-[11px] font-bold text-(--ui-danger-fg) mt-0.5">
                    Not a known available serial for this product
                  </p>
                )}
              </label>
            ))}

          <div className="flex gap-2">
            <button
              onClick={close}
              className="flex-1 bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) font-bold py-2.5 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={!allFilled}
              className="flex-1 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold py-2.5 rounded-lg transition disabled:opacity-40"
            >
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
