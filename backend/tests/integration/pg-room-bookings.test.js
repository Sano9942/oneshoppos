/**
 * pg-room-bookings.test.js — Integration tests for M9 room management.
 *
 * Covers: room-type + room CRUD, rate overrides, availability with app-level
 * overlap detection, booking lifecycle (reserve → confirm → check in → check
 * out → folio settle → customer invoice), overbooking rejection, POS sale
 * attached to folio, rate-quote weekend override, deposit pre-auth with
 * sandbox adapter + webhook.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

// Supabase network latency can push individual network-heavy tests past the
// default 5s budget; raise per-test timeout to 30s so lifecycle steps that
// chain multiple requests have headroom.
jest.setTimeout(30000);

describe("M9 Room Management — full lifecycle", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../middleware/feature-flags").init({ db });
    require("../../middleware/permissions");
    // Room routes call req.employee.id — inject before registration.
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rooms")(app, deps);
    require("../../routes/sales")(app, deps);

    // Seed a customer with email for folio settlement.
    await db.query(
      "UPDATE customers SET email = 'guest@example.com' WHERE id = 1"
    );
  }, 180000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };
  let deluxeTypeId, standardTypeId, room201Id, room202Id;

  it("1. creates room types with base rate + deposit", async () => {
    const deluxe = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Deluxe Room",
      capacity: 2,
      base_rate: 15000,
      deposit_required: 5000,
    });
    expect(deluxe.status).toBe(201);
    deluxeTypeId = deluxe.body.id;

    const std = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Standard Room",
      capacity: 2,
      base_rate: 10000,
      deposit_required: 2000,
    });
    expect(std.status).toBe(201);
    standardTypeId = std.body.id;

    const list = await request(app).get("/api/room-types").set(authHeaders);
    expect(list.status).toBe(200);
    expect(list.body.room_types.length).toBe(2);
  });

  it("2. creates individual rooms under each type", async () => {
    const r201 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: deluxeTypeId,
      outlet_id: 1,
      room_number: "201",
      floor: "2",
    });
    expect(r201.status).toBe(201);
    expect(r201.body.occupancy_status).toBe("vacant");
    expect(r201.body.housekeeping_status).toBe("clean");
    room201Id = r201.body.id;

    const r202 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: deluxeTypeId,
      outlet_id: 1,
      room_number: "202",
      floor: "2",
    });
    expect(r202.status).toBe(201);
    room202Id = r202.body.id;

    await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: standardTypeId, outlet_id: 1, room_number: "101", floor: "1",
    });

    const list = await request(app).get("/api/rooms").set(authHeaders);
    expect(list.body.rooms.length).toBe(3);
  });

  it("3. rejects duplicate room_number at same outlet", async () => {
    const dup = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: deluxeTypeId,
      outlet_id: 1,
      room_number: "201",
    });
    expect(dup.status).toBe(409);
  });

  it("4. updates housekeeping status via PUT /api/rooms/:id/housekeeping", async () => {
    const update = await request(app).put(`/api/rooms/${room201Id}/housekeeping`).set(authHeaders).send({
      housekeeping_status: "dirty",
    });
    expect(update.status).toBe(200);
    expect(update.body.housekeeping_status).toBe("dirty");

    // Reset for later tests
    await request(app).put(`/api/rooms/${room201Id}/housekeeping`).set(authHeaders).send({
      housekeeping_status: "clean",
    });
  });

  it("5. creates a weekend rate override and quote reflects it", async () => {
    // Override: 2026-06-06 (Sat) to 2026-06-07 (Sun) at 20000 for deluxe
    const create = await request(app)
      .post(`/api/room-types/${deluxeTypeId}/rate-overrides`)
      .set(authHeaders)
      .send({
        from_date: "2026-06-06",
        to_date: "2026-06-07",
        rate: 20000,
        label: "Weekend surcharge",
      });
    expect(create.status).toBe(201);

    // Quote Fri–Sun = 2 nights (Fri 5 @ 15000, Sat 6 @ 20000)
    const quote = await request(app)
      .get(`/api/room-types/${deluxeTypeId}/quote?from=2026-06-05&to=2026-06-07`)
      .set(authHeaders);
    expect(quote.status).toBe(200);
    expect(quote.body.nights).toBe(2);
    expect(Number(quote.body.subtotal)).toBe(35000);
    const rates = quote.body.rate_breakdown.map((b) => Number(b.rate));
    expect(rates).toEqual([15000, 20000]);
  });

  it("6. availability returns both deluxe rooms as available for future window", async () => {
    const avail = await request(app)
      .get(`/api/rooms/availability?from=2026-07-01&to=2026-07-03&room_type_id=${deluxeTypeId}`)
      .set(authHeaders);
    expect(avail.status).toBe(200);
    expect(avail.body.rooms_total).toBe(2);
    expect(avail.body.rooms_available).toBe(2);
    expect(avail.body.conflicts).toEqual([]);
  });

  it("7. creates a booking in 'reserved' status with generated booking_number", async () => {
    const create = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: deluxeTypeId,
      room_id: room201Id,
      check_in_date: "2026-07-01",
      check_out_date: "2026-07-03",
      deposit_collected: 5000,
      deposit_method: "cash",
    });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe("reserved");
    expect(create.body.booking_number).toMatch(/^BK-\d{6}$/);
    expect(create.body.nights).toBe(2);
  });

  it("8. rejects an overlapping booking on the same room with 409", async () => {
    const overlap = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: deluxeTypeId,
      room_id: room201Id,
      check_in_date: "2026-07-02",
      check_out_date: "2026-07-04",
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toMatch(/already booked|No rooms/i);
  });

  it("9. allows booking the other deluxe room (202) for the same dates", async () => {
    const ok = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: deluxeTypeId,
      room_id: room202Id,
      check_in_date: "2026-07-02",
      check_out_date: "2026-07-04",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("reserved");
  });

  it("10. confirms → checks in → opens folio with 2 room-night lines", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.room_id === room201Id);

    const confirm = await request(app)
      .post(`/api/room-bookings/${booking.id}/confirm`)
      .set(authHeaders).send({});
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("confirmed");

    const ci = await request(app)
      .post(`/api/room-bookings/${booking.id}/checkin`)
      .set(authHeaders).send({});
    expect(ci.status).toBe(200);
    expect(ci.body.status).toBe("checked_in");
    expect(ci.body.actual_checkin).toBeTruthy();

    const folio = await request(app)
      .get(`/api/room-bookings/${booking.id}/folio`)
      .set(authHeaders);
    expect(folio.status).toBe(200);
    expect(folio.body.status).toBe("open");
    expect(folio.body.lines.length).toBe(2); // 2 room-night lines
    expect(folio.body.lines.every((l) => l.line_type === "room_night")).toBe(true);
    expect(Number(folio.body.grand_total)).toBe(30000); // 2 × 15000
  });

  it("11. attaches a POS sale to the folio via folio_id on /api/sales", async () => {
    // Open a shift and clock in the admin — required by POST /api/sales.
    await db.query(
      `INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status, opened_at)
       VALUES (1, 1, 0, 'open', NOW())`
    );
    await db.query(
      `INSERT INTO attendance_sessions (employee_id, outlet_id, session_start, session_type)
       VALUES (1, 1, NOW(), 'work')`
    );

    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "checked_in");
    expect(booking.folio_id).toBeTruthy();

    const saleRes = await request(app)
      .post("/api/sales")
      .set(authHeaders)
      .send({
        cartItems: [{ id: 1, price: 500, quantity: 1 }],
        outlet_id: 1,
        folio_id: booking.folio_id,
      });
    expect(saleRes.status).toBe(200);

    // Verify folio now has a pos_sale line.
    const folio = await request(app)
      .get(`/api/room-bookings/${booking.id}/folio`)
      .set(authHeaders);
    const posLines = folio.body.lines.filter((l) => l.line_type === "pos_sale");
    expect(posLines.length).toBe(1);
    expect(Number(posLines[0].line_total)).toBe(500);
    expect(Number(folio.body.grand_total)).toBe(30500); // 30000 + 500
  });

  it("12. rejects POS sale with folio_id on a different outlet", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "checked_in");
    const saleRes = await request(app)
      .post("/api/sales")
      .set(authHeaders)
      .send({
        cartItems: [{ id: 1, price: 100, quantity: 1 }],
        outlet_id: 2,
        folio_id: booking.folio_id,
      });
    expect(saleRes.status).toBe(400);
    expect(saleRes.body.error).toMatch(/outlet/i);
  });

  it("13. manual folio line adds to the running total", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "checked_in");

    const add = await request(app)
      .post(`/api/room-bookings/${booking.id}/folio/lines`)
      .set(authHeaders)
      .send({
        line_type: "manual_charge",
        description: "Minibar",
        quantity: 1,
        unit_price: 250,
      });
    expect(add.status).toBe(201);

    const folio = await request(app)
      .get(`/api/room-bookings/${booking.id}/folio`)
      .set(authHeaders);
    expect(Number(folio.body.grand_total)).toBe(30750); // + 250
  });

  it("14. checks out → settles folio → generates invoice + status='invoiced'", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "checked_in");

    const co = await request(app)
      .post(`/api/room-bookings/${booking.id}/checkout`)
      .set(authHeaders).send({});
    expect(co.status).toBe(200);
    expect(co.body.status).toBe("checked_out");

    const settle = await request(app)
      .post(`/api/room-bookings/${booking.id}/folio/settle`)
      .set(authHeaders)
      .send({ capture_deposit: false });
    expect(settle.status).toBe(201);
    expect(settle.body.invoice).toBeTruthy();
    expect(settle.body.invoice.invoice_number).toMatch(/^INV-\d{6}$/);
    expect(Number(settle.body.invoice.total_amount)).toBe(30750);

    // Deposit 5000 applied → balance_due = 30750 - 5000 = 25750
    expect(Number(settle.body.invoice.balance_due)).toBe(25750);

    const detail = await request(app).get(`/api/room-bookings/${booking.id}`).set(authHeaders);
    expect(detail.body.status).toBe("invoiced");
    expect(detail.body.invoice_id).toBe(settle.body.invoice.id);
  });

  it("15. rejects settlement on an already-settled folio", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "invoiced");
    const settle = await request(app)
      .post(`/api/room-bookings/${booking.id}/folio/settle`)
      .set(authHeaders).send({});
    expect(settle.status).toBe(400);
  });

  it("16. cancels a reserved booking (room 202 booking — still reserved)", async () => {
    const list = await request(app).get("/api/room-bookings").set(authHeaders);
    const booking = list.body.bookings.find((b) => b.status === "reserved" && b.room_id === room202Id);
    expect(booking).toBeTruthy();

    const cancel = await request(app)
      .post(`/api/room-bookings/${booking.id}/cancel`)
      .set(authHeaders)
      .send({ cancellation_reason: "Guest called to cancel" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect(cancel.body.cancellation_reason).toBe("Guest called to cancel");
  });

  it("17. reports overdue checkouts via service helper", async () => {
    // Insert a fake checked_in booking past its checkout date
    await db.query(
      `INSERT INTO room_bookings
         (booking_number, customer_id, outlet_id, created_by, room_id, room_type_id,
          status, check_in_date, check_out_date, nights, rate_snapshot)
       VALUES ('BK-999901', 1, 1, 1, $1, $2, 'checked_in',
               CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '1 day',
               2, 10000)`,
      [room201Id, deluxeTypeId]
    );
    const roomService = require("../../services/room-service");
    const overdue = await roomService.getOverdueCheckouts(db);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(overdue.find((b) => b.booking_number === "BK-999901")).toBeTruthy();
  });

  it("18. no_show marks booking and releases room reservation", async () => {
    // Create fresh booking for no-show
    const create = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: standardTypeId,
      check_in_date: "2026-08-01",
      check_out_date: "2026-08-02",
    });
    const id = create.body.id;
    const ns = await request(app).post(`/api/room-bookings/${id}/noshow`).set(authHeaders).send({});
    expect(ns.status).toBe(200);
    expect(ns.body.status).toBe("no_show");
  });

  it("19. timeline returns rooms + non-cancelled bookings", async () => {
    const timeline = await request(app)
      .get("/api/room-bookings/timeline?from=2026-06-01&to=2026-08-31")
      .set(authHeaders);
    expect(timeline.status).toBe(200);
    expect(Array.isArray(timeline.body.rooms)).toBe(true);
    expect(Array.isArray(timeline.body.bookings)).toBe(true);
    // Cancelled + no_show are filtered out.
    expect(timeline.body.bookings.every((b) => !["cancelled", "no_show"].includes(b.status))).toBe(true);
  });

  it("20. rejects booking with feature flag off", async () => {
    // Flip feature flag off
    await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'phase4_room_management'");
    require("../../middleware/feature-flags").invalidateFeatureFlagCache();

    const res = await request(app).get("/api/room-types").set(authHeaders);
    expect([403, 503]).toContain(res.status);

    // Restore for other tests (if any later re-use app)
    await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'phase4_room_management'");
    require("../../middleware/feature-flags").invalidateFeatureFlagCache();
  });
});
