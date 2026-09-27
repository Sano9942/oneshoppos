// One Toy Store pilot, Phase B step 6c: the Import page's "Update prices" tab
// uploads a price sheet, previews old → new per row with a tick box on every
// changed row (ticked by default), and applies only the ticked rows.
// Rows that match nothing are shown as "Not found" and can't be ticked.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { apiState } = vi.hoisted(() => ({ apiState: { upload: vi.fn(), raw: vi.fn(), get: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), toast: vi.fn() }) }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

const ok = (body) => ({ ok: true, json: async () => body });
const ROWS = [
  { _row: 2, sku: "KITE-1", barcode: "", status: "change", product_id: 5, variant_id: null, item_name: "Kite",
    variant_label: null, old_price: 300, new_price: 350, old_cost: 150, new_cost: 150, below_cost: false, _errors: [] },
  { _row: 3, sku: "HW-RED", barcode: "", status: "change", product_id: 7, variant_id: 70, item_name: "Hot Wheels",
    variant_label: "HW-RED", old_price: 450, new_price: 400, old_cost: 300, new_cost: 420, below_cost: true, _errors: [] },
  { _row: 4, sku: "BALL-1", barcode: "", status: "unchanged", product_id: 6, variant_id: null, item_name: "Ball",
    variant_label: null, old_price: 200, new_price: 200, old_cost: 90, new_cost: 90, below_cost: false, _errors: [] },
  { _row: 5, sku: "GHOST", barcode: "", status: "not_found", _errors: [] },
  { _row: 6, sku: "KITE-1", barcode: "BALL-BC", status: "error", _errors: ['SKU "KITE-1" and barcode "BALL-BC" are on different items'] },
];

async function openAndPreview() {
  const { default: ImportRedesign } = await import("../../src/pages/redesign/ImportRedesign");
  const { container } = render(<ImportRedesign />);
  fireEvent.click(screen.getByRole("button", { name: "Update prices" }));
  const input = container.querySelector('input[type="file"][data-testid="price-sheet-file"]');
  fireEvent.change(input, { target: { files: [new File(["sku,selling_price\n"], "prices.csv", { type: "text/csv" })] } });
  return await screen.findByTestId("price-sheet-preview");
}

describe("Import → Update prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiState.upload.mockImplementation(async (url) =>
      url === "/api/import/prices?preview=1"
        ? ok({ preview: true, rows: ROWS, summary: { change: 2, unchanged: 1, not_found: 1, error: 1 } })
        : ok({ updated: 1 }));
  });

  it("previews old → new, variants by name + SKU, below-cost flagged, not-found and errors shown", async () => {
    const table = await openAndPreview();
    const kite = within(table).getByTestId("price-row-2");
    expect(kite.textContent).toContain("Rs 300");
    expect(kite.textContent).toContain("Rs 350");
    const hw = within(table).getByTestId("price-row-3");
    expect(hw.textContent).toContain("Hot Wheels");
    expect(hw.textContent).toContain("HW-RED");
    expect(hw.textContent).toMatch(/below cost/i);
    expect(within(table).getByTestId("price-row-4").textContent).toMatch(/No change/);
    expect(within(table).getByTestId("price-row-5").textContent).toMatch(/Not found/);
    expect(within(table).getByTestId("price-row-6").textContent).toMatch(/different items/);
    // only changed rows can be ticked, and start ticked
    expect(within(table).getAllByRole("checkbox", { name: /Update row/ })).toHaveLength(2);
    expect(within(table).getByRole("checkbox", { name: "Update row 2" }).checked).toBe(true);
    expect(screen.getByRole("button", { name: /Update 2 prices/ })).toBeTruthy();
  });

  it("applies only the ticked rows", async () => {
    const table = await openAndPreview();
    fireEvent.click(within(table).getByRole("checkbox", { name: "Update row 3" }));
    fireEvent.click(screen.getByRole("button", { name: /Update 1 price/ }));
    await waitFor(() => expect(apiState.upload).toHaveBeenCalledTimes(2));
    const [url, fd] = apiState.upload.mock.calls[1];
    expect(url).toBe("/api/import/prices");
    expect(JSON.parse(fd.get("rows"))).toEqual([2]);
    expect(fd.get("file")).toBeTruthy();
  });

  it("nothing ticked: the update button is disabled", async () => {
    const table = await openAndPreview();
    fireEvent.click(within(table).getByRole("checkbox", { name: "Update row 2" }));
    fireEvent.click(within(table).getByRole("checkbox", { name: "Update row 3" }));
    expect(screen.getByRole("button", { name: /Update 0 prices/ }).disabled).toBe(true);
  });
});
