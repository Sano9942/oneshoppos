// One Toy Store pilot D56 (2026-10-01, INV-00082): Water Game Large 590 back,
// Water Game 269D4 390 out, the customer got Rs 200 cash back. The screen
// saved the return as "Return Credit" and the new bill as 390 − a 590
// discount, so the 200 never came off the drawer. Now: the new bill is at its
// real price, paid by Return Credit; the return keeps its value, says how much
// of it was spent (credit_applied) and the real method of the rest; the slip
// reads Returned / New items / Difference / Paid back to customer.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pos, apiMock } = vi.hoisted(() => ({
  pos: {},
  apiMock: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: apiMock }));
vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ fmt: (n) => `Rs ${Number(n || 0).toLocaleString("en-US")}` }),
}));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ hasPerm: () => true }) }));
vi.mock("../../src/pages/redesign/pos/POSRefundThresholdModal", () => ({ default: () => null }));

import POSReturnExchangeModal from "../../src/pages/redesign/pos/POSReturnExchangeModal";
import { exchangeSettlement } from "../../src/pages/redesign/pos/exchangeMath";
import { buildReceiptSections, buildReceiptHtml, exchangeSummary } from "../../src/utils/receipt";

describe("exchangeSettlement: the new bill at its real price", () => {
  it("INV-00082: 590 back, 390 out, Cash back → Return Credit 390, no discount, 200 back by Cash", () => {
    const s = exchangeSettlement({ refundTotal: 590, exchangeTotal: 390, discountInput: "", discountType: "fixed", settleMethod: "Cash" });
    expect(s).toMatchObject({
      balance: -200, due: 0, saleDiscountAmount: 0,
      creditApplied: 390, returnMethod: "Cash", moneyBack: 200,
    });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 390 }]);
  });

  it("customer pays more: 590 back, 1,000 out, 60 off → Return Credit 590 + Cash 350, discount 60 only", () => {
    const s = exchangeSettlement({ refundTotal: 590, exchangeTotal: 1000, discountInput: "60", discountType: "fixed", settleMethod: "Cash" });
    expect(s).toMatchObject({
      balance: 410, discount: 60, due: 350, saleDiscountAmount: 60,
      creditApplied: 590, returnMethod: "Return Credit", moneyBack: 0,
    });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 590 }, { method: "Cash", amount: 350 }]);
  });

  it("even exchange: Return Credit covers the bill, nothing back", () => {
    const s = exchangeSettlement({ refundTotal: 590, exchangeTotal: 590, discountInput: "", discountType: "fixed", settleMethod: "Cash" });
    expect(s).toMatchObject({ balance: 0, saleDiscountAmount: 0, creditApplied: 590, returnMethod: "Return Credit", moneyBack: 0 });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 590 }]);
  });
});

function setup() {
  for (const k of Object.keys(pos)) delete pos[k];
  Object.assign(pos, {
    returnModalOpen: true, setReturnModalOpen: vi.fn(),
    returnSourceSale: { id: 81 }, selectedOutletId: 1,
    employee: { id: 1 }, authHeaders: {}, printSlip: vi.fn(),
    outlets: [{ id: 1, name: "Main" }], showNotice: vi.fn(), setError: vi.fn(),
    posFlags: {}, setCollisionModal: vi.fn(), enqueueReturn: vi.fn(),
  });
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/api/return-reasons") return { reasons: [] };
    if (url === "/api/sales/81") {
      return {
        sale: { id: 81, invoice_number: "INV-2026-00081" },
        items: [{ product_id: 10, product_name: "Water Game Large", price_at_sale: 590, quantity: 1, refunded_qty: 0 }],
      };
    }
    if (url === "/api/sales/81/serials") return { serials: [] };
    if (url === "/api/products/search") return { products: [{ id: 20, name: "Water Game 269D4", price: 390 }] };
    return {};
  });
  apiMock.post.mockImplementation(async (url) => (url === "/api/sales" ? { saleId: 82, invoiceNumber: "INV-2026-00082" } : { ok: true }));
  render(<POSReturnExchangeModal />);
}

describe("Return / Exchange screen sends the new shape", () => {
  afterEach(() => vi.clearAllMocks());

  it("INV-00082: sale at 390 paid by Return Credit; return 590 by Cash with 390 credit applied", async () => {
    setup();
    await screen.findByText("Water Game Large");
    fireEvent.click(screen.getByRole("button", { name: /Exchange for Other Items/ }));
    fireEvent.change(screen.getByPlaceholderText(/Search product to exchange for/), { target: { value: "water" } });
    fireEvent.click(await screen.findByRole("button", { name: /Water Game 269D4 — Rs 390/ }, { timeout: 2000 }));
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    fireEvent.click(screen.getByRole("button", { name: /Complete Exchange/ }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/api/returns", expect.anything()));
    const [, saleBody] = apiMock.post.mock.calls.find(([u]) => u === "/api/sales");
    expect(saleBody.payments).toEqual([{ method: "Return Credit", amount: 390 }]);
    expect(saleBody.discount_amount).toBe(0);
    expect(saleBody.exchange_full_price).toBe(true);
    const [, retBody] = apiMock.post.mock.calls.find(([u]) => u === "/api/returns");
    expect(retBody).toMatchObject({ total_refund: 590, refund_method: "Cash", credit_applied: 390 });

    const printed = pos.printSlip.mock.calls[0][0];
    expect(printed.exchangeSettle).toEqual({ direction: "back", method: "Cash", amount: 200 });
  });
});

const EXCHANGE_SLIP = {
  invoiceNumber: "INV-2026-00082",
  cart: [{ name: "Water Game 269D4", quantity: 1, price: 390 }],
  returnedItems: [{ name: "Water Game Large", quantity: 1, price: 590 }],
  returnedFrom: "INV-2026-00081",
  payments: [{ method: "Return Credit", amount: 390 }],
  exchangeCredit: 590,
  exchangeDiscount: 0,
  balanceDue: -200,
  exchangeSettle: { direction: "back", method: "Cash", amount: 200 },
};

describe("Exchange slip: Returned / New items / Difference / Paid back", () => {
  it("summary for money back", () => {
    expect(exchangeSummary(EXCHANGE_SLIP)).toEqual({
      returned: 590, newItems: 390, discount: 0, difference: -200,
      settle: { label: "Paid back to customer", method: "Cash", amount: 200 },
    });
    expect(buildReceiptSections(EXCHANGE_SLIP, null, "Rs").exchange).toEqual(exchangeSummary(EXCHANGE_SLIP));
  });

  it("summary for customer pays", () => {
    const slip = {
      ...EXCHANGE_SLIP,
      cart: [{ name: "Big Car", quantity: 1, price: 1000 }],
      exchangeDiscount: 60,
      payments: [{ method: "Return Credit", amount: 590 }, { method: "Online - JazzCash", amount: 350 }],
      exchangeSettle: { direction: "pay", method: "Online - JazzCash", amount: 350 },
    };
    expect(exchangeSummary(slip)).toEqual({
      returned: 590, newItems: 1000, discount: 60, difference: 350,
      settle: { label: "Customer pays", method: "Online - JazzCash", amount: 350 },
    });
  });

  it("a plain sale has no exchange summary", () => {
    expect(exchangeSummary({ cart: [{ name: "x", quantity: 1, price: 5 }] })).toBeNull();
  });

  it("prints the new lines, not 'Return Credit' / 'Balance due' / 'Refund to Customer'", async () => {
    await buildReceiptHtml(EXCHANGE_SLIP, null, "Rs", {}, { onPrint: () => {} });
    const d = document.getElementById("sanopos-receipt-frame").contentDocument;
    const text = d.body.textContent.replace(/\s+/g, " ");
    const rows = [...d.querySelectorAll(".row")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toContainEqual(["Returned", "-590.00"]);
    expect(rows).toContainEqual(["New items", "390.00"]);
    expect(rows).toContainEqual(["Difference", "-200.00"]);
    expect(rows).toContainEqual(["Paid back to customer: Cash", "200.00"]);
    expect(text).not.toContain("Refund to Customer");
    expect(text).not.toContain("BALANCE DUE");
    document.getElementById("sanopos-receipt-frame")?.remove();
  });

  it("the on-screen receipt shows the same lines", async () => {
    const { default: POSReceiptModal } = await import("../../src/pages/redesign/pos/POSReceiptModal");
    for (const k of Object.keys(pos)) delete pos[k];
    Object.assign(pos, {
      slipOpen: true, setSlipOpen: vi.fn(), slip: EXCHANGE_SLIP,
      money: (n) => `Rs ${Number(n || 0).toLocaleString("en-US")}`, printSlip: vi.fn(),
      receiptTemplate: null, currencySymbol: "Rs", presetLabels: {},
    });
    render(<POSReceiptModal />);
    expect(await screen.findByText("Paid back to customer: Cash")).toBeTruthy();
    expect(screen.getByText("Difference")).toBeTruthy();
    expect(screen.queryByText("Refund to Customer")).toBeNull();
  });
});
