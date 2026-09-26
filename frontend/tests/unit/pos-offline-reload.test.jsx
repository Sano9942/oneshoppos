// One Toy Store pilot, blocker 3h: after a reload with the internet down, the POS
// must still be able to sell. Before the fix, the opening gate couldn't load the
// branches, till or clock-in ("Failed to load POS setup data.") and blocked the
// counter, and money showed in "$". The POS now remembers the last-known state.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, renderHook, waitFor } from "@testing-library/react";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ employee: { id: 1 }, hasPerm: () => true }),
}));

import { useShiftGate } from "../../src/pages/redesign/pos/hooks/useShiftGate";
import { CurrencyProvider, useCurrency } from "../../src/contexts/CurrencyContext";
import { AUTH_KEY } from "../../src/auth/authStore";

const OUTLETS = { outlets: [{ id: 1, name: "Packages Mall" }] };
const SHIFT = { shift: { id: 2, outlet_id: 1, status: "open", opened_at: "2026-09-26T04:00:00Z" } };
const CLOCKED_IN = { status: "clocked_in" };
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function online(path) {
  if (path === "/api/outlets") return Promise.resolve(OUTLETS);
  if (path === "/api/shifts/active") return Promise.resolve(SHIFT);
  if (path === "/api/attendance/my-status") return Promise.resolve(CLOCKED_IN);
  return Promise.resolve({});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(AUTH_KEY, JSON.stringify({ employee: { id: 1, role_id: 1 }, tenant_slug: "otsshop", token: "t" }));
});

describe("useShiftGate after an offline reload", () => {
  it("uses the branch, till and clock-in last seen online, and says so", async () => {
    apiState.get.mockImplementation(online);
    const setError = vi.fn();
    const first = renderHook(() => useShiftGate({ setError, showNotice: vi.fn() }));
    await waitFor(() => expect(first.result.current.isReadyForCheckout).toBe(true));
    first.unmount();

    // Reload, internet down.
    apiState.get.mockImplementation(offline);
    const showNotice = vi.fn();
    const { result } = renderHook(() => useShiftGate({ setError, showNotice }));
    await waitFor(() => expect(result.current.isReadyForCheckout).toBe(true));
    expect(result.current.outlets).toEqual(OUTLETS.outlets);
    expect(result.current.activeShift.id).toBe(2);
    expect(setError).not.toHaveBeenCalledWith("Failed to load POS setup data.");
    expect(showNotice).toHaveBeenCalledWith(expect.stringMatching(/^Offline: using the till and clock-in saved at/));
  });

  it("with nothing saved, still reports the problem", async () => {
    apiState.get.mockImplementation(offline);
    const setError = vi.fn();
    const { result } = renderHook(() => useShiftGate({ setError, showNotice: vi.fn() }));
    await waitFor(() => expect(setError).toHaveBeenCalledWith("Failed to load POS setup data."));
    expect(result.current.isReadyForCheckout).toBe(false);
  });

  it("a real answer from the server (e.g. till closed) replaces the saved state", async () => {
    apiState.get.mockImplementation(online);
    const a = renderHook(() => useShiftGate({ setError: vi.fn(), showNotice: vi.fn() }));
    await waitFor(() => expect(a.result.current.isReadyForCheckout).toBe(true));
    a.unmount();
    apiState.get.mockImplementation((p) => (p === "/api/shifts/active" ? Promise.resolve({ shift: null }) : online(p)));
    const b = renderHook(() => useShiftGate({ setError: vi.fn(), showNotice: vi.fn() }));
    await waitFor(() => expect(b.result.current.gateLoading).toBe(false));
    await waitFor(() => expect(b.result.current.activeShift).toBeNull());
    b.unmount();
    apiState.get.mockImplementation(offline);
    const c = renderHook(() => useShiftGate({ setError: vi.fn(), showNotice: vi.fn() }));
    await waitFor(() => expect(c.result.current.outlets).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(c.result.current.activeShift).toBeNull();
  });
});

describe("CurrencyProvider after an offline reload", () => {
  function Show() { return <p>{useCurrency().fmt(9550)}</p>; }

  it("keeps the shop's currency", async () => {
    const realFetch = window.fetch;
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ symbol: "Rs", code: "PKR", denominations: [5000, 1000] }) }));
    const a = render(<CurrencyProvider><Show /></CurrencyProvider>);
    await screen.findByText(/^Rs 9,550\.00$/);
    a.unmount();
    window.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<CurrencyProvider><Show /></CurrencyProvider>);
    expect(await screen.findByText(/^Rs 9,550\.00$/)).toBeTruthy();
    window.fetch = realFetch;
  });
});
