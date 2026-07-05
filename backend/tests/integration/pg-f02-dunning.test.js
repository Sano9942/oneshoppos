const { createTestApp } = require("../helpers/createTestApp-pg");
const subs = require("../../services/subscriptions");
const { processDunningForTenant } = require("../../workers/subscription-dunning-worker-boss");

/**
 * pg-f02-dunning.test.js — F02 membership dunning (billing hardening).
 *
 * Drives the sandbox failure sequence end-to-end:
 *   processRenewal on a card-on-file whose token declines → run marked
 *   'failed' + first retry scheduled + member notified → three dunning retries
 *   at attempts 1/2/3 → auto-pause + paused notification. Plus a recovery case:
 *   a retry that succeeds marks the run paid and closes dunning.
 *
 * Uses the sandbox gateway (memory: sanopay_sandbox) — a token containing
 * "FAIL" always declines; any other token succeeds.
 */

const logger = { info() {}, warn() {}, error() {} };
const fakeBoss = { send: async () => {} };

let db, cleanup;

async function makePlan(interval = "monthly", price = 3000) {
  const { rows: [p] } = await db.query(
    "INSERT INTO subscription_plans (name, price, billing_interval) VALUES ('Gold', $1, $2) RETURNING id",
    [price, interval]);
  return p.id;
}
async function makeCustomer() {
  const { rows: [c] } = await db.query(
    "INSERT INTO customers (name, email, mobile) VALUES ('Member', 'm@x.co', '03001234567') RETURNING id");
  return c.id;
}
async function makeSub(planId, customerId, token) {
  const { rows: [s] } = await db.query(
    `INSERT INTO customer_subscriptions
       (plan_id, customer_id, status, current_period_start, current_period_end, auto_charge, gateway_token)
     VALUES ($1, $2, 'active', NOW() - INTERVAL '31 days', NOW() - INTERVAL '1 day', true, $3)
     RETURNING id`,
    [planId, customerId, token]);
  return s.id;
}
async function run(subId) {
  const { rows: [r] } = await db.query(
    "SELECT * FROM subscription_runs WHERE subscription_id = $1 ORDER BY id DESC LIMIT 1", [subId]);
  return r;
}
async function noticeCount(event, customerId) {
  const { rows: [r] } = await db.query(
    "SELECT COUNT(*)::int AS n FROM customer_notifications WHERE event = $1 AND customer_id = $2",
    [event, customerId]);
  return r.n;
}

beforeAll(async () => {
  const result = await createTestApp();
  db = result.db; cleanup = result.cleanup;
  await db.query("SET TIME ZONE 'UTC'");
  process.env.PAYMENT_GATEWAY = "sandbox";
  // Notifications must be on for the dispatch engine to log rows.
  await db.query(
    "INSERT INTO feature_flags (key, enabled) VALUES ('customer_notifications', true) ON CONFLICT (key) DO UPDATE SET enabled = true");
}, 120000);

afterAll(async () => {
  delete process.env.PAYMENT_GATEWAY;
  if (cleanup) await cleanup();
}, 30000);

describe("F02 — dunning", () => {
  test("processRenewal on a declining card enters dunning + notifies", async () => {
    const planId = await makePlan();
    const customerId = await makeCustomer();
    const subId = await makeSub(planId, customerId, "sbx_tok_FAIL_1");

    await subs.processRenewal(db, fakeBoss, "single", subId);

    const r = await run(subId);
    expect(r.charge_status).toBe("failed");
    expect(r.dunning_attempts).toBe(0);
    expect(r.first_failed_at).toBeTruthy();
    expect(r.next_dunning_at).toBeTruthy();
    expect(r.dunning_done_at).toBeNull();
    expect(await noticeCount("subscription.payment_failed", customerId)).toBeGreaterThanOrEqual(1);
  });

  test("three dunning retries → auto-pause + paused notification", async () => {
    const planId = await makePlan();
    const customerId = await makeCustomer();
    const subId = await makeSub(planId, customerId, "sbx_tok_FAIL_2");
    await subs.processRenewal(db, fakeBoss, "single", subId);

    // Attempt 1 (due now via clock-shift).
    await db.query("UPDATE subscription_runs SET next_dunning_at = NOW() - INTERVAL '1 minute' WHERE subscription_id = $1", [subId]);
    let processed = await processDunningForTenant(db, logger, "single");
    expect(processed).toBe(1);
    let r = await run(subId);
    expect(r.dunning_attempts).toBe(1);
    expect(r.dunning_done_at).toBeNull();
    // Next retry anchored to first_failed_at + 3 days.
    expect(new Date(r.next_dunning_at).getTime()).toBeGreaterThan(new Date(r.first_failed_at).getTime());

    // Attempt 2.
    await db.query("UPDATE subscription_runs SET next_dunning_at = NOW() - INTERVAL '1 minute' WHERE subscription_id = $1", [subId]);
    await processDunningForTenant(db, logger, "single");
    r = await run(subId);
    expect(r.dunning_attempts).toBe(2);
    expect(r.dunning_done_at).toBeNull();

    // Attempt 3 → exhaust + pause.
    await db.query("UPDATE subscription_runs SET next_dunning_at = NOW() - INTERVAL '1 minute' WHERE subscription_id = $1", [subId]);
    await processDunningForTenant(db, logger, "single");
    r = await run(subId);
    expect(r.dunning_attempts).toBe(3);
    expect(r.dunning_done_at).toBeTruthy();

    const { rows: [sub] } = await db.query("SELECT status, paused_at FROM customer_subscriptions WHERE id = $1", [subId]);
    expect(sub.status).toBe("paused");
    expect(sub.paused_at).toBeTruthy();
    expect(await noticeCount("subscription.paused", customerId)).toBeGreaterThanOrEqual(1);
  });

  test("a retry that succeeds marks the run paid and closes dunning", async () => {
    const planId = await makePlan();
    const customerId = await makeCustomer();
    const subId = await makeSub(planId, customerId, "sbx_tok_FAIL_3");
    await subs.processRenewal(db, fakeBoss, "single", subId);

    // Member fixes their card → swap to a good token, then retry.
    await db.query("UPDATE customer_subscriptions SET gateway_token = 'sbx_tok_GOOD' WHERE id = $1", [subId]);
    await db.query("UPDATE subscription_runs SET next_dunning_at = NOW() - INTERVAL '1 minute' WHERE subscription_id = $1", [subId]);
    await processDunningForTenant(db, logger, "single");

    const r = await run(subId);
    expect(r.charge_status).toBe("completed");
    expect(r.dunning_done_at).toBeTruthy();
    const { rows: [inv] } = await db.query("SELECT status, balance_due FROM customer_invoices WHERE id = $1", [r.invoice_id]);
    expect(inv.status).toBe("paid");
    expect(Number(inv.balance_due)).toBe(0);
    // Subscription stays active.
    const { rows: [sub] } = await db.query("SELECT status FROM customer_subscriptions WHERE id = $1", [subId]);
    expect(sub.status).toBe("active");
  });

  test("dunning skips a subscription that was paused/cancelled mid-cycle (race guard)", async () => {
    const planId = await makePlan();
    const customerId = await makeCustomer();
    const subId = await makeSub(planId, customerId, "sbx_tok_FAIL_4");
    await subs.processRenewal(db, fakeBoss, "single", subId);

    // Owner cancels between scheduling and the retry firing.
    await db.query("UPDATE customer_subscriptions SET status = 'cancelled' WHERE id = $1", [subId]);
    await db.query("UPDATE subscription_runs SET next_dunning_at = NOW() - INTERVAL '1 minute' WHERE subscription_id = $1", [subId]);
    await processDunningForTenant(db, logger, "single");

    const r = await run(subId);
    // Run closed out without another charge attempt.
    expect(r.dunning_done_at).toBeTruthy();
    expect(r.dunning_attempts).toBe(0);
  });
});
