const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

/**
 * pg-v04-salon.test.js — V04 salon depth.
 *
 * Backend half of the plan's verification bar:
 *   - client service history P0: skeleton record auto-created at appointment
 *     checkout (single + multi-segment), attributed to the performed-by stylist
 *     (segment employee), idempotent on retry; last-visit + history reads;
 *     manual walk-in add; stylist enrich (notes/formula/photos) — formula
 *     round-trips as an array.
 *   - SMS reminder truth: salon appointments seed 24h + 1h SMS reminder rows;
 *     non-salon presets keep the single 1h reminder.
 *   - salon flag seeding: seedSalonFlags + PRESET_EXTRA_FLAGS resolve to the
 *     approved set (loyalty + gift cards + SMS surfaces + packages + waitlist),
 *     and loyalty/gift-cards are NOT in the extra-flags reset set (regression
 *     guard for the preset-switch strip).
 */

describe("V04 — salon depth (Postgres)", () => {
  let app, db, deps, cleanup;

  const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000);

  beforeAll(async () => {
    ({ app, db, deps, cleanup } = await createTestApp());

    const featureFlags = require("../../middleware/feature-flags");
    featureFlags.init({ db, IS_MULTI_TENANT: false });

    await db.query(`
      INSERT INTO feature_flags (key, enabled) VALUES
        ('phase4_appointments', true),
        ('phase2_commissions', true),
        ('packages_passes', true),
        ('phase4_appointments_waitlists', true)
      ON CONFLICT (key) DO UPDATE SET enabled = true
    `);
    await db.query(
      "INSERT INTO tenant_modes (mode, enabled) VALUES ('appointments', true) ON CONFLICT (mode) DO NOTHING"
    );
    // Salon preset so the SMS-forward reminder path activates.
    await db.query("UPDATE company_profile SET industry_type = 'salon' WHERE id = 1");

    require("../../routes/bookings")(app, deps);
    require("../../routes/sales")(app, deps);
    require("../../routes/client-service-records")(app, deps);

    // Sales require an open shift + the ringing employee clocked in.
    await db.query(
      "INSERT INTO cash_shifts (outlet_id, employee_id, opening_float, status) VALUES (1, 1, 500, 'open')"
    );
    await db.query(
      "INSERT INTO attendance_sessions (employee_id, outlet_id, session_type) VALUES (1, 1, 'work')"
    );
  }, 60000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  async function makeCustomer(name, mobile) {
    const { rows: [c] } = await db.query(
      "INSERT INTO customers (name, mobile) VALUES ($1, $2) RETURNING id",
      [name, mobile]
    );
    return c.id;
  }

  async function makeService(name, duration = 60, price = 500) {
    const { rows: [s] } = await db.query(
      "INSERT INTO booking_services (name, duration_minutes, price) VALUES ($1,$2,$3) RETURNING *",
      [name, duration, price]
    );
    return s;
  }

  async function pollFor(fn, { timeoutMs = 5000, everyMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  const bookingSvc = () => require("../../services/booking-services");

  // ─── P0: service history at checkout ──────────────────────────────────────

  describe("client service history (P0)", () => {
    it("auto-creates a skeleton record at appointment checkout, attributed to the provider", async () => {
      const customerId = await makeCustomer("Ayesha", "03001112222");
      const svc = await makeService("Haircut");
      // employee 2 (Manager) is the stylist who performs it.
      const appt = await bookingSvc().createAppointment(db, {
        service_id: svc.id, employee_id: 2, outlet_id: 1,
        start_at: hoursFromNow(2).toISOString(),
        customer_id: customerId, customer_name: "Ayesha", customer_phone: "03001112222",
      }, "admin");

      const res = await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1")
        .set("x-outlet-id", "1")
        .send({
          outlet_id: 1, employee_id: 1, customer_id: customerId,
          cartItems: [{ id: 1, name: "Haircut", price: 500, quantity: 1 }],
          payments: [{ method: "cash", amount: 500 }],
          appointment_id: appt.id,
          idempotency_key: "v04-checkout-" + Date.now(),
        });
      expect(res.status).toBe(200);
      const saleId = res.body.saleId;

      const record = await pollFor(async () => {
        const { rows } = await db.query(
          "SELECT * FROM client_service_records WHERE appointment_id = $1",
          [appt.id]
        );
        return rows.length ? rows[0] : null;
      });
      expect(record).toBeTruthy();
      expect(record.customer_id).toBe(customerId);
      expect(record.sale_id).toBe(saleId);
      expect(record.booking_service_id).toBe(svc.id);
      expect(record.employee_id).toBe(2); // the stylist, NOT the cashier (emp 1)
      expect(record.service_name).toBe("Haircut");
      // Skeleton starts empty — stylist fills these.
      expect(record.notes).toBeNull();
      expect(Array.isArray(record.formula)).toBe(true);
      expect(record.formula.length).toBe(0);
    }, 20000);

    it("multi-segment appointment creates one record per service, each to its own stylist", async () => {
      const customerId = await makeCustomer("Bilal", "03004445555");
      const cut = await makeService("Cut2");
      const color = await makeService("Color2");
      // Primary service (cut, stylist 2) + one extra segment (color, stylist 3).
      const appt = await bookingSvc().createAppointment(db, {
        outlet_id: 1, start_at: hoursFromNow(6).toISOString(),
        customer_id: customerId, customer_name: "Bilal", customer_phone: "03004445555",
        service_id: cut.id, employee_id: 2,
        segments: [{ service_id: color.id, employee_id: 3 }],
      }, "admin");

      await request(app)
        .post("/api/sales")
        .set("x-employee-id", "1").set("x-outlet-id", "1")
        .send({
          outlet_id: 1, employee_id: 1, customer_id: customerId,
          cartItems: [
            { id: 1, name: "Cut2", price: 500, quantity: 1, staff_id: 2 },
            { id: 2, name: "Color2", price: 900, quantity: 1, staff_id: 3 },
          ],
          payments: [{ method: "cash", amount: 1400 }],
          appointment_id: appt.id,
          idempotency_key: "v04-multi-" + Date.now(),
        });

      const records = await pollFor(async () => {
        const { rows } = await db.query(
          "SELECT * FROM client_service_records WHERE appointment_id = $1 ORDER BY booking_service_id",
          [appt.id]
        );
        return rows.length === 2 ? rows : null;
      });
      expect(records).toBeTruthy();
      const byService = Object.fromEntries(records.map((r) => [r.booking_service_id, r]));
      expect(byService[cut.id].employee_id).toBe(2);
      expect(byService[color.id].employee_id).toBe(3);
    }, 20000);

    it("checkout skeleton creation is idempotent (no duplicate on a second attach)", async () => {
      const customerId = await makeCustomer("Chai", "03007778888");
      const svc = await makeService("Beard Trim");
      const appt = await bookingSvc().createAppointment(db, {
        service_id: svc.id, employee_id: 2, outlet_id: 1,
        start_at: hoursFromNow(10).toISOString(), customer_id: customerId,
        customer_name: "Chai", customer_phone: "03007778888",
      }, "admin");

      await request(app).post("/api/sales").set("x-employee-id", "1").set("x-outlet-id", "1")
        .send({ outlet_id: 1, employee_id: 1, customer_id: customerId,
          cartItems: [{ id: 1, name: "Beard Trim", price: 300, quantity: 1 }],
          payments: [{ method: "cash", amount: 300 }], appointment_id: appt.id,
          idempotency_key: "v04-idem-" + Date.now() });

      await pollFor(async () => {
        const { rows } = await db.query("SELECT id FROM client_service_records WHERE appointment_id = $1", [appt.id]);
        return rows.length ? rows : null;
      });
      // Re-run skeleton creation directly (simulating a retry / double-fire).
      const svcMod = require("../../services/client-service-records");
      await svcMod.createSkeletonRecordsForAppointment(db, { saleId: null, appointmentId: appt.id });
      const { rows } = await db.query("SELECT id FROM client_service_records WHERE appointment_id = $1", [appt.id]);
      expect(rows.length).toBe(1);
    }, 20000);

    it("last-visit + history endpoints return the client's records", async () => {
      const customerId = await makeCustomer("Dania", "03009990000");
      const svc = await makeService("Facial");
      const appt = await bookingSvc().createAppointment(db, {
        service_id: svc.id, employee_id: 2, outlet_id: 1,
        start_at: hoursFromNow(14).toISOString(), customer_id: customerId,
        customer_name: "Dania", customer_phone: "03009990000",
      }, "admin");
      await request(app).post("/api/sales").set("x-employee-id", "1").set("x-outlet-id", "1")
        .send({ outlet_id: 1, employee_id: 1, customer_id: customerId,
          cartItems: [{ id: 1, name: "Facial", price: 500, quantity: 1 }],
          payments: [{ method: "cash", amount: 500 }], appointment_id: appt.id,
          idempotency_key: "v04-read-" + Date.now() });
      await pollFor(async () => {
        const { rows } = await db.query("SELECT id FROM client_service_records WHERE customer_id = $1", [customerId]);
        return rows.length ? rows : null;
      });

      const last = await request(app)
        .get(`/api/customers/${customerId}/service-records/last-visit`)
        .set("x-employee-id", "1");
      expect(last.status).toBe(200);
      expect(last.body.record).toBeTruthy();
      expect(last.body.record.service_name).toBe("Facial");
      expect(last.body.record.employee_name).toBe("Manager User");

      const hist = await request(app)
        .get(`/api/customers/${customerId}/service-records`)
        .set("x-employee-id", "1");
      expect(hist.status).toBe(200);
      expect(hist.body.records.length).toBeGreaterThanOrEqual(1);
    }, 20000);

    it("stylist enriches a record: notes + formula (array) + performed-by round-trip", async () => {
      const customerId = await makeCustomer("Esha", "03001010101");
      const svcMod = require("../../services/client-service-records");
      const rec = await svcMod.createManualRecord(db, {
        customerId, serviceName: "Walk-in Color", employeeId: 3,
      });
      const res = await request(app)
        .put(`/api/service-records/${rec.id}`)
        .set("x-employee-id", "1")
        .send({
          notes: "Toned down brassiness",
          formula: [{ label: "Base", value: "6N 40ml" }, { label: "Developer", value: "20vol" }],
          employee_id: 2,
        });
      expect(res.status).toBe(200);
      expect(res.body.record.notes).toBe("Toned down brassiness");
      expect(res.body.record.formula.length).toBe(2);
      expect(res.body.record.formula[0].value).toBe("6N 40ml");
      expect(res.body.record.employee_id).toBe(2);
    });

    it("manual add creates a walk-in record with no appointment", async () => {
      const customerId = await makeCustomer("Farah", "03002020202");
      const res = await request(app)
        .post("/api/service-records")
        .set("x-employee-id", "1")
        .send({ customer_id: customerId, service_name: "Walk-in Blowout", employee_id: 3, notes: "Loves volume" });
      expect(res.status).toBe(201);
      expect(res.body.record.appointment_id).toBeNull();
      expect(res.body.record.service_name).toBe("Walk-in Blowout");
    });

    it("rejects a non-array formula", async () => {
      const customerId = await makeCustomer("Gul", "03003030303");
      const svcMod = require("../../services/client-service-records");
      const rec = await svcMod.createManualRecord(db, { customerId, serviceName: "X" });
      const res = await request(app)
        .put(`/api/service-records/${rec.id}`)
        .set("x-employee-id", "1")
        .send({ formula: { base: "wrong" } });
      expect(res.status).toBe(400);
    });
  });

  // ─── P1: SMS reminder truthfulness ────────────────────────────────────────

  describe("SMS reminder defaults", () => {
    it("salon appointment with a phone seeds 24h + 1h SMS reminders", async () => {
      const customerId = await makeCustomer("Hina", "03005050505");
      const svc = await makeService("Keratin");
      const appt = await bookingSvc().createAppointment(db, {
        service_id: svc.id, employee_id: 2, outlet_id: 1,
        start_at: hoursFromNow(48).toISOString(), // far enough that both offsets are future
        customer_id: customerId, customer_name: "Hina", customer_phone: "03005050505",
      }, "admin");
      const { rows } = await db.query(
        "SELECT minutes_before, channel FROM appointment_reminders WHERE appointment_id = $1 ORDER BY minutes_before DESC",
        [appt.id]
      );
      expect(rows.length).toBe(2);
      expect(rows[0]).toEqual({ minutes_before: 1440, channel: "sms" });
      expect(rows[1]).toEqual({ minutes_before: 60, channel: "sms" });
    });

    it("non-salon preset keeps the single 1h reminder", async () => {
      await db.query("UPDATE company_profile SET industry_type = 'clinic' WHERE id = 1");
      try {
        const customerId = await makeCustomer("Imran", "03006060606");
        const svc = await makeService("Consult");
        const appt = await bookingSvc().createAppointment(db, {
          service_id: svc.id, employee_id: 2, outlet_id: 1,
          start_at: hoursFromNow(52).toISOString(),
          customer_id: customerId, customer_name: "Imran", customer_phone: "03006060606",
        }, "admin");
        const { rows } = await db.query(
          "SELECT minutes_before, channel FROM appointment_reminders WHERE appointment_id = $1",
          [appt.id]
        );
        expect(rows.length).toBe(1);
        expect(rows[0].minutes_before).toBe(60);
      } finally {
        await db.query("UPDATE company_profile SET industry_type = 'salon' WHERE id = 1");
      }
    });
  });

  // ─── Salon flag seeding (config-level) ────────────────────────────────────

  describe("salon flag seeding", () => {
    it("seedSalonFlags enables loyalty + gift cards + SMS surfaces", async () => {
      const { SALON_SEED_FLAGS } = require("../../services/retail-flag-preset");
      expect(SALON_SEED_FLAGS).toEqual(
        expect.arrayContaining(["phase2g_loyalty", "phase2g_gift_cards", "sms_campaigns", "phase5_sms_providers"])
      );
    });

    it("PRESET_EXTRA_FLAGS gives salon packages + waitlist, and NOT loyalty/gift-cards", () => {
      const { getExtraFlagsForPreset, ALL_PRESET_EXTRA_FLAGS } = require("../../config/industry-config");
      const salonExtras = getExtraFlagsForPreset("salon");
      expect(salonExtras).toEqual(
        expect.arrayContaining(["packages_passes", "phase4_appointments_waitlists"])
      );
      // Regression guard: loyalty/gift-cards must never be in the extra-flags
      // reset set, or a preset switch away from salon would strip them from
      // retail tenants (see preset-switch path in tier4/company-profile.js).
      expect(ALL_PRESET_EXTRA_FLAGS).not.toContain("phase2g_loyalty");
      expect(ALL_PRESET_EXTRA_FLAGS).not.toContain("phase2g_gift_cards");
    });
  });
});
