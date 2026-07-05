const express = require("express");
const kitEngine = require("../../services/kit-engine");
const batchStock = require("../../services/batch-stock");
const nodemailer = require("nodemailer");

// ─── FBR E-INVOICING PLACEHOLDER ───────────────────────────────────────
// When FBR credentials are available, POST sale data to FBR on each sale.
// Required: FBR_API_URL, FBR_CLIENT_ID, FBR_CLIENT_SECRET in .env
// Payload fields: invoice_number, buyer_ntn, items[], total_amount, tax_amount
// Implementation deferred — feature flag: e_invoicing_export
// ────────────────────────────────────────────────────────────────────────

module.exports = function createCRMRouter({
  db,
  requireFeature,
  requirePerm,
  createNotification,
}) {
  const router = express.Router();

  // --- LEADS ---

  router.get(
    "/api/crm/leads",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { rows } = await db.query(
          `SELECT l.*, e.name AS assigned_to_name,
              (SELECT COUNT(*) FROM crm_activities a WHERE a.lead_id = l.id) AS activity_count
           FROM crm_leads l
           LEFT JOIN employees e ON e.id = l.assigned_to
           ORDER BY l.created_at DESC`
        );
        res.json({ leads: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/crm/leads",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const {
          name,
          company,
          phone,
          email,
          source,
          stage = "new",
          priority = "medium",
          expected_value = 0,
          assigned_to,
          notes,
        } = req.body || {};
        if (!name) return res.status(400).json({ error: "name is required" });
        const { rows } = await db.query(
          `INSERT INTO crm_leads
           (name, company, phone, email, source, stage, priority, expected_value, assigned_to, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id`,
          [
            name,
            company || null,
            phone || null,
            email || null,
            source || null,
            stage,
            priority,
            Number(expected_value || 0),
            assigned_to || null,
            notes || null,
          ]
        );
        res.json({ message: "Lead created", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const {
          name,
          company,
          phone,
          email,
          source,
          stage,
          priority,
          expected_value,
          assigned_to,
          notes,
        } = req.body || {};
        const { rowCount } = await db.query(
          `UPDATE crm_leads
           SET name = COALESCE($1, name),
               company = $2,
               phone = $3,
               email = $4,
               source = $5,
               stage = COALESCE($6, stage),
               priority = COALESCE($7, priority),
               expected_value = COALESCE($8, expected_value),
               assigned_to = $9,
               notes = $10,
               updated_at = NOW()
           WHERE id = $11`,
          [
            name || null,
            company || null,
            phone || null,
            email || null,
            source || null,
            stage || null,
            priority || null,
            expected_value !== undefined ? Number(expected_value) : null,
            assigned_to || null,
            notes || null,
            id,
          ]
        );
        res.json({ message: "Lead updated", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.delete(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rowCount } = await db.query("DELETE FROM crm_leads WHERE id = $1", [id]);
        res.json({ message: "Lead deleted", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { type = "note", description, employee_id } = req.body || {};
        if (!description)
          return res.status(400).json({ error: "description is required" });
        const { rows } = await db.query(
          "INSERT INTO crm_activities (lead_id, employee_id, type, description) VALUES ($1, $2, $3, $4) RETURNING id",
          [id, employee_id || null, type, description]
        );
        res.json({ message: "Activity added", id: rows[0].id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows } = await db.query(
          `SELECT a.*, e.name AS employee_name
           FROM crm_activities a
           LEFT JOIN employees e ON e.id = a.employee_id
           WHERE a.lead_id = $1
           ORDER BY a.created_at DESC`,
          [id]
        );
        res.json({ activities: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/crm/leads/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows: leadRows } = await db.query(
          "SELECT * FROM crm_leads WHERE id = $1", [id]
        );
        const lead = leadRows[0];
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.customer_id) {
          return res.json({
            message: "Lead already converted",
            customer_id: lead.customer_id,
          });
        }

        const { rows: custRows } = await db.query(
          "INSERT INTO customers (name, mobile, email, address) VALUES ($1, $2, $3, $4) RETURNING id",
          [lead.name, lead.phone || null, lead.email || null, lead.company || null]
        );
        const customerId = custRows[0].id;

        await db.query(
          "UPDATE crm_leads SET customer_id = $1, stage = 'converted', updated_at = NOW() WHERE id = $2",
          [customerId, id]
        );
        res.json({ message: "Lead converted", customer_id: customerId });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  // --- QUOTATIONS ---

  router.get(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { status = "", customer_id = "", from = "", to = "" } = req.query || {};
        const where = ["1=1"];
        const params = [];
        let idx = 1;
        if (status) {
          where.push(`q.status = $${idx++}`);
          params.push(status);
        }
        if (customer_id) {
          where.push(`q.customer_id = $${idx++}`);
          params.push(customer_id);
        }
        if (from) {
          where.push(`q.created_at::date >= $${idx++}`);
          params.push(from);
        }
        if (to) {
          where.push(`q.created_at::date <= $${idx++}`);
          params.push(to);
        }
        const { rows } = await db.query(
          `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
           FROM quotations q
           LEFT JOIN customers c ON c.id = q.customer_id
           LEFT JOIN crm_leads l ON l.id = q.lead_id
           LEFT JOIN employees e ON e.id = q.employee_id
           LEFT JOIN outlets o ON o.id = q.outlet_id
           WHERE ${where.join(" AND ")}
           ORDER BY q.created_at DESC`,
          params
        );
        res.json({ quotations: rows || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const {
          lead_id,
          customer_id,
          outlet_id,
          employee_id,
          items,
          discount_type = "fixed",
          discount_amount = 0,
          valid_until,
          notes,
        } = req.body || {};
        if (!outlet_id || !items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "outlet_id and items are required" });
        }

        const subtotal = items.reduce(
          (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
          0,
        );
        const taxTotal = items.reduce((sum, item) => {
          const line = Number(item.unit_price || 0) * Number(item.quantity || 0);
          return sum + (line * Number(item.tax_rate || 0)) / 100;
        }, 0);
        const discount =
          discount_type === "percent"
            ? (subtotal * Number(discount_amount || 0)) / 100
            : Number(discount_amount || 0);
        const total = subtotal + taxTotal - discount;
        const quoteNumber = `Q-${Date.now()}`;

        const quotationId = await db.transaction(async (client) => {
          const { rows } = await client.query(
            `INSERT INTO quotations
             (quote_number, lead_id, customer_id, outlet_id, employee_id, status, discount_type, discount_amount, subtotal, tax_total, total_amount, valid_until, notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()) RETURNING id`,
            [
              quoteNumber,
              lead_id || null,
              customer_id || null,
              outlet_id,
              employee_id || null,
              discount_type,
              Number(discount_amount || 0),
              subtotal,
              taxTotal,
              total,
              valid_until || null,
              notes || null,
            ]
          );
          const qId = rows[0].id;

          for (const item of items) {
            const qty = Number(item.quantity || 0);
            const unitPrice = Number(item.unit_price || 0);
            const taxRate = Number(item.tax_rate || 0);
            const lineTotal = unitPrice * qty;
            await client.query(
              `INSERT INTO quotation_items
               (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [qId, item.product_id, item.variant_id || null, qty, unitPrice, taxRate, lineTotal]
            );
          }

          return qId;
        });

        res.json({
          message: "Quotation created",
          id: quotationId,
          quote_number: quoteNumber,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.get(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows: qRows } = await db.query(
          `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
           FROM quotations q
           LEFT JOIN customers c ON c.id = q.customer_id
           LEFT JOIN crm_leads l ON l.id = q.lead_id
           LEFT JOIN employees e ON e.id = q.employee_id
           LEFT JOIN outlets o ON o.id = q.outlet_id
           WHERE q.id = $1`,
          [id]
        );
        const quotation = qRows[0];
        if (!quotation) return res.status(404).json({ error: "Quotation not found" });

        const { rows: items } = await db.query(
          `SELECT qi.*, p.name AS product_name
           FROM quotation_items qi
           JOIN products p ON p.id = qi.product_id
           WHERE qi.quotation_id = $1`,
          [id]
        );
        res.json({ quotation, items: items || [] });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const {
          lead_id,
          customer_id,
          outlet_id,
          employee_id,
          items,
          discount_type = "fixed",
          discount_amount = 0,
          valid_until,
          notes,
        } = req.body || {};

        const { rows: checkRows } = await db.query(
          "SELECT status FROM quotations WHERE id = $1", [id]
        );
        if (!checkRows[0]) return res.status(404).json({ error: "Quotation not found" });
        if (!["draft", "sent"].includes(String(checkRows[0].status || "").toLowerCase())) {
          return res.status(400).json({ error: "Only draft/sent quotations can be edited" });
        }

        const safeItems = Array.isArray(items) ? items : [];
        const subtotal = safeItems.reduce(
          (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
          0,
        );
        const taxTotal = safeItems.reduce((sum, item) => {
          const line = Number(item.unit_price || 0) * Number(item.quantity || 0);
          return sum + (line * Number(item.tax_rate || 0)) / 100;
        }, 0);
        const discount =
          discount_type === "percent"
            ? (subtotal * Number(discount_amount || 0)) / 100
            : Number(discount_amount || 0);
        const total = subtotal + taxTotal - discount;

        await db.transaction(async (client) => {
          await client.query(
            `UPDATE quotations
             SET lead_id = $1, customer_id = $2, outlet_id = $3, employee_id = $4,
                 discount_type = $5, discount_amount = $6, subtotal = $7, tax_total = $8, total_amount = $9,
                 valid_until = $10, notes = $11, updated_at = NOW()
             WHERE id = $12`,
            [
              lead_id || null,
              customer_id || null,
              outlet_id || null,
              employee_id || null,
              discount_type,
              Number(discount_amount || 0),
              subtotal,
              taxTotal,
              total,
              valid_until || null,
              notes || null,
              id,
            ]
          );
          await client.query("DELETE FROM quotation_items WHERE quotation_id = $1", [id]);

          for (const item of safeItems) {
            const qty = Number(item.quantity || 0);
            const unitPrice = Number(item.unit_price || 0);
            await client.query(
              "INSERT INTO quotation_items (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total) VALUES ($1, $2, $3, $4, $5, $6, $7)",
              [id, item.product_id, item.variant_id || null, qty, unitPrice, Number(item.tax_rate || 0), unitPrice * qty]
            );
          }
        });

        res.json({ message: "Quotation updated" });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.put(
    "/api/quotations/:id/status",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body || {};
        const allowed = ["draft", "sent", "accepted", "rejected", "expired", "converted"];
        if (!allowed.includes(status))
          return res.status(400).json({ error: "Invalid status" });
        const { rowCount } = await db.query(
          "UPDATE quotations SET status = $1, updated_at = NOW() WHERE id = $2",
          [status, id]
        );
        res.json({ message: "Quotation status updated", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/quotations/:id/send",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows: qRows } = await db.query(
          `SELECT q.*, c.name AS customer_name, c.email AS customer_email
           FROM quotations q
           LEFT JOIN customers c ON c.id = q.customer_id
           WHERE q.id = $1`,
          [id]
        );
        const quote = qRows[0];
        if (!quote) return res.status(404).json({ error: "Quotation not found" });

        const toEmail = quote.customer_email;
        if (!toEmail) return res.status(400).json({ error: "Customer has no email address." });

        const { rows: items } = await db.query(
          `SELECT qi.*, p.name AS product_name
           FROM quotation_items qi
           JOIN products p ON p.id = qi.product_id
           WHERE qi.quotation_id = $1`,
          [id]
        );

        const { rows: cfgRows } = await db.query("SELECT * FROM email_config LIMIT 1");
        const cfg = cfgRows[0];
        if (!cfg || !cfg.smtp_host) {
          return res.status(400).json({ error: "Email not configured. Set up SMTP in Printer Settings." });
        }

        const createdAtStr = quote.created_at
          ? (typeof quote.created_at === "string" ? quote.created_at.split(" ")[0] : new Date(quote.created_at).toISOString().slice(0, 10))
          : "—";

        const rowsHtml = (items || []).map((it) =>
          `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee">${it.product_name || "—"}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${it.quantity}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${req.company?.currency_symbol || "$"} ${Number(it.unit_price || 0).toFixed(2)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${req.company?.currency_symbol || "$"} ${Number(it.line_total || 0).toFixed(2)}</td>
          </tr>`
        ).join("");

        const html = `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1e293b">Quotation #${quote.quote_number || quote.id}</h2>
            <p>Dear ${quote.customer_name || "Customer"},</p>
            <p>Please find your quotation details below:</p>
            <p><strong>Date:</strong> ${createdAtStr}</p>
            ${quote.valid_until ? `<p><strong>Valid Until:</strong> ${quote.valid_until}</p>` : ""}
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0">Product</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0">Qty</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0">Unit Price</th>
                  <th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0">Total</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td colspan="3" style="padding:8px 10px;text-align:right;font-weight:bold">Grand Total</td>
                  <td style="padding:8px 10px;text-align:right;font-weight:bold">${req.company?.currency_symbol || "$"} ${Number(quote.total_amount || 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
            ${quote.notes ? `<p><em>Notes: ${quote.notes}</em></p>` : ""}
          </div>`;

        const transporter = nodemailer.createTransport({
          host: cfg.smtp_host,
          port: Number(cfg.smtp_port || 587),
          secure: cfg.smtp_port === 465,
          auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
        });

        await transporter.sendMail({
          from: cfg.from_email || cfg.smtp_user,
          to: toEmail,
          subject: `Quotation #${quote.quote_number || quote.id} from ${cfg.company_name || "Us"}`,
          html,
        });

        await db.query(
          "UPDATE quotations SET status = 'sent', updated_at = NOW() WHERE id = $1",
          [id]
        );
        res.json({ success: true, message: `Quotation sent to ${toEmail}` });
      } catch (err) {
        if (err.message && err.message.includes("send")) {
          return res.status(500).json({ error: `Failed to send email: ${err.message}` });
        }
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.delete(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { rows } = await db.query("SELECT status FROM quotations WHERE id = $1", [id]);
        if (!rows[0]) return res.status(404).json({ error: "Quotation not found" });
        if (String(rows[0].status || "").toLowerCase() !== "draft") {
          return res.status(400).json({ error: "Only draft quotations can be deleted" });
        }
        const { rowCount } = await db.query("DELETE FROM quotations WHERE id = $1", [id]);
        res.json({ message: "Quotation deleted", changed: rowCount || 0 });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );

  router.post(
    "/api/quotations/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const { payment_method = "Cash", employee_id } = req.body || {};

        const { rows: qRows } = await db.query(
          "SELECT * FROM quotations WHERE id = $1", [id]
        );
        const quote = qRows[0];
        if (!quote) return res.status(404).json({ error: "Quotation not found" });
        if (String(quote.status || "").toLowerCase() !== "accepted") {
          return res.status(400).json({ error: "Only accepted quotations can be converted" });
        }

        const { rows: items } = await db.query(
          "SELECT * FROM quotation_items WHERE quotation_id = $1", [id]
        );
        if (!items || items.length === 0)
          return res.status(400).json({ error: "Quotation has no items" });

        const saleId = await db.transaction(async (client) => {
          // v83 tax snapshot: the quotation is a price commitment, so the
          // sale carries the QUOTED per-line tax_rate (percent, exclusive
          // math — see the POST /api/quotations handler above) rather than
          // re-resolving live rates, which could make tax_total disagree
          // with the accepted total_amount.
          const { rows: saleRows } = await client.query(
            `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, notes,
               subtotal, tax_total, tax_inclusive)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false) RETURNING id`,
            [
              Number(quote.total_amount || 0),
              payment_method,
              quote.outlet_id || null,
              employee_id || quote.employee_id || null,
              quote.customer_id || null,
              Number(quote.discount_amount || 0),
              quote.discount_type || "fixed",
              `Converted from quotation ${quote.quote_number || quote.id}`,
              Number(quote.subtotal || 0),
              Number(quote.tax_total || 0),
            ]
          );
          const sid = saleRows[0].id;

          for (const it of items) {
            // F01: this convert path decrements outlet_stock without FOR UPDATE
            // (a documented completion-01 concurrency gap — NOT fixed here). It
            // must not process kits: decrementing a kit's own (empty) row would
            // silently oversell components. Hard-reject with a clear message.
            if ((await kitEngine.getBomType(client, it.product_id)) === "kit") {
              throw Object.assign(
                new Error("This quotation contains a kit/bundle product — convert it to a sale at POS instead."),
                { statusCode: 400, code: "kit_not_supported" }
              );
            }
            // F07: this convert path decrements outlet_stock with NO FOR UPDATE
            // (the documented completion-01 concurrency gap). Bolting batch
            // consumption onto an unlocked decrement would race the batch ledger
            // against the total → guaranteed drift. Hard-reject batch-tracked
            // products here (same stance as kits) until the base decrement is
            // hardened; sell them at POS where FEFO consumption is safe.
            if (await batchStock.isTracked(client, it.product_id)) {
              throw Object.assign(
                new Error("This quotation contains a batch/expiry-tracked product — convert it to a sale at POS instead."),
                { statusCode: 400, code: "batch_tracked_not_supported" }
              );
            }
            const qty = Number(it.quantity || 0);
            const lineRate = Number(it.tax_rate || 0);
            const lineTax =
              Math.round(Number(it.unit_price || 0) * qty * lineRate) / 100;
            await client.query(
              "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale, tax_rate_at_sale, tax_amount_at_sale) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
              [sid, it.product_id, it.variant_id || null, qty, Number(it.unit_price || 0), 0, lineRate, lineTax]
            );
            await client.query(
              "UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3",
              [qty, it.product_id, quote.outlet_id]
            );
          }

          await client.query(
            "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, $2, $3)",
            [sid, payment_method, Number(quote.total_amount || 0)]
          );

          await client.query(
            "UPDATE quotations SET status = 'converted', converted_sale_id = $1, updated_at = NOW() WHERE id = $2",
            [sid, id]
          );

          return sid;
        });

        createNotification(
          "quotation_accepted",
          "Quotation Converted",
          `Quotation ${quote.quote_number || id} converted to Sale #${saleId}`,
          "/sales-history",
        );
        res.json({ message: "Quotation converted", sale_id: saleId });
      } catch (err) {
        // Honor guarded rejections (kit / batch-tracked products throw a 400 with
        // a code) instead of masking every guard as a generic 500.
        res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
      }
    },
  );

  return router;
};
