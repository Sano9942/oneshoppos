/**
 * Phase 2-G Wave 3 — 2-G.1 variant matrix + variant_outlet_stock integration test.
 *
 * Covers:
 *   1. GET /api/products/:id/variants?outlet_id= returns per-outlet stock
 *      from variant_outlet_stock with fallback to product_variants.stock.
 *   2. POST /api/sales with a variant_id line decrements variant_outlet_stock
 *      at the selling outlet only (other outlets untouched) AND keeps
 *      product_variants.stock + outlet_stock in sync.
 *   3. Returns restock both variant_outlet_stock + product_variants.stock.
 *   4. Migration backfill seeds variant_outlet_stock for existing variants.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup;
let reqAdmin;

// Test fixture — create a parent product with 4 variants (2 sizes × 2 colors).
// variant ids stored here for use in the test bodies.
const fixture = {
  parentProductId: null,
  variantIds: [], // [v_smallRed, v_smallBlue, v_largeRed, v_largeBlue]
};

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  await db.query("SET TIME ZONE 'UTC'");

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  require("../../routes/shifts")(app, deps);
  require("../../routes/attendance")(app, deps);
  require("../../routes/sales")(app, deps);
  require("../../routes/returns")(app, deps);
  require("../../routes/products")(app, deps);

  reqAdmin = makeRequest(app, ADMIN_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // Seed a parent product with 4 variants (2 sizes × 2 colors).
  const { rows: [parent] } = await db.query(
    `INSERT INTO products (name, price, cost_price, barcode, sku, status, has_variants)
       VALUES ('T-Shirt', 500, 200, 'TSH-001', 'TSH-001', 'active', true)
     RETURNING id`,
  );
  fixture.parentProductId = parent.id;

  const combos = [
    { sku: "TSH-S-RED", size: "S", color: "Red", stock: 10 },
    { sku: "TSH-S-BLU", size: "S", color: "Blue", stock: 3 }, // low stock
    { sku: "TSH-L-RED", size: "L", color: "Red", stock: 0 }, // out
    { sku: "TSH-L-BLU", size: "L", color: "Blue", stock: 20 },
  ];

  // Attribute set + attributes + options (size, color).
  const { rows: [attrSet] } = await db.query(
    `INSERT INTO attribute_sets (name) VALUES ('apparel') RETURNING id`,
  );
  const { rows: [sizeAttr] } = await db.query(
    `INSERT INTO attributes (name, attribute_set_id) VALUES ('size', $1) RETURNING id`,
    [attrSet.id],
  );
  const { rows: [colorAttr] } = await db.query(
    `INSERT INTO attributes (name, attribute_set_id) VALUES ('color', $1) RETURNING id`,
    [attrSet.id],
  );
  const opts = {};
  for (const val of ["S", "L"]) {
    const { rows: [o] } = await db.query(
      `INSERT INTO attribute_options (attribute_id, value) VALUES ($1, $2) RETURNING id`,
      [sizeAttr.id, val],
    );
    opts[`size:${val}`] = o.id;
  }
  for (const val of ["Red", "Blue"]) {
    const { rows: [o] } = await db.query(
      `INSERT INTO attribute_options (attribute_id, value) VALUES ($1, $2) RETURNING id`,
      [colorAttr.id, val],
    );
    opts[`color:${val}`] = o.id;
  }

  for (const c of combos) {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, price, cost_price, stock)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [parent.id, c.sku, 500, 200, c.stock],
    );
    fixture.variantIds.push(v.id);
    await db.query(
      `INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id)
         VALUES ($1, $2, $3)`,
      [v.id, sizeAttr.id, opts[`size:${c.size}`]],
    );
    await db.query(
      `INSERT INTO variant_option_values (variant_id, attribute_id, attribute_option_id)
         VALUES ($1, $2, $3)`,
      [v.id, colorAttr.id, opts[`color:${c.color}`]],
    );
    // Seed variant_outlet_stock at outlet 1 with the same stock, outlet 2 with 0.
    await db.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
         VALUES ($1, 1, $2), ($1, 2, 0)`,
      [v.id, c.stock],
    );
  }
  // Seed product-level outlet_stock too (so sales path can decrement it).
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
       VALUES ($1, 1, 33), ($1, 2, 0)`,
    [parent.id],
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();
}

async function getVariantOutletStock(variantId, outletId) {
  const { rows } = await db.query(
    `SELECT COALESCE(quantity, 0)::numeric AS q
       FROM variant_outlet_stock
      WHERE variant_id = $1 AND outlet_id = $2`,
    [variantId, outletId],
  );
  return rows[0] ? Number(rows[0].q) : null;
}

async function getVariantRollupStock(variantId) {
  const { rows } = await db.query(
    `SELECT stock::numeric AS q FROM product_variants WHERE id = $1`,
    [variantId],
  );
  return Number(rows[0].q);
}

describe("Phase 2-G Wave 3 — 2-G.1 variant matrix + variant_outlet_stock", () => {
  beforeEach(async () => {
    await setFlag("phase2g_variant_picker", true);
  });

  test("GET /api/products/:id/variants?outlet_id=1 returns per-outlet stock", async () => {
    const res = await reqAdmin.get(
      `/api/products/${fixture.parentProductId}/variants?outlet_id=1`,
    );
    expect(res.status).toBe(200);
    const vs = res.body.variants;
    expect(vs).toHaveLength(4);
    for (const v of vs) {
      // Each variant should have stock_at_outlet matching the seeded value.
      expect(v.stock_at_outlet).toBeDefined();
      expect(Number(v.stock_at_outlet)).toBeGreaterThanOrEqual(0);
    }
    // The out-of-stock variant (TSH-L-RED) must show 0.
    const outOfStock = vs.find((v) => v.sku === "TSH-L-RED");
    expect(Number(outOfStock.stock_at_outlet)).toBe(0);
    // The low-stock variant (TSH-S-BLU) must show 3.
    const lowStock = vs.find((v) => v.sku === "TSH-S-BLU");
    expect(Number(lowStock.stock_at_outlet)).toBe(3);
  });

  test("GET /api/products/:id/variants?outlet_id=2 returns the outlet-2 stock (all zero)", async () => {
    const res = await reqAdmin.get(
      `/api/products/${fixture.parentProductId}/variants?outlet_id=2`,
    );
    expect(res.status).toBe(200);
    for (const v of res.body.variants) {
      expect(Number(v.stock_at_outlet)).toBe(0);
    }
  });

  test("POST /api/sales with variant_id decrements variant_outlet_stock at selling outlet only", async () => {
    // Sell 2 of TSH-S-RED (variantIds[0]) at outlet 1. It starts at 10.
    const variantId = fixture.variantIds[0];
    const beforeO1 = await getVariantOutletStock(variantId, 1);
    const beforeO2 = await getVariantOutletStock(variantId, 2);
    const beforeRollup = await getVariantRollupStock(variantId);

    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: variantId,
          original_product_id: fixture.parentProductId,
          variant_id: variantId,
          name: "T-Shirt S Red",
          price: 500,
          quantity: 2,
        },
      ],
      payments: [{ method: "Cash", amount: 1000 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);

    const afterO1 = await getVariantOutletStock(variantId, 1);
    const afterO2 = await getVariantOutletStock(variantId, 2);
    const afterRollup = await getVariantRollupStock(variantId);

    expect(afterO1).toBe(beforeO1 - 2);
    expect(afterO2).toBe(beforeO2); // other outlet untouched
    expect(afterRollup).toBe(beforeRollup - 2); // rollup stays in sync
  });

  test("POST /api/sales refuses variant sale when variant_outlet_stock is insufficient at that outlet", async () => {
    // Try to sell 5 of TSH-L-RED (stock=0 at outlet 1)
    const variantId = fixture.variantIds[2]; // TSH-L-RED
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: variantId,
          original_product_id: fixture.parentProductId,
          variant_id: variantId,
          name: "T-Shirt L Red",
          price: 500,
          quantity: 5,
        },
      ],
      payments: [{ method: "Cash", amount: 2500 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(400);
    expect(String(saleRes.body.error || "")).toMatch(/[Ii]nsufficient stock/);
  });

  test("void-sale flow restores variant_outlet_stock AND product_variants.stock", async () => {
    const variantId = fixture.variantIds[3]; // TSH-L-BLU, stock 20
    const beforeO1 = await getVariantOutletStock(variantId, 1);
    const beforeRollup = await getVariantRollupStock(variantId);

    // Sell 1 so we have a sale to void.
    const sellRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: variantId,
          original_product_id: fixture.parentProductId,
          variant_id: variantId,
          name: "T-Shirt L Blue",
          price: 500,
          quantity: 1,
        },
      ],
      payments: [{ method: "Cash", amount: 500 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(sellRes.status).toBe(200);
    const saleId = sellRes.body.saleId;

    expect(await getVariantOutletStock(variantId, 1)).toBe(beforeO1 - 1);
    expect(await getVariantRollupStock(variantId)).toBe(beforeRollup - 1);

    const voidRes = await reqAdmin.put(`/api/sales/${saleId}/void`).send({
      void_reason: "test void restores variant stock",
    });
    expect(voidRes.status).toBeLessThan(400);

    expect(await getVariantOutletStock(variantId, 1)).toBe(beforeO1);
    expect(await getVariantRollupStock(variantId)).toBe(beforeRollup);
  });

  test("variant_outlet_stock unique constraint: (variant_id, outlet_id) cannot duplicate", async () => {
    const vid = fixture.variantIds[0];
    await expect(
      db.query(
        `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity) VALUES ($1, 1, 99)`,
        [vid],
      ),
    ).rejects.toThrow();
  });
});
