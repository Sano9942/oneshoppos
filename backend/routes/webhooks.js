/**
 * backend/routes/webhooks.js — Payment gateway webhook handlers.
 *
 * POST /api/webhooks/xpay — xPay payment notification
 *
 * Mounted BEFORE tenant middleware (no auth, no tenant context).
 * Identifies tenant via payment_intents.tenant_id lookup.
 *
 * processWebhookEvent() is exported for reuse by the sandbox simulate endpoint.
 */

// ── Shared webhook processing logic ──────────────────────────────────
// Extracted so that both real gateway webhooks (xPay, Bank Alfalah, etc.)
// and the sandbox simulate endpoint can reuse the same processing path.

const masterDb = require("../master-db-pg");
const _logger = require("../services/logger").child({ component: "webhooks" });
const { PLAN_DEFAULTS } = require("../middleware/plan-limits");
const depositEngine = require("../services/deposit-engine");

// W32: webhook arrives with no tenant context (mounted before tenant
// middleware, payload doesn't carry slug). Tenant-scoped tables
// (room_bookings, treatment_plans, customer_invoice_payment_links,
// restaurant_payment_sessions, storefront_payment_sessions) live in each
// tenant schema. The original handler queried `db-pg` (public pool)
// without a search_path so every tenant-scoped lookup silently failed
// with "relation does not exist". Pay-at-table sandbox transactions
// never transitioned to "paid" because the webhook couldn't resolve
// the session.
//
// Resolves tenant by scanning active tenants and returning the first
// hit + its scoped DB. Returns null if not found in any tenant.
async function resolveTenantDbForGatewayRef(gatewayRef) {
  const tenantDbMgr = require("../tenant-db-manager-pg");
  let tenants = [];
  try {
    const { rows } = await masterDb.query(
      "SELECT id, slug FROM tenants WHERE status = 'active' ORDER BY id"
    );
    tenants = rows;
  } catch (err) {
    _logger.error({ err }, "webhook tenant list failed");
    return null;
  }

  // Try each tenant-scoped table where a payment session might live.
  // First match wins. Order matches the lookup order in processWebhookEvent
  // below (deposit entities → invoice → restaurant → storefront). The deposit
  // tables come from deposit-engine.ENTITY_ADAPTERS (F04) so a new deposit
  // entity is resolved here automatically once it registers an adapter.
  const lookups = [
    ...Object.values(depositEngine.ENTITY_ADAPTERS).map((cfg) => ({
      table: cfg.table,
      ref: cfg.refColumn,
    })),
    { table: "customer_invoice_payment_links", ref: "gateway_ref" },
    { table: "restaurant_payment_sessions", ref: "gateway_ref" },
    { table: "storefront_payment_sessions", ref: "provider_ref" },
  ];

  for (const t of tenants) {
    let db;
    try {
      db = await tenantDbMgr.getDb(t.id);
    } catch (err) {
      _logger.warn({ err, slug: t.slug }, "webhook getDb failed — skipping tenant");
      continue;
    }
    for (const { table, ref } of lookups) {
      try {
        const { rows } = await db.query(
          `SELECT 1 FROM ${table} WHERE ${ref} = $1 LIMIT 1`,
          [gatewayRef]
        );
        if (rows.length) return { db, tenant: t };
      } catch (err) {
        if (!/does not exist/i.test(err.message)) {
          _logger.warn({ err, slug: t.slug, table }, "webhook lookup error");
        }
      }
    }
  }
  return null;
}

/**
 * Process a verified payment webhook event.
 * @param {Object} opts
 * @param {string} opts.provider - Payment provider key (e.g. 'xpay', 'sandbox')
 * @param {string} opts.event_type - Event type (payment.completed, payment.failed, payment.cancelled)
 * @param {string} opts.transaction_id - Gateway transaction/session ID (matches gateway_ref/provider_ref)
 * @param {string} opts.status - Payment status string
 * @param {number} opts.amount - Payment amount
 * @param {Object} opts.raw - Raw webhook payload
 * @returns {Promise<{ ok: boolean, message?: string, statusCode?: number, error?: string }>}
 */
async function processWebhookEvent({ provider, event_type, transaction_id, status, amount, raw }) {
  _logger.info({ provider, event_type, transaction_id, status }, "Processing webhook event");

  // Log to payment_webhook_events for idempotency and auditability
  try {
    await masterDb.query(
      `INSERT INTO payment_webhook_events (provider, event_id, event_type, raw_payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, event_id) DO NOTHING`,
      [provider, transaction_id + ":" + (event_type || status), event_type, JSON.stringify(raw)]
    );
  } catch (logErr) {
    _logger.warn({ err: logErr }, "Failed to log webhook event (non-fatal)");
  }

  // ── Context 1: Platform billing (payment_intents in public schema) ──
  const { rows: [intent] } = await masterDb.query(
    "SELECT id, tenant_id, amount, plan, cycle, outlet_count, status AS intent_status FROM payment_intents WHERE gateway_ref = $1",
    [transaction_id]
  );

  if (intent) {
    // Idempotency: already processed
    if (intent.intent_status === "completed") {
      _logger.info({ intent_id: intent.id }, `${provider} webhook: already processed (idempotent)`);
      return { ok: true, message: "Already processed" };
    }

    if (status === "completed" || event_type === "payment.completed") {
      const now = new Date();
      const daysToAdd = intent.cycle === "annual" ? 365 : 30;
      const periodEnd = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const graceEnd = new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

      const limits = PLAN_DEFAULTS[intent.plan] || PLAN_DEFAULTS.free;

      await masterDb.query(
        `UPDATE payment_intents SET status = 'completed', completed_at = NOW(), gateway_data = $1 WHERE id = $2`,
        [JSON.stringify(raw), intent.id]
      );

      await masterDb.query(
        `UPDATE tenants
         SET plan = $1, billing_cycle = $2, plan_expires_at = $3, grace_ends_at = $4,
             payment_status = 'active', max_employees = $5, max_outlets = $6, max_products = $7, updated_at = NOW()
         WHERE id = $8`,
        [intent.plan, intent.cycle, periodEnd.toISOString(), graceEnd.toISOString(),
         limits.max_employees, Math.max(limits.max_outlets, intent.outlet_count), limits.max_products, intent.tenant_id]
      );

      await masterDb.query(
        `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, reference_note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [intent.tenant_id, intent.amount, intent.plan, intent.cycle,
         now.toISOString(), periodEnd.toISOString(), provider, `intent:${intent.id}`, `webhook:${provider}`]
      );

      // Enqueue confirmation email via pg-boss (fire-and-forget).
      // Previously INSERTed into legacy `email_queue` table — that path was
      // orphaned in the email-worker migration to pg-boss (the legacy polling
      // worker was deleted). Confirmation emails sat unsent forever. Use
      // services/email.enqueueEmail() like every other email-emitting code path.
      try {
        const { rows: [tenant] } = await masterDb.query(
          "SELECT slug, name FROM tenants WHERE id = $1",
          [intent.tenant_id]
        );
        if (tenant) {
          const { rows: [cp] } = await masterDb.query(
            `SELECT email FROM tenant_${tenant.slug}.company_profile WHERE id = 1`
          );
          if (cp?.email) {
            const { enqueueEmail } = require("../services/email");
            await enqueueEmail(masterDb, {
              tenantId: intent.tenant_id,
              type: "billing_payment_recorded",
              to: cp.email,
              tenant: { slug: tenant.slug, name: tenant.name },
              data: {
                storeName: tenant.name,
                amount: `PKR ${Number(intent.amount).toLocaleString()}`,
                plan: intent.plan,
                cycle: intent.cycle,
                periodEnd: periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
              },
            });
          }
        }
      } catch (emailErr) {
        _logger.error({ err: emailErr }, "Failed to enqueue payment confirmation email");
      }

      _logger.info({ intent_id: intent.id, tenant_id: intent.tenant_id }, "Payment confirmed — tenant activated");
      return { ok: true };

    } else if (status === "failed" || event_type === "payment.failed") {
      await masterDb.query(
        `UPDATE payment_intents SET status = 'failed', gateway_data = $1 WHERE id = $2`,
        [JSON.stringify(raw), intent.id]
      );
      _logger.info({ intent_id: intent.id }, "Payment failed");
      return { ok: true };

    } else if (status === "cancelled" || event_type === "payment.cancelled") {
      await masterDb.query(
        `UPDATE payment_intents SET status = 'cancelled', gateway_data = $1 WHERE id = $2`,
        [JSON.stringify(raw), intent.id]
      );
      _logger.info({ intent_id: intent.id }, "Payment cancelled");
      return { ok: true };
    }

    _logger.info({ event_type, transaction_id }, `${provider} webhook: unhandled event type`);
    return { ok: true, message: "Event acknowledged" };
  }

  // ── Context 2: Deposit pre-auth (tenant schema, F04) ──
  // A single webhook endpoint serves every payment-gateway adapter (sandbox,
  // xpay, etc.) because verifyWebhook() is dispatched on adapter up front.
  //
  // W32: scope db to the tenant that owns this gateway_ref. Without this,
  // every tenant-scoped lookup below queries the public pool with no
  // search_path and silently fails with "relation does not exist", which
  // is why pay-at-table never transitioned to "paid" in sandbox.
  const resolved = await resolveTenantDbForGatewayRef(transaction_id);
  if (!resolved) {
    _logger.info(
      { transaction_id, provider, event_type },
      "Webhook gateway_ref not found in any tenant — checked deposit/invoice/restaurant/storefront contexts"
    );
    return { ok: false, statusCode: 404, error: "Payment context not found" };
  }
  const db = resolved.db;
  _logger.info(
    { transaction_id, tenant: resolved.tenant.slug },
    "Webhook tenant resolved"
  );

  // Each deposit entity's <table>.<refColumn> is set by deposit-engine.create()
  // when a pre-auth is created; the webhook looks it up here by iterating the
  // engine's ENTITY_ADAPTERS registry, so adding a deposit entity (rental,
  // appointment, ticket, …) needs no webhook edit. Table/column names come
  // only from the in-code registry — never user input. A table that doesn't
  // exist for an unmigrated tenant is swallowed silently so remaining contexts
  // (invoice/restaurant/storefront) still run.
  for (const entityType of Object.keys(depositEngine.ENTITY_ADAPTERS)) {
    const cfg = depositEngine.ENTITY_ADAPTERS[entityType];
    try {
      const { rows: [hit] } = await db.query(
        `SELECT id FROM ${cfg.table} WHERE ${cfg.refColumn} = $1`,
        [transaction_id]
      );
      if (hit) {
        const result = await depositEngine.handleWebhook(db, {
          entityType,
          gatewayRef: transaction_id,
          eventType: event_type,
          status,
          amount,
        });
        _logger.info({ entityType, entityId: hit.id, result }, "Deposit webhook handled");
        return { ok: true };
      }
    } catch (depositErr) {
      // Table may not exist for tenants that haven't migrated yet — fall
      // through to remaining contexts silently.
      if (!String(depositErr.message || "").includes("does not exist")) {
        _logger.error({ err: depositErr, transaction_id, entityType }, "Deposit webhook lookup failed");
      }
    }
  }

  // ── Context 3: Invoice payment links (tenant schema) ──
  const { rows: [link] } = await db.query(
    "SELECT * FROM customer_invoice_payment_links WHERE gateway_ref = $1",
    [transaction_id]
  );
  if (link) {
    if (status === "completed" || event_type === "payment.completed") {
      try {
        await db.query(
          "UPDATE customer_invoice_payment_links SET status = 'completed', completed_at = NOW(), raw_completion_payload = $1 WHERE id = $2",
          [JSON.stringify(raw), link.id]
        );
        await db.query(
          `INSERT INTO customer_invoice_payments (invoice_id, amount, payment_method, payment_type, reference)
           VALUES ($1, $2, 'online', 'payment', $3)`,
          [link.invoice_id, link.amount, `gateway:${transaction_id}`]
        );
        const { recomputeBalance } = require("../services/customer-invoicing");
        await recomputeBalance(db, link.invoice_id);
        _logger.info({ invoiceId: link.invoice_id, linkId: link.id }, "Invoice payment link completed");
      } catch (linkErr) {
        _logger.error({ err: linkErr }, "Invoice payment link processing failed");
      }
    }
    return { ok: true };
  }

  // ── Context 3b: Restaurant pay-at-table sessions (tenant schema, 2-R.3) ──
  // Checked before storefront so a restaurant-prefixed gateway_ref never
  // misses its handler if the storefront table happens to have a stale
  // row with the same id (shouldn't happen in practice — gateway_ref is
  // unique per mint — but keeps the dispatch order explicit).
  try {
    const { handleRestaurantPayWebhook } = require("./restaurant/pay-at-table");
    const { rows: [rps] } = await db.query(
      "SELECT id FROM restaurant_payment_sessions WHERE gateway_ref = $1",
      [transaction_id]
    );
    if (rps) {
      const result = await handleRestaurantPayWebhook(db, {
        gatewayRef: transaction_id,
        status,
        eventType: event_type,
        raw,
      });
      if (result.matched) return { ok: true, message: result.message };
    }
  } catch (rpsErr) {
    if (!String(rpsErr.message || "").includes("does not exist")) {
      _logger.error({ err: rpsErr, transaction_id }, "Restaurant pay-at-table webhook failed");
    }
  }

  // ── Context 4: Storefront payment sessions (tenant schema) ──
  const { rows: [session] } = await db.query(
    "SELECT * FROM storefront_payment_sessions WHERE provider_ref = $1",
    [transaction_id]
  );
  if (session) {
    if (status === "completed" || event_type === "payment.completed") {
      try {
        await db.query(
          "UPDATE storefront_payment_sessions SET status = 'completed', completed_at = NOW() WHERE id = $1",
          [session.id]
        );
        await db.query(
          `UPDATE web_orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
          [session.web_order_id]
        );
        await db.query(
          `INSERT INTO web_order_transactions (web_order_id, external_txn_id, gateway, kind, status, amount, processed_at, provider_ref, payment_context)
           VALUES ($1, $2, $3, 'sale', 'completed', $4, NOW(), $5, 'storefront')`,
          [session.web_order_id, transaction_id, provider, session.amount, transaction_id]
        );
        _logger.info({ orderId: session.web_order_id, sessionId: session.id }, "Storefront payment completed");
      } catch (sfErr) {
        _logger.error({ err: sfErr }, "Storefront payment processing failed");
      }
    } else if (status === "failed" || event_type === "payment.failed") {
      try {
        await db.query(
          "UPDATE storefront_payment_sessions SET status = 'failed' WHERE id = $1",
          [session.id]
        );
        await db.query(
          `UPDATE web_orders SET payment_status = 'failed', updated_at = NOW() WHERE id = $1`,
          [session.web_order_id]
        );
        // Release inventory reservations
        const { rows: reservations } = await db.query(
          `SELECT r.id, r.product_id, r.variant_id, r.outlet_id, r.quantity
           FROM storefront_cart_reservations r
           JOIN web_orders wo ON wo.id = $1
           WHERE r.status = 'converted' AND r.outlet_id IS NOT NULL`,
          [session.web_order_id]
        );
        for (const r of reservations) {
          await db.query(
            `UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3`,
            [r.quantity, r.product_id, r.outlet_id]
          );
          if (r.variant_id) {
            await db.query(
              `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
              [r.quantity, r.variant_id]
            );
          }
          await db.query(
            `UPDATE storefront_cart_reservations SET status = 'released' WHERE id = $1`,
            [r.id]
          );
        }
        _logger.info({ orderId: session.web_order_id, sessionId: session.id, releasedCount: reservations.length }, "Storefront payment failed — inventory released");
      } catch (sfErr) {
        _logger.error({ err: sfErr }, "Storefront payment failure processing failed");
      }
    } else if (status === "cancelled" || event_type === "payment.cancelled") {
      try {
        await db.query(
          "UPDATE storefront_payment_sessions SET status = 'cancelled' WHERE id = $1",
          [session.id]
        );
        await db.query(
          `UPDATE web_orders SET payment_status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [session.web_order_id]
        );
        _logger.info({ orderId: session.web_order_id, sessionId: session.id }, "Storefront payment cancelled");
      } catch (sfErr) {
        _logger.error({ err: sfErr }, "Storefront payment cancellation processing failed");
      }
    }
    return { ok: true };
  }

  // ── Context 5: Wallet top-up (tenant schema, reference pattern match) ──
  if (transaction_id.includes("wallet-topup-") && (status === "completed" || event_type === "payment.completed")) {
    try {
      // Extract customer ID from the reference pattern: wallet-topup-{customerId}-{timestamp}
      const match = transaction_id.match(/wallet-topup-(\d+)-/);
      if (match && amount > 0) {
        const customerId = match[1];
        await db.query(
          "UPDATE customers SET balance = COALESCE(balance, 0) + $1 WHERE id = $2",
          [amount, customerId]
        );
        await db.query(
          `INSERT INTO customer_wallet_ledger (customer_id, type, amount, reference_type, note)
           VALUES ($1, 'credit', $2, 'online_topup', $3)`,
          [customerId, amount, `Online top-up via ${provider} (ref: ${transaction_id})`]
        );
        _logger.info({ customerId, amount, provider }, "Wallet top-up completed via payment");
        return { ok: true };
      }
    } catch (walletErr) {
      _logger.error({ err: walletErr, transaction_id }, "Wallet top-up processing failed");
    }
  }

  _logger.warn({ transaction_id, provider }, "Webhook: unknown transaction");
  return { ok: false, statusCode: 404, error: "Unknown transaction" };
}

module.exports = function registerWebhookRoutes(app, deps) {
  const paymentGateway = require("../services/payment-gateway");
  const logger = _logger;
  const { z } = require("zod");

  // Rate limiter for all webhook endpoints — passed from registerAllRoutes
  // deps. Defaults to a passthrough so this module is callable in tests
  // without wiring the full middleware chain.
  const webhookLimiter = deps.webhookLimiter || ((_req, _res, next) => next());

  // Structural schema for xPay payloads — non-fatal. HMAC is the real gate;
  // this logs anomalies so unexpected payload shapes surface in Sentry/Pino
  // before they corrupt downstream idempotency state. passthrough() preserves
  // unknown fields since xPay evolves its payload over time.
  const XPayPayloadSchema = z.object({
    event_type: z.string().max(100).optional(),
    transaction_id: z.string().min(1).optional(),
    status: z.string().max(50).optional(),
    amount: z.coerce.number().optional(),
  }).passthrough();

  // Note: raw body is captured by express.json() verify callback in index.js
  // and available as req.rawBody for HMAC verification.

  app.post("/api/webhooks/xpay", webhookLimiter, async (req, res) => {
    try {
      const rawBody = req.rawBody;
      const { valid, event_type, transaction_id, status, amount, raw, error } =
        await paymentGateway.verifyWebhook("xpay", req.headers, rawBody);

      if (!valid) {
        logger.warn({ error }, "xPay webhook signature invalid");
        return res.status(400).json({ error: "Invalid signature" });
      }

      const bodyParse = XPayPayloadSchema.safeParse(raw || {});
      if (!bodyParse.success) {
        logger.warn(
          { issues: bodyParse.error.issues, provider: "xpay", transaction_id },
          "xPay webhook payload failed structural schema check",
        );
        // Non-fatal — HMAC already verified. Continue processing.
      }

      const result = await processWebhookEvent({ provider: "xpay", event_type, transaction_id, status, amount, raw });

      if (result.error) {
        return res.status(result.statusCode || 400).json({ error: result.error });
      }
      return res.json({ ok: true, message: result.message });

    } catch (err) {
      logger.error({ err }, "xPay webhook processing error");
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /api/webhooks/meta — Facebook/Instagram webhook verification
  app.get("/api/webhooks/meta", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      logger.info("Meta webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  // POST /api/webhooks/meta — Facebook/Instagram order webhooks
  app.post("/api/webhooks/meta", webhookLimiter, async (req, res) => {
    try {
      const { object, entry } = req.body || {};
      logger.info({ object, entries: entry?.length }, "Meta webhook received");
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "Meta webhook processing error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // GET /api/webhooks/whatsapp — WhatsApp webhook verification
  app.get("/api/webhooks/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      logger.info("WhatsApp webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  // POST /api/webhooks/whatsapp — receive WhatsApp messages
  app.post("/api/webhooks/whatsapp", webhookLimiter, async (req, res) => {
    try {
      const { entry } = req.body || {};
      const changes = entry?.[0]?.changes || [];

      for (const change of changes) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          logger.info({ from: msg.from, type: msg.type }, "WhatsApp message received");

          // Dual-write into generic messaging inbox
          try {
            const { findOrCreateThread, addMessage } = require("../services/messaging");
            const db = require("../db-pg");
            const thread = await findOrCreateThread(db, {
              channel: "whatsapp",
              channelIdentifier: msg.from,
            });
            await addMessage(db, {
              threadId: thread.id,
              direction: "inbound",
              content: msg.text?.body || msg.caption || `[${msg.type}]`,
              messageType: msg.type || "text",
              externalId: msg.id,
              senderType: "customer",
            });
          } catch (inboxErr) {
            logger.error({ err: inboxErr }, "Failed to write WhatsApp message to inbox");
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "WhatsApp webhook processing error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // POST /api/webhooks/daraz — Daraz order status push notifications
  app.post("/api/webhooks/daraz", webhookLimiter, async (req, res) => {
    try {
      const { trade_order_id, status, timestamp } = req.body || {};
      if (!trade_order_id) return res.status(400).json({ error: "Missing order ID" });

      logger.info({ trade_order_id, status, timestamp }, "Daraz webhook received");

      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "Daraz webhook processing error");
      res.status(500).json({ error: "Internal error" });
    }
  });
};

// Export processWebhookEvent for reuse by sandbox simulate endpoint
module.exports.processWebhookEvent = processWebhookEvent;
