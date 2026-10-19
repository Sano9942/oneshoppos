// One Toy Store G3: dashboard "Sales by Supplier (30d)" card (owner,
// 2026-10-19): top 10, Others, No supplier; each % a share of all sales.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

import { DashboardContribution } from "../../src/pages/dashboard/DashboardContribution";

const SUPPLIERS = {
  total: 8050,
  rows: [
    { supplier: "HAFIZ NAWAZ", revenue: 1100, contribution_pct: 13.66 },
    { supplier: "Others", revenue: 300, contribution_pct: 3.73 },
    { supplier: "No supplier", revenue: 500, contribution_pct: 6.21 },
    { supplier: "TOYS AND TOYS", revenue: -200, contribution_pct: -2.48 },
  ],
};

describe("G3 — Sales by supplier card", () => {
  it("lists each supplier with amount and share", () => {
    render(<DashboardContribution data={{ supplierContribution: SUPPLIERS }} />);
    const card = screen.getByTestId("supplier-contribution");
    expect(within(card).getByText("Sales by Supplier (30d)")).toBeTruthy();
    expect(card.textContent).toContain("HAFIZ NAWAZ");
    expect(card.textContent).toContain("Rs 1100 · 13.66%");
    expect(card.textContent).toContain("Others");
    expect(card.textContent).toContain("No supplier");
  });

  it("a supplier with more returned than sold shows a minus figure and an empty bar", () => {
    render(<DashboardContribution data={{ supplierContribution: SUPPLIERS }} />);
    const card = screen.getByTestId("supplier-contribution");
    expect(card.textContent).toContain("Rs -200 · -2.48%");
    const bars = card.querySelectorAll("[data-bar]");
    expect(bars[bars.length - 1].style.width).toBe("0%");
  });

  it("shows nothing when there were no sales", () => {
    render(<DashboardContribution data={{ supplierContribution: { total: 0, rows: [] } }} />);
    expect(screen.queryByTestId("supplier-contribution")).toBeNull();
  });
});
