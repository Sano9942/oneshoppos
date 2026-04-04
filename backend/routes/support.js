const crypto = require("crypto");
const multer = require("multer");
const { uploadToR2 } = require("../utils/r2");
const { sendAlertEmail } = require("../utils/alertEmail");
const { imageFileFilter, safeExtension } = require("../middleware/upload-validation");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: imageFileFilter,
});

module.exports = function supportRoutes(app, deps) {
  const { db } = deps;

  // POST /api/support/tickets — Create a support ticket
  app.post("/api/support/tickets", async (req, res) => {
    try {
      const { type = "bug", message, page_url, browser, screenshots, last_req_id } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ error: "message is required" });
      }

      const employeeId = req.employee?.id;
      const employeeName = req.employee?.name || "Unknown";
      const tenantSlug = req.tenantSlug || "unknown";

      const { rows } = await db.query(
        `INSERT INTO support_tickets (employee_id, type, message, page_url, browser, screenshots, last_req_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          employeeId,
          type,
          message.trim(),
          page_url || null,
          browser || null,
          screenshots ? JSON.stringify(screenshots) : null,
          last_req_id || null,
        ]
      );

      const ticket = rows[0];

      // Fire-and-forget alert email
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      sendAlertEmail({
        subject: `Support Ticket #${ticket.id} — ${esc(type)}`,
        html: `<h2>Support Ticket</h2>
<p><strong>Tenant:</strong> ${esc(tenantSlug)}</p>
<p><strong>Employee:</strong> ${esc(employeeName)}</p>
<p><strong>Type:</strong> ${esc(type)}</p>
<p><strong>Page:</strong> ${esc(page_url || "N/A")}</p>
<p><strong>Request ID:</strong> ${esc(last_req_id || "N/A")}</p>
<p><strong>Message:</strong></p>
<blockquote>${esc(message)}</blockquote>
<p><a href="https://sanopos.com/admin">Open Admin Panel</a></p>`,
      }).catch((err) => {
        req.log?.error({ err }, "Failed to send support ticket alert email");
      });

      // Send confirmation email to submitting employee (fire-and-forget)
      if (req.employee?.email) {
        const { sendEmail } = require("../services/email");
        sendEmail({
          type: "support_received",
          to: req.employee.email,
          data: {
            ticketId: ticket.id,
            type,
            message: message.trim().substring(0, 200),
            storeName: req.company?.company_name || tenantSlug,
          },
        }).catch((err) => {
          req.log?.error({ err }, "Failed to send support ticket confirmation");
        });
      }

      res.status(201).json(ticket);
    } catch (err) {
      req.log?.error({ err }, "Failed to create support ticket");
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/support/upload — Upload a screenshot to R2
  app.post("/api/support/upload", (req, res) => {
    upload.single("file")(req, res, async (multerErr) => {
      if (multerErr) {
        if (multerErr.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 5 MB)" });
        }
        return res.status(400).json({ error: multerErr.message });
      }

      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const ext = safeExtension(file.originalname, file.mimetype);
        const opaqueId = crypto.randomBytes(16).toString("hex");
        const key = `support/${opaqueId}${ext}`;
        const url = await uploadToR2(file.buffer, key, file.mimetype);

        res.json({ filename: file.originalname, url });
      } catch (err) {
        req.log?.error({ err }, "Failed to upload support screenshot");
        res.status(500).json({ error: err.message });
      }
    });
  });

  // GET /api/support/tickets — List own tickets
  app.get("/api/support/tickets", async (req, res) => {
    try {
      const employeeId = req.employee?.id;
      const { rows } = await db.query(
        `SELECT * FROM support_tickets
         WHERE employee_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [employeeId]
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Failed to list support tickets");
      res.status(500).json({ error: err.message });
    }
  });
};
