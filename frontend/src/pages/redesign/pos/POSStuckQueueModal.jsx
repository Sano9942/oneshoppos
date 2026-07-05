import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, X, RefreshCw, Trash2, RotateCw } from "lucide-react";
import { usePOS } from "./POSContext";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { fmtLocalDateTime } from "../../../utils/dates";
import {
  getQueueByState,
  markPending,
  markSynced,
} from "../../../utils/offlineQueue";

export default function POSStuckQueueModal({ open, onClose }) {
  const { syncQueue, showNotice } = usePOS();
  const { employee } = useAuth();
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!employee?.id) return;
    setLoading(true);
    try {
      const failed = await getQueueByState(employee.id, "failed");
      setRows(failed);
    } finally {
      setLoading(false);
    }
  }, [employee?.id]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!open) return null;

  const handleRetry = async (key) => {
    await markPending(key);
    await syncQueue?.();
    await refresh();
    showNotice?.("Retrying stuck sale…");
  };

  const handleDiscard = async (key) => {
    if (!confirm("Discard this stuck sale? This cannot be undone.")) return;
    await markSynced(key);
    await refresh();
    showNotice?.("Stuck sale discarded.");
  };

  const computeTotal = (payload) => {
    if (!payload) return 0;
    if (typeof payload.total === "number") return payload.total;
    const items = Array.isArray(payload.cartItems) ? payload.cartItems : [];
    return items.reduce(
      (s, i) => s + Number(i.price || 0) * Number(i.quantity || 0),
      0,
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border) bg-(--ui-warning-bg) shrink-0">
          <h3 className="font-bold text-(--ui-text) flex items-center gap-2">
            <AlertTriangle size={16} className="text-(--ui-warning-fg)" /> Stuck Offline Sales
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="text-(--ui-text-muted) hover:text-(--ui-text) p-1.5 rounded-full hover:bg-(--ui-warning-bg) disabled:opacity-50"
              title="Refresh"
            >
              <RotateCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="text-(--ui-text-muted) hover:text-(--ui-text) p-1.5 rounded-full hover:bg-(--ui-warning-bg)"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {rows.length === 0 ? (
            <div className="text-center py-12 text-(--ui-text-muted)">
              <AlertTriangle size={36} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium">No stuck sales.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-bold text-(--ui-text-muted) border-b border-(--ui-border-strong)">
                  <th className="py-2 pr-3">Queued At</th>
                  <th className="py-2 pr-3">Retries</th>
                  <th className="py-2 pr-3">Last Error</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-0 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.idempotency_key}
                    className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)"
                  >
                    <td className="py-3 pr-3 text-(--ui-text)">
                      {fmtLocalDateTime(r.queued_at)}
                    </td>
                    <td className="py-3 pr-3 text-(--ui-text) font-mono">
                      {r.retry_count || 0}
                    </td>
                    <td className="py-3 pr-3 text-(--ui-danger-fg) text-xs max-w-xs truncate">
                      {r.last_error || "—"}
                    </td>
                    <td className="py-3 pr-3 text-right text-(--ui-text) font-bold">
                      {fmt(computeTotal(r.payload))}
                    </td>
                    <td className="py-3 pr-0 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleRetry(r.idempotency_key)}
                          className="px-2.5 py-1 text-(--ui-text) bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) rounded-md text-xs font-bold transition flex items-center gap-1"
                        >
                          <RefreshCw size={12} /> Retry
                        </button>
                        <button
                          onClick={() => handleDiscard(r.idempotency_key)}
                          className="px-2.5 py-1 text-(--ui-danger-fg) bg-(--ui-danger-bg) hover:bg-(--ui-danger-bg) rounded-md text-xs font-bold transition flex items-center gap-1"
                        >
                          <Trash2 size={12} /> Discard
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
