import React from "react";
import { Building2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { usePOS } from "./POSContext";

function shiftMessage(attendanceCode) {
  if (attendanceCode === "on_break") {
    return "The shift is open, but you are currently on break. Clock back in at the kiosk before using POS.";
  }
  if (attendanceCode === "clocked_out") {
    return "The shift is open, but you have already clocked out for today. Use the kiosk before using POS.";
  }
  if (attendanceCode === "clocked_in") {
    return "";
  }
  return "Use the kiosk to clock in before using POS.";
}

export default function POSOpeningGateModal() {
  const {
    outlets,
    selectedOutletId,
    setSelectedOutletId,
    activeShift,
    attendanceCode,
    gateLoading,
    canOpenShift,
    openingDenoms,
    setOpeningDenoms,
    openingFloat,
    openingShiftBusy,
    openShiftFromPOS,
    refreshGateStatus,
    handleLogout,
    employee,
  } = usePOS();

  const needsOutlet = !selectedOutletId;
  const needsShift = Boolean(selectedOutletId) && !gateLoading && !activeShift;
  const needsClockIn =
    Boolean(selectedOutletId) &&
    !gateLoading &&
    Boolean(activeShift) &&
    attendanceCode !== "clocked_in" &&
    !canOpenShift;

  if (!needsOutlet && !needsShift && !needsClockIn && !gateLoading) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">
            Opening Flow
          </p>
          <h2 className="mt-1 text-2xl font-black text-slate-900">
            Prepare POS Before Selling
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Select the branch, confirm the shift is open, and make sure the logged-in employee is clocked in.
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Branch
            </label>
            <div className="flex items-center gap-3">
              <Building2 size={18} className="text-[#8066FF]" />
              <select
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-[#8066FF] focus:outline-none"
              >
                <option value="">Select branch...</option>
                {outlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {gateLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">
              Checking shift and attendance status...
            </div>
          ) : null}

          {needsShift ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black text-slate-900">No open shift found for this branch</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {canOpenShift
                      ? "Open the shift now by entering the opening cash denominations."
                      : "A manager or administrator must open the shift before sales can start."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => refreshGateStatus(selectedOutletId)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>

              {canOpenShift ? (
                <div className="mt-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {openingDenoms.map((row, index) => (
                      <label key={row.denomination} className="rounded-xl border border-amber-200 bg-white p-3">
                        <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                          Rs {row.denomination}
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={row.count}
                          onChange={(e) =>
                            setOpeningDenoms((prev) =>
                              prev.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, count: Math.max(0, Number(e.target.value || 0)) }
                                  : entry,
                              ),
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 focus:border-[#8066FF] focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        Manager
                      </p>
                      <p className="text-sm font-semibold text-slate-800">
                        {employee?.name || "Current user"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        Opening Float
                      </p>
                      <p className="text-xl font-black text-slate-900">
                        PKR {openingFloat.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={openShiftFromPOS}
                    disabled={openingShiftBusy || openingFloat <= 0}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#8066FF] px-5 py-3 text-sm font-black text-white hover:bg-[#7055E6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShieldCheck size={16} />
                    {openingShiftBusy ? "Opening Shift..." : "Open Shift"}
                  </button>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    <LogOut size={14} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {needsClockIn ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <p className="text-sm font-black text-slate-900">Shift is open</p>
              <p className="mt-1 text-sm text-slate-600">{shiftMessage(attendanceCode)}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => refreshGateStatus(selectedOutletId)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw size={14} />
                  I Have Clocked In
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
