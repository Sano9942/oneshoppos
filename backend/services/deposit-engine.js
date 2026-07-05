"use strict";

/**
 * Unified deposit / pre-auth engine (F04).
 *
 * services/room-deposits.js and services/treatment-plan-deposits.js were
 * structural twins (createDepositPreAuth / handleDepositWebhook / capture* /
 * find*ByIntent) — this module extracts the shared lifecycle once and drives
 * it through an entity-adapter registry. Each adapter maps the engine onto
 * its own table/columns, so existing deposits need no data migration and the
 * two original services keep their exact public API as thin delegates.
 *
 * Deposit lifecycle (mirrors room_bookings.deposit_status state machine):
 *   pending → authorized → captured   (damage / extras / settled with capture)
 *                        → released   (clean completion, no capture)
 *                        → failed     (gateway rejected / expired)
 *
 * Adapter contract (see ENTITY_ADAPTERS):
 *   table              — entity table name
 *   refColumn          — column holding the gateway ref (payment intent id)
 *   statusColumn       — column holding the deposit status
 *   fetchSql           — SELECT returning the entity row (joins allowed), $1 = id
 *   notFound           — 404 message when the entity row is missing
 *   defaultAmount(row) — fallback deposit amount when caller passes none
 *   reference(row)     — gateway reference string (unique per entity)
 *   description(row)   — human description shown on the checkout page
 *   returnPath(id)     — frontend path appended to FRONTEND_URL for return/cancel
 *   resultIdKey        — key name for the entity id in webhook results
 *                        (kept per-entity for backwards compatibility)
 *   logLabel           — human label used in log lines
 *   logComponent       — pino child component name (kept per-entity so log
 *                        filtering stays unchanged after the extraction)
 */

const { getPaymentAdapter } = require("./payment-gateway");
const baseLogger = require("./logger");

const ENTITY_ADAPTERS = {
  room_booking: {
    table: "room_bookings",
    refColumn: "deposit_payment_intent_id",
    statusColumn: "deposit_status",
    fetchSql: `SELECT b.*, rt.deposit_required, rt.name AS room_type_name, c.name AS customer_name
               FROM room_bookings b
               LEFT JOIN room_types rt ON rt.id = b.room_type_id
               LEFT JOIN customers c ON c.id = b.customer_id
               WHERE b.id = $1`,
    notFound: "Booking not found",
    defaultAmount: (row) => Number(row.deposit_required || 0),
    reference: (row) => `room-deposit-${row.booking_number}`,
    description: (row) => `Security deposit — ${row.room_type_name || "Room"} (${row.booking_number})`,
    returnPath: (id) => `/rooms/bookings/${id}`,
    resultIdKey: "bookingId",
    logLabel: "Room deposit",
    logComponent: "room-deposits",
  },

  treatment_plan: {
    table: "treatment_plans",
    refColumn: "deposit_payment_intent_id",
    statusColumn: "deposit_status",
    fetchSql: `SELECT p.*, c.name AS customer_name
               FROM treatment_plans p
               LEFT JOIN customers c ON c.id = p.customer_id
               WHERE p.id = $1`,
    notFound: "Treatment plan not found",
    defaultAmount: (row) => Number(row.deposit_collected || 0),
    reference: (row) => `treatment-deposit-${row.plan_number}`,
    description: (row) => `Treatment plan deposit — ${row.plan_number}`,
    returnPath: (id) => `/treatment-plans/${id}`,
    resultIdKey: "planId",
    logLabel: "Treatment plan deposit",
    logComponent: "treatment-plan-deposits",
  },
};

function getAdapterConfig(entityType) {
  const cfg = ENTITY_ADAPTERS[entityType];
  if (!cfg) throw new Error(`Unknown deposit entity type: ${entityType}`);
  return cfg;
}

function logFor(cfg) {
  return baseLogger.child({ component: cfg.logComponent });
}

/**
 * Map a verified gateway webhook event onto a deposit status transition.
 * Shared verbatim from the two original services — both used the identical
 * mapping. Returns the current status unchanged for unrecognized events.
 */
function mapWebhookToStatus({ eventType, status }, currentStatus) {
  if (status === "authorized" || eventType === "payment.authorized" || eventType === "authorization.success") {
    return "authorized";
  }
  if (status === "captured" || eventType === "payment.captured") {
    return "captured";
  }
  if (status === "released" || status === "refunded" || eventType === "payment.released" || eventType === "payment.refunded") {
    return "released";
  }
  if (status === "failed" || eventType === "payment.failed") {
    return "failed";
  }
  if (status === "completed" || eventType === "payment.completed") {
    // Some gateways send completed for the auth-and-capture single-step flow —
    // treat as authorized; the settle step will trigger capture/release.
    return "authorized";
  }
  return currentStatus;
}

/**
 * Create a deposit pre-auth checkout session for an entity.
 * Stores the gateway_ref on the entity row so the webhook can look it up.
 */
async function create(db, { entityType, entityId, amount, returnUrl, cancelUrl }) {
  const cfg = getAdapterConfig(entityType);
  const { rows: [row] } = await db.query(cfg.fetchSql, [entityId]);
  if (!row) {
    throw Object.assign(new Error(cfg.notFound), { statusCode: 404 });
  }

  const depositAmount = Number(amount || cfg.defaultAmount(row) || 0);
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

  const { checkout_url, gateway_ref } = await adapter.createCheckout({
    amount: depositAmount,
    currency: "PKR",
    reference: cfg.reference(row),
    description: cfg.description(row),
    returnUrl: returnUrl || `${process.env.FRONTEND_URL || ""}${cfg.returnPath(entityId)}`,
    cancelUrl: cancelUrl || `${process.env.FRONTEND_URL || ""}${cfg.returnPath(entityId)}`,
  });

  await db.query(
    `UPDATE ${cfg.table}
       SET ${cfg.refColumn} = $1,
           ${cfg.statusColumn} = 'pending',
           updated_at = NOW()
     WHERE id = $2`,
    [gateway_ref, entityId]
  );

  logFor(cfg).info(
    { [cfg.resultIdKey]: entityId, gateway_ref, amount: depositAmount },
    `${cfg.logLabel} pre-auth created`
  );

  return { checkout_url, gateway_ref, amount: depositAmount };
}

/**
 * Find the entity row that owns a given gateway_ref.
 */
async function findByIntent(db, entityType, gatewayRef) {
  const cfg = getAdapterConfig(entityType);
  const { rows: [row] } = await db.query(
    `SELECT * FROM ${cfg.table} WHERE ${cfg.refColumn} = $1`,
    [gatewayRef]
  );
  return row || null;
}

/**
 * Handle a verified payment webhook for a deposit. Called from
 * routes/webhooks.js after adapter.verifyWebhook() has confirmed the
 * signature. Runs outside tenant middleware — `db` must already be scoped
 * to the tenant that owns the gateway_ref.
 */
async function handleWebhook(db, { entityType, gatewayRef, eventType, status }) {
  const cfg = getAdapterConfig(entityType);
  const row = await findByIntent(db, entityType, gatewayRef);
  if (!row) return { ok: false, reason: "Unknown deposit intent" };

  const prev = row[cfg.statusColumn];
  const newStatus = mapWebhookToStatus({ eventType, status }, prev);

  await db.query(
    `UPDATE ${cfg.table} SET ${cfg.statusColumn} = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, row.id]
  );

  logFor(cfg).info(
    { [cfg.resultIdKey]: row.id, gatewayRef, prev, next: newStatus, eventType, status },
    `${cfg.logLabel} webhook processed`
  );

  return { ok: true, [cfg.resultIdKey]: row.id, deposit_status: newStatus };
}

/**
 * At the entity's settlement point (room checkout / plan folio settle /
 * rental return), either capture the pre-auth or release it. For adapters
 * that don't implement separate auth/capture this is a record update only.
 */
async function settle(db, { entityType, entityId, capture }) {
  const cfg = getAdapterConfig(entityType);
  const { rows: [row] } = await db.query(
    `SELECT * FROM ${cfg.table} WHERE id = $1`,
    [entityId]
  );
  if (!row) return null;
  if (!row[cfg.refColumn] || row[cfg.statusColumn] !== "authorized") {
    return { skipped: true, reason: "No authorized deposit to capture/release" };
  }

  const next = capture ? "captured" : "released";
  await db.query(
    `UPDATE ${cfg.table} SET ${cfg.statusColumn} = $1, updated_at = NOW() WHERE id = $2`,
    [next, entityId]
  );
  logFor(cfg).info({ [cfg.resultIdKey]: entityId, action: next }, `${cfg.logLabel} settled`);
  return { deposit_status: next };
}

/**
 * Release an authorized hold without capture — clean return / cancellation.
 */
async function release(db, { entityType, entityId }) {
  return settle(db, { entityType, entityId, capture: false });
}

module.exports = {
  ENTITY_ADAPTERS,
  create,
  findByIntent,
  handleWebhook,
  settle,
  release,
  mapWebhookToStatus,
};
