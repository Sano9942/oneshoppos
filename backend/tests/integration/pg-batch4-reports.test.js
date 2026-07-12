const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 4 — Reports routes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Register dependency routes needed by reports
    require("../../routes/sales")(app, deps);
    require("../../routes/returns")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/products")(app, deps);
    require("../../routes/inventory")(app, deps);
    require("../../routes/attendance")(app, deps);

    // Register reports routes (wires all sub-modules)
    require("../../routes/reports")(app, deps);

    // ── Seed report-specific data ──────────────────────────────
    // Open a shift
    await db.query(
      `INSERT INTO cash_shifts (id, outlet_id, employee_id, status, opened_at, opening_float)
       VALUES (1, 1, 1, 'open', NOW() - interval '2 hours', 5000)`
    );

    // Create sales
    for (let i = 1; i <= 5; i++) {
      await db.query(
        `INSERT INTO sales (id, outlet_id, employee_id, customer_id, total_amount,
           discount_amount, payment_method, voided, shift_id, timestamp)
         VALUES ($1, 1, 1, $2, $3, 0, $4, false, 1, NOW() - interval '1 hour' + make_interval(mins => $5))`,
        [i, i <= 2 ? 1 : null, i * 100, i % 2 === 0 ? "Cash" : "Card", i]
      );
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
         VALUES ($1, $2, $3, $4, $5)`,
        [i, (i % 5) + 1, i, (i % 5 + 1) * 20, (i % 5 + 1) * 10]
      );
    }

    // Sale payments
    await db.query(`INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (1, 'Cash', 100)`);
    await db.query(`INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (2, 'Card', 200)`);

    // A voided sale
    await db.query(
      `INSERT INTO sales (id, outlet_id, employee_id, total_amount, discount_amount, payment_method, voided, shift_id, timestamp)
       VALUES (6, 1, 1, 150, 0, 'Cash', true, 1, NOW() - interval '30 minutes')`
    );

    // A return
    await db.query(
      `INSERT INTO returns (id, original_sale_id, outlet_id, employee_id, total_refund, refund_method, shift_id, timestamp)
       VALUES (1, 1, 1, 1, 50, 'Cash', 1, NOW() - interval '20 minutes')`
    );
    await db.query(
      `INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (1, 1, 1, 50)`
    );

    // Attendance session for staff reports
    await db.query(
      `INSERT INTO attendance_sessions (id, employee_id, outlet_id, session_type, session_start, duration_hours)
       VALUES (1, 1, 1, 'work', NOW() - interval '8 hours', 8.0)`
    );

    // An expense
    await db.query(`INSERT INTO expense_categories (id, name) VALUES (1, 'Office Supplies')`);
    await db.query(
      `INSERT INTO expenses (id, category_id, amount, description, expense_date, outlet_id, employee_id)
       VALUES (1, 1, 500, 'Paper', CURRENT_DATE, 1, 1)`
    );

    // A GRN for purchasing reports
    await db.query(
      `INSERT INTO purchase_orders (id, supplier_id, status, total_cost) VALUES (1, 1, 'received', 5000)`
    );
    await db.query(
      `INSERT INTO goods_received_notes (id, grn_number, po_id, outlet_id, received_by, received_at)
       VALUES (1, 'GRN-0001', 1, 1, 1, NOW())`
    );
    await db.query(
      `INSERT INTO grn_items (grn_id, product_id, qty_ordered, qty_received, cost_price) VALUES (1, 1, 10, 10, 50)`
    );

    // Supplier invoice + payment for finance
    await db.query(
      `INSERT INTO supplier_invoices (id, supplier_id, po_id, grn_id, invoice_number, amount, status)
       VALUES (1, 1, 1, 1, 'INV-001', 5000, 'paid')`
    );
    await db.query(
      `INSERT INTO supplier_payments (id, supplier_invoice_id, supplier_id, amount, payment_method, paid_at)
       VALUES (1, 1, 1, 5000, 'Bank Transfer', NOW())`
    );

    // Stock adjustment for inventory reports
    await db.query(
      `INSERT INTO stock_adjustments (id, product_id, outlet_id, quantity_change, reason, employee_id, timestamp)
       VALUES (1, 1, 1, -5, 'Damaged', 1, NOW())`
    );

    // Inventory transfer
    await db.query(
      `INSERT INTO inventory_transfers (id, product_id, from_outlet_id, to_outlet_id, quantity, status, employee_id, timestamp)
       VALUES (1, 1, 1, 2, 3, 'completed', 1, NOW())`
    );

    // Enable reports_scheduled_exports feature flag for governance tests
    await db.query(`UPDATE feature_flags SET enabled = true WHERE key = 'reports_scheduled_exports'`);

    // Report schedule for governance
    await db.query(
      `INSERT INTO report_schedules (id, name, report_key, frequency, recipient, is_active, created_by)
       VALUES (1, 'Sales Summary', 'sales-summary', 'daily', 'console', true, 1)`
    );

    // Saved view
    await db.query(
      `INSERT INTO saved_report_views (id, report_key, name, filters_json, employee_id)
       VALUES (1, 'sales-summary', 'My View', '{}', 1)`
    );

    // Reset sequences for seeded data
    for (const [table, maxId] of [
      ["cash_shifts", 1], ["sales", 6], ["returns", 1],
      ["attendance_sessions", 1], ["expense_categories", 1], ["expenses", 1],
      ["purchase_orders", 1], ["goods_received_notes", 1],
      ["supplier_invoices", 1], ["supplier_payments", 1],
      ["stock_adjustments", 1], ["inventory_transfers", 1],
      ["report_schedules", 1], ["saved_report_views", 1],
    ]) {
      await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
    }
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // ─── DASHBOARD ───────────────────────────────────────────

  describe("dashboard", () => {
    it("GET /api/reports/dashboard returns summary data", async () => {
      const res = await request(app)
        .get("/api/reports/dashboard")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalRevenueToday");
      expect(res.body).toHaveProperty("saleCount");
      expect(res.body).toHaveProperty("topProducts");
    }, 15000);

    it("GET /api/reports/dashboard accepts outlet_id filter", async () => {
      const res = await request(app)
        .get("/api/reports/dashboard?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalRevenueToday");
    }, 15000);
  });

  // ─── SHIFTS ──────────────────────────────────────────────

  describe("shifts", () => {
    it("GET /api/reports/cash-flow returns shift records", async () => {
      const res = await request(app)
        .get("/api/reports/cash-flow")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.sessions).toBeDefined();
      expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/reports/cash-audit returns transactions for a shift", async () => {
      const res = await request(app)
        .get("/api/reports/cash-audit?session_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.audit).toBeDefined();
      expect(res.body.shift).toBeDefined();
    });

    it("GET /api/reports/cash-audit requires session_id", async () => {
      const res = await request(app)
        .get("/api/reports/cash-audit")
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });

    it("GET /api/reports/shift-summary returns totals for a shift", async () => {
      const res = await request(app)
        .get("/api/reports/shift-summary?session_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary).toHaveProperty("total_sales");
    });

    it("GET /api/reports/shift-sales returns sales for a shift", async () => {
      const res = await request(app)
        .get("/api/reports/shift-sales?session_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.sales).toBeDefined();
      expect(res.body.sales.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/reports/payment-summary returns payment breakdown", async () => {
      const res = await request(app)
        .get("/api/reports/payment-summary?session_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.payments).toBeDefined();
    });

    it("GET /api/reports/all-denominations returns denomination data", async () => {
      const res = await request(app)
        .get("/api/reports/all-denominations")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.denominations).toBeDefined();
    });

    it("GET /api/reports/current-session-zreport returns Z-report", async () => {
      const res = await request(app)
        .get("/api/reports/current-session-zreport?session_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.zReport).toBeDefined();
      expect(res.body.shift).toBeDefined();
    });
  });

  // ─── SALES REPORTS ───────────────────────────────────────

  describe("sales reports", () => {
    it("GET /api/reports/sales-summary returns summary", async () => {
      const res = await request(app)
        .get("/api/reports/sales-summary")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("daily_sales");
      expect(res.body).toHaveProperty("payment_methods");
    });

    it("GET /api/reports/item-wise returns product breakdown", async () => {
      const res = await request(app)
        .get("/api/reports/item-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/category-wise returns category breakdown", async () => {
      const res = await request(app)
        .get("/api/reports/category-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/brand-wise returns brand breakdown", async () => {
      const res = await request(app)
        .get("/api/reports/brand-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/customer-wise returns customer breakdown", async () => {
      const res = await request(app)
        .get("/api/reports/customer-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/top-salespeople returns top sellers", async () => {
      const res = await request(app)
        .get("/api/reports/top-salespeople")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/order-wise returns order data", async () => {
      const res = await request(app)
        .get("/api/reports/order-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/monthly-mop-matrix returns payment matrix", async () => {
      const res = await request(app)
        .get("/api/reports/monthly-mop-matrix")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/sales-detail returns detailed sales", async () => {
      const res = await request(app)
        .get("/api/reports/sales-detail")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/refunds-voids returns refund/void data", async () => {
      const res = await request(app)
        .get("/api/reports/refunds-voids")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/cashier-wise returns cashier data", async () => {
      const res = await request(app)
        .get("/api/reports/cashier-wise")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/product-performance returns perf data", async () => {
      const res = await request(app)
        .get("/api/reports/product-performance")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("supports date range filters", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/reports/sales-summary?date_from=${today}&date_to=${today}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("supports outlet_id filter", async () => {
      const res = await request(app)
        .get("/api/reports/sales-summary?outlet_id=1")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── INVENTORY REPORTS ───────────────────────────────────

  describe("inventory reports", () => {
    it("GET /api/reports/inventory-dump returns stock data", async () => {
      const res = await request(app)
        .get("/api/reports/inventory-dump")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/on-hand returns on-hand stock", async () => {
      const res = await request(app)
        .get("/api/reports/on-hand")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/sales-stock returns sales vs stock", async () => {
      const res = await request(app)
        .get("/api/reports/sales-stock")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/dead-stock returns dead stock items", async () => {
      const res = await request(app)
        .get("/api/reports/dead-stock")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/product-movement returns movement data", async () => {
      const res = await request(app)
        .get("/api/reports/product-movement")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/forecast-demand returns forecast", async () => {
      const res = await request(app)
        .get("/api/reports/forecast-demand")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/shrinkage returns shrinkage report", async () => {
      const res = await request(app)
        .get("/api/reports/shrinkage")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/inventory-loss returns loss data", async () => {
      const res = await request(app)
        .get("/api/reports/inventory-loss")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── ANALYTICS ───────────────────────────────────────────

  describe("analytics", () => {
    it("GET /api/reports/comparative-trends returns trends", async () => {
      const res = await request(app)
        .get("/api/reports/comparative-trends")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
    });

    it("GET /api/reports/heatmaps returns heatmap data", async () => {
      const res = await request(app)
        .get("/api/reports/heatmaps")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("heatmap");
    });

    it("GET /api/reports/customer-rfm returns RFM data", async () => {
      const res = await request(app)
        .get("/api/reports/customer-rfm")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/product-mix returns product mix", async () => {
      const res = await request(app)
        .get("/api/reports/product-mix")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/revenue-leaks returns leak data", async () => {
      const res = await request(app)
        .get("/api/reports/revenue-leaks")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/outlet-comparison returns outlet data", async () => {
      const res = await request(app)
        .get("/api/reports/outlet-comparison")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── FINANCE ─────────────────────────────────────────────

  describe("finance", () => {
    it("GET /api/reports/settlement-overview returns settlement data", async () => {
      const res = await request(app)
        .get("/api/reports/settlement-overview")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/gst-output returns tax data", async () => {
      const res = await request(app)
        .get("/api/reports/gst-output")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/payables-receivables returns P/R data", async () => {
      const res = await request(app)
        .get("/api/reports/payables-receivables")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/supplier-payments-invoices returns payment data", async () => {
      const res = await request(app)
        .get("/api/reports/supplier-payments-invoices")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/finance-payment-mix returns payment mix", async () => {
      const res = await request(app)
        .get("/api/reports/finance-payment-mix")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── PURCHASING ──────────────────────────────────────────

  describe("purchasing", () => {
    it("GET /api/reports/total-purchases returns purchase data", async () => {
      const res = await request(app)
        .get("/api/reports/total-purchases")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("items");
    });

    it("GET /api/reports/itemwise-purchases returns item purchase data", async () => {
      const res = await request(app)
        .get("/api/reports/itemwise-purchases")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/procurement-parity returns parity data", async () => {
      const res = await request(app)
        .get("/api/reports/procurement-parity")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/purchase-orders-report returns PO report", async () => {
      const res = await request(app)
        .get("/api/reports/purchase-orders-report")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/po-workflow returns workflow data", async () => {
      const res = await request(app)
        .get("/api/reports/po-workflow")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── STAFF ───────────────────────────────────────────────

  describe("staff", () => {
    it("GET /api/reports/labor-performance returns staff data", async () => {
      const res = await request(app)
        .get("/api/reports/labor-performance")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.labor_performance).toBeDefined();
    });

    it("GET /api/reports/loss-prevention returns risk data", async () => {
      const res = await request(app)
        .get("/api/reports/loss-prevention")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.loss_prevention).toBeDefined();
    });

    it("labor-performance supports date and outlet filters", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/reports/labor-performance?date_from=${today}&date_to=${today}&outlet_id=1`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── GOVERNANCE ──────────────────────────────────────────

  describe("governance", () => {
    it("GET /api/reports/schedules returns schedules", async () => {
      const res = await request(app)
        .get("/api/reports/schedules")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.schedules).toBeDefined();
      expect(res.body.schedules.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/reports/schedules creates a schedule", async () => {
      const res = await request(app)
        .post("/api/reports/schedules")
        .set("x-employee-id", "1")
        .send({
          name: "Inventory Summary",
          report_key: "inventory-summary",
          frequency: "weekly",
          recipient: "console",
        });
      expect([200, 201]).toContain(res.status);
      expect(res.body.schedule).toBeDefined();
      expect(res.body.schedule.id).toBeDefined();
    });

    it("PUT /api/reports/schedules/:id updates a schedule", async () => {
      const res = await request(app)
        .put("/api/reports/schedules/1")
        .set("x-employee-id", "1")
        .send({ name: "Updated Sales Summary", frequency: "weekly" });
      expect(res.status).toBe(200);
    });

    it("DELETE /api/reports/schedules/:id deletes a schedule", async () => {
      const createRes = await request(app)
        .post("/api/reports/schedules")
        .set("x-employee-id", "1")
        .send({ name: "Temp", report_key: "temp-schedule", frequency: "daily", recipient: "console" });
      const id = createRes.body.schedule.id;
      const res = await request(app)
        .delete(`/api/reports/schedules/${id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });

    it("GET /api/reports/saved-views returns views", async () => {
      const res = await request(app)
        .get("/api/reports/saved-views")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.views).toBeDefined();
    });

    it("POST /api/reports/saved-views creates a view", async () => {
      const res = await request(app)
        .post("/api/reports/saved-views")
        .set("x-employee-id", "1")
        .send({ report_key: "sales-by-product", name: "Top Products View", filters: { outlet_id: 1 } });
      expect([200, 201]).toContain(res.status);
      expect(res.body.view).toBeDefined();
    });

    it("DELETE /api/reports/saved-views/:id deletes a view", async () => {
      const createRes = await request(app)
        .post("/api/reports/saved-views")
        .set("x-employee-id", "1")
        .send({ report_key: "temp-view", name: "Temp View", filters: {} });
      const id = createRes.body.view.id;
      const res = await request(app)
        .delete(`/api/reports/saved-views/${id}`)
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
    });
  });

  // ─── PERMISSION GATING ──────────────────────────────────

  describe("permission gating", () => {
    it("reports accessible with view_sales_reports perm", async () => {
      // Employee 3 is Cashier with view_sales_reports
      const res = await request(app)
        .get("/api/reports/sales-summary")
        .set("x-employee-id", "3");
      expect(res.status).toBe(200);
    });

    it("reports blocked without auth", async () => {
      const res = await request(app).get("/api/reports/sales-summary");
      expect(res.status).toBe(403);
    });
  });
});
