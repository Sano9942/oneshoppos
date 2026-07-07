/**
 * pg-admin-impersonation-list.test.js
 *
 * Batch A / A3 — impersonation session list + revoke.
 *
 * GET /api/admin/impersonation-sessions[?active=1] lists sessions (active =
 * not ended, not revoked, within the 1h token TTL). Revoke reuses the existing
 * POST /api/admin/impersonate/:sessionId/end route, which blacklists the token's
 * jti in the tenant's revoked_tokens and marks the session ended.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-imp@example.com";
const SLUG = "test_imp_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Impersonation session list + revoke", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassImp!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Imp')
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
    require("../../routes/admin")(app, { authLimiter: (req, res, next) => next() });

    const createRes = await auth(request(app).post("/api/admin/tenants"))
      .send({ slug: SLUG, name: "Impersonation Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;
  }, 60000);

  afterAll(async () => {
    if (tenantId) {
      await pool.query("DELETE FROM impersonation_sessions WHERE tenant_id = $1", [tenantId]).catch(() => {});
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [tenantId]);
      await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  test("start → active list shows it → revoke → gone from active, jti blacklisted, history marks revoked", async () => {
    const startRes = await auth(request(app).post(`/api/admin/impersonate/${tenantId}`)).send({});
    expect(startRes.status).toBe(200);
    const sessionId = startRes.body.sessionId;
    const jti = jwt.decode(startRes.body.token).jti;
    expect(sessionId).toBeTruthy();
    expect(jti).toBeTruthy();

    // Active list contains the new session.
    let active = (await auth(request(app).get("/api/admin/impersonation-sessions?active=1"))).body.sessions;
    const found = active.find((s) => s.id === sessionId);
    expect(found).toBeTruthy();
    expect(found.is_active).toBe(true);
    expect(found.has_jti).toBe(true);
    expect(found.tenant_slug).toBe(SLUG);
    expect(found.admin_email).toBe(TEST_ADMIN_EMAIL);

    // Revoke via the existing /end route.
    const endRes = await auth(request(app).post(`/api/admin/impersonate/${sessionId}/end`));
    expect(endRes.status).toBe(200);

    // No longer active.
    active = (await auth(request(app).get("/api/admin/impersonation-sessions?active=1"))).body.sessions;
    expect(active.find((s) => s.id === sessionId)).toBeFalsy();

    // jti blacklisted in the tenant's revoked_tokens.
    const { rows } = await pool.query(`SELECT reason FROM ${SCHEMA}.revoked_tokens WHERE token_jti = $1`, [jti]);
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe("impersonation_ended");

    // History (no active filter) shows it as revoked.
    const history = (await auth(request(app).get("/api/admin/impersonation-sessions?limit=20"))).body.sessions;
    const histRow = history.find((s) => s.id === sessionId);
    expect(histRow).toBeTruthy();
    expect(histRow.is_active).toBe(false);
    expect(histRow.revoked_at).toBeTruthy();
  });

  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/impersonation-sessions?active=1");
    expect(res.status).toBe(401);
  });
});
