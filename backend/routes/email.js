/**
 * Email routes — SMTP receipt delivery
 *
 * GET  /api/email/config        — load email_config (password masked)
 * PUT  /api/email/config        — save email_config
 * POST /api/email/test          — send test email to smtp_user
 * POST /api/email/send-receipt  — send HTML receipt to toEmail for a given saleId
 *
 * All endpoints require x-employee-id header (authenticated employee).
 */

const nodemailer = require("nodemailer");
const { buildReceiptEmailHtml } = require("../utils/receiptEmail");

module.exports = function emailRoutes(app, deps) {
  const { db, requirePerm } = deps;

  function authGuard(req, res) {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  async function getConfig() {
    const { rows } = await db.query("SELECT * FROM email_config WHERE id = 1");
    return rows[0] || null;
  }

  function makeTransport(cfg) {
    return nodemailer.createTransport({
      host: cfg.smtp_host,
      port: Number(cfg.smtp_port || 587),
      secure: Number(cfg.smtp_port) === 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    });
  }

  // GET /api/email/config
  app.get("/api/email/config", async (req, res) => {
    if (!authGuard(req, res)) return;
    try {
      const row = await getConfig();
      const cfg = row || {};
      // Never expose raw password
      if (cfg.smtp_pass) cfg.smtp_pass = "*****";
      res.json(cfg);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/email/config
  app.put("/api/email/config", requirePerm("all_access"), async (req, res) => {
    if (!authGuard(req, res)) return;
    try {
      const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name, enabled } =
        req.body || {};

      const updatePass = smtp_pass && smtp_pass !== "*****";

      let sql, params;
      if (updatePass) {
        sql = `UPDATE email_config SET
                 smtp_host = $1, smtp_port = $2, smtp_user = $3, smtp_pass = $4,
                 from_name = $5, enabled = $6
               WHERE id = 1`;
        params = [
          smtp_host || "smtp.gmail.com",
          Number(smtp_port || 587),
          smtp_user || null,
          smtp_pass,
          from_name || "SanoPOS",
          enabled != null ? (enabled ? true : false) : false,
        ];
      } else {
        sql = `UPDATE email_config SET
                 smtp_host = $1, smtp_port = $2, smtp_user = $3,
                 from_name = $4, enabled = $5
               WHERE id = 1`;
        params = [
          smtp_host || "smtp.gmail.com",
          Number(smtp_port || 587),
          smtp_user || null,
          from_name || "SanoPOS",
          enabled != null ? (enabled ? true : false) : false,
        ];
      }

      const { rowCount } = await db.query(sql, params);
      if (rowCount === 0) return res.status(500).json({ error: "Config row missing. Run migrate65.js." });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/email/test
  app.post("/api/email/test", requirePerm("all_access"), async (req, res) => {
    if (!authGuard(req, res)) return;
    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings \u2192 Email." });
      }
      const transport = makeTransport(cfg);
      await transport.sendMail({
        from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
        to: cfg.smtp_user,
        subject: "SanoPOS \u2014 Email Test",
        html: "<p>Email is configured correctly!</p>",
      });
      res.json({ ok: true, message: "Test email sent to " + cfg.smtp_user });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/email/send-receipt
  app.post("/api/email/send-receipt", async (req, res) => {
    if (!authGuard(req, res)) return;
    const { saleId, toEmail } = req.body || {};

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: "Valid email address is required." });
    }
    if (!saleId) return res.status(400).json({ error: "saleId is required." });

    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings \u2192 Email." });
      }

      // Fetch sale + items + payments
      const { rows: saleRows } = await db.query(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name,
                c.name as customer_name
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = $1`,
        [saleId]
      );
      const sale = saleRows[0];
      if (!sale) return res.status(404).json({ error: "Sale not found." });

      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name FROM sale_items si
         JOIN products p ON si.product_id = p.id WHERE si.sale_id = $1`,
        [saleId]
      );

      const { rows: payments } = await db.query(
        "SELECT * FROM sale_payments WHERE sale_id = $1",
        [saleId]
      );

      // Fetch active receipt template (optional)
      let template = null;
      try {
        const { rows: tplRows } = await db.query(
          "SELECT * FROM receipt_templates WHERE is_active = true LIMIT 1"
        );
        template = tplRows[0] || null;
      } catch (_) {
        // template errors are non-fatal — proceed without it
      }

      const html = buildReceiptEmailHtml(
        sale,
        items || [],
        payments || [],
        template,
        req.company?.currency_symbol || "$"
      );

      const transport = makeTransport(cfg);
      await transport.sendMail({
        from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
        to: toEmail,
        subject: `Receipt #${sale.invoice_number || sale.id} from ${cfg.from_name || "SanoPOS"}`,
        html,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
