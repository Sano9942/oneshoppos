// One Toy Store F9 (f) 5/6: "Correct this bill" on Supplier bills → Open.
// Owner (2026-10-16): four kinds (pieces received, wrong rate, money only,
// wrong toy), one box, a note always required; corrections listed on the bill.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 5000 });

const LIST = [{ id: 7, supplier_id: 6, supplier_name: "HAFIZ NAWAZ", bill_number: "M100", bill_date: "2026-10-05", status: "saved", amount: "1990", lines: 2, files: 0, saved_at: "2026-10-05T10:00:00Z", saved_by_name: "Hassan" },
  { id: 5, supplier_id: 6, supplier_name: "HAFIZ NAWAZ", bill_number: "01", bill_date: "2026-10-01", status: "undone", amount: "100", lines: 1, files: 0, saved_at: "2026-10-01T10:00:00Z" }];
const LINES = [
  { id: 11, line_no: "4", supplier_code: "B0444", description: "CAPTAIN AMERICA SHIELD", billed_qty: "2", received_qty: "1", rate: "995", discount_pct: "0", amount: "1990", split_into: 1, unit_cost: "995",
    toys: [{ product_id: 3, name: "Shield", sku: "2703", qty: "1", extra_qty: "0" }] },
  { id: 12, line_no: "5", supplier_code: null, description: "ASSORTED CARS", billed_qty: "4", received_qty: "4", rate: "100", discount_pct: "0", amount: "400", split_into: 1, unit_cost: "100",
    toys: [{ product_id: 4, name: "Red car", sku: "31001", qty: "2", extra_qty: "0" }, { product_id: 5, name: "Blue car", sku: "31002", qty: "2", extra_qty: "0" }] },
];
const BILL = { ...LIST[0], outlet_name: "Packages Mall", files: [], lines: LINES, entries: [], corrections: [] };
const CORRECTED = {
  ...BILL,
  corrections: [{ id: 1, kind: "pieces", line_id: 11, line_no: "4", note: "found the other one", before: { received_qty: "1" }, after: { received_qty: 2 }, amount: "995", created_at: "2026-10-16T12:00:00Z", employee_name: "Owner" }],
};

const { apiState, posts } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn() }, posts: [] }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

beforeEach(() => {
  posts.length = 0;
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/suppliers") return { suppliers: [{ id: 6, name: "HAFIZ NAWAZ" }] };
    if (url.startsWith("/api/supplier-bills?")) return { bills: LIST, total: 2 };
    if (url === "/api/supplier-bills/7") return { bill: BILL };
    if (url === "/api/supplier-bills/5") return { bill: { ...LIST[1], status: "undone", files: [], lines: [LINES[0]], entries: [], corrections: [] } };
    if (url === "/api/products/search") return { products: [{ id: 9, name: "Iron Man mask", sku: "2801" }] };
    return {};
  });
  apiState.post.mockImplementation(async (url, body) => {
    posts.push({ url, body });
    return { bill: CORRECTED };
  });
});

async function openBill(i = 0) {
  const { default: Page } = await import("../../src/pages/redesign/SupplierBillsRedesign");
  render(<MemoryRouter initialEntries={["/supplier-bills"]}><Page /></MemoryRouter>);
  const table = await screen.findByTestId("supplier-bills");
  fireEvent.click((await within(table).findAllByRole("button", { name: "Open" }))[i]);
  await screen.findByTestId("supplier-bill-lines");
}

describe("Correct this bill", { timeout: 20000 }, () => {
  it("pieces received: says what will change, needs a note, then sends the correction and lists it", async () => {
    await openBill();
    fireEvent.click(screen.getByRole("button", { name: "Correct this bill" }));
    const box = await screen.findByTestId("correct-bill");
    fireEvent.change(within(box).getByLabelText("Received"), { target: { value: "2" } });
    expect(within(box).getByTestId("correction-preview").textContent).toBe("Stock +1 pcs · we owe Rs 995 more");
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    expect(await within(box).findByText(/Write a note/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    fireEvent.change(within(box).getByLabelText("Note"), { target: { value: "found the other one" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/supplier-bills/7/corrections", body: { kind: "pieces", note: "found the other one", line_id: 11, received_qty: 2 } });
    const list = await screen.findByTestId("supplier-bill-corrections");
    expect(list.textContent).toMatch(/Pieces received, line 4: received 1 → 2 · we owe Rs 995 more · found the other one/);
    expect(list.textContent).toMatch(/by Owner/);
    expect(screen.getByText("Correction saved")).toBeTruthy();
    expect(within(screen.getByTestId("supplier-bill-lines")).getByText("Corrected")).toBeTruthy();
    expect(screen.getByTestId("corrections-total").textContent).toBe("Corrections on the account: +Rs 995");
  });

  it("an assorted line sends the pieces per toy", async () => {
    await openBill();
    fireEvent.click(screen.getByRole("button", { name: "Correct this bill" }));
    const box = await screen.findByTestId("correct-bill");
    fireEvent.change(within(box).getByLabelText("Line"), { target: { value: "12" } });
    fireEvent.change(within(box).getByLabelText("Received"), { target: { value: "3" } });
    fireEvent.change(within(box).getByLabelText("Blue car pieces"), { target: { value: "1" } });
    fireEvent.change(within(box).getByLabelText("Note"), { target: { value: "one blue car short" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ kind: "pieces", note: "one blue car short", line_id: 12, received_qty: 3,
      toys: [{ product_id: 4, qty: 2 }, { product_id: 5, qty: 1 }] });
  });

  it("wrong rate and money only", async () => {
    await openBill();
    fireEvent.click(screen.getByRole("button", { name: "Correct this bill" }));
    let box = await screen.findByTestId("correct-bill");
    fireEvent.change(within(box).getByLabelText("What is wrong"), { target: { value: "rate" } });
    fireEvent.change(within(box).getByLabelText("Right rate"), { target: { value: "900" } });
    expect(within(box).getByTestId("correction-preview").textContent).toBe("Cost per piece 900 · we owe Rs 95 less");
    fireEvent.change(within(box).getByLabelText("Note"), { target: { value: "agreed 900" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ kind: "rate", note: "agreed 900", line_id: 11, rate: 900 });

    fireEvent.click(await screen.findByRole("button", { name: "Correct this bill" }));
    box = await screen.findByTestId("correct-bill");
    fireEvent.change(within(box).getByLabelText("What is wrong"), { target: { value: "money" } });
    expect(within(box).queryByLabelText("Line")).toBeNull();
    fireEvent.change(within(box).getByLabelText("Amount"), { target: { value: "-250" } });
    expect(within(box).getByTestId("correction-preview").textContent).toBe("We owe Rs 250 less");
    fireEvent.change(within(box).getByLabelText("Note"), { target: { value: "phone discount" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual({ kind: "money", note: "phone discount", amount: -250 });
  });

  it("wrong toy: finds the right toy and moves the pieces", async () => {
    await openBill();
    fireEvent.click(screen.getByRole("button", { name: "Correct this bill" }));
    const box = await screen.findByTestId("correct-bill");
    fireEvent.change(within(box).getByLabelText("What is wrong"), { target: { value: "toy" } });
    fireEvent.change(within(box).getByLabelText("Find the right toy"), { target: { value: "iron" } });
    fireEvent.mouseDown(await within(box).findByRole("option", { name: /Iron Man mask/ }));
    expect(within(box).getByTestId("correction-preview").textContent).toBe("1 pcs move from Shield to Iron Man mask · cost follows · nothing owed changes");
    fireEvent.change(within(box).getByLabelText("Note"), { target: { value: "B0444 is the mask" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toEqual({ kind: "toy", note: "B0444 is the mask", line_id: 11, from_product_id: 3, to_product_id: 9 });
  });

  it("an undone bill has no Correct button", async () => {
    await openBill(1);
    expect(screen.queryByRole("button", { name: "Correct this bill" })).toBeNull();
  });
});
