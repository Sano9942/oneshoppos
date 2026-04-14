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
const { TEMPLATES } = require("../services/email-templates");

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

  // ── Context 2: Room deposit pre-auth (tenant schema, M9) ──
  // A single webhook endpoint serves every payment-gateway adapter (sandbox,
  // xpay, etc.) because verifyWebhook() is dispatched on adapter up front.
  // room_bookings.deposit_payment_intent_id is set by room-deposits.js when
  // a pre-auth is created, and the webhook looks it up here.
  const db = require("../db-pg");
  try {
    const { rows: [booking] } = await db.query(
      "SELECT id, deposit_status FROM room_bookings WHERE deposit_payment_intent_id = $1",
      [transaction_id]
    );
    if (booking) {
      const { handleDepositWebhook } = require("../services/room-deposits");
      const result = await handleDepositWebhook(db, {
        gatewayRef: transaction_id,
        eventType: event_type,
        status,
      });
      _logger.info({ bookingId: booking.id, result }, "Room deposit webhook handled");
      return { ok: true };
    }
  } catch (depositErr) {
    // Table may not exist for tenants that haven't migrated to v38 yet — fall
    // through to remaining contexts silently.
    if (!String(depositErr.message || "").includes("does not exist")) {
      _logger.error({ err: depositErr, transaction_id }, "Room deposit webhook lookup failed");
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
  app.post("/api/webhooks/meta", async (req, res) => {
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
  app.post("/api/webhooks/whatsapp", async (req, res) => {
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
  app.post("/api/webhooks/daraz", async (req, res) => {
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
