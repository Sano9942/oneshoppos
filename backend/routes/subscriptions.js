/**
 * backend/routes/subscriptions.js — Subscription plans + customer subscriptions.
 *
 * GET    /api/subscription-plans              — List active plans
 * POST   /api/subscription-plans              — Create plan
 * PUT    /api/subscription-plans/:id          — Update plan
 * GET    /api/customer-subscriptions          — List subscriptions
 * POST   /api/customer-subscriptions          — Create subscription
 * PUT    /api/customer-subscriptions/:id      — Update metadata
 * POST   /api/customer-subscriptions/:id/pause   — Pause
 * POST   /api/customer-subscriptions/:id/resume  — Resume
 * POST   /api/customer-subscriptions/:id/cancel  — Cancel
 */

module.exports = function registerSubscriptionRoutes(app, deps) {
  const { requireFeature } = require("../middleware/feature-flags");
  const { requirePerm } = require("../middleware/permissions");
  const { validate } = require("../middleware/validate");
  const { createPlanSchema, updatePlanSchema, createSubscriptionSchema } = require("../schemas/subscriptions");
  const {
    computeNextPeriod,
    cancelSubscription,
    pauseSubscription,
    resumeSubscription,
  } = require("../services/subscriptions");
  const { getBoss } = require("../services/boss");

  const gate = [requireFeature("subscription_billing"), requirePerm("all_access")];

  // ── Plans ─────────────────────────────────────────────────────────────

  app.get("/api/subscription-plans", ...gate, async (req, res) => {
    try {
      const { rows } = await deps.db.query(
        "SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price ASC"
      );
      res.json({ plans: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/subscription-plans", ...gate, validate(createPlanSchema), async (req, res) => {
    try {
      const { name, description, price, billing_interval, billing_interval_count, trial_days } = req.body;
      const { rows: [plan] } = await deps.db.query(
        `INSERT INTO subscription_plans (name, description, price, billing_interval, billing_interval_count, trial_days)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, description || null, price, billing_interval, billing_interval_count, trial_days]
      );
      res.status(201).json(plan);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/subscription-plans/:id", ...gate, validate(updatePlanSchema), async (req, res) => {
    try {
      const sets = [];
      const params = [];
      let idx = 1;

      for (const field of ["name", "description", "price", "is_active"]) {
        if (req.body[field] !== undefined) {
          sets.push(`${field} = $${idx}`);
          params.push(req.body[field]);
          idx++;
        }
      }
      if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });

      sets.push("updated_at = NOW()");
      params.push(req.params.id);

      const { rows: [plan] } = await deps.db.query(
        `UPDATE subscription_plans SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      res.json(plan);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Customer Subscriptions ────────────────────────────────────────────

  app.get("/api/customer-subscriptions", ...gate, async (req, res) => {
    try {
      const { status, customer_id } = req.query;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;

      const conditions = [];
      const params = [];
      let idx = 1;

      if (status) {
        conditions.push(`cs.status = $${idx}`);
        params.push(status);
        idx++;
      }
      if (customer_id) {
        conditions.push(`cs.customer_id = $${idx}`);
        params.push(Number(customer_id));
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const { rows } = await deps.db.query(
        `SELECT cs.*, sp.name AS plan_name, sp.price AS plan_price, sp.billing_interval,
           c.name AS customer_name
         FROM customer_subscriptions cs
         JOIN subscription_plans sp ON sp.id = cs.plan_id
         LEFT JOIN customers c ON c.id = cs.customer_id
         ${where}
         ORDER BY cs.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      const { rows: [{ cnt }] } = await deps.db.query(
        `SELECT COUNT(*)::int AS cnt FROM customer_subscriptions cs ${where}`,
        params
      );

      res.json({ subscriptions: rows, total: cnt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/customer-subscriptions", ...gate, validate(createSubscriptionSchema), async (req, res) => {
    try {
      const { plan_id, customer_id, auto_charge } = req.body;

      // Load plan
      const { rows: [plan] } = await deps.db.query("SELECT * FROM subscription_plans WHERE id = $1", [plan_id]);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (!plan.is_active) return res.status(400).json({ error: "Plan is not active" });

      const now = new Date();
      const { end } = computeNextPeriod(now, plan.billing_interval, plan.billing_interval_count);
      const trialEnd = plan.trial_days > 0 ? new Date(now.getTime() + plan.trial_days * 86400000) : null;
      const periodEnd = trialEnd || end;

      const { rows: [sub] } = await deps.db.query(
        `INSERT INTO customer_subscriptions
           (plan_id, customer_id, status, current_period_start, current_period_end, trial_end, auto_charge)
         VALUES ($1, $2, 'active', $3, $4, $5, $6) RETURNING *`,
        [plan_id, customer_id, now, periodEnd, trialEnd, auto_charge || false]
      );

      // Schedule first renewal at period end. tenantSlug is required so
      // the worker can set search_path when the job fires.
      const boss = await getBoss();
      await boss.send(
        "subscription-renewal",
        { tenantSlug: req.tenantSlug, subscriptionId: sub.id },
        { startAfter: periodEnd }
      );

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "subscription_created", JSON.stringify({ subscription_id: sub.id, plan_id })]); } catch {}

      res.status(201).json(sub);
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post("/api/customer-subscriptions/:id/pause", ...gate, async (req, res) => {
    try {
      const sub = await pauseSubscription(deps.db, Number(req.params.id));
      if (!sub) return res.status(400).json({ error: "Subscription is not active or not found" });

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "subscription_paused", JSON.stringify({ subscription_id: Number(req.params.id) })]); } catch {}

      res.json(sub);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/customer-subscriptions/:id/resume", ...gate, async (req, res) => {
    try {
      const boss = await getBoss();
      const sub = await resumeSubscription(deps.db, boss, req.tenantSlug, Number(req.params.id));
      if (!sub) return res.status(400).json({ error: "Subscription is not paused or not found" });

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "subscription_resumed", JSON.stringify({ subscription_id: Number(req.params.id) })]); } catch {}

      res.json(sub);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/customer-subscriptions/:id/cancel", ...gate, async (req, res) => {
    try {
      const sub = await cancelSubscription(deps.db, Number(req.params.id));
      if (!sub) return res.status(404).json({ error: "Subscription not found" });

      try { await deps.db.query("INSERT INTO action_history (employee_id, action, details) VALUES ($1, $2, $3)", [req.employee.id, "subscription_cancelled", JSON.stringify({ subscription_id: Number(req.params.id) })]); } catch {}

      res.json(sub);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
