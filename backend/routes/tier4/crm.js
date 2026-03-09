const express = require("express");
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
    (req, res) => {
      db.all(
        `SELECT l.*, e.name AS assigned_to_name,
            (SELECT COUNT(*) FROM crm_activities a WHERE a.lead_id = l.id) AS activity_count
     FROM crm_leads l
     LEFT JOIN employees e ON e.id = l.assigned_to
     ORDER BY datetime(l.created_at) DESC`,
        [],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ leads: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/crm/leads",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
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
      db.run(
        `INSERT INTO crm_leads
     (name, company, phone, email, source, stage, priority, expected_value, assigned_to, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
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
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Lead created", id: this.lastID });
        },
      );
    },
  );

  router.put(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
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
      db.run(
        `UPDATE crm_leads
     SET name = COALESCE(?, name),
         company = ?,
         phone = ?,
         email = ?,
         source = ?,
         stage = COALESCE(?, stage),
         priority = COALESCE(?, priority),
         expected_value = COALESCE(?, expected_value),
         assigned_to = ?,
         notes = ?,
         updated_at = datetime('now','localtime')
     WHERE id = ?`,
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
        ],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Lead updated", changed: this.changes || 0 });
        },
      );
    },
  );

  router.delete(
    "/api/crm/leads/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.run("DELETE FROM crm_leads WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Lead deleted", changed: this.changes || 0 });
      });
    },
  );

  router.post(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { type = "note", description, employee_id } = req.body || {};
      if (!description)
        return res.status(400).json({ error: "description is required" });
      db.run(
        "INSERT INTO crm_activities (lead_id, employee_id, type, description) VALUES (?, ?, ?, ?)",
        [id, employee_id || null, type, description],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Activity added", id: this.lastID });
        },
      );
    },
  );

  router.get(
    "/api/crm/leads/:id/activities",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.all(
        `SELECT a.*, e.name AS employee_name
     FROM crm_activities a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.lead_id = ?
     ORDER BY datetime(a.created_at) DESC`,
        [id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ activities: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/crm/leads/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get("SELECT * FROM crm_leads WHERE id = ?", [id], (err, lead) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.customer_id) {
          return res.json({
            message: "Lead already converted",
            customer_id: lead.customer_id,
          });
        }
        db.run(
          "INSERT INTO customers (name, mobile, email, address) VALUES (?, ?, ?, ?)",
          [
            lead.name,
            lead.phone || null,
            lead.email || null,
            lead.company || null,
          ],
          function (insErr) {
            if (insErr) return res.status(500).json({ error: insErr.message });
            const customerId = this.lastID;
            db.run(
              "UPDATE crm_leads SET customer_id = ?, stage = 'converted', updated_at = datetime('now','localtime') WHERE id = ?",
              [customerId, id],
              (updErr) => {
                if (updErr)
                  return res.status(500).json({ error: updErr.message });
                res.json({
                  message: "Lead converted",
                  customer_id: customerId,
                });
              },
            );
          },
        );
      });
    },
  );

  // --- QUOTATIONS ---

  router.get(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const {
        status = "",
        customer_id = "",
        from = "",
        to = "",
      } = req.query || {};
      const where = ["1=1"];
      const params = [];
      if (status) {
        where.push("q.status = ?");
        params.push(status);
      }
      if (customer_id) {
        where.push("q.customer_id = ?");
        params.push(customer_id);
      }
      if (from) {
        where.push("date(q.created_at) >= ?");
        params.push(from);
      }
      if (to) {
        where.push("date(q.created_at) <= ?");
        params.push(to);
      }
      db.all(
        `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN crm_leads l ON l.id = q.lead_id
     LEFT JOIN employees e ON e.id = q.employee_id
     LEFT JOIN outlets o ON o.id = q.outlet_id
     WHERE ${where.join(" AND ")}
     ORDER BY datetime(q.created_at) DESC`,
        params,
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ quotations: rows || [] });
        },
      );
    },
  );

  router.post(
    "/api/quotations",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
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
        return res
          .status(400)
          .json({ error: "outlet_id and items are required" });
      }

      const subtotal = items.reduce(
        (sum, item) =>
          sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
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

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          `INSERT INTO quotations
       (quote_number, lead_id, customer_id, outlet_id, employee_id, status, discount_type, discount_amount, subtotal, tax_total, total_amount, valid_until, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
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
          ],
          function (err) {
            if (err) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: err.message });
            }
            const quotationId = this.lastID;
            const stmt = db.prepare(
              `INSERT INTO quotation_items
           (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
            );
            let hasErr = false;
            items.forEach((item) => {
              const qty = Number(item.quantity || 0);
              const unitPrice = Number(item.unit_price || 0);
              const taxRate = Number(item.tax_rate || 0);
              const lineTotal = unitPrice * qty;
              stmt.run(
                quotationId,
                item.product_id,
                item.variant_id || null,
                qty,
                unitPrice,
                taxRate,
                lineTotal,
                (lineErr) => {
                  if (lineErr) hasErr = true;
                },
              );
            });
            stmt.finalize();
            if (hasErr) {
              db.run("ROLLBACK");
              return res
                .status(500)
                .json({ error: "Failed to insert quotation items" });
            }
            db.run("COMMIT", (commitErr) => {
              if (commitErr)
                return res.status(500).json({ error: commitErr.message });
              res.json({
                message: "Quotation created",
                id: quotationId,
                quote_number: quoteNumber,
              });
            });
          },
        );
      });
    },
  );

  router.get(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT q.*, c.name AS customer_name, l.name AS lead_name, e.name AS employee_name, o.name AS outlet_name
     FROM quotations q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN crm_leads l ON l.id = q.lead_id
     LEFT JOIN employees e ON e.id = q.employee_id
     LEFT JOIN outlets o ON o.id = q.outlet_id
     WHERE q.id = ?`,
        [id],
        (err, quotation) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!quotation)
            return res.status(404).json({ error: "Quotation not found" });
          db.all(
            `SELECT qi.*, p.name AS product_name
          FROM quotation_items qi
          JOIN products p ON p.id = qi.product_id
          WHERE qi.quotation_id = ?`,
            [id],
            (itemErr, items) => {
              if (itemErr)
                return res.status(500).json({ error: itemErr.message });
              res.json({ quotation, items: items || [] });
            },
          );
        },
      );
    },
  );

  router.put(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
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
      db.get(
        "SELECT status FROM quotations WHERE id = ?",
        [id],
        (checkErr, row) => {
          if (checkErr)
            return res.status(500).json({ error: checkErr.message });
          if (!row)
            return res.status(404).json({ error: "Quotation not found" });
          if (
            !["draft", "sent"].includes(String(row.status || "").toLowerCase())
          ) {
            return res
              .status(400)
              .json({ error: "Only draft/sent quotations can be edited" });
          }

          const safeItems = Array.isArray(items) ? items : [];
          const subtotal = safeItems.reduce(
            (sum, item) =>
              sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
            0,
          );
          const taxTotal = safeItems.reduce((sum, item) => {
            const line =
              Number(item.unit_price || 0) * Number(item.quantity || 0);
            return sum + (line * Number(item.tax_rate || 0)) / 100;
          }, 0);
          const discount =
            discount_type === "percent"
              ? (subtotal * Number(discount_amount || 0)) / 100
              : Number(discount_amount || 0);
          const total = subtotal + taxTotal - discount;

          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(
              `UPDATE quotations
          SET lead_id = ?, customer_id = ?, outlet_id = ?, employee_id = ?,
              discount_type = ?, discount_amount = ?, subtotal = ?, tax_total = ?, total_amount = ?,
              valid_until = ?, notes = ?, updated_at = datetime('now','localtime')
          WHERE id = ?`,
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
              ],
              (updErr) => {
                if (updErr) {
                  db.run("ROLLBACK");
                  return res.status(500).json({ error: updErr.message });
                }
                db.run(
                  "DELETE FROM quotation_items WHERE quotation_id = ?",
                  [id],
                  (delErr) => {
                    if (delErr) {
                      db.run("ROLLBACK");
                      return res.status(500).json({ error: delErr.message });
                    }
                    const stmt = db.prepare(
                      "INSERT INTO quotation_items (quotation_id, product_id, variant_id, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    );
                    let hasErr = false;
                    safeItems.forEach((item) => {
                      const qty = Number(item.quantity || 0);
                      const unitPrice = Number(item.unit_price || 0);
                      stmt.run(
                        id,
                        item.product_id,
                        item.variant_id || null,
                        qty,
                        unitPrice,
                        Number(item.tax_rate || 0),
                        unitPrice * qty,
                        (insErr) => {
                          if (insErr) hasErr = true;
                        },
                      );
                    });
                    stmt.finalize();
                    if (hasErr) {
                      db.run("ROLLBACK");
                      return res
                        .status(500)
                        .json({ error: "Failed to update quotation items" });
                    }
                    db.run("COMMIT", (commitErr) => {
                      if (commitErr)
                        return res
                          .status(500)
                          .json({ error: commitErr.message });
                      res.json({ message: "Quotation updated" });
                    });
                  },
                );
              },
            );
          });
        },
      );
    },
  );

  router.put(
    "/api/quotations/:id/status",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      const allowed = [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "expired",
        "converted",
      ];
      if (!allowed.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      db.run(
        "UPDATE quotations SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?",
        [status, id],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            message: "Quotation status updated",
            changed: this.changes || 0,
          });
        },
      );
    },
  );

  router.post(
    "/api/quotations/:id/send",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get(
        `SELECT q.*, c.name AS customer_name, c.email AS customer_email
         FROM quotations q
         LEFT JOIN customers c ON c.id = q.customer_id
         WHERE q.id = ?`,
        [id],
        (err, quote) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!quote) return res.status(404).json({ error: "Quotation not found" });

          const toEmail = quote.customer_email;
          if (!toEmail) return res.status(400).json({ error: "Customer has no email address." });

          db.all(
            `SELECT qi.*, p.name AS product_name
             FROM quotation_items qi
             JOIN products p ON p.id = qi.product_id
             WHERE qi.quotation_id = ?`,
            [id],
            (itemErr, items) => {
              if (itemErr) return res.status(500).json({ error: itemErr.message });

              db.get("SELECT * FROM email_config LIMIT 1", [], (cfgErr, cfg) => {
                if (cfgErr) return res.status(500).json({ error: cfgErr.message });
                if (!cfg || !cfg.smtp_host) {
                  return res.status(400).json({ error: "Email not configured. Set up SMTP in Printer Settings." });
                }

                const rowsHtml = (items || []).map((it) =>
                  `<tr>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee">${it.product_name || "—"}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${it.quantity}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">PKRs ${Number(it.unit_price || 0).toFixed(2)}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">PKRs ${Number(it.line_total || 0).toFixed(2)}</td>
                  </tr>`
                ).join("");

                const html = `
                  <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                    <h2 style="color:#1e293b">Quotation #${quote.quote_number || quote.id}</h2>
                    <p>Dear ${quote.customer_name || "Customer"},</p>
                    <p>Please find your quotation details below:</p>
                    <p><strong>Date:</strong> ${quote.created_at ? quote.created_at.split(" ")[0] : "—"}</p>
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
                          <td style="padding:8px 10px;text-align:right;font-weight:bold">PKRs ${Number(quote.total_amount || 0).toFixed(2)}</td>
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

                transporter.sendMail({
                  from: cfg.from_email || cfg.smtp_user,
                  to: toEmail,
                  subject: `Quotation #${quote.quote_number || quote.id} from ${cfg.company_name || "Us"}`,
                  html,
                }, (mailErr) => {
                  if (mailErr) return res.status(500).json({ error: `Failed to send email: ${mailErr.message}` });
                  db.run(
                    "UPDATE quotations SET status = 'sent', updated_at = datetime('now','localtime') WHERE id = ?",
                    [id],
                    (updErr) => {
                      if (updErr) return res.status(500).json({ error: updErr.message });
                      res.json({ success: true, message: `Quotation sent to ${toEmail}` });
                    },
                  );
                });
              });
            },
          );
        },
      );
    },
  );

  router.delete(
    "/api/quotations/:id",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      db.get("SELECT status FROM quotations WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Quotation not found" });
        if (String(row.status || "").toLowerCase() !== "draft") {
          return res
            .status(400)
            .json({ error: "Only draft quotations can be deleted" });
        }
        db.run("DELETE FROM quotations WHERE id = ?", [id], function (delErr) {
          if (delErr) return res.status(500).json({ error: delErr.message });
          res.json({
            message: "Quotation deleted",
            changed: this.changes || 0,
          });
        });
      });
    },
  );

  router.post(
    "/api/quotations/:id/convert",
    requirePerm("manage_orders"),
    requireFeature("crm_quotations"),
    (req, res) => {
      const { id } = req.params;
      const { payment_method = "Cash", employee_id } = req.body || {};
      db.get("SELECT * FROM quotations WHERE id = ?", [id], (err, quote) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!quote)
          return res.status(404).json({ error: "Quotation not found" });
        if (String(quote.status || "").toLowerCase() !== "accepted") {
          return res
            .status(400)
            .json({ error: "Only accepted quotations can be converted" });
        }
        db.all(
          "SELECT * FROM quotation_items WHERE quotation_id = ?",
          [id],
          (itemErr, items) => {
            if (itemErr)
              return res.status(500).json({ error: itemErr.message });
            if (!items || items.length === 0)
              return res.status(400).json({ error: "Quotation has no items" });

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run(
                `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id, customer_id, discount_amount, discount_type, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  Number(quote.total_amount || 0),
                  payment_method,
                  quote.outlet_id || null,
                  employee_id || quote.employee_id || null,
                  quote.customer_id || null,
                  Number(quote.discount_amount || 0),
                  quote.discount_type || "fixed",
                  `Converted from quotation ${quote.quote_number || quote.id}`,
                ],
                function (saleErr) {
                  if (saleErr) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: saleErr.message });
                  }
                  const saleId = this.lastID;
                  const itemStmt = db.prepare(
                    "INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, price_at_sale, cost_price_at_sale) VALUES (?, ?, ?, ?, ?, ?)",
                  );
                  const stockStmt = db.prepare(
                    `UPDATE outlet_stock
               SET quantity = quantity - ?
               WHERE product_id = ? AND outlet_id = ?`,
                  );
                  const payStmt = db.prepare(
                    "INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES (?, ?, ?)",
                  );
                  let hasErr = false;
                  items.forEach((it) => {
                    const qty = Number(it.quantity || 0);
                    itemStmt.run(
                      saleId,
                      it.product_id,
                      it.variant_id || null,
                      qty,
                      Number(it.unit_price || 0),
                      0,
                      (insErr) => {
                        if (insErr) hasErr = true;
                      },
                    );
                    stockStmt.run(
                      qty,
                      it.product_id,
                      quote.outlet_id,
                      (stkErr) => {
                        if (stkErr) hasErr = true;
                      },
                    );
                  });
                  payStmt.run(
                    saleId,
                    payment_method,
                    Number(quote.total_amount || 0),
                    (payErr) => {
                      if (payErr) hasErr = true;
                    },
                  );
                  itemStmt.finalize();
                  stockStmt.finalize();
                  payStmt.finalize();

                  if (hasErr) {
                    db.run("ROLLBACK");
                    return res
                      .status(500)
                      .json({ error: "Failed to convert quotation into sale" });
                  }
                  db.run(
                    "UPDATE quotations SET status = 'converted', converted_sale_id = ?, updated_at = datetime('now','localtime') WHERE id = ?",
                    [saleId, id],
                    (updErr) => {
                      if (updErr) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: updErr.message });
                      }
                      db.run("COMMIT", (commitErr) => {
                        if (commitErr)
                          return res
                            .status(500)
                            .json({ error: commitErr.message });
                        createNotification(
                          "quotation_accepted",
                          "Quotation Converted",
                          `Quotation ${quote.quote_number || id} converted to Sale #${saleId}`,
                          "/sales-history",
                        );
                        res.json({
                          message: "Quotation converted",
                          sale_id: saleId,
                        });
                      });
                    },
                  );
                },
              );
            });
          },
        );
      });
    },
  );

  return router;
};
