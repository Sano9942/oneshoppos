/**
 * pg-restaurant-pay-at-table.test.js — Phase 2-R Wave D / 2-R.3
 *
 * Pay-at-table QR payment flow (SanoPay sandbox).
 *   1. Staff creates a payment session on an open dine-in check.
 *   2. Second create invalidates the first.
 *   3. Public GET /pay/:token returns sanitized bill.
 *   4. Sold-out item blocks the public bill view (422).
 *   5. Sandbox webhook with correct data marks session paid,
 *      creates sale row, copies seat_number, flips table session 'dirty'.
 *   6. Wrong gateway_ref → 404 via processWebhookEvent.
 *   7. Expired session → 410 on public view.
 */

// Load migrate-pg first (it calls dotenv.config), THEN delete MULTI_TENANT
// so the delete wins. public-tenant-context reads process.env at require
// time, so we must keep MULTI_TENANT unset when that module loads via
// the registerPublicPayAtTableRoutes call in beforeAll.
const { MIGRATIONS } = require("../../migrate-pg");
delete process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

describe("Phase 2-R.3 — Pay-at-table QR payment", () => {
  let app, db, deps, cleanup, schemaName;
  let draftOrderId, tableSessionId, tableId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    // Apply v61 schema (restaurant_payment_sessions + 'dirty' status).
    const v61 = MIGRATIONS.find((m) => m.version === 61);
    await v61.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    // Register both the staff routes and the public routes. Order matters:
    // the staff registrar is the default export; public is a named export.
    require("../../routes/restaurant/pay-at-table")(app, deps);
    require("../../routes/restaurant/pay-at-table").registerPublicPayAtTableRoutes(app, deps);

    // Flip restaurant mode + pay-at-table flag on.
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_pay_at_table', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();

    // Seed floor + table + session + draft_order + two items so a check exists.
    const { rows: [plan] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Main') RETURNING id`
    );
    const { rows: [table] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity) VALUES ($1, 'T5', 4) RETURNING id`,
      [plan.id]
    );
    tableId = table.id;

    const { rows: [session] } = await db.query(
      `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count, status)
       VALUES ($1, 1, 1, 2, 'seated') RETURNING id`,
      [tableId]
    );
    tableSessionId = session.id;

    const { rows: [order] } = await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, table_id, table_session_id, order_context, status)
       VALUES (1, 1, $1, $2, 'dine_in', 'open') RETURNING id`,
      [tableId, tableSessionId]
    );
    draftOrderId = order.id;

    await db.query(
      `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price, seat_number)
       VALUES ($1, 1, 'Burger', 2, 500, 1), ($1, 2, 'Fries', 1, 200, 1)`,
      [draftOrderId]
    );
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  it("POST /checks/:id/payment-session creates a pending session", async () => {
    const res = await request(app)
      .post(`/api/restaurant/checks/${draftOrderId}/payment-session`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ tip_amount: 0 });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/[0-9a-f-]{36}/);
    expect(Number(res.body.amount)).toBe(1200);
    expect(res.body.status).toBe("pending");
    expect(res.body.pay_url).toContain(res.body.token);

    // Exactly one pending row on the session table.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM restaurant_payment_sessions
       WHERE table_session_id = $1 AND status = 'pending'`,
      [tableSessionId]
    );
    expect(rows[0].cnt).toBe(1);
  });

  it("A second session on the same table invalidates the first", async () => {
    // First is already pending from previous test — create a second.
    const res = await request(app)
      .post(`/api/restaurant/checks/${draftOrderId}/payment-session`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({});

    expect(res.status).toBe(201);

    const { rows } = await db.query(
      `SELECT status, COUNT(*)::int AS cnt FROM restaurant_payment_sessions
       WHERE table_session_id = $1 GROUP BY status`,
      [tableSessionId]
    );
    const byStatus = Object.fromEntries(rows.map(r => [r.status, r.cnt]));
    expect(byStatus.pending).toBe(1);
    expect(byStatus.expired).toBeGreaterThanOrEqual(1);
  });

  it("Public GET /pay/:token returns itemized bill", async () => {
    const { rows: [row] } = await db.query(
      `SELECT token FROM restaurant_payment_sessions
       WHERE table_session_id = $1 AND status = 'pending'`,
      [tableSessionId]
    );
    const res = await request(app)
      .get(`/api/public/restaurant/pay/${row.token}`)
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(Number(res.body.amount)).toBe(1200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.items[0].name).toBe("Burger");
  });

  it("Public bill view 422s when any item went sold-out", async () => {
    // Mark product 1 sold-out.
    await db.query(
      `UPDATE products SET is_sold_out = true, sold_out_reason = 'out of stock' WHERE id = 1`
    );
    const { rows: [row] } = await db.query(
      `SELECT token FROM restaurant_payment_sessions
       WHERE table_session_id = $1 AND status = 'pending'`,
      [tableSessionId]
    );
    const res = await request(app)
      .get(`/api/public/restaurant/pay/${row.token}`)
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no longer available/i);

    // Restore for subsequent tests.
    await db.query(`UPDATE products SET is_sold_out = false, sold_out_reason = NULL WHERE id = 1`);
  });

  it("Webhook completion creates sale, copies seat_number, flips table dirty", async () => {
    const { rows: [session] } = await db.query(
      `SELECT id, gateway_ref FROM restaurant_payment_sessions
       WHERE table_session_id = $1 AND status = 'pending'`,
      [tableSessionId]
    );
    const { handleRestaurantPayWebhook } = require("../../routes/restaurant/pay-at-table");

    const result = await handleRestaurantPayWebhook(db, {
      gatewayRef: session.gateway_ref,
      status: "completed",
      eventType: "payment.completed",
      raw: { sandbox: true, status: "completed" },
    });
    expect(result.matched).toBe(true);
    expect(result.ok).toBe(true);

    const { rows: [paid] } = await db.query(
      `SELECT status, sale_id FROM restaurant_payment_sessions WHERE id = $1`,
      [session.id]
    );
    expect(paid.status).toBe("paid");
    expect(paid.sale_id).toBeGreaterThan(0);

    const { rows: saleItems } = await db.query(
      `SELECT product_id, quantity, seat_number FROM sale_items WHERE sale_id = $1 ORDER BY product_id`,
      [paid.sale_id]
    );
    expect(saleItems.length).toBe(2);
    expect(saleItems.every((it) => it.seat_number === 1)).toBe(true);

    const { rows: [ts] } = await db.query(
      `SELECT status FROM restaurant_table_sessions WHERE id = $1`,
      [tableSessionId]
    );
    expect(ts.status).toBe("dirty");

    const { rows: [draft] } = await db.query(
      `SELECT status FROM draft_orders WHERE id = $1`,
      [draftOrderId]
    );
    expect(draft.status).toBe("completed");
  });

  it("Webhook is idempotent — second call returns without duplicate sale", async () => {
    const { rows: [paidSession] } = await db.query(
      `SELECT id, gateway_ref, sale_id FROM restaurant_payment_sessions WHERE status = 'paid' LIMIT 1`
    );
    const { handleRestaurantPayWebhook } = require("../../routes/restaurant/pay-at-table");
    const result = await handleRestaurantPayWebhook(db, {
      gatewayRef: paidSession.gateway_ref,
      status: "completed",
      eventType: "payment.completed",
      raw: {},
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/already paid/i);

    // No new sale row.
    const { rows: sales } = await db.query(`SELECT id FROM sales`);
    expect(sales.length).toBe(1);
  });

  it("Expired session returns 410 on public GET", async () => {
    // Create a fresh draft + session backdated to expire.
    const { rows: [order2] } = await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, order_context, status)
       VALUES (1, 1, 'dine_in', 'open') RETURNING id`
    );
    await db.query(
      `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
       VALUES ($1, 1, 'Burger', 1, 500)`,
      [order2.id]
    );
    const { rows: [expired] } = await db.query(
      `INSERT INTO restaurant_payment_sessions
        (draft_order_id, token, gateway_ref, amount, status, expires_at)
       VALUES ($1, 'expired-token', 'ref-expired', 500, 'pending', NOW() - INTERVAL '1 minute')
       RETURNING token`,
      [order2.id]
    );
    const res = await request(app)
      .get(`/api/public/restaurant/pay/${expired.token}`)
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(410);
  });

  it("Unknown gateway_ref returns unmatched from webhook handler", async () => {
    const { handleRestaurantPayWebhook } = require("../../routes/restaurant/pay-at-table");
    const result = await handleRestaurantPayWebhook(db, {
      gatewayRef: "does-not-exist",
      status: "completed",
      eventType: "payment.completed",
      raw: {},
    });
    expect(result.matched).toBeFalsy();
  });
});
