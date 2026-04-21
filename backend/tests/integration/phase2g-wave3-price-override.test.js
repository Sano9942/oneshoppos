/**
 * Phase 2-G Wave 3 — 2-G.5 manager price override integration test.
 *
 * Covers the full loop:
 *   1. Cashier hits POST /api/approvals/price-override with a manager PIN,
 *      gets back an approval_event_id + the approver identity.
 *   2. Cashier submits POST /api/sales with cartItems[i].price_override
 *      carrying that approval_event_id — sale_items is stamped with the 5
 *      new audit columns (original price, reason, approver, timestamp, event id).
 *   3. Negative cases: bad PIN → 401, insufficient permission → 403, missing
 *      event + no override_price perm on cashier → 403, invalid event_id → 400.
 *   4. Flag OFF regression: backend silently ignores any incoming override.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, MANAGER_ID, CASHIER_ID } = require("../helpers/request");

let app, db, deps, cleanup;
let reqAdmin, reqManager, reqCashier;

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
  require("../../routes/approval-policies")(app, deps);
  require("../../routes/override-reasons")(app, deps);

  reqAdmin = makeRequest(app, ADMIN_ID);
  reqManager = makeRequest(app, MANAGER_ID);
  reqCashier = makeRequest(app, CASHIER_ID);

  await request(app)
    .post("/api/shifts/open")
    .set("x-employee-id", "1")
    .send({ outlet_id: 1, opening_float: 500, denominations: [] });
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "2580", outlet_id: 1 });
  // Cashier clocks in too so /api/sales submissions as the cashier pass the
  // attendance gate. PIN 3333 = Cashier (id=3) per seedSchema-pg.
  await request(app)
    .post("/api/attendance/pin-checkin")
    .send({ pin_code: "3333", outlet_id: 1 });

  // Seed the 2-G.5 permission on Manager (migration back-seeds in prod;
  // ensureDefaultRolePermissions is stubbed noop in tests).
  await db.query(
    `INSERT INTO role_permissions (role_id, permission) VALUES (2, 'override_price')
     ON CONFLICT DO NOTHING`,
  );

  // Seed override_reasons (migration v64 seeds these, but the test helper
  // runs schema-pg.sql then migrations — belt-and-braces to guarantee rows).
  await db.query(
    `INSERT INTO override_reasons (code, label, sort_order) VALUES
       ('price_match', 'Price match', 10),
       ('damaged_item', 'Damaged item', 20)
     ON CONFLICT (code) DO NOTHING`,
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

async function getReasonId(code) {
  const { rows } = await db.query(
    `SELECT id FROM override_reasons WHERE code = $1`,
    [code],
  );
  return rows[0]?.id;
}

describe("Phase 2-G Wave 3 — 2-G.5 manager price override", () => {
  beforeEach(async () => {
    await setFlag("phase2g_price_override", true);
  });

  test("GET /api/override-reasons returns seeded rows", async () => {
    const res = await reqAdmin.get("/api/override-reasons");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reasons)).toBe(true);
    const codes = res.body.reasons.map((r) => r.code);
    expect(codes).toContain("price_match");
    expect(codes).toContain("damaged_item");
  });

  test("POST /api/approvals/price-override with valid manager PIN approves", async () => {
    const reasonId = await getReasonId("price_match");
    const res = await reqCashier.post("/api/approvals/price-override").send({
      pin: "2222",
      product_id: 1,
      original_price: 100,
      new_price: 80,
      reason_id: reasonId,
      outlet_id: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.authorized).toBe(true);
    expect(res.body.approval_event_id).toBeGreaterThan(0);
    expect(res.body.approved_by.id).toBe(MANAGER_ID);

    const { rows } = await db.query(
      `SELECT action_type, status, approved_by, reference_type
         FROM approval_events WHERE id = $1`,
      [res.body.approval_event_id],
    );
    expect(rows[0]).toMatchObject({
      action_type: "price_override",
      status: "approved",
      approved_by: MANAGER_ID,
      reference_type: "sale_item_pending",
    });
  });

  test("POST /api/approvals/price-override with bad PIN returns 401", async () => {
    const res = await reqCashier.post("/api/approvals/price-override").send({
      pin: "9999",
      product_id: 1,
      original_price: 100,
      new_price: 80,
      reason_id: await getReasonId("price_match"),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/approvals/price-override with cashier PIN (no override_price perm) returns 403", async () => {
    const res = await reqCashier.post("/api/approvals/price-override").send({
      pin: "3333",
      product_id: 1,
      original_price: 100,
      new_price: 80,
      reason_id: await getReasonId("price_match"),
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/sales persists override columns when approval_event_id is attached", async () => {
    const reasonId = await getReasonId("damaged_item");

    // 1. Cashier gets manager approval up front.
    const approvalRes = await reqCashier.post("/api/approvals/price-override").send({
      pin: "2222",
      product_id: 1,
      original_price: 100,
      new_price: 70,
      reason_id: reasonId,
      outlet_id: 1,
    });
    expect(approvalRes.status).toBe(200);
    const approvalEventId = approvalRes.body.approval_event_id;

    // 2. Cashier submits sale with price_override metadata on the line.
    const saleRes = await reqCashier.post("/api/sales").send({
      cartItems: [
        {
          id: 1,
          name: "Product 1",
          price: 70,
          quantity: 1,
          price_override: {
            original_price: 100,
            reason_id: reasonId,
            approval_event_id: approvalEventId,
          },
        },
      ],
      payments: [{ method: "Cash", amount: 70 }],
      outlet_id: 1,
      employee_id: CASHIER_ID,
    });
    expect(saleRes.status).toBe(200);
    const saleId = saleRes.body.saleId;

    const { rows } = await db.query(
      `SELECT price_at_sale::numeric AS price_at_sale,
              price_override_amount::numeric AS price_override_amount,
              price_override_reason_id,
              price_override_approved_by,
              price_override_approved_at,
              price_override_approval_event_id
         FROM sale_items WHERE sale_id = $1`,
      [saleId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].price_at_sale)).toBe(70);
    expect(Number(rows[0].price_override_amount)).toBe(100);
    expect(rows[0].price_override_reason_id).toBe(reasonId);
    expect(rows[0].price_override_approved_by).toBe(MANAGER_ID);
    expect(rows[0].price_override_approved_at).toBeTruthy();
    expect(rows[0].price_override_approval_event_id).toBe(approvalEventId);
  });

  test("POST /api/sales rejects override with invalid approval_event_id", async () => {
    const saleRes = await reqCashier.post("/api/sales").send({
      cartItems: [
        {
          id: 1,
          name: "Product 1",
          price: 70,
          quantity: 1,
          price_override: {
            original_price: 100,
            reason_id: await getReasonId("price_match"),
            approval_event_id: 999999,
          },
        },
      ],
      payments: [{ method: "Cash", amount: 70 }],
      outlet_id: 1,
      employee_id: CASHIER_ID,
    });
    expect(saleRes.status).toBe(400);
  });

  test("POST /api/sales rejects cashier override with no approval_event_id", async () => {
    const saleRes = await reqCashier.post("/api/sales").send({
      cartItems: [
        {
          id: 1,
          name: "Product 1",
          price: 70,
          quantity: 1,
          price_override: {
            original_price: 100,
            reason_id: await getReasonId("price_match"),
          },
        },
      ],
      payments: [{ method: "Cash", amount: 70 }],
      outlet_id: 1,
      employee_id: CASHIER_ID,
    });
    expect(saleRes.status).toBe(403);
  });

  test("POST /api/sales admin self-override creates a new approval_event", async () => {
    const reasonId = await getReasonId("price_match");
    const before = await db.query(
      "SELECT COUNT(*)::int AS n FROM approval_events WHERE action_type = 'price_override'",
    );
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: 2,
          name: "Product 2",
          price: 150,
          quantity: 1,
          price_override: {
            original_price: 200,
            reason_id: reasonId,
          },
        },
      ],
      payments: [{ method: "Cash", amount: 150 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(200);
    const after = await db.query(
      "SELECT COUNT(*)::int AS n FROM approval_events WHERE action_type = 'price_override'",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);

    const { rows } = await db.query(
      `SELECT price_override_amount::numeric AS amt, price_override_approved_by
         FROM sale_items WHERE sale_id = $1`,
      [saleRes.body.saleId],
    );
    expect(Number(rows[0].amt)).toBe(200);
    expect(rows[0].price_override_approved_by).toBe(ADMIN_ID);
  });

  test("flag OFF: sales with price_override is rejected 503", async () => {
    await setFlag("phase2g_price_override", false);
    const saleRes = await reqAdmin.post("/api/sales").send({
      cartItems: [
        {
          id: 1,
          name: "Product 1",
          price: 80,
          quantity: 1,
          price_override: {
            original_price: 100,
            reason_id: await getReasonId("price_match"),
          },
        },
      ],
      payments: [{ method: "Cash", amount: 80 }],
      outlet_id: 1,
      employee_id: ADMIN_ID,
    });
    expect(saleRes.status).toBe(503);
    expect(saleRes.body.flag).toBe("phase2g_price_override");
  });
});
