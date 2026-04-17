const { validate } = require("../middleware/validate");
const { createPlanSchema, updatePlanSchema } = require("../schemas/commissions");

module.exports = function registerCommissionRoutes(app, deps) {
  const { db, requirePerm, requireAnyPerm, requireFeature } = deps;
  const feat = requireFeature("phase2_commissions");

  // ── Commission Plans CRUD ──────────────────────────────────────────

  // GET /api/commission-plans
  app.get("/api/commission-plans", feat, requirePerm("all_access"), async (req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT cp.*,
                json_agg(json_build_object(
                  'id', cpr.id, 'scope_type', cpr.scope_type, 'scope_id', cpr.scope_id,
                  'rate', cpr.rate, 'min_threshold', cpr.min_threshold, 'max_cap', cpr.max_cap,
                  'priority', cpr.priority
                ) ORDER BY cpr.priority DESC) FILTER (WHERE cpr.id IS NOT NULL) AS rules,
                (SELECT COUNT(*) FROM employees e WHERE e.commission_plan_id = cp.id AND e.deleted_at IS NULL) AS assigned_employees
         FROM commission_plans cp
         LEFT JOIN commission_plan_rules cpr ON cpr.plan_id = cp.id
         GROUP BY cp.id
         ORDER BY cp.name`
      );
      res.json({ plans: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commission-plans
  app.post("/api/commission-plans", feat, requirePerm("all_access"), validate(createPlanSchema), async (req, res) => {
    const { name, description, type, starts_at, ends_at, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO commission_plans (name, description, type, starts_at, ends_at)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [name, description || null, type, starts_at || null, ends_at || null]
        );
        const plan = rows[0];
        for (const rule of rules) {
          await client.query(
            `INSERT INTO commission_plan_rules (plan_id, scope_type, scope_id, rate, min_threshold, max_cap, priority)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [plan.id, rule.scope_type, rule.scope_id || null, rule.rate, rule.min_threshold || 0, rule.max_cap || null, rule.priority || 0]
          );
        }
        return plan;
      });
      res.status(201).json({ plan: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/commission-plans/:id
  app.put("/api/commission-plans/:id", feat, requirePerm("all_access"), validate(updatePlanSchema), async (req, res) => {
    const { name, description, type, is_active, starts_at, ends_at, rules } = req.body;
    try {
      const result = await db.transaction(async (client) => {
        const { rows: existing } = await client.query("SELECT * FROM commission_plans WHERE id = $1", [req.params.id]);
        if (!existing.length) return null;

        const sets = [];
        const vals = [];
        let idx = 1;
        if (name !== undefined) { sets.push(`name = $${idx}`); vals.push(name); idx++; }
        if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
        if (type !== undefined) { sets.push(`type = $${idx}`); vals.push(type); idx++; }
        if (is_active !== undefined) { sets.push(`is_active = $${idx}`); vals.push(is_active); idx++; }
        if (starts_at !== undefined) { sets.push(`starts_at = $${idx}`); vals.push(starts_at); idx++; }
        if (ends_at !== undefined) { sets.push(`ends_at = $${idx}`); vals.push(ends_at); idx++; }
        sets.push(`updated_at = NOW()`);

        vals.push(req.params.id);
        const { rows: updated } = await client.query(
          `UPDATE commission_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
        );

        if (rules) {
          await client.query("DELETE FROM commission_plan_rules WHERE plan_id = $1", [req.params.id]);
          for (const rule of rules) {
            await client.query(
              `INSERT INTO commission_plan_rules (plan_id, scope_type, scope_id, rate, min_threshold, max_cap, priority)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [req.params.id, rule.scope_type, rule.scope_id || null, rule.rate, rule.min_threshold || 0, rule.max_cap || null, rule.priority || 0]
            );
          }
        }
        return updated[0];
      });
      if (!result) return res.status(404).json({ error: "Plan not found" });
      res.json({ plan: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/commission-plans/:id
  app.delete("/api/commission-plans/:id", feat, requirePerm("all_access"), async (req, res) => {
    try {
      await db.query("UPDATE employees SET commission_plan_id = NULL WHERE commission_plan_id = $1", [req.params.id]);
      const { rowCount } = await db.query("DELETE FROM commission_plans WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Plan not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commission-plans/:id/assign
  // Body: { employee_ids: [1, 2, 3] }
  app.post("/api/commission-plans/:id/assign", feat, requirePerm("all_access"), async (req, res) => {
    const { employee_ids } = req.body;
    if (!Array.isArray(employee_ids)) return res.status(400).json({ error: "employee_ids array required" });
    try {
      const { rows } = await db.query("SELECT id FROM commission_plans WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Plan not found" });

      await db.query(
        "UPDATE employees SET commission_plan_id = $1 WHERE id = ANY($2) AND deleted_at IS NULL",
        [req.params.id, employee_ids]
      );
      res.json({ success: true, assigned: employee_ids.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Commission Earnings ────────────────────────────────────────────

  // GET /api/commissions/earnings
  // earning_type filter: "commission" | "tip" | "both" (default — no filter).
  // After Phase 2.1 C tip rows live in this table with sale_id+plan_id NULL,
  // so the legacy JOINs are now LEFT to keep tips visible.
  app.get("/api/commissions/earnings", feat, requireAnyPerm(["all_access", "view_reports"]), async (req, res) => {
    const { employee_id, status, from, to, earning_type } = req.query;
    try {
      let where = "1=1";
      const params = [];
      let idx = 1;

      if (employee_id) { where += ` AND ce.employee_id = $${idx}`; params.push(employee_id); idx++; }
      if (status) { where += ` AND ce.status = $${idx}`; params.push(status); idx++; }
      if (from) { where += ` AND ce.created_at >= $${idx}`; params.push(from); idx++; }
      if (to) { where += ` AND ce.created_at < $${idx}`; params.push(to); idx++; }
      if (earning_type && earning_type !== "both") {
        where += ` AND ce.earning_type = $${idx}`;
        params.push(earning_type);
        idx++;
      }

      const { rows } = await db.query(
        `SELECT ce.*, e.name AS employee_name, cp.name AS plan_name, s.invoice_number
         FROM commission_earnings ce
         JOIN employees e ON e.id = ce.employee_id
         LEFT JOIN commission_plans cp ON cp.id = ce.plan_id
         LEFT JOIN sales s ON s.id = ce.sale_id
         WHERE ${where}
         ORDER BY ce.created_at DESC
         LIMIT 500`,
        params
      );

      const { rows: summary } = await db.query(
        `SELECT
           COUNT(*) AS total_records,
           SUM(commission_amount) FILTER (WHERE status = 'pending') AS pending_total,
           SUM(commission_amount) FILTER (WHERE status = 'approved') AS approved_total,
           SUM(commission_amount) FILTER (WHERE status = 'paid') AS paid_total,
           SUM(commission_amount) FILTER (WHERE earning_type = 'commission') AS commission_total,
           SUM(commission_amount) FILTER (WHERE earning_type = 'tip') AS tip_total
         FROM commission_earnings ce
         WHERE ${where}`,
        params
      );

      res.json({ earnings: rows, summary: summary[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/commissions/earnings/:id/status
  // Body: { status: "approved" | "paid" | "reversed", reversal_reason? }
  app.put("/api/commissions/earnings/:id/status", feat, requirePerm("all_access"), async (req, res) => {
    const { status, reversal_reason } = req.body;
    const validTransitions = {
      pending: ["approved", "reversed"],
      approved: ["paid", "reversed"],
    };
    try {
      const { rows } = await db.query("SELECT * FROM commission_earnings WHERE id = $1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Earning not found" });

      const current = rows[0];
      if (!validTransitions[current.status]?.includes(status)) {
        return res.status(400).json({ error: `Cannot transition from ${current.status} to ${status}` });
      }

      const sets = [`status = $1`];
      const vals = [status];
      if (status === "approved") { sets.push("approved_at = NOW()"); }
      if (status === "paid") { sets.push("paid_at = NOW()"); }
      if (status === "reversed") { sets.push("reversed_at = NOW()"); sets.push(`reversal_reason = $2`); vals.push(reversal_reason || null); }

      vals.push(req.params.id);
      const { rows: updated } = await db.query(
        `UPDATE commission_earnings SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
      );
      res.json({ earning: updated[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/commissions/calculate — manual recalculation for a sale
  // Body: { sale_id }
  app.post("/api/commissions/calculate", feat, async (req, res) => {
    const { sale_id } = req.body;
    if (!sale_id) return res.status(400).json({ error: "sale_id required" });
    try {
      const { rows: saleRows } = await db.query(
        `SELECT s.*, e.commission_plan_id
         FROM sales s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.id = $1 AND s.voided = FALSE`,
        [sale_id]
      );
      if (!saleRows.length) return res.status(404).json({ error: "Sale not found or voided" });
      const sale = saleRows[0];
      if (!sale.commission_plan_id) return res.json({ earnings: [], message: "Employee has no commission plan" });

      const { rows: planRows } = await db.query(
        `SELECT * FROM commission_plans WHERE id = $1 AND is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= $2) AND (ends_at IS NULL OR ends_at >= $2)`,
        [sale.commission_plan_id, sale.timestamp]
      );
      if (!planRows.length) return res.json({ earnings: [], message: "Commission plan not active" });
      const plan = planRows[0];

      const { rows: rules } = await db.query(
        "SELECT * FROM commission_plan_rules WHERE plan_id = $1 ORDER BY priority DESC", [plan.id]
      );

      const { rows: items } = await db.query(
        `SELECT si.*, p.category_id, p.brand_id
         FROM sale_items si
         JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = $1`,
        [sale_id]
      );

      let totalCommission = 0;
      const earnings = [];

      if (plan.type === "percentage" || plan.type === "tiered") {
        for (const item of items) {
          const matchedRule = rules.find(r => {
            if (r.scope_type === "all") return true;
            if (r.scope_type === "product" && r.scope_id === item.product_id) return true;
            if (r.scope_type === "category" && r.scope_id === item.category_id) return true;
            if (r.scope_type === "brand" && r.scope_id === item.brand_id) return true;
            return false;
          });
          if (!matchedRule) continue;

          const itemTotal = Number(item.price_at_sale) * item.quantity;
          if (itemTotal < Number(matchedRule.min_threshold)) continue;

          let commission = itemTotal * Number(matchedRule.rate) / 100;
          if (matchedRule.max_cap && commission > Number(matchedRule.max_cap)) {
            commission = Number(matchedRule.max_cap);
          }
          totalCommission += commission;
        }

        if (totalCommission > 0) {
          const bestRule = rules[0];
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, bestRule?.id || null,
             Number(sale.total_amount), Math.round(totalCommission * 100) / 100]
          );
          earnings.push(inserted[0]);
        }
      } else if (plan.type === "fixed_per_sale") {
        const rule = rules[0];
        if (rule && Number(sale.total_amount) >= Number(rule.min_threshold)) {
          const commission = Math.min(Number(rule.rate), rule.max_cap ? Number(rule.max_cap) : Infinity);
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, rule.id, Number(sale.total_amount), commission]
          );
          earnings.push(inserted[0]);
        }
      } else if (plan.type === "fixed_per_item") {
        const rule = rules[0];
        if (rule) {
          const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
          const commission = Math.min(totalQty * Number(rule.rate), rule.max_cap ? Number(rule.max_cap) : Infinity);
          const { rows: inserted } = await db.query(
            `INSERT INTO commission_earnings (employee_id, sale_id, plan_id, rule_id, sale_amount, commission_amount)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [sale.employee_id, sale_id, plan.id, rule.id, Number(sale.total_amount), commission]
          );
          earnings.push(inserted[0]);
        }
      }

      res.json({ earnings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
