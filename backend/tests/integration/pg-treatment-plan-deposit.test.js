/**
 * pg-treatment-plan-deposit.test.js — M10 treatment plan deposit lifecycle
 * under PAYMENT_GATEWAY=sandbox. Mirrors pg-sandbox-payment.test.js shape.
 *
 * Flow covered:
 *   1. Create plan → seed folio
 *   2. createDepositPreAuth → gateway_ref stored, deposit_status = 'pending'
 *   3. handleDepositWebhook event 'payment.authorized' → deposit_status = 'authorized'
 *   4. captureDepositOnSettle({ capture: true }) → deposit_status = 'captured'
 *   5. Negative: webhook for unknown intent returns ok=false
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");

let db, cleanup;

beforeAll(async () => {
  process.env.PAYMENT_GATEWAY = "sandbox";
  process.env.SANDBOX_WEBHOOK_SECRET = "test-sandbox-secret-m10";

  const result = await createTestApp();
  db = result.db;
  cleanup = result.cleanup;
}, 60000);

afterAll(async () => {
  if (cleanup) await cleanup();
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.SANDBOX_WEBHOOK_SECRET;
}, 30000);

describe("M10 treatment plan deposit (sandbox adapter)", () => {
  let planId;

  test("adapter is sandbox and enabled", () => {
    const pg = require("../../services/payment-gateway");
    expect(pg.isEnabled()).toBe(true);
    expect(pg.getPaymentAdapter().constructor.name).toBe("SandboxAdapter");
  });

  test("createDepositPreAuth stores gateway_ref and sets deposit_status=pending", async () => {
    // Seed a treatment plan for customer 1 by employee 1
    const { rows: [plan] } = await db.query(
      `INSERT INTO treatment_plans
         (plan_number, customer_id, created_by, title, status, total_sessions_planned, deposit_collected)
       VALUES ('TP-TEST-0001', 1, 1, 'Root canal — upper molar', 'draft', 3, 5000)
       RETURNING id`
    );
    planId = plan.id;
    // Seed folio (createPlan normally does this — doing it directly here)
    await db.query("INSERT INTO treatment_folios (plan_id, status) VALUES ($1, 'open')", [planId]);

    const deposits = require("../../services/treatment-plan-deposits");
    const result = await deposits.createDepositPreAuth(db, {
      planId,
      amount: 5000,
      returnUrl: "http://localhost/return",
      cancelUrl: "http://localhost/cancel",
    });

    expect(result.checkout_url).toContain("/api/sandbox/pay/");
    expect(result.gateway_ref).toMatch(/^sandbox_\d+_treatment-deposit-TP-TEST-0001$/);
    expect(result.amount).toBe(5000);

    const { rows: [row] } = await db.query(
      "SELECT deposit_payment_intent_id, deposit_status FROM treatment_plans WHERE id = $1",
      [planId]
    );
    expect(row.deposit_payment_intent_id).toBe(result.gateway_ref);
    expect(row.deposit_status).toBe("pending");
  });

  test("webhook event authorized → deposit_status=authorized", async () => {
    const { rows: [plan] } = await db.query(
      "SELECT deposit_payment_intent_id FROM treatment_plans WHERE id = $1",
      [planId]
    );
    const deposits = require("../../services/treatment-plan-deposits");
    const result = await deposits.handleDepositWebhook(db, {
      gatewayRef: plan.deposit_payment_intent_id,
      eventType: "payment.authorized",
      status: "authorized",
    });
    expect(result.ok).toBe(true);
    expect(result.deposit_status).toBe("authorized");

    const { rows: [row] } = await db.query(
      "SELECT deposit_status FROM treatment_plans WHERE id = $1",
      [planId]
    );
    expect(row.deposit_status).toBe("authorized");
  });

  test("captureDepositOnSettle({ capture: true }) → deposit_status=captured", async () => {
    const deposits = require("../../services/treatment-plan-deposits");
    const result = await deposits.captureDepositOnSettle(db, planId, { capture: true });
    expect(result.deposit_status).toBe("captured");

    const { rows: [row] } = await db.query(
      "SELECT deposit_status FROM treatment_plans WHERE id = $1",
      [planId]
    );
    expect(row.deposit_status).toBe("captured");
  });

  test("captureDepositOnSettle on already-captured plan is a no-op (skipped)", async () => {
    const deposits = require("../../services/treatment-plan-deposits");
    const result = await deposits.captureDepositOnSettle(db, planId, { capture: true });
    expect(result.skipped).toBe(true);
  });

  test("release flow: fresh plan → authorized → capture=false → released", async () => {
    const { rows: [plan] } = await db.query(
      `INSERT INTO treatment_plans
         (plan_number, customer_id, created_by, title, status, total_sessions_planned, deposit_collected)
       VALUES ('TP-TEST-0002', 1, 1, 'Dental cleaning', 'draft', 1, 2000)
       RETURNING id`
    );
    const releasePlanId = plan.id;
    await db.query("INSERT INTO treatment_folios (plan_id, status) VALUES ($1, 'open')", [releasePlanId]);

    const deposits = require("../../services/treatment-plan-deposits");
    const preauth = await deposits.createDepositPreAuth(db, { planId: releasePlanId, amount: 2000 });
    await deposits.handleDepositWebhook(db, {
      gatewayRef: preauth.gateway_ref,
      eventType: "payment.authorized",
      status: "authorized",
    });
    const released = await deposits.captureDepositOnSettle(db, releasePlanId, { capture: false });
    expect(released.deposit_status).toBe("released");
  });

  test("webhook for unknown intent returns ok=false", async () => {
    const deposits = require("../../services/treatment-plan-deposits");
    const result = await deposits.handleDepositWebhook(db, {
      gatewayRef: "sandbox_99999_unknown-ref",
      eventType: "payment.authorized",
      status: "authorized",
    });
    expect(result.ok).toBe(false);
  });

  test("webhook event failed → deposit_status=failed", async () => {
    const { rows: [plan] } = await db.query(
      `INSERT INTO treatment_plans
         (plan_number, customer_id, created_by, title, status, total_sessions_planned, deposit_collected)
       VALUES ('TP-TEST-0003', 1, 1, 'Test failed flow', 'draft', 1, 1000)
       RETURNING id`
    );
    const fpid = plan.id;
    await db.query("INSERT INTO treatment_folios (plan_id, status) VALUES ($1, 'open')", [fpid]);

    const deposits = require("../../services/treatment-plan-deposits");
    const pre = await deposits.createDepositPreAuth(db, { planId: fpid, amount: 1000 });
    const result = await deposits.handleDepositWebhook(db, {
      gatewayRef: pre.gateway_ref,
      eventType: "payment.failed",
      status: "failed",
    });
    expect(result.deposit_status).toBe("failed");
  });
});
