/**
 * pg-admin-vertical-usage.test.js
 *
 * Chunk 2 (admin refresh) — vertical-aware tenant management:
 * - GET /api/admin/tenants          → industry_type + modes[] enrichment
 * - GET /api/admin/tenants/:id/vertical-usage → per-mode adoption counts
 *
 * Runs against the real public schema (admin routes hardcode db-pg), same
 * pattern as pg-batch11-admin.test.js. Provisions a throwaway tenant via the
 * admin create endpoint, seeds preset/mode/domain rows directly, cleans up.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-vertical@example.com";
const SLUG = "test_vert_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Admin vertical-aware tenant management", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassVert!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Vert')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2
       RETURNING id`,
      [TEST_ADMIN_EMAIL, hash]
    );
    adminId = sa.id;
    adminToken = jwt.sign(
      { tid: 0, eid: 0, rid: 0, oid: null, aid: adminId, email: TEST_ADMIN_EMAIL, role: "super_admin", scope: "admin" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    app = express();
    app.use(express.json());
    const registerAdminRoutes = require("../../routes/admin");
    registerAdminRoutes(app, { authLimiter: (req, res, next) => next() });

    // Provision a real tenant schema through the admin endpoint.
    const createRes = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ slug: SLUG, name: "Vertical Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;

    // Seed a clinic-flavoured preset state + domain activity directly.
    await pool.query(`UPDATE ${SCHEMA}.company_profile SET industry_type = 'dental_clinic', setup_complete = true WHERE id = 1`);
    await pool.query(`INSERT INTO ${SCHEMA}.tenant_modes (mode, enabled) VALUES ('treatment_plans', true), ('appointments', true) ON CONFLICT (mode) DO UPDATE SET enabled = true`);
    // One customer to satisfy FK-ish flows, one treatment plan, two appointments.
    const { rows: [cust] } = await pool.query(
      `INSERT INTO ${SCHEMA}.customers (name) VALUES ('Vert Patient') RETURNING id`
    );
    await pool.query(
      `INSERT INTO ${SCHEMA}.treatment_plans (plan_number, customer_id, created_by, title, status)
       VALUES ('TP-TEST-1', $1, 1, 'Root canal', 'active')`,
      [cust.id]
    );
    const { rows: [svc] } = await pool.query(
      `INSERT INTO ${SCHEMA}.booking_services (name, duration_minutes) VALUES ('Consultation', 30) RETURNING id`
    );
    await pool.query(
      `INSERT INTO ${SCHEMA}.appointments (service_id, customer_id, start_at, end_at, status)
       VALUES ($1, $2, NOW() + interval '1 day', NOW() + interval '1 day 30 minutes', 'confirmed'),
              ($1, $2, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes', 'confirmed')`,
      [svc.id, cust.id]
    );
  }, 60000);

  afterAll(async () => {
    if (tenantId) {
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [tenantId]);
      await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  test("tenant list rows carry industry_type and enabled modes", async () => {
    const res = await request(app)
      .get("/api/admin/tenants")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.tenants.find((t) => t.id === tenantId);
    expect(row).toBeTruthy();
    expect(row.industry_type).toBe("dental_clinic");
    expect(row.modes).toEqual(["appointments", "treatment_plans"]);
  });

  test("vertical-usage returns preset info + per-mode counts", async () => {
    const res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/vertical-usage`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.industry_type).toBe("dental_clinic");
    expect(res.body.business_model).toBe("clinical_treatment");
    expect(res.body.modes).toEqual(["appointments", "treatment_plans"]);

    const byKey = Object.fromEntries(res.body.usage.map((u) => [u.key, u]));
    expect(byKey.treatment_plans.count).toBe(1);
    expect(byKey.appointments.count).toBe(2);
    expect(byKey.appointments.last_activity).toBeTruthy();
    // Untouched verticals still report zero rather than being omitted.
    expect(byKey.rental_contracts.count).toBe(0);
  });

  test("vertical-usage 404s for unknown tenant", async () => {
    const res = await request(app)
      .get("/api/admin/tenants/999999/vertical-usage")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test("requires super-admin auth", async () => {
    const res = await request(app).get(`/api/admin/tenants/${tenantId}/vertical-usage`);
    expect(res.status).toBe(401);
  });
});
