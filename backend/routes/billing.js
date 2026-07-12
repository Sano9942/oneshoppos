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
  const tenantDb = deps.db; // tenant-scoped Proxy for /usage queries
  const masterDb = require("../master-db-pg");
  const paymentGateway = require("../services/payment-gateway");
  const { validate } = require("../middleware/validate");
  // §9.3 (Step 4): billable plan changes are owner actions — guard matches the
  // frontend, where /billing is already perm("all_access").
  const { requirePerm } = require("../middleware/permissions");
  const { RequestUpgradeSchema, CreateCheckoutSchema } = require("../schemas/billing");

  /**
   * @swagger
   * /api/billing/pricing:
   *   get:
   *     summary: Get subscription pricing
   *     description: Returns available subscription plans and their pricing tiers. Public endpoint — no auth required.
   *     tags: [Billing]
   *     responses:
   *       200:
   *         description: Pricing tiers
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 plans:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       plan: { type: string }
   *                       price_monthly: { type: number }
   *                       price_yearly: { type: number }
   *                       features: { type: object }
   */
  // ── Public Pricing ─────────────────────────────────────────────────────
  // Use db.pool directly (raw pg pool) to query public schema without tenant context
  app.get("/api/billing/pricing", async (req, res) => {
    try {
      const { rows } = await db.pool.query(
        "SELECT plan, cycle, price, currency_code FROM plan_pricing WHERE is_active = true ORDER BY plan, cycle"
      );

      // Build a lookup of monthly prices per plan for discount calculation
      const monthlyPrices = {};
      for (const r of rows) {
        if (r.cycle === "monthly") monthlyPrices[r.plan] = Number(r.price);
      }

      const CYCLE_MONTHS = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };

      const enriched = rows.map(r => {
        const price = Number(r.price);
        const months = CYCLE_MONTHS[r.cycle] || 1;
        const monthly_equivalent = Math.round(price / months);
        const monthly_price = monthlyPrices[r.plan] || monthly_equivalent;
        const discount_percent = monthly_price > 0
          ? Math.round((1 - monthly_equivalent / monthly_price) * 100)
          : 0;
        const savings = (monthly_price * months) - price;
        return {
          plan: r.plan,
          cycle: r.cycle,
          price,
          currency_code: r.currency_code,
          months,
          monthly_equivalent,
          discount_percent: Math.max(0, discount_percent),
          savings: Math.max(0, savings),
        };
      });

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/billing/status:
   *   get:
   *     summary: Get tenant billing status
   *     description: Returns current subscription status including plan, trial/grace period, payment history, and whether payment gateway is enabled.
   *     tags: [Billing]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Billing status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 plan: { type: string }
   *                 status: { type: string, enum: [trial, active, grace, expired] }
   *                 trial_ends_at: { type: string, format: date-time, nullable: true }
   *                 payment_enabled: { type: boolean }
   *                 days_remaining: { type: integer }
   *       401:
   *         description: Unauthorized
   */
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

      // Compute next renewal date from expiry
      let next_renewal_date = null;
      if (tenant.plan_expires_at && tenant.payment_status === "active") {
        next_renewal_date = tenant.plan_expires_at;
      }

      // Multi-outlet seeded flag — read from tenant company_profile so the
      // dashboard banner can decide visibility without exposing the flag via
      // a separate endpoint. Best-effort; missing column (tenants on a stale
      // schema) silently returns false.
      let multi_outlet_flags_seeded = false;
      try {
        const { rows: [profile] } = await tenantDb.query(
          "SELECT multi_outlet_flags_seeded FROM company_profile WHERE id = 1"
        );
        multi_outlet_flags_seeded = profile?.multi_outlet_flags_seeded === true;
      } catch {
        // column not present — leave as false
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
        next_renewal_date,
        payment_enabled: paymentGateway.isEnabled(),
        upgrade_options: upgradeOptions,
        pending_request: pendingReq || null,
        max_outlets: tenant.max_outlets || 1,
        multi_outlet_flags_seeded,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Plan Usage (cap-hit UX) ────────────────────────────────────────────
  // Returns current vs. limit for the three capped resources. Frontend polls
  // this on the dashboard to show an amber "approaching plan limit" banner
  // (≥80%) and the upgrade-to-Pro modal triggered by 403 PLAN_LIMIT_REACHED
  // responses.
  //
  //   limit: null  → unlimited (Pro plan; max_* column is 0)
  //   limit: N     → cap; current >= N triggers a hard block on writes
  app.get("/api/billing/usage", async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const [empR, prodR, outR] = await Promise.all([
        tenantDb.query("SELECT COUNT(*) AS cnt FROM employees WHERE deleted_at IS NULL"),
        tenantDb.query("SELECT COUNT(*) AS cnt FROM products WHERE deleted_at IS NULL"),
        tenantDb.query("SELECT COUNT(*) AS cnt FROM outlets"),
      ]);

      // 0 in the master.tenants column means unlimited; surface that as null
      // so the frontend renders "unlimited" instead of "0 of 0".
      const asLimit = (n) => (n == null || Number(n) <= 0 ? null : Number(n));

      res.json({
        employees: { used: Number(empR.rows[0].cnt), limit: asLimit(tenant.max_employees) },
        products:  { used: Number(prodR.rows[0].cnt), limit: asLimit(tenant.max_products) },
        outlets:   { used: Number(outR.rows[0].cnt),  limit: asLimit(tenant.max_outlets) },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Request Upgrade ────────────────────────────────────────────────────
  app.post("/api/billing/request-upgrade", requirePerm("all_access"), validate(RequestUpgradeSchema), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const { plan, cycle, message } = req.body;

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

  // ── Add Outlet (Pro only — pay first, then create) ─────────────────────
  // Pro tenants pay for one extra outlet's worth of subscription. The webhook
  // (routes/webhooks.js context 1) bumps tenants.max_outlets via Math.max
  // when payment_intents.outlet_count is greater than the current limit, so
  // no webhook changes are needed.
  app.post("/api/billing/add-outlet", requirePerm("all_access"), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(400).json({ error: "Tenant context required" });

      const tenant = await masterDb.getTenantById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      // Free tenants must upgrade to Pro first — the upgrade flow uses
      // /api/billing/create-checkout, not this endpoint.
      if (tenant.plan !== "pro") {
        return res.status(400).json({
          error: "Upgrade to Pro before adding outlets.",
          code: "UPGRADE_REQUIRED",
        });
      }

      if (!paymentGateway.isEnabled()) {
        return res.status(400).json({ error: "Online payments are not configured. Contact support to add an outlet." });
      }

      const cycle = tenant.billing_cycle || "monthly";
      const newOutletCount = (tenant.max_outlets || 1) + 1;

      const { rows: [pricingRow] } = await db.pool.query(
        "SELECT price FROM plan_pricing WHERE plan = 'pro' AND cycle = $1 AND is_active = true",
        [cycle]
      );
      if (!pricingRow) {
        return res.status(400).json({ error: `No active pricing found for pro/${cycle}` });
      }
      const pricePerOutlet = Number(pricingRow.price);
      // Charge for the additional outlet only — webhook will bump max_outlets
      // via Math.max(current, newOutletCount), preserving the existing
      // subscription period.
      const amount = pricePerOutlet;

      const gateway = process.env.PAYMENT_GATEWAY || "manual";
      const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";

      const { rows: [intent] } = await masterDb.query(
        `INSERT INTO payment_intents (tenant_id, amount, plan, cycle, outlet_count, gateway, return_url, provider)
         VALUES ($1, $2, 'pro', $3, $4, $5, $6, $5)
         RETURNING id`,
        [tenantId, amount, cycle, newOutletCount, gateway, `${frontendUrl}/outlets`]
      );

      const { checkout_url, gateway_ref } = await paymentGateway.createCheckout({
        amount,
        currency: "PKR",
        reference: intent.id,
        description: `Add outlet (${newOutletCount} total) — Pro ${cycle}`,
        returnUrl: `${frontendUrl}/outlets?payment=success&intent=${intent.id}`,
        cancelUrl: `${frontendUrl}/outlets?payment=cancelled&intent=${intent.id}`,
      });

      await masterDb.query(
        "UPDATE payment_intents SET gateway_ref = $1 WHERE id = $2",
        [gateway_ref, intent.id]
      );

      res.json({ checkout_url, payment_intent_id: intent.id, new_outlet_count: newOutletCount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create Checkout ──────────────────────────────────────────────────
  app.post("/api/billing/create-checkout", requirePerm("all_access"), validate(CreateCheckoutSchema), async (req, res) => {
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

      const plan = "pro";
      const outletCount = Math.max(1, tenant.max_outlets || 1);

      // Look up price from plan_pricing table
      const { rows: [pricingRow] } = await db.pool.query(
        "SELECT price FROM plan_pricing WHERE plan = $1 AND cycle = $2 AND is_active = true",
        [plan, cycle]
      );
      if (!pricingRow) {
        return res.status(400).json({ error: `No active pricing found for ${plan}/${cycle}` });
      }
      const pricePerOutlet = Number(pricingRow.price);
      const amount = pricePerOutlet * outletCount;

      const gateway = process.env.PAYMENT_GATEWAY || "manual";
      const frontendUrl = process.env.CORS_ORIGIN?.split(",")[0] || "https://sanopos.com";

      // Create payment intent record
      const { rows: [intent] } = await masterDb.query(
        `INSERT INTO payment_intents (tenant_id, amount, plan, cycle, outlet_count, gateway, return_url, provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [tenantId, amount, plan, cycle, outletCount, gateway, `${frontendUrl}/billing`, gateway]
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
