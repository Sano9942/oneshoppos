// One Toy Store pilot (2026-09-29): Sales History → Reprint printed with no
// receipt template (no shop name, address or policy lines) and without item
// codes, discount or cashier. A reprint must match the till's slip.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const SALE = {
  id: 12, invoice_number: "INV-2026-00012", timestamp: "2026-09-29T08:24:00Z", total_amount: 8000,
  item_count: 1, voided: false, employee_name: "hassan", discount_amount: 950, discount_type: "fixed",
};
const TEMPLATE = { header_text: "ONE SHOP\nShop # G-017", footer_text: "Exchange within 3 days" };

const { apiState, printed } = vi.hoisted(() => ({
  printed: vi.fn(),
  apiState: {
    get: vi.fn(async (url) => {
      if (url.startsWith("/api/sales?")) return { sales: [SALE], total: 1, pages: 1, page: 1 };
      if (url === "/api/sales/12") {
        return {
          sale: SALE,
          items: [{ product_name: "ACTIVITY WALKER TRAINER-AW-994", sku: "2106", barcode: null, price_at_sale: 8950, quantity: 1 }],
          payments: [{ payment_method: "Card", amount: 8000 }],
        };
      }
      if (url === "/api/receipt-templates/active") return { template: TEMPLATE };
      return {};
    }),
  },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/utils/receipt", () => ({ buildReceiptHtml: printed }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {} }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${n}`, symbol: "Rs" }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));

describe("Sales History reprint", () => {
  it("prints with the shop's receipt template, item codes, discount and cashier", async () => {
    const { default: SalesHistoryRedesign } = await import("../../src/pages/redesign/SalesHistoryRedesign");
    render(<MemoryRouter><SalesHistoryRedesign /></MemoryRouter>);
    fireEvent.click(await screen.findByText("INV-2026-00012"));
    fireEvent.click(await screen.findByText("Reprint"));
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const [slip, template] = printed.mock.calls[0];
    expect(template).toEqual(TEMPLATE);
    expect(slip.cart[0]).toMatchObject({ name: "ACTIVITY WALKER TRAINER-AW-994", sku: "2106", price: 8950, quantity: 1 });
    expect(slip.discountAmount).toBe(950);
    expect(slip.employee).toEqual({ name: "hassan" });
  });
});
