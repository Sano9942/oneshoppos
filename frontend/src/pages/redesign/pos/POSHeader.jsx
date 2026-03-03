import React from "react";
import { Link } from "react-router-dom";
import { Store, ArrowLeft, FileText, Lock, LogOut } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSHeader() {
  const {
    employee,
    outlets,
    selectedOutletId,
    setSelectedOutletId,
    slip,
    setSlipOpen,
    handleLock,
    handleLogout,
    activeShift,
    canOpenShift,
    setCloseShiftOpen,
  } = usePOS();

  return (
    <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex items-center justify-between shrink-0 shadow-sm z-20">
      <div className="flex items-center gap-2.5">
        <Store size={18} className="text-[#8066FF]" />
        <span className="text-base font-bold text-slate-800">
          Point Of Sale
        </span>
      </div>
      <div className="flex items-center gap-5 text-sm">
        <span className="font-medium text-slate-600 hidden sm:block">
          {employee?.name || "Employee"}
        </span>
        {outlets.length > 0 && (
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
        <Link
          to="/dashboard"
          className="flex items-center gap-1 text-slate-500 hover:text-slate-800 font-medium transition"
        >
          <ArrowLeft size={14} /> Dashboard
        </Link>
        {slip && (
          <button
            onClick={() => setSlipOpen(true)}
            className="flex items-center gap-1 text-violet-500 hover:text-violet-700 font-medium transition text-sm"
          >
            <FileText size={14} /> Last Receipt
          </button>
        )}
        {activeShift && canOpenShift && (
          <button
            onClick={() => setCloseShiftOpen(true)}
            className="flex items-center gap-1 text-rose-600 hover:text-rose-700 font-medium transition"
          >
            <Lock size={14} /> Close Shift
          </button>
        )}
        <button
          onClick={handleLock}
          className="flex items-center gap-1 text-slate-500 hover:text-red-600 font-medium transition"
        >
          <Lock size={14} /> Lock
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium transition"
        >
          <LogOut size={14} /> Logout
        </button>
      </div>
    </div>
  );
}
