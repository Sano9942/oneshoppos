// One Toy Store pilot, Phase B step 6b: the label page's product search lists
// each variant as its own label (own barcode + price), never the parent of a
// product with variants, and the print log gets the variant id.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { buildLabelPickList, searchLabelPickList } from "../../src/pages/labelReprints";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

const PRODUCTS = [
  { id: 5, name: "Kite", barcode: "KITE-1", sku: "K1", price: "350.00", brand_name: "Wind", has_variants: false },
  { id: 7, name: "Hot Wheels Single Car", barcode: "HW-PARENT", sku: "HW", price: "450.00", brand_name: "Mattel", has_variants: true },
  { id: 8, name: "Doll Dress-Up Set", barcode: "", sku: "DRESS", price: "2400.00", brand_name: null, has_variants: true },
];
const VARIANTS = [
  { id: 70, product_id: 7, sku: "HW-TWINMILL", barcode: "027084120901", price: "475.00", options: [] },
  { id: 71, product_id: 7, sku: "HW-DEORA", barcode: "027084120903", price: "450.00", options: [] },
  { id: 80, product_id: 8, sku: "DRESS-PINK", barcode: "8690000900001", price: null, options: [{ attribute_name: "Colour", option_value: "Pink" }] },
];

describe("pick list", () => {
  it("lists each variant with its own barcode and price, and not the parent", () => {
    const list = buildLabelPickList(PRODUCTS, VARIANTS);
    expect(list.map((i) => [i.product_id, i.variant_id])).toEqual([[5, null], [7, 70], [7, 71], [8, 80]]);
    expect(list[1]).toMatchObject({
      name: "Hot Wheels Single Car – HW-TWINMILL", barcode: "027084120901", sku: "HW-TWINMILL", price: 475, brand: "Mattel",
    });
    // options name the variant when it has them; a blank variant price falls back to the parent's
    expect(list[3]).toMatchObject({ name: "Doll Dress-Up Set – Pink", price: 2400 });
  });

  it("search matches name, barcode or SKU, variants included", () => {
    const list = buildLabelPickList(PRODUCTS, VARIANTS);
    expect(searchLabelPickList(list, "twinmill").map((i) => i.variant_id)).toEqual([70]);
    expect(searchLabelPickList(list, "027084120903").map((i) => i.variant_id)).toEqual([71]);
    expect(searchLabelPickList(list, "hot wheels").map((i) => i.variant_id)).toEqual([70, 71]);
    expect(searchLabelPickList(list, "K1").map((i) => i.product_id)).toEqual([5]);
  });
});

describe("label page: adding a single variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn(() => null);
    window.alert = vi.fn();
    apiState.get.mockImplementation(async (url) => {
      if (url === "/api/label-reprints") return { items: [] };
      if (url === "/api/barcode-templates") return { templates: [{ id: 1, name: "Shelf", width_mm: 50, height_mm: 30, is_default: true, show_price: 1 }] };
      if (url === "/api/products") return { products: PRODUCTS };
      if (url === "/api/products/catalogue") return { version: "x", products: [], variants: VARIANTS };
      return {};
    });
    apiState.post.mockResolvedValue({ logged: 1 });
  });

  it("search finds the variant; printing logs it with its variant id, barcode and price", async () => {
    const { default: BarcodeTemplates } = await import("../../src/pages/BarcodeTemplates");
    render(<BarcodeTemplates />);
    await waitFor(() => expect(apiState.get).toHaveBeenCalledWith("/api/products/catalogue"));
    fireEvent.click(screen.getByRole("button", { name: /Print Labels/ }));
    fireEvent.change(screen.getByPlaceholderText(/Name, SKU or barcode/), { target: { value: "Hot Wheels" } });
    expect(screen.queryByRole("button", { name: /^Hot Wheels Single Car HW-PARENT$/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /HW-TWINMILL/ }));
    const queue = screen.getByTestId("print-queue");
    expect(within(queue).getByText("Hot Wheels Single Car – HW-TWINMILL")).toBeTruthy();

    const printBtns = screen.getAllByRole("button", { name: /Print Labels/ });
    fireEvent.click(printBtns[printBtns.length - 1]);
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/barcode-print-jobs", expect.anything()));
    const { items } = apiState.post.mock.calls.find(([u]) => u === "/api/barcode-print-jobs")[1];
    expect(items).toEqual([expect.objectContaining({
      product_id: 7, variant_id: 70, barcode: "027084120901", price: 475, copies: 1,
    })]);
  });
});
