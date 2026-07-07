/**
 * pg-admin-session.test.js
 *
 * Batch B / B2 — admin session hardening.
 *
 * Covers: refresh cookie issuance on login, rotating refresh (old token
 * rejected, reuse kills the family), active-sessions list with current-session
 * marking, revoke-others, and logout revoking the current session.
 */
const request = require("supertest");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-session@example.com";
const PASSWORD = "TestSess!123";

function getRefreshCookie(res) {
  const raw = res.headers["set-cookie"] || [];
  const c = raw.find((x) => x.startsWith("adminRefreshToken="));
  return c ? c.split(";")[0] : null; // "adminRefreshToken=<jwt>"
}

const login = (app) =>
  request(app).post("/api/admin/auth/login").send({ email: TEST_ADMIN_EMAIL, password: PASSWORD });

describe("Admin session hardening", () => {
  let app;
  let adminId;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);
    const hash = await bcrypt.hash(PASSWORD, 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Session')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2,
         totp_secret = NULL, totp_enabled_at = NULL, recovery_codes = NULL
       RETURNING id`,
      [TEST_ADMIN_EMAIL, hash]
    );
    adminId = sa.id;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    require("../../routes/admin")(app, { authLimiter: (req, res, next) => next() });
  }, 60000);

  afterAll(async () => {
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    // admin_sessions cascades on super_admins delete
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]).catch(() => {});
  });

  test("login issues an access token + a refresh cookie + a session row", async () => {
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
    const res = await login(app);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(getRefreshCookie(res)).toBeTruthy();
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM admin_sessions WHERE admin_id = $1 AND revoked_at IS NULL", [adminId]
    );
    expect(rows[0].n).toBe(1);
  });

  test("refresh rotates the token; reusing the old one kills the family", async () => {
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
    const cookie1 = getRefreshCookie(await login(app));

    const r1 = await request(app).post("/api/admin/auth/refresh").set("Cookie", cookie1);
    expect(r1.status).toBe(200);
    expect(r1.body.token).toBeTruthy();
    const cookie2 = getRefreshCookie(r1);
    expect(cookie2).toBeTruthy();
    expect(cookie2).not.toBe(cookie1);

    // Reusing the rotated-out cookie1 is theft → REFRESH_REUSE + family revoke.
    const reuse = await request(app).post("/api/admin/auth/refresh").set("Cookie", cookie1);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe("REFRESH_REUSE");

    // cookie2 (the current live token) is now dead too.
    const dead = await request(app).post("/api/admin/auth/refresh").set("Cookie", cookie2);
    expect(dead.status).toBe(401);
  });

  test("missing/invalid refresh cookie is rejected", async () => {
    const none = await request(app).post("/api/admin/auth/refresh");
    expect(none.status).toBe(401);
    const bad = await request(app).post("/api/admin/auth/refresh").set("Cookie", "adminRefreshToken=not-a-jwt");
    expect(bad.status).toBe(401);
  });

  test("sessions list marks the current session; revoke-others clears the rest", async () => {
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
    const logins = [];
    for (let i = 0; i < 3; i++) logins.push(await login(app));
    const token = logins[2].body.token; // sid = session #3

    const list = await request(app).get("/api/admin/auth/sessions").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBe(3);
    expect(list.body.sessions.filter((s) => s.current).length).toBe(1);

    const rev = await request(app).post("/api/admin/auth/sessions/revoke-others").set("Authorization", `Bearer ${token}`);
    expect(rev.status).toBe(200);
    expect(rev.body.revoked).toBe(2);

    const list2 = await request(app).get("/api/admin/auth/sessions").set("Authorization", `Bearer ${token}`);
    expect(list2.body.sessions.length).toBe(1);
    expect(list2.body.sessions[0].current).toBe(true);
  });

  test("logout revokes the current session (its refresh cookie stops working)", async () => {
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
    const res = await login(app);
    const token = res.body.token;
    const cookie = getRefreshCookie(res);

    const out = await request(app).post("/api/admin/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(200);

    const ref = await request(app).post("/api/admin/auth/refresh").set("Cookie", cookie);
    expect(ref.status).toBe(401);
  });
});
