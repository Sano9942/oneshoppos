// One Toy Store G1: Reports → Stock Value. One table, "Group by" Supplier /
// Category / Sub-category / Brand (owner, 2026-10-19), like iPOS's PSP summaries.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });

const BY = {
  supplier: {
    rows: [
      { name: "HAFIZ NAWAZ", parent: null, toys: 2, units: 12, cost_value: 3000, retail_value: 6000, margin_pct: 50, share_pct: 46.15 },
      { name: "No supplier", parent: null, toys: 1, units: 2, cost_value: 500, retail_value: 1000, margin_pct: 50, share_pct: 7.69 },
    ],
    totals: { toys: 3, units: 14, cost_value: 3500, retail_value: 7000, margin_pct: 50 },
  },
  subcategory: {
    rows: [{ name: "Remote Control Toys", parent: "Vehicles", toys: 1, units: 2, cost_value: 3000, retail_value: 5000, margin_pct: 40, share_pct: 100 }],
    totals: { toys: 1, units: 2, cost_value: 3000, retail_value: 5000, margin_pct: 40 },
  },
};

const { apiState, calls } = vi.hoisted(() => ({ apiState: { get: vi.fn() }, calls: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

beforeEach(() => {
  calls.length = 0;
  apiState.get.mockImplementation(async (url) => {
    calls.push(url);
    const g = new URL(url, "http://x").searchParams.get("group_by");
    return BY[g] || { rows: [], totals: { toys: 0, units: 0, cost_value: 0, retail_value: 0, margin_pct: 0 } };
  });
});

async function tab(filters = { outletIds: [] }) {
  const { StockValueTab } = await import("../../src/pages/reports/ReportsInventoryCore");
  render(<StockValueTab filters={filters} />);
  return screen.findByTestId("stock-value");
}

describe("G1 — Stock Value tab", () => {
  it("starts grouped by supplier and lists each supplier with a totals row", async () => {
    const root = await tab();
    await waitFor(() => expect(within(root).getByText("HAFIZ NAWAZ")).toBeTruthy());
    expect(calls[0]).toMatch(/^\/api\/reports\/stock-value-summary\?group_by=supplier/);
    const total = within(root).getByTestId("stock-value-total");
    expect(total.textContent).toContain("Rs 3500");
    expect(total.textContent).toContain("Rs 7000");
    expect(total.textContent).toContain("14");
    expect(within(root).getByText("No supplier")).toBeTruthy();
    expect(within(root).getByText("46.15%")).toBeTruthy();
  });

  it("switching to Sub-category asks again and shows the parent category", async () => {
    const root = await tab();
    await waitFor(() => expect(within(root).getByText("HAFIZ NAWAZ")).toBeTruthy());
    fireEvent.click(within(root).getByRole("button", { name: "Sub-category" }));
    await waitFor(() => expect(within(root).getByText("Remote Control Toys")).toBeTruthy());
    expect(calls.at(-1)).toMatch(/group_by=subcategory/);
    expect(within(root).getByText("Vehicles")).toBeTruthy();
  });

  it("passes the chosen branch on", async () => {
    await tab({ outletIds: [2] });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toMatch(/outlet_id=2/);
  });
});
