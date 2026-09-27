// One Toy Store pilot, Phase B step 7: the product History tab. Three views:
// stock ledger (branch picker incl. "All branches", per variant, running
// balance, on-hand now), price & cost changes (old → new, who, why) and sales
// by bill no (returns as minus lines, voided bills marked, bill no links to
// the bill in Sales History).
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

const STOCK = {
  on_hand: "8.000",
  items: [
    { id: 3, outlet_id: 1, outlet_name: "Packages Mall", qty_change: "-2.000", balance: "8.000", kind: "sale",
      ref_type: "sale", ref_id: 11, ref_no: "INV-2026-00011", employee_name: "Owner", created_at: "2026-09-27T10:00:00Z" },
    { id: 2, outlet_id: 1, outlet_name: "Packages Mall", qty_change: "5.000", balance: "10.000", kind: "delivery",
      ref_type: "grn", ref_id: 4, ref_no: "GRN-0004", employee_name: "Owner", created_at: "2026-09-26T10:00:00Z" },
    { id: 1, outlet_id: 1, outlet_name: "Packages Mall", qty_change: "5.000", balance: "5.000", kind: "opening",
      ref_type: null, ref_id: null, ref_no: null, employee_name: null, created_at: "2026-09-25T10:00:00Z" },
    { id: 0, outlet_id: 1, outlet_name: "Packages Mall", qty_change: "1.000", balance: "1.000", kind: null,
      ref_type: null, ref_id: null, ref_no: null, employee_name: null, created_at: "2026-09-24T10:00:00Z" },
  ],
};
const PRICES = {
  items: [
    { id: 2, field: "price", variant_id: null, variant_sku: null, old_value: "300.00", new_value: "350.00",
      kind: "price_sheet", ref_no: null, employee_name: "Owner", changed_at: "2026-09-27T09:00:00Z" },
    { id: 1, field: "cost_price", variant_id: null, variant_sku: null, old_value: "150.00", new_value: "170.00",
      kind: "delivery", ref_no: "GRN-0004", employee_name: "Owner", changed_at: "2026-09-26T09:00:00Z" },
  ],
};
const SALES = {
  items: [
    { line_type: "return", line_id: 9, sale_id: 11, invoice_number: "INV-2026-00011", at: "2026-09-27T12:00:00Z",
      variant_sku: null, quantity: "-1.000", price: "300.00", cashier: "Ali", outlet_name: "Packages Mall", voided: false },
    { line_type: "sale", line_id: 8, sale_id: 11, invoice_number: "INV-2026-00011", at: "2026-09-27T10:00:00Z",
      variant_sku: null, quantity: "2.000", price: "300.00", cashier: "Ali", outlet_name: "Packages Mall", voided: false },
    { line_type: "sale", line_id: 7, sale_id: 10, invoice_number: "INV-2026-00010", at: "2026-09-26T10:00:00Z",
      variant_sku: null, quantity: "1.000", price: "300.00", cashier: "Ali", outlet_name: "Packages Mall", voided: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }, { id: 2, name: "Store Room" }] };
    if (url.startsWith("/api/products/7/history/stock")) return STOCK;
    if (url.startsWith("/api/products/7/history/prices")) return PRICES;
    if (url.startsWith("/api/products/7/history/sales")) return SALES;
    return {};
  });
});

async function renderHistory(props = {}) {
  const { default: ProductHistory } = await import("../../src/pages/redesign/ProductHistory");
  render(<MemoryRouter><ProductHistory productId={7} variants={[]} {...props} /></MemoryRouter>);
}

describe("product History tab", () => {
  it("stock: movements with what/why, document no, who, change and balance; on hand now", async () => {
    await renderHistory();
    const table = await screen.findByTestId("history-stock");
    await within(table).findByText("INV-2026-00011");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Sale/);
    expect(rows[0].textContent).toContain("−2");
    expect(rows[0].textContent).toContain("8");
    expect(rows[1].textContent).toMatch(/Delivery/);
    expect(rows[1].textContent).toContain("GRN-0004");
    expect(rows[1].textContent).toContain("+5");
    expect(rows[2].textContent).toMatch(/Opening stock/);
    expect(rows[3].textContent).toMatch(/Other change/);
    expect(screen.getByTestId("history-on-hand").textContent).toContain("8");
    // the bill no links to the bill in Sales History
    expect(within(table).getByRole("link", { name: "INV-2026-00011" }).getAttribute("href")).toBe("/sales-history?q=INV-2026-00011");
  });

  it("stock: the branch picker reloads that branch; 'All branches' by default", async () => {
    await renderHistory();
    await screen.findByTestId("history-stock");
    expect(apiState.get).toHaveBeenCalledWith("/api/products/7/history/stock?outlet_id=all");
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "2" } });
    await waitFor(() => expect(apiState.get).toHaveBeenCalledWith("/api/products/7/history/stock?outlet_id=2"));
  });

  it("variant picker: stock and sales for one variant", async () => {
    await renderHistory({ variants: [{ id: 70, sku: "HW-RED", options: [] }] });
    await screen.findByTestId("history-stock");
    fireEvent.change(screen.getByLabelText("Variant"), { target: { value: "70" } });
    await waitFor(() => expect(apiState.get).toHaveBeenCalledWith("/api/products/7/history/stock?outlet_id=all&variant_id=70"));
  });

  it("prices: old → new, which price, who and why", async () => {
    await renderHistory();
    fireEvent.click(await screen.findByRole("tab", { name: "Price & cost" }));
    const table = await screen.findByTestId("history-prices");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Selling price/);
    expect(rows[0].textContent).toContain("Rs 300");
    expect(rows[0].textContent).toContain("Rs 350");
    expect(rows[0].textContent).toMatch(/Price sheet/);
    expect(rows[0].textContent).toContain("Owner");
    expect(rows[1].textContent).toMatch(/Cost/);
    expect(rows[1].textContent).toMatch(/Delivery GRN-0004/);
  });

  it("sales: bill no links, returns as minus lines, voided bills marked", async () => {
    await renderHistory();
    fireEvent.click(await screen.findByRole("tab", { name: "Sales" }));
    const table = await screen.findByTestId("history-sales");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Return/);
    expect(rows[0].textContent).toContain("−1");
    expect(within(rows[1]).getByRole("link", { name: "INV-2026-00011" })).toBeTruthy();
    expect(rows[2].textContent).toMatch(/Voided/);
  });
});
