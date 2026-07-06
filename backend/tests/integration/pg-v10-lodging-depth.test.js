/**
 * pg-v10-lodging-depth.test.js — V10 lodging depth walkthrough.
 *
 * Covers: folio-tax rooms slice (per-line snapshots via room_types.tax_id,
 * exclusive + tax-inclusive room types, settle invoice math), the public
 * direct booking engine (flag gate, availability quote, book-through-the-
 * choke-point, hold TTL), iCal channel sync (export feed live state, import
 * parse + blocks + availability, conflicting import → dead-letter,
 * upstream-removed events release blocks), guest registration enforcement +
 * registry report, group bookings with master-folio charge routing, and the
 * night audit / occupancy / ADR hand-math check.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const rooms = require("../../services/room-service");
const channelSync = require("../../services/room-channel-sync");
const nightAudit = require("../../services/room-night-audit");

vi.setConfig({ testTimeout: 30000 });

describe("V10 Lodging depth — tax, public engine, channels, guests, groups, audit", () => {
  let app, db, deps, cleanup;
  const realFetch = global.fetch;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());
    require("../../middleware/feature-flags").init({ db });
    app.use((req, res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      req.company = { timezone: "UTC", email: "desk@example.com", store_name: "Test Hotel" };
      next();
    });
    require("../../routes/rooms")(app, deps);

    // The public engine resolves the tenant via public-tenant-context, which
    // freezes MULTI_TENANT at module load. Tests run single-tenant against
    // the isolated schema — evict + re-require with MT off (safe: after
    // createTestApp() per the Decision II trap).
    process.env.MULTI_TENANT = "0";
    delete require.cache[require.resolve("../../services/public-tenant-context")];
    delete require.cache[require.resolve("../../routes/public-rooms")];
    require("../../routes/public-rooms")(app, deps);

    // Lodging flags ON for the walkthrough (preset backfill equivalent).
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('room_online_booking', true),
        ('room_channel_sync', true),
        ('room_guest_registration', true)
      ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled
    `);
    // Exclusive tax mode + a 10% tax for the folio-tax slice.
    await db.query("UPDATE company_profile SET tax_mode = 'exclusive' WHERE id = 1");
  }, 180000);

  afterAll(async () => {
    global.fetch = realFetch;
    process.env.MULTI_TENANT = "1";
    if (cleanup) await cleanup();
  });

  const authHeaders = { "x-employee-id": "1" };
  let taxId, taxedTypeId, inclusiveTypeId, taxedRoomId, inclRoomId;

  it("seeds taxed room types (exclusive + tax-inclusive)", async () => {
    const { rows: [tax] } = await db.query(
      "INSERT INTO taxes (name, rate) VALUES ('GST 10', 10) RETURNING id"
    );
    taxId = tax.id;

    const rt = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Taxed Double", capacity: 2, base_rate: 1000, deposit_required: 0,
    });
    taxedTypeId = rt.body.id;
    await db.query("UPDATE room_types SET tax_id = $1 WHERE id = $2", [taxId, taxedTypeId]);

    const rti = await request(app).post("/api/room-types").set(authHeaders).send({
      name: "Inclusive Single", capacity: 1, base_rate: 1100,
    });
    inclusiveTypeId = rti.body.id;
    await db.query(
      "UPDATE room_types SET tax_id = $1, tax_inclusive = TRUE WHERE id = $2",
      [taxId, inclusiveTypeId]
    );

    const r1 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: taxedTypeId, outlet_id: 1, room_number: "T1",
    });
    taxedRoomId = r1.body.id;
    const r2 = await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: inclusiveTypeId, outlet_id: 1, room_number: "I1",
    });
    inclRoomId = r2.body.id;
  });

  // ── Folio-tax (rooms slice of the approved proposal) ─────────────

  let taxedBookingId;

  it("folio-tax: exclusive mode stamps per-line snapshots and adds tax on top", async () => {
    const book = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: taxedTypeId, room_id: taxedRoomId,
      check_in_date: "2027-02-01", check_out_date: "2027-02-03",
    });
    expect(book.status).toBe(201);
    taxedBookingId = book.body.id;

    const checkin = await request(app)
      .post(`/api/room-bookings/${taxedBookingId}/checkin`)
      .set(authHeaders)
      .send({ guests: [{ name: "Ali Khan", cnic_passport: "35202-1234567-1", is_primary: true }] });
    expect(checkin.status).toBe(200);

    const folio = await request(app)
      .get(`/api/room-bookings/${taxedBookingId}/folio`)
      .set(authHeaders);
    expect(folio.status).toBe(200);
    const nights = folio.body.lines.filter((l) => l.line_type === "room_night");
    expect(nights.length).toBe(2);
    for (const line of nights) {
      expect(Number(line.tax_rate_at_charge)).toBe(10);
      expect(Number(line.tax_amount_at_charge)).toBe(100); // 10% of 1000, exclusive
      expect(line.tax_inclusive_at_charge).toBe(false);
    }
    // Exclusive: grand = 2000 base + 200 tax on top.
    expect(Number(folio.body.tax_total)).toBe(200);
    expect(Number(folio.body.grand_total)).toBe(2200);
  });

  it("folio-tax: manual charge with explicit tax_id stamps too; settle invoice math is net/tax/gross", async () => {
    const line = await request(app)
      .post(`/api/room-bookings/${taxedBookingId}/folio/lines`)
      .set(authHeaders)
      .send({ line_type: "manual_charge", description: "Minibar", unit_price: 500, quantity: 1, tax_id: taxId });
    expect(line.status).toBe(201);
    expect(Number(line.body.tax_amount_at_charge)).toBe(50);

    await request(app).post(`/api/room-bookings/${taxedBookingId}/checkout`).set(authHeaders).send({});
    const settle = await request(app)
      .post(`/api/room-bookings/${taxedBookingId}/folio/settle`)
      .set(authHeaders)
      .send({});
    expect(settle.status).toBe(201);
    // base 2500 + tax 250 = 2750 gross; subtotal = net 2500.
    expect(Number(settle.body.invoice.total_amount)).toBe(2750);
    expect(Number(settle.body.invoice.tax_total)).toBe(250);
    expect(Number(settle.body.invoice.subtotal)).toBe(2500);

    // Idempotent re-run: a second settle refuses (folio already settled).
    const again = await request(app)
      .post(`/api/room-bookings/${taxedBookingId}/folio/settle`)
      .set(authHeaders)
      .send({});
    expect(again.status).toBe(400);
  });

  it("folio-tax: a tax-inclusive room type keeps tax inside the rate (v49 column now real)", async () => {
    const book = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: inclusiveTypeId, room_id: inclRoomId,
      check_in_date: "2027-02-01", check_out_date: "2027-02-02",
    });
    const id = book.body.id;
    await request(app).post(`/api/room-bookings/${id}/checkin`).set(authHeaders).send({
      guests: [{ name: "Sara", cnic_passport: "P123456", is_primary: true }],
    });
    const folio = await request(app).get(`/api/room-bookings/${id}/folio`).set(authHeaders);
    const [line] = folio.body.lines;
    expect(Number(line.tax_amount_at_charge)).toBe(100); // 1100 × 10/110
    expect(line.tax_inclusive_at_charge).toBe(true);
    expect(Number(folio.body.grand_total)).toBe(1100); // tax inside, NOT added on top
    expect(Number(folio.body.tax_total)).toBe(100);
  });

  // ── Guest registration ───────────────────────────────────────────

  it("check-in without a primary guest is refused when registration is enforced (skip escape works)", async () => {
    const book = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: taxedTypeId, room_id: taxedRoomId,
      check_in_date: "2027-02-10", check_out_date: "2027-02-11",
    });
    const id = book.body.id;
    const noGuests = await request(app)
      .post(`/api/room-bookings/${id}/checkin`).set(authHeaders).send({});
    expect(noGuests.status).toBe(400);
    expect(noGuests.body.code).toBe("REGISTRATION_REQUIRED");

    const skipped = await request(app)
      .post(`/api/room-bookings/${id}/checkin`).set(authHeaders)
      .send({ skip_registration: true });
    expect(skipped.status).toBe(200);
  });

  it("guest registry report lists captured guests in a date range (staff-only)", async () => {
    const reg = await request(app)
      .get("/api/reports/guest-registry?from=2027-02-01&to=2027-02-05")
      .set(authHeaders);
    expect(reg.status).toBe(200);
    const names = reg.body.guests.map((g) => g.name);
    expect(names).toContain("Ali Khan");
    expect(reg.body.guests.find((g) => g.name === "Ali Khan").cnic_passport).toBe("35202-1234567-1");
  });

  // ── Public direct booking engine ─────────────────────────────────

  let publicBookingNumber;

  it("public availability quotes room types with live counts + stay totals", async () => {
    const res = await request(app).get("/api/public/rooms/availability?from=2027-07-01&to=2027-07-03");
    expect(res.status).toBe(200);
    const taxed = res.body.room_types.find((t) => t.id === taxedTypeId);
    expect(taxed.rooms_available).toBe(1);
    expect(taxed.nights).toBe(2);
    expect(Number(taxed.stay_total)).toBe(2000);
  });

  it("public book creates a 'reserved' hold through the choke point with a TTL", async () => {
    const res = await request(app).post("/api/public/rooms/book").send({
      room_type_id: taxedTypeId,
      check_in_date: "2027-07-01",
      check_out_date: "2027-07-03",
      guest_name: "Web Guest",
      guest_phone: "03001234567",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("reserved");
    expect(res.body.hold_expires_at).toBeTruthy();
    publicBookingNumber = res.body.booking_number;

    // Front desk sees it, attributed to the online source.
    const list = await request(app).get("/api/room-bookings?status=reserved").set(authHeaders);
    const row = list.body.bookings.find((b) => b.booking_number === publicBookingNumber);
    expect(row).toBeTruthy();
    expect(row.source).toBe("online");

    // The engine can't hoard: a second public book for the same window 409s
    // (last taxed room now held).
    const again = await request(app).post("/api/public/rooms/book").send({
      room_type_id: taxedTypeId,
      check_in_date: "2027-07-01",
      check_out_date: "2027-07-03",
      guest_name: "Second Guest",
      guest_email: "second@example.com",
    });
    expect(again.status).toBe(409);
  });

  it("public engine is flag-gated (403 when room_online_booking is off)", async () => {
    await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'room_online_booking'");
    const res = await request(app).get("/api/public/rooms/availability?from=2027-07-01&to=2027-07-02");
    expect(res.status).toBe(403);
    await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'room_online_booking'");
  });

  // ── iCal channel sync ────────────────────────────────────────────

  let exportSecret, importFeedId;

  it("export feed serves live bookings as all-day VEVENTs; secret is unguessable", async () => {
    const feed = await request(app).post("/api/room-channel-feeds").set(authHeaders).send({
      direction: "export", name: "All rooms — Booking.com",
    });
    expect(feed.status).toBe(201);
    exportSecret = feed.body.secret;
    expect(exportSecret).toMatch(/^[a-f0-9]{48}$/);

    const ics = await request(app).get(`/api/public/rooms/ical/${exportSecret}`);
    expect(ics.status).toBe(200);
    expect(ics.headers["content-type"]).toMatch(/text\/calendar/);
    expect(ics.text).toContain(`${publicBookingNumber}@sanopos`);
    expect(ics.text).toContain("DTSTART;VALUE=DATE:20270701");
    expect(ics.text).toContain("DTEND;VALUE=DATE:20270703"); // exclusive checkout day
    // Guest identity never leaks to the OTA.
    expect(ics.text).not.toContain("Web Guest");

    const bogus = await request(app).get(`/api/public/rooms/ical/${"0".repeat(48)}`);
    expect(bogus.status).toBe(404);
  });

  it("cancelled bookings drop from the export feed (live state, no cache)", async () => {
    const list = await request(app).get("/api/room-bookings?status=reserved").set(authHeaders);
    const row = list.body.bookings.find((b) => b.booking_number === publicBookingNumber);
    await request(app).post(`/api/room-bookings/${row.id}/cancel`).set(authHeaders).send({});
    const ics = await request(app).get(`/api/public/rooms/ical/${exportSecret}`);
    expect(ics.text).not.toContain(`${publicBookingNumber}@sanopos`);
  });

  it("import sync: external events become channel_blocks that block availability", async () => {
    const feed = await request(app).post("/api/room-channel-feeds").set(authHeaders).send({
      direction: "import", name: "Airbnb — T1", channel_name: "Airbnb",
      room_id: taxedRoomId, url: "https://ota.example.test/t1.ics",
    });
    expect(feed.status).toBe(201);
    importFeedId = feed.body.id;

    global.fetch = async () => ({
      ok: true,
      text: async () => [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:airbnb-evt-1",
        "DTSTART;VALUE=DATE:20270801",
        "DTEND;VALUE=DATE:20270803",
        "SUMMARY:Airbnb (Not available)",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const sync = await request(app)
      .post(`/api/room-channel-feeds/${importFeedId}/sync`).set(authHeaders).send({});
    expect(sync.status).toBe(200);
    expect(sync.body.upserted).toBe(1);
    expect(sync.body.conflicts).toBe(0);

    // The OTA dates are now occupied for local sellers.
    const avail = await rooms.checkRoomAvailability(db, {
      from: "2027-08-01", to: "2027-08-03", room_id: taxedRoomId,
    });
    expect(avail.rooms_available).toBe(0);
    expect(avail.channel_blocks.length).toBe(1);

    // Booking through the choke point refuses the blocked window.
    const book = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: taxedTypeId, room_id: taxedRoomId,
      check_in_date: "2027-08-02", check_out_date: "2027-08-04",
    });
    expect(book.status).toBe(409);
  });

  it("conflicting import (external event over a LOCAL booking) dead-letters + notifies, never silent", async () => {
    // Local booking first.
    const local = await request(app).post("/api/room-bookings").set(authHeaders).send({
      customer_id: 1, room_type_id: taxedTypeId, room_id: taxedRoomId,
      check_in_date: "2027-09-01", check_out_date: "2027-09-03",
    });
    expect(local.status).toBe(201);

    global.fetch = async () => ({
      ok: true,
      text: async () => [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:airbnb-evt-1",
        "DTSTART;VALUE=DATE:20270801",
        "DTEND;VALUE=DATE:20270803",
        "SUMMARY:Airbnb (Not available)",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:airbnb-evt-2",
        "DTSTART;VALUE=DATE:20270902",
        "DTEND;VALUE=DATE:20270904",
        "SUMMARY:Airbnb clash",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    });

    const sync = await request(app)
      .post(`/api/room-channel-feeds/${importFeedId}/sync`).set(authHeaders).send({});
    expect(sync.status).toBe(200);
    expect(sync.body.conflicts).toBe(1);

    const dls = await request(app).get("/api/room-channel-dead-letters").set(authHeaders);
    expect(dls.status).toBe(200);
    expect(dls.body.dead_letters.length).toBe(1);
    expect(dls.body.dead_letters[0].booking_number).toBe(local.body.booking_number);
    expect(dls.body.dead_letters[0].external_uid).toBe("airbnb-evt-2");

    // In-app notification fired.
    const { rows: notifs } = await db.query(
      "SELECT * FROM notifications WHERE type = 'channel_conflict'"
    );
    expect(notifs.length).toBe(1);

    // Re-sync doesn't duplicate the dead letter or the notification.
    await request(app).post(`/api/room-channel-feeds/${importFeedId}/sync`).set(authHeaders).send({});
    const dls2 = await request(app).get("/api/room-channel-dead-letters").set(authHeaders);
    expect(dls2.body.dead_letters.length).toBe(1);
    const { rows: notifs2 } = await db.query(
      "SELECT * FROM notifications WHERE type = 'channel_conflict'"
    );
    expect(notifs2.length).toBe(1);

    // Resolve clears it from the open queue.
    const resolve = await request(app)
      .post(`/api/room-channel-dead-letters/${dls.body.dead_letters[0].id}/resolve`)
      .set(authHeaders).send({});
    expect(resolve.status).toBe(200);
    const dls3 = await request(app).get("/api/room-channel-dead-letters").set(authHeaders);
    expect(dls3.body.dead_letters.length).toBe(0);
  });

  it("events removed upstream release their blocks", async () => {
    global.fetch = async () => ({
      ok: true,
      text: async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    });
    const sync = await request(app)
      .post(`/api/room-channel-feeds/${importFeedId}/sync`).set(authHeaders).send({});
    expect(sync.body.removed).toBe(2);
    const avail = await rooms.checkRoomAvailability(db, {
      from: "2027-08-01", to: "2027-08-03", room_id: taxedRoomId,
    });
    expect(avail.rooms_available).toBe(1);
  });

  it("a failing feed stamps last_status='error' (staleness surfaces, sweep continues)", async () => {
    global.fetch = async () => { throw new Error("connect ETIMEDOUT"); };
    const sync = await request(app)
      .post(`/api/room-channel-feeds/${importFeedId}/sync`).set(authHeaders).send({});
    expect(sync.body.error).toMatch(/ETIMEDOUT/);
    const feeds = await request(app).get("/api/room-channel-feeds").set(authHeaders);
    const feed = feeds.body.feeds.find((f) => f.id === importFeedId);
    expect(feed.last_status).toBe("error");
    expect(feed.last_error).toMatch(/ETIMEDOUT/);
    global.fetch = realFetch;
  });

  // ── Group bookings ───────────────────────────────────────────────

  let groupId, masterBookingId, memberBookingId;

  it("creates a multi-room block; each room goes through the choke point", async () => {
    // Two more taxed rooms for the block.
    await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: taxedTypeId, outlet_id: 1, room_number: "T2",
    });
    await request(app).post("/api/rooms").set(authHeaders).send({
      room_type_id: taxedTypeId, outlet_id: 1, room_number: "T3",
    });
    const res = await request(app).post("/api/room-booking-groups").set(authHeaders).send({
      name: "Ahmed Wedding Block",
      customer_id: 1,
      bookings: [
        { room_type_id: taxedTypeId, check_in_date: "2027-10-01", check_out_date: "2027-10-03" },
        { room_type_id: taxedTypeId, check_in_date: "2027-10-01", check_out_date: "2027-10-03" },
        { room_type_id: taxedTypeId, check_in_date: "2027-10-01", check_out_date: "2027-10-03" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.bookings.length).toBe(3);
    groupId = res.body.id;
    [masterBookingId, memberBookingId] = [res.body.bookings[0].id, res.body.bookings[1].id];
  });

  it("a block that can't fully fit rolls back every room (no half-booked group)", async () => {
    // Only 3 taxed rooms exist and all are held 10-01→10-03 → a 2-room block fails.
    const res = await request(app).post("/api/room-booking-groups").set(authHeaders).send({
      name: "Overflow Block",
      bookings: [
        { room_type_id: taxedTypeId, check_in_date: "2027-10-02", check_out_date: "2027-10-04" },
        { room_type_id: taxedTypeId, check_in_date: "2027-10-01", check_out_date: "2027-10-03" },
      ],
    });
    // First line could fit only if a room were free — all are taken, so 409;
    // nothing survives.
    expect(res.status).toBe(409);
    const groups = await request(app).get("/api/room-booking-groups").set(authHeaders);
    expect(groups.body.groups.find((g) => g.name === "Overflow Block")).toBeFalsy();
  });

  it("master folio routes POS charges from any room in the block", async () => {
    // Check in master + member (opens folios).
    await request(app).post(`/api/room-bookings/${masterBookingId}/checkin`).set(authHeaders)
      .send({ guests: [{ name: "Groom", cnic_passport: "1", is_primary: true }] });
    await request(app).post(`/api/room-bookings/${memberBookingId}/checkin`).set(authHeaders)
      .send({ guests: [{ name: "Guest2", cnic_passport: "2", is_primary: true }] });

    const setMaster = await request(app)
      .post(`/api/room-booking-groups/${groupId}/master-folio`)
      .set(authHeaders)
      .send({ booking_id: masterBookingId });
    expect(setMaster.status).toBe(200);

    const masterFolio = await rooms.getFolio(db, masterBookingId);
    const memberFolio = await rooms.getFolio(db, memberBookingId);

    // Simulate the POS charge path: attachSaleToFolio against the MEMBER's
    // folio redirects to the master.
    const result = await db.transaction(async (client) => {
      const { rows: [sale] } = await client.query(
        `INSERT INTO sales (total_amount, payment_method, outlet_id, employee_id)
         VALUES (750, 'room_charge', 1, 1) RETURNING id`
      );
      return rooms.attachSaleToFolio(client, {
        saleId: sale.id, folioId: memberFolio.id, amount: 750, employeeId: 1,
      });
    });
    expect(result.redirected).toBe(true);
    expect(result.folio_id).toBe(masterFolio.id);

    const masterAfter = await rooms.getFolio(db, masterBookingId);
    expect(masterAfter.lines.some((l) => l.line_type === "pos_sale" && Number(l.line_total) === 750)).toBe(true);
    const memberAfter = await rooms.getFolio(db, memberBookingId);
    expect(memberAfter.lines.some((l) => l.line_type === "pos_sale")).toBe(false);
  });

  // ── Night audit + occupancy/ADR hand math ────────────────────────

  it("night audit matches hand math (occupancy, ADR, RevPAR, net-of-tax revenue)", async () => {
    // For night 2027-10-01: rooms occupying = the 3 wedding-block rooms
    // (T1 blocked? channel blocks removed earlier; T1/T2/T3 hold the block).
    // Sellable inventory: every active room that isn't a dorm parent.
    const { rows: [inv] } = await db.query(
      `SELECT COUNT(*)::int AS total FROM rooms r
       WHERE r.is_active = TRUE
         AND NOT EXISTS (SELECT 1 FROM rooms c WHERE c.parent_room_id = r.id AND c.is_active = TRUE)`
    );
    const snap = await request(app)
      .post("/api/rooms/night-audit/run").set(authHeaders)
      .send({ date: "2027-10-01" });
    expect(snap.status).toBe(201);
    expect(snap.body.rooms_total).toBe(inv.total);
    expect(snap.body.rooms_occupied).toBe(3);
    expect(snap.body.arrivals).toBe(3);
    // Rate 1000/night, tax exclusive → net revenue 3 × 1000 = 3000.
    expect(Number(snap.body.room_revenue)).toBe(3000);
    expect(Number(snap.body.adr)).toBe(1000);
    const expectedOcc = Math.round((3 / inv.total) * 10000) / 100;
    expect(Number(snap.body.occupancy_pct)).toBe(expectedOcc);
    const expectedRevpar = Math.round((3000 / inv.total) * 100) / 100;
    expect(Number(snap.body.revpar)).toBe(expectedRevpar);

    // Re-run upserts (idempotent), and history lists it.
    const rerun = await request(app)
      .post("/api/rooms/night-audit/run").set(authHeaders)
      .send({ date: "2027-10-01" });
    expect(rerun.status).toBe(201);
    const hist = await request(app).get("/api/rooms/night-audit/history").set(authHeaders);
    expect(hist.body.snapshots.filter((s) => String(s.audit_date).slice(0, 10) === "2027-10-01").length).toBe(1);
  });

  it("occupancy report blends audited + live days over a range", async () => {
    const rep = await request(app)
      .get("/api/reports/occupancy?from=2027-10-01&to=2027-10-02")
      .set(authHeaders);
    expect(rep.status).toBe(200);
    expect(rep.body.days.length).toBe(2);
    expect(rep.body.days[0].source).toBe("audit");
    expect(rep.body.days[1].source).toBe("live");
    expect(rep.body.summary.room_nights_sold).toBe(6); // 3 rooms × 2 nights
  });

  it("empty state: audit on a zero-booking date returns clean zeros", async () => {
    const snap = await nightAudit.computeNightAudit(db, "2030-01-01");
    expect(snap.rooms_occupied).toBe(0);
    expect(snap.adr).toBe(0);
    expect(snap.occupancy_pct).toBe(0);
  });
});
