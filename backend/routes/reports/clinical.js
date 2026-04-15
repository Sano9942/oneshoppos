"use strict";

/**
 * Clinical reports (M10) — for tenants running treatment_plans mode.
 * All routes gated by `phase4_treatment_plans` feature flag and `view_reports` perm.
 */

module.exports = function registerClinicalReports(app, deps /* , helpers */) {
  const { requireFeature } = require("../../middleware/feature-flags");
  const { requirePerm } = require("../../middleware/permissions");

  const gate = [requireFeature("phase4_treatment_plans"), requirePerm("view_reports")];

  // Completion rate by provider / by plan title
  app.get("/api/reports/clinical/plan-completion", ...gate, async (req, res) => {
    try {
      const { rows: byProvider } = await deps.db.query(
        `SELECT COALESCE(e.name, '(unassigned)') AS provider_name,
                COUNT(*)::int AS total_plans,
                SUM(CASE WHEN p.status IN ('completed','invoiced') THEN 1 ELSE 0 END)::int AS completed_plans,
                ROUND(
                  100.0 * SUM(CASE WHEN p.status IN ('completed','invoiced') THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0)::numeric, 1
                ) AS completion_pct
         FROM treatment_plans p
         LEFT JOIN employees e ON e.id = p.provider_id
         GROUP BY e.name
         ORDER BY completion_pct DESC NULLS LAST`
      );
      res.json({ by_provider: byProvider });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Session attendance — no-show rates
  app.get("/api/reports/clinical/session-attendance", ...gate, async (req, res) => {
    try {
      const { rows: byProvider } = await deps.db.query(
        `SELECT COALESCE(e.name, '(unassigned)') AS provider_name,
                COUNT(*)::int AS scheduled_count,
                SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
                SUM(CASE WHEN s.status = 'no_show' THEN 1 ELSE 0 END)::int AS no_show_count,
                ROUND(
                  100.0 * SUM(CASE WHEN s.status = 'no_show' THEN 1 ELSE 0 END)
                  / NULLIF(COUNT(*), 0)::numeric, 1
                ) AS no_show_pct
         FROM treatment_sessions s
         LEFT JOIN employees e ON e.id = s.provider_id
         GROUP BY e.name
         ORDER BY no_show_pct DESC NULLS LAST`
      );
      res.json({ by_provider: byProvider });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Revenue per plan / per session
  app.get("/api/reports/clinical/revenue-per-plan", ...gate, async (req, res) => {
    try {
      const { rows: [agg] } = await deps.db.query(
        `SELECT
           COUNT(DISTINCT p.id)::int AS plan_count,
           COALESCE(SUM(tf.grand_total), 0) AS total_revenue,
           ROUND(
             COALESCE(SUM(tf.grand_total), 0)::numeric
             / NULLIF(COUNT(DISTINCT p.id), 0)::numeric, 2
           ) AS avg_revenue_per_plan
         FROM treatment_plans p
         LEFT JOIN treatment_folios tf ON tf.plan_id = p.id
         WHERE p.status IN ('completed','invoiced')`
      );
      const { rows: [sessionAgg] } = await deps.db.query(
        `SELECT
           COUNT(*)::int AS completed_sessions,
           COALESCE(SUM(tfl.line_total), 0) AS session_revenue,
           ROUND(
             COALESCE(SUM(tfl.line_total), 0)::numeric
             / NULLIF(COUNT(*), 0)::numeric, 2
           ) AS avg_revenue_per_session
         FROM treatment_sessions s
         LEFT JOIN treatment_folio_lines tfl ON tfl.session_id = s.id AND tfl.line_type = 'session_fee'
         WHERE s.status = 'completed'`
      );
      res.json({ plans: agg, sessions: sessionAgg });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Patient retention — 30/60/90-day return rates
  app.get("/api/reports/clinical/patient-retention", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `WITH first_visit AS (
           SELECT customer_id, MIN(created_at) AS first_visit_at
           FROM treatment_plans
           GROUP BY customer_id
         ),
         cohort AS (
           SELECT fv.customer_id, fv.first_visit_at,
             EXISTS (SELECT 1 FROM treatment_plans p2
                     WHERE p2.customer_id = fv.customer_id
                       AND p2.created_at > fv.first_visit_at
                       AND p2.created_at <= fv.first_visit_at + INTERVAL '30 days') AS returned_30,
             EXISTS (SELECT 1 FROM treatment_plans p2
                     WHERE p2.customer_id = fv.customer_id
                       AND p2.created_at > fv.first_visit_at
                       AND p2.created_at <= fv.first_visit_at + INTERVAL '60 days') AS returned_60,
             EXISTS (SELECT 1 FROM treatment_plans p2
                     WHERE p2.customer_id = fv.customer_id
                       AND p2.created_at > fv.first_visit_at
                       AND p2.created_at <= fv.first_visit_at + INTERVAL '90 days') AS returned_90
           FROM first_visit fv
         )
         SELECT
           COUNT(*)::int AS total_patients,
           SUM(CASE WHEN returned_30 THEN 1 ELSE 0 END)::int AS returned_30_count,
           SUM(CASE WHEN returned_60 THEN 1 ELSE 0 END)::int AS returned_60_count,
           SUM(CASE WHEN returned_90 THEN 1 ELSE 0 END)::int AS returned_90_count
         FROM cohort`
      );
      res.json({ retention: rows[0] || { total_patients: 0 } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Lab turnaround — avg days from order to result
  app.get("/api/reports/clinical/lab-turnaround", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        `SELECT
           COALESCE(lab_vendor, '(unspecified)') AS lab_vendor,
           COUNT(*)::int AS total_orders,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed_orders,
           ROUND(
             AVG(
               EXTRACT(EPOCH FROM (result_received_at - ordered_at)) / 86400.0
             )::numeric, 1
           ) AS avg_turnaround_days
         FROM lab_orders
         WHERE result_received_at IS NOT NULL
         GROUP BY lab_vendor
         ORDER BY avg_turnaround_days ASC NULLS LAST`
      );
      res.json({ by_vendor: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
