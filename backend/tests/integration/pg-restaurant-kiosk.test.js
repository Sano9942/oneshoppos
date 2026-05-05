const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

/**
 * pg-restaurant-kiosk.test.js — Customer order kiosk (counter + table modes).
 *
 * Covers:
 *   - LEFT JOIN on the public menu fetch — counter-mode token (no table)
 *     returns 200 with table_label = null (regression: used to 404).
 *   - Manager kiosk-tokens endpoints: mint counter + mint table + list +
 *     revoke counter + revoke table.
 *   - Public submit endpoint:
 *       counter mode → web_orders + web_order_items rows, slot rotated,
 *                      draft retired (status='cancelled', submitted_at set).
 *       table mode  → submitted_at stamped, draft stays open.
 *
 * See docs/plans/2026-05-06-order-kiosk-design.md.
 */

describe("Customer order kiosk", () => {
  let app, db, deps, cleanup;
  let origMultiTenant;
  let floorPlanId, tableId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Inject req.employee for the manager-facing kiosk-tokens routes.
    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    // Enable the kiosk feature flag + restaurant mode.
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_qr', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
    await db.query(`
      INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
      ON CONFLICT (mode) DO UPDATE SET enabled = true
    `);

    // Seed: floor plan + one table on outlet 1.
    const { rows: [fp] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Main') RETURNING id`
    );
    floorPlanId = fp.id;
    const { rows: [t] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity)
       VALUES ($1, 'T1', 4) RETURNING id`,
      [floorPlanId]
    );
    tableId = t.id;

    // public-restaurant.js short-circuits to deps.db when MULTI_TENANT is
    // unset. Mirror the trick from pg-batch13-restaurant.test.js.
    origMultiTenant = process.env.MULTI_TENANT;
    delete process.env.MULTI_TENANT;

    require("../../routes/public-restaurant")(app, deps);
    require("../../routes/restaurant-kiosk")(app, deps);
  }, 30000);

  afterAll(async () => {
    if (origMultiTenant !== undefined) process.env.MULTI_TENANT = origMultiTenant;
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (featureFlags.invalidateModeCache) featureFlags.invalidateModeCache();
    if (cleanup) await cleanup();
  });

  // ── Counter mode ─────────────────────────────────────────────

  it("POST /api/restaurant/kiosk-tokens (no table_id) mints a counter slot", async () => {
    const res = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, label: "Front counter" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("counter");
    expect(res.body.token).toBeTruthy();
    expect(res.body.path).toBe(`/menu/${res.body.token}`);

    // Persisted in restaurant_kiosk_slots.
    const { rows } = await db.query(
      "SELECT id, slot_token, label, current_draft_order_id FROM restaurant_kiosk_slots WHERE id = $1",
      [res.body.id]
    );
    expect(rows[0].slot_token).toBe(res.body.token);
    expect(rows[0].label).toBe("Front counter");
    expect(rows[0].current_draft_order_id).toBeNull();
  });

  it("GET /api/public/restaurant/menu/:token works for a counter slot (LEFT JOIN regression)", async () => {
    // Mint a fresh counter slot.
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1 });
    expect(mint.status).toBe(201);

    const res = await request(app).get(`/api/public/restaurant/menu/${mint.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("counter");
    expect(res.body.table_label).toBeNull();
    expect(Array.isArray(res.body.items)).toBe(true);

    // First menu hit lazily mints a draft and links it on the slot.
    const { rows } = await db.query(
      "SELECT current_draft_order_id FROM restaurant_kiosk_slots WHERE id = $1",
      [mint.body.id]
    );
    expect(rows[0].current_draft_order_id).toBeGreaterThan(0);
  });

  it("counter submit creates a web_orders row, retires the draft, and frees the slot", async () => {
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1 });
    const token = mint.body.token;
    const slotId = mint.body.id;

    // Hit the menu so a draft is minted.
    await request(app).get(`/api/public/restaurant/menu/${token}`);

    // Add an item.
    const { rows: [product] } = await db.query("SELECT id FROM products LIMIT 1");
    const add = await request(app)
      .post(`/api/public/restaurant/checks/${token}/items`)
      .send({ product_id: product.id, quantity: 2 });
    expect(add.status).toBe(201);

    const { rows: slotBefore } = await db.query(
      "SELECT current_draft_order_id FROM restaurant_kiosk_slots WHERE id = $1",
      [slotId]
    );
    const draftId = slotBefore[0].current_draft_order_id;
    expect(draftId).toBeGreaterThan(0);

    // Submit.
    const submit = await request(app)
      .post(`/api/public/restaurant/checks/${token}/submit`)
      .send({});
    expect(submit.status).toBe(200);
    expect(submit.body.mode).toBe("counter");
    expect(submit.body.order_number).toMatch(/^K-\d+$/);

    // Slot drained.
    const { rows: slotAfter } = await db.query(
      "SELECT current_draft_order_id FROM restaurant_kiosk_slots WHERE id = $1",
      [slotId]
    );
    expect(slotAfter[0].current_draft_order_id).toBeNull();

    // Draft retired with submitted_at stamped.
    const { rows: draftRows } = await db.query(
      "SELECT status, submitted_at FROM draft_orders WHERE id = $1",
      [draftId]
    );
    expect(draftRows[0].status).toBe("cancelled");
    expect(draftRows[0].submitted_at).not.toBeNull();

    // web_orders row + items present, source='kiosk'.
    const { rows: webOrders } = await db.query(
      "SELECT id, source, order_status, grand_total FROM web_orders WHERE source = 'kiosk' ORDER BY id DESC LIMIT 1"
    );
    expect(webOrders[0].source).toBe("kiosk");
    const { rows: items } = await db.query(
      "SELECT qty FROM web_order_items WHERE web_order_id = $1",
      [webOrders[0].id]
    );
    expect(items.length).toBe(1);
    expect(Number(items[0].qty)).toBe(2);
  });

  it("counter submit with empty cart returns 409", async () => {
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1 });
    const token = mint.body.token;

    // Mint draft via menu hit but add nothing.
    await request(app).get(`/api/public/restaurant/menu/${token}`);

    const submit = await request(app)
      .post(`/api/public/restaurant/checks/${token}/submit`)
      .send({});
    expect(submit.status).toBe(409);
  });

  it("after submit the same slot URL still works — next /menu hit mints a fresh draft", async () => {
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1 });
    const token = mint.body.token;
    const slotId = mint.body.id;

    await request(app).get(`/api/public/restaurant/menu/${token}`);
    const { rows: [product] } = await db.query("SELECT id FROM products LIMIT 1");
    await request(app)
      .post(`/api/public/restaurant/checks/${token}/items`)
      .send({ product_id: product.id, quantity: 1 });
    const submit = await request(app).post(`/api/public/restaurant/checks/${token}/submit`).send({});
    expect(submit.status).toBe(200);

    // Hit menu again — should resolve, lazily minting a fresh draft.
    const reload = await request(app).get(`/api/public/restaurant/menu/${token}`);
    expect(reload.status).toBe(200);
    expect(reload.body.mode).toBe("counter");

    const { rows } = await db.query(
      "SELECT current_draft_order_id FROM restaurant_kiosk_slots WHERE id = $1",
      [slotId]
    );
    expect(rows[0].current_draft_order_id).toBeGreaterThan(0);
  });

  // ── Table mode ───────────────────────────────────────────────

  it("POST /api/restaurant/kiosk-tokens (with table_id) mints a table-mode draft token", async () => {
    const res = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, table_id: tableId });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("table");
    expect(res.body.token).toBeTruthy();
    expect(res.body.table_label).toBe("T1");

    // Draft in draft_orders with this token + table.
    const { rows } = await db.query(
      `SELECT status, table_id, source_token_id, order_context FROM draft_orders WHERE id = $1`,
      [res.body.id]
    );
    expect(rows[0].status).toBe("open");
    expect(rows[0].table_id).toBe(tableId);
    expect(rows[0].source_token_id).toBe(res.body.token);
    expect(rows[0].order_context).toBe("dine_in");
  });

  it("table-mode menu fetch returns table_label populated", async () => {
    // Reuse the existing open table token (or mint).
    const { rows: [existing] } = await db.query(
      `SELECT source_token_id FROM draft_orders WHERE table_id = $1 AND status = 'open' LIMIT 1`,
      [tableId]
    );
    const token = existing.source_token_id;
    const res = await request(app).get(`/api/public/restaurant/menu/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("table");
    expect(res.body.table_label).toBe("T1");
  });

  it("table-mode submit stamps submitted_at and leaves draft open", async () => {
    const { rows: [existing] } = await db.query(
      `SELECT id, source_token_id FROM draft_orders WHERE table_id = $1 AND status = 'open' LIMIT 1`,
      [tableId]
    );
    const token = existing.source_token_id;
    const draftId = existing.id;
    const { rows: [product] } = await db.query("SELECT id FROM products LIMIT 1");

    await request(app)
      .post(`/api/public/restaurant/checks/${token}/items`)
      .send({ product_id: product.id, quantity: 1 });

    const submit = await request(app)
      .post(`/api/public/restaurant/checks/${token}/submit`)
      .send({});
    expect(submit.status).toBe(200);
    expect(submit.body.mode).toBe("table");
    expect(submit.body.check_id).toBe(draftId);

    const { rows } = await db.query(
      "SELECT status, submitted_at FROM draft_orders WHERE id = $1",
      [draftId]
    );
    expect(rows[0].status).toBe("open");
    expect(rows[0].submitted_at).not.toBeNull();
  });

  // ── List + revoke ────────────────────────────────────────────

  it("GET /api/restaurant/kiosk-tokens returns counters + tables for the outlet", async () => {
    const res = await request(app)
      .get("/api/restaurant/kiosk-tokens")
      .query({ outlet_id: 1 })
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.counters)).toBe(true);
    expect(Array.isArray(res.body.tables)).toBe(true);
    expect(res.body.counters.length).toBeGreaterThan(0);
    expect(res.body.tables.length).toBeGreaterThan(0);
  });

  it("DELETE /api/restaurant/kiosk-tokens/counter/:id revokes a counter slot", async () => {
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1 });
    const slotId = mint.body.id;

    const del = await request(app)
      .delete(`/api/restaurant/kiosk-tokens/counter/${slotId}`)
      .set("x-employee-id", "1");
    expect(del.status).toBe(200);
    expect(del.body.revoked).toBe(true);

    // Subsequent menu fetch returns 404.
    const reload = await request(app).get(`/api/public/restaurant/menu/${mint.body.token}`);
    expect(reload.status).toBe(404);
  });

  it("DELETE /api/restaurant/kiosk-tokens/table/:id cancels the draft", async () => {
    // Need a fresh table — the prior table token is still 'open'.
    const { rows: [t2] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity) VALUES ($1, 'T2', 2) RETURNING id`,
      [floorPlanId]
    );
    const mint = await request(app)
      .post("/api/restaurant/kiosk-tokens")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, table_id: t2.id });
    const draftId = mint.body.id;

    const del = await request(app)
      .delete(`/api/restaurant/kiosk-tokens/table/${draftId}`)
      .set("x-employee-id", "1");
    expect(del.status).toBe(200);

    const { rows } = await db.query("SELECT status FROM draft_orders WHERE id = $1", [draftId]);
    expect(rows[0].status).toBe("cancelled");
  });
});
