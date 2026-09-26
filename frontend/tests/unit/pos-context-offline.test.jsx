// One Toy Store pilot, blocker 3 — POSContext with the internet down.
import "fake-indexeddb/auto";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────
// Stub api.get / api.post / api.del / api.raw with permissive defaults.
// Individual tests override api.post for the /api/draft-orders assertion.
// vi.mock is hoisted above imports — use vi.hoisted so the shared object
// is initialized before the factory runs.
const { apiState, CATALOGUE } = vi.hoisted(() => ({
  CATALOGUE: {
    products: [{ id: 1, name: "LEGO City Fire Truck", barcode: "5702017161000", sku: "LEGO-60374", price: "8500.00" }],
    variants: [],
  },
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
    raw: vi.fn(async (path) => {
      if (path === "/api/products/catalogue") {
        return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => CATALOGUE };
      }
      throw new TypeError("Failed to fetch"); // internet down, shop Wi-Fi up
    }),
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

import { POSProvider, usePOS } from "../../src/pages/redesign/pos/POSContext";
import { getCatalogueIndex, resetCatalogueForTests } from "../../src/utils/offlineCatalogue";

const wrapper = ({ children }) => <POSProvider>{children}</POSProvider>;

beforeEach(async () => {
  Object.values(apiState).forEach((fn) => fn.mockClear?.());
  sessionStorage.clear();
  localStorage.clear();
  await resetCatalogueForTests();
});

function typeScan(code) {
  for (const ch of code) window.dispatchEvent(new KeyboardEvent("keydown", { key: ch }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

describe("POSContext offline (blocker 3)", () => {
  it("3a: a barcode from the hand scanner goes into the cart from the offline copy", async () => {
    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(getCatalogueIndex()).not.toBeNull());
    await act(async () => { typeScan("5702017161000"); });
    await waitFor(() => expect(result.current.cart.map((l) => l.id)).toEqual([1]));
    expect(result.current.offlineCatalogue.productCount).toBe(1);
  });

  it("3h: after an offline reload the POS keeps its feature flags (the scan box is one)", async () => {
    const realGet = apiState.get.getMockImplementation();
    apiState.get.mockImplementation(async (path) => {
      if (path === "/api/feature-flags") return { flags: [{ key: "phase2g_omni_input", enabled: true }] };
      return realGet(path);
    });
    const first = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(first.result.current.posFlags.phase2g_omni_input).toBe(true));
    first.unmount();

    apiState.get.mockImplementation(async (path) => {
      if (path === "/api/feature-flags") throw new TypeError("Failed to fetch");
      return realGet(path);
    });
    const { result } = renderHook(() => usePOS(), { wrapper });
    await waitFor(() => expect(result.current.posFlags.phase2g_omni_input).toBe(true));
    apiState.get.mockImplementation(realGet);
  });

  it("Lock is refused while the server can't be reached, with a plain reason", async () => {
    const { result } = renderHook(() => usePOS(), { wrapper });
    await act(async () => { await result.current.handleLock(); });
    expect(result.current.isLocked).toBe(false);
    expect(result.current.notice).toBe("Lock needs the internet");
  });

  it("a screen already locked says plainly why it can't unlock offline", async () => {
    sessionStorage.setItem("posLocked", "1");
    const { result } = renderHook(() => usePOS(), { wrapper });
    // Wi-Fi up, internet down: the request fails. Browser offline: AuthProvider's
    // interceptor answers 503 "Offline mode" and api.post throws with status 503.
    for (const failure of [
      new TypeError("Failed to fetch"),
      Object.assign(new Error("Offline mode: write actions require an internet connection."), { status: 503 }),
    ]) {
      apiState.post.mockRejectedValueOnce(failure);
      act(() => { result.current.setLockPin("1234"); });
      await act(async () => { await result.current.handleUnlock(); });
      expect(result.current.isLocked).toBe(true);
      expect(result.current.lockError).toMatch(/offline/i);
      expect(result.current.lockError).toMatch(/internet is back/i);
    }
  });
});
