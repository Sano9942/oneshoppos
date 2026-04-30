const crypto = require("crypto");
const multer = require("multer");
const { uploadToR2 } = require("../utils/r2");
const { sendAlertEmail } = require("../utils/alertEmail");
const { rasterImageFileFilter, safeExtension, verifyImageMagicBytes } = require("../middleware/upload-validation");

// rasterImageFileFilter (not imageFileFilter) — SVG is intentionally rejected
// here. Support uploads are served back from api.sanopos.com same-origin to
// the auth cookie, so an SVG with <script> would XSS into a session-refresh
// fetch. See P31 (Phase 7.11). Product/receipt logo paths still accept SVG
// because sharp rasterises before storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: rasterImageFileFilter,
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

        // P32 — multer's file.mimetype comes from the client multipart envelope
        // and is unverified. Sniff the actual bytes against the claim to block
        // EXE-renamed-jpg, ZIP-as-png, etc. from landing on R2 with an image
        // content-type. Empty files have no magic bytes either, so they fail
        // here too.
        if (!verifyImageMagicBytes(file.buffer, file.mimetype)) {
          return res.status(400).json({ error: "File contents do not match an image format" });
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
