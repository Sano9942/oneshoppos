// One Toy Store G4: dashboard "This month" row (margin % today + month,
// month sale, month purchase) and the Top 50 items (30 days) card — top 10
// on the dashboard, "Show all 50" for the rest (owner, 2026-10-19).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

import { DashboardMonthRow, DashboardTopItems } from "../../src/pages/dashboard/DashboardMonth";

const DATA = {
  todayMarginPct: 33.33, todayGrossProfit: 600,
  monthMarginPct: 25, monthGrossMargin: 700,
  monthSales: 3300, monthPurchases: 125000,
  topItems30d: Array.from({ length: 50 }, (_, i) => ({
    product_id: i + 1, name: `Toy ${i + 1}`, barcode: `B${i + 1}`, units: 2, amount: 10000 - i * 100, margin_pct: 40,
  })),
};

describe("G4 — This month row", () => {
  it("shows margin % today and month with the amounts, month sale and purchase", () => {
    render(<DashboardMonthRow data={DATA} canFinancial />);
    const row = screen.getByTestId("dashboard-month");
    expect(row.textContent).toContain("Margin today");
    expect(row.textContent).toContain("33.33%");
    expect(row.textContent).toContain("Rs 600");
    expect(row.textContent).toContain("Margin this month");
    expect(row.textContent).toContain("25%");
    expect(row.textContent).toContain("Rs 700");
    expect(row.textContent).toContain("Month sale");
    expect(row.textContent).toContain("Rs 3300");
    expect(row.textContent).toContain("Month purchase");
    expect(row.textContent).toContain("Rs 125000");
  });

  it("no sale yet shows a dash, not 0%", () => {
    render(<DashboardMonthRow data={{ ...DATA, todayMarginPct: null }} canFinancial />);
    const tile = screen.getByTestId("margin-today");
    expect(tile.textContent).toContain("—");
    expect(tile.textContent).not.toContain("0%");
  });

  it("without the finance permission only Month sale shows", () => {
    render(<DashboardMonthRow data={{ monthSales: 3300 }} canFinancial={false} />);
    const row = screen.getByTestId("dashboard-month");
    expect(row.textContent).toContain("Month sale");
    expect(row.textContent).not.toContain("Margin");
    expect(row.textContent).not.toContain("Month purchase");
  });
});

describe("G4 — Top 50 items card", () => {
  it("shows the top 10 with units, amount and margin", () => {
    render(<DashboardTopItems data={DATA} canFinancial />);
    const card = screen.getByTestId("top-items");
    expect(within(card).getByText("Top 50 Items (30d)")).toBeTruthy();
    const rows = within(card).getAllByTestId("top-item");
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toContain("Toy 1");
    expect(rows[0].textContent).toContain("Rs 10000");
    expect(rows[0].textContent).toContain("40%");
    expect(rows[0].textContent).toContain("2");
    expect(card.textContent).not.toContain("Toy 11");
  });

  it("Show all 50 opens the full list", () => {
    render(<DashboardTopItems data={DATA} canFinancial />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 50" }));
    const all = screen.getByTestId("top-items-all");
    expect(within(all).getAllByTestId("top-item")).toHaveLength(50);
    expect(all.textContent).toContain("Toy 50");
  });

  it("without the finance permission there is no margin column", () => {
    const rows = DATA.topItems30d.map(({ margin_pct, ...r }) => r);
    render(<DashboardTopItems data={{ topItems30d: rows }} canFinancial={false} />);
    const card = screen.getByTestId("top-items");
    expect(card.textContent).not.toContain("Margin");
  });

  it("shows nothing when there were no sales", () => {
    render(<DashboardTopItems data={{ topItems30d: [] }} canFinancial />);
    expect(screen.queryByTestId("top-items")).toBeNull();
  });
});
