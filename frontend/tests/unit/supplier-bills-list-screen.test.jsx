// One Toy Store F9 (f): Supplier bills. Owner: bill files "listed on the
// supplier's page"; every bill shows who saved it.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 5000 });

const BILLS = [
  { id: 7, supplier_id: 6, supplier_name: "HAFIZ NAWAZ", bill_number: "M100", bill_date: "2026-10-05", status: "saved", amount: "68195.00", lines: 25, files: 1, saved_at: "2026-10-05T10:00:00Z", saved_by_name: "Hassan", paid_now_method: "cheque", paid_now_amount: "10000" },
  { id: 5, supplier_id: 6, supplier_name: "HAFIZ NAWAZ", bill_number: "01", bill_date: "2026-10-01", status: "undone", amount: "1500.00", lines: 1, files: 0, saved_at: "2026-10-01T10:00:00Z", saved_by_name: "Hassan", undo_reason: "wrong supplier" },
];
const BILL = {
  ...BILLS[0], outlet_name: "Packages Mall", paid_now_reference: "CHQ 7 Meezan",
  files: [{ id: 1, file_name: "M100.pdf", content_type: "application/pdf", storage_key: "https://api.sanopos.com/r2/supplier-bills/ots/abc.pdf?exp=1&sig=x" }],
  lines: [{ id: 11, line_no: "4", page: 1, supplier_code: "B0444", description: "CAPTAIN AMERICA SHIELD", billed_qty: "2", received_qty: "1", rate: "995", discount_pct: "0", amount: "1990", split_into: 1, unit_cost: "995", is_new_product: false,
    matched_qty: "2", toys: [{ product_id: 3, name: "Shield", sku: "2703", qty: "1", extra_qty: "0" }] }],
  entries: [{ id: 2, kind: "not_received", amount: "-995", entry_date: "2026-10-05", note: "Line 4: 1 of 2 not received" }],
};

const { apiState, calls } = vi.hoisted(() => ({ apiState: { get: vi.fn() }, calls: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

beforeEach(() => {
  calls.length = 0;
  apiState.get.mockImplementation(async (url) => {
    calls.push(url);
    if (url === "/api/suppliers") return { suppliers: [{ id: 6, name: "HAFIZ NAWAZ" }, { id: 7, name: "BABY LAND" }] };
    if (url.startsWith("/api/supplier-bills?")) return { bills: BILLS, total: 2 };
    if (url === "/api/supplier-bills/7") return { bill: BILL };
    return {};
  });
});

async function page(url = "/supplier-bills?supplier_id=6") {
  const { default: Page } = await import("../../src/pages/redesign/SupplierBillsRedesign");
  render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
  return screen.findByTestId("supplier-bills");
}

describe("Supplier bills", { timeout: 20000 }, () => {
  it("opens on the supplier from the Suppliers page and lists bills with who saved them", async () => {
    const table = await page();
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/supplier-bills?") && u.includes("supplier_id=6"))).toBe(true));
    expect(await within(table).findByText("M100")).toBeTruthy();
    expect(within(table).getAllByText(/· Hassan$/)).toHaveLength(2);
    expect(within(table).getByText("Undone")).toBeTruthy();
    expect(within(table).getByText(/Paid now Rs 10000 · Cheque/)).toBeTruthy();
    expect(await screen.findByText("Supplier bills: HAFIZ NAWAZ")).toBeTruthy();
  });

  it("Open shows the files, the lines with their toys and the account entries", async () => {
    const table = await page();
    fireEvent.click((await within(table).findAllByRole("button", { name: "Open" }))[0]);
    const lines = await screen.findByTestId("supplier-bill-lines");
    expect(within(lines).getByText("CAPTAIN AMERICA SHIELD")).toBeTruthy();
    expect(within(lines).getByText(/Shield · 1/)).toBeTruthy();
    expect(within(lines).getByText("2 pcs were extras already in the shop")).toBeTruthy();
    const link = screen.getByRole("link", { name: "M100.pdf" });
    expect(link.getAttribute("href")).toBe(BILL.files[0].storage_key);
    expect(screen.getByText(/Not received Rs -995/)).toBeTruthy();
    expect(screen.getByText(/CHQ 7 Meezan/)).toBeTruthy();
  });

  it("a file kept on a PC without R2 opens from the API", async () => {
    const { billFileHref } = await import("../../src/pages/redesign/supplierBill/billFiles");
    expect(billFileHref("uploads/supplier-bills/ots/abc.pdf")).toMatch(/^http:\/\/localhost:\d+\/uploads\/supplier-bills\/ots\/abc\.pdf$/);
    expect(billFileHref("")).toBeNull();
  });
});
