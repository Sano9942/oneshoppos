/**
 * Shared promotion evaluation engine.
 *
 * Single source of truth for evaluating active promotions against a cart —
 * extracted verbatim from routes/promotions.js POST /api/promotions/quote
 * (the POS + field-rep engine) so the storefront/portal quote path
 * (services/quote.js) stops running a stale fork. The fork was missing the
 * Tier 1.3 (v93) additions: slab_percent tier evaluation, brand-scoped
 * matching, and ORDER BY priority DESC.
 *
 * Item shape: { product_id, category_id?, brand_id?, quantity, price, price_locked? }.
 * brand_id is hydrated from the products table when any active promo needs
 * it and the caller didn't supply it.
 *
 * price_locked (V01 grocery): a line whose price is FINAL and not promotable —
 * a scale/deli price-embedded barcode already carries the exact price for that
 * pre-weighed pack, and a manager price override is an explicit fixed price.
 * Such lines are excluded from EVERY promotion (percentage, threshold, bxgy,
 * slab) so a "10% off storewide" scheme can't re-discount a chicken pack that
 * was already priced at the counter — a margin leak on every weighed item
 * otherwise. Locked lines still count toward the caller-supplied orderTotal
 * (they are real spend for threshold gating); they just never RECEIVE discount.
 *
 * Read-only — safe to call outside a transaction.
 */

/**
 * @param {object} db         tenant db (proxy or scoped handle) — needs .query
 * @param {Array}  items      [{ product_id, category_id, brand_id, quantity, price }]
 * @param {number} orderTotal cart subtotal (pre-discount) for threshold_* types
 * @returns {Promise<{applied: Array, totalDiscount: number}>}
 *          applied: [{ promotion_id, name, type, discount, qty_qualifying, tier }]
 */
async function evaluatePromotions(db, items, orderTotal) {
  // promotions.starts_at/ends_at are TEXT 'YYYY-MM-DD' strings entered as
  // tenant-LOCAL dates, so "today" must be the tenant's local date — not the
  // UTC date (a promo ending "today" died at 5 PM PKT; one starting "today"
  // went live 5 hours early... or late, depending on the zone). The tenant tz
  // is resolved here rather than threaded through because the storefront
  // caller (services/quote.js) runs before company-profile middleware.
  const { tenantToday } = require("../utils/tz");
  let tz = "UTC";
  try {
    const { rows: [prof] } = await db.query(
      "SELECT timezone FROM company_profile WHERE id = 1"
    );
    if (prof?.timezone) tz = prof.timezone;
  } catch { /* fall back to UTC */ }
  const now = tenantToday(tz);

  const { rows: promos } = await db.query(
    `SELECT * FROM promotions WHERE active = true
     AND (starts_at IS NULL OR starts_at <= $1)
     AND (ends_at IS NULL OR ends_at >= $2)
     ORDER BY priority DESC, id ASC`,
    [now, now],
  );

  // Hydrate item.brand_id if any active promo is brand-scoped and the
  // caller didn't pass brand_id on cart items.
  const needsBrand = promos.some(
    (p) => p.applies_to === "brand" || (p.type === "slab_percent" && p.brand_id),
  );
  const missingBrandIds = items
    .filter((i) => needsBrand && i.brand_id == null)
    .map((i) => Number(i.product_id))
    .filter((id) => Number.isInteger(id) && id > 0);
  let brandMap = new Map();
  if (missingBrandIds.length) {
    const ids = Array.from(new Set(missingBrandIds));
    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(",");
    const { rows: prodRows } = await db.query(
      `SELECT id, brand_id FROM products WHERE id IN (${placeholders})`,
      ids,
    );
    brandMap = new Map(prodRows.map((p) => [Number(p.id), p.brand_id]));
  }
  const hydratedItems = items.map((i) => ({
    ...i,
    brand_id:
      i.brand_id != null ? Number(i.brand_id) : brandMap.get(Number(i.product_id)) ?? null,
  }));

  const applied = [];
  let totalDiscount = 0;

  for (const promo of promos) {
    const itemMatches = (item) => {
      if (promo.applies_to === "all") return true;
      if (promo.applies_to === "product" && promo.product_id)
        return item.product_id === promo.product_id;
      if (promo.applies_to === "category" && promo.category_id)
        return item.category_id === promo.category_id;
      if (promo.applies_to === "brand" && promo.brand_id)
        return Number(item.brand_id) === Number(promo.brand_id);
      return false;
    };

    const matchedItems = hydratedItems.filter(
      (item) => itemMatches(item) && item.price_locked !== true,
    );
    const matchedTotal = matchedItems.reduce(
      (s, i) => s + i.price * i.quantity,
      0,
    );
    const matchedQty = matchedItems.reduce(
      (s, i) => s + Number(i.quantity || 0),
      0,
    );
    let discount = 0;
    let matchedTier = null;

    if (promo.type === "percent") {
      discount = matchedTotal * (promo.value / 100);
    } else if (promo.type === "fixed") {
      discount = Math.min(promo.value, matchedTotal);
    } else if (promo.type === "threshold_percent") {
      if (orderTotal >= promo.min_order_amount)
        discount = matchedTotal * (promo.value / 100);
    } else if (promo.type === "threshold_fixed") {
      if (orderTotal >= promo.min_order_amount)
        discount = Math.min(promo.value, matchedTotal);
    } else if (promo.type === "bxgy") {
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
          const sets = Math.floor(
            agg.quantity / (promo.buy_qty + promo.get_qty),
          );
          const avgPrice = agg.totalValue / agg.quantity;
          discount += sets * promo.get_qty * avgPrice;
        });
      }
    } else if (promo.type === "slab_percent") {
      // Volume slab: total matched qty determines which tier applies.
      // tier_rules is a JSONB array of { qty_from, qty_to|null, value }.
      // Pick the single matching tier (no stacking across tiers).
      const tiers = Array.isArray(promo.tier_rules) ? promo.tier_rules : [];
      for (const t of tiers) {
        const from = Number(t.qty_from);
        const to = t.qty_to == null ? Infinity : Number(t.qty_to);
        if (matchedQty >= from && matchedQty <= to) {
          matchedTier = t;
          discount = matchedTotal * (Number(t.value) / 100);
          break;
        }
      }
    }

    if (discount > 0) {
      totalDiscount += discount;
      applied.push({
        promotion_id: promo.id,
        name: promo.name,
        type: promo.type,
        discount: parseFloat(discount.toFixed(2)),
        qty_qualifying: matchedQty,
        tier: matchedTier,
      });
    }
  }

  return { applied, totalDiscount };
}

module.exports = { evaluatePromotions };
