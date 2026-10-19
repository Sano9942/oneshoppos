import React, { useEffect, useState } from "react";
import { api } from "../../../api";
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
  PenLine,
  Gift,
  Receipt,
  Smartphone,
  BadgeCheck,
} from "lucide-react";
import { usePOS } from "./POSContext";
import { usePreset } from "../../../contexts/PresetContext";
import { Button } from "../../../ui/primitives";
import {
  isOnlineMethod,
  onlineMethodName,
  useOnlinePaymentOptions,
} from "../../../utils/onlinePayments";
import { CUT_FROM_SALARY } from "./hooks/useStaffPurchase";
import { NOTE_BUTTONS, addNote, onlineTender, startAmount } from "./tenderAmount";

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
    loyaltyEnabled,
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
    // M9 charge-to-room
    chargeToRoomFolioId,
    setChargeToRoomFolioId,
    openBookings,
    openBookingsLoading,
    // M10 charge-to-plan
    chargeToTreatmentFolioId,
    setChargeToTreatmentFolioId,
    openTreatmentPlans,
    setOpenTreatmentPlans,
    selectedOutletId,
    // Phase 2.1 C1 — tip + server (restaurant flow)
    tipAmount,
    setTipAmount,
    tipMethod,
    setTipMethod,
    serverId,
    setServerId,
    employeesList,
    setShowGuestMode,
    signatureSvg,
    posFlags,
    activeAppointmentId,
    staffPurchase,
  } = usePOS();
  const { labels = {}, hasMode, industry_type } = usePreset();
  const isSalonWalkIn = industry_type === "salon" && !activeAppointmentId;
  const restaurantOn = hasMode && hasMode("restaurant");
  const giftCardsOn = !!posFlags?.phase2g_gift_cards;
  // Tier 0.1 wholesale — Credit (on-account) tender. Visible when the flag is
  // on. Disabled (greyed) until a customer is selected since /api/sales rejects
  // with CREDIT_REQUIRES_CUSTOMER otherwise.
  const creditTenderOn = !!posFlags?.wholesale_credit_controls;

  // Phase 2-G Wave 2 (2-G.2) — gift-card tender state, local to the modal.
  const [giftCardCode, setGiftCardCode] = useState("");
  // F2 (D52): Online = EasyPaisa / JazzCash / bank app. One button, then the
  // shop's choices (Company Profile); saved as "Online - <choice>".
  const onlineOptions = useOnlinePaymentOptions();
  const [onlineChoice, setOnlineChoice] = useState("");
  const [onlineError, setOnlineError] = useState("");
  const [giftCardBalance, setGiftCardBalance] = useState(null); // { remaining, status } | null
  const [giftCardLookupBusy, setGiftCardLookupBusy] = useState(false);
  const [giftCardError, setGiftCardError] = useState("");

  const lookupGiftCardBalance = async () => {
    const code = giftCardCode.trim().toUpperCase();
    setGiftCardError("");
    setGiftCardBalance(null);
    if (!code) return;
    setGiftCardLookupBusy(true);
    try {
      let data;
      try {
        data = await api.get(`/api/gift-cards/${encodeURIComponent(code)}/balance`);
      } catch (err) {
        // Phase 2-G Wave 2 (2-G.2) — pre-printed flow: if the card
        // isn't in gift_cards yet, /balance returns 404. Attempt to
        // auto-activate from a registered range and then re-read the
        // balance. If no range matches, surface the original 404.
        if (err.status === 404) {
          try {
            await api.post(`/api/gift-cards/${encodeURIComponent(code)}/activate`, {});
            data = await api.get(`/api/gift-cards/${encodeURIComponent(code)}/balance`);
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }

      // If the card exists but is still flagged pre_printed (e.g. an
      // admin manually seeded it), activate it now so the cashier can
      // tender immediately.
      if (data.activation_status === "pre_printed") {
        try {
          await api.post(`/api/gift-cards/${encodeURIComponent(code)}/activate`, {});
          data = await api.get(`/api/gift-cards/${encodeURIComponent(code)}/balance`);
        } catch {
          // Leave status as-is; the cashier will see pre_printed in the UI.
        }
      }

      setGiftCardBalance({
        remaining: Number(data.remaining_value),
        status: data.activation_status,
      });
    } catch (err) {
      setGiftCardError(err.body?.error || "Gift card not found");
    } finally {
      setGiftCardLookupBusy(false);
    }
  };
  const customerLabel = labels.customer || "Customer";
  const roomManagementOn = hasMode && hasMode("room_management");
  const treatmentPlansOn = hasMode && hasMode("treatment_plans");

  const isOffline = !navigator.onLine;

  // B4 — Quick-create plan for walk-in clinical patients who don't have
  // an active plan yet. Skips the dashboard detour; plan is saved in draft
  // state, then the updated openTreatmentPlans list re-renders and the user
  // selects it from the charge-to-plan dropdown.
  const [quickPlanOpen, setQuickPlanOpen] = useState(false);
  const [quickPlanTitle, setQuickPlanTitle] = useState("");
  const [quickPlanSessions, setQuickPlanSessions] = useState("1");
  const [quickPlanNotes, setQuickPlanNotes] = useState("");
  const [quickPlanBusy, setQuickPlanBusy] = useState(false);
  const [quickPlanError, setQuickPlanError] = useState("");

  const submitQuickPlan = async () => {
    setQuickPlanError("");
    if (!quickPlanTitle.trim()) {
      setQuickPlanError("Plan title required");
      return;
    }
    setQuickPlanBusy(true);
    try {
      await api.post("/api/treatment-plans", {
        customer_id: Number(checkoutCustomerId),
        outlet_id: selectedOutletId ? Number(selectedOutletId) : null,
        title: quickPlanTitle.trim(),
        total_sessions_planned: Math.max(1, Number(quickPlanSessions) || 1),
        notes: quickPlanNotes || null,
      });
      // Refetch open plans so the new plan appears in the dropdown
      const r = await api.get("/api/treatment-plans", {
        customer_id: checkoutCustomerId,
        status: "active",
      });
      const plans = r.plans || [];
      // Newly-created plans start in "draft" status, not "active" — also pull drafts.
      const draftRes = await api.get("/api/treatment-plans", {
        customer_id: checkoutCustomerId,
        status: "draft",
      });
      setOpenTreatmentPlans([...(draftRes.plans || []), ...plans]);
      setQuickPlanOpen(false);
      setQuickPlanTitle("");
      setQuickPlanSessions("1");
      setQuickPlanNotes("");
    } catch (err) {
      setQuickPlanError(err.message || "Failed to create plan");
    } finally {
      setQuickPlanBusy(false);
    }
  };

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
    <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-3xl shadow-(--ui-shadow-lg) w-full max-w-lg flex flex-col border border-(--ui-border) max-h-[92vh]">
        <div className="px-6 py-4 border-b border-(--ui-border) flex items-center justify-between bg-(--ui-muted-surface) rounded-t-3xl shrink-0">
          <h2 className="text-lg font-bold text-(--ui-text) flex items-center gap-2">
            <Banknote className="text-(--ui-text)" size={20} /> Complete Payment
          </h2>
          <button
            onClick={() => setCheckoutOpen(false)}
            className="text-(--ui-text-muted) hover:text-(--ui-text) p-1.5 rounded-full hover:bg-(--ui-border-strong)"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Total due */}
          <div className="text-center bg-(--ui-muted-surface) border border-(--ui-border) rounded-2xl py-5">
            <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-widest mb-1">
              Total Due
            </p>
            <p className="text-4xl font-black text-(--ui-text)">
              {money(remaining)}
            </p>
          </div>

          {/* M9 — Charge to room (room_management mode only) */}
          {roomManagementOn && (
            <div>
              <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
                Charge to room (optional)
              </label>
              <select
                value={chargeToRoomFolioId || ""}
                onChange={(e) => setChargeToRoomFolioId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-medium border border-(--ui-border-strong) rounded-xl focus:outline-none focus:border-(--ui-focus)"
                disabled={openBookingsLoading}
              >
                <option value="">— Pay now (cash / card / etc.) —</option>
                {(openBookings || [])
                  .filter((b) => b.folio_id && b.folio_status === "open")
                  .map((b) => (
                    <option key={b.folio_id} value={b.folio_id}>
                      Room {b.room_number || "?"} — {b.customer_name || "Guest"} ({b.booking_number})
                    </option>
                  ))}
              </select>
              {chargeToRoomFolioId && (
                <p className="text-xs text-(--ui-text-muted) mt-1.5">
                  This sale will be added to the folio — no payment is collected now.
                </p>
              )}
            </div>
          )}

          {/* M10 — Charge to treatment plan (treatment_plans mode only). Shows
              the dropdown when open plans exist, or a quick-create button for
              walk-in patients with no active plan (B4 fallback). */}
          {treatmentPlansOn && checkoutCustomerId && (
            <div>
              <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
                Charge to treatment plan (optional)
              </label>
              {(openTreatmentPlans || []).length > 0 ? (
                <select
                  value={chargeToTreatmentFolioId || ""}
                  onChange={(e) => setChargeToTreatmentFolioId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-medium border border-(--ui-border-strong) rounded-xl focus:outline-none focus:border-(--ui-focus)"
                >
                  <option value="">— Pay now (cash / card / etc.) —</option>
                  {(openTreatmentPlans || [])
                    .filter((p) => p.folio_id)
                    .map((p) => (
                      <option key={p.id} value={p.folio_id}>
                        {p.plan_number} — {p.customer_name} ({p.sessions_completed || 0}/{p.total_sessions_planned})
                      </option>
                    ))}
                </select>
              ) : !quickPlanOpen ? (
                <button
                  type="button"
                  onClick={() => setQuickPlanOpen(true)}
                  className="w-full px-3 py-2.5 text-sm font-medium border border-dashed border-(--ui-border-strong) text-(--ui-text) rounded-xl hover:bg-(--ui-muted-surface) transition"
                >
                  <Plus size={14} className="inline mr-1" /> Create new treatment plan
                </button>
              ) : (
                <div className="space-y-2 p-3 rounded-xl border border-(--ui-border-strong) bg-(--ui-muted-surface)">
                  <input
                    type="text"
                    placeholder="Plan title (e.g. Root canal — upper molar)"
                    value={quickPlanTitle}
                    onChange={(e) => setQuickPlanTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:border-(--ui-focus)"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Sessions"
                      value={quickPlanSessions}
                      onChange={(e) => setQuickPlanSessions(e.target.value)}
                      className="w-24 px-3 py-2 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:border-(--ui-focus)"
                    />
                    <input
                      type="text"
                      placeholder="Notes (optional)"
                      value={quickPlanNotes}
                      onChange={(e) => setQuickPlanNotes(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-(--ui-border-strong) rounded-lg focus:outline-none focus:border-(--ui-focus)"
                    />
                  </div>
                  {quickPlanError && (
                    <p className="text-xs text-(--ui-danger-fg)">{quickPlanError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setQuickPlanOpen(false); setQuickPlanError(""); }}
                      className="px-3 py-1.5 text-xs font-medium text-(--ui-text-muted) hover:text-(--ui-text)"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitQuickPlan}
                      disabled={quickPlanBusy || !quickPlanTitle.trim()}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-(--ui-primary) rounded-lg hover:bg-(--ui-primary-strong) disabled:opacity-50"
                    >
                      {quickPlanBusy ? "Creating…" : "Create plan"}
                    </button>
                  </div>
                </div>
              )}
              {chargeToTreatmentFolioId && (
                <p className="text-xs text-(--ui-text-muted) mt-1.5">
                  This sale will be added to the plan folio — no payment is collected now.
                </p>
              )}
            </div>
          )}

          {/* One Toy Store F3b part 2 — staff bill: no customer, no points. */}
          {staffPurchase && (
            <div className="flex items-center gap-2 rounded-2xl border-2 border-(--ui-primary) bg-(--ui-muted-surface) px-4 py-3 text-sm font-bold text-(--ui-text)">
              <BadgeCheck size={16} /> Staff purchase at cost · {staffPurchase.name}
            </div>
          )}

          {/* Customer at checkout — quick search + create */}
          {!staffPurchase && <div>
            <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
              {customerLabel} (optional)
            </label>

            {checkoutCustomerId ? (
              <div className="flex items-center justify-between px-3 py-2.5 bg-(--ui-muted-surface) border border-(--ui-border-strong) rounded-xl">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-(--ui-text-muted) shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-(--ui-text)">
                      {checkoutCustSearch}
                    </span>
                    {loyaltyEnabled && checkoutCustomerTier?.name && (
                      <span className="inline-flex items-center gap-0.5 ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: (checkoutCustomerTier.color || "#101010") + "33", color: checkoutCustomerTier.color || "#101010" }}>
                        <Award size={9} />{checkoutCustomerTier.name}
                        {checkoutCustomerTier.multiplier > 1 && <span className="opacity-70">{checkoutCustomerTier.multiplier}x</span>}
                      </span>
                    )}
                    {customers.find(
                      (c) => String(c.id) === String(checkoutCustomerId),
                    )?.mobile && (
                      <span className="text-xs text-(--ui-text-muted) ml-2">
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
                  className="text-(--ui-text-muted) hover:text-(--ui-text) p-1 rounded-lg hover:bg-(--ui-border-strong) transition"
                >
                  <X size={14} />
                </button>
              </div>
            ) : custMode === "search" ? (
              <div className="border border-(--ui-border-strong) rounded-xl overflow-hidden">
                <div className="relative">
                  <User
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted) pointer-events-none"
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
                    className="w-full pl-8 pr-3 py-2.5 text-sm font-medium focus:outline-none border-b border-(--ui-border)"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto">
                  <div
                    onMouseDown={() => {
                      setCheckoutCustomerId("");
                      setCheckoutCustSearch("");
                      setShowCheckoutCustDD(false);
                    }}
                    className="px-3 py-2 text-(--ui-text-muted) text-xs font-semibold cursor-pointer hover:bg-(--ui-muted-surface) border-b border-(--ui-border)"
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
                      className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-(--ui-muted-surface) border-b border-(--ui-border) last:border-0"
                    >
                      <span className="font-bold text-sm text-(--ui-text)">
                        {c.name}
                      </span>
                      <span className="text-xs text-(--ui-text-muted)">
                        {c.mobile || ""}
                      </span>
                    </div>
                  ))}
                  {filteredCheckoutCustomers.length === 0 &&
                    checkoutCustSearch && (
                      <p className="text-xs text-(--ui-text-muted) text-center py-2">
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
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-(--ui-text) hover:bg-(--ui-muted-surface) border-t border-(--ui-border) transition"
                >
                  <Plus size={13} /> New Customer
                </button>
              </div>
            ) : (
              <div className="border-2 border-(--ui-border-strong) rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-(--ui-primary) flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wide">
                    New Customer
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCustMode("search");
                      setNewCustError("");
                    }}
                    className="text-white/70 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="p-3 space-y-2 bg-(--ui-surface)">
                  <input
                    type="text"
                    autoFocus
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    placeholder="Full name *"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:border-(--ui-focus) focus:outline-none"
                  />
                  <input
                    type="tel"
                    value={newCustMobile}
                    onChange={(e) => setNewCustMobile(e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:border-(--ui-focus) focus:outline-none"
                  />
                  {newCustError && (
                    <p className="text-xs text-(--ui-danger-fg) font-semibold">
                      {newCustError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleQuickCreateCustomer}
                    disabled={newCustSaving}
                    className="w-full py-2 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white text-sm font-bold rounded-lg transition disabled:opacity-50"
                  >
                    {newCustSaving ? "Saving…" : "Create & Attach to Sale"}
                  </button>
                </div>
              </div>
            )}
          </div>}

          {/* Loyalty & Wallet panel — shown only when a customer is selected
              AND the tenant has the Loyalty module on (phase2g_loyalty). */}
          {!staffPurchase && loyaltyEnabled && checkoutCustomerId && (
            <div className="rounded-2xl border border-(--ui-border) bg-(--ui-muted-surface) px-4 py-3 space-y-3">
              {/* Balance summary */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-(--ui-text) uppercase tracking-wide">
                  <Star size={13} className="text-(--ui-warning-fg)" />
                  Points & Wallet
                </div>
                {checkoutWalletLoading && (
                  <span className="text-xs text-(--ui-text-muted)">Loading…</span>
                )}
              </div>
              <div className="flex gap-3">
                <div className="flex-1 bg-(--ui-surface) rounded-xl px-3 py-2 text-center border border-(--ui-border)">
                  <p className="text-xs text-(--ui-text-muted) mb-0.5">Points</p>
                  <p className="text-lg font-black text-(--ui-text)">
                    {checkoutCustomerPoints}
                  </p>
                </div>
                <div className="flex-1 bg-(--ui-surface) rounded-xl px-3 py-2 text-center border border-(--ui-border)">
                  <p className="text-xs text-(--ui-text-muted) mb-0.5">Wallet</p>
                  <p className="text-lg font-black text-(--ui-success-fg)">
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
                      ? "border-(--ui-border-strong) bg-(--ui-muted-surface) text-(--ui-text-muted) cursor-not-allowed"
                      : redeemPointsOn
                        ? "border-(--ui-warning-fg) bg-(--ui-warning-bg) text-(--ui-warning-fg)"
                        : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text-muted) hover:border-(--ui-border-strong)"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Star size={14} className="text-(--ui-warning-fg)" />
                    Redeem {Math.floor(checkoutCustomerPoints / 100) * 100} pts
                    <span className="text-xs text-(--ui-text-muted) font-normal">
                      = {money(pointsDiscount)} off
                    </span>
                  </span>
                  {redeemPointsOn ? (
                    <ToggleRight size={20} className="text-(--ui-warning-fg)" />
                  ) : (
                    <ToggleLeft size={20} className="text-(--ui-text-muted)" />
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
                      ? "border-(--ui-border-strong) bg-(--ui-muted-surface) text-(--ui-text-muted) cursor-not-allowed"
                      : payWithWalletOn
                        ? "border-(--ui-success-fg) bg-(--ui-success-bg) text-(--ui-success-fg)"
                        : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text-muted) hover:border-(--ui-border-strong)"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Wallet size={14} className="text-(--ui-success-fg)" />
                    Pay with Wallet
                    <span className="text-xs text-(--ui-text-muted) font-normal">
                      ({money(checkoutWalletBalance)} available)
                    </span>
                  </span>
                  {payWithWalletOn ? (
                    <ToggleRight size={20} className="text-(--ui-success-fg)" />
                  ) : (
                    <ToggleLeft size={20} className="text-(--ui-text-muted)" />
                  )}
                </button>
              )}
            </div>
          )}

          {/* V04 salon — walk-in performed-by (blocking pick; no cashier default).
              Appointment checkouts stamp the stylist per line, so this only
              shows for walk-ins. Reuses serverId → sale_items.staff_id. */}
          {isSalonWalkIn && (
            <div className="space-y-2 rounded-2xl border-2 border-(--ui-border-strong) bg-(--ui-muted-surface) p-3">
              <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide">
                Performed by <span className="text-(--ui-danger-fg)">*</span>
              </label>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                className="w-full px-3 py-2 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-xl focus:border-(--ui-focus) focus:ring-0 outline-none text-sm font-medium"
              >
                <option value="">— Select stylist —</option>
                {(employeesList || []).map((e) => (
                  <option key={e.id} value={e.id}>{e.name || e.username || `Employee #${e.id}`}</option>
                ))}
              </select>
              <p className="text-[11px] text-(--ui-text-muted)">Attributes the sale to the stylist for commission — not the cashier.</p>
            </div>
          )}

          {/* Phase 2.1 C1 — Tip + Server (restaurant mode only) */}
          {restaurantOn && (
            <div className="space-y-3 rounded-2xl border border-(--ui-border) bg-(--ui-muted-surface) p-3">
              <div>
                <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
                  Tip
                </label>
                <div className="flex gap-2">
                  {[10, 15, 20].map((pct) => {
                    const amt = Number(((total || 0) * pct) / 100).toFixed(2);
                    const active = Number(tipAmount) === Number(amt) && Number(amt) > 0;
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setTipAmount(amt)}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                          active
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text) hover:border-(--ui-border-strong)"
                        }`}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    className="w-28 px-3 py-2 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-xl focus:border-(--ui-focus) focus:ring-0 outline-none text-sm font-semibold"
                    placeholder="Custom"
                  />
                  {Number(tipAmount) > 0 && (
                    <button
                      type="button"
                      onClick={() => setTipAmount("")}
                      className="px-2 text-xs text-(--ui-text-muted) hover:text-(--ui-danger)"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {Number(tipAmount) > 0 && (
                  <div className="mt-2 flex gap-2">
                    {["Cash", "Card", "Wallet"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTipMethod(m)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                          tipMethod === m
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text-muted) hover:border-(--ui-border-strong)"
                        }`}
                      >
                        Tip via {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
                  Server
                </label>
                <select
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  className="w-full px-3 py-2 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-xl focus:border-(--ui-focus) focus:ring-0 outline-none text-sm font-medium"
                >
                  <option value="">— Not assigned —</option>
                  {(employeesList || []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name || e.username || `Employee #${e.id}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phase 2-R.0 Day 8 — Hand to guest opens RestaurantGuestModeModal,
                  which writes tip + signature back through POSContext and then
                  closes itself so the operator completes the sale. */}
              <button
                type="button"
                onClick={() => setShowGuestMode?.(true)}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2 transition ${
                  signatureSvg
                    ? "border-(--ui-success-fg) bg-(--ui-success-bg) text-(--ui-success-fg) hover:bg-(--ui-success-bg)"
                    : "border-(--ui-primary) bg-(--ui-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                }`}
              >
                <PenLine size={15} />
                {signatureSvg ? "Signature captured — tap to re-sign" : "Hand to guest"}
              </button>
            </div>
          )}

          {/* Payment method */}
          <div>
            <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
              Payment Method
            </label>
            {(() => {
              // F3b part 2: a staff bill is paid Cash, Online or Cut from salary.
              const methods = staffPurchase ? [
                { id: "Cash", icon: <Banknote size={16} /> },
                { id: "Online", icon: <Smartphone size={16} /> },
                { id: CUT_FROM_SALARY, icon: <BadgeCheck size={16} /> },
              ] : [
                { id: "Cash", icon: <Banknote size={16} /> },
                { id: "Card", icon: <CreditCard size={16} /> },
                { id: "Online", icon: <Smartphone size={16} /> },
                { id: "Wallet", icon: <Wallet size={16} /> },
                ...(giftCardsOn
                  ? [{ id: "gift_card", label: "Gift Card", icon: <Gift size={16} /> }]
                  : []),
                ...(creditTenderOn
                  ? [{ id: "Credit", label: "On Account", icon: <Receipt size={16} />, requiresCustomer: true }]
                  : []),
              ];
              const colClass =
                methods.length >= 6 ? "grid-cols-3"
                  : methods.length === 5 ? "grid-cols-5"
                  : methods.length === 4 ? "grid-cols-4"
                  : "grid-cols-3";
              return (
                <div className={`grid ${colClass} gap-2`}>
                  {methods.map(({ id, label, icon, requiresCustomer }) => {
                    const disabled = requiresCustomer && !checkoutCustomerId;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={disabled}
                        title={disabled ? "Select a customer to use On Account" : undefined}
                        onClick={() => {
                          if (disabled) return;
                          setPaymentMethod(id);
                          // Cash: empty; Card / Online / others: exact amount due.
                          setPaymentAmount(startAmount(id, remaining));
                          setOnlineChoice("");
                          setOnlineError("");
                          if (id !== "gift_card") {
                            setGiftCardCode("");
                            setGiftCardBalance(null);
                            setGiftCardError("");
                          }
                        }}
                        className={`py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold text-sm transition border-2 ${
                          disabled
                            ? "border-(--ui-border) bg-(--ui-muted-surface) text-(--ui-text-muted) cursor-not-allowed"
                            : paymentMethod === id
                            ? "border-(--ui-primary) bg-(--ui-muted-surface) text-(--ui-text)"
                            : "border-(--ui-border) bg-(--ui-surface) hover:border-(--ui-border-strong) text-(--ui-text-muted)"
                        }`}
                      >
                        {icon} {label || id}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {paymentMethod === "Online" && (
              <div className="mt-3 p-3 bg-(--ui-surface) border border-(--ui-border-strong) rounded-xl space-y-2">
                <label className="block text-[11px] font-bold text-(--ui-text-muted) uppercase tracking-wide">
                  Paid by
                </label>
                <div className="flex flex-wrap gap-2">
                  {onlineOptions.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      tone={onlineChoice === choice ? "primary" : "default"}
                      onClick={() => {
                        setOnlineChoice(choice);
                        setOnlineError("");
                        payAmountRef?.current?.focus();
                      }}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
                {onlineError && (
                  <div className="text-sm px-3 py-2 rounded-lg bg-(--ui-danger-bg) text-(--ui-danger-fg) border border-(--ui-danger-fg)/30">
                    {onlineError}
                  </div>
                )}
              </div>
            )}

            {paymentMethod === "gift_card" && (
              <div className="mt-3 p-3 bg-(--ui-muted-surface) border border-(--ui-border-strong) rounded-xl space-y-2">
                <label className="block text-[11px] font-bold text-(--ui-text-muted) uppercase tracking-wide">
                  Gift Card Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardCode}
                    onChange={(e) => {
                      setGiftCardCode(e.target.value);
                      setGiftCardBalance(null);
                      setGiftCardError("");
                    }}
                    placeholder="Scan or paste code"
                    className="flex-1 px-3 py-2 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-lg focus:border-(--ui-focus) outline-none font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={lookupGiftCardBalance}
                    disabled={giftCardLookupBusy || !giftCardCode.trim()}
                    className="bg-(--ui-primary) text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-(--ui-primary-strong) disabled:opacity-30 transition"
                  >
                    {giftCardLookupBusy ? "…" : "Check"}
                  </button>
                </div>
                {giftCardBalance && (
                  <div
                    className={`text-sm px-3 py-2 rounded-lg ${
                      giftCardBalance.status === "active"
                        ? "bg-(--ui-success-bg) text-(--ui-success-fg) border border-(--ui-success-fg)/30"
                        : "bg-(--ui-warning-bg) text-(--ui-warning-fg) border border-(--ui-warning-fg)/30"
                    }`}
                  >
                    Balance: <strong>{money(giftCardBalance.remaining)}</strong>
                    {" "}· {giftCardBalance.status}
                  </div>
                )}
                {giftCardError && (
                  <div className="text-sm px-3 py-2 rounded-lg bg-(--ui-danger-bg) text-(--ui-danger-fg) border border-(--ui-danger-fg)/30">
                    {giftCardError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount */}
          <form
            onSubmit={(e) => {
              // Phase 2-G Wave 2: when tendering a gift card, force a
              // balance lookup + attach the code to the payment entry.
              if (paymentMethod === "gift_card") {
                e.preventDefault();
                const code = giftCardCode.trim().toUpperCase();
                const amt = Number(paymentAmount);
                if (!code) {
                  setGiftCardError("Enter a gift card code first");
                  return;
                }
                if (!amt || amt <= 0) return;
                if (giftCardBalance && amt > giftCardBalance.remaining) {
                  setGiftCardError(
                    `Amount exceeds remaining balance (${money(giftCardBalance.remaining)})`,
                  );
                  return;
                }
                addPayment(null, { code });
                // Reset code-side state so the next tender lookup is fresh.
                setGiftCardCode("");
                setGiftCardBalance(null);
                setGiftCardError("");
                return;
              }
              if (paymentMethod === CUT_FROM_SALARY) {
                // Onto the staff account: no money, so never more than is due.
                e.preventDefault();
                const amt = Math.min(Number(paymentAmount), remaining);
                if (!amt || amt <= 0) return;
                addPayment(null, { method: CUT_FROM_SALARY, amount: amt });
                return;
              }
              if (paymentMethod === "Online") {
                e.preventDefault();
                if (!onlineChoice) {
                  setOnlineError("Tap how the customer paid first");
                  return;
                }
                // D59: book what the customer sent; any extra is Change Due
                // from the drawer (saved as a Cash minus line).
                const amt = onlineTender(paymentAmount);
                if (!amt || amt <= 0) return;
                addPayment(null, { method: onlineMethodName(onlineChoice), amount: amt });
                return;
              }
              addPayment(e);
            }}
          >
            <label className="block text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-2">
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
                className="flex-1 px-4 py-3 bg-(--ui-surface) border-2 border-(--ui-border-strong) rounded-xl focus:border-(--ui-focus) focus:ring-0 outline-none text-lg font-bold"
                placeholder="0.00"
              />
              <button
                type="submit"
                disabled={!paymentAmount || Number(paymentAmount) <= 0}
                className="bg-(--ui-primary) text-white px-6 py-2 rounded-xl font-bold hover:bg-(--ui-primary-strong) disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Add
              </button>
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <button
                type="button"
                onClick={() => setPaymentAmount(remaining.toFixed(2))}
                className="px-2.5 py-1 bg-(--ui-success-bg) hover:bg-(--ui-success-bg) text-(--ui-success-fg) border border-(--ui-success-fg)/30 rounded-lg text-xs font-bold transition"
              >
                Exact
              </button>
              {/* Each note adds to the box: 5000 then 500 = 5,500. */}
              {NOTE_BUTTONS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setPaymentAmount(addNote(paymentAmount, amt))}
                  className="px-2.5 py-1 bg-(--ui-muted-surface) hover:bg-(--ui-muted-surface) text-(--ui-text-muted) border border-(--ui-border-strong) rounded-lg text-xs font-bold transition"
                >
                  {amt}
                </button>
              ))}
              <Button type="button" size="sm" onClick={() => setPaymentAmount("")}>
                Clear
              </Button>
            </div>
          </form>

          {/* Tenders */}
          {payments.length > 0 && (
            <div className="border-t border-(--ui-border) pt-4">
              <p className="text-xs font-bold text-(--ui-text-muted) uppercase tracking-wide mb-3">
                Tenders
              </p>
              <div className="space-y-2">
                {payments.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 bg-(--ui-muted-surface) border border-(--ui-border) rounded-xl"
                  >
                    <div className="flex items-center gap-2 text-sm font-bold text-(--ui-text)">
                      {p.method === "Cash" ? (
                        <Banknote size={14} className="text-(--ui-text-muted)" />
                      ) : p.method === "Wallet" ? (
                        <Wallet size={14} className="text-(--ui-text-muted)" />
                      ) : isOnlineMethod(p.method) ? (
                        <Smartphone size={14} className="text-(--ui-text-muted)" />
                      ) : p.method === CUT_FROM_SALARY ? (
                        <BadgeCheck size={14} className="text-(--ui-text-muted)" />
                      ) : (
                        <CreditCard size={14} className="text-(--ui-text-muted)" />
                      )}
                      {p.method}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-black text-(--ui-text) text-sm">
                        {money(p.amount)}
                      </span>
                      <button
                        onClick={() =>
                          setPayments((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="text-(--ui-text-muted) hover:text-(--ui-danger) hover:bg-(--ui-danger-bg) p-1 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {change > 0 && (
                <div className="mt-3 flex justify-between items-center text-sm font-bold text-(--ui-success-fg) bg-(--ui-success-bg) border border-(--ui-success-fg)/20 rounded-xl px-3 py-2">
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
                ? "bg-(--ui-muted-surface) text-(--ui-text-muted) cursor-not-allowed"
                : "bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white hover:scale-[1.01]"
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
