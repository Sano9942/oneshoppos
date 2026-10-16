// One Toy Store F9 (f): Undo a whole supplier bill the same day. Owner: same
// day, Undo the whole bill (stock back, balance back) only while none of its
// pieces is sold; after that the bill is corrected instead.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The whole frontend suite runs in parallel: allow slow renders.
configure({ asyncUtilTimeout: 5000 });

const TODAY = [
  { id: 9, supplier_name: "HAFIZ NAWAZ", bill_number: "M100", bill_date: "2026-10-16", status: "saved", amount: "3460.00", lines: 4, saved_at: "2026-10-16T10:05:00Z", saved_by_name: "Hassan" },
  { id: 8, supplier_name: "BABY LAND", bill_number: "47496", bill_date: "2026-10-15", status: "undone", amount: "900.00", lines: 2, saved_at: "2026-10-16T09:00:00Z", saved_by_name: "Hassan", undone_by_name: "Hassan", undo_reason: "wrong supplier" },
];

const { apiState, state } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), upload: vi.fn(), del: vi.fn() }, state: { today: [], undo: null } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  state.today = TODAY.map((b) => ({ ...b }));
  state.undo = null;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [] };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url === "/api/supplier-bills/today") return { bills: state.today };
    if (url === "/api/supplier-bills/drafts") return { drafts: [] };
    return {};
  });
  apiState.post.mockImplementation(async (url, body) => {
    if (url === "/api/supplier-bills/9/undo") {
      if (state.undo) throw Object.assign(new Error(state.undo), { body: { error: state.undo } });
      state.today[0] = { ...state.today[0], status: "undone", undone_by_name: "Hassan", undo_reason: body.reason };
      return { bill: { id: 9, status: "undone" }, paid_kept: 0 };
    }
    return {};
  });
});

async function page() {
  const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
  render(<MemoryRouter><Page /></MemoryRouter>);
  return screen.findByTestId("f9-today");
}

describe("Receive supplier bill: undo today's bill", { timeout: 20000 }, () => {
  it("lists today's bills; an undone one shows who and why", async () => {
    const table = await page();
    expect(within(table).getByText("HAFIZ NAWAZ")).toBeTruthy();
    expect(within(table).getByText("Rs 3460")).toBeTruthy();
    expect(within(table).getByText(/by Hassan: wrong supplier/)).toBeTruthy();
    expect(within(table).getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("Undo needs a reason, then the bill shows as undone", async () => {
    const table = await page();
    fireEvent.click(within(table).getByRole("button", { name: "Undo" }));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Undo the whole bill" });
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Why undo"), { target: { value: "pieces typed wrong" } });
    fireEvent.click(go);
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/supplier-bills/9/undo", { reason: "pieces typed wrong" }));
    await waitFor(() => expect(within(screen.getByTestId("f9-today")).getByText(/by Hassan: pieces typed wrong/)).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a refusal is shown in the box (e.g. a piece was sold)", async () => {
    state.undo = "Ball was sold after this bill was saved, so the bill can't be undone: correct the bill instead";
    const table = await page();
    fireEvent.click(within(table).getByRole("button", { name: "Undo" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Why undo"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo the whole bill" }));
    expect(await within(dialog).findByText(/Ball was sold after this bill was saved/)).toBeTruthy();
  });
});
