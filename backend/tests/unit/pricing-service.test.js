const {
  applyPriceBookOverrides,
  composeAutoDiscountPercent,
} = require("../../services/pricing");

describe("pricing service — applyPriceBookOverrides", () => {
  it("is a no-op on empty overrides map", () => {
    const cart = [{ id: 1, price: 100, quantity: 1 }];
    const applied = applyPriceBookOverrides(cart, new Map());
    expect(applied).toEqual([]);
    expect(cart[0].price).toBe(100);
  });

  it("applies product-level override when no variant match", () => {
    const cart = [{ id: 1, price: 100, quantity: 2 }];
    const overrides = new Map([["1:null", { price: 80, minQty: 1 }]]);
    const applied = applyPriceBookOverrides(cart, overrides);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      product_id: 1,
      variant_id: null,
      original_price: 100,
      override_price: 80,
      quantity: 2,
    });
    expect(cart[0].price).toBe(80);
  });

  it("prefers variant-scoped override over product-level when item has variant_id", () => {
    const cart = [{ id: 5, variant_id: 42, price: 200, quantity: 1 }];
    const overrides = new Map([
      ["5:null", { price: 180, minQty: 1 }],
      ["5:42", { price: 150, minQty: 1 }],
    ]);
    applyPriceBookOverrides(cart, overrides);
    expect(cart[0].price).toBe(150);
  });

  it("falls back to product-level override when no variant-specific row", () => {
    const cart = [{ id: 5, variant_id: 99, price: 200, quantity: 1 }];
    const overrides = new Map([["5:null", { price: 180, minQty: 1 }]]);
    applyPriceBookOverrides(cart, overrides);
    expect(cart[0].price).toBe(180);
  });

  it("skips override when item qty is below min_qty", () => {
    const cart = [{ id: 1, price: 100, quantity: 2 }];
    const overrides = new Map([["1:null", { price: 80, minQty: 5 }]]);
    const applied = applyPriceBookOverrides(cart, overrides);
    expect(applied).toHaveLength(0);
    expect(cart[0].price).toBe(100);
  });

  it("never applies an upward override (only downward)", () => {
    const cart = [{ id: 1, price: 50, quantity: 1 }];
    const overrides = new Map([["1:null", { price: 70, minQty: 1 }]]);
    applyPriceBookOverrides(cart, overrides);
    expect(cart[0].price).toBe(50);
  });

  it("ignores bundle items", () => {
    const cart = [{ id: 1, price: 100, quantity: 1, is_bundle: true }];
    const overrides = new Map([["1:null", { price: 80, minQty: 1 }]]);
    const applied = applyPriceBookOverrides(cart, overrides);
    expect(applied).toHaveLength(0);
    expect(cart[0].price).toBe(100);
  });

  it("uses original_product_id when item.id has been rewritten (bundle expansion)", () => {
    const cart = [
      { id: 999, original_product_id: 7, price: 100, quantity: 1 },
    ];
    const overrides = new Map([["7:null", { price: 60, minQty: 1 }]]);
    applyPriceBookOverrides(cart, overrides);
    expect(cart[0].price).toBe(60);
  });
});

describe("pricing service — composeAutoDiscountPercent", () => {
  it("returns 0 pct when neither group nor tier set", () => {
    const r = composeAutoDiscountPercent({ group: null, tier: null });
    expect(r.pct).toBe(0);
    expect(r.breakdown).toEqual([]);
  });

  it("stacks group + tier additively (10% + 5% = 15%)", () => {
    const r = composeAutoDiscountPercent({
      group: { id: 1, name: "Wholesale", discount_percent: 10 },
      tier: { id: 2, name: "Silver", discount_percent: 5 },
    });
    expect(r.pct).toBe(15);
    expect(r.breakdown).toHaveLength(2);
    expect(r.breakdown[0]).toMatchObject({
      kind: "customer_group",
      customer_group_id: 1,
      percent: 10,
    });
    expect(r.breakdown[1]).toMatchObject({
      kind: "loyalty_tier",
      loyalty_tier_id: 2,
      percent: 5,
    });
  });

  it("suppresses group when applyGroup=false (flag off)", () => {
    const r = composeAutoDiscountPercent({
      group: { id: 1, name: "Wholesale", discount_percent: 10 },
      tier: { id: 2, name: "Silver", discount_percent: 5 },
      applyGroup: false,
    });
    expect(r.pct).toBe(5);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].kind).toBe("loyalty_tier");
  });

  it("suppresses tier when applyTier=false (loyalty flag off)", () => {
    const r = composeAutoDiscountPercent({
      group: { id: 1, name: "Wholesale", discount_percent: 10 },
      tier: { id: 2, name: "Silver", discount_percent: 5 },
      applyTier: false,
    });
    expect(r.pct).toBe(10);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].kind).toBe("customer_group");
  });

  it("caps at 100% so subtotal never goes negative", () => {
    const r = composeAutoDiscountPercent({
      group: { id: 1, name: "Weird", discount_percent: 80 },
      tier: { id: 2, name: "Weirder", discount_percent: 50 },
    });
    expect(r.pct).toBe(100);
  });

  it("ignores 0% or missing discount_percent", () => {
    const r = composeAutoDiscountPercent({
      group: { id: 1, name: "Default", discount_percent: 0 },
      tier: { id: 2, name: "Bronze", discount_percent: 0 },
    });
    expect(r.pct).toBe(0);
    expect(r.breakdown).toEqual([]);
  });
});
