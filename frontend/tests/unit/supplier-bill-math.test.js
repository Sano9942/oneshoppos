// One Toy Store F9 (c1): the check screen's arithmetic (PHASE-F-PLAN F9, owner):
// cost = actual cost after discounts (line discount lowers that line; a
// whole-bill discount is spread over the lines by value); a pack split into
// N pieces: qty × N, cost ÷ N; freight never in toy cost.
import { describe, it, expect } from "vitest";
import { lineFromRead, unitCost, lineStatus, billSummary } from "../../src/pages/redesign/supplierBill/billMath";

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

  it("a new toy is ready once it has a name", () => {
    const l = lineFromRead(read(), { matches: [], chosen: [] });
    l.is_new = true;
    expect(l.new_name).toBe("RC CAR");
    expect(lineStatus(l)).toBe("ready");
    l.new_name = " ";
    expect(lineStatus(l)).toBe("pick");
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
