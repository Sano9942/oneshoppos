/**
 * pg-v06-device-intake.test.js — V06 P0 device intake.
 *
 * Against a real isolated Postgres schema:
 *   - ticket_types: 3 seeded defaults, CRUD, delete = deactivate-if-used
 *   - intake: create ticket with ticket_type_id + devices → checklist seeded
 *     from the type template
 *   - passcode: encrypted at rest (enc:v1:...), never in general reads
 *     (has_passcode only), reveal decrypts + logs a passcode_revealed audit row
 *   - device CRUD (add/update/remove) each writes an activity row
 *   - device history lookup by IMEI/serial; ticket search by IMEI/serial/phone
 */

// Set an encryption key BEFORE any require so crypto.js encrypts the passcode
// (getKeyBuffer reads process.env per-call, but set it early to be safe).
process.env.INTEGRATION_SECRET_KEY =
  process.env.INTEGRATION_SECRET_KEY || "a".repeat(64); // 32-byte hex key

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const { createTestApp } = require("../helpers/createTestApp-pg");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

let app, db, deps, cleanup, req;
let customerId;

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

  app.use((r, _res, next) => {
    const eid = r.headers["x-employee-id"];
    if (eid) r.employee = { id: Number(eid) };
    r.tenantSlug = "testco";
    r.company = { company_name: "Fixit Shop", timezone: "UTC" };
    next();
  });

  require("../../routes/service-tickets")(app, deps);
  req = makeRequest(app, ADMIN_ID);

  await setFlag("phase4_workflow_tickets", true);
  await setFlag("customer_notifications", false);

  const { rows } = await db.query(
    "INSERT INTO customers (name, mobile) VALUES ('Device Test', '03215557788') RETURNING id"
  );
  customerId = rows[0].id;
}, 180000);

afterAll(async () => {
  if (cleanup) await cleanup();
}, 30000);

describe("V06 — ticket types (checklist templates)", () => {
  it("lists the 3 seeded defaults", async () => {
    const res = await req.get("/api/service-tickets/types");
    expect(res.status).toBe(200);
    const names = res.body.types.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Screen Replacement", "Battery Replacement", "Water Damage"]));
  });

  it("creates, updates and deletes a custom type", async () => {
    const create = await req.post("/api/service-tickets/types").send({
      name: "Charging Port", checklist_template: ["Powers on", "Charges"], default_warranty_days: 14,
    });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const upd = await req.put(`/api/service-tickets/types/${id}`).send({ name: "Charging Port Repair" });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe("Charging Port Repair");

    // Unused → hard delete.
    const del = await req.delete(`/api/service-tickets/types/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
  });

  it("deactivates (not deletes) a type referenced by a ticket", async () => {
    const t = await req.post("/api/service-tickets/types").send({ name: "Speaker Fix" });
    const typeId = t.body.id;
    const ticket = await req.post("/api/service-tickets").send({ title: "Speaker job", customer_id: customerId, ticket_type_id: typeId });
    expect(ticket.status).toBe(201);

    const del = await req.delete(`/api/service-tickets/types/${typeId}`);
    expect(del.status).toBe(200);
    expect(del.body.deactivated).toBe(true);
    // No longer in the active list, but still exists.
    const active = await req.get("/api/service-tickets/types");
    expect(active.body.types.find((x) => x.id === typeId)).toBeFalsy();
  });
});

describe("V06 — intake with device + checklist seeding", () => {
  let ticketId, deviceId, screenTypeId;

  beforeAll(async () => {
    const types = await req.get("/api/service-tickets/types");
    screenTypeId = types.body.types.find((t) => t.name === "Screen Replacement").id;
  });

  it("creates a ticket with a device; checklist is seeded from the type template", async () => {
    const res = await req.post("/api/service-tickets").send({
      title: "Cracked screen intake",
      customer_id: customerId,
      ticket_type_id: screenTypeId,
      deposit_amount: 500,
      deposit_method: "cash",
      devices: [{
        device_type: "Phone", brand: "Apple", model: "iPhone 12",
        imei: "356789101112131", serial_number: "F2LABC123",
        passcode: "1234",
        condition_notes: "front glass shattered",
        accessories: ["charger", "case"],
      }],
    });
    expect(res.status).toBe(201);
    ticketId = res.body.id;

    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.ticket_type_name).toBe("Screen Replacement");
    expect(full.body.devices).toHaveLength(1);
    deviceId = full.body.devices[0].id;

    // checklist keys seeded from the "Screen Replacement" template, values null.
    const checklist = full.body.devices[0].checklist;
    expect(Object.keys(checklist)).toEqual(expect.arrayContaining(["Powers on", "Screen cracked", "LCD intact"]));
    expect(checklist["Powers on"]).toBeNull();
    expect(full.body.devices[0].accessories).toEqual(["charger", "case"]);
  });

  it("never leaks the passcode in reads — only has_passcode", async () => {
    const full = await req.get(`/api/service-tickets/${ticketId}`);
    const dev = full.body.devices[0];
    expect(dev.passcode).toBeUndefined();
    expect(dev.has_passcode).toBe(true);
  });

  it("stores the passcode encrypted at rest (enc:v1:...)", async () => {
    const { rows } = await db.query("SELECT passcode FROM ticket_devices WHERE id = $1", [deviceId]);
    expect(rows[0].passcode).toMatch(/^enc:v1:/);
    expect(rows[0].passcode).not.toContain("1234");
  });

  it("reveal-passcode decrypts to the original and logs an audit row", async () => {
    const res = await req.post(`/api/service-tickets/${ticketId}/devices/${deviceId}/reveal-passcode`);
    expect(res.status).toBe(200);
    expect(res.body.passcode).toBe("1234");

    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.activities.some((a) => a.activity_type === "passcode_revealed")).toBe(true);
  });

  it("updates a device checklist + logs device_updated", async () => {
    const res = await req.put(`/api/service-tickets/${ticketId}/devices/${deviceId}`).send({
      checklist: { "Powers on": true, "Screen cracked": true, "LCD intact": true, "Touch works": false, "Frame bent": false },
    });
    expect(res.status).toBe(200);
    expect(res.body.checklist["Powers on"]).toBe(true);

    const full = await req.get(`/api/service-tickets/${ticketId}`);
    expect(full.body.activities.some((a) => a.activity_type === "device_updated")).toBe(true);
  });
});

describe("V06 — device history + search", () => {
  const IMEI = "999888777666555";
  let firstTicketId;

  beforeAll(async () => {
    const t1 = await req.post("/api/service-tickets").send({
      title: "March water damage", customer_id: customerId,
      devices: [{ brand: "Samsung", model: "S21", imei: IMEI }],
    });
    firstTicketId = t1.body.id;
    // Same physical phone returns later.
    await req.post("/api/service-tickets").send({
      title: "October screen", customer_id: customerId,
      devices: [{ brand: "Samsung", model: "S21", imei: IMEI }],
    });
  });

  it("device-history returns prior tickets for the same IMEI", async () => {
    const res = await req.get(`/api/service-tickets/device-history?imei=${IMEI}`);
    expect(res.status).toBe(200);
    expect(res.body.history.length).toBeGreaterThanOrEqual(2);
    expect(res.body.history.every((h) => h.imei === IMEI)).toBe(true);
  });

  it("device-history can exclude the current ticket", async () => {
    const res = await req.get(`/api/service-tickets/device-history?imei=${IMEI}&exclude=${firstTicketId}`);
    expect(res.body.history.every((h) => h.ticket_id !== firstTicketId)).toBe(true);
  });

  it("ticket search matches on device IMEI", async () => {
    const res = await req.get(`/api/service-tickets?search=${IMEI}`);
    expect(res.status).toBe(200);
    expect(res.body.tickets.length).toBeGreaterThanOrEqual(2);
  });

  it("ticket search matches on customer phone", async () => {
    const res = await req.get("/api/service-tickets?search=03215557788");
    expect(res.body.tickets.length).toBeGreaterThan(0);
  });

  it("removes a device + logs device_removed", async () => {
    const t = await req.post("/api/service-tickets").send({
      title: "To be removed", customer_id: customerId,
      devices: [{ brand: "LG", model: "G8" }],
    });
    const full = await req.get(`/api/service-tickets/${t.body.id}`);
    const devId = full.body.devices[0].id;

    const del = await req.delete(`/api/service-tickets/${t.body.id}/devices/${devId}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    const after = await req.get(`/api/service-tickets/${t.body.id}`);
    expect(after.body.devices).toHaveLength(0);
    expect(after.body.activities.some((a) => a.activity_type === "device_removed")).toBe(true);
  });
});
