import React, { useState, useEffect, useCallback } from "react";
import { CalendarClock, X, User, RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";

/**
 * F06 — "Today's appointments" checkout entry point. Lists confirmed /
 * in-progress appointments for the outlet's local day; tapping one prefills
 * the cart (service product line at the service price, provider stamped as
 * staff_id, customer attached) and links the eventual sale back to the
 * appointment (sales.appointment_id → appointment completed on commit).
 */
export default function POSAppointmentsModal() {
  const {
    showAppointments, setShowAppointments,
    selectedOutletId,
    loadAppointmentToCart,
  } = usePOS();

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/appointments/pos-today",
        selectedOutletId ? { outlet_id: selectedOutletId } : undefined);
      setAppointments(data.appointments || []);
    } catch (e) {
      setError(e.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }, [selectedOutletId]);

  useEffect(() => {
    if (showAppointments) load();
  }, [showAppointments, load]);

  if (!showAppointments) return null;

  const fmtTime = (iso) => {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-[#8066FF]" />
            <h3 className="font-black text-slate-900">Today's Appointments</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-slate-400 hover:text-slate-600" title="Refresh">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={() => setShowAppointments(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-3 flex-1">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-2">{error}</div>
          )}
          {!loading && !error && appointments.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-10">
              No unpaid appointments left for today.
            </div>
          )}
          {appointments.map((a) => (
            <button
              key={a.id}
              onClick={() => loadAppointmentToCart(a)}
              className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 mb-1.5 rounded-xl border border-slate-100 hover:border-[#8066FF] hover:bg-indigo-50/50 transition"
            >
              <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm truncate">
                  {a.service_name}
                  {a.status === "in_progress" && (
                    <span className="ml-2 text-[10px] font-black uppercase text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">In progress</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 truncate">
                  <User size={11} className="shrink-0" />
                  {a.customer_display_name || a.customer_name || "Walk-in"}
                  {a.employee_name ? <span className="text-slate-400"> · with {a.employee_name}</span> : null}
                </div>
                {!a.service_product_id && (
                  <div className="text-[10px] text-amber-600 flex items-center gap-1 mt-0.5">
                    <AlertTriangle size={10} className="shrink-0" />
                    No POS product linked to this service — add lines manually
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="font-black text-slate-900 text-sm">{fmtTime(a.start_at)}</div>
                {a.service_price != null && (
                  <div className="text-xs text-slate-500">{Number(a.service_price).toLocaleString()}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
