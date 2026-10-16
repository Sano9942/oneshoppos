// One Toy Store F9 (f): the same bill number twice. Owner (B): same supplier +
// same bill number → warn and show the earlier bill, but let the owner save it
// as a different bill (suppliers reuse "Bill No 01" on different dates).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const LINE = { line_no: 1, page: 1, file_index: 0, supplier_code: "BL-1", description: "BALL", qty: 3, rate: 100, amount: 300, discount_pct: 0, check: "ok" };
const READ = { files: [{ file_name: "bill.pdf", kind: "pdf", sha256: "b".repeat(64), already: null }], layout: "hafiz_bill_no", layout_label: "Bill No", bill_number: "Bill No 01", bill_date: "2026-10-09", printed: { total: 300 }, lines: [LINE], lines_total: 300, total_matches: true, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null, needs_photo_reader: false };
const EARLIER = { id: 7, bill_number: "Bill No 01", bill_date: "2026-10-01", amount: "300.00", lines: 1, saved_by_name: "Hassan" };

const { apiState, saves, state } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn() }, saves: [], state: { earlier: [] } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  saves.length = 0;
  state.earlier = [EARLIER];
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 3, name: "HAFIZ NAWAZ" }] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url.startsWith("/api/supplier-bills/same-number")) {
      return { bills: url.includes("supplier_id=3") && url.includes("bill_number=Bill%20No%2001") ? state.earlier : [] };
    }
    return {};
  });
  apiState.post.mockImplementation(async () => ({ lines: [{ key: "0", matches: [{ product_id: 11, name: "Ball", sku: "1001" }], chosen: [11] }] }));
  apiState.upload.mockImplementation(async (url, fd) => {
    if (url === "/api/supplier-bills/read") return reply(READ);
    const payload = JSON.parse(fd.get("payload"));
    saves.push(payload);
    if (!payload.same_number_ok && state.earlier.length) {
      return reply({ error: "already saved", code: "SAME_BILL_NUMBER", bills: state.earlier }, 409);
    }
    return reply({ bill: { id: 8, bill_number: payload.bill_number, status: "saved" }, labels: [] }, 201);
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

describe("Receive supplier bill: same bill number twice", () => {
  it("warns with the earlier bill as soon as supplier and number are known", async () => {
    await readBill();
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert.textContent).toMatch(/HAFIZ NAWAZ bill Bill No 01 is already saved/);
    expect(alert.textContent).toMatch(/dated 1 Oct 2026 · Rs 300 · 1 line · saved by Hassan/);
  });

  it("Save asks first; 'Don't save' sends nothing, 'different bill' saves it", async () => {
    await readBill();
    await screen.findByRole("alert", {}, { timeout: 2000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));
    expect(saves).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    fireEvent.click(await screen.findByRole("button", { name: "It's a different bill, save it" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].same_number_ok).toBe(true);
  });

  it("no earlier bill: saves straight away", async () => {
    state.earlier = [];
    await readBill();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].same_number_ok).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
