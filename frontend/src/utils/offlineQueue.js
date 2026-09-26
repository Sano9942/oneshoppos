import { openDB } from "idb";

const DB_NAME = "sanopos_pos";
const DB_VERSION = 1;
const STORE = "sales_queue";
const LS_PREFIX = "pos_offline_queue_";

// Was 50: a busy afternoon outage at a shop counter passes that, and the 51st
// bill was refused (One Toy Store blocker 3g). IndexedDB holds far more.
export const MAX_QUEUED = 500;
export const WARN_THRESHOLD = 400;

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

// Bucket F: lazy row-type stamping. Existing rows (written before the
// offline-returns feature) don't carry a `type` field. We default them to
// "sale" on read so older tabs keep working without bumping DB_VERSION.
function normalizeRow(row) {
  if (!row) return row;
  if (!row.type) row.type = "sale";
  return row;
}

export function getQueueKey(employeeId) {
  return `${LS_PREFIX}${employeeId}`;
}

export async function getQueue(employeeId) {
  const db = await getDb();
  const rows = await db.getAllFromIndex(STORE, "by_employee", employeeId);
  return rows.map(normalizeRow);
}

// Bucket F: type-scoped getters. Keep `getQueue` returning everything so the
// top-of-file count in the banner stays a single number the UI can display.
export async function getSalesQueue(employeeId) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.type === "sale");
}

export async function getReturnsQueue(employeeId) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.type === "return");
}

export async function getQueueByState(employeeId, state) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.sync_state === state);
}

// Internal: shared write path for both sale and return queue rows. Keeps the
// MAX_QUEUED cap across all types (sales + returns combined) to match the
// existing single-bucket UX — users won't stockpile both.
async function enqueueTyped(employeeId, payload, type) {
  // Count through the index rather than reading every queued row.
  const db = await getDb();
  const queued = await db.countFromIndex(STORE, "by_employee", employeeId);
  if (queued >= MAX_QUEUED) {
    throw new Error(`Offline queue full (${MAX_QUEUED} items). Please sync before adding more.`);
  }
  const key = payload?.idempotency_key;
  if (!key) {
    const label =
      type === "return"
        ? "Return"
        : type === "check_in"
        ? "Check-in"
        : type === "field_order"
        ? "Order"
        : "Sale";
    throw new Error(`${label} payload missing idempotency_key`);
  }
  const row = {
    idempotency_key: key,
    employee_id: employeeId,
    type,
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    queued_at: new Date().toISOString(),
    last_attempt_at: null,
    payload,
  };
  await db.put(STORE, row);
  return queued + 1;
}

// Back-compat: the existing enqueue() keeps its sale-only semantics.
export async function enqueue(employeeId, salePayload) {
  return enqueueTyped(employeeId, salePayload, "sale");
}

// Bucket F: explicit helpers for callers that want to be unambiguous.
export async function enqueueSale(employeeId, salePayload) {
  return enqueueTyped(employeeId, salePayload, "sale");
}

export async function enqueueReturn(employeeId, returnPayload) {
  return enqueueTyped(employeeId, returnPayload, "return");
}

// Tier 1.1 wholesale: field-rep check-ins share the same IndexedDB store but
// use type="check_in". Reuses MAX_QUEUED cap (500 — a rep does 8-15 visits/day,
// so this is plenty). On reconnect, the drain loop sees these alongside sales
// and POSTs them to /api/field/check-in. Payload contract:
//   {
//     idempotency_key: <uuid>,    // becomes field_visits.client_uuid
//     customer_id, outcome, lat, lng, gps_accuracy_m, selfie_base64,
//     tag_shop_location?
//   }
export async function enqueueCheckIn(employeeId, checkInPayload) {
  return enqueueTyped(employeeId, checkInPayload, "check_in");
}

export async function getCheckInsQueue(employeeId) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.type === "check_in");
}

// Tier 1.2 wholesale field sales: field-rep orders share the same queue and
// drain to POST /api/sales (with field_visit_uuid linking back to the visit).
// Payload contract mirrors the POS sale body — see useCheckout.completeSale —
// plus field_visit_uuid set to the check-in's idempotency_key.
//   {
//     idempotency_key: <uuid>,
//     cartItems, payments, paymentMethod,
//     outlet_id, employee_id, customer_id,
//     field_visit_uuid: <checkin idempotency_key>,
//     // optional: notes, discount_amount/type
//   }
export async function enqueueFieldOrder(employeeId, orderPayload) {
  return enqueueTyped(employeeId, orderPayload, "field_order");
}

export async function getFieldOrdersQueue(employeeId) {
  const rows = await getQueue(employeeId);
  return rows.filter((r) => r.type === "field_order");
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
      // Migrated legacy rows are always sales — returns queue is new in Bucket F.
      type: "sale",
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
