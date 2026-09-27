// One Toy Store pilot: Sales History listed bills as "#10" (the internal sale
// id), while receipts and a product's History tab show the invoice number
// (INV-2026-00010). Staff look bills up by the number on the receipt, so the
// list, the receipt heading and the CSV must show the invoice number too.
// A sale with no invoice number (older data) still shows "#id".
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const SALES = [
  { id: 10, invoice_number: "INV-2026-00010", timestamp: "2026-09-27T10:00:00Z", total_amount: 450, item_count: 1, voided: false },
  { id: 11, invoice_number: null, timestamp: "2026-09-27T11:00:00Z", total_amount: 300, item_count: 1, voided: false },
];

const { apiState } = vi.hoisted(() => ({
  apiState: {
    get: vi.fn(async (url) => {
      if (url.startsWith("/api/sales?")) return { sales: SALES, total: 2, pages: 1, page: 1 };
      if (url === "/api/sales/10") return { sale: SALES[0], items: [], payments: [] };
      return {};
    }),
  },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {} }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));

describe("Sales History bill no", () => {
  it("lists bills by invoice number, falling back to #id", async () => {
    const { default: SalesHistoryRedesign } = await import("../../src/pages/redesign/SalesHistoryRedesign");
    render(<MemoryRouter><SalesHistoryRedesign /></MemoryRouter>);
    const row = await screen.findByText("INV-2026-00010");
    expect(screen.queryByText("#10")).toBeNull();
    expect(screen.getByText("#11")).toBeTruthy();

    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText("Receipt INV-2026-00010")).toBeTruthy());
  });
});
