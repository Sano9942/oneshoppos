/**
 * completion-00 P0 regression guards.
 *
 * P0-1: `ai_insights` must be present in DEFAULT_FEATURE_FLAGS (default false)
 *        so the flag is reachable/toggleable in the admin flags editor.
 * P0-2: `/api/reports/stock-aging` must serve UNGATED (the shadowing gated
 *        duplicate in reports/inventory.js was removed), while the genuinely
 *        premium `/api/reports/stockout-risk` stays gated on
 *        `reports_inventory_health_plus`.
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const {
  DEFAULT_FEATURE_FLAGS,
} = require("../../middleware/feature-flags");

describe("completion-00 — reports gating + ai_insights flag (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../routes/products")(app, deps);
    require("../../routes/inventory")(app, deps);
    require("../../routes/reports")(app, deps);
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("P0-1: ai_insights is in DEFAULT_FEATURE_FLAGS and defaults false", () => {
    expect(Object.prototype.hasOwnProperty.call(DEFAULT_FEATURE_FLAGS, "ai_insights")).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.ai_insights).toBe(false);
  });

  it("P0-2: /api/reports/stock-aging serves ungated (200) with no flag set", async () => {
    const res = await request(app)
      .get("/api/reports/stock-aging")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items || res.body.rows)).toBe(true);
  });

  it("P0-2: /api/reports/stockout-risk stays gated when flag is off", async () => {
    const res = await request(app)
      .get("/api/reports/stockout-risk")
      .set("x-employee-id", "1");
    expect(res.status).not.toBe(200);
    expect(res.body.flag).toBe("reports_inventory_health_plus");
  });

  it("P0-2: enabling reports_inventory_health_plus opens the stockout-risk gate", async () => {
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('reports_inventory_health_plus', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    const res = await request(app)
      .get("/api/reports/stockout-risk")
      .set("x-employee-id", "1");
    // Gate opened → no longer a "feature disabled" refusal. (The handler may
    // still error on sparse fixtures; we only assert the flag no longer blocks.)
    expect(res.body.flag).toBeUndefined();
    expect([503]).not.toContain(res.status);
  });
});
