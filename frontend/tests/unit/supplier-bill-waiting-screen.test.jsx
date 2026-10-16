// One Toy Store F9 (f) 6/6: extra pieces waiting for the supplier's bill.
// Owner (2026-10-17): the later bill's line offers them pre-ticked "These are
// those pieces" (untick if different pieces): counted as received, stock not
// added again; Waiting for supplier's bill list with "No bill coming (free)".
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { applyWaiting, lineStatus, savePayload } from "../../src/pages/redesign/supplierBill/billMath";

configure({ asyncUtilTimeout: 5000 });

const LINE = { line_no: 1, page: 1, file_index: 0, supplier_code: "BL-1", description: "BALL", qty: 5, rate: 120, amount: 600, discount_pct: 0, check: "ok" };
const READ = { files: [{ file_name: "bill.pdf", kind: "pdf", sha256: "c".repeat(64), already: null }], layout: "hafiz_bill_no", layout_label: "Bill No", bill_number: "W2", bill_date: "2026-10-17", printed: { total: 600 }, lines: [LINE], lines_total: 600, total_matches: true, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null, needs_photo_reader: false };
const WAITING = [
  { id: 41, supplier_id: 3, supplier_name: "HAFIZ NAWAZ", product_id: 11, name: "Ball", sku: "1001", qty: "2", bill_number: "M100", bill_date: "2026-10-12", outlet_name: "Packages Mall", days: 5 },
  { id: 42, supplier_id: 4, supplier_name: "BABY LAND", product_id: 12, name: "Car", sku: "1002", qty: "1", bill_number: "B7", bill_date: "2026-10-10", days: 7 },
];

const { apiState, saves, posts } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn() }, saves: [], posts: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  saves.length = 0;
  posts.length = 0;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 3, name: "HAFIZ NAWAZ" }, { id: 4, name: "BABY LAND" }] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url === "/api/supplier-bills/waiting") return { items: WAITING };
    if (url.startsWith("/api/supplier-bills/same-number")) return { bills: [] };
    return {};
  });
  apiState.post.mockImplementation(async (url, body) => {
    posts.push({ url, body });
    if (url === "/api/supplier-bills/match") return { lines: [{ key: "0", matches: [{ product_id: 11, name: "Ball", sku: "1001" }], chosen: [11] }] };
    return { item: { id: 41, status: "free" } };
  });
  apiState.upload.mockImplementation(async (url, fd) => {
    if (url === "/api/supplier-bills/read") return reply(READ);
    saves.push(JSON.parse(fd.get("payload")));
    return reply({ bill: { id: 9, bill_number: "W2", status: "saved" }, labels: [] }, 201);
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

describe("matching waiting extras (billMath)", () => {
  const line = (over) => ({ key: "a", line_no: 1, billed: 5, received: 5, split_into: 1, is_new: false, is_return: false, toys: [{ product_id: 11, qty: 5 }], suggestions: [], ...over });

  it("offers the toy's waiting pieces, oldest first, once across lines, up to what the line billed", () => {
    const ws = [{ id: 1, product_id: 11, qty: "2" }, { id: 2, product_id: 11, qty: "4" }];
    const [a, b] = applyWaiting([line({ key: "a", billed: 3, received: 3 }), line({ key: "b" })], ws);
    expect(a.waiting_offer.map((w) => [w.id, w.qty])).toEqual([[1, 2], [2, 1]]);
    expect(a.toys[0].qty).toBe(0); // 3 billed, all already in the shop
    expect(lineStatus(a)).toBe("ready");
    expect(b.waiting_offer.map((w) => [w.id, w.qty])).toEqual([[2, 3]]);
    expect(b.toys[0].qty).toBe(2);
  });

  it("unticked: nothing matched, all pieces come in now, the pieces stay free for other lines", () => {
    const ws = [{ id: 1, product_id: 11, qty: "2" }];
    const [a, b] = applyWaiting([line({ key: "a", waiting_off: true }), line({ key: "b" })], ws);
    expect(a.waiting_matched).toBe(0);
    expect(a.toys[0].qty).toBe(5);
    expect(b.waiting_matched).toBe(2);
    const p = savePayload({ supplierId: 3, outletId: 1, header: {}, result: {}, lines: [a, b] });
    expect(p.lines[0].waiting).toEqual([]);
    expect(p.lines[1].waiting).toEqual([{ id: 1, qty: 2 }]);
    expect(p.lines[1].toys).toEqual([{ product_id: 11, qty: 3 }]);
  });
});

describe("Receive supplier bill: waiting extras", { timeout: 20000 }, () => {
  it("the line offers them pre-ticked; saving sends them and only the pieces arriving now", async () => {
    await readBill();
    const offer = await screen.findByTestId("waiting-offer-1");
    expect(offer.textContent).toMatch(/2 pcs already in the shop: extras from bill M100 \(2026-10-12\)/);
    expect(offer.textContent).toMatch(/3 pcs arrive now/);
    expect(within(offer).getByLabelText("These are those pieces, line 1").checked).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].lines[0]).toMatchObject({ received_qty: 5, waiting: [{ id: 41, qty: 2 }], toys: [{ product_id: 11, qty: 3 }] });
  });

  it("unticked = different pieces: all 5 come in, nothing matched", async () => {
    await readBill();
    const offer = await screen.findByTestId("waiting-offer-1");
    fireEvent.click(within(offer).getByLabelText("These are those pieces, line 1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].lines[0]).toMatchObject({ waiting: [], toys: [{ product_id: 11, qty: 5 }] });
  });

  it("lists every supplier's waiting extras; No bill coming (free) needs a note", async () => {
    const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
    render(<MemoryRouter><Page /></MemoryRouter>);
    const table = await screen.findByTestId("f9-waiting");
    expect(within(table).getByText("HAFIZ NAWAZ")).toBeTruthy();
    expect(within(table).getByText("BABY LAND")).toBeTruthy();
    expect(within(table).getByText(/M100 · 2026-10-12 · Packages Mall/)).toBeTruthy();
    expect(within(table).getByText("5 days")).toBeTruthy();
    fireEvent.click(within(table).getAllByRole("button", { name: "No bill coming (free)" })[0]);
    const mark = await screen.findByRole("button", { name: "Mark free" });
    expect(mark.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why no bill"), { target: { value: "gift from the supplier" } });
    fireEvent.click(mark);
    await waitFor(() => expect(posts.some((p) => p.url === "/api/supplier-bills/waiting/41/free")).toBe(true));
    expect(posts.find((p) => p.url === "/api/supplier-bills/waiting/41/free").body).toEqual({ note: "gift from the supplier" });
  });
});
