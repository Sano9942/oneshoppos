const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 20000, hookTimeout: 60000 });

/**
 * pg-phase21a-modifiers.test.js — Phase 2.1 Batch A2 first-class modifiers.
 *
 * Covers CRUD of modifier_groups + modifier_options, product linking, the
 * constraint-enforced attach flow (min/max/selection_type), snapshot
 * persistence, and the KDS ticket JOIN that surfaces modifier names to the
 * kitchen.
 */

describe("Phase 2.1 A2 — First-class modifiers (Postgres)", () => {
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

    require("../../routes/modifiers")(app, deps);
    require("../../routes/restaurant")(app, deps);
    require("../../routes/kds")(app, deps);

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_restaurant', true),
        ('phase4_restaurant_kds', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  describe("group + option CRUD", () => {
    let groupId;

    it("POST /api/modifiers/groups creates a min=1/max=2 group", async () => {
      const res = await request(app)
        .post("/api/modifiers/groups")
        .set("x-employee-id", "1")
        .send({
          name: "Doneness",
          selection_type: "single",
          min_select: 1,
          max_select: 2,
          is_required: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.selection_type).toBe("single");
      expect(res.body.min_select).toBe(1);
      groupId = res.body.id;
    });

    it("POST /api/modifiers/groups/:id/options adds 3 options", async () => {
      for (const name of ["Rare", "Medium", "Well done"]) {
        const res = await request(app)
          .post(`/api/modifiers/groups/${groupId}/options`)
          .set("x-employee-id", "1")
          .send({ name, price_delta: 0 });
        expect(res.status).toBe(201);
        expect(res.body.name).toBe(name);
      }
    });

    it("GET /api/modifiers/groups returns group with its options", async () => {
      const res = await request(app)
        .get("/api/modifiers/groups")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      const found = res.body.groups.find((g) => g.id === groupId);
      expect(found).toBeTruthy();
      expect(found.options).toHaveLength(3);
    });

    it("POST /api/products/:id/modifier-groups links group to product", async () => {
      const res = await request(app)
        .post(`/api/products/1/modifier-groups`)
        .set("x-employee-id", "1")
        .send({ group_id: groupId });
      expect(res.status).toBe(201);
    });

    it("GET /api/products/:id/modifier-tree returns linked group + options", async () => {
      const res = await request(app)
        .get(`/api/products/1/modifier-tree`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].options).toHaveLength(3);
    });
  });

  describe("attach flow — constraint validation", () => {
    let multiGroupId, optionIds;
    let draftOrderId, draftItemId;

    beforeAll(async () => {
      // Create a multi-select group max=2
      const { rows: [group] } = await db.query(
        `INSERT INTO modifier_groups (name, selection_type, min_select, max_select)
         VALUES ('Toppings', 'multi', 0, 2) RETURNING *`
      );
      multiGroupId = group.id;

      const opts = [];
      for (const [name, price] of [["Cheese", 50], ["Mushroom", 75], ["Bacon", 100]]) {
        const { rows: [opt] } = await db.query(
          `INSERT INTO modifier_options (group_id, name, price_delta)
           VALUES ($1, $2, $3) RETURNING id`,
          [multiGroupId, name, price]
        );
        opts.push(opt.id);
      }
      optionIds = opts;

      const { rows: [order] } = await db.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, status)
         VALUES (1, 1, 'dine_in', 'open') RETURNING id`
      );
      draftOrderId = order.id;
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 1, 'Pizza', 1, 500) RETURNING id`,
        [draftOrderId]
      );
      draftItemId = item.id;
    });

    it("1 option passes max_select=2 validation and bumps item price", async () => {
      const res = await request(app)
        .post("/api/modifiers/attach")
        .set("x-employee-id", "1")
        .send({ draft_order_item_id: draftItemId, option_ids: [optionIds[0]] });

      expect(res.status).toBe(200);
      expect(res.body.attached).toBe(1);
      expect(Number(res.body.price_delta)).toBe(50);

      const { rows } = await db.query(
        "SELECT price FROM draft_order_items WHERE id = $1",
        [draftItemId]
      );
      expect(Number(rows[0].price)).toBe(550); // 500 + 50
    });

    it("3 options fails max_select=2 validation (400)", async () => {
      const { rows: [item2] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 1, 'Pizza', 1, 500) RETURNING id`,
        [draftOrderId]
      );
      const res = await request(app)
        .post("/api/modifiers/attach")
        .set("x-employee-id", "1")
        .send({ draft_order_item_id: item2.id, option_ids: optionIds });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at most 2 options/);
    });

    it("multiple options on a single-select group fails (400)", async () => {
      const { rows: [single] } = await db.query(
        `INSERT INTO modifier_groups (name, selection_type, max_select)
         VALUES ('Size', 'single', 1) RETURNING id`
      );
      const sizeOpts = [];
      for (const name of ["Small", "Large"]) {
        const { rows: [opt] } = await db.query(
          `INSERT INTO modifier_options (group_id, name, price_delta) VALUES ($1, $2, 0) RETURNING id`,
          [single.id, name]
        );
        sizeOpts.push(opt.id);
      }
      const { rows: [item3] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 1, 'Pizza', 1, 500) RETURNING id`,
        [draftOrderId]
      );
      const res = await request(app)
        .post("/api/modifiers/attach")
        .set("x-employee-id", "1")
        .send({ draft_order_item_id: item3.id, option_ids: sizeOpts });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/single-select|at most 1/i);
    });
  });

  describe("snapshot persistence + KDS surface", () => {
    it("option rename does not rewrite history (snapshot survives)", async () => {
      const { rows: [group] } = await db.query(
        `INSERT INTO modifier_groups (name, selection_type, max_select)
         VALUES ('Temp', 'single', 1) RETURNING id`
      );
      const { rows: [opt] } = await db.query(
        `INSERT INTO modifier_options (group_id, name, price_delta)
         VALUES ($1, 'Original Name', 10) RETURNING id`,
        [group.id]
      );
      const { rows: [order] } = await db.query(
        `INSERT INTO draft_orders (outlet_id, created_by, order_context, status)
         VALUES (1, 1, 'dine_in', 'open') RETURNING id`
      );
      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items (draft_order_id, product_id, product_name, quantity, price)
         VALUES ($1, 1, 'Steak', 1, 1000) RETURNING id`,
        [order.id]
      );

      await request(app)
        .post("/api/modifiers/attach")
        .set("x-employee-id", "1")
        .send({ draft_order_item_id: item.id, option_ids: [opt.id] });

      // Rename the option
      await db.query(
        `UPDATE modifier_options SET name = 'Changed Name' WHERE id = $1`,
        [opt.id]
      );

      const { rows } = await db.query(
        `SELECT option_name_snapshot FROM draft_order_item_modifiers WHERE draft_order_item_id = $1`,
        [item.id]
      );
      expect(rows[0].option_name_snapshot).toBe("Original Name");
    });

    it("KDS getTickets JSON contains modifier names under each item", async () => {
      // Seed: station + match_all route, a check with item + modifier,
      // sendToKitchen, then GET tickets.
      const { rows: [station] } = await db.query(
        `INSERT INTO kds_stations (outlet_id, name, station_role)
         VALUES (1, 'PrepMod', 'prep') RETURNING id`
      );
      await db.query(
        `DELETE FROM kds_station_routes WHERE station_id != $1`, [station.id]
      );
      await db.query(
        `INSERT INTO kds_station_routes (station_id, match_all) VALUES ($1, true)`,
        [station.id]
      );

      const { rows: [group] } = await db.query(
        `INSERT INTO modifier_groups (name, selection_type, max_select)
         VALUES ('Prep', 'single', 1) RETURNING id`
      );
      const { rows: [opt] } = await db.query(
        `INSERT INTO modifier_options (group_id, name, price_delta)
         VALUES ($1, 'medium-rare', 0) RETURNING id`,
        [group.id]
      );

      const checkRes = await request(app)
        .post("/api/restaurant/checks")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, order_context: "dine_in", seat_count: 1 });
      expect(checkRes.status).toBe(201);
      const checkId = checkRes.body.id;

      const { rows: [item] } = await db.query(
        `INSERT INTO draft_order_items
           (draft_order_id, product_id, product_name, quantity, price, course_name, kitchen_status)
         VALUES ($1, 1, 'Ribeye', 1, 1500, 'main', 'pending') RETURNING id`,
        [checkId]
      );

      const attachRes = await request(app)
        .post("/api/modifiers/attach")
        .set("x-employee-id", "1")
        .send({ draft_order_item_id: item.id, option_ids: [opt.id] });
      expect(attachRes.status).toBe(200);

      const sendRes = await request(app)
        .post(`/api/restaurant/checks/${checkId}/send-to-kitchen`)
        .set("x-employee-id", "1");
      expect(sendRes.status).toBe(200);

      const ticketsRes = await request(app)
        .get("/api/kds/tickets")
        .query({ station_id: station.id })
        .set("x-employee-id", "1");
      expect(ticketsRes.status).toBe(200);
      const t = ticketsRes.body.tickets.find((x) => x.draft_order_id === checkId);
      expect(t).toBeTruthy();
      const it = t.items.find((x) => x.product_name === "Ribeye");
      expect(it).toBeTruthy();
      expect(it.modifiers).toContain("medium-rare");
    });
  });
});
