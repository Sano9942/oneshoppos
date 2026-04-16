import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getQueue,
  getQueueByState,
  enqueue,
  markSyncing,
  markSynced,
  markFailed,
  clearQueue,
  migrateFromLocalStorage,
  getQueueKey,
  MAX_QUEUED,
} from "../../src/utils/offlineQueue";

const EMP_A = 111;
const EMP_B = 222;

async function resetAll() {
  await clearQueue(EMP_A);
  await clearQueue(EMP_B);
}

beforeEach(async () => {
  await resetAll();
  try { localStorage.clear(); } catch { /* ignore */ }
});

afterEach(async () => {
  await resetAll();
  try { localStorage.clear(); } catch { /* ignore */ }
});

function makeSale(key, extra = {}) {
  return {
    idempotency_key: key,
    cartItems: [{ id: 1, name: "Test", price: 100, quantity: 1 }],
    payments: [{ method: "Cash", amount: 100 }],
    total: 100,
    ...extra,
  };
}

describe("utils/offlineQueue (IndexedDB)", () => {
  it("enqueue + getQueue returns 1 row with sync_state='pending'", async () => {
    await enqueue(EMP_A, makeSale("k1"));
    const rows = await getQueue(EMP_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotency_key).toBe("k1");
    expect(rows[0].sync_state).toBe("pending");
    expect(rows[0].retry_count).toBe(0);
    expect(rows[0].employee_id).toBe(EMP_A);
    expect(rows[0].queued_at).toBeTruthy();
  });

  it("enqueue past MAX_QUEUED throws", async () => {
    for (let i = 0; i < MAX_QUEUED; i++) {
      await enqueue(EMP_A, makeSale(`max-${i}`));
    }
    const rows = await getQueue(EMP_A);
    expect(rows).toHaveLength(MAX_QUEUED);
    await expect(enqueue(EMP_A, makeSale("overflow"))).rejects.toThrow(/full/i);
  });

  it("markSyncing sets sync_state='syncing' and last_attempt_at", async () => {
    await enqueue(EMP_A, makeSale("k2"));
    await markSyncing("k2");
    const rows = await getQueue(EMP_A);
    expect(rows[0].sync_state).toBe("syncing");
    expect(rows[0].last_attempt_at).toBeTruthy();
  });

  it("markSyncing then markSynced removes the row", async () => {
    await enqueue(EMP_A, makeSale("k3"));
    await markSyncing("k3");
    await markSynced("k3");
    const rows = await getQueue(EMP_A);
    expect(rows).toHaveLength(0);
  });

  it("markFailed sets retry_count=1, last_error, sync_state='failed'", async () => {
    await enqueue(EMP_A, makeSale("k4"));
    await markFailed("k4", "boom");
    const rows = await getQueue(EMP_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].sync_state).toBe("failed");
    expect(rows[0].retry_count).toBe(1);
    expect(rows[0].last_error).toBe("boom");
  });

  it("getQueueByState filters correctly across pending/syncing/failed", async () => {
    await enqueue(EMP_A, makeSale("p1"));
    await enqueue(EMP_A, makeSale("s1"));
    await enqueue(EMP_A, makeSale("f1"));
    await markSyncing("s1");
    await markFailed("f1", "err");

    const pending = await getQueueByState(EMP_A, "pending");
    const syncing = await getQueueByState(EMP_A, "syncing");
    const failed = await getQueueByState(EMP_A, "failed");

    expect(pending.map((r) => r.idempotency_key)).toEqual(["p1"]);
    expect(syncing.map((r) => r.idempotency_key)).toEqual(["s1"]);
    expect(failed.map((r) => r.idempotency_key)).toEqual(["f1"]);
  });

  it("migrateFromLocalStorage imports entries and clears the key", async () => {
    const lsKey = getQueueKey(EMP_A);
    const legacy = [
      { idempotency_key: "legacy-1", cartItems: [], total: 50, queued_at: "2026-04-10T12:00:00Z" },
      { idempotency_key: "legacy-2", cartItems: [], total: 75, queued_at: "2026-04-10T12:01:00Z" },
    ];
    localStorage.setItem(lsKey, JSON.stringify(legacy));

    const imported = await migrateFromLocalStorage(EMP_A);
    expect(imported).toBe(2);
    expect(localStorage.getItem(lsKey)).toBeNull();

    const rows = await getQueue(EMP_A);
    expect(rows.map((r) => r.idempotency_key).sort()).toEqual(["legacy-1", "legacy-2"]);
    for (const r of rows) {
      expect(r.sync_state).toBe("pending");
    }

    // Idempotent: calling again is a no-op
    const again = await migrateFromLocalStorage(EMP_A);
    expect(again).toBe(0);
  });

  it("clearQueue is scoped to a specific employee", async () => {
    await enqueue(EMP_A, makeSale("a1"));
    await enqueue(EMP_A, makeSale("a2"));
    await enqueue(EMP_B, makeSale("b1"));

    await clearQueue(EMP_A);
    expect(await getQueue(EMP_A)).toHaveLength(0);
    expect(await getQueue(EMP_B)).toHaveLength(1);
    expect((await getQueue(EMP_B))[0].idempotency_key).toBe("b1");
  });
});
