/**
 * pg-admin-adoption.test.js
 *
 * Batch A / A4 — feature-adoption matrix.
 *
 * The adoption-snapshot worker (runSnapshot) fans out over active tenants and
 * writes a `feature_adoption` row into public.infra_cache: per-tenant enabled
 * modes/flags + mode usage counts, plus platform-wide flag/mode adoption tallies.
 * GET /api/admin/adoption serves the cache (hit) or recomputes on ?force=1 (miss).
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-adoption@example.com";
const SLUG = "test_adopt_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Feature-adoption snapshot + endpoint", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassAdopt!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Adoption')
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
      .send({ slug: SLUG, name: "Adoption Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;

    // Enable the appointments mode (cascades its feature flags).
    const modeRes = await auth(request(app).put(`/api/admin/tenants/${tenantId}/modes`))
      .send({ mode: "appointments", enabled: true });
    expect(modeRes.status).toBe(200);

    // Warm the cache so the endpoint hit-path has data.
    const { runSnapshot } = require("../../workers/adoption-snapshot-worker-boss");
    await runSnapshot(pool);
  }, 90000);

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

  test("runSnapshot captures the tenant's enabled modes/flags and writes the cache", async () => {
    const { runSnapshot } = require("../../workers/adoption-snapshot-worker-boss");
    const result = await runSnapshot(pool);

    expect(Array.isArray(result.modes)).toBe(true);
    expect(result.modes).toContain("appointments");

    const mine = result.tenants.find((t) => t.slug === SLUG);
    expect(mine).toBeTruthy();
    expect(mine.enabled_modes).toContain("appointments");
    expect(typeof mine.mode_usage.appointments).toBe("number"); // count query ran (>=0)
    expect(mine.enabled_flag_count).toBeGreaterThan(0);
    expect(mine.enabled_flags.length).toBe(mine.enabled_flag_count);

    expect(result.mode_adoption.appointments).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "SELECT payload FROM public.infra_cache WHERE cache_key = 'feature_adoption'"
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload.tenant_count).toBe(result.tenant_count);
  }, 90000);

  test("GET /adoption serves cache (hit), recomputes on ?force=1 (miss)", async () => {
    const hit = await auth(request(app).get("/api/admin/adoption"));
    expect(hit.status).toBe(200);
    expect(hit.headers["x-infra-cache"]).toBe("hit");
    expect(hit.body.tenants.some((t) => t.slug === SLUG)).toBe(true);
    expect(hit.body.computed_at).toBeTruthy();

    const miss = await auth(request(app).get("/api/admin/adoption?force=1"));
    expect(miss.status).toBe(200);
    expect(miss.headers["x-infra-cache"]).toBe("miss");
    expect(miss.body.tenants.some((t) => t.slug === SLUG)).toBe(true);
  }, 90000);

  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/adoption");
    expect(res.status).toBe(401);
  });
});
