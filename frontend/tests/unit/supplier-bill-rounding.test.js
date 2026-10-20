// F9 (e) trial, owner 2026-10-20: a bill that rounds each line to whole rupees
// (A2Z: 48 lines − 5 %, paper 138,396 vs lines 138,396.95) counts as matching.
// Allowed gap: under 50 paisa per line, never Rs 5 or more.
import { describe, it, expect } from "vitest";
import { lineFromRead, billSummary, roundingAllowance } from "../../src/pages/redesign/supplierBill/billMath";

const line = (i, amount, pct = 5) => {
  const l = lineFromRead({ line_no: String(i), page: 1, supplier_code: `C${i}`, description: "T", qty: 1, rate: amount, amount, check: "ok" }, { matches: [], chosen: [] });
  l.discount_pct = pct;
  return l;
};

describe("rounding allowance", () => {
  it("is 50 paisa per line, at most Rs 5", () => {
    expect(roundingAllowance(1)).toBe(0.5);
    expect(roundingAllowance(2)).toBe(1);
    expect(roundingAllowance(48)).toBe(5);
    expect(roundingAllowance(0)).toBe(0.5);
  });

  it("A2Z-style: 3 lines each rounded by the supplier still match", () => {
    const lines = [line(1, 1010), line(2, 1010), line(3, 1001)]; // 959.5 + 959.5 + 950.95 = 2,869.95
    expect(billSummary(lines, 2869)).toMatchObject({ difference: -0.95, total_matches: true });
    expect(billSummary(lines, 2871)).toMatchObject({ difference: 1.05, total_matches: true });
  });

  it("a real gap still asks why", () => {
    const lines = [line(1, 1010), line(2, 1010), line(3, 1001)];
    expect(billSummary(lines, 2875)).toMatchObject({ total_matches: false });
    const many = Array.from({ length: 48 }, (_, i) => line(i + 1, 100, 0));
    expect(billSummary(many, 4805)).toMatchObject({ difference: 5, total_matches: false });
    expect(billSummary(many, 4804.5)).toMatchObject({ total_matches: true });
  });

  it("one line keeps the old 50 paisa rule", () => {
    expect(billSummary([line(1, 1920)], 1824.4)).toMatchObject({ total_matches: true });
    expect(billSummary([line(1, 1920)], 1825)).toMatchObject({ total_matches: false });
  });
});
