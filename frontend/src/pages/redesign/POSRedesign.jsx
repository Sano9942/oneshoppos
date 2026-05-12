import React, { useState } from "react";
import { ShoppingCart, Search as SearchIcon, CreditCard, WifiOff, RefreshCw } from "lucide-react";
import { POSProvider, usePOS } from "./pos/POSContext";
import POSHeader from "./pos/POSHeader";
import POSSubHeader from "./pos/POSSubHeader";
import POSSearchArea from "./pos/POSSearchArea";
import POSCartTable from "./pos/POSCartTable";
import POSSidebar from "./pos/POSSidebar";
import POSLockScreen from "./pos/POSLockScreen";
import POSDiscountModal from "./pos/POSDiscountModal";
import POSNoteModal from "./pos/POSNoteModal";
import POSParkedModal from "./pos/POSParkedModal";
import POSCheckoutModal from "./pos/POSCheckoutModal";
import POSModifierModal from "./pos/POSModifierModal";
import POSReceiptModal from "./pos/POSReceiptModal";
import POSOpeningGateModal from "./pos/POSOpeningGateModal";
import POSCloseShiftModal from "./pos/POSCloseShiftModal";
import POSRecentSalesPanel from "./pos/POSRecentSalesPanel";
import POSPriceOverrideModal from "./pos/POSPriceOverrideModal";
import POSVariantMatrixModal from "./pos/POSVariantMatrixModal";
import POSSerialEntryModal from "./pos/POSSerialEntryModal";
import POSReturnExchangeModal from "./pos/POSReturnExchangeModal";
import POSHoldCreateModal from "./pos/POSHoldCreateModal";
import POSHoldPickupModal from "./pos/POSHoldPickupModal";
import POSSessionExpiredModal from "./pos/POSSessionExpiredModal";
import POSShortcutsOverlay from "./pos/POSShortcutsOverlay";
import POSReceiptRetryModal from "./pos/POSReceiptRetryModal";
import POSShiftRecoveryModal from "./pos/POSShiftRecoveryModal";
import POSCartCollisionModal from "./pos/POSCartCollisionModal";
import POSCartResumeModal from "./pos/POSCartResumeModal";
import POSBarcodeMissModal from "./pos/POSBarcodeMissModal";
import POSInsufficientStockModal from "./pos/POSInsufficientStockModal";
import POSCreditLimitModal from "./pos/POSCreditLimitModal";
import EndlessAisleModal from "./pos/EndlessAisleModal";
import { ErrorBoundary } from "../../ui/ErrorBoundary";

const MOBILE_TABS = [
  { key: "cart", label: "Cart", icon: ShoppingCart },
  { key: "search", label: "Search", icon: SearchIcon },
  { key: "pay", label: "Pay", icon: CreditCard },
];

// Bucket F: banner label respects type-split so users know whether their
// queue contains refunds as well as sales. `queuedSalesCount`/`queuedReturnsCount`
// are optional so older tests / external callers without Bucket F still render.
// Status bar shortcut chip. Black "F-key" pill + label, clickable.
// Mirrors the style of cashier-facing POSes like Lightspeed Retail.
function ShortcutHint({ k, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 hover:bg-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">{k}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

function ShortcutSep() {
  return <span className="shrink-0 select-none text-slate-300">·</span>;
}

function offlineBannerLabel({ offlineQueueCount, queuedSalesCount, queuedReturnsCount }) {
  const s = Number(queuedSalesCount || 0);
  const r = Number(queuedReturnsCount || 0);
  if (s && r) return `${s} sale(s) + ${r} refund(s) queued offline — will sync automatically`;
  if (r && !s) return `${r} refund(s) queued offline — will sync automatically`;
  // Default (sales-only or untyped legacy rows) — preserve the original wording.
  return `${offlineQueueCount} sale(s) queued offline — will sync automatically`;
}

function POSContent() {
  const {
    isLocked, notice, error, cart, total, money, openCheckout,
    offlineQueueCount, queuedSalesCount, queuedReturnsCount,
    offlineSyncing, offlineSyncResult, syncQueue,
    posLayout, suggestions, addToCart,
    parkSale, setShowParked, setShowShortcutsOverlay,
    setShowDiscountModal, removeFromCart, setCart,
  } = usePOS();
  const [activeTab, setActiveTab] = useState("cart");

  const focusOmni = () => {
    const el = document.querySelector(
      '[placeholder*="Scan, search"], [placeholder*="search products"]',
    );
    if (el && typeof el.focus === "function") el.focus();
  };
  const focusCustomerSearch = () => {
    const el = document.querySelector('[data-pos-customer-search]');
    if (el && typeof el.focus === "function") el.focus();
  };
  const removeLastLine = () => {
    if (!cart.length) return;
    removeFromCart(cart[cart.length - 1].id);
  };
  const clearCart = () => {
    if (!cart.length) return;
    if (window.confirm("Clear entire cart?")) setCart([]);
  };
  const cartEmpty = cart.length === 0;

  if (isLocked) {
    return <POSLockScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] overflow-hidden font-sans">
      {/* Offline queue banner */}
      {offlineQueueCount > 0 && (
        <div className="fixed top-0 left-0 right-0 z-60 flex items-center justify-between px-4 py-2.5 bg-amber-500 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          <span className="flex items-center gap-2">
            <WifiOff size={16} />
            {offlineBannerLabel({ offlineQueueCount, queuedSalesCount, queuedReturnsCount })}
          </span>
          <button
            onClick={syncQueue}
            disabled={offlineSyncing}
            className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            <RefreshCw size={12} className={offlineSyncing ? "animate-spin" : ""} />
            {offlineSyncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      )}
      {/* Sync success banner — Bucket F: use the richer message from the hook. */}
      {offlineSyncResult && (
        <div className="fixed top-0 left-0 right-0 z-60 flex items-center justify-center px-4 py-2.5 bg-emerald-500 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          {offlineSyncResult.sales && offlineSyncResult.returns
            ? `${offlineSyncResult.sales} sale(s) + ${offlineSyncResult.returns} refund(s) synced`
            : offlineSyncResult.returns
              ? `${offlineSyncResult.returns} refund(s) synced successfully`
              : `${offlineSyncResult.sales || offlineSyncResult.synced} sale(s) synced successfully`}
        </div>
      )}
      {/* Notifications */}
      {notice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-60 bg-slate-900/90 text-white px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-sm font-bold tracking-tight">{notice}</span>
        </div>
      )}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-60 bg-rose-600 text-white px-6 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <span className="text-sm font-bold tracking-tight">{error}</span>
        </div>
      )}

      {/* Header */}
      <POSHeader />

      {/* Desktop layout — unchanged */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <POSSubHeader />
          <POSSearchArea />
          {/* POS Layout Tiles (Phase 2B) */}
          {posLayout?.layout_json?.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {posLayout.layout_json.map((tile, i) => (
                <button key={tile.id || i}
                  className={`rounded-lg p-2 text-white text-center text-xs font-medium hover:opacity-80 transition ${tile.size === "2x1" ? "col-span-2" : ""}`}
                  style={{ backgroundColor: tile.color || "#8066FF" }}
                  onClick={() => {
                    if (tile.type === "product" && tile.product_id) addToCart({ id: tile.product_id, name: tile.label });
                  }}>
                  {tile.label || tile.type}
                </button>
              ))}
            </div>
          )}
          <POSCartTable />
          {/* Item Suggestions (Phase 2B) */}
          {suggestions.length > 0 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {suggestions.slice(0, 4).map(s => (
                <button key={s.product_id}
                  onClick={() => addToCart({ id: s.product_id, name: s.name, price: Number(s.price) })}
                  className="shrink-0 bg-slate-700 hover:bg-slate-600 rounded-lg p-2 text-xs text-white text-center w-28">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="text-slate-300 mt-0.5">{Number(s.price).toFixed(2)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <POSSidebar />
      </div>

      {/* Mobile layout — tab-driven */}
      <div className="flex md:hidden flex-col flex-1 overflow-hidden">
        {/* Mobile tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "cart" && (
            <div className="flex flex-col p-3 gap-2 h-full">
              <POSSubHeader />
              <POSCartTable />
            </div>
          )}
          {activeTab === "search" && (
            <div className="flex flex-col p-3 gap-2">
              <POSSearchArea />
            </div>
          )}
          {activeTab === "pay" && (
            <POSSidebar mobile />
          )}
        </div>

        {/* Mobile sticky pay button — visible on cart and search tabs */}
        {activeTab !== "pay" && cart.length > 0 && (
          <div className="shrink-0 p-3 border-t border-slate-200 bg-white">
            <button
              onClick={openCheckout}
              className="w-full py-3.5 rounded-xl font-black text-base flex items-center justify-between px-5 bg-[#8066FF] hover:bg-[#7055E6] shadow-[0_10px_20px_-10px_rgba(128,102,255,0.6)] text-white transition-all"
            >
              <span className="border-r border-white/20 pr-4 tracking-wide">Pay</span>
              <span className="pl-2 flex-1 text-right tracking-tight">{money(total)}</span>
            </button>
          </div>
        )}

        {/* Mobile tab bar */}
        <div className="shrink-0 flex items-center border-t border-slate-200 bg-white">
          {MOBILE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`relative flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-bold transition ${
                activeTab === key
                  ? "text-[#8066FF]"
                  : "text-slate-400"
              }`}
            >
              <Icon size={20} />
              <span>{label}</span>
              {key === "cart" && cart.length > 0 && (
                <span className="absolute -mt-1 ml-5 bg-[#8066FF] text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                  {cart.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop-only status bar — clickable shortcut hints. Mobile gets the
          bottom tab bar instead, so this is hidden under md. Style matches
          POS's slate/violet hardcoded palette (NOT design-system tokens).
          Spans the full POS width (under both the cart column and the dark
          sidebar) so it reads as a unified app footer, not a column hint. */}
      <div className="hidden md:flex shrink-0 items-center gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
        <ShortcutHint k="F1" label="Help" onClick={() => setShowShortcutsOverlay((v) => !v)} />
        <ShortcutSep />
        <ShortcutHint k="F2" label="Discount" disabled={cartEmpty} onClick={() => setShowDiscountModal(true)} />
        <ShortcutSep />
        <ShortcutHint k="F3" label="Park" disabled={cartEmpty} onClick={parkSale} />
        <ShortcutSep />
        <ShortcutHint k="F4" label="Customer" onClick={focusCustomerSearch} />
        <ShortcutSep />
        <ShortcutHint k="F5" label="Parked" onClick={() => setShowParked(true)} />
        <ShortcutSep />
        <ShortcutHint k="F8" label="Remove" disabled={cartEmpty} onClick={removeLastLine} />
        <ShortcutSep />
        <ShortcutHint k="F9" label="Pay" disabled={cartEmpty} onClick={openCheckout} />
        <ShortcutSep />
        <ShortcutHint k="F10" label="Clear" disabled={cartEmpty} onClick={clearCart} />
        <ShortcutSep />
        <ShortcutHint k="/" label="Search" onClick={focusOmni} />
      </div>

      {/* Modals */}
      <POSDiscountModal />
      <POSNoteModal />
      <POSParkedModal />
      <POSOpeningGateModal />
      <POSCloseShiftModal />
      <POSCheckoutModal />
      <POSModifierModal />
      <POSReceiptModal />
      <POSRecentSalesPanel />
      <POSPriceOverrideModal />
      <POSVariantMatrixModal />
      <POSSerialEntryModal />
      <POSReturnExchangeModal />
      <POSHoldCreateModal />
      <POSHoldPickupModal />
      <POSSessionExpiredModal />
      <EndlessAisleModal />
      <POSShortcutsOverlay />
      <POSErrorStateModals />
    </div>
  );
}

// 2-G.15 Day 2 — the receipt retry + shift recovery modals need context
// values piped in as props (same pattern as POSApprovalModal /
// POSEmailReceiptModal). Keeping them in a dedicated sub-component avoids
// threading a dozen usePOS() values into POSContent itself.
function POSErrorStateModals() {
  const {
    receiptRetryPrompt, dismissReceiptRetry,
    receiptTemplate, presetLabels, currencySymbol,
    shiftRecoveryOpen, setShiftRecoveryOpen, setShiftRecoveryDismissed,
    activeShift, setCloseShiftOpen, money,
    collisionModal, setCollisionModal,
    cartResumePrompt, resumeCartFromCheckpoint, discardCartCheckpoint,
    barcodeMissPrompt, setBarcodeMissPrompt,
    insufficientStockPrompt, setInsufficientStockPrompt,
    creditLimitPrompt, setCreditLimitPrompt,
    retryWithManagerPin, cancelCreditOverride,
    submitting,
    addToCart, setQty,
  } = usePOS();
  const [creditPinError, setCreditPinError] = useState("");

  return (
    <>
      <POSReceiptRetryModal
        open={!!receiptRetryPrompt}
        slip={receiptRetryPrompt?.slip}
        template={receiptTemplate}
        labels={presetLabels}
        currencySymbol={currencySymbol}
        error={receiptRetryPrompt?.error}
        onClose={dismissReceiptRetry}
      />

      <POSShiftRecoveryModal
        open={shiftRecoveryOpen}
        shift={activeShift}
        money={money}
        onCloseNow={() => {
          setShiftRecoveryOpen(false);
          setShiftRecoveryDismissed(true);
          setCloseShiftOpen(true);
        }}
        onQuickClose={() => {
          // Same trigger — POSCloseShiftModal collects the close details.
          // The "quick" framing is a UX hint; the actual close still goes
          // through the normal modal for safety.
          setShiftRecoveryOpen(false);
          setShiftRecoveryDismissed(true);
          setCloseShiftOpen(true);
        }}
        onKeepOpen={() => {
          setShiftRecoveryOpen(false);
          setShiftRecoveryDismissed(true);
        }}
      />

      <POSCartCollisionModal
        open={!!collisionModal}
        existing={collisionModal?.existing}
        currencySymbol={currencySymbol}
        onClose={() => setCollisionModal(null)}
      />

      <POSCartResumeModal
        open={!!cartResumePrompt}
        checkpoint={cartResumePrompt}
        currencySymbol={currencySymbol}
        onResume={resumeCartFromCheckpoint}
        onDiscard={discardCartCheckpoint}
      />

      <POSBarcodeMissModal
        open={!!barcodeMissPrompt}
        barcode={barcodeMissPrompt?.barcode}
        currencySymbol={currencySymbol}
        onCreated={(product) => addToCart?.(product)}
        onClose={() => setBarcodeMissPrompt(null)}
      />

      <POSInsufficientStockModal
        open={!!insufficientStockPrompt}
        prompt={insufficientStockPrompt}
        canOverride={false}
        onAdjust={(productId, _variantId, available) => setQty?.(productId, available)}
        onClose={() => setInsufficientStockPrompt(null)}
      />

      <POSCreditLimitModal
        open={!!creditLimitPrompt}
        prompt={creditLimitPrompt}
        currency={currencySymbol}
        error={creditPinError}
        loading={submitting}
        onSubmit={async (pin) => {
          setCreditPinError("");
          const result = await retryWithManagerPin?.(pin);
          if (result?.ok) {
            setCreditLimitPrompt(null);
          } else {
            setCreditPinError(result?.error || "Manager PIN verification failed");
          }
        }}
        onClose={() => {
          cancelCreditOverride?.();
          setCreditLimitPrompt(null);
          setCreditPinError("");
        }}
      />
    </>
  );
}

export default function POSRedesign() {
  return (
    <POSProvider>
      <ErrorBoundary>
        <POSContent />
      </ErrorBoundary>
    </POSProvider>
  );
}
