/**
 * pg-v06-warranty.test.js — V06 P1 warranty tracking.
 *
 *   - completing a ticket stamps warranty_until from the ticket type's
 *     default_warranty_days (or an explicit override)
 *   - a same-IMEI device returning inside the window shows in_warranty=true via
 *     device-history; outside the window (or never warrantied) shows false
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
let customerId, screenTypeId;

async function setFlag(key, enabled) {
  await db.query(
    `INSERT INTO feature_flags (key, enabled) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET enabled = $2`, [key, enabled]
  );
  const { invalidateFeatureFlagCache } = require("../../middleware/feature-flags");
  if (invalidateFeatureFlagCache) invalidateFeatureFlagCache(null);
}

async function complete(ticketId, extra = {}) {
  await req.put(`/api/service-tickets/${ticketId}`).send({ status: "approved" });
  await req.put(`/api/service-tickets/${ticketId}`).send({ status: "in_progress" });
  return req.put(`/api/service-tickets/${ticketId}`).send({ status: "completed", ...extra });
}

beforeAll(async () => {
  const result = await createTestApp();
  app = result.app; db = result.db; deps = result.deps; cleanup = result.cleanup;
  require("../../middleware/feature-flags").init({ db });
  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco"; r.company = { company_name: "Fixit", timezone: "UTC" };
    next();
  });
  require("../../routes/service-tickets")(app, deps);
  req = makeRequest(app, ADMIN_ID);
  await setFlag("phase4_workflow_tickets", true);
  await setFlag("customer_notifications", false);
  const { rows } = await db.query("INSERT INTO customers (name) VALUES ('Warranty Test') RETURNING id");
  customerId = rows[0].id;
  const types = await req.get("/api/service-tickets/types");
  screenTypeId = types.body.types.find((t) => t.name === "Screen Replacement").id; // 30-day default
}, 180000);

afterAll(async () => { if (cleanup) await cleanup(); }, 30000);

describe("V06 — warranty stamped at completion", () => {
  it("uses the ticket type's default_warranty_days", async () => {
    const create = await req.post("/api/service-tickets").send({
      title: "Screen job", customer_id: customerId, ticket_type_id: screenTypeId,
      devices: [{ imei: "111222333444555", brand: "Apple", model: "iPhone 13" }],
    });
    const ticketId = create.body.id;
    await complete(ticketId);
    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.warranty_days).toBe(30);
    expect(full.body.warranty_until).toBeTruthy();
    // warranty_until ~ today + 30d
    const days = Math.round((new Date(full.body.warranty_until) - new Date()) / 86400000);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it("honours an explicit warranty_days override at completion", async () => {
    const create = await req.post("/api/service-tickets").send({
      title: "Custom warranty", customer_id: customerId, ticket_type_id: screenTypeId,
    });
    const res = await complete(create.body.id, { warranty_days: 90 });
    expect(res.status).toBe(200);
    const full = await req.get(`/api/service-tickets/${create.body.id}`);
    expect(full.body.warranty_days).toBe(90);
  });
});

describe("V06 — warranty return detection via device-history", () => {
  it("flags a same-IMEI return inside the warranty window", async () => {
    const IMEI = "777666555444333";
    const first = await req.post("/api/service-tickets").send({
      title: "First repair", customer_id: customerId, ticket_type_id: screenTypeId,
      devices: [{ imei: IMEI, brand: "Samsung", model: "S22" }],
    });
    await complete(first.body.id); // warranty 30d

    const hist = await req.get(`/api/service-tickets/device-history?imei=${IMEI}`);
    const prior = hist.body.history.find((h) => h.ticket_id === first.body.id);
    expect(prior).toBeTruthy();
    expect(prior.in_warranty).toBe(true);
    expect(prior.warranty_until).toBeTruthy();
  });

  it("a device that was never warrantied is not in_warranty", async () => {
    const IMEI = "000111000111000";
    const t = await req.post("/api/service-tickets").send({
      title: "No warranty yet", customer_id: customerId,
      devices: [{ imei: IMEI }],
    });
    // not completed → no warranty stamped
    const hist = await req.get(`/api/service-tickets/device-history?imei=${IMEI}`);
    const prior = hist.body.history.find((h) => h.ticket_id === t.body.id);
    expect(prior.in_warranty).toBe(false);
  });
});
