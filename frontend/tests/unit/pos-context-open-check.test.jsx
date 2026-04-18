/**
 * Phase 2-R.0 Day 10 — Vitest unit test for POSContext open/close/ensure
 * draft order state transitions. Renders POSProvider with all heavy
 * dependencies mocked so the test stays fast and deterministic.
 *
 * NOTE: vi.mock for the project's CommonJS-style modules has been flaky in
 * the past; we mock at the ESM module boundary (api.js + AuthProvider) since
 * those are the only network-touching deps.
 */
import "fake-indexeddb/auto";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────
// Stub api.get / api.post / api.del / api.raw with permissive defaults.
// Individual tests override api.post for the /api/draft-orders assertion.
// vi.mock is hoisted above imports — use vi.hoisted so the shared object
// is initialized before the factory runs.
const { apiState } = vi.hoisted(() => ({
  apiState: {
    get: vi.fn(async (path) => {
      if (path === "/api/outlets") return { outlets: [{ id: 1, name: "Main" }] };
      if (path === "/api/customers") return { customers: [] };
      if (path === "/api/employees") return { employees: [] };
      if (path === "/api/feature-flags") return { flags: [] };
      if (path === "/api/parked-sales") return { parkedSales: [] };
      if (path === "/api/receipt-templates/active") return null;
      if (path.startsWith("/api/shifts/active")) return { shift: null };
      if (path.startsWith("/api/attendance/my-status")) return { code: "clocked_out" };
      return {};
    }),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
    raw: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    upload: vi.fn(async () => ({})),
  },
}));

vi.mock("../../src/api", () => ({ api: apiState }));

vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({
    employee: { id: 1, name: "Test", username: "test" },
    authHeaders: {},
    isAuthenticated: true,
    hasPerm: () => true,
    permissions: ["all_access"],
    session: { tenant_slug: "test" },
  }),
}));

vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    symbol: "$",
    code: "USD",
    fmt: (n) => `$ ${Number(n || 0).toFixed(2)}`,
    refresh: () => {},
    denominations: [100, 50, 20, 10, 5, 1],
  }),
}));

vi.mock("../../src/contexts/PresetContext", () => ({
  usePreset: () => ({
    labels: {},
    label: (k) => k,
    presetLoaded: true,
    hasMode: () => true,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => {},
}));

// Now import the provider + hook (after all mocks are wired).
import { POSProvider, usePOS } from "../../src/pages/redesign/pos/POSContext";

const wrapper = ({ children }) => <POSProvider>{children}</POSProvider>;

beforeEach(() => {
  Object.values(apiState).forEach((fn) => fn.mockClear?.());
});

describe("POSContext — Phase 2-R.0 openCheck / closeCheck / ensureDraftOrder", () => {
  it("openCheck stamps orderContext, tableSessionId, seatCount and resets seat/course", async () => {
    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());

    expect(result.current.orderContext).toBeNull();
    expect(result.current.tableSessionId).toBeNull();
    expect(result.current.seatCount).toBe(0);

    act(() => {
      result.current.openCheck({
        context: "dine_in",
        tableSessionId: 42,
        seatCount: 4,
      });
    });

    expect(result.current.orderContext).toBe("dine_in");
    expect(result.current.tableSessionId).toBe(42);
    expect(result.current.seatCount).toBe(4);
    expect(result.current.activeSeat).toBe(1);
    expect(result.current.activeCourse).toBe(1);
    expect(result.current.cart).toEqual([]);
    expect(result.current.draftOrderId).toBeNull();
  });

  it("openCheck for takeout leaves tableSessionId null and seatCount 0", async () => {
    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());

    act(() => {
      result.current.openCheck({ context: "takeout" });
    });

    expect(result.current.orderContext).toBe("takeout");
    expect(result.current.tableSessionId).toBeNull();
    expect(result.current.seatCount).toBe(0);
  });

  it("closeCheck resets all restaurant context fields", async () => {
    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());

    act(() => {
      result.current.openCheck({
        context: "dine_in",
        tableSessionId: 7,
        draftOrderId: 99,
        seatCount: 3,
      });
    });
    expect(result.current.orderContext).toBe("dine_in");
    expect(result.current.draftOrderId).toBe(99);

    act(() => {
      result.current.closeCheck();
    });

    expect(result.current.orderContext).toBeNull();
    expect(result.current.tableSessionId).toBeNull();
    expect(result.current.draftOrderId).toBeNull();
    expect(result.current.seatCount).toBe(0);
    expect(result.current.activeSeat).toBe(1);
    expect(result.current.activeCourse).toBe(1);
  });

  it("ensureDraftOrder lazily POSTs to /api/draft-orders and stores the returned id", async () => {
    apiState.post.mockImplementation(async (path, body) => {
      if (path === "/api/draft-orders") {
        return { draftOrder: { id: 555 }, body };
      }
      return {};
    });

    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());

    act(() => {
      result.current.openCheck({
        context: "dine_in",
        tableSessionId: 11,
        seatCount: 2,
      });
    });

    let returnedId;
    await act(async () => {
      returnedId = await result.current.ensureDraftOrder();
    });

    expect(returnedId).toBe(555);
    expect(result.current.draftOrderId).toBe(555);

    const draftCall = apiState.post.mock.calls.find(
      ([p]) => p === "/api/draft-orders",
    );
    expect(draftCall).toBeTruthy();
    expect(draftCall[1]).toMatchObject({
      order_context: "dine_in",
      table_session_id: 11,
      seat_count: 2,
    });
  });

  it("ensureDraftOrder is idempotent — second call returns the cached id without re-POSTing", async () => {
    apiState.post.mockImplementation(async (path) => {
      if (path === "/api/draft-orders") return { draftOrder: { id: 777 } };
      return {};
    });

    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());

    act(() => {
      result.current.openCheck({ context: "takeout" });
    });

    await act(async () => {
      await result.current.ensureDraftOrder();
    });
    await act(async () => {
      await result.current.ensureDraftOrder();
    });

    const draftCalls = apiState.post.mock.calls.filter(
      ([p]) => p === "/api/draft-orders",
    );
    expect(draftCalls).toHaveLength(1);
    expect(result.current.draftOrderId).toBe(777);
  });
});
