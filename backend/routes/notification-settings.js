"use strict";

/**
 * Notification settings (F05) — per-event channel rules, delivery log, and a
 * provider connectivity test. Rule config is perm-gated (admin/manager) but NOT
 * feature-flag-gated on purpose: an admin must be able to configure rules before
 * flipping the customer_notifications flag on. Actual dispatch is gated centrally
 * inside services/customer-notify.js (notificationsEnabled).
 */

module.exports = function registerNotificationSettingsRoutes(app, deps) {
  const { requireAnyPerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { ruleUpsertSchema, rulePatchSchema, testSchema } = require("../schemas/notification-settings");
  const sms = require("../services/sms");
  const { SMS_TEMPLATES } = require("../services/sms-templates");
  const { testWhatsApp } = require("../services/customer-notify");

  // Manager/admin only. Recipient values in the log are PII — never public.
  const gate = [requireAnyPerm(["manage_inventory", "manage_tickets", "manage_bookings"])];

  // Email templates the engine can address (curated — not every marketing/billing type).
  const EMAIL_TEMPLATE_KEYS = [
    "ticket_approved", "ticket_in_progress", "ticket_completed", "ticket_invoiced",
    "appointment_reminder",
  ];

  // --- Status: flag + provider availability (drives the settings UI banner) ---
  app.get("/api/notification-settings/status", ...gate, async (req, res) => {
    try {
      let enabled = false;
      try {
        const { rows } = await deps.db.query(
          "SELECT enabled FROM feature_flags WHERE key = 'customer_notifications'"
        );
        enabled = rows.length ? rows[0].enabled === true : false;
      } catch { /* table missing → false */ }

      const smsProvider = await sms.resolveProvider(deps.db).catch(() => null);
      let whatsappConfigured = false;
      try {
        const { rows } = await deps.db.query(
          "SELECT 1 FROM integration_settings WHERE provider = 'whatsapp' AND is_active = true LIMIT 1"
        );
        whatsappConfigured = rows.length > 0;
      } catch { /* ignore */ }

      res.json({
        enabled,
        channels: {
          email: !!process.env.RESEND_API_KEY,
          sms: !!smsProvider,
          whatsapp: whatsappConfigured,
        },
        available_templates: { email: EMAIL_TEMPLATE_KEYS, sms: Object.keys(SMS_TEMPLATES) },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- List rules ---
  app.get("/api/notification-settings/rules", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        "SELECT id, event, channel, template_key, enabled, updated_at FROM notification_rules ORDER BY event, channel"
      );
      res.json({ rules: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- Upsert a rule (idempotent on event+channel) ---
  app.put("/api/notification-settings/rules", ...gate, validate(ruleUpsertSchema), async (req, res) => {
    try {
      const { event, channel, template_key, enabled } = req.body;
      const { rows: [rule] } = await deps.db.query(
        `INSERT INTO notification_rules (event, channel, template_key, enabled)
         VALUES ($1, $2, $3, COALESCE($4, true))
         ON CONFLICT (event, channel)
         DO UPDATE SET template_key = EXCLUDED.template_key,
                       enabled = COALESCE($4, notification_rules.enabled),
                       updated_at = NOW()
         RETURNING id, event, channel, template_key, enabled, updated_at`,
        [event, channel, template_key, enabled === undefined ? null : enabled]
      );
      res.status(201).json(rule);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- Patch a rule (toggle enabled / change template) ---
  app.patch("/api/notification-settings/rules/:id", ...gate, validate(rulePatchSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const sets = [];
      const params = [];
      let idx = 0;
      if (req.body.enabled !== undefined) { idx++; sets.push(`enabled = $${idx}`); params.push(req.body.enabled); }
      if (req.body.template_key !== undefined) { idx++; sets.push(`template_key = $${idx}`); params.push(req.body.template_key); }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      sets.push("updated_at = NOW()");
      idx++;
      params.push(id);
      const { rows: [rule] } = await deps.db.query(
        `UPDATE notification_rules SET ${sets.join(", ")} WHERE id = $${idx}
         RETURNING id, event, channel, template_key, enabled, updated_at`,
        params
      );
      if (!rule) return res.status(404).json({ error: "Rule not found" });
      res.json(rule);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- Delete a rule ---
  app.delete("/api/notification-settings/rules/:id", ...gate, async (req, res) => {
    try {
      const { rowCount } = await deps.db.query(
        "DELETE FROM notification_rules WHERE id = $1", [Number(req.params.id)]
      );
      if (!rowCount) return res.status(404).json({ error: "Rule not found" });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- Delivery log (PII: recipient values — perm-gated, never public) ---
  app.get("/api/notification-settings/log", ...gate, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const params = [];
      let idx = 0;
      let where = "1=1";
      if (req.query.status) { idx++; where += ` AND cn.status = $${idx}`; params.push(req.query.status); }
      if (req.query.channel) { idx++; where += ` AND cn.channel = $${idx}`; params.push(req.query.channel); }
      if (req.query.event) { idx++; where += ` AND cn.event = $${idx}`; params.push(req.query.event); }
      idx++;
      params.push(limit);
      const { rows } = await deps.db.query(
        `SELECT cn.id, cn.event, cn.channel, cn.recipient, cn.entity_type, cn.entity_id,
                cn.status, cn.provider_ref, cn.error, cn.created_at,
                c.name AS customer_name
         FROM customer_notifications cn
         LEFT JOIN customers c ON c.id = cn.customer_id
         WHERE ${where}
         ORDER BY cn.created_at DESC
         LIMIT $${idx}`,
        params
      );
      res.json({ log: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // --- Provider connectivity test (mirrors sms.js:testProvider) ---
  app.post("/api/notification-settings/test", ...gate, validate(testSchema), async (req, res) => {
    try {
      const channel = req.body.channel || "sms";
      if (channel === "sms") {
        const result = await sms.testProvider(deps.db);
        return res.json({ channel: "sms", ...result });
      }
      if (channel === "whatsapp") {
        const result = await testWhatsApp(deps.db);
        return res.json({ channel: "whatsapp", ...result });
      }
      res.status(400).json({ error: "Unsupported test channel" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
