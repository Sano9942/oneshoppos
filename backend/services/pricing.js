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

module.exports = {
  resolveCustomerPricing,
  resolveGroupPriceBookOverrides,
  applyPriceBookOverrides,
  composeAutoDiscountPercent,
};
