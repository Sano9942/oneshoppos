/**
 * cartMath-tax-mode.test.js — P8 (3.14) tax-mode behavior for cart math
 *
 * The original `calcTaxTotal` early-returned 0 in exclusive mode, so the
 * cart UI silently lost all tax in that mode. This spec asserts:
 *   1. Exclusive mode now returns non-zero tax (tax-on-top semantics).
 *   2. Exclusive math: tax = price * qty * rate / 100.
 *   3. Mixed-rate carts (3.14 fixture: 17% + 5%) sum correctly under both modes.
 *   4. Inclusive math is unchanged (regression check).
 */

import { describe, it, expect } from "vitest";
import { calcTaxTotal, calcTotal } from "../../src/pages/redesign/pos/cartMath.js";

describe("calcTaxTotal — tax_mode behaviour", () => {
  it("EXCLUSIVE mode adds tax on top (was returning 0 before P8 fix)", () => {
    const cart = [{ price: 100, quantity: 1, effectiveTaxRate: 17 }];
    expect(calcTaxTotal(cart, false)).toBeCloseTo(17, 2);
  });

  it("EXCLUSIVE mode — multi-line cart sums correctly", () => {
    const cart = [
      { price: 100, quantity: 1, effectiveTaxRate: 17 },
      { price: 50, quantity: 2, effectiveTaxRate: 5 },
    ];
    // 100*17/100 = 17, 100*5/100 = 5 → 22
    expect(calcTaxTotal(cart, false)).toBeCloseTo(22, 2);
  });

  it("INCLUSIVE mode — 3.14 fixture (Coffee 17% + Snack 5%) → 19.29", () => {
    const cart = [
      { price: 100, quantity: 1, effectiveTaxRate: 17 },
      { price: 50, quantity: 2, effectiveTaxRate: 5 },
    ];
    // 100*17/117 ≈ 14.53, 100*5/105 ≈ 4.76 → 19.29
    expect(calcTaxTotal(cart, true)).toBeCloseTo(19.29, 1);
  });

  it("zero rate items contribute 0 in either mode", () => {
    const cart = [{ price: 100, quantity: 5, effectiveTaxRate: 0 }];
    expect(calcTaxTotal(cart, true)).toBe(0);
    expect(calcTaxTotal(cart, false)).toBe(0);
  });

  it("calcTotal — exclusive mode: total = gross + tax (regression-checks bug fix end-to-end)", () => {
    const cart = [
      { price: 100, quantity: 1, effectiveTaxRate: 17 },
      { price: 50, quantity: 2, effectiveTaxRate: 5 },
    ];
    const gross = 200; // 100 + 100
    const tax = calcTaxTotal(cart, false); // 22
    expect(calcTotal(gross, 0, tax, false)).toBeCloseTo(222, 2);
  });
});
