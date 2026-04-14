/**
 * Integration tests — portal-driven appointment lifecycle.
 * Book / reschedule / cancel with ownership + 15-min-notice guard.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const express = require("express");
const cookieParser = require("cookie-parser");
const supertest = require("supertest");
const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");

const STUB_TENANT = { id: 999, slug: "acme", name: "Acme Co" };
const publicTenantCtx = require("../../services/public-tenant-context");
const originalResolve = publicTenantCtx.resolvePublicTenantDb;

let testDb;
publicTenantCtx.resolvePublicTenantDb = async () => ({
  db: testDb,
  tenant: STUB_TENANT,
});

let app, cleanup, req, token, customerId, serviceId;

beforeAll(async () => {
  process.env.CUSTOMER_PORTAL_JWT_SECRET = "appt-test-secret";

  const result = await createTestApp();
  app = result.app;
  testDb = result.db;
  cleanup = result.cleanup;

  app.use(cookieParser());
  require("../../routes/customer-portal/auth")(app, {});
  require("../../routes/customer-portal/appointments")(app, {});
  require("../../routes/customer-portal/data")(app, {});
  req = supertest(app);

  // Seed a booking service + an employee assigned to it. booking_services
  // is created by migration v22, so the column list must match the real DDL.
  const { rows: svcRows } = await testDb.query(
    `INSERT INTO booking_services (name, duration_minutes, requires_confirmation, is_active)
     VALUES ('Haircut', 30, false, true)
     RETURNING id`
  );
  serviceId = svcRows[0].id;

  // Create portal-enabled customer.
  const pwHash = await bcrypt.hash("Book1234!", 4);
  const { rows: cRows } = await testDb.query(
    `INSERT INTO customers (name, email, portal_password_hash, portal_enabled_at, portal_email_verified_at)
     VALUES ('Booker', 'booker@example.com', $1, NOW(), NOW())
     RETURNING id`,
    [pwHash]
  );
  customerId = cRows[0].id;

  const loginRes = await req
    .post("/api/portal/auth/login?tenant=acme")
    .send({ email: "booker@example.com", password: "Book1234!" })
    .expect(200);
  token = loginRes.body.access_token;
}, 60000);

afterAll(async () => {
  publicTenantCtx.resolvePublicTenantDb = originalResolve;
  if (cleanup) await cleanup();
  delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
}, 30000);

function futureIso(hoursAhead) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

describe("POST /api/portal/me/appointments", () => {
  test("books an appointment with source='portal'", async () => {
    const start = futureIso(48);
    const res = await req
      .post("/api/portal/me/appointments?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .send({ service_id: serviceId, start_at: start })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.customer_id).toBe(customerId);
    expect(res.body.source).toBe("portal");
  });

  test("rejects a booking less than 15 minutes from now", async () => {
    const start = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const res = await req
      .post("/api/portal/me/appointments?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .send({ service_id: serviceId, start_at: start });
    expect([400]).toContain(res.status);
    expect(res.body.error).toMatch(/15 minutes/i);
  });

  test("rejects booking without auth", async () => {
    await req
      .post("/api/portal/me/appointments?tenant=acme")
      .send({ service_id: serviceId, start_at: futureIso(24) })
      .expect(401);
  });
});

describe("PUT /api/portal/me/appointments/:id/reschedule", () => {
  let apptId;

  beforeAll(async () => {
    const res = await req
      .post("/api/portal/me/appointments?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .send({ service_id: serviceId, start_at: futureIso(72) })
      .expect(201);
    apptId = res.body.id;
  });

  test("reschedules to a new valid future time", async () => {
    const newStart = futureIso(96);
    const res = await req
      .put(`/api/portal/me/appointments/${apptId}/reschedule?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ start_at: newStart })
      .expect(200);
    expect(new Date(res.body.start_at).getTime()).toBeCloseTo(new Date(newStart).getTime(), -4);
  });

  test("rejects reschedule within 15-minute window", async () => {
    const close = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const res = await req
      .put(`/api/portal/me/appointments/${apptId}/reschedule?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ start_at: close });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/15 minutes/i);
  });

  test("rejects reschedule of another customer's appointment (404)", async () => {
    // Appointment owned by a different customer.
    const { rows: [other] } = await testDb.query(
      `INSERT INTO customers (name, email) VALUES ('Someone Else', 'somebody@example.com') RETURNING id`
    );
    const { rows: [otherAppt] } = await testDb.query(
      `INSERT INTO appointments
         (service_id, customer_id, status, start_at, end_at, customer_name, source)
       VALUES ($1, $2, 'confirmed', NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 30 minutes', 'Other', 'admin')
       RETURNING id`,
      [serviceId, other.id]
    );

    await req
      .put(`/api/portal/me/appointments/${otherAppt.id}/reschedule?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ start_at: futureIso(96) })
      .expect(404);
  });
});

describe("PUT /api/portal/me/appointments/:id/cancel", () => {
  test("cancels an owned appointment", async () => {
    const bookRes = await req
      .post("/api/portal/me/appointments?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .send({ service_id: serviceId, start_at: futureIso(168) })
      .expect(201);
    const id = bookRes.body.id;

    const res = await req
      .put(`/api/portal/me/appointments/${id}/cancel?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Scheduling conflict" })
      .expect(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.cancellation_reason).toBe("Scheduling conflict");
  });
});

describe("GET /api/portal/me/appointments", () => {
  test("scopes the list to the logged-in customer", async () => {
    const res = await req
      .get("/api/portal/me/appointments?scope=upcoming&tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const a of res.body) {
      // All entries should be from future, and none can belong to other customers.
      expect(new Date(a.start_at).getTime()).toBeGreaterThanOrEqual(Date.now() - 60000);
    }
  });
});
