/**
 * pg-admin-lifecycle-events.test.js
 *
 * Batch C / C1 — tenant lifecycle event capture.
 *
 * Inline writers append to public.tenant_lifecycle_events on cold-path admin
 * actions (create=signup, suspend, activate, record-payment, bulk trial/expire,
 * upgrade approval=plan_changed, delete). The adoption worker's deriveLifecycle
 * computes one-time milestones (first_sale, first_week_active, dormant_30d) from
 * each tenant's sales history, idempotently.
 *
 * (auth.js signup + setup.js setup_completed + the email-worker 'expired'
 * transition share the same recordLifecycleEvent helper — exercised here via the
 * admin-route writers, which are the same code path.)
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-lifecycle@example.com";
const SLUG = "test_lc_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Tenant lifecycle event capture", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  async function eventsFor(event) {
    const { rows } = await pool.query(
      "SELECT * FROM public.tenant_lifecycle_events WHERE tenant_id = $1 AND event = $2 ORDER BY created_at",
      [tenantId, event]
    );
    return rows;
  }

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassLC!", 4);
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

    const createRes = await auth(request(app).post("/api/admin/tenants"))
      .send({ slug: SLUG, name: "Lifecycle Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;
  }, 60000);

  afterAll(async () => {
    if (tenantId) {
      await pool.query("DELETE FROM public.tenant_lifecycle_events WHERE tenant_id = $1", [tenantId]).catch(() => {});
      await pool.query("DELETE FROM upgrade_requests WHERE tenant_id = $1", [tenantId]).catch(() => {});
      await pool.query("DELETE FROM payment_records WHERE tenant_id = $1", [tenantId]).catch(() => {});
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [tenantId]).catch(() => {});
      await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  test("tenant create emits a one-time 'signup' event", async () => {
    const rows = await eventsFor("signup");
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.source).toBe("admin");
  });

  test("suspend + activate emit their events", async () => {
    expect((await auth(request(app).post(`/api/admin/tenants/${tenantId}/suspend`)).send({ reason: "test" })).status).toBe(200);
    expect((await auth(request(app).post(`/api/admin/tenants/${tenantId}/activate`))).status).toBe(200);
    expect((await eventsFor("suspended")).length).toBe(1);
    expect((await eventsFor("activated")).length).toBe(1);
  });

  test("record-payment emits 'payment_recorded'", async () => {
    const res = await auth(request(app).post(`/api/admin/tenants/${tenantId}/record-payment`))
      .send({ plan: "pro", cycle: "monthly", amount: 5000, payment_method: "manual" });
    expect(res.status).toBe(200);
    const rows = await eventsFor("payment_recorded");
    expect(rows.length).toBe(1);
    expect(Number(rows[0].metadata.amount)).toBe(5000);
  });

  test("bulk-lifecycle emits 'trial_extended' then 'expired' (recurring, appends)", async () => {
    expect((await auth(request(app).post("/api/admin/tenants/bulk-lifecycle"))
      .send({ tenant_ids: [tenantId], action: "extend_trial", days: 10 })).status).toBe(200);
    expect((await auth(request(app).post("/api/admin/tenants/bulk-lifecycle"))
      .send({ tenant_ids: [tenantId], action: "expire_now" })).status).toBe(200);
    expect((await eventsFor("trial_extended")).length).toBe(1);
    expect((await eventsFor("expired")).length).toBe(1);
  });

  test("approving an upgrade request emits 'plan_changed'", async () => {
    await pool.query(
      "INSERT INTO upgrade_requests (tenant_id, requested_plan, requested_cycle) VALUES ($1, 'pro', 'monthly')",
      [tenantId]
    );
    const { rows: [ur] } = await pool.query(
      "SELECT id FROM upgrade_requests WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1", [tenantId]
    );
    const res = await auth(request(app).put(`/api/admin/upgrade-requests/${ur.id}`)).send({ status: "approved" });
    expect(res.status).toBe(200);
    const rows = await eventsFor("plan_changed");
    expect(rows.length).toBe(1);
    expect(rows[0].metadata.via).toBe("upgrade_request");
  });

  test("deriveLifecycle computes first_sale + first_week_active, idempotently", async () => {
    // 3 sales on 3 distinct dates within the tenant's first week.
    for (const offset of [0, 1, 2]) {
      await pool.query(
        `INSERT INTO ${SCHEMA}.sales (total_amount, payment_method, "timestamp")
         VALUES (100, 'cash', NOW() - ($1 || ' days')::interval)`,
        [offset]
      );
    }

    const { deriveLifecycle } = require("../../workers/adoption-snapshot-worker-boss");
    const tenant = { id: tenantId, slug: SLUG, created_at: new Date().toISOString() };

    await deriveLifecycle(pool, tenant);
    await deriveLifecycle(pool, tenant); // second run must not duplicate one-time events

    expect((await eventsFor("first_sale")).length).toBe(1);
    expect((await eventsFor("first_week_active")).length).toBe(1);
    expect((await eventsFor("dormant_30d")).length).toBe(0); // last sale is recent
  });

  test("delete emits 'deleted' (event survives the dropped schema)", async () => {
    const res = await auth(request(app).delete(`/api/admin/tenants/${tenantId}`));
    expect(res.status).toBe(200);
    expect((await eventsFor("deleted")).length).toBe(1);
  });
});
