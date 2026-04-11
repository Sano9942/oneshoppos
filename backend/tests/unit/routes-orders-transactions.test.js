import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Unit test for routes/orders.js — POST /api/orders/:id/transactions.
//
// Pattern D / Phase 5 H2: v25 added provider_ref, payment_context,
// webhook_event_id to web_order_transactions. The original INSERT at
// routes/orders.js:575-589 did not list them, so POS-created
// transactions had NULLs for all three and a later xPay webhook would
// insert a second row via routes/webhooks.js:94 instead of matching
// the first.
//
// This test mounts the orders router on a mini-express, injects a
// mocked db.query, and asserts (a) the SQL includes the three new
// column names and (b) the params array has the expected values in
// the right positions.

const registerOrderRoutes = require("../../routes/orders");

function buildApp({ dbQuery }) {
  const app = express();
  app.use(express.json());

  const deps = {
    db: { query: dbQuery },
    requirePerm: () => (req, res, next) => next(),
    requireAnyPerm: () => (req, res, next) => next(),
    createNotification: () => {},
    notifyLowStockForSale: () => {},
    path: require("path"),
    fs: require("fs"),
    UPLOADS_DIR: "/tmp",
    runtimeState: {},
    verifyConnection: () => Promise.resolve({}),
    fetchShopifyLocations: () => Promise.resolve([]),
    adjustShopifyInventory: () => Promise.resolve({}),
    fetchShopifyVariantCatalog: () => Promise.resolve([]),
    fetchShopifyProductsFull: () => Promise.resolve([]),
    fetchInventoryLevel: () => Promise.resolve(null),
    fetchInventoryLevelsBatch: () => Promise.resolve([]),
    fetchRecentOrders: () => Promise.resolve([]),
    retryDelayMinutesWithJitter: () => 1,
    evaluateWebhookTimestampWindow: () => ({ withinWindow: true }),
    isRetryableInventoryEventStatus: () => false,
    buildWebhookIdempotencyKey: () => "key",
    logShopifyEvent: () => {},
    DB_PATH: "",
    multer: require("multer"),
    SHOPIFY_MAX_RETRY_ATTEMPTS: 3,
    decryptShopifySecret: (v) => v,
  };

  registerOrderRoutes(app, deps);
  return app;
}

describe("POST /api/orders/:id/transactions — v25 column population", () => {
  let capturedSql;
  let capturedParams;
  let dbQuery;

  beforeEach(() => {
    capturedSql = null;
    capturedParams = null;
    dbQuery = vi.fn().mockImplementation((sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return Promise.resolve({ rows: [{ id: 999 }] });
    });
  });

  it("INSERT lists provider_ref, payment_context, webhook_event_id", async () => {
    const app = buildApp({ dbQuery });
    const res = await request(app)
      .post("/api/orders/42/transactions")
      .send({
        external_txn_id: "TXN-001",
        gateway: "xpay",
        kind: "sale",
        status: "completed",
        amount: 300,
        provider_ref: "prov-abc-123",
        payment_context: "billing",
        webhook_event_id: 77,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(999);

    // SQL must reference the three v25 columns in the column list.
    expect(capturedSql).toContain("provider_ref");
    expect(capturedSql).toContain("payment_context");
    expect(capturedSql).toContain("webhook_event_id");

    // Params must include the posted values. The handler passes them
    // as the last three positional params (positions 9, 10, 11 — after
    // web_order_id, external_txn_id, gateway, kind, status, amount,
    // processed_at, raw_payload).
    expect(capturedParams).toContain("prov-abc-123");
    expect(capturedParams).toContain("billing");
    expect(capturedParams).toContain(77);
  });

  it("defaults payment_context to 'billing' when caller omits it", async () => {
    const app = buildApp({ dbQuery });
    const res = await request(app)
      .post("/api/orders/42/transactions")
      .send({
        external_txn_id: "TXN-002",
        gateway: "manual",
        kind: "sale",
        status: "completed",
        amount: 150,
      });

    expect(res.status).toBe(200);

    // provider_ref and webhook_event_id default to null.
    expect(capturedParams).toContain(null);
    // payment_context defaults to "billing".
    expect(capturedParams).toContain("billing");
  });

  it("param array length matches INSERT placeholder count ($1..$11)", async () => {
    const app = buildApp({ dbQuery });
    await request(app)
      .post("/api/orders/42/transactions")
      .send({
        external_txn_id: "TXN-003",
        gateway: "xpay",
        kind: "refund",
        status: "completed",
        amount: 50,
        provider_ref: "prov-xyz",
        payment_context: "storefront",
        webhook_event_id: 99,
      });

    // 11 columns in the INSERT → 11 positional params.
    expect(capturedParams).toHaveLength(11);
    // Placeholder count in SQL must match.
    const placeholderCount = (capturedSql.match(/\$\d+/g) || []).length;
    expect(placeholderCount).toBe(11);
  });
});
