const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

/**
 * pg-phase21c-tips.test.js — Phase 2.1 Batch C tips capture + pooling.
 *
 * Covers:
 *   - captureTipOnSale writes a row with the correct server_id (pulled
 *     from the table session, not the cashier).
 *   - open pool → close: stamps captures with pool_id and sums total_tips.
 *   - hours_weighted distribution with 8h/4h/4h: 50%/25%/25% with the
 *     rounding remainder going to the longest-hours employee.
 *   - one commission_earnings row per payout with earning_type='tip'.
 *   - voiding a distributed pool reverses commission_earnings.
 */

describe("Phase 2.1 C — Tip capture + pooling (Postgres)", () => {
  let app, db, deps, cleanup;
  let tipsService;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    require("../../routes/tips")(app, deps);

    tipsService = require("../../services/tips");

    // Seed three "server" employees on top of the standard fixtures so we
    // can attribute attendance hours and tip pool payouts to known ids.
    // (Hassan = id 1 is admin; we add 4/5/6 as servers.)
    for (const [id, name, salary] of [
      [4, "Server Alpha", 30000],
      [5, "Server Beta", 30000],
      [6, "Server Gamma", 30000],
    ]) {
      await db.query(
        `INSERT INTO employees (id, name, role, role_id, monthly_salary)
         VALUES ($1, $2, 'Cashier', 3, $3)`,
        [id, name, salary]
      );
      await db.query(
        `INSERT INTO employee_outlets (employee_id, outlet_id, is_primary)
         VALUES ($1, 1, true)`,
        [id]
      );
    }
    await db.query(`SELECT setval(pg_get_serial_sequence('employees', 'id'), 6, true)`);
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // Each test starts with a clean tip ledger so assertions are isolated.
  beforeEach(async () => {
    await db.query("DELETE FROM tip_pool_payouts");
    await db.query("DELETE FROM tip_pools");
    await db.query("DELETE FROM tip_pool_distribution_rules");
    await db.query("DELETE FROM tip_captures");
    await db.query("DELETE FROM commission_earnings");
    await db.query("DELETE FROM attendance_sessions");
    await db.query("DELETE FROM sale_payments");
    await db.query("DELETE FROM sale_items");
    await db.query("DELETE FROM sales");
    await db.query("DELETE FROM restaurant_check_seats");
    await db.query("DELETE FROM draft_order_items");
    await db.query("DELETE FROM draft_orders");
    await db.query("DELETE FROM restaurant_table_sessions");
    await db.query("DELETE FROM restaurant_tables");
    await db.query("DELETE FROM restaurant_floor_plans");
  });

  // Helper — open a table session with a known server, return ids.
  async function seedTableSession(serverId) {
    const { rows: [floor] } = await db.query(
      `INSERT INTO restaurant_floor_plans (outlet_id, name) VALUES (1, 'Main Floor') RETURNING id`
    );
    const { rows: [tbl] } = await db.query(
      `INSERT INTO restaurant_tables (floor_plan_id, label, capacity)
       VALUES ($1, 'T1', 4) RETURNING id`,
      [floor.id]
    );
    const { rows: [sess] } = await db.query(
      `INSERT INTO restaurant_table_sessions (table_id, outlet_id, server_id, guest_count)
       VALUES ($1, 1, $2, 2) RETURNING id`,
      [tbl.id, serverId]
    );
    const { rows: [draft] } = await db.query(
      `INSERT INTO draft_orders (outlet_id, created_by, status, table_session_id, source_channel)
       VALUES (1, $1, 'open', $2, 'pos') RETURNING id`,
      [serverId, sess.id]
    );
    return { floorId: floor.id, tableId: tbl.id, sessionId: sess.id, draftId: draft.id };
  }

  // Helper — create a sale row directly (bypasses the full /api/sales handler
  // since we're testing the tip capture, not the sale ingest).
  // saleDate is optional YYYY-MM-DD to control the sale's timestamp so the
  // tip pool's business_date filter matches.
  async function createSale({ employeeId, totalAmount, saleDate = null }) {
    // The test schema requires shifts.employee_id; create a quick shift.
    const { rows: [shift] } = await db.query(
      `INSERT INTO cash_shifts (employee_id, outlet_id, status, opening_float)
       VALUES ($1, 1, 'open', 0) RETURNING id`,
      [employeeId]
    );
    const ts = saleDate ? `${saleDate}T12:00:00Z` : new Date().toISOString();
    const { rows: [sale] } = await db.query(
      `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, shift_id, timestamp)
       VALUES ($1, 'Card', 1, $2, $3, $4) RETURNING id`,
      [totalAmount, employeeId, shift.id, ts]
    );
    return sale.id;
  }

  // Helper — log an attendance work session for an employee on a date with
  // a given duration in hours.
  async function logAttendance(employeeId, businessDate, hours) {
    const start = new Date(`${businessDate}T08:00:00Z`);
    const end = new Date(start.getTime() + hours * 3600 * 1000);
    await db.query(
      `INSERT INTO attendance_sessions
         (employee_id, outlet_id, session_type, session_start, session_end, duration_hours)
       VALUES ($1, 1, 'work', $2, $3, $4)`,
      [employeeId, start.toISOString(), end.toISOString(), hours]
    );
  }

  describe("captureTipOnSale", () => {
    it("attributes the tip to the table session's server, not the cashier", async () => {
      const SERVER_ID = 4;
      const CASHIER_ID = 3;
      const { draftId } = await seedTableSession(SERVER_ID);
      const saleId = await createSale({ employeeId: CASHIER_ID, totalAmount: 1500 });

      const captured = await tipsService.captureTipOnSale(db, {
        sale_id: saleId,
        draft_order_id: draftId,
        tip_amount: 200,
        tip_method: "card",
      });

      expect(captured).not.toBeNull();
      expect(captured.server_id).toBe(SERVER_ID);
      expect(Number(captured.tip_amount)).toBe(200);
      expect(captured.tip_method).toBe("card");
      expect(captured.outlet_id).toBe(1);
      expect(captured.pool_id).toBeNull();
    });

    it("is idempotent on sale_id (second call returns null)", async () => {
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 1000 });

      const first = await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 100, tip_method: "cash",
      });
      const second = await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 100, tip_method: "cash",
      });

      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it("captures non-restaurant sales (no draft_order_id) with NULL server", async () => {
      const saleId = await createSale({ employeeId: 3, totalAmount: 800 });
      const captured = await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: null, tip_amount: 50, tip_method: "cash",
      });
      expect(captured).not.toBeNull();
      expect(captured.server_id).toBeNull();
    });

    it("returns null and writes nothing for tip_amount <= 0", async () => {
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 1200 });
      const captured = await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 0, tip_method: "cash",
      });
      expect(captured).toBeNull();
    });
  });

  describe("openTipPool / closeTipPool", () => {
    it("opens an idempotent pool — second call returns the same row", async () => {
      const businessDate = "2026-04-18";
      const first = await tipsService.openTipPool(db, 1, businessDate);
      const second = await tipsService.openTipPool(db, 1, businessDate);
      expect(first.id).toBe(second.id);
      expect(first.status).toBe("open");
    });

    it("closes a pool with three sales: stamps captures and sums total", async () => {
      const businessDate = new Date().toISOString().slice(0, 10);
      const SERVER_ID = 4;
      const pool = await tipsService.openTipPool(db, 1, businessDate);

      // Three sales with different tip amounts on the same business day.
      for (const tip of [100, 200, 50]) {
        const { draftId } = await seedTableSession(SERVER_ID);
        const saleId = await createSale({ employeeId: 3, totalAmount: 1000, saleDate: businessDate });
        await tipsService.captureTipOnSale(db, {
          sale_id: saleId, draft_order_id: draftId, tip_amount: tip, tip_method: "card",
        });
      }

      const closed = await tipsService.closeTipPool(db, pool.id, 2);
      expect(closed.status).toBe("closed");
      expect(Number(closed.total_tips)).toBe(350);
      expect(closed.closed_by).toBe(2);

      // All captures should now carry pool_id.
      const { rows } = await db.query(
        "SELECT pool_id FROM tip_captures ORDER BY id"
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.pool_id === pool.id)).toBe(true);
    });

    it("rejects a double-close (status flow guard)", async () => {
      const pool = await tipsService.openTipPool(db, 1, "2026-04-18");
      await tipsService.closeTipPool(db, pool.id, 2);
      await expect(tipsService.closeTipPool(db, pool.id, 2)).rejects.toThrow(
        /Cannot close pool from status 'closed'/
      );
    });
  });

  describe("distributeTipPool — hours_weighted", () => {
    it("splits 50%/25%/25% across 8h/4h/4h workers, pennies to longest hours", async () => {
      const businessDate = new Date().toISOString().slice(0, 10);

      // Three servers worked: 8h, 4h, 4h → weights 8/16, 4/16, 4/16 = 50/25/25.
      await logAttendance(4, businessDate, 8);
      await logAttendance(5, businessDate, 4);
      await logAttendance(6, businessDate, 4);

      const pool = await tipsService.openTipPool(db, 1, businessDate);

      // Tip total chosen so distribution has a 1-cent remainder: 100.01 →
      // shares 50.005 / 25.0025 / 25.0025 → cents 5000/2500/2500 = 10000,
      // remainder 1 → goes to employee 4 (longest hours).
      // We need to record the tip with a sale on the same business_date.
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 5000, saleDate: businessDate });
      await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 100.01, tip_method: "card",
      });

      await tipsService.closeTipPool(db, pool.id, 2);

      // Create a hours_weighted rule (default for the outlet).
      const { rows: [rule] } = await db.query(
        `INSERT INTO tip_pool_distribution_rules
           (outlet_id, name, strategy, is_default, is_active)
         VALUES (1, 'Hours Weighted', 'hours_weighted', true, true)
         RETURNING *`
      );

      const result = await tipsService.distributeTipPool(db, pool.id, rule.id);
      expect(result.pool.status).toBe("distributed");
      expect(result.payouts).toHaveLength(3);

      // Locate payouts by employee.
      const byEmp = Object.fromEntries(
        result.payouts.map((p) => [p.employee_id, p])
      );

      // 50% of 100.01 = 50.005 → 50.00 + the penny remainder (1 cent) = 50.01.
      expect(Number(byEmp[4].payout_amount)).toBeCloseTo(50.01, 2);
      // 25% of 100.01 = 25.0025 → floored to 25.00.
      expect(Number(byEmp[5].payout_amount)).toBeCloseTo(25.0, 2);
      expect(Number(byEmp[6].payout_amount)).toBeCloseTo(25.0, 2);

      // Total reconciles exactly.
      const total = result.payouts.reduce(
        (s, p) => s + Number(p.payout_amount),
        0
      );
      expect(total).toBeCloseTo(100.01, 2);
    });

    it("creates one commission_earnings row per payout with earning_type='tip'", async () => {
      const businessDate = new Date().toISOString().slice(0, 10);
      await logAttendance(4, businessDate, 6);
      await logAttendance(5, businessDate, 6);

      const pool = await tipsService.openTipPool(db, 1, businessDate);
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 2000, saleDate: businessDate });
      await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 60, tip_method: "card",
      });
      await tipsService.closeTipPool(db, pool.id, 2);

      const { rows: [rule] } = await db.query(
        `INSERT INTO tip_pool_distribution_rules
           (outlet_id, name, strategy, is_default, is_active)
         VALUES (1, 'Equal Hours', 'hours_weighted', true, true)
         RETURNING *`
      );
      const result = await tipsService.distributeTipPool(db, pool.id, rule.id);

      // Two payouts → two commission_earnings rows.
      const { rows: ce } = await db.query(
        `SELECT * FROM commission_earnings WHERE earning_type = 'tip' ORDER BY id`
      );
      expect(ce).toHaveLength(2);
      expect(ce.every((r) => r.earning_type === "tip")).toBe(true);
      expect(ce.every((r) => r.sale_id === null)).toBe(true);
      expect(ce.every((r) => r.plan_id === null)).toBe(true);
      expect(ce.every((r) => r.status === "pending")).toBe(true);

      // Each tip_pool_payout points to its commission_earnings row.
      const ceIds = new Set(ce.map((r) => r.id));
      result.payouts.forEach((p) => {
        expect(ceIds.has(p.commission_earning_id)).toBe(true);
      });
    });
  });

  describe("voidTipPool", () => {
    it("voids a closed (undistributed) pool without affecting commission_earnings", async () => {
      const pool = await tipsService.openTipPool(db, 1, "2026-04-18");
      await tipsService.closeTipPool(db, pool.id, 2);

      const voided = await tipsService.voidTipPool(db, pool.id, "test cleanup");
      expect(voided.status).toBe("voided");
      expect(voided.notes).toMatch(/test cleanup/);
    });

    it("reverses commission_earnings on a distributed pool", async () => {
      const businessDate = new Date().toISOString().slice(0, 10);
      await logAttendance(4, businessDate, 8);
      await logAttendance(5, businessDate, 4);

      const pool = await tipsService.openTipPool(db, 1, businessDate);
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 1500, saleDate: businessDate });
      await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 60, tip_method: "card",
      });
      await tipsService.closeTipPool(db, pool.id, 2);

      const { rows: [rule] } = await db.query(
        `INSERT INTO tip_pool_distribution_rules
           (outlet_id, name, strategy, is_default, is_active)
         VALUES (1, 'Hours', 'hours_weighted', true, true)
         RETURNING *`
      );
      await tipsService.distributeTipPool(db, pool.id, rule.id);

      // Sanity: two pending tip earnings now exist.
      const { rows: pendingBefore } = await db.query(
        `SELECT * FROM commission_earnings WHERE earning_type = 'tip' AND status = 'pending'`
      );
      expect(pendingBefore).toHaveLength(2);

      const voided = await tipsService.voidTipPool(db, pool.id, "shift error");
      expect(voided.status).toBe("voided");

      const { rows: reversed } = await db.query(
        `SELECT * FROM commission_earnings WHERE earning_type = 'tip' AND status = 'reversed'`
      );
      expect(reversed).toHaveLength(2);
      expect(reversed.every((r) => r.reversal_reason)).toBe(true);
    });
  });

  describe("HTTP routes", () => {
    it("POST /api/tips/pools opens a pool (idempotent)", async () => {
      const r1 = await request(app)
        .post("/api/tips/pools")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, business_date: "2026-04-18" })
        .expect(201);
      expect(r1.body.pool.status).toBe("open");

      // Second call returns the same pool — express returns 201 on the same
      // service path; the service is idempotent.
      const r2 = await request(app)
        .post("/api/tips/pools")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, business_date: "2026-04-18" })
        .expect(201);
      expect(r2.body.pool.id).toBe(r1.body.pool.id);
    });

    it("GET /api/tips/payouts returns summary totals", async () => {
      const businessDate = new Date().toISOString().slice(0, 10);
      await logAttendance(4, businessDate, 8);
      await logAttendance(5, businessDate, 4);
      const { draftId } = await seedTableSession(4);
      const saleId = await createSale({ employeeId: 3, totalAmount: 1000, saleDate: businessDate });
      await tipsService.captureTipOnSale(db, {
        sale_id: saleId, draft_order_id: draftId, tip_amount: 60, tip_method: "card",
      });

      const pool = await tipsService.openTipPool(db, 1, businessDate);
      await tipsService.closeTipPool(db, pool.id, 2);
      const { rows: [rule] } = await db.query(
        `INSERT INTO tip_pool_distribution_rules
           (outlet_id, name, strategy, is_default, is_active)
         VALUES (1, 'Hours', 'hours_weighted', true, true)
         RETURNING *`
      );
      await tipsService.distributeTipPool(db, pool.id, rule.id);

      const res = await request(app)
        .get("/api/tips/payouts")
        .set("x-employee-id", "1")
        .expect(200);

      expect(res.body.payouts).toHaveLength(2);
      expect(Number(res.body.summary.total_amount)).toBeCloseTo(60, 2);
      expect(Number(res.body.summary.unpaid_amount)).toBeCloseTo(60, 2);
    });
  });
});
