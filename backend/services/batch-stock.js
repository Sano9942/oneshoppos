'use strict';

/**
 * Batch / expiry / lot engine (F07) — THE single home for batch stock semantics.
 *
 * Batches are a PARALLEL LEDGER, not a replacement. `outlet_stock.quantity`
 * (and `variant_outlet_stock.quantity` for variant SKUs) remain the authoritative
 * total every existing consumer reads. For products with `products.track_batches`,
 * `stock_batches` rows DECOMPOSE that total into identifiable lots (batch number,
 * expiry, unit cost) or divisible rolls (textile).
 *
 * Invariant (tracked products):
 *   Σ stock_batches.remaining_qty (status='active') = outlet_stock.quantity
 * maintained by calling these helpers INSIDE the caller's existing transaction,
 * AFTER the caller's `outlet_stock`/`variant_outlet_stock FOR UPDATE` (which already
 * serializes concurrent access to the product/outlet[/variant] key — that outer
 * lock is what makes the parallel-batch-drain race safe). We additionally lock the
 * batch rows FOR UPDATE as defense-in-depth.
 *
 * Consumption policy: FEFO — first-expiry-first-out; batches with no expiry sort
 * last (consumed after dated stock), then FIFO by id.
 *
 * Drift tolerance (non-negotiable): if a tracked product's active batches sum to
 * LESS than the requested qty (pre-existing ledger drift, or tracking switched on
 * over legacy stock), consume what exists, log a drift warning, and RETURN — never
 * throw, never block the sale. The base `outlet_stock` decrement (owned by the
 * caller) is the source of truth and always proceeds. Blocking a sale on ledger
 * drift would be a regression vs. the pre-F07 behavior.
 *
 * Untracked products: every function short-circuits to a no-op ({ tracked:false }),
 * so calling them on a normal SKU changes nothing. Hot paths (POS) additionally
 * gate the call behind loadTrackedMap() so untracked lines pay zero extra queries.
 */

const logger = require('./logger');

const QTY_SCALE = 4;

/** Single rounding point for all batch qty math (mirrors kit-engine roundQty). */
function roundQty(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** QTY_SCALE;
  return Math.round(x * f) / f;
}

/**
 * Batched track_batches lookup for hot paths. Returns Map(productId -> boolean).
 * sales.js uses this to skip consumeBatches entirely for untracked lines.
 */
async function loadTrackedMap(runner, productIds) {
  const ids = [...new Set((productIds || []).map((n) => Number(n)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await runner.query(
    `SELECT id, COALESCE(track_batches, false) AS track_batches
       FROM products WHERE id = ANY($1::int[])`,
    [ids]
  );
  for (const r of rows) map.set(Number(r.id), r.track_batches === true);
  return map;
}

/** Cheap single-product tracked check. */
async function isTracked(runner, productId) {
  const { rows: [r] } = await runner.query(
    `SELECT COALESCE(track_batches, false) AS t FROM products WHERE id = $1`,
    [Number(productId)]
  );
  return !!(r && r.t === true);
}

/**
 * Create a received batch (GRN capture) + its 'receive' movement. Caller owns the
 * transaction and bumps outlet_stock in the same tx. Returns the new batch id.
 */
async function receiveBatch(client, {
  productId, variantId = null, outletId, batchNumber, expiryDate = null,
  qty, unitCost = null, grnId = null, lotType = 'batch',
}) {
  const rq = roundQty(qty);
  const bn = (batchNumber && String(batchNumber).trim()) || defaultBatchNumber(grnId);
  const { rows: [b] } = await client.query(
    `INSERT INTO stock_batches
       (product_id, variant_id, outlet_id, lot_type, batch_number, expiry_date,
        received_qty, remaining_qty, unit_cost, grn_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)
     RETURNING id`,
    [productId, variantId, outletId, lotType, bn, expiryDate || null, rq, unitCost, grnId]
  );
  await client.query(
    `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
     VALUES ($1,'receive',$2,'grn',$3)`,
    [b.id, rq, grnId]
  );
  return b.id;
}

function defaultBatchNumber(grnId) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return grnId ? `GRN${grnId}-${stamp}` : `LOT-${Date.now()}`;
}

/**
 * FEFO-consume `qty` of a tracked product from its active batches. Call AFTER the
 * caller's outlet_stock FOR UPDATE, inside the same tx. Drift-tolerant (see file
 * header). Returns { tracked, allocations:[{batchId, qty}], shortfall }.
 *
 * @param batchId       optional manual pick (butcher's specific carcass / cashier's
 *                      chosen roll) — consumes only from that batch.
 * @param movementType  'sale' (default) | 'adjust' | 'write_off' — the audit label.
 * @param depletedStatus status to set when a batch hits 0 ('depleted' default;
 *                      'written_off' for expiry write-offs).
 */
async function consumeBatches(client, {
  productId, variantId = null, outletId, qty, refType = null, refId = null,
  batchId = null, movementType = 'sale', depletedStatus = 'depleted',
}) {
  const need = roundQty(qty);
  if (!(need > 0)) return { tracked: false, allocations: [], shortfall: 0 };

  if (!(await isTracked(client, productId))) {
    return { tracked: false, allocations: [], shortfall: 0 };
  }

  let batches;
  if (batchId) {
    const { rows } = await client.query(
      `SELECT id, remaining_qty FROM stock_batches
        WHERE id = $1 AND status = 'active' AND remaining_qty > 0
        FOR UPDATE`,
      [batchId]
    );
    batches = rows;
  } else {
    const { rows } = await client.query(
      `SELECT id, remaining_qty FROM stock_batches
        WHERE product_id = $1 AND outlet_id = $2
          AND variant_id IS NOT DISTINCT FROM $3
          AND status = 'active' AND remaining_qty > 0
        ORDER BY expiry_date NULLS LAST, id
        FOR UPDATE`,
      [productId, outletId, variantId]
    );
    batches = rows;
  }

  let remaining = need;
  const allocations = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const avail = Number(b.remaining_qty);
    const take = roundQty(Math.min(avail, remaining));
    if (take <= 0) continue;
    const newRem = roundQty(avail - take);
    await client.query(
      `UPDATE stock_batches
          SET remaining_qty = $1::numeric,
              status = CASE WHEN $1::numeric <= 0 THEN $2 ELSE status END
        WHERE id = $3`,
      [newRem, depletedStatus, b.id]
    );
    await client.query(
      `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [b.id, movementType, -take, refType, refId]
    );
    allocations.push({ batchId: b.id, qty: take });
    remaining = roundQty(remaining - take);
  }

  const shortfall = roundQty(remaining);
  if (shortfall > 0) {
    // Pre-existing ledger drift (batches short of outlet_stock) OR a manual
    // batch pick that didn't cover the line. Never block — outlet_stock is truth.
    logger.warn(
      { productId, variantId, outletId, requested: need, shortfall, refType, refId, batchId },
      '[batch-stock] drift: consumed less than requested from batch ledger'
    );
  }
  return { tracked: true, allocations, shortfall };
}

/**
 * Restock returned/voided units into the batch ledger for a tracked product.
 * Prefers the batch(es) the original sale drew from (resolved via batch_movements),
 * else the newest active batch, else creates a fresh return batch — so the invariant
 * holds after the caller adds `qty` back to outlet_stock. Returns { tracked }.
 */
async function returnToBatch(client, {
  productId, variantId = null, outletId, qty, refType = null, refId = null,
  originalSaleId = null,
}) {
  if (!(await isTracked(client, productId))) return { tracked: false };
  let restore = roundQty(qty);
  if (!(restore > 0)) return { tracked: true };

  // 1. Original batch(es) from the sale — newest first, reactivate if depleted.
  if (originalSaleId != null) {
    // GROUP BY (not DISTINCT) dedupes batch ids without tripping the
    // "FOR UPDATE not allowed with DISTINCT" rule; the addToBatch UPDATE below
    // takes the row lock, and the caller's outlet_stock lock serializes returns.
    const { rows: origs } = await client.query(
      `SELECT sb.id
         FROM batch_movements bm
         JOIN stock_batches sb ON sb.id = bm.batch_id
        WHERE bm.ref_type = 'sale' AND bm.ref_id = $1 AND bm.movement_type = 'sale'
          AND sb.product_id = $2 AND sb.outlet_id = $3
          AND sb.variant_id IS NOT DISTINCT FROM $4
        GROUP BY sb.id
        ORDER BY sb.id DESC
        LIMIT 1`,
      [originalSaleId, productId, outletId, variantId]
    );
    if (origs.length) {
      await addToBatch(client, origs[0].id, restore, refType, refId);
      return { tracked: true, batchId: origs[0].id, mode: 'original' };
    }
  }

  // 2. Newest active batch for this key.
  const { rows: active } = await client.query(
    `SELECT id FROM stock_batches
      WHERE product_id = $1 AND outlet_id = $2 AND variant_id IS NOT DISTINCT FROM $3
        AND status = 'active'
      ORDER BY id DESC LIMIT 1
      FOR UPDATE`,
    [productId, outletId, variantId]
  );
  if (active.length) {
    await addToBatch(client, active[0].id, restore, refType, refId);
    return { tracked: true, batchId: active[0].id, mode: 'newest' };
  }

  // 3. No batch to return into — create one so the ledger stays reconciled.
  const { rows: [nb] } = await client.query(
    `INSERT INTO stock_batches
       (product_id, variant_id, outlet_id, lot_type, batch_number, received_qty, remaining_qty)
     VALUES ($1,$2,$3,'batch',$4,$5,$5)
     RETURNING id`,
    [productId, variantId, outletId, `RET-${originalSaleId ?? Date.now()}`, restore]
  );
  await client.query(
    `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
     VALUES ($1,'return',$2,$3,$4)`,
    [nb.id, restore, refType, refId]
  );
  return { tracked: true, batchId: nb.id, mode: 'new' };
}

/** Add qty back to an existing batch (reactivating if it was depleted). */
async function addToBatch(client, batchId, qty, refType, refId) {
  const q = roundQty(qty);
  await client.query(
    `UPDATE stock_batches
        SET remaining_qty = remaining_qty + $1,
            status = CASE WHEN status = 'depleted' THEN 'active' ELSE status END
      WHERE id = $2`,
    [q, batchId]
  );
  await client.query(
    `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
     VALUES ($1,'return',$2,$3,$4)`,
    [batchId, q, refType, refId]
  );
}

/**
 * Transfer batch identity between outlets: FEFO-consume at source (transfer_out)
 * and recreate the consumed slices at the destination preserving batch_number,
 * expiry_date, unit_cost and lot_type (transfer_in). This is what stops mithai
 * losing its 2-day expiry when moved between branches. Call after the caller has
 * decremented source + incremented destination outlet_stock. Returns { tracked, shortfall }.
 */
async function transferBatches(client, {
  productId, variantId = null, fromOutletId, toOutletId, qty, refType = 'transfer', refId = null,
}) {
  if (!(await isTracked(client, productId))) return { tracked: false };
  let remaining = roundQty(qty);
  if (!(remaining > 0)) return { tracked: true, shortfall: 0 };

  const { rows: batches } = await client.query(
    `SELECT id, batch_number, expiry_date, unit_cost, lot_type, remaining_qty
       FROM stock_batches
      WHERE product_id = $1 AND outlet_id = $2 AND variant_id IS NOT DISTINCT FROM $3
        AND status = 'active' AND remaining_qty > 0
      ORDER BY expiry_date NULLS LAST, id
      FOR UPDATE`,
    [productId, fromOutletId, variantId]
  );

  for (const b of batches) {
    if (remaining <= 0) break;
    const take = roundQty(Math.min(Number(b.remaining_qty), remaining));
    if (take <= 0) continue;
    const newRem = roundQty(Number(b.remaining_qty) - take);
    await client.query(
      `UPDATE stock_batches
          SET remaining_qty = $1::numeric, status = CASE WHEN $1::numeric <= 0 THEN 'depleted' ELSE status END
        WHERE id = $2`,
      [newRem, b.id]
    );
    await client.query(
      `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
       VALUES ($1,'transfer_out',$2,$3,$4)`,
      [b.id, -take, refType, refId]
    );
    const { rows: [nb] } = await client.query(
      `INSERT INTO stock_batches
         (product_id, variant_id, outlet_id, lot_type, batch_number, expiry_date,
          received_qty, remaining_qty, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8)
       RETURNING id`,
      [productId, variantId, toOutletId, b.lot_type, b.batch_number, b.expiry_date, take, b.unit_cost]
    );
    await client.query(
      `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
       VALUES ($1,'transfer_in',$2,$3,$4)`,
      [nb.id, take, refType, refId]
    );
    remaining = roundQty(remaining - take);
  }

  const shortfall = roundQty(remaining);
  if (shortfall > 0) {
    logger.warn(
      { productId, variantId, fromOutletId, toOutletId, requested: roundQty(qty), shortfall },
      '[batch-stock] transfer drift: source batches short of transfer qty'
    );
  }
  return { tracked: true, shortfall };
}

/**
 * Apply a stock adjustment to the batch ledger. delta<0 → FEFO-consume (or a
 * specific batch); delta>0 → add to newest active batch (or create one). Used by
 * adjustments and write-offs. movementType 'adjust' | 'write_off'. For write_off,
 * fully-consumed batches flip to 'written_off' (not 'depleted') for reporting.
 * Returns the consumeBatches/addToBatch result. No-op for untracked.
 */
async function adjustBatches(client, {
  productId, variantId = null, outletId, delta, movementType = 'adjust',
  refType = null, refId = null, batchId = null,
}) {
  if (!(await isTracked(client, productId))) return { tracked: false };
  const d = roundQty(delta);
  if (d === 0) return { tracked: true };
  if (d < 0) {
    return consumeBatches(client, {
      productId, variantId, outletId, qty: -d, refType, refId, batchId,
      movementType,
      depletedStatus: movementType === 'write_off' ? 'written_off' : 'depleted',
    });
  }
  // Positive adjustment: add to newest active batch, else create an adjustment batch.
  const { rows: active } = await client.query(
    `SELECT id FROM stock_batches
      WHERE product_id = $1 AND outlet_id = $2 AND variant_id IS NOT DISTINCT FROM $3
        AND status = 'active'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [productId, outletId, variantId]
  );
  if (active.length) {
    const q = roundQty(d);
    await client.query(
      `UPDATE stock_batches SET remaining_qty = remaining_qty + $1 WHERE id = $2`,
      [q, active[0].id]
    );
    await client.query(
      `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
       VALUES ($1,'adjust',$2,$3,$4)`,
      [active[0].id, q, refType, refId]
    );
    return { tracked: true, batchId: active[0].id, mode: 'newest' };
  }
  const { rows: [nb] } = await client.query(
    `INSERT INTO stock_batches
       (product_id, variant_id, outlet_id, lot_type, batch_number, received_qty, remaining_qty)
     VALUES ($1,$2,$3,'batch',$4,$5,$5)
     RETURNING id`,
    [productId, variantId, outletId, `ADJ-${Date.now()}`, roundQty(d)]
  );
  await client.query(
    `INSERT INTO batch_movements (batch_id, movement_type, quantity, ref_type, ref_id)
     VALUES ($1,'adjust',$2,$3,$4)`,
    [nb.id, roundQty(d), refType, refId]
  );
  return { tracked: true, batchId: nb.id, mode: 'new' };
}

/**
 * Drift-check report (the invariant enforcer). For product-level tracked stock,
 * compares outlet_stock.quantity against Σ active batch remaining_qty. Rows where
 * they disagree beyond a rounding epsilon are drift. Variant-level batches are out
 * of scope for v1 (tracked SKUs are overwhelmingly non-variant perishables/rolls).
 * Read-only — safe with the db proxy.
 */
async function getDrift(runner, { outletId = null } = {}) {
  const { rows } = await runner.query(
    `SELECT os.product_id,
            p.name AS product_name,
            os.outlet_id,
            os.quantity::numeric AS stock_qty,
            COALESCE(b.batch_qty, 0)::numeric AS batch_qty,
            (os.quantity - COALESCE(b.batch_qty, 0))::numeric AS drift
       FROM outlet_stock os
       JOIN products p ON p.id = os.product_id AND COALESCE(p.track_batches, false) = true
       LEFT JOIN (
         SELECT product_id, outlet_id, SUM(remaining_qty) AS batch_qty
           FROM stock_batches
          WHERE status = 'active' AND variant_id IS NULL
          GROUP BY product_id, outlet_id
       ) b ON b.product_id = os.product_id AND b.outlet_id = os.outlet_id
      WHERE ($1::int IS NULL OR os.outlet_id = $1)
        AND ABS(os.quantity - COALESCE(b.batch_qty, 0)) > 0.0001
      ORDER BY ABS(os.quantity - COALESCE(b.batch_qty, 0)) DESC`,
    [outletId]
  );
  return rows.map((r) => ({
    product_id: Number(r.product_id),
    product_name: r.product_name,
    outlet_id: Number(r.outlet_id),
    stock_qty: Number(r.stock_qty),
    batch_qty: Number(r.batch_qty),
    drift: Number(r.drift),
  }));
}

module.exports = {
  QTY_SCALE,
  roundQty,
  loadTrackedMap,
  isTracked,
  receiveBatch,
  consumeBatches,
  returnToBatch,
  addToBatch,
  transferBatches,
  adjustBatches,
  getDrift,
};
