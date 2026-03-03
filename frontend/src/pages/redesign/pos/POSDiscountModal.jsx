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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-slate-800">Add Discount</h3>
          <button
            onClick={() => setShowDiscountModal(false)}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
            {["percent", "fixed"].map((t) => (
              <button
                key={t}
                onClick={() => setDiscountType(t)}
                className={`flex-1 py-1.5 rounded-md text-sm font-bold transition ${
                  discountType === t
                    ? "bg-white shadow-sm text-slate-800"
                    : "text-slate-500 hover:bg-slate-200"
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
            className="w-full border-2 border-slate-200 rounded-lg px-4 py-2.5 focus:border-[#8066FF] outline-none font-bold text-slate-800"
            placeholder={discountType === "percent" ? "10" : "50.00"}
          />
          <button
            onClick={() => setShowDiscountModal(false)}
            className="w-full bg-[#8066FF] hover:bg-[#7055E6] text-white font-bold py-2.5 rounded-lg transition"
          >
            Apply Discount
          </button>
        </div>
      </div>
    </div>
  );
}
