import { useRef } from "react";
import { usePOS } from "../POSContext";
import POSSearchArea from "../POSSearchArea";
import RestaurantHeader from "./RestaurantHeader";
import RestaurantCartGrouped from "./RestaurantCartGrouped";
import RestaurantActionBar from "./RestaurantActionBar";
import SeatCoursePicker, { useIsPortrait } from "./SeatCoursePicker";

// Phase 2-R.0 Day 3 + 5 — The check view at /pos/restaurant.
// Composition: RestaurantHeader (top) + 2-column body (menu left,
// grouped cart right) + RestaurantActionBar (sticky bottom).
//
// The menu column reuses POSSearchArea + POSContext.posLayout tiles —
// the same product tiles that render in retail POSRedesign.jsx — and
// every add path runs through the existing addToCartWithModifiers in
// POSContext, which (a) routes through POSModifierModal when the
// product has modifier groups and (b) stamps each line with the
// active seat / course. No duplicate add logic here.

export default function RestaurantCheckView({ onExit, onOpenSplit, onOpenTransfer }) {
  const { posLayout, addToCart, suggestions, money, total } = usePOS();
  const scrollRef = useRef(null);
  const isPortrait = useIsPortrait(900);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable content (Header collapses on scroll inside this container) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <RestaurantHeader onBack={onExit} scrollRef={scrollRef} />

        {/* Body — 2-col on desktop, stacked on portrait */}
        <div className={`flex ${isPortrait ? "flex-col" : "flex-row"} gap-4 p-4`}>
          {/* Menu column */}
          <div className={`${isPortrait ? "w-full" : "flex-1"} min-w-0 flex flex-col gap-3`}>
            {!isPortrait && <SeatCoursePicker />}

            <POSSearchArea />

            {/* Existing POS layout tiles — identical to POSRedesign */}
            {posLayout?.layout_json?.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {posLayout.layout_json.map((tile, i) => (
                  <button
                    key={tile.id || i}
                    className={`rounded-lg p-2 text-white text-center text-xs font-medium hover:opacity-80 transition ${
                      tile.size === "2x1" ? "col-span-2" : ""
                    }`}
                    style={{ backgroundColor: tile.color || "#8066FF" }}
                    onClick={() => {
                      if (tile.type === "product" && tile.product_id) {
                        addToCart({ id: tile.product_id, name: tile.label });
                      }
                    }}
                  >
                    {tile.label || tile.type}
                  </button>
                ))}
              </div>
            )}

            {suggestions?.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {suggestions.slice(0, 4).map((s) => (
                  <button
                    key={s.product_id}
                    onClick={() => addToCart({ id: s.product_id, name: s.name, price: Number(s.price) })}
                    className="shrink-0 bg-slate-700 hover:bg-slate-600 rounded-lg p-2 text-xs text-white text-center w-28"
                  >
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="text-slate-300 mt-0.5">{Number(s.price).toFixed(2)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart column — fixed width on desktop, full width below */}
          <div className={`${isPortrait ? "w-full" : "w-[420px] shrink-0"} flex flex-col rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden`}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-black text-slate-900 uppercase tracking-wider">Check</span>
              <span className="text-xs text-slate-500">Total: <span className="font-bold text-slate-900">{money(total)}</span></span>
            </div>
            <RestaurantCartGrouped />
          </div>
        </div>
      </div>

      {/* Bottom sheet seat/course picker on portrait */}
      {isPortrait && <SeatCoursePicker asSheet />}

      {/* Sticky action bar — pinned to viewport */}
      <RestaurantActionBar onOpenSplit={onOpenSplit} onOpenTransfer={onOpenTransfer} />
    </div>
  );
}
