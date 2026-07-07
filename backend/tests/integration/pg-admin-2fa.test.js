/**
 * pg-admin-2fa.test.js
 *
 * Batch B / B1 — super-admin TOTP two-factor authentication.
 *
 * Covers: enrollment (setup → verify → recovery codes), the two-step login
 * flow once enabled, TOTP + recovery-code second step, single-use recovery
 * codes, pending-token scoping (can't hit protected routes), and disable.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { authenticator } = require("otplib");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-2fa@example.com";
const PASSWORD = "TestPass2FA!";
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Admin 2FA (TOTP)", () => {
  let app;
  let adminId;
  let adminToken; // full super-admin token (for enrollment endpoints)
  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash(PASSWORD, 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin 2FA')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2,
         totp_secret = NULL, totp_enabled_at = NULL, recovery_codes = NULL
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
  }, 60000);

  afterAll(async () => {
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]).catch(() => {});
  });

  let secret;
  let recoveryCodes;

  test("login before enrollment returns a full token (no 2FA)", async () => {
    const res = await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.totp_required).toBeUndefined();
  });

  test("setup returns a secret + otpauth URI + QR data URL", async () => {
    const res = await auth(request(app).post("/api/admin/auth/totp/setup"));
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    expect(res.body.otpauth_uri).toMatch(/^otpauth:\/\//);
    expect(res.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
    secret = res.body.secret;
    // status still disabled until verified
    const st = await auth(request(app).get("/api/admin/auth/totp/status"));
    expect(st.body.enabled).toBe(false);
  });

  test("verify with a wrong code is rejected", async () => {
    const res = await auth(request(app).post("/api/admin/auth/totp/verify")).send({ code: "000000" });
    expect(res.status).toBe(400);
  });

  test("verify with the real code enables 2FA and returns 10 recovery codes", async () => {
    const code = authenticator.generate(secret);
    const res = await auth(request(app).post("/api/admin/auth/totp/verify")).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(Array.isArray(res.body.recovery_codes)).toBe(true);
    expect(res.body.recovery_codes.length).toBe(10);
    recoveryCodes = res.body.recovery_codes;

    const st = await auth(request(app).get("/api/admin/auth/totp/status"));
    expect(st.body.enabled).toBe(true);
    expect(st.body.recovery_codes_remaining).toBe(10);
  });

  test("login now returns totp_required + a pending token (no full token)", async () => {
    const res = await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.totp_required).toBe(true);
    expect(res.body.pending_token).toBeTruthy();
    expect(res.body.token).toBeUndefined();
  });

  test("the pending token cannot access protected admin routes", async () => {
    const { pending_token } = (await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD })).body;
    const res = await request(app).get("/api/admin/stats")
      .set("Authorization", `Bearer ${pending_token}`);
    expect([401, 403]).toContain(res.status);
  });

  test("second step with a wrong code is rejected", async () => {
    const { pending_token } = (await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD })).body;
    const res = await request(app).post("/api/admin/auth/totp")
      .send({ pending_token, code: "000000" });
    expect(res.status).toBe(401);
  });

  test("second step with the correct TOTP code returns a full token", async () => {
    const { pending_token } = (await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD })).body;
    const code = authenticator.generate(secret);
    const res = await request(app).post("/api/admin/auth/totp")
      .send({ pending_token, code });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.used_recovery).toBe(false);
  });

  test("a recovery code works once and is then burned", async () => {
    const login1 = await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });
    const rc = recoveryCodes[0];
    const first = await request(app).post("/api/admin/auth/totp")
      .send({ pending_token: login1.body.pending_token, code: rc });
    expect(first.status).toBe(200);
    expect(first.body.used_recovery).toBe(true);

    // remaining count dropped
    const st = await auth(request(app).get("/api/admin/auth/totp/status"));
    expect(st.body.recovery_codes_remaining).toBe(9);

    // same code again fails
    const login2 = await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });
    const reuse = await request(app).post("/api/admin/auth/totp")
      .send({ pending_token: login2.body.pending_token, code: rc });
    expect(reuse.status).toBe(401);
  });

  test("disable requires a valid code and turns 2FA off", async () => {
    const bad = await auth(request(app).post("/api/admin/auth/totp/disable")).send({ code: "000000" });
    expect(bad.status).toBe(400);

    const code = authenticator.generate(secret);
    const res = await auth(request(app).post("/api/admin/auth/totp/disable")).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);

    const login = await request(app).post("/api/admin/auth/login")
      .send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });
    expect(login.body.token).toBeTruthy();
    expect(login.body.totp_required).toBeUndefined();
  });
});
