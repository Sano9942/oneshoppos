"use strict";

/**
 * Unified deposit / pre-auth engine (F04).
 *
 * Extracts the shared deposit lifecycle once and drives it through an
 * entity-adapter registry. Each adapter maps the engine onto its own
 * table/columns, so existing deposits need no data migration.
 *
 * Two capture modes:
 *   - "hold"   (rooms, treatments, rentals): pre-auth → authorize → capture
 *              or release. Rentals additionally support PARTIAL capture
 *              (damage < hold) via authorized/captured amount columns.
 *   - "charge" (service tickets): repair deposits are payments, not holds —
 *              a completed webhook lands straight on 'captured'.
 *
 * Lifecycle (hold): pending → authorized → captured | partially_captured | released | failed
 * Lifecycle (charge): pending → captured | failed
 *
 * Adapter contract (see ENTITY_ADAPTERS):
 *   table, refColumn, statusColumn         — core columns
 *   authorizedAtColumn                     — hold-age stamp (orphan sweep)
 *   authorizedAmountColumn / capturedAmountColumn — partial-capture only
 *   paidAtColumn                           — charge mode: stamp on capture
 *   captureMode                            — "hold" (default) | "charge"
 *   supportsPartialCapture                 — bool (rentals)
 *   fetchSql, notFound, defaultAmount(row) — create() inputs
 *   reference(row), description(row), returnPath(id)
 *   resultIdKey, logLabel, logComponent
 */

const { getPaymentAdapter } = require("./payment-gateway");
const baseLogger = require("./logger");

const ENTITY_ADAPTERS = {
  room_booking: {
    table: "room_bookings",
    refColumn: "deposit_payment_intent_id",
    statusColumn: "deposit_status",
    authorizedAtColumn: "deposit_authorized_at",
    captureMode: "hold",
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
    authorizedAtColumn: "deposit_authorized_at",
    captureMode: "hold",
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

  rental_contract: {
    table: "rental_contracts",
    refColumn: "deposit_payment_intent_id",
    statusColumn: "deposit_status",
    authorizedAtColumn: "deposit_authorized_at",
    authorizedAmountColumn: "deposit_authorized_amount",
    capturedAmountColumn: "deposit_captured_amount",
    supportsPartialCapture: true,
    captureMode: "hold",
    fetchSql: `SELECT rc.*, c.name AS customer_name
               FROM rental_contracts rc
               LEFT JOIN customers c ON c.id = rc.customer_id
               WHERE rc.id = $1`,
    notFound: "Rental contract not found",
    defaultAmount: (row) => Number(row.deposit_collected || 0),
    reference: (row) => `rental-deposit-${row.contract_number}`,
    description: (row) => `Security deposit — rental ${row.contract_number}`,
    returnPath: (id) => `/rentals/contracts/${id}`,
    resultIdKey: "contractId",
    logLabel: "Rental deposit",
    logComponent: "rental-deposits",
  },

  service_ticket: {
    table: "service_tickets",
    refColumn: "deposit_payment_intent_id",
    statusColumn: "deposit_status",
    authorizedAtColumn: "deposit_authorized_at",
    paidAtColumn: "deposit_paid_at",
    captureMode: "charge", // repair deposit is a payment, not a hold
    fetchSql: `SELECT st.*, c.name AS customer_name
               FROM service_tickets st
               LEFT JOIN customers c ON c.id = st.customer_id
               WHERE st.id = $1`,
    notFound: "Service ticket not found",
    defaultAmount: (row) => Number(row.deposit_amount || 0),
    reference: (row) => `ticket-deposit-${row.ticket_number}`,
    description: (row) => `Repair deposit — ticket ${row.ticket_number}`,
    returnPath: (id) => `/service-tickets/${id}`,
    resultIdKey: "ticketId",
    logLabel: "Service ticket deposit",
    logComponent: "service-ticket-deposits",
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
 * `captureMode==='charge'` treats a completed payment as an immediate capture
 * (a repair deposit is money taken, not a hold). Returns the current status
 * unchanged for unrecognized events.
 */
function mapWebhookToStatus({ eventType, status }, currentStatus, captureMode = "hold") {
  if (status === "captured" || eventType === "payment.captured") {
    return "captured";
  }
  if (status === "authorized" || eventType === "payment.authorized" || eventType === "authorization.success") {
    return "authorized";
  }
  if (status === "released" || status === "refunded" || eventType === "payment.released" || eventType === "payment.refunded") {
    return "released";
  }
  if (status === "failed" || eventType === "payment.failed") {
    return "failed";
  }
  if (status === "completed" || eventType === "payment.completed") {
    // Hold mode: auth-and-capture single-step → authorized; settle captures.
    // Charge mode: the payment is complete → captured immediately.
    return captureMode === "charge" ? "captured" : "authorized";
  }
  return currentStatus;
}

/**
 * Create a deposit pre-auth (or charge) checkout session for an entity.
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

  // Persist the pre-auth amount for partial-capture adapters so capture() can
  // cap against it later.
  const sets = [`${cfg.refColumn} = $1`, `${cfg.statusColumn} = 'pending'`, "updated_at = NOW()"];
  const params = [gateway_ref];
  if (cfg.authorizedAmountColumn) {
    params.push(depositAmount);
    sets.push(`${cfg.authorizedAmountColumn} = $${params.length}`);
  }
  params.push(entityId);
  await db.query(
    `UPDATE ${cfg.table} SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params
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
 * signature. `db` must already be scoped to the tenant that owns the ref.
 * Stamps the hold-age column when transitioning into 'authorized' and the
 * paid-at column when a charge transitions into 'captured'.
 */
async function handleWebhook(db, { entityType, gatewayRef, eventType, status }) {
  const cfg = getAdapterConfig(entityType);
  const row = await findByIntent(db, entityType, gatewayRef);
  if (!row) return { ok: false, reason: "Unknown deposit intent" };

  const prev = row[cfg.statusColumn];
  const newStatus = mapWebhookToStatus({ eventType, status }, prev, cfg.captureMode);

  const sets = [`${cfg.statusColumn} = $1`, "updated_at = NOW()"];
  if (newStatus === "authorized" && cfg.authorizedAtColumn) {
    // COALESCE preserves the original authorize time across webhook replays.
    sets.push(`${cfg.authorizedAtColumn} = COALESCE(${cfg.authorizedAtColumn}, NOW())`);
  }
  if (newStatus === "captured" && cfg.paidAtColumn) {
    sets.push(`${cfg.paidAtColumn} = COALESCE(${cfg.paidAtColumn}, NOW())`);
  }

  await db.query(
    `UPDATE ${cfg.table} SET ${sets.join(", ")} WHERE id = $2`,
    [newStatus, row.id]
  );

  logFor(cfg).info(
    { [cfg.resultIdKey]: row.id, gatewayRef, prev, next: newStatus, eventType, status },
    `${cfg.logLabel} webhook processed`
  );

  return { ok: true, [cfg.resultIdKey]: row.id, deposit_status: newStatus };
}

/**
 * Full capture or release of an authorized hold (rooms, treatments). Gated on
 * `deposit_status='authorized'` under `SELECT ... FOR UPDATE` so a retried
 * settlement (double-click / network retry) can't capture twice.
 */
async function settle(db, { entityType, entityId, capture }) {
  const cfg = getAdapterConfig(entityType);
  return db.transaction(async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, ${cfg.refColumn} AS ref, ${cfg.statusColumn} AS status FROM ${cfg.table} WHERE id = $1 FOR UPDATE`,
      [entityId]
    );
    if (!row) return null;
    if (!row.ref || row.status !== "authorized") {
      return { skipped: true, reason: "No authorized deposit to capture/release" };
    }

    const next = capture ? "captured" : "released";
    await client.query(
      `UPDATE ${cfg.table} SET ${cfg.statusColumn} = $1, updated_at = NOW() WHERE id = $2`,
      [next, entityId]
    );
    logFor(cfg).info({ [cfg.resultIdKey]: entityId, action: next }, `${cfg.logLabel} settled`);
    return { deposit_status: next };
  });
}

/**
 * Partial or full capture of an authorized hold, capping at the authorized
 * amount (rentals: capture damage/late-fee ≤ hold, release the rest). Gated on
 * `deposit_status='authorized'` under `FOR UPDATE` (double-capture idempotency).
 * A capture of 0 releases the hold.
 */
async function capture(db, { entityType, entityId, amount }) {
  const cfg = getAdapterConfig(entityType);
  if (!cfg.supportsPartialCapture) {
    // Non-partial adapters: any positive amount is a full capture.
    return settle(db, { entityType, entityId, capture: Number(amount) > 0 });
  }
  return db.transaction(async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, ${cfg.refColumn} AS ref, ${cfg.statusColumn} AS status,
              ${cfg.authorizedAmountColumn} AS authorized
       FROM ${cfg.table} WHERE id = $1 FOR UPDATE`,
      [entityId]
    );
    if (!row) return null;
    if (!row.ref || row.status !== "authorized") {
      return { skipped: true, reason: "No authorized deposit to capture/release" };
    }

    const authorized = Number(row.authorized || 0);
    let captureAmt = Math.max(0, Number(amount || 0));
    if (authorized > 0) captureAmt = Math.min(captureAmt, authorized);

    let next;
    if (captureAmt <= 0) {
      next = "released";
    } else if (authorized > 0 && captureAmt >= authorized) {
      next = "captured";
    } else {
      next = "partially_captured";
    }

    await client.query(
      `UPDATE ${cfg.table}
         SET ${cfg.statusColumn} = $1,
             ${cfg.capturedAmountColumn} = $2,
             updated_at = NOW()
       WHERE id = $3`,
      [next, next === "released" ? 0 : captureAmt, entityId]
    );
    logFor(cfg).info(
      { [cfg.resultIdKey]: entityId, action: next, captured: captureAmt, authorized },
      `${cfg.logLabel} captured`
    );
    return { deposit_status: next, captured_amount: next === "released" ? 0 : captureAmt };
  });
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
  capture,
  release,
  mapWebhookToStatus,
};
