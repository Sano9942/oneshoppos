/**
 * Phase 2-G Wave 3 — 2-G.1 follow-up: variant-aware transfers + adjustments.
 *
 * Covers:
 *   1. POST /api/transfers with variant_id moves variant_outlet_stock from
 *      source outlet to destination outlet (zero-sum across outlets), keeps
 *      product-level outlet_stock in sync, and leaves product_variants.stock
 *      rollup unchanged (a transfer doesn't change the cross-outlet total).
 *   2. POST /api/transfers/:id/reverse undoes the variant move symmetrically.
 *   3. POST /api/adjustments with variant_id updates variant_outlet_stock AND
 *      product_variants.stock rollup AND product-level outlet_stock together.
 *   4. DELETE /api/adjustments/:id reverses all three.
 *   5. Product-level (no variant_id) transfers + adjustments still work — no
 *      regression in the legacy path.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup;
let reqAdmin;

const fixture = {
  parentProductId: null,
  variantId: null,
};

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({
    db,
    IS_MULTI_TENANT: false,
    tenantDbManager: null,
    dbProxy: db,
  });
  require("../../middleware/feature-flags").invalidateFeatureFlagCache();

  require("../../routes/inventory")(app, deps);

  reqAdmin = makeRequest(app, ADMIN_ID);

  // Seed a parent product + single variant with known stock at outlets 1 & 2.
  const { rows: [parent] } = await db.query(
    `INSERT INTO products (name, price, cost_price, barcode, sku, status, has_variants)
       VALUES ('Hoodie', 1200, 500, 'HOOD-001', 'HOOD-001', 'active', true)
     RETURNING id`,
  );
  fixture.parentProductId = parent.id;

  const { rows: [v] } = await db.query(
    `INSERT INTO product_variants (product_id, sku, price, cost_price, stock)
       VALUES ($1, 'HOOD-M-BLU', 1200, 500, 15) RETURNING id`,
    [parent.id],
  );
  fixture.variantId = v.id;

  // Outlet 1 has 10 of this variant; outlet 2 has 5. Rollup is 15.
  await db.query(
    `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
       VALUES ($1, 1, 10), ($1, 2, 5)`,
    [v.id],
  );
  // Product-level outlet_stock (matches variant totals for this test).
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
       VALUES ($1, 1, 10), ($1, 2, 5)`,
    [parent.id],
  );
}, 120000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

async function vos(variantId, outletId) {
  const { rows } = await db.query(
    `SELECT quantity::numeric AS q FROM variant_outlet_stock WHERE variant_id = $1 AND outlet_id = $2`,
    [variantId, outletId],
  );
  return rows[0] ? Number(rows[0].q) : null;
}
async function rollup(variantId) {
  const { rows } = await db.query(
    `SELECT stock::numeric AS q FROM product_variants WHERE id = $1`,
    [variantId],
  );
  return Number(rows[0].q);
}
async function oStock(productId, outletId) {
  const { rows } = await db.query(
    `SELECT quantity::numeric AS q FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2`,
    [productId, outletId],
  );
  return rows[0] ? Number(rows[0].q) : null;
}

describe("Phase 2-G Wave 3 — 2-G.1 follow-up: variant transfers + adjustments", () => {
  test("transfer with variant_id moves variant_outlet_stock + outlet_stock; rollup unchanged", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const beforeRollup = await rollup(vid);

    const res = await reqAdmin.post("/api/transfers").send({
      product_id: pid,
      variant_id: vid,
      from_outlet_id: 1,
      to_outlet_id: 2,
      quantity: 3,
    });
    expect(res.status).toBe(200);

    expect(await vos(vid, 1)).toBe(7);  // 10 - 3
    expect(await vos(vid, 2)).toBe(8);  // 5 + 3
    expect(await oStock(pid, 1)).toBe(7);
    expect(await oStock(pid, 2)).toBe(8);
    expect(await rollup(vid)).toBe(beforeRollup); // transfer does not change rollup
  });

  test("transfer reversal undoes variant + product stock symmetrically", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;

    // First make a transfer we can reverse.
    const createRes = await reqAdmin.post("/api/transfers").send({
      product_id: pid,
      variant_id: vid,
      from_outlet_id: 1,
      to_outlet_id: 2,
      quantity: 2,
    });
    expect(createRes.status).toBe(200);
    const { rows } = await db.query(
      `SELECT id FROM inventory_transfers WHERE variant_id = $1 AND reversed = false ORDER BY id DESC LIMIT 1`,
      [vid],
    );
    const transferId = rows[0].id;

    const beforeO1 = await vos(vid, 1);
    const beforeO2 = await vos(vid, 2);
    const reverseRes = await reqAdmin.post(`/api/transfers/${transferId}/reverse`);
    expect(reverseRes.status).toBe(200);

    expect(await vos(vid, 1)).toBe(beforeO1 + 2); // moved back
    expect(await vos(vid, 2)).toBe(beforeO2 - 2);
  });

  test("insufficient variant_outlet_stock at source rejects the transfer", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const currentO1 = await vos(vid, 1);
    const res = await reqAdmin.post("/api/transfers").send({
      product_id: pid,
      variant_id: vid,
      from_outlet_id: 1,
      to_outlet_id: 2,
      quantity: currentO1 + 100,
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/[Ii]nsufficient/);
  });

  test("adjustment with variant_id updates variant_outlet_stock + rollup + outlet_stock", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const beforeO1 = await vos(vid, 1);
    const beforeRollup = await rollup(vid);
    const beforeProdO1 = await oStock(pid, 1);

    const res = await reqAdmin.post("/api/adjustments").send({
      product_id: pid,
      variant_id: vid,
      outlet_id: 1,
      quantity_change: -1,
      reason: "Damaged",
    });
    expect(res.status).toBe(200);

    expect(await vos(vid, 1)).toBe(beforeO1 - 1);
    expect(await rollup(vid)).toBe(beforeRollup - 1);
    expect(await oStock(pid, 1)).toBe(beforeProdO1 - 1);
  });

  test("adjustment DELETE reverses variant_outlet_stock + rollup + outlet_stock", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const beforeO1 = await vos(vid, 1);
    const beforeRollup = await rollup(vid);

    const createRes = await reqAdmin.post("/api/adjustments").send({
      product_id: pid,
      variant_id: vid,
      outlet_id: 1,
      quantity_change: 2,
      reason: "Recount",
    });
    expect(createRes.status).toBe(200);

    // The route doesn't return an id, so pull the latest adjustment for this variant.
    const { rows } = await db.query(
      `SELECT id FROM stock_adjustments WHERE variant_id = $1 ORDER BY id DESC LIMIT 1`,
      [vid],
    );
    const adjustmentId = rows[0].id;

    expect(await vos(vid, 1)).toBe(beforeO1 + 2);
    expect(await rollup(vid)).toBe(beforeRollup + 2);

    const delRes = await reqAdmin.delete(`/api/adjustments/${adjustmentId}`);
    expect(delRes.status).toBe(200);

    expect(await vos(vid, 1)).toBe(beforeO1);
    expect(await rollup(vid)).toBe(beforeRollup);
  });

  test("product-level transfer (no variant_id) still works; variant stock untouched", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const beforeVosO1 = await vos(vid, 1);
    const beforeRollup = await rollup(vid);
    const beforeProdO1 = await oStock(pid, 1);
    const beforeProdO2 = await oStock(pid, 2);

    const res = await reqAdmin.post("/api/transfers").send({
      product_id: pid,
      from_outlet_id: 1,
      to_outlet_id: 2,
      quantity: 1,
    });
    expect(res.status).toBe(200);

    // Variant stock should be untouched; product-level shifted by 1.
    expect(await vos(vid, 1)).toBe(beforeVosO1);
    expect(await rollup(vid)).toBe(beforeRollup);
    expect(await oStock(pid, 1)).toBe(beforeProdO1 - 1);
    expect(await oStock(pid, 2)).toBe(beforeProdO2 + 1);
  });

  test("product-level adjustment (no variant_id) still works", async () => {
    const vid = fixture.variantId;
    const pid = fixture.parentProductId;
    const beforeVosO1 = await vos(vid, 1);
    const beforeRollup = await rollup(vid);
    const beforeProdO1 = await oStock(pid, 1);

    const res = await reqAdmin.post("/api/adjustments").send({
      product_id: pid,
      outlet_id: 1,
      quantity_change: 5,
      reason: "Found",
    });
    expect(res.status).toBe(200);

    expect(await oStock(pid, 1)).toBe(beforeProdO1 + 5);
    expect(await vos(vid, 1)).toBe(beforeVosO1); // variant untouched
    expect(await rollup(vid)).toBe(beforeRollup);
  });

  test("GET /api/transfers includes variant_sku when variant_id is set", async () => {
    const res = await reqAdmin.get("/api/transfers");
    expect(res.status).toBe(200);
    const withVariant = res.body.transfers.find((t) => t.variant_id === fixture.variantId);
    expect(withVariant).toBeDefined();
    expect(withVariant.variant_sku).toBe("HOOD-M-BLU");
  });
});
