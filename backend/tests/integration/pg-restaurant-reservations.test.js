/**
 * pg-restaurant-reservations.test.js — Phase 2-R Wave D / 2-R.4
 *
 * Reservations + waitlist: admin CRUD, public booking, SMS dispatch,
 * and the reminder worker's runOnce tenant-scoped handler.
 */

const { MIGRATIONS } = require("../../migrate-pg");
delete process.env.MULTI_TENANT;

const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

// Stub SMS on the real module — vi.mock is unreliable against CJS, so we
// overwrite the module-level sendSms export with a spy that captures calls.
const smsCalls = [];
const smsModule = require("../../services/sms");
const _originalSendSms = smsModule.sendSms;
smsModule.sendSms = async (_db, args) => { smsCalls.push(args); return { sent: true }; };

vi.setConfig({ testTimeout: 30000, hookTimeout: 300000 });

describe("Phase 2-R.4 — Reservations + waitlist", () => {
  let app, db, deps, cleanup, schemaName;

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    const v61 = MIGRATIONS.find((m) => m.version === 61);
    await v61.up(await db.getClient());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/restaurant/reservations")(app, deps);
    require("../../routes/restaurant/waitlist")(app, deps);
    require("../../routes/public-reservations")(app, deps);

    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('restaurant', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = true`
    );
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_reservations', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    featureFlags.invalidateFeatureFlagCache();
    featureFlags.invalidateModeCache();
  });

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    smsModule.sendSms = _originalSendSms;
    if (cleanup) await cleanup();
  });

  afterEach(() => { smsCalls.length = 0; });

  it("POST reservation → status pending, PUT confirm + send SMS → sms_confirmed_at set", async () => {
    const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    const createRes = await request(app)
      .post("/api/restaurant/reservations")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({
        customer_name: "Hussain",
        phone: "03001234567",
        party_size: 4,
        reservation_start: future,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("pending");

    const id = createRes.body.id;
    const updateRes = await request(app)
      .put(`/api/restaurant/reservations/${id}`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ status: "confirmed" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("confirmed");

    const smsRes = await request(app)
      .post(`/api/restaurant/reservations/${id}/send-sms`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ template: "confirmation" });
    expect(smsRes.status).toBe(200);
    expect(smsCalls.length).toBe(1);
    expect(smsCalls[0].body).toMatch(/confirmed/i);

    const { rows: [row] } = await db.query(
      `SELECT sms_confirmed_at FROM reservations WHERE id = $1`,
      [id]
    );
    expect(row.sms_confirmed_at).toBeTruthy();
  });

  it("Public /availability excludes a slot that already has a booking", async () => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 2);
    const dateStr = date.toISOString().slice(0, 10);

    // Book 19:00.
    const bookingTime = new Date(date);
    bookingTime.setUTCHours(19, 0, 0, 0);
    await db.query(
      `INSERT INTO reservations (customer_name, party_size, reservation_start, status)
       VALUES ('Blocker', 2, $1, 'confirmed')`,
      [bookingTime.toISOString()]
    );

    const res = await request(app)
      .get(`/api/public/restaurant/reservations/any/availability?date=${dateStr}`)
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(200);
    const slot19 = res.body.slots.find((s) => s.time === "19:00");
    expect(slot19).toBeTruthy();
    expect(slot19.available).toBe(false);

    const slot20 = res.body.slots.find((s) => s.time === "20:00");
    expect(slot20.available).toBe(true);
  });

  it("Waitlist add/notify/seat compacts positions and fires SMS on notify", async () => {
    // Clear for a clean slate.
    await db.query(`DELETE FROM waitlist_entries`);

    const a = await request(app)
      .post("/api/restaurant/waitlist")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ customer_name: "Alice", phone: "03111", party_size: 2 });
    const b = await request(app)
      .post("/api/restaurant/waitlist")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ customer_name: "Bob", phone: "03222", party_size: 3 });
    const c = await request(app)
      .post("/api/restaurant/waitlist")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({ customer_name: "Chen", phone: "03333", party_size: 2 });
    expect(a.body.position).toBe(1);
    expect(b.body.position).toBe(2);
    expect(c.body.position).toBe(3);

    // Notify Bob (second in queue) — should fire SMS.
    const notifyRes = await request(app)
      .put(`/api/restaurant/waitlist/${b.body.id}/notify`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(notifyRes.status).toBe(200);
    expect(notifyRes.body.status).toBe("notified");
    expect(smsCalls.length).toBe(1);
    expect(smsCalls[0].to).toBe("03222");

    // Seat Alice (first) — remaining queue should compact to 1, 2.
    const seatRes = await request(app)
      .put(`/api/restaurant/waitlist/${a.body.id}/seat`)
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName)
      .send({});
    expect(seatRes.status).toBe(200);
    expect(seatRes.body.status).toBe("seated");

    const listRes = await request(app)
      .get("/api/restaurant/waitlist?status=waiting,notified")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(listRes.body.entries.length).toBe(2);
    const positions = listRes.body.entries.map((e) => e.position).sort();
    expect(positions).toEqual([1, 2]);
  });

  it("Feature flag off returns 503", async () => {
    const featureFlags = require("../../middleware/feature-flags");
    await db.query(
      `INSERT INTO feature_flags (key, enabled) VALUES ('phase4_restaurant_reservations', false)
       ON CONFLICT (key) DO UPDATE SET enabled = false`
    );
    featureFlags.invalidateFeatureFlagCache();

    const res = await request(app)
      .get("/api/restaurant/reservations")
      .set("x-employee-id", "1")
      .set("x-tenant-schema", schemaName);
    expect(res.status).toBe(503);

    // Restore for downstream tests.
    await db.query(
      `UPDATE feature_flags SET enabled = true WHERE key = 'phase4_restaurant_reservations'`
    );
    featureFlags.invalidateFeatureFlagCache();
  });
});
