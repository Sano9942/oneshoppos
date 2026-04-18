import { useEffect, useState } from "react";
import { X, ArrowRightLeft } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 6 — Transfer an open dine-in session to a different table.
// Calls PUT /api/restaurant/table-sessions/:id { table_id } — extended in
// backend/services/restaurant-floor.js to accept table_id (and update
// outlet_id when the destination lives on a different plan).
//
// Tables are fetched from GET /api/restaurant/floor-plans on open so this
// modal stays self-contained even when launched from the check view
// (which doesn't already hold the table list in memory).

export default function TransferTableModal({ open, onClose, onTransferred }) {
  const {
    tableSessionId,
    setTableSessionId,
    showNotice,
    setError,
  } = usePOS();

  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await api.get("/api/restaurant/floor-plans");
        if (cancelled) return;
        const list = data.floor_plans || [];
        setPlans(list);
        setActivePlan(list[0]?.id || null);
      } catch {
        if (!cancelled) setPlans([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!activePlan) { setTables([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/api/restaurant/floor-plans/${activePlan}`);
        if (!cancelled) setTables(data.tables || []);
      } catch {
        if (!cancelled) setTables([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activePlan]);

  if (!open) return null;

  const transferTo = async (tableId) => {
    if (!tableSessionId) {
      setError?.("No active table session — transfer only works for dine-in.");
      return;
    }
    setBusy(true);
    try {
      const updated = await api.put(`/api/restaurant/table-sessions/${tableSessionId}`, {
        table_id: tableId,
      });
      // Session id stays the same; table_id changed under the hood. Keep the
      // POSContext session id in sync in case the backend ever returns a new
      // session id (it does not today, but belt-and-suspenders).
      if (updated?.id && updated.id !== tableSessionId) {
        setTableSessionId(updated.id);
      }
      showNotice?.("Table transferred.");
      onTransferred?.();
      onClose?.();
    } catch (e) {
      setError?.(e.message || "Failed to transfer table");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col border border-slate-100/20 max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ArrowRightLeft className="text-[#8066FF]" size={20} />
            Transfer to Table
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {plans.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePlan(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                    activePlan === p.id
                      ? "bg-[#8066FF] text-white border-[#8066FF]"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading tables…</p>
          ) : tables.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No tables on this plan.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {tables.map((t) => {
                const occupied = t.current_session_id && t.current_session_id !== tableSessionId;
                const isCurrent = t.current_session_id === tableSessionId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => !occupied && !isCurrent && !busy && transferTo(t.id)}
                    disabled={occupied || isCurrent || busy}
                    title={
                      isCurrent
                        ? "Current table"
                        : occupied
                        ? "Table occupied"
                        : `Move to ${t.label}`
                    }
                    className={`min-h-[88px] rounded-2xl p-3 border-2 flex flex-col items-center justify-center transition ${
                      isCurrent
                        ? "border-[#8066FF] bg-[#8066FF]/10 text-[#8066FF]"
                        : occupied
                        ? "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                        : "border-slate-200 bg-white text-slate-800 hover:border-[#8066FF] hover:bg-[#8066FF]/5 active:scale-[0.98]"
                    }`}
                  >
                    <span className="text-lg font-black tracking-tight">{t.label}</span>
                    <span className="text-[10px] uppercase tracking-wider mt-1 opacity-70">
                      {isCurrent ? "Current" : occupied ? "Occupied" : `Seats ${t.capacity || 2}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50 rounded-b-3xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-200 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
