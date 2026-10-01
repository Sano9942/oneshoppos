// One Toy Store pilot, F1 / D48 — a discount on an exchange's balance.
// Day 1 (INV-2026-00004): Pony Biting 950 back, Clay 990 out, the owner waived
// the Rs 40 difference in iPOS; SanoPOS had no way to, so it booked Card 40
// that was never taken.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pos, apiMock, perms } = vi.hoisted(() => ({
  pos: {},
  apiMock: { get: vi.fn(), post: vi.fn() },
  perms: { list: [] },
}));
vi.mock("../../src/pages/redesign/pos/POSContext", () => ({ usePOS: () => pos }));
vi.mock("../../src/api", () => ({ api: apiMock }));
vi.mock("../../src/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ fmt: (n) => `Rs ${Number(n || 0).toLocaleString("en-US")}` }),
}));
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ hasPerm: (p) => perms.list.includes("all_access") || perms.list.includes(p) }),
}));
vi.mock("../../src/pages/redesign/pos/POSRefundThresholdModal", () => ({ default: () => null }));

import POSReturnExchangeModal from "../../src/pages/redesign/pos/POSReturnExchangeModal";
import { exchangeSettlement } from "../../src/pages/redesign/pos/exchangeMath";

describe("exchangeSettlement (pure)", () => {
  it("no discount: customer pays the whole balance, the bill keeps its full price (D56)", () => {
    const s = exchangeSettlement({ refundTotal: 950, exchangeTotal: 990, discountInput: "", discountType: "fixed", settleMethod: "Card" });
    expect(s).toMatchObject({ balance: 40, discount: 0, due: 40, saleDiscountAmount: 0 });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 950 }, { method: "Card", amount: 40 }]);
  });

  it("day 1's case: Rs 40 waived → nothing to pay, no Card line", () => {
    const s = exchangeSettlement({ refundTotal: 950, exchangeTotal: 990, discountInput: "40", discountType: "fixed", settleMethod: "Card" });
    expect(s).toMatchObject({ balance: 40, discount: 40, due: 0, saleDiscountAmount: 40 });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 950 }]);
  });

  it("part waived: pays the rest", () => {
    const s = exchangeSettlement({ refundTotal: 950, exchangeTotal: 1100, discountInput: "50", discountType: "fixed", settleMethod: "Cash" });
    expect(s).toMatchObject({ balance: 150, discount: 50, due: 100, saleDiscountAmount: 50 });
    expect(s.payments).toEqual([{ method: "Return Credit", amount: 950 }, { method: "Cash", amount: 100 }]);
  });

  it("percent is of the balance, and a discount can never exceed the balance", () => {
    expect(exchangeSettlement({ refundTotal: 950, exchangeTotal: 1150, discountInput: "10", discountType: "percent", settleMethod: "Cash" }))
      .toMatchObject({ balance: 200, discount: 20, due: 180 });
    expect(exchangeSettlement({ refundTotal: 950, exchangeTotal: 990, discountInput: "500", discountType: "fixed", settleMethod: "Cash" }))
      .toMatchObject({ discount: 40, due: 0 });
    expect(exchangeSettlement({ refundTotal: 950, exchangeTotal: 990, discountInput: "150", discountType: "percent", settleMethod: "Cash" }))
      .toMatchObject({ discount: 40, due: 0 });
    expect(exchangeSettlement({ refundTotal: 950, exchangeTotal: 990, discountInput: "-5", discountType: "fixed", settleMethod: "Cash" }))
      .toMatchObject({ discount: 0, due: 40 });
  });

  it("even exchange and customer-owed exchange ignore any discount (nothing to waive)", () => {
    expect(exchangeSettlement({ refundTotal: 950, exchangeTotal: 950, discountInput: "40", discountType: "fixed", settleMethod: "Cash" }))
      .toMatchObject({ balance: 0, discount: 0, due: 0, saleDiscountAmount: 0, payments: [{ method: "Return Credit", amount: 950 }] });
    const owed = exchangeSettlement({ refundTotal: 950, exchangeTotal: 600, discountInput: "40", discountType: "fixed", settleMethod: "Cash" });
    expect(owed).toMatchObject({ balance: -350, discount: 0, due: 0 });
    expect(owed.payments).toEqual([{ method: "Return Credit", amount: 600 }]);
  });
});

function setup(permList) {
  perms.list = permList;
  for (const k of Object.keys(pos)) delete pos[k];
  Object.assign(pos, {
    returnModalOpen: true, setReturnModalOpen: vi.fn(),
    returnSourceSale: { id: 2 }, selectedOutletId: 1,
    employee: { id: 1 }, authHeaders: {}, printSlip: vi.fn(),
    outlets: [{ id: 1, name: "Main" }], showNotice: vi.fn(), setError: vi.fn(),
    posFlags: {}, setCollisionModal: vi.fn(), enqueueReturn: vi.fn(),
  });
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/api/return-reasons") return { reasons: [] };
    if (url === "/api/sales/2") {
      return {
        sale: { id: 2, invoice_number: "INV-2026-00002" },
        items: [{ product_id: 10, product_name: "Pony Biting", price_at_sale: 950, quantity: 1, refunded_qty: 0 }],
      };
    }
    if (url === "/api/sales/2/serials") return { serials: [] };
    if (url === "/api/products/search") return { products: [{ id: 20, name: "Clay", price: 990 }] };
    return {};
  });
  apiMock.post.mockImplementation(async (url) => (url === "/api/sales" ? { saleId: 99, invoiceNumber: "INV-2026-00099" } : { ok: true }));
  render(<POSReturnExchangeModal />);
}

async function exchangePonyForClay() {
  await screen.findByText("Pony Biting");
  fireEvent.click(screen.getByRole("button", { name: /Exchange for Other Items/ }));
  fireEvent.change(screen.getByPlaceholderText(/Search product to exchange for/), { target: { value: "clay" } });
  fireEvent.click(await screen.findByRole("button", { name: /Clay — Rs 990/ }, { timeout: 2000 }));
  await screen.findByText("Customer pays");
}

describe("Return / Exchange screen", () => {
  beforeEach(() => { perms.list = []; });

  it("lets a cashier with pos_discount waive the balance: no Card line is sent", async () => {
    setup(["pos_discount"]);
    await exchangePonyForClay();
    fireEvent.change(screen.getByLabelText(/Discount on balance/i), { target: { value: "40" } });
    expect(screen.getByTestId("exchange-due").textContent).toBe("Rs 0");
    fireEvent.click(screen.getByRole("button", { name: /Complete Exchange/ }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/api/returns", expect.anything()));
    const [, saleBody] = apiMock.post.mock.calls.find(([u]) => u === "/api/sales");
    expect(saleBody.payments).toEqual([{ method: "Return Credit", amount: 950 }]);
    expect(saleBody.discount_amount).toBe(40); // D56: only the real discount
    expect(saleBody.notes).toMatch(/Exchange for INV-2026-00002/);
    expect(saleBody.notes).toMatch(/discount Rs 40/i);
    const printed = pos.printSlip.mock.calls[0][0];
    expect(printed.balanceDue).toBe(0);
    expect(printed.exchangeDiscount).toBe(40);
  });

  it("hides the discount box from staff without pos_discount", async () => {
    setup([]);
    await exchangePonyForClay();
    expect(screen.queryByLabelText(/Discount on balance/i)).toBeNull();
    expect(screen.getByTestId("exchange-due").textContent).toBe("Rs 40");
  });
});

describe("Exchange slip", () => {
  it("prints the discount under Return Credit and a balance due of 0", async () => {
    const { buildReceiptSections } = await import("../../src/utils/receipt");
    const s = buildReceiptSections({
      cart: [{ name: "Clay", quantity: 1, price: 990 }],
      returnedItems: [{ name: "Pony Biting", quantity: 1, price: 950 }],
      payments: [{ method: "Return Credit", amount: 950 }],
      exchangeCredit: 950, exchangeDiscount: 40, balanceDue: 0,
    }, null, "Rs");
    expect(s.exchangeDiscount).toBe(40);
    expect(s.totalValue).toBe(0);
    expect(s.payments).toEqual([]);
  });
});
