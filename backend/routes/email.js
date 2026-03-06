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

module.exports = function emailRoutes(app, deps) {
  const { db } = deps;
  const nodemailer = require("nodemailer");
  const { buildReceiptEmailHtml } = require("../utils/receiptEmail");

  function authGuard(req, res) {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  function getConfig(cb) {
    db.get("SELECT * FROM email_config WHERE id = 1", cb);
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
  app.get("/api/email/config", (req, res) => {
    if (!authGuard(req, res)) return;
    getConfig((err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      const cfg = row || {};
      // Never expose raw password
      if (cfg.smtp_pass) cfg.smtp_pass = "*****";
      res.json(cfg);
    });
  });

  // PUT /api/email/config
  app.put("/api/email/config", (req, res) => {
    if (!authGuard(req, res)) return;
    const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name, enabled } =
      req.body || {};

    // Only update smtp_pass if a real value is provided (not masked placeholder)
    const passClause = smtp_pass && smtp_pass !== "*****"
      ? ", smtp_pass = ?"
      : "";
    const params = [
      smtp_host || "smtp.gmail.com",
      Number(smtp_port || 587),
      smtp_user || null,
      from_name || "OneShopPOS",
      enabled ? 1 : 0,
    ];
    if (passClause) params.splice(3, 0, smtp_pass); // insert before from_name

    db.run(
      `UPDATE email_config SET
         smtp_host = ?, smtp_port = ?, smtp_user = ?${passClause},
         from_name = ?, enabled = ?
       WHERE id = 1`,
      params,
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      }
    );
  });

  // POST /api/email/test
  app.post("/api/email/test", async (req, res) => {
    if (!authGuard(req, res)) return;
    getConfig(async (err, cfg) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }
      try {
        const transport = makeTransport(cfg);
        await transport.sendMail({
          from: `"${cfg.from_name || "OneShopPOS"}" <${cfg.smtp_user}>`,
          to: cfg.smtp_user,
          subject: "OneShopPOS — Email Test",
          html: "<p>Email is configured correctly!</p>",
        });
        res.json({ ok: true, message: "Test email sent to " + cfg.smtp_user });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });

  // POST /api/email/send-receipt
  app.post("/api/email/send-receipt", async (req, res) => {
    if (!authGuard(req, res)) return;
    const { saleId, toEmail } = req.body || {};

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: "Valid email address is required." });
    }
    if (!saleId) return res.status(400).json({ error: "saleId is required." });

    getConfig(async (err, cfg) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }

      // Fetch sale + items + payments
      db.get(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name,
                c.name as customer_name
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = ?`,
        [saleId],
        (err, sale) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!sale) return res.status(404).json({ error: "Sale not found." });

          db.all(
            `SELECT si.*, p.name as product_name FROM sale_items si
             JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?`,
            [saleId],
            (err, items) => {
              if (err) return res.status(500).json({ error: err.message });

              db.all(
                "SELECT * FROM sale_payments WHERE sale_id = ?",
                [saleId],
                async (err, payments) => {
                  if (err) return res.status(500).json({ error: err.message });

                  // Fetch active receipt template (optional)
                  db.get(
                    "SELECT * FROM receipt_templates WHERE is_active = 1 LIMIT 1",
                    async (err, template) => {
                      // template errors are non-fatal — proceed without it
                      const html = buildReceiptEmailHtml(
                        sale,
                        items || [],
                        payments || [],
                        template || null
                      );

                      try {
                        const transport = makeTransport(cfg);
                        await transport.sendMail({
                          from: `"${cfg.from_name || "OneShopPOS"}" <${cfg.smtp_user}>`,
                          to: toEmail,
                          subject: `Receipt #${sale.invoice_number || sale.id} from ${cfg.from_name || "OneShopPOS"}`,
                          html,
                        });
                        res.json({ ok: true });
                      } catch (e) {
                        res.status(500).json({ error: e.message });
                      }
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
};
