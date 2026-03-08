/**
 * promotions.test.js — Integration tests for /api/promotions and /api/promotions/quote
 *
 * Targets bug: B10 (BXGY treats cart lines independently — doesn't combine quantities)
 */

const { createTestApp, closeDb, dbAll, dbGet, dbRun } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db;

// Promo IDs assigned during setup
let percentPromoId, fixedPromoId, thresholdPercentId, thresholdFixedId, bxgyPromoId, categoryPromoId;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // Create test promotions
  let res;

  // 1. Percent: 10% off all items
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "10% Off Everything",
    type: "percent",
    value: 10,
    applies_to: "all",
  });
  percentPromoId = res.body.id;

  // 2. Fixed: $50 off all items
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "$50 Off",
    type: "fixed",
    value: 50,
    applies_to: "all",
    active: 0, // start inactive
  });
  fixedPromoId = res.body.id;
  // Deactivate it for now so it doesn't interfere
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [fixedPromoId]);

  // 3. Threshold percent: 15% off when order >= 500
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "15% Off Orders Over 500",
    type: "threshold_percent",
    value: 15,
    min_order_amount: 500,
    applies_to: "all",
    active: 0,
  });
  thresholdPercentId = res.body.id;
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [thresholdPercentId]);

  // 4. Threshold fixed: $100 off when order >= 1000
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "$100 Off Orders Over 1000",
    type: "threshold_fixed",
    value: 100,
    min_order_amount: 1000,
    applies_to: "all",
    active: 0,
  });
  thresholdFixedId = res.body.id;
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [thresholdFixedId]);

  // 5. BXGY: Buy 2 Get 1 Free on product 1
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "Buy 2 Get 1 Free",
    type: "bxgy",
    value: 0,
    buy_qty: 2,
    get_qty: 1,
    applies_to: "product",
    product_id: 1,
    active: 0,
  });
  bxgyPromoId = res.body.id;
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [bxgyPromoId]);

  // 6. Category-specific percent: 20% off Electronics (category 1)
  res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
    name: "20% Off Electronics",
    type: "percent",
    value: 20,
    applies_to: "category",
    category_id: 1,
    active: 0,
  });
  categoryPromoId = res.body.id;
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [categoryPromoId]);

  // Deactivate the percent promo too — we activate per test
  await dbRun(db, "UPDATE promotions SET active = 0 WHERE id = ?", [percentPromoId]);
});

afterAll(async () => {
  await closeDb(db);
});

// Helper to activate a single promo and deactivate all others
async function activateOnly(promoId) {
  await dbRun(db, "UPDATE promotions SET active = 0");
  if (promoId) {
    await dbRun(db, "UPDATE promotions SET active = 1 WHERE id = ?", [promoId]);
  }
}

// Helper to quote
function quote(items, orderTotal) {
  return makeRequest(app).post("/api/promotions/quote").send({
    items,
    order_total: orderTotal || items.reduce((s, i) => s + i.price * i.quantity, 0),
  });
}

describe("POST /api/promotions/quote — Percent Promotions", () => {
  it("10% off all items", async () => {
    await activateOnly(percentPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 2, price: 100 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.total_promotion_discount).toBe(20); // 200 * 10%
    expect(res.body.applied_promotions).toHaveLength(1);
    expect(res.body.applied_promotions[0].name).toBe("10% Off Everything");
  });

  it("category-specific percent only applies to matching category", async () => {
    await activateOnly(categoryPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 1, price: 100 }, // Electronics — matches
      { product_id: 4, category_id: 2, quantity: 1, price: 50 },  // Groceries — doesn't match
    ]);

    expect(res.status).toBe(200);
    // 20% off only the Electronics item: 100 * 20% = 20
    expect(res.body.total_promotion_discount).toBe(20);
  });

  it("inactive promo not applied", async () => {
    await activateOnly(null); // deactivate all

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 1, price: 100 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.total_promotion_discount).toBe(0);
    expect(res.body.applied_promotions).toHaveLength(0);
  });

  it("future start date not applied", async () => {
    await dbRun(db, "UPDATE promotions SET active = 1, starts_at = '2099-01-01' WHERE id = ?", [percentPromoId]);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 1, price: 100 },
    ]);

    expect(res.body.total_promotion_discount).toBe(0);

    // Reset
    await dbRun(db, "UPDATE promotions SET active = 0, starts_at = NULL WHERE id = ?", [percentPromoId]);
  });

  it("expired promo not applied", async () => {
    await dbRun(db, "UPDATE promotions SET active = 1, ends_at = '2020-01-01' WHERE id = ?", [percentPromoId]);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 1, price: 100 },
    ]);

    expect(res.body.total_promotion_discount).toBe(0);

    // Reset
    await dbRun(db, "UPDATE promotions SET active = 0, ends_at = NULL WHERE id = ?", [percentPromoId]);
  });
});

describe("Promotion category validation", () => {
  it("rejects category promotions for parent categories", async () => {
    await dbRun(
      db,
      `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
       VALUES (50, 'Parent Category', '', NULL, 0, 1)`,
    );
    await dbRun(
      db,
      `INSERT INTO categories (id, name, description, parent_id, sort_order, is_active)
       VALUES (51, 'Child Category', '', 50, 0, 1)`,
    );

    const res = await makeRequest(app, ADMIN_ID).post("/api/promotions").send({
      name: "Invalid Parent Promo",
      type: "percent",
      value: 10,
      applies_to: "category",
      category_id: 50,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leaf categories/i);
  });
});

describe("POST /api/promotions/quote — Fixed Promotions", () => {
  it("$50 off $200 total", async () => {
    await activateOnly(fixedPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 2, price: 100 },
    ]);

    expect(res.body.total_promotion_discount).toBe(50);
  });

  it("$50 off $30 total — capped at matched total", async () => {
    await activateOnly(fixedPromoId);

    const res = await quote([
      { product_id: 4, category_id: 2, quantity: 1, price: 30 },
    ]);

    // discount = min(50, 30) = 30
    expect(res.body.total_promotion_discount).toBe(30);
  });
});

describe("POST /api/promotions/quote — Threshold Promotions", () => {
  it("threshold_percent: min_order met → applied", async () => {
    await activateOnly(thresholdPercentId);

    const res = await quote(
      [{ product_id: 3, category_id: 1, quantity: 2, price: 500 }],
      1000,
    );

    // 15% of 1000 = 150
    expect(res.body.total_promotion_discount).toBe(150);
  });

  it("threshold_percent: min_order not met → not applied", async () => {
    await activateOnly(thresholdPercentId);

    const res = await quote(
      [{ product_id: 1, category_id: 1, quantity: 1, price: 100 }],
      100,
    );

    expect(res.body.total_promotion_discount).toBe(0);
  });

  it("threshold_fixed: capped at matched total", async () => {
    await activateOnly(thresholdFixedId);

    const res = await quote(
      [{ product_id: 4, category_id: 2, quantity: 1, price: 50 }],
      1000, // order_total meets threshold
    );

    // discount = min(100, 50) = 50
    expect(res.body.total_promotion_discount).toBe(50);
  });
});

describe("POST /api/promotions/quote — BXGY Promotions", () => {
  it("buy-2-get-1: qty=3 → 1 free item", async () => {
    await activateOnly(bxgyPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 3, price: 100 },
    ]);

    // sets = floor(3 / (2+1)) = 1, discount = 1 * 1 * 100 = 100
    expect(res.body.total_promotion_discount).toBe(100);
  });

  it("buy-2-get-1: qty=6 → 2 free items", async () => {
    await activateOnly(bxgyPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 6, price: 100 },
    ]);

    // sets = floor(6 / 3) = 2, discount = 2 * 1 * 100 = 200
    expect(res.body.total_promotion_discount).toBe(200);
  });

  it("buy-2-get-1: qty=2 → 0 free (not enough for a full set)", async () => {
    await activateOnly(bxgyPromoId);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 2, price: 100 },
    ]);

    // sets = floor(2 / 3) = 0
    expect(res.body.total_promotion_discount).toBe(0);
  });

  it("B10 fix: same product split across 2 lines combines quantities", async () => {
    await activateOnly(bxgyPromoId);

    // 2 cart lines, each qty=2 of product 1 → total qty=4 → sets=floor(4/3)=1
    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 2, price: 100 },
      { product_id: 1, category_id: 1, quantity: 2, price: 100 },
    ]);

    // B10 fixed: combined qty=4, sets=1, discount = 1 * 1 * 100 = 100
    expect(res.body.total_promotion_discount).toBe(100);
  });
});

describe("POST /api/promotions/quote — Edge Cases", () => {
  it("multiple active promos stack", async () => {
    // Activate both percent (10%) and category (20% Electronics)
    await dbRun(db, "UPDATE promotions SET active = 0");
    await dbRun(db, "UPDATE promotions SET active = 1 WHERE id IN (?, ?)", [percentPromoId, categoryPromoId]);

    const res = await quote([
      { product_id: 1, category_id: 1, quantity: 1, price: 100 }, // Electronics
    ]);

    // 10% off all = 10, plus 20% off Electronics = 20, total = 30
    expect(res.body.total_promotion_discount).toBe(30);
    expect(res.body.applied_promotions).toHaveLength(2);
  });

  it("empty cart → 0 discount", async () => {
    await activateOnly(percentPromoId);

    const res = await quote([], 0);

    expect(res.body.total_promotion_discount).toBe(0);
    expect(res.body.applied_promotions).toHaveLength(0);
  });

  it("all items excluded from promo → 0 discount", async () => {
    await activateOnly(categoryPromoId); // 20% off Electronics only

    const res = await quote([
      { product_id: 4, category_id: 2, quantity: 1, price: 50 }, // Groceries — doesn't match
    ]);

    expect(res.body.total_promotion_discount).toBe(0);
  });
});
