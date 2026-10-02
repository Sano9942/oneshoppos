/**
 * One Toy Store F9 (d): new toys from a supplier bill (PHASE-F-PLAN F9).
 *
 *   code      ONE running number for all new toys, 31000 up, max 5 digits; the
 *             next number not used as an SKU (with or without leading zeros:
 *             7556 = 07556) nor as a barcode. The shop may type its own code
 *             (same checks). A lock keeps two saves from taking the same one.
 *   category  required, a bottom-level one (same rule as Add Product)
 *   brand     Brand (which one; added when not in SanoPOS yet, spelling
 *             differences ignored) or Non-brand (no brand) — required
 *   price     from the check screen (the shop's price rules live there)
 *   barcode   optional, the maker's barcode scanned while unpacking
 * Runs inside the save's transaction: any refusal creates nothing.
 */
const { getCategoryById, isLeafCategory } = require("../category-tree");

const FIRST_CODE = 31000;
const LAST_CODE = 99999;
const fail = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
const noZeros = (s) => String(s).replace(/^0+/, "");
// "Fisher Price" = "Fisher-Price"; the website's "Bburago" = SanoPOS's "Burago".
const BRAND_ALIASES = { bburago: "burago" };
const brandKey = (s) => {
  const k = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return BRAND_ALIASES[k] || k;
};

async function usedNumbers(client) {
  const { rows } = await client.query(
    `SELECT x FROM (SELECT sku AS x FROM products UNION ALL SELECT barcode FROM products
                    UNION ALL SELECT barcode FROM product_barcodes) t
      WHERE x ~ '^[0-9]{1,6}$'`);
  return new Set(rows.map((r) => noZeros(r.x)));
}

async function codeOwner(client, code) {
  const { rows: [r] } = await client.query(
    `SELECT p.sku, p.name FROM products p
      WHERE ltrim(p.sku, '0') = $1 OR ltrim(p.barcode, '0') = $1
         OR p.id IN (SELECT product_id FROM product_barcodes WHERE ltrim(barcode, '0') = $1)
      LIMIT 1`, [code]);
  return r || null;
}

async function barcodeOwner(client, barcode) {
  const { rows: [r] } = await client.query(
    `SELECT p.name FROM products p
      WHERE p.barcode = $1 OR p.sku = $1 OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode = $1)
      LIMIT 1`, [barcode]);
  return r || null;
}

async function brandId(client, name) {
  const key = brandKey(name);
  const { rows } = await client.query("SELECT id, name FROM brands");
  const found = rows.find((b) => brandKey(b.name) === key);
  if (found) return found.id;
  const { rows: [b] } = await client.query(
    "INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [String(name).trim()]);
  return b.id;
}

/**
 * Check every new toy on the bill, then create them. Returns the lines with
 * each new toy's line pointing at its created toy (all pieces on it), and the
 * created toys for the labels list.
 */
async function createNewToys(client, lines, supplierId) {
  const items = lines.map((l, i) => ({ l, i })).filter((x) => x.l.is_new);
  if (!items.length) return { lines, created: [] };

  // 1. Check everything first.
  const typedCodes = new Map();
  const barcodes = new Map();
  for (const { l, i } of items) {
    const label = `Line ${l.line_no ?? i + 1}`;
    const t = l.new_toy || {};
    if (!String(t.name || "").trim()) throw fail(`${label}: type the new toy's name`);
    if (!t.category_id) throw fail(`${label}: choose the category`);
    const cat = await getCategoryById(client, t.category_id);
    if (!cat) throw fail(`${label}: category not found`);
    if (!(await isLeafCategory(client, cat.id))) throw fail(`${label}: "${cat.name}" has sub-categories: choose the category under it`);
    if (t.is_brand !== true && t.is_brand !== false) throw fail(`${label}: say Brand or Non-brand`);
    if (t.is_brand && !String(t.brand_name || "").trim()) throw fail(`${label}: which brand?`);
    if (!(Number(t.price) > 0)) throw fail(`${label}: type the selling price`);
    const code = String(t.code || "").trim();
    if (code) {
      if (!/^\d{1,5}$/.test(code) || !noZeros(code)) throw fail(`${label}: a shop code is 1 to 5 digits (the price-tag machine's limit)`);
      if (typedCodes.has(noZeros(code))) throw fail(`${label}: code ${code} is also on ${typedCodes.get(noZeros(code))}`);
      const owner = await codeOwner(client, noZeros(code));
      if (owner) throw fail(`${label}: code ${code} is already used (${owner.sku} ${owner.name})`);
      typedCodes.set(noZeros(code), label.toLowerCase());
    }
    const bc = String(t.barcode || "").trim();
    if (bc) {
      if (barcodes.has(bc)) throw fail(`${label}: barcode ${bc} is also on ${barcodes.get(bc)}`);
      const owner = await barcodeOwner(client, bc);
      if (owner) throw fail(`${label}: barcode ${bc} is already on ${owner.name}`);
      barcodes.set(bc, label.toLowerCase());
    }
  }

  // 2. Codes: one running number, under a lock for this shop.
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':ots_shop_codes'))");
  const used = await usedNumbers(client);
  for (const c of typedCodes.keys()) used.add(c);
  let next = FIRST_CODE;
  const nextCode = () => {
    while (next <= LAST_CODE && used.has(String(next))) next += 1;
    if (next > LAST_CODE) throw fail("No free 5-digit shop code left from 31000 up");
    used.add(String(next));
    return String(next);
  };

  // 3. Create.
  const created = [];
  const out = lines.slice();
  for (const { l, i } of items) {
    const t = l.new_toy;
    const sku = String(t.code || "").trim() || nextCode();
    const brand = t.is_brand ? await brandId(client, t.brand_name) : null;
    const { rows: [p] } = await client.query(
      `INSERT INTO products (name, sku, barcode, price, cost_price, category_id, brand_id, supplier_id, unit, status)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,'pcs','active') RETURNING id, sku, name, price`,
      [String(t.name).trim(), sku, String(t.barcode || "").trim() || null, Number(t.price), Number(t.category_id), brand, supplierId]);
    const pieces = (Number(l.received_qty) || 0) * Math.max(1, Math.round(Number(l.split_into) || 1));
    out[i] = { ...l, is_new: false, was_new: true, toys: [{ product_id: p.id, qty: pieces }] };
    created.push({ product_id: p.id, sku: p.sku, name: p.name, price: Number(p.price), is_new: true });
  }
  return { lines: out, created };
}

module.exports = { createNewToys, brandKey, FIRST_CODE };
