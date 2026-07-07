/**
 * pg-admin-login-alert.test.js
 *
 * Batch B / B3 — new-IP login anomaly detection.
 *
 * isNewLoginIp compares a candidate IP against the last 30 days of
 * login_success rows in admin_security_log. Tested against a seeded history.
 * (The alert send itself is a no-op without ALERT_EMAIL/RESEND_API_KEY.)
 */
const pool = require("../../db-pg");
const { isNewLoginIp } = require("../../services/admin-login-alert");

const EMAIL = "test-login-alert@example.com";

async function seed(ip, ageDays) {
  await pool.query(
    `INSERT INTO admin_security_log (event_type, email, ip_address, created_at)
     VALUES ('login_success', $1, $2, NOW() - ($3 || ' days')::interval)`,
    [EMAIL, ip, ageDays]
  );
}

describe("Admin login anomaly detection (isNewLoginIp)", () => {
  beforeAll(async () => {
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [EMAIL]);
    await seed("1.1.1.1", 2);   // recent, known IP
    await seed("2.2.2.2", 40);  // stale (outside 30-day window)
  });

  afterAll(async () => {
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [EMAIL]);
  });

  test("a known recent IP is NOT flagged as new", async () => {
    expect(await isNewLoginIp(pool, EMAIL, "1.1.1.1")).toBe(false);
  });

  test("a never-seen IP IS flagged as new", async () => {
    expect(await isNewLoginIp(pool, EMAIL, "9.9.9.9")).toBe(true);
  });

  test("an IP only seen >30 days ago IS flagged as new", async () => {
    expect(await isNewLoginIp(pool, EMAIL, "2.2.2.2")).toBe(true);
  });

  test("only login_success counts — a failed-login IP is still 'new'", async () => {
    await pool.query(
      `INSERT INTO admin_security_log (event_type, email, ip_address, created_at)
       VALUES ('login_failed', $1, '3.3.3.3', NOW())`,
      [EMAIL]
    );
    expect(await isNewLoginIp(pool, EMAIL, "3.3.3.3")).toBe(true);
  });

  test("a missing IP is treated as not-new (never cry wolf)", async () => {
    expect(await isNewLoginIp(pool, EMAIL, null)).toBe(false);
  });
});
