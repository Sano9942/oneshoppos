'use strict';

/**
 * Shared stock ledger helper — the single home for "move on-hand stock" semantics.
 *
 * The POS sale path (`routes/sales.js`) was hardened long ago: it takes a
 * `SELECT … FOR UPDATE` on the authoritative stock row, gates on
 * `available >= qty`, writes all three stock tables when a variant is present
 * (`variant_outlet_stock` + `product_variants.stock` rollup + `outlet_stock`),
 * and maintains the `stock_batches` ledger via `services/batch-stock`. Its
 * sibling writers (quotation-convert, inventory transfer, supplier return,
 * PO receive, stock count) were NOT — they oversold under concurrency and/or
 * drifted the variant/batch tables. This module extracts that exact behavior
 * so every writer shares one implementation and new surfaces can't drift again.
 *
 * Table-selection rule (mirrors `sales.js:1506`): when `variantId` is set, the
 * per-outlet `variant_outlet_stock` row is the authoritative gate when it exists;
 * otherwise fall back to the `product_variants.stock` rollup (pre-v65 tenants
 * that haven't been backfilled for this outlet). Either way the decrement writes
 * all three tables so every downstream reader stays consistent.
 *
 * Batch handling (`manageBatch`, default true):
 *   - decrementStock → FEFO `consumeBatches` (label via `movementType`)
 *   - incrementStock → `returnToBatch` (prefers the batch the sale drew from)
 * Callers whose batch semantics differ — an inter-outlet transfer that must
 * PRESERVE batch identity (`batchStock.transferBatches`), a GRN receipt that
 * creates a fresh lot (`batchStock.receiveBatch`), or a bidirectional stock-count
 * correction (`batchStock.adjustBatches`) — pass `manageBatch:false` and drive
 * the ledger themselves in the same transaction.
 *
 * Every function must be called INSIDE the caller's `deps.db.transaction(...)`
 * so the FOR UPDATE lock and the multi-table write commit atomically.
 */

const batchStock = require('./batch-stock');
const { roundQty } = batchStock;

/** Build the typed insufficient-stock error the sale path throws (statusCode 400). */
function insufficientStock({ productId, variantId, available, requested }) {
  return Object.assign(
    new Error(
      variantId
        ? `Insufficient stock for variant ${variantId} at this outlet`
        : `Insufficient stock for product ${productId}`
    ),
    {
      statusCode: 400,
      code: 'insufficient_stock',
      product_id: productId,
      variant_id: variantId || null,
      available: Number(available || 0),
      requested: Number(requested || 0),
    }
  );
}

/**
 * Decrement on-hand stock for one product/variant at one outlet, matching the POS
 * sale path's semantics. MUST run inside the caller's transaction.
 *
 * @param client      the transaction client (from deps.db.transaction)
 * @param productId   product id (the outlet_stock key even for a variant line)
 * @param variantId   optional variant id — when set, writes all 3 stock tables
 * @param outletId    outlet id
 * @param qty         quantity to remove (> 0)
 * @param gate        default true — throw insufficient_stock when available < qty.
 *                    Pass false only for authoritative corrections (stock count).
 * @param manageBatch default true — FEFO-consume the batch ledger. Pass false when
 *                    the caller drives batches itself (transfer/stock-count).
 * @param movementType batch movement label ('sale' | 'adjust' | 'write_off')
 * @param batchId     optional manual batch pick (butcher carcass / textile roll)
 * @param refType/refId audit trail for the batch movement
 * @returns { productId, variantId, outletId, qty, batch }
 */
async function decrementStock(client, {
  productId, variantId = null, outletId, qty,
  gate = true, manageBatch = true, movementType = 'sale',
  batchId = null, refType = null, refId = null,
}) {
  const need = roundQty(qty);
  if (!(need > 0)) return { productId, variantId, outletId, qty: 0, batch: null };
  if (!productId || !outletId) {
    throw Object.assign(new Error('decrementStock requires productId and outletId'), { statusCode: 500 });
  }

  if (variantId) {
    // Prefer the per-outlet variant row as the authoritative gate; fall back to
    // the cross-outlet rollup for variants not yet backfilled for this outlet.
    const { rows: [vos] } = await client.query(
      `SELECT COALESCE(quantity, 0) AS available
         FROM variant_outlet_stock
        WHERE variant_id = $1 AND outlet_id = $2
        FOR UPDATE`,
      [variantId, outletId]
    );
    if (vos) {
      if (gate && Number(vos.available) < need) {
        throw insufficientStock({ productId, variantId, available: vos.available, requested: need });
      }
    } else {
      const { rows: [rollup] } = await client.query(
        `SELECT COALESCE(stock, 0) AS available
           FROM product_variants WHERE id = $1 FOR UPDATE`,
        [variantId]
      );
      if (gate && (!rollup || Number(rollup.available) < need)) {
        throw insufficientStock({ productId, variantId, available: rollup?.available ?? 0, requested: need });
      }
    }

    // Write all three tables (upsert variant_outlet_stock so a missing per-outlet
    // row lands negative, exactly like the sale path's pre-v65 fallback).
    await client.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
         VALUES ($1, $2, 0 - $3::numeric)
         ON CONFLICT (variant_id, outlet_id)
         DO UPDATE SET quantity = variant_outlet_stock.quantity - $3::numeric`,
      [variantId, outletId, need]
    );
    await client.query(
      `UPDATE product_variants SET stock = stock - $1 WHERE id = $2`,
      [need, variantId]
    );
    await client.query(
      `UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3`,
      [need, productId, outletId]
    );
  } else {
    const { rows: [row] } = await client.query(
      `SELECT COALESCE(quantity, 0) AS available
         FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE`,
      [productId, outletId]
    );
    if (gate && (!row || Number(row.available) < need)) {
      throw insufficientStock({ productId, variantId: null, available: row?.available ?? 0, requested: need });
    }
    await client.query(
      `UPDATE outlet_stock SET quantity = quantity - $1 WHERE product_id = $2 AND outlet_id = $3`,
      [need, productId, outletId]
    );
  }

  let batch = null;
  if (manageBatch) {
    batch = await batchStock.consumeBatches(client, {
      productId, variantId, outletId, qty: need,
      refType, refId, batchId, movementType,
    });
  }
  return { productId, variantId: variantId || null, outletId, qty: need, batch };
}

/**
 * Increment on-hand stock for one product/variant at one outlet — the inverse of
 * decrementStock, matching the void/return restock path. MUST run inside the
 * caller's transaction. No availability gate (adding stock never blocks).
 *
 * @param manageBatch   default true — return units to the batch ledger via
 *                      `returnToBatch`. Pass false when the caller creates lots
 *                      itself (GRN receiveBatch / transfer transferBatches).
 * @param originalSaleId optional — lets returnToBatch reuse the sale's batch(es).
 * @returns { productId, variantId, outletId, qty, batch }
 */
async function incrementStock(client, {
  productId, variantId = null, outletId, qty,
  manageBatch = true, originalSaleId = null, refType = null, refId = null,
}) {
  const add = roundQty(qty);
  if (!(add > 0)) return { productId, variantId, outletId, qty: 0, batch: null };
  if (!productId || !outletId) {
    throw Object.assign(new Error('incrementStock requires productId and outletId'), { statusCode: 500 });
  }

  await client.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (product_id, outlet_id)
       DO UPDATE SET quantity = outlet_stock.quantity + $3`,
    [productId, outletId, add]
  );
  if (variantId) {
    await client.query(
      `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
      [add, variantId]
    );
    await client.query(
      `INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (variant_id, outlet_id)
         DO UPDATE SET quantity = variant_outlet_stock.quantity + $3`,
      [variantId, outletId, add]
    );
  }

  let batch = null;
  if (manageBatch) {
    batch = await batchStock.returnToBatch(client, {
      productId, variantId, outletId, qty: add,
      refType, refId, originalSaleId,
    });
  }
  return { productId, variantId: variantId || null, outletId, qty: add, batch };
}

module.exports = {
  decrementStock,
  incrementStock,
  insufficientStock,
};
