const assert = require("assert");
const {
  verifyConnection,
  fetchShopifyLocations,
  adjustShopifyInventory,
  fetchShopifyVariantCatalog,
  fetchInventoryLevel,
} = require("./shopify/client");
const {
  buildWebhookIdempotencyKey,
  verifyWebhookSignature,
  evaluateWebhookTimestampWindow,
} = require("./shopify/utils");

function createConnection() {
  return {
    shop_domain: "mock-store.myshopify.com",
    access_token: "mock_token",
    api_version: "2025-10",
  };
}

async function withMockedFetch(mockFn, runner) {
  const originalFetch = global.fetch;
  global.fetch = mockFn;
  try {
    await runner();
  } finally {
    global.fetch = originalFetch;
  }
}

async function runClientTests() {
  await withMockedFetch(async (_url, options) => {
    const body = JSON.parse(options.body || "{}");
    const query = String(body.query || "");
    if (query.includes("shop {")) {
      return {
        ok: true,
        json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1", name: "Mock Shop", myshopifyDomain: "mock-store.myshopify.com" } } }),
      };
    }
    if (query.includes("FetchLocations")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            locations: {
              edges: [
                { node: { id: "gid://shopify/Location/10", name: "Main", isActive: true } },
                { node: { id: "gid://shopify/Location/11", name: "Warehouse", isActive: false } },
              ],
            },
          },
        }),
      };
    }
    if (query.includes("AdjustInventory")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            inventoryAdjustQuantities: {
              userErrors: [],
              inventoryAdjustmentGroup: { reason: "correction", changes: [{ name: "available", delta: -1 }] },
            },
          },
        }),
      };
    }
    if (query.includes("FetchVariants")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productVariants: {
              edges: [
                {
                  cursor: "c1",
                  node: {
                    id: "gid://shopify/ProductVariant/501",
                    sku: "SKU-501",
                    barcode: "BC-501",
                    displayName: "Mock Variant",
                    product: { id: "gid://shopify/Product/50", title: "Mock Product" },
                    inventoryItem: { id: "gid://shopify/InventoryItem/9001", sku: "SKU-501" },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      };
    }
    if (query.includes("InventoryLevel")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            inventoryItem: {
              id: "gid://shopify/InventoryItem/9001",
              inventoryLevel: {
                id: "gid://shopify/InventoryLevel/1",
                quantities: [{ name: "available", quantity: 7 }],
              },
            },
          },
        }),
      };
    }
    return { ok: false, status: 400, json: async () => ({ errors: [{ message: "Unknown mock query" }] }) };
  }, async () => {
    const conn = createConnection();
    const shop = await verifyConnection(conn);
    assert.strictEqual(shop.myshopifyDomain, "mock-store.myshopify.com");

    const locations = await fetchShopifyLocations(conn);
    assert.strictEqual(locations.length, 2);
    assert.strictEqual(locations[0].is_active, true);

    const adj = await adjustShopifyInventory(
      conn,
      [{ inventory_item_id: "9001", location_id: "10", delta: -1 }],
      "correction",
    );
    assert.strictEqual(adj.applied, 1);
    assert.strictEqual(adj.userErrors.length, 0);

    const variants = await fetchShopifyVariantCatalog(conn, 5);
    assert.strictEqual(variants.length, 1);
    assert.strictEqual(variants[0].sku, "SKU-501");

    const inv = await fetchInventoryLevel(conn, "9001", "10");
    assert.strictEqual(inv.available, 7);
  });
}

function runWebhookMockTests() {
  const payload = { id: 12345, updated_at: "2026-02-24T10:00:00Z" };
  const key1 = buildWebhookIdempotencyKey({ webhookId: "hook-1", payload });
  const key2 = buildWebhookIdempotencyKey({ webhookId: "", payload, nowMs: 1000 });
  assert.strictEqual(key1, "shopify_webhook_hook-1");
  assert.ok(key2.startsWith("shopify_webhook_order_12345_"));

  const raw = JSON.stringify(payload);
  const crypto = require("crypto");
  const secret = "mock-secret";
  const goodSig = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const okCheck = verifyWebhookSignature({ rawBody: raw, providedHmac: goodSig, webhookSecret: secret });
  assert.strictEqual(okCheck.ok, true);

  const badCheck = verifyWebhookSignature({ rawBody: raw, providedHmac: "bad", webhookSecret: secret });
  assert.strictEqual(badCheck.ok, false);

  const nowMs = Date.parse("2026-02-24T10:10:00Z");
  const replayOk = evaluateWebhookTimestampWindow("2026-02-24T10:05:00Z", nowMs);
  const replayOld = evaluateWebhookTimestampWindow("2026-02-24T09:00:00Z", nowMs);
  assert.strictEqual(replayOk.ok, true);
  assert.strictEqual(replayOld.ok, false);
}

async function run() {
  await runClientTests();
  runWebhookMockTests();
  console.log("shopify_mock_integration_test: all tests passed");
}

run().catch((e) => {
  console.error("shopify_mock_integration_test failed:", e);
  process.exit(1);
});

