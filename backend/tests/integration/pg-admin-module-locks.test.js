/**
 * pg-admin-module-locks.test.js — Business Modules Step 5.
 *
 * Super-admin platform lock CRUD (routes/admin/module-locks.js). Lock
 * semantics: a row means the tenant cannot self-ENABLE the module (the
 * enforcement itself lands in Step 6's toggle service — here we verify the
 * registry CRUD, perm gating, catalog validation, upsert behavior, and
 * admin audit logging).
 *
 * Run guidance (same as other pg-admin-* files): local test DB, and prefer
 * --no-file-parallelism when running the whole admin batch.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-modlocks@example.com";
const SLUG = "test_ml_" + Date.now().toString(36);
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Admin platform module locks", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    // Harness bootstrap: the table normally arrives via migration v131 /
    // schema-pg.sql — create idempotently in case this test DB predates it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.platform_module_locks (
        id SERIAL PRIMARY KEY,
        module_key TEXT NOT NULL,
        tenant_id INTEGER,
        locked_by TEXT,
        reason TEXT,
        locked_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS platform_module_locks_global_uniq
        ON public.platform_module_locks (module_key) WHERE tenant_id IS NULL`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS platform_module_locks_tenant_uniq
        ON public.platform_module_locks (module_key, tenant_id) WHERE tenant_id IS NOT NULL`);

    const hash = await bcrypt.hash("TestPassML!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin ML')
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

    // Bare tenant registry row (no schema provisioning needed for lock CRUD).
    const { rows: [t] } = await pool.query(
      `INSERT INTO public.tenants (slug, name, status, owner_email)
       VALUES ($1, 'ModLock Test', 'active', $2) RETURNING id`,
      [SLUG, TEST_ADMIN_EMAIL]
    );
    tenantId = t.id;

    app = express();
    app.use(express.json());
    require("../../routes/admin")(app, { authLimiter: (req, res, next) => next() });
  }, 60000);

  afterAll(async () => {
    await pool.query("DELETE FROM public.platform_module_locks WHERE locked_by = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM public.tenants WHERE id = $1", [tenantId]).catch(() => {});
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]).catch(() => {});
  });

  test("unauthenticated requests are rejected", async () => {
    expect((await request(app).get("/api/admin/module-locks")).status).toBe(401);
    expect((await request(app).put("/api/admin/module-locks/restaurant").send({})).status).toBe(401);
    expect((await request(app).delete("/api/admin/module-locks/restaurant")).status).toBe(401);
  });

  test("PUT rejects an unknown module key (catalog-validated)", async () => {
    const res = await auth(request(app).put("/api/admin/module-locks/not_a_module")).send({ reason: "x" });
    expect(res.status).toBe(404);
  });

  test("global lock round-trips: PUT → GET → re-PUT upserts (no duplicate)", async () => {
    const put = await auth(request(app).put("/api/admin/module-locks/restaurant"))
      .send({ reason: "abuse investigation" });
    expect(put.status).toBe(200);
    expect(put.body.lock.tenant_id).toBeNull();
    expect(put.body.lock.locked_by).toBe(TEST_ADMIN_EMAIL);

    const list = await auth(request(app).get("/api/admin/module-locks"));
    expect(list.status).toBe(200);
    const mine = list.body.locks.filter(
      (l) => l.module_key === "restaurant" && l.tenant_id === null && l.locked_by === TEST_ADMIN_EMAIL
    );
    expect(mine.length).toBe(1);
    expect(list.body.module_keys).toContain("restaurant");

    // Refresh the same lock — still exactly one row.
    const rePut = await auth(request(app).put("/api/admin/module-locks/restaurant"))
      .send({ reason: "updated reason" });
    expect(rePut.status).toBe(200);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n, MAX(reason) AS reason FROM public.platform_module_locks WHERE module_key = 'restaurant' AND tenant_id IS NULL AND locked_by = $1",
      [TEST_ADMIN_EMAIL]
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].reason).toBe("updated reason");
  });

  test("per-tenant lock: valid tenant OK, unknown tenant 404, coexists with global", async () => {
    const put = await auth(request(app).put("/api/admin/module-locks/rentals"))
      .send({ tenant_id: tenantId, reason: "per-tenant" });
    expect(put.status).toBe(200);
    expect(put.body.lock.tenant_id).toBe(tenantId);

    const bogus = await auth(request(app).put("/api/admin/module-locks/rentals"))
      .send({ tenant_id: 99999999, reason: "x" });
    expect(bogus.status).toBe(404);

    // Global + per-tenant on the same module are distinct rows.
    const g = await auth(request(app).put("/api/admin/module-locks/rentals")).send({ reason: "global too" });
    expect(g.status).toBe(200);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM public.platform_module_locks WHERE module_key = 'rentals' AND locked_by = $1",
      [TEST_ADMIN_EMAIL]
    );
    expect(rows[0].n).toBe(2);
  });

  test("DELETE removes the addressed lock only; missing lock 404s", async () => {
    const delTenant = await auth(
      request(app).delete(`/api/admin/module-locks/rentals?tenant_id=${tenantId}`)
    );
    expect(delTenant.status).toBe(200);

    const { rows } = await pool.query(
      "SELECT tenant_id FROM public.platform_module_locks WHERE module_key = 'rentals' AND locked_by = $1",
      [TEST_ADMIN_EMAIL]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBeNull(); // global survives

    const delGlobal = await auth(request(app).delete("/api/admin/module-locks/rentals"));
    expect(delGlobal.status).toBe(200);
    const again = await auth(request(app).delete("/api/admin/module-locks/rentals"));
    expect(again.status).toBe(404);
  });

  test("lock mutations are audit-logged", async () => {
    const { rows } = await pool.query(
      `SELECT action FROM admin_activity_log WHERE admin_email = $1 AND action IN ('module_lock_set','module_lock_removed')`,
      [TEST_ADMIN_EMAIL]
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("module_lock_set");
    expect(actions).toContain("module_lock_removed");
  });
});
