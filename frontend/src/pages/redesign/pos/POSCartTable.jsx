import React, { useState } from "react";
import { ShoppingCart, Minus, Plus, Trash2, Package, Tag, Scale, MoreHorizontal, ShieldAlert, Loader2 } from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset, isWeightedUnit } from "../../../contexts/PresetContext";
import { isScaleSupported, weighOnce } from "../../../utils/scale";

export default function POSCartTable() {
  const {
    cart,
    updateQty,
    setQty,
    removeFromCart,
    money,
    posFlags,
    setPriceOverrideLineId,
    showNotice,
  } = usePOS();
  const overrideOn = !!posFlags?.phase2g_price_override;
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const preset = usePreset();
  const labels = preset.labels || {};
  const showTareField = preset.pos_search_config?.show_tare === true;
  const productsLabel = labels.products || "Products";
  const qtyLabel = labels.quantity_label || "Qty";

  return (
    <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-(--ui-border)">
        <span className="text-sm font-bold text-(--ui-text)">{productsLabel} List</span>
        {cart.length > 0 && (
          <span className="bg-(--ui-primary) text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {cart.length} item{cart.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-(--ui-text-muted) py-16">
          <ShoppingCart size={36} className="mb-3 text-(--ui-text) opacity-30" />
          <p className="font-bold text-(--ui-text)">Cart is empty</p>
          <p className="text-xs text-(--ui-text-muted) mt-1">
            Search items above to start a new sale.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-(--ui-text-muted) tracking-wider border-b border-(--ui-border) bg-(--ui-muted-surface)">
                <th className="px-3 md:px-4 py-2.5 text-left font-bold">{labels.product || "Product"}</th>
                <th className="px-2 md:px-3 py-2.5 text-center font-bold">{qtyLabel}</th>
                <th className="hidden md:table-cell px-3 py-2.5 text-right font-bold">Unit</th>
                <th className="px-2 md:px-3 py-2.5 text-right font-bold">Total</th>
                <th className="hidden md:table-cell px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-(--ui-border) last:border-0 hover:bg-(--ui-muted-surface) transition"
                >
                  <td className="px-3 md:px-4 py-3">
                    <div className="font-bold text-(--ui-text) text-xs md:text-sm flex items-center gap-1.5">
                      {item.name}
                      {item.is_bundle && (
                        <span className="inline-flex items-center gap-0.5 bg-(--ui-muted-surface) text-(--ui-text) text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <Package size={9} /> Bundle
                        </span>
                      )}
                      {item.originalPrice != null && item.originalPrice !== item.price && !item.price_override && (
                        <span className="inline-flex items-center gap-0.5 bg-(--ui-success-bg) text-(--ui-success-fg) text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <Tag size={9} /> Special Price
                        </span>
                      )}
                      {item.price_override && (
                        <span className="inline-flex items-center gap-0.5 bg-(--ui-warning-bg) text-(--ui-warning-fg) text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <ShieldAlert size={9} /> Override
                        </span>
                      )}
                    </div>
                    <div className="md:hidden text-[10px] text-(--ui-text-muted) mt-0.5 flex items-center gap-2">
                      <span>
                        {item.originalPrice != null && item.originalPrice !== item.price && (
                          <span className="line-through text-(--ui-text-muted) mr-1">{money(item.originalPrice)}</span>
                        )}
                        {money(item.price)} ea
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.id); }}
                        className="text-(--ui-danger) hover:text-(--ui-danger) p-0.5"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {item.availableStock > 0 &&
                      item.quantity >= item.availableStock && (
                        <div className="text-[10px] text-(--ui-danger-fg) font-bold mt-0.5">
                          ⚠ Max x stock reached
                        </div>
                      )}
                    {item.availableStock <= 0 && (
                      <div className="text-[10px] text-(--ui-warning-fg) font-bold mt-0.5">
                        ⚠ Override: out of stock
                      </div>
                    )}
                  </td>
                  <td className="px-2 md:px-3 py-3 text-center">
                    {isWeightedUnit(item.unit) ? (
                      <WeightedQtyCell
                        item={item}
                        setQty={setQty}
                        showTare={showTareField}
                        showNotice={showNotice}
                      />
                    ) : (
                      <div className="inline-flex items-center gap-0.5 md:gap-1">
                        <button
                          onClick={() => updateQty(item.id, -1)}
                          className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center text-(--ui-text) hover:bg-(--ui-muted-surface) rounded-full font-bold transition"
                        >
                          <Minus size={14} className="md:hidden" />
                          <Minus size={12} className="hidden md:block" />
                        </button>
                        <span className="w-7 md:w-8 text-center font-bold text-(--ui-text)">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQty(item.id, 1)}
                          className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center text-(--ui-text) hover:bg-(--ui-muted-surface) rounded-full font-bold transition"
                        >
                          <Plus size={14} className="md:hidden" />
                          <Plus size={12} className="hidden md:block" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="hidden md:table-cell px-3 py-3 text-right font-bold">
                    {item.originalPrice != null && item.originalPrice !== item.price ? (
                      <span>
                        <span className="line-through text-(--ui-text-muted) text-xs mr-1">{money(item.originalPrice)}</span>
                        <span className="text-(--ui-success-fg)">{money(item.price)}</span>
                      </span>
                    ) : (
                      <span className="text-(--ui-text-muted)">{money(item.price)}</span>
                    )}
                  </td>
                  <td className="px-2 md:px-3 py-3 text-right font-black text-(--ui-text)">
                    {isWeightedUnit(item.unit) && (
                      <div className="text-[10px] font-normal text-(--ui-text-muted)">
                        {Number(item.quantity).toFixed(3)} {item.unit} × {money(item.price)}
                      </div>
                    )}
                    {money(item.price * item.quantity)}
                  </td>
                  <td className="hidden md:table-cell px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5 relative">
                      {overrideOn && (
                        <button
                          onClick={() => setMenuOpenFor(menuOpenFor === item.id ? null : item.id)}
                          aria-label="Line options"
                          className="text-(--ui-text-muted) hover:text-(--ui-text) bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) p-1.5 rounded-lg transition"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      )}
                      {menuOpenFor === item.id && overrideOn && (
                        <div
                          className="absolute right-0 top-full mt-1 z-10 w-44 bg-(--ui-surface) border border-(--ui-border-strong) rounded-lg shadow-(--ui-shadow-lg) text-left"
                          onMouseLeave={() => setMenuOpenFor(null)}
                        >
                          <button
                            onClick={() => {
                              setMenuOpenFor(null);
                              setPriceOverrideLineId(item.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-(--ui-text) hover:bg-(--ui-muted-surface)"
                          >
                            <ShieldAlert size={12} className="text-(--ui-text)" />
                            Override price…
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="text-(--ui-danger) hover:text-(--ui-danger) bg-(--ui-danger-bg) hover:bg-(--ui-danger-bg) p-1.5 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * WeightedQtyCell — inline decimal quantity input for weighted items (kg, g, lb, m, cm).
 *
 * Default mode: gross only, tare=0, net=gross.
 * When `showTare` (preset.pos_search_config.show_tare), a second small input appears
 * for tare weight. Net is computed (gross - tare) and committed via setQty().
 *
 * V01 grocery lane:
 *  - "Weigh" button (only when the browser has Web Serial) pulls a live settled
 *    weight from the lane scale straight into the gross field. Feature-detected;
 *    when unsupported the cashier types the weight exactly as before (fallback).
 *  - Lines whose weight came from a scale price/weight-embedded label carry
 *    `tare_locked` — the deli scale already netted the tare into the printed
 *    label, so re-entering tare here would undercharge. The tare field is then
 *    read-only.
 */
function WeightedQtyCell({ item, setQty, showTare, showNotice }) {
  const gross = item.gross_weight != null ? Number(item.gross_weight) : Number(item.quantity);
  const tare = Number(item.tare_weight || 0);
  const tareLocked = item.tare_locked === true;
  const [weighing, setWeighing] = useState(false);
  const canWeigh = isScaleSupported();

  const commit = (nextGross, nextTare) => {
    const g = Math.max(0, Number(nextGross) || 0);
    const t = Math.max(0, Number(nextTare) || 0);
    const net = Math.max(0.001, g - t);
    setQty(item.id, net, { gross_weight: g, tare_weight: t });
  };

  const handleWeigh = async () => {
    if (weighing) return;
    setWeighing(true);
    try {
      const { weight } = await weighOnce();
      commit(weight, tare);
    } catch (err) {
      showNotice?.(err?.message || "Could not read the scale — type the weight.");
    } finally {
      setWeighing(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="inline-flex items-center gap-1">
        <Scale size={12} className="text-(--ui-text)" />
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={gross}
          onChange={(e) => commit(e.target.value, tare)}
          className="w-20 px-2 py-1 text-center text-sm font-bold text-(--ui-text) border border-(--ui-border-strong) rounded-md focus:outline-none focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus)"
        />
        <span className="text-[10px] font-semibold text-(--ui-text-muted) uppercase">{item.unit}</span>
        {canWeigh && (
          <button
            type="button"
            onClick={handleWeigh}
            disabled={weighing}
            title="Read weight from the lane scale"
            className="inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold text-(--ui-text) border border-(--ui-border-strong) rounded-md hover:bg-(--ui-muted-surface) disabled:opacity-50 transition"
          >
            {weighing ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
            Weigh
          </button>
        )}
      </div>
      {showTare && (
        <div className="inline-flex items-center gap-1 text-[10px] text-(--ui-text-muted)">
          <span>Tare:</span>
          <input
            type="number"
            step="0.001"
            min="0"
            value={tare}
            disabled={tareLocked}
            readOnly={tareLocked}
            onChange={(e) => commit(gross, e.target.value)}
            title={tareLocked ? "Tare already netted by the deli scale label" : undefined}
            className={`w-14 px-1 py-0.5 text-center text-[11px] border border-(--ui-border-strong) rounded focus:outline-none focus:ring-1 focus:ring-(--ui-focus) ${tareLocked ? "opacity-60 cursor-not-allowed bg-(--ui-muted-surface)" : ""}`}
          />
          <span>{item.unit}</span>
          {tareLocked && <span className="text-[9px]">🔒</span>}
        </div>
      )}
    </div>
  );
}
