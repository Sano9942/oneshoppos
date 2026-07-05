"use strict";

/**
 * Room deposit pre-auth — thin delegate over services/deposit-engine.js
 * (F04 extraction). The engine owns the shared lifecycle; the room_booking
 * adapter in ENTITY_ADAPTERS maps it onto room_bookings columns. Public API
 * and behavior are unchanged from the original standalone implementation.
 *
 * Deposit lifecycle:
 *   pending → authorized → captured   (guest caused damage / extra charges)
 *                        → released   (clean check-out, no capture)
 *                        → failed     (gateway rejected / expired)
 */

const engine = require("./deposit-engine");

const ENTITY_TYPE = "room_booking";

/**
 * Create a deposit pre-auth checkout session for a booking.
 *
 * The gateway_ref returned by the adapter is stored on the booking
 * (`deposit_payment_intent_id`) so the webhook handler can look it up.
 * With the `manual` gateway it throws — callers should guard on
 * `getPaymentAdapter().isEnabled()` when presenting the "Send deposit link"
 * button.
 */
async function createDepositPreAuth(db, { bookingId, amount, returnUrl, cancelUrl }) {
  return engine.create(db, { entityType: ENTITY_TYPE, entityId: bookingId, amount, returnUrl, cancelUrl });
}

/**
 * Find the booking that owns a given payment intent id (gateway_ref) —
 * used by the webhook handler.
 */
async function findBookingByIntent(db, gatewayRef) {
  return engine.findByIntent(db, ENTITY_TYPE, gatewayRef);
}

/**
 * Handle a verified payment webhook for a room deposit. Called from
 * routes/webhooks.js after adapter.verifyWebhook() has confirmed the
 * signature. `db` must be scoped to the tenant that owns the gateway_ref.
 */
async function handleDepositWebhook(db, { gatewayRef, eventType, status }) {
  return engine.handleWebhook(db, { entityType: ENTITY_TYPE, gatewayRef, eventType, status });
}

/**
 * At folio settlement, either capture the pre-auth (if damage/extras)
 * or release it (clean check-out).
 */
async function captureDepositOnCheckout(db, bookingId, { capture }) {
  return engine.settle(db, { entityType: ENTITY_TYPE, entityId: bookingId, capture });
}

module.exports = {
  createDepositPreAuth,
  handleDepositWebhook,
  captureDepositOnCheckout,
  findBookingByIntent,
};
