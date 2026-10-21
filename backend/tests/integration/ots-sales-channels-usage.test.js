/**
 * ots-sales-channels-usage.test.js — One Toy Store pilot (owner, 2026-10-21).
 *
 * The product page's Sales Channels box, Compare-at Price and the "View
 * Storefront" menu link followed the marketplace_integrations switch, which is
 * ON by default for every shop and (as an Integrations card) can't be switched
 * off by the shop. Owner: show them only when a marketplace is actually
 * connected or something is actually published. GET /api/sales-channels/usage
 * answers both, read-only.
 */

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID, CASHIER_ID } = require("../helpers/request");

let app, db, cleanup, productId;
const usage = async (who = ADMIN_ID) => makeRequest(app, who).get("/api/sales-channels/usage");

beforeAll(async () => {
  ({ app, db, cleanup } = await createTestApp({ registerAll: true }));
  await db.query("DELETE FROM channel_publications");
  await db.query("DELETE FROM integration_settings");
  await db.query("DELETE FROM shopify_connections");
  productId = (await db.query("INSERT INTO products (name, price) VALUES ('Usage toy', 100) RETURNING id")).rows[0].id;
});

afterAll(async () => { await cleanup?.(); });

afterEach(async () => {
  await db.query("DELETE FROM channel_publications");
  await db.query("DELETE FROM integration_settings");
  await db.query("DELETE FROM shopify_connections");
});

describe("GET /api/sales-channels/usage", () => {
  it("a shop with nothing connected and nothing published is not using channels", async () => {
    const res = await usage();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marketplace_connected: false, published_products: 0, in_use: false });
  });

  it("a published toy counts (any channel)", async () => {
    const ch = (await db.query("SELECT id FROM sales_channels WHERE code = 'storefront'")).rows[0].id;
    await db.query("INSERT INTO channel_publications (channel_id, product_id, is_published) VALUES ($1, $2, true)", [ch, productId]);
    const res = await usage();
    expect(res.body).toMatchObject({ published_products: 1, in_use: true });
  });

  it("an unpublished row does not count", async () => {
    const ch = (await db.query("SELECT id FROM sales_channels WHERE code = 'storefront'")).rows[0].id;
    await db.query("INSERT INTO channel_publications (channel_id, product_id, is_published) VALUES ($1, $2, false)", [ch, productId]);
    expect((await usage()).body.in_use).toBe(false);
  });

  it("an active marketplace connection counts; a saved but inactive one does not", async () => {
    await db.query("INSERT INTO integration_settings (provider, category, is_active) VALUES ('daraz', 'marketplace', false)");
    expect((await usage()).body.marketplace_connected).toBe(false);
    await db.query("UPDATE integration_settings SET is_active = true WHERE provider = 'daraz'");
    expect((await usage()).body).toMatchObject({ marketplace_connected: true, in_use: true });
  });

  it("an SMS or payment provider is not a marketplace", async () => {
    await db.query("INSERT INTO integration_settings (provider, category, is_active) VALUES ('twilio', 'sms', true)");
    expect((await usage()).body.marketplace_connected).toBe(false);
  });

  it("a connected Shopify or WooCommerce store counts", async () => {
    await db.query("INSERT INTO shopify_connections (shop_domain, access_token, is_active) VALUES ('ots.myshopify.com', 'x', true)");
    expect((await usage()).body.marketplace_connected).toBe(true);
    await db.query("DELETE FROM shopify_connections");
    await db.query("INSERT INTO integration_settings (provider, store_url) VALUES ('woocommerce', 'https://shop.example')");
    expect((await usage()).body.marketplace_connected).toBe(true);
  });

  it("needs a catalogue permission (a cashier gets 403)", async () => {
    expect((await usage(CASHIER_ID)).status).toBe(403);
  });
});
