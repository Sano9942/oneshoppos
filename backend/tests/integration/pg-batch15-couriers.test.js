/**
 * pg-batch15-couriers.test.js — Phase 5 H1 regression coverage
 *
 * Verifies that the "no booking API" courier stubs (PakPost, Bykea) throw
 * a 501 from the /api/orders/:id/shipments/book route instead of silently
 * persisting a null-tracking order_shipments row with status='booked'.
 *
 * Before the fix (commits `<fix>`):
 *   - PakPostAdapter.bookShipment() returned { tracking_number: null, ... }
 *   - BykeaAdapter.bookShipment() returned { tracking_number: null, ... }
 *   - The book route treated the null-shape as success, INSERTed an
 *     order_shipments row with status='booked', updated web_orders to
 *     `fulfillment_status='shipped'`, and fired a "Tracking: N/A" SMS.
 *
 * After the fix:
 *   - Both stubs throw an Error with `statusCode = 501` and
 *     `code = 'COURIER_NO_BOOKING_API'`.
 *   - The route's outer catch returns a 501 response.
 *   - The enclosing db.transaction() rolls back, leaving zero
 *     order_shipments rows and no web_orders mutation.
 *
 * Tests:
 *   1. PakPost with supports_booking=true → 501 + clean rollback
 *   2. Bykea   with supports_booking=true → 501 + clean rollback
 *   3. Transaction atomicity (rollback verification — deepest assertion)
 *   4. Control: Leopards with supports_booking=true + bogus creds → 500 (NOT 501)
 *   5. Control: PakPost with supports_booking=false → manual fallback still works
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

// beforeAll runs full schema-pg.sql against remote Supabase which is slow
// on a cold connection. Per-test budget stays tight.
jest.setTimeout(60000);

describe("Phase 5 H1 — pakpost/bykea stub adapters throw 501", () => {
  let app;
  let db;
  let cleanup;

  // IDs seeded in beforeAll
  let pakpostCourierId;
  let bykeaCourierId;
  let leopardsCourierId;
  let pakpostManualCourierId;
  let orderId;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Mount the couriers route. Route signature: mountCourierRoutes(app, deps)
    require("../../routes/couriers")(app, ctx.deps);

    // Seed the phase5_shipping_automation feature flag that
    // /api/orders/:id/shipments/book is gated on.
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase5_shipping_automation', true)
       ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`
    );

    // Seed courier_integrations rows.
    //   - pakpost with supports_booking=true: the bug path. Fix should reject.
    //   - bykea   with supports_booking=true: same bug class.
    //   - leopards with supports_booking=true + bogus creds: control — must
    //     produce a non-501 error (proves we only catch the stub case).
    //   - pakpost_manual with supports_booking=false: control — proves the
    //     pre-existing manual fallback branch still works.
    const { rows: [pakpost] } = await db.query(
      `INSERT INTO courier_integrations
         (name, adapter_key, supports_booking, supports_tracking, enabled)
       VALUES ('Pakistan Post (booking-on)', 'pakpost', true, false, true)
       RETURNING id`
    );
    pakpostCourierId = pakpost.id;

    const { rows: [bykea] } = await db.query(
      `INSERT INTO courier_integrations
         (name, adapter_key, supports_booking, supports_tracking, enabled)
       VALUES ('Bykea (booking-on)', 'bykea', true, false, true)
       RETURNING id`
    );
    bykeaCourierId = bykea.id;

    const { rows: [leopards] } = await db.query(
      `INSERT INTO courier_integrations
         (name, adapter_key, supports_booking, supports_tracking, enabled,
          api_key, api_secret)
       VALUES ('Leopards (bogus creds)', 'leopards', true, true, true, NULL, NULL)
       RETURNING id`
    );
    leopardsCourierId = leopards.id;

    const { rows: [pakpostManual] } = await db.query(
      `INSERT INTO courier_integrations
         (name, adapter_key, supports_booking, supports_tracking, enabled)
       VALUES ('Pakistan Post (manual)', 'pakpost', false, false, true)
       RETURNING id`
    );
    pakpostManualCourierId = pakpostManual.id;

    // Seed one web_order. The book route re-uses the same order across tests;
    // each test records the expected rollback state and verifies it.
    const { rows: [order] } = await db.query(
      `INSERT INTO web_orders
         (source, external_order_id, external_order_number, customer_id,
          grand_total, payment_status, fulfillment_status, order_status,
          shipping_address_json)
       VALUES ('manual', 'TEST-001', 'TEST-001', 1, 1500, 'cod', 'unfulfilled', 'open',
         $1::jsonb)
       RETURNING id`,
      [
        JSON.stringify({
          name: "Test Receiver",
          phone: "03001234567",
          address_line_1: "123 Test Street",
          city: "Karachi",
        }),
      ]
    );
    orderId = order.id;
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // Helper: reset web_orders to pre-booking state before each test so tests
  // don't contaminate each other's rollback assertions.
  async function resetOrderState() {
    await db.query(
      `UPDATE web_orders SET
         courier_id = NULL,
         tracking_number = NULL,
         active_shipment_id = NULL,
         shipping_provider_status = NULL,
         fulfillment_status = 'unfulfilled',
         shipped_at = NULL,
         updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );
    await db.query(`DELETE FROM order_shipments WHERE web_order_id = $1`, [orderId]);
  }

  beforeEach(async () => {
    await resetOrderState();
  });

  test("PakPost stub with supports_booking=true → 501 with COURIER_NO_BOOKING_API message", async () => {
    const req = makeRequest(app, ADMIN_ID);
    const res = await req
      .post(`/api/orders/${orderId}/shipments/book`)
      .send({ courier_id: pakpostCourierId, weight: 0.5 });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/Pakistan Post/i);
    expect(res.body.error).toMatch(/no booking API/i);
    // Message should point the operator at the workaround.
    expect(res.body.error).toMatch(/manually|manual/i);
  });

  test("Bykea stub with supports_booking=true → 501 with manual-entry guidance", async () => {
    const req = makeRequest(app, ADMIN_ID);
    const res = await req
      .post(`/api/orders/${orderId}/shipments/book`)
      .send({ courier_id: bykeaCourierId, weight: 0.5 });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/Bykea/i);
    expect(res.body.error).toMatch(/no booking API/i);
    expect(res.body.error).toMatch(/manually|manual/i);
  });

  test("Transaction rollback: 501 leaves no order_shipments row and no web_orders mutation", async () => {
    // This is the highest-value test. It proves the pre-fix failure mode
    // (orphan row with status='booked' + tainted web_orders.fulfillment_status)
    // cannot happen even though the route has multiple INSERTs/UPDATEs
    // inside the same db.transaction() block.
    const req = makeRequest(app, ADMIN_ID);
    const res = await req
      .post(`/api/orders/${orderId}/shipments/book`)
      .send({ courier_id: pakpostCourierId, weight: 0.5 });

    expect(res.status).toBe(501);

    // order_shipments must be empty — the rolled-back INSERT must have
    // left no trace.
    const { rows: shipments } = await db.query(
      `SELECT id, status, tracking_number FROM order_shipments WHERE web_order_id = $1`,
      [orderId]
    );
    expect(shipments).toHaveLength(0);

    // web_orders must be untouched — no shipping_provider_status,
    // no fulfillment_status promotion, no shipped_at timestamp.
    const { rows: [order] } = await db.query(
      `SELECT shipping_provider_status, fulfillment_status, shipped_at,
              active_shipment_id, courier_id, tracking_number
       FROM web_orders WHERE id = $1`,
      [orderId]
    );
    expect(order.shipping_provider_status).toBeNull();
    expect(order.fulfillment_status).toBe("unfulfilled");
    expect(order.shipped_at).toBeNull();
    expect(order.active_shipment_id).toBeNull();
    expect(order.courier_id).toBeNull();
    expect(order.tracking_number).toBeNull();
  });

  test("Control: Leopards with bogus credentials → 500, not 501 (proves fix is scoped to stubs only)", async () => {
    // LeopardsAdapter throws "Leopards API credentials not configured" with
    // no statusCode set. The route's outer catch defaults to 500 in that case.
    // If this test starts returning 501, something in the fix accidentally
    // widened to non-stub adapters.
    const req = makeRequest(app, ADMIN_ID);
    const res = await req
      .post(`/api/orders/${orderId}/shipments/book`)
      .send({ courier_id: leopardsCourierId, weight: 0.5 });

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(501);
    expect(res.body.error).toMatch(/Leopards/i);

    // Transaction rollback must hold here too — Leopards throws from inside
    // the same db.transaction() block as the stub adapters.
    const { rows: shipments } = await db.query(
      `SELECT id FROM order_shipments WHERE web_order_id = $1`,
      [orderId]
    );
    expect(shipments).toHaveLength(0);
  });

  test("Control: PakPost with supports_booking=false → manual fallback (200) still works", async () => {
    // This is the production shape today: all 3 live tenants have
    // pakpost/bykea with supports_booking=false. The fix must not disturb
    // the manual fallback branch at routes/couriers.js:314.
    const req = makeRequest(app, ADMIN_ID);
    const res = await req
      .post(`/api/orders/${orderId}/shipments/book`)
      .send({
        courier_id: pakpostManualCourierId,
        weight: 0.5,
        tracking_number: "PAKPOST-MANUAL-12345",
      });

    expect(res.status).toBe(200);
    expect(res.body.manual).toBe(true);

    // Manual fallback DID write a shipment row and DID update web_orders.
    const { rows: shipments } = await db.query(
      `SELECT id, status, tracking_number FROM order_shipments WHERE web_order_id = $1`,
      [orderId]
    );
    expect(shipments).toHaveLength(1);
    expect(shipments[0].status).toBe("booked");
    expect(shipments[0].tracking_number).toBe("PAKPOST-MANUAL-12345");

    const { rows: [order] } = await db.query(
      `SELECT shipping_provider_status, fulfillment_status, tracking_number
       FROM web_orders WHERE id = $1`,
      [orderId]
    );
    expect(order.shipping_provider_status).toBe("manual");
    expect(order.fulfillment_status).toBe("shipped");
    expect(order.tracking_number).toBe("PAKPOST-MANUAL-12345");
  });
});
