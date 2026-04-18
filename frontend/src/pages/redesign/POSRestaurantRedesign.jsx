import { useState } from "react";
import { POSProvider, usePOS } from "./pos/POSContext";
import { ErrorBoundary } from "../../ui/ErrorBoundary";
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
import POSReturnExchangeModal from "./pos/POSReturnExchangeModal";
import POSSessionExpiredModal from "./pos/POSSessionExpiredModal";
import POSShortcutsOverlay from "./pos/POSShortcutsOverlay";
import EndlessAisleModal from "./pos/EndlessAisleModal";
import RestaurantFloorGrid from "./pos/restaurant/RestaurantFloorGrid";
import RestaurantCheckView from "./pos/restaurant/RestaurantCheckView";

// Phase 2-R.0 — Restaurant POS shell at /pos/restaurant.
// Composition only: wraps POSContent with POSProvider + ErrorBoundary,
// renders the floor grid or the check view based on local view state, and
// mounts every existing POS modal so the restaurant flow inherits the
// retail POS opening gate / lock / checkout / receipt / session-expired UX.
function RestaurantContent() {
  const { isLocked, notice, error, closeCheck } = usePOS();
  const [view, setView] = useState("floor");

  if (isLocked) return <POSLockScreen />;

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] overflow-hidden font-sans">
      {/* Notice / error banners (mirror POSRedesign) */}
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

      <div className="flex-1 overflow-hidden">
        {view === "floor" ? (
          <RestaurantFloorGrid onOpenCheck={() => setView("check")} />
        ) : (
          <RestaurantCheckView
            onExit={() => {
              closeCheck();
              setView("floor");
            }}
          />
        )}
      </div>

      {/* Modals — mirrored from POSRedesign so every flow remains identical */}
      <POSDiscountModal />
      <POSNoteModal />
      <POSParkedModal />
      <POSOpeningGateModal />
      <POSCloseShiftModal />
      <POSCheckoutModal />
      <POSModifierModal />
      <POSReceiptModal />
      <POSRecentSalesPanel />
      <POSReturnExchangeModal />
      <POSSessionExpiredModal />
      <EndlessAisleModal />
      <POSShortcutsOverlay />
    </div>
  );
}

export default function POSRestaurantRedesign() {
  return (
    <POSProvider>
      <ErrorBoundary level="page">
        <RestaurantContent />
      </ErrorBoundary>
    </POSProvider>
  );
}
