// One Toy Store: "Needs a Category" fix-it screen (owner, 2026-10-19) — toys
// the import left in "Other → Needs a Category" (or with none), sold first
// then in stock; a category picker per row that saves at once; tick many and
// give them one category; a supplier suggestion with "Use it"; a dashboard
// line with the count while any are left.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 5000 });

const CATS = [
  { id: 1, name: "Other", path_label: "Other", is_leaf: false },
  { id: 2, name: "Needs a Category", path_label: "Other / Needs a Category", is_leaf: true },
  { id: 3, name: "Cycles", path_label: "Ride-ons / Cycles", is_leaf: true },
  { id: 4, name: "Dolls", path_label: "Dolls", is_leaf: true },
];
const ROWS = () => [
  { id: 11, name: "FOREST PARK 8 IN 1", sku: "1069", supplier_name: "REHMAT", category_name: "Needs a Category", stock: 1, cost_value: 2500, units_sold: 2, sold_amount: 9980, last_sold: "2026-10-02T15:24:23Z",
    suggestion: { category_id: 3, path_label: "Ride-ons / Cycles", count: 3, of: 4 } },
  { id: 12, name: "STEERING WHEEL", sku: "8968", supplier_name: null, category_name: "Needs a Category", stock: 4, cost_value: 6000, units_sold: 0, sold_amount: 0, last_sold: null, suggestion: null },
  { id: 13, name: "EXPERIMENT SET", sku: "6901", supplier_name: "MIXED", category_name: null, stock: 2, cost_value: 1000, units_sold: 0, sold_amount: 0, last_sold: null, suggestion: null },
];

const { apiState, state, toast } = vi.hoisted(() => ({
  apiState: { get: vi.fn(), post: vi.fn() },
  state: { rows: [], posts: [] },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => toast }));

beforeEach(() => {
  state.rows = ROWS();
  state.posts = [];
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/categories") return { categories: CATS };
    if (url.startsWith("/api/products/needs-category/count")) return { count: state.rows.length };
    if (url.startsWith("/api/products/needs-category")) {
      return { counts: { listed: state.rows.length, all: state.rows.length + 5 }, rows: state.rows, all: url.includes("all=1") };
    }
    return {};
  });
  apiState.post.mockImplementation(async (url, body) => {
    state.posts.push({ url, body });
    state.rows = state.rows.filter((r) => !body.ids.includes(r.id));
    return { updated: body.ids.length };
  });
});

async function page() {
  const { default: Page } = await import("../../src/pages/redesign/NeedsCategoryRedesign");
  render(<MemoryRouter><Page /></MemoryRouter>);
  await screen.findByText("FOREST PARK 8 IN 1");
}

describe("Needs a Category screen", { timeout: 20000 }, () => {
  it("lists the toys with supplier, stock, sales and the count", async () => {
    await page();
    const rows = screen.getAllByTestId("nc-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("REHMAT");
    expect(rows[0].textContent).toContain("Rs 9980");
    expect(rows[1].textContent).toContain("Rs 6000");
    expect(screen.getByTestId("nc-count").textContent).toContain("3");
  });

  it("the picker offers real bottom-level categories only (not Needs a Category, not a parent)", async () => {
    await page();
    const picker = within(screen.getAllByTestId("nc-row")[1]).getByRole("combobox");
    const labels = [...picker.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels).toContain("Ride-ons / Cycles");
    expect(labels).toContain("Dolls");
    expect(labels.some((l) => l.includes("Needs a Category"))).toBe(false);
    expect(labels).not.toContain("Other");
  });

  it("picking a category saves at once and the toy leaves the list", async () => {
    await page();
    const picker = within(screen.getAllByTestId("nc-row")[1]).getByRole("combobox");
    fireEvent.change(picker, { target: { value: "4" } });
    await waitFor(() => expect(screen.queryByText("STEERING WHEEL")).toBeNull());
    expect(state.posts).toEqual([{ url: "/api/products/bulk-category", body: { ids: [12], category_id: 4 } }]);
  });

  it("shows the supplier suggestion and Use it saves it", async () => {
    await page();
    const row = screen.getAllByTestId("nc-row")[0];
    expect(row.textContent).toContain("Ride-ons / Cycles");
    expect(row.textContent).toContain("3 of 4");
    fireEvent.click(within(row).getByRole("button", { name: /use it/i }));
    await waitFor(() => expect(screen.queryByText("FOREST PARK 8 IN 1")).toBeNull());
    expect(state.posts[0].body).toEqual({ ids: [11], category_id: 3 });
  });

  it("tick several and give them one category", async () => {
    await page();
    const rows = screen.getAllByTestId("nc-row");
    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    fireEvent.click(within(rows[2]).getByRole("checkbox"));
    const bar = screen.getByTestId("nc-bulk");
    expect(bar.textContent).toContain("2 ticked");
    fireEvent.change(within(bar).getByRole("combobox"), { target: { value: "3" } });
    fireEvent.click(within(bar).getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(screen.getAllByTestId("nc-row")).toHaveLength(1));
    expect(state.posts[0].body).toEqual({ ids: [12, 13], category_id: 3 });
  });

  it("Show all asks the server for every toy", async () => {
    await page();
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    await waitFor(() => expect(apiState.get).toHaveBeenCalledWith("/api/products/needs-category?all=1"));
  });
});

describe("Dashboard reminder", { timeout: 20000 }, () => {
  it("shows the count with a link while any are left", async () => {
    const { DashboardNeedsCategory } = await import("../../src/pages/dashboard/DashboardNeedsCategory");
    render(<MemoryRouter><DashboardNeedsCategory /></MemoryRouter>);
    const line = await screen.findByTestId("nc-dashboard");
    expect(line.textContent).toContain("3 toys need a category");
    expect(within(line).getByRole("link").getAttribute("href")).toBe("/needs-category");
  });

  it("shows nothing when none are left", async () => {
    state.rows = [];
    const { DashboardNeedsCategory } = await import("../../src/pages/dashboard/DashboardNeedsCategory");
    const { container } = render(<MemoryRouter><DashboardNeedsCategory /></MemoryRouter>);
    await waitFor(() => expect(apiState.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
