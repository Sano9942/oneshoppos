import { describe, it, expect, vi } from "vitest";
import { evaluatePromotions } from "../../services/promo-engine.js";

// V01 grocery harden: a price-embedded (scale-priced) deli pack carries a FINAL
// price and must never be re-discounted by a storewide percentage promo. The
// exclusion lives in the shared promo engine (one choke point for POS-quote,
// storefront, portal, and field-rep) via the per-item `price_locked` flag.

/** Fake tenant db that returns the given promos for the promotions SELECT. */
function fakeDb(promos) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM promotions/i.test(sql)) return { rows: promos };
      return { rows: [] };
    }),
  };
}

const STOREWIDE_10 = {
  id: 1,
  name: "10% off storewide",
  type: "percent",
  value: 10,
  applies_to: "all",
  priority: 1,
  active: true,
};

describe("evaluatePromotions — price_locked exclusion (storewide-promo case)", () => {
  it("does NOT discount a price_locked deli pack under a 10%-off-storewide promo", async () => {
    const db = fakeDb([STOREWIDE_10]);
    const items = [
      { product_id: 1, category_id: null, quantity: 2, price: 100 }, // normal → 200
      { product_id: 2, category_id: null, quantity: 1, price: 500, price_locked: true }, // scale-priced pack
    ];
    const { applied, totalDiscount } = await evaluatePromotions(db, items, 700);
    // 10% of the 200 normal spend only; the 500 locked line is untouched.
    expect(totalDiscount).toBe(20);
    expect(applied).toHaveLength(1);
    expect(applied[0].discount).toBe(20);
  });

  it("discounts the whole cart when nothing is locked (regression guard)", async () => {
    const db = fakeDb([STOREWIDE_10]);
    const items = [
      { product_id: 1, quantity: 2, price: 100 },
      { product_id: 2, quantity: 1, price: 500 },
    ];
    const { totalDiscount } = await evaluatePromotions(db, items, 700);
    expect(totalDiscount).toBe(70); // (200 + 500) * 10%
  });

  it("excludes locked lines from slab-percent qty tiers", async () => {
    const SLAB = {
      id: 2,
      name: "Volume slab",
      type: "slab_percent",
      applies_to: "all",
      priority: 1,
      active: true,
      tier_rules: [
        { qty_from: 1, qty_to: 5, value: 5 },
        { qty_from: 6, qty_to: null, value: 10 },
      ],
    };
    const db = fakeDb([SLAB]);
    // 4 normal units + 3 locked units. Locked units must not push qty into the
    // 6+ tier, and must not receive discount.
    const items = [
      { product_id: 1, quantity: 4, price: 100 }, // 400, qualifies
      { product_id: 2, quantity: 3, price: 100, price_locked: true }, // excluded
    ];
    const { applied, totalDiscount } = await evaluatePromotions(db, items, 700);
    expect(applied[0].qty_qualifying).toBe(4); // 5% tier, not 10%
    expect(totalDiscount).toBe(20); // 400 * 5%
  });

  it("excludes locked lines from a flat fixed cart discount", async () => {
    const FIXED = {
      id: 3,
      name: "Rs 50 off",
      type: "fixed",
      value: 50,
      applies_to: "all",
      priority: 1,
      active: true,
    };
    const db = fakeDb([FIXED]);
    const items = [
      { product_id: 1, quantity: 1, price: 30 }, // only 30 of eligible spend
      { product_id: 2, quantity: 1, price: 500, price_locked: true },
    ];
    const { totalDiscount } = await evaluatePromotions(db, items, 530);
    // min(50, eligible matched total 30) → 30, NOT 50 eating into the locked line
    expect(totalDiscount).toBe(30);
  });
});
