/**
 * pg-room-deposit-sandbox.test.js — Covers room deposit pre-auth through the
 * SanoPay sandbox adapter plus the cancel-and-release path.
 *
 * Why this file exists: pg-room-bookings.test.js mentions "deposit pre-auth
 * with sandbox adapter" in its docstring but does not actually exercise the
 * sandbox adapter — its deposit flow uses deposit_collected + deposit_method
 * columns (cash/manual capture). This test fills that gap and verifies the
 * services/room-deposits.js code path end-to-end.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Rooms — sandbox deposit pre-auth + release", () => {
  let app, db, deps, cleanup;
  let deluxeTypeId, roomId, bookingId;

  beforeAll(async () => {
    process.env.PAYMENT_GATEWAY = "sandbox";
    process.env.SANDBOX_WEBHOOK_SECRET = "test-sandbox-secret";

    ({ app, db, deps, cleanup } = await createTestApp());
    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db });
    require("../../middleware/permissions");

    // Pre-seed room_management mode so the wave-b gate passes.
    await db.query(
      `INSERT INTO tenant_modes (mode, enabled) VALUES ('room_management', true)
       ON CONFLICT (mode) DO UPDATE SET enabled = EXCLUDED.enabled`
    );
    featureFlags.invalidateModeCache();

    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rooms")(app, deps);
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
    delete process.env.PAYMENT_GATEWAY;
    delete process.env.SANDBOX_WEBHOOK_SECRET;
  });

  const authHeaders = { "x-employee-id": "1" };

  it("1. provisions a room type, room, and booking", async () => {
    const type = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Deluxe Suite",
      capacity: 2,
      base_rate: 15000,
      deposit_required: 5000,
    });
    expect(type.status).toBe(201);
    deluxeTypeId = type.body.id;

    const room = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: deluxeTypeId,
      outlet_id: 1,
      room_number: "301",
      floor: "3",
    });
    expect(room.status).toBe(201);
    roomId = room.body.id;

    const booking = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: deluxeTypeId,
      room_id: roomId,
      check_in_date: "2026-08-01",
      check_out_date: "2026-08-03",
    });
    expect(booking.status).toBe(201);
    bookingId = booking.body.id;
  });

  it("2. POST /deposit/preauth creates sandbox checkout + persists gateway_ref", async () => {
    const res = await request(app)
      .post(`/api/room-bookings/${bookingId}/deposit/preauth`)
      .set(authHeaders)
      .send({ amount: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.gateway_ref).toMatch(/^sandbox_/);
    expect(res.body.checkout_url).toContain("/api/sandbox/pay/");
    expect(Number(res.body.amount)).toBe(5000);

    // Booking row should carry the gateway_ref and deposit_status=pending.
    const { rows } = await db.query(
      "SELECT deposit_payment_intent_id, deposit_status FROM room_bookings WHERE id = $1",
      [bookingId]
    );
    expect(rows[0].deposit_payment_intent_id).toBe(res.body.gateway_ref);
    expect(rows[0].deposit_status).toBe("pending");
  });

  it("3. cancel-and-release path: authorized deposit is released (not captured)", async () => {
    // Simulate webhook authorization success so deposit_status transitions
    // from 'pending' → 'authorized' (mirrors handleDepositWebhook logic).
    await db.query(
      "UPDATE room_bookings SET deposit_status = 'authorized' WHERE id = $1",
      [bookingId]
    );

    const {
      captureDepositOnCheckout,
    } = require("../../services/room-deposits");

    // Clean check-out — no damage/extras → release the pre-auth.
    const released = await captureDepositOnCheckout(db, bookingId, { capture: false });
    expect(released).toEqual({ deposit_status: "released" });

    const { rows } = await db.query(
      "SELECT deposit_status FROM room_bookings WHERE id = $1",
      [bookingId]
    );
    expect(rows[0].deposit_status).toBe("released");
  });
});
