/**
 * backend/routes/billing.js — Tenant-facing billing endpoints.
 *
 * GET  /api/billing/status          — Billing info + upgrade options + trial status.
 * GET  /api/billing/pricing         — Public pricing (no auth).
 * GET  /api/billing/payment-history — Payment records for tenant.
 * POST /api/billing/request-upgrade — Submit upgrade request (manual path).
 * POST /api/billing/create-checkout — Create gateway checkout session (automated path).
 */

module.exports = function registerBillingRoutes(app, deps) {
  const db = require("../db-pg");
  const masterDb = require("../master-db-pg");
  const paymentGateway = require("../services/payment-gateway");

  // ── Public Pricing ─────────────────────────────────────────────────────
  // Use db.pool directly (raw pg pool) to query public schema without tenant context
  app.get("/api/billing/pricing", async (req, res) => {
    try {
      const { rows } = await db.pool.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

      const planRank = { free: 0, pro: 1 };
      const currentRank = planRank[tenant.plan] || 0;
      const upgradeOptions = pricing.filter((p) => (planRank[p.plan] || 0) > currentRank);

      const { rows: [pendingReq] } = await db.query(
        "SELECT id, requested_plan, requested_cycle, created_at FROM upgrade_requests WHERE tenant_id = $1 AND status = 'pending' LIMIT 1",
        [tenantId]
      );

      let trial_days_left = null;
      let grace_days_left = null;
      if (tenant.payment_status === "trial" && tenant.trial_ends_at) {
        trial_days_left = Math.max(0, Math.ceil((new Date(tenant.trial_ends_at) - new Date()) / 86400000));
      }
      if (tenant.payment_status === "grace" && tenant.grace_ends_at) {
        grace_days_left = Math.max(0, Math.ceil((new Date(tenant.grace_ends_at) - new Date()) / 86400000));
      }

      res.json({
        plan: tenant.plan,
        billing_cycle: tenant.billing_cycle || null,
        expires_at: tenant.plan_expires_at || null,
        trial_ends_at: tenant.trial_ends_at || null,
        grace_ends_at: tenant.grace_ends_at || null,
        payment_status: tenant.payment_status || "active",
        trial_days_left,
        grace_days_left,
        payment_enabled: paymentGateway.isEnabled(),
        upgrade_options: upgradeOptions,
        pending_request: pendingReq || null,
        max_outlets: tenant.max_outlets || 1,
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
      if (!["pro"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
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

  // ── Create Checkout ──────────────────────────────────────────────────
  app.post("/api/billing/create-checkout", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      if (!paymentGateway.isEnabled()) {
        return res.status(400).json({ error: "Online payments are not configured. Contact support to subscribe." });
      }

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      // Guard: don't allow double-pay if subscription has 7+ days remaining
      if (tenant.payment_status === "active" && tenant.plan_expires_at) {
        const daysLeft = Math.ceil((new Date(tenant.plan_expires_at) - new Date()) / 86400000);
        if (daysLeft > 7) {
          return res.status(400).json({
            error: `Your subscription is active until ${new Date(tenant.plan_expires_at).toLocaleDateString()}. You can renew within the last 7 days.`,
          });
        }
      }

      const { cycle = "monthly" } = req.body;
      if (!["monthly", "annual"].includes(cycle)) {
        return res.status(400).json({ error: "Invalid cycle" });
      }

      const plan = "pro";
      const outletCount = Math.max(1, tenant.max_outlets || 1);
      const pricePerOutlet = cycle === "annual" ? 80000 : 8000;
      const amount = pricePerOutlet * outletCount;

      const gateway = process.env.PAYMENT_GATEWAY || "manual";
      const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";

      // Create payment intent record
      const { rows: [intent] } = await masterDb.query(
        `INSERT INTO payment_intents (tenant_id, amount, plan, cycle, outlet_count, gateway, return_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, amount, plan, cycle, outletCount, gateway, `${frontendUrl}/billing`]
      );

      // Call gateway to create checkout session
      const { checkout_url, gateway_ref } = await paymentGateway.createCheckout({
        amount,
        currency: "PKR",
        reference: intent.id,
        description: `SanoPOS Pro — ${cycle} (${outletCount} outlet${outletCount > 1 ? "s" : ""})`,
        returnUrl: `${frontendUrl}/billing?payment=success&intent=${intent.id}`,
        cancelUrl: `${frontendUrl}/billing?payment=cancelled&intent=${intent.id}`,
      });

      // Store gateway reference
      await masterDb.query(
        "UPDATE payment_intents SET gateway_ref = $1 WHERE id = $2",
        [gateway_ref, intent.id]
      );

      res.json({ checkout_url, payment_intent_id: intent.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Payment History ──────────────────────────────────────────────────
  app.get("/api/billing/payment-history", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const { rows } = await masterDb.query(
        `SELECT id, amount, currency_code, plan, cycle, period_start, period_end, payment_method, recorded_at
         FROM payment_records
         WHERE tenant_id = $1
         ORDER BY recorded_at DESC
         LIMIT 24`,
        [tenantId]
      );

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
