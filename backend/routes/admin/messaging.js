/**
 * Admin messaging — email queue, broadcast, activity logs, security logs,
 * cross-tenant activity, announcements, broadcast history.
 */
module.exports = function registerMessagingRoutes(app, deps) {
  const { db, masterDb, requireAllowedIp, requireSuperAdmin, tenantDbManager, auditLog, logAdminAction } = deps;

  // ── Email Queue ────────────────────────────────────────────────────────
  app.get("/api/admin/email-queue", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { status, limit: lim } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 100, 500);

      let where = "1=1";
      if (status === "pending") where = "eq.sent_at IS NULL AND eq.attempts < eq.max_attempts";
      else if (status === "sent") where = "eq.sent_at IS NOT NULL";
      else if (status === "failed") where = "eq.sent_at IS NULL AND eq.attempts >= eq.max_attempts";

      const { rows } = await db.query(
        `SELECT eq.id, eq.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
                eq.email_type, eq.to_email, eq.subject, eq.from_address,
                eq.send_at, eq.sent_at, eq.error, eq.attempts, eq.max_attempts, eq.created_at
         FROM email_queue eq
         LEFT JOIN tenants t ON t.id = eq.tenant_id
         WHERE ${where}
         ORDER BY eq.id DESC
         LIMIT $1`,
        [limit]
      );

      const { rows: [counts] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts < max_attempts) AS pending,
           COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS sent,
           COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts >= max_attempts) AS failed
         FROM email_queue`
      );

      return res.json({
        emails: rows,
        counts: {
          pending: Number(counts.pending),
          sent: Number(counts.sent),
          failed: Number(counts.failed),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/email-queue/:id/retry", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE email_queue SET attempts = 0, error = NULL WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/email-queue/:id/send-now", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "UPDATE email_queue SET send_at = NOW(), attempts = 0, error = NULL WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_force_sent", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email queued for immediate send" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // NOTE: purge-deleted must be registered BEFORE the :id param route to avoid Express matching "purge-deleted" as :id
  app.delete("/api/admin/email-queue/purge-deleted", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE tenant_id IN (SELECT id FROM tenants WHERE status = 'deleted')"
      );
      logAdminAction(req.admin.email, "email_purge_deleted", "email", null, { count: rowCount }, req.ip);
      return res.json({ message: `Purged ${rowCount} email(s) for deleted tenants` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/email-queue/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        "DELETE FROM email_queue WHERE id = $1 AND sent_at IS NULL",
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already sent" });
      logAdminAction(req.admin.email, "email_deleted", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Broadcast ──────────────────────────────────────────────────────────
  app.post("/api/admin/email/broadcast", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { type, subject, message } = req.body || {};
      if (!type || !["downtime", "announcement"].includes(type)) {
        return res.status(400).json({ error: "type must be 'downtime' or 'announcement'" });
      }
      if (!subject || !message) {
        return res.status(400).json({ error: "subject and message are required" });
      }

      const { rows: tenants } = await masterDb.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active'"
      );

      const { enqueueEmail } = require("../../services/email");
      const dbPg = require("../../db-pg");
      let enqueued = 0;

      for (const t of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(t.id);
          const { rows: [profile] } = await tenantDb.query(
            "SELECT email FROM company_profile WHERE id = 1"
          );
          if (!profile?.email) continue;

          await enqueueEmail(dbPg, {
            tenantId: t.id,
            type,
            to: profile.email,
            data: { subject, message },
          });
          enqueued++;
        } catch (err) {
          console.error(`Broadcast enqueue failed for ${t.slug}:`, err.message);
        }
      }

      await auditLog(null, "broadcast_sent", { type, subject, recipients: enqueued }, `admin:${req.admin.email}`);
      logAdminAction(req.admin.email, "broadcast_sent", "email", null, { subject: req.body.subject, type: req.body.type }, req.ip);

      try {
        await db.query(
          `INSERT INTO broadcast_log (admin_email, broadcast_type, subject, message, recipient_count) VALUES ($1, $2, $3, $4, $5)`,
          [req.admin.email, type, subject, message, enqueued]
        );
      } catch (_) { /* non-critical */ }

      return res.json({ ok: true, enqueued });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Broadcast History ──────────────────────────────────────────────────
  app.get("/api/admin/broadcast-history", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM broadcast_log ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Activity Log ───────────────────────────────────────────────────────
  app.get("/api/admin/activity-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { action, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (action) {
        params.push(action);
        conditions.push(`action = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_activity_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_activity_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Security Log ───────────────────────────────────────────────────────
  app.get("/api/admin/security-log", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { event_type, limit: lim, offset: off } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 50, 200);
      const offset = parseInt(off, 10) || 0;
      const conditions = [];
      const params = [];

      if (event_type) {
        params.push(event_type);
        conditions.push(`event_type = $${params.length}`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await db.query(
        `SELECT * FROM admin_security_log ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) AS count FROM admin_security_log ${where}`,
        params
      );

      return res.json({ entries: rows, total: Number(count) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Cross-Tenant Activity ──────────────────────────────────────────────
  app.get("/api/admin/tenant-activity", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allActivity = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          const { rows } = await tenantDb.query(
            `SELECT action, entity_type, entity_id, details, performed_by, created_at
             FROM action_history ORDER BY created_at DESC LIMIT $1`,
            [Math.ceil(limit / tenants.length) || 10]
          );
          for (const row of rows) {
            allActivity.push({ ...row, tenant_slug: tenant.slug, tenant_name: tenant.name });
          }
        } catch (_) { /* table may not exist */ }
      }

      allActivity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ entries: allActivity.slice(0, limit) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Announcements ──────────────────────────────────────────────────────
  app.get("/api/admin/announcements", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/announcements", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { message, type = "info", ends_at } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });
      if (!["info", "warning", "maintenance"].includes(type)) return res.status(400).json({ error: "Type must be info, warning, or maintenance" });

      const { rows } = await db.query(
        `INSERT INTO announcements (message, type, ends_at, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [message.trim(), type, ends_at || null, req.admin.email]
      );
      logAdminAction(req.admin.email, "announcement_created", "announcement", rows[0].id, { type, message: message.trim().substring(0, 100) }, req.ip);
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/announcements/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { message, type, active, ends_at } = req.body;
      const { rows } = await db.query(
        `UPDATE announcements SET
          message = COALESCE($1, message),
          type = COALESCE($2, type),
          active = COALESCE($3, active),
          ends_at = $4
        WHERE id = $5 RETURNING *`,
        [message, type, active, ends_at !== undefined ? ends_at : null, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/announcements/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM announcements WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Announcement not found" });
      logAdminAction(req.admin.email, "announcement_deleted", "announcement", req.params.id, null, req.ip);
      return res.json({ message: "Announcement deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Public: active announcements (no auth — for tenant dashboards) ─────
  app.get("/api/announcements/active", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, message, type, starts_at, ends_at FROM announcements
         WHERE active = true AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
         ORDER BY created_at DESC LIMIT 5`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
