/**
 * Admin messaging — email queue, broadcast, activity logs, security logs,
 * cross-tenant activity, announcements, broadcast history.
 */
const { validate } = require("../../middleware/validate");
const { CreateAnnouncementSchema } = require("../../schemas/admin");

module.exports = function registerMessagingRoutes(app, deps) {
  const { db, masterDb, requireSuperAdmin, tenantDbManager, auditLog, logAdminAction } = deps;

  // ── Targeted-announcement audience helpers ─────────────────────────────
  // audience_plan / audience_industry are NULL (= everyone) or a comma-separated
  // list of plans (free/pro) / industry presets. "all" and empty normalize to NULL.
  function normalizeAudience(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim().toLowerCase();
    if (!s || s === "all") return null;
    const list = s.split(",").map((x) => x.trim()).filter(Boolean);
    return list.length ? list.join(",") : null;
  }
  function audienceMatches(csv, val) {
    if (!csv) return true; // NULL/empty = everyone
    const list = csv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    return val != null && list.includes(String(val).toLowerCase());
  }
  // Resolve a caller's plan (registry) + industry (tenant company_profile) from
  // its slug, cached 60s. The /active endpoint is public and mounted before
  // tenant middleware, so it can't lean on req.company — it gets ?tenant=<slug>.
  const _audienceCache = new Map(); // slug -> { plan, industry, at }
  async function resolveAudience(slug) {
    if (!/^[a-z0-9_]{3,40}$/.test(slug)) return null;
    const cached = _audienceCache.get(slug);
    if (cached && Date.now() - cached.at < 60000) return cached;
    let plan = null, industry = null;
    try {
      const { rows: [t] } = await db.query("SELECT plan FROM tenants WHERE slug = $1", [slug]);
      if (!t) return null;
      plan = t.plan || null;
      try {
        const { rows: [cp] } = await db.query(`SELECT industry_type FROM tenant_${slug}.company_profile WHERE id = 1`);
        industry = cp ? cp.industry_type : null;
      } catch (_) { /* schema/table may be absent — leave industry null */ }
    } catch (_) { return null; }
    const val = { plan, industry, at: Date.now() };
    _audienceCache.set(slug, val);
    return val;
  }

  // ── Email Queue (pg-boss backed) ───────────────────────────────────────
  // Reads `pgboss.job WHERE name = 'email'`, the live queue. The legacy
  // `public.email_queue` table is no longer written to by enqueueEmail()
  // — pg-boss is the durable queue for all transactional email since
  // commit 38b6d73 ("fix(workers): route email-worker-boss jobs through
  // tenant context"). This endpoint returns the same row shape the
  // existing AdminEmails.jsx expects (id, email_type, to_email, subject,
  // tenant_slug, tenant_name, attempts, max_attempts, sent_at, send_at,
  // created_at, error) so no frontend changes are needed.
  //
  // pg-boss state mapping:
  //   created/retry  → pending  (sent_at NULL, attempts < max_attempts)
  //   active         → pending  (in flight)
  //   completed      → sent     (sent_at = completed_on)
  //   failed         → failed   (attempts >= max_attempts, error from output)
  //   cancelled      → failed   (rare; treat like failed for UI)
  //
  // Job IDs are UUIDs (strings); the route accepts string IDs throughout.
  const EMAIL_SELECT_SQL = `
    SELECT j.id,
           (j.data->>'tenantId')::int AS tenant_id,
           t.slug AS tenant_slug,
           t.name AS tenant_name,
           j.data->>'type' AS email_type,
           j.data->>'to'   AS to_email,
           j.data->>'from' AS from_address,
           j.data->>'subject' AS subject,
           j.start_after AS send_at,
           CASE WHEN j.state = 'completed' THEN j.completed_on ELSE NULL END AS sent_at,
           CASE WHEN j.state IN ('failed', 'cancelled') THEN j.output->>'message' ELSE NULL END AS error,
           (j.retry_count + 1) AS attempts,
           (j.retry_limit + 1) AS max_attempts,
           j.created_on AS created_at,
           j.state AS pgboss_state
      FROM pgboss.job j
      LEFT JOIN tenants t ON t.id = (j.data->>'tenantId')::int
     WHERE j.name = 'email'`;

  app.get("/api/admin/email-queue", requireSuperAdmin, async (req, res) => {
    try {
      const { status, limit: lim } = req.query;
      const limit = Math.min(parseInt(lim, 10) || 100, 500);

      let stateClause = "";
      if (status === "pending") stateClause = " AND j.state IN ('created','retry','active')";
      else if (status === "sent") stateClause = " AND j.state = 'completed'";
      else if (status === "failed") stateClause = " AND j.state IN ('failed','cancelled')";

      const { rows } = await db.query(
        `${EMAIL_SELECT_SQL}${stateClause}
         ORDER BY j.created_on DESC
         LIMIT $1`,
        [limit]
      );

      const { rows: [counts] } = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE state IN ('created','retry','active')) AS pending,
           COUNT(*) FILTER (WHERE state = 'completed') AS sent,
           COUNT(*) FILTER (WHERE state IN ('failed','cancelled')) AS failed
         FROM pgboss.job WHERE name = 'email'`
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

  // Retry: revive a failed/cancelled job by resetting state to 'created'
  // and clearing retry_count + output. pg-boss will pick it up on the
  // next fetch.
  app.post("/api/admin/email-queue/:id/retry", requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `UPDATE pgboss.job
            SET state = 'created',
                retry_count = 0,
                output = NULL,
                started_on = NULL,
                completed_on = NULL,
                start_after = NOW()
          WHERE name = 'email' AND id = $1 AND state IN ('failed','cancelled','retry')`,
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or not retriable" });
      logAdminAction(req.admin.email, "email_queue_retried", "email", req.params.id, null, req.ip);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Send-now: bring forward `start_after` for a pending job so the next
  // fetch picks it up immediately. No-op for already-sent jobs.
  app.post("/api/admin/email-queue/:id/send-now", requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `UPDATE pgboss.job
            SET start_after = NOW()
          WHERE name = 'email' AND id = $1 AND state IN ('created','retry')`,
        [req.params.id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Email not found or already processed" });
      logAdminAction(req.admin.email, "email_force_sent", "email", req.params.id, null, req.ip);
      return res.json({ message: "Email queued for immediate send" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // NOTE: purge-deleted must be registered BEFORE the :id param route to
  // avoid Express matching "purge-deleted" as :id.
  app.delete("/api/admin/email-queue/purge-deleted", requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM pgboss.job
          WHERE name = 'email'
            AND state IN ('created','retry','failed','cancelled')
            AND (data->>'tenantId')::int IN (SELECT id FROM tenants WHERE status = 'deleted')`
      );
      logAdminAction(req.admin.email, "email_purge_deleted", "email", null, { count: rowCount }, req.ip);
      return res.json({ message: `Purged ${rowCount} email(s) for deleted tenants`, deleted: rowCount });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Delete: only allow removing non-completed jobs. completed jobs are
  // archived by pg-boss after `keep_until` and shouldn't be hand-deleted.
  app.delete("/api/admin/email-queue/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM pgboss.job
          WHERE name = 'email' AND id = $1 AND state IN ('created','retry','failed','cancelled')`,
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
  app.post("/api/admin/email/broadcast", requireSuperAdmin, async (req, res) => {
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
  app.get("/api/admin/broadcast-history", requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM broadcast_log ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Activity Log ───────────────────────────────────────────────────────
  app.get("/api/admin/activity-log", requireSuperAdmin, async (req, res) => {
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
  app.get("/api/admin/security-log", requireSuperAdmin, async (req, res) => {
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
  app.get("/api/admin/tenant-activity", requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows: tenants } = await db.query(
        "SELECT id, slug, name FROM tenants WHERE status = 'active' ORDER BY id"
      );

      const allActivity = [];
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          // action_history's real columns are action_type/description/
          // user_name/timestamp. This query named action/details/performed_by/
          // created_at — none of which exist — so it threw for every tenant
          // into the catch below and this endpoint returned an empty list on
          // every call it has ever served. Aliased rather than renamed because
          // the caller (AdminActivity.jsx) shares this response shape with
          // admin_activity_log, which genuinely has created_at/performed_by.
          const { rows } = await tenantDb.query(
            `SELECT action_type AS action,
                    entity_type,
                    entity_id,
                    description AS details,
                    user_name   AS performed_by,
                    timestamp   AS created_at
             FROM action_history ORDER BY timestamp DESC LIMIT $1`,
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
  app.get("/api/admin/announcements", requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50");
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/announcements", requireSuperAdmin, validate(CreateAnnouncementSchema), async (req, res) => {
    try {
      const { message, type = "info", ends_at, audience_plan, audience_industry } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });
      if (!["info", "warning", "maintenance"].includes(type)) return res.status(400).json({ error: "Type must be info, warning, or maintenance" });

      const { rows } = await db.query(
        `INSERT INTO announcements (message, type, ends_at, created_by, audience_plan, audience_industry)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [message.trim(), type, ends_at || null, req.admin.email,
         normalizeAudience(audience_plan), normalizeAudience(audience_industry)]
      );
      logAdminAction(req.admin.email, "announcement_created", "announcement", rows[0].id, { type, message: message.trim().substring(0, 100) }, req.ip);
      return res.status(201).json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/announcements/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { message, type, active, ends_at, audience_plan, audience_industry } = req.body;
      const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);
      // Only overwrite audience columns when the key is actually present in the
      // body — a partial PUT (e.g. deactivate sends only { active:false }) must
      // not wipe existing targeting. Passing the key with an empty value clears
      // it back to "everyone".
      const { rows } = await db.query(
        `UPDATE announcements SET
          message = COALESCE($1, message),
          type = COALESCE($2, type),
          active = COALESCE($3, active),
          ends_at = $4,
          audience_plan = CASE WHEN $5 THEN $6 ELSE audience_plan END,
          audience_industry = CASE WHEN $7 THEN $8 ELSE audience_industry END
        WHERE id = $9 RETURNING *`,
        [message, type, active, ends_at !== undefined ? ends_at : null,
         has("audience_plan"), normalizeAudience(audience_plan),
         has("audience_industry"), normalizeAudience(audience_industry),
         req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
      logAdminAction(req.admin.email, "announcement_updated", "announcement", req.params.id, { type: rows[0].type }, req.ip);
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/announcements/:id", requireSuperAdmin, async (req, res) => {
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
  // Optional ?tenant=<slug> narrows targeted announcements to the caller's plan
  // and industry. Without a slug (e.g. pre-login), only untargeted announcements
  // (audience_plan AND audience_industry NULL) are returned — we can't confirm a
  // targeted banner applies, so it stays hidden.
  app.get("/api/announcements/active", async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT id, message, type, starts_at, ends_at, audience_plan, audience_industry
           FROM announcements
          WHERE active = true AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
          ORDER BY created_at DESC LIMIT 20`
      );

      const slug = (req.query.tenant || "").toString().trim().toLowerCase();
      let plan = null, industry = null;
      if (slug) {
        const aud = await resolveAudience(slug);
        if (aud) { plan = aud.plan; industry = aud.industry; }
      }

      const visible = rows
        .filter((a) => audienceMatches(a.audience_plan, plan) && audienceMatches(a.audience_industry, industry))
        .slice(0, 5)
        .map(({ audience_plan, audience_industry, ...rest }) => rest);

      return res.json(visible);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
