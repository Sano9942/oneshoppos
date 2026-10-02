import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Store, ArrowLeft, FileText, HelpCircle, Lock, LogOut, History, RotateCcw, AlertTriangle, Monitor, Banknote, PiggyBank, Printer } from "lucide-react";
import { usePOS } from "./POSContext";
import { useAuth } from "../../../auth/AuthProvider";
import { readTenantSlug } from "../../../auth/authStore";
import { IS_MULTI_TENANT } from "../../../config";
import { getQueueByState } from "../../../utils/offlineQueue";
import POSStuckQueueModal from "./POSStuckQueueModal";
import POSLockButton from "./POSLockButton";
import POSPaidOutModal from "./POSPaidOutModal";
import POSPaidInModal from "./POSPaidInModal";
import { Button } from "../../../ui/primitives";
import { printDayReport } from "../../../utils/dayReportSlip";

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
    setError,
  } = usePOS();
  const { hasPerm } = useAuth();
  const [stuckCount, setStuckCount] = useState(0);
  const [stuckOpen, setStuckOpen] = useState(false);
  const [paidOutOpen, setPaidOutOpen] = useState(false);
  const [paidInOpen, setPaidInOpen] = useState(false);
  const canPayOut = hasPerm?.("pos_paid_out");
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
    <div className="bg-(--ui-surface) border-b border-(--ui-border) px-3 md:px-5 py-2 md:py-2.5 flex items-center justify-between gap-3 shrink-0 z-20">
      <div className="flex items-center gap-2 shrink-0">
        <Store size={18} className="text-(--ui-text)" />
        <span className="text-sm md:text-base font-bold text-(--ui-text)">
          POS
        </span>
      </div>
      {/* D61 (One Toy Store pilot): one row, no name ever wraps; the rarely
          used buttons show only their icon (name as tooltip) below 1536 px. */}
      <div className="flex items-center gap-2 lg:gap-3 xl:gap-4 text-sm overflow-x-auto">
        <span className="whitespace-nowrap shrink-0 font-medium text-(--ui-text-muted) hidden 2xl:block">
          {employee?.name || "Employee"}
        </span>
        {outlets.length > 0 && canSwitchOutlet && (
          <select
            value={selectedOutletId}
            onChange={(e) => setSelectedOutletId(e.target.value)}
            aria-label="Select branch"
            className="whitespace-nowrap shrink-0 text-sm font-bold text-(--ui-text) bg-transparent focus:outline-none cursor-pointer border-none"
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
          <span className="whitespace-nowrap shrink-0 text-sm font-bold text-(--ui-text)">
            {outlets.find((o) => String(o.id) === String(selectedOutletId))?.name || "Assigned Branch"}
          </span>
        )}
        <Link
          to="/dashboard"
          title="Dashboard"
          className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
        >
          <ArrowLeft size={14} /> <span className="hidden 2xl:inline">Dashboard</span>
        </Link>
        {slip && (
          <button
            onClick={() => setSlipOpen(true)}
            className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition text-sm"
          >
            <FileText size={14} /> <span>Last Receipt</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { loadRecentSales(); setRecentSalesOpen(true); }}
            className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition text-sm"
          >
            <History size={14} /> <span>Recent Sales</span>
          </button>
        )}
        {selectedOutletId && (
          <button
            onClick={() => { setReturnSourceSale(null); setReturnModalOpen(true); }}
            className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-danger) font-medium transition text-sm"
          >
            <RotateCcw size={14} /> <span>Return</span>
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
          className="whitespace-nowrap shrink-0 flex items-center gap-1 font-medium transition text-sm disabled:cursor-not-allowed disabled:text-(--ui-border-strong) text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          <Monitor size={14} /> <span className="hidden 2xl:inline">Customer Display</span>
        </button>
        {isAdmin && stuckCount > 0 && (
          <button
            onClick={() => setStuckOpen(true)}
            className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-warning-fg) hover:text-(--ui-warning-fg) font-bold transition text-sm bg-(--ui-warning-bg) px-2 py-1 rounded-lg"
            title="Stuck offline sales"
          >
            <AlertTriangle size={14} /> <span>Stuck ({stuckCount})</span>
          </button>
        )}
        {activeShift && canPayOut && (
          <Button
            size="sm"
            className="whitespace-nowrap shrink-0"
            onClick={() => setPaidOutOpen(true)}
            title="Cash paid out of the till (expenses, suppliers, home, advances)"
          >
            <Banknote size={14} className="mr-1 inline" /> Paid out
          </Button>
        )}
        {activeShift && canPayOut && (
          <Button
            size="sm"
            className="whitespace-nowrap shrink-0"
            onClick={() => setPaidInOpen(true)}
            title="Cash put into the till (from the bank, the owner, staff paying back)"
          >
            <PiggyBank size={14} className="mr-1 inline" /> Paid in
          </Button>
        )}
        {activeShift && canOpenShift && (
          <Button
            size="sm"
            className="whitespace-nowrap shrink-0"
            onClick={() => printDayReport(activeShift.id).catch((err) => setError?.(err.message || "Could not load the day report"))}
            title="Print the day report now (check copy) to count the drawer against"
          >
            <Printer size={14} className="mr-1 inline" /> Day report
          </Button>
        )}
        {activeShift && canOpenShift && (
          <button
            onClick={() => setCloseShiftOpen(true)}
            className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-danger) hover:text-(--ui-danger) font-medium transition"
          >
            <Lock size={14} /> <span>Close Shift</span>
          </button>
        )}
        <button
          onClick={() => setShowShortcutsOverlay(true)}
          className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
          title="Keyboard shortcuts (F1)"
        >
          <HelpCircle size={14} /> <span className="hidden 2xl:inline">Help</span>
        </button>
        <POSLockButton />
        <button
          onClick={handleLogout}
          title="Logout"
          className="whitespace-nowrap shrink-0 flex items-center gap-1 text-(--ui-text-muted) hover:text-(--ui-text) font-medium transition"
        >
          <LogOut size={14} /> <span className="hidden 2xl:inline">Logout</span>
        </button>
      </div>
      <POSStuckQueueModal
        open={stuckOpen}
        onClose={() => { setStuckOpen(false); refreshStuck(); }}
      />
      {activeShift && canPayOut && (
        <POSPaidOutModal open={paidOutOpen} onClose={() => setPaidOutOpen(false)} shift={activeShift} />
      )}
      {activeShift && canPayOut && (
        <POSPaidInModal open={paidInOpen} onClose={() => setPaidInOpen(false)} shift={activeShift} />
      )}
    </div>
  );
}
