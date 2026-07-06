'use strict';

/**
 * Backorder engine (V02 wholesale depth).
 *
 * THE single decision point for "fulfill available + backorder remainder" —
 * every order-taking surface goes through here rather than reimplementing the
 * split. Surfaces map onto two backend entry points:
 *   - POST /api/sales           → POS + field-rep PWA (source 'sale'/'field_order')
 *   - storefront checkout       → public storefront + customer-portal reorder
 *                                 (source 'web_order')
 *
 * Flow contract (identical on every surface):
 *   1. First submit with full quantities → structured `insufficient_stock` 400
 *      carrying { available, requested, backorder_available }.
 *   2. Surface shows the offer; on accept it re-submits with line quantities
 *      clamped to the offered amount PLUS a `backorder_items` array holding the
 *      remainder at the ORDER-time unit price.
 *   3. The order writer calls createBackorders() inside its own transaction so
 *      a rolled-back order never leaves orphan backorder rows.
 *
 * AR / credit-limit rule (stated here on purpose): a backorder is NOT AR.
 * No customer_invoices row exists until the backorder is converted to a sale,
 * so the credit-exposure check (sales.js / customers.js) naturally counts the
 * fulfilled amount only. Statements list open backorders as a memo section,
 * never in the balance.
 *
 * Pricing rule: unit_price is snapshotted at order time and honored at
 * fulfillment — conversion must never re-price, even if price lists changed.
 */

const MAX_QTY = 4; // NUMERIC(12,4) scale on qty columns

function roundQty(n) {
  return Number(Number(n).toFixed(MAX_QTY));
}

/**
 * Is the backorder offer available on this tenant for this buyer?
 * Requires the wholesale_backorders flag AND an identified customer
 * (backorders.customer_id is NOT NULL — an anonymous guest has nobody to
 * notify or invoice later).
 */
async function backordersEnabled(db) {
  try {
    const { rows } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'wholesale_backorders'"
    );
    return rows.length ? rows[0].enabled === true : false;
  } catch {
    return false; // flag table missing on a not-yet-migrated tenant → no offer
  }
}

/**
 * Validate + normalize the backorder_items array a surface re-submitted.
 * Throws statusCode 400 on malformed entries. Returns normalized items.
 */
function normalizeBackorderItems(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) return [];
  return rawItems.map((it, idx) => {
    const productId = Number(it.product_id ?? it.id);
    const qty = roundQty(it.quantity ?? it.qty);
    const unitPrice = Number(it.unit_price ?? it.price);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw Object.assign(new Error(`backorder_items[${idx}]: invalid product_id`), { statusCode: 400 });
    }
    if (!(qty > 0)) {
      throw Object.assign(new Error(`backorder_items[${idx}]: quantity must be > 0`), { statusCode: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error(`backorder_items[${idx}]: invalid unit_price`), { statusCode: 400 });
    }
    return {
      product_id: productId,
      variant_id: it.variant_id ? Number(it.variant_id) : null,
      quantity: qty,
      unit_price: unitPrice,
      notes: typeof it.notes === "string" ? it.notes.slice(0, 500) : null,
    };
  });
}

/**
 * Insert backorder rows inside the caller's transaction.
 *
 * @param {object} client - transaction client (search_path already tenant-scoped)
 * @param {object} opts
 * @param {number} opts.customerId  - REQUIRED (schema NOT NULL)
 * @param {string} opts.sourceType  - 'sale' | 'web_order' | 'field_order'
 * @param {number} opts.sourceId    - the sale/web_order the shortfall came from
 * @param {number|null} opts.outletId
 * @param {Array}  opts.items       - output of normalizeBackorderItems()
 * @param {number|null} opts.createdBy - employee id (null on portal/storefront)
 * @returns {Promise<Array>} inserted rows (id, product_id, qty_ordered, unit_price)
 */
async function createBackorders(client, { customerId, sourceType, sourceId, outletId, items, createdBy }) {
  if (!customerId) {
    throw Object.assign(
      new Error("Backorders require a customer on the order"),
      { statusCode: 400, code: "BACKORDER_REQUIRES_CUSTOMER" }
    );
  }
  const created = [];
  for (const it of items) {
    const { rows: [row] } = await client.query(
      `INSERT INTO backorders
         (customer_id, source_type, source_id, product_id, variant_id, outlet_id,
          qty_ordered, unit_price, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10)
       RETURNING id, product_id, variant_id, qty_ordered, unit_price`,
      [
        customerId, sourceType, sourceId,
        it.product_id, it.variant_id, outletId || null,
        it.quantity, it.unit_price, it.notes, createdBy || null,
      ]
    );
    created.push(row);
  }
  return created;
}

/**
 * Load + lock a backorder row for conversion, verifying the sale line matches.
 * Called from inside the sale transaction (FOR UPDATE prevents two concurrent
 * conversions from over-fulfilling the same backorder).
 * Returns the locked row.
 */
async function lockForFulfillment(client, backorderId) {
  const { rows: [bo] } = await client.query(
    `SELECT id, customer_id, product_id, variant_id, qty_ordered, qty_fulfilled,
            unit_price, status
       FROM backorders WHERE id = $1 FOR UPDATE`,
    [backorderId]
  );
  if (!bo) {
    throw Object.assign(new Error(`Backorder ${backorderId} not found`), { statusCode: 400, code: "BACKORDER_NOT_FOUND" });
  }
  if (bo.status === "cancelled" || bo.status === "fulfilled") {
    throw Object.assign(
      new Error(`Backorder ${backorderId} is ${bo.status}`),
      { statusCode: 400, code: "BACKORDER_NOT_OPEN" }
    );
  }
  return bo;
}

/**
 * Record a (possibly partial) fulfillment against a locked backorder.
 * Caller has already created the sale + sale_item through the standard path.
 */
async function applyFulfillment(client, { backorder, saleId, saleItemId, qty }) {
  const remaining = roundQty(Number(backorder.qty_ordered) - Number(backorder.qty_fulfilled));
  const q = roundQty(qty);
  if (q <= 0 || q > remaining + 1e-9) {
    throw Object.assign(
      new Error(`Fulfillment qty ${q} exceeds remaining ${remaining} on backorder ${backorder.id}`),
      { statusCode: 400, code: "BACKORDER_OVERFULFILL" }
    );
  }
  await client.query(
    `INSERT INTO backorder_fulfillments (backorder_id, sale_id, sale_item_id, qty)
     VALUES ($1,$2,$3,$4)`,
    [backorder.id, saleId, saleItemId || null, q]
  );
  const newFulfilled = roundQty(Number(backorder.qty_fulfilled) + q);
  const newStatus = newFulfilled + 1e-9 >= Number(backorder.qty_ordered) ? "fulfilled" : "partial";
  await client.query(
    `UPDATE backorders SET qty_fulfilled = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [newFulfilled, newStatus, backorder.id]
  );
  return { fulfilled: newFulfilled, status: newStatus };
}

/**
 * F05 notification wrappers — best-effort, never throw into the sale path.
 * Inert unless the tenant's customer_notifications flag is on (central gate
 * inside customer-notify.notify).
 */
async function notifyBackorderEvent(db, { event, customerId, tenantSlug, tenant, data, entityId }) {
  if (!tenantSlug) return; // pg-boss email routing needs the slug; skip silently
  try {
    const { notify } = require("./customer-notify");
    await notify(db, {
      event,
      customerId,
      data,
      tenantSlug,
      tenant,
      entityType: "backorder",
      entityId: entityId || null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[backorder] ${event} notification skipped: ${err.message}`);
  }
}

module.exports = {
  backordersEnabled,
  normalizeBackorderItems,
  createBackorders,
  lockForFulfillment,
  applyFulfillment,
  notifyBackorderEvent,
  roundQty,
};
