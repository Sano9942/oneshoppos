/**
 * backend/routes/customer-invoices.js — Customer invoicing, deposits, reminders.
 *
 * GET    /api/customer-invoices                     — List invoices
 * POST   /api/customer-invoices                     — Create invoice
 * PUT    /api/customer-invoices/:id                 — Update draft invoice
 * POST   /api/customer-invoices/batch               — Batch create
 * POST   /api/customer-invoices/:id/send            — Mark sent + email
 * POST   /api/customer-invoices/:id/payments        — Record payment/deposit
 * POST   /api/customer-invoices/:id/reminders/run   — Manually trigger reminder
 * POST   /api/customer-invoices/from-quotation/:qid — Convert quotation
 * PUT    /api/customer-invoices/:id/void            — Void invoice
 * POST   /api/customer-invoices/:id/payment-link   — Generate payment link
 */

module.exports = function registerCustomerInvoiceRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createInvoiceSchema, batchInvoiceSchema, recordPaymentSchema } = require("../schemas/customer-invoices");
  const {
    generateInvoiceNumber,
    computeInvoiceTotals,
    recomputeBalance,
    convertQuotationToInvoice,
    createBatchInvoices,
    scheduleReminders,
  } = require("../services/customer-invoicing");
  const { enqueueEmail } = require("../services/email");
  const { getBoss } = require("../services/boss");

  const gate = [requireFeature("customer_invoicing"), requirePerm("manage_orders")];

  // Tier 0.2 — when a caller omits due_date on invoice create, derive it from
  // the customer's payment_terms_days (Net X). Returns either an ISO date
  // string (YYYY-MM-DD) when terms are set, or null when terms are 0/missing
  // (COD — caller intent matches). Pre-condition: customer_id exists on the
  // tenant's customers table; bad ids return null without throwing so the
  // upstream INSERT can still report its own foreign-key error.
  async function resolveDueDate(db, customerId, providedDueDate, tz) {
    if (providedDueDate) return providedDueDate;
    if (!customerId) return null;
    try {
      const { rows: [cust] } = await db.query(
        "SELECT payment_terms_days FROM customers WHERE id = $1",
        [customerId]
      );
      const days = Number(cust?.payment_terms_days || 0);
      if (days <= 0) return null;
      // Net-X terms count from the tenant-LOCAL day the invoice was raised,
      // not the UTC day (which lags/leads by the tenant's offset).
      const { tenantToday, addDaysStr } = require("../utils/tz");
      return addDaysStr(tenantToday(tz), days);
    } catch {
      return null;
    }
  }

  // ── List invoices ─────────────────────────────────────────────────────

  app.get("/api/customer-invoices", ...gate, async (req, res) => {
    try {
      const { status, from, to, customer_id } = req.query;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const conditions = [];
      const params = [];
      let idx = 1;

      if (status) {
        conditions.push(`ci.status = $${idx}`);
        params.push(status);
        idx++;
      }
      if (from) {
        conditions.push(`ci.created_at >= $${idx}`);
        params.push(from);
        idx++;
      }
      if (to) {
        conditions.push(`ci.created_at <= $${idx}`);
        params.push(to);
        idx++;
      }
      if (customer_id) {
        conditions.push(`ci.customer_id = $${idx}`);
        params.push(Number(customer_id));
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Overdue is judged against the tenant-local day (CURRENT_DATE is the
      // DB session's day — UTC on prod — flipping invoices at the wrong hour).
      const { tenantToday } = require("../utils/tz");
      const { rows } = await deps.db.query(
        `SELECT ci.*, c.name AS customer_name, c.email AS customer_email,
           CASE WHEN ci.due_date < $${idx + 2}::date AND ci.balance_due > 0 AND ci.status NOT IN ('paid','void','draft') THEN true ELSE false END AS is_overdue
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.id = ci.customer_id
         ${where}
         ORDER BY ci.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset, tenantToday(req.company?.timezone)]
      );

      const { rows: [{ cnt }] } = await deps.db.query(
        `SELECT COUNT(*)::int AS cnt FROM customer_invoices ci ${where}`,
        params
      );

      res.json({ invoices: rows, total: cnt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create invoice ────────────────────────────────────────────────────

  app.post("/api/customer-invoices", ...gate, validate(createInvoiceSchema), async (req, res) => {
    try {
      const { customer_id, items, due_date, notes, outlet_id, discount_amount, reminders } = req.body;
      const totals = computeInvoiceTotals(items, discount_amount);
      const invoiceNumber = await generateInvoiceNumber(deps.db);
      // Tier 0.2 — default due_date from customer.payment_terms_days when
      // the caller omits it. Explicit dates win; 0/missing terms keep null.
      const effectiveDueDate = await resolveDueDate(deps.db, customer_id, due_date, req.company?.timezone);

      const { rows: [invoice] } = await deps.db.query(
        `INSERT INTO customer_invoices
           (invoice_number, customer_id, outlet_id, employee_id, status,
            subtotal, tax_total, discount_amount, total_amount, balance_due, due_date, notes)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $8, $9, $10) RETURNING *`,
        [invoiceNumber, customer_id, outlet_id || null, req.employee.id,
         totals.subtotal, totals.tax_total, discount_amount || 0, totals.total_amount, effectiveDueDate, notes || null]
      );

      for (const item of totals.items) {
        await deps.db.query(
          `INSERT INTO customer_invoice_items (invoice_id, product_id, variant_id, description, quantity, unit_price, tax_rate, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [invoice.id, item.product_id || null, item.variant_id || null, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
        );
      }

      // Schedule reminders if provided and due_date set. tenantSlug is
      // required so each invoice-reminder job carries tenant routing.
      if (reminders && reminders.length > 0 && effectiveDueDate) {
        const boss = await getBoss();
        await scheduleReminders(boss, deps.db, invoice.id, reminders, req.tenantSlug);
      }

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "invoice_created", JSON.stringify({ invoice_id: invoice.id, invoice_number: invoice.invoice_number })]); } catch {}

      res.status(201).json(invoice);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Update draft invoice ──────────────────────────────────────────────

  app.put("/api/customer-invoices/:id", ...gate, validate(createInvoiceSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [existing] } = await deps.db.query("SELECT status FROM customer_invoices WHERE id = $1", [id]);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });
      if (existing.status !== "draft") return res.status(400).json({ error: "Only draft invoices can be edited" });

      const { customer_id, items, due_date, notes, outlet_id, discount_amount } = req.body;
      const totals = computeInvoiceTotals(items, discount_amount);
      // Tier 0.2 — same default-from-payment_terms_days rule as POST.
      const effectiveDueDate = await resolveDueDate(deps.db, customer_id, due_date, req.company?.timezone);

      const { rows: [invoice] } = await deps.db.query(
        `UPDATE customer_invoices SET
           customer_id = $1, outlet_id = $2, subtotal = $3, tax_total = $4,
           discount_amount = $5, total_amount = $6, balance_due = $6,
           due_date = $7, notes = $8, updated_at = NOW()
         WHERE id = $9 RETURNING *`,
        [customer_id, outlet_id || null, totals.subtotal, totals.tax_total,
         discount_amount || 0, totals.total_amount, effectiveDueDate, notes || null, id]
      );

      // Replace items
      await deps.db.query("DELETE FROM customer_invoice_items WHERE invoice_id = $1", [id]);
      for (const item of totals.items) {
        await deps.db.query(
          `INSERT INTO customer_invoice_items (invoice_id, product_id, variant_id, description, quantity, unit_price, tax_rate, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, item.product_id || null, item.variant_id || null, item.description, item.quantity, item.unit_price, item.tax_rate, item.line_total]
        );
      }

      res.json(invoice);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Batch create ──────────────────────────────────────────────────────

  app.post("/api/customer-invoices/batch", ...gate, validate(batchInvoiceSchema), async (req, res) => {
    try {
      const { customer_ids, items, due_date, notes, discount_amount } = req.body;
      // V02 — credit-gate override rides on the caller's permissions; the
      // gate itself runs inside createBatchInvoices under FOR UPDATE.
      const creditOverrideAuthorized =
        Array.isArray(req.employeePerms) &&
        (req.employeePerms.includes("all_access") ||
          req.employeePerms.includes("override_credit_limit"));
      const invoices = await createBatchInvoices(deps.db, {
        customerIds: customer_ids,
        items,
        dueDate: due_date || null,
        discountAmount: discount_amount,
        employeeId: req.employee.id,
        outletId: null,
        creditOverrideAuthorized,
      });
      res.status(201).json({ created: invoices.length, invoices, skipped: invoices.skipped || [] });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Send invoice ──────────────────────────────────────────────────────

  app.post("/api/customer-invoices/:id/send", ...gate, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [invoice] } = await deps.db.query(
        `SELECT ci.*, c.name AS customer_name, c.email AS customer_email
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.id = ci.customer_id
         WHERE ci.id = $1`,
        [id]
      );
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (!invoice.customer_email) return res.status(400).json({ error: "Customer has no email" });

      // Load items for email
      const { rows: items } = await deps.db.query(
        "SELECT * FROM customer_invoice_items WHERE invoice_id = $1 ORDER BY id",
        [id]
      );

      await deps.db.query(
        "UPDATE customer_invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = NOW(), updated_at = NOW() WHERE id = $1",
        [id]
      );

      await enqueueEmail(deps.db, {
        tenantId: req.tenantId || null,
        type: "customer_invoice",
        to: invoice.customer_email,
        tenant: req.tenant,
        data: {
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          company_name: req.company?.company_name || "Our Store",
          items,
          subtotal: invoice.subtotal,
          tax_total: invoice.tax_total,
          discount_amount: invoice.discount_amount,
          total_amount: invoice.total_amount,
          balance_due: invoice.balance_due,
          due_date: invoice.due_date,
          notes: invoice.notes,
        },
      });

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "invoice_sent", JSON.stringify({ invoice_id: Number(id) })]); } catch {}

      res.json({ sent: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Record payment / deposit ──────────────────────────────────────────

  app.post("/api/customer-invoices/:id/payments", ...gate, validate(recordPaymentSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [invoice] } = await deps.db.query("SELECT id, status FROM customer_invoices WHERE id = $1", [id]);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "void") return res.status(400).json({ error: "Cannot record payment on a voided invoice" });

      const { amount, payment_method, payment_type, reference, notes } = req.body;

      const { rows: [payment] } = await deps.db.query(
        `INSERT INTO customer_invoice_payments (invoice_id, amount, payment_method, payment_type, reference, notes, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, amount, payment_method, payment_type, reference || null, notes || null, req.employee.id]
      );

      const balanceInfo = await recomputeBalance(deps.db, Number(id));

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "invoice_payment_recorded", JSON.stringify({ invoice_id: Number(id), amount, payment_type })]); } catch {}

      res.status(201).json({ payment, ...balanceInfo });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Manual reminder trigger ───────────────────────────────────────────

  app.post("/api/customer-invoices/:id/reminders/run", ...gate, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [invoice] } = await deps.db.query(
        `SELECT ci.*, c.email AS customer_email, c.name AS customer_name
         FROM customer_invoices ci
         LEFT JOIN customers c ON c.id = ci.customer_id WHERE ci.id = $1`,
        [id]
      );
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid" || invoice.status === "void") {
        return res.status(400).json({ error: "Invoice is already paid or voided" });
      }
      if (!invoice.customer_email) return res.status(400).json({ error: "Customer has no email" });

      await enqueueEmail(deps.db, {
        tenantId: req.tenantId || null,
        type: "invoice_reminder",
        to: invoice.customer_email,
        tenant: req.tenant,
        data: {
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          company_name: req.company?.company_name || "Our Store",
          balance_due: invoice.balance_due,
          due_date: invoice.due_date,
        },
      });

      res.json({ sent: true });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Convert quotation to invoice ──────────────────────────────────────

  app.post("/api/customer-invoices/from-quotation/:quotationId", ...gate, async (req, res) => {
    try {
      const creditOverrideAuthorized =
        Array.isArray(req.employeePerms) &&
        (req.employeePerms.includes("all_access") ||
          req.employeePerms.includes("override_credit_limit"));
      const invoice = await convertQuotationToInvoice(
        deps.db, Number(req.params.quotationId), req.employee.id,
        { creditOverrideAuthorized }
      );
      res.status(201).json(invoice);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Payment link ───────────────────────────────────────────────────────

  app.post("/api/customer-invoices/:id/payment-link", ...gate, requireFeature("payment_links"), async (req, res) => {
    try {
      const paymentGateway = require("../services/payment-gateway");
      if (!paymentGateway.isEnabled()) {
        return res.status(400).json({ error: "Online payments are not configured. Set PAYMENT_GATEWAY env var." });
      }

      const { id } = req.params;
      const { rows: [invoice] } = await deps.db.query(
        "SELECT * FROM customer_invoices WHERE id = $1",
        [id]
      );
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status === "paid" || invoice.status === "void") {
        return res.status(400).json({ error: "Invoice is already paid or voided" });
      }
      if (Number(invoice.balance_due) <= 0) {
        return res.status(400).json({ error: "No balance due" });
      }

      const crypto = require("crypto");
      const linkToken = crypto.randomBytes(24).toString("hex");
      const amount = Number(invoice.balance_due);
      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.com";

      const { checkout_url, gateway_ref } = await paymentGateway.createInvoiceCheckout({
        invoiceId: invoice.id,
        amount,
        description: `Invoice ${invoice.invoice_number}`,
        returnUrl: `${frontendUrl}/invoice-paid?token=${linkToken}`,
        cancelUrl: `${frontendUrl}/customer-invoices`,
        linkToken,
      });

      const expiresAt = new Date(Date.now() + 7 * 86400000); // 7 days

      const providerName = process.env.PAYMENT_GATEWAY || "manual";
      await deps.db.query(
        `INSERT INTO customer_invoice_payment_links (invoice_id, link_token, gateway_ref, amount, status, expires_at, provider)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [id, linkToken, gateway_ref, amount, expiresAt, providerName]
      );

      res.json({ link_url: checkout_url, link_token: linkToken, expires_at: expiresAt });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Void invoice ──────────────────────────────────────────────────────

  app.put("/api/customer-invoices/:id/void", ...gate, async (req, res) => {
    try {
      // V02 (completion-04 parity): a voided invoice is not exposure — zero
      // balance_due so Σ(balance_due) invariants hold everywhere, matching
      // what the sale-void path writes for its linked AR invoice.
      const { rows: [invoice] } = await deps.db.query(
        "UPDATE customer_invoices SET status = 'void', balance_due = 0, updated_at = NOW() WHERE id = $1 AND status != 'void' RETURNING *",
        [req.params.id]
      );
      if (!invoice) return res.status(404).json({ error: "Invoice not found or already voided" });

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "invoice_voided", JSON.stringify({ invoice_id: invoice.id })]); } catch {}

      res.json(invoice);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
