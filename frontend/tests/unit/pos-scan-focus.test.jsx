// One Toy Store pilot, D63 (owner 2026-10-02): the cursor should always be in
// the top scan bar so the cashier can scan or type without reaching for the
// mouse. Before: it came back only every 10 s, so after a click on a cart line
// or a button a scan went nowhere (or its Enter pressed that button).
// Never steal it from another box being typed in, or while a pop-up is open.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, renderHook } from "@testing-library/react";

const pos = {};
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ company: {} }) }));
vi.mock("../../src/api", () => ({ api: { get: vi.fn() } }));
vi.mock("../../src/pages/redesign/pos/offlineLookup", () => ({ scanProduct: vi.fn(), listVariants: vi.fn() }));

import POSOmniInput from "../../src/pages/redesign/pos/POSOmniInput";
import { useCart } from "../../src/pages/redesign/pos/hooks/useCart";

function Till({ overlay = false }) {
  return (
    <div>
      <POSOmniInput />
      <button type="button">Cart line</button>
      <input placeholder="Search customer…" />
      {overlay && (
        <div className="fixed inset-0 z-50">
          <button type="button">Pay</button>
        </div>
      )}
    </div>
  );
}

const scanBar = () => screen.getByPlaceholderText(/Scan, search/);

beforeEach(() => {
  Object.assign(pos, { handleSearchChange: vi.fn(), setSearch: vi.fn(), setResults: vi.fn(), setShowResults: vi.fn(), addToCart: vi.fn(), showNotice: vi.fn() });
});
afterEach(() => vi.useRealTimers());

describe("D63 — the cursor stays in the scan bar", () => {
  it("comes back at once after a click on a button", async () => {
    render(<Till />);
    const btn = screen.getByText("Cart line");
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(document.activeElement).toBe(scanBar()));
  });

  it("a key typed while the cursor is lost goes to the scan bar", () => {
    render(<Till />);
    document.activeElement.blur();
    screen.getByText("Cart line").focus();
    fireEvent.keyDown(document.activeElement, { key: "2" });
    expect(document.activeElement).toBe(scanBar());
  });

  it("does not take the cursor from another box being typed in", async () => {
    render(<Till />);
    const customer = screen.getByPlaceholderText("Search customer…");
    customer.focus();
    fireEvent.click(customer);
    fireEvent.keyDown(customer, { key: "a" });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(customer);
  });

  it("leaves a pop-up alone (payment, return, discount…)", async () => {
    render(<Till overlay />);
    const pay = screen.getByText("Pay");
    pay.focus();
    fireEvent.click(pay);
    fireEvent.keyDown(pay, { key: "5" });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(pay);
  });

  it("the backup check runs every second, not every 10", () => {
    vi.useFakeTimers();
    render(<Till />);
    screen.getByText("Cart line").focus();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(document.activeElement).toBe(scanBar());
  });
});

// With the cursor living in the scan bar, a name typed there + Enter must
// really search (before it only copied the text into the F2 box, no list).
describe("D63 — a name typed in the scan bar searches", () => {
  it("runs the same search as the F2 box", () => {
    render(<Till />);
    scanBar().value = "Puzzle";
    fireEvent.keyDown(scanBar(), { key: "Enter" });
    expect(pos.handleSearchChange).toHaveBeenCalledWith({ target: { value: "Puzzle" } });
  });
});

// The real cause seen on the till: every item added to the cart (scan or pick)
// put the cursor in the F2 box below. It goes back to the top scan bar now
// (to the F2 box only when the scan bar is switched off).
describe("D63 — after an item goes in the cart", () => {
  const NO_CUSTOMERS = [];
  const NO_FLAGS = {};
  const ITEM = { id: 7, name: "POP TUBES", price: "250", local_stock: 5 };

  it("the cursor goes to the top scan bar", () => {
    render(<Till />);
    const { result } = renderHook(() => useCart({
      selectedOutletId: 1, selectedCustomerId: "", customers: NO_CUSTOMERS, posFlags: NO_FLAGS, showNotice: pos.showNotice,
    }));
    const f2 = document.createElement("input");
    document.body.appendChild(f2);
    result.current.searchRef.current = f2;
    screen.getByText("Cart line").focus();
    act(() => { result.current.addToCart(ITEM); });
    expect(document.activeElement).toBe(scanBar());
    f2.remove();
  });

  it("with no scan bar, the F2 box as before", () => {
    const { result } = renderHook(() => useCart({
      selectedOutletId: 1, selectedCustomerId: "", customers: NO_CUSTOMERS, posFlags: NO_FLAGS, showNotice: pos.showNotice,
    }));
    const f2 = document.createElement("input");
    document.body.appendChild(f2);
    result.current.searchRef.current = f2;
    act(() => { result.current.addToCart(ITEM); });
    expect(document.activeElement).toBe(f2);
    f2.remove();
  });
});
