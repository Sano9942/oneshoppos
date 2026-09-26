import React, { useState } from "react";
import { Hash, Delete, X } from "lucide-react";
import { usePOS } from "./POSContext";
import { variantCartLine } from "./variantCartLine";
import { scanProduct, listVariants } from "./offlineLookup";

/**
 * POSPluPad — grocery/butcher/sweet PLU rapid-entry pad (V01 P1).
 *
 * A touch numeric pad for ringing loose produce by its 4-5 digit PLU code. The
 * lookup reuses the same authoritative scan endpoint as the omni input (which
 * now matches products.plu_code), so a typed PLU resolves the product exactly
 * like a scanned barcode — including embedded-scale decoding if the code turns
 * out to be a scale label. Feature-surfaced via preset.pos_search_config.show_plu.
 */
export default function POSPluPad() {
  const {
    addToCart,
    addDecodedLine,
    showNotice,
    setPendingVariantProductId,
    setPendingSerialProductId,
    setPendingSerialContext,
  } = usePOS();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const press = (d) => setCode((c) => (c.length >= 8 ? c : c + d));
  const backspace = () => setCode((c) => c.slice(0, -1));
  const clear = () => setCode("");

  const submit = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      // Server first; the offline catalogue copy when it can't be reached.
      const data = await scanProduct(value);
      if (!data.found) { showNotice?.(data.error || `No product for PLU ${value}`); return; }
      const product = data.product;
      if (product.age_restricted &&
        typeof window !== "undefined" && typeof window.confirm === "function" &&
        !window.confirm(`"${product.name || "This item"}" is age-restricted.\nConfirm the customer meets the minimum age?`)) {
        return;
      }
      if (product.embedded) { addDecodedLine(product, product.embedded); setCode(""); return; }
      if (data.variant) {
        addToCart(variantCartLine(product, data.variant, data.variant.sku));
        showNotice?.(`Added ${product.name} (${data.variant.sku})`);
        setCode("");
        return;
      }
      const variants = await listVariants(product.id);
      if (variants.length > 0) { setPendingVariantProductId(product.id); setCode(""); return; }
      if (product.serial_required) {
        setPendingSerialContext({ product_id: product.id, variant_id: null, quantity: 1 });
        setPendingSerialProductId(product.id);
        setCode("");
        return;
      }
      addToCart(product);
      showNotice?.(`Added ${product.name}`);
      setCode("");
    } catch (err) {
      showNotice?.(err?.message || "PLU lookup failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-(--ui-text) border border-(--ui-border-strong) rounded-lg hover:bg-(--ui-muted-surface) transition"
      >
        <Hash size={13} /> PLU pad
      </button>
    );
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

  return (
    <div className="border border-(--ui-border-strong) rounded-xl p-3 bg-(--ui-surface) w-full max-w-[240px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-(--ui-text-muted) inline-flex items-center gap-1">
          <Hash size={12} /> PLU entry
        </span>
        <button type="button" onClick={() => { setOpen(false); setCode(""); }} className="text-(--ui-text-muted) hover:text-(--ui-text)">
          <X size={14} />
        </button>
      </div>
      <div className="mb-2 h-9 flex items-center justify-end px-3 rounded-lg bg-(--ui-bg) border border-(--ui-border) font-mono text-lg text-(--ui-text)">
        {code || <span className="text-(--ui-text-muted)">0000</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((k) => {
          if (k === "clear") return (
            <button key={k} type="button" onClick={clear}
              className="h-10 rounded-lg border border-(--ui-border-strong) text-xs font-semibold text-(--ui-text) hover:bg-(--ui-muted-surface)">C</button>
          );
          if (k === "back") return (
            <button key={k} type="button" onClick={backspace}
              className="h-10 rounded-lg border border-(--ui-border-strong) inline-flex items-center justify-center text-(--ui-text) hover:bg-(--ui-muted-surface)"><Delete size={15} /></button>
          );
          return (
            <button key={k} type="button" onClick={() => press(k)}
              className="h-10 rounded-lg border border-(--ui-border-strong) text-base font-semibold text-(--ui-text) hover:bg-(--ui-muted-surface)">{k}</button>
          );
        })}
      </div>
      <button type="button" onClick={submit} disabled={busy || !code}
        className="mt-2 w-full h-10 rounded-lg bg-(--ui-primary) text-white text-sm font-semibold disabled:opacity-50">
        {busy ? "…" : "Add item"}
      </button>
    </div>
  );
}
