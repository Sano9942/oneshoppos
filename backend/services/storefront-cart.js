'use strict';

/**
 * Storefront cart service — manages anonymous/authenticated shopping carts
 * for the omnichannel storefront.
 *
 * All functions accept a `db` handle (the tenant-scoped Proxy) as first arg.
 */

const { validateMoqSingle } = require('./moq');
const { isProductVisibleToCustomer } = require('./product-visibility');

function moqError(violation) {
  const err = new Error('MOQ violation');
  err.code = 'MOQ_VIOLATION';
  err.statusCode = 400;
  err.violations = [violation];
  return err;
}

function visibilityError() {
  const err = new Error('Product not available for this account');
  err.code = 'PRODUCT_NOT_VISIBLE';
  err.statusCode = 404;
  return err;
}

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

  // Tier 2.11 — visibility check. The buyer is identified by the cart's
  // customer_id. Anonymous cart with a restricted product = 404 (don't
  // leak existence). Defense in depth: storefront product list already
  // filters, but URL tampering could still POST /cart/.../items with a
  // restricted product_id, and we catch that here.
  try {
    const { rows: cartRows } = await db.query(
      'SELECT customer_id FROM storefront_carts WHERE id = $1',
      [cartId]
    );
    const cartCustomerId = cartRows[0]?.customer_id || null;
    const visible = await isProductVisibleToCustomer(db, cartCustomerId, productId);
    if (!visible) throw visibilityError();
  } catch (visErr) {
    if (visErr.code === 'PRODUCT_NOT_VISIBLE') throw visErr;
    // visibility column / table missing on a not-yet-migrated tenant —
    // fail open so cart still works during the v96 rollout window.
  }

  // Tier 2.2 — MOQ check uses the *cumulative* line qty after this add, not
  // just the incoming qty. Otherwise a customer can defeat a min of 12 by
  // adding 1 twelve times.
  const dupForMoq = await db.query(
    `SELECT quantity FROM storefront_cart_items
     WHERE cart_id = $1 AND product_id = $2
       AND (variant_id = $3 OR ($3::int IS NULL AND variant_id IS NULL))`,
    [cartId, productId, variantId || null]
  );
  const existingQty = dupForMoq.rows.length ? Number(dupForMoq.rows[0].quantity) : 0;
  const moqViolation = await validateMoqSingle(db, productId, existingQty + Number(qty));
  if (moqViolation) throw moqError(moqViolation);

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

  // Tier 2.2 — re-validate MOQ against the *new* qty. Look up product_id
  // from the cart line first so we can hit the products table directly.
  const lineLookup = await db.query(
    'SELECT product_id FROM storefront_cart_items WHERE id = $1 AND cart_id = $2',
    [itemId, cartId]
  );
  if (!lineLookup.rows.length) throw new Error('Cart item not found');
  const moqViolation = await validateMoqSingle(
    db,
    lineLookup.rows[0].product_id,
    Number(qty)
  );
  if (moqViolation) throw moqError(moqViolation);

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
            COALESCE(p.min_order_qty, 0) AS min_order_qty,
            COALESCE(p.order_increment, 1) AS order_increment,
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
