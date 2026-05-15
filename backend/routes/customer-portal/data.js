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

  // ── GET /me/order-history ─────────────────────────────────────────
  // Tier 2.10 — unified web+in-store order history for the Reorder feature.
  // Each row carries `source` so the frontend (and the reorder endpoint) can
  // route back to the right items table. `id` is the source-table primary key;
  // the (source, id) pair is the stable identity.
  router.get("/me/order-history", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const { rows } = await req.db.query(
        `SELECT * FROM (
           SELECT 'web'::text AS source,
                  wo.id,
                  COALESCE(wo.external_order_number, wo.external_order_id) AS order_number,
                  wo.grand_total AS total,
                  wo.currency,
                  COALESCE(wo.ordered_at, wo.created_at) AS ordered_at,
                  wo.payment_status,
                  wo.fulfillment_status,
                  (SELECT COUNT(*) FROM web_order_items WHERE web_order_id = wo.id) AS item_count
             FROM web_orders wo
            WHERE wo.customer_id = $1
              AND COALESCE(wo.order_status, 'open') <> 'cancelled'
           UNION ALL
           SELECT 'in_store'::text AS source,
                  s.id,
                  s.invoice_number AS order_number,
                  s.total_amount AS total,
                  NULL::text AS currency,
                  s.timestamp AS ordered_at,
                  'paid'::text AS payment_status,
                  'fulfilled'::text AS fulfillment_status,
                  (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS item_count
             FROM sales s
            WHERE s.customer_id = $1
              AND s.voided = false
         ) combined
         ORDER BY ordered_at DESC NULLS LAST
         LIMIT $2`,
        [req.customerId, limit]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /me/reorder ──────────────────────────────────────────────
  // Tier 2.10 — clone an old order into a fresh storefront cart at current
  // prices, then redirect the customer to /store/:slug/cart?adopt=<token>.
  // The storefront page reads the `adopt` param on mount, persists the token
  // to its localStorage key, and strips the param from history.
  //
  // Items skipped (deleted product, missing variant, hard-removed) come back
  // in `items_skipped` so the frontend can show a notice.
  router.post("/me/reorder", authMw, customerPortalDataLimiter, async (req, res) => {
    try {
      const source = req.body?.source;
      const orderId = Number(req.body?.order_id);
      if (!["web", "in_store"].includes(source)) {
        return res.status(400).json({ error: "source must be 'web' or 'in_store'" });
      }
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ error: "order_id must be a positive integer" });
      }

      // Verify ownership + fetch items in one go. Both shapes are normalized
      // to { product_id, variant_id, quantity } so the cart-insert loop below
      // doesn't have to branch on source.
      let rawItems = [];
      if (source === "web") {
        const { rows: ownerRows } = await req.db.query(
          "SELECT id FROM web_orders WHERE id = $1 AND customer_id = $2",
          [orderId, req.customerId]
        );
        if (!ownerRows.length) {
          return res.status(404).json({ error: "Order not found" });
        }
        const { rows } = await req.db.query(
          `SELECT product_id, variant_id, qty AS quantity, title
             FROM web_order_items
            WHERE web_order_id = $1
            ORDER BY id`,
          [orderId]
        );
        rawItems = rows;
      } else {
        const { rows: ownerRows } = await req.db.query(
          "SELECT id FROM sales WHERE id = $1 AND customer_id = $2 AND voided = false",
          [orderId, req.customerId]
        );
        if (!ownerRows.length) {
          return res.status(404).json({ error: "Order not found" });
        }
        const { rows } = await req.db.query(
          `SELECT si.product_id, si.variant_id, si.quantity, p.name AS title
             FROM sale_items si
             LEFT JOIN products p ON p.id = si.product_id
            WHERE si.sale_id = $1
            ORDER BY si.id`,
          [orderId]
        );
        rawItems = rows;
      }

      if (rawItems.length === 0) {
        return res.status(400).json({ error: "Original order has no reorderable items" });
      }

      // Resolve each item against the CURRENT product/variant catalog. Items
      // whose product is deleted, status != 'active', or whose variant no
      // longer exists are reported in items_skipped instead of failing the
      // whole reorder. Quantities below 1 are rounded up to 1 (sales rows can
      // hold fractional qty for weighed items; cart quantities are integer).
      const itemsAdded = [];
      const itemsSkipped = [];
      for (const it of rawItems) {
        const productId = Number(it.product_id);
        const variantId = it.variant_id != null ? Number(it.variant_id) : null;
        const qty = Math.max(1, Math.ceil(Number(it.quantity) || 0));
        if (!Number.isInteger(productId) || productId <= 0) {
          itemsSkipped.push({ title: it.title || "Unknown", reason: "missing_product" });
          continue;
        }
        const { rows: pRows } = await req.db.query(
          "SELECT id, name, status, deleted_at FROM products WHERE id = $1",
          [productId]
        );
        if (!pRows.length || pRows[0].deleted_at || pRows[0].status !== "active") {
          itemsSkipped.push({
            title: it.title || pRows[0]?.name || `Product #${productId}`,
            reason: "not_available",
          });
          continue;
        }
        // Tier 2.11 — visibility gate. A SKU set to restricted after the
        // original order was placed lands here and gets skipped.
        try {
          const { isProductVisibleToCustomer } = require("../../services/product-visibility");
          const visible = await isProductVisibleToCustomer(
            req.db,
            req.customerId,
            productId
          );
          if (!visible) {
            itemsSkipped.push({
              title: it.title || pRows[0].name,
              reason: "not_available",
            });
            continue;
          }
        } catch {
          // visibility table/columns may not exist yet on this tenant —
          // fail open, let the item through. Backend addItem still gates.
        }
        if (variantId != null) {
          const { rows: vRows } = await req.db.query(
            "SELECT id FROM product_variants WHERE id = $1 AND product_id = $2",
            [variantId, productId]
          );
          if (!vRows.length) {
            itemsSkipped.push({
              title: it.title || pRows[0].name,
              reason: "variant_removed",
            });
            continue;
          }
        }
        itemsAdded.push({ productId, variantId, qty });
      }

      if (itemsAdded.length === 0) {
        return res.status(409).json({
          error: "None of the items from this order are currently available",
          items_skipped: itemsSkipped,
        });
      }

      // Mint a fresh cart for the reorder. We do NOT try to merge into an
      // existing cart — the customer may have items in a guest cart on a
      // different device; clobbering them silently would be a UX bug. A fresh
      // token wins on adoption; the customer can manually keep the old cart
      // by not following the redirect.
      const crypto = require("crypto");
      const cartToken = crypto.randomUUID();
      const { getOrCreateCart, addItem } = require("../../services/storefront-cart");
      const cart = await getOrCreateCart(req.db, cartToken);

      // Persist customer_id on the cart so the storefront checkout can
      // pre-fill name/phone/email later. addItem() uses live product prices.
      await req.db.query(
        "UPDATE storefront_carts SET customer_id = $1 WHERE id = $2",
        [req.customerId, cart.id]
      );

      for (const ai of itemsAdded) {
        try {
          await addItem(req.db, cart.id, ai.productId, ai.variantId, ai.qty);
        } catch (e) {
          // Don't abort the whole reorder for one bad row; record it.
          itemsSkipped.push({
            title: `Product #${ai.productId}`,
            reason: "add_failed",
          });
        }
      }

      const redirectUrl = `/store/${req.tenant.slug}/cart?adopt=${encodeURIComponent(cartToken)}`;
      res.json({
        cart_token: cartToken,
        redirect_url: redirectUrl,
        items_added: itemsAdded.length,
        items_skipped: itemsSkipped,
      });
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
