import React from "react";
import { Play, X, ShoppingCart } from "lucide-react";
import { usePOS } from "./POSContext";
import { api } from "../../../api";
import { fmtLocalDateTime } from "../../../utils/dates";

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
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-muted-surface) shrink-0">
          <h3 className="font-bold text-(--ui-text) flex items-center gap-2">
            <Play size={16} className="text-(--ui-text)" /> Parked Sales
          </h3>
          <button
            onClick={() => setShowParked(false)}
            className="text-(--ui-text-muted) hover:text-(--ui-text) p-1.5 rounded-full hover:bg-(--ui-border-strong)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {parkedSales.length === 0 ? (
            <div className="text-center py-12 text-(--ui-text-muted)">
              <ShoppingCart size={36} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium">No parked sales.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {parkedSales.map((p) => (
                <div
                  key={p.id}
                  className="border border-(--ui-border-strong) rounded-xl p-4 flex items-center justify-between hover:border-(--ui-text) transition"
                >
                  <div>
                    <div className="font-bold text-(--ui-text)">
                      Parked Sale #{p.id}
                    </div>
                    <div className="text-xs text-(--ui-text-muted) mt-0.5">
                      {fmtLocalDateTime(p.parked_at)} · {p.item_count}{" "}
                      item(s) · {p.customer_name || "Walk-in"}
                    </div>
                    {p.notes && (
                      <div className="text-xs text-(--ui-text-muted) mt-0.5 italic">
                        "{p.notes}"
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <button
                      onClick={async () => {
                        const url =
                          p._source === "draft"
                            ? `/api/draft-orders/${p.id}`
                            : `/api/parked-sales/${p.id}`;
                        await api.del(url);
                        await loadParked(selectedOutletId);
                        showNotice("Parked sale deleted.");
                      }}
                      className="px-3 py-1.5 text-(--ui-danger) bg-(--ui-danger-bg) hover:bg-(--ui-danger-bg) rounded-lg text-xs font-bold transition"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => restoreParked(p)}
                      className="px-4 py-1.5 bg-(--ui-primary) hover:bg-(--ui-primary-strong) text-white rounded-lg text-xs font-bold transition"
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
