/**
 * ots-shopify-mappings.test.js — One Toy Store pilot, Phase C (D30).
 *
 * "Generate Suggestions" on the Shopify Mappings tab matches SanoPOS items to
 * Shopify items. It compared a variant's barcode as NULL (the query selected
 * NULL for it) and never looked at a plain item's SKU, so a variant could only
 * match by SKU and a plain item only by barcode. One Toy Store has plain items
 * with a SKU and no barcode. The Shopify catalogue here is a fake.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, cleanup;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);

// What fetchShopifyVariantCatalog returns for the store.
const catalog = [
  { product_id: "sp-1", variant_id: "sv-plain-sku", inventory_item_id: "ii-1", sku: "D30-PLAIN-SKU", barcode: "", display_name: "Puzzle" },
  { product_id: "sp-2", variant_id: "sv-plain-bc", inventory_item_id: "ii-2", sku: "", barcode: "D30BC0001", display_name: "Kite" },
  { product_id: "sp-3", variant_id: "sv-var-bc", inventory_item_id: "ii-3", sku: "", barcode: "D30VARBC01", display_name: "Car - Red" },
  { product_id: "sp-3", variant_id: "sv-var-sku", inventory_item_id: "ii-4", sku: "D30-CAR-BLUE", barcode: "", display_name: "Car - Blue" },
  // Shares the parent product's barcode: a variant must never match on its parent's barcode.
  { product_id: "sp-9", variant_id: "sv-parent-bc", inventory_item_id: "ii-9", sku: "", barcode: "D30PARENT", display_name: "Wrong" },
];

let plainSku, plainBc, carProduct, red, blue;
beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({
    registerAll: true,
    deps: { fetchShopifyVariantCatalog: async () => catalog },
  }));
  await db.query(
    `INSERT INTO shopify_connections (shop_domain, access_token, api_version, is_active)
     VALUES ('ots-mapping-fake.myshopify.com', 'shpat_fake', '2026-07', true)`,
  );
  const mk = async (name, sku, barcode, hasVariants = false) =>
    (await one(
      "INSERT INTO products (name, sku, barcode, price, cost_price, stock, has_variants) VALUES ($1, $2, $3, 100, 50, 0, $4) RETURNING id",
      [name, sku, barcode, hasVariants],
    )).id;
  plainSku = await mk("D30 Puzzle", "D30-PLAIN-SKU", null);
  plainBc = await mk("D30 Kite", null, "D30BC0001");
  carProduct = await mk("D30 Car", "D30-CAR", "D30PARENT", true);
  red = (await one("INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock) VALUES ($1, 'D30-CAR-RED', 'D30VARBC01', 100, 50, 0) RETURNING id", [carProduct])).id;
  blue = (await one("INSERT INTO product_variants (product_id, sku, barcode, price, cost_price, stock) VALUES ($1, 'D30-CAR-BLUE', NULL, 100, 50, 0) RETURNING id", [carProduct])).id;
});

afterAll(async () => {
  if (cleanup) await cleanup();
});

describe("D30 — Generate Suggestions matches every kind of item", () => {
  let suggestions;
  const find = (productId, variantId = null) =>
    suggestions.filter((s) => s.product_id === productId && (s.variant_id || null) === variantId);

  beforeAll(async () => {
    const res = await admin().post("/api/integrations/mappings/products/auto-live").send({});
    expect(res.status).toBe(200);
    suggestions = res.body.suggestions;
  });

  it("a plain item with a SKU and no barcode matches by SKU", () => {
    expect(find(plainSku)).toMatchObject([{ shopify_variant_id: "sv-plain-sku", confidence: "exact_sku" }]);
  });

  it("a plain item matches by barcode", () => {
    expect(find(plainBc)).toMatchObject([{ shopify_variant_id: "sv-plain-bc", confidence: "exact_barcode" }]);
  });

  it("a variant matches by its own barcode", () => {
    expect(find(carProduct, red)).toMatchObject([{ shopify_variant_id: "sv-var-bc", confidence: "exact_barcode" }]);
  });

  it("a variant with no barcode matches by its SKU, never by the parent's barcode", () => {
    expect(find(carProduct, blue)).toMatchObject([{ shopify_variant_id: "sv-var-sku", confidence: "exact_sku" }]);
    expect(suggestions.some((s) => s.shopify_variant_id === "sv-parent-bc")).toBe(false);
  });

  it("applying them links the items, so the next run suggests nothing new for them", async () => {
    const res = await admin().post("/api/integrations/mappings/products/apply-suggestions").send({ suggestions });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(4);
    const again = await admin().post("/api/integrations/mappings/products/auto-live").send({});
    expect(again.body.suggestions).toEqual([]);
  });
});
