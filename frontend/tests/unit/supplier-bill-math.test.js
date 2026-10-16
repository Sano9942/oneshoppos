// One Toy Store F9 (c1): the check screen's arithmetic (PHASE-F-PLAN F9, owner):
// cost = actual cost after discounts (line discount lowers that line; a
// whole-bill discount is spread over the lines by value); a pack split into
// N pieces: qty × N, cost ÷ N; freight never in toy cost.
import { describe, it, expect } from "vitest";
import { lineFromRead, unitCost, lineStatus, billSummary, savePayload, newToyPrice, suggestedPrice } from "../../src/pages/redesign/supplierBill/billMath";

const read = (over = {}) => ({ line_no: "1", page: 1, supplier_code: "RC-77", description: "RC CAR", qty: 12, rate: 160, amount: 1920, check: "ok", ...over });

describe("unitCost", () => {
  it("is the rate when there is no discount or split", () => {
    expect(unitCost({ rate: 160, discount_pct: 0, split_into: 1 })).toBe(160);
  });
  it("takes off the line discount (A2Z: 12 × 160 less 5 % → 152 a piece)", () => {
    expect(unitCost({ rate: 160, discount_pct: 5, split_into: 1 })).toBe(152);
  });
  it("spreads a whole-bill discount by value", () => {
    expect(unitCost({ rate: 1000, discount_pct: 0, split_into: 1 }, 0.02)).toBe(980);
  });
  it("divides by the pieces in a split pack", () => {
    expect(unitCost({ rate: 600, discount_pct: 0, split_into: 6 })).toBe(100);
    expect(unitCost({ rate: 1000, discount_pct: 0, split_into: 6 })).toBe(166.67);
  });
});

describe("lineFromRead + lineStatus", () => {
  const toy = (id, extra = {}) => ({ product_id: id, name: `Toy ${id}`, sku: `S${id}`, price: 500, cost_price: 150, how: "supplier_code", split_into: 1, ...extra });

  it("one chosen toy gets all the pieces → ready", () => {
    const l = lineFromRead(read(), { matches: [toy(1)], chosen: [1] });
    expect(l.received).toBe(12);
    expect(l.toys.map((t) => [t.product_id, t.qty])).toEqual([[1, 12]]);
    expect(lineStatus(l)).toBe("ready");
  });

  it("a remembered split multiplies the pieces", () => {
    const l = lineFromRead(read({ qty: 2, rate: 600, amount: 1200 }), { matches: [toy(1, { split_into: 6 })], chosen: [1] });
    expect(l.split_into).toBe(6);
    expect(l.toys[0].qty).toBe(12);
    expect(unitCost(l)).toBe(100);
  });

  it("an assorted code (several toys) waits for the pieces to be shared out", () => {
    const l = lineFromRead(read(), { matches: [toy(1), toy(2)], chosen: [1, 2] });
    expect(l.toys.map((t) => t.qty)).toEqual([0, 0]);
    expect(lineStatus(l)).toBe("split");
    l.toys[0].qty = 7;
    l.toys[1].qty = 5;
    expect(lineStatus(l)).toBe("ready");
  });

  it("a suggestion (not chosen) needs confirming; nothing found needs a toy", () => {
    expect(lineStatus(lineFromRead(read(), { matches: [toy(1, { how: "name_code" })], chosen: [] }))).toBe("confirm");
    expect(lineStatus(lineFromRead(read(), { matches: [], chosen: [] }))).toBe("pick");
  });

  it("step (d): a new toy is ready once it has a name, a category and Brand / Non-brand (owner: both required)", () => {
    const l = lineFromRead(read(), { matches: [], chosen: [] });
    l.is_new = true;
    expect(l.new_toy).toMatchObject({ name: "RC CAR", category_id: "", is_brand: null });
    expect(lineStatus(l)).toBe("newtoy");
    l.new_toy.category_id = 46;
    expect(lineStatus(l)).toBe("newtoy");
    l.new_toy.is_brand = true;
    expect(lineStatus(l)).toBe("newtoy"); // which brand?
    l.new_toy.brand_name = "Hot Wheels";
    expect(lineStatus(l)).toBe("ready");
    l.new_toy.is_brand = false;
    expect(lineStatus(l)).toBe("ready");
    l.new_toy.name = " ";
    expect(lineStatus(l)).toBe("newtoy");
  });

  it("step (d): the most similar toy's category and brand are the new toy's suggestion", () => {
    const like = { name: "RC CAR BLUE", category_id: 9, brand_id: 15, brand_name: "Maisto" };
    expect(lineFromRead(read(), { matches: [], chosen: [], like }).new_toy).toMatchObject({ category_id: 9, is_brand: true, brand_name: "Maisto" });
    expect(lineFromRead(read(), { matches: [], chosen: [], like: { ...like, brand_id: null, brand_name: null } }).new_toy)
      .toMatchObject({ category_id: 9, is_brand: false });
  });

  it("a minus line is goods sent back", () => {
    const l = lineFromRead(read({ qty: -2, amount: -320 }), { matches: [toy(1)], chosen: [1] });
    expect(l.received).toBe(-2);
    expect(l.toys[0].qty).toBe(-2);
    expect(lineStatus(l)).toBe("ready");
    expect(l.is_return).toBe(true);
  });
});

describe("billSummary", () => {
  it("counts lines by status and compares the lines with the total written on the bill", () => {
    const lines = [
      lineFromRead(read({ amount: 1920 }), { matches: [{ product_id: 1, name: "A", how: "supplier_code", split_into: 1 }], chosen: [1] }),
      lineFromRead(read({ line_no: "2", amount: 1000 }), { matches: [], chosen: [] }),
    ];
    const s = billSummary(lines, 2920);
    expect(s).toMatchObject({ ready: 1, pick: 1, lines_total: 2920, difference: 0, total_matches: true });
    expect(billSummary(lines, 3000)).toMatchObject({ difference: 80, total_matches: false });
  });

  it("the written total is after line discounts and the bill discount", () => {
    const l = lineFromRead(read({ amount: 1920 }), { matches: [], chosen: [] });
    l.discount_pct = 5;
    expect(billSummary([l], 1824)).toMatchObject({ lines_total: 1824, bill_total: 1824, total_matches: true });
    expect(billSummary([l], 1800, 24)).toMatchObject({ bill_total: 1800, total_matches: true });
  });
});

describe("step (d): prices and what is saved", () => {
  const ctx = { supplierName: "SMART TOYS", billDiscountRatio: 0 };
  const newLine = (over = {}) => {
    const l = lineFromRead(read({ qty: 2, rate: 500, amount: 1000 }), { matches: [], chosen: [] });
    l.is_new = true;
    Object.assign(l.new_toy, { category_id: 46, is_brand: false }, over);
    return l;
  };

  it("a new toy's price follows the rule until the shop types one", () => {
    const l = newLine();
    expect(newToyPrice(l, ctx)).toMatchObject({ key: "nonbrand", pct: 175, price: 1380 });
    l.new_toy.price = "1500";
    expect(newToyPrice(l, ctx).price).toBe(1500);
  });

  it("the rule follows the split cost and the shop's chosen rule", () => {
    const l = newLine({ rule: "stationery" });
    l.split_into = 5; // 100 a piece
    expect(newToyPrice(l, ctx)).toMatchObject({ key: "stationery", price: 240 });
  });

  it("savePayload sends the new toy with its price, code and barcode", () => {
    const l = newLine({ code: "45001", barcode: "6901234" });
    const body = savePayload({ supplierId: 1, outletId: 1, header: {}, result: {}, lines: [l], paidNow: null, ...ctx });
    expect(body.lines[0]).toMatchObject({
      is_new: true,
      toys: [],
      new_toy: { name: "RC CAR", category_id: 46, is_brand: false, brand_name: null, price: 1380, code: "45001", barcode: "6901234" },
    });
  });

  it("an existing toy: the rule's price is only suggested when its cost changes", () => {
    const t = { product_id: 1, name: "A", price: 900, cost_price: 300, brand_id: null, qty: 2 };
    const l = lineFromRead(read({ qty: 2, rate: 300, amount: 600 }), { matches: [{ ...t, how: "supplier_code", split_into: 1 }], chosen: [1] });
    expect(suggestedPrice(l, l.toys[0], ctx)).toBe(null); // same cost
    const dearer = lineFromRead(read({ qty: 2, rate: 400, amount: 800 }), { matches: [{ ...t, how: "supplier_code", split_into: 1 }], chosen: [1] });
    expect(suggestedPrice(dearer, dearer.toys[0], ctx)).toMatchObject({ key: "nonbrand", price: 1140 });
  });

  it("savePayload sends a new price only for toys the shop said Use on", () => {
    const t = { product_id: 1, name: "A", price: 900, cost_price: 300, qty: 2 };
    const l = lineFromRead(read({ qty: 2, rate: 400, amount: 800 }), { matches: [{ ...t, how: "supplier_code", split_into: 1 }], chosen: [1] });
    expect(savePayload({ supplierId: 1, outletId: 1, header: {}, result: {}, lines: [l], ...ctx }).lines[0].toys[0]).toEqual({ product_id: 1, qty: 2 });
    l.toys[0].new_price = 1100;
    expect(savePayload({ supplierId: 1, outletId: 1, header: {}, result: {}, lines: [l], ...ctx }).lines[0].toys[0]).toEqual({ product_id: 1, qty: 2, new_price: 1100 });
  });
});

// F9 (e): photo bills come back from the AI with the line discount, the
// printed barcode and the paper marks (owner 2026-10-16: flag only).
describe("lineFromRead for a photo bill", () => {
  it("keeps the line discount the reader found", () => {
    const l = lineFromRead(read({ discount_pct: 5 }));
    expect(l.discount_pct).toBe(5);
    expect(unitCost(l)).toBe(152);
  });
  it("a printed barcode fills a new toy's maker's barcode", () => {
    expect(lineFromRead(read({ barcode: "8859335200140" })).new_toy.barcode).toBe("8859335200140");
  });
  it("struck / circled / hard to read comes through for the screen", () => {
    const l = lineFromRead(read({ paper_mark: "struck", unsure: true, note: "barcode smudged" }));
    expect(l).toMatchObject({ paper_mark: "struck", unsure: true, read_note: "barcode smudged" });
    expect(lineFromRead(read()).paper_mark).toBeNull();
  });
  it("the bill total takes each line's discount off (A2Z: 1,920 less 5 % = 1,824)", () => {
    const s = billSummary([lineFromRead(read({ discount_pct: 5 }))], "1824", 0);
    expect(s.total_matches).toBe(true);
  });
});
