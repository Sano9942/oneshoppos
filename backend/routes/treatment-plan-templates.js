"use strict";

/**
 * Treatment Plan Templates (A7) — clone-to-create for recurring clinical plans.
 *
 * Endpoints:
 *   GET    /api/treatment-plan-templates
 *   POST   /api/treatment-plan-templates
 *   PUT    /api/treatment-plan-templates/:id
 *   DELETE /api/treatment-plan-templates/:id            (archive, not hard-delete)
 *   POST   /api/treatment-plan-templates/:id/create-plan (clone into a real plan)
 *
 * Gate: same as treatment-plans — mode + flag + manage_treatment_plans perm.
 */

module.exports = function registerTreatmentPlanTemplateRoutes(app, deps) {
  const {
    requireFeature,
    requireMode,
  } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const tp = require("../services/treatment-plan-service");

  const gate = [
    requireMode("treatment_plans"),
    requireFeature("phase4_treatment_plans"),
    requirePerm("manage_treatment_plans"),
  ];

  app.get("/api/treatment-plan-templates", ...gate, async (req, res) => {
    try {
      const includeArchived = req.query.include_archived === "1";
      const { rows } = await deps.db.query(
        `SELECT * FROM treatment_plan_templates
         WHERE ($1::boolean OR is_archived = false)
         ORDER BY is_archived ASC, name ASC`,
        [includeArchived]
      );
      res.json({ templates: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/treatment-plan-templates", ...gate, async (req, res) => {
    try {
      const {
        name,
        description,
        default_title,
        default_diagnosis_code,
        default_diagnosis_notes,
        default_sessions_planned,
        default_estimated_total,
        default_notes,
        default_activities,
      } = req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name required" });
      }

      const { rows: [row] } = await deps.db.query(
        `INSERT INTO treatment_plan_templates
          (name, description, default_title, default_diagnosis_code,
           default_diagnosis_notes, default_sessions_planned,
           default_estimated_total, default_notes, default_activities,
           created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         RETURNING *`,
        [
          name.trim(),
          description || null,
          default_title || null,
          default_diagnosis_code || null,
          default_diagnosis_notes || null,
          Math.max(1, Number(default_sessions_planned) || 1),
          Number(default_estimated_total) || 0,
          default_notes || null,
          JSON.stringify(default_activities || []),
          req.employee?.id || null,
        ]
      );
      res.status(201).json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.put("/api/treatment-plan-templates/:id", ...gate, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const {
        name,
        description,
        default_title,
        default_diagnosis_code,
        default_diagnosis_notes,
        default_sessions_planned,
        default_estimated_total,
        default_notes,
        default_activities,
        is_archived,
      } = req.body || {};

      const { rows: [row] } = await deps.db.query(
        `UPDATE treatment_plan_templates
         SET name = COALESCE($2, name),
             description = COALESCE($3, description),
             default_title = COALESCE($4, default_title),
             default_diagnosis_code = COALESCE($5, default_diagnosis_code),
             default_diagnosis_notes = COALESCE($6, default_diagnosis_notes),
             default_sessions_planned = COALESCE($7, default_sessions_planned),
             default_estimated_total = COALESCE($8, default_estimated_total),
             default_notes = COALESCE($9, default_notes),
             default_activities = COALESCE($10::jsonb, default_activities),
             is_archived = COALESCE($11, is_archived),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          name?.trim() || null,
          description ?? null,
          default_title ?? null,
          default_diagnosis_code ?? null,
          default_diagnosis_notes ?? null,
          default_sessions_planned != null ? Number(default_sessions_planned) : null,
          default_estimated_total != null ? Number(default_estimated_total) : null,
          default_notes ?? null,
          default_activities != null ? JSON.stringify(default_activities) : null,
          typeof is_archived === "boolean" ? is_archived : null,
        ]
      );
      if (!row) return res.status(404).json({ error: "Template not found" });
      res.json(row);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // Archive rather than hard-delete — past plans may still reference templates.
  app.delete("/api/treatment-plan-templates/:id", ...gate, async (req, res) => {
    try {
      const { rows: [row] } = await deps.db.query(
        `UPDATE treatment_plan_templates SET is_archived = true, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [Number(req.params.id)]
      );
      if (!row) return res.status(404).json({ error: "Template not found" });
      res.json({ ok: true, template: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clone a template into a new plan for a given customer. Reuses the same
  // service that powers POST /api/treatment-plans so deposits, activities,
  // and folio seeding stay consistent.
  app.post("/api/treatment-plan-templates/:id/create-plan", ...gate, async (req, res) => {
    try {
      const templateId = Number(req.params.id);
      const { customer_id, subject_id, outlet_id, provider_id, start_date } =
        req.body || {};

      if (!customer_id) {
        return res.status(400).json({ error: "customer_id required" });
      }

      const { rows: [template] } = await deps.db.query(
        `SELECT * FROM treatment_plan_templates WHERE id = $1 AND is_archived = false`,
        [templateId]
      );
      if (!template) {
        return res.status(404).json({ error: "Template not found or archived" });
      }

      const plan = await tp.createPlan(
        deps.db,
        {
          customer_id: Number(customer_id),
          subject_id: subject_id ? Number(subject_id) : null,
          outlet_id: outlet_id ? Number(outlet_id) : null,
          provider_id: provider_id ? Number(provider_id) : null,
          title: template.default_title || template.name,
          diagnosis_code: template.default_diagnosis_code,
          diagnosis_notes: template.default_diagnosis_notes,
          start_date: start_date || null,
          total_sessions_planned: template.default_sessions_planned,
          estimated_total: template.default_estimated_total,
          notes: template.default_notes,
        },
        req.employee?.id || null
      );
      res.status(201).json({ ok: true, plan, template_id: templateId });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
