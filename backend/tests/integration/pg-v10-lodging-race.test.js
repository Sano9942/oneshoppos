/**
 * pg-v10-lodging-race.test.js — V10 task 1: the createBooking race.
 *
 * Proves the advisory-lock choke point with a TRUE parallel run: two
 * independent pool clients (separate Postgres sessions, search_path pinned to
 * the test schema) race createBooking for the last room / last bed —
 * pg_advisory_xact_lock(room_type) serializes them, so exactly one wins and
 * the loser gets the 409 from the availability re-check behind the lock.
 *
 * Also covers: back-to-back stays (checkout-day-exclusive overlap math),
 * dorm-parent bookability guard, and the unpaid-reservation TTL (availability
 * ignores expired holds + the sweep formalizes the cancel).
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const rooms = require("../../services/room-service");

vi.setConfig({ testTimeout: 30000 });

describe("V10 Lodging — booking race + overlap math + TTL", () => {
  let app, db, deps, cleanup, schemaName;
  const raceClients = [];

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());
    require("../../middleware/feature-flags").init({ db });
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });
    require("../../routes/rooms")(app, deps);
  }, 180000);

  afterAll(async () => {
    for (const c of raceClients) {
      try { c.release(); } catch { /* already released */ }
    }
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };
  let typeId, roomId, dormTypeId, dormId, bed1Id, bed2Id;

  /** A real second/third Postgres session scoped to the test schema. */
  async function checkoutRaceDb() {
    const { pool } = require("../../db-pg");
    const client = await pool.connect();
    raceClients.push(client);
    await client.query(`SET search_path TO "${schemaName}", public`);
    return {
      query: (text, params) => client.query(text, params),
      transaction: async (fn) => {
        await client.query("BEGIN");
        try {
          const out = await fn({ query: (t, p) => client.query(t, p) });
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      },
    };
  }

  it("seeds a type with ONE room", async () => {
    const rt = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Only Suite", capacity: 2, base_rate: 5000,
    });
    expect(rt.status).toBe(201);
    typeId = rt.body.id;
    const r = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: typeId, outlet_id: 1, room_number: "R1",
    });
    expect(r.status).toBe(201);
    roomId = r.body.id;
  });

  it("RACE: two parallel bookings of the last room → exactly one winner", async () => {
    const dbA = await checkoutRaceDb();
    const dbB = await checkoutRaceDb();
    const payload = {
      customer_id: 1,
      room_type_id: typeId,
      check_in_date: "2027-03-10",
      check_out_date: "2027-03-12",
    };
    const results = await Promise.allSettled([
      rooms.createBooking(dbA, payload, 1),
      rooms.createBooking(dbB, payload, 1),
    ]);
    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r) => r.status === "rejected");
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].reason.statusCode).toBe(409);

    // Exactly one live booking row exists for the window.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM room_bookings
       WHERE room_id = $1 AND status = 'reserved'
         AND check_in_date = '2027-03-10'`,
      [roomId]
    );
    expect(rows[0].n).toBe(1);
  });

  it("back-to-back stays on one room are allowed (checkout day exclusive)", async () => {
    // Winner above holds 03-10 → 03-12. A stay starting on the checkout day
    // must be accepted — the guest leaves at 11am, room resells that night.
    const res = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1,
      room_type_id: typeId,
      room_id: roomId,
      check_in_date: "2027-03-12",
      check_out_date: "2027-03-14",
    });
    expect(res.status).toBe(201);
  });

  it("hostel: seeds a 2-bed dorm; the dorm parent itself is NOT bookable", async () => {
    const rt = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "8-Bed Mixed Dorm", capacity: 1, base_rate: 800,
    });
    dormTypeId = rt.body.id;
    const dorm = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: dormTypeId, outlet_id: 1, room_number: "DORM-A",
    });
    dormId = dorm.body.id;
    // Beds inherit the dorm's type/outlet.
    const b1 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_number: "DORM-A-1", parent_room_id: dormId,
    });
    expect(b1.status).toBe(201);
    expect(b1.body.room_type_id).toBe(dormTypeId);
    bed1Id = b1.body.id;
    const b2 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_number: "DORM-A-2", parent_room_id: dormId,
    });
    bed2Id = b2.body.id;

    // Direct booking of the parent → 400.
    const parentBook = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: dormTypeId, room_id: dormId,
      check_in_date: "2027-04-01", check_out_date: "2027-04-03",
    });
    expect(parentBook.status).toBe(400);
    expect(parentBook.body.error).toMatch(/dorm/i);

    // Availability lists beds, never the parent.
    const avail = await request(app)
      .get(`/api/rooms/availability?from=2027-04-01&to=2027-04-03&room_type_id=${dormTypeId}`)
      .set(authHeaders);
    const ids = avail.body.available.map((r) => r.id);
    expect(ids).toContain(bed1Id);
    expect(ids).toContain(bed2Id);
    expect(ids).not.toContain(dormId);
  });

  it("RACE: concurrent pair for the LAST bed → one winner", async () => {
    // Fill bed 1 first.
    const first = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: dormTypeId, room_id: bed1Id,
      check_in_date: "2027-04-01", check_out_date: "2027-04-03",
    });
    expect(first.status).toBe(201);

    // Two guests race for the one remaining bed (type-level booking).
    const dbA = await checkoutRaceDb();
    const dbB = await checkoutRaceDb();
    const payload = {
      customer_id: 1,
      room_type_id: dormTypeId,
      check_in_date: "2027-04-01",
      check_out_date: "2027-04-03",
    };
    const results = await Promise.allSettled([
      rooms.createBooking(dbA, payload, 1),
      rooms.createBooking(dbB, payload, 1),
    ]);
    const winners = results.filter((r) => r.status === "fulfilled");
    expect(winners.length).toBe(1);
    expect(winners[0].value.room_id).toBe(bed2Id);
    const loser = results.find((r) => r.status === "rejected");
    expect(loser.reason.statusCode).toBe(409);
  });

  it("dorm map shows live bed occupancy", async () => {
    const map = await request(app).get(`/api/rooms/${dormId}/dorm-map`).set(authHeaders);
    expect(map.status).toBe(200);
    expect(map.body.beds_total).toBe(2);
    // Bookings above are for 2027 — not "tonight" — so occupancy today is 0.
    expect(map.body.beds_occupied).toBe(0);
  });

  it("TTL: an expired unpaid online hold stops blocking availability and the sweep cancels it", async () => {
    // Fresh room to isolate.
    const r = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: typeId, outlet_id: 1, room_number: "R2",
    });
    const r2Id = r.body.id;

    const booking = await rooms.createBooking(
      db,
      {
        customer_id: 1, room_type_id: typeId, room_id: r2Id,
        check_in_date: "2027-05-01", check_out_date: "2027-05-03",
      },
      1,
      { source: "online", expiresAt: new Date(Date.now() - 60_000).toISOString() } // already lapsed
    );
    expect(booking.source).toBe("online");

    // Availability ignores the lapsed hold immediately.
    const avail = await rooms.checkRoomAvailability(db, {
      from: "2027-05-01", to: "2027-05-03", room_id: r2Id,
    });
    expect(avail.rooms_available).toBe(1);

    // The sweep formalizes the cancel + frees the room.
    const expired = await rooms.expireStaleRoomReservations(db);
    expect(expired.map((b) => b.id)).toContain(booking.id);
    const { rows: [after] } = await db.query(
      "SELECT status FROM room_bookings WHERE id = $1", [booking.id]
    );
    expect(after.status).toBe("cancelled");
  });

  it("TTL: an AUTHORIZED deposit protects the hold from expiry", async () => {
    const booking = await rooms.createBooking(
      db,
      {
        customer_id: 1, room_type_id: typeId,
        check_in_date: "2027-06-01", check_out_date: "2027-06-03",
      },
      1,
      { source: "online", expiresAt: new Date(Date.now() - 60_000).toISOString() }
    );
    await db.query(
      "UPDATE room_bookings SET deposit_status = 'authorized' WHERE id = $1",
      [booking.id]
    );
    const expired = await rooms.expireStaleRoomReservations(db);
    expect(expired.map((b) => b.id)).not.toContain(booking.id);
    const avail = await rooms.checkRoomAvailability(db, {
      from: "2027-06-01", to: "2027-06-03", room_id: booking.room_id,
    });
    expect(avail.rooms_available).toBe(0); // still blocking — guest paid
  });
});
