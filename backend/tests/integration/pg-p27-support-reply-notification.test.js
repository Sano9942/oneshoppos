/**
 * P27 — Admin reply must insert a row into the tenant's notifications table
 * so the tenant employee's NotificationBell shows the reply.
 *
 * Pre-fix the route INSERTed into a non-existent `employee_id` column on
 * notifications, throwing an error that was silently swallowed by a
 * `catch (_) { /* non-critical *\/ }`. Reply succeeded (200), notification
 * never landed.
 *
 * This test mirrors pg-batch11-admin's setup — provisions a real tenant
 * via the admin tenant-create route, then exercises the reply path
 * end-to-end and asserts the row in `tenant_<slug>.notifications`.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-p27@example.com";
const TEST_ADMIN_PASSWORD = "TestPassP27!";
const TEST_TENANT_SLUG = "test_p27_" + Date.now().toString(36);
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("P27 — admin reply inserts a notification row", () => {
  let app;
  let adminToken;
  let testTenantId;
  let testTicketId;
  let employeeId;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    // Admin tables (idempotent)
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_activity_log (
      id SERIAL PRIMARY KEY, admin_email TEXT, action TEXT, target_type TEXT,
      target_id TEXT, details JSONB, ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_security_log (
      id SERIAL PRIMARY KEY, event_type TEXT, email TEXT, ip_address TEXT,
      user_agent TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    // Super admin
    const hash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin P27')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2
       RETURNING id`,
      [TEST_ADMIN_EMAIL, hash]
    );
    adminToken = jwt.sign(
      { tid: 0, eid: 0, rid: 0, oid: null, aid: sa.id, email: TEST_ADMIN_EMAIL, role: "super_admin", scope: "admin" },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    app = express();
    app.use(express.json());
    const registerAdminRoutes = require("../../routes/admin");
    const noopLimiter = (req, res, next) => next();
    registerAdminRoutes(app, { authLimiter: noopLimiter });

    // Provision a tenant — generates real schema with employees + notifications tables
    const provisionRes = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ slug: TEST_TENANT_SLUG, name: "P27 Test Tenant", pin: "1234" });
    expect(provisionRes.status).toBe(201);
    testTenantId = provisionRes.body.tenant.id;

    // Look up the seeded admin employee in the new tenant schema
    const { rows: emps } = await pool.query(
      `SELECT id FROM "tenant_${TEST_TENANT_SLUG}".employees ORDER BY id LIMIT 1`
    );
    expect(emps.length).toBeGreaterThan(0);
    employeeId = emps[0].id;

    // Insert a support ticket directly (skips tenant auth middleware setup)
    const { rows: tix } = await pool.query(
      `INSERT INTO "tenant_${TEST_TENANT_SLUG}".support_tickets
         (employee_id, type, message)
       VALUES ($1, 'bug', 'P27 test ticket')
       RETURNING id`,
      [employeeId]
    );
    testTicketId = tix[0].id;
  }, 30000);

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_SLUG}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [testTenantId]);
      await pool.query("DELETE FROM super_admins WHERE email = $1", [TEST_ADMIN_EMAIL]);
    } catch (_) { /* ignore */ }
  });

  it("PUT /api/admin/support-tickets/:tenantId/:ticketId/reply persists a notification row", async () => {
    const res = await request(app)
      .put(`/api/admin/support-tickets/${testTenantId}/${testTicketId}/reply`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reply: "Phase 7.8 — P27 regression reply" });

    expect(res.status).toBe(200);
    expect(res.body.admin_reply).toBe("Phase 7.8 — P27 regression reply");
    expect(res.body.status).toBe("acknowledged");

    // The notification row MUST exist — pre-fix it never landed because the
    // INSERT referenced a non-existent `employee_id` column and the throw
    // was silently swallowed.
    const { rows: notifs } = await pool.query(
      `SELECT type, title, message, link FROM "tenant_${TEST_TENANT_SLUG}".notifications
       WHERE type = 'support_reply'
       ORDER BY id DESC LIMIT 1`
    );

    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe("support_reply");
    expect(notifs[0].title).toBe("Support ticket reply");
    expect(notifs[0].message).toMatch(/Your support ticket has been replied to/);
    // Notifications table is tenant-wide (no employee_id column) — verify
    // the link points to /my-tickets so the bell row routes correctly.
    expect(notifs[0].link).toBe("/my-tickets");
  }, 15000);
});
