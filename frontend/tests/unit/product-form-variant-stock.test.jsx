// One Toy Store pilot, D25: the product edit screen let you type a variant's
// stock and sent the count it had loaded back on save, erasing sales made while
// the screen was open. On edit, variant stock is shown read-only (like a simple
// product's) and never sent; stock moves through sales, receiving, adjustments
// and counts.
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
  id: 7, name: "Hot Wheels Single Car", price: 450, cost_price: 300, has_variants: true,
  attribute_set_id: 1, bom_type: "standard", status: "active", unit: "pcs",
};
const VARIANTS = [
  { id: 70, sku: "HW-RED", barcode: "HW-RED-BC", price: 450, cost_price: 300, stock: 6, options: [{ option_value: "Red" }] },
  { id: 71, sku: "HW-BLUE", barcode: "HW-BLUE-BC", price: 450, cost_price: 300, stock: 4, options: [{ option_value: "Blue" }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/attribute-sets") return { attributeSets: [{ id: 1, name: "Colour", attributes: [] }] };
    if (url === "/api/products/7") return { product: PRODUCT };
    if (url === "/api/products/7/variants") return { variants: VARIANTS };
    if (url === "/api/products/7/stock") return { stock: [] };
    if (url === "/api/products/7/reviews") return [];
    return {};
  });
  apiState.put.mockResolvedValue({ message: "ok" });
});

async function renderEdit() {
  const { default: ProductFormPage } = await import("../../src/pages/redesign/ProductFormPage");
  render(
    <MemoryRouter initialEntries={["/products/7"]}>
      <Routes><Route path="/products/:id" element={<ProductFormPage />} /></Routes>
    </MemoryRouter>,
  );
  return await screen.findByTestId("variant-row-70");
}

describe("product edit: variant stock", () => {
  it("shows each variant's stock read-only", async () => {
    const row = await renderEdit();
    expect(row.textContent).toContain("6");
    expect(within(row).queryByDisplayValue("6")).toBeNull(); // not an input
  });

  it("saving never sends variant stock", async () => {
    await renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => expect(apiState.put).toHaveBeenCalledWith("/api/products/7", expect.anything()));
    const payload = apiState.put.mock.calls.find(([u]) => u === "/api/products/7")[1];
    expect(payload.variants).toHaveLength(2);
    for (const v of payload.variants) expect(v).not.toHaveProperty("stock");
  });
});
