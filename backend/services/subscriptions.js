/**
 * backend/services/subscriptions.js — Subscription lifecycle and renewal.
 */

const logger = require("./logger").child({ component: "subscriptions" });

const INTERVAL_DAYS = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

/**
 * Compute next billing period from current end date.
 */
function computeNextPeriod(currentPeriodEnd, interval, intervalCount = 1) {
  const days = (INTERVAL_DAYS[interval] || 30) * intervalCount;
  const start = new Date(currentPeriodEnd);
  const end = new Date(start.getTime() + days * 86400000);
  return { start, end };
}

/**
 * Process a subscription renewal.
 * If auto_charge disabled or not available, creates an invoice instead.
 *
 * @param {object} db - tenant-scoped db proxy (query, transaction)
 * @param {object} boss - pg-boss instance
 * @param {string} tenantSlug - needed so the next scheduled renewal job
 *   carries the correct tenant context in its payload. Without this, the
 *   re-enqueue below would silently drop tenant routing.
 * @param {number} subscriptionId
 */
async function processRenewal(db, boss, tenantSlug, subscriptionId) {
  if (!tenantSlug) {
    throw new Error("processRenewal requires tenantSlug for pg-boss re-enqueue");
  }
  const { rows: [sub] } = await db.query(
    `SELECT cs.*, sp.name AS plan_name, sp.price, sp.billing_interval, sp.billing_interval_count
     FROM customer_subscriptions cs
     JOIN subscription_plans sp ON sp.id = cs.plan_id
     WHERE cs.id = $1`,
    [subscriptionId]
  );

  if (!sub) {
    logger.warn({ subscriptionId }, "Subscription not found for renewal");
    return;
  }

  if (sub.status !== "active") {
    logger.info({ subscriptionId, status: sub.status }, "Subscription not active — skipping renewal");
    return;
  }

  const { start: nextStart, end: nextEnd } = computeNextPeriod(
    sub.current_period_end,
    sub.billing_interval,
    sub.billing_interval_count
  );

  const { generateInvoiceNumber } = require("./customer-invoicing");
  const invoiceNumber = await generateInvoiceNumber(db);

  // All 4 writes run in one transaction so a crash or error between any
  // two of them rolls back everything. Without this wrapper, a failure
  // between the invoice insert and the subscription period update would
  // leave a hanging invoice with no corresponding run, and the next
  // renewal tick would create a duplicate invoice.
  //
  // boss.send is deliberately OUTSIDE the transaction: pg-boss writes
  // to public.pgboss_* tables, which are not affected by the tenant tx
  // rollback. If we enqueued inside the tx and the tx then rolled back,
  // an orphan renewal job would sit in the queue. Running boss.send
  // AFTER the commit means a queue enqueue only happens when the
  // period has actually advanced.
  const invoice = await db.transaction(async (client) => {
    const { rows: [inv] } = await client.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, total_amount, balance_due, due_date, notes)
       VALUES ($1, $2, 'sent', $3, 0, $3, $3, $4, $5) RETURNING *`,
      [invoiceNumber, sub.customer_id, Number(sub.price), nextStart.toISOString().slice(0, 10), `Subscription renewal: ${sub.plan_name}`]
    );

    await client.query(
      `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
       VALUES ($1, $2, 1, $3, $3)`,
      [inv.id, `${sub.plan_name} subscription — ${sub.billing_interval}`, Number(sub.price)]
    );

    await client.query(
      `INSERT INTO subscription_runs (subscription_id, period_start, period_end, status, invoice_id, charge_amount)
       VALUES ($1, $2, $3, 'invoiced', $4, $5)`,
      [subscriptionId, nextStart, nextEnd, inv.id, Number(sub.price)]
    );

    await client.query(
      `UPDATE customer_subscriptions SET current_period_start = $1, current_period_end = $2, updated_at = NOW() WHERE id = $3`,
      [nextStart, nextEnd, subscriptionId]
    );

    return inv;
  });

  // Set grace period: 7 days after the new period end — gives the customer
  // time to pay the renewal invoice before the subscription degrades to past_due.
  const graceDays = 7;
  const graceEnd = new Date(nextEnd.getTime() + graceDays * 86400000);
  await db.query(
    "UPDATE customer_subscriptions SET grace_period_end = $1 WHERE id = $2",
    [graceEnd, subscriptionId]
  );

  // Schedule next renewal — tenantSlug is threaded through so the worker
  // can set search_path when it fires. Runs AFTER tx commit — see comment
  // above for why this must not move inside the transaction.
  //
  // singletonKey is a deterministic dedupe token per (subscription, period).
  // If the worker crashes between db.transaction commit and this boss.send,
  // the next scheduled tick will enqueue with the same key — pg-boss then
  // rejects the duplicate at the queue layer. Closes the H1 deferred race
  // (fix-plan.md:866) with zero schema change. House pattern: email-worker-boss.js:66
  // already uses singletonKey for lifecycle emails. Per drive-by decision D3.
  await boss.send(
    "subscription-renewal",
    { tenantSlug, subscriptionId },
    {
      startAfter: nextEnd,
      singletonKey: `${subscriptionId}:${nextEnd.toISOString().slice(0, 10)}`,
    }
  );

  // Auto-charge: generate payment link and email it to the customer
  if (sub.auto_charge) {
    try {
      const paymentGateway = require("./payment-gateway");
      if (paymentGateway.isEnabled()) {
        const crypto = require("crypto");
        const linkToken = crypto.randomBytes(16).toString("hex");
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        const { checkout_url, gateway_ref } = await paymentGateway.createCheckout({
          amount: Number(sub.price),
          currency: "PKR",
          reference: `sub-renew-${subscriptionId}-${linkToken}`,
          description: `${sub.plan_name} subscription renewal`,
          returnUrl: `${frontendUrl}/subscription-renewed?subscription=${subscriptionId}`,
          cancelUrl: `${frontendUrl}/customer-invoices`,
        });

        // Record the payment link on the invoice
        await db.query(
          `INSERT INTO customer_invoice_payment_links (invoice_id, link_token, gateway_ref, amount, status, expires_at)
           VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '7 days')`,
          [invoice.id, linkToken, gateway_ref, Number(sub.price)]
        );

        // Email the payment link to the customer
        const { rows: [customer] } = await db.query(
          "SELECT name, email FROM customers WHERE id = $1",
          [sub.customer_id]
        );
        if (customer?.email) {
          const { enqueueEmail } = require("./email");
          await enqueueEmail(db, {
            tenantSlug,
            emailType: "subscription_renewal_payment",
            toEmail: customer.email,
            subject: `Payment due: ${sub.plan_name} subscription renewal`,
            htmlBody: `<p>Hi ${customer.name || ""},</p>
              <p>Your <strong>${sub.plan_name}</strong> subscription has been renewed. Please complete payment of <strong>PKR ${Number(sub.price).toLocaleString()}</strong>.</p>
              <p><a href="${checkout_url}" style="display:inline-block;padding:12px 24px;background:#10b981;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Pay Now</a></p>
              <p>This link expires in 7 days.</p>`,
          });
          logger.info({ subscriptionId, invoiceId: invoice.id, customerEmail: customer.email }, "Subscription renewal payment link emailed");
        }
      }
    } catch (chargeErr) {
      logger.error({ err: chargeErr, subscriptionId }, "Auto-charge payment link generation failed (non-blocking)");
    }
  }

  logger.info({ subscriptionId, invoiceId: invoice.id, nextEnd }, "Subscription renewed — invoice created");
  return invoice;
}

/**
 * Cancel a subscription.
 */
async function cancelSubscription(db, subscriptionId, cancelReason) {
  const { rows: [sub] } = await db.query(
    "UPDATE customer_subscriptions SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [subscriptionId, cancelReason || null]
  );
  return sub;
}

/**
 * Pause a subscription.
 */
async function pauseSubscription(db, subscriptionId) {
  const { rows: [sub] } = await db.query(
    "UPDATE customer_subscriptions SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING *",
    [subscriptionId]
  );
  return sub;
}

/**
 * Resume a paused subscription. Reschedules next renewal.
 *
 * @param {object} db - tenant-scoped db proxy
 * @param {object} boss - pg-boss instance
 * @param {string} tenantSlug - required so the rescheduled renewal job
 *   is dispatched with tenant routing.
 * @param {number} subscriptionId
 */
async function resumeSubscription(db, boss, tenantSlug, subscriptionId) {
  if (!tenantSlug) {
    throw new Error("resumeSubscription requires tenantSlug for pg-boss re-enqueue");
  }

  const { rows: [sub] } = await db.query(
    "UPDATE customer_subscriptions SET status = 'active', paused_at = NULL, updated_at = NOW() WHERE id = $1 AND status = 'paused' RETURNING *",
    [subscriptionId]
  );
  if (!sub) return null;

  // Schedule next renewal at current_period_end
  if (sub.current_period_end) {
    await boss.send(
      "subscription-renewal",
      { tenantSlug, subscriptionId },
      { startAfter: new Date(sub.current_period_end) }
    );
  }

  return sub;
}

module.exports = {
  computeNextPeriod,
  processRenewal,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
};
