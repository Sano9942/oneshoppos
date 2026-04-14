import React from "react";
import { ShoppingCart, Minus, Plus, Trash2, Package, Tag, Scale } from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset, isWeightedUnit } from "../../../contexts/PresetContext";

export default function POSCartTable() {
  const { cart, updateQty, setQty, removeFromCart, money } = usePOS();
  const preset = usePreset();
  const labels = preset.labels || {};
  const showTareField = preset.pos_search_config?.show_tare === true;
  const productsLabel = labels.products || "Products";
  const qtyLabel = labels.quantity_label || "Qty";

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800">{productsLabel} List</span>
        {cart.length > 0 && (
          <span className="bg-[#8066FF] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            {cart.length} item{cart.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-16">
          <ShoppingCart size={36} className="mb-3 text-[#8066FF] opacity-30" />
          <p className="font-bold text-slate-600">Cart is empty</p>
          <p className="text-xs text-slate-400 mt-1">
            Search items above to start a new sale.
          </p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-slate-400 tracking-wider border-b border-slate-100 bg-slate-50">
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
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition"
                >
                  <td className="px-3 md:px-4 py-3">
                    <div className="font-bold text-slate-800 text-xs md:text-sm flex items-center gap-1.5">
                      {item.name}
                      {item.is_bundle && (
                        <span className="inline-flex items-center gap-0.5 bg-violet-100 text-violet-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <Package size={9} /> Bundle
                        </span>
                      )}
                      {item.originalPrice != null && item.originalPrice !== item.price && (
                        <span className="inline-flex items-center gap-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          <Tag size={9} /> Special Price
                        </span>
                      )}
                    </div>
                    <div className="md:hidden text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>
                        {item.originalPrice != null && item.originalPrice !== item.price && (
                          <span className="line-through text-slate-300 mr-1">{money(item.originalPrice)}</span>
                        )}
                        {money(item.price)} ea
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromCart(item.id); }}
                        className="text-red-400 hover:text-red-600 p-0.5"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {item.availableStock > 0 &&
                      item.quantity >= item.availableStock && (
                        <div className="text-[10px] text-rose-500 font-bold mt-0.5">
                          ⚠ Max x stock reached
                        </div>
                      )}
                    {item.availableStock <= 0 && (
                      <div className="text-[10px] text-amber-500 font-bold mt-0.5">
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
                      />
                    ) : (
                      <div className="inline-flex items-center gap-0.5 md:gap-1">
                        <button
                          onClick={() => updateQty(item.id, -1)}
                          className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition"
                        >
                          <Minus size={14} className="md:hidden" />
                          <Minus size={12} className="hidden md:block" />
                        </button>
                        <span className="w-7 md:w-8 text-center font-bold text-slate-800">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQty(item.id, 1)}
                          className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center text-[#8066FF] hover:bg-[#8066FF]/10 rounded-full font-bold transition"
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
                        <span className="line-through text-slate-300 text-xs mr-1">{money(item.originalPrice)}</span>
                        <span className="text-emerald-600">{money(item.price)}</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">{money(item.price)}</span>
                    )}
                  </td>
                  <td className="px-2 md:px-3 py-3 text-right font-black text-slate-900">
                    {isWeightedUnit(item.unit) && (
                      <div className="text-[10px] font-normal text-slate-400">
                        {Number(item.quantity).toFixed(3)} {item.unit} × {money(item.price)}
                      </div>
                    )}
                    {money(item.price * item.quantity)}
                  </td>
                  <td className="hidden md:table-cell px-3 py-3 text-right">
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition"
                    >
                      <Trash2 size={13} />
                    </button>
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
 */
function WeightedQtyCell({ item, setQty, showTare }) {
  const gross = item.gross_weight != null ? Number(item.gross_weight) : Number(item.quantity);
  const tare = Number(item.tare_weight || 0);

  const commit = (nextGross, nextTare) => {
    const g = Math.max(0, Number(nextGross) || 0);
    const t = Math.max(0, Number(nextTare) || 0);
    const net = Math.max(0.001, g - t);
    setQty(item.id, net, { gross_weight: g, tare_weight: t });
  };

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="inline-flex items-center gap-1">
        <Scale size={12} className="text-[#8066FF]" />
        <input
          type="number"
          step="0.001"
          min="0.001"
          value={gross}
          onChange={(e) => commit(e.target.value, tare)}
          className="w-20 px-2 py-1 text-center text-sm font-bold text-slate-800 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#8066FF]/30 focus:border-[#8066FF]"
        />
        <span className="text-[10px] font-semibold text-slate-500 uppercase">{item.unit}</span>
      </div>
      {showTare && (
        <div className="inline-flex items-center gap-1 text-[10px] text-slate-400">
          <span>Tare:</span>
          <input
            type="number"
            step="0.001"
            min="0"
            value={tare}
            onChange={(e) => commit(gross, e.target.value)}
            className="w-14 px-1 py-0.5 text-center text-[11px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-[#8066FF]/40"
          />
          <span>{item.unit}</span>
        </div>
      )}
    </div>
  );
}
