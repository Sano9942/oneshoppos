import React from "react";
import { Play, X, ShoppingCart } from "lucide-react";
import { usePOS } from "./POSContext";
import { API_BASE as API } from "../../../config";

export default function POSParkedModal() {
  const {
    showParked,
    setShowParked,
    parkedSales,
    loadParked,
    selectedOutletId,
    restoreParked,
    showNotice,
    authHeaders,
  } = usePOS();

  if (!showParked) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Play size={16} className="text-[#8066FF]" /> Parked Sales
          </h3>
          <button
            onClick={() => setShowParked(false)}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {parkedSales.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <ShoppingCart size={36} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium">No parked sales.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {parkedSales.map((p) => (
                <div
                  key={p.id}
                  className="border border-slate-200 rounded-xl p-4 flex items-center justify-between hover:border-[#8066FF] transition"
                >
                  <div>
                    <div className="font-bold text-slate-800">
                      Parked Sale #{p.id}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Date(p.parked_at).toLocaleString()} · {p.item_count}{" "}
                      item(s) · {p.customer_name || "Walk-in"}
                    </div>
                    {p.notes && (
                      <div className="text-xs text-slate-400 mt-0.5 italic">
                        "{p.notes}"
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <button
                      onClick={async () => {
                        await fetch(`${API}/api/parked-sales/${p.id}`, {
                          method: "DELETE",
                          headers: authHeaders(),
                        });
                        await loadParked(selectedOutletId);
                        showNotice("Parked sale deleted.");
                      }}
                      className="px-3 py-1.5 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg text-xs font-bold transition"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => restoreParked(p)}
                      className="px-4 py-1.5 bg-[#8066FF] hover:bg-[#7055E6] text-white rounded-lg text-xs font-bold shadow-sm transition"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
