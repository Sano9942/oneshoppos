const { validate } = require("../middleware/validate");
const {
  openPoolSchema,
  closePoolSchema,
  distributePoolSchema,
  voidPoolSchema,
  createDistributionRuleSchema,
  updateDistributionRuleSchema,
} = require("../schemas/tips");
const tipsService = require("../services/tips");

/**
 * Phase 2.1 C2 — tip pool routes.
 *
 * Gated by phase4_restaurant + manage_tips permission. The permission is
 * granted by default to roles holding manage_restaurant (see
 * middleware/permissions.js DEFAULT_ROLE_PERMISSIONS).
 */
module.exports = function registerTipsRoutes(app, deps) {
  const { db, requirePerm, requireFeature } = deps;
  const { requireMode } = require("../middleware/feature-flags");
  // P2 fix: defense-in-depth — gate on restaurant mode in addition to flag.
  // requireMode falls through with empty modes map (back-compat for pre-M1 tenants).
  const mode = requireMode("restaurant");
  const feat = requireFeature("phase4_restaurant");
  const guard = requirePerm("manage_tips");

  // ── Pools ─────────────────────────────────────────────────────────────────

  // GET /api/tips/pools?outlet_id=&from=&to=&status=
  app.get("/api/tips/pools", mode, feat, guard, async (req, res) => {
    const { outlet_id, from, to, status } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;
      if (outlet_id) { where += ` AND tp.outlet_id = $${idx}`; params.push(outlet_id); idx++; }
      if (from) { where += ` AND tp.business_date >= $${idx}`; params.push(from); idx++; }
      if (to) { where += ` AND tp.business_date <= $${idx}`; params.push(to); idx++; }
      if (status) { where += ` AND tp.status = $${idx}`; params.push(status); idx++; }

      const { rows } = await db.query(
        `SELECT tp.*,
                e.name AS closed_by_name,
                tpdr.name AS distribution_rule_name,
                tpdr.strategy AS distribution_rule_strategy,
                (SELECT COUNT(*)::int FROM tip_captures tc WHERE tc.pool_id = tp.id) AS capture_count,
                (SELECT COUNT(*)::int FROM tip_pool_payouts pp WHERE pp.pool_id = tp.id) AS payout_count
           FROM tip_pools tp
           LEFT JOIN employees e ON e.id = tp.closed_by
           LEFT JOIN tip_pool_distribution_rules tpdr ON tpdr.id = tp.distribution_rule_id
          WHERE ${where}
          ORDER BY tp.business_date DESC, tp.id DESC
          LIMIT 200`,
        params
      );
      res.json({ pools: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tips/pools — open (idempotent)
  app.post("/api/tips/pools", mode, feat, guard, validate(openPoolSchema), async (req, res) => {
    const { outlet_id, business_date } = req.body;
    try {
      const pool = await tipsService.openTipPool(db, outlet_id, business_date);
      res.status(201).json({ pool });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // POST /api/tips/pools/:id/close
  app.post("/api/tips/pools/:id/close", mode, feat, guard, validate(closePoolSchema), async (req, res) => {
    try {
      const pool = await tipsService.closeTipPool(db, Number(req.params.id), req.employee?.id || null);
      res.json({ pool });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // POST /api/tips/pools/:id/distribute
  app.post("/api/tips/pools/:id/distribute", mode, feat, guard, validate(distributePoolSchema), async (req, res) => {
    try {
      const result = await tipsService.distributeTipPool(db, Number(req.params.id), req.body.rule_id || null);
      res.json(result);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // POST /api/tips/pools/:id/void
  app.post("/api/tips/pools/:id/void", mode, feat, guard, validate(voidPoolSchema), async (req, res) => {
    try {
      const pool = await tipsService.voidTipPool(db, Number(req.params.id), req.body.reason || null);
      res.json({ pool });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Distribution rules ────────────────────────────────────────────────────

  // GET /api/tips/distribution-rules?outlet_id=
  app.get("/api/tips/distribution-rules", mode, feat, guard, async (req, res) => {
    const { outlet_id } = req.query;
    try {
      let where = "is_active = TRUE";
      const params = [];
      if (outlet_id) { where += ` AND outlet_id = $1`; params.push(outlet_id); }
      const { rows } = await db.query(
        `SELECT * FROM tip_pool_distribution_rules
          WHERE ${where}
          ORDER BY is_default DESC, name ASC`,
        params
      );
      res.json({ rules: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/tips/distribution-rules
  app.post("/api/tips/distribution-rules", mode, feat, guard, validate(createDistributionRuleSchema), async (req, res) => {
    const { outlet_id, name, strategy, config_jsonb, is_default, is_active } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        // If this rule is the new default, unset the previous default for
        // the outlet so the partial unique index doesn't trip.
        if (is_default) {
          await client.query(
            `UPDATE tip_pool_distribution_rules
                SET is_default = FALSE, updated_at = NOW()
              WHERE outlet_id = $1 AND is_default = TRUE`,
            [outlet_id]
          );
        }
        const { rows } = await client.query(
          `INSERT INTO tip_pool_distribution_rules
             (outlet_id, name, strategy, config_jsonb, is_default, is_active)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            outlet_id,
            name,
            strategy,
            JSON.stringify(config_jsonb || {}),
            !!is_default,
            is_active !== false,
          ]
        );
        return rows[0];
      });
      res.status(201).json({ rule: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/tips/distribution-rules/:id
  app.put("/api/tips/distribution-rules/:id", mode, feat, guard, validate(updateDistributionRuleSchema), async (req, res) => {
    try {
      const result = await db.transaction(async (client) => {
        const { rows: existing } = await client.query(
          `SELECT * FROM tip_pool_distribution_rules WHERE id = $1`,
          [req.params.id]
        );
        if (!existing.length) return null;
        const cur = existing[0];

        if (req.body.is_default === true && !cur.is_default) {
          await client.query(
            `UPDATE tip_pool_distribution_rules
                SET is_default = FALSE, updated_at = NOW()
              WHERE outlet_id = $1 AND is_default = TRUE AND id != $2`,
            [cur.outlet_id, req.params.id]
          );
        }

        const sets = [];
        const vals = [];
        let idx = 1;
        for (const field of ["name", "strategy", "is_default", "is_active"]) {
          if (req.body[field] !== undefined) {
            sets.push(`${field} = $${idx}`);
            vals.push(req.body[field]);
            idx++;
          }
        }
        if (req.body.config_jsonb !== undefined) {
          sets.push(`config_jsonb = $${idx}`);
          vals.push(JSON.stringify(req.body.config_jsonb || {}));
          idx++;
        }
        sets.push(`updated_at = NOW()`);
        vals.push(req.params.id);

        const { rows: updated } = await client.query(
          `UPDATE tip_pool_distribution_rules SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
          vals
        );
        return updated[0];
      });
      if (!result) return res.status(404).json({ error: "Rule not found" });
      res.json({ rule: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Payouts ───────────────────────────────────────────────────────────────

  // GET /api/tips/payouts?employee_id=&from=&to=&pool_id=
  app.get("/api/tips/payouts", mode, feat, guard, async (req, res) => {
    const { employee_id, from, to, pool_id } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;
      if (employee_id) { where += ` AND pp.employee_id = $${idx}`; params.push(employee_id); idx++; }
      if (pool_id) { where += ` AND pp.pool_id = $${idx}`; params.push(pool_id); idx++; }
      if (from) { where += ` AND tp.business_date >= $${idx}`; params.push(from); idx++; }
      if (to) { where += ` AND tp.business_date <= $${idx}`; params.push(to); idx++; }

      const { rows } = await db.query(
        `SELECT pp.*,
                e.name AS employee_name,
                tp.business_date,
                tp.outlet_id,
                ce.status AS commission_status
           FROM tip_pool_payouts pp
           JOIN employees e ON e.id = pp.employee_id
           JOIN tip_pools tp ON tp.id = pp.pool_id
           LEFT JOIN commission_earnings ce ON ce.id = pp.commission_earning_id
          WHERE ${where}
          ORDER BY tp.business_date DESC, pp.id DESC
          LIMIT 500`,
        params
      );

      const { rows: summary } = await db.query(
        `SELECT
           COUNT(*)::int AS total_payouts,
           COALESCE(SUM(pp.payout_amount), 0)::numeric AS total_amount,
           COALESCE(SUM(CASE WHEN pp.paid_at IS NULL THEN pp.payout_amount ELSE 0 END), 0)::numeric AS unpaid_amount
           FROM tip_pool_payouts pp
           JOIN tip_pools tp ON tp.id = pp.pool_id
          WHERE ${where}`,
        params
      );

      res.json({ payouts: rows, summary: summary[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
