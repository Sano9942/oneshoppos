import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";
import {
  getQueue,
  getQueueByState,
  enqueueSale as enqueueSaleRow,
  enqueueReturn as enqueueReturnRow,
  markSyncing,
  markSynced,
  markFailed,
  migrateFromLocalStorage,
} from "../../../../utils/offlineQueue";

// Thin wrapper over utils/offlineQueue (IndexedDB-backed). Public API kept
// stable for useCheckout; Bucket F adds returns support (queuedReturnsCount,
// enqueueReturn) and routes sync by row.type.
export function useOfflineQueue({ showNotice } = {}) {
  const { employee } = useAuth();
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [queuedSalesCount, setQueuedSalesCount] = useState(0);
  const [queuedReturnsCount, setQueuedReturnsCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineSyncResult, setOfflineSyncResult] = useState(null);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    if (!employee?.id) return;
    const rows = await getQueue(employee.id);
    setOfflineQueueCount(rows.length);
    // Type-split counts for the banner ("3 sales + 1 refund queued offline")
    let sales = 0;
    let returns = 0;
    for (const r of rows) {
      if (r.type === "return") returns++;
      else sales++;
    }
    setQueuedSalesCount(sales);
    setQueuedReturnsCount(returns);
  }, [employee?.id]);

  // Init on mount / employee change: run one-time LS migration, then count.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!employee?.id) return;
      try {
        await migrateFromLocalStorage(employee.id);
      } catch {
        // Non-fatal — migration is best-effort.
      }
      if (cancelled) return;
      await refreshCount();
    })();
    return () => { cancelled = true; };
  }, [employee?.id, refreshCount]);

  const enqueueSale = useCallback(async (payload) => {
    if (!employee?.id) throw new Error("No employee context");
    const count = await enqueueSaleRow(employee.id, payload);
    await refreshCount();
    return count;
  }, [employee?.id, refreshCount]);

  // Bucket F: mirror of enqueueSale for returns. Caller should pass a
  // fully-built /api/returns payload with its own idempotency_key already
  // stamped (same shape used when posting online).
  const enqueueReturn = useCallback(async (payload) => {
    if (!employee?.id) throw new Error("No employee context");
    const count = await enqueueReturnRow(employee.id, payload);
    await refreshCount();
    return count;
  }, [employee?.id, refreshCount]);

  const syncQueue = useCallback(async () => {
    if (!employee?.id) return;
    if (syncingRef.current) return;
    const pending = await getQueueByState(employee.id, "pending");
    if (!pending.length) return;
    syncingRef.current = true;
    setOfflineSyncing(true);
    let syncedSales = 0;
    let syncedReturns = 0;
    for (const row of pending) {
      const key = row.idempotency_key;
      const isReturn = row.type === "return";
      const endpoint = isReturn ? "/api/returns" : "/api/sales";
      try {
        await markSyncing(key);
        const res = await api.raw(endpoint, {
          method: "POST",
          body: JSON.stringify(row.payload),
        });
        let body = {};
        try { body = await res.json(); } catch { body = {}; }
        // Both /api/sales and /api/returns return 409 with a `code` on
        // duplicates; treat either duplicate marker as a successful sync
        // (server already has the record — drop it from the queue).
        const duplicate = body.duplicate || body.code === "duplicate_return" || body.code === "duplicate";
        if (res.ok || duplicate) {
          await markSynced(key);
          if (isReturn) syncedReturns++;
          else syncedSales++;
        } else {
          await markFailed(key, body.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        await markFailed(key, e?.message || "Network error");
      }
    }
    await refreshCount();
    syncingRef.current = false;
    setOfflineSyncing(false);
    const total = syncedSales + syncedReturns;
    if (total > 0) {
      setOfflineSyncResult({ synced: total, sales: syncedSales, returns: syncedReturns });
      let msg;
      if (syncedSales && syncedReturns) {
        msg = `${syncedSales} sale(s) + ${syncedReturns} refund(s) synced successfully.`;
      } else if (syncedReturns) {
        msg = `${syncedReturns} offline refund(s) synced successfully.`;
      } else {
        msg = `${syncedSales} offline sale(s) synced successfully.`;
      }
      showNotice?.(msg);
      setTimeout(() => setOfflineSyncResult(null), 5000);
    }
  }, [employee?.id, refreshCount, showNotice]);

  // Auto-sync on window.online.
  useEffect(() => {
    const handleOnline = () => { syncQueue(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncQueue]);

  return {
    offlineQueueCount,
    queuedSalesCount,
    queuedReturnsCount,
    offlineSyncing,
    offlineSyncResult,
    enqueueSale,
    enqueueReturn,
    syncQueue,
  };
}
