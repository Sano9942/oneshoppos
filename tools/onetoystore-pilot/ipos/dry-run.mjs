/**
 * One Toy Store pilot, Phase D: dry run of the iPOS item file into a brand-new
 * THROWAWAY local shop, then check every item came in exactly as converted.
 *
 *   python tools/onetoystore-pilot/ipos/ipos_convert.py <pspsupplier.xls> <dir>
 *   OTS_API_BASE=http://127.0.0.1:5000 node tools/onetoystore-pilot/ipos/dry-run.mjs <dir>
 *
 * Needs the local backend running (LOCAL DB). Refuses anything not on localhost.
 * Sets up what the importer needs first (category tree, brands, suppliers, a
 * Packages Mall + Store Room shop), previews, imports into Packages Mall with
 * "these items already have labels" ticked, then reads everything back from the
 * database and the till's scan lookup. Writes dry-run-report.json into <dir>.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "../../../backend");
const require = createRequire(path.join(BACKEND, "index.js"));
const Papa = require("papaparse");

const DIR = process.argv[2];
if (!DIR) { console.error("usage: dry-run.mjs <converter output dir>"); process.exit(2); }
const BASE = process.env.OTS_API_BASE || "http://127.0.0.1:5000";

// ─── safety ────────────────────────────────────────────────────────────────
require("dotenv").config({ path: path.join(BACKEND, ".env"), quiet: true });
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) {
  console.error("REFUSING: backend/.env DATABASE_URL is not localhost."); process.exit(2);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error(`REFUSING: API base ${BASE} is not localhost.`); process.exit(2);
}

const results = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  → got ${JSON.stringify(actual).slice(0, 400)}, expected ${JSON.stringify(expected).slice(0, 200)}`}`);
  return ok;
}
const note = (name, detail) => { results.push({ name, ok: null, detail }); console.log(`  NOTE  ${name}: ${detail}`); };

let TOKEN = null, SLUG = null, OUTLET = null;
async function call(method, p, { json, form, allowFail = false } = {}) {
  const sep = p.includes("?") ? "&" : "?";
  const headers = {
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(OUTLET ? { "x-outlet-id": String(OUTLET) } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
  const r = await fetch(`${BASE}${p}${sep}tenant=${SLUG}`, { method, headers, body: json ? JSON.stringify(json) : form });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : null; } catch { j = { _raw: text.slice(0, 300) }; }
  if (!r.ok && !allowFail) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return allowFail ? { status: r.status, body: j } : j;
}
const idOf = (r) => r?.id ?? r?.supplier?.id ?? r?.brand?.id ?? r?.category?.id;
const listOf = (j) => (Array.isArray(j) ? j : j?.outlets || j?.rows || j?.data || []);
const readCsv = (f) => Papa.parse(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^﻿/, ""), { header: true, dynamicTyping: false, skipEmptyLines: "greedy" }).data;

async function main() {
  const t0 = Date.now();
  const products = readCsv("ipos-products.csv");
  const tree = readCsv("ipos-category-tree.csv");
  const summary = JSON.parse(fs.readFileSync(path.join(DIR, "ipos-summary.json"), "utf8"));
  console.log(`converter output: ${products.length} items, ${tree.length} categories, ${summary.suppliers.length} suppliers, ${summary.brands.length} brands`);

  // 1. a throwaway shop, as shop-day.mjs makes one
  console.log("\n━━ 1. Throwaway shop");
  const db = require("./db-pg");
  const masterDb = require("./master-db-pg");
  await masterDb.init(db);
  const { provision } = require("./tenant-provisioner-pg");
  SLUG = `otsipos_${Date.now().toString(36)}`;
  const res = await provision(db, { slug: SLUG, name: "One Toy Store (iPOS dry run)", ownerEmail: `${SLUG}@example.invalid`, pin: "0000", timezone: "Asia/Karachi" });
  await masterDb.query(
    `UPDATE tenants SET plan='pro', max_outlets=5, max_employees=50, max_products=100000,
       payment_status='active', email_verified_at=NOW() WHERE id=$1`, [res.tenantId]);
  const setup = await call("POST", "/api/setup/complete", { json: {
    token: res.setupToken, company_name: "One Toy Store (iPOS dry run)", country: "Pakistan", country_code: "PK",
    city: "Lahore", timezone: "Asia/Karachi", currency_symbol: "Rs", currency_code: "PKR",
    is_gst_registered: false, tax_mode: "none", outlet_name: "Packages Mall", admin_name: "Owner",
    admin_pin: "4321", industry_type: "general_retail",
  } });
  TOKEN = setup?.auth?.token || setup?.token;
  OUTLET = listOf(await call("GET", "/api/outlets"))[0].id;
  const storeRoom = idOf(await call("POST", "/api/outlets", { json: { name: "Store Room", address: "Back office" } }));
  console.log(`  tenant ${SLUG}: Packages Mall = outlet ${OUTLET}, Store Room = outlet ${storeRoom}; login Owner / 4321`);

  // Setup seeds 5 "(Sample)" products (100 units each) and their categories into
  // every new shop (seeds/preset-seed-data.js). The app's delete only hides a
  // product and keeps its stock, and a category with hidden products can't be
  // deleted, so in a brand-new shop (no sales yet) remove them outright. The same
  // step is needed on the real shop before its import.
  const pre = await db.getClient();
  try {
    await pre.query(`SET search_path TO tenant_${SLUG}, public`);
    await pre.query("BEGIN");
    const sold = (await pre.query("SELECT COUNT(*)::int AS n FROM sales")).rows[0].n;
    if (sold) throw new Error(`refusing to remove samples: the shop already has ${sold} sale(s)`);
    const { rows: samples } = await pre.query("SELECT id, category_id FROM products WHERE name LIKE '%(Sample)'");
    const ids = samples.map((s) => s.id);
    const catIds = [...new Set(samples.map((s) => s.category_id).filter(Boolean))];
    await pre.query("DELETE FROM outlet_stock WHERE product_id = ANY($1::int[])", [ids]);
    await pre.query("DELETE FROM products WHERE id = ANY($1::int[])", [ids]);
    const cats = await pre.query(
      "DELETE FROM categories c WHERE c.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id) RETURNING name",
      [catIds]);
    await pre.query("COMMIT");
    console.log(`  removed ${ids.length} sample products and ${cats.rowCount} sample categories (${cats.rows.map((r) => r.name).join(", ")})`);
  } catch (e) {
    await pre.query("ROLLBACK");
    throw e;
  } finally {
    pre.release();
  }

  // 2. what the importer looks up by name
  console.log("\n━━ 2. Category tree, brands, suppliers");
  const groupId = {};
  for (const { group, category } of tree) {
    if (!groupId[group]) groupId[group] = idOf(await call("POST", "/api/categories", { json: { name: group } }));
    await call("POST", "/api/categories", { json: { name: category, parent_id: groupId[group] } });
  }
  for (const b of summary.brands) await call("POST", "/api/brands", { json: { name: b } });
  for (const s of summary.suppliers) await call("POST", "/api/suppliers", { json: { name: s } });
  console.log(`  ${Object.keys(groupId).length} groups + ${tree.length} categories, ${summary.brands.length} brands, ${summary.suppliers.length} suppliers`);

  // 3. preview, then import into Packages Mall
  console.log("\n━━ 3. Import");
  const file = fs.readFileSync(path.join(DIR, "ipos-products.csv"));
  const form = () => { const f = new FormData(); f.append("file", new Blob([file], { type: "text/csv" }), "ipos-products.csv"); return f; };
  let t = Date.now();
  const pv = await call("POST", "/api/import/products?preview=1", { form: form() });
  note("preview time", `${((Date.now() - t) / 1000).toFixed(1)}s`);
  const pvErrors = pv.rows.filter((r) => r._errors.length);
  check("preview: every row valid", { valid: pv.valid, errors: pv.errors }, { valid: products.length, errors: 0 });
  if (pvErrors.length) console.log(pvErrors.slice(0, 10).map((r) => `row ${r._row}: ${r._errors.join("; ")}`).join("\n"));
  check("preview: no SKU was made up (every item keeps its iPOS code)", pv.rows.filter((r) => r._sku_generated).length, 0);
  t = Date.now();
  const imp = await call("POST", "/api/import/products?already_labelled=1", { form: form() });
  note("import time", `${((Date.now() - t) / 1000).toFixed(1)}s`);
  check("import: every row imported, no errors", { imported: imp.imported, errors: imp.errors.length }, { imported: products.length, errors: 0 });

  // 4. read it all back
  console.log("\n━━ 4. Check every item against the converter");
  const client = await db.getClient();
  await client.query(`SET search_path TO tenant_${SLUG}, public`);
  const { rows: got } = await client.query(`
    SELECT p.sku, p.name, p.barcode, p.price::float AS price, p.cost_price::float AS cost, c.name AS category,
           pc.name AS grp, b.name AS brand, s.name AS supplier, p.status,
           COALESCE((SELECT SUM(quantity) FROM outlet_stock WHERE product_id = p.id AND outlet_id = $1), 0)::int AS pm,
           COALESCE((SELECT SUM(quantity) FROM outlet_stock WHERE product_id = p.id AND outlet_id = $2), 0)::int AS sr
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
      LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.deleted_at IS NULL`, [OUTLET, storeRoom]);
  const bySku = new Map(got.map((r) => [r.sku, r]));
  check("item count", got.length, products.length);
  const groupOf = Object.fromEntries(tree.map((r) => [r.category, r.group]));
  const diffs = [];
  for (const p of products) {
    const g = bySku.get(p.sku);
    if (!g) { diffs.push({ sku: p.sku, missing: true }); continue; }
    const want = { name: p.name, price: Number(p.selling_price), cost: Number(p.cost_price), category: p.category,
      grp: groupOf[p.category], brand: p.brand || null, supplier: p.supplier || null, pm: Number(p.stock_quantity), sr: 0, status: "active" };
    const have = { name: g.name, price: g.price, cost: g.cost, category: g.category, grp: g.grp, brand: g.brand,
      supplier: g.supplier, pm: g.pm, sr: g.sr, status: g.status };
    if (JSON.stringify(want) !== JSON.stringify(have)) diffs.push({ sku: p.sku, want, have });
  }
  check("every item: name, price, cost, category (+group), brand, supplier, Packages Mall stock, Store Room 0", diffs.slice(0, 5), []);
  if (diffs.length) note("items that differ", String(diffs.length));
  const sum = (f) => Math.round(got.reduce((a, r) => a + f(r), 0) * 100) / 100;
  check("units in Packages Mall", sum((r) => r.pm), summary.import_units);
  check("stock value at cost", sum((r) => r.pm * r.cost), summary.import_cost_value);
  check("stock value at selling price", sum((r) => r.pm * r.price), summary.import_sale_value);
  check("units in Store Room", sum((r) => r.sr), 0);
  const below = readCsv("ipos-below-zero.csv");
  check("below-zero items came in at 0", below.filter((b) => bySku.get(b.code)?.pm !== 0).map((b) => b.code), []);
  const lr = (await client.query(
    "SELECT COUNT(*) FILTER (WHERE cleared_at IS NULL)::int AS open, COUNT(*) FILTER (WHERE cleared_how = 'already_labelled')::int AS cleared FROM label_reprints")).rows[0];
  check("'already have labels' ticked: nothing open on Labels to reprint, every item marked already labelled", lr, { open: 0, cleared: products.length });
  const cats = (await client.query("SELECT COUNT(*)::int AS n FROM categories")).rows[0].n;
  check("categories = only the approved tree (groups + categories)", cats, new Set(tree.map((r) => r.group)).size + tree.length);
  const mv = (await client.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(qty_change),0)::int AS q FROM stock_movements")).rows[0];
  note("History tab stock lines written", `${mv.n} lines, ${mv.q} units`);
  client.release();

  // 5. the till finds items by their iPOS code
  console.log("\n━━ 5. Till scan");
  const scanSample = ["0107", "001", "027084120134", "6939143104280.", "X000UO7NQD", "2011009434138",
    products.find((p) => p.sku.length === 13 && p.sku.startsWith("2"))?.sku].filter(Boolean);
  for (const code of [...new Set(scanSample)]) {
    const want = products.find((p) => p.sku === code);
    if (!want) continue;
    const r = await call("GET", `/api/products/scan/${encodeURIComponent(code)}?outlet_id=${OUTLET}`, { allowFail: true });
    const p = r.body?.product || r.body;
    check(`scan ${code} → ${want.name}`, { status: r.status, name: p?.name, price: Number(p?.price) }, { status: 200, name: want.name, price: Number(want.selling_price) });
  }

  const fails = results.filter((r) => r.ok === false).length;
  console.log(`\n══ ${results.filter((r) => r.ok).length} passed, ${fails} failed — tenant ${SLUG} — ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  fs.writeFileSync(path.join(DIR, "dry-run-report.json"), JSON.stringify({ tenant: SLUG, results, diffs: diffs.slice(0, 200) }, null, 1));
  await db.end().catch(() => {});
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("CRASH:", e.stack); process.exit(1); });
