// One Toy Store pilot, blocker 3 — the offline sales queue (3d, 3e, 3f, 3g).
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ employee: { id: 77 } }) }));
vi.mock("../../src/api", () => ({ api: { raw: vi.fn() } }));

import { useOfflineQueue, QUEUE_RETRY_MS } from "../../src/pages/redesign/pos/hooks/useOfflineQueue";
import { api } from "../../src/api";
import { getQueue, clearQueue, enqueue, markSyncing } from "../../src/utils/offlineQueue";

const EMP = 77;
const sale = (k, extra = {}) => ({ idempotency_key: k, cartItems: [{ id: 1, price: 100, quantity: 1 }], ...extra });
const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

beforeEach(async () => { await clearQueue(EMP); vi.clearAllMocks(); });
afterEach(async () => { await clearQueue(EMP); });

describe("3f — a queued sale remembers when it was rung up", () => {
  it("enqueueSale stamps offline_sold_at", async () => {
    const before = Date.now();
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => { await result.current.enqueueSale(sale("t1", { shift_id: 9 })); });
    const [row] = await getQueue(EMP);
    const t = new Date(row.payload.offline_sold_at).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
    expect(row.payload.shift_id).toBe(9);
  });

  it("keeps a time already on the payload", async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => { await result.current.enqueueSale(sale("t2", { offline_sold_at: "2026-09-26T16:50:00.000Z" })); });
    expect((await getQueue(EMP))[0].payload.offline_sold_at).toBe("2026-09-26T16:50:00.000Z");
  });
});

describe("3g — a long outage doesn't fill the queue", () => {
  it("holds a busy afternoon of bills (more than the old 50)", async () => {
    for (let i = 0; i < 120; i++) await enqueue(EMP, sale(`busy-${i}`));
    expect(await getQueue(EMP)).toHaveLength(120);
  });
});

describe("3d — waiting sales are sent even if the browser never went 'offline'", () => {
  it("retries on its own every QUEUE_RETRY_MS", async () => {
    const spy = vi.spyOn(window, "setInterval");
    await enqueue(EMP, sale("wifi-up-internet-down"));
    api.raw.mockResolvedValue(reply({ saleId: 1 }));
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(1));
    const tick = spy.mock.calls.find(([, ms]) => ms === QUEUE_RETRY_MS)?.[0];
    spy.mockRestore();
    expect(tick).toBeTypeOf("function");
    await act(async () => { await tick(); });
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(0));
    expect(api.raw).toHaveBeenCalledWith("/api/sales", expect.anything());
  });
});

describe("3d — a retry while the internet is still down leaves sales waiting, not failed", () => {
  it("network failure keeps the sale pending, and the next retry sends it", async () => {
    await enqueue(EMP, sale("still-down"));
    api.raw.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(1));
    await act(async () => { await result.current.syncQueue(); });
    expect((await getQueue(EMP))[0].sync_state).toBe("pending");

    api.raw.mockResolvedValueOnce(reply({}, 503)); // server down
    await act(async () => { await result.current.syncQueue(); });
    expect((await getQueue(EMP))[0].sync_state).toBe("pending");

    api.raw.mockResolvedValueOnce(reply({ saleId: 5 }));
    await act(async () => { await result.current.syncQueue(); });
    expect(await getQueue(EMP)).toHaveLength(0);
  });

  it("a real refusal from the server still marks the sale failed for a manager to look at", async () => {
    await enqueue(EMP, sale("refused"));
    api.raw.mockResolvedValueOnce(reply({ error: "Cart is empty" }, 400));
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(1));
    await act(async () => { await result.current.syncQueue(); });
    expect((await getQueue(EMP))[0].sync_state).toBe("failed");
  });
});

describe("3d — a sync cut off by a page reload isn't lost", () => {
  it("a sale left 'syncing' when the page opens goes back to waiting and is sent", async () => {
    await enqueue(EMP, sale("cut-off"));
    await markSyncing("cut-off"); // the page reloaded mid-request
    api.raw.mockResolvedValue(reply({ saleId: 9 }));
    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(1));
    await waitFor(async () => expect((await getQueue(EMP))[0].sync_state).toBe("pending"));
    await act(async () => { await result.current.syncQueue(); });
    expect(await getQueue(EMP)).toHaveLength(0);
  });
});

describe("3e/3f — the sync report: what to recount and which closed till got cash", () => {
  it("collects past-stock items and closed tills from the replies and keeps them until dismissed", async () => {
    await enqueue(EMP, sale("r1"));
    await enqueue(EMP, sale("r2"));
    api.raw
      .mockResolvedValueOnce(reply({ saleId: 10, sold_past_stock: [{ product_id: 4, variant_id: null, name: "Snack D", available: 1, requested: 3 }], till_closed: { shift_id: 12 } }))
      .mockResolvedValueOnce(reply({ saleId: 11, sold_past_stock: [], till_closed: { shift_id: 12 } }));
    const showNotice = vi.fn();
    const { result } = renderHook(() => useOfflineQueue({ showNotice }));
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(2));
    await act(async () => { await result.current.syncQueue(); });

    expect(result.current.syncReport.pastStock).toEqual([
      expect.objectContaining({ name: "Snack D", available: 1, requested: 3 }),
    ]);
    expect(result.current.syncReport.tillsClosed).toEqual([12]);
    expect(showNotice).toHaveBeenCalledWith(expect.stringMatching(/recount/i));
    act(() => { result.current.dismissSyncReport(); });
    expect(result.current.syncReport).toBeNull();
  });
});
