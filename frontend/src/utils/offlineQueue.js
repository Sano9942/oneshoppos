import { openDB } from "idb";

const DB_NAME = "sanopos_pos";
const DB_VERSION = 1;
const STORE = "sales_queue";
const LS_PREFIX = "pos_offline_queue_";

export const MAX_QUEUED = 50;
export const WARN_THRESHOLD = 40;

let _dbPromise = null;

function getDb() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "idempotency_key" });
          store.createIndex("by_employee", "employee_id", { unique: false });
          store.createIndex("by_state", "sync_state", { unique: false });
          store.createIndex("by_queued_at", "queued_at", { unique: false });
        }
      },
    });
  }
  return _dbPromise;
}

export function getQueueKey(employeeId) {
  return `${LS_PREFIX}${employeeId}`;
}

export async function getQueue(employeeId) {
  const db = await getDb();
  return db.getAllFromIndex(STORE, "by_employee", employeeId);
}

export async function getQueueByState(employeeId, state) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.sync_state === state);
}

export async function enqueue(employeeId, salePayload) {
  const existing = await getQueue(employeeId);
  if (existing.length >= MAX_QUEUED) {
    throw new Error(`Offline queue full (${MAX_QUEUED} sales). Please sync before adding more.`);
  }
  const key = salePayload?.idempotency_key;
  if (!key) throw new Error("Sale payload missing idempotency_key");
  const row = {
    idempotency_key: key,
    employee_id: employeeId,
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    queued_at: new Date().toISOString(),
    last_attempt_at: null,
    payload: salePayload,
  };
  const db = await getDb();
  await db.put(STORE, row);
  return existing.length + 1;
}

export async function markSyncing(idempotencyKey) {
  const db = await getDb();
  const row = await db.get(STORE, idempotencyKey);
  if (!row) return;
  row.sync_state = "syncing";
  row.last_attempt_at = new Date().toISOString();
  await db.put(STORE, row);
}

export async function markSynced(idempotencyKey) {
  const db = await getDb();
  await db.delete(STORE, idempotencyKey);
}

export async function markFailed(idempotencyKey, errorMessage) {
  const db = await getDb();
  const row = await db.get(STORE, idempotencyKey);
  if (!row) return;
  row.sync_state = "failed";
  row.retry_count = (row.retry_count || 0) + 1;
  row.last_error = errorMessage || "Unknown error";
  await db.put(STORE, row);
}

export async function markPending(idempotencyKey) {
  const db = await getDb();
  const row = await db.get(STORE, idempotencyKey);
  if (!row) return;
  row.sync_state = "pending";
  await db.put(STORE, row);
}

export async function clearQueue(employeeId) {
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE, "by_employee", employeeId);
  const tx = db.transaction(STORE, "readwrite");
  await Promise.all(rows.map((r) => tx.store.delete(r.idempotency_key)));
  await tx.done;
}

export async function migrateFromLocalStorage(employeeId) {
  const key = getQueueKey(employeeId);
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return 0;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    localStorage.removeItem(key);
    return 0;
  }
  const db = await getDb();
  let imported = 0;
  for (const entry of parsed) {
    const idempotencyKey = entry?.idempotency_key;
    if (!idempotencyKey) continue;
    const existing = await db.get(STORE, idempotencyKey);
    if (existing) continue;
    await db.put(STORE, {
      idempotency_key: idempotencyKey,
      employee_id: employeeId,
      sync_state: "pending",
      retry_count: 0,
      last_error: null,
      queued_at: entry.queued_at || new Date().toISOString(),
      last_attempt_at: null,
      payload: entry,
    });
    imported++;
  }
  localStorage.removeItem(key);
  return imported;
}

/** @deprecated Use markSynced instead. Kept for backward compat with old callers. */
export async function dequeue(employeeId, idempotencyKey) {
  // eslint-disable-next-line no-console
  console.warn("offlineQueue.dequeue() is deprecated; use markSynced() instead");
  await markSynced(idempotencyKey);
  const remaining = await getQueue(employeeId);
  return remaining.length;
}
