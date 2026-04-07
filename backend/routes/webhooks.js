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
