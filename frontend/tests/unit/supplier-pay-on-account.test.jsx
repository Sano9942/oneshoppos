// One Toy Store pilot, D13: credit suppliers are paid lump sums ON ACCOUNT (cash
// by hand or bank transfer), not bill by bill; each supplier can carry an
// opening balance from the paper registers. Plus D36: the Payables page's
// Supplier Ledger tab read `amount` / `payment` / type "purchase", which the
// server never sends (it sends debit / credit / invoice | payment | ...), so
// every line showed "—" and was labelled "Payment".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const SUPPLIERS = [
  { id: 7, name: "TOYS AND TOYS LAHORE", payment_terms: "credit", credit_days: 60, credit_limit: 0, running_balance: 60000, opening_balance: 20000 },
  { id: 8, name: "BABY LAND LAHORE", payment_terms: "credit", credit_days: 30, credit_limit: 0, running_balance: -500, opening_balance: 0 },
];
const LEDGER = {
  supplier: SUPPLIERS[0],
  entries: [
    { date: "2026-09-20T10:00:00Z", type: "payment", reference: "TRX-1", debit: 0, credit: 45000, running_balance: 15000, notes: "Bank Transfer · on account" },
    { date: "2026-09-10T10:00:00Z", type: "invoice", reference: "B-1", debit: 40000, credit: 0, running_balance: 60000, notes: null },
    { date: "2026-09-01T00:00:00Z", type: "brought_forward", reference: "Balance brought forward", debit: 0, credit: 0, running_balance: 20000, notes: null },
  ],
  brought_forward: 20000,
  closing_balance: 15000,
  total_count: 2, page: 0, total_pages: 1,
};

const { apiState } = vi.hoisted(() => ({
  apiState: {
    get: vi.fn(),
    post: vi.fn(async () => ({ payment: { id: 1 }, balance: 15000 })),
    put: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {} }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

beforeEach(() => {
  apiState.post.mockClear();
  apiState.put.mockClear();
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: SUPPLIERS };
    if (url.startsWith("/api/supplier-ledger/7")) return LEDGER;
    if (url === "/api/supplier-aging") {
      return { aging: [{ id: 7, supplier_name: "TOYS AND TOYS LAHORE", invoice_count: 1, total_invoiced: 40000, total_paid: 0, total_due: 60000 }] };
    }
    if (url === "/api/supplier-invoices") return { invoices: [] };
    return {};
  });
});

async function paySupplier(dialogTitle) {
  const dialog = await screen.findByRole("dialog", { name: dialogTitle });
  fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "45000" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Bank Transfer" }));
  fireEvent.change(within(dialog).getByLabelText("Reference"), { target: { value: "TRX-1" } });
  fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-09-20" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Record payment" }));
}

describe("Suppliers page", () => {
  it("pays a supplier on account from its row", async () => {
    const { default: SuppliersRedesign } = await import("../../src/pages/redesign/SuppliersRedesign");
    render(<SuppliersRedesign />);
    const row = (await screen.findByText("TOYS AND TOYS LAHORE")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Pay" }));
    await paySupplier("Pay TOYS AND TOYS LAHORE");
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/suppliers/7/payments", {
      amount: 45000, payment_method: "Bank Transfer", reference: "TRX-1", notes: "", paid_at: "2026-09-20",
    }));
  });

  it("an advance (paid ahead) shows as an advance, not 'Clear'", async () => {
    const { default: SuppliersRedesign } = await import("../../src/pages/redesign/SuppliersRedesign");
    render(<SuppliersRedesign />);
    const row = (await screen.findByText("BABY LAND LAHORE")).closest("tr");
    expect(within(row).getByText(/Rs 500 advance/)).toBeTruthy();
  });

  it("the supplier form sends the opening balance", async () => {
    const { default: SuppliersRedesign } = await import("../../src/pages/redesign/SuppliersRedesign");
    render(<SuppliersRedesign />);
    const row = (await screen.findByText("TOYS AND TOYS LAHORE")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Supplier" });
    const opening = within(dialog).getByLabelText("Opening balance (owed on switchover day)");
    expect(opening.value).toBe("20000");
    fireEvent.change(opening, { target: { value: "25000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(apiState.put).toHaveBeenCalledWith("/api/suppliers/7", expect.objectContaining({ opening_balance: 25000 })));
  });
});

describe("Supplier Payables page", () => {
  it("pays on account from the aging list", async () => {
    const { default: SupplierPayablesRedesign } = await import("../../src/pages/redesign/SupplierPayablesRedesign");
    render(<SupplierPayablesRedesign />);
    const row = (await screen.findByText("TOYS AND TOYS LAHORE")).closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Pay on account" }));
    await paySupplier("Pay TOYS AND TOYS LAHORE");
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/suppliers/7/payments", expect.objectContaining({ amount: 45000 })));
  });

  it("D36: the ledger tab shows bills and payments in their columns, with the balance brought forward", async () => {
    const { default: SupplierPayablesRedesign } = await import("../../src/pages/redesign/SupplierPayablesRedesign");
    render(<SupplierPayablesRedesign />);
    fireEvent.click(await screen.findByRole("button", { name: "Supplier Ledger" }));
    fireEvent.change(await screen.findByLabelText("Supplier"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /View Ledger/ }));
    const bill = (await screen.findByText("B-1")).closest("tr");
    expect(within(bill).getByText("Bill")).toBeTruthy();
    expect(within(bill).getByText("Rs 40000")).toBeTruthy();
    const pay = screen.getByText("TRX-1").closest("tr");
    expect(within(pay).getByText("Payment")).toBeTruthy();
    expect(within(pay).getByText("Rs 45000")).toBeTruthy();
    expect(screen.getByText("Balance brought forward")).toBeTruthy();
  });
});
