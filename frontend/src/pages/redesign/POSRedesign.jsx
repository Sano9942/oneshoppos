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
import POSReturnExchangeModal from "./pos/POSReturnExchangeModal";
import POSSessionExpiredModal from "./pos/POSSessionExpiredModal";
import POSShortcutsOverlay from "./pos/POSShortcutsOverlay";
import EndlessAisleModal from "./pos/EndlessAisleModal";
import { ErrorBoundary } from "../../ui/ErrorBoundary";

const MOBILE_TABS = [
  { key: "cart", label: "Cart", icon: ShoppingCart },
  { key: "search", label: "Search", icon: SearchIcon },
  { key: "pay", label: "Pay", icon: CreditCard },
];

function POSContent() {
  const { isLocked, notice, error, cart, total, money, openCheckout, offlineQueueCount, offlineSyncing, offlineSyncResult, syncQueue, posLayout, suggestions, addToCart } = usePOS();
  const [activeTab, setActiveTab] = useState("cart");

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
            {offlineQueueCount} sale(s) queued offline — will sync automatically
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
      {/* Sync success banner */}
      {offlineSyncResult && (
        <div className="fixed top-0 left-0 right-0 z-60 flex items-center justify-center px-4 py-2.5 bg-emerald-500 text-white text-sm font-medium shadow-lg animate-in fade-in slide-in-from-top-4 duration-300">
          {offlineSyncResult.synced} sale(s) synced successfully
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
      <POSReturnExchangeModal />
      <POSSessionExpiredModal />
      <EndlessAisleModal />
      <POSShortcutsOverlay />
    </div>
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
