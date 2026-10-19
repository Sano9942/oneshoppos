// One Toy Store pilot: the "Needs a Category" fix-it list (owner, 2026-10-19).
//
// The iPOS import put every toy it had no category for into the sub-category
// "Other → Needs a Category"; those toys spoil the category figures (G1 Stock
// Value, the dashboard's category card). This lists them — plus any toy with
// no category at all — so the owner can give each a real one:
//   - toys that sold come first (biggest sale less returns first), then toys
//     in stock (biggest stock value at cost first); the rest only with `all`;
//   - sold = rung up on a bill that wasn't voided, any branch, any date;
//     stock = all branches together (the catalogue is shop-wide);
//   - a suggestion from the supplier: the category most of the same
//     supplier's other (categorised) toys are in, when it is more than half
//     of them and at least 2 toys. Nothing changes until the owner clicks.
// Saving goes through the existing POST /api/products/bulk-category.

const { fetchEnrichedCategories } = require("../category-tree");

const NEEDS_NAME = "needs a category";
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const BASE_SQL = `
  WITH nc AS (SELECT id FROM categories WHERE LOWER(TRIM(name)) = '${NEEDS_NAME}'),
  toys AS (
    SELECT p.id FROM products p
     WHERE p.deleted_at IS NULL
       AND (p.category_id IS NULL OR p.category_id IN (SELECT id FROM nc))
  ),
  stock AS (
    SELECT os.product_id, SUM(os.quantity) AS q
      FROM outlet_stock os WHERE os.product_id IN (SELECT id FROM toys)
     GROUP BY os.product_id
  ),
  sold AS (
    SELECT si.product_id, SUM(si.quantity) AS units,
           SUM(si.quantity * si.price_at_sale) AS amount, MAX(s.timestamp) AS last_sold
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.voided = false AND si.product_id IN (SELECT id FROM toys)
     GROUP BY si.product_id
  ),
  back AS (
    SELECT ri.product_id, SUM(ri.quantity * ri.refund_price) AS amount
      FROM return_items ri WHERE ri.product_id IN (SELECT id FROM toys)
     GROUP BY ri.product_id
  )
  SELECT p.id, p.name, p.sku, p.barcode, p.supplier_id, p.category_id,
         p.price, p.cost_price,
         sup.name AS supplier_name, c.name AS category_name,
         COALESCE(st.q, 0) AS stock,
         COALESCE(st.q, 0) * COALESCE(p.cost_price, 0) AS cost_value,
         COALESCE(so.units, 0) AS units_sold,
         COALESCE(so.amount, 0) - COALESCE(b.amount, 0) AS sold_amount,
         so.last_sold
    FROM toys t
    JOIN products p ON p.id = t.id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock st ON st.product_id = p.id
    LEFT JOIN sold so ON so.product_id = p.id
    LEFT JOIN back b ON b.product_id = p.id`;

const isSold = (r) => Number(r.units_sold) > 0;
const inStock = (r) => Number(r.stock) > 0;

function sortRows(rows) {
  const rank = (r) => (isSold(r) ? 0 : inStock(r) ? 1 : 2);
  return rows.sort((a, b) =>
    rank(a) - rank(b)
    || (rank(a) === 0 ? Number(b.sold_amount) - Number(a.sold_amount) : 0)
    || (rank(a) === 1 ? Number(b.cost_value) - Number(a.cost_value) : 0)
    || String(a.name).localeCompare(String(b.name)));
}

async function supplierSuggestions(db, supplierIds) {
  if (!supplierIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT p.supplier_id, p.category_id, COUNT(*)::int AS n
       FROM products p
      WHERE p.deleted_at IS NULL AND p.supplier_id = ANY($1::int[])
        AND p.category_id IS NOT NULL
        AND p.category_id NOT IN (SELECT id FROM categories WHERE LOWER(TRIM(name)) = '${NEEDS_NAME}')
      GROUP BY p.supplier_id, p.category_id`,
    [supplierIds]);
  const bySupplier = new Map();
  for (const r of rows) {
    const s = bySupplier.get(r.supplier_id) || { of: 0, best: null };
    s.of += r.n;
    if (!s.best || r.n > s.best.n) s.best = r;
    bySupplier.set(r.supplier_id, s);
  }
  const categories = new Map((await fetchEnrichedCategories(db)).map((c) => [Number(c.id), c]));
  const out = new Map();
  for (const [supplierId, s] of bySupplier) {
    if (s.best.n < 2 || s.best.n * 2 <= s.of) continue;
    const cat = categories.get(Number(s.best.category_id));
    if (!cat || !cat.is_leaf) continue;
    out.set(supplierId, { category_id: Number(cat.id), path_label: cat.path_label || cat.name, count: s.best.n, of: s.of });
  }
  return out;
}

async function listNeedsCategory(db, { all = false } = {}) {
  const { rows } = await db.query(BASE_SQL);
  const listed = rows.filter((r) => isSold(r) || inStock(r));
  const shown = sortRows(all ? rows : listed);
  const suggestions = await supplierSuggestions(db, [...new Set(shown.map((r) => r.supplier_id).filter(Boolean))]);
  return {
    counts: { listed: listed.length, all: rows.length },
    rows: shown.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      supplier_name: r.supplier_name || null,
      category_name: r.category_name || null,
      price: round2(r.price),
      stock: round2(r.stock),
      cost_value: round2(r.cost_value),
      units_sold: round2(r.units_sold),
      sold_amount: round2(r.sold_amount),
      last_sold: r.last_sold || null,
      suggestion: (r.supplier_id && suggestions.get(r.supplier_id)) || null,
    })),
  };
}

async function countNeedsCategory(db) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM (${BASE_SQL}) x WHERE x.units_sold > 0 OR x.stock > 0`);
  return rows[0]?.n || 0;
}

module.exports = { listNeedsCategory, countNeedsCategory };
