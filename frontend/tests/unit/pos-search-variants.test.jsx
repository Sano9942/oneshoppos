// One Toy Store pilot, D24: picking a product with variants from the search list
// added the parent product itself, so the sale was booked against the parent and
// no variant's stock moved. It must open the variant picker, like a scan does.
import "fake-indexeddb/auto";
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { apiState, pos } = vi.hoisted(() => ({ apiState: { get: vi.fn(), raw: vi.fn() }, pos: {} }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/contexts/PresetContext", () => ({ usePreset: () => ({ labels: {}, pos_search_config: {} }) }));

vi.mock("../../src/pages/redesign/pos/POSOmniInput", () => ({ default: () => <input placeholder="Scan or type a code" /> }));

import POSSearchArea from "../../src/pages/redesign/pos/POSSearchArea";

const LEGO = { id: 1, name: "LEGO City Fire Truck", barcode: "5702017161000", price: "8500.00", local_stock: 3 };
const DRESS = { id: 25, name: "Doll Dress-Up Set", sku: "OTS-DRESS", price: "2400.00", has_variants: true, local_stock: 6 };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("pos_view_mode", "list");
  for (const k of Object.keys(pos)) delete pos[k];
  Object.assign(pos, {
    barcodeSearch: "", skuSearch: "", priceSearch: "", search: "d", handleSearchChange: vi.fn(),
    searchRef: { current: null }, results: [LEGO, DRESS], showResults: true, setShowResults: vi.fn(),
    addToCart: vi.fn(), money: (n) => `Rs ${n}`, posFlags: { phase2g_variant_picker: true },
    setPendingVariantProductId: vi.fn(), showNotice: vi.fn(),
  });
  apiState.get.mockImplementation(async (path) =>
    path === "/api/products/25/variants" ? { variants: [{ id: 4 }, { id: 5 }] } : { variants: [] });
});

describe("D24 — choosing a search result", () => {
  it("a product with variants opens the variant picker instead of adding the parent", async () => {
    render(<POSSearchArea />);
    fireEvent.click(screen.getByText("Doll Dress-Up Set"));
    await waitFor(() => expect(pos.setPendingVariantProductId).toHaveBeenCalledWith(25));
    expect(pos.addToCart).not.toHaveBeenCalled();
    expect(pos.setShowResults).toHaveBeenCalledWith(false);
  });

  it("Enter on the first result does the same", async () => {
    pos.results = [DRESS, LEGO];
    render(<POSSearchArea />);
    fireEvent.keyDown(screen.getByPlaceholderText(/Search products by name/), { key: "Enter" });
    await waitFor(() => expect(pos.setPendingVariantProductId).toHaveBeenCalledWith(25));
    expect(pos.addToCart).not.toHaveBeenCalled();
  });

  it("a plain product still goes straight into the cart", async () => {
    render(<POSSearchArea />);
    fireEvent.click(screen.getByText("LEGO City Fire Truck"));
    await waitFor(() => expect(pos.addToCart).toHaveBeenCalledWith(LEGO));
    expect(pos.setPendingVariantProductId).not.toHaveBeenCalled();
  });

  it("with the variant picker switched off, it says what to do instead of adding the parent", async () => {
    pos.posFlags = {};
    render(<POSSearchArea />);
    fireEvent.click(screen.getByText("Doll Dress-Up Set"));
    await waitFor(() => expect(pos.showNotice).toHaveBeenCalledWith(expect.stringMatching(/variant/i)));
    expect(pos.addToCart).not.toHaveBeenCalled();
  });
});

// D60 (owner 2026-10-02): the three small Barcode / SKU / Price boxes go while
// the top scan box is on (it takes codes; the F2 search finds the rest). They
// come back as a fallback if POS Power Features (the top box) is switched off.
describe("D60 — the Barcode / SKU / Price boxes", () => {
  const boxes = () => screen.queryAllByPlaceholderText(/^Search by (Barcode|SKU|Price)$/);

  it("are hidden while the top scan box is on", () => {
    pos.posFlags = { phase2g_omni_input: true, phase2g_variant_picker: true };
    render(<POSSearchArea />);
    expect(screen.getByPlaceholderText("Scan or type a code")).toBeTruthy();
    expect(boxes()).toHaveLength(0);
    expect(screen.getByPlaceholderText(/Search products by name/)).toBeTruthy();
  });

  it("come back when the top scan box is off", () => {
    pos.posFlags = {};
    render(<POSSearchArea />);
    expect(screen.queryByPlaceholderText("Scan or type a code")).toBeNull();
    expect(boxes()).toHaveLength(3);
  });
});
