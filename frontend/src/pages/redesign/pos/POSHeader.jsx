import React from "react";
import { Link } from "react-router-dom";
import { Store, ArrowLeft, FileText, HelpCircle, Lock, LogOut, History, RotateCcw } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSHeader() {
  const {
    employee,
    outlets,
    selectedOutletId,
    setSelectedOutletId,
    canSwitchOutlet,
    slip,
    setSlipOpen,
    handleLock,
    handleLogout,
    activeShift,
    canOpenShift,
    setCloseShiftOpen,
    recentSalesOpen,
    setRecentSalesOpen,
    loadRecentSales,
    setReturnModalOpen,
    setReturnSourceSale,
    setShowShortcutsOverlay,
  } = usePOS();

  return (
    <div className="bg-white border-b border-slate-200 px-3 md:px-5 py-2 md:py-2.5 flex items-center justify-between shrink-0 shadow-sm z-20">
      <div className="flex items-center gap-2">
        <Store size={18} className="text-[#8066FF]" />
        <span className="text-sm md:text-base font-bold text-slate-800">
          POS
        </span>
      </div>
      <div className="flex items-center gap-2 md:gap-5 text-sm overflow-x-auto">
        <span className="font-medium text-slate-600 hidden sm:block">
          {employee?.name || "Employee"}
        </span>
        {outlets.length > 0 && canSwitchOutlet && (
          <select
            value={selectedOutletId}
            onChange={(e) => setSelectedOutletId(e.target.value)}
            className="text-sm font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer border-none"
          >
            <option value="">Select Branch</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {outlets.length > 0 && !canSwitchOutlet && (
          <span className="text-sm font-bold text-slate-700">
            {outlets.find((o) => String(o.id) === String(selectedOutletId))?.name || "Assigned Branch"}
          </span>
        )}
        <Link
          to="/dashboard"
          className="flex items-center gap-1 text-slate-500 hover:text-slate-800 font-medium transition"
        >
          <ArrowLeft size={14} /> <span className="hidden sm:inline">Dashboard</span>
        </Link>
        {slip && (
          <button
            onClick={() => setSlipOpen(true)}
            className="flex items-center gap-1 text-violet-500 hover:text-violet-700 font-medium transition text-sm"
          >
            <FileText size={14} /> <span className="hidden sm:inline">Last Receipt</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { loadRecentSales(); setRecentSalesOpen(true); }}
            className="flex items-center gap-1 text-slate-500 hover:text-violet-700 font-medium transition text-sm"
          >
            <History size={14} /> <span className="hidden sm:inline">Recent Sales</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { setReturnSourceSale(null); setReturnModalOpen(true); }}
            className="flex items-center gap-1 text-slate-500 hover:text-rose-600 font-medium transition text-sm"
          >
            <RotateCcw size={14} /> <span className="hidden sm:inline">Return</span>
          </button>
        )}
        {activeShift && canOpenShift && (
          <button
            onClick={() => setCloseShiftOpen(true)}
            className="flex items-center gap-1 text-rose-600 hover:text-rose-700 font-medium transition"
          >
            <Lock size={14} /> <span className="hidden sm:inline">Close Shift</span>
          </button>
        )}
        <button
          onClick={() => setShowShortcutsOverlay(true)}
          className="flex items-center gap-1 text-slate-500 hover:text-violet-600 font-medium transition"
          title="Keyboard shortcuts (F1)"
        >
          <HelpCircle size={14} /> <span className="hidden sm:inline">Help</span>
        </button>
        <button
          onClick={handleLock}
          className="flex items-center gap-1 text-slate-500 hover:text-red-600 font-medium transition"
        >
          <Lock size={14} /> <span className="hidden sm:inline">Lock</span>
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium transition"
        >
          <LogOut size={14} /> <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </div>
  );
}
