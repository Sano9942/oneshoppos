'use strict';

/**
 * Fulfillment allocation service.
 *
 * Decides which outlet fulfills each web-order line item.
 *  - Pickup orders   -> all items allocated to the chosen pickup outlet.
 *  - Ship-to-customer -> each item allocated to the outlet with the highest
 *    available stock (simple v1 strategy).
 */

/**
 * Create allocation records for every line item in a web order.
 *
 * @param {object}  db               - tenant db proxy (has .transaction)
 * @param {number}  webOrderId       - web_orders.id
 * @param {Array}   items            - [{ webOrderItemId, productId, variantId, qty }]
 * @param {string}  deliveryMethod   - 'pickup' | 'ship_to_customer'
 * @param {number|null} pickupOutletId - required when deliveryMethod is 'pickup'
 * @returns {Promise<Array>} inserted web_order_allocations rows
 */
async function allocateOrder(db, webOrderId, items, deliveryMethod, pickupOutletId) {
  return db.transaction(async (client) => {
    const allocations = [];

    for (const item of items) {
      let outletId;

      if (deliveryMethod === 'pickup') {
        if (!pickupOutletId) {
          throw Object.assign(
            new Error('pickupOutletId is required for pickup orders'),
            { statusCode: 400 }
          );
        }
        outletId = pickupOutletId;
      } else {
        // Ship-to-customer: pick the active outlet with the most stock
        const { rows } = await client.query(
          `SELECT os.outlet_id, os.quantity
           FROM outlet_stock os
           JOIN outlets o ON o.id = os.outlet_id AND o.is_active = true
           WHERE os.product_id = $1 AND os.quantity >= $2
           ORDER BY os.quantity DESC
           LIMIT 1`,
          [item.productId, item.qty]
        );

        if (!rows.length) {
          throw Object.assign(
            new Error(`No outlet has sufficient stock for product ${item.productId}`),
            { statusCode: 400 }
          );
        }
        outletId = rows[0].outlet_id;
      }

      const { rows: [alloc] } = await client.query(
        `INSERT INTO web_order_allocations
           (web_order_id, web_order_item_id, fulfillment_outlet_id,
            fulfillment_method, status, allocated_qty)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         RETURNING *`,
        [webOrderId, item.webOrderItemId, outletId, deliveryMethod, item.qty]
      );
      allocations.push(alloc);
    }

    return allocations;
  });
}

/**
 * Fetch all allocation records for a web order, enriched with outlet name.
 *
 * @param {object} db          - tenant db proxy
 * @param {number} webOrderId  - web_orders.id
 * @returns {Promise<Array>}
 */
async function getAllocationsForOrder(db, webOrderId) {
  const { rows } = await db.query(
    `SELECT woa.*, o.name AS outlet_name
     FROM web_order_allocations woa
     JOIN outlets o ON o.id = woa.fulfillment_outlet_id
     WHERE woa.web_order_id = $1
     ORDER BY woa.id`,
    [webOrderId]
  );
  return rows;
}

module.exports = { allocateOrder, getAllocationsForOrder };
