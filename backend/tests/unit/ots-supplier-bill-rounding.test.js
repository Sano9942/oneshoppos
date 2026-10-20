// F9 (e) trial, owner 2026-10-20: the save accepts a supplier's per-line
// rounding (under 50 paisa a line, never Rs 5) and the account carries the
// figure on the paper; toy costs stay exact.
import { describe, it, expect } from "vitest";
const { planBill } = require("../../services/supplier-bill-save");

const ln = (i, amount, pct = 5, qty = 1) => ({ line_no: i, amount, rate: amount / qty, discount_pct: pct, billed_qty: qty, received_qty: qty, split_into: 1, toys: [{ product_id: i, qty }] });
const lines3 = [ln(1, 1010), ln(2, 1010), ln(3, 1001)]; // 2,869.95

describe("planBill rounding", () => {
  it("matches within the allowance and puts the paper figure on the account", () => {
    const p = planBill({ lines: lines3, written_total: 2869 });
    expect(p.matches).toBe(true);
    expect(p.billTotal).toBe(2869.95);
    expect(p.accountNet).toBe(2869);
    expect(p.invoiceAmount).toBe(2869);
    expect(p.planned[0].unitCost).toBe(959.5); // cost stays exact
  });

  it("an exact match is unchanged", () => {
    const p = planBill({ lines: [ln(1, 1920)], written_total: 1824 });
    expect(p).toMatchObject({ matches: true, accountNet: 1824, invoiceAmount: 1824 });
  });

  it("a real gap still needs the tick and a note", () => {
    expect(() => planBill({ lines: lines3, written_total: 2875 })).toThrow(/supplier's total is different/);
    const many = Array.from({ length: 48 }, (_, i) => ln(i + 1, 100, 0));
    expect(() => planBill({ lines: many, written_total: 4805 })).toThrow(/supplier's total is different/);
    expect(planBill({ lines: many, written_total: 4804.5 }).matches).toBe(true);
  });

  it("with a line sent back, the invoice is the paper figure plus the return", () => {
    const back = { line_no: 4, amount: -200, rate: 200, discount_pct: 0, billed_qty: -1, received_qty: -1, split_into: 1, toys: [{ product_id: 4, qty: -1 }] };
    const p = planBill({ lines: [...lines3, back], written_total: 2669 }); // 2,669.95 on the lines
    expect(p).toMatchObject({ matches: true, accountNet: 2669, returnValue: 200, invoiceAmount: 2869 });
  });
});
