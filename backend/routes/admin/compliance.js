/**
 * Admin compliance — tax rate reference CRUD, tax rate suggestions, FBR health.
 */
const { validate } = require("../../middleware/validate");
const { CreateTaxRateSchema } = require("../../schemas/admin");

module.exports = function registerComplianceRoutes(app, deps) {
  const { db, masterDb, requireSuperAdmin, tenantDbManager, logAdminAction } = deps;

  // ── Tax Rate Reference CRUD (public schema) ────────────────────────────
  app.get("/api/admin/tax-rates", requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM public.tax_rate_reference ORDER BY hs_code");
      res.json({ rates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tax-rates", requireSuperAdmin, validate(CreateTaxRateSchema), async (req, res) => {
    try {
      const { hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes } = req.body;
      if (!hs_code || !description_en) return res.status(400).json({ error: "hs_code and description_en are required" });

      const { rows: [rate] } = await db.query(
        `INSERT INTO public.tax_rate_reference (hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [hs_code, description_en, description_ur || null, federal_gst || 0, punjab_pra || 0, sindh_srb || 0, kpk_kpra || 0, balochistan_bra || 0, exemption_notes || null]
      );
      logAdminAction(req.admin.email, "tax_rate_created", "tax_rate", rate.id, { hs_code: rate.hs_code }, req.ip);
      res.json(rate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tax-rates/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes } = req.body;
      const { rows: [rate] } = await db.query(
        `UPDATE public.tax_rate_reference
         SET hs_code = COALESCE($1, hs_code), description_en = COALESCE($2, description_en),
             description_ur = COALESCE($3, description_ur), federal_gst = COALESCE($4, federal_gst),
             punjab_pra = COALESCE($5, punjab_pra), sindh_srb = COALESCE($6, sindh_srb),
             kpk_kpra = COALESCE($7, kpk_kpra), balochistan_bra = COALESCE($8, balochistan_bra),
             exemption_notes = COALESCE($9, exemption_notes), last_updated = CURRENT_DATE
         WHERE id = $10 RETURNING *`,
        [hs_code, description_en, description_ur, federal_gst, punjab_pra, sindh_srb, kpk_kpra, balochistan_bra, exemption_notes, id]
      );
      if (!rate) return res.status(404).json({ error: "Rate not found" });
      logAdminAction(req.admin.email, "tax_rate_updated", "tax_rate", rate.id, { hs_code: rate.hs_code }, req.ip);
      res.json(rate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/tax-rates/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { rowCount } = await db.query("DELETE FROM public.tax_rate_reference WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Rate not found" });
      logAdminAction(req.admin.email, "tax_rate_deleted", "tax_rate", req.params.id, null, req.ip);
      res.json({ message: "Rate deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Tax Rate Suggestions Review ────────────────────────────────────────
  app.get("/api/admin/tax-rate-suggestions", requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await masterDb.query("SELECT id, slug, name FROM tenants WHERE status = 'active'");
      const suggestions = [];
      for (const tenant of tenants) {
        try {
          const { rows } = await db.query(
            `SELECT * FROM tenant_${tenant.slug}.tax_rate_suggestions WHERE status = 'pending' ORDER BY created_at DESC`
          );
          rows.forEach((r) => suggestions.push({ ...r, tenant_slug: tenant.slug, tenant_name: tenant.name }));
        } catch (_) { /* skip tenants without the table */ }
      }
      res.json({ suggestions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tax-rate-suggestions/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, tenant_slug } = req.body;
      if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status must be approved or rejected" });
      if (!tenant_slug) return res.status(400).json({ error: "tenant_slug is required" });
      if (!/^[a-z0-9_]{3,40}$/.test(tenant_slug)) return res.status(400).json({ error: "Invalid tenant_slug format" });

      const { rows: [suggestion] } = await db.query(
        `UPDATE tenant_${tenant_slug}.tax_rate_suggestions SET status = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *`,
        [status, id]
      );
      if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });

      if (status === "approved" && suggestion.field_name && suggestion.suggested_value != null) {
        const allowedFields = ["federal_gst", "punjab_pra", "sindh_srb", "kpk_kpra", "balochistan_bra"];
        if (allowedFields.includes(suggestion.field_name)) {
          await db.query(
            `UPDATE public.tax_rate_reference SET ${suggestion.field_name} = $1, last_updated = CURRENT_DATE WHERE id = $2`,
            [suggestion.suggested_value, suggestion.reference_id]
          );
        }
      }

      logAdminAction(req.admin.email, "tax_suggestion_reviewed", "tax_suggestion", req.params.id, { status, tenant_slug }, req.ip);
      res.json({ message: `Suggestion ${status}`, suggestion });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── FBR Health (cross-tenant) ──────────────────────────────────────────
  app.get("/api/admin/fbr-health", requireSuperAdmin, async (req, res) => {
    try {
      const { rows: tenants } = await masterDb.query("SELECT id, slug, name FROM tenants WHERE status = 'active'");
      const health = [];

      for (const tenant of tenants) {
        try {
          const { rows: [flag] } = await db.query(
            `SELECT enabled FROM tenant_${tenant.slug}.feature_flags WHERE key = 'fbr_integration'`
          );
          if (!flag?.enabled) continue;

          const { rows: [stats] } = await db.query(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
               COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE status = 'posted')::int AS posted,
               MIN(created_at) FILTER (WHERE status = 'pending') AS oldest_pending,
               AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) FILTER (WHERE status = 'pending') AS avg_delay_secs
             FROM tenant_${tenant.slug}.fbr_invoices`
          );
          health.push({
            tenant_slug: tenant.slug,
            tenant_name: tenant.name,
            ...stats,
          });
        } catch (_) { /* skip tenants without the table */ }
      }

      res.json({ health });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
