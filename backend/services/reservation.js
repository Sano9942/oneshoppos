'use strict';

/**
 * Inventory Reservation Service
 *
 * Manages stock holds for omnichannel orders. Every reservation decrements
 * outlet_stock on creation and restores it on release/expiry. Conversions
 * (cart → confirmed order) keep the stock decremented.
 *
 * All mutating operations run inside transactions with SELECT … FOR UPDATE
 * on outlet_stock rows to prevent overselling under concurrency.
 */

async function createReservation({ db, cartToken, channelId, productId, variantId, outletId, qty, ttlMinutes = 15 }) {
  return db.transaction(async (client) => {
    // Lock the outlet_stock row to prevent concurrent oversell
    const { rows: [stock] } = await client.query(
      'SELECT id, quantity FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE',
      [productId, outletId]
    );
    if (!stock || stock.quantity < qty) {
      throw Object.assign(new Error('Insufficient stock'), { statusCode: 400 });
    }

    // Decrement available stock
    await client.query(
      'UPDATE outlet_stock SET quantity = quantity - $1 WHERE id = $2',
      [qty, stock.id]
    );

    // Insert the reservation
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const { rows: [reservation] } = await client.query(
      `INSERT INTO inventory_reservations
       (reservation_key, channel_id, product_id, variant_id, outlet_id, quantity, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
       RETURNING id`,
      [cartToken, channelId, productId, variantId, outletId, qty, expiresAt]
    );

    return reservation;
  });
}

async function convertReservations(db, cartToken, webOrderId) {
  const { rowCount } = await db.query(
    `UPDATE inventory_reservations
     SET status = 'converted', web_order_id = $2, updated_at = NOW()
     WHERE reservation_key = $1 AND status = 'active'`,
    [cartToken, webOrderId]
  );
  return rowCount;
}

async function releaseReservations(db, cartToken) {
  return db.transaction(async (client) => {
    // Fetch and lock all active reservations for this cart
    const { rows: reservations } = await client.query(
      `SELECT ir.id, ir.product_id, ir.outlet_id, ir.quantity
       FROM inventory_reservations ir
       WHERE ir.reservation_key = $1 AND ir.status = 'active'
       ORDER BY ir.id
       FOR UPDATE`,
      [cartToken]
    );

    if (reservations.length === 0) return 0;

    // Lock the corresponding outlet_stock rows (sorted to avoid deadlocks)
    const stockKeys = [...new Set(reservations.map(r => `${r.product_id}:${r.outlet_id}`))];
    for (const key of stockKeys.sort()) {
      const [pid, oid] = key.split(':');
      await client.query(
        'SELECT id FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE',
        [pid, oid]
      );
    }

    // Restore stock for each reservation
    for (const r of reservations) {
      await client.query(
        'UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3',
        [r.quantity, r.product_id, r.outlet_id]
      );
    }

    // Mark all as released
    const ids = reservations.map(r => r.id);
    await client.query(
      `UPDATE inventory_reservations
       SET status = 'released', updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );

    return reservations.length;
  });
}

async function expireStaleReservations(db) {
  // Fetch all stale reservations first (outside transaction — each batch handled individually)
  const { rows: stale } = await db.query(
    `SELECT id, product_id, variant_id, outlet_id, quantity
     FROM inventory_reservations
     WHERE status = 'active' AND expires_at < NOW()
     ORDER BY id`
  );

  let expired = 0;

  for (const r of stale) {
    try {
      await db.transaction(async (client) => {
        // Re-check status under lock to avoid double-processing
        const { rows: [current] } = await client.query(
          'SELECT id, status FROM inventory_reservations WHERE id = $1 FOR UPDATE',
          [r.id]
        );
        if (!current || current.status !== 'active') return;

        // Lock and restore stock
        await client.query(
          'SELECT id FROM outlet_stock WHERE product_id = $1 AND outlet_id = $2 FOR UPDATE',
          [r.product_id, r.outlet_id]
        );
        await client.query(
          'UPDATE outlet_stock SET quantity = quantity + $1 WHERE product_id = $2 AND outlet_id = $3',
          [r.quantity, r.product_id, r.outlet_id]
        );

        // Mark expired
        await client.query(
          `UPDATE inventory_reservations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [r.id]
        );
      });
      expired++;
    } catch (_err) {
      // Individual reservation failure should not block the rest
    }
  }

  return { expired };
}

async function getActiveReservationsForOutlet(db, outletId, productId, variantId) {
  const { rows: [row] } = await db.query(
    `SELECT COALESCE(SUM(quantity), 0)::int AS reserved_qty
     FROM inventory_reservations
     WHERE outlet_id = $1
       AND product_id = $2
       AND (variant_id = $3 OR ($3::int IS NULL AND variant_id IS NULL))
       AND status = 'active'`,
    [outletId, productId, variantId || null]
  );
  return row.reserved_qty;
}

module.exports = {
  createReservation,
  convertReservations,
  releaseReservations,
  expireStaleReservations,
  getActiveReservationsForOutlet,
};
