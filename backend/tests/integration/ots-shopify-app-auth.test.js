/**
 * ots-shopify-app-auth.test.js — One Toy Store pilot, Phase C.
 *
 * Shopify no longer lets anyone create an admin custom app (the permanent
 * shpat_ token SanoPOS was built for). A Dev Dashboard app has a client ID and
 * secret instead, exchanged for a token that lasts 24 hours (client credentials
 * grant). SanoPOS must store the client ID + secret, get a token when the
 * connection is saved, renew it before it runs out, and accept webhooks signed
 * with the client secret. docs/onetoystore-pilot/PROGRESS.md, Phase C.
 *
 * The network is a fake Shopify: nothing here talks to a real store.
 */

const crypto = require("crypto");
const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");
const shopifyUtils = require("../../shopify/utils");
const { decryptShopifySecret } = require("../../shopify/crypto");

let app, db, cleanup;
const SHOP = "ots-sanopos-fake.myshopify.com";
const CLIENT_ID = "fake-client-id-123";
const CLIENT_SECRET = "fake-client-secret-456";
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const admin = () => makeRequest(app, ADMIN_ID);

// ─── Fake Shopify ──────────────────────────────────────────────────────────
const shop = {
  tokenCalls: [],
  graphqlTokens: [], // the X-Shopify-Access-Token of every Admin API call
  issued: 0,
  refuse: null, // { status, body } makes the token endpoint refuse
  tokenDelayMs: 0,
  reset() {
    this.tokenCalls = [];
    this.graphqlTokens = [];
    this.refuse = null;
    this.tokenDelayMs = 0;
  },
};

async function fakeShopifyFetch(url, init) {
  const u = String(url);
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.endsWith("/admin/oauth/access_token")) {
    const raw = String(init.body || "");
    const params = init.headers?.["Content-Type"]?.includes("json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
    shop.tokenCalls.push({ url: u, params });
    if (shop.tokenDelayMs) await new Promise((r) => setTimeout(r, shop.tokenDelayMs));
    if (shop.refuse) return json(shop.refuse.status, shop.refuse.body);
    if (params.grant_type !== "client_credentials" || params.client_id !== CLIENT_ID || params.client_secret !== CLIENT_SECRET) {
      return json(400, { error: "invalid_client", error_description: "Client authentication failed" });
    }
    shop.issued += 1;
    return json(200, { access_token: `shpat_issued_${shop.issued}`, scope: "read_products,write_inventory", expires_in: 86399 });
  }
  if (u.includes("/admin/api/")) {
    shop.graphqlTokens.push(init.headers["X-Shopify-Access-Token"]);
    return json(200, { data: { shop: { id: "gid://shopify/Shop/1", name: "Fake", myshopifyDomain: SHOP } } });
  }
  throw new Error(`unexpected fetch ${u}`);
}

let realFetch;
const savedKey = process.env.INTEGRATION_SECRET_KEY;
beforeAll(async () => {
  // A key so we can see the client secret is stored encrypted, not in plain text.
  process.env.INTEGRATION_SECRET_KEY = "ots-phase-c-test-key";
  realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    String(url).includes(".myshopify.com/") ? fakeShopifyFetch(url, init) : realFetch(url, init);
  ({ app, db, cleanup } = await createTestApp({
    registerAll: true,
    deps: {
      verifyWebhookSignature: shopifyUtils.verifyWebhookSignature,
      evaluateWebhookTimestampWindow: shopifyUtils.evaluateWebhookTimestampWindow,
      buildWebhookIdempotencyKey: shopifyUtils.buildWebhookIdempotencyKey,
      // The real encryption (the harness default stores secrets as given).
      encryptShopifySecret: require("../../shopify/crypto").encryptShopifySecret,
      decryptShopifySecret,
      // Real client: its calls go to the fake Shopify above.
      verifyConnection: require("../../shopify/client").verifyConnection,
    },
  }));
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env.INTEGRATION_SECRET_KEY;
  else process.env.INTEGRATION_SECRET_KEY = savedKey;
  if (cleanup) await cleanup();
});

beforeEach(() => shop.reset());

const saveApp = (extra = {}) =>
  admin().put("/api/integrations/shopify/config").send({
    shop_domain: SHOP, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, api_version: "2026-04", ...extra,
  });
const row = () => one("SELECT * FROM shopify_connections WHERE shop_domain = $1", [SHOP]);

describe("saving a Dev Dashboard app connection", () => {
  it("wrong credentials are refused with Shopify's reason, and nothing is saved", async () => {
    shop.refuse = { status: 400, body: { error: "shop_not_permitted", error_description: "Client credentials cannot be performed on this shop." } };
    const res = await saveApp();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/shop_not_permitted|cannot be performed/);
    expect(res.body.error).toMatch(/same Shopify organization/);
    expect(await row()).toBeUndefined();
  });

  it("client ID + secret get a token straight away; the secret is stored encrypted", async () => {
    const before = Date.now();
    const res = await saveApp();
    expect(res.status).toBe(200);
    expect(shop.tokenCalls).toHaveLength(1);
    expect(shop.tokenCalls[0].url).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(shop.tokenCalls[0].params).toMatchObject({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET });

    const r = await row();
    expect(r.is_active).toBe(true);
    expect(r.client_id).toBe(CLIENT_ID);
    expect(r.client_secret).not.toContain(CLIENT_SECRET);
    expect(decryptShopifySecret(r.client_secret)).toBe(CLIENT_SECRET);
    expect(decryptShopifySecret(r.access_token)).toBe("shpat_issued_" + shop.issued);
    const expiresIn = new Date(r.access_token_expires_at).getTime() - before;
    expect(expiresIn).toBeGreaterThan(23 * 3600e3);
    expect(expiresIn).toBeLessThanOrEqual(24 * 3600e3);
  });

  it("the settings screen is told it's an app connection, never the secret", async () => {
    const res = await admin().get("/api/integrations/shopify/config");
    expect(res.status).toBe(200);
    expect(res.body.config).toMatchObject({ shop_domain: SHOP, auth_mode: "app", client_id: CLIENT_ID });
    expect(res.body.config.access_token_expires_at).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(res.body)).not.toContain("shpat_issued");
  });

  it("re-saving without re-typing the secret keeps the stored one", async () => {
    const res = await saveApp({ client_secret: "" });
    expect(res.status).toBe(200);
    expect(decryptShopifySecret((await row()).client_secret)).toBe(CLIENT_SECRET);
    expect(shop.tokenCalls[0].params.client_secret).toBe(CLIENT_SECRET);
  });
});

describe("keeping the 24-hour token fresh", () => {
  const expireIn = (ms) =>
    db.query("UPDATE shopify_connections SET access_token_expires_at = $1 WHERE shop_domain = $2", [new Date(Date.now() + ms), SHOP]);

  it("a token with hours left is used as it is", async () => {
    await expireIn(20 * 3600e3);
    const current = decryptShopifySecret((await row()).access_token);
    const res = await admin().post("/api/integrations/shopify/verify");
    expect(res.status).toBe(200);
    expect(shop.tokenCalls).toHaveLength(0);
    expect(shop.graphqlTokens).toEqual([current]);
  });

  it("a token about to run out is renewed before the call, and the new one is saved", async () => {
    await expireIn(10 * 60e3);
    const res = await admin().post("/api/integrations/shopify/verify");
    expect(res.status).toBe(200);
    expect(shop.tokenCalls).toHaveLength(1);
    const fresh = `shpat_issued_${shop.issued}`;
    expect(shop.graphqlTokens).toEqual([fresh]);
    const r = await row();
    expect(decryptShopifySecret(r.access_token)).toBe(fresh);
    expect(new Date(r.access_token_expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600e3);
  });

  it("two callers at once share one renewal", async () => {
    await expireIn(-60e3);
    shop.tokenDelayMs = 150;
    const conns = await Promise.all([
      shopifyUtils.getActiveShopifyConnection(db, decryptShopifySecret),
      shopifyUtils.getActiveShopifyConnection(db, decryptShopifySecret),
    ]);
    expect(shop.tokenCalls).toHaveLength(1);
    expect(conns[0].access_token).toBe(conns[1].access_token);
  });

  it("if Shopify refuses a renewal, the reason is recorded and the old token is still tried", async () => {
    const old = decryptShopifySecret((await row()).access_token);
    await expireIn(5 * 60e3);
    shop.refuse = { status: 401, body: { error: "invalid_client", error_description: "App uninstalled" } };
    const conn = await shopifyUtils.getActiveShopifyConnection(db, decryptShopifySecret);
    expect(conn.access_token).toBe(old);
    expect((await row()).last_error).toMatch(/App uninstalled/);
  });
});

describe("online-order webhooks from a Dev Dashboard app", () => {
  it("are accepted when signed with the app's client secret (no separate webhook secret)", async () => {
    await db.query("UPDATE shopify_connections SET webhook_secret = NULL WHERE shop_domain = $1", [SHOP]);
    const body = JSON.stringify({ id: 99001, name: "#T1", line_items: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const sign = (secret) => crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
    const send = (secret, n) =>
      makeRequest(app)
        .post("/api/integrations/shopify/webhooks/orders-create")
        .set("content-type", "application/json")
        .set("x-shopify-webhook-id", `ots-appauth-${n}-${Date.now()}`)
        .set("x-shopify-shop-domain", SHOP)
        .set("x-shopify-topic", "orders/create")
        .set("x-shopify-hmac-sha256", sign(secret))
        .send(body);

    expect((await send("some-other-secret", 1)).status).toBe(401);
    expect((await send(CLIENT_SECRET, 2)).status).toBe(200);
  });
});

describe("the old permanent-token connection still works", () => {
  it("saving an Admin API token switches back to token mode with no renewal", async () => {
    const res = await admin().put("/api/integrations/shopify/config").send({ shop_domain: SHOP, access_token: "shpat_permanent" });
    expect(res.status).toBe(200);
    const r = await row();
    expect(r.client_id).toBeNull();
    expect(r.client_secret).toBeNull();
    expect(r.access_token_expires_at).toBeNull();
    const conn = await shopifyUtils.getActiveShopifyConnection(db, decryptShopifySecret);
    expect(conn.access_token).toBe("shpat_permanent");
    expect(shop.tokenCalls).toHaveLength(0);
    expect((await admin().get("/api/integrations/shopify/config")).body.config.auth_mode).toBe("token");
  });
});
