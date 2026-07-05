/**
 * Plan-01 (cross-surface) — unified pricing/promo resolution seam test.
 *
 * Proves the same customer + product + qty resolves to the same price and
 * the same scheme discount on every engine entry point:
 *   - services/pricing.resolvePriceForContext  (shared cascade)
 *   - POST /api/promotions/quote               (POS + field-rep promo engine)
 *   - services/quote.calculateQuote            (storefront + portal reorder)
 *   - POST /api/field/price-quote              (field-rep price resolution)
 *
 * Pre-unification failures this guards against (plan-01 trap 6):
 *   - quote.js promo fork missing slab_percent / brand scope / priority order
 *   - price-list precedence inverted (outlet beat customer on storefront)
 *   - qty breaks ignored server-side (lowest min_qty row won regardless of qty)
 *   - field-rep surface stuck on base price
 */
const { createTestApp } = require("../helpers/createTestApp-pg");
const request = require("supertest");
const { resolvePriceForContext } = require("../../services/pricing");
const { calculateQuote } = require("../../services/quote");

describe("plan-01 — pricing/promo unification across surfaces", () => {
  let app, db, deps, cleanup;
  let brandId, productId, customerId, channelId;
  const OUTLET_ID = 1;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/promotions")(app, deps);
    require("../../routes/field")(app, deps);

    // Brand-scoped product at base price 100
    const { rows: [brand] } = await db.query(
      "INSERT INTO brands (name) VALUES ('Acme') RETURNING id"
    );
    brandId = brand.id;
    const { rows: [product] } = await db.query(
      `INSERT INTO products (name, price, status, brand_id)
       VALUES ('Unification Widget', 100, 'active', $1) RETURNING id`,
      [brandId]
    );
    productId = product.id;

    // Customer with a direct price list: 80 each, 70 at 10+ (qty break)
    const { rows: [custList] } = await db.query(
      "INSERT INTO price_lists (name, type, is_active) VALUES ('Wholesale A', 'customer_group', true) RETURNING id"
    );
    await db.query(
      `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
       VALUES ($1, $2, NULL, 80, 1), ($1, $2, NULL, 70, 10)`,
      [custList.id, productId]
    );
    const { rows: [customer] } = await db.query(
      "INSERT INTO customers (name, price_list_id) VALUES ('Big Buyer', $1) RETURNING id",
      [custList.id]
    );
    customerId = customer.id;

    // Competing OUTLET-scoped list at 90 — must LOSE to the customer list
    // (this is the precedence inversion the old copies had).
    const { rows: [outletList] } = await db.query(
      "INSERT INTO price_lists (name, type, is_active) VALUES ('Outlet List', 'customer_group', true) RETURNING id"
    );
    await db.query(
      `INSERT INTO price_list_items (price_list_id, product_id, variant_id, price, min_qty)
       VALUES ($1, $2, NULL, 90, 1)`,
      [outletList.id, productId]
    );
    await db.query(
      `INSERT INTO price_list_assignments (price_list_id, scope_type, scope_id, priority, is_active)
       VALUES ($1, 'outlet', $2, 100, true)`,
      [outletList.id, OUTLET_ID]
    );

    // Brand-scoped slab scheme: 5% off at 10+ qty (Tier 1.3 features the
    // old storefront fork could not evaluate at all).
    await db.query(
      `INSERT INTO promotions (name, type, applies_to, brand_id, active, tier_rules, priority)
       VALUES ('Acme Slab', 'slab_percent', 'brand', $1, true,
               '[{"qty_from":10,"qty_to":null,"value":5}]'::jsonb, 10)`,
      [brandId]
    );

    // Storefront prerequisites: channel + publication + pickup stock
    const { rows: [channel] } = await db.query(
      "INSERT INTO sales_channels (code, name, type) VALUES ('web', 'Web Store', 'storefront') RETURNING id"
    );
    channelId = channel.id;
    await db.query(
      "INSERT INTO channel_publications (channel_id, product_id, is_published) VALUES ($1, $2, true)",
      [channelId, productId]
    );
    await db.query(
      `INSERT INTO outlet_stock (outlet_id, product_id, quantity) VALUES ($1, $2, 500)
       ON CONFLICT (outlet_id, product_id) DO UPDATE SET quantity = 500`,
      [OUTLET_ID, productId]
    );

    // Field-rep surface flag
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_field_sales', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("shared resolver: customer price list beats outlet assignment", async () => {
    const r = await resolvePriceForContext(db, {
      productId, qty: 2, outletId: OUTLET_ID, customerId,
    });
    expect(r.price).toBe(80);
    expect(r.source).toBe("customer_price_list");
  });

  it("shared resolver: qty break applies at 10+", async () => {
    const r = await resolvePriceForContext(db, {
      productId, qty: 12, outletId: OUTLET_ID, customerId,
    });
    expect(r.price).toBe(70);
  });

  it("shared resolver: anonymous buyer falls to outlet list, then base", async () => {
    const outlet = await resolvePriceForContext(db, {
      productId, qty: 1, outletId: OUTLET_ID, customerId: null,
    });
    expect(outlet.price).toBe(90);
    expect(outlet.source).toBe("assignment:outlet");

    const base = await resolvePriceForContext(db, { productId, qty: 1 });
    expect(base.price).toBe(100);
    expect(base.source).toBe("base_price");
  });

  it("POS/field promo endpoint evaluates the brand slab", async () => {
    const res = await request(app)
      .post("/api/promotions/quote")
      .set("x-employee-id", "1")
      .send({
        items: [{ product_id: productId, quantity: 12, price: 70 }],
        order_total: 840,
      });
    expect(res.status).toBe(200);
    expect(res.body.applied_promotions).toHaveLength(1);
    expect(res.body.applied_promotions[0].type).toBe("slab_percent");
    // 5% of 12 × 70 = 42
    expect(res.body.total_promotion_discount).toBe(42);
  });

  it("storefront quote resolves the SAME price and SAME slab discount", async () => {
    const quote = await calculateQuote(
      db,
      [{ productId, variantId: null, qty: 12 }],
      "pickup",
      OUTLET_ID,
      channelId,
      null,
      { taxMode: "none", customerId }
    );
    expect(quote.availabilityErrors).toHaveLength(0);
    // Customer price list (qty break) — not base 100, not outlet 90.
    expect(quote.items[0].unitPrice).toBe(70);
    // Slab evaluated identically to the POS engine: 5% of 840 = 42.
    expect(quote.appliedPromotions).toHaveLength(1);
    expect(quote.appliedPromotions[0].type).toBe("slab_percent");
    expect(quote.discountTotal).toBe(42);
    expect(quote.subtotal).toBe(840);
    expect(quote.grandTotal).toBe(798);
  });

  it("storefront quote for an anonymous cart uses the outlet list price", async () => {
    const quote = await calculateQuote(
      db,
      [{ productId, variantId: null, qty: 1 }],
      "pickup",
      OUTLET_ID,
      channelId,
      null,
      { taxMode: "none" }
    );
    expect(quote.items[0].unitPrice).toBe(90);
  });

  it("field-rep price quote returns the buyer's negotiated prices", async () => {
    const res = await request(app)
      .post("/api/field/price-quote")
      .set("x-employee-id", "1")
      .send({
        customer_id: customerId,
        items: [
          { product_id: productId, quantity: 2 },
          { product_id: productId, quantity: 12 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.prices[0].unit_price).toBe(80);
    expect(res.body.prices[1].unit_price).toBe(70);
  });

  it("field-rep price quote validates input", async () => {
    const res = await request(app)
      .post("/api/field/price-quote")
      .set("x-employee-id", "1")
      .send({ items: [] });
    expect(res.status).toBe(400);
  });
});
