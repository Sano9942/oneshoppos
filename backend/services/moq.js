/**
 * Tier 2.2 — minimum order quantity + case-pack increment enforcement.
 *
 * Shared helper called from the storefront cart service (for portal + public
 * storefront flows) and from /api/sales (for field-rep order capture, gated
 * by field_visit_uuid). POS is intentionally NOT gated — cashiers are in
 * person with the buyer and overrides happen naturally.
 *
 * Rules:
 *   - min_order_qty = 0 → no minimum (default; pre-v95 behavior)
 *   - order_increment = 1 → no case-pack rule (default; pre-v95 behavior)
 *   - qty must be >= min_order_qty AND qty % order_increment === 0
 *
 * The helper accepts a single { product_id, quantity, name? } pair or an
 * array of cart items, and returns { ok, violations: [...] }. Callers throw
 * or 400-respond from the returned shape — this module never throws.
 */

const DB_FIELDS = "id, name, min_order_qty, order_increment";

async function loadMoqMap(db, productIds) {
  if (!productIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT ${DB_FIELDS} FROM products WHERE id = ANY($1::int[])`,
    [productIds]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(Number(r.id), {
      name: r.name,
      min_order_qty: Number(r.min_order_qty || 0),
      order_increment: Number(r.order_increment || 1),
    });
  }
  return map;
}

function checkOne(rule, qty) {
  const reasons = [];
  if (rule.min_order_qty > 0 && qty < rule.min_order_qty) {
    reasons.push({
      reason: "below_min",
      min_order_qty: rule.min_order_qty,
    });
  }
  if (rule.order_increment > 1 && qty % rule.order_increment !== 0) {
    reasons.push({
      reason: "not_a_multiple",
      order_increment: rule.order_increment,
    });
  }
  return reasons;
}

/**
 * Validate an array of cart-like items against MOQ rules.
 * Each item: { product_id, quantity, name? }
 * Returns { ok, violations: [{ product_id, name, quantity, ...rule }] }.
 * Items with product_id missing from the DB are skipped (not a violation —
 * upstream validation should catch missing products).
 */
async function validateMoq(db, items) {
  if (!Array.isArray(items) || items.length === 0) return { ok: true, violations: [] };

  const productIds = Array.from(
    new Set(
      items
        .map((i) => Number(i.product_id))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  );
  const map = await loadMoqMap(db, productIds);

  const violations = [];
  for (const item of items) {
    const pid = Number(item.product_id);
    const qty = Number(item.quantity || 0);
    const rule = map.get(pid);
    if (!rule) continue;
    const reasons = checkOne(rule, qty);
    if (reasons.length === 0) continue;
    violations.push({
      product_id: pid,
      name: item.name || rule.name,
      quantity: qty,
      min_order_qty: rule.min_order_qty,
      order_increment: rule.order_increment,
      reasons,
    });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Single-item check used by cart add/update — fetches the one row and
 * returns a violation object (or null). Cheaper than building the array
 * form when you only have one product to check.
 */
async function validateMoqSingle(db, productId, quantity) {
  const pid = Number(productId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const { rows } = await db.query(
    `SELECT ${DB_FIELDS} FROM products WHERE id = $1`,
    [pid]
  );
  if (!rows.length) return null;
  const rule = {
    name: rows[0].name,
    min_order_qty: Number(rows[0].min_order_qty || 0),
    order_increment: Number(rows[0].order_increment || 1),
  };
  const reasons = checkOne(rule, Number(quantity || 0));
  if (reasons.length === 0) return null;
  return {
    product_id: pid,
    name: rule.name,
    quantity: Number(quantity),
    min_order_qty: rule.min_order_qty,
    order_increment: rule.order_increment,
    reasons,
  };
}

module.exports = { validateMoq, validateMoqSingle };
