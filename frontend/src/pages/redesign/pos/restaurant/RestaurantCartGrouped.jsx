import { useMemo } from "react";
import { Trash2, Minus, Plus } from "lucide-react";
import { usePOS } from "../POSContext";
import { groupCartBySeatAndCourse } from "./cartGrouping.js";

// Phase 2-R.0 Day 4 — Cart grouped by seat → course.
// Pure-presentational; the grouping math is in cartGrouping.js (unit-tested
// in tests/unit/restaurant-cart-grouping.test.js). Per-row controls call
// the same updateQty / removeFromCart from POSContext that the retail
// POSCartTable uses.

const COURSE_LABELS = {
  1: "Appetizer",
  2: "Salad",
  3: "Entrée",
  4: "Dessert",
  5: "Drinks",
};

export default function RestaurantCartGrouped() {
  const { cart, updateQty, removeFromCart, money } = usePOS();
  const groups = useMemo(() => groupCartBySeatAndCourse(cart), [cart]);

  if (!cart.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-(--ui-text-muted)">
        <div className="text-sm font-semibold">Pick a seat and course to start</div>
        <div className="text-xs mt-1 opacity-70">Items added to the cart will be grouped by seat and course.</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
      {groups.map((g) => (
        <div
          key={`${g.seat}-${g.course}`}
          className="rounded-xl border border-(--ui-border-strong) bg-(--ui-surface) overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-2 bg-(--ui-muted-surface) border-b border-(--ui-border-strong)">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-black text-(--ui-text)">
                {g.seat === 0 ? "Shared" : `Seat ${g.seat}`}
              </span>
              <span className="text-xs text-(--ui-text-muted)">·</span>
              <span className="text-xs font-bold text-(--ui-text)">
                Course {g.course}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-(--ui-text-muted) truncate">
                {COURSE_LABELS[g.course] || ""}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-(--ui-text-muted)">{g.itemCount} item{g.itemCount === 1 ? "" : "s"}</span>
              <span className="font-bold text-(--ui-text)">{money(g.subtotal)}</span>
            </div>
          </div>
          <ul className="divide-y divide-(--ui-border)">
            {g.items.map((item) => (
              <li
                key={`${item.id}-${item.seat_number ?? "_"}-${item.course_name ?? "_"}`}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-(--ui-text) truncate">{item.name}</div>
                  <div className="text-[11px] text-(--ui-text-muted)">
                    {money(Number(item.price))} each
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-(--ui-muted-surface) rounded-lg px-1 py-0.5">
                  <button
                    onClick={() => updateQty(item.id, -1)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-(--ui-surface) text-(--ui-text)"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                  <button
                    onClick={() => updateQty(item.id, +1)}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-(--ui-surface) text-(--ui-text)"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="text-sm font-bold text-(--ui-text) w-20 text-right">
                  {money(Number(item.price) * Number(item.quantity))}
                </div>
                <button
                  onClick={() => removeFromCart(item.id)}
                  className="text-(--ui-text-muted) hover:text-(--ui-danger) p-1"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
