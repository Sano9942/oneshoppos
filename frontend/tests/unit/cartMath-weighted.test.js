import { describe, it, expect } from "vitest";
import {
  calcGrossTotal,
  calcTaxTotal,
  calcTotal,
  calcDiscountValue,
} from "../../src/pages/redesign/pos/cartMath.js";

// V01 grocery harden — decimal rounding at the lane. A weighed line is
// weight × unit-price at up to 4-decimal weights (0.1235 kg × Rs 999.99/kg);
// the cart math must carry full precision so the receipt total reconciles.
// cartMath is pure and already unit-tested elsewhere — this extends coverage to
// 4-decimal weighted lines and price-locked (decoded) lines.

describe("cartMath — 4-decimal weighted lines", () => {
  it("calcGrossTotal keeps full precision for a fractional-kg weighed line", () => {
    const cart = [{ price: 999.99, quantity: 0.1235 }];
    // 999.99 * 0.1235 = 123.498765
    expect(calcGrossTotal(cart)).toBeCloseTo(123.498765, 6);
  });

  it("sums mixed weighed + unit lines exactly", () => {
    const cart = [
      { price: 999.99, quantity: 0.1235 }, // 123.498765
      { price: 250, quantity: 3 }, // 750
      { price: 45.5, quantity: 2.25 }, // 102.375
    ];
    expect(calcGrossTotal(cart)).toBeCloseTo(975.873765, 6);
  });

  it("calcTaxTotal (exclusive) on a 4-decimal weighed line", () => {
    const cart = [{ price: 999.99, quantity: 0.1235, effectiveTaxRate: 17 }];
    // gross 123.498765 * 0.17 = 20.99479...
    expect(calcTaxTotal(cart, false)).toBeCloseTo(20.994790, 5);
  });

  it("calcTaxTotal (inclusive) backs tax out of a weighed sticker price", () => {
    const cart = [{ price: 117, quantity: 0.5, effectiveTaxRate: 17 }];
    const gross = 58.5; // 117 * 0.5
    const expected = gross - gross / 1.17; // ≈ 8.5
    expect(calcTaxTotal(cart, true)).toBeCloseTo(expected, 6);
  });

  it("grand total flows through weighed line + exclusive tax", () => {
    const cart = [{ price: 999.99, quantity: 0.1235, effectiveTaxRate: 17 }];
    const gross = calcGrossTotal(cart);
    const tax = calcTaxTotal(cart, false);
    const disc = calcDiscountValue(gross, "percent", 0);
    expect(calcTotal(gross, disc, tax, false)).toBeCloseTo(144.493555, 5);
  });
});

describe("cartMath — decoded (price-locked) line behaves as a fixed line", () => {
  it("a decoded price line contributes its exact final price (qty 1)", () => {
    // Scale price-embedded pack: price is FINAL, quantity is 1.
    const cart = [{ price: 137.45, quantity: 1, price_locked: true }];
    expect(calcGrossTotal(cart)).toBe(137.45);
  });
});
