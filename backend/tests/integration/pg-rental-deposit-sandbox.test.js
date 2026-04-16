/**
 * pg-rental-deposit-sandbox.test.js — Placeholder for rental deposit flow
 * through the SanoPay sandbox adapter.
 *
 * Status (wave-b, Apr 2026): rental deposits are currently captured as a
 * simple column update (deposit_collected + deposit_method) inside
 * services/rental-service.js:createContract. They do NOT route through
 * payment-gateway.processInlinePayment() or createCheckout(). Shipping the
 * gateway wiring is scope-creep for wave-b.
 *
 * These tests are intentionally skipped with TODOs; convert to `it(...)`
 * once rental-service.js:createContract calls processInlinePayment() for
 * Card deposits and persists gateway_ref, and once returnContract triggers
 * gateway.refund() and persists gateway_refund_ref.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Rentals — sandbox deposit flow (skipped until wired)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    process.env.PAYMENT_GATEWAY = "sandbox";
    process.env.SANDBOX_WEBHOOK_SECRET = "test-sandbox-secret";

    ({ app, db, deps, cleanup } = await createTestApp());
    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db });
    require("../../middleware/permissions");

    // Pre-seed rentals mode so the new wave-b gate passes.
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('rentals', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = EXCLUDED.enabled`
    );
    featureFlags.invalidateModeCache();

    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rentals")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
    delete process.env.PAYMENT_GATEWAY;
    delete process.env.SANDBOX_WEBHOOK_SECRET;
  });

  const authHeaders = { "x-employee-id": "1" };

  // Smoke test: confirms the mode+feature+perm gate is still permissive when
  // the rentals mode is enabled (guards against future regressions).
  it("smoke — rental-items endpoint reachable when rentals mode enabled", async () => {
    const res = await request(app).get("/api/rental-items").set(authHeaders);
    expect(res.status).toBe(200);
  });

  // TODO(wave-b follow-up): enable once rental-service wires Card deposits
  // to payment-gateway.processInlinePayment() on contract create.
  it.skip("Card deposit on contract create returns gateway_ref matching /^sandbox_/", async () => {
    // Create rental item with deposit_amount, create contract with
    // deposit_method='Card' and deposit_collected > 0. Expect the contract
    // row to persist `gateway_ref LIKE 'sandbox_inline_%'`.
  });

  // TODO(wave-b follow-up): enable once returnContract calls
  // gateway.refund() and persists gateway_refund_ref.
  it.skip("return triggers gateway refund and persists gateway_refund_ref", async () => {
    // Execute full lifecycle: create → confirm → checkout → return. Expect
    // the contract row to have gateway_refund_ref LIKE 'sandbox_refund_%'.
  });
});
