/**
 * pg-v06-estimate.test.js — V06 P1 estimate (staff + notification).
 *
 *   - "Send Estimate" totals the ticket's items and fires the customer
 *     notification via the F05 engine (ticket.estimate_ready → ticket_estimate
 *     template); a truthful customer_notifications row is written
 *   - the v104 estimate rules are seeded (schema-pg.sql for fresh tenants)
 *   - approval remains the existing intake→approved transition
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req, customerId;
const OUTLET = 1;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = $2`, [key, enabled]
  );
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  if (invalidateFeatureFlagCache) invalidateFeatureFlagCache(null);
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;
  require("../../middleware/feature-flags").init({ db });
  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco"; r.company = { company_name: "Fixit", phone: "042-111", timezone: "UTC" };
    next();
  });
  require("../../routes/service-tickets")(app, deps);
  req = makeRequest(app, ADMIN_ID);
  await setFlag("phase4_workflow_tickets", true);
  await setFlag("customer_notifications", true);
  const { rows } = await db.query("INSERT INTO customers (name, mobile) VALUES ('Estimate Test', '03001112233') RETURNING id");
  customerId = rows[0].id;
  await db.query(
    `INSERT INTO outlet_stock (product_id, outlet_id, quantity) VALUES (1, $1, 100)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET quantity = 100`, [OUTLET]
  );
}, 180000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

describe("V06 — estimate rules seeded", () => {
  it("has ticket.estimate_ready rules (sms + email)", async () => {
    const { rows } = await db.query(
      "SELECT channel FROM notification_rules WHERE event = 'ticket.estimate_ready' ORDER BY channel"
    );
    const channels = rows.map((r) => r.channel);
    expect(channels).toContain("sms");
    expect(channels).toContain("email");
  });
});

describe("V06 — send estimate", () => {
  it("totals the items, logs the send, and dispatches the notification", async () => {
    const create = await req.post("/api/service-tickets").send({
      title: "Estimate job", customer_id: customerId, outlet_id: OUTLET,
    });
    const ticketId = create.body.id;
    await req.post(`/api/service-tickets/${ticketId}/items`).send({ item_type: "part", product_id: 1, quantity: 2, unit_price: 2000 });
    await req.post(`/api/service-tickets/${ticketId}/items`).send({ item_type: "labor", description: "Labor", unit_price: 1500 });

    const res = await req.post(`/api/service-tickets/${ticketId}/send-estimate`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5500); // 2×2000 + 1500

    // activity logged
    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.activities.some((a) => a.activity_type === "note" && /Estimate sent/.test(a.description))).toBe(true);

    // notification dispatched (fire-and-forget) — poll the truth log.
    let rows = [];
    for (let i = 0; i < 20; i++) {
      const r = await db.query(
        "SELECT channel, status FROM customer_notifications WHERE event = 'ticket.estimate_ready' AND entity_id = $1", [ticketId]
      );
      rows = r.rows;
      if (rows.length >= 1) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(rows.length).toBeGreaterThanOrEqual(1); // engine resolved the rule + template
  });
});
