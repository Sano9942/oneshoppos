/**
 * pg-admin-payment-observability.test.js
 *
 * Integration tests for admin payment observability endpoints:
 * - GET /api/admin/payment-intents/stuck
 * - GET /api/admin/webhooks/payment-dead-letters
 *
 * These are super-admin routes mounted BEFORE tenant middleware, so they
 * use masterDb directly for public-schema queries.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const request = require("supertest");
const express = require("express");
const dbPg = require("../../db-pg");
const masterDb = require("../../master-db-pg");

// Stub super-admin middleware so tests can bypass JWT verification.
const requireAllowedIp = (req, res, next) => next();
const requireSuperAdmin = (req, res, next) => {
  if (req.headers["x-admin-test"] === "ok") return next();
  return res.status(401).json({ error: "Super-admin required" });
};

let app;

beforeAll(async () => {
  await masterDb.init(dbPg);

  app = express();
  app.use(express.json());

  // Register the two admin route files under test with stubbed middleware.
  const deps = {
    masterDb,
    requireAllowedIp,
    requireSuperAdmin,
  };
  require("../../routes/admin/billing")(app, deps);
  require("../../routes/admin/operations")(app, deps);

  // Reset seed state: clear stuck-test intents + stale webhook events.
  await masterDb.query("DELETE FROM payment_intents WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'obs-test-%')");
  await masterDb.query("DELETE FROM tenants WHERE slug LIKE 'obs-test-%'");
  await masterDb.query("DELETE FROM payment_webhook_events WHERE provider = 'obs-test'");
}, 30000);

afterAll(async () => {
  await masterDb.query("DELETE FROM payment_intents WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'obs-test-%')");
  await masterDb.query("DELETE FROM tenants WHERE slug LIKE 'obs-test-%'");
  await masterDb.query("DELETE FROM payment_webhook_events WHERE provider = 'obs-test'");
});

describe("GET /api/admin/payment-intents/stuck", () => {
  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/payment-intents/stuck");
    expect(res.status).toBe(401);
  });

  test("returns empty intents array + threshold_hours with no stuck intents", async () => {
    const res = await request(app)
      .get("/api/admin/payment-intents/stuck")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("intents");
    expect(Array.isArray(res.body.intents)).toBe(true);
    expect(res.body.threshold_hours).toBe(2);
  });

  test("accepts custom hours query param", async () => {
    const res = await request(app)
      .get("/api/admin/payment-intents/stuck?hours=0")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    expect(res.body.threshold_hours).toBe(0);
  });

  test("returns pending intent older than threshold with tenant info", async () => {
    // Create a test tenant + stuck pending intent (created 3 hours ago)
    const { rows: [tenant] } = await masterDb.query(
      `INSERT INTO tenants (slug, name, owner_email, status) VALUES ('obs-test-1', 'Obs Test 1', 'obs-test-1@test.local', 'active') RETURNING id`
    );
    await masterDb.query(
      `INSERT INTO payment_intents
        (tenant_id, amount, plan, cycle, status, gateway, gateway_ref, created_at)
       VALUES ($1, 8000, 'pro', 'monthly', 'pending', 'xpay', 'stuck-ref-1', NOW() - INTERVAL '3 hours')`,
      [tenant.id]
    );

    const res = await request(app)
      .get("/api/admin/payment-intents/stuck?hours=2")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    const found = res.body.intents.find((i) => i.gateway_ref === "stuck-ref-1");
    expect(found).toBeDefined();
    expect(found.tenant_slug).toBe("obs-test-1");
    expect(found.tenant_name).toBe("Obs Test 1");
    expect(Number(found.amount)).toBe(8000);
  });

  test("does not return recent pending intent (< threshold hours)", async () => {
    const { rows: [tenant] } = await masterDb.query(
      `INSERT INTO tenants (slug, name, owner_email, status) VALUES ('obs-test-2', 'Obs Test 2', 'obs-test-2@test.local', 'active') RETURNING id`
    );
    await masterDb.query(
      `INSERT INTO payment_intents
        (tenant_id, amount, plan, cycle, status, gateway, gateway_ref, created_at)
       VALUES ($1, 8000, 'pro', 'monthly', 'pending', 'xpay', 'recent-ref-1', NOW() - INTERVAL '10 minutes')`,
      [tenant.id]
    );

    const res = await request(app)
      .get("/api/admin/payment-intents/stuck?hours=2")
      .set("x-admin-test", "ok");
    const found = res.body.intents.find((i) => i.gateway_ref === "recent-ref-1");
    expect(found).toBeUndefined();
  });
});

describe("GET /api/admin/webhooks/payment-dead-letters", () => {
  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/webhooks/payment-dead-letters");
    expect(res.status).toBe(401);
  });

  test("returns empty events array baseline", async () => {
    const res = await request(app)
      .get("/api/admin/webhooks/payment-dead-letters")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("events");
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  test("returns seeded webhook event ordered by created_at DESC", async () => {
    await masterDb.query(
      `INSERT INTO payment_webhook_events
        (provider, event_id, event_type, raw_payload, created_at)
       VALUES ('obs-test', 'evt-1', 'payment.completed', $1, NOW() - INTERVAL '1 hour')`,
      [JSON.stringify({ transaction_id: "tx-1" })]
    );
    await masterDb.query(
      `INSERT INTO payment_webhook_events
        (provider, event_id, event_type, raw_payload, created_at)
       VALUES ('obs-test', 'evt-2', 'payment.failed', $1, NOW() - INTERVAL '30 minutes')`,
      [JSON.stringify({ transaction_id: "tx-2" })]
    );

    const res = await request(app)
      .get("/api/admin/webhooks/payment-dead-letters")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    const ours = res.body.events.filter((e) => e.provider === "obs-test");
    expect(ours.length).toBe(2);
    // DESC order means evt-2 (newer) first
    expect(ours[0].event_id).toBe("evt-2");
    expect(ours[1].event_id).toBe("evt-1");
  });

  test("respects limit query param", async () => {
    const res = await request(app)
      .get("/api/admin/webhooks/payment-dead-letters?limit=1")
      .set("x-admin-test", "ok");
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeLessThanOrEqual(1);
  });
});
