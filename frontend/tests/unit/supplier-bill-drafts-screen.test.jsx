// One Toy Store F9 (f): drafts on Receive supplier bill. Owner: a bill can be
// saved as a draft and finished later; a draft changes nothing until the final
// Save; drafts are listed with who started them.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The whole frontend suite runs in parallel: allow slow renders.
configure({ asyncUtilTimeout: 5000 });

const LINE = { line_no: 1, page: 1, file_index: 0, supplier_code: "BL-1", description: "BALL", qty: 3, rate: 100, amount: 300, discount_pct: 0, check: "ok" };
const READ = { files: [{ file_name: "bill.pdf", kind: "pdf", sha256: "c".repeat(64), already: null }], layout: "hafiz_bill_no", layout_label: "Bill No", bill_number: "M200", bill_date: "2026-10-09", printed: { total: 300 }, lines: [LINE], lines_total: 300, total_matches: true, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null, needs_photo_reader: false };
const MATCH = { key: "0", matches: [{ product_id: 11, name: "Ball", sku: "1001" }], chosen: [11] };

const { apiState, posts, state } = vi.hoisted(() => ({
  apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn(), del: vi.fn() },
  posts: [],
  state: { drafts: [], draft: null },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  posts.length = 0;
  state.drafts = [];
  state.draft = null;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 3, name: "HAFIZ NAWAZ" }] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url === "/api/supplier-bills/drafts") return { drafts: state.drafts };
    if (url.startsWith("/api/supplier-bills/drafts/")) return { draft: state.draft };
    if (url.startsWith("/api/supplier-bills/same-number")) return { bills: [] };
    return {};
  });
  apiState.post.mockImplementation(async () => ({ lines: [MATCH] }));
  apiState.del.mockImplementation(async () => ({ ok: true }));
  apiState.upload.mockImplementation(async (url, fd) => {
    if (url === "/api/supplier-bills/read") return reply(READ);
    posts.push({ url, payload: JSON.parse(fd.get("payload")), files: fd.getAll("files").length });
    if (url === "/api/supplier-bills/drafts") return reply({ draft: { id: 41, status: "draft" } }, 201);
    return reply({ bill: { id: 41, bill_number: "M200", status: "saved" }, labels: [] }, 201);
  });
});

async function page() {
  const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
  const utils = render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByRole("option", { name: "HAFIZ NAWAZ" }).length).toBeGreaterThan(0));
  return utils;
}

describe("Receive supplier bill: drafts", { timeout: 20000 }, () => {
  it("Save as draft keeps the screen and the file, and the same bill is finished later", async () => {
    const { container } = await page();
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "3" } });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["%PDF-"], "bill.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read bill" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ url: "/api/supplier-bills/drafts", files: 1 });
    expect(posts[0].payload).toMatchObject({ supplier_id: 3, outlet_id: 1, bill_number: "M200", bill_date: "2026-10-09" });
    expect(posts[0].payload.draft_id).toBeUndefined();
    expect(posts[0].payload.state.lines[0].toys[0].product_id).toBe(11);
    expect(await screen.findByText("Draft")).toBeTruthy();

    // Saving the draft again updates it, without sending the file again.
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ files: 0, payload: { draft_id: 41 } });

    // Save bill finishes the same bill.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts[2]).toMatchObject({ url: "/api/supplier-bills", files: 0, payload: { draft_id: 41 } });
  });

  it("lists drafts with who started them; Open brings the check screen back", async () => {
    state.drafts = [{ id: 41, supplier_id: 3, supplier_name: "HAFIZ NAWAZ", bill_number: "M200", bill_date: "2026-10-09", lines: 1, files: 1, started_by_name: "Hassan", updated_at: "2026-10-16T12:00:00Z" }];
    state.draft = {
      id: 41, supplier_id: 3, outlet_id: 1, bill_number: "M200", bill_date: "2026-10-09",
      files: [{ id: 5, file_name: "bill.pdf", content_type: "application/pdf" }],
      state: {
        header: { bill_number: "M200", bill_date: "2026-10-09", written_total: "300", differs: false, differs_note: "", account_amount: "300" },
        result: READ,
        lines: [{ ...LINE, key: "0", billed: 3, received: "3", split_into: 1, rate: 100, amount: 300, toys: [{ product_id: 11, name: "Ball", sku: "1001", qty: 3 }], suggestions: [] }],
        paidNow: { method: "", amount: "", reference: "" },
      },
    };
    await page();
    const table = await screen.findByTestId("f9-drafts");
    expect(within(table).getByText("HAFIZ NAWAZ")).toBeTruthy();
    expect(within(table).getByText("Hassan")).toBeTruthy();
    fireEvent.click(within(table).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByDisplayValue("M200")).toBeTruthy());
    expect(screen.getByText("Draft")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save bill" }).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ url: "/api/supplier-bills", files: 0, payload: { draft_id: 41, supplier_id: 3, bill_number: "M200" } });
  });

  it("Throw away asks first", async () => {
    state.drafts = [{ id: 42, supplier_id: 3, supplier_name: "HAFIZ NAWAZ", bill_number: "M300", bill_date: null, lines: 0, files: 1, started_by_name: "Hassan", updated_at: "2026-10-16T12:00:00Z" }];
    await page();
    fireEvent.click(within(await screen.findByTestId("f9-drafts")).getByRole("button", { name: "Throw away" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(apiState.del).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId("f9-drafts")).getByRole("button", { name: "Throw away" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Throw away" }));
    await waitFor(() => expect(apiState.del).toHaveBeenCalledWith("/api/supplier-bills/drafts/42"));
  });
});
