import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── cartMath ──────────────────────────────────────────────────────────────────

import {
  calcGrossTotal,
  calcDiscountValue,
  calcTaxTotal,
  calcTotal,
} from "../../src/pages/redesign/pos/cartMath.js";

describe("calcGrossTotal", () => {
  it("sums price × quantity for all items", () => {
    const cart = [
      { price: 100, quantity: 3 },
      { price: 250, quantity: 1 },
    ];
    expect(calcGrossTotal(cart)).toBe(550);
  });

  it("returns 0 for empty cart", () => {
    expect(calcGrossTotal([])).toBe(0);
  });

  it("treats missing price as 0", () => {
    expect(calcGrossTotal([{ quantity: 2 }])).toBe(0);
  });

  it("handles string price values (coerces to number)", () => {
    expect(calcGrossTotal([{ price: "200", quantity: 2 }])).toBe(400);
  });
});

describe("calcDiscountValue", () => {
  it("calculates percentage discount correctly", () => {
    expect(calcDiscountValue(1000, "percent", 10)).toBe(100);
    expect(calcDiscountValue(1000, "percent", 25)).toBe(250);
  });

  it("returns flat discount as-is", () => {
    expect(calcDiscountValue(1000, "flat", 150)).toBe(150);
  });

  it("returns 0 for empty discount input", () => {
    expect(calcDiscountValue(1000, "percent", "")).toBe(0);
    expect(calcDiscountValue(1000, "flat", "")).toBe(0);
  });

  it("100% discount equals the full gross total", () => {
    expect(calcDiscountValue(1000, "percent", 100)).toBe(1000);
  });
});

describe("calcTaxTotal", () => {
  it("EXCLUSIVE mode: tax sits on top (P8 fix — was incorrectly 0 before)", () => {
    const cart = [{ price: 100, quantity: 1, effectiveTaxRate: 18 }];
    expect(calcTaxTotal(cart, false)).toBeCloseTo(18, 2);
  });

  it("extracts inclusive tax correctly (18% GST)", () => {
    // PKR 118 inclusive of 18% tax → tax = 118 - 118/1.18 ≈ 18
    const cart = [{ price: 118, quantity: 1, effectiveTaxRate: 18 }];
    const tax = calcTaxTotal(cart, true);
    expect(tax).toBeCloseTo(18, 1);
  });

  it("returns 0 for items with zero tax rate", () => {
    const cart = [{ price: 100, quantity: 2, effectiveTaxRate: 0 }];
    expect(calcTaxTotal(cart, true)).toBe(0);
    expect(calcTaxTotal(cart, false)).toBe(0);
  });

  it("sums tax across multiple items (inclusive mode)", () => {
    const cart = [
      { price: 118, quantity: 1, effectiveTaxRate: 18 },
      { price: 110, quantity: 1, effectiveTaxRate: 10 },
    ];
    const tax = calcTaxTotal(cart, true);
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeCloseTo(18 + 10, 0);
  });
});

describe("calcTotal", () => {
  it("subtracts discount from gross (no tax)", () => {
    expect(calcTotal(1000, 100, 0, false)).toBe(900);
  });

  it("adds exclusive tax to post-discount amount", () => {
    expect(calcTotal(1000, 0, 150, false)).toBe(1150);
  });

  it("does not add inclusive tax to total (already in price)", () => {
    expect(calcTotal(1000, 0, 150, true)).toBe(1000);
  });

  it("total cannot go below zero when discount exceeds subtotal", () => {
    expect(calcTotal(100, 200, 0, false)).toBe(0);
  });

  it("combines discount and exclusive tax correctly", () => {
    // gross 1000 - discount 100 + tax 90 = 990
    expect(calcTotal(1000, 100, 90, false)).toBe(990);
  });
});

// ── CurrencyContext ───────────────────────────────────────────────────────────

import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { CurrencyProvider, useCurrency } from "../../src/contexts/CurrencyContext.jsx";

describe("CurrencyContext — fmt()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ symbol: "PKR", code: "PKR", denominations: null }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }) {
    return React.createElement(CurrencyProvider, null, children);
  }

  it("fmt() formats a whole number with symbol", async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.symbol).toBe("PKR"));
    const formatted = result.current.fmt(1000);
    expect(formatted).toContain("1,000");
  });

  it("fmt() formats zero", async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current.fmt).toBeDefined());
    const formatted = result.current.fmt(0);
    expect(formatted).toContain("0");
  });
});
