const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("COD settlements — /resolve extension", () => {
  let app, db, deps, cleanup;
  const authHeaders = { "x-employee-id": "1" };

  beforeEach(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Mount routes used by the COD tests
    require("../../routes/fulfillment")(app, deps);
    require("../../routes/couriers")(app, deps);

    // Upsert the feature flag so requireFeature("phase5_cod_reconciliation") passes.
    // schema-pg.sql does not seed this flag; migrate-pg.js adds it later.
    await db.query(
      `INSERT INTO feature_flags (key, enabled)
       VALUES ('phase5_cod_reconciliation', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    // Seed a courier, a web_order, and a cod batch+line
    await db.query(
      `INSERT INTO courier_integrations (id, name, adapter_key, enabled)
       VALUES (1, 'Test Courier', 'generic', true)
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status)
       VALUES (100, 'manual', 'TEST-100', 'WEB-100', 500.00, 'pending')`
    );
    await db.query(
      `INSERT INTO cod_settlement_batches (id, courier_id, batch_ref, status, total_lines, total_amount)
       VALUES (1, 1, 'TEST-BATCH', 'review', 1, 500.00)`
    );
    await db.query(
      `INSERT INTO cod_settlement_lines (id, batch_id, courier_tracking_number, remitted_amount, match_status)
       VALUES (1, 1, 'UNKNOWN-TRK', 500.00, 'unmatched')`
    );
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  test("resolve with matched_order_id links the line and recomputes status", async () => {
    const res = await request(app)
      .post("/api/fulfillment/cod/settlements/1/resolve")
      .set(authHeaders)
      .send({ line_id: 1, matched_order_id: 100, resolution_note: "Manually matched" });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT match_status, matched_order_id, expected_amount, difference, resolution_note FROM cod_settlement_lines WHERE id = 1"
    );
    expect(rows[0].match_status).toBe("matched");
    expect(rows[0].matched_order_id).toBe(100);
    expect(Number(rows[0].expected_amount)).toBe(500.00);
    expect(Number(rows[0].difference)).toBe(0);
    expect(rows[0].resolution_note).toBe("Manually matched");
  });

  test("resolve without matched_order_id still works (note only)", async () => {
    const res = await request(app)
      .post("/api/fulfillment/cod/settlements/1/resolve")
      .set(authHeaders)
      .send({ line_id: 1, resolution_note: "Investigating" });

    expect(res.status).toBe(200);

    const { rows } = await db.query(
      "SELECT match_status, resolution_note FROM cod_settlement_lines WHERE id = 1"
    );
    expect(rows[0].match_status).toBe("unmatched"); // unchanged
    expect(rows[0].resolution_note).toBe("Investigating");
  });

  describe("GET /api/web-orders/search", () => {
    beforeEach(async () => {
      await db.query(
        `INSERT INTO web_orders (id, source, external_order_id, external_order_number, grand_total, payment_status, customer_name_snapshot, customer_phone_snapshot)
         VALUES
           (200, 'manual', 'T-200', 'ORD-200', 1500.00, 'paid', 'Ali Khan', '03001234567'),
           (201, 'manual', 'T-201', 'ORD-201', 750.50, 'pending', 'Sara Ahmed', '03009999999')
         ON CONFLICT DO NOTHING`
      );
    });

    test("searches by external_order_number", async () => {
      const res = await request(app)
        .get("/api/web-orders/search?q=ORD-200")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.orders).toHaveLength(1);
      expect(res.body.orders[0].id).toBe(200);
      expect(res.body.orders[0].is_already_matched).toBe(false);
    });

    test("searches by customer name (case-insensitive)", async () => {
      const res = await request(app)
        .get("/api/web-orders/search?q=ali")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.orders.some((o) => o.id === 200)).toBe(true);
    });

    test("searches by phone", async () => {
      const res = await request(app)
        .get("/api/web-orders/search?q=03009999999")
        .set(authHeaders);
      expect(res.body.orders.some((o) => o.id === 201)).toBe(true);
    });

    test("searches by exact grand_total", async () => {
      const res = await request(app)
        .get("/api/web-orders/search?q=750.50")
        .set(authHeaders);
      expect(res.body.orders.some((o) => o.id === 201)).toBe(true);
    });

    test("returns empty array for no matches", async () => {
      const res = await request(app)
        .get("/api/web-orders/search?q=NONEXISTENT_QUERY_XYZ")
        .set(authHeaders);
      expect(res.body.orders).toEqual([]);
    });
  });

  describe("PATCH /api/couriers/:id/csv-mapping", () => {
    test("saves mapping to config_json", async () => {
      const res = await request(app)
        .patch("/api/couriers/1/csv-mapping")
        .set(authHeaders)
        .send({
          mapping: {
            courier_tracking_number: "Tracking No",
            remitted_amount: "COD Amount",
            courier_order_ref: "CN#",
            courier_fee: "Delivery Fee",
          },
        });

      expect(res.status).toBe(200);

      // config_json is stored as TEXT (JSON string) — cast to jsonb in the
      // query so the pg driver returns a parsed object for assertion.
      const { rows } = await db.query(
        "SELECT config_json::jsonb AS config_json FROM courier_integrations WHERE id = 1"
      );
      const cfg = rows[0].config_json || {};
      expect(cfg.cod_csv_mapping).toEqual({
        courier_tracking_number: "Tracking No",
        remitted_amount: "COD Amount",
        courier_order_ref: "CN#",
        courier_fee: "Delivery Fee",
      });
    });

    test("GET /api/couriers returns config_json", async () => {
      const res = await request(app).get("/api/couriers").set(authHeaders);
      const courier = res.body.couriers.find((c) => c.id === 1);
      expect(courier).toBeDefined();
      expect(courier.config_json).toBeDefined();
    });

    test("rejects missing required fields", async () => {
      const res = await request(app)
        .patch("/api/couriers/1/csv-mapping")
        .set(authHeaders)
        .send({ mapping: { courier_order_ref: "CN#" } }); // missing required fields

      expect(res.status).toBe(400);
    });
  });

  describe("approve permission (maker-checker)", () => {
    // Employee id=1 is Administrator (all_access).
    // Employee id=2 is Manager (has manage_orders but NOT all_access).
    const managerHeaders = { "x-employee-id": "2" };

    test("manager with manage_orders cannot approve (requires all_access)", async () => {
      const res = await request(app)
        .post("/api/fulfillment/cod/settlements/1/approve")
        .set(managerHeaders)
        .send({});

      expect(res.status).toBe(403);
    });

    test("admin with all_access can approve", async () => {
      const res = await request(app)
        .post("/api/fulfillment/cod/settlements/1/approve")
        .set(authHeaders)
        .send({});

      // batch id=1 was seeded in status='review', so approval should succeed
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(true);
    });
  });

  describe("approve wrong-state", () => {
    test("approving an already-approved batch returns 400", async () => {
      // Flip the seeded batch straight to 'approved' so the FOR UPDATE +
      // status guard in the handler rejects the second call.
      await db.query(
        "UPDATE cod_settlement_batches SET status = 'approved' WHERE id = 1"
      );

      const res = await request(app)
        .post("/api/fulfillment/cod/settlements/1/approve")
        .set(authHeaders)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/review/i);
    });
  });
});
