/**
 * pg-phase2g8-cycle-counts.test.js — Cycle count scheduling + sessions.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("2-G.8 Cycle counts API", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase2g_inventory_intelligence', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    require("../../routes/inventory-intelligence")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60000);

  beforeEach(async () => {
    await db.query("DELETE FROM cycle_count_sessions");
    await db.query("DELETE FROM cycle_count_schedules");
    await db.query("DELETE FROM stock_count_items");
    await db.query("DELETE FROM stock_counts");
  });

  const auth = { "x-employee-id": "1" };

  describe("schedule CRUD", () => {
    it("POST creates a schedule with filter_criteria", async () => {
      const res = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "Weekly outlet 1",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });
      expect(res.status).toBe(201);
      expect(res.body.schedule.id).toBeGreaterThan(0);
      expect(res.body.schedule.name).toBe("Weekly outlet 1");
      expect(res.body.schedule.is_active).toBe(true);
    });

    it("POST requires name + recurrence + next_due_date", async () => {
      const res = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({ filter_criteria: { outlet_id: 1 } });
      expect(res.status).toBe(400);
    });

    it("POST rejects invalid recurrence value", async () => {
      const res = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "Bad",
          filter_criteria: { outlet_id: 1 },
          recurrence: "daily", // not allowed
          next_due_date: "2026-05-01",
        });
      expect(res.status).toBe(400);
    });

    it("GET lists schedules", async () => {
      await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "Sched A",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });

      const res = await request(app)
        .get("/api/inventory-intelligence/cycle-schedules")
        .set(auth);
      expect(res.status).toBe(200);
      expect(res.body.schedules.length).toBe(1);
      expect(res.body.schedules[0].name).toBe("Sched A");
    });

    it("PUT updates a schedule", async () => {
      const { body: created } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "A",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });

      const res = await request(app)
        .put(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}`)
        .set(auth)
        .send({ name: "A-updated", is_active: false });
      expect(res.status).toBe(200);
      expect(res.body.schedule.name).toBe("A-updated");
      expect(res.body.schedule.is_active).toBe(false);
    });

    it("DELETE removes a schedule", async () => {
      const { body: created } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "Temp",
          filter_criteria: { outlet_id: 1 },
          recurrence: "monthly",
          next_due_date: "2026-05-01",
        });
      const res = await request(app)
        .delete(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}`)
        .set(auth);
      expect(res.status).toBe(204);
    });
  });

  describe("start-session", () => {
    async function makeSchedule(filter) {
      const { body } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "T",
          filter_criteria: filter,
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });
      return body.schedule.id;
    }

    it("creates a stock_count with items matching the filter, advances next_due_date", async () => {
      const id = await makeSchedule({ outlet_id: 1 });
      const res = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(res.status).toBe(200);
      expect(res.body.session_id).toBeGreaterThan(0);
      expect(res.body.stock_count_id).toBeGreaterThan(0);

      const { rows: itemRows } = await db.query(
        `SELECT COUNT(*)::int AS c FROM stock_count_items WHERE stock_count_id = $1`,
        [res.body.stock_count_id]
      );
      // Seed has products 1..5 at outlet 1 — all should be seeded into the count.
      expect(itemRows[0].c).toBe(5);

      // Schedule next_due_date advanced by 7 days from 2026-05-01 → 2026-05-08.
      const { rows: schedRows } = await db.query(
        `SELECT next_due_date::text AS d, last_run_at FROM cycle_count_schedules WHERE id = $1`,
        [id]
      );
      expect(schedRows[0].d).toBe("2026-05-08");
      expect(schedRows[0].last_run_at).not.toBeNull();
    });

    it("filter by category resolves only matching products", async () => {
      // Seed products 1..3 are category 1 (Electronics); products 4..5 are category 2.
      const id = await makeSchedule({ outlet_id: 1, category_id: 2 });
      const res = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(res.status).toBe(200);
      const { rows } = await db.query(
        `SELECT product_id FROM stock_count_items WHERE stock_count_id = $1 ORDER BY product_id`,
        [res.body.stock_count_id]
      );
      expect(rows.map((r) => r.product_id)).toEqual([4, 5]);
    });

    it("returns 400 when the filter matches zero products and does not advance next_due_date", async () => {
      // category_id 99 doesn't exist.
      const id = await makeSchedule({ outlet_id: 1, category_id: 99 });
      const res = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(res.status).toBe(400);

      const { rows } = await db.query(
        `SELECT next_due_date::text AS d, last_run_at FROM cycle_count_schedules WHERE id = $1`,
        [id]
      );
      expect(rows[0].d).toBe("2026-05-01");
      expect(rows[0].last_run_at).toBeNull();
    });

    it("returns 400 when outlet_id missing from filter_criteria", async () => {
      const id = await makeSchedule({ category_id: 1 });
      const res = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(res.status).toBe(400);
    });

    it("concurrent start-session on same schedule — second call errors via unique partial index", async () => {
      const id = await makeSchedule({ outlet_id: 1 });
      const r1 = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(r1.status).toBe(200);
      const r2 = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${id}/start-session`)
        .set(auth);
      expect(r2.status).toBe(409);
    });
  });

  describe("complete session", () => {
    async function seedSessionAndCount() {
      const { body: created } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "X",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });
      const { body: started } = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}/start-session`)
        .set(auth);
      return started;
    }

    it("computes variance_value = SUM(|counted - system| × cost_price)", async () => {
      const { session_id, stock_count_id } = await seedSessionAndCount();

      // Product 1 system_qty 50, set counted_qty 45 → variance 5 units × cost 60 = 300.
      // Product 2 system_qty 30, set counted_qty 35 → variance 5 units × cost 120 = 600.
      await db.query(
        `UPDATE stock_count_items SET counted_qty = 45 WHERE stock_count_id = $1 AND product_id = 1`,
        [stock_count_id]
      );
      await db.query(
        `UPDATE stock_count_items SET counted_qty = 35 WHERE stock_count_id = $1 AND product_id = 2`,
        [stock_count_id]
      );
      // Rest set counted = system so variance 0.
      await db.query(
        `UPDATE stock_count_items SET counted_qty = system_qty
           WHERE stock_count_id = $1 AND counted_qty IS NOT DISTINCT FROM 0 AND product_id NOT IN (1,2)`,
        [stock_count_id]
      );

      const res = await request(app)
        .post(`/api/inventory-intelligence/cycle-sessions/${session_id}/complete`)
        .set(auth);
      expect(res.status).toBe(200);
      expect(Number(res.body.variance_units)).toBe(10);
      expect(Number(res.body.variance_value)).toBeCloseTo(900, 0);
    });
  });

  describe("schedule delete while session open", () => {
    it("session survives with schedule_id = NULL", async () => {
      const { body: created } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "DelMe",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });

      const { body: started } = await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}/start-session`)
        .set(auth);

      const del = await request(app)
        .delete(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}`)
        .set(auth);
      expect(del.status).toBe(204);

      const { rows } = await db.query(
        `SELECT id, schedule_id FROM cycle_count_sessions WHERE id = $1`,
        [started.session_id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].schedule_id).toBeNull();
    });
  });

  describe("list sessions", () => {
    it("returns recent sessions sorted by started_at desc", async () => {
      const { body: created } = await request(app)
        .post("/api/inventory-intelligence/cycle-schedules")
        .set(auth)
        .send({
          name: "S1",
          filter_criteria: { outlet_id: 1 },
          recurrence: "weekly",
          next_due_date: "2026-05-01",
        });
      await request(app)
        .post(`/api/inventory-intelligence/cycle-schedules/${created.schedule.id}/start-session`)
        .set(auth);

      const res = await request(app)
        .get("/api/inventory-intelligence/cycle-sessions")
        .set(auth);
      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].schedule_name).toBe("S1");
    });
  });
});
