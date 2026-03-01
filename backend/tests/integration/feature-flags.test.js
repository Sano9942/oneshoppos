/**
 * feature-flags.test.js — Integration tests for feature flag middleware
 *
 * Tests that requireFeature() returns 503 when a flag is disabled,
 * and that toggling flags changes behavior dynamically.
 */

const { createTestApp, closeDb, dbRun, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
});

afterAll(async () => {
  await closeDb(db);
});

describe("Feature Flags — requireFeature middleware", () => {
  it("supplier invoices endpoint works when supplier_payables flag is enabled", async () => {
    // The flag is enabled by default in seed data
    const flag = await dbGet(db, "SELECT enabled FROM feature_flags WHERE key = 'supplier_payables'");
    expect(flag.enabled).toBe(1);

    const res = await makeRequest(app, ADMIN_ID).get("/api/supplier-invoices");
    // Should not be 503
    expect(res.status).not.toBe(503);
  });

  it("supplier invoices endpoint returns 503 when supplier_payables flag is disabled", async () => {
    // Disable the flag
    await dbRun(db, "UPDATE feature_flags SET enabled = 0 WHERE key = 'supplier_payables'");

    const res = await makeRequest(app, ADMIN_ID).get("/api/supplier-invoices");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/feature disabled/i);

    // Re-enable for other tests
    await dbRun(db, "UPDATE feature_flags SET enabled = 1 WHERE key = 'supplier_payables'");
  });

  it("notifications endpoint returns 503 when notifications flag is disabled", async () => {
    await dbRun(db, "UPDATE feature_flags SET enabled = 0 WHERE key = 'notifications'");

    const res = await makeRequest(app, ADMIN_ID).get("/api/notifications");
    expect(res.status).toBe(503);
    expect(res.body.flag).toBe("notifications");

    // Re-enable
    await dbRun(db, "UPDATE feature_flags SET enabled = 1 WHERE key = 'notifications'");
  });

  it("toggling flag changes behavior on next request", async () => {
    // Start enabled
    const res1 = await makeRequest(app, ADMIN_ID).get("/api/notifications");
    expect(res1.status).not.toBe(503);

    // Disable
    await dbRun(db, "UPDATE feature_flags SET enabled = 0 WHERE key = 'notifications'");

    const res2 = await makeRequest(app, ADMIN_ID).get("/api/notifications");
    expect(res2.status).toBe(503);

    // Re-enable
    await dbRun(db, "UPDATE feature_flags SET enabled = 1 WHERE key = 'notifications'");

    const res3 = await makeRequest(app, ADMIN_ID).get("/api/notifications");
    expect(res3.status).not.toBe(503);
  });
});
