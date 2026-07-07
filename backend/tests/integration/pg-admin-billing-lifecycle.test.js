/**
 * pg-admin-billing-lifecycle.test.js
 *
 * Chunk 5 (admin refresh) — billing & lifecycle tools:
 * - POST /api/admin/tenants/bulk-lifecycle (extend_trial / expire_now)
 * - GET  /api/admin/test-fleet + POST /api/admin/test-fleet/delete
 * - GET  /api/admin/payments (global list)
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-lifecycle@example.com";
const PREFIX = "tfleet" + Date.now().toString(36) + "_";
const SLUG_A = PREFIX + "a";
const SLUG_B = PREFIX + "b";
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Admin billing & lifecycle tools", () => {
  let app;
  let adminToken;
  let adminId;
  let idA;
  let idB;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassLc!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin LC')
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

    for (const slug of [SLUG_A, SLUG_B]) {
      const res = await request(app)
        .post("/api/admin/tenants")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ slug, name: `Fleet ${slug}`, pin: "1234", plan: "pro" });
      expect(res.status).toBe(201);
      if (slug === SLUG_A) idA = res.body.tenant.id; else idB = res.body.tenant.id;
    }
    // Give both a near-expiry trial state.
    await pool.query(
      `UPDATE tenants SET payment_status = 'trial', trial_ends_at = NOW() + interval '2 days' WHERE id = ANY($1)`,
      [[idA, idB]]
    );
  }, 90000);

  afterAll(async () => {
    for (const [id, slug] of [[idA, SLUG_A], [idB, SLUG_B]]) {
      if (!id) continue;
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [id]);
      await pool.query(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [id]);
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  test("bulk extend_trial pushes trial_ends_at forward and resets to trial", async () => {
    const res = await request(app)
      .post("/api/admin/tenants/bulk-lifecycle")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenant_ids: [idA, idB], action: "extend_trial", days: 30 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const { rows } = await pool.query(
      "SELECT payment_status, trial_ends_at FROM tenants WHERE id = ANY($1)",
      [[idA, idB]]
    );
    for (const t of rows) {
      expect(t.payment_status).toBe("trial");
      const daysLeft = (new Date(t.trial_ends_at) - Date.now()) / 86400000;
      expect(daysLeft).toBeGreaterThan(30); // 2 days remaining + 30 extended
      expect(daysLeft).toBeLessThan(34);
    }
  });

  test("bulk expire_now flips payment_status to expired", async () => {
    const res = await request(app)
      .post("/api/admin/tenants/bulk-lifecycle")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenant_ids: [idB], action: "expire_now" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    const { rows: [t] } = await pool.query("SELECT payment_status FROM tenants WHERE id = $1", [idB]);
    expect(t.payment_status).toBe("expired");
  });

  test("bulk-lifecycle validates inputs", async () => {
    const noIds = await request(app)
      .post("/api/admin/tenants/bulk-lifecycle")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenant_ids: [], action: "extend_trial" });
    expect(noIds.status).toBe(400);

    const badAction = await request(app)
      .post("/api/admin/tenants/bulk-lifecycle")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ tenant_ids: [idA], action: "self_destruct" });
    expect(badAction.status).toBe(400);
  });

  test("test-fleet lists tenants by prefix with trial state", async () => {
    const res = await request(app)
      .get(`/api/admin/test-fleet?prefix=${PREFIX}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.tenants.map((t) => t.slug).sort()).toEqual([SLUG_A, SLUG_B]);
    expect(res.body.tenants[0]).toHaveProperty("trial_ends_at");
  });

  test("test-fleet delete requires exact confirm and drops schemas", async () => {
    const noConfirm = await request(app)
      .post("/api/admin/test-fleet/delete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prefix: PREFIX, confirm: "nope" });
    expect(noConfirm.status).toBe(400);

    const res = await request(app)
      .post("/api/admin/test-fleet/delete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prefix: PREFIX, confirm: PREFIX });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.deleted.sort()).toEqual([SLUG_A, SLUG_B]);

    const { rows } = await pool.query("SELECT status FROM tenants WHERE id = ANY($1)", [[idA, idB]]);
    expect(rows.every((t) => t.status === "deleted")).toBe(true);
    const { rows: schemas } = await pool.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1)",
      [[`tenant_${SLUG_A}`, `tenant_${SLUG_B}`]]
    );
    expect(schemas.length).toBe(0);
  });

  test("global payments list paginates", async () => {
    const res = await request(app)
      .get("/api/admin/payments?limit=5")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
    expect(res.body.payments.length).toBeLessThanOrEqual(5);
    expect(typeof res.body.total).toBe("number");
  });

  test("requires super-admin auth", async () => {
    const res = await request(app).post("/api/admin/tenants/bulk-lifecycle").send({});
    expect(res.status).toBe(401);
  });
});
