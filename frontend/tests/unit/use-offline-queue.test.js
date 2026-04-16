import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock useAuth BEFORE importing useOfflineQueue
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ employee: { id: 42 } }),
}));

// Mock api.raw — test controls responses per case
vi.mock("../../src/api", () => ({
  api: {
    raw: vi.fn(),
  },
}));

import { useOfflineQueue } from "../../src/pages/redesign/pos/hooks/useOfflineQueue";
import { api } from "../../src/api";
import { getQueue, clearQueue } from "../../src/utils/offlineQueue";

const EMPLOYEE_ID = 42;

beforeEach(() => {
  clearQueue(EMPLOYEE_ID);
  vi.clearAllMocks();
});

afterEach(() => {
  clearQueue(EMPLOYEE_ID);
});

describe("useOfflineQueue", () => {
  it("enqueueSale adds to queue and increments count", async () => {
    const { result } = renderHook(() => useOfflineQueue());

    // Initial count is 0 after mount effect
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(0));

    act(() => {
      result.current.enqueueSale({
        idempotency_key: "key-1",
        cartItems: [{ id: 1, name: "Test", price: 100, quantity: 1 }],
        total: 100,
      });
    });

    expect(result.current.offlineQueueCount).toBe(1);
    expect(getQueue(EMPLOYEE_ID)).toHaveLength(1);
    expect(getQueue(EMPLOYEE_ID)[0].idempotency_key).toBe("key-1");
  });

  it("syncQueue clears queue on 200 OK", async () => {
    api.raw.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ saleId: 1 }),
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(0));

    act(() => {
      result.current.enqueueSale({ idempotency_key: "k-ok", cartItems: [], total: 50 });
    });
    expect(result.current.offlineQueueCount).toBe(1);

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(result.current.offlineQueueCount).toBe(0);
    expect(getQueue(EMPLOYEE_ID)).toHaveLength(0);
    expect(api.raw).toHaveBeenCalledWith(
      "/api/sales",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("syncQueue leaves entry in queue on 500 error", async () => {
    api.raw.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server exploded" }),
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(0));

    act(() => {
      result.current.enqueueSale({ idempotency_key: "k-fail", cartItems: [], total: 75 });
    });
    expect(result.current.offlineQueueCount).toBe(1);

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(result.current.offlineQueueCount).toBe(1);
    expect(getQueue(EMPLOYEE_ID)).toHaveLength(1);
    expect(getQueue(EMPLOYEE_ID)[0].idempotency_key).toBe("k-fail");
  });

  it("syncQueue treats duplicate: true response as synced", async () => {
    api.raw.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ duplicate: true, saleId: 99 }),
    });

    const { result } = renderHook(() => useOfflineQueue());
    await waitFor(() => expect(result.current.offlineQueueCount).toBe(0));

    act(() => {
      result.current.enqueueSale({ idempotency_key: "k-dup", cartItems: [], total: 25 });
    });

    await act(async () => {
      await result.current.syncQueue();
    });

    expect(result.current.offlineQueueCount).toBe(0);
  });
});
