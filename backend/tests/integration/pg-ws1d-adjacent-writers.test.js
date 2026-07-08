/**
 * pg-ws1d-adjacent-writers.test.js — WS1d adjacent money/stock writers
 *
 * Covers the fixes in this workstream:
 *   M4 — commission idempotency: calculating commissions for a sale twice
 *        (checkout auto-calc + manager recalc) yields ONE earning set, not two.
 *   M5 — PO partial receive: a partial receipt keeps the PO 'Approved'
 *        (still receivable) and books a supplier invoice for the RECEIVED
 *        value, not the full po.total_cost; receiving the remainder closes it.
 *   M8 — transfer-points writes the LOYALTY ledger (loyalty_transactions),
 *        not customer_wallet_ledger, and adjusts customers.loyalty_points.
 *   M9 — dunning predicate flags a subscription only when its LATEST run is
 *        unpaid — an old unpaid + current-paid subscriber is NOT cut off.
 *   V2 — an all_access holder overriding a HARD credit block writes an
 *        approval_events row, matching the manager-PIN path.
 */

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

describe("WS1d — adjacent money/stock writers (Postgres)", () => {
  let app, db, deps, cleanup, req;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Real company profile so credit/tax behave like production (the default
    // stub only sets { timezone: "UTC" }).
    app.use("/api/", async (req, res, next) => {
      try {
        const { rows: [row] } = await db.query(
          "SELECT * FROM company_profile WHERE id = 1"
        );
        req.company = row || { timezone: "UTC" };
        next();
      } catch (err) {
        next(err);
      }
    });

    require("../../routes/customers")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/customer-invoices")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/commissions")(app, deps);
    require("../../routes/purchase-orders")(app, deps);

    req = makeRequest(app, ADMIN_ID);

    // phase2_commissions is not in the default test flag set — seed ON.
    await db.query(
      "INSERT INTO feature_flags (key, enabled) VALUES ($1, true) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
      ["phase2_commissions"],
    );
    require("../../middleware/feature-flags").invalidateFeatureFlagCache();

    await db.query("UPDATE company_profile SET tax_mode = 'none' WHERE id = 1");

    // Clock in + open a shift so POST /api/sales isn't blocked.
    await request(app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ outlet_id: 1, opening_float: 500, denominations: [] });
    await request(app)
      .post("/api/attendance/pin-checkin")
      .send({ pin_code: "2580", outlet_id: 1 });
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 30000);

  // ── M4 ──────────────────────────────────────────────────────────────────
  describe("M4 — commission idempotency", () => {
    it("double calc → a single earning set (no payroll double-pay)", async () => {
      const { rows: [plan] } = await db.query(
        `INSERT INTO commission_plans (name, description, type)
         VALUES ('M4-flat', '', 'fixed_per_item') RETURNING *`,
      );
      await db.query(
        `INSERT INTO commission_plan_rules (plan_id, scope_type, rate, min_threshold, priority)
         VALUES ($1, 'all', 10, 0, 0)`,
        [plan.id],
      );
      await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id = 1", [plan.id]);
      await db.query("UPDATE employees SET commission_plan_id = NULL WHERE id IN (2,3)");

      const { rows: [sale] } = await db.query(
        `INSERT INTO sales (employee_id, outlet_id, total_amount, payment_method, invoice_number, discount_amount)
         VALUES (1, 1, 300, 'Cash', 'M4-0001', 0) RETURNING *`,
      );
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, staff_id)
         VALUES ($1, 1, 3, 100, NULL)`,
        [sale.id],
      );

      // First calc (simulates the POS checkout auto-hook).
      const r1 = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
      expect(r1.status).toBe(200);
      expect(r1.body.earnings).toHaveLength(1);

      // Second calc (simulates a later manager "recalculate").
      const r2 = await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
      expect(r2.status).toBe(200);

      const { rows: earnings } = await db.query(
        "SELECT * FROM commission_earnings WHERE sale_id = $1 AND earning_type = 'commission'",
        [sale.id],
      );
      expect(earnings).toHaveLength(1); // not two — recalc REPLACED, not duplicated
      expect(Number(earnings[0].commission_amount)).toBe(30);
    });

    it("recalc leaves an already-approved earning alone (no un-pay)", async () => {
      const { rows: [plan] } = await db.query(
        `INSERT INTO commission_plans (name, description, type)
         VALUES ('M4-approved', '', 'fixed_per_item') RETURNING *`,
      );
      await db.query(
        `INSERT INTO commission_plan_rules (plan_id, scope_type, rate, min_threshold, priority)
         VALUES ($1, 'all', 5, 0, 0)`,
        [plan.id],
      );
      await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id = 1", [plan.id]);

      const { rows: [sale] } = await db.query(
        `INSERT INTO sales (employee_id, outlet_id, total_amount, payment_method, invoice_number, discount_amount)
         VALUES (1, 1, 100, 'Cash', 'M4-0002', 0) RETURNING *`,
      );
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, staff_id)
         VALUES ($1, 1, 1, 100, NULL)`,
        [sale.id],
      );

      await req.post("/api/commissions/calculate").send({ sale_id: sale.id });
      // Approve the earning — payroll has actioned it.
      await db.query(
        "UPDATE commission_earnings SET status = 'approved' WHERE sale_id = $1",
        [sale.id],
      );
      // Recalc: pre-delete only clears 'pending', so the approved row survives
      // and a fresh pending row is added.
      await req.post("/api/commissions/calculate").send({ sale_id: sale.id });

      const { rows: earnings } = await db.query(
        "SELECT status FROM commission_earnings WHERE sale_id = $1 ORDER BY status",
        [sale.id],
      );
      const statuses = earnings.map((e) => e.status);
      expect(statuses).toContain("approved"); // the actioned row is untouched
    });
  });

  // ── M5 ──────────────────────────────────────────────────────────────────
  describe("M5 — PO partial receive", () => {
    it("partial receipt keeps PO open + bills received value; remainder closes it", async () => {
      const { rows: [supplier] } = await db.query(
        `INSERT INTO suppliers (name, payment_terms, credit_days)
         VALUES ('Acme Supply', 'cash', 0) RETURNING id`,
      );
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (supplier_id, status, total_cost, due_date)
         VALUES ($1, 'Approved', 1000, NULL) RETURNING id`,
        [supplier.id],
      );
      await db.query(
        `INSERT INTO purchase_order_items (po_id, product_id, quantity, cost_price)
         VALUES ($1, 1, 100, 10)`,
        [po.id],
      );

      // Receive 60 of 100.
      const r1 = await req
        .post(`/api/purchase-orders/${po.id}/receive`)
        .send({ outlet_id: 1, items: [{ product_id: 1, qty_received: 60 }] });
      expect(r1.status).toBe(200);
      expect(r1.body.fully_received).toBe(false);
      expect(r1.body.message).toMatch(/partial/i);

      // PO stays 'Approved' (receivable) — not force-closed to 'Received'.
      const { rows: [afterPartial] } = await db.query(
        "SELECT status FROM purchase_orders WHERE id = $1",
        [po.id],
      );
      expect(afterPartial.status).toBe("Approved");

      // Supplier invoice books the RECEIVED value (60 × 10 = 600), not 1000.
      const { rows: inv1 } = await db.query(
        "SELECT amount::numeric AS amount FROM supplier_invoices WHERE po_id = $1",
        [po.id],
      );
      expect(inv1).toHaveLength(1);
      expect(Number(inv1[0].amount)).toBe(600);

      // Receive the remaining 40.
      const r2 = await req
        .post(`/api/purchase-orders/${po.id}/receive`)
        .send({ outlet_id: 1, items: [{ product_id: 1, qty_received: 40 }] });
      expect(r2.status).toBe(200);
      expect(r2.body.fully_received).toBe(true);

      const { rows: [afterFull] } = await db.query(
        "SELECT status FROM purchase_orders WHERE id = $1",
        [po.id],
      );
      expect(afterFull.status).toBe("Received");

      // Two invoices now; AP total == received value == po.total_cost.
      const { rows: [agg] } = await db.query(
        "SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS total FROM supplier_invoices WHERE po_id = $1",
        [po.id],
      );
      expect(agg.n).toBe(2);
      expect(Number(agg.total)).toBe(1000); // 600 + 400
    });
  });

  // ── M8 ──────────────────────────────────────────────────────────────────
  describe("M8 — transfer-points writes the loyalty ledger", () => {
    it("moves loyalty_points and records loyalty_transactions, not the wallet ledger", async () => {
      const { rows: [sender] } = await db.query(
        "INSERT INTO customers (name, loyalty_points) VALUES ('M8 Sender', 100) RETURNING id",
      );
      const { rows: [receiver] } = await db.query(
        "INSERT INTO customers (name, loyalty_points) VALUES ('M8 Receiver', 0) RETURNING id",
      );

      const res = await req.post("/api/customers/transfer-points").send({
        from_customer_id: sender.id,
        to_customer_id: receiver.id,
        points: 30,
      });
      expect(res.status).toBe(200);

      const { rows: [s] } = await db.query("SELECT loyalty_points FROM customers WHERE id = $1", [sender.id]);
      const { rows: [r] } = await db.query("SELECT loyalty_points FROM customers WHERE id = $1", [receiver.id]);
      expect(Number(s.loyalty_points)).toBe(70);
      expect(Number(r.loyalty_points)).toBe(30);

      // Loyalty ledger: a redeem row for the sender, an earn row for the receiver.
      const { rows: senderTx } = await db.query(
        "SELECT type, points FROM loyalty_transactions WHERE customer_id = $1 AND reference_type = 'points_transfer'",
        [sender.id],
      );
      expect(senderTx).toHaveLength(1);
      expect(senderTx[0].type).toBe("redeem");
      expect(Number(senderTx[0].points)).toBe(30);

      const { rows: receiverTx } = await db.query(
        "SELECT type, points FROM loyalty_transactions WHERE customer_id = $1 AND reference_type = 'points_transfer'",
        [receiver.id],
      );
      expect(receiverTx).toHaveLength(1);
      expect(receiverTx[0].type).toBe("earn");

      // No wallet-ledger rows written for a points transfer.
      const { rows: [wallet] } = await db.query(
        "SELECT COUNT(*)::int AS n FROM customer_wallet_ledger WHERE reference_type = 'points_transfer'",
      );
      expect(wallet.n).toBe(0);
    });
  });

  // ── V2 ──────────────────────────────────────────────────────────────────
  describe("V2 — perm-path credit override is audited", () => {
    it("all_access override of a HARD block writes an approval_events row", async () => {
      // Deterministic catalog line: product 1 @ 500, no tax.
      await db.query("UPDATE products SET price = 500, tax_id = NULL, gst = 0, category_id = NULL WHERE id = 1");

      const { rows: [cust] } = await db.query(
        `INSERT INTO customers (name, credit_limit, credit_block_mode, payment_terms_days)
         VALUES ('V2 HardMode', 100, 'hard', 30) RETURNING id`,
      );

      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1") // Administrator → all_access
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1,
          employee_id: 1,
          customer_id: cust.id,
          cartItems: [{ id: 1, name: "Item", price: 500, quantity: 1, cost_price: 1 }],
          payments: [{ method: "Credit", amount: 500 }], // over the 100 limit
          idempotency_key: `v2-${cust.id}-${Date.now()}`,
        });
      expect(res.status).toBe(200);

      const { rows: events } = await db.query(
        `SELECT action_type, status, requested_by, approved_by, metadata
         FROM approval_events
         WHERE action_type = 'credit_limit_override'
           AND (metadata->>'customer_id')::int = $1`,
        [cust.id],
      );
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("approved");
      expect(events[0].requested_by).toBe(1);
      expect(events[0].approved_by).toBe(1);
      expect(events[0].metadata.override_method).toBe("permission");
    });
  });

  // ── M9 ──────────────────────────────────────────────────────────────────
  describe("M9 — dunning predicate tests only the LATEST run", () => {
    it("a current-paid subscriber with one OLD unpaid run is NOT cut off", async () => {
      const { checkGracePeriods } = require("../../workers/subscription-grace-worker-boss");
      const logger = { info: () => {}, error: () => {} };

      const { rows: [plan] } = await db.query(
        `INSERT INTO subscription_plans (name, price, billing_interval)
         VALUES ('M9 Plan', 100, 'monthly') RETURNING id`,
      );

      // Subscription A — bug case: an old UNPAID run, latest run PAID.
      const { rows: [subA] } = await db.query(
        `INSERT INTO customer_subscriptions (plan_id, customer_id, status, grace_period_end)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day') RETURNING id`,
        [plan.id],
      );
      const oldUnpaid = await seedRunWithInvoice(subA.id, "M9-A-old", 500, "2026-01-01");
      const newPaid = await seedRunWithInvoice(subA.id, "M9-A-new", 0, "2026-06-01");
      void oldUnpaid; void newPaid;

      // Subscription B — genuinely overdue: latest run UNPAID.
      const { rows: [subB] } = await db.query(
        `INSERT INTO customer_subscriptions (plan_id, customer_id, status, grace_period_end)
         VALUES ($1, 1, 'active', NOW() - INTERVAL '1 day') RETURNING id`,
        [plan.id],
      );
      await seedRunWithInvoice(subB.id, "M9-B", 500, "2026-06-01");

      await checkGracePeriods(db, logger, "test");

      const { rows: [a] } = await db.query("SELECT status FROM customer_subscriptions WHERE id = $1", [subA.id]);
      const { rows: [b] } = await db.query("SELECT status FROM customer_subscriptions WHERE id = $1", [subB.id]);
      expect(a.status).toBe("active"); // current subscriber NOT flagged
      expect(b.status).toBe("past_due"); // genuinely overdue IS flagged
    });

    async function seedRunWithInvoice(subId, invNumber, balanceDue, periodStart) {
      const { rows: [inv] } = await db.query(
        `INSERT INTO customer_invoices (invoice_number, customer_id, status, total_amount, balance_due)
         VALUES ($1, 1, $2, 500, $3) RETURNING id`,
        [invNumber, balanceDue > 0 ? "sent" : "paid", balanceDue],
      );
      await db.query(
        `INSERT INTO subscription_runs (subscription_id, period_start, period_end, invoice_id, status)
         VALUES ($1, $2, ($2::timestamptz + INTERVAL '30 days'), $3, 'invoiced')`,
        [subId, periodStart, inv.id],
      );
      return inv.id;
    }
  });
});
