/**
 * pg-admin-flag-parity.test.js
 *
 * Chunk 3 (admin refresh) — flag/mode editor parity:
 * - GET  /api/admin/tenants/:id/feature-flags  → union merge (DB-seeded flags
 *   outside DEFAULT_FEATURE_FLAGS, e.g. fbr_integration, must appear)
 * - GET/PUT /api/admin/tenants/:id/modes       → mode toggle + flag cascade
 * - GET  /api/admin/tenants/:id/flag-drift     → expected vs actual
 * - POST /api/admin/tenants/:id/reapply-preset → repair action
 * - services/preset-apply.js applyPreset       → shared with tenant-side PUT
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-flags@example.com";
const SLUG = "test_flags_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

async function flagState(key) {
  const { rows } = await pool.query(`SELECT enabled FROM ${SCHEMA}.feature_flags WHERE key = $1`, [key]);
  return rows[0] ? rows[0].enabled : null;
}

describe("Admin flag/mode parity + drift + preset re-apply", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassFlags!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Flags')
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

    const createRes = await request(app)
      .post("/api/admin/tenants")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ slug: SLUG, name: "Flag Parity Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;

    await pool.query(`UPDATE ${SCHEMA}.company_profile SET industry_type = 'gym', setup_complete = true WHERE id = 1`);
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

  test("feature-flags GET includes DB-seeded flags outside DEFAULT_FEATURE_FLAGS (fbr_integration)", async () => {
    await pool.query(
      `INSERT INTO ${SCHEMA}.feature_flags (key, enabled) VALUES ('fbr_integration', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );
    const res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/feature-flags`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const fbr = res.body.find((f) => f.key === "fbr_integration");
    expect(fbr).toBeTruthy();
    expect(fbr.enabled).toBe(true);
  });

  test("modes GET lists all registry modes with enabled state", async () => {
    const res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/modes`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { VALID_MODES } = require("../../config/mode-registry");
    expect(res.body.map((m) => m.mode).sort()).toEqual([...VALID_MODES].sort());
    for (const m of res.body) {
      expect(typeof m.enabled).toBe("boolean");
      expect(Array.isArray(m.feature_flags)).toBe(true);
    }
  });

  test("modes PUT enables a mode and cascades its registry flags", async () => {
    const res = await request(app)
      .put(`/api/admin/tenants/${tenantId}/modes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mode: "rentals", enabled: true });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT enabled FROM ${SCHEMA}.tenant_modes WHERE mode = 'rentals'`);
    expect(rows[0].enabled).toBe(true);
    expect(await flagState("phase4_rentals")).toBe(true);

    const off = await request(app)
      .put(`/api/admin/tenants/${tenantId}/modes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mode: "rentals", enabled: false });
    expect(off.status).toBe(200);
    expect(await flagState("phase4_rentals")).toBe(false);
  });

  test("modes PUT rejects unknown mode", async () => {
    const res = await request(app)
      .put(`/api/admin/tenants/${tenantId}/modes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mode: "time_travel", enabled: true });
    expect(res.status).toBe(400);
  });

  test("reapply-preset restores gym modes + extras", async () => {
    // Sabotage: wipe modes, kill a preset extra flag.
    await pool.query(`DELETE FROM ${SCHEMA}.tenant_modes`);
    await pool.query(
      `INSERT INTO ${SCHEMA}.feature_flags (key, enabled) VALUES ('member_checkin', false)
       ON CONFLICT (key) DO UPDATE SET enabled = false`
    );

    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/reapply-preset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.industry_type).toBe("gym");
    expect(res.body.modes.sort()).toEqual(["appointments", "subscriptions"]);

    const { rows: modeRows } = await pool.query(`SELECT mode FROM ${SCHEMA}.tenant_modes WHERE enabled = true ORDER BY mode`);
    expect(modeRows.map((r) => r.mode)).toEqual(["appointments", "subscriptions"]);
    expect(await flagState("member_checkin")).toBe(true);       // PRESET_EXTRA_FLAGS
    expect(await flagState("packages_passes")).toBe(true);      // PRESET_EXTRA_FLAGS
    expect(await flagState("subscription_billing")).toBe(true); // mode flag
    expect(await flagState("phase4_restaurant")).toBe(false);   // other modes reset OFF
  });

  test("flag-drift reports missing expected flags and manual extras", async () => {
    // Clean state after reapply → no missing.
    let res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/flag-drift`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.industry_type).toBe("gym");
    expect(res.body.missing).toEqual([]);

    // Turn an expected flag off + a non-preset flag on.
    await pool.query(`UPDATE ${SCHEMA}.feature_flags SET enabled = false WHERE key = 'member_checkin'`);
    await pool.query(
      `INSERT INTO ${SCHEMA}.feature_flags (key, enabled) VALUES ('wholesale_schemes', true)
       ON CONFLICT (key) DO UPDATE SET enabled = true`
    );

    res = await request(app)
      .get(`/api/admin/tenants/${tenantId}/flag-drift`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.missing).toContain("member_checkin");
    expect(res.body.extra).toContain("wholesale_schemes");
    // Default-true platform flags are never reported as extra.
    expect(res.body.extra).not.toContain("accounting_core");
  });

  test("applyPreset service works directly (tenant-side PUT delegates to it)", async () => {
    const { applyPreset } = require("../../services/preset-apply");
    const tenantDb = {
      query: (sql, params) => pool.query(sql.replace(/\b(company_profile|tenant_modes|feature_flags)\b/g, `${SCHEMA}.$1`), params),
    };
    const preset = await applyPreset(tenantDb, "restaurant");
    expect(preset.industry_type).toBe("restaurant");
    const { rows } = await pool.query(`SELECT mode FROM ${SCHEMA}.tenant_modes WHERE enabled = true`);
    expect(rows.map((r) => r.mode)).toEqual(["restaurant"]);
    expect(await flagState("phase4_restaurant")).toBe(true);
    expect(await flagState("subscription_billing")).toBe(false); // gym mode flag reset
    expect(await flagState("member_checkin")).toBe(false);       // gym extra reset
  });

  test("reapply-preset rejects unknown industry_type", async () => {
    const res = await request(app)
      .post(`/api/admin/tenants/${tenantId}/reapply-preset`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ industry_type: "spaceship_dealer" });
    expect(res.status).toBe(400);
  });
});
