// One Toy Store pilot F5 (D44): Stock Adjustments, Transfers and Promotions
// picked a toy from a plain list of all 10,044 items; scanning or typing a code
// did nothing. Now they use the till's search box (ui/ItemSearchBox: GET
// /api/products/search, exact code first; Enter picks), and an adjustment can
// carry its own note.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const DISC = { id: 42, name: "FLYING DISC BALL", sku: "2703", barcode: "", price: 450, local_stock: 29 };
const DINKEY = { id: 43, name: "MATTLE HW DINKEY", sku: "1214", barcode: "027084120134", price: 650, local_stock: 31 };
const OUTLETS = [{ id: 1, name: "Packages Mall" }, { id: 2, name: "Store Room" }];

const { apiState } = vi.hoisted(() => ({
  apiState: { get: vi.fn(), post: vi.fn(async () => ({})), put: vi.fn(async () => ({})), del: vi.fn(async () => ({})) },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ authHeaders: {}, hasPerm: () => true, company: {}, employee: { id: 1, name: "Owner" } }),
}));
vi.mock("../../src/auth/authStore", () => ({ readContext: () => ({ outletId: "1" }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}`, symbol: "Rs" }) }));
vi.mock("../../src/hooks/useFeatureFlags", () => ({ default: () => ({ flags: {}, loading: false }) }));

beforeEach(() => {
  apiState.post.mockClear();
  apiState.put.mockClear();
  apiState.get.mockReset();
  apiState.get.mockImplementation(async (url, params) => {
    if (url === "/api/products/search") {
      const q = String(params?.query || "").toLowerCase();
      return { products: [DISC, DINKEY].filter((p) => p.sku === q || p.barcode === q || p.name.toLowerCase().includes(q)) };
    }
    if (url === "/api/products") return { products: [DISC, DINKEY] };
    if (url === "/api/outlets") return { outlets: OUTLETS };
    if (url === "/api/adjustments") return [];
    if (url === "/api/transfers") return [];
    if (url === "/api/promotions") return { promotions: [] };
    if (url === "/api/categories") return { categories: [] };
    if (url === "/api/brands") return { brands: [] };
    if (url.endsWith("/variants")) return { variants: [] };
    return {};
  });
});

async function findToy(container, text) {
  const box = within(container).getByLabelText("Find toy");
  fireEvent.change(box, { target: { value: text } });
  await within(container).findByRole("option", { name: new RegExp(text === "2703" ? "FLYING DISC BALL" : "MATTLE HW DINKEY") });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("Stock Adjustments", () => {
  it("finds a toy by its code and saves the adjustment with a note", async () => {
    const { default: Page } = await import("../../src/pages/redesign/StockAdjustmentsRedesign");
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "New Adjustment" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("option", { name: "Select product" })).toBeNull();
    await findToy(dialog, "2703");
    expect(within(dialog).getByText("FLYING DISC BALL")).toBeTruthy();
    expect(within(dialog).getByText(/In stock: 29/)).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText(/Quantity change/), { target: { value: "-1" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "found broken in the box" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/adjustments", expect.objectContaining({
      product_id: 42, quantity_change: -1, reason: "Damaged", notes: "found broken in the box",
    })));
  });

  it("a scanned barcode picks the toy; Change lets you pick another", async () => {
    const { default: Page } = await import("../../src/pages/redesign/StockAdjustmentsRedesign");
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "New Adjustment" }));
    const dialog = await screen.findByRole("dialog");
    await findToy(dialog, "027084120134");
    expect(within(dialog).getByText("MATTLE HW DINKEY")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Change" }));
    expect(within(dialog).getByLabelText("Find toy")).toBeTruthy();
  });

  it("won't save without a toy", async () => {
    const { default: Page } = await import("../../src/pages/redesign/StockAdjustmentsRedesign");
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "New Adjustment" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/Quantity change/), { target: { value: "-1" } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create" }).closest("form"));
    expect(await within(dialog).findByText("Pick a toy first.")).toBeTruthy();
    expect(apiState.post).not.toHaveBeenCalled();
  });

  it("no longer loads the whole catalogue for the list", async () => {
    const { default: Page } = await import("../../src/pages/redesign/StockAdjustmentsRedesign");
    render(<Page />);
    await screen.findByRole("button", { name: "New Adjustment" });
    expect(apiState.get.mock.calls.some(([u]) => u === "/api/products")).toBe(false);
  });
});

describe("Transfers", () => {
  it("finds a toy by its code", async () => {
    const { default: Page } = await import("../../src/pages/redesign/TransfersRedesign");
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "New Transfer" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("option", { name: "Select product" })).toBeNull();
    await findToy(dialog, "2703");
    expect(within(dialog).getByText("FLYING DISC BALL")).toBeTruthy();
  });
});

describe("Promotions", () => {
  it("a product promotion's toy is found by code", async () => {
    const { default: Page } = await import("../../src/pages/redesign/PromotionsRedesign");
    render(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Promotion" }));
    const dialog = await screen.findByRole("dialog");
    const appliesTo = within(dialog).getAllByRole("combobox").find((s) => [...s.options].some((o) => o.value === "product"));
    fireEvent.change(appliesTo, { target: { value: "product" } });
    expect(within(dialog).queryByRole("option", { name: "Select product" })).toBeNull();
    await findToy(dialog, "1214");
    expect(within(dialog).getByText("MATTLE HW DINKEY")).toBeTruthy();
  });

  it("the Quote Test finds a toy by code", async () => {
    const { default: Page } = await import("../../src/pages/redesign/PromotionsRedesign");
    const { container } = render(<Page />);
    await screen.findByText("Quote Test");
    const card = screen.getByText("Quote Test").closest("section, div[class*='ui-'], div");
    expect(screen.queryAllByRole("option", { name: "Select product" })).toHaveLength(0);
    await findToy(container, "2703");
    expect(screen.getByText("FLYING DISC BALL")).toBeTruthy();
    expect(card).toBeTruthy();
  });
});
