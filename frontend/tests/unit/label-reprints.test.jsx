// One Toy Store pilot, Phase B step 6: "Labels to reprint" on the label page.
// The list shows name, label price → new price and when; selected rows go
// into the print queue at the CURRENT price (so printing clears them), variants
// as their own labels; "Label is fine" takes rows off without printing.
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { reprintRowToQueueItem, queueKey, addToQueue } from "../../src/pages/labelReprints";

const { apiState } = vi.hoisted(() => ({ apiState: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));

const ROWS = [
  { id: 11, product_id: 5, variant_id: null, name: "Kite", variant_sku: null, barcode: "KITE-1", sku: "K1",
    brand_name: "Wind", old_price: "300.00", new_price: "350.00", is_new: false, changed_at: "2026-09-27T09:00:00.000Z" },
  { id: 12, product_id: 7, variant_id: 70, name: "Hot Wheels", variant_sku: "HW-RED", barcode: "HW-RED-BC", sku: "HW-RED",
    brand_name: null, old_price: "500.00", new_price: "550.00", is_new: false, changed_at: "2026-09-27T08:00:00.000Z" },
  { id: 13, product_id: 9, variant_id: null, name: "Yo-yo", variant_sku: null, barcode: "YOYO", sku: null,
    brand_name: null, old_price: null, new_price: "150.00", is_new: true, changed_at: "2026-09-27T07:00:00.000Z" },
];

describe("helpers", () => {
  it("a list row becomes a print-queue item at the current price, variant kept", () => {
    expect(reprintRowToQueueItem(ROWS[1])).toEqual({
      product_id: 7, variant_id: 70, name: "Hot Wheels – HW-RED", barcode: "HW-RED-BC",
      sku: "HW-RED", price: 550, brand: "", copies: 1,
    });
  });

  it("a variant and its parent are separate queue entries", () => {
    expect(queueKey({ product_id: 7, variant_id: 70 })).not.toBe(queueKey({ product_id: 7, variant_id: null }));
    let q = addToQueue([], reprintRowToQueueItem(ROWS[1]));
    q = addToQueue(q, { product_id: 7, variant_id: null, name: "Hot Wheels", barcode: "", price: 500, copies: 1 });
    q = addToQueue(q, reprintRowToQueueItem(ROWS[1]));
    expect(q).toHaveLength(2);
    expect(q[0].copies).toBe(2);
  });
});

describe("Labels to reprint section", () => {
  let BarcodeTemplates;
  beforeEach(async () => {
    vi.clearAllMocks();
    apiState.get.mockImplementation(async (url) => {
      if (url === "/api/label-reprints") return { items: ROWS };
      if (url === "/api/barcode-templates") return { templates: [{ id: 1, name: "Shelf", width_mm: 50, height_mm: 30, is_default: true, show_price: 1 }] };
      if (url === "/api/products") return { products: [] };
      return {};
    });
    apiState.post.mockResolvedValue({ cleared: 1, logged: 1 });
    ({ default: BarcodeTemplates } = await import("../../src/pages/BarcodeTemplates"));
  });

  it("shows name, label price → new price, and new items as new", async () => {
    render(<BarcodeTemplates />);
    const section = await screen.findByTestId("label-reprints");
    await within(section).findByText("Kite");
    expect(within(section).getByText(/Labels to reprint \(3\)/)).toBeTruthy();
    const kite = within(section).getByTestId("reprint-row-11");
    expect(kite.textContent).toContain("Rs 300");
    expect(kite.textContent).toContain("Rs 350");
    expect(within(section).getByTestId("reprint-row-12").textContent).toContain("HW-RED");
    expect(within(section).getByTestId("reprint-row-13").textContent).toMatch(/New/);
  });

  it("'Label is fine' on the selected rows posts their ids and reloads the list", async () => {
    render(<BarcodeTemplates />);
    const section = await screen.findByTestId("label-reprints");
    await within(section).findByText("Kite");
    fireEvent.click(within(section).getByLabelText("Select Kite"));
    fireEvent.click(within(section).getByLabelText("Select Yo-yo"));
    fireEvent.click(within(section).getByRole("button", { name: /Label is fine/ }));
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/label-reprints/dismiss", { ids: [11, 13] }));
    await waitFor(() => expect(apiState.get.mock.calls.filter(([u]) => u === "/api/label-reprints").length).toBe(2));
  });

  it("'Print selected' opens the print queue with those items at the new price", async () => {
    render(<BarcodeTemplates />);
    const section = await screen.findByTestId("label-reprints");
    await within(section).findByText("Kite");
    fireEvent.click(within(section).getByLabelText("Select all labels to reprint"));
    fireEvent.click(within(section).getByRole("button", { name: /Print selected/ }));
    const queue = await screen.findByTestId("print-queue");
    expect(within(queue).getByText("Hot Wheels – HW-RED")).toBeTruthy();
    expect(within(queue).getByText("Kite")).toBeTruthy();
    expect(screen.getByText(/Total labels:/).textContent).toContain("3");
  });
});
