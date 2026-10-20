// One Toy Store F10 (owner 2026-10-20): Settings → Price rules, and the bill
// check screen using the shop's saved rules (PHASE-F-PLAN F10).
//   - the five rules in a fixed order; each %, the cost bands, the suppliers
//     (tick boxes), the item words, the stationery brands, the rounding
//   - every % 30–300, bands rising: problems listed, Save stays off
//   - a preview of sample costs, old vs new, before Save
//   - history of every save with "Go back to this version"
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { configure, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_RULES } from "../../src/pages/redesign/supplierBill/priceRules";

configure({ asyncUtilTimeout: 5000 });

const { apiState, toast } = vi.hoisted(() => ({
  apiState: { get: vi.fn(), post: vi.fn(), put: vi.fn(), upload: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/api", () => ({ api: apiState }));
vi.mock("../../src/contexts/CurrencyContext", () => ({ useCurrency: () => ({ fmt: (n) => `Rs ${Number(n)}` }) }));
vi.mock("../../src/contexts/ToastContext", () => ({ useToast: () => toast }));

const SUPPLIERS = [
  { id: 1, name: "A TO Z CONSUMERS" }, { id: 3, name: "HAFIZ NAWAZ" }, { id: 4, name: "AL HASSAN TRADERS" },
  { id: 9, name: "BABY LAND LAHORE" }, { id: 22, name: "TOYS AND TOYS LAHORE" },
];
const BRANDS = [{ id: 6, name: "Deli" }, { id: 12, name: "LEGO" }, { id: 19, name: "Pelikan" }, { id: 22, name: "Yalong" }];
const live = () => {
  const r = structuredClone(DEFAULT_RULES);
  r.big.groups[0].supplier_ids = [9];
  r.big.groups[1].supplier_ids = [22];
  r.bbtt.supplier_ids = [9, 22];
  r.stationery.supplier_ids = [4];
  r.stationery.brand_ids = [6, 19, 22];
  r.stationery.brand_names = ["Deli", "Pelikan", "Yalong"];
  return r;
};
const VERSIONS = [
  { id: 2, saved_at: "2026-10-20T13:00:00Z", saved_by_name: "hassan", restored_from: null, rules: live() },
  { id: 1, saved_at: "2026-10-20T12:00:00Z", saved_by_name: "hassan", restored_from: null, rules: live() },
];

let rulesReply;
beforeEach(() => {
  vi.clearAllMocks();
  rulesReply = async () => ({ rules: live(), version: null });
  apiState.get.mockImplementation(async (url) => {
    if (url === "/api/price-rules") return rulesReply();
    if (url === "/api/price-rules/history") return { versions: VERSIONS };
    if (url === "/api/suppliers") return { suppliers: SUPPLIERS };
    if (url === "/api/brands") return { brands: BRANDS };
    if (url === "/api/outlets") return { outlets: [{ id: 1, name: "Packages Mall" }] };
    if (url === "/api/supplier-bills/waiting") return { items: [] };
    if (url.startsWith("/api/supplier-bills/same-number")) return { bills: [] };
    return {};
  });
  apiState.put.mockResolvedValue({ version: { id: 3, saved_by_name: "hassan" } });
  apiState.post.mockResolvedValue({ version: { id: 3 } });
});

async function openPage() {
  const { default: Page } = await import("../../src/pages/redesign/PriceRulesRedesign");
  render(<MemoryRouter><Page /></MemoryRouter>);
  await screen.findByLabelText("Stuff & stationery %");
}
const section = (name) => screen.getByRole("region", { name });
const saveButton = () => screen.getByRole("button", { name: "Save price rules" });

describe("Settings → Price rules", { timeout: 20000 }, () => {
  it("shows the five rules in the fixed order, with today's figures and ticks", async () => {
    await openPage();
    const titles = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(titles.slice(0, 5)).toEqual(["Big item", "B.B Land & T&T list", "Stuff & stationery", "Brand, by cost", "Non-brand, by cost"]);
    expect(screen.getByLabelText("Stuff & stationery %").value).toBe("140");
    const st = section("Stuff & stationery");
    expect(within(st).getByRole("checkbox", { name: "AL HASSAN TRADERS" }).checked).toBe(true);
    expect(within(st).getByRole("checkbox", { name: "A TO Z CONSUMERS" }).checked).toBe(false);
    expect(within(st).getByRole("checkbox", { name: "Yalong" }).checked).toBe(true);
    expect(within(st).getByRole("checkbox", { name: "LEGO" }).checked).toBe(false);
    expect(screen.getByText(/never changes a toy's price/i)).toBeTruthy();
  });

  it("a changed % shows in the preview (old → new) and is saved", async () => {
    await openPage();
    expect(saveButton().disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByLabelText("Stuff & stationery %"), { target: { value: "150" } });
    const preview = screen.getByRole("table", { name: "Preview" });
    expect(within(preview).getByText("480 → 500")).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiState.put).toHaveBeenCalledTimes(1));
    const [url, body] = apiState.put.mock.calls[0];
    expect(url).toBe("/api/price-rules");
    expect(body.rules.stationery.pct).toBe(150);
    expect(body.rules.stationery.supplier_ids).toEqual([4]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("ticking a supplier and a brand, rounding to 50", async () => {
    await openPage();
    const st = section("Stuff & stationery");
    fireEvent.click(within(st).getByRole("checkbox", { name: "A TO Z CONSUMERS" }));
    fireEvent.click(within(st).getByRole("checkbox", { name: "Deli" }));
    fireEvent.change(screen.getByLabelText("Round prices to the nearest"), { target: { value: "50" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiState.put).toHaveBeenCalledTimes(1));
    const { rules } = apiState.put.mock.calls[0][1];
    expect(rules.stationery.supplier_ids.sort()).toEqual([1, 4]);
    expect(rules.stationery.brand_ids.sort()).toEqual([19, 22]);
    expect(rules.rounding).toBe(50);
  });

  it("item words: one per line", async () => {
    await openPage();
    const box = screen.getByLabelText("Big items: item words");
    expect(box.value.split("\n")).toContain("tricycle");
    fireEvent.change(box, { target: { value: `${box.value}\nbaby cot` } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiState.put).toHaveBeenCalledTimes(1));
    expect(apiState.put.mock.calls[0][1].rules.big.groups[0].words).toContain("baby cot");
  });

  it("cost bands: add a band, remove one; the last row is 'and above'", async () => {
    await openPage();
    const br = section("Brand, by cost");
    expect(within(br).getByText("and above")).toBeTruthy();
    fireEvent.click(within(br).getByRole("button", { name: "Add a band" }));
    expect(within(br).getAllByLabelText(/Brand, by cost: row \d+ %/)).toHaveLength(7);
    fireEvent.change(within(br).getByLabelText("Brand, by cost: row 6 cost below"), { target: { value: "8000" } });
    fireEvent.change(within(br).getByLabelText("Brand, by cost: row 6 %"), { target: { value: "90" } });
    fireEvent.click(within(br).getByRole("button", { name: "Remove row 1, Brand, by cost" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(apiState.put).toHaveBeenCalledTimes(1));
    expect(apiState.put.mock.calls[0][1].rules.brand.bands).toEqual([[1000, 120], [2000, 110], [3000, 100], [5000, 95], [8000, 90], [null, 85]]);
  });

  it("a % outside 30–300 or a band out of order: the problem is listed and Save stays off", async () => {
    await openPage();
    fireEvent.change(screen.getByLabelText("Stuff & stationery %"), { target: { value: "25" } });
    expect(screen.getByText("Stuff & stationery: the % must be between 30 and 300.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Stuff & stationery %"), { target: { value: "140" } });
    fireEvent.change(screen.getByLabelText("Non-brand, by cost: row 2 cost below"), { target: { value: "400" } });
    expect(screen.getByText("Non-brand, by cost: row 2's cost must be higher than row 1's.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("a refused save shows the server's problems", async () => {
    apiState.put.mockRejectedValueOnce(Object.assign(new Error("Big item: a ticked supplier doesn't exist any more."), {
      body: { errors: ["Big item: a ticked supplier doesn't exist any more."] },
    }));
    await openPage();
    fireEvent.change(screen.getByLabelText("Stuff & stationery %"), { target: { value: "150" } });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Big item: a ticked supplier doesn't exist any more.")).toBeTruthy();
  });

  it("history: who saved and when; Go back to a version asks first", async () => {
    await openPage();
    const h = section("History");
    expect(within(h).getAllByText(/hassan/)).toHaveLength(2);
    fireEvent.click(within(h).getByRole("button", { name: "Go back to version 1" }));
    fireEvent.click(await screen.findByRole("button", { name: "Go back" }));
    await waitFor(() => expect(apiState.post).toHaveBeenCalledWith("/api/price-rules/history/1/restore", {}));
  });
});

describe("the bill check screen uses the shop's saved rules", { timeout: 20000 }, () => {
  const LINE = { line_no: 1, page: 1, file_index: 0, supplier_code: "PN-1", description: "PEN", qty: 10, rate: 125, amount: 1250, discount_pct: 5, check: "ok" };
  const READ = { files: [{ file_name: "bill.pdf", kind: "pdf", sha256: "e".repeat(64), already: null }], layout: "hafiz_bill_no", layout_label: "Bill No", bill_number: "P2", bill_date: "2026-10-20", printed: { total: 1187.5 }, lines: [LINE], lines_total: 1187.5, total_matches: true, warnings: [], supplier_suggestion: null, expected_layout: null, layout_warning: null, needs_photo_reader: false };
  // Cost on the toy 100; this bill's 118.75 → a rule suggestion.
  const TOY = { product_id: 11, name: "Pen", sku: "1001", price: 190, cost_price: 100, brand_id: null };

  async function readBill() {
    apiState.post.mockImplementation(async (url) => (url === "/api/supplier-bills/match" ? { lines: [{ key: "0", matches: [TOY], chosen: [11] }] } : {}));
    apiState.upload.mockImplementation(async () => ({ ok: true, status: 200, json: async () => READ }));
    const { default: Page } = await import("../../src/pages/redesign/ReceiveSupplierBillRedesign");
    const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "HAFIZ NAWAZ" }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "3" } });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["%PDF-"], "bill.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read bill" }));
    await screen.findByRole("button", { name: "Save bill" });
  }

  it("a supplier ticked under Stuff & stationery at 150 % gets that rule's price", async () => {
    rulesReply = async () => {
      const r = live();
      r.stationery.supplier_ids = [3];
      r.stationery.pct = 150;
      return { rules: r, version: { id: 3 } };
    };
    await readBill();
    expect(screen.getByText("rule 300")).toBeTruthy(); // 118.75 × 2.5 = 296.88 → 300 (non-brand would be 340)
    expect(screen.queryByText(/price rules didn't load/)).toBeNull();
  });

  it("if the rules don't load, the screen says so", async () => {
    rulesReply = async () => { throw new Error("offline"); };
    await readBill();
    expect(screen.getByText(/price rules didn't load/)).toBeTruthy();
    expect(screen.getByText("rule 340")).toBeTruthy();
  });
});
