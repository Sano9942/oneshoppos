import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Store, ArrowLeft, FileText, HelpCircle, Lock, LogOut, History, RotateCcw, AlertTriangle, Monitor } from "lucide-react";
import { usePOS } from "./POSContext";
import { useAuth } from "../../../auth/AuthProvider";
import { readTenantSlug } from "../../../auth/authStore";
import { IS_MULTI_TENANT } from "../../../config";
import { getQueueByState } from "../../../utils/offlineQueue";
import POSStuckQueueModal from "./POSStuckQueueModal";
import POSLockButton from "./POSLockButton";

export default function POSHeader() {
  const {
    employee,
    outlets,
    selectedOutletId,
    setSelectedOutletId,
    canSwitchOutlet,
    slip,
    setSlipOpen,
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
    offlineQueueCount,
    offlineSyncing,
  } = usePOS();
  const { hasPerm } = useAuth();
  const [stuckCount, setStuckCount] = useState(0);
  const [stuckOpen, setStuckOpen] = useState(false);
  const isAdmin = hasPerm?.("all_access");

  const refreshStuck = useCallback(async () => {
    if (!employee?.id || !isAdmin) return;
    try {
      const failed = await getQueueByState(employee.id, "failed");
      setStuckCount(failed.length);
    } catch {
      setStuckCount(0);
    }
  }, [employee?.id, isAdmin]);

  useEffect(() => {
    refreshStuck();
    // Re-check whenever queue count changes (sync cycle transitions may leave rows failed)
  }, [refreshStuck, offlineQueueCount, offlineSyncing]);

  return (
    <div className="bg-(--ui-surface) border-b border-(--ui-border) px-3 md:px-5 py-2 md:py-2.5 flex items-center justify-between shrink-0 z-20">
      <div className="flex items-center gap-2">
        <Store size={18} className="text-(--ui-text)" />
        <span className="text-sm md:text-base font-bold text-(--ui-text)">
          POS
        </span>
      </div>
      <div className="flex items-center gap-2 md:gap-5 text-sm overflow-x-auto">
        <span className="font-medium text-(--ui-text-muted) hidden sm:block">
          {employee?.name || "Employee"}
        </span>
        {outlets.length > 0 && canSwitchOutlet && (
          <select
            value={selectedOutletId}
            onChange={(e) => setSelectedOutletId(e.target.value)}
            aria-label="Select branch"
            className="text-sm font-bold text-(--ui-text) bg-transparent focus:outline-none cursor-pointer border-none"
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
          <span className="text-sm font-bold text-(--ui-text)">
            {outlets.find((o) => String(o.id) === String(selectedOutletId))?.name || "Assigned Branch"}
          </span>
        )}
        <Link
          to="/dashboard"
          className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
        >
          <ArrowLeft size={14} /> <span className="hidden sm:inline">Dashboard</span>
        </Link>
        {slip && (
          <button
            onClick={() => setSlipOpen(true)}
            className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition text-sm"
          >
            <FileText size={14} /> <span className="hidden sm:inline">Last Receipt</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { loadRecentSales(); setRecentSalesOpen(true); }}
            className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition text-sm"
          >
            <History size={14} /> <span className="hidden sm:inline">Recent Sales</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { setReturnSourceSale(null); setReturnModalOpen(true); }}
            className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-danger) font-medium transition text-sm"
          >
            <RotateCcw size={14} /> <span className="hidden sm:inline">Return</span>
          </button>
        )}
        <button
          onClick={() => {
            if (!activeShift?.id) return;
            const slug = readTenantSlug();
            const tenantParam = IS_MULTI_TENANT && slug ? `&tenant=${encodeURIComponent(slug)}` : "";
            const url = `${window.location.origin}/customer-display?shift_id=${activeShift.id}${tenantParam}`;
            window.open(url, "_blank", "noopener,noreferrer");
          }}
          disabled={!activeShift?.id}
          title={activeShift?.id ? "Open customer-facing display in a new window" : "Open a shift to enable the customer-facing display"}
          className="flex items-center gap-1 font-medium transition text-sm disabled:cursor-not-allowed disabled:text-(--ui-border-strong) text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          <Monitor size={14} /> <span className="hidden sm:inline">Customer Display</span>
        </button>
        {isAdmin && stuckCount > 0 && (
          <button
            onClick={() => setStuckOpen(true)}
            className="flex items-center gap-1 text-(--ui-warning-fg) hover:text-(--ui-warning-fg) font-bold transition text-sm bg-(--ui-warning-bg) px-2 py-1 rounded-lg"
            title="Stuck offline sales"
          >
            <AlertTriangle size={14} /> <span>Stuck ({stuckCount})</span>
          </button>
        )}
        {activeShift && canOpenShift && (
          <button
            onClick={() => setCloseShiftOpen(true)}
            className="flex items-center gap-1 text-(--ui-danger) hover:text-(--ui-danger) font-medium transition"
          >
            <Lock size={14} /> <span className="hidden sm:inline">Close Shift</span>
          </button>
        )}
        <button
          onClick={() => setShowShortcutsOverlay(true)}
          className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
          title="Keyboard shortcuts (F1)"
        >
          <HelpCircle size={14} /> <span className="hidden sm:inline">Help</span>
        </button>
        <POSLockButton />
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
        >
          <LogOut size={14} /> <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
      <POSStuckQueueModal
        open={stuckOpen}
        onClose={() => { setStuckOpen(false); refreshStuck(); }}
      />
    </div>
  );
}
