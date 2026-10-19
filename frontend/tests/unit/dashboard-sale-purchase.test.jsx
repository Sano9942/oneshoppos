// One Toy Store G5: dashboard "Sale vs Purchase (7 days)" card — one row per
// shop day (Sale, Purchase, Sale − Purchase, a minus in red) and a 7-day
// total row; finance roles only (owner, 2026-10-19).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

import { DashboardSalePurchase } from "../../src/pages/dashboard/DashboardSalePurchase";

const ROWS = [
  { day: "2026-10-13", sales_total: "400.00", purchase_total: "0.00" },
  { day: "2026-10-14", sales_total: "0", purchase_total: "0" },
  { day: "2026-10-15", sales_total: "0", purchase_total: "0" },
  { day: "2026-10-16", sales_total: "0.00", purchase_total: "1000.00" },
  { day: "2026-10-17", sales_total: "700.00", purchase_total: "0.00" },
  { day: "2026-10-18", sales_total: "0", purchase_total: "0" },
  { day: "2026-10-19", sales_total: "1300.00", purchase_total: "500.00" },
];

describe("G5 — Sale vs Purchase card", () => {
  it("shows one row per day, newest first, with sale, purchase and difference", () => {
    render(<DashboardSalePurchase data={{ salePurchaseComparison: ROWS }} canFinancial />);
    const card = screen.getByTestId("sale-purchase");
    expect(within(card).getByText("Sale vs Purchase (7 days)")).toBeTruthy();
    const rows = within(card).getAllByTestId("sale-purchase-day");
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain("Today");
    expect(rows[0].textContent).toContain("Rs 1300");
    expect(rows[0].textContent).toContain("Rs 500");
    expect(rows[0].textContent).toContain("Rs 800");
    expect(rows[3].textContent).toContain("16 Oct");
  });

  it("a day that bought more than it sold shows the difference in red with a minus", () => {
    render(<DashboardSalePurchase data={{ salePurchaseComparison: ROWS }} canFinancial />);
    const day = screen.getAllByTestId("sale-purchase-day")[3];
    const diff = within(day).getByTestId("sale-purchase-diff");
    expect(diff.textContent).toBe("−Rs 1000");
    expect(diff.className).toContain("--ui-danger");
  });

  it("adds a 7-day total row", () => {
    render(<DashboardSalePurchase data={{ salePurchaseComparison: ROWS }} canFinancial />);
    const total = screen.getByTestId("sale-purchase-total");
    expect(total.textContent).toContain("7 days");
    expect(total.textContent).toContain("Rs 2400");
    expect(total.textContent).toContain("Rs 1500");
    expect(total.textContent).toContain("Rs 900");
  });

  it("is hidden without the finance permission", () => {
    const { container } = render(
      <DashboardSalePurchase data={{ salePurchaseComparison: ROWS }} canFinancial={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("is hidden when the server sent no purchase figures", () => {
    const salesOnly = ROWS.map(({ day, sales_total }) => ({ day, sales_total }));
    const { container } = render(<DashboardSalePurchase data={{ salePurchaseComparison: salesOnly }} canFinancial />);
    expect(container.innerHTML).toBe("");
  });
});
