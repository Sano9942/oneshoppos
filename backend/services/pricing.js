/**
 * Phase 2-G Wave 2 — customer-group + loyalty-tier price resolution.
 *
 * Pure-ish resolver: fetches group + tier info for one customer, looks up
 * any group-scoped price_list_items overrides, and returns the data the
 * sales route needs to rewrite cart prices + stack discounts additively.
 *
 * Design decisions (per plan):
 *   - Group discount + tier discount stack ADDITIVELY (10% + 5% = 15%).
 *   - Per-product overrides gated by phase2g_price_books flag.
 *   - Group-level auto-discount gated by phase2g_price_books (keeps one
 *     flag for the B2B wedge feature; Wave 1 stance was to ship ungated
 *     but shipping everything behind the same flag makes rollback cleaner).
 *   - Tier discount gated by phase2g_loyalty (applied in Track B).
 */

async function resolveCustomerPricing({ db, customerId }) {
  if (!customerId) {
    return {
      customer: null,
      group: null,
      tier: null,
    };
  }

  const { rows: custRows } = await db.query(
    `SELECT id, customer_group_id, loyalty_tier_id
       FROM customers
      WHERE id = $1`,
    [customerId],
  );
  const customer = custRows[0] || null;
  if (!customer) {
    return { customer: null, group: null, tier: null };
  }

  let group = null;
  if (customer.customer_group_id) {
    const { rows } = await db.query(
      `SELECT id, name, COALESCE(discount_percent, 0)::numeric AS discount_percent
         FROM customer_groups
        WHERE id = $1 AND is_active = true`,
      [customer.customer_group_id],
    );
    group = rows[0] || null;
  }

  let tier = null;
  if (customer.loyalty_tier_id) {
    const { rows } = await db.query(
      `SELECT id, name, COALESCE(discount_percent, 0)::numeric AS discount_percent
         FROM loyalty_tiers
        WHERE id = $1 AND is_active = true`,
      [customer.loyalty_tier_id],
    );
    tier = rows[0] || null;
  }

  return { customer, group, tier };
}

/**
 * Look up per-product group-scoped price-book overrides.
 * Returns a Map<productId, overridePrice>. Variant-scoped overrides take
 * precedence over product-only overrides for a matching variant.
 */
async function resolveGroupPriceBookOverrides({ db, groupId, cartItems }) {
  if (!groupId || !Array.isArray(cartItems) || cartItems.length === 0) {
    return new Map();
  }

  // Normalize product ids we want to look up. An item can carry either `id`
  // (raw product id) or `original_product_id` (when a POS sent through a
  // bundle expansion). Bundle components themselves aren't resolved here.
  const productIds = Array.from(
    new Set(
      cartItems
        .filter((i) => !i.is_bundle)
        .map((i) => Number(i.original_product_id || i.id))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  );
  if (productIds.length === 0) return new Map();

  const { rows } = await db.query(
    `SELECT pli.product_id, pli.variant_id, pli.price::numeric AS price, pli.min_qty
       FROM price_lists pl
       JOIN price_list_items pli ON pli.price_list_id = pl.id
      WHERE pl.customer_group_id = $1
        AND pl.is_active = true
        AND pli.product_id = ANY($2::int[])`,
    [groupId, productIds],
  );

  // Key: "productId:variantId|null". Variant-specific rows win over
  // product-level rows when a cart item supplies a variant_id.
  const byKey = new Map();
  for (const row of rows) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) continue;
    const minQty = Number(row.min_qty || 1);
    // Best-price-wins among rows that meet min_qty — cart-item filtering
    // happens in applyOverrides below, once we know each item's qty.
    const variantKey = row.variant_id == null ? "null" : String(row.variant_id);
    const key = `${row.product_id}:${variantKey}`;
    const existing = byKey.get(key);
    if (!existing || price < existing.price) {
      byKey.set(key, { price, minQty });
    }
  }

  return byKey;
}

/**
 * Apply overrides to a cart in place. Returns a summary of what changed
 * so the sale route can log + include breakdown in the response.
 *
 * Matching order per cart item:
 *   1. Variant-scoped override (if item.variant_id matches)
 *   2. Product-level override (variant_id IS NULL row)
 */
function applyPriceBookOverrides(cartItems, overridesMap) {
  const applied = [];
  if (!overridesMap || overridesMap.size === 0) return applied;

  for (const item of cartItems) {
    if (item.is_bundle) continue;
    const productId = Number(item.original_product_id || item.id);
    const variantId = item.variant_id != null ? Number(item.variant_id) : null;
    const qty = Number(item.quantity || 0);

    const candidate =
      (variantId != null && overridesMap.get(`${productId}:${variantId}`)) ||
      overridesMap.get(`${productId}:null`) ||
      null;
    if (!candidate) continue;
    if (qty < (candidate.minQty || 1)) continue;

    const originalPrice = Number(item.price);
    if (!Number.isFinite(originalPrice)) continue;
    if (candidate.price >= originalPrice) continue; // only downward overrides

    applied.push({
      product_id: productId,
      variant_id: variantId,
      original_price: originalPrice,
      override_price: candidate.price,
      quantity: qty,
    });
    item.price = candidate.price;
  }

  return applied;
}

/**
 * Compose additive auto-discount percentages from group + tier.
 * Returns { pct, breakdown } where breakdown preserves the individual
 * components so the receipt + audit log can surface each separately.
 */
function composeAutoDiscountPercent({
  group,
  tier,
  applyGroup = true,
  applyTier = true,
}) {
  const components = [];
  let pct = 0;
  if (applyGroup && group && Number(group.discount_percent) > 0) {
    const p = Number(group.discount_percent);
    pct += p;
    components.push({
      kind: "customer_group",
      customer_group_id: group.id,
      name: group.name,
      percent: p,
    });
  }
  if (applyTier && tier && Number(tier.discount_percent) > 0) {
    const p = Number(tier.discount_percent);
    pct += p;
    components.push({
      kind: "loyalty_tier",
      loyalty_tier_id: tier.id,
      name: tier.name,
      percent: p,
    });
  }
  // Cap additive stacking at 100% so we never return a negative subtotal.
  if (pct > 100) pct = 100;
  return { pct, breakdown: components };
}

/**
 * Shared price-list resolution — single source of truth for "what does this
 * buyer pay for this product". Replaces two divergent copies (services/
 * quote.js + routes/price-list-assignments.js) that both tried outlet scope
 * BEFORE customer scope, inverting POS semantics (useCart.js: the customer's
 * price list always beats the outlet list).
 *
 * Canonical precedence (customer-most-specific first):
 *   1. price_list_assignments scope 'customer'
 *   2. customers.price_list_id (direct — the source POS reads)
 *   3. price_list_assignments scope 'customer_group'
 *      (via customers.customer_group_id — the old copies queried a
 *      customer_group_members table that does not exist in the schema, so
 *      group scope silently never matched)
 *   4. price_list_assignments scope 'channel'
 *   5. price_list_assignments scope 'outlet'
 *   6. product/variant base price
 *
 * Quantity breaks: rows are matched min_qty <= qty, highest qualifying
 * min_qty wins (same as POS useCart). The old backend copies did
 * ORDER BY min_qty ASC ignoring qty — handing bulk prices to single-unit
 * buyers when only a high-min row existed.
 */
async function resolvePriceForContext(db, { productId, variantId, qty, outletId, channelId, customerId }) {
  const now = new Date().toISOString();
  const quantity = Number(qty) > 0 ? Number(qty) : 1;

  const lookup = async (priceListId) => {
    const { rows } = await db.query(
      `SELECT price FROM price_list_items
        WHERE price_list_id = $1 AND product_id = $2
          AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
          AND COALESCE(min_qty, 1) <= $4
        ORDER BY COALESCE(min_qty, 1) DESC LIMIT 1`,
      [priceListId, productId, variantId || null, quantity],
    );
    return rows[0]?.price ?? null;
  };

  const tryAssignment = async (scopeType, scopeId) => {
    const { rows: assignments } = await db.query(
      `SELECT pla.price_list_id
         FROM price_list_assignments pla
         JOIN price_lists pl ON pl.id = pla.price_list_id AND pl.is_active = TRUE
        WHERE pla.scope_type = $1 AND pla.scope_id = $2 AND pla.is_active = TRUE
          AND (pla.starts_at IS NULL OR pla.starts_at <= $3)
          AND (pla.ends_at IS NULL OR pla.ends_at >= $4)
        ORDER BY pla.priority DESC`,
      [scopeType, scopeId, now, now],
    );
    for (const a of assignments) {
      const price = await lookup(a.price_list_id);
      if (price != null) {
        return {
          price: Number(price),
          source: `assignment:${scopeType}`,
          price_list_id: a.price_list_id,
        };
      }
    }
    return null;
  };

  if (customerId) {
    // 1. customer-scoped assignment
    const byCustomer = await tryAssignment("customer", customerId);
    if (byCustomer) return byCustomer;

    // 2 + 3. direct price_list_id, then group assignment
    try {
      const { rows } = await db.query(
        "SELECT price_list_id, customer_group_id FROM customers WHERE id = $1",
        [customerId],
      );
      const cust = rows[0];
      if (cust?.price_list_id) {
        const price = await lookup(cust.price_list_id);
        if (price != null) {
          return { price: Number(price), source: "customer_price_list", price_list_id: cust.price_list_id };
        }
      }
      if (cust?.customer_group_id) {
        const byGroup = await tryAssignment("customer_group", cust.customer_group_id);
        if (byGroup) return byGroup;
      }
    } catch (_) { /* pre-migration tenant — columns may be missing */ }
  }

  // 4. channel, 5. outlet
  if (channelId) {
    const byChannel = await tryAssignment("channel", channelId);
    if (byChannel) return byChannel;
  }
  if (outletId) {
    const byOutlet = await tryAssignment("outlet", outletId);
    if (byOutlet) return byOutlet;
  }

  // 6. base price
  const { rows: baseRows } = await db.query(
    `SELECT p.price AS product_price, pv.price AS variant_price
       FROM products p
       LEFT JOIN product_variants pv ON pv.id = $2 AND pv.product_id = p.id
      WHERE p.id = $1`,
    [productId, variantId || null],
  );
  if (baseRows[0]) {
    const base = baseRows[0].variant_price != null
      ? Number(baseRows[0].variant_price)
      : Number(baseRows[0].product_price);
    return { price: base, source: "base_price", price_list_id: null };
  }
  return { price: 0, source: "not_found", price_list_id: null };
}

module.exports = {
  resolveCustomerPricing,
  resolveGroupPriceBookOverrides,
  applyPriceBookOverrides,
  composeAutoDiscountPercent,
  resolvePriceForContext,
};
