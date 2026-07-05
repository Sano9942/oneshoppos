import React from "react";
import { X } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSDiscountModal() {
  const {
    showDiscountModal,
    setShowDiscountModal,
    discountType,
    setDiscountType,
    discountInput,
    setDiscountInput,
  } = usePOS();

  if (!showDiscountModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface)">
          <h3 className="font-bold text-(--ui-text)">Add Discount</h3>
          <button
            onClick={() => setShowDiscountModal(false)}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-1 p-1 bg-(--ui-muted-surface) rounded-lg">
            {["percent", "fixed"].map((t) => (
              <button
                key={t}
                onClick={() => setDiscountType(t)}
                className={`flex-1 py-1.5 rounded-md text-sm font-bold transition ${
                  discountType === t
                    ? "bg-(--ui-surface) shadow-sm text-(--ui-text)"
                    : "text-(--ui-text-muted) hover:bg-(--ui-border-strong)"
                }`}
              >
                {t === "percent" ? "Percentage (%)" : "Fixed Amount"}
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={discountInput}
            onChange={(e) => setDiscountInput(e.target.value)}
            autoFocus
            className="w-full border border-(--ui-border-strong) rounded-lg px-4 py-2.5 focus:border-(--ui-focus) outline-none font-bold text-(--ui-text)"
            placeholder={discountType === "percent" ? "10" : "50.00"}
          />
          <button
            onClick={() => setShowDiscountModal(false)}
            className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white font-bold py-2.5 rounded-lg transition"
          >
            Apply Discount
          </button>
        </div>
      </div>
    </div>
  );
}
