import React, { useState } from "react";
import { Award, Search, User, ShoppingCart, Tag, FileText, BadgeCheck, X } from "lucide-react";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useBrowserOnline } from "./hooks/useBrowserOnline";
import POSStaffPurchaseModal from "./POSStaffPurchaseModal";
import { Button } from "../../../ui/primitives";

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
    loyaltyEnabled,
    staffPurchase,
    staffQuote,
    staffQuoteError,
    staffQuotePending,
    loadStaffList,
    clearStaffPurchase,
  } = usePOS();
  const [showStaff, setShowStaff] = useState(false);
  const online = useBrowserOnline();
  const openStaff = () => {
    loadStaffList();
    setShowStaff(true);
  };

  const customerLabel = presetLabels?.customer || "Customer";

  return (
    <div className={`${mobile ? "w-full" : "w-80 shrink-0"} bg-(--ui-surface) text-(--ui-text) flex flex-col p-4 border-l border-(--ui-border) z-10`}>
      {/* One Toy Store F3b part 2 — a staff bill has no customer. */}
      {staffPurchase ? (
        <div className="mb-4 rounded-2xl border-2 border-(--ui-primary) bg-(--ui-muted-surface) p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-(--ui-text-muted)">
                <BadgeCheck size={14} /> Staff purchase (at cost)
              </div>
              <div className="mt-1 text-lg font-black text-(--ui-text)">{staffPurchase.name}</div>
            </div>
            <button
              type="button"
              onClick={clearStaffPurchase}
              aria-label="Not a staff purchase"
              className="rounded-full p-1 text-(--ui-text-muted) hover:bg-(--ui-surface)"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mt-2 text-xs text-(--ui-text-muted)">Pay with Cash, Online or Cut from salary.</p>
          {staffQuoteError && <p className="mt-2 text-xs font-bold text-(--ui-danger)">{staffQuoteError}</p>}
        </div>
      ) : (<>
      {/* Customer search */}
      <div className="relative mb-4">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted) pointer-events-none"
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
          className="w-full bg-(--ui-surface) text-(--ui-text) border border-(--ui-border-strong) rounded-xl pl-9 pr-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-(--ui-focus) placeholder-(--ui-text-muted)"
        />
        {showCustomerDD && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-(--ui-surface) border border-(--ui-border-strong) rounded-xl shadow-(--ui-shadow-lg) max-h-48 overflow-y-auto z-40">
            <div
              onMouseDown={() => {
                setSelectedCustomerId("");
                setCustomerSearch("");
                setShowCustomerDD(false);
              }}
              className="px-3 py-2 border-b border-(--ui-border) text-(--ui-text-muted) text-sm cursor-pointer hover:bg-(--ui-muted-surface)"
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
                className="px-3 py-2 border-b border-(--ui-border) last:border-0 cursor-pointer hover:bg-(--ui-muted-surface)"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm text-(--ui-text)">{c.name}</span>
                  {c.tier_name && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: (c.tier_color || "#888") + "22", color: c.tier_color || "#888" }}>
                      {c.tier_name}
                    </span>
                  )}
                </div>
                {c.mobile && (
                  <div className="text-xs text-(--ui-text-muted)">{c.mobile}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer card */}
      <div className="rounded-2xl border border-(--ui-border) bg-(--ui-muted-surface) p-4 text-center mb-4">
        {selectedCustomer ? (
          <>
            <div className="w-10 h-10 rounded-full bg-(--ui-border-strong) text-(--ui-text) flex items-center justify-center mx-auto mb-2">
              <User size={18} />
            </div>
            <p className="font-bold text-sm text-(--ui-text)">
              {selectedCustomer.name}
            </p>
            {selectedCustomer.mobile && (
              <p className="text-xs text-(--ui-text-muted) mt-0.5">
                {selectedCustomer.mobile}
              </p>
            )}
            <div className="flex justify-center gap-2 mt-2 text-xs">
              {loyaltyEnabled && selectedCustomer.tier_name && (
                <span
                  className="rounded-full px-2 py-0.5 font-semibold flex items-center gap-1"
                  style={{ backgroundColor: (selectedCustomer.tier_color || "#101010") + "33", color: selectedCustomer.tier_color || "#101010" }}
                >
                  <Award size={10} />
                  {selectedCustomer.tier_name}
                  {Number(selectedCustomer.tier_multiplier) > 1 && (
                    <span className="opacity-70 text-[10px]">{selectedCustomer.tier_multiplier}x</span>
                  )}
                </span>
              )}
              {loyaltyEnabled && (
                <span className="rounded-full bg-(--ui-border-strong) text-(--ui-text) px-2 py-0.5 font-semibold">
                  {selectedCustomer.loyalty_points || 0} pts
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedCustomerId("");
                setCustomerSearch("");
              }}
              className="mt-2 text-[10px] text-(--ui-danger) hover:opacity-80"
            >
              Remove
            </button>
          </>
        ) : (
          <div className="opacity-40 flex flex-col items-center">
            <ShoppingCart size={28} className="mb-2" />
            <span className="text-sm font-bold">Walk-in {customerLabel}</span>
          </div>
        )}
      </div>

      </>)}

      {/* Discount / Note / Staff buttons */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <button
          onClick={() => setShowDiscountModal(true)}
          disabled={!!staffPurchase}
          className="flex items-center justify-center gap-1.5 border border-(--ui-border-strong) hover:bg-(--ui-muted-surface) rounded-full py-2.5 text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Tag size={12} className="text-(--ui-text-muted)" />
          {discountInput
            ? `Disc. (${discountType === "percent" ? discountInput + "%" : currencySymbol + " " + discountInput})`
            : "Add Discount"}
        </button>
        <button
          onClick={() => setShowNoteModal(true)}
          className="flex items-center justify-center gap-1.5 border border-(--ui-border-strong) hover:bg-(--ui-muted-surface) rounded-full py-2.5 text-xs font-bold transition"
        >
          <FileText
            size={12}
            className={orderNote ? "text-(--ui-success-fg)" : "text-(--ui-text-muted)"}
          />
          {orderNote ? "Edit Note" : "Add Note"}
        </button>
        <Button
          tone={staffPurchase ? "primary" : "default"}
          onClick={openStaff}
          disabled={!online}
          title={online ? "Staff takes toys at cost" : "Staff purchase needs the internet (cost price)"}
          className="!h-auto py-2.5 text-xs font-bold"
        >
          <BadgeCheck size={12} />
          Staff
        </Button>
      </div>
      <POSStaffPurchaseModal open={showStaff} onClose={() => setShowStaff(false)} />

      {/* Totals */}
      <div className="space-y-3 text-sm font-medium text-(--ui-text-muted) border-t border-(--ui-border) pt-4 mb-4 flex-1">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="text-(--ui-text)">{money(grossTotal)}</span>
        </div>
        {staffPurchase ? (
          <div className="flex justify-between text-(--ui-warning-fg)">
            <span>Staff discount (to cost)</span>
            <span>{staffQuote ? `- ${money(discountValue)}` : staffQuotePending ? "…" : "—"}</span>
          </div>
        ) : discountValue > 0 && (
          <div className="flex justify-between text-(--ui-warning-fg)">
            <span>
              Discount {discountType === "percent" ? `(${discountInput}%)` : ""}
            </span>
            <span>- {money(discountValue)}</span>
          </div>
        )}
        {!staffPurchase && promoDiscount > 0 && (
          <div className="flex justify-between text-(--ui-success-fg)">
            <span className="flex items-center gap-1">
              Promo{appliedPromotions.length > 1 ? ` (${appliedPromotions.length})` : appliedPromotions[0]?.name ? ` — ${appliedPromotions[0].name}` : ""}
            </span>
            <span>- {money(promoDiscount)}</span>
          </div>
        )}
        {taxInclusive && taxTotal > 0 && (
          <div className="flex justify-between">
            <span>GST (incl.)</span>
            <span className="text-(--ui-text)">{money(taxTotal)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-black text-(--ui-text) border-t border-(--ui-border) pt-3">
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
            ? "bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong)"
            : "bg-(--ui-muted-surface) cursor-not-allowed text-(--ui-text-muted)"
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
