const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

/**
 * pg-phase21b-online-inbox.test.js — Phase 2.1 Batch B2 online ordering inbox.
 *
 * Covers the accept flow (web_order → draft_order + kitchen ticket), the
 * reject flow (no draft, rejected_at set), unmapped product SKUs (product_id
 * NULL passes through to the kitchen with title as fallback name), and the
 * guard against double-accept / double-reject.
 */

describe("Phase 2.1 B2 — Online ordering inbox (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/restaurant-inbox")(app, deps);
    require("../../routes/kds")(app, deps);

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);

    // Seed a station + match_all route so sendToKitchen has somewhere to go.
    const { rows: [station] } = await db.query(
      `INSERT INTO kds_stations (outlet_id, name, station_role)
       VALUES (1, 'InboxGrill', 'prep') RETURNING id`
    );
    await db.query(
      `INSERT INTO kds_station_routes (station_id, outlet_id, match_all, priority)
       VALUES ($1, 1, true, 0)`,
      [station.id]
    );
    global.__testInboxStationId = station.id;
  }, 120000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  async function seedWebOrder({ source = "whatsapp", items = [] } = {}) {
    const { rows: [wo] } = await db.query(
      `INSERT INTO web_orders (source, external_order_id, external_order_number, outlet_id, grand_total, subtotal, order_status)
       VALUES ($1, $2, $3, 1, $4, $4, 'open') RETURNING *`,
      [source, `ext-${Date.now()}-${Math.random()}`, `W-${Math.floor(Math.random() * 10000)}`,
       items.reduce((s, i) => s + (i.unit_price || 0) * (i.qty || 1), 0)]
    );
    for (const it of items) {
      await db.query(
        `INSERT INTO web_order_items (web_order_id, product_id, title, sku, qty, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [wo.id, it.product_id || null, it.title || "Item", it.sku || null,
         it.qty || 1, it.unit_price || 0, (it.unit_price || 0) * (it.qty || 1)]
      );
    }
    return wo;
  }

  describe("accept flow", () => {
    it("WhatsApp order with 2 items → draft_order created, sendToKitchen fires", async () => {
      const wo = await seedWebOrder({
        source: "whatsapp",
        items: [
          { product_id: 1, title: "Widget A", qty: 1, unit_price: 100 },
          { product_id: 2, title: "Widget B", qty: 2, unit_price: 200 },
        ],
      });

      const res = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/accept`)
        .set("x-employee-id", "1")
        .send({ order_context: "online" });
      expect(res.status).toBe(201);
      expect(res.body.draft_order_id).toBeGreaterThan(0);
      // Kitchen ticket was created (match_all route routes everything to our station)
      expect(Array.isArray(res.body.tickets)).toBe(true);

      // web_orders stamped with conversion fields
      const { rows: [stamp] } = await db.query(
        `SELECT converted_draft_order_id, accepted_at, accepted_by
         FROM web_orders WHERE id = $1`,
        [wo.id]
      );
      expect(stamp.converted_draft_order_id).toBe(res.body.draft_order_id);
      expect(stamp.accepted_at).toBeTruthy();
      expect(stamp.accepted_by).toBe(1);

      // draft_order has source_channel = 'whatsapp' and order_context = 'online'
      const { rows: [draft] } = await db.query(
        `SELECT source_channel, order_context, outlet_id FROM draft_orders WHERE id = $1`,
        [res.body.draft_order_id]
      );
      expect(draft.source_channel).toBe("whatsapp");
      expect(draft.order_context).toBe("online");
      expect(draft.outlet_id).toBe(1);

      // draft_order_items copied from web_order_items with [external] notes
      const { rows: items } = await db.query(
        `SELECT product_name, quantity, price, notes FROM draft_order_items
         WHERE draft_order_id = $1 ORDER BY id`,
        [res.body.draft_order_id]
      );
      expect(items).toHaveLength(2);
      expect(items[0].product_name).toBe("Widget A");
      expect(Number(items[0].quantity)).toBe(1);
      expect(items[0].notes).toMatch(/\[external\]/);
      expect(items[0].notes).toMatch(/whatsapp/);
      expect(items[1].product_name).toBe("Widget B");
      expect(Number(items[1].quantity)).toBe(2);

      // kds_tickets exist for the new draft
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [res.body.draft_order_id]
      );
      expect(n).toBeGreaterThanOrEqual(1);
    });

    it("accepting the same order twice returns 409", async () => {
      const wo = await seedWebOrder({
        source: "daraz",
        items: [{ product_id: 1, title: "X", qty: 1, unit_price: 50 }],
      });
      const first = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/accept`)
        .set("x-employee-id", "1")
        .send({ order_context: "online" });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/accept`)
        .set("x-employee-id", "1")
        .send({ order_context: "online" });
      expect(second.status).toBe(409);
    });

    it("Daraz order with unmapped product (product_id NULL) still creates ticket with item title", async () => {
      const wo = await seedWebOrder({
        source: "daraz",
        items: [
          { product_id: null, sku: "DRZ-42", title: "Daraz-only Combo", qty: 1, unit_price: 900 },
        ],
      });

      const res = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/accept`)
        .set("x-employee-id", "1")
        .send({ order_context: "takeout" });
      expect(res.status).toBe(201);

      // draft_order_items.product_id is NULL, product_name is the title
      const { rows: items } = await db.query(
        `SELECT product_id, product_name FROM draft_order_items WHERE draft_order_id = $1`,
        [res.body.draft_order_id]
      );
      expect(items).toHaveLength(1);
      expect(items[0].product_id).toBeNull();
      expect(items[0].product_name).toBe("Daraz-only Combo");

      // Kitchen ticket still created for the unmapped item
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM kds_tickets WHERE draft_order_id = $1`,
        [res.body.draft_order_id]
      );
      expect(n).toBeGreaterThanOrEqual(1);
    });
  });

  describe("reject flow", () => {
    it("rejecting sets rejected_at, does not create draft", async () => {
      const wo = await seedWebOrder({
        source: "facebook",
        items: [{ product_id: 1, title: "A", qty: 1, unit_price: 50 }],
      });

      const res = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/reject`)
        .set("x-employee-id", "1")
        .send({ reason: "duplicate order" });
      expect(res.status).toBe(200);
      expect(res.body.web_order.rejected_at).toBeTruthy();
      expect(res.body.web_order.reject_reason).toBe("duplicate order");
      expect(res.body.web_order.order_status).toBe("cancelled");

      // No draft_order was created for this web_order
      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM draft_orders d
         WHERE d.source_channel = 'facebook'
           AND EXISTS (SELECT 1 FROM web_orders wo WHERE wo.id = $1 AND wo.converted_draft_order_id = d.id)`,
        [wo.id]
      );
      expect(n).toBe(0);
    });

    it("rejecting an already-rejected order returns 409", async () => {
      const wo = await seedWebOrder({
        source: "whatsapp",
        items: [{ product_id: 1, title: "A", qty: 1, unit_price: 50 }],
      });
      await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/reject`)
        .set("x-employee-id", "1")
        .send({ reason: "first" });
      const second = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/reject`)
        .set("x-employee-id", "1")
        .send({ reason: "second" });
      expect(second.status).toBe(409);
    });

    it("rejecting an already-accepted order returns 409", async () => {
      const wo = await seedWebOrder({
        source: "whatsapp",
        items: [{ product_id: 1, title: "A", qty: 1, unit_price: 50 }],
      });
      const a = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/accept`)
        .set("x-employee-id", "1")
        .send({ order_context: "online" });
      expect(a.status).toBe(201);

      const r = await request(app)
        .post(`/api/restaurant/inbox/${wo.id}/reject`)
        .set("x-employee-id", "1")
        .send({ reason: "changed mind" });
      expect(r.status).toBe(409);
    });
  });

  describe("list endpoint", () => {
    it("GET /api/restaurant/inbox excludes converted and rejected orders", async () => {
      // Seed three web_orders: one unconverted, one rejected, one accepted.
      const keep = await seedWebOrder({
        source: "whatsapp",
        items: [{ product_id: 1, title: "KeepMe", qty: 1, unit_price: 10 }],
      });
      const rejectMe = await seedWebOrder({
        source: "daraz",
        items: [{ product_id: 1, title: "RejectMe", qty: 1, unit_price: 10 }],
      });
      const acceptMe = await seedWebOrder({
        source: "shopify",
        items: [{ product_id: 1, title: "AcceptMe", qty: 1, unit_price: 10 }],
      });
      await request(app).post(`/api/restaurant/inbox/${rejectMe.id}/reject`)
        .set("x-employee-id", "1").send({ reason: "no" });
      await request(app).post(`/api/restaurant/inbox/${acceptMe.id}/accept`)
        .set("x-employee-id", "1").send({ order_context: "online" });

      const res = await request(app)
        .get("/api/restaurant/inbox")
        .query({ outlet_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      const ids = res.body.orders.map((o) => o.id);
      expect(ids).toContain(keep.id);
      expect(ids).not.toContain(rejectMe.id);
      expect(ids).not.toContain(acceptMe.id);
    });

    it("source filter narrows results", async () => {
      await seedWebOrder({
        source: "whatsapp",
        items: [{ product_id: 1, title: "W1", qty: 1, unit_price: 10 }],
      });
      await seedWebOrder({
        source: "daraz",
        items: [{ product_id: 1, title: "D1", qty: 1, unit_price: 10 }],
      });

      const res = await request(app)
        .get("/api/restaurant/inbox")
        .query({ outlet_id: 1, source: "daraz" })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      for (const o of res.body.orders) expect(o.source).toBe("daraz");
    });
  });
});
