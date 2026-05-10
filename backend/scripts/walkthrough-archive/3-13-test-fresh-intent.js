// One-off: create a fresh pending payment_intent for the P6 fix verification.
// Prints the gateway_ref to stdout so the operator can pass it to
// POST /api/sandbox/simulate-webhook { gatewayRef, outcome: "payment.completed" }.
//
// Usage: railway run --service oneshoppos node backend/scripts/3-13-test-fresh-intent.js
// Cleanup: optional — payment_intents row stays harmless after webhook flips it to 'completed'.

const db = require("../db-pg");
const masterDb = require("../master-db-pg");

(async () => {
  await masterDb.init(db);

  const TENANT_ID = 95; // livetest1
  const PLAN = "pro";
  const CYCLE = "annual";
  const AMOUNT = 80000;
  const OUTLET_COUNT = 1;

  const gatewayRef = `sandbox_${Date.now()}_p6verify`;

  const { rows: [intent] } = await masterDb.query(
    `INSERT INTO payment_intents
       (tenant_id, amount, plan, cycle, outlet_count, gateway, return_url, provider, gateway_ref, status)
     VALUES ($1, $2, $3, $4, $5, 'sandbox', 'https://sanopos.com/billing', 'sandbox', $6, 'pending')
     RETURNING id, gateway_ref`,
    [TENANT_ID, AMOUNT, PLAN, CYCLE, OUTLET_COUNT, gatewayRef]
  );

  console.log(JSON.stringify({ intent_id: intent.id, gateway_ref: intent.gateway_ref }));
  process.exit(0);
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
