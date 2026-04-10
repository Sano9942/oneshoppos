'use strict';

/**
 * Storefront cart service — manages anonymous/authenticated shopping carts
 * for the omnichannel storefront.
 *
 * All functions accept a `db` handle (the tenant-scoped Proxy) as first arg.
 */

// ---------------------------------------------------------------------------
// getOrCreateCart
// ---------------------------------------------------------------------------
async function getOrCreateCart(db, cartToken) {
  if (!cartToken) throw new Error('cart_token is required');

  const existing = await db.query(
    'SELECT * FROM storefront_carts WHERE cart_token = $1',
    [cartToken]
  );
  if (existing.rows.length) return existing.rows[0];

  // Look up the storefront channel (may not exist yet — nullable)
  const chResult = await db.query(
    "SELECT id FROM sales_channels WHERE code = 'storefront' LIMIT 1"
  );
  const channelId = chResult.rows.length ? chResult.rows[0].id : null;

  const ins = await db.query(
    `INSERT INTO storefront_carts (cart_token, channel_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')
     RETURNING *`,
    [cartToken, channelId]
  );
  return ins.rows[0];
}

// ---------------------------------------------------------------------------
// addItem
// ---------------------------------------------------------------------------
async function addItem(db, cartId, productId, variantId, qty) {
  if (!cartId || !productId) throw new Error('cart_id and product_id are required');
  if (!qty || qty < 1) throw new Error('quantity must be >= 1');

  // Fetch current price
  let unitPrice;
  if (variantId) {
    const vr = await db.query(
      'SELECT price FROM product_variants WHERE id = $1',
      [variantId]
    );
    if (vr.rows.length) unitPrice = vr.rows[0].price;
  }
  if (unitPrice == null) {
    const pr = await db.query(
      'SELECT price FROM products WHERE id = $1',
      [productId]
    );
    if (!pr.rows.length) throw new Error('Product not found');
    unitPrice = pr.rows[0].price;
  }

  // Check for existing line with same product+variant
  const dup = await db.query(
    `SELECT * FROM storefront_cart_items
     WHERE cart_id = $1 AND product_id = $2
       AND (variant_id = $3 OR ($3::int IS NULL AND variant_id IS NULL))`,
    [cartId, productId, variantId || null]
  );

  let item;
  if (dup.rows.length) {
    const newQty = dup.rows[0].quantity + qty;
    const upd = await db.query(
      `UPDATE storefront_cart_items
       SET quantity = $1, unit_price = $2
       WHERE id = $3
       RETURNING *`,
      [newQty, unitPrice, dup.rows[0].id]
    );
    item = upd.rows[0];
  } else {
    const ins = await db.query(
      `INSERT INTO storefront_cart_items (cart_id, product_id, variant_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [cartId, productId, variantId || null, qty, unitPrice]
    );
    item = ins.rows[0];
  }

  await touchCart(db, cartId);
  return item;
}

// ---------------------------------------------------------------------------
// updateItem
// ---------------------------------------------------------------------------
async function updateItem(db, cartId, itemId, qty) {
  if (!cartId || !itemId) throw new Error('cart_id and item_id are required');

  if (qty <= 0) {
    return removeItem(db, cartId, itemId);
  }

  const upd = await db.query(
    `UPDATE storefront_cart_items
     SET quantity = $1
     WHERE id = $2 AND cart_id = $3
     RETURNING *`,
    [qty, itemId, cartId]
  );
  if (!upd.rows.length) throw new Error('Cart item not found');

  await touchCart(db, cartId);
  return upd.rows[0];
}

// ---------------------------------------------------------------------------
// removeItem
// ---------------------------------------------------------------------------
async function removeItem(db, cartId, itemId) {
  if (!cartId || !itemId) throw new Error('cart_id and item_id are required');

  const del = await db.query(
    'DELETE FROM storefront_cart_items WHERE id = $1 AND cart_id = $2 RETURNING id',
    [itemId, cartId]
  );
  if (!del.rows.length) throw new Error('Cart item not found');

  await touchCart(db, cartId);
  return { removed: true };
}

// ---------------------------------------------------------------------------
// getCartWithItems
// ---------------------------------------------------------------------------
async function getCartWithItems(db, cartId) {
  if (!cartId) throw new Error('cart_id is required');

  const cartRes = await db.query(
    'SELECT * FROM storefront_carts WHERE id = $1',
    [cartId]
  );
  if (!cartRes.rows.length) throw new Error('Cart not found');
  const cart = cartRes.rows[0];

  const itemsRes = await db.query(
    `SELECT sci.id, sci.product_id, sci.variant_id, sci.quantity, sci.unit_price,
            p.name AS product_name, p.image_url, p.sku,
            pv.sku AS variant_name, pv.sku AS variant_sku
     FROM storefront_cart_items sci
     JOIN products p ON p.id = sci.product_id
     LEFT JOIN product_variants pv ON pv.id = sci.variant_id
     WHERE sci.cart_id = $1
     ORDER BY sci.id`,
    [cartId]
  );

  const items = itemsRes.rows;
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.unit_price || 0) * i.quantity,
    0
  );

  return {
    cart: {
      ...cart,
      item_count: itemCount,
      subtotal: Number(subtotal.toFixed(2)),
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------
async function touchCart(db, cartId) {
  await db.query(
    'UPDATE storefront_carts SET updated_at = NOW() WHERE id = $1',
    [cartId]
  );
}

module.exports = { getOrCreateCart, addItem, updateItem, removeItem, getCartWithItems };
