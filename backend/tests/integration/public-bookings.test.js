/**
 * public-bookings.test.js — M6 Online Booking Page integration tests.
 *
 * Covers:
 *   - GET /api/public/bookings/config returns labels + services
 *   - GET /api/public/bookings/availability returns slots
 *   - POST /api/public/bookings creates appointment + enqueues confirmation email
 *   - POST rejects overlapping slot with 409
 *   - POST rejects start_at in the past with 400
 *   - POST rejects start_at beyond max_advance_days with 400
 *   - GET /api/public/bookings/:id/ics returns text/calendar with VEVENT
 *
 * Runs in single-tenant mode so `resolvePublicTenantDb` returns `deps.db`
 * directly without touching the master tenant registry.
 */

const request = require("supertest");

// Mock pg-boss so enqueueEmail() doesn't try to connect to a real queue.
// Captured calls are asserted below.
const bossSendCalls = [];
jest.mock("../../services/boss", () => ({
  getBoss: async () => ({
    send: async (queue, payload, opts) => {
      bossSendCalls.push({ queue, payload, opts });
      return "test-job-id";
    },
  }),
  shutdownBoss: async () => {},
}));

const { createTestApp } = require("../helpers/createTestApp-pg");

jest.setTimeout(120000);

describe("M6 — Public Bookings (Postgres, single-tenant mode)", () => {
  let app, db, deps, cleanup;

  // Derive a future weekday so availability rules match regardless of when
  // the suite is run. Pick 14 days out, then find the next Monday.
  const futureDateStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  let serviceId;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Seed a salon preset on company_profile so labels fall through correctly.
    await db.query(
      `UPDATE company_profile SET industry_type = 'salon' WHERE id = 1`
    );

    // Create a booking service with max_advance_days=30.
    const { rows: [svc] } = await db.query(
      `INSERT INTO booking_services (name, duration_minutes, padding_minutes, price,
         requires_confirmation, max_advance_days, is_active)
       VALUES ('Haircut', 30, 0, 500, false, 30, true) RETURNING *`
    );
    serviceId = svc.id;

    // Assign employee 1 to the service.
    await db.query(
      "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, 1)",
      [serviceId]
    );

    // Availability every Monday 09:00-17:00 for employee 1.
    await db.query(
      `INSERT INTO booking_availability_rules (employee_id, day_of_week, start_time, end_time, is_active)
       VALUES (1, 1, '09:00', '17:00', true)`
    );

    // Register the public-bookings routes under test.
    require("../../routes/public-bookings")(app, deps);
  }, 120000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  beforeEach(() => {
    bossSendCalls.length = 0;
  });

  describe("GET /api/public/bookings/config", () => {
    it("returns services + labels for salon preset", async () => {
      const res = await request(app).get("/api/public/bookings/config");
      expect(res.status).toBe(200);
      expect(res.body.services.length).toBeGreaterThanOrEqual(1);
      expect(res.body.labels).toBeTruthy();
      expect(res.body.labels.booking_cta).toBe("Book an appointment");
      expect(res.body.labels.staff_singular).toBe("Stylist");
      expect(res.body.labels.service_singular).toBe("Service");
    });
  });

  describe("GET /api/public/bookings/availability", () => {
    it("returns slots for the seeded Monday", async () => {
      const res = await request(app)
        .get("/api/public/bookings/availability")
        .query({ service_id: serviceId, date: futureDateStr });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.slots)).toBe(true);
      expect(res.body.slots.length).toBeGreaterThan(0);
    });

    it("returns 400 when service_id missing", async () => {
      const res = await request(app)
        .get("/api/public/bookings/availability")
        .query({ date: futureDateStr });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/public/bookings", () => {
    it("creates a booking + enqueues confirmation email (201)", async () => {
      const res = await request(app)
        .post("/api/public/bookings")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDateStr}T10:00:00.000Z`,
          customer_name: "Public Jane",
          customer_phone: "03001234567",
          customer_email: "jane@example.com",
          notes: "First visit",
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.status).toBe("confirmed");
      expect(res.body.start_at).toBeTruthy();

      // DB row confirms source=public.
      const { rows: [row] } = await db.query(
        "SELECT source, customer_email FROM appointments WHERE id = $1",
        [res.body.id]
      );
      expect(row.source).toBe("public");
      expect(row.customer_email).toBe("jane@example.com");

      // The email-enqueue was routed through our mocked pg-boss.
      const emailJobs = bossSendCalls.filter((c) => c.queue === "email");
      expect(emailJobs.length).toBe(1);
      expect(emailJobs[0].payload.to).toBe("jane@example.com");
      expect(emailJobs[0].payload.type).toBe("booking_confirmation");
      expect(String(emailJobs[0].payload.subject)).toMatch(/Booking/i);
    });

    it("rejects overlapping slot with 409", async () => {
      const res = await request(app)
        .post("/api/public/bookings")
        .send({
          service_id: serviceId,
          employee_id: 1,
          // Overlaps the 10:00–10:30 booking created above.
          start_at: `${futureDateStr}T10:15:00.000Z`,
          customer_name: "Double Book",
          customer_phone: "03001111111",
          customer_email: "double@example.com",
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already booked/i);
    });

    it("rejects start_at in the past with 400", async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post("/api/public/bookings")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: pastDate,
          customer_name: "Past Booker",
          customer_phone: "03000000000",
        });
      expect(res.status).toBe(400);
    });

    it("rejects start_at beyond max_advance_days (400)", async () => {
      const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post("/api/public/bookings")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: farFuture,
          customer_name: "Too Far",
          customer_phone: "03009999999",
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/days ahead/i);
    });

    it("returns 400 when required fields missing (Zod)", async () => {
      const res = await request(app)
        .post("/api/public/bookings")
        .send({ service_id: serviceId }); // missing start_at + customer_name + customer_phone
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/public/bookings/:id/ics", () => {
    let apptId;

    beforeAll(async () => {
      // Create an appointment via createAppointment with source=public (admin route
      // sets source=admin, so we insert directly).
      const { rows: [appt] } = await db.query(
        `INSERT INTO appointments
           (service_id, employee_id, outlet_id, status, start_at, end_at,
            customer_name, customer_phone, customer_email, source)
         VALUES ($1, 1, 1, 'confirmed', $2, $3, 'ICS Tester', '03001234567',
                 'ics@example.com', 'public')
         RETURNING id`,
        [
          serviceId,
          `${futureDateStr}T13:00:00.000Z`,
          `${futureDateStr}T13:30:00.000Z`,
        ]
      );
      apptId = appt.id;
    });

    it("returns a valid VEVENT as text/calendar", async () => {
      const res = await request(app).get(`/api/public/bookings/${apptId}/ics`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/calendar/);
      expect(res.text).toMatch(/BEGIN:VCALENDAR/);
      expect(res.text).toMatch(/BEGIN:VEVENT/);
      expect(res.text).toMatch(/END:VEVENT/);
      expect(res.text).toMatch(/END:VCALENDAR/);
      expect(res.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(res.text).toMatch(/DTEND:\d{8}T\d{6}Z/);
      expect(res.text).toMatch(/SUMMARY:/);
      expect(res.text).toMatch(new RegExp(`UID:booking-${apptId}@`));
    });

    it("returns 404 for non-existent booking", async () => {
      const res = await request(app).get("/api/public/bookings/999999/ics");
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid id", async () => {
      const res = await request(app).get("/api/public/bookings/abc/ics");
      expect(res.status).toBe(400);
    });
  });
});
