import React from "react";
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
import POSReceiptModal from "./pos/POSReceiptModal";
import POSOpeningGateModal from "./pos/POSOpeningGateModal";
import POSCloseShiftModal from "./pos/POSCloseShiftModal";

function POSContent() {
  const { isLocked, notice, error } = usePOS();

  if (isLocked) {
    return <POSLockScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] overflow-hidden font-sans">
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

      <div className="flex flex-1 overflow-hidden">
        {/* Main Area */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          <POSSubHeader />
          <POSSearchArea />
          <POSCartTable />
        </div>

        {/* Sidebar */}
        <POSSidebar />
      </div>

      {/* Modals */}
      <POSDiscountModal />
      <POSNoteModal />
      <POSParkedModal />
      <POSOpeningGateModal />
      <POSCloseShiftModal />
      <POSCheckoutModal />
      <POSReceiptModal />
    </div>
  );
}

export default function POSRedesign() {
  return (
    <POSProvider>
      <POSContent />
    </POSProvider>
  );
}
