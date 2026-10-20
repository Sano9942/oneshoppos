// One Toy Store, owner 2026-10-20 (live A2Z 171 read): on the check screen
// (1) any matched toy's selling price can be changed, not only when the bill
// changes its cost ("Change"); (2) a misread rate or line discount % can be
// corrected; cost per piece, the line total and the bill total follow (the
// line amount = billed × rate), so the toy's cost and the supplier's account
// stay together.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { billSummary, correctLine, savePayload, unitCost } from "../../src/pages/redesign/supplierBill/billMath";

configure({ asyncUtilTimeout: 5000 });

const LINE = { line_no: 1, page: 1, file_index: 0, supplier_code: "SL-150", description: "SLIME", qty: 10, rate: 125, amount: 1250, discount_pct: 5, check: "ok" };
const READ = { files: [{ file_name: "bill.pdf", kind: "pdf", sha256: "d".repeat(64), already: null }], layout: "hafiz_bill_no", layout_label: "Bill No", bill_number: "P1", bill_date: "2026-10-20", printed: { total: 1187.5 }, lines: [LINE], lines_total: 1187.5, total_matches: true, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null, needs_photo_reader: false };
// Cost on the toy = this bill's cost (118.75), so no rule suggestion / no "Use".
const TOY = { product_id: 11, name: "Slime", sku: "1001", price: 190, cost_price: 118.75 };

const { apiState, saves } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn() }, saves: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  saves.length = 0;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 3, name: "HAFIZ NAWAZ" }] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url === "/api/supplier-bills/waiting") return { items: [] };
    if (url.startsWith("/api/supplier-bills/same-number")) return { bills: [] };
    return {};
  });
  apiState.post.mockImplementation(async (url) => {
    if (url === "/api/supplier-bills/match") return { lines: [{ key: "0", matches: [TOY], chosen: [11] }] };
    return {};
  });
  apiState.upload.mockImplementation(async (url, fd) => {
    if (url === "/api/supplier-bills/read") return reply(READ);
    saves.push(JSON.parse(fd.get("payload")));
    return reply({ bill: { id: 9, bill_number: "P1", status: "saved" }, labels: [] }, 201);
  });
});

async function readBill() {
  const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
  const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole("option", { name: "HAFIZ NAWAZ" }).length).toBeGreaterThan(0));
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "3" } });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["%PDF-"], "bill.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Read bill" }));
  await screen.findByRole("button", { name: "Save bill" });
}

async function save() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
  await waitFor(() => expect(saves).toHaveLength(1));
  return saves[0];
}

describe("correcting a misread line (billMath)", () => {
  const line = { billed: 10, received: 10, rate: 125, amount: 1250, discount_pct: 5, split_into: 1, toys: [], suggestions: [] };

  it("a new rate sets the line amount to billed × rate; cost and totals follow; the read figure is kept", () => {
    const l = correctLine(line, { rate: 120 });
    expect(l).toMatchObject({ rate: 120, amount: 1200, discount_pct: 5, read_rate: 125, read_discount_pct: 5 });
    expect(unitCost(l)).toBe(114);
    expect(billSummary([l], 1140).total_matches).toBe(true);
  });

  it("a new discount % keeps the amount; cost follows", () => {
    const l = correctLine(line, { discount_pct: 10 });
    expect(l).toMatchObject({ rate: 125, amount: 1250, discount_pct: 10, read_discount_pct: 5 });
    expect(unitCost(l)).toBe(112.5);
  });

  it("a second correction keeps the first read figures; going back to them clears the mark", () => {
    const l = correctLine(correctLine(line, { rate: 120 }), { rate: 125 });
    expect(l.read_rate).toBe(125);
    expect(l.corrected).toBe(false);
    expect(correctLine(line, { rate: 120 }).corrected).toBe(true);
  });

  it("the saved line carries the corrected rate, discount and amount", () => {
    const l = { ...correctLine(line, { rate: 120, discount_pct: 0 }), line_no: 1, toys: [{ product_id: 11, qty: 10 }] };
    const p = savePayload({ supplierId: 3, outletId: 1, header: {}, result: {}, lines: [l] });
    expect(p.lines[0]).toMatchObject({ rate: 120, discount_pct: 0, amount: 1200 });
  });
});

describe("Receive supplier bill: changing prices and misread figures", { timeout: 20000 }, () => {
  it("(1) Change opens any matched toy's selling price, even when its cost didn't change", async () => {
    await readBill();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change the price of Slime" }));
    const box = screen.getByLabelText("New price of Slime");
    expect(box.value).toBe("190");
    fireEvent.change(box, { target: { value: "250" } });
    const p = await save();
    expect(p.lines[0].toys).toEqual([{ product_id: 11, qty: 10, new_price: 250 }]);
  });

  it("(2) correcting the rate changes cost per piece and the line total; the read figure is shown", async () => {
    await readBill();
    expect(screen.getByText("118.75")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Correct rate or discount, line 1" }));
    fireEvent.change(screen.getByLabelText("Rate, line 1"), { target: { value: "120" } });
    expect(screen.getByText("114")).toBeTruthy();
    expect(screen.getByText(/read as 125 − 5%/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Discount %, line 1"), { target: { value: "0" } });
    expect(screen.getByText("120")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Total written on the bill"), { target: { value: "1200" } });
    const p = await save();
    expect(p.lines[0]).toMatchObject({ rate: 120, discount_pct: 0, amount: 1200 });
  });
});
