import { useState, useEffect, useCallback } from "react";
import { api } from "../../../../api";
import { useAuth } from "../../../../auth/AuthProvider";
import { getQueue, enqueue, dequeue } from "../../../../utils/offlineQueue";

// Thin wrapper over utils/offlineQueue. Public API kept stable so Wave D can
// swap localStorage → IndexedDB without touching useCheckout.
export function useOfflineQueue({ showNotice } = {}) {
  const { employee } = useAuth();
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineSyncResult, setOfflineSyncResult] = useState(null);

  // Init count when employee changes
  useEffect(() => {
    if (employee?.id) {
      setOfflineQueueCount(getQueue(employee.id).length);
    }
  }, [employee?.id]);

  const enqueueSale = useCallback((payload) => {
    if (!employee?.id) throw new Error("No employee context");
    const count = enqueue(employee.id, payload);
    setOfflineQueueCount(count);
    return count;
  }, [employee?.id]);

  const syncQueue = useCallback(async () => {
    if (!employee?.id) return;
    const queue = getQueue(employee.id);
    if (!queue.length) return;
    if (offlineSyncing) return;
    setOfflineSyncing(true);
    let synced = 0;
    for (const sale of queue) {
      try {
        const res = await api.raw("/api/sales", {
          method: "POST",
          body: JSON.stringify(sale),
        });
        if (res.ok) {
          dequeue(employee.id, sale.idempotency_key);
          synced++;
        } else {
          const data = await res.json().catch(() => ({}));
          if (data.duplicate) {
            dequeue(employee.id, sale.idempotency_key);
            synced++;
          } else {
            break;
          }
        }
      } catch {
        break;
      }
    }
    const remainingCount = getQueue(employee.id).length;
    setOfflineQueueCount(remainingCount);
    setOfflineSyncing(false);
    if (synced > 0) {
      setOfflineSyncResult({ synced });
      showNotice?.(`${synced} offline sale(s) synced successfully.`);
      setTimeout(() => setOfflineSyncResult(null), 5000);
    }
  }, [employee?.id, offlineSyncing, showNotice]);

  // Auto-sync on window.online, and react to cross-tab storage events
  useEffect(() => {
    const handleOnline = () => { syncQueue(); };
    const handleStorage = (e) => {
      if (e.key?.startsWith("pos_offline_queue_") && employee?.id) {
        setOfflineQueueCount(getQueue(employee.id).length);
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("storage", handleStorage);
    };
  }, [syncQueue, employee?.id]);

  return {
    offlineQueueCount,
    offlineSyncing,
    offlineSyncResult,
    enqueueSale,
    syncQueue,
  };
}
