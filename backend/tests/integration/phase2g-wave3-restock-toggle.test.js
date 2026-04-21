/**
 * Phase 2-G Wave 3 — 2-G.7 per-line restock toggle + reason codes.
 *
 * Covers the returns flow with the phase2g_per_line_restock flag on and off:
 *   1. Flag OFF (legacy): any restock_flag / reason_code_id sent is ignored;
 *      every returned line goes back into outlet_stock + variant stocks.
 *   2. Flag ON, restock=true: line is recorded with restock_flag=true and
 *      stock counters increment (outlet_stock + product_variants.stock +
 *      variant_outlet_stock when a variant is attached).
 *   3. Flag ON, restock=false: line is recorded with restock_flag=false;
 *      stock counters do NOT move. Captured as shrinkage.
 *   4. Flag ON, restock=false WITHOUT reason_code_id: rejected 400.
 *   5. GET /api/reports/returns-by-reason aggregates split qty_restocked /
 *      qty_scrapped per reason+product with supplier join.
 *   6. Shrinkage report surfaces scrapped_qty as a separate shrink vector
 *      and does NOT double-count it in the opening/expected balance.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup;
let reqAdmin;

const fixture = {
  saleId: null,
  damagedReasonId: null,
  wrongItemReasonId: null,
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
  require("../../routes/return-policies")(app, deps);
  require("../../routes/reports")(app, deps);

  reqAdmin = makeRequest(app, ADMIN_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });

  // Seed return_reasons so the per-line dropdown + reason_code_id FK works.
  // Migration v68 seeds these in prod; tests may run DDL-then-migrations, so
  // this is belt-and-braces (ON CONFLICT keeps it idempotent).
  await db.query(`
    INSERT INTO return_reasons (code, label, sort_order) VALUES
      ('damaged', 'Damaged', 10),
      ('wrong_item', 'Wrong item', 30)
    ON CONFLICT (code) DO NOTHING
  `);
  const { rows: reasons } = await db.query(
    "SELECT id, code FROM return_reasons WHERE code IN ('damaged','wrong_item')"
  );
  for (const r of reasons) {
    if (r.code === "damaged") fixture.damagedReasonId = r.id;
    if (r.code === "wrong_item") fixture.wrongItemReasonId = r.id;
  }

  // One big sale we can return against repeatedly. Products 1 + 2 come from
  // the fixture (prices 100 + 200).
  const saleRes = await reqAdmin
    .post("/api/sales")
    .send({
      cartItems: [
        { id: 1, quantity: 10, price: 100 },
        { id: 2, quantity: 10, price: 200 },
      ],
      paymentMethod: "Cash",
      outlet_id: 1,
    });
  expect(saleRes.status).toBe(200);
  fixture.saleId = saleRes.body.saleId;
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

async function getOutletStock(productId, outletId = 1) {
  const { rows } = await db.query(
    "SELECT quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2",
    [productId, outletId],
  );
  return Number(rows[0]?.quantity || 0);
}

describe("Phase 2-G Wave 3 — 2-G.7 per-line restock toggle", () => {
  describe("Flag OFF — legacy behavior preserved", () => {
    beforeAll(async () => {
      await setFlag("phase2g_per_line_restock", false);
    });

    test("any restock_flag=false on the request body is ignored — stock still increments", async () => {
      const before = await getOutletStock(1);
      const res = await reqAdmin
        .post("/api/returns")
        .send({
          original_sale_id: fixture.saleId,
          outlet_id: 1,
          total_refund: 100,
          refund_method: "Cash",
          items: [
            { product_id: 1, quantity: 1, refund_price: 100, restock_flag: false, reason_code_id: fixture.damagedReasonId },
          ],
        });
      expect(res.status).toBe(200);
      const after = await getOutletStock(1);
      expect(after).toBe(before + 1);

      // Row should persist with legacy default restock_flag=true, reason_code_id=NULL.
      const { rows } = await db.query(
        `SELECT restock_flag, reason_code_id FROM return_items
          WHERE return_id = $1 ORDER BY id DESC LIMIT 1`,
        [res.body.id],
      );
      expect(rows[0].restock_flag).toBe(true);
      expect(rows[0].reason_code_id).toBeNull();
    });
  });

  describe("Flag ON — per-line honored", () => {
    beforeAll(async () => {
      await setFlag("phase2g_per_line_restock", true);
    });

    test("restock=true (default) — increments outlet_stock, persists flag + reason", async () => {
      const before = await getOutletStock(2);
      const res = await reqAdmin
        .post("/api/returns")
        .send({
          original_sale_id: fixture.saleId,
          outlet_id: 1,
          total_refund: 200,
          refund_method: "Cash",
          items: [
            {
              product_id: 2,
              quantity: 1,
              refund_price: 200,
              restock_flag: true,
              reason_code_id: fixture.wrongItemReasonId,
            },
          ],
        });
      expect(res.status).toBe(200);
      const after = await getOutletStock(2);
      expect(after).toBe(before + 1);

      const { rows } = await db.query(
        `SELECT restock_flag, reason_code_id FROM return_items
           WHERE return_id = $1 ORDER BY id DESC LIMIT 1`,
        [res.body.id],
      );
      expect(rows[0].restock_flag).toBe(true);
      expect(rows[0].reason_code_id).toBe(fixture.wrongItemReasonId);
    });

    test("restock=false with reason — persists, does NOT increment outlet_stock", async () => {
      const before = await getOutletStock(1);
      const res = await reqAdmin
        .post("/api/returns")
        .send({
          original_sale_id: fixture.saleId,
          outlet_id: 1,
          total_refund: 100,
          refund_method: "Cash",
          items: [
            {
              product_id: 1,
              quantity: 2,
              refund_price: 100,
              restock_flag: false,
              reason_code_id: fixture.damagedReasonId,
            },
          ],
        });
      expect(res.status).toBe(200);
      const after = await getOutletStock(1);
      expect(after).toBe(before); // unchanged — scrapped, not restocked

      const { rows } = await db.query(
        `SELECT restock_flag, reason_code_id, quantity FROM return_items
           WHERE return_id = $1 ORDER BY id DESC LIMIT 1`,
        [res.body.id],
      );
      expect(rows[0].restock_flag).toBe(false);
      expect(rows[0].reason_code_id).toBe(fixture.damagedReasonId);
      expect(Number(rows[0].quantity)).toBe(2);
    });

    test("restock=false WITHOUT reason_code_id is rejected 400", async () => {
      const res = await reqAdmin
        .post("/api/returns")
        .send({
          original_sale_id: fixture.saleId,
          outlet_id: 1,
          total_refund: 100,
          refund_method: "Cash",
          items: [
            { product_id: 1, quantity: 1, refund_price: 100, restock_flag: false },
          ],
        });
      expect(res.status).toBe(400);
      expect(String(res.body.error || "")).toMatch(/reason_code_id/i);
    });
  });

  describe("GET /api/reports/returns-by-reason", () => {
    test("aggregates restocked vs scrapped by reason + product", async () => {
      const res = await reqAdmin.get(
        "/api/reports/returns-by-reason?date_from=2020-01-01&date_to=2099-12-31&outlet_id=1",
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rows)).toBe(true);

      // Find the damaged/product_1 row — scrapped 2 units earlier.
      const damagedRow = res.body.rows.find(
        (r) => r.reason_code === "damaged" && r.product_id === 1,
      );
      expect(damagedRow).toBeDefined();
      expect(Number(damagedRow.qty_scrapped)).toBeGreaterThanOrEqual(2);

      // Find wrong_item/product_2 — restocked 1 unit.
      const wrongRow = res.body.rows.find(
        (r) => r.reason_code === "wrong_item" && r.product_id === 2,
      );
      expect(wrongRow).toBeDefined();
      expect(Number(wrongRow.qty_restocked)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /api/reports/shrinkage", () => {
    test("surfaces scrapped_qty as a separate shrink vector and does not poison the balance", async () => {
      const res = await reqAdmin.get(
        "/api/reports/shrinkage?date_from=2020-01-01&date_to=2099-12-31",
      );
      expect(res.status).toBe(200);
      const summary = res.body.summary;
      expect(summary).toBeDefined();
      // total_scrapped_units reflects the 2 scrapped earlier.
      expect(Number(summary.total_scrapped_units)).toBeGreaterThanOrEqual(2);

      // Pick product 1 at outlet 1 — opening math must not double-count the
      // scrapped units: expected = opening + purchases + returns(restocked) -
      // sales - adjustments etc. scrapped does NOT enter the equation.
      const prod1Row = res.body.rows.find(
        (r) => r.product_id === 1 && r.outlet_id === 1,
      );
      expect(prod1Row).toBeDefined();
      expect(Number(prod1Row.scrapped)).toBeGreaterThanOrEqual(2);
      // `returns` column now means restocked-only — product 1's restocked
      // count should be whatever the flag-off leg did (1 unit) plus any
      // restocked legs; scrapped is excluded from it by construction.
      expect(Number(prod1Row.returns)).toBeGreaterThanOrEqual(1);
    });
  });
});
