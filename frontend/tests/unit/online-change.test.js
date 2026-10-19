// One Toy Store pilot D59: a customer sends more by transfer and gets the
// difference in cash from the drawer (INV-00078: bill 2,650, JazzCash 2,780,
// Rs 130 back). Owner, 2026-10-19: the bill keeps the full transfer and the
// change is a Cash −130 line.
import { describe, it, expect } from "vitest";
import { buildReceiptSections } from "../../src/utils/receipt";
import { onlineTender } from "../../src/pages/redesign/pos/tenderAmount";

const JAZZ = "Online - JazzCash";

describe("D59 — the Online amount box", () => {
  it("takes the full amount the customer sent, even above what is due", () => {
    expect(onlineTender("2780")).toBe(2780);
  });
  it("takes a part payment as typed", () => {
    expect(onlineTender("1000")).toBe(1000);
  });
  it("ignores an empty or zero amount", () => {
    expect(onlineTender("")).toBe(0);
    expect(onlineTender("0")).toBe(0);
  });
});

describe("D59 — receipt", () => {
  it("at the till: JazzCash 2,780 and Change 130", () => {
    const s = buildReceiptSections({ cart: [], total: 2650, payments: [{ method: JAZZ, amount: 2780 }], change: 130 }, null, "Rs");
    expect(s.payments).toEqual([{ method: JAZZ, amount: 2780 }]);
    expect(s.change).toBe(130);
  });
  it("a reprint from the saved lines reads the same, not 'Cash -130'", () => {
    const s = buildReceiptSections({
      cart: [], total: 2650, change: 0,
      payments: [{ method: JAZZ, amount: "2780.00" }, { method: "Cash", amount: "-130.00" }],
    }, null, "Rs");
    expect(s.payments).toEqual([{ method: JAZZ, amount: "2780.00" }]);
    expect(s.change).toBe(130);
  });
});
