// One Toy Store pilot, blocker 3a: with the internet down, the cashier can still
// put items in the cart — by scanning, the PLU pad, the variant picker or search —
// from the counter's catalogue copy. Every test here failed before the fix:
// each input asked the server and gave up when it couldn't be reached.
import "fake-indexeddb/auto";
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, renderHook, act, within } from "@testing-library/react";

const { apiState, pos } = vi.hoisted(() => ({
  apiState: { raw: vi.fn(), get: vi.fn(), post: vi.fn() },
  pos: {},
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ company: {} }) }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));

import { refreshCatalogue, resetCatalogueForTests } from "../../src/utils/offlineCatalogue";
import POSOmniInput from "../../src/pages/redesign/pos/POSOmniInput";
import POSPluPad from "../../src/pages/redesign/pos/POSPluPad";
import POSVariantMatrixModal from "../../src/pages/redesign/pos/POSVariantMatrixModal";
import { useCart } from "../../src/pages/redesign/pos/hooks/useCart";

const CATALOGUE = {
  products: [
    { id: 1, name: "LEGO City Fire Truck", barcode: "5702017161000", sku: "LEGO-60374", plu_code: "6037", price: "8500.00", has_variants: false },
    { id: 2, name: "Hot Wheels Assortment", barcode: "0887961000001", sku: "HW-ASSORT", price: "450.00", has_variants: true },
  ],
  variants: [
    { id: 70, product_id: 2, sku: "HW-TWINMILL", barcode: "8901234567897", price: "450.00", options: [{ attribute_name: "Model", option_value: "Twin Mill" }] },
  ],
};
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(pos, {
    addToCart: vi.fn(), addDecodedLine: vi.fn(), showNotice: vi.fn(),
    setSearch: vi.fn(), setResults: vi.fn(), setShowResults: vi.fn(),
    setSelectedCustomerId: vi.fn(), setCustomerSearch: vi.fn(), setShowCustomerDD: vi.fn(),
    setPendingVariantProductId: vi.fn(), setPendingSerialProductId: vi.fn(), setPendingSerialContext: vi.fn(),
    pendingVariantProductId: null, selectedOutletId: 1, posFlags: { phase2g_variant_picker: true },
  });
  await resetCatalogueForTests();
  apiState.raw.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => CATALOGUE });
  await refreshCatalogue("default");
  // From here on the internet is down (shop Wi-Fi up, so the browser still says online).
  apiState.raw.mockImplementation(offline);
  apiState.get.mockImplementation(offline);
  apiState.post.mockImplementation(offline);
});
afterEach(() => { apiState.raw.mockReset(); apiState.get.mockReset(); apiState.post.mockReset(); });

function scanInto(input, code) {
  fireEvent.keyDown(input, { key: "Enter", currentTarget: { value: code }, target: { value: code } });
}

describe("scan box (POSOmniInput)", () => {
  it("a scanned barcode goes into the cart from the offline copy", async () => {
    render(<POSOmniInput />);
    const input = screen.getByPlaceholderText(/Scan, search/);
    input.value = "5702017161000";
    scanInto(input, "5702017161000");
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledTimes(1));
    expect(pos.addToCart.mock.calls[0][0]).toMatchObject({ id: 1, name: "LEGO City Fire Truck" });
  });

  it("a variant's own barcode adds that variant", async () => {
    render(<POSOmniInput />);
    const input = screen.getByPlaceholderText(/Scan, search/);
    input.value = "8901234567897";
    scanInto(input, "8901234567897");
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledTimes(1));
    expect(pos.addToCart.mock.calls[0][0]).toMatchObject({ id: 70, variant_id: 70, original_product_id: 2 });
  });

  it("a product with variants opens the picker", async () => {
    render(<POSOmniInput />);
    const input = screen.getByPlaceholderText(/Scan, search/);
    input.value = "0887961000001";
    scanInto(input, "0887961000001");
    await waitFor(() => expect(pos.setPendingVariantProductId).toHaveBeenCalledWith(2));
    expect(pos.addToCart).not.toHaveBeenCalled();
  });
});

describe("PLU pad", () => {
  it("a typed PLU goes into the cart from the offline copy", async () => {
    render(<POSPluPad />);
    fireEvent.click(screen.getByText(/PLU pad/));
    for (const d of "6037") fireEvent.click(screen.getByRole("button", { name: d }));
    fireEvent.click(screen.getByRole("button", { name: /add|enter|ok/i }));
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledTimes(1));
    expect(pos.addToCart.mock.calls[0][0]).toMatchObject({ id: 1 });
  });
});

describe("variant picker (POSVariantMatrixModal)", () => {
  it("shows the product's variants from the offline copy", async () => {
    pos.pendingVariantProductId = 2;
    render(<POSVariantMatrixModal />);
    expect(await screen.findByText("Twin Mill")).toBeTruthy();
  });

  it("an offline variant can be picked (stock unknown, not 'out of stock') and goes in the cart", async () => {
    pos.pendingVariantProductId = 2;
    render(<POSVariantMatrixModal />);
    const cell = await screen.findByTitle(/stock not known offline/i);
    expect(cell.disabled).toBe(false);
    fireEvent.click(cell);
    expect(pos.addToCart).toHaveBeenCalledTimes(1);
    expect(pos.addToCart.mock.calls[0][0]).toMatchObject({ id: 70, variant_id: 70, stock_unknown: true });
  });
});

describe("variant picker with SKU-only variants (D24)", () => {
  it("lists each variant by SKU so the cashier can pick the right one", async () => {
    apiState.get.mockImplementation(async (path) => {
      if (path === "/api/products/25") return { id: 25, name: "Doll Dress-Up Set", price: "2400.00" };
      if (path.startsWith("/api/products/25/variants")) return { variants: [
        { id: 4, product_id: 25, sku: "DRESS-PINK", price: "2400.00", stock_at_outlet: 3, options: [] },
        { id: 5, product_id: 25, sku: "DRESS-BLUE", price: "2400.00", stock_at_outlet: 2, options: [] },
      ] };
      throw new TypeError("Failed to fetch");
    });
    pos.pendingVariantProductId = 25;
    render(<POSVariantMatrixModal />);
    expect(await screen.findByText("DRESS-PINK")).toBeTruthy();
    fireEvent.click(within(screen.getByText("DRESS-BLUE").closest("tr")).getByRole("button"));
    expect(pos.addToCart).toHaveBeenCalledTimes(1);
    expect(pos.addToCart.mock.calls[0][0]).toMatchObject({ id: 5, variant_id: 5, name: "Doll Dress-Up Set (DRESS-BLUE)" });
  });
});

describe("search and cart (useCart)", () => {
  // Stable props: a new [] / {} each render re-runs the hook's effects forever.
  const NO_CUSTOMERS = [];
  const NO_FLAGS = {};
  const hook = () => {
    const showNotice = pos.showNotice;
    return renderHook(() => useCart({
      selectedOutletId: 1, selectedCustomerId: "", customers: NO_CUSTOMERS, posFlags: NO_FLAGS, showNotice,
    }));
  };

  it("typed search finds items in the offline copy", async () => {
    const { result } = hook();
    act(() => { result.current.triggerSearch("wheels"); });
    await waitFor(() => expect(result.current.results.map((p) => p.id)).toEqual([2]));
  });

  it("offline, the cashier is told automatic discounts are off (once)", async () => {
    const { result } = hook();
    const { products } = await import("../../src/utils/offlineCatalogue").then((m) => m.getCatalogueIndex());
    act(() => { result.current.addToCart(products.find((p) => p.id === 1)); });
    await waitFor(() => expect(pos.showNotice).toHaveBeenCalledWith("Automatic discounts are off while offline"));
    act(() => { result.current.addToCart(products.find((p) => p.id === 2)); });
    await new Promise((r) => setTimeout(r, 600));
    expect(pos.showNotice.mock.calls.filter(([m]) => /Automatic discounts/.test(m))).toHaveLength(1);
    expect(result.current.discountsOffline).toBe(true);
  });

  it("an item from the offline copy isn't called out of stock", async () => {
    const { result } = hook();
    const { products } = await import("../../src/utils/offlineCatalogue").then((m) => m.getCatalogueIndex());
    act(() => { result.current.addToCart(products.find((p) => p.id === 1)); });
    act(() => { result.current.addToCart(products.find((p) => p.id === 1)); });
    expect(result.current.cart[0].quantity).toBe(2);
    expect(pos.showNotice).not.toHaveBeenCalledWith(expect.stringMatching(/out of stock|past available stock/));
  });
});
