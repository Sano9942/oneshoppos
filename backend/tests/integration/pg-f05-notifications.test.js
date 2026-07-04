/**
 * pg-f05-notifications.test.js — F05 customer notification engine integration.
 *
 * Covers (against a real isolated Postgres schema, no external providers):
 *   - notification_rules seeded by schema-pg.sql (default repair-ticket + reminder rules)
 *   - notification-settings CRUD: list / upsert / patch / delete / status
 *   - repair-ticket status transition fires the engine and writes a truthful
 *     customer_notifications row (skipped when no provider — never a false 'sent')
 *   - central feature-flag gate: flag OFF → no dispatch, no rows
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
let customerId, ticketId;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = $2`,
    [key, enabled]
  );
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  if (invalidateFeatureFlagCache) invalidateFeatureFlagCache(null);
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app;
  db = result.db;
  deps = result.deps;
  cleanup = result.cleanup;

  require("../../middleware/feature-flags").init({ db });

  // Inject the request context the tenant middleware would normally set.
  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco";
    r.company = { company_name: "Fixit Shop", phone: "042-111", timezone: "UTC" };
    next();
  });

  require("../../routes/notification-settings")(app, deps);
  require("../../routes/service-tickets")(app, deps);

  req = makeRequest(app, ADMIN_ID);

  await setFlag("customer_notifications", true);
  await setFlag("phase4_workflow_tickets", true);

  // Customer with a mobile but NO email — so the email rule logs 'skipped'
  // (no recipient, no pg-boss) and the sms rule logs 'skipped' (no provider).
  const { rows } = await db.query(
    "INSERT INTO customers (name, mobile) VALUES ('Notify Test', '03001234567') RETURNING id"
  );
  customerId = rows[0].id;
}, 180000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("F05 — default rules seeded by schema", () => {
  it("ships the repair-ticket + appointment-reminder rules", async () => {
    const res = await req.get("/api/notification-settings/rules");
    expect(res.status).toBe(200);
    const events = res.body.rules.map((r) => `${r.event}:${r.channel}`);
    expect(events).toContain("ticket.status_changed:completed:sms");
    expect(events).toContain("ticket.status_changed:completed:email");
    expect(events).toContain("appointment.reminder:sms");
  });

  it("reports feature status + available templates", async () => {
    const res = await req.get("/api/notification-settings/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.channels).toHaveProperty("sms");
    expect(res.body.available_templates.sms).toContain("ticket_completed");
  });
});

describe("F05 — rules CRUD", () => {
  let ruleId;
  it("upserts a rule (idempotent on event+channel)", async () => {
    const body = { event: "ticket.status_changed:on_hold", channel: "email", template_key: "ticket_approved", enabled: true };
    const res = await req.put("/api/notification-settings/rules").send(body);
    expect(res.status).toBe(201);
    ruleId = res.body.id;
    // Upsert again → same row, no duplicate
    const res2 = await req.put("/api/notification-settings/rules").send({ ...body, enabled: false });
    expect(res2.body.id).toBe(ruleId);
    expect(res2.body.enabled).toBe(false);
  });

  it("patches enabled", async () => {
    const res = await req.patch(`/api/notification-settings/rules/${ruleId}`).send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it("deletes a rule", async () => {
    const res = await req.delete(`/api/notification-settings/rules/${ruleId}`);
    expect(res.status).toBe(200);
    const res2 = await req.delete(`/api/notification-settings/rules/${ruleId}`);
    expect(res2.status).toBe(404);
  });
});

describe("F05 — repair-ticket status notification", () => {
  it("creates a ticket then fires a truthful notification on 'completed'", async () => {
    const create = await req.post("/api/service-tickets").send({ title: "Cracked screen", customer_id: customerId });
    expect(create.status).toBe(201);
    ticketId = create.body.id;

    const upd = await req.put(`/api/service-tickets/${ticketId}`).send({ status: "completed" });
    expect(upd.status).toBe(200);

    // Notification dispatch is fire-and-forget — poll briefly for the log rows.
    let rows = [];
    for (let i = 0; i < 20; i++) {
      const r = await db.query(
        "SELECT channel, status FROM customer_notifications WHERE event = 'ticket.status_changed:completed' AND entity_id = $1 ORDER BY channel",
        [ticketId]
      );
      rows = r.rows;
      if (rows.length >= 2) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const byChannel = Object.fromEntries(rows.map((x) => [x.channel, x.status]));
    // email rule: no recipient (customer has no email) → skipped, no pg-boss.
    expect(byChannel.email).toBe("skipped");
    // sms rule: no provider configured → skipped (NOT a false 'sent', NOT 'failed').
    expect(byChannel.sms).toBe("skipped");
  });

  it("writes an auditable 'skipped' (rule disabled) row when a rule is switched off", async () => {
    // Disable the sms rule for 'completed', then walk a fresh ticket to completed.
    const rulesRes = await req.get("/api/notification-settings/rules");
    const smsRule = rulesRes.body.rules.find(
      (r) => r.event === "ticket.status_changed:completed" && r.channel === "sms"
    );
    await req.put("/api/notification-settings/rules").send({
      event: smsRule.event, channel: "sms", template_key: smsRule.template_key, enabled: false,
    });

    const create = await req.post("/api/service-tickets").send({ title: "Battery swap", customer_id: customerId });
    const tid = create.body.id;
    await req.put(`/api/service-tickets/${tid}`).send({ status: "completed" });

    let smsRow = null;
    for (let i = 0; i < 20; i++) {
      const r = await db.query(
        "SELECT status, error FROM customer_notifications WHERE event = 'ticket.status_changed:completed' AND channel = 'sms' AND entity_id = $1",
        [tid]
      );
      smsRow = r.rows[0];
      if (smsRow) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(smsRow).toBeTruthy();
    expect(smsRow.status).toBe("skipped");
    expect(smsRow.error).toMatch(/rule disabled/);

    // Restore the rule for later assertions.
    await req.put("/api/notification-settings/rules").send({
      event: smsRule.event, channel: "sms", template_key: smsRule.template_key, enabled: true,
    });
  });

  it("does NOT dispatch when the feature flag is off (central gate)", async () => {
    await setFlag("customer_notifications", false);
    const upd = await req.put(`/api/service-tickets/${ticketId}`).send({ status: "in_progress" });
    expect(upd.status).toBe(200);
    await new Promise((res) => setTimeout(res, 300));
    const r = await db.query(
      "SELECT count(*)::int c FROM customer_notifications WHERE event = 'ticket.status_changed:in_progress' AND entity_id = $1",
      [ticketId]
    );
    expect(r.rows[0].c).toBe(0);
    await setFlag("customer_notifications", true);
  });
});
