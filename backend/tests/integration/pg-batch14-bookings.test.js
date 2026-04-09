const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

/**
 * pg-batch14-bookings.test.js — Phase 4B Booking integration tests (Postgres).
 *
 * Covers: booking services CRUD, availability rules + blocks,
 * appointment lifecycle (create, reschedule, cancel, double-booking rejection),
 * public booking source, and appointment reminders.
 */

describe("Batch 14 — Phase 4B Bookings (Postgres)", () => {
  let app, db, deps, cleanup;

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    // Initialise feature-flags module with the test DB
    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    // Inject employee context from header
    app.use((req, _res, next) => {
      const eid = req.headers["x-employee-id"];
      if (eid) req.employee = { id: Number(eid) };
      next();
    });

    // Register booking routes
    require("../../routes/bookings")(app, deps);

    // Enable Phase 4 booking feature flag
    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_appointments', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);

    // Grant booking permission to role 2 (Manager)
    await db.query(
      `INSERT INTO role_permissions (role_id, permission) VALUES (2, 'manage_bookings')
       ON CONFLICT DO NOTHING`
    );

    // Ensure employee 1 exists (seed data from createTestApp)
    // Ensure an action_history table exists for audit logging
  }, 30000);

  afterAll(async () => {
    const featureFlags = require("../../middleware/feature-flags");
    if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    if (cleanup) await cleanup();
  });

  // ─── BOOKING SERVICES CRUD ──────────────────────────────────

  describe("booking services", () => {
    let serviceId;

    it("POST /api/booking-services creates service with duration/price (201)", async () => {
      const res = await request(app)
        .post("/api/booking-services")
        .set("x-employee-id", "1")
        .send({
          name: "Haircut",
          duration_minutes: 30,
          padding_minutes: 5,
          price: 500,
          requires_confirmation: false,
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.name).toBe("Haircut");
      expect(res.body.duration_minutes).toBe(30);
      expect(Number(res.body.price)).toBe(500);
      serviceId = res.body.id;
    });

    it("POST /api/booking-services creates service with staff_ids (201)", async () => {
      const res = await request(app)
        .post("/api/booking-services")
        .set("x-employee-id", "1")
        .send({
          name: "Massage",
          duration_minutes: 60,
          price: 2000,
          staff_ids: [1],
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Massage");
      expect(res.body.duration_minutes).toBe(60);
    });

    it("GET /api/booking-services lists services with staff (200)", async () => {
      const res = await request(app)
        .get("/api/booking-services")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(res.body.services.length).toBeGreaterThanOrEqual(2);
      const massage = res.body.services.find((s) => s.name === "Massage");
      expect(massage).toBeTruthy();
      expect(massage.staff).toBeTruthy();
      expect(massage.staff.length).toBe(1);
      expect(massage.staff[0].id).toBe(1);
    });

    it("PUT /api/booking-services/:id updates service (200)", async () => {
      const res = await request(app)
        .put(`/api/booking-services/${serviceId}`)
        .set("x-employee-id", "1")
        .send({ name: "Haircut Deluxe", price: 750 });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Haircut Deluxe");
      expect(Number(res.body.price)).toBe(750);
    });

    it("PUT /api/booking-services/:id updates staff_ids (200)", async () => {
      const res = await request(app)
        .put(`/api/booking-services/${serviceId}`)
        .set("x-employee-id", "1")
        .send({ staff_ids: [1] });
      expect(res.status).toBe(200);

      // Verify staff assignment via list
      const list = await request(app)
        .get("/api/booking-services")
        .set("x-employee-id", "1");
      const svc = list.body.services.find((s) => s.id === serviceId);
      expect(svc.staff).toBeTruthy();
      expect(svc.staff.length).toBe(1);
    });
  });

  // ─── AVAILABILITY ───────────────────────────────────────────

  describe("availability", () => {
    let serviceId;
    // Use a future date that is a Monday (day_of_week = 1)
    const futureDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14); // 2 weeks from now
      // Advance to next Monday
      while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    beforeAll(async () => {
      // Create a service with employee 1 assigned
      const { rows: [svc] } = await db.query(
        `INSERT INTO booking_services (name, duration_minutes, padding_minutes, price)
         VALUES ('Availability Test Service', 30, 0, 100) RETURNING *`
      );
      serviceId = svc.id;

      // Assign employee 1 to this service
      await db.query(
        "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, 1)",
        [serviceId]
      );

      // Add availability rule for employee 1 on Monday (day_of_week = 1), 09:00-12:00
      await db.query(
        `INSERT INTO booking_availability_rules (employee_id, day_of_week, start_time, end_time, is_active)
         VALUES (1, 1, '09:00', '12:00', true)`
      );
    });

    it("GET /api/appointments/availability returns valid slots (200)", async () => {
      const res = await request(app)
        .get("/api/appointments/availability")
        .query({ service_id: serviceId, date: futureDate })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.slots)).toBe(true);
      expect(res.body.slots.length).toBeGreaterThan(0);

      // Each slot should have correct structure
      const slot = res.body.slots[0];
      expect(slot.employee_id).toBe(1);
      expect(slot.start_at).toBeTruthy();
      expect(slot.end_at).toBeTruthy();
      expect(slot.duration_minutes).toBe(30);

      // All slots should be within the 09:00-12:00 window
      for (const s of res.body.slots) {
        const hour = parseInt(s.start_at.split("T")[1].split(":")[0], 10);
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(12);
      }
    });

    it("GET /api/appointments/availability without service_id returns 400", async () => {
      const res = await request(app)
        .get("/api/appointments/availability")
        .query({ date: futureDate })
        .set("x-employee-id", "1");
      expect(res.status).toBe(400);
    });

    it("blocked time does not appear in available slots", async () => {
      // Insert a block for employee 1 on the test date covering 09:00-10:00
      await db.query(
        `INSERT INTO appointment_blocks (employee_id, block_type, start_at, end_at, reason)
         VALUES (1, 'unavailable', $1, $2, 'Staff meeting')`,
        [`${futureDate}T09:00:00`, `${futureDate}T10:00:00`]
      );

      const res = await request(app)
        .get("/api/appointments/availability")
        .query({ service_id: serviceId, date: futureDate })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);

      // No slots should start within the 09:00-10:00 blocked window
      for (const s of res.body.slots) {
        const startTime = s.start_at.split("T")[1].slice(0, 5);
        const startMinutes = parseInt(startTime.split(":")[0], 10) * 60 + parseInt(startTime.split(":")[1], 10);
        // Slot must not overlap with 09:00 (540 min) to 10:00 (600 min)
        const endMinutes = startMinutes + 30;
        const overlaps = startMinutes < 600 && endMinutes > 540;
        expect(overlaps).toBe(false);
      }

      // Clean up block for subsequent tests
      await db.query(
        `DELETE FROM appointment_blocks WHERE employee_id = 1 AND reason = 'Staff meeting'`
      );
    });

    it("returns slots filtered by specific employee_id", async () => {
      const res = await request(app)
        .get("/api/appointments/availability")
        .query({ service_id: serviceId, employee_id: 1, date: futureDate })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      for (const s of res.body.slots) {
        expect(s.employee_id).toBe(1);
      }
    });
  });

  // ─── APPOINTMENTS ───────────────────────────────────────────

  describe("appointments", () => {
    let serviceId;
    let appointmentId;
    // Use a future date that is a Tuesday (day_of_week = 2) to avoid collision with availability tests
    const futureDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    beforeAll(async () => {
      // Create a service
      const { rows: [svc] } = await db.query(
        `INSERT INTO booking_services (name, duration_minutes, padding_minutes, price, requires_confirmation)
         VALUES ('Appointment Test Service', 60, 0, 200, false) RETURNING *`
      );
      serviceId = svc.id;

      // Assign employee 1
      await db.query(
        "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, 1)",
        [serviceId]
      );

      // Add availability rule for Tuesday 09:00-17:00
      await db.query(
        `INSERT INTO booking_availability_rules (employee_id, day_of_week, start_time, end_time, is_active)
         VALUES (1, 2, '09:00', '17:00', true)`
      );
    });

    it("POST /api/appointments creates appointment in available slot (201, status=confirmed)", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDate}T10:00:00`,
          customer_name: "John Doe",
          customer_phone: "03001234567",
          customer_email: "john@example.com",
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.status).toBe("confirmed");
      expect(res.body.service_id).toBe(serviceId);
      expect(res.body.employee_id).toBe(1);
      expect(res.body.customer_name).toBe("John Doe");
      appointmentId = res.body.id;
    });

    it("POST /api/appointments rejects double-booking (409)", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDate}T10:30:00`, // overlaps with 10:00-11:00
          customer_name: "Jane Doe",
          customer_phone: "03009876543",
        });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already booked/i);
    });

    it("POST /api/appointments allows non-overlapping booking (201)", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDate}T14:00:00`,
          customer_name: "Ali Khan",
          customer_phone: "03211234567",
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("confirmed");
    });

    it("GET /api/appointments lists appointments (200)", async () => {
      const res = await request(app)
        .get("/api/appointments")
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.appointments)).toBe(true);
      expect(res.body.appointments.length).toBeGreaterThanOrEqual(2);
    });

    it("GET /api/appointments filters by status", async () => {
      const res = await request(app)
        .get("/api/appointments")
        .query({ status: "confirmed" })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      for (const a of res.body.appointments) {
        expect(a.status).toBe("confirmed");
      }
    });

    it("GET /api/appointments filters by employee_id", async () => {
      const res = await request(app)
        .get("/api/appointments")
        .query({ employee_id: 1 })
        .set("x-employee-id", "1");
      expect(res.status).toBe(200);
      for (const a of res.body.appointments) {
        expect(a.employee_id).toBe(1);
      }
    });

    it("POST /api/appointments/:id/reschedule updates time (200)", async () => {
      const res = await request(app)
        .post(`/api/appointments/${appointmentId}/reschedule`)
        .set("x-employee-id", "1")
        .send({ start_at: `${futureDate}T12:00:00` });
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(appointmentId);
      // end_at should be 1 hour after new start (60 min service)
      expect(res.body.start_at).toContain("12:00");
    });

    it("POST /api/appointments/:id/reschedule rejects overlap (409)", async () => {
      // Try to reschedule into the 14:00-15:00 slot already taken
      const res = await request(app)
        .post(`/api/appointments/${appointmentId}/reschedule`)
        .set("x-employee-id", "1")
        .send({ start_at: `${futureDate}T14:00:00` });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already booked/i);
    });

    it("POST /api/appointments/:id/cancel sets status=cancelled (200)", async () => {
      const res = await request(app)
        .post(`/api/appointments/${appointmentId}/cancel`)
        .set("x-employee-id", "1")
        .send({ reason: "Customer requested cancellation" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
      expect(res.body.cancelled_at).toBeTruthy();
      expect(res.body.cancellation_reason).toBe("Customer requested cancellation");
    });

    it("POST /api/appointments/:id/cancel on already cancelled returns 404", async () => {
      const res = await request(app)
        .post(`/api/appointments/${appointmentId}/cancel`)
        .set("x-employee-id", "1")
        .send({ reason: "Duplicate cancel" });
      expect(res.status).toBe(404);
    });
  });

  // ─── PUBLIC BOOKING (source=public, requires_confirmation) ──

  describe("public booking source", () => {
    let publicServiceId;
    const futureDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      while (d.getDay() !== 3) d.setDate(d.getDate() + 1); // Wednesday
      return d.toISOString().slice(0, 10);
    })();

    beforeAll(async () => {
      // Create a service that requires confirmation
      const { rows: [svc] } = await db.query(
        `INSERT INTO booking_services (name, duration_minutes, price, requires_confirmation)
         VALUES ('Public Booking Service', 45, 1500, true) RETURNING *`
      );
      publicServiceId = svc.id;

      // Assign employee 1
      await db.query(
        "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, 1)",
        [publicServiceId]
      );

      // Availability rule for Wednesday
      await db.query(
        `INSERT INTO booking_availability_rules (employee_id, day_of_week, start_time, end_time, is_active)
         VALUES (1, 3, '09:00', '17:00', true)`
      );
    });

    it("appointment with source=public and requires_confirmation=true gets status=pending", async () => {
      // Use the createAppointment service directly with "public" source
      // since the /api/appointments route uses "admin" source.
      // Insert via the booking-services module to test the logic.
      const { createAppointment } = require("../../services/booking-services");
      const appt = await createAppointment(db, {
        service_id: publicServiceId,
        employee_id: 1,
        start_at: `${futureDate}T10:00:00`,
        customer_name: "Public Customer",
        customer_phone: "03001112233",
        customer_email: "public@example.com",
      }, "public");

      expect(appt.status).toBe("pending");
      expect(appt.source).toBe("public");
      expect(appt.customer_name).toBe("Public Customer");
    });

    it("appointment via admin route gets status=confirmed even when service requires_confirmation", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: publicServiceId,
          employee_id: 1,
          start_at: `${futureDate}T14:00:00`,
          customer_name: "Admin Booked Customer",
          customer_phone: "03009998877",
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("confirmed");
    });
  });

  // ─── APPOINTMENT REMINDERS ──────────────────────────────────

  describe("appointment reminders", () => {
    const futureDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      while (d.getDay() !== 4) d.setDate(d.getDate() + 1); // Thursday
      return d.toISOString().slice(0, 10);
    })();

    let serviceId;

    beforeAll(async () => {
      const { rows: [svc] } = await db.query(
        `INSERT INTO booking_services (name, duration_minutes, price)
         VALUES ('Reminder Test Service', 30, 100) RETURNING *`
      );
      serviceId = svc.id;

      await db.query(
        "INSERT INTO booking_staff_assignments (service_id, employee_id) VALUES ($1, 1)",
        [serviceId]
      );

      // Thursday availability
      await db.query(
        `INSERT INTO booking_availability_rules (employee_id, day_of_week, start_time, end_time, is_active)
         VALUES (1, 4, '09:00', '17:00', true)`
      );
    });

    it("creates reminder row when appointment has customer_email", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDate}T10:00:00`,
          customer_name: "Reminder Test",
          customer_phone: "03001234567",
          customer_email: "reminder@example.com",
        });
      expect(res.status).toBe(201);

      const { rows } = await db.query(
        "SELECT * FROM appointment_reminders WHERE appointment_id = $1",
        [res.body.id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].channel).toBe("email");
      expect(rows[0].minutes_before).toBe(60);
      expect(rows[0].status).toBe("pending");
    });

    it("creates sms reminder when appointment has phone but no email", async () => {
      const res = await request(app)
        .post("/api/appointments")
        .set("x-employee-id", "1")
        .send({
          service_id: serviceId,
          employee_id: 1,
          start_at: `${futureDate}T14:00:00`,
          customer_name: "SMS Reminder Test",
          customer_phone: "03009876543",
        });
      expect(res.status).toBe(201);

      const { rows } = await db.query(
        "SELECT * FROM appointment_reminders WHERE appointment_id = $1",
        [res.body.id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].channel).toBe("sms");
    });
  });

  // ─── FEATURE FLAG GATING ────────────────────────────────────

  describe("feature flag gating", () => {
    beforeAll(async () => {
      await db.query("UPDATE feature_flags SET enabled = false WHERE key = 'phase4_appointments'");
      const featureFlags = require("../../middleware/feature-flags");
      if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    });

    afterAll(async () => {
      await db.query("UPDATE feature_flags SET enabled = true WHERE key = 'phase4_appointments'");
      const featureFlags = require("../../middleware/feature-flags");
      if (featureFlags.invalidateFeatureFlagCache) featureFlags.invalidateFeatureFlagCache();
    });

    it("returns 503 when phase4_appointments feature flag is disabled", async () => {
      const res = await request(app)
        .get("/api/booking-services")
        .set("x-employee-id", "1");
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Feature disabled/i);
    });
  });
});
