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
  markPending,
  migrateFromLocalStorage,
} from "../../../../utils/offlineQueue";

// While sales wait, retry this often even if the browser never reported going
// offline: when only the shop's internet drops (router still up) the browser
// stays "online", so the `online` event never fires (One Toy Store blocker 3d).
export const QUEUE_RETRY_MS = 60 * 1000;

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
  // What the last sync needs the shop to act on (blocker 3e/3f): items sold
  // offline past SanoPOS's stock (recount them) and closed tills that got
  // cash afterwards. Kept until the cashier dismisses it.
  const [syncReport, setSyncReport] = useState(null);
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
      // A sale left "syncing" was cut off by a page reload mid-request, and
      // nothing retries "syncing" rows. No sync runs before this, so put them
      // back to waiting; a repeat send is safe (idempotency_key).
      try {
        for (const row of await getQueueByState(employee.id, "syncing")) {
          await markPending(row.idempotency_key);
        }
      } catch { /* best-effort */ }
      if (cancelled) return;
      await refreshCount();
    })();
    return () => { cancelled = true; };
  }, [employee?.id, refreshCount]);

  const enqueueSale = useCallback(async (payload) => {
    if (!employee?.id) throw new Error("No employee context");
    // 3f: the moment it was rung up, so the server books it then (and in the
    // till open then), not whenever the internet comes back.
    const stamped = { ...payload, offline_sold_at: payload.offline_sold_at || new Date().toISOString() };
    const count = await enqueueSaleRow(employee.id, stamped);
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
    const pastStock = [];
    const tillsClosed = [];
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
        // Server still unreachable (gateway down, or the offline interceptor's
        // 503): leave this and the rest waiting for the next try (3d). Marking
        // them failed parked them where no automatic retry looks.
        if ([502, 503, 504].includes(res.status)) {
          await markPending(key);
          break;
        }
        let body = {};
        try { body = await res.json(); } catch { body = {}; }
        // Both /api/sales and /api/returns return 409 with a `code` on
        // duplicates; treat either duplicate marker as a successful sync
        // (server already has the record — drop it from the queue).
        const duplicate = body.duplicate || body.code === "duplicate_return" || body.code === "duplicate";
        if (res.ok || duplicate) {
          if (Array.isArray(body.sold_past_stock)) pastStock.push(...body.sold_past_stock);
          const closedId = body.till_closed?.shift_id;
          if (closedId && !tillsClosed.includes(closedId)) tillsClosed.push(closedId);
          await markSynced(key);
          if (isReturn) syncedReturns++;
          else syncedSales++;
        } else {
          await markFailed(key, body.error || `HTTP ${res.status}`);
        }
      } catch (e) {
        if (e instanceof TypeError) {
          await markPending(key); // no connection: try again later (3d)
          break;
        }
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
      if (pastStock.length) msg += ` ${pastStock.length} item(s) sold past stock: recount them.`;
      if (tillsClosed.length) msg += ` Closed till(s) ${tillsClosed.map((id) => `#${id}`).join(", ")} got these sales.`;
      showNotice?.(msg);
      setTimeout(() => setOfflineSyncResult(null), 5000);
    }
    if (pastStock.length || tillsClosed.length) {
      setSyncReport((prev) => ({
        pastStock: [...(prev?.pastStock || []), ...pastStock],
        tillsClosed: [...new Set([...(prev?.tillsClosed || []), ...tillsClosed])],
      }));
    }
  }, [employee?.id, refreshCount, showNotice]);

  // Auto-sync on window.online, and (3d) on a timer while sales wait.
  useEffect(() => {
    const handleOnline = () => { syncQueue(); };
    window.addEventListener("online", handleOnline);
    const timer = setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      return syncQueue();
    }, QUEUE_RETRY_MS);
    return () => {
      window.removeEventListener("online", handleOnline);
      clearInterval(timer);
    };
  }, [syncQueue]);

  const dismissSyncReport = useCallback(() => setSyncReport(null), []);

  return {
    offlineQueueCount,
    queuedSalesCount,
    queuedReturnsCount,
    offlineSyncing,
    offlineSyncResult,
    syncReport,
    dismissSyncReport,
    enqueueSale,
    enqueueReturn,
    syncQueue,
  };
}
