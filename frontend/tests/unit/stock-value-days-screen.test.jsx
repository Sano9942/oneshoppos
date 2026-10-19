// One Toy Store G2: Reports → Stock Value → "Saved by day". The stock value
// saved at each Close Shift, else nightly at 23:59 (owner, 2026-10-19),
// newest day first, each row saying which.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });

const DAYS = {
  rows: [
    { day: "2026-10-19", outlet_id: 1, outlet_name: "Packages Mall", source: "close_shift", shift_id: 6,
      taken_at: "2026-10-19T17:31:00Z", toys: 4436, units: 51230, cost_value: 13104512.5, retail_value: 31912040 },
    { day: "2026-10-18", outlet_id: 1, outlet_name: "Packages Mall", source: "nightly", shift_id: null,
      taken_at: "2026-10-18T18:59:00Z", toys: 4440, units: 51300, cost_value: 13120000, retail_value: 31950000 },
  ],
};

const { apiState, calls } = vi.hoisted(() => ({ apiState: { get: vi.fn() }, calls: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

let daysReply;
beforeEach(() => {
  calls.length = 0;
  daysReply = DAYS;
  apiState.get.mockImplementation(async (url) => {
    calls.push(url);
    if (url.startsWith("/api/reports/stock-value-days")) return daysReply;
    return { rows: [], totals: { toys: 0, units: 0, cost_value: 0, retail_value: 0, margin_pct: 0 } };
  });
});

async function byDay(filters = { outletIds: [], dateFrom: "", dateTo: "" }) {
  const { StockValueTab } = await import("../../src/pages/reports/ReportsInventoryCore");
  render(<StockValueTab filters={filters} />);
  const root = await screen.findByTestId("stock-value");
  fireEvent.click(within(root).getByRole("button", { name: "Saved by day" }));
  return root;
}

describe("G2 — Stock Value, saved by day", () => {
  it("lists each saved day, newest first, saying how it was saved", async () => {
    const root = await byDay();
    await waitFor(() => expect(within(root).getByTestId("stock-value-days")).toBeTruthy());
    expect(calls.at(-1)).toMatch(/^\/api\/reports\/stock-value-days/);
    const rows = within(root).getAllByTestId("stock-value-day");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("19 Oct 2026");
    expect(rows[0].textContent).toContain("At Close Shift");
    expect(rows[0].textContent).toContain("Rs 13104512.5");
    expect(rows[0].textContent).toContain("Rs 31912040");
    expect(rows[0].textContent).toContain("51,230");
    expect(rows[1].textContent).toContain("18 Oct 2026");
    expect(rows[1].textContent).toContain("Automatic (no shift closed)");
  });

  it("passes the page's dates and branch on", async () => {
    await byDay({ outletIds: [1], dateFrom: "2026-10-01", dateTo: "2026-10-19" });
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/reports/stock-value-days"))).toBe(true));
    const url = calls.find((u) => u.startsWith("/api/reports/stock-value-days"));
    expect(url).toMatch(/date_from=2026-10-01/);
    expect(url).toMatch(/date_to=2026-10-19/);
    expect(url).toMatch(/outlet_id=1/);
  });

  it("says when nothing has been saved yet", async () => {
    daysReply = { rows: [] };
    const root = await byDay();
    await waitFor(() => expect(within(root).getByText(/first figure is saved at the next Close Shift/)).toBeTruthy());
  });

  it("a failed load says so instead of 'nothing saved yet'", async () => {
    daysReply = null;
    apiState.get.mockImplementation(async (url) => {
      calls.push(url);
      if (url.startsWith("/api/reports/stock-value-days")) throw new Error("Failed to fetch");
      return { rows: [], totals: null };
    });
    const root = await byDay();
    await waitFor(() => expect(within(root).getByText(/Could not load the saved days/)).toBeTruthy());
    expect(within(root).queryByText(/Nothing saved yet/)).toBeNull();
  });

  it("Now goes back to the grouped table", async () => {
    const root = await byDay();
    await waitFor(() => expect(within(root).getByTestId("stock-value-days")).toBeTruthy());
    fireEvent.click(within(root).getByRole("button", { name: "Now" }));
    await waitFor(() => expect(calls.at(-1)).toMatch(/stock-value-summary/));
  });
});
