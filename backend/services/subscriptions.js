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

  // Create invoice for this renewal
  const { generateInvoiceNumber } = require("./customer-invoicing");
  const invoiceNumber = await generateInvoiceNumber(db);

  const { rows: [invoice] } = await db.query(
    `INSERT INTO customer_invoices
       (invoice_number, customer_id, status, subtotal, tax_total, total_amount, balance_due, due_date, notes)
     VALUES ($1, $2, 'sent', $3, 0, $3, $3, $4, $5) RETURNING *`,
    [invoiceNumber, sub.customer_id, Number(sub.price), nextStart.toISOString().slice(0, 10), `Subscription renewal: ${sub.plan_name}`]
  );

  // Insert invoice item
  await db.query(
    `INSERT INTO customer_invoice_items (invoice_id, description, quantity, unit_price, line_total)
     VALUES ($1, $2, 1, $3, $3)`,
    [invoice.id, `${sub.plan_name} subscription — ${sub.billing_interval}`, Number(sub.price)]
  );

  // Create subscription run
  await db.query(
    `INSERT INTO subscription_runs (subscription_id, period_start, period_end, status, invoice_id, charge_amount)
     VALUES ($1, $2, $3, 'invoiced', $4, $5)`,
    [subscriptionId, nextStart, nextEnd, invoice.id, Number(sub.price)]
  );

  // Advance the subscription period
  await db.query(
    `UPDATE customer_subscriptions SET current_period_start = $1, current_period_end = $2, updated_at = NOW() WHERE id = $3`,
    [nextStart, nextEnd, subscriptionId]
  );

  // Schedule next renewal — tenantSlug is threaded through so the worker
  // can set search_path when it fires.
  await boss.send(
    "subscription-renewal",
    { tenantSlug, subscriptionId },
    { startAfter: nextEnd }
  );

  logger.info({ subscriptionId, invoiceId: invoice.id, nextEnd }, "Subscription renewed — invoice created");
  return invoice;
}

/**
 * Cancel a subscription.
 */
async function cancelSubscription(db, subscriptionId) {
  const { rows: [sub] } = await db.query(
    "UPDATE customer_subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
    [subscriptionId]
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
