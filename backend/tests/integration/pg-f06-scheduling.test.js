const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");
const dbPg = require("../../db-pg");

/**
 * pg-f06-scheduling.test.js — F06 scheduling engine activation.
 *
 * Covers the plan's Verification bar (backend half):
 *   - class capacity: full class → 409 CLASS_FULL, dup member → 409 ALREADY_BOOKED
 *   - RACES (real parallel Postgres sessions, not one shared test client):
 *       last class spot and same appointment slot — exactly one winner each
 *   - waitlist: join → offer → claim books → expiry re-offers → cancel ripple
 *   - segments: multi-service visit blocks BOTH staff per their own window
 *     (and does NOT over-block the primary), reschedule shifts segments
 *   - resources: auto-assign at booking, 409 when none free, resource race
 *   - appointment → POS checkout link: sale completes appointment, void reopens
 */

describe("F06 — scheduling engine (Postgres)", () => {
  let app, db, deps, cleanup, schemaName;
  const extraClients = [];

  // A second/third real Postgres session pinned to the test schema — the
  // shared test `db` is ONE client, so "parallel" transactions on it would
  // interleave on one connection instead of actually racing.
  async function parallelDb() {
    const client = await dbPg.getClient();
    await client.query(`SET search_path = '${schemaName}'`);
    extraClients.push(client);
    return {
      query: (sql, params) => client.query(sql, params),
      transaction: async (fn) => {
        await client.query("BEGIN");
        try {
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      },
      getClient: () => Promise.resolve(client),
    };
  }

  async function pollFor(checkFn, { timeoutMs = 4000, everyMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await checkFn();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

  async function makeCustomer(name, mobile) {
    const { rows: [c] } = await db.query(
      "INSERT INTO customers (name, mobile) VALUES ($1, $2) RETURNING id",
      [name, mobile]
    );
    return c.id;
  }

  async function makeService(name, durationMinutes, price = 500) {
    const { rows: [s] } = await db.query(
      "INSERT INTO booking_services (name, duration_minutes, price) VALUES ($1, $2, $3) RETURNING *",
      [name, durationMinutes, price]
    );
    return s;
  }

  beforeAll(async () => {
    ({ app, db, deps, cleanup, schemaName } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    require("../../routes/bookings")(app, deps);
    require("../../routes/classes")(app, deps);
    require("../../routes/shifts")(app, deps);
    require("../../routes/attendance")(app, deps);
    require("../../routes/sales")(app, deps);

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_appointments', true),
        ('phase4_appointments_classes', true),
        ('phase4_appointments_waitlists', true),
        ('phase4_appointments_resources', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    for (const client of extraClients) {
      try { client.release(); } catch { /* already released */ }
    }
    if (cleanup) await cleanup();
  });

  // ─── Classes: capacity + dedupe ─────────────────────────────────────────

  describe("class capacity", () => {
    let session, service;

    beforeAll(async () => {
      service = await makeService("Yoga", 60);
      const { createClassSession } = require("../../services/class-bookings");
      ({ session } = await createClassSession(db, {
        service_id: service.id,
        employee_id: 2,
        outlet_id: 1,
        start_at: hoursFromNow(24).toISOString(),
        end_at: hoursFromNow(25).toISOString(),
        max_capacity: 2,
      }));
    });

    it("books up to capacity, then rejects with 409 CLASS_FULL", async () => {
      const { bookIntoSession } = require("../../services/class-bookings");
      const c1 = await makeCustomer("Cap One", "0300-0000001");
      const c2 = await makeCustomer("Cap Two", "0300-0000002");
      const c3 = await makeCustomer("Cap Three", "0300-0000003");

      await bookIntoSession(db, { classSessionId: session.id, customerId: c1 });
      await bookIntoSession(db, { classSessionId: session.id, customerId: c2 });

      await expect(
        bookIntoSession(db, { classSessionId: session.id, customerId: c3 })
      ).rejects.toMatchObject({ statusCode: 409, code: "CLASS_FULL" });
    });

    it("rejects the same member booking twice with 409 ALREADY_BOOKED", async () => {
      const { bookIntoSession, createClassSession } = require("../../services/class-bookings");
      const { session: s2 } = await createClassSession(db, {
        service_id: service.id,
        start_at: hoursFromNow(26).toISOString(),
        end_at: hoursFromNow(27).toISOString(),
        max_capacity: 5,
      });
      const c = await makeCustomer("Dupe Member", "0300-0000004");
      await bookIntoSession(db, { classSessionId: s2.id, customerId: c });
      await expect(
        bookIntoSession(db, { classSessionId: s2.id, customerId: c })
      ).rejects.toMatchObject({ statusCode: 409, code: "ALREADY_BOOKED" });
    });

    it("materializes weekly recurrence occurrences at save time", async () => {
      const { createClassSession } = require("../../services/class-bookings");
      const { session: parent, occurrences } = await createClassSession(db, {
        service_id: service.id,
        start_at: hoursFromNow(24).toISOString(),
        end_at: hoursFromNow(25).toISOString(),
        max_capacity: 10,
        recurrence_rule: "weekly:0,1,2,3,4,5,6", // every day → weeks*7 occurrences
        recurrence_weeks: 2,
      }, { timezone: "UTC" });
      expect(occurrences.length).toBe(14);
      expect(occurrences.every((o) => o.recurrence_parent_id === parent.id)).toBe(true);
    });
  });

  // ─── RACE: last class spot ──────────────────────────────────────────────

  describe("race — last class spot", () => {
    it("two parallel bookings on the last spot → exactly one winner", async () => {
      const { createClassSession, bookIntoSession } = require("../../services/class-bookings");
      const service = await makeService("Spin", 45);
      const { session } = await createClassSession(db, {
        service_id: service.id,
        start_at: hoursFromNow(30).toISOString(),
        end_at: hoursFromNow(31).toISOString(),
        max_capacity: 1,
      });
      const cA = await makeCustomer("Racer A", "0300-0000010");
      const cB = await makeCustomer("Racer B", "0300-0000011");

      const [dbA, dbB] = await Promise.all([parallelDb(), parallelDb()]);
      const results = await Promise.allSettled([
        bookIntoSession(dbA, { classSessionId: session.id, customerId: cA }),
        bookIntoSession(dbB, { classSessionId: session.id, customerId: cB }),
      ]);

      const wins = results.filter((r) => r.status === "fulfilled");
      const losses = results.filter((r) => r.status === "rejected");
      expect(wins.length).toBe(1);
      expect(losses.length).toBe(1);
      expect(losses[0].reason).toMatchObject({ statusCode: 409, code: "CLASS_FULL" });

      const { rows: [{ n }] } = await db.query(
        `SELECT COUNT(*)::int AS n FROM class_session_bookings
         WHERE class_session_id = $1 AND status = 'confirmed'`,
        [session.id]
      );
      expect(n).toBe(1);
    }, 20000);
  });

  // ─── RACE: same appointment slot ────────────────────────────────────────

  describe("race — same appointment slot", () => {
    it("two parallel bookings of the same staff slot → exactly one winner", async () => {
      const { createAppointment } = require("../../services/booking-services");
      const service = await makeService("Haircut Race", 30);
      const startAt = hoursFromNow(48).toISOString();

      const [dbA, dbB] = await Promise.all([parallelDb(), parallelDb()]);
      const results = await Promise.allSettled([
        createAppointment(dbA, { service_id: service.id, employee_id: 2, start_at: startAt, customer_name: "Race A" }, "admin"),
        createAppointment(dbB, { service_id: service.id, employee_id: 2, start_at: startAt, customer_name: "Race B" }, "admin"),
      ]);

      const wins = results.filter((r) => r.status === "fulfilled");
      const losses = results.filter((r) => r.status === "rejected");
      expect(wins.length).toBe(1);
      expect(losses.length).toBe(1);
      expect(losses[0].reason).toMatchObject({ statusCode: 409 });

      const { rows } = await db.query(
        `SELECT id FROM appointments
         WHERE employee_id = 2 AND start_at = $1 AND status NOT IN ('cancelled','no_show')`,
        [startAt]
      );
      expect(rows.length).toBe(1);
    }, 20000);
  });

  // ─── Waitlist: offer → claim → expiry → cancel ripple ───────────────────

  describe("class waitlist flow", () => {
    let service, session, bookedCustomer, waiter1, waiter2;

    beforeAll(async () => {
      const { createClassSession, bookIntoSession } = require("../../services/class-bookings");
      const { joinClassWaitlist } = require("../../services/waitlist");
      service = await makeService("Pilates", 60);
      ({ session } = await createClassSession(db, {
        service_id: service.id,
        start_at: hoursFromNow(72).toISOString(),
        end_at: hoursFromNow(73).toISOString(),
        max_capacity: 1,
      }));
      bookedCustomer = await makeCustomer("Booked In", "0300-0000020");
      waiter1 = await makeCustomer("Waiter One", "0300-0000021");
      waiter2 = await makeCustomer("Waiter Two", "0300-0000022");
      await bookIntoSession(db, { classSessionId: session.id, customerId: bookedCustomer });
      await joinClassWaitlist(db, { classSessionId: session.id, customerId: waiter1 });
      await joinClassWaitlist(db, { classSessionId: session.id, customerId: waiter2 });
    });

    it("cancelling a booking ripples an offer to the oldest waiting entry", async () => {
      const { cancelClassBooking } = require("../../services/class-bookings");
      const { rows: [booking] } = await db.query(
        "SELECT id FROM class_session_bookings WHERE class_session_id = $1 AND customer_id = $2",
        [session.id, bookedCustomer]
      );
      await cancelClassBooking(db, booking.id, { notifyCtx: { tenantSlug: "test-tenant" } });

      // The offer flow is fire-and-forget after the cancel — poll for it.
      const offered = await pollFor(async () => {
        const { rows: [e] } = await db.query(
          `SELECT * FROM appointment_waitlist_entries
           WHERE class_session_id = $1 AND customer_id = $2 AND status = 'offered'`,
          [session.id, waiter1]
        );
        return e || null;
      });
      expect(offered).toBeTruthy();
      expect(offered.claim_token).toBeTruthy();
      expect(new Date(offered.offer_expires_at) > new Date()).toBe(true);
    }, 15000);

    it("claiming the offer books through the locked path and marks the entry booked", async () => {
      const { claimOffer } = require("../../services/waitlist");
      const { rows: [entry] } = await db.query(
        `SELECT * FROM appointment_waitlist_entries
         WHERE class_session_id = $1 AND customer_id = $2 AND status = 'offered'`,
        [session.id, waiter1]
      );
      const result = await claimOffer(db, entry.claim_token, {});
      expect(result.kind).toBe("class");
      expect(result.booking.customer_id).toBe(waiter1);

      const { rows: [after] } = await db.query(
        "SELECT status FROM appointment_waitlist_entries WHERE id = $1",
        [entry.id]
      );
      expect(after.status).toBe("booked");

      // Class is back at capacity — the second waiter must NOT hold an offer.
      const { rows: [w2] } = await db.query(
        "SELECT status FROM appointment_waitlist_entries WHERE class_session_id = $1 AND customer_id = $2",
        [session.id, waiter2]
      );
      expect(w2.status).toBe("waiting");
    });

    it("expired offers re-offer to the next in line", async () => {
      const { cancelClassBooking } = require("../../services/class-bookings");
      const { expireStaleOffers, offerNextForClassSession } = require("../../services/waitlist");

      // Free the spot again (cancel waiter1's claimed booking, no auto-ripple)
      const { rows: [booking] } = await db.query(
        `SELECT id FROM class_session_bookings
         WHERE class_session_id = $1 AND customer_id = $2 AND status = 'confirmed'`,
        [session.id, waiter1]
      );
      await cancelClassBooking(db, booking.id, {});

      // waiter2 gets the offer, then we force it past its expiry window
      const offered = await offerNextForClassSession(db, session.id, {});
      expect(offered.customer_id).toBe(waiter2);
      await db.query(
        "UPDATE appointment_waitlist_entries SET offer_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
        [offered.id]
      );

      // Add a third waiter so the sweep has someone to re-offer to
      const waiter3 = await makeCustomer("Waiter Three", "0300-0000023");
      const { joinClassWaitlist } = require("../../services/waitlist");
      await joinClassWaitlist(db, { classSessionId: session.id, customerId: waiter3 });

      const swept = await expireStaleOffers(db, {});
      expect(swept).toBeGreaterThanOrEqual(1);

      const { rows: [expired] } = await db.query(
        "SELECT status FROM appointment_waitlist_entries WHERE id = $1", [offered.id]
      );
      expect(expired.status).toBe("expired");

      const { rows: [next] } = await db.query(
        `SELECT status FROM appointment_waitlist_entries
         WHERE class_session_id = $1 AND customer_id = $2`,
        [session.id, waiter3]
      );
      expect(next.status).toBe("offered");
    });
  });

  describe("appointment waitlist — cancel ripple", () => {
    it("cancelling an appointment offers the freed slot to a matching waiter", async () => {
      const { createAppointment, cancelAppointment } = require("../../services/booking-services");
      const { joinAppointmentWaitlist } = require("../../services/waitlist");
      const service = await makeService("Facial", 30);
      const startAt = hoursFromNow(50).toISOString();

      const appt = await createAppointment(db, {
        service_id: service.id, employee_id: 3, start_at: startAt, customer_name: "Will Cancel",
      }, "admin");

      const waiter = await makeCustomer("Appt Waiter", "0300-0000030");
      await joinAppointmentWaitlist(db, { serviceId: service.id, customerId: waiter });

      await cancelAppointment(db, appt.id, "test", { notifyCtx: { tenantSlug: "test-tenant" } });

      const offered = await pollFor(async () => {
        const { rows: [e] } = await db.query(
          `SELECT * FROM appointment_waitlist_entries
           WHERE class_session_id IS NULL AND service_id = $1 AND customer_id = $2 AND status = 'offered'`,
          [service.id, waiter]
        );
        return e || null;
      });
      expect(offered).toBeTruthy();
      // Guards the $2::timestamptz cast in offerForFreedAppointmentSlot — a
      // bare ($2)::date once typed the param as DATE and stored local midnight.
      expect(new Date(offered.offered_start_at).toISOString()).toBe(startAt);

      // Claim it — books a real appointment in the freed slot
      const { claimOffer } = require("../../services/waitlist");
      const result = await claimOffer(db, offered.claim_token, {});
      expect(result.kind).toBe("appointment");
      expect(new Date(result.appointment.start_at).toISOString()).toBe(startAt);
      expect(result.appointment.status).toBe("confirmed");
    }, 15000);
  });

  // ─── Segments: multi-service visits ─────────────────────────────────────

  describe("appointment segments", () => {
    let cutService, colorService, apptId, startAt;

    beforeAll(async () => {
      cutService = await makeService("Cut", 30);
      colorService = await makeService("Color", 45);
    });

    it("creates sequential segments, parent spans the whole visit with employee_id NULL", async () => {
      const { createAppointment } = require("../../services/booking-services");
      startAt = hoursFromNow(96);
      const appt = await createAppointment(db, {
        service_id: cutService.id,
        employee_id: 2,
        start_at: startAt.toISOString(),
        customer_name: "Color+Cut",
        segments: [{ service_id: colorService.id, employee_id: 3 }],
      }, "admin");
      apptId = appt.id;

      expect(appt.employee_id).toBeNull();
      expect(new Date(appt.end_at).getTime()).toBe(startAt.getTime() + 75 * 60000);

      const { rows: segs } = await db.query(
        "SELECT * FROM appointment_segments WHERE appointment_id = $1 ORDER BY start_at",
        [apptId]
      );
      expect(segs.length).toBe(2);
      expect(segs[0].employee_id).toBe(2);
      expect(segs[1].employee_id).toBe(3);
      expect(new Date(segs[0].end_at).getTime()).toBe(startAt.getTime() + 30 * 60000);
      expect(new Date(segs[1].start_at).getTime()).toBe(startAt.getTime() + 30 * 60000);
    });

    it("blocks each segment's staff in their own window", async () => {
      const { createAppointment } = require("../../services/booking-services");
      // Employee 2 during segment 1 → 409
      await expect(createAppointment(db, {
        service_id: cutService.id, employee_id: 2, start_at: startAt.toISOString(), customer_name: "Clash 2",
      }, "admin")).rejects.toMatchObject({ statusCode: 409 });

      // Employee 3 during segment 2 → 409
      const seg2Start = new Date(startAt.getTime() + 30 * 60000);
      await expect(createAppointment(db, {
        service_id: cutService.id, employee_id: 3, start_at: seg2Start.toISOString(), customer_name: "Clash 3",
      }, "admin")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("does NOT over-block the primary stylist during the second segment", async () => {
      const { createAppointment } = require("../../services/booking-services");
      // Employee 2 is only busy for segment 1 (first 30 min); a 45-min booking
      // starting at +30min must succeed.
      const seg2Start = new Date(startAt.getTime() + 30 * 60000);
      const appt = await createAppointment(db, {
        service_id: colorService.id, employee_id: 2, start_at: seg2Start.toISOString(), customer_name: "Emp2 Free",
      }, "admin");
      expect(appt.id).toBeGreaterThan(0);
    });

    it("reschedule shifts every segment by the same delta", async () => {
      const { rescheduleAppointment } = require("../../services/booking-services");
      const newStart = new Date(startAt.getTime() + 24 * 3600 * 1000);
      const updated = await rescheduleAppointment(db, apptId, { start_at: newStart.toISOString() });
      expect(new Date(updated.start_at).getTime()).toBe(newStart.getTime());
      expect(new Date(updated.end_at).getTime()).toBe(newStart.getTime() + 75 * 60000);

      const { rows: segs } = await db.query(
        "SELECT * FROM appointment_segments WHERE appointment_id = $1 ORDER BY start_at",
        [apptId]
      );
      expect(new Date(segs[0].start_at).getTime()).toBe(newStart.getTime());
      expect(new Date(segs[1].start_at).getTime()).toBe(newStart.getTime() + 30 * 60000);
      expect(new Date(segs[1].end_at).getTime()).toBe(newStart.getTime() + 75 * 60000);
    });

    it("rejects staff reassignment on a multi-segment appointment", async () => {
      const { rescheduleAppointment } = require("../../services/booking-services");
      await expect(
        rescheduleAppointment(db, apptId, { start_at: hoursFromNow(200).toISOString(), employee_id: 1 })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // ─── Resources: auto-assign + race ──────────────────────────────────────

  describe("booking resources", () => {
    let service, resourceId;

    beforeAll(async () => {
      service = await makeService("Physio Session", 30);
      const { rows: [r] } = await db.query(
        "INSERT INTO booking_resources (outlet_id, name, resource_type) VALUES (1, 'Bed 1', 'bed') RETURNING id"
      );
      resourceId = r.id;
      await db.query(
        "INSERT INTO booking_resource_assignments (service_id, resource_id) VALUES ($1, $2)",
        [service.id, resourceId]
      );
    });

    it("auto-assigns a free resource and 409s when none is free", async () => {
      const { createAppointment } = require("../../services/booking-services");
      // +150h — clear of the segments tests, whose reschedule parks employee 2
      // at +120h.
      const startAt = hoursFromNow(150).toISOString();

      const first = await createAppointment(db, {
        service_id: service.id, employee_id: 2, start_at: startAt, customer_name: "Bed User",
      }, "admin");
      expect(first.resource_id).toBe(resourceId);

      // Different staff, same window, same single bed → no resource free
      await expect(createAppointment(db, {
        service_id: service.id, employee_id: 3, start_at: startAt, customer_name: "No Bed",
      }, "admin")).rejects.toMatchObject({ statusCode: 409 });
    });

    it("race — two parallel bookings, one bed → exactly one winner", async () => {
      const { createAppointment } = require("../../services/booking-services");
      const startAt = hoursFromNow(152).toISOString();

      const [dbA, dbB] = await Promise.all([parallelDb(), parallelDb()]);
      const results = await Promise.allSettled([
        createAppointment(dbA, { service_id: service.id, employee_id: 2, start_at: startAt, customer_name: "Bed Race A" }, "admin"),
        createAppointment(dbB, { service_id: service.id, employee_id: 3, start_at: startAt, customer_name: "Bed Race B" }, "admin"),
      ]);

      const wins = results.filter((r) => r.status === "fulfilled");
      expect(wins.length).toBe(1);
      expect(wins[0].value.resource_id).toBe(resourceId);
      expect(results.filter((r) => r.status === "rejected").length).toBe(1);
    }, 20000);
  });

  // ─── Appointment → POS checkout link ────────────────────────────────────

  describe("appointment → POS checkout link", () => {
    let apptId, saleId;

    beforeAll(async () => {
      // Sales need an open shift + clock-in (post-2G contract)
      await request(app)
        .post("/api/shifts/open")
        .set("x-employee-id", "1")
        .send({ outlet_id: 1, opening_float: 500, denominations: [] });
      await request(app)
        .post("/api/attendance/pin-checkin")
        .send({ pin_code: "2580", outlet_id: 1 });
      // sales.js getEmployeeCheckoutStatus is now tz-aware ((session_start AT
      // TIME ZONE tz)::date on both sides; test harness tenant tz = UTC), so
      // the old "pin the session onto the UTC date" workaround is no longer
      // needed. Keep the session pinned to UTC noon anyway so the suite stays
      // deterministic even if the harness timezone changes.
      const utcToday = new Date().toISOString().slice(0, 10);
      await db.query(
        "UPDATE attendance_sessions SET session_start = ($1 || ' 12:00:00')::timestamp WHERE employee_id = 1 AND session_end IS NULL",
        [utcToday]
      );

      const { createAppointment } = require("../../services/booking-services");
      const service = await makeService("Checkout Cut", 30, 150);
      const appt = await createAppointment(db, {
        service_id: service.id, employee_id: 2, start_at: hoursFromNow(1).toISOString(),
        customer_id: 1, customer_name: "Checkout Customer",
      }, "admin");
      apptId = appt.id;
    }, 30000);

    it("sale with appointment_id completes the appointment with a sale backlink", async () => {
      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1,
          employee_id: 1,
          customer_id: 1,
          cartItems: [{ id: 1, name: "Service Line", price: 150, quantity: 1 }],
          payments: [{ method: "cash", amount: 150 }],
          appointment_id: apptId,
          idempotency_key: "f06-checkout-" + Date.now(),
        });
      expect(res.status).toBe(200);
      saleId = res.body.saleId;
      expect(saleId).toBeGreaterThan(0);

      // Completion is applied post-commit (fire-and-forget) — poll for it.
      const appt = await pollFor(async () => {
        const { rows: [a] } = await db.query("SELECT * FROM appointments WHERE id = $1", [apptId]);
        return a && a.status === "completed" ? a : null;
      });
      expect(appt).toBeTruthy();
      expect(appt.sale_id).toBe(saleId);

      const { rows: [sale] } = await db.query("SELECT appointment_id FROM sales WHERE id = $1", [saleId]);
      expect(sale.appointment_id).toBe(apptId);
    }, 15000);

    it("a second sale for the same appointment is rejected (409 APPOINTMENT_ALREADY_PAID)", async () => {
      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1,
          employee_id: 1,
          cartItems: [{ id: 1, name: "Dup", price: 150, quantity: 1 }],
          payments: [{ method: "cash", amount: 150 }],
          appointment_id: apptId,
          idempotency_key: "f06-dup-" + Date.now(),
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("APPOINTMENT_ALREADY_PAID");
    });

    it("voiding the sale unlinks + reopens the appointment as in_progress", async () => {
      const res = await request(app)
        .put(`/api/sales/${saleId}/void`)
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({ void_reason: "F06 test void" });
      expect(res.status).toBe(200);

      const appt = await pollFor(async () => {
        const { rows: [a] } = await db.query("SELECT * FROM appointments WHERE id = $1", [apptId]);
        return a && a.sale_id === null ? a : null;
      });
      expect(appt).toBeTruthy();
      expect(appt.status).toBe("in_progress");
    }, 15000);
  });

  // ─── Verifier-found defect fixes ────────────────────────────────────────

  describe("verifier fixes", () => {
    it("commission auto-calc attributes per-line staff_id, not the cashier", async () => {
      // 10% percentage plan for the two stylists; the cashier (emp 1) has none.
      const { rows: [plan] } = await db.query(
        "INSERT INTO commission_plans (name, type) VALUES ('Stylist 10%', 'percentage') RETURNING id"
      );
      await db.query(
        "INSERT INTO commission_plan_rules (plan_id, scope_type, rate) VALUES ($1, 'all', 10)",
        [plan.id]
      );
      await db.query("UPDATE employees SET commission_plan_id = $1 WHERE id IN (2, 3)", [plan.id]);

      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1,
          employee_id: 1,
          cartItems: [
            { id: 1, name: "Cut", price: 100, quantity: 1, staff_id: 2 },
            { id: 2, name: "Color", price: 200, quantity: 1, staff_id: 3 },
          ],
          payments: [{ method: "cash", amount: 300 }],
          idempotency_key: "f06-comm-" + Date.now(),
        });
      expect(res.status).toBe(200);
      const saleId = res.body.saleId;

      // Auto-calc is fire-and-forget post-commit — poll for both rows.
      const earnings = await pollFor(async () => {
        const { rows } = await db.query(
          "SELECT * FROM commission_earnings WHERE sale_id = $1 ORDER BY employee_id",
          [saleId]
        );
        return rows.length >= 2 ? rows : null;
      });
      expect(earnings).toBeTruthy();
      expect(earnings.map((e) => e.employee_id)).toEqual([2, 3]);
      expect(Number(earnings[0].sale_amount)).toBeCloseTo(100, 2);
      expect(Number(earnings[0].commission_amount)).toBeCloseTo(10, 2);
      expect(Number(earnings[1].sale_amount)).toBeCloseTo(200, 2);
      expect(Number(earnings[1].commission_amount)).toBeCloseTo(20, 2);
      // The cashier earned nothing — attribution followed the lines.
      expect(earnings.some((e) => e.employee_id === 1)).toBe(false);
    }, 15000);

    it("PUT /api/appointments/:id rejects unknown statuses (400)", async () => {
      const { createAppointment } = require("../../services/booking-services");
      const service = await makeService("Whitelist Check", 30);
      const appt = await createAppointment(db, {
        service_id: service.id, start_at: hoursFromNow(240).toISOString(), customer_name: "W",
      }, "admin");
      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set("x-employee-id", "1")
        .send({ status: "bogus" });
      expect(res.status).toBe(400);
    });

    it("PUT status=cancelled routes through cancelAppointment (bookkeeping + ripple)", async () => {
      const { createAppointment } = require("../../services/booking-services");
      const { joinAppointmentWaitlist } = require("../../services/waitlist");
      const service = await makeService("Put Cancel", 30);
      const startAt = hoursFromNow(250).toISOString();
      const appt = await createAppointment(db, {
        service_id: service.id, employee_id: 2, start_at: startAt, customer_name: "PC",
      }, "admin");
      const waiter = await makeCustomer("Put Cancel Waiter", "0300-0000040");
      await joinAppointmentWaitlist(db, { serviceId: service.id, customerId: waiter });

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set("x-employee-id", "1")
        .send({ status: "cancelled" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
      expect(res.body.cancelled_at).toBeTruthy();

      const offered = await pollFor(async () => {
        const { rows: [e] } = await db.query(
          "SELECT * FROM appointment_waitlist_entries WHERE service_id = $1 AND customer_id = $2 AND status = 'offered'",
          [service.id, waiter]
        );
        return e || null;
      });
      expect(offered).toBeTruthy();
    }, 15000);

    it("pre-start appointment no-show frees the slot and ripples an offer", async () => {
      const { createAppointment } = require("../../services/booking-services");
      const { joinAppointmentWaitlist } = require("../../services/waitlist");
      const service = await makeService("NoShow Ripple", 30);
      const appt = await createAppointment(db, {
        service_id: service.id, employee_id: 3, start_at: hoursFromNow(260).toISOString(), customer_name: "NS",
      }, "admin");
      const waiter = await makeCustomer("NoShow Waiter", "0300-0000041");
      await joinAppointmentWaitlist(db, { serviceId: service.id, customerId: waiter });

      const res = await request(app)
        .put(`/api/appointments/${appt.id}`)
        .set("x-employee-id", "1")
        .send({ status: "no_show" });
      expect(res.status).toBe(200);

      const offered = await pollFor(async () => {
        const { rows: [e] } = await db.query(
          "SELECT * FROM appointment_waitlist_entries WHERE service_id = $1 AND customer_id = $2 AND status = 'offered'",
          [service.id, waiter]
        );
        return e || null;
      });
      expect(offered).toBeTruthy();
    }, 15000);

    it("re-confirming a no-show cannot exceed class capacity (409 CLASS_FULL)", async () => {
      const { createClassSession, bookIntoSession, setClassBookingStatus } = require("../../services/class-bookings");
      const service = await makeService("Reconfirm Cap", 60);
      const { session } = await createClassSession(db, {
        service_id: service.id,
        start_at: hoursFromNow(270).toISOString(),
        end_at: hoursFromNow(271).toISOString(),
        max_capacity: 1,
      });
      const cA = await makeCustomer("Reconfirm A", "0300-0000042");
      const cB = await makeCustomer("Reconfirm B", "0300-0000043");
      const { booking: bookingA } = await bookIntoSession(db, { classSessionId: session.id, customerId: cA });
      await setClassBookingStatus(db, bookingA.id, "no_show");
      await bookIntoSession(db, { classSessionId: session.id, customerId: cB }); // refills the spot

      await expect(setClassBookingStatus(db, bookingA.id, "confirmed"))
        .rejects.toMatchObject({ statusCode: 409, code: "CLASS_FULL" });
    });

    it("cancelling a multi-segment appointment does NOT offer the slot (no ghost claim)", async () => {
      const { createAppointment, cancelAppointment } = require("../../services/booking-services");
      const { joinAppointmentWaitlist } = require("../../services/waitlist");
      const svcA = await makeService("Ghost Cut", 30);
      const svcB = await makeService("Ghost Color", 45);
      const appt = await createAppointment(db, {
        service_id: svcA.id, employee_id: 2, start_at: hoursFromNow(280).toISOString(),
        customer_name: "Ghost",
        segments: [{ service_id: svcB.id, employee_id: 3 }],
      }, "admin");
      const waiter = await makeCustomer("Ghost Waiter", "0300-0000044");
      await joinAppointmentWaitlist(db, { serviceId: svcA.id, customerId: waiter });

      await cancelAppointment(db, appt.id, "ghost test", { notifyCtx: { tenantSlug: "test-tenant" } });

      // Negative poll: give the fire-and-forget ripple time to (not) fire.
      await new Promise((r) => setTimeout(r, 1200));
      const { rows: [entry] } = await db.query(
        "SELECT status FROM appointment_waitlist_entries WHERE service_id = $1 AND customer_id = $2",
        [svcA.id, waiter]
      );
      expect(entry.status).toBe("waiting");
    }, 15000);
  });
});
