/**
 * Customer portal data endpoints (M8).
 *
 * All /me/* routes run AFTER loadCustomerAuth which attaches req.db, req.tenant,
 * req.customerId. The only unauthenticated route here is /config — it returns
 * tenant branding + the portal tab list (preset ∩ enabled feature flags).
 */

const express = require("express");
const { validate } = require("../../middleware/validate");
const { loadCustomerAuth } = require("../../middleware/customer-auth");
const { resolvePublicTenantDb } = require("../../services/public-tenant-context");
const { customerPortalDataLimiter } = require("../../middleware/rate-limit");
const {
  getPreset,
  getPresetLabels,
  getPortalLabels,
  getPortalEnabledTabs,
  DEFAULT_INDUSTRY_TYPE,
} = require("../../config/industry-config");
const {
  updateProfileSchema,
  addressSchema,
} = require("../../schemas/customer-portal");

// Preset tab → feature-flag dependency. Tabs without a flag are always
// eligible (subject to the preset tab list).
const TAB_FEATURE_FLAGS = {
  invoices: "customer_invoicing",
  appointments: "phase4_appointments",
  subscriptions: "subscription_billing",
  contracts: "phase4_rentals",
  stays: "phase4_room_management",
  treatments: "phase4_treatment_plans",
  tickets: "phase4_service_projects",
  orders: null,
  loyalty: null,
  profile: null,
};

async function getFeatureFlagsMap(db) {
  try {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
    const map = {};
    for (const r of rows) map[r.key] = r.enabled === true || Number(r.enabled) === 1;
    return map;
  } catch {
    return {};
  }
}

async function loadCompanyBranding(db) {
  try {
    const { rows: [profile] } = await db.query(
      `SELECT company_name, logo_url, address, phone, email, currency_code, industry_type
       FROM company_profile LIMIT 1`
    );
    return profile || null;
  } catch {
    return null;
  }
}

module.exports = function registerCustomerPortalData(app, deps) {
  const router = express.Router();

  // ── GET /config (public, no auth) ─────────────────────────────────
  router.get("/config", async (req, res) => {
    try {
      const resolved = await resolvePublicTenantDb(req, deps);
      if (resolved.error) {
        return res.status(resolved.status || 400).json({ error: resolved.error });
      }
      const { db, tenant } = resolved;

      const profile = await loadCompanyBranding(db);
      const industryType = profile?.industry_type || DEFAULT_INDUSTRY_TYPE;
      const labels = getPresetLabels(industryType);
      const portalLabels = getPortalLabels(industryType);
      const presetTabs = getPortalEnabledTabs(industryType);
      const flags = await getFeatureFlagsMap(db);

      const enabledTabs = presetTabs.filter((tab) => {
        const requiredFlag = TAB_FEATURE_FLAGS[tab];
        if (!requiredFlag) return true;
        return !!flags[requiredFlag];
      });

      res.json({
        tenant: { slug: tenant.slug, name: profile?.company_name || tenant.name || tenant.slug },
        branding: {
          logo_url: profile?.logo_url || null,
          address: profile?.address || null,
          phone: profile?.phone || null,
          email: profile?.email || null,
          currency_code: profile?.currency_code || "PKR",
        },
        industry_type: industryType,
        labels,
        portal_labels: portalLabels,
        enabled_tabs: enabledTabs,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // From here on, loadCustomerAuth guards every route.
  const authMw = loadCustomerAuth(deps);

  // ── GET /me ───────────────────────────────────────────────────────
  router.get("/me", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows: [c] } = await req.db.query(
        `SELECT id, name, email, mobile, address, city, date_of_birth, gender,
                email_consent, sms_consent, whatsapp_consent, preferred_contact,
                loyalty_points, balance, portal_email_verified_at
         FROM customers WHERE id = $1 AND deleted_at IS NULL`,
        [req.customerId]
      );
      if (!c) return res.status(404).json({ error: "Customer not found" });
      res.json(c);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /me ───────────────────────────────────────────────────────
  router.put(
    "/me",
    authMw,
    customerPortalDataLimiter,
    validate(updateProfileSchema),
    async (req, res) => {
      try {
        const allowed = [
          "name",
          "mobile",
          "address",
          "city",
          "date_of_birth",
          "gender",
          "email_consent",
          "sms_consent",
          "whatsapp_consent",
          "preferred_contact",
        ];
        const sets = [];
        const params = [];
        let i = 1;
        for (const key of allowed) {
          if (key in req.body) {
            sets.push(`${key} = $${i++}`);
            params.push(req.body[key]);
          }
        }
        if (!sets.length) return res.json({ updated: 0 });
        params.push(req.customerId);
        const { rows: [c] } = await req.db.query(
          `UPDATE customers SET ${sets.join(", ")} WHERE id = $${i}
           RETURNING id, name, email, mobile, address, city, date_of_birth, gender,
                     email_consent, sms_consent, whatsapp_consent, preferred_contact`,
          params
        );
        res.json(c);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── GET /me/sales ─────────────────────────────────────────────────
  router.get("/me/sales", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const { rows } = await req.db.query(
        `SELECT id, invoice_number, total_amount, timestamp, outlet_id
         FROM sales
         WHERE customer_id = $1 AND voided = false
         ORDER BY timestamp DESC
         LIMIT $2`,
        [req.customerId, limit]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/invoices ──────────────────────────────────────────────
  router.get("/me/invoices", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : null;
      const params = [req.customerId];
      let sql = `SELECT id, invoice_number, status, total_amount, amount_paid, balance_due,
                        due_date, created_at
                 FROM customer_invoices WHERE customer_id = $1`;
      if (status) {
        params.push(status);
        sql += ` AND status = $2`;
      }
      sql += " ORDER BY created_at DESC LIMIT 200";
      const { rows } = await req.db.query(sql, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/invoices/:id ──────────────────────────────────────────
  router.get("/me/invoices/:id", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows: [inv] } = await req.db.query(
        `SELECT * FROM customer_invoices WHERE id = $1 AND customer_id = $2`,
        [req.params.id, req.customerId]
      );
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      const { rows: items } = await req.db.query(
        "SELECT id, description, quantity, unit_price, tax_rate, line_total FROM customer_invoice_items WHERE invoice_id = $1 ORDER BY id",
        [inv.id]
      );
      const { rows: payments } = await req.db.query(
        `SELECT id, amount, payment_method, payment_type, reference, created_at
         FROM customer_invoice_payments WHERE invoice_id = $1 ORDER BY created_at DESC`,
        [inv.id]
      );
      res.json({ ...inv, items, payments });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/appointments ──────────────────────────────────────────
  router.get("/me/appointments", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const scope = req.query.scope === "past" ? "past" : "upcoming";
      const { rows } = await req.db.query(
        `SELECT a.id, a.status, a.start_at, a.end_at, a.notes, a.customer_name, a.employee_id,
                a.service_id, s.name AS service_name, e.name AS employee_name
         FROM appointments a
         LEFT JOIN booking_services s ON s.id = a.service_id
         LEFT JOIN employees e ON e.id = a.employee_id
         WHERE a.customer_id = $1
           AND ${scope === "past" ? "a.start_at < NOW()" : "a.start_at >= NOW()"}
         ORDER BY a.start_at ${scope === "past" ? "DESC" : "ASC"}
         LIMIT 200`,
        [req.customerId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/orders ────────────────────────────────────────────────
  // Read-only view of web_orders (storefront orders) — portal cannot create.
  router.get("/me/orders", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT id, external_order_number, payment_status, fulfillment_status, order_status,
                grand_total, currency, ordered_at, tracking_number, shipped_at, delivered_at
         FROM web_orders WHERE customer_id = $1
         ORDER BY COALESCE(ordered_at, created_at) DESC
         LIMIT 100`,
        [req.customerId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/subscriptions ─────────────────────────────────────────
  router.get("/me/subscriptions", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT cs.id, cs.status, cs.current_period_start, cs.current_period_end,
                cs.trial_end, cs.cancelled_at, cs.paused_at, cs.auto_charge,
                sp.name AS plan_name, sp.price AS plan_price, sp.currency AS plan_currency,
                sp.billing_interval
         FROM customer_subscriptions cs
         JOIN subscription_plans sp ON sp.id = cs.plan_id
         WHERE cs.customer_id = $1
         ORDER BY cs.created_at DESC`,
        [req.customerId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/loyalty ───────────────────────────────────────────────
  router.get("/me/loyalty", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows: [c] } = await req.db.query(
        `SELECT loyalty_points, total_spend, loyalty_tier_id
         FROM customers WHERE id = $1`,
        [req.customerId]
      );
      let tier = null;
      if (c?.loyalty_tier_id) {
        const { rows: [t] } = await req.db.query(
          "SELECT id, name, min_spend FROM loyalty_tiers WHERE id = $1",
          [c.loyalty_tier_id]
        );
        tier = t || null;
      }
      res.json({
        loyalty_points: c?.loyalty_points || 0,
        total_spend: c?.total_spend || 0,
        tier,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /me/wallet ────────────────────────────────────────────────
  router.get("/me/wallet", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows: [c] } = await req.db.query(
        "SELECT balance FROM customers WHERE id = $1",
        [req.customerId]
      );
      const { rows: ledger } = await req.db.query(
        `SELECT id, type, amount, reference_type, note, created_at
         FROM customer_wallet_ledger WHERE customer_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [req.customerId]
      );
      res.json({ balance: c?.balance || 0, ledger });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /me/wallet/top-up-intent ─────────────────────────────────
  // Creates a payment intent via the active gateway (sandbox in dev,
  // xPay in prod) and returns the hosted checkout URL. Wallet is
  // credited by the payment webhook handler when payment.completed fires.
  router.post("/me/wallet/top-up-intent", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const amount = Number(req.body?.amount || 0);
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "amount must be > 0" });
      }
      const tenantSlug = req.tenantSlug || req.tenant?.slug || "tenant";
      const reference = `wallet-topup-${tenantSlug}-${req.customerId}-${Date.now()}`;
      const gateway = require("../../services/payment-gateway");
      const { checkout_url, gateway_ref } = await gateway.createCheckout({
        amount,
        currency: "PKR",
        reference,
        description: `Wallet top-up`,
        returnUrl: `${process.env.FRONTEND_URL || ""}/portal/${tenantSlug}/wallet?topup=success`,
        cancelUrl: `${process.env.FRONTEND_URL || ""}/portal/${tenantSlug}/wallet?topup=cancelled`,
      });
      res.json({ checkout_url, gateway_ref, amount });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ── Addresses CRUD ────────────────────────────────────────────────
  router.get("/me/addresses", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rows } = await req.db.query(
        `SELECT id, label, recipient_name, phone, address_line_1, address_line_2,
                city, province, postal_code, country_code, is_default
         FROM customer_addresses WHERE customer_id = $1
         ORDER BY is_default DESC, id DESC`,
        [req.customerId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post(
    "/me/addresses",
    authMw,
    customerPortalDataLimiter,
    validate(addressSchema),
    async (req, res) => {
      try {
        const body = req.body;
        await req.db.transaction(async (client) => {
          if (body.is_default) {
            await client.query(
              "UPDATE customer_addresses SET is_default = false WHERE customer_id = $1",
              [req.customerId]
            );
          }
          const { rows: [created] } = await client.query(
            `INSERT INTO customer_addresses
               (customer_id, label, address_line_1, address_line_2, city, province,
                postal_code, country_code, is_default)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              req.customerId,
              body.label || null,
              body.line1,
              body.line2 || null,
              body.city || null,
              body.region || null,
              body.postal_code || null,
              body.country || "PK",
              !!body.is_default,
            ]
          );
          res.status(201).json(created);
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.put(
    "/me/addresses/:id",
    authMw,
    customerPortalDataLimiter,
    validate(addressSchema),
    async (req, res) => {
      try {
        const body = req.body;
        const { rows: [existing] } = await req.db.query(
          "SELECT id FROM customer_addresses WHERE id = $1 AND customer_id = $2",
          [req.params.id, req.customerId]
        );
        if (!existing) return res.status(404).json({ error: "Address not found" });

        await req.db.transaction(async (client) => {
          if (body.is_default) {
            await client.query(
              "UPDATE customer_addresses SET is_default = false WHERE customer_id = $1",
              [req.customerId]
            );
          }
          const { rows: [updated] } = await client.query(
            `UPDATE customer_addresses
                SET label = $2, address_line_1 = $3, address_line_2 = $4,
                    city = $5, province = $6, postal_code = $7, country_code = $8,
                    is_default = $9
              WHERE id = $1 RETURNING *`,
            [
              req.params.id,
              body.label || null,
              body.line1,
              body.line2 || null,
              body.city || null,
              body.region || null,
              body.postal_code || null,
              body.country || "PK",
              !!body.is_default,
            ]
          );
          res.json(updated);
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.delete("/me/addresses/:id", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const { rowCount } = await req.db.query(
        "DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2",
        [req.params.id, req.customerId]
      );
      if (!rowCount) return res.status(404).json({ error: "Address not found" });
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use("/api/portal", router);
};
