const assert = require("assert");
const {
  baseRetryDelayMinutes,
  retryDelayMinutesWithJitter,
  evaluateWebhookTimestampWindow,
  isRetryableInventoryEventStatus,
  canApproveReconciliationRequest,
} = require("./shopify/utils");

function run() {
  assert.strictEqual(baseRetryDelayMinutes(1), 1);
  assert.strictEqual(baseRetryDelayMinutes(2), 5);
  assert.strictEqual(baseRetryDelayMinutes(3), 15);
  assert.strictEqual(baseRetryDelayMinutes(4), 60);
  assert.strictEqual(baseRetryDelayMinutes(7), 240);

  const fixedRand = () => 0;
  assert.strictEqual(retryDelayMinutesWithJitter(1, fixedRand), 1);
  assert.strictEqual(retryDelayMinutesWithJitter(3, fixedRand), 15);

  const baseNow = Date.parse("2026-02-24T12:00:00.000Z");
  const okTs = evaluateWebhookTimestampWindow("2026-02-24T11:56:00.000Z", baseNow);
  assert.strictEqual(okTs.ok, true);

  const oldTs = evaluateWebhookTimestampWindow("2026-02-24T11:40:00.000Z", baseNow);
  assert.strictEqual(oldTs.ok, false);
  assert.strictEqual(oldTs.reason, "outside_window");

  const badTs = evaluateWebhookTimestampWindow("not-a-date", baseNow);
  assert.strictEqual(badTs.ok, false);
  assert.strictEqual(badTs.reason, "invalid_timestamp");

  assert.strictEqual(isRetryableInventoryEventStatus("failed"), true);
  assert.strictEqual(isRetryableInventoryEventStatus("dead_letter"), true);
  assert.strictEqual(isRetryableInventoryEventStatus("processed"), false);

  assert.strictEqual(canApproveReconciliationRequest({ requesterEmployeeId: 1, approverEmployeeId: 1 }), false);
  assert.strictEqual(canApproveReconciliationRequest({ requesterEmployeeId: 1, approverEmployeeId: 2 }), true);
  assert.strictEqual(canApproveReconciliationRequest({ requesterEmployeeId: null, approverEmployeeId: 2 }), true);

  console.log("shopify_utils_test: all tests passed");
}

run();

