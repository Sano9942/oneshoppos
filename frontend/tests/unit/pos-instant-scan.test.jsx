// One Toy Store pilot, D62 (owner 2026-10-02: the top scan box is "a little
// slow"; measured ~0.5 s per server trip from Lahore). An exact code found in
// the till's own catalogue copy goes into the cart at once; the server lookup
// runs in the background and corrects the line (price, stock note) or takes it
// back out if the server knows that code as something else / nothing. A code
// not in the copy, or an item that needs a choice (variants, serial, age
// check, gift card, bundle), waits for the server as before.
// Also: the restaurant add-ons check (another server trip) is skipped unless
// the shop has the restaurant feature on.
import "fake-indexeddb/auto";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";

const { apiState, pos, scan } = vi.hoisted(() => ({
  apiState: { raw: vi.fn(), get: vi.fn() },
  pos: {},
  scan: { scanProduct: vi.fn(), listVariants: vi.fn() },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ company: {} }) }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/pages/redesign/pos/offlineLookup", () => scan);

import { refreshCatalogue, resetCatalogueForTests } from "../../src/utils/offlineCatalogue";
import POSOmniInput from "../../src/pages/redesign/pos/POSOmniInput";
import { useCart } from "../../src/pages/redesign/pos/hooks/useCart";
import { needsModifierLookup } from "../../src/pages/redesign/pos/modifierLookup";

const POP = { id: 7, name: "POP TUBES-POP-02", sku: "2516", barcode: null, price: "250.00", has_variants: false };
const CATALOGUE = {
  products: [
    POP,
    { id: 8, name: "Dress-Up Set", sku: "3001", price: "2400.00", has_variants: true },
    { id: 9, name: "Phone", sku: "4001", price: "9000.00", has_variants: false, serial_required: true },
  ],
  variants: [],
};

// A promise the test resolves when it wants the server to answer.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const k of Object.keys(pos)) delete pos[k];
  Object.assign(pos, {
    addToCart: vi.fn(), addDecodedLine: vi.fn(), showNotice: vi.fn(), handleSearchChange: vi.fn(),
    setSearch: vi.fn(), setResults: vi.fn(), setShowResults: vi.fn(),
    setPendingVariantProductId: vi.fn(), setPendingSerialProductId: vi.fn(), setPendingSerialContext: vi.fn(),
    confirmCopyLine: vi.fn(), undoCopyLine: vi.fn(),
  });
  scan.listVariants.mockResolvedValue([]);
  await resetCatalogueForTests();
  apiState.raw.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...CATALOGUE, version: "v1" }) });
  await refreshCatalogue("default");
});

const scanBar = () => screen.getByPlaceholderText(/Scan, search/);
function scanCode(code) {
  scanBar().value = code;
  fireEvent.keyDown(scanBar(), { key: "Enter" });
}
const copyLine = () => expect.objectContaining({ id: 7, stock_unknown: true });

describe("D62 — instant add from the till's copy", () => {
  it("a code in the copy goes into the cart before the server answers", async () => {
    const server = deferred();
    scan.scanProduct.mockReturnValue(server.promise);
    render(<POSOmniInput />);
    scanCode("2516");
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledWith(copyLine()));
    expect(pos.confirmCopyLine).not.toHaveBeenCalled();
    server.resolve({ found: true, offline: false, product: { ...POP, price: "300.00", local_stock: 0 } });
    await waitFor(() => expect(pos.confirmCopyLine).toHaveBeenCalledWith(copyLine(), expect.objectContaining({ id: 7, price: "300.00" })));
    expect(pos.addToCart).toHaveBeenCalledTimes(1);
  });

  it("the server knows the code as another item: the copy line comes out, the server's item goes in", async () => {
    const other = { id: 99, name: "New Kite", sku: "2516", price: "500.00", local_stock: 3 };
    scan.scanProduct.mockResolvedValue({ found: true, offline: false, product: other });
    render(<POSOmniInput />);
    scanCode("2516");
    await waitFor(() => expect(pos.undoCopyLine).toHaveBeenCalledWith(copyLine()));
    expect(pos.addToCart).toHaveBeenLastCalledWith(other);
    expect(pos.confirmCopyLine).not.toHaveBeenCalled();
  });

  it("the server has no such code any more: the copy line comes out, with a note", async () => {
    scan.scanProduct.mockResolvedValue({ found: false, offline: false, status: 404, error: "No product for 2516" });
    render(<POSOmniInput />);
    scanCode("2516");
    await waitFor(() => expect(pos.undoCopyLine).toHaveBeenCalledWith(copyLine()));
    expect(pos.showNotice).toHaveBeenCalledWith(expect.stringMatching(/2516/));
  });

  it("the server can't be reached: the copy line stays (offline, as before)", async () => {
    scan.scanProduct.mockResolvedValue({ found: true, offline: true, product: POP });
    render(<POSOmniInput />);
    scanCode("2516");
    await waitFor(() => expect(scan.scanProduct).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(pos.addToCart).toHaveBeenCalledTimes(1);
    expect(pos.undoCopyLine).not.toHaveBeenCalled();
    expect(pos.confirmCopyLine).not.toHaveBeenCalled();
  });

  it("a code not in the copy waits for the server, as before", async () => {
    const server = deferred();
    scan.scanProduct.mockReturnValue(server.promise);
    render(<POSOmniInput />);
    scanCode("77777777");
    await new Promise((r) => setTimeout(r, 20));
    expect(pos.addToCart).not.toHaveBeenCalled();
    const kite = { id: 50, name: "Kite", sku: "77777777", price: "300.00", local_stock: 2 };
    server.resolve({ found: true, offline: false, product: kite });
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledWith(kite));
  });

  it("items that need a choice (variants, serial number) wait for the server", async () => {
    scan.scanProduct.mockResolvedValue({ found: true, offline: false, product: { ...CATALOGUE.products[1] } });
    scan.listVariants.mockResolvedValue([{ id: 1 }]);
    render(<POSOmniInput />);
    scanCode("3001");
    await waitFor(() => expect(pos.setPendingVariantProductId).toHaveBeenCalledWith(8));
    scan.scanProduct.mockResolvedValue({ found: true, offline: false, product: { ...CATALOGUE.products[2] } });
    scan.listVariants.mockResolvedValue([]);
    scanCode("4001");
    await waitFor(() => expect(pos.setPendingSerialProductId).toHaveBeenCalledWith(9));
    expect(pos.addToCart).not.toHaveBeenCalled();
  });
});

describe("D62 — the cart corrects a copy line when the server answers", () => {
  const NO_CUSTOMERS = [];
  const NO_FLAGS = {};
  const hook = () => renderHook(() => useCart({
    selectedOutletId: 1, selectedCustomerId: "", customers: NO_CUSTOMERS, posFlags: NO_FLAGS, showNotice: pos.showNotice,
  }));
  const copy = { ...POP, stock_unknown: true };

  it("takes the server's price and stock; notes the price change and out of stock", () => {
    const { result } = hook();
    act(() => { result.current.addToCart(copy); });
    expect(result.current.cart[0].price).toBe(250);
    act(() => { result.current.confirmCopyLine(copy, { ...POP, price: "300.00", local_stock: 0 }); });
    const line = result.current.cart[0];
    expect(line).toMatchObject({ price: 300, originalPrice: 300, availableStock: 0, stock_unknown: false, quantity: 1 });
    expect(pos.showNotice).toHaveBeenCalledWith(expect.stringMatching(/POP TUBES.*300/));
    expect(pos.showNotice).toHaveBeenCalledWith("Note: Item is out of stock — selling on override.");
  });

  it("same price and in stock: no notes, just the real stock", () => {
    const { result } = hook();
    act(() => { result.current.addToCart(copy); });
    act(() => { result.current.confirmCopyLine(copy, { ...POP, local_stock: 12 }); });
    expect(result.current.cart[0]).toMatchObject({ price: 250, availableStock: 12, stock_unknown: false });
    expect(pos.showNotice).not.toHaveBeenCalled();
  });

  it("a price the cashier already changed is left alone", () => {
    const { result } = hook();
    act(() => { result.current.addToCart(copy); });
    act(() => { result.current.setCart((prev) => prev.map((x) => ({ ...x, price: 200, originalPrice: 200 }))); });
    act(() => { result.current.confirmCopyLine(copy, { ...POP, price: "300.00", local_stock: 5 }); });
    expect(result.current.cart[0].price).toBe(200);
  });

  it("taking a copy line back out removes one, or the line when it was the only one", () => {
    const { result } = hook();
    act(() => { result.current.addToCart(copy); });
    act(() => { result.current.addToCart(copy); });
    expect(result.current.cart[0].quantity).toBe(2);
    act(() => { result.current.undoCopyLine(copy); });
    expect(result.current.cart[0].quantity).toBe(1);
    act(() => { result.current.undoCopyLine(copy); });
    expect(result.current.cart).toHaveLength(0);
  });
});

describe("D62 — the restaurant add-ons check", () => {
  it("is skipped unless the shop has the restaurant feature on", () => {
    const item = { id: 7, price: "250" };
    expect(needsModifierLookup(item, {})).toBe(false);
    expect(needsModifierLookup(item, { phase4_restaurant: false })).toBe(false);
    expect(needsModifierLookup(item, { phase4_restaurant: true })).toBe(true);
    expect(needsModifierLookup({ ...item, is_bundle: true }, { phase4_restaurant: true })).toBe(false);
    expect(needsModifierLookup({ ...item, stock_unknown: true }, { phase4_restaurant: true })).toBe(false);
  });
});
