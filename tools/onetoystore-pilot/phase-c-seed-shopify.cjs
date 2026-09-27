#!/usr/bin/env node
/**
 * phase-c-seed-shopify.cjs — One Toy Store pilot, Phase C check C-2: put a few
 * test toys on the TEST Shopify store with the same SKUs and barcodes as the
 * local shop-day tenant, so SanoPOS can match and sync them.
 *
 *   node tools/onetoystore-pilot/phase-c-seed-shopify.cjs <otsacc_* tenant> [--renew]
 *
 * It goes through SanoPOS's own Shopify connection for that tenant
 * (shopify/utils.js getActiveShopifyConnection, which renews the 24-hour token),
 * and refuses to run unless that connection is the test store below. It never
 * touches onetoystore.com. Items already on Shopify (matched by SKU) are left
 * alone, so it's safe to run again.
 *
 * Shopify's starting counts are deliberately NOT SanoPOS's (every item starts
 * at 2), so check C-3 ("Set Shopify to SanoPOS counts") has something to fix.
 *
 * --renew marks the saved token as expired first, which proves renewal against
 * the real Shopify (check C-8) and picks up newly approved app permissions.
 */
const path = require("path");
const B = path.resolve(__dirname, "../../backend");
require(path.join(B, "node_modules/dotenv")).config({ path: path.join(B, ".env") });
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "")) {
  console.error("Refusing: DATABASE_URL is not a local database.");
  process.exit(2);
}
const { Client } = require(path.join(B, "node_modules/pg"));
const { getActiveShopifyConnection } = require(path.join(B, "shopify/utils"));
const { decryptShopifySecret } = require(path.join(B, "shopify/crypto"));

const TEST_STORE = "ots-sanopos-test.myshopify.com";
const SHOPIFY_START_QTY = 2;
const SLUG = process.argv[2];
const RENEW = process.argv.includes("--renew");
if (!SLUG || !/^otsacc_[a-z0-9_]+$/.test(SLUG)) {
  console.error("usage: phase-c-seed-shopify.cjs <otsacc_* tenant> [--renew]");
  process.exit(2);
}

// Plain items by SanoPOS SKU; the variant product by its variant SKUs.
const PLAIN_SKUS = ["OTS-HW5", "OTS-BARBIE", "OTS-LEGOP", "OTS-RUBIK"];
const VARIANT_PRODUCT_SKU = "OTS-HWS";
const OPTION = "Model";
const VARIANT_NAMES = { "HW-TWINMILL": "Twin Mill", "HW-BONESHAKER": "Bone Shaker", "HW-DEORA": "Deora" };

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`SET search_path = tenant_${SLUG}`);
  const db = { query: (sql, p) => c.query(sql, p) };
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  try {
    if (RENEW) {
      await q("UPDATE shopify_connections SET access_token_expires_at = NOW() - INTERVAL '1 minute' WHERE is_active = true");
      console.log("Marked the saved token as expired (forces a renewal).");
    }
    const before = (await q("SELECT access_token_expires_at FROM shopify_connections WHERE is_active = true"))[0];
    const conn = await getActiveShopifyConnection(db, decryptShopifySecret);
    if (!conn) throw new Error(`tenant ${SLUG} has no active Shopify connection`);
    if (String(conn.shop_domain).toLowerCase() !== TEST_STORE) {
      throw new Error(`Refusing: this tenant is connected to ${conn.shop_domain}, not the test store ${TEST_STORE}`);
    }
    const after = (await q("SELECT access_token_expires_at, last_error FROM shopify_connections WHERE is_active = true"))[0];
    if (RENEW) {
      const renewed = new Date(after.access_token_expires_at) > new Date(before.access_token_expires_at);
      console.log(`${renewed ? "PASS" : "FAIL"}  token renewed against the real Shopify: now valid until ${new Date(after.access_token_expires_at).toISOString()}${after.last_error ? ` (last_error: ${after.last_error})` : ""}`);
      if (!renewed) process.exitCode = 1;
    }

    const gql = async (query, variables = {}) => {
      const res = await fetch(`https://${TEST_STORE}/admin/api/${conn.api_version}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.access_token },
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
      return json.data;
    };

    const scopes = (await gql("{ currentAppInstallation { accessScopes { handle } } }"))
      .currentAppInstallation.accessScopes.map((s) => s.handle);
    console.log(`App permissions on the store: ${scopes.join(", ")}`);
    if (!scopes.includes("write_products")) {
      throw new Error("The app doesn't have write_products on the store yet: release the new version and approve it on ots-sanopos-test, then run again with --renew");
    }
    const { locations } = await gql("{ locations(first: 5) { nodes { id name } } }");
    const location = locations.nodes[0];
    console.log(`Shopify location: ${location.name} (${location.id})`);

    const onShopify = async (sku) =>
      (await gql(`query($q: String!) { productVariants(first: 1, query: $q) { nodes { id product { title } } } }`, { q: `sku:${sku}` }))
        .productVariants.nodes[0] || null;

    const variantInput = (v, optionValue) => ({
      optionValues: [{ optionName: optionValue ? OPTION : "Title", name: optionValue || "Default Title" }],
      price: Number(v.price),
      barcode: v.barcode || null,
      inventoryItem: { sku: v.sku, tracked: true },
      inventoryQuantities: [{ locationId: location.id, name: "available", quantity: SHOPIFY_START_QTY }],
    });
    const create = async (input) => {
      const d = await gql(
        `mutation($input: ProductSetInput!) { productSet(synchronous: true, input: $input) {
           product { id title variants(first: 10) { nodes { sku inventoryQuantity } } }
           userErrors { field message } } }`,
        { input: { status: "ACTIVE", vendor: "One Toy Store test", ...input } },
      );
      if (d.productSet.userErrors.length) throw new Error(JSON.stringify(d.productSet.userErrors));
      return d.productSet.product;
    };

    for (const sku of PLAIN_SKUS) {
      const [p] = await q("SELECT name, sku, barcode, price FROM products WHERE sku = $1", [sku]);
      if (!p) { console.log(`skip ${sku}: not in the SanoPOS tenant`); continue; }
      const existing = await onShopify(sku);
      if (existing) { console.log(`already on Shopify: ${sku} (${existing.product.title})`); continue; }
      const made = await create({
        title: p.name,
        productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
        variants: [variantInput(p)],
      });
      console.log(`created ${made.title}: ${made.variants.nodes.map((v) => `${v.sku}=${v.inventoryQuantity}`).join(", ")}`);
    }

    const [vp] = await q("SELECT id, name FROM products WHERE sku = $1", [VARIANT_PRODUCT_SKU]);
    const variants = vp ? await q("SELECT sku, barcode, price FROM product_variants WHERE product_id = $1 ORDER BY id", [vp.id]) : [];
    const wanted = variants.filter((v) => VARIANT_NAMES[v.sku]);
    if (!wanted.length) {
      console.log(`skip ${VARIANT_PRODUCT_SKU}: variants not in the SanoPOS tenant`);
    } else if (await onShopify(wanted[0].sku)) {
      console.log(`already on Shopify: ${vp.name}`);
    } else {
      const made = await create({
        title: vp.name,
        productOptions: [{ name: OPTION, values: wanted.map((v) => ({ name: VARIANT_NAMES[v.sku] })) }],
        variants: wanted.map((v) => variantInput(v, VARIANT_NAMES[v.sku])),
      });
      console.log(`created ${made.title}: ${made.variants.nodes.map((v) => `${v.sku}=${v.inventoryQuantity}`).join(", ")}`);
    }
    console.log("Done. Every item starts at", SHOPIFY_START_QTY, "on Shopify.");
  } catch (err) {
    console.error("FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
