import React from "react";
import { Award, Search, User, ShoppingCart, Tag, FileText } from "lucide-react";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSSidebar({ mobile }) {
  const { symbol: currencySymbol } = useCurrency();
  const {
    customerSearch,
    setCustomerSearch,
    showCustomerDD,
    setShowCustomerDD,
    setSelectedCustomerId,
    filteredCustomers,
    selectedCustomer,
    setShowDiscountModal,
    discountInput,
    discountType,
    setShowNoteModal,
    orderNote,
    grossTotal,
    discountValue,
    taxInclusive,
    taxTotal,
    total,
    money,
    cart,
    openCheckout,
    checkoutCustomerTier,
    appliedPromotions,
    promoDiscount,
    presetLabels,
  } = usePOS();

  const customerLabel = presetLabels?.customer || "Customer";

  return (
    <div className={`${mobile ? "w-full" : "w-80 shrink-0"} bg-[#0A0A0A] text-white flex flex-col p-4 shadow-2xl z-10`}>
      {/* Customer search */}
      <div className="relative mb-4">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
        />
        <input
          type="text"
          placeholder={`Search ${customerLabel.toLowerCase()}…`}
          data-pos-customer-search
          value={customerSearch}
          onFocus={() => setShowCustomerDD(true)}
          onBlur={() => setTimeout(() => setShowCustomerDD(false), 180)}
          onChange={(e) => {
            setCustomerSearch(e.target.value);
            setShowCustomerDD(true);
          }}
          className="w-full bg-white text-slate-900 rounded-xl pl-9 pr-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#8066FF] placeholder-slate-400"
        />
        {showCustomerDD && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-40">
            <div
              onMouseDown={() => {
                setSelectedCustomerId("");
                setCustomerSearch("");
                setShowCustomerDD(false);
              }}
              className="px-3 py-2 border-b border-slate-100 text-slate-500 text-sm cursor-pointer hover:bg-slate-50"
            >
              Walk-in {customerLabel}
            </div>
            {filteredCustomers.map((c) => (
              <div
                key={c.id}
                onMouseDown={() => {
                  setSelectedCustomerId(String(c.id));
                  setCustomerSearch(c.name || "");
                  setShowCustomerDD(false);
                }}
                className="px-3 py-2 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-slate-800">{c.name}</span>
                  {c.tier_name && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: (c.tier_color || "#888") + "22", color: c.tier_color || "#888" }}>
                      {c.tier_name}
                    </span>
                  )}
                </div>
                {c.mobile && (
                  <div className="text-xs text-slate-500">{c.mobile}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer card */}
      <div className="rounded-2xl border border-[#1A1A1A] bg-[#111] p-4 text-center mb-4">
        {selectedCustomer ? (
          <>
            <div className="w-10 h-10 rounded-full bg-[#8066FF]/20 text-[#8066FF] flex items-center justify-center mx-auto mb-2">
              <User size={18} />
            </div>
            <p className="font-bold text-sm text-white">
              {selectedCustomer.name}
            </p>
            {selectedCustomer.mobile && (
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedCustomer.mobile}
              </p>
            )}
            <div className="flex justify-center gap-2 mt-2 text-xs">
              {selectedCustomer.tier_name && (
                <span
                  className="rounded-full px-2 py-0.5 font-semibold flex items-center gap-1"
                  style={{ backgroundColor: (selectedCustomer.tier_color || "#8066FF") + "33", color: selectedCustomer.tier_color || "#8066FF" }}
                >
                  <Award size={10} />
                  {selectedCustomer.tier_name}
                  {Number(selectedCustomer.tier_multiplier) > 1 && (
                    <span className="opacity-70 text-[10px]">{selectedCustomer.tier_multiplier}x</span>
                  )}
                </span>
              )}
              <span className="rounded-full bg-[#8066FF]/20 text-[#8066FF] px-2 py-0.5 font-semibold">
                {selectedCustomer.loyalty_points || 0} pts
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedCustomerId("");
                setCustomerSearch("");
              }}
              className="mt-2 text-[10px] text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </>
        ) : (
          <div className="opacity-40 flex flex-col items-center">
            <ShoppingCart size={28} className="mb-2" />
            <span className="text-sm font-bold">Walk-in Customer</span>
          </div>
        )}
      </div>

      {/* Discount / Note buttons */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setShowDiscountModal(true)}
          className="flex items-center justify-center gap-1.5 border border-[#333] hover:bg-[#1A1A1A] rounded-xl py-2.5 text-xs font-bold transition"
        >
          <Tag size={12} className="text-[#8066FF]" />
          {discountInput
            ? `Disc. (${discountType === "percent" ? discountInput + "%" : currencySymbol + " " + discountInput})`
            : "Add Discount"}
        </button>
        <button
          onClick={() => setShowNoteModal(true)}
          className="flex items-center justify-center gap-1.5 border border-[#333] hover:bg-[#1A1A1A] rounded-xl py-2.5 text-xs font-bold transition"
        >
          <FileText
            size={12}
            className={orderNote ? "text-emerald-400" : "text-[#8066FF]"}
          />
          {orderNote ? "Edit Note" : "Add Note"}
        </button>
      </div>

      {/* Totals */}
      <div className="space-y-3 text-sm font-medium text-slate-400 border-t border-[#222] pt-4 mb-4 flex-1">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="text-white">{money(grossTotal)}</span>
        </div>
        {discountValue > 0 && (
          <div className="flex justify-between text-amber-400">
            <span>
              Discount {discountType === "percent" ? `(${discountInput}%)` : ""}
            </span>
            <span>- {money(discountValue)}</span>
          </div>
        )}
        {promoDiscount > 0 && (
          <div className="flex justify-between text-green-400">
            <span className="flex items-center gap-1">
              Promo{appliedPromotions.length > 1 ? ` (${appliedPromotions.length})` : appliedPromotions[0]?.name ? ` — ${appliedPromotions[0].name}` : ""}
            </span>
            <span>- {money(promoDiscount)}</span>
          </div>
        )}
        {taxInclusive && taxTotal > 0 && (
          <div className="flex justify-between">
            <span>GST (incl.)</span>
            <span className="text-white">{money(taxTotal)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-black text-white border-t border-[#222] pt-3">
          <span>Total</span>
          <span>{money(total)}</span>
        </div>
      </div>

      {/* Pay button */}
      <button
        onClick={openCheckout}
        disabled={!cart.length}
        className={`w-full py-4 rounded-xl font-black text-lg flex items-center justify-between px-5 transition-all ${
          cart.length
            ? "bg-[#8066FF] hover:bg-[#7055E6] hover:scale-[1.01] shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)]"
            : "bg-[#8066FF]/30 cursor-not-allowed text-white/40"
        }`}
      >
        <span className="border-r border-white/20 pr-4 text-base tracking-wide">
          Pay
        </span>
        <span className="pl-2 flex-1 text-right tracking-tight">
          {money(total)}
        </span>
      </button>
    </div>
  );
}
