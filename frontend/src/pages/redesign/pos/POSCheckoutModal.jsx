import React, { useEffect } from "react";
import {
  Award,
  Banknote,
  X,
  User,
  Plus,
  CreditCard,
  Wallet,
  Trash2,
  CheckCircle2,
  Star,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset } from "../../../contexts/PresetContext";

export default function POSCheckoutModal() {
  const {
    checkoutOpen,
    setCheckoutOpen,
    money,
    remaining,
    checkoutCustomerId,
    setCheckoutCustomerId,
    checkoutCustSearch,
    setCheckoutCustSearch,
    setShowCheckoutCustDD,
    customers,
    custMode,
    setCustMode,
    filteredCheckoutCustomers,
    setNewCustName,
    newCustName,
    setNewCustMobile,
    newCustMobile,
    setNewCustError,
    newCustError,
    handleQuickCreateCustomer,
    newCustSaving,
    paymentMethod,
    setPaymentMethod,
    payAmountRef,
    paymentAmount,
    setPaymentAmount,
    addPayment,
    payments,
    setPayments,
    change,
    completeSale,
    submitting,
    // Loyalty & wallet
    checkoutWalletBalance,
    checkoutWalletLoading,
    redeemPointsOn,
    setRedeemPointsOn,
    payWithWalletOn,
    setPayWithWalletOn,
    checkoutCustomerPoints,
    checkoutCustomerTier,
    pointsDiscount,
    total,
  } = usePOS();
  const { labels = {} } = usePreset();
  const customerLabel = labels.customer || "Customer";

  const isOffline = !navigator.onLine;

  // Force-disable wallet and points when going offline
  useEffect(() => {
    const handleOffline = () => {
      setRedeemPointsOn(false);
      if (payWithWalletOn) {
        setPayWithWalletOn(false);
        setPayments((prev) => prev.filter((p) => p.method !== "Wallet"));
      }
    };
    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, [payWithWalletOn]);

  // Toggle wallet payment — adds/removes a Wallet entry in the payments array
  const handleWalletToggle = () => {
    const next = !payWithWalletOn;
    setPayWithWalletOn(next);
    if (next) {
      // Add wallet payment entry capped at total due
      const walletAmt = Math.min(checkoutWalletBalance, total);
      if (walletAmt > 0) {
        setPayments((prev) => [
          ...prev.filter((p) => p.method !== "Wallet"),
          { method: "Wallet", amount: walletAmt },
        ]);
      }
    } else {
      // Remove wallet payment entries
      setPayments((prev) => prev.filter((p) => p.method !== "Wallet"));
    }
  };

  if (!checkoutOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col border border-slate-100/20 max-h-[92vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Banknote className="text-[#8066FF]" size={20} /> Complete Payment
          </h2>
          <button
            onClick={() => setCheckoutOpen(false)}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Total due */}
          <div className="text-center bg-slate-50 border border-slate-100 rounded-2xl py-5">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
              Total Due
            </p>
            <p className="text-4xl font-black text-slate-900">
              {money(remaining)}
            </p>
          </div>

          {/* Customer at checkout — quick search + create */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              {customerLabel} (optional)
            </label>

            {checkoutCustomerId ? (
              <div className="flex items-center justify-between px-3 py-2.5 bg-violet-50 border border-violet-200 rounded-xl">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-violet-500 shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-violet-800">
                      {checkoutCustSearch}
                    </span>
                    {checkoutCustomerTier?.name && (
                      <span className="inline-flex items-center gap-0.5 ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: (checkoutCustomerTier.color || "#8066FF") + "33", color: checkoutCustomerTier.color || "#8066FF" }}>
                        <Award size={9} />{checkoutCustomerTier.name}
                        {checkoutCustomerTier.multiplier > 1 && <span className="opacity-70">{checkoutCustomerTier.multiplier}x</span>}
                      </span>
                    )}
                    {customers.find(
                      (c) => String(c.id) === String(checkoutCustomerId),
                    )?.mobile && (
                      <span className="text-xs text-violet-500 ml-2">
                        ·{" "}
                        {
                          customers.find(
                            (c) => String(c.id) === String(checkoutCustomerId),
                          )?.mobile
                        }
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCheckoutCustomerId("");
                    setCheckoutCustSearch("");
                  }}
                  className="text-violet-400 hover:text-violet-700 p-1 rounded-lg hover:bg-violet-100 transition"
                >
                  <X size={14} />
                </button>
              </div>
            ) : custMode === "search" ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="relative">
                  <User
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search name or phone…"
                    value={checkoutCustSearch}
                    onFocus={() => setShowCheckoutCustDD(true)}
                    onBlur={() =>
                      setTimeout(() => setShowCheckoutCustDD(false), 180)
                    }
                    onChange={(e) => {
                      setCheckoutCustSearch(e.target.value);
                      setShowCheckoutCustDD(true);
                    }}
                    className="w-full pl-8 pr-3 py-2.5 text-sm font-medium focus:outline-none border-b border-slate-100"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto">
                  <div
                    onMouseDown={() => {
                      setCheckoutCustomerId("");
                      setCheckoutCustSearch("");
                      setShowCheckoutCustDD(false);
                    }}
                    className="px-3 py-2 text-slate-400 text-xs font-semibold cursor-pointer hover:bg-slate-50 border-b border-slate-50"
                  >
                    Walk-in (no customer)
                  </div>
                  {filteredCheckoutCustomers.map((c) => (
                    <div
                      key={c.id}
                      onMouseDown={() => {
                        setCheckoutCustomerId(String(c.id));
                        setCheckoutCustSearch(c.name || "");
                        setShowCheckoutCustDD(false);
                      }}
                      className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-violet-50 border-b border-slate-50 last:border-0"
                    >
                      <span className="font-bold text-sm text-slate-800">
                        {c.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {c.mobile || ""}
                      </span>
                    </div>
                  ))}
                  {filteredCheckoutCustomers.length === 0 &&
                    checkoutCustSearch && (
                      <p className="text-xs text-slate-400 text-center py-2">
                        No match found
                      </p>
                    )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustMode("create");
                    setNewCustName(checkoutCustSearch);
                    setNewCustMobile("");
                    setNewCustError("");
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-violet-600 hover:bg-violet-50 border-t border-slate-100 transition"
                >
                  <Plus size={13} /> New Customer
                </button>
              </div>
            ) : (
              <div className="border-2 border-violet-300 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-violet-600 flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wide">
                    New Customer
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCustMode("search");
                      setNewCustError("");
                    }}
                    className="text-violet-200 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="p-3 space-y-2 bg-white">
                  <input
                    type="text"
                    autoFocus
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    placeholder="Full name *"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
                  />
                  <input
                    type="tel"
                    value={newCustMobile}
                    onChange={(e) => setNewCustMobile(e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:border-violet-400 focus:outline-none"
                  />
                  {newCustError && (
                    <p className="text-xs text-red-500 font-semibold">
                      {newCustError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleQuickCreateCustomer}
                    disabled={newCustSaving}
                    className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-lg transition disabled:opacity-50"
                  >
                    {newCustSaving ? "Saving…" : "Create & Attach to Sale"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Loyalty & Wallet panel — shown only when a customer is selected */}
          {checkoutCustomerId && (
            <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 space-y-3">
              {/* Balance summary */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-violet-700 uppercase tracking-wide">
                  <Star size={13} className="text-amber-500" />
                  Points & Wallet
                </div>
                {checkoutWalletLoading && (
                  <span className="text-xs text-violet-400">Loading…</span>
                )}
              </div>
              <div className="flex gap-3">
                <div className="flex-1 bg-white rounded-xl px-3 py-2 text-center border border-violet-100">
                  <p className="text-xs text-slate-500 mb-0.5">Points</p>
                  <p className="text-lg font-black text-violet-700">
                    {checkoutCustomerPoints}
                  </p>
                </div>
                <div className="flex-1 bg-white rounded-xl px-3 py-2 text-center border border-violet-100">
                  <p className="text-xs text-slate-500 mb-0.5">Wallet</p>
                  <p className="text-lg font-black text-emerald-600">
                    {money(checkoutWalletBalance)}
                  </p>
                </div>
              </div>

              {/* Redeem Points toggle */}
              {checkoutCustomerPoints >= 100 && (
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => !isOffline && setRedeemPointsOn((v) => !v)}
                  title={isOffline ? "Points redemption requires connectivity" : ""}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition font-semibold text-sm ${
                    isOffline
                      ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                      : redeemPointsOn
                        ? "border-amber-400 bg-amber-50 text-amber-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star size={14} className="text-amber-500" />
                    Redeem {Math.floor(checkoutCustomerPoints / 100) * 100} pts
                    <span className="text-xs text-slate-400 font-normal">
                      = {money(pointsDiscount)} off
                    </span>
                  </span>
                  {redeemPointsOn ? (
                    <ToggleRight size={20} className="text-amber-500" />
                  ) : (
                    <ToggleLeft size={20} className="text-slate-400" />
                  )}
                </button>
              )}

              {/* Pay with Wallet toggle */}
              {checkoutWalletBalance > 0 && (
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={() => !isOffline && handleWalletToggle()}
                  title={isOffline ? "Wallet payment requires connectivity" : ""}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 transition font-semibold text-sm ${
                    isOffline
                      ? "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed"
                      : payWithWalletOn
                        ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Wallet size={14} className="text-emerald-600" />
                    Pay with Wallet
                    <span className="text-xs text-slate-400 font-normal">
                      ({money(checkoutWalletBalance)} available)
                    </span>
                  </span>
                  {payWithWalletOn ? (
                    <ToggleRight size={20} className="text-emerald-500" />
                  ) : (
                    <ToggleLeft size={20} className="text-slate-400" />
                  )}
                </button>
              )}
            </div>
          )}

          {/* Payment method */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "Cash", icon: <Banknote size={16} /> },
                { id: "Card", icon: <CreditCard size={16} /> },
                { id: "Wallet", icon: <Wallet size={16} /> },
              ].map(({ id, icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPaymentMethod(id)}
                  className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold text-sm transition border-2 ${
                    paymentMethod === id
                      ? "border-[#8066FF] bg-[#8066FF]/5 text-[#8066FF]"
                      : "border-slate-100 bg-white hover:border-slate-200 text-slate-600"
                  }`}
                >
                  {icon} {id}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <form onSubmit={addPayment}>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Amount
            </label>
            <div className="flex gap-2">
              <input
                ref={payAmountRef}
                type="number"
                step="0.01"
                min="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 rounded-xl focus:border-[#8066FF] focus:ring-0 outline-none text-lg font-bold shadow-sm"
                placeholder="0.00"
              />
              <button
                type="submit"
                disabled={!paymentAmount || Number(paymentAmount) <= 0}
                className="bg-slate-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition shadow-md"
              >
                Add
              </button>
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <button
                type="button"
                onClick={() => setPaymentAmount(remaining.toFixed(2))}
                className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition"
              >
                Exact
              </button>
              {[50, 100, 500, 1000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() =>
                    setPaymentAmount(
                      (Math.ceil(remaining / amt) * amt).toFixed(2),
                    )
                  }
                  className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-xs font-bold transition"
                >
                  +{amt}
                </button>
              ))}
            </div>
          </form>

          {/* Tenders */}
          {payments.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
                Tenders
              </p>
              <div className="space-y-2">
                {payments.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 bg-slate-50 border border-slate-100 rounded-xl"
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      {p.method === "Cash" ? (
                        <Banknote size={14} className="text-[#8066FF]" />
                      ) : p.method === "Wallet" ? (
                        <Wallet size={14} className="text-[#8066FF]" />
                      ) : (
                        <CreditCard size={14} className="text-[#8066FF]" />
                      )}
                      {p.method}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-black text-slate-900 text-sm">
                        {money(p.amount)}
                      </span>
                      <button
                        onClick={() =>
                          setPayments((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {change > 0 && (
                <div className="mt-3 flex justify-between items-center text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                  <span>Change Due</span>
                  <span>{money(change)}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={completeSale}
            disabled={remaining > 0 || submitting}
            className={`w-full py-4 rounded-xl font-black text-lg flex items-center justify-center gap-2 transition-all ${
              remaining > 0 || submitting
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_10px_20px_-10px_rgba(16,185,129,0.5)] hover:scale-[1.01]"
            }`}
          >
            <CheckCircle2
              size={22}
              className={remaining > 0 ? "opacity-40" : ""}
            />
            {submitting
              ? "Processing…"
              : remaining > 0
                ? "Add Remaining Tender"
                : "Complete Sale"}
          </button>
        </div>
      </div>
    </div>
  );
}
