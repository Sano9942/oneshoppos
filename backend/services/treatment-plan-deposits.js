"use strict";

/**
 * Treatment plan deposit pre-auth — thin delegate over
 * services/deposit-engine.js (F04 extraction). The engine owns the shared
 * lifecycle; the treatment_plan adapter in ENTITY_ADAPTERS maps it onto
 * treatment_plans columns. Public API and behavior are unchanged from the
 * original standalone implementation.
 *
 * Deposit lifecycle:
 *   pending → authorized → captured   (folio settled with capture)
 *                        → released   (plan completed cleanly, no capture)
 *                        → failed     (gateway rejected / expired)
 */

const engine = require("./deposit-engine");

const ENTITY_TYPE = "treatment_plan";

/**
 * Create a deposit pre-auth checkout session for a treatment plan.
 */
async function createDepositPreAuth(db, { planId, amount, returnUrl, cancelUrl }) {
  return engine.create(db, { entityType: ENTITY_TYPE, entityId: planId, amount, returnUrl, cancelUrl });
}

/**
 * Find the plan that owns a given payment intent id.
 */
async function findPlanByIntent(db, gatewayRef) {
  return engine.findByIntent(db, ENTITY_TYPE, gatewayRef);
}

/**
 * Handle a verified webhook for a treatment plan deposit — same event
 * mapping as room deposits (shared in the engine).
 */
async function handleDepositWebhook(db, { gatewayRef, eventType, status }) {
  return engine.handleWebhook(db, { entityType: ENTITY_TYPE, gatewayRef, eventType, status });
}

/**
 * On folio settlement, capture or release the pre-auth.
 */
async function captureDepositOnSettle(db, planId, { capture }) {
  return engine.settle(db, { entityType: ENTITY_TYPE, entityId: planId, capture });
}

module.exports = {
  createDepositPreAuth,
  handleDepositWebhook,
  captureDepositOnSettle,
  findPlanByIntent,
};
