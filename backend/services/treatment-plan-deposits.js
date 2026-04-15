"use strict";

/**
 * Treatment plan deposit pre-auth — adapter-agnostic wrapper over the
 * payment-gateway adapter registry. Mirrors services/room-deposits.js (M9).
 *
 * Dispatches on `PAYMENT_GATEWAY` env var — sandbox (local/testing), xpay
 * (production), manual (no online pre-auth) all share the same code path.
 *
 * Deposit lifecycle:
 *   pending → authorized → captured   (folio settled with capture)
 *                        → released   (plan completed cleanly, no capture)
 *                        → failed     (gateway rejected / expired)
 */

const { getPaymentAdapter } = require("./payment-gateway");
const logger = require("./logger").child({ component: "treatment-plan-deposits" });

/**
 * Create a deposit pre-auth checkout session for a treatment plan.
 */
async function createDepositPreAuth(db, { planId, amount, returnUrl, cancelUrl }) {
  const { rows: [plan] } = await db.query(
    `SELECT p.*, c.name AS customer_name
     FROM treatment_plans p
     LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.id = $1`,
    [planId]
  );
  if (!plan) {
    throw Object.assign(new Error("Treatment plan not found"), { statusCode: 404 });
  }

  const depositAmount = Number(amount || plan.deposit_collected || 0);
  if (depositAmount <= 0) {
    throw Object.assign(new Error("Deposit amount must be > 0"), { statusCode: 400 });
  }

  const adapter = getPaymentAdapter();
  if (!adapter.isEnabled()) {
    throw Object.assign(
      new Error("Online payment gateway is not configured — use manual deposit entry"),
      { statusCode: 400 }
    );
  }

  const reference = `treatment-deposit-${plan.plan_number}`;
  const description = `Treatment plan deposit — ${plan.plan_number}`;

  const { checkout_url, gateway_ref } = await adapter.createCheckout({
    amount: depositAmount,
    currency: "PKR",
    reference,
    description,
    returnUrl: returnUrl || `${process.env.FRONTEND_URL || ""}/treatment-plans/${planId}`,
    cancelUrl: cancelUrl || `${process.env.FRONTEND_URL || ""}/treatment-plans/${planId}`,
  });

  await db.query(
    `UPDATE treatment_plans
       SET deposit_payment_intent_id = $1,
           deposit_status = 'pending',
           updated_at = NOW()
     WHERE id = $2`,
    [gateway_ref, planId]
  );

  logger.info({ planId, gateway_ref, amount: depositAmount }, "Treatment plan deposit pre-auth created");

  return { checkout_url, gateway_ref, amount: depositAmount };
}

/**
 * Find the plan that owns a given payment intent id.
 */
async function findPlanByIntent(db, gatewayRef) {
  const { rows: [plan] } = await db.query(
    "SELECT * FROM treatment_plans WHERE deposit_payment_intent_id = $1",
    [gatewayRef]
  );
  return plan || null;
}

/**
 * Handle a verified webhook for a treatment plan deposit — mirrors M9
 * room-deposits.handleDepositWebhook exactly on event mapping.
 */
async function handleDepositWebhook(db, { gatewayRef, eventType, status }) {
  const plan = await findPlanByIntent(db, gatewayRef);
  if (!plan) return { ok: false, reason: "Unknown deposit intent" };

  let newStatus = plan.deposit_status;
  if (status === "authorized" || eventType === "payment.authorized" || eventType === "authorization.success") {
    newStatus = "authorized";
  } else if (status === "captured" || eventType === "payment.captured") {
    newStatus = "captured";
  } else if (status === "released" || status === "refunded" || eventType === "payment.released" || eventType === "payment.refunded") {
    newStatus = "released";
  } else if (status === "failed" || eventType === "payment.failed") {
    newStatus = "failed";
  } else if (status === "completed" || eventType === "payment.completed") {
    // Auth-and-capture single-step — treat as authorized; settle triggers capture/release later.
    newStatus = "authorized";
  }

  await db.query(
    "UPDATE treatment_plans SET deposit_status = $1, updated_at = NOW() WHERE id = $2",
    [newStatus, plan.id]
  );

  logger.info(
    { planId: plan.id, gatewayRef, prev: plan.deposit_status, next: newStatus, eventType, status },
    "Treatment plan deposit webhook processed"
  );

  return { ok: true, planId: plan.id, deposit_status: newStatus };
}

/**
 * On folio settlement, capture or release the pre-auth.
 */
async function captureDepositOnSettle(db, planId, { capture }) {
  const { rows: [plan] } = await db.query(
    "SELECT * FROM treatment_plans WHERE id = $1",
    [planId]
  );
  if (!plan) return null;
  if (!plan.deposit_payment_intent_id || plan.deposit_status !== "authorized") {
    return { skipped: true, reason: "No authorized deposit to capture/release" };
  }

  const next = capture ? "captured" : "released";
  await db.query(
    "UPDATE treatment_plans SET deposit_status = $1, updated_at = NOW() WHERE id = $2",
    [next, planId]
  );
  logger.info({ planId, action: next }, "Treatment plan deposit settled");
  return { deposit_status: next };
}

module.exports = {
  createDepositPreAuth,
  handleDepositWebhook,
  captureDepositOnSettle,
  findPlanByIntent,
};
