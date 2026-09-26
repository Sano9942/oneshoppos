// One Toy Store pilot, blocker 1 — end-to-end proof that a Shopify order
// webhook reaches the REAL local backend (multi-tenant, auth wall live) and
// moves shop stock. Local DB only; fake shop domain; never calls Shopify.
//
//   1. start the backend (banner must say LOCAL DB)
//   2. OTS_API_BASE=http://127.0.0.1:5000 node tools/onetoystore-pilot/shop-day.mjs --dump
//   3. node tools/onetoystore-pilot/online-orders.cjs <otsacc_* tenant printed by step 2>
const path = require("path");
const B = path.resolve(__dirname, "../../backend");
require(path.join(B, "node_modules/dotenv")).config({ path: path.join(B, ".env") });
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")) throw new Error("not a local DB");
const { Client } = require(path.join(B, "node_modules/pg"));
const crypto = require("crypto");
const { encryptShopifySecret } = require(path.join(B, "shopify/crypto"));

const SLUG = process.argv[2];
const API = "http://127.0.0.1:5000";
const SHOP = "ots-local-proof.myshopify.com";
const SECRET = "local_proof_whsec";
const results = [];
const check = (label, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`); };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`SET search_path = tenant_${SLUG}`);
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  const [outlet] = await q("SELECT id FROM outlets ORDER BY id LIMIT 1");
  const [plain] = await q(`SELECT p.id, p.name, os.quantity FROM products p JOIN outlet_stock os ON os.product_id = p.id AND os.outlet_id = $1
                           WHERE COALESCE(p.has_variants,false) = false AND os.quantity > 3 ORDER BY p.id LIMIT 1`, [outlet.id]);
  const [variant] = await q(`SELECT v.id, v.product_id, v.sku, vos.quantity FROM product_variants v
                             JOIN variant_outlet_stock vos ON vos.variant_id = v.id AND vos.outlet_id = $1
                             WHERE vos.quantity >= 2 ORDER BY v.id LIMIT 1`, [outlet.id]);

  await q("UPDATE shopify_connections SET is_active = false");
  await q(`INSERT INTO shopify_connections (shop_domain, access_token, webhook_secret, default_location_id, is_active)
           VALUES ($1, $2, $3, 'gid-loc-1', true)
           ON CONFLICT (shop_domain) DO UPDATE SET is_active = true, webhook_secret = EXCLUDED.webhook_secret`,
    [SHOP, encryptShopifySecret("shpat_fake"), encryptShopifySecret(SECRET)]);
  await q("INSERT INTO shopify_location_map (outlet_id, shopify_location_id) VALUES ($1, 'gid-loc-1') ON CONFLICT DO NOTHING", [outlet.id]);
  await q(`INSERT INTO shopify_product_map (product_id, variant_id, shopify_product_id, shopify_variant_id, is_active)
           VALUES ($1, NULL, 'sp-plain', 'sv-plain', true), ($2, $3, 'sp-var', 'sv-var', true)
           ON CONFLICT DO NOTHING`, [plain.id, variant.product_id, variant.id]);

  const plainStock = async () => Number((await q("SELECT quantity FROM outlet_stock WHERE product_id=$1 AND outlet_id=$2", [plain.id, outlet.id]))[0].quantity);
  const varStock = async () => Number((await q("SELECT quantity FROM variant_outlet_stock WHERE variant_id=$1 AND outlet_id=$2", [variant.id, outlet.id]))[0].quantity);

  let n = 0;
  const send = async (payload, { topic = "orders/create", slug = SLUG, secret = SECRET } = {}) => {
    const body = JSON.stringify(payload);
    const hmac = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    const res = await fetch(`${API}/api/integrations/shopify/webhooks/orders/${slug}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",           // no Authorization header: Shopify sends none
        "x-shopify-webhook-id": `proof-${Date.now()}-${++n}`,
        "x-shopify-shop-domain": SHOP,
        "x-shopify-topic": topic,
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-triggered-at": new Date().toISOString(),
      },
      body,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const id = Date.now();
  const order = {
    id, name: `#PROOF${id % 10000}`, currency: "PKR", financial_status: "pending",
    created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 60000).toISOString(), cancelled_at: null, refunds: [],
    line_items: [
      { id: 1, variant_id: "sv-plain", sku: "", title: plain.name, quantity: 2, price: "500" },
      { id: 2, variant_id: "sv-var", sku: "", title: variant.sku, quantity: 1, price: "500" },
    ],
  };

  const p0 = await plainStock(), v0 = await varStock();
  console.log(`start: ${plain.name} = ${p0}, variant ${variant.sku} = ${v0}, outlet ${outlet.id}`);

  const r1 = await send(order);
  check("COD order webhook with no login is accepted (was 401 AUTH_REQUIRED)", r1.status === 200, `HTTP ${r1.status} ${JSON.stringify(r1.body?.stock_policy?.action || r1.body)}`);
  check("plain item: shop stock down by 2", (await plainStock()) === p0 - 2, `${await plainStock()}`);
  check("variant: its own shop stock down by 1", (await varStock()) === v0 - 1, `${await varStock()}`);

  const r2 = await send({ ...order, updated_at: new Date(Date.now() - 30000).toISOString() }, { topic: "orders/updated" });
  check("orders/updated for the same order doesn't take stock again", r2.status === 200 && (await plainStock()) === p0 - 2, `${await plainStock()}`);

  const r3 = await send({ ...order, cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { topic: "orders/cancelled" });
  check("cancel puts the stock back", r3.status === 200 && (await plainStock()) === p0 && (await varStock()) === v0, `${await plainStock()} / ${await varStock()}`);

  const bad = await send({ ...order, id: id + 1 }, { secret: "wrong" });
  check("forged signature rejected", bad.status === 401, `HTTP ${bad.status}`);
  const unknown = await send({ ...order, id: id + 2 }, { slug: "no_such_shop_zz" });
  check("unknown shop in the address → 404", unknown.status === 404, `HTTP ${unknown.status}`);

  const setup = await q("SELECT count(*)::int AS n FROM web_order_stock");
  console.log(`web_order_stock rows now: ${setup[0].n} (0 expected after cancel)`);

  await c.end();
  const failed = results.filter((r) => !r).length;
  console.log(`\n== ${results.length - failed} passed, ${failed} failed ==`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
