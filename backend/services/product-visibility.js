'use strict';

/**
 * Tier 2.11 — customer-group catalog visibility (Option C/C2).
 *
 * Decides which products a given customer is allowed to see and buy.
 *
 * Rules:
 *   - products.visibility = 'all'        → visible to everyone (default)
 *   - products.visibility = 'restricted' → visible only to customers whose
 *     customer_group_id appears in customer_group_products.product_id
 *
 * Ungrouped buyers (and anonymous storefront visitors) see only 'all' rows.
 * This is the C2 default the handoff specified — a forgotten new buyer
 * sees a partial catalog (recoverable) rather than private-label SKUs
 * (contractual problem if anonymous, embarrassing if signed-in).
 *
 * Bypass paths (never call this helper):
 *   - admin product CRUD (owner must see every SKU they own)
 *   - reports (financial totals must not exclude restricted revenue)
 *   - POS (in-person cashier flow — visibility is a buyer gate, not a
 *     transaction gate)
 *   - manufacturer portal (manufacturer partners see their own brand)
 *
 * Field-rep app: the rep is logged in as an employee, but they're acting
 * on behalf of a specific customer (one customer per FieldOrderRedesign
 * mount). The rep's view should reflect the *customer's* visibility, not
 * the employee's. Callers pass that customer_id, not req.employee.id.
 */

/**
 * Returns a SQL WHERE fragment that filters `products p` rows to those
 * visible to `customerId`. The fragment references `p.id` and (when
 * needed) one positional parameter `$<paramIndex>` for the customer's
 * group id. The caller is responsible for inserting the parameter at
 * the correct index in their query.
 *
 * Shape: { sql: string, params: number[] }
 *   - `params` is the array of values to append to the caller's params
 *     array. The caller must substitute `$<placeholder>` with the right
 *     positional index when building the final SQL.
 *
 * Use `withVisibilityWhere` below for the common case of appending the
 * filter to an existing WHERE clause string + params array.
 */
async function visibleProductSqlFragment(db, customerId) {
  if (!customerId) {
    return { sql: "p.visibility = 'all'", params: [] };
  }
  const { rows } = await db.query(
    "SELECT customer_group_id FROM customers WHERE id = $1 AND deleted_at IS NULL",
    [customerId]
  );
  const gid = rows[0]?.customer_group_id || null;
  if (!gid) {
    // Customer exists but isn't in any group → C2 default
    return { sql: "p.visibility = 'all'", params: [] };
  }
  return {
    sql: "(p.visibility = 'all' OR EXISTS (SELECT 1 FROM customer_group_products cgp WHERE cgp.product_id = p.id AND cgp.customer_group_id = $PLACEHOLDER))",
    params: [gid],
  };
}

/**
 * Convenience: append a visibility filter to an existing `conditions[]`
 * + `params[]` pair. Mutates both arrays in place.
 *
 * Example:
 *   const conditions = ["p.status = $1"];
 *   const params = ["active"];
 *   await withVisibilityWhere(db, conditions, params, customerId);
 *   // conditions now ends with the visibility fragment using the next
 *   // available $N placeholder; params has the group id appended (if any).
 */
async function withVisibilityWhere(db, conditions, params, customerId) {
  const frag = await visibleProductSqlFragment(db, customerId);
  if (!frag.params.length) {
    conditions.push(frag.sql);
    return;
  }
  const nextIdx = params.length + 1;
  conditions.push(frag.sql.replace('$PLACEHOLDER', `$${nextIdx}`));
  params.push(...frag.params);
}

/**
 * Single-item gate: is this product visible to this customer?
 * Used by storefront-cart.js addItem and the reorder eligibility filter.
 * Returns true if visible, false otherwise. NEVER throws.
 */
async function isProductVisibleToCustomer(db, customerId, productId) {
  const pid = Number(productId);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const { rows: pr } = await db.query(
    "SELECT visibility FROM products WHERE id = $1",
    [pid]
  );
  if (!pr.length) return false;
  if (pr[0].visibility === 'all') return true;

  // Restricted — needs a matching customer group
  if (!customerId) return false;
  const { rows: cr } = await db.query(
    "SELECT customer_group_id FROM customers WHERE id = $1 AND deleted_at IS NULL",
    [customerId]
  );
  const gid = cr[0]?.customer_group_id || null;
  if (!gid) return false;

  const { rows: mr } = await db.query(
    "SELECT 1 FROM customer_group_products WHERE product_id = $1 AND customer_group_id = $2 LIMIT 1",
    [pid, gid]
  );
  return mr.length > 0;
}

module.exports = {
  visibleProductSqlFragment,
  withVisibilityWhere,
  isProductVisibleToCustomer,
};
