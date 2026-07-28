import { useState, useEffect, useRef } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { POSProvider, usePOS } from "./pos/POSContext";
import { api } from "../../api";
import { usePreset } from "../../contexts/PresetContext";
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
import SplitCheckModal from "./pos/restaurant/SplitCheckModal";
import TransferTableModal from "./pos/restaurant/TransferTableModal";
import RestaurantGuestModeModal from "./pos/restaurant/RestaurantGuestModeModal";
import RestaurantAvailabilityModal from "./pos/restaurant/RestaurantAvailabilityModal";
import VoidCompModal from "./pos/restaurant/VoidCompModal";
import PayAtTableQRModal from "./pos/restaurant/PayAtTableQRModal";

// Phase 2-R.0 — Restaurant POS shell at /pos/restaurant.
// Composition only: wraps POSContent with POSProvider + ErrorBoundary,
// renders the floor grid or the check view based on local view state, and
// mounts every existing POS modal so the restaurant flow inherits the
// retail POS opening gate / lock / checkout / receipt / session-expired UX.
function RestaurantContent() {
  const { isLocked, notice, error, closeCheck, openCheck, setCart, money } = usePOS();
  const [view, setView] = useState("floor");
  const [splitOpen, setSplitOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [voidCompState, setVoidCompState] = useState({ open: false, tab: "void" });
  const [payAtTable, setPayAtTable] = useState({ open: false, draftOrderId: null });

  // W23 — when navigated here from /restaurant/checks "Pay this check"
  // action, location.state carries { resumeCheck: { draftOrderId, ... } }.
  // Resume by calling openCheck() with the row's payload, fetching the
  // specific draft's items so the cart shows what the cashier is paying for,
  // and flipping the view to "check". One-shot: clear location.state after
  // consuming so a back-navigation (or accidental remount) doesn't re-fire.
  // Cart rehydrate mirrors the W16 pattern in RestaurantFloorGrid but
  // targets a specific draftOrderId instead of resolving via tableSessionId
  // (split children share session_id with their parent — we need *this* one).
  const location = useLocation();
  const navigate = useNavigate();
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current) return;
    const resume = location.state?.resumeCheck;
    if (!resume?.draftOrderId) return;
    consumedRef.current = true;
    openCheck({
      context: resume.orderContext || "dine_in",
      tableSessionId: resume.tableSessionId || null,
      tableLabel: resume.tableLabel || null,
      draftOrderId: resume.draftOrderId,
      seatCount: resume.seatCount || 0,
    });
    setView("check");
    // Best-effort cart rehydrate from the draft's items. If this fails the
    // cashier sees an empty cart but Pay still works against the draft id.
    (async () => {
      try {
        const detail = await api.get(`/api/draft-orders/${resume.draftOrderId}`);
        const items = detail?.items || [];
        if (items.length) {
          setCart(items.map((it) => ({
            id: it.product_id,
            variant_id: it.variant_id || null,
            name: it.product_name,
            price: Number(it.price),
            originalPrice: Number(it.price),
            quantity: Number(it.quantity),
            seat_number: it.seat_number ?? null,
            course_name: it.course_name || "main",
            kitchen_status: it.kitchen_status || "pending",
            availableStock: 99999,
          })));
        }
      } catch { /* silent — empty cart is the safe default */ }
    })();
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLocked) return <POSLockScreen />;

  return (
    <div className="flex flex-col h-screen bg-(--ui-bg) overflow-hidden font-sans">
      {/* Notice / error banners (mirror POSRedesign) */}
      {notice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-60 bg-(--ui-primary)/95 text-white px-6 py-3 rounded-2xl backdrop-blur-md border border-white/10 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="w-2 h-2 rounded-full bg-white/80 animate-pulse" />
          <span className="text-sm font-bold tracking-tight">{notice}</span>
        </div>
      )}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-60 bg-(--ui-danger) text-white px-6 py-3 rounded-2xl border border-white/10 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
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
            onOpenSplit={() => setSplitOpen(true)}
            onOpenTransfer={() => setTransferOpen(true)}
            onOpen86={() => setAvailabilityOpen(true)}
            onOpenVoidComp={(tab) => setVoidCompState({ open: true, tab: tab || "void" })}
            onOpenPayAtTable={(draftOrderId) => setPayAtTable({ open: true, draftOrderId })}
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

      {/* Phase 2-R.0 Day 6 + 8 — restaurant-only modals */}
      <SplitCheckModal
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        onSplitComplete={() => {
          closeCheck();
          setView("floor");
        }}
      />
      <TransferTableModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onTransferred={() => { /* poll loop picks up the new table_id */ }}
      />
      <RestaurantGuestModeModal />

      {/* 2-R.1 — 86'd items modal */}
      <RestaurantAvailabilityModal
        open={availabilityOpen}
        onClose={() => setAvailabilityOpen(false)}
      />

      {/* 2-R.2 — Void/Comp modal; opens with no saleItemId from the POS
         overflow so the modal itself explains that committed sales are
         needed. Check-detail page wires saleItemId directly. */}
      <VoidCompModal
        open={voidCompState.open}
        initialTab={voidCompState.tab}
        onClose={() => setVoidCompState({ open: false, tab: "void" })}
        onSuccess={() => setVoidCompState({ open: false, tab: "void" })}
      />

      {/* 2-R.3 — QR pay-at-table. Auto-closes on payment success so the
         cashier can hand off the table to busser without clicking through. */}
      <PayAtTableQRModal
        open={payAtTable.open}
        onClose={() => setPayAtTable({ open: false, draftOrderId: null })}
        draftOrderId={payAtTable.draftOrderId}
        moneyFormat={money}
        onSuccess={() => {
          setPayAtTable({ open: false, draftOrderId: null });
          closeCheck();
          setView("floor");
        }}
      />
    </div>
  );
}

export default function POSRestaurantRedesign() {
  // Phase 2-R.0 Day 9 — defensive redirect. If a retail tenant somehow
  // navigates here directly (deep link, manual URL, stale tab) bounce
  // back to /pos. Wait for preset to load to avoid a redirect loop.
  const { presetLoaded, hasMode } = usePreset();
  if (presetLoaded && !hasMode("restaurant")) {
    return <Navigate to="/pos" replace />;
  }

  return (
    <POSProvider>
      <ErrorBoundary level="page">
        <RestaurantContent />
      </ErrorBoundary>
    </POSProvider>
  );
}
