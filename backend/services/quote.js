'use strict';

/**
 * Quote service — single source of truth for storefront order pricing.
 *
 * Validates publication, checks stock, resolves prices, applies tax,
 * and validates delivery method.
 */

/**
 * Build a pricing quote for a storefront cart.
 *
 * @param {object}  db               – tenant db proxy (query, getClient)
 * @param {Array}   cartItems        – [{ productId, variantId, qty }]
 * @param {string}  deliveryMethod   – 'pickup' | 'ship_to_customer'
 * @param {number|null} pickupOutletId – required when deliveryMethod === 'pickup'
 * @param {number}  channelId        – sales_channels.id
 * @returns {Promise<object>} quote object (see return shape below)
 */
async function calculateQuote(db, cartItems, deliveryMethod, pickupOutletId, channelId) {
  if (!cartItems || cartItems.length === 0) {
    return emptyQuote(deliveryMethod, pickupOutletId);
  }

  const availabilityErrors = [];

  // ── 1. Delivery method validation ──────────────────────────────────
  if (deliveryMethod === 'pickup') {
    if (!pickupOutletId) {
      throw new Error('pickupOutletId is required for pickup delivery');
    }
    const { rows: outletRows } = await db.query(
      `SELECT id FROM outlets WHERE id = $1 AND is_active = TRUE`,
      [pickupOutletId]
    );
    if (outletRows.length === 0) {
      throw new Error('Invalid or inactive pickup outlet');
    }
  }

  // ── 2. Collect product IDs & variant IDs ───────────────────────────
  const productIds = [...new Set(cartItems.map(i => i.productId))];
  const variantIds = cartItems.map(i => i.variantId).filter(Boolean);

  // ── 3. Batch-fetch product + category + tax data ───────────────────
  const { rows: productRows } = await db.query(
    `SELECT p.id, p.name, p.price, p.compare_at_price, p.category_id, p.is_active,
            COALESCE(t2.rate, t.rate) AS tax_rate
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN taxes t ON c.tax_id = t.id
       LEFT JOIN taxes t2 ON p.tax_id = t2.id
      WHERE p.id = ANY($1)`,
    [productIds]
  );
  const productMap = new Map(productRows.map(r => [r.id, r]));

  // ── 4. Batch-fetch variant data (price override + display name) ────
  let variantMap = new Map();
  if (variantIds.length > 0) {
    const { rows: variantRows } = await db.query(
      `SELECT pv.id, pv.product_id, pv.price, pv.sku,
              COALESCE(
                STRING_AGG(ao.value, ' / ' ORDER BY a.name),
                pv.sku
              ) AS variant_name
         FROM product_variants pv
         LEFT JOIN variant_option_values vov ON pv.id = vov.variant_id
         LEFT JOIN attributes a ON vov.attribute_id = a.id
         LEFT JOIN attribute_options ao ON vov.attribute_option_id = ao.id
        WHERE pv.id = ANY($1)
        GROUP BY pv.id`,
      [variantIds]
    );
    variantMap = new Map(variantRows.map(r => [r.id, r]));
  }

  // ── 5. Batch-fetch publication status ──────────────────────────────
  const { rows: pubRows } = await db.query(
    `SELECT product_id, variant_id, is_published
       FROM channel_publications
      WHERE channel_id = $1 AND product_id = ANY($2)`,
    [channelId, productIds]
  );
  // Key: "productId-variantId" (variantId may be null → "productId-null")
  const pubSet = new Map(
    pubRows.map(r => [`${r.product_id}-${r.variant_id}`, r.is_published])
  );

  // ── 6. Batch-fetch stock ───────────────────────────────────────────
  let stockMap; // key: "productId" → available qty
  if (deliveryMethod === 'pickup') {
    const { rows: stockRows } = await db.query(
      `SELECT product_id, quantity
         FROM outlet_stock
        WHERE outlet_id = $1 AND product_id = ANY($2)`,
      [pickupOutletId, productIds]
    );
    stockMap = new Map(stockRows.map(r => [r.product_id, Number(r.quantity)]));
  } else {
    // ship_to_customer: sum across all active outlets
    const { rows: stockRows } = await db.query(
      `SELECT os.product_id, SUM(os.quantity)::int AS quantity
         FROM outlet_stock os
         JOIN outlets o ON os.outlet_id = o.id AND o.is_active = TRUE
        WHERE os.product_id = ANY($1)
        GROUP BY os.product_id`,
      [productIds]
    );
    stockMap = new Map(stockRows.map(r => [r.product_id, Number(r.quantity)]));
  }

  // ── 7. Build line items ────────────────────────────────────────────
  const items = [];

  for (const cartItem of cartItems) {
    const { productId, variantId, qty } = cartItem;
    const product = productMap.get(productId);

    // Product must exist and be active
    if (!product || !product.is_active) {
      availabilityErrors.push({ productId, variantId, reason: 'Product not found or inactive' });
      continue;
    }

    // Publication check
    const pubKey = variantId ? `${productId}-${variantId}` : `${productId}-${null}`;
    const isPublished = pubSet.get(pubKey);
    // Also check product-level publication if variant-level not found
    const productPubKey = `${productId}-${null}`;
    const productPublished = pubSet.get(productPubKey);
    if (isPublished !== true && productPublished !== true) {
      availabilityErrors.push({ productId, variantId, reason: 'Not published on this channel' });
      continue;
    }

    // Variant validation
    let variant = null;
    if (variantId) {
      variant = variantMap.get(variantId);
      if (!variant || variant.product_id !== productId) {
        availabilityErrors.push({ productId, variantId, reason: 'Variant not found' });
        continue;
      }
    }

    // Price resolution: variant price overrides product price
    const unitPrice = Number(
      (variant && variant.price != null) ? variant.price : product.price
    );

    // Tax calculation
    const rawRate = product.tax_rate != null ? Number(product.tax_rate) : 0;
    const taxRate = rawRate / 100; // e.g. 17 → 0.17
    const taxAmount = round2(unitPrice * qty * taxRate);
    const lineTotal = round2((unitPrice * qty) + taxAmount);

    // Stock availability
    const availableQty = stockMap.get(productId) || 0;
    const inStock = availableQty >= qty;

    if (!inStock) {
      availabilityErrors.push({
        productId,
        variantId,
        reason: availableQty <= 0
          ? 'Out of stock'
          : `Only ${availableQty} available (requested ${qty})`
      });
    }

    items.push({
      productId,
      variantId: variantId || null,
      categoryId: product.category_id || null,
      qty,
      productName: product.name,
      variantName: variant ? variant.variant_name : null,
      unitPrice,
      discount: 0,
      taxRate,
      taxAmount,
      lineTotal,
      inStock,
      availableQty
    });
  }

  // ── 8. Compute subtotals ───────────────────────────────────────────
  const subtotal = round2(items.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0));
  const taxTotal = round2(items.reduce((sum, i) => sum + i.taxAmount, 0));
  const shippingTotal = 0; // v1 free shipping placeholder

  // ── 9. Evaluate promotions ────────────────────────────────────────
  const { totalDiscount, appliedPromotions } = await evaluatePromotions(db, items, subtotal);
  const discountTotal = round2(totalDiscount);
  const grandTotal = round2(subtotal + taxTotal + shippingTotal - discountTotal);

  return {
    items,
    subtotal,
    discountTotal,
    taxTotal,
    shippingTotal,
    grandTotal,
    appliedPromotions,
    deliveryMethod,
    pickupOutletId: deliveryMethod === 'pickup' ? pickupOutletId : null,
    currency: 'PKR',
    availabilityErrors
  };
}

/**
 * Evaluate active promotions against quote line items.
 *
 * Mirrors the logic in POST /api/promotions/quote (routes/promotions.js)
 * so storefront quotes apply the same discounts as the POS.
 *
 * @param {object} db       – tenant db proxy
 * @param {Array}  items    – quote line items (from step 7)
 * @param {number} orderTotal – cart subtotal (pre-discount)
 * @returns {Promise<{ totalDiscount: number, appliedPromotions: Array }>}
 */
async function evaluatePromotions(db, items, orderTotal) {
  const now = new Date().toISOString().slice(0, 10);

  const { rows: promos } = await db.query(
    `SELECT * FROM promotions WHERE active = true
     AND (starts_at IS NULL OR starts_at <= $1)
     AND (ends_at IS NULL OR ends_at >= $2)
     ORDER BY id ASC`,
    [now, now]
  );

  const appliedPromotions = [];
  let totalDiscount = 0;

  // Map quote items to the shape the promo matcher expects
  const promoItems = items.map(i => ({
    product_id: i.productId,
    category_id: i.categoryId || null,
    quantity: i.qty,
    price: i.unitPrice
  }));

  for (const promo of promos) {
    const itemMatches = (item) => {
      if (promo.applies_to === 'all') return true;
      if (promo.applies_to === 'product' && promo.product_id)
        return item.product_id === promo.product_id;
      if (promo.applies_to === 'category' && promo.category_id)
        return item.category_id === promo.category_id;
      return false;
    };

    const matchedItems = promoItems.filter(itemMatches);
    const matchedTotal = matchedItems.reduce((s, i) => s + i.price * i.quantity, 0);
    let discount = 0;

    if (promo.type === 'percent') {
      discount = matchedTotal * (promo.value / 100);
    } else if (promo.type === 'fixed') {
      discount = Math.min(promo.value, matchedTotal);
    } else if (promo.type === 'threshold_percent') {
      if (orderTotal >= promo.min_order_amount)
        discount = matchedTotal * (promo.value / 100);
    } else if (promo.type === 'threshold_fixed') {
      if (orderTotal >= promo.min_order_amount)
        discount = Math.min(promo.value, matchedTotal);
    } else if (promo.type === 'bxgy') {
      if (promo.buy_qty > 0 && promo.get_qty > 0) {
        const aggregated = {};
        matchedItems.forEach((item) => {
          const pid = item.product_id;
          if (!aggregated[pid]) {
            aggregated[pid] = { quantity: 0, totalValue: 0 };
          }
          aggregated[pid].quantity += item.quantity;
          aggregated[pid].totalValue += item.quantity * item.price;
        });
        Object.values(aggregated).forEach((agg) => {
          const sets = Math.floor(agg.quantity / (promo.buy_qty + promo.get_qty));
          const avgPrice = agg.totalValue / agg.quantity;
          discount += sets * promo.get_qty * avgPrice;
        });
      }
    }

    if (discount > 0) {
      totalDiscount += discount;
      appliedPromotions.push({
        promotionId: promo.id,
        name: promo.name,
        type: promo.type,
        discount: round2(discount)
      });
    }
  }

  // Distribute discount proportionally across line items
  if (totalDiscount > 0 && items.length > 0) {
    const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
    for (const item of items) {
      const lineSubtotal = item.unitPrice * item.qty;
      const proportion = subtotal > 0 ? lineSubtotal / subtotal : 0;
      item.discount = round2(totalDiscount * proportion);
      item.lineTotal = round2(lineSubtotal + item.taxAmount - item.discount);
    }
  }

  return { totalDiscount: round2(totalDiscount), appliedPromotions };
}

/** Round to 2 decimal places */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Empty quote for zero-item carts */
function emptyQuote(deliveryMethod, pickupOutletId) {
  return {
    items: [],
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    shippingTotal: 0,
    grandTotal: 0,
    appliedPromotions: [],
    deliveryMethod,
    pickupOutletId: deliveryMethod === 'pickup' ? pickupOutletId : null,
    currency: 'PKR',
    availabilityErrors: []
  };
}

/**
 * Resolve the effective price for a product in a given context.
 * Cascade: outlet assignment → channel → customer → customer_group → base price.
 *
 * @param {object}  db
 * @param {object}  opts - { productId, variantId, outletId, channelId, customerId }
 * @returns {Promise<{ price: number, source: string, price_list_id: number|null }>}
 */
async function resolvePriceForContext(db, { productId, variantId, outletId, channelId, customerId }) {
  const now = new Date().toISOString();
  const scopes = [];
  if (outletId) scopes.push({ type: "outlet", id: outletId });
  if (channelId) scopes.push({ type: "channel", id: channelId });
  if (customerId) {
    scopes.push({ type: "customer", id: customerId });
    try {
      const { rows } = await db.query(
        "SELECT group_id FROM customer_group_members WHERE customer_id = $1 LIMIT 1",
        [customerId]
      );
      if (rows[0]) scopes.push({ type: "customer_group", id: rows[0].group_id });
    } catch (_) {}
  }

  for (const scope of scopes) {
    try {
      const { rows: assignments } = await db.query(
        `SELECT pla.price_list_id
         FROM price_list_assignments pla
         JOIN price_lists pl ON pl.id = pla.price_list_id AND pl.is_active = TRUE
         WHERE pla.scope_type = $1 AND pla.scope_id = $2 AND pla.is_active = TRUE
           AND (pla.starts_at IS NULL OR pla.starts_at <= $3)
           AND (pla.ends_at IS NULL OR pla.ends_at >= $4)
         ORDER BY pla.priority DESC LIMIT 1`,
        [scope.type, scope.id, now, now]
      );
      if (assignments[0]) {
        const { rows: priceRows } = await db.query(
          `SELECT price FROM price_list_items
           WHERE price_list_id = $1 AND product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
           ORDER BY min_qty ASC LIMIT 1`,
          [assignments[0].price_list_id, productId, variantId || null]
        );
        if (priceRows[0]) {
          return { price: Number(priceRows[0].price), source: `assignment:${scope.type}`, price_list_id: assignments[0].price_list_id };
        }
      }
    } catch (_) {}
  }

  // Customer's direct price_list_id
  if (customerId) {
    try {
      const { rows } = await db.query(
        "SELECT price_list_id FROM customers WHERE id = $1 AND price_list_id IS NOT NULL", [customerId]
      );
      if (rows[0]) {
        const { rows: priceRows } = await db.query(
          `SELECT price FROM price_list_items
           WHERE price_list_id = $1 AND product_id = $2
             AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
           ORDER BY min_qty ASC LIMIT 1`,
          [rows[0].price_list_id, productId, variantId || null]
        );
        if (priceRows[0]) {
          return { price: Number(priceRows[0].price), source: "customer_price_list", price_list_id: rows[0].price_list_id };
        }
      }
    } catch (_) {}
  }

  // Base price fallback
  const { rows } = await db.query(
    `SELECT p.price, pv.price AS variant_price
     FROM products p LEFT JOIN product_variants pv ON pv.id = $2 AND pv.product_id = p.id
     WHERE p.id = $1`,
    [productId, variantId]
  );
  const base = rows[0]
    ? (rows[0].variant_price != null ? Number(rows[0].variant_price) : Number(rows[0].price))
    : 0;
  return { price: base, source: "base_price", price_list_id: null };
}

module.exports = { calculateQuote, resolvePriceForContext };
