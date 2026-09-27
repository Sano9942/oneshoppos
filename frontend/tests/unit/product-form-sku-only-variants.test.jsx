// One Toy Store pilot, D27: a product whose variants have no attribute set
// (SKU-only variants, like the Hot Wheels singles) couldn't be saved from the
// edit screen ("Select an attribute set for variant products.") while the
// attribute-set box is locked on edit, so a variant's price couldn't be changed
// on screen. Its rows also showed as "Variant <id>" instead of their SKU.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, company: {}, hasPerm: () => true }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}`, symbol: "Rs" }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));
vi.mock("../../src/contexts/PresetContext", async (importOriginal) => ({
  ...(await importOriginal()),
  usePreset: () => ({ labels: {}, hasMode: () => false, unit_vocabulary: null, enabled_modes: [] }),
}));

const PRODUCT = {
  id: 9, name: "Hot Wheels Singles", price: 450, cost_price: 300, has_variants: true,
  attribute_set_id: null, bom_type: "standard", status: "active", unit: "pcs",
};
const VARIANTS = [
  { id: 90, sku: "HW-TWINMILL", barcode: "HW-TM-BC", price: 450, cost_price: 300, stock: 2, options: [] },
  { id: 91, sku: "HW-BONESHAKER", barcode: "HW-BS-BC", price: 450, cost_price: 300, stock: 3, options: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/attribute-sets") return { attributeSets: [{ id: 1, name: "Colour", attributes: [] }] };
    if (url === "/api/products/9") return { product: PRODUCT };
    if (url === "/api/products/9/variants") return { variants: VARIANTS };
    if (url === "/api/products/9/stock") return { stock: [] };
    if (url === "/api/products/9/reviews") return [];
    return {};
  });
  apiState.put.mockResolvedValue({ message: "ok" });
});

async function renderEdit() {
  const { default: ProductFormPage } = await import("../../src/pages/redesign/ProductFormPage");
  render(
    <MemoryRouter initialEntries={["/products/9"]}>
      <Routes><Route path="/products/:id" element={<ProductFormPage />} /></Routes>
    </MemoryRouter>,
  );
  return await screen.findByTestId("variant-row-90");
}

describe("product edit: SKU-only variants (no attribute set)", () => {
  it("labels each row by its SKU", async () => {
    const row = await renderEdit();
    expect(within(row).getByText("HW-TWINMILL")).toBeTruthy();
    expect(screen.queryByText(/^Variant \d+$/)).toBeNull();
  });

  it("saves a changed variant price", async () => {
    const row = await renderEdit();
    fireEvent.change(within(row).getByDisplayValue("450"), { target: { value: "475" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => expect(apiState.put).toHaveBeenCalledWith("/api/products/9", expect.anything()));
    const payload = apiState.put.mock.calls.find(([u]) => u === "/api/products/9")[1];
    expect(payload.variants.find((v) => v.id === 90).price).toBe(475);
    expect(payload.variants.find((v) => v.id === 91).price).toBe(450);
    expect(screen.queryByText(/Select an attribute set/)).toBeNull();
  });

  it("edit screen shows the History section (OTS step 7)", async () => {
    await renderEdit();
    expect(screen.getByTestId("product-history")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Price & cost" })).toBeTruthy();
  });
});
