/**
 * Batch 6 — Shopify routes (Postgres)
 *
 * Tests: config, health, sync, orders, webhooks, import, mappings, reconciliation
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

// Build stubs that the shopify routes expect
const shopifyStubs = {
  verifyConnection: () => Promise.resolve({ name: "Test Shop", myshopifyDomain: "test.myshopify.com" }),
  fetchShopifyLocations: () => Promise.resolve([{ id: "loc1", name: "Main" }]),
  adjustShopifyInventory: () => Promise.resolve({}),
  fetchShopifyVariantCatalog: () => Promise.resolve([]),
  fetchShopifyProductsFull: () => Promise.resolve([]),
  fetchInventoryLevel: () => Promise.resolve({ available: 10 }),
  fetchInventoryLevelsBatch: () => Promise.resolve([]),
  fetchRecentOrders: () => Promise.resolve([]),
  processPendingShopifyInventoryEvents: (limit, cb) => cb(null, { processed: 0, failed: 0, skipped: 0 }),
  enqueueInventorySyncEvents: (rows, opts, cb) => cb(null, { queued: 0, skipped: 0 }),
  upsertWebOrderFromShopifyPayload: (payload, cb) => cb(null, { web_order_id: 999 }),
  logShopifyEvent: () => {},
  encryptShopifySecret: (v) => v,
  decryptShopifySecret: (v) => v,
  isRetryableInventoryEventStatus: (s) => ["failed", "dead_letter", "retry"].includes(s),
  canApproveReconciliationRequest: () => true,
  buildWebhookIdempotencyKey: ({ webhookId }) => `test_${webhookId || "key"}`,
  verifyWebhookSignature: () => ({ ok: true }),
  evaluateWebhookTimestampWindow: () => ({ ok: true }),
};

const authHeaders = { "x-employee-id": "1" };

describe("Batch 6 — Shopify routes (Postgres)", () => {
  let app, db, cleanup, deps;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

  // Wire shopify routes onto the test app
  const registerShopifyRoutes = require("../../routes/shopify");
  const noopLimiter = (req, res, next) => next();
  const shopifyDeps = {
    db,
    requirePerm: deps.requirePerm,
    requireAnyPerm: deps.requireAnyPerm,
    requireFeature: deps.requireFeature,
    createNotification: () => {},
    webhookLimiter: noopLimiter,
    ...shopifyStubs,
  };
  registerShopifyRoutes(app, shopifyDeps);

  // Seed a Shopify connection
  await db.query(
    `INSERT INTO shopify_connections (id, shop_domain, access_token, api_version, is_active, webhook_secret)
     VALUES (1, 'test.myshopify.com', 'shpat_test_token', '2025-10', true, 'webhook_secret_123')`
  );

  // Seed a location mapping
  await db.query(
    `INSERT INTO shopify_location_map (id, outlet_id, shopify_location_id, shopify_location_name)
     VALUES (1, 1, 'loc_123', 'Main Location')`
  );

  // Seed a product mapping
  await db.query(
    `INSERT INTO shopify_product_map (id, product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active)
     VALUES (1, 1, 'sp_1', 'sv_1', 'sii_1', true)`
  );

  // Seed sync events
  await db.query(
    `INSERT INTO external_sync_events (id, direction, entity_type, idempotency_key, status, created_at, processed_at)
     VALUES (1, 'outbound', 'inventory', 'test_event_1', 'processed', NOW(), NOW())`
  );
  await db.query(
    `INSERT INTO external_sync_events (id, direction, entity_type, idempotency_key, status, created_at)
     VALUES (2, 'outbound', 'inventory', 'test_event_2', 'failed', NOW())`
  );
  await db.query(
    `INSERT INTO external_sync_events (id, direction, entity_type, idempotency_key, status, created_at, processed_at)
     VALUES (3, 'inbound', 'order', 'test_event_3', 'processed', NOW(), NOW())`
  );

  // Seed a sync run
  await db.query(
    `INSERT INTO shopify_sync_runs (id, direction, run_type, status, processed_count, failed_count)
     VALUES (1, 'outbound', 'manual_push', 'completed', 5, 0)`
  );

  // Seed a reconciliation row
  await db.query(
    `INSERT INTO inventory_reconciliation (id, product_id, outlet_id, external_location_id, local_qty, external_qty, diff, status, resolution_status)
     VALUES (1, 1, 1, 'loc_123', 50, 45, 5, 'mismatch', 'open')`
  );

  // Reset sequences
  for (const [table, maxId] of [
    ["shopify_connections", 1], ["shopify_location_map", 1],
    ["shopify_product_map", 1], ["external_sync_events", 3],
    ["shopify_sync_runs", 1], ["inventory_reconciliation", 1],
  ]) {
    await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, true)`, [table, maxId]);
  }
  }, 30000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

// ═══════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Config", () => {
  it("GET /api/integrations/shopify/config returns active connection", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/config")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.config.shop_domain).toBe("test.myshopify.com");
    expect(res.body.config.is_active).toBe(true);
  });

  it("PUT /api/integrations/shopify/config saves connection", async () => {
    const res = await request(app)
      .put("/api/integrations/shopify/config")
      .set(authHeaders)
      .send({ shop_domain: "new-store.myshopify.com", access_token: "shpat_new" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("saved");
  });

  it("PUT /api/integrations/shopify/config requires shop_domain", async () => {
    const res = await request(app)
      .put("/api/integrations/shopify/config")
      .set(authHeaders)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /api/integrations/shopify/disconnect deactivates connection", async () => {
    // Re-activate first
    await db.query("UPDATE shopify_connections SET is_active = true WHERE shop_domain = 'test.myshopify.com'");
    const res = await request(app)
      .post("/api/integrations/shopify/disconnect")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("disconnected");
    // Re-activate for subsequent tests
    await db.query("UPDATE shopify_connections SET is_active = true WHERE shop_domain = 'test.myshopify.com'");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Health", () => {
  it("GET /api/integrations/shopify/status returns connection + event stats", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/status")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.event_stats).toBeDefined();
    expect(Number(res.body.event_stats.total)).toBeGreaterThanOrEqual(3);
    expect(res.body.queue_health).toBeDefined();
    expect(res.body.last_run).toBeDefined();
  });

  it("POST /api/integrations/shopify/verify verifies connection", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/verify")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /api/integrations/shopify/locations/live returns locations", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/locations/live")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.locations).toBeDefined();
  });

  it("GET /api/integrations/shopify/webhooks/setup returns webhook info", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/webhooks/setup")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.callback_url).toContain("webhooks/orders-create");
  });

  it("GET /api/integrations/shopify/uat-checklist returns checklist", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/uat-checklist")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.checklist).toBeDefined();
    expect(res.body.checklist.length).toBe(6);
    // connection should pass
    expect(res.body.checklist[0].pass).toBe(true);
  });

  it("POST /api/integrations/shopify/live-validation runs validation", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/live-validation")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.shop_connection.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Sync", () => {
  it("GET /api/integrations/shopify/events lists events", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/events")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(3);
  });

  it("GET /api/integrations/shopify/events filters by status", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/events?status=failed")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.events.every((e) => e.status === "failed")).toBe(true);
  });

  it("POST retry-event/:id retries a failed event", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/retry-event/2")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("retry");
    // Reset status for other tests
    await db.query("UPDATE external_sync_events SET status = 'failed' WHERE id = 2");
  });

  it("POST retry-event returns 404 for missing event", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/retry-event/9999")
      .set(authHeaders);
    expect(res.status).toBe(404);
  });

  it("POST process-pending processes queued events", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/process-pending")
      .set(authHeaders)
      .send({ limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeDefined();
  });

  it("POST retry-failed requeues failed events", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/retry-failed")
      .set(authHeaders)
      .send({ limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBeDefined();
  });

  it("POST push-inventory runs sync", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/push-inventory")
      .set(authHeaders)
      .send({ rows: [], process_now: false });
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Orders", () => {
  it("POST pull-orders pulls orders (empty list from stub)", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/sync/pull-orders")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Webhooks", () => {
  it("POST webhooks/orders-create processes a webhook", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/webhooks/orders-create")
      .set(authHeaders)
      .set("x-shopify-webhook-id", "wh_test_1")
      .set("x-shopify-shop-domain", "test.myshopify.com")
      .send({ id: "order_1", order_id: "order_1" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("POST webhooks/orders-create rejects duplicate", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/webhooks/orders-create")
      .set(authHeaders)
      .set("x-shopify-webhook-id", "wh_test_1")
      .set("x-shopify-shop-domain", "test.myshopify.com")
      .send({ id: "order_1" });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
  });

  it("POST webhooks/orders-create rejects shop domain mismatch", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/webhooks/orders-create")
      .set(authHeaders)
      .set("x-shopify-webhook-id", "wh_test_new")
      .set("x-shopify-shop-domain", "wrong-shop.myshopify.com")
      .send({ id: "order_2" });
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// IMPORT
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Import", () => {
  it("POST import/products imports products (empty from stub)", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/import/products")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toBe(0);
  });

  it("POST import/inventory syncs inventory", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/import/inventory")
      .set(authHeaders);
    expect(res.status).toBe(200);
    // Should sync at least one mapped product
    expect(res.body.synced).toBeDefined();
  });

  it("DELETE import/products deletes shopify-imported products", async () => {
    // Product 1 is mapped — it will be deleted
    const res = await request(app)
      .delete("/api/integrations/shopify/import/products")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBeDefined();
    // Re-seed the product for subsequent tests
    await db.query(
      `INSERT INTO products (id, barcode, name, price, stock, cost_price, category_id, tax_id)
       VALUES (1, 'PROD-001', 'Widget A', 100, 50, 60, 1, 1)
       ON CONFLICT (id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, 1, 50)
       ON CONFLICT (product_id, outlet_id) DO NOTHING`
    );
    await db.query(
      `INSERT INTO shopify_product_map (id, product_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id, is_active)
       VALUES (1, 1, 'sp_1', 'sv_1', 'sii_1', true)
       ON CONFLICT (id) DO NOTHING`
    );
    // Re-seed reconciliation row (deleted by the cascade cleanup)
    await db.query(
      `INSERT INTO inventory_reconciliation (id, product_id, outlet_id, external_location_id, local_qty, external_qty, diff, status, resolution_status)
       VALUES (1, 1, 1, 'loc_123', 50, 45, 5, 'mismatch', 'open')
       ON CONFLICT (id) DO NOTHING`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MAPPINGS
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Mappings", () => {
  it("GET /api/integrations/mappings/products lists product mappings", async () => {
    const res = await request(app)
      .get("/api/integrations/mappings/products")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.mappings).toBeDefined();
  });

  it("PUT /api/integrations/mappings/products/:id saves mapping", async () => {
    const res = await request(app)
      .put("/api/integrations/mappings/products/1")
      .set(authHeaders)
      .send({
        product_id: 1,
        shopify_product_id: "sp_updated",
        shopify_variant_id: "sv_updated",
        shopify_inventory_item_id: "sii_updated",
        is_active: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("saved");
  });

  it("POST /api/integrations/mappings/products/auto returns candidates", async () => {
    const res = await request(app)
      .post("/api/integrations/mappings/products/auto")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toBeDefined();
  });

  it("POST apply-suggestions applies mappings", async () => {
    const res = await request(app)
      .post("/api/integrations/mappings/products/apply-suggestions")
      .set(authHeaders)
      .send({
        suggestions: [{
          product_id: 2,
          shopify_product_id: "sp_2",
          shopify_variant_id: "sv_2",
          shopify_inventory_item_id: "sii_2",
        }],
      });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
  });

  it("POST apply-suggestions requires suggestions array", async () => {
    const res = await request(app)
      .post("/api/integrations/mappings/products/apply-suggestions")
      .set(authHeaders)
      .send({ suggestions: [] });
    expect(res.status).toBe(400);
  });

  it("GET /api/integrations/mappings/locations lists location mappings", async () => {
    const res = await request(app)
      .get("/api/integrations/mappings/locations")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.mappings.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT /api/integrations/mappings/locations/:outletId saves location mapping", async () => {
    const res = await request(app)
      .put("/api/integrations/mappings/locations/2")
      .set(authHeaders)
      .send({ shopify_location_id: "loc_456", shopify_location_name: "Branch" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("saved");
  });

  it("PUT /api/integrations/mappings/locations requires shopify_location_id", async () => {
    const res = await request(app)
      .put("/api/integrations/mappings/locations/2")
      .set(authHeaders)
      .send({});
    expect(res.status).toBe(400);
  });

  it("GET /api/integrations/mappings/customers lists customer mappings", async () => {
    const res = await request(app)
      .get("/api/integrations/mappings/customers")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.mappings).toBeDefined();
  });

  it("PUT /api/integrations/mappings/customers/:id saves customer mapping", async () => {
    const res = await request(app)
      .put("/api/integrations/mappings/customers/1")
      .set(authHeaders)
      .send({ shopify_customer_id: "sc_1" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("saved");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════

describe("Shopify Reconciliation", () => {
  it("GET /api/integrations/shopify/reconciliation lists rows", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/reconciliation")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("GET reconciliation filters by resolution_status", async () => {
    const res = await request(app)
      .get("/api/integrations/shopify/reconciliation?resolution_status=open")
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r) => r.resolution_status === "open")).toBe(true);
  });

  it("PUT /api/integrations/shopify/reconciliation/:id resolves row", async () => {
    const res = await request(app)
      .put("/api/integrations/shopify/reconciliation/1")
      .set(authHeaders)
      .send({ resolution_status: "resolved", resolution_note: "Manual fix" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("Updated");
  });

  it("PUT reconciliation/:id rejects invalid status", async () => {
    const res = await request(app)
      .put("/api/integrations/shopify/reconciliation/1")
      .set(authHeaders)
      .send({ resolution_status: "invalid" });
    expect(res.status).toBe(400);
  });

  it("PUT reconciliation/:id returns 404 for missing row", async () => {
    const res = await request(app)
      .put("/api/integrations/shopify/reconciliation/9999")
      .set(authHeaders)
      .send({ resolution_status: "resolved" });
    expect(res.status).toBe(404);
  });

  it("POST reconciliation/:id/fix creates approval request", async () => {
    // Reset to open
    await db.query("UPDATE inventory_reconciliation SET resolution_status = 'open' WHERE id = 1");
    const res = await request(app)
      .post("/api/integrations/shopify/reconciliation/1/fix")
      .set(authHeaders)
      .send({ mode: "adjust_local", note: "Test fix" });
    expect(res.status).toBe(200);
    expect(res.body.approval_request_id).toBeDefined();
  });

  it("POST reconciliation/bulk ignores rows", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/reconciliation/bulk")
      .set(authHeaders)
      .send({ ids: [1], action: "ignore" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("Ignored");
  });

  it("POST reconciliation/bulk rejects invalid action", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/reconciliation/bulk")
      .set(authHeaders)
      .send({ ids: [1], action: "invalid" });
    expect(res.status).toBe(400);
  });

  it("POST reconciliation/bulk requires ids", async () => {
    const res = await request(app)
      .post("/api/integrations/shopify/reconciliation/bulk")
      .set(authHeaders)
      .send({ action: "ignore" });
    expect(res.status).toBe(400);
  });
});

}); // end outer describe
