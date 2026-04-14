"use strict";

/**
 * Room deposit pre-auth — adapter-agnostic wrapper over the payment-gateway
 * adapter registry. Dispatches on `PAYMENT_GATEWAY` env var so sandbox
 * (local + Railway testing), xpay (production), and manual (cash/card at
 * check-in, no online pre-auth) all share the same code path.
 *
 * Deposit lifecycle:
 *   pending → authorized → captured   (guest caused damage / extra charges)
 *                        → released   (clean check-out, no capture)
 *                        → failed     (gateway rejected / expired)
 */

const { getPaymentAdapter } = require("./payment-gateway");
const logger = require("./logger").child({ component: "room-deposits" });

/**
 * Create a deposit pre-auth checkout session for a booking.
 *
 * The gateway_ref returned by the adapter is stored on the booking
 * (`deposit_payment_intent_id`) so the webhook handler can look it up.
 *
 * Works with: `sandbox`, `xpay`, any future adapter that implements
 * `createCheckout()`. With `manual` it throws — callers should guard on
 * `getPaymentAdapter().isEnabled()` when presenting the "Send deposit link"
 * button.
 */
async function createDepositPreAuth(db, { bookingId, amount, returnUrl, cancelUrl }) {
  const { rows: [booking] } = await db.query(
    `SELECT b.*, rt.deposit_required, rt.name AS room_type_name, c.name AS customer_name
     FROM room_bookings b
     LEFT JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.id = $1`,
    [bookingId]
  );
  if (!booking) {
    throw Object.assign(new Error("Booking not found"), { statusCode: 404 });
  }

  const depositAmount = Number(amount || booking.deposit_required || 0);
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

  const reference = `room-deposit-${booking.booking_number}`;
  const description = `Security deposit — ${booking.room_type_name || "Room"} (${booking.booking_number})`;

  const { checkout_url, gateway_ref } = await adapter.createCheckout({
    amount: depositAmount,
    currency: "PKR",
    reference,
    description,
    returnUrl: returnUrl || `${process.env.FRONTEND_URL || ""}/rooms/bookings/${bookingId}`,
    cancelUrl: cancelUrl || `${process.env.FRONTEND_URL || ""}/rooms/bookings/${bookingId}`,
  });

  await db.query(
    `UPDATE room_bookings
       SET deposit_payment_intent_id = $1,
           deposit_status = 'pending',
           updated_at = NOW()
     WHERE id = $2`,
    [gateway_ref, bookingId]
  );

  logger.info({ bookingId, gateway_ref, amount: depositAmount }, "Room deposit pre-auth created");

  return { checkout_url, gateway_ref, amount: depositAmount };
}

/**
 * Find the booking that owns a given payment intent id (gateway_ref) —
 * used by the webhook handler (Context 3).
 */
async function findBookingByIntent(db, gatewayRef) {
  const { rows: [booking] } = await db.query(
    "SELECT * FROM room_bookings WHERE deposit_payment_intent_id = $1",
    [gatewayRef]
  );
  return booking || null;
}

/**
 * Handle a verified payment webhook for a room deposit. Called from
 * routes/webhooks.js Context 3 after adapter.verifyWebhook() has already
 * confirmed the signature.
 *
 * Note: this runs outside tenant middleware, so `db` must be a tenant-scoped
 * proxy resolved by the caller (typically via the default db-pg proxy, since
 * webhook routes mount before tenant middleware but the deposit intent_id
 * uniquely identifies the tenant+booking).
 */
async function handleDepositWebhook(db, { gatewayRef, eventType, status }) {
  const booking = await findBookingByIntent(db, gatewayRef);
  if (!booking) return { ok: false, reason: "Unknown deposit intent" };

  let newStatus = booking.deposit_status;
  if (status === "authorized" || eventType === "payment.authorized" || eventType === "authorization.success") {
    newStatus = "authorized";
  } else if (status === "captured" || eventType === "payment.captured") {
    newStatus = "captured";
  } else if (status === "released" || status === "refunded" || eventType === "payment.released" || eventType === "payment.refunded") {
    newStatus = "released";
  } else if (status === "failed" || eventType === "payment.failed") {
    newStatus = "failed";
  } else if (status === "completed" || eventType === "payment.completed") {
    // Some gateways send completed for the auth-and-capture single-step flow —
    // treat as authorized; the settle step will trigger capture/release.
    newStatus = "authorized";
  }

  await db.query(
    "UPDATE room_bookings SET deposit_status = $1, updated_at = NOW() WHERE id = $2",
    [newStatus, booking.id]
  );

  logger.info(
    { bookingId: booking.id, gatewayRef, prev: booking.deposit_status, next: newStatus, eventType, status },
    "Room deposit webhook processed"
  );

  return { ok: true, bookingId: booking.id, deposit_status: newStatus };
}

/**
 * At folio settlement, either capture the pre-auth (if damage/extras)
 * or release it (clean check-out). For adapters that don't implement
 * separate auth/capture, this is a no-op record update.
 */
async function captureDepositOnCheckout(db, bookingId, { capture }) {
  const { rows: [booking] } = await db.query(
    "SELECT * FROM room_bookings WHERE id = $1",
    [bookingId]
  );
  if (!booking) return null;
  if (!booking.deposit_payment_intent_id || booking.deposit_status !== "authorized") {
    return { skipped: true, reason: "No authorized deposit to capture/release" };
  }

  const next = capture ? "captured" : "released";
  await db.query(
    "UPDATE room_bookings SET deposit_status = $1, updated_at = NOW() WHERE id = $2",
    [next, bookingId]
  );
  logger.info({ bookingId, action: next }, "Room deposit settled");
  return { deposit_status: next };
}

module.exports = {
  createDepositPreAuth,
  handleDepositWebhook,
  captureDepositOnCheckout,
  findBookingByIntent,
};
