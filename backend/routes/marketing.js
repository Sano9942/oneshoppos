/**
 * backend/routes/marketing.js — Email marketing campaigns and templates.
 *
 * GET    /api/marketing/campaigns          — List campaigns with delivery stats
 * POST   /api/marketing/campaigns          — Create campaign (draft)
 * PUT    /api/marketing/campaigns/:id      — Update draft campaign
 * POST   /api/marketing/campaigns/:id/send-test  — Send test email
 * POST   /api/marketing/campaigns/:id/send        — Send campaign now
 * POST   /api/marketing/campaigns/:id/schedule    — Schedule campaign
 * GET    /api/marketing/audiences/preview  — Preview audience count
 * GET    /api/marketing/templates          — List templates
 * POST   /api/marketing/templates          — Create template
 * PUT    /api/marketing/templates/:id      — Update template
 * DELETE /api/marketing/templates/:id      — Delete template
 */

module.exports = function registerMarketingRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createTemplateSchema, createCampaignSchema, scheduleCampaignSchema } = require("../schemas/marketing");
  const { resolveAudience, enqueueCampaignSend } = require("../services/marketing");
  const { enqueueEmail } = require("../services/email");
  const { getBoss } = require("../services/boss");

  const gate = [requireFeature("marketing_campaigns"), requirePerm("all_access")];

  // ── Campaigns ────────────────────────────────────────────────────────

  app.get("/api/marketing/campaigns", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(`
        SELECT mc.*,
          (SELECT COUNT(*)::int FROM marketing_campaign_deliveries d WHERE d.campaign_id = mc.id) AS total_deliveries,
          (SELECT COUNT(*)::int FROM marketing_campaign_deliveries d WHERE d.campaign_id = mc.id AND d.status = 'sent') AS sent_count,
          (SELECT COUNT(*)::int FROM marketing_campaign_deliveries d WHERE d.campaign_id = mc.id AND d.status = 'failed') AS failed_count
        FROM marketing_campaigns mc
        ORDER BY mc.created_at DESC
      `);
      res.json({ campaigns: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing/campaigns", ...gate, validate(createCampaignSchema), async (req, res) => {
    try {
      const { name, channel, template_id, subject, body_html, audience_filters } = req.body;
      const { rows: [campaign] } = await deps.db.query(
        `INSERT INTO marketing_campaigns (name, channel, template_id, subject, body_html, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING *`,
        [name, channel || "email", template_id || null, subject || null, body_html || null, req.employee.id]
      );

      // Save audience filters
      if (audience_filters && audience_filters.length > 0) {
        for (const f of audience_filters) {
          await deps.db.query(
            "INSERT INTO marketing_campaign_audiences (campaign_id, filter_type, filter_value) VALUES ($1, $2, $3)",
            [campaign.id, f.filter_type, f.filter_value]
          );
        }
      }

      res.status(201).json(campaign);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/marketing/campaigns/:id", ...gate, validate(createCampaignSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [existing] } = await deps.db.query("SELECT status FROM marketing_campaigns WHERE id = $1", [id]);
      if (!existing) return res.status(404).json({ error: "Campaign not found" });
      if (existing.status !== "draft") return res.status(400).json({ error: "Only draft campaigns can be edited" });

      const { name, channel, template_id, subject, body_html, audience_filters } = req.body;
      const { rows: [campaign] } = await deps.db.query(
        `UPDATE marketing_campaigns SET name = $1, channel = $2, template_id = $3, subject = $4, body_html = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [name, channel || "email", template_id || null, subject || null, body_html || null, id]
      );

      // Replace audience filters
      if (audience_filters) {
        await deps.db.query("DELETE FROM marketing_campaign_audiences WHERE campaign_id = $1", [id]);
        for (const f of audience_filters) {
          await deps.db.query(
            "INSERT INTO marketing_campaign_audiences (campaign_id, filter_type, filter_value) VALUES ($1, $2, $3)",
            [id, f.filter_type, f.filter_value]
          );
        }
      }

      res.json(campaign);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing/campaigns/:id/send-test", ...gate, async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: [campaign] } = await deps.db.query(
        `SELECT mc.*, mt.body_html AS tmpl_html, mt.subject AS tmpl_subject
         FROM marketing_campaigns mc
         LEFT JOIN marketing_templates mt ON mt.id = mc.template_id
         WHERE mc.id = $1`,
        [id]
      );
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });

      // Resolve audience preview (1 sample)
      const { rows: filterRows } = await deps.db.query(
        "SELECT filter_type, filter_value FROM marketing_campaign_audiences WHERE campaign_id = $1",
        [id]
      );
      const { sample } = await resolveAudience(deps.db, filterRows, { previewOnly: true });
      const testRecipient = sample?.[0];
      if (!testRecipient?.email) return res.status(400).json({ error: "No test recipient with email found" });

      const subject = campaign.subject || campaign.tmpl_subject || campaign.name;
      const html = campaign.body_html || campaign.tmpl_html || "";

      await enqueueEmail(deps.db, {
        tenantId: req.tenantId || null,
        type: "campaign_test",
        to: testRecipient.email,
        data: { subject, html, campaign_name: campaign.name },
      });

      res.json({ sent_to: testRecipient.email });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/marketing/campaigns/:id/send", ...gate, async (req, res) => {
    try {
      const boss = await getBoss();
      const result = await enqueueCampaignSend(boss, Number(req.params.id), deps.db);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/marketing/campaigns/:id/schedule", ...gate, validate(scheduleCampaignSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { scheduled_at } = req.body;
      const { rows: [existing] } = await deps.db.query("SELECT status FROM marketing_campaigns WHERE id = $1", [id]);
      if (!existing) return res.status(404).json({ error: "Campaign not found" });
      if (existing.status !== "draft") return res.status(400).json({ error: "Only draft campaigns can be scheduled" });

      await deps.db.query(
        "UPDATE marketing_campaigns SET status = 'scheduled', scheduled_at = $1, updated_at = NOW() WHERE id = $2",
        [scheduled_at, id]
      );

      // Enqueue delayed pg-boss job
      const boss = await getBoss();
      await boss.send("campaign-scheduled-send", { campaignId: Number(id) }, { startAfter: new Date(scheduled_at) });

      res.json({ status: "scheduled", scheduled_at });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Audience Preview ──────────────────────────────────────────────────

  app.get("/api/marketing/audiences/preview", ...gate, async (req, res) => {
    try {
      // Accept filters as JSON query param
      let filters = [];
      if (req.query.filters) {
        try { filters = JSON.parse(req.query.filters); } catch { /* ignore parse errors */ }
      }
      const result = await resolveAudience(deps.db, filters, { previewOnly: true });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Templates ─────────────────────────────────────────────────────────

  app.get("/api/marketing/templates", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query("SELECT * FROM marketing_templates ORDER BY created_at DESC");
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/marketing/templates", ...gate, validate(createTemplateSchema), async (req, res) => {
    try {
      const { name, channel, subject, body_html, body_text } = req.body;
      const { rows: [template] } = await deps.db.query(
        `INSERT INTO marketing_templates (name, channel, subject, body_html, body_text, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, channel || "email", subject || null, body_html || null, body_text || null, req.employee.id]
      );
      res.status(201).json(template);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/marketing/templates/:id", ...gate, validate(createTemplateSchema), async (req, res) => {
    try {
      const { name, channel, subject, body_html, body_text } = req.body;
      const { rows: [template] } = await deps.db.query(
        `UPDATE marketing_templates SET name = $1, channel = $2, subject = $3, body_html = $4, body_text = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [name, channel || "email", subject || null, body_html || null, body_text || null, req.params.id]
      );
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/marketing/templates/:id", ...gate, async (req, res) => {
    try {
      // Check if template is used by any campaign
      const { rows: [used] } = await deps.db.query(
        "SELECT id FROM marketing_campaigns WHERE template_id = $1 LIMIT 1",
        [req.params.id]
      );
      if (used) return res.status(400).json({ error: "Template is used by a campaign and cannot be deleted" });

      const { rowCount } = await deps.db.query("DELETE FROM marketing_templates WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Template not found" });
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
