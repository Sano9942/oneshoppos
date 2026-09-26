// One Toy Store pilot, blocker 3 — what the counter shows while offline.
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const { pos } = vi.hoisted(() => ({ pos: {} }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));

import POSLockScreen from "../../src/pages/redesign/pos/POSLockScreen";
import POSSyncReport from "../../src/pages/redesign/pos/POSSyncReport";
import POSLockButton from "../../src/pages/redesign/pos/POSLockButton";

const setOnline = (v) => {
  Object.defineProperty(window.navigator, "onLine", { value: v, configurable: true });
  window.dispatchEvent(new Event(v ? "online" : "offline"));
};

beforeEach(() => {
  setOnline(true);
  for (const k of Object.keys(pos)) delete pos[k];
  Object.assign(pos, {
    lockPin: "", setLockPin: vi.fn(), lockError: "", setLockError: vi.fn(),
    handleUnlock: vi.fn(), logout: vi.fn(), navigate: vi.fn(), handleLock: vi.fn(),
    syncReport: null, dismissSyncReport: vi.fn(),
  });
});
afterEach(() => setOnline(true));

describe("Lock button", () => {
  it("greys out with 'Lock needs the internet' while offline, and comes back online", () => {
    render(<POSLockButton />);
    const button = screen.getByRole("button", { name: /lock/i });
    expect(button.disabled).toBe(false);
    act(() => setOnline(false));
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Lock needs the internet");
    act(() => setOnline(true));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(pos.handleLock).toHaveBeenCalled();
  });
});

describe("Lock screen", () => {
  it("says plainly that it unlocks when the internet is back", () => {
    setOnline(false);
    render(<POSLockScreen />);
    expect(screen.getByText(/You're offline\. The PIN is checked online/)).toBeTruthy();
  });

  it("says nothing extra when online", () => {
    render(<POSLockScreen />);
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });
});

describe("Sync report", () => {
  it("lists what to recount and the closed tills, until dismissed", () => {
    pos.syncReport = {
      pastStock: [
        { product_id: 4, variant_id: null, name: "Snack D", available: 1, requested: 3 },
        { product_id: 2, variant_id: 9, name: "Widget B (WB-BLUE)", available: 0, requested: 1 },
      ],
      tillsClosed: [12],
    };
    render(<POSSyncReport />);
    expect(screen.getByText(/Sold offline past stock/)).toBeTruthy();
    expect(screen.getByText(/Snack D/)).toBeTruthy();
    expect(screen.getByText(/sold 3, SanoPOS had 1/)).toBeTruthy();
    expect(screen.getByText(/Widget B \(WB-BLUE\)/)).toBeTruthy();
    expect(screen.getByText(/till #12/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(pos.dismissSyncReport).toHaveBeenCalled();
  });

  it("shows nothing when there is nothing to report", () => {
    const { container } = render(<POSSyncReport />);
    expect(container.textContent).toBe("");
  });
});
