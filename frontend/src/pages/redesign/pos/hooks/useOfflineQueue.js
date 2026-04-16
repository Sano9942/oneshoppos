import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";
import {
  getQueue,
  getQueueByState,
  enqueue,
  markSyncing,
  markSynced,
  markFailed,
  migrateFromLocalStorage,
} from "../../../../utils/offlineQueue";

// Thin wrapper over utils/offlineQueue (IndexedDB-backed). Public API kept
// stable so useCheckout doesn't change when storage implementation swaps.
export function useOfflineQueue({ showNotice } = {}) {
  const { employee } = useAuth();
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineSyncResult, setOfflineSyncResult] = useState(null);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    if (!employee?.id) return;
    const rows = await getQueue(employee.id);
    setOfflineQueueCount(rows.length);
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
    const count = await enqueue(employee.id, payload);
    setOfflineQueueCount(count);
    return count;
  }, [employee?.id]);

  const syncQueue = useCallback(async () => {
    if (!employee?.id) return;
    if (syncingRef.current) return;
    const pending = await getQueueByState(employee.id, "pending");
    if (!pending.length) return;
    syncingRef.current = true;
    setOfflineSyncing(true);
    let synced = 0;
    for (const row of pending) {
      const key = row.idempotency_key;
      try {
        await markSyncing(key);
        const res = await api.raw("/api/sales", {
          method: "POST",
          body: JSON.stringify(row.payload),
        });
        let body = {};
        try { body = await res.json(); } catch { body = {}; }
        if (res.ok || body.duplicate) {
          await markSynced(key);
          synced++;
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
    if (synced > 0) {
      setOfflineSyncResult({ synced });
      showNotice?.(`${synced} offline sale(s) synced successfully.`);
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
    offlineSyncing,
    offlineSyncResult,
    enqueueSale,
    syncQueue,
  };
}
