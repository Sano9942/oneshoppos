import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Grid3x3 } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";

// Phase 2-G Wave 3 — 2-G.1 matrix variant grid modal.
// Opens when `pendingVariantProductId` is set (by POSOmniInput after scanning
// a product that has >1 variant). Fetches /api/products/:id/variants with
// the current outlet_id so each cell shows the honest per-outlet stock.
// Click or Enter on a cell adds the variant to the cart.
export default function POSVariantMatrixModal() {
  const {
    pendingVariantProductId,
    setPendingVariantProductId,
    selectedOutletId,
    addToCart,
    posFlags,
    setPendingSerialProductId,
    setPendingSerialContext,
  } = usePOS();

  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [axis2Filter, setAxis2Filter] = useState(null); // 3rd-axis dropdown
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });
  const cellRefs = useRef({});

  useEffect(() => {
    if (!pendingVariantProductId) return;
    setLoading(true);
    setError("");
    const qs = selectedOutletId ? `?outlet_id=${selectedOutletId}` : "";
    Promise.all([
      api.get(`/api/products/${pendingVariantProductId}`),
      api.get(`/api/products/${pendingVariantProductId}/variants${qs}`),
    ])
      .then(([prodRes, varRes]) => {
        setProduct(prodRes?.product || prodRes || null);
        setVariants(Array.isArray(varRes?.variants) ? varRes.variants : []);
      })
      .catch((err) => setError(err.message || "Failed to load variants"))
      .finally(() => setLoading(false));
  }, [pendingVariantProductId, selectedOutletId]);

  const axes = useMemo(() => {
    // Collect unique attribute_name values in the order they first appear.
    const order = [];
    const seen = new Set();
    for (const v of variants) {
      for (const o of v.options || []) {
        if (o.attribute_name && !seen.has(o.attribute_name)) {
          seen.add(o.attribute_name);
          order.push(o.attribute_name);
        }
      }
    }
    return order;
  }, [variants]);

  const axisValues = useMemo(() => {
    // For each axis, unique option values in first-seen order.
    const byAxis = {};
    for (const name of axes) byAxis[name] = [];
    const seen = {};
    for (const name of axes) seen[name] = new Set();
    for (const v of variants) {
      for (const o of v.options || []) {
        if (axes.includes(o.attribute_name) && !seen[o.attribute_name].has(o.option_value)) {
          seen[o.attribute_name].add(o.option_value);
          byAxis[o.attribute_name].push(o.option_value);
        }
      }
    }
    return byAxis;
  }, [axes, variants]);

  const [axisRow, axisCol, axis3] = axes;

  // Auto-select the first third-axis value when axes[2] appears.
  useEffect(() => {
    if (axis3 && axisValues[axis3]?.length && !axis2Filter) {
      setAxis2Filter(axisValues[axis3][0]);
    }
  }, [axis3, axisValues, axis2Filter]);

  const findVariant = (rowVal, colVal) => {
    return variants.find((v) => {
      const opts = v.options || [];
      const r = opts.find((o) => o.attribute_name === axisRow)?.option_value;
      const c = axisCol ? opts.find((o) => o.attribute_name === axisCol)?.option_value : undefined;
      if (axisRow && r !== rowVal) return false;
      if (axisCol && c !== colVal) return false;
      if (axis3 && axis2Filter) {
        const t = opts.find((o) => o.attribute_name === axis3)?.option_value;
        if (t !== axis2Filter) return false;
      }
      return true;
    });
  };

  const rowValues = axisRow ? axisValues[axisRow] || [] : ["—"];
  const colValues = axisCol ? axisValues[axisCol] || [] : ["—"];

  const commitVariant = (variant) => {
    if (!variant) return;
    const parentName = product?.name || "Variant";
    const variantLabel = (variant.options || [])
      .map((o) => o.option_value)
      .filter(Boolean)
      .join(" / ");
    const cartLine = {
      id: variant.id, // distinct cart line per variant
      original_product_id: product?.id ?? pendingVariantProductId,
      variant_id: variant.id,
      name: variantLabel ? `${parentName} (${variantLabel})` : parentName,
      price: Number(variant.price ?? product?.price ?? 0),
      cost_price: Number(variant.cost_price ?? product?.cost_price ?? 0),
      barcode: variant.barcode || product?.barcode || null,
      sku: variant.sku || null,
      unit: product?.unit || null,
      stock: Number(variant.stock_at_outlet ?? variant.stock ?? 0),
      local_stock: Number(variant.stock_at_outlet ?? variant.stock ?? 0),
      tax: product?.tax ?? null,
      gst: product?.gst ?? null,
    };
    addToCart(cartLine);

    // 2-G.6: if this variant's parent product is serialized, chain into the
    // serial-entry modal with the freshly added cart line so the cashier can
    // stamp it with the specific serial (the modal mutates the cart line
    // rather than adding a new one).
    if (product?.serial_required) {
      setPendingSerialContext({
        product_id: product.id,
        variant_id: variant.id,
        quantity: 1,
        cartLine: { id: variant.id },
      });
      setPendingSerialProductId(product.id);
    }

    close();
  };

  const close = () => {
    setPendingVariantProductId(null);
    setProduct(null);
    setVariants([]);
    setAxis2Filter(null);
    setFocusedCell({ row: 0, col: 0 });
  };

  // Keyboard nav: arrows move focus, Enter commits, Esc closes.
  useEffect(() => {
    if (!pendingVariantProductId) return;
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const rv = rowValues[focusedCell.row];
        const cv = colValues[focusedCell.col];
        const v = findVariant(rv, cv);
        if (v) commitVariant(v);
        return;
      }
      let { row, col } = focusedCell;
      if (e.key === "ArrowUp") row = Math.max(0, row - 1);
      else if (e.key === "ArrowDown") row = Math.min(rowValues.length - 1, row + 1);
      else if (e.key === "ArrowLeft") col = Math.max(0, col - 1);
      else if (e.key === "ArrowRight") col = Math.min(colValues.length - 1, col + 1);
      else return;
      e.preventDefault();
      setFocusedCell({ row, col });
      const key = `${row}-${col}`;
      cellRefs.current[key]?.focus?.();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVariantProductId, focusedCell, rowValues, colValues, variants, axis2Filter]);

  if (!pendingVariantProductId) return null;
  if (!posFlags.phase2g_variant_picker) return null;

  const lowThreshold = Number(product?.low_stock_threshold ?? 5);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface)">
          <div className="flex items-center gap-2">
            <Grid3x3 size={16} className="text-(--ui-text)" />
            <h3 className="font-bold text-(--ui-text)">
              Choose variant{product?.name ? ` — ${product.name}` : ""}
            </h3>
          </div>
          <button onClick={close} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && (
            <div className="text-sm text-(--ui-text-muted) text-center py-6">Loading variants…</div>
          )}

          {!loading && error && (
            <div className="text-xs font-bold text-(--ui-danger-fg) bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {!loading && !error && variants.length === 0 && (
            <div className="text-sm text-(--ui-text-muted) text-center py-6">
              No variants configured for this product.
            </div>
          )}

          {!loading && !error && variants.length > 0 && axis3 && (
            <label className="block text-xs font-bold uppercase text-(--ui-text-muted) tracking-wider">
              {axis3}
              <select
                value={axis2Filter || ""}
                onChange={(e) => setAxis2Filter(e.target.value)}
                className="mt-1 w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 focus:border-(--ui-focus) outline-none font-semibold text-(--ui-text)"
              >
                {(axisValues[axis3] || []).map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!loading && !error && variants.length > 0 && (
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-[10px] uppercase tracking-wider text-(--ui-text-muted) text-left px-2 py-1 font-bold">
                      {axisRow || ""}
                    </th>
                    {axisCol ? (
                      colValues.map((cv) => (
                        <th
                          key={cv}
                          className="text-[10px] uppercase tracking-wider text-(--ui-text-muted) text-center px-2 py-1 font-bold"
                        >
                          {cv}
                        </th>
                      ))
                    ) : (
                      <th className="text-[10px] uppercase tracking-wider text-(--ui-text-muted) text-center px-2 py-1 font-bold">
                        Stock
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rowValues.map((rv, rowIdx) => (
                    <tr key={rv}>
                      <td className="text-sm font-bold text-(--ui-text) px-2 py-1 whitespace-nowrap">
                        {rv}
                      </td>
                      {colValues.map((cv, colIdx) => {
                        const v = findVariant(rv, cv);
                        const stock = v ? Number(v.stock_at_outlet ?? v.stock ?? 0) : 0;
                        let cellClass =
                          "px-2 py-2 text-center border border-(--ui-border) text-xs font-semibold min-w-[80px]";
                        let disabled = false;
                        let title = "";
                        if (!v) {
                          cellClass += " bg-(--ui-muted-surface) text-(--ui-text-muted)";
                          disabled = true;
                          title = "No such combination";
                        } else if (stock <= 0) {
                          cellClass += " bg-(--ui-muted-surface) text-(--ui-text-muted) line-through";
                          disabled = true;
                          title = `Out of stock · ${v.sku || ""}`;
                        } else if (stock <= lowThreshold) {
                          cellClass += " bg-(--ui-warning-bg) text-(--ui-warning-fg) hover:bg-(--ui-warning-bg)";
                          title = `Low stock · ${stock} left · ${v.sku || ""}`;
                        } else {
                          cellClass += " bg-(--ui-success-bg) text-(--ui-success-fg) hover:bg-(--ui-success-bg)";
                          title = `${stock} in stock · ${v.sku || ""}`;
                        }
                        const isFocused =
                          focusedCell.row === rowIdx && focusedCell.col === colIdx;
                        if (isFocused && !disabled) {
                          cellClass += " ring-2 ring-(--ui-focus)";
                        }
                        return (
                          <td key={cv} className="p-0">
                            <button
                              ref={(el) => {
                                cellRefs.current[`${rowIdx}-${colIdx}`] = el;
                              }}
                              disabled={disabled}
                              title={title}
                              onClick={() => v && commitVariant(v)}
                              onFocus={() => setFocusedCell({ row: rowIdx, col: colIdx })}
                              className={cellClass + " w-full"}
                            >
                              {v ? stock : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between items-center text-[11px] text-(--ui-text-muted)">
            <span>↑ ↓ ← → to move · Enter to add · Esc to cancel</span>
            <button onClick={close} className="text-(--ui-text-muted) hover:text-(--ui-text) font-semibold">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
