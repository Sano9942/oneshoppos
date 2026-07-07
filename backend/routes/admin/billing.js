/**
 * Admin billing — plan pricing, payments, upgrade requests, billing attention.
 */
const { recordLifecycleEvent } = require("../../services/lifecycle-events");

module.exports = function registerBillingRoutes(app, deps) {
  const { db, masterDb, requireAllowedIp, requireSuperAdmin, tenantDbManager, PLAN_DEFAULTS, auditLog, logAdminAction } = deps;

  // ── Plan Pricing CRUD ──────────────────────────────────────────────────
  app.get("/api/admin/plan-pricing", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await masterDb.query(
        "SELECT * FROM plan_pricing ORDER BY plan, cycle"
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/plan-pricing/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { price, is_active } = req.body;

      const sets = [];
      const vals = [];
      let idx = 1;

      if (price !== undefined) {
        sets.push(`price = $${idx++}`);
        vals.push(price);
      }
      if (is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        vals.push(is_active);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: "Nothing to update" });
      }

      vals.push(id);
      const { rows } = await masterDb.query(
        `UPDATE plan_pricing SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        vals
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Pricing row not found" });
      }
      logAdminAction(req.admin.email, "pricing_updated", "plan", req.params.id, req.body, req.ip);
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Bulk lifecycle (trial extend / expire) ─────────────────────────────
  // Batch tool for managing trial fleets (e.g. the golv_* test tenants).
  // extend_trial: pushes trial_ends_at forward from whichever is later
  // (current trial end or now) and puts the tenant back in 'trial' state.
  // expire_now: payment_status='expired' — requireActiveSubscription blocks
  // writes on next request (free-plan tenants stay usable by design).
  app.post("/api/admin/tenants/bulk-lifecycle", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { tenant_ids, action } = req.body || {};
      const days = Number(req.body?.days) || 30;
      if (!Array.isArray(tenant_ids) || tenant_ids.length === 0) {
        return res.status(400).json({ error: "tenant_ids array is required" });
      }
      if (tenant_ids.length > 100) {
        return res.status(400).json({ error: "Max 100 tenants per batch" });
      }
      if (!["extend_trial", "expire_now"].includes(action)) {
        return res.status(400).json({ error: "action must be 'extend_trial' or 'expire_now'" });
      }
      if (action === "extend_trial" && (days < 1 || days > 365)) {
        return res.status(400).json({ error: "days must be between 1 and 365" });
      }

      const ids = tenant_ids.map((n) => parseInt(n, 10)).filter(Number.isInteger);
      let updated;
      if (action === "extend_trial") {
        ({ rows: updated } = await db.query(
          `UPDATE tenants
           SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + make_interval(days => $1),
               payment_status = 'trial',
               grace_ends_at = NULL,
               updated_at = NOW()
           WHERE id = ANY($2) AND status != 'deleted'
           RETURNING id, slug, trial_ends_at, payment_status`,
          [days, ids]
        ));
      } else {
        ({ rows: updated } = await db.query(
          `UPDATE tenants
           SET payment_status = 'expired', updated_at = NOW()
           WHERE id = ANY($1) AND status != 'deleted'
           RETURNING id, slug, trial_ends_at, payment_status`,
          [ids]
        ));
      }

      for (const t of updated) {
        await auditLog(t.id, `bulk_${action}`, action === "extend_trial" ? { days } : null, `admin:${req.admin.email}`);
        await recordLifecycleEvent(t.id, action === "extend_trial" ? "trial_extended" : "expired",
          action === "extend_trial" ? { days } : { via: "bulk_expire" });
      }
      logAdminAction(req.admin.email, "bulk_lifecycle", "tenants", null,
        { action, days: action === "extend_trial" ? days : undefined, count: updated.length, tenant_ids: updated.map((t) => t.id) }, req.ip);
      return res.json({ action, updated: updated.length, tenants: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Global payments list ───────────────────────────────────────────────
  app.get("/api/admin/payments", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const { rows } = await masterDb.query(
        `SELECT pr.*, t.slug AS tenant_slug, t.name AS tenant_name
         FROM payment_records pr
         LEFT JOIN tenants t ON t.id = pr.tenant_id
         ORDER BY pr.recorded_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const { rows: [count] } = await masterDb.query("SELECT COUNT(*)::int AS total FROM payment_records");
      return res.json({ payments: rows, total: count.total, limit, offset });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Record Payment ─────────────────────────────────────────────────────
  app.post("/api/admin/tenants/:id/record-payment", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.id, 10);
      const { plan, cycle, amount, payment_method, reference_note } = req.body;

      if (!plan || !cycle || !amount) {
        return res.status(400).json({ error: "plan, cycle, and amount are required" });
      }

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const now = new Date();
      const periodStart = now;
      const daysToAdd = cycle === "annual" ? 365 : 30;
      const periodEnd = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const graceEnd = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

      const limits = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.free;

      await masterDb.query(
        `UPDATE tenants
         SET plan = $1,
             billing_cycle = $2,
             plan_expires_at = $3,
             grace_ends_at = $4,
             payment_status = 'active',
             max_employees = $5,
             max_outlets = $6,
             max_products = $7,
             updated_at = NOW()
         WHERE id = $8`,
        [plan, cycle, periodEnd.toISOString(), graceEnd.toISOString(),
         limits.max_employees, limits.max_outlets, limits.max_products, tenantId]
      );

      await masterDb.query(
        `INSERT INTO payment_records
           (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, reference_note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tenantId, amount, plan, cycle, periodStart.toISOString(), periodEnd.toISOString(),
         payment_method || null, reference_note || null, req.admin.email]
      );

      await auditLog(tenantId, "payment_recorded", { plan, cycle, amount, payment_method }, `admin:${req.admin.email}`);

      try {
        const tenantDb = await tenantDbManager.getDb(tenantId);
        const { rows: [profile] } = await tenantDb.query("SELECT email FROM company_profile WHERE id = 1");
        if (profile?.email) {
          const { sendEmail } = require("../../services/email");
          sendEmail({
            type: "billing_payment_recorded",
            to: profile.email,
            data: {
              storeName: tenant?.name || "Your store",
              amount: `${amount}`,
              plan,
              cycle,
              periodEnd: periodEnd.toLocaleDateString(),
            },
          }).catch((err) => console.error("Billing payment email failed:", err.message));
        }
      } catch (emailErr) {
        console.error("Billing payment email lookup failed:", emailErr.message);
      }

      logAdminAction(req.admin.email, "payment_recorded", "tenant", req.params.id, { amount: req.body.amount, method: req.body.method }, req.ip);
      await recordLifecycleEvent(parseInt(req.params.id, 10), "payment_recorded", { amount: req.body.amount, method: req.body.method, plan, cycle });
      return res.json({
        ok: true,
        plan,
        cycle,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        grace_ends_at: graceEnd.toISOString(),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Payment History ────────────────────────────────────────────────────
  app.get("/api/admin/tenants/:id/payments", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenantId = parseInt(req.params.id, 10);
      const { rows } = await masterDb.query(
        "SELECT * FROM payment_records WHERE tenant_id = $1 ORDER BY recorded_at DESC",
        [tenantId]
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Upgrade Requests ───────────────────────────────────────────────────
  app.get("/api/admin/upgrade-requests", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { rows } = await masterDb.query(
        `SELECT ur.*, t.slug, t.name AS tenant_name, t.plan AS current_plan
         FROM upgrade_requests ur
         JOIN tenants t ON t.id = ur.tenant_id
         WHERE ur.status = 'pending'
         ORDER BY ur.created_at ASC`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/upgrade-requests/:id", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["approved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "status must be 'approved' or 'dismissed'" });
      }

      const { rows } = await masterDb.query(
        `UPDATE upgrade_requests
         SET status = $1, resolved_at = NOW(), resolved_by = $2
         WHERE id = $3
         RETURNING *`,
        [status, req.admin.email, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Upgrade request not found" });
      }

      logAdminAction(req.admin.email, "upgrade_request_" + status, "tenant", req.params.id, null, req.ip);
      if (status === "approved") {
        await recordLifecycleEvent(rows[0].tenant_id, "plan_changed", { via: "upgrade_request", requested_plan: rows[0].requested_plan || null });
      }
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Billing Attention ──────────────────────────────────────────────────
  app.get("/api/admin/billing-attention", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const dueSoon = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at
         FROM tenants
         WHERE status = 'active'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at > $1
           AND plan_expires_at <= $2
         ORDER BY plan_expires_at ASC`,
        [now, sevenDays]
      );

      const overdue = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at, grace_ends_at
         FROM tenants
         WHERE status = 'active'
           AND plan_expires_at IS NOT NULL
           AND plan_expires_at < $1
           AND grace_ends_at IS NOT NULL
           AND grace_ends_at >= $1
         ORDER BY plan_expires_at ASC`,
        [now]
      );

      const pastGrace = await masterDb.query(
        `SELECT id, slug, name, plan, plan_expires_at, grace_ends_at
         FROM tenants
         WHERE status = 'active'
           AND grace_ends_at IS NOT NULL
           AND grace_ends_at < $1
         ORDER BY grace_ends_at ASC`,
        [now]
      );

      const upgradeCount = await masterDb.query(
        "SELECT COUNT(*)::int AS count FROM upgrade_requests WHERE status = 'pending'"
      );

      return res.json({
        due_soon: dueSoon.rows,
        overdue: overdue.rows,
        past_grace: pastGrace.rows,
        pending_upgrades: upgradeCount.rows[0].count,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── Stuck Payment Intents ──────────────────────────────────────────────
  // Returns payment_intents that have been in 'pending' state longer than
  // the threshold (default 2 hours). Used by AdminStuckPayments.jsx.
  app.get("/api/admin/payment-intents/stuck", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const hours = Math.max(0, Number(req.query.hours || 2));
      const { rows } = await masterDb.query(
        `SELECT pi.id, pi.tenant_id, pi.amount, pi.currency_code, pi.plan, pi.cycle,
                pi.status, pi.gateway, pi.gateway_ref, pi.created_at,
                t.name AS tenant_name, t.slug AS tenant_slug
         FROM payment_intents pi
         JOIN tenants t ON pi.tenant_id = t.id
         WHERE pi.status = 'pending'
           AND pi.created_at < NOW() - ($1 || ' hours')::INTERVAL
         ORDER BY pi.created_at ASC
         LIMIT 100`,
        [hours]
      );
      return res.json({ intents: rows, threshold_hours: hours });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
};
