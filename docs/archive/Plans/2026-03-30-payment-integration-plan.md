# Payment Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fully automated one-time payments via gateway redirect checkout (xPay first, Stripe later), so tenants can self-service pay for Pro subscriptions without admin involvement.

**Architecture:** New `payment_intents` table tracks checkout attempts. Gateway adapter pattern abstracts xPay/Stripe. Billing route creates checkout → gateway redirect → webhook confirms → tenant auto-activated. Email worker gains paid subscription expiry transitions (active→grace→expired). Feature-gated by `PAYMENT_GATEWAY` env var — when unset, system works as today (manual admin payments).

**Tech Stack:** Node.js/Express backend, React frontend, Postgres (Supabase), existing email queue worker, xPay REST API (future).

---

### Task 1: Add payment_intents table — migration v11

**Files:**
- Modify: `backend/migrate-pg.js` (after line 385, before `];`)
- Modify: `backend/master-db-pg.js` (after `upgrade_requests` table DDL, around line 104)

**Step 1: Add migration v11 to MIGRATIONS array (migrate-pg.js, insert before line 386 `];`)**

```javascript
  {
    version: 11,
    description: "payment_intents table for gateway checkout tracking",
    up: async (client) => {
      await client.query(`CREATE TABLE IF NOT EXISTS payment_intents (
        id              SERIAL PRIMARY KEY,
        tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
        amount          NUMERIC(12,2) NOT NULL,
        currency_code   TEXT DEFAULT 'PKR',
        plan            TEXT NOT NULL,
        cycle           TEXT NOT NULL,
        outlet_count    INTEGER DEFAULT 1,
        status          TEXT DEFAULT 'pending',
        gateway         TEXT NOT NULL,
        gateway_ref     TEXT,
        gateway_data    JSONB,
        return_url      TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_payment_intents_gateway_ref ON payment_intents(gateway_ref) WHERE gateway_ref IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id, status)`);
    },
  },
```

**Step 2: Add payment_intents DDL to master-db-pg.js (after upgrade_requests CREATE TABLE)**

Add to the `MASTER_SCHEMA` template string, after the `upgrade_requests` table:

```sql
CREATE TABLE IF NOT EXISTS payment_intents (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency_code   TEXT DEFAULT 'PKR',
  plan            TEXT NOT NULL,
  cycle           TEXT NOT NULL,
  outlet_count    INTEGER DEFAULT 1,
  status          TEXT DEFAULT 'pending',
  gateway         TEXT NOT NULL,
  gateway_ref     TEXT,
  gateway_data    JSONB,
  return_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_gateway_ref ON payment_intents(gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id, status);
```

**Step 3: Also update plan_pricing seed data** — remove Starter rows, ensure Pro pricing is correct:

In `master-db-pg.js`, update the `INSERT INTO plan_pricing` block:

```sql
INSERT INTO plan_pricing (plan, cycle, price) VALUES
  ('pro', 'monthly', 8000),
  ('pro', 'annual', 80000)
ON CONFLICT DO NOTHING;
```

And in `migrate-pg.js` v7 seed (leave existing — it's historical and uses ON CONFLICT DO NOTHING).

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/master-db-pg.js
git commit -m "feat: add payment_intents table (migration v11)"
```

---

### Task 2: Create payment gateway adapter

**Files:**
- Create: `backend/services/payment-gateway.js`

**Step 1: Create the gateway adapter with xPay stub**

```javascript
/**
 * Payment gateway adapter — abstracts xPay/Stripe/manual behind one interface.
 *
 * Usage:
 *   const gateway = require("./payment-gateway");
 *   const { checkout_url, gateway_ref } = await gateway.createCheckout({ ... });
 *
 * Configuration via env vars:
 *   PAYMENT_GATEWAY=xpay|stripe|manual (default: manual)
 *   XPAY_API_KEY, XPAY_WEBHOOK_SECRET
 */

const logger = require("./logger").child({ component: "payment-gateway" });

// ── Gateway Interface ─────────────────────────────────────────────────

/**
 * Create a hosted checkout session.
 * @param {Object} opts
 * @param {number} opts.amount - Amount in smallest currency unit (e.g. PKR whole number)
 * @param {string} opts.currency - Currency code (default PKR)
 * @param {string} opts.reference - Internal reference (payment_intents.id)
 * @param {string} opts.description - Human-readable description
 * @param {string} opts.returnUrl - URL to redirect after payment
 * @param {string} opts.cancelUrl - URL to redirect on cancel
 * @returns {Promise<{ checkout_url: string, gateway_ref: string }>}
 */
async function createCheckout({ amount, currency = "PKR", reference, description, returnUrl, cancelUrl }) {
  const gw = process.env.PAYMENT_GATEWAY || "manual";

  if (gw === "xpay") {
    return xpayCreateCheckout({ amount, currency, reference, description, returnUrl, cancelUrl });
  }

  // Manual mode — no gateway, no checkout URL
  throw new Error("Online payments are not configured. Contact support to subscribe.");
}

/**
 * Verify a webhook signature and parse the payload.
 * @param {string} gateway - Gateway name (e.g. "xpay")
 * @param {Object} headers - Request headers
 * @param {string|Buffer} rawBody - Raw request body
 * @returns {Promise<{ valid: boolean, event_type: string, transaction_id: string, status: string, amount: number, raw: Object }>}
 */
async function verifyWebhook(gateway, headers, rawBody) {
  if (gateway === "xpay") {
    return xpayVerifyWebhook(headers, rawBody);
  }
  return { valid: false, error: "Unknown gateway" };
}

/**
 * Check if online payments are enabled.
 * @returns {boolean}
 */
function isEnabled() {
  const gw = process.env.PAYMENT_GATEWAY || "manual";
  return gw !== "manual";
}

// ── xPay Adapter ──────────────────────────────────────────────────────

async function xpayCreateCheckout({ amount, currency, reference, description, returnUrl, cancelUrl }) {
  const apiKey = process.env.XPAY_API_KEY;
  if (!apiKey) throw new Error("XPAY_API_KEY not configured");

  // xPay API call — placeholder until account is created
  // Docs: https://docs.xpay.pk/
  //
  // POST https://api.xpay.pk/v1/checkout/session
  // Headers: { Authorization: Bearer <apiKey>, Content-Type: application/json }
  // Body: { amount, currency, reference_id, description, success_url, cancel_url }
  // Response: { session_id, checkout_url }

  const res = await fetch("https://api.xpay.pk/v1/checkout/session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency,
      reference_id: String(reference),
      description,
      success_url: returnUrl,
      cancel_url: cancelUrl,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, body: err }, "xPay checkout creation failed");
    throw new Error(`xPay error: ${res.status}`);
  }

  const data = await res.json();
  return {
    checkout_url: data.checkout_url,
    gateway_ref: data.session_id,
  };
}

async function xpayVerifyWebhook(headers, rawBody) {
  const secret = process.env.XPAY_WEBHOOK_SECRET;
  if (!secret) return { valid: false, error: "XPAY_WEBHOOK_SECRET not configured" };

  // xPay sends HMAC-SHA256 signature in X-XPay-Signature header
  // Verify: HMAC(rawBody, secret) === signature
  const crypto = require("crypto");
  const signature = headers["x-xpay-signature"];
  if (!signature) return { valid: false, error: "Missing signature header" };

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) return { valid: false, error: "Invalid signature" };

  const payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;

  return {
    valid: true,
    event_type: payload.event_type || payload.event,   // e.g. "payment.completed"
    transaction_id: payload.session_id || payload.transaction_id,
    status: payload.status,                             // "completed" | "failed"
    amount: payload.amount,
    raw: payload,
  };
}

module.exports = { createCheckout, verifyWebhook, isEnabled };
```

**Step 2: Commit**

```bash
git add backend/services/payment-gateway.js
git commit -m "feat: add payment gateway adapter with xPay implementation"
```

---

### Task 3: Add create-checkout and payment-history to billing routes

**Files:**
- Modify: `backend/routes/billing.js` (add 2 new endpoints + update status response)

**Step 1: Add `payment_enabled` to billing status response (line 56)**

In the `res.json({...})` block at line 56, add after `grace_days_left`:

```javascript
        payment_enabled: paymentGateway.isEnabled(),
```

And at the top of the function (after line 10), add:

```javascript
  const paymentGateway = require("../services/payment-gateway");
```

**Step 2: Add create-checkout endpoint (after the request-upgrade endpoint, after line 102)**

```javascript
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
```

**Step 3: Add payment-history endpoint (after create-checkout)**

```javascript
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
```

**Step 4: Update file header comment (line 1-5)**

```javascript
/**
 * backend/routes/billing.js — Tenant-facing billing endpoints.
 *
 * GET  /api/billing/status          — Billing info + upgrade options + trial status.
 * GET  /api/billing/pricing         — Public pricing (no auth).
 * GET  /api/billing/payment-history — Payment records for tenant.
 * POST /api/billing/request-upgrade — Submit upgrade request (manual path).
 * POST /api/billing/create-checkout — Create gateway checkout session (automated path).
 */
```

**Step 5: Commit**

```bash
git add backend/routes/billing.js
git commit -m "feat: add create-checkout and payment-history billing endpoints"
```

---

### Task 4: Create webhook route

**Files:**
- Create: `backend/routes/webhooks.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount before tenant middleware)
- Modify: `backend/index.js` (add xPay webhook path to raw body capture)

**Step 0: Add xPay webhook path to raw body capture in index.js (line 249-256)**

The existing `express.json()` middleware has a `verify` callback that saves raw body for Shopify webhooks. Add xPay webhook path to the same check:

```javascript
    verify: (req, res, buf) => {
      if (
        req.originalUrl &&
        (req.originalUrl.includes("/api/integrations/shopify/webhooks/") ||
         req.originalUrl.startsWith("/api/webhooks/"))
      ) {
        req.rawBody = buf.toString("utf8");
      }
    },
```

This preserves the raw body for HMAC verification while still letting `express.json()` parse it into `req.body`. No need for `express.raw()` on the webhook route.

**Step 1: Create webhooks.js**

```javascript
/**
 * backend/routes/webhooks.js — Payment gateway webhook handlers.
 *
 * POST /api/webhooks/xpay — xPay payment notification
 *
 * Mounted BEFORE tenant middleware (no auth, no tenant context).
 * Identifies tenant via payment_intents.tenant_id lookup.
 */

module.exports = function registerWebhookRoutes(app, deps) {
  const masterDb = require("../master-db-pg");
  const paymentGateway = require("../services/payment-gateway");
  const logger = require("../services/logger").child({ component: "webhooks" });
  const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
  const { TEMPLATES } = require("../services/email-templates");

  // Note: raw body is captured by express.json() verify callback in index.js
  // and available as req.rawBody for HMAC verification.

  app.post("/api/webhooks/xpay", async (req, res) => {
    try {
      const rawBody = req.rawBody;
      const { valid, event_type, transaction_id, status, amount, raw, error } =
        await paymentGateway.verifyWebhook("xpay", req.headers, rawBody);

      if (!valid) {
        logger.warn({ error }, "xPay webhook signature invalid");
        return res.status(400).json({ error: "Invalid signature" });
      }

      logger.info({ event_type, transaction_id, status }, "xPay webhook received");

      // Look up payment intent by gateway reference
      const { rows: [intent] } = await masterDb.query(
        "SELECT id, tenant_id, amount, plan, cycle, outlet_count, status AS intent_status FROM payment_intents WHERE gateway_ref = $1",
        [transaction_id]
      );

      if (!intent) {
        logger.warn({ transaction_id }, "xPay webhook: unknown transaction");
        return res.status(404).json({ error: "Unknown transaction" });
      }

      // Idempotency: already processed
      if (intent.intent_status === "completed") {
        logger.info({ intent_id: intent.id }, "xPay webhook: already processed (idempotent)");
        return res.json({ ok: true, message: "Already processed" });
      }

      if (status === "completed" || event_type === "payment.completed") {
        // ── Payment confirmed ─────────────────────────────────────────
        const now = new Date();
        const daysToAdd = intent.cycle === "annual" ? 365 : 30;
        const periodEnd = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        const graceEnd = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

        const limits = PLAN_DEFAULTS[intent.plan] || PLAN_DEFAULTS.free;

        // Update payment intent
        await masterDb.query(
          `UPDATE payment_intents SET status = 'completed', completed_at = NOW(), gateway_data = $1 WHERE id = $2`,
          [JSON.stringify(raw), intent.id]
        );

        // Activate tenant
        await masterDb.query(
          `UPDATE tenants
           SET plan = $1, billing_cycle = $2, plan_expires_at = $3, grace_ends_at = $4,
               payment_status = 'active', max_employees = $5, max_outlets = $6, max_products = $7, updated_at = NOW()
           WHERE id = $8`,
          [intent.plan, intent.cycle, periodEnd.toISOString(), graceEnd.toISOString(),
           limits.max_employees, Math.max(limits.max_outlets, intent.outlet_count), limits.max_products, intent.tenant_id]
        );

        // Insert payment record
        await masterDb.query(
          `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, reference_note, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [intent.tenant_id, intent.amount, intent.plan, intent.cycle,
           now.toISOString(), periodEnd.toISOString(), "xpay", `intent:${intent.id}`, "webhook:xpay"]
        );

        // Enqueue confirmation email (fire-and-forget)
        try {
          const { rows: [tenant] } = await masterDb.query("SELECT slug, name FROM tenants WHERE id = $1", [intent.tenant_id]);
          if (tenant) {
            const { rows: [cp] } = await masterDb.query(
              `SELECT email FROM tenant_${tenant.slug}.company_profile WHERE id = 1`
            );
            if (cp?.email) {
              const template = TEMPLATES.billing_payment_recorded({
                storeName: tenant.name,
                amount: `PKR ${Number(intent.amount).toLocaleString()}`,
                plan: intent.plan,
                cycle: intent.cycle,
                periodEnd: periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
              });
              const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";
              await masterDb.query(
                `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [intent.tenant_id, "billing_payment_recorded", cp.email, template.subject, template.html, fromAddress]
              );
            }
          }
        } catch (emailErr) {
          logger.error({ err: emailErr }, "Failed to enqueue payment confirmation email");
        }

        logger.info({ intent_id: intent.id, tenant_id: intent.tenant_id }, "Payment confirmed — tenant activated");
        return res.json({ ok: true });

      } else if (status === "failed" || event_type === "payment.failed") {
        await masterDb.query(
          `UPDATE payment_intents SET status = 'failed', gateway_data = $1 WHERE id = $2`,
          [JSON.stringify(raw), intent.id]
        );
        logger.info({ intent_id: intent.id }, "Payment failed");
        return res.json({ ok: true });

      } else if (status === "cancelled" || event_type === "payment.cancelled") {
        await masterDb.query(
          `UPDATE payment_intents SET status = 'cancelled', gateway_data = $1 WHERE id = $2`,
          [JSON.stringify(raw), intent.id]
        );
        logger.info({ intent_id: intent.id }, "Payment cancelled");
        return res.json({ ok: true });
      }

      // Unknown event type — acknowledge but don't process
      logger.info({ event_type, transaction_id }, "xPay webhook: unhandled event type");
      return res.json({ ok: true, message: "Event acknowledged" });

    } catch (err) {
      logger.error({ err }, "xPay webhook processing error");
      return res.status(500).json({ error: "Internal error" });
    }
  });
};
```

**Step 2: Mount webhook route in registerAllRoutes.js BEFORE tenant middleware**

Find line 140 (before `require("./receipts")(app, deps);`). Insert before it:

```javascript
  // Payment gateway webhooks — no auth, no tenant context (identifies via payment_intents)
  require("./webhooks")(app, deps);
```

**Step 3: Commit**

```bash
git add backend/routes/webhooks.js backend/routes/registerAllRoutes.js backend/index.js
git commit -m "feat: add xPay webhook handler, mount before tenant middleware"
```

---

### Task 5: Add paid subscription expiry transitions to email worker

**Files:**
- Modify: `backend/workers/email-worker.js`

**IMPORTANT: Overlap with existing `runBillingCheck`**

The existing `runBillingCheck` (lines 68-150) already sends `billing_expiry_warning` and `billing_overdue` emails for tenants where `plan_expires_at` is approaching/past. The new `runPaidExpiryCheck` does the same PLUS transitions `payment_status` to `grace`. To avoid duplicate emails:

- Update `runBillingCheck`'s expiry warning query to add `AND payment_status != 'active'` (skip tenants that `runPaidExpiryCheck` handles)
- Update `runBillingCheck`'s overdue query to add `AND payment_status NOT IN ('grace', 'expired')` (skip tenants already transitioned)

Or simpler: since `runPaidExpiryCheck` now handles paid tenant expiry fully, update `runBillingCheck` to skip tenants that have any `payment_records` (those are handled by `runPaidExpiryCheck`). Add to both queries in `runBillingCheck`:

```sql
AND NOT EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = t.id)
```

This way `runBillingCheck` only handles tenants that were manually set to active by admin (no payment gateway involvement), and `runPaidExpiryCheck` handles gateway-paid tenants.

**Step 1: Add `runPaidExpiryCheck` function after `runTrialCheck` (after line 260)**

```javascript
// -- Paid Subscription Expiry Check ----------------------------------------

async function runPaidExpiryCheck(pool, logger) {
  const fromAddress = process.env.RESEND_FROM_EMAIL || "SanoPOS <noreply@sanopos.com>";

  try {
    // 1. Renewal warning — 7 days before plan_expires_at (for active PAID tenants only)
    //    Skip tenants still on trial (handled by runTrialCheck)
    const { rows: renewalWarning } = await pool.query(
      `SELECT t.id, t.slug, t.name, t.plan, t.plan_expires_at
       FROM tenants t
       WHERE t.payment_status = 'active'
         AND t.plan != 'free'
         AND t.plan_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
         AND t.status != 'deleted'
         AND EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = t.id)`
    );

    for (const t of renewalWarning) {
      const { rows: dup } = await pool.query(
        `SELECT 1 FROM email_queue
         WHERE tenant_id = $1 AND email_type = 'renewal_due'
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [t.id]
      );
      if (dup.length) continue;

      const email = await getTenantEmail(pool, t.slug);
      if (!email) continue;

      const daysLeft = Math.max(1, Math.ceil((new Date(t.plan_expires_at) - new Date()) / 86400000));
      const template = TEMPLATES.renewal_due({
        storeName: t.name,
        plan: t.plan,
        expiresAt: new Date(t.plan_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        daysLeft,
      });

      await pool.query(
        `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, "renewal_due", email, template.subject, template.html, fromAddress]
      );
      logger.info({ tenant: t.slug, daysLeft }, "Enqueued renewal due notice");
    }

    // 2. Active (paid) → Grace transition
    //    Only for tenants with payment history (not trial-originated with no payments)
    const { rows: expiredPaid } = await pool.query(
      `SELECT t.id, t.slug, t.name, t.plan, t.plan_expires_at
       FROM tenants t
       WHERE t.payment_status = 'active'
         AND t.plan != 'free'
         AND t.plan_expires_at < NOW()
         AND t.status != 'deleted'
         AND EXISTS (SELECT 1 FROM payment_records WHERE tenant_id = t.id)`
    );

    for (const t of expiredPaid) {
      await pool.query(
        `UPDATE tenants SET payment_status = 'grace', grace_ends_at = plan_expires_at + INTERVAL '7 days', updated_at = NOW()
         WHERE id = $1`,
        [t.id]
      );

      const email = await getTenantEmail(pool, t.slug);
      if (email) {
        const template = TEMPLATES.renewal_overdue({
          storeName: t.name,
          plan: t.plan,
          expiredAt: new Date(t.plan_expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        });
        await pool.query(
          `INSERT INTO email_queue (tenant_id, email_type, to_email, subject, html_body, from_address)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.id, "renewal_overdue", email, template.subject, template.html, fromAddress]
        );
      }
      logger.info({ tenant: t.slug }, "Paid subscription → grace transition");
    }

    // Note: grace → expired is already handled by runTrialCheck (same logic applies to both trial and paid)
  } catch (err) {
    logger.error({ err }, "Paid expiry check error");
  }
}
```

**Step 2: Call runPaidExpiryCheck in pollOnce (line 264-273)**

Update pollOnce to:

```javascript
async function pollOnce(pool, resend, logger) {
  if (stopping) return;
  try {
    await runTrialCheck(pool, logger);
    await runPaidExpiryCheck(pool, logger);
    await runBillingCheck(pool, logger);
    await processQueue(pool, resend, logger);
  } catch (err) {
    logger.error({ err }, "Email worker poll error");
  }
}
```

**Step 3: Commit**

```bash
git add backend/workers/email-worker.js
git commit -m "feat: add paid subscription expiry transitions (active→grace) to email worker"
```

---

### Task 6: Add renewal email templates

**Files:**
- Modify: `backend/services/email-templates.js`

**Step 1: Add 2 new template functions before the TEMPLATES registry (before line 254)**

```javascript
// -- Renewal: Due (7 days before expiry) ------------------------------------
function renewalDue({ storeName, plan, expiresAt, daysLeft }) {
  const urgency = daysLeft <= 1 ? "expires tomorrow" : `renews in ${daysLeft} days`;
  return {
    subject: `Your ${plan} subscription ${urgency} — ${storeName}`,
    html: wrapEmailHtml("Subscription Renewal Due", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> subscription for <strong>${storeName}</strong> ${urgency} (${expiresAt}).</p>
      <p>To continue using all features without interruption, please renew your subscription.</p>
      <p>After expiry, you'll have a <strong>7-day grace period</strong> before your account becomes read-only.</p>
      ${btn("Renew Now", "https://sanopos.com/billing")}
      ${footer("This is an automated reminder about your SanoPOS subscription.")}
    `),
  };
}

// -- Renewal: Overdue (entered grace period) --------------------------------
function renewalOverdue({ storeName, plan, expiredAt }) {
  return {
    subject: `Subscription lapsed — 7 days to renew — ${storeName}`,
    html: wrapEmailHtml("Subscription Lapsed", `
      <p>Hi,</p>
      <p>Your <strong>${plan}</strong> subscription for <strong>${storeName}</strong> expired on ${expiredAt}.</p>
      <p>You have <strong>7 days</strong> to renew before your account becomes read-only. During this grace period, everything still works normally.</p>
      <p>Renew now to keep selling without interruption.</p>
      ${btn("Renew Now", "https://sanopos.com/billing")}
      ${footer("This is an automated notification about your SanoPOS subscription.")}
    `),
  };
}
```

**Step 2: Add to TEMPLATES registry (line 255)**

```javascript
  renewal_due: renewalDue,
  renewal_overdue: renewalOverdue,
```

Add after the `account_locked: accountLocked,` line.

**Step 3: Commit**

```bash
git add backend/services/email-templates.js
git commit -m "feat: add renewal_due and renewal_overdue email templates"
```

---

### Task 7: Update BillingRedesign with Pay Now button and payment return handling

**Files:**
- Modify: `frontend/src/pages/redesign/BillingRedesign.jsx`

**Step 1: Add Pay Now handler and payment return detection**

After the existing `useEffect(() => { fetchBilling(); }, []);` (line 24), add:

```javascript
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // Handle payment return from gateway
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get("payment");
    const intentId = params.get("intent");

    if (paymentResult === "success" && intentId) {
      setPaymentProcessing(true);
      // Poll billing status until payment_status changes to active
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`${API_BASE}/api/billing/status`);
          const data = await r.json();
          if (data.payment_status === "active" && data.expires_at) {
            clearInterval(poll);
            setPaymentProcessing(false);
            setBilling(data);
            success("Payment confirmed! Your subscription is now active.");
            window.history.replaceState({}, "", "/billing");
          } else if (attempts >= 15) {
            clearInterval(poll);
            setPaymentProcessing(false);
            fetchBilling();
            success("Payment is being processed. Check back in a minute.");
            window.history.replaceState({}, "", "/billing");
          }
        } catch {
          if (attempts >= 15) {
            clearInterval(poll);
            setPaymentProcessing(false);
            fetchBilling();
          }
        }
      }, 2000);
      return () => clearInterval(poll);
    }

    if (paymentResult === "cancelled") {
      showError("Payment was cancelled.");
      window.history.replaceState({}, "", "/billing");
    }
  }, []);
```

**Step 2: Add handlePayNow function**

After the `handleRequestUpgrade` function, add:

```javascript
  const handlePayNow = async (cycle = "monthly") => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkout");
      // Redirect to gateway
      window.location.href = data.checkout_url;
    } catch (err) {
      showError(err.message);
      setSubmitting(false);
    }
  };
```

**Step 3: Add payment processing overlay**

After the `if (loading)` return (around line 49), add:

```jsx
  if (paymentProcessing) return (
    <PageShell title="Billing">
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full mb-4" />
        <p className="text-slate-600 font-medium">Verifying your payment...</p>
        <p className="text-sm text-slate-400 mt-1">This usually takes a few seconds.</p>
      </div>
    </PageShell>
  );
```

**Step 4: Add Pay Now button to trial/grace/expired banners**

In the **trial banner** (where `billing.trial_days_left <= 7`), add after the `<p>` text:

```jsx
            {billing.payment_enabled && (
              <button onClick={() => handlePayNow()} disabled={submitting}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : "Subscribe Now — PKR 8,000/mo"}
              </button>
            )}
```

In the **grace banner**, add after the `<p>` text:

```jsx
            {billing.payment_enabled && (
              <button onClick={() => handlePayNow()} disabled={submitting}
                className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : "Pay Now — PKR 8,000/mo"}
              </button>
            )}
```

In the **expired banner**, replace the existing `<button onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}...>` with:

```jsx
            {billing.payment_enabled ? (
              <button onClick={() => handlePayNow()} disabled={submitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : "Pay Now — PKR 8,000/mo"}
              </button>
            ) : (
              <button onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors cursor-pointer">
                Subscribe Now — PKR 8,000/mo
              </button>
            )}
```

**Step 5: Add "Upcoming Renewal" Pay Now for active paid tenants**

After the "Current Plan" card, add:

```jsx
        {/* Upcoming Renewal */}
        {paymentStatus === "active" && billing?.plan === "pro" && billing?.expires_at && (() => {
          const daysUntilExpiry = Math.ceil((new Date(billing.expires_at) - new Date()) / 86400000);
          if (daysUntilExpiry > 7) return null;
          return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={18} className="text-amber-600" />
                <h2 className="text-base font-semibold text-amber-800">
                  Subscription renews in {daysUntilExpiry} {daysUntilExpiry === 1 ? "day" : "days"}
                </h2>
              </div>
              <p className="text-sm text-amber-700">Renew now to avoid any interruption in service.</p>
              {billing.payment_enabled && (
                <button onClick={() => handlePayNow(billing.billing_cycle || "monthly")} disabled={submitting}
                  className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer">
                  {submitting ? "Redirecting..." : "Renew Now"}
                </button>
              )}
            </div>
          );
        })()}
```

**Step 6: Add Payment History section**

Inside the main `<div className="max-w-3xl space-y-6">`, before the closing `</div>`, add:

```jsx
        {/* Payment History */}
        {billing?.plan !== "free" && <PaymentHistorySection />}
```

And define `PaymentHistorySection` as a function inside `BillingRedesign` (before the return statement):

```javascript
  function PaymentHistorySection() {
    const [payments, setPayments] = useState([]);
    const [loadingPayments, setLoadingPayments] = useState(true);

    useEffect(() => {
      fetch(`${API_BASE}/api/billing/payment-history`)
        .then(r => r.json())
        .then(data => { setPayments(Array.isArray(data) ? data : []); setLoadingPayments(false); })
        .catch(() => setLoadingPayments(false));
    }, []);

    if (loadingPayments || !payments.length) return null;

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Payment History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{new Date(p.recorded_at).toLocaleDateString()}</td>
                  <td className="py-2 text-slate-700">PKR {Number(p.amount).toLocaleString()}</td>
                  <td className="py-2 capitalize text-slate-700">{p.plan} ({p.cycle})</td>
                  <td className="py-2 text-slate-500 text-xs">
                    {new Date(p.period_start).toLocaleDateString()} — {new Date(p.period_end).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
```

**Step 7: Commit**

```bash
git add frontend/src/pages/redesign/BillingRedesign.jsx
git commit -m "feat: add Pay Now button, payment return handling, and payment history to billing page"
```

---

### Task 8: Verify and test

**Step 1: Run backend build check**

```bash
cd backend && node -e "
  require('./middleware/plan-limits');
  require('./services/email-templates');
  require('./services/payment-gateway');
  const { TEMPLATES } = require('./services/email-templates');
  console.log('renewal_due:', typeof TEMPLATES.renewal_due === 'function');
  console.log('renewal_overdue:', typeof TEMPLATES.renewal_overdue === 'function');
  const gw = require('./services/payment-gateway');
  console.log('isEnabled:', gw.isEnabled());
  console.log('OK');
"
```

Expected: All `true`, `isEnabled: false` (no PAYMENT_GATEWAY env var), `OK`.

**Step 2: Run frontend build**

```bash
cd frontend && npx vite build
```

Expected: Clean build, no errors.

**Step 3: Verify migration**

```bash
cd backend && node -e "
  const { MIGRATIONS } = require('./migrate-pg');
  console.log('Latest migration version:', MIGRATIONS[MIGRATIONS.length - 1].version);
  console.log('Description:', MIGRATIONS[MIGRATIONS.length - 1].description);
"
```

Expected: `Latest migration version: 11`, `Description: payment_intents table for gateway checkout tracking`.

**Step 4: Commit verification**

```bash
git add -A
git status
# If only the design/plan docs are untracked, add them
git commit -m "chore: verify payment integration — all checks pass"
```

---

### Task 9: Push branch

**Step 1: Ensure on feature branch**

```bash
git checkout -b feature/payment-integration
```

(Or if already on the branch, skip.)

**Step 2: Push**

```bash
git push -u origin feature/payment-integration
```

---

## Summary of all changes

| Task | What | Files |
|------|------|-------|
| 1 | payment_intents table (migration v11) | `migrate-pg.js`, `master-db-pg.js` |
| 2 | Payment gateway adapter (xPay) | `services/payment-gateway.js` (NEW) |
| 3 | create-checkout + payment-history endpoints | `routes/billing.js` |
| 4 | Webhook handler + route mounting + raw body capture | `routes/webhooks.js` (NEW), `registerAllRoutes.js`, `index.js` |
| 5 | Paid subscription expiry transitions | `workers/email-worker.js` |
| 6 | Renewal email templates (2 new) | `services/email-templates.js` |
| 7 | Billing page: Pay Now + return handling + history | `BillingRedesign.jsx` |
| 8 | Verify and test | — |
| 9 | Push branch | — |

## Deployment Notes

After merge:
1. Run `node backend/migrate-pg.js` to create `payment_intents` table
2. Set `PAYMENT_GATEWAY=xpay` on Railway when xPay account is ready
3. Set `XPAY_API_KEY` and `XPAY_WEBHOOK_SECRET` on Railway
4. Configure xPay webhook URL: `https://api.sanopos.com/api/webhooks/xpay`
5. Until env vars are set, system works exactly as today (manual admin payments)
