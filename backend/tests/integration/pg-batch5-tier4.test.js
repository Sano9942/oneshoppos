const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Batch 5 — Tier4 routes (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Register tier4 routes (wires all sub-modules)
    const createTier4Router = require("../../routes/tier4");
    app.use(createTier4Router(deps));

    // ── Seed tier4-specific data ──────────────────────────────

    // Notifications (1 read, 1 unread)
    await db.query(
      `INSERT INTO notifications (id, type, title, message, link, is_read)
       VALUES (1, 'info', 'Test Notification', 'This is a test', '/test', false)`
    );
    await db.query(
      `INSERT INTO notifications (id, type, title, message, link, is_read)
       VALUES (2, 'info', 'Read Notification', 'Already read', '/test2', true)`
    );

    // CRM leads
    await db.query(
      `INSERT INTO crm_leads (id, name, company, phone, email, source, stage, priority, expected_value, assigned_to)
       VALUES (1, 'Lead One', 'Acme Corp', '111-1111', 'lead@acme.com', 'website', 'new', 'high', 5000, 1)`
    );

    // CRM activities
    await db.query(
      `INSERT INTO crm_activities (id, lead_id, employee_id, type, description)
       VALUES (1, 1, 1, 'call', 'Initial contact call')`
    );

    // Quotations
    await db.query(
      `INSERT INTO quotations (id, quote_number, lead_id, customer_id, outlet_id, employee_id, status, subtotal, tax_total, total_amount, discount_type, discount_amount, notes)
       VALUES (1, 'Q-TEST-001', 1, 1, 1, 1, 'draft', 300, 0, 300, 'fixed', 0, 'Test quotation')`
    );
    await db.query(
      `INSERT INTO quotation_items (id, quotation_id, product_id, quantity, unit_price, tax_rate, line_total)
       VALUES (1, 1, 1, 2, 100, 0, 200)`
    );
    await db.query(
      `INSERT INTO quotation_items (id, quotation_id, product_id, quantity, unit_price, tax_rate, line_total)
       VALUES (2, 1, 2, 1, 100, 0, 100)`
    );

    // Leave requests
    await db.query(
      `INSERT INTO leave_requests (id, employee_id, type, start_date, end_date, days, reason, status, approved_by)
       VALUES (1, 1, 'annual', '2026-03-01', '2026-03-02', 2, 'Vacation', 'approved', 1)`
    );

    // Payroll periods
    await db.query(
      `INSERT INTO payroll_periods (id, period_name, start_date, end_date, status, created_by)
       VALUES (1, 'March 2026', '2026-03-01', '2026-03-31', 'draft', 1)`
    );

    // Accounting periods
    await db.query(
      `INSERT INTO accounting_periods (id, period_name, start_date, end_date, status)
       VALUES (1, 'Q1 2026', '2026-01-01', '2026-03-31', 'open')`
    );

    // Expense categories + expenses
    await db.query(`INSERT INTO expense_categories (id, name) VALUES (1, 'Office Supplies')`);
    await db.query(
      `INSERT INTO expenses (id, category_id, amount, description, expense_date, outlet_id, employee_id)
       VALUES (1, 1, 500, 'Paper and pens', CURRENT_DATE, 1, 1)`
    );

    // Purchase order (for approval tests)
    await db.query(
      `INSERT INTO purchase_orders (id, supplier_id, status, total_cost) VALUES (1, 1, 'Draft', 5000)`
    );

    // Transfer (for approval tests)
    await db.query(
      `INSERT INTO inventory_transfers (id, product_id, from_outlet_id, to_outlet_id, quantity, employee_id, status)
       VALUES (1, 1, 1, 2, 5, 1, 'draft')`
    );

    // Sales + sale_items + sale_payments (for accounting tests)
    await db.query(
      `INSERT INTO sales (id, outlet_id, employee_id, customer_id, total_amount, discount_amount, payment_method, voided, timestamp)
       VALUES (1, 1, 1, 1, 1000, 50, 'Cash', false, NOW() - interval '1 hour')`
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, cost_price_at_sale)
       VALUES (1, 1, 5, 200, 60)`
    );
    await db.query(
      `INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (1, 'Cash', 1000)`
    );

    // Returns (for P&L)
    await db.query(
      `INSERT INTO returns (id, original_sale_id, outlet_id, employee_id, total_refund, refund_method, timestamp)
       VALUES (1, 1, 1, 1, 100, 'Cash', NOW() - interval '30 minutes')`
    );
    await db.query(
      `INSERT INTO return_items (return_id, product_id, quantity, refund_price) VALUES (1, 1, 1, 100)`
    );

    // Supplier invoices + payments (for AP tests)
    await db.query(
      `INSERT INTO supplier_invoices (id, supplier_id, invoice_number, amount, status, due_date)
       VALUES (1, 1, 'INV-001', 3000, 'unpaid', CURRENT_DATE - interval '10 days')`
    );
    await db.query(
      `INSERT INTO supplier_payments (id, supplier_invoice_id, supplier_id, amount, payment_method, paid_at)
       VALUES (1, 1, 1, 1000, 'Cash', NOW() - interval '5 days')`
    );

    // Cash shift for balance-sheet (opening_float is the column name in Postgres schema)
    await db.query(
      `INSERT INTO cash_shifts (id, outlet_id, employee_id, status, opened_at, opening_float)
       VALUES (1, 1, 1, 'open', NOW() - interval '2 hours', 10000)`
    );

    // Attendance (for payroll generate)
    await db.query(
      `INSERT INTO employee_attendance (id, employee_id, outlet_id, check_in, check_out)
       VALUES (1, 1, 1, '2026-03-10 09:00:00+00', '2026-03-10 17:00:00+00')`
    );

    // Reset sequences
    for (const [table, maxId] of [
      ["notifications", 2], ["crm_leads", 1], ["crm_activities", 1],
      ["quotations", 1], ["quotation_items", 2], ["leave_requests", 1],
      ["payroll_periods", 1], ["accounting_periods", 1], ["expense_categories", 1],
      ["expenses", 1], ["purchase_orders", 1], ["inventory_transfers", 1],
      ["sales", 1], ["returns", 1], ["supplier_invoices", 1], ["supplier_payments", 1],
      ["cash_shifts", 1], ["employee_attendance", 1],
    ]) {
      await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
    }
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };

  // ── Notifications ──────────────────────────────────────────────────────

  describe("Notifications", () => {
    it("GET /api/notifications — lists all notifications", async () => {
      const res = await request(app).get("/api/notifications").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.notifications.length).toBe(2);
    });

    it("GET /api/notifications?unread_only=1 — lists only unread", async () => {
      const res = await request(app).get("/api/notifications?unread_only=1").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.notifications.length).toBe(1);
      expect(res.body.notifications[0].is_read).toBe(false);
    });

    it("GET /api/notifications/count — returns unread count", async () => {
      const res = await request(app).get("/api/notifications/count").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.unread).toBe(1);
    });

    it("PUT /api/notifications/:id/read — marks one read", async () => {
      const res = await request(app).put("/api/notifications/1/read").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
      // Verify
      const count = await request(app).get("/api/notifications/count").set(authHeaders);
      expect(count.body.unread).toBe(0);
    });

    it("PUT /api/notifications/read-all — marks all read", async () => {
      // Reset one to unread first
      await db.query("UPDATE notifications SET is_read = false WHERE id = 1");
      const res = await request(app).put("/api/notifications/read-all").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.changed).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Company Profile ────────────────────────────────────────────────────

  describe("Company Profile", () => {
    it("GET /api/company-profile — returns profile", async () => {
      const res = await request(app).get("/api/company-profile").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.profile).toBeTruthy();
      expect(res.body.profile.company_name).toBe("Test Store");
    });

    it("PUT /api/company-profile — updates profile", async () => {
      const res = await request(app)
        .put("/api/company-profile")
        .set(authHeaders)
        .send({ company_name: "Updated Store", city: "Karachi" });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("updated");
      // Verify
      const check = await request(app).get("/api/company-profile").set(authHeaders);
      expect(check.body.profile.company_name).toBe("Updated Store");
      expect(check.body.profile.city).toBe("Karachi");
    });
  });

  // ── Approvals ──────────────────────────────────────────────────────────

  describe("Approvals", () => {
    it("POST /api/purchase-orders/:id/submit — submits PO for approval", async () => {
      const res = await request(app)
        .post("/api/purchase-orders/1/submit")
        .set(authHeaders)
        .send({ requested_by: "Hassan", notes: "Please approve" });
      expect(res.status).toBe(200);
      expect(res.body.approval_request_id).toBeTruthy();
    });

    it("GET /api/approvals — lists pending approvals", async () => {
      const res = await request(app).get("/api/approvals").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.approvals.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/purchase-orders/:id/approve — approves PO", async () => {
      const res = await request(app)
        .post("/api/purchase-orders/1/approve")
        .set(authHeaders)
        .send({ action: "approved", action_by: "Hassan", reason: "Looks good" });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("approved");
    });

    it("POST /api/transfers/:id/submit — submits transfer for approval", async () => {
      const res = await request(app)
        .post("/api/transfers/1/submit")
        .set(authHeaders)
        .send({ requested_by: "Hassan" });
      expect(res.status).toBe(200);
      expect(res.body.approval_request_id).toBeTruthy();
    });

    it("POST /api/transfers/:id/approve — approves transfer", async () => {
      const res = await request(app)
        .post("/api/transfers/1/approve")
        .set(authHeaders)
        .send({ action: "approved", action_by: "Hassan", reason: "Approved" });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("approved");
    });

    it("POST /api/purchase-orders/:id/submit — rejects non-Draft PO", async () => {
      const res = await request(app)
        .post("/api/purchase-orders/1/submit")
        .set(authHeaders)
        .send({ requested_by: "Hassan" });
      expect(res.status).toBe(400);
    });
  });

  // ── HR ─────────────────────────────────────────────────────────────────

  describe("HR — Leave", () => {
    it("GET /api/hr/leave — lists leave requests", async () => {
      const res = await request(app).get("/api/hr/leave").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.leave_requests.length).toBeGreaterThanOrEqual(1);
      expect(res.body.leave_requests[0].employee_name).toBeTruthy();
    });

    it("POST /api/hr/leave — creates leave request", async () => {
      const res = await request(app)
        .post("/api/hr/leave")
        .set(authHeaders)
        .send({ employee_id: 2, start_date: "2026-04-01", end_date: "2026-04-03", days: 3, reason: "Family" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });

    it("PUT /api/hr/leave/:id/status — updates leave status", async () => {
      const res = await request(app)
        .put("/api/hr/leave/1/status")
        .set(authHeaders)
        .send({ status: "approved" });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });

    it("PUT /api/hr/leave/:id/status — rejects invalid status", async () => {
      const res = await request(app)
        .put("/api/hr/leave/1/status")
        .set(authHeaders)
        .send({ status: "invalid" });
      expect(res.status).toBe(400);
    });

    it("GET /api/hr/leave/balance — returns leave balance", async () => {
      const res = await request(app)
        .get("/api/hr/leave/balance?month=2026-03")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.balances.length).toBeGreaterThanOrEqual(1);
      expect(res.body.balances[0]).toHaveProperty("monthly_allowance");
      expect(res.body.balances[0]).toHaveProperty("used_this_month");
      expect(res.body.balances[0]).toHaveProperty("remaining");
    });
  });

  describe("HR — Payroll", () => {
    it("GET /api/hr/payroll/periods — lists payroll periods", async () => {
      const res = await request(app).get("/api/hr/payroll/periods").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.periods.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/hr/payroll/periods — creates payroll period", async () => {
      const res = await request(app)
        .post("/api/hr/payroll/periods")
        .set(authHeaders)
        .send({ period_name: "April 2026", start_date: "2026-04-01", end_date: "2026-04-30" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });

    it("POST /api/hr/payroll/periods — rejects missing fields", async () => {
      const res = await request(app)
        .post("/api/hr/payroll/periods")
        .set(authHeaders)
        .send({ period_name: "Bad" });
      expect(res.status).toBe(400);
    });

    it("POST /api/hr/payroll/periods/:id/generate — generates payroll", async () => {
      const res = await request(app)
        .post("/api/hr/payroll/periods/1/generate")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("Payroll generated");
      expect(res.body.lines).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/hr/payroll/periods/:id/lines — returns payroll lines", async () => {
      const res = await request(app)
        .get("/api/hr/payroll/periods/1/lines")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.lines.length).toBeGreaterThanOrEqual(1);
      expect(res.body.lines[0].employee_name).toBeTruthy();
    });

    it("POST /api/hr/payroll/periods/:id/lines — upserts hr_payroll_line", async () => {
      const res = await request(app)
        .post("/api/hr/payroll/periods/1/lines")
        .set(authHeaders)
        .send({ employee_id: 1, base_salary: 50000, deductions: 5000, notes: "Manual override" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });
  });

  // ── CRM ────────────────────────────────────────────────────────────────

  describe("CRM — Leads", () => {
    it("GET /api/crm/leads — lists leads", async () => {
      const res = await request(app).get("/api/crm/leads").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.leads.length).toBeGreaterThanOrEqual(1);
      expect(res.body.leads[0].assigned_to_name).toBeTruthy();
    });

    it("POST /api/crm/leads — creates a lead", async () => {
      const res = await request(app)
        .post("/api/crm/leads")
        .set(authHeaders)
        .send({ name: "Lead Two", company: "Beta Inc", phone: "222-2222", email: "lead2@beta.com", source: "referral" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });

    it("POST /api/crm/leads — rejects missing name", async () => {
      const res = await request(app)
        .post("/api/crm/leads")
        .set(authHeaders)
        .send({ company: "No name" });
      expect(res.status).toBe(400);
    });

    it("PUT /api/crm/leads/:id — updates a lead", async () => {
      const res = await request(app)
        .put("/api/crm/leads/1")
        .set(authHeaders)
        .send({ stage: "qualified", expected_value: 10000 });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });

    it("POST /api/crm/leads/:id/activities — adds activity", async () => {
      const res = await request(app)
        .post("/api/crm/leads/1/activities")
        .set(authHeaders)
        .send({ type: "email", description: "Sent follow-up email", employee_id: 1 });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });

    it("GET /api/crm/leads/:id/activities — lists activities", async () => {
      const res = await request(app).get("/api/crm/leads/1/activities").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/crm/leads/:id/convert — converts lead to customer", async () => {
      const res = await request(app)
        .post("/api/crm/leads/1/convert")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.customer_id).toBeTruthy();
    });

    it("POST /api/crm/leads/:id/convert — returns already converted", async () => {
      const res = await request(app)
        .post("/api/crm/leads/1/convert")
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("already converted");
    });

    it("DELETE /api/crm/leads/:id — deletes a lead", async () => {
      // Create a disposable lead
      const create = await request(app)
        .post("/api/crm/leads")
        .set(authHeaders)
        .send({ name: "Disposable Lead" });
      const res = await request(app)
        .delete(`/api/crm/leads/${create.body.id}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });
  });

  describe("CRM — Quotations", () => {
    it("GET /api/quotations — lists quotations", async () => {
      const res = await request(app).get("/api/quotations").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.quotations.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/quotations — creates quotation with items", async () => {
      const res = await request(app)
        .post("/api/quotations")
        .set(authHeaders)
        .send({
          outlet_id: 1,
          customer_id: 1,
          employee_id: 1,
          items: [
            { product_id: 1, quantity: 3, unit_price: 100, tax_rate: 0 },
            { product_id: 2, quantity: 1, unit_price: 200, tax_rate: 17 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
      expect(res.body.quote_number).toBeTruthy();
    });

    it("POST /api/quotations — rejects missing items", async () => {
      const res = await request(app)
        .post("/api/quotations")
        .set(authHeaders)
        .send({ outlet_id: 1 });
      expect(res.status).toBe(400);
    });

    it("GET /api/quotations/:id — returns quotation with items", async () => {
      const res = await request(app).get("/api/quotations/1").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.quotation).toBeTruthy();
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it("PUT /api/quotations/:id — updates draft quotation", async () => {
      const res = await request(app)
        .put("/api/quotations/1")
        .set(authHeaders)
        .send({
          outlet_id: 1,
          notes: "Updated notes",
          items: [{ product_id: 1, quantity: 5, unit_price: 100, tax_rate: 0 }],
        });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("updated");
    });

    it("PUT /api/quotations/:id/status — updates status", async () => {
      const res = await request(app)
        .put("/api/quotations/1/status")
        .set(authHeaders)
        .send({ status: "sent" });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });

    it("PUT /api/quotations/:id/status — rejects invalid status", async () => {
      const res = await request(app)
        .put("/api/quotations/1/status")
        .set(authHeaders)
        .send({ status: "bogus" });
      expect(res.status).toBe(400);
    });

    it("DELETE /api/quotations/:id — only deletes draft quotations", async () => {
      // Quotation 1 is now 'sent', should fail
      const res = await request(app).delete("/api/quotations/1").set(authHeaders);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("draft");
    });

    it("DELETE /api/quotations/:id — deletes a draft quotation", async () => {
      // Create a fresh draft
      const create = await request(app)
        .post("/api/quotations")
        .set(authHeaders)
        .send({
          outlet_id: 1,
          items: [{ product_id: 1, quantity: 1, unit_price: 50, tax_rate: 0 }],
        });
      const res = await request(app)
        .delete(`/api/quotations/${create.body.id}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });

    it("POST /api/quotations/:id/convert — converts accepted quotation to sale", async () => {
      // Create a new quotation and mark as accepted
      const create = await request(app)
        .post("/api/quotations")
        .set(authHeaders)
        .send({
          outlet_id: 1,
          customer_id: 1,
          employee_id: 1,
          items: [{ product_id: 1, quantity: 2, unit_price: 100, tax_rate: 0 }],
        });
      await db.query("UPDATE quotations SET status = 'accepted' WHERE id = $1", [create.body.id]);

      const res = await request(app)
        .post(`/api/quotations/${create.body.id}/convert`)
        .set(authHeaders)
        .send({ payment_method: "Cash" });
      expect(res.status).toBe(200);
      expect(res.body.sale_id).toBeTruthy();
    });

    it("POST /api/quotations/:id/convert — rejects non-accepted quotation", async () => {
      // Create a draft quotation
      const create = await request(app)
        .post("/api/quotations")
        .set(authHeaders)
        .send({
          outlet_id: 1,
          items: [{ product_id: 1, quantity: 1, unit_price: 50, tax_rate: 0 }],
        });
      const res = await request(app)
        .post(`/api/quotations/${create.body.id}/convert`)
        .set(authHeaders)
        .send({ payment_method: "Cash" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("accepted");
    });
  });

  // ── Accounting ─────────────────────────────────────────────────────────

  describe("Accounting", () => {
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

    it("GET /api/accounting/pnl — returns P&L", async () => {
      const res = await request(app)
        .get(`/api/accounting/pnl?from=${yearAgo}&to=${today}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.revenue).toBeTruthy();
      expect(res.body.revenue.gross_sales).toBeGreaterThan(0);
      expect(res.body).toHaveProperty("cogs");
      expect(res.body).toHaveProperty("net_profit");
    });

    it("GET /api/accounting/pnl — requires from and to", async () => {
      const res = await request(app).get("/api/accounting/pnl").set(authHeaders);
      expect(res.status).toBe(400);
    });

    it("GET /api/accounting/cashflow — returns cashflow", async () => {
      const res = await request(app)
        .get(`/api/accounting/cashflow?from=${yearAgo}&to=${today}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("inflows");
      expect(res.body).toHaveProperty("total_inflows");
      expect(res.body).toHaveProperty("net_cashflow");
    });

    it("GET /api/accounting/cashflow/daily — returns daily cashflow", async () => {
      const res = await request(app)
        .get(`/api/accounting/cashflow/daily?date_from=${yearAgo}&date_to=${today}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("cashflow");
      expect(Array.isArray(res.body.cashflow)).toBe(true);
    });

    it("GET /api/accounting/ap-ar — returns AP/AR summary", async () => {
      const res = await request(app).get("/api/accounting/ap-ar").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("total_ap");
      expect(res.body).toHaveProperty("total_ar");
      expect(res.body).toHaveProperty("net_position");
      expect(res.body.total_ap).toBeGreaterThan(0);
    });

    it("GET /api/accounting/ap — returns AP detail + AR", async () => {
      const res = await request(app).get("/api/accounting/ap").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("supplier_ap");
      expect(res.body).toHaveProperty("customer_ar");
      expect(res.body.supplier_ap.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/accounting/balance-sheet — returns balance sheet", async () => {
      const res = await request(app).get("/api/accounting/balance-sheet").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.assets).toBeTruthy();
      expect(res.body.liabilities).toBeTruthy();
      expect(res.body).toHaveProperty("equity");
      expect(res.body.assets.inventory_value).toBeGreaterThan(0);
      expect(res.body.assets.cash_on_hand).toBeGreaterThan(0);
    });

    it("GET /api/accounting/expenses — returns expense ledger", async () => {
      const res = await request(app).get("/api/accounting/expenses").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.expenses.length).toBeGreaterThanOrEqual(1);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/accounting/ap-aging — returns aging buckets", async () => {
      const res = await request(app).get("/api/accounting/ap-aging").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("buckets");
      expect(res.body).toHaveProperty("totals");
    });

    it("GET /api/accounting/tax-ledger — returns tax ledger", async () => {
      const res = await request(app)
        .get(`/api/accounting/tax-ledger?from=${yearAgo}&to=${today}`)
        .set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("rows");
      expect(res.body).toHaveProperty("total_tax");
    });

    it("GET /api/accounting/supplier-payments — returns supplier payments", async () => {
      const res = await request(app).get("/api/accounting/supplier-payments").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.payments.length).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty("total");
    });

    it("GET /api/accounting/periods — lists accounting periods", async () => {
      const res = await request(app).get("/api/accounting/periods").set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body.periods.length).toBeGreaterThanOrEqual(1);
    });

    it("POST /api/accounting/periods — creates accounting period", async () => {
      const res = await request(app)
        .post("/api/accounting/periods")
        .set(authHeaders)
        .send({ period_name: "Q2 2026", start_date: "2026-04-01", end_date: "2026-06-30" });
      expect(res.status).toBe(200);
      expect(res.body.id).toBeTruthy();
    });

    it("PUT /api/accounting/periods/:id — updates accounting period", async () => {
      const res = await request(app)
        .put("/api/accounting/periods/1")
        .set(authHeaders)
        .send({ status: "closed", notes: "Closed for year-end" });
      expect(res.status).toBe(200);
      expect(res.body.changed).toBe(1);
    });
  });
});
