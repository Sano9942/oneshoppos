#!/usr/bin/env node
/**
 * shopify-sync-live.cjs — prove on the REAL multi-tenant backend (not the test
 * harness) that a stock move in SanoPOS queues its Shopify update (blocker 2h),
 * and that the Reconciliation endpoints answer. LOCAL ONLY.
 *
 * Usage (backend running, banner says LOCAL DB, after a shop-day run):
 *   node tools/onetoystore-pilot/shopify-sync-live.cjs <otsacc_* tenant>
 *
 * It gives the throwaway tenant a Shopify connection to a domain that cannot
 * exist (ots-fake.invalid), so nothing ever reaches a real Shopify. Sends to
 * Shopify therefore FAIL on purpose; what is checked is that SanoPOS queues them.
 */
const path = require("path");
const backend = path.join(__dirname, "..", "..", "backend");
require(path.join(backend, "node_modules", "dotenv")).config({ path: path.join(backend, ".env") });
const { Client } = require(path.join(backend, "node_modules", "pg"));

const API = process.env.OTS_API_BASE || "http://127.0.0.1:5000";
const slug = process.argv[2];
if (!slug || !/^otsacc_[a-z0-9_]+$/.test(slug)) {
  console.error("usage: shopify-sync-live.cjs <otsacc_* tenant slug>");
  process.exit(2);
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) {
  console.error("Refusing: DATABASE_URL is not a local database.");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function call(method, url, token, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const schema = `tenant_${slug}`;
  await db.query(`SET search_path TO ${schema}, public`);

  // Fake Shopify link for this throwaway tenant.
  await db.query("UPDATE shopify_connections SET is_active = false");
  await db.query(
    `INSERT INTO shopify_connections (shop_domain, access_token, api_version, is_active, webhook_secret)
     VALUES ('ots-fake.invalid', 'shpat_fake', '2025-10', true, 'whsec_fake')`,
  );
  const { rows: outlets } = await db.query("SELECT id FROM outlets ORDER BY id LIMIT 2");
  const [o1, o2] = outlets.map((o) => o.id);
  const { rows: [prod] } = await db.query(
    `SELECT p.id FROM products p JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = $1
      WHERE os.quantity >= 5 AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)
      ORDER BY p.id LIMIT 1`,
    [o1],
  );
  await db.query("DELETE FROM shopify_location_map");
  await db.query("INSERT INTO shopify_location_map (outlet_id, shopify_location_id, shopify_location_name) VALUES ($1, 'gid://shopify/Location/1', 'Shop')", [o1]);
  await db.query("DELETE FROM shopify_product_map WHERE product_id = $1", [prod.id]);
  await db.query(
    `INSERT INTO shopify_product_map (product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active)
     VALUES ($1, 'gid://shopify/Product/1', 'gid://shopify/ProductVariant/1', 'gid://shopify/InventoryItem/1', true)`,
    [prod.id],
  );
  const { rows: [{ max: before }] } = await db.query("SELECT COALESCE(MAX(id), 0) AS max FROM external_sync_events");

  const login = await call("POST", "/api/auth/mt-login", null, { tenant_slug: slug, username: "Owner", password: "4321" });
  const token = login.body?.token || login.body?.accessToken || login.body?.auth?.token;
  check(login.status === 200 && token, "log in as Owner", `HTTP ${login.status}`);
  if (!token) process.exit(1);

  // Two transfers of the same item: each must queue its own Shopify change.
  for (let i = 0; i < 2; i++) {
    const t = await call("POST", "/api/transfers", token, { product_id: prod.id, from_outlet_id: o1, to_outlet_id: o2, quantity: 1 });
    check(t.status === 200, `transfer ${i + 1}`, `HTTP ${t.status}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const { rows: ev } = await db.query(
    "SELECT id, status, idempotency_key, payload FROM external_sync_events WHERE id > $1 AND direction = 'outbound' ORDER BY id",
    [before],
  );
  const outs = ev.filter((e) => JSON.parse(e.payload || "{}").reason === "transfer_out");
  check(outs.length === 2, "both transfers queued a Shopify change for the shop (2h + 2f)", `${outs.length} queued`);

  // The Reconciliation endpoints answer (Shopify can't be reached: expect a clean result, not a hang).
  const chk = await call("POST", "/api/integrations/shopify/reconciliation", token, {});
  check(chk.status === 200 && chk.body?.errors >= 1, "'Check now' answers; unreachable Shopify is reported as an error row", `HTTP ${chk.status}, errors ${chk.body?.errors}`);
  const { rows: [row] } = await db.query("SELECT status, external_qty FROM inventory_reconciliation WHERE product_id = $1", [prod.id]);
  check(row?.status === "error" && row.external_qty === null, "unreadable Shopify count is blank, not 0", JSON.stringify(row));
  const pend = await call("POST", "/api/integrations/shopify/sync/process-pending", token, { limit: 5 });
  check(pend.status === 200, "'process pending' answers", `HTTP ${pend.status}`);
  const set = await call("POST", "/api/integrations/shopify/stock/set-to-pos", token, {});
  check(set.status === 200 && set.body?.set === 0, "'Set Shopify to SanoPOS counts' answers and sets nothing it couldn't read", `HTTP ${set.status}, set ${set.body?.set}`);

  // Leave the throwaway tenant without an active Shopify link.
  await db.query("UPDATE shopify_connections SET is_active = false");
  await db.end();
  console.log(`\n══ ${pass} passed, ${fail} failed — tenant ${slug}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
