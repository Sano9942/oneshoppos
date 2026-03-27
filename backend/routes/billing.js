/**
 * backend/routes/billing.js — Tenant-facing billing endpoints.
 *
 * GET  /api/billing/status   — Authenticated. Returns tenant billing info + upgrade options.
 * POST /api/billing/request-upgrade — Authenticated. Submit upgrade request (1 pending max).
 */

module.exports = function registerBillingRoutes(app, deps) {
  const db = require("../db-pg");
  const masterDb = require("../master-db-pg");

  // ── Billing Status ─────────────────────────────────────────────────────
  app.get("/api/billing/status", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const { rows: pricing } = await db.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );

      const planRank = { free: 0, starter: 1, pro: 2 };
      const currentRank = planRank[tenant.plan] || 0;
      const upgradeOptions = pricing.filter((p) => (planRank[p.plan] || 0) > currentRank);

      const { rows: [pendingReq] } = await db.query(
        "SELECT id, requested_plan, requested_cycle, created_at FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
        [tenantId]
      );

      res.json({
        plan: tenant.plan,
        billing_cycle: tenant.billing_cycle || null,
        expires_at: tenant.plan_expires_at || null,
        grace_ends_at: tenant.grace_ends_at || null,
        payment_status: tenant.payment_status || "active",
        upgrade_options: upgradeOptions,
        pending_request: pendingReq || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Request Upgrade ────────────────────────────────────────────────────
  app.post("/api/billing/request-upgrade", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const { plan, cycle, message } = req.body;
      if (!plan || !cycle) return res.status(400).json({ error: "plan and cycle are required" });
      if (!["starter", "pro"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
      if (!["monthly", "annual"].includes(cycle)) return res.status(400).json({ error: "Invalid cycle" });

      const { rows: existing } = await db.query(
        "SELECT id FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending'",
        [tenantId]
      );
      if (existing.length) {
        return res.status(409).json({ error: "You already have a pending upgrade request" });
      }

      await db.query(
        `INSERT INTO upgrade_requests (tenant_id, requested_plan, requested_cycle, message)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, plan, cycle, message || null]
      );

      res.json({ ok: true, message: "Upgrade request submitted. We'll be in touch shortly." });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
