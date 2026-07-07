/**
 * pg-admin-audit-coverage.test.js
 *
 * Batch A / A1 — logAdminAction gap closure.
 *
 * Every admin mutation must write an admin_activity_log row. This suite exercises
 * the mutations that previously had NO audit logging and asserts a row lands for
 * each, with the expected action verb.
 *
 * Newly-covered routes (12) and how they're verified here:
 *   compliance.js  tax_rate_created / tax_rate_updated / tax_rate_deleted   → live
 *                  tax_suggestion_reviewed                                   → live
 *   messaging.js   announcement_updated                                     → live
 *                  email_queue_retried                → live IF pgboss.job is present
 *   operations.js  ticket_status_updated                                    → live
 *                  dead_letter_retried    → inspection-only (see note below)
 *   tenants.js     setup_token_regenerated / note_deleted                   → live
 *   monitoring.js  cleanup_run            → inspection-only (see note below)
 *   system.js      backup_verified        → inspection-only (see note below)
 *
 * Inspection-only rationale (each is a single fire-and-forget logAdminAction placed
 * immediately before the success response — identical pattern to the live-tested ones):
 *   - dead_letter_retried: `shopify_webhook_events` is created only when a tenant has
 *     an active Shopify integration; a freshly-provisioned schema has no such table,
 *     so the route can't be driven to its success path in isolation.
 *   - cleanup_run: invokes cleanupDeadTenants({dryRun:false}) which *deletes* dead
 *     tenants live — unsafe to run against a shared local/CI database.
 *   - backup_verified: requires a real pg_dump artifact on disk (filePath) to reach
 *     the success path.
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-audit@example.com";
const SLUG = "test_audit_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const HS_CODE = "TESTHS" + Date.now().toString(36);
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

// admin_activity_log writes are fire-and-forget (the routes don't await
// logAdminAction), so poll briefly after the HTTP response resolves.
async function waitForLog(action, { targetId } = {}) {
  for (let i = 0; i < 40; i++) {
    const params = [TEST_ADMIN_EMAIL, action];
    let sql = "SELECT * FROM admin_activity_log WHERE admin_email = $1 AND action = $2";
    if (targetId !== undefined) {
      params.push(String(targetId));
      sql += ` AND target_id = $${params.length}`;
    }
    sql += " ORDER BY created_at DESC LIMIT 1";
    const { rows } = await pool.query(sql, params);
    if (rows.length) return rows[0];
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

describe("Admin audit-log coverage (logAdminAction gap closure)", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  let pgbossJobId;
  let hasPgbossJob = false;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassAudit!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Audit')
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
      .send({ slug: SLUG, name: "Audit Coverage Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;

    const { rows: [reg] } = await pool.query("SELECT to_regclass('pgboss.job') AS t");
    hasPgbossJob = reg.t !== null;
  }, 60000);

  afterAll(async () => {
    if (pgbossJobId) {
      await pool.query("DELETE FROM pgboss.job WHERE id = $1", [pgbossJobId]).catch(() => {});
    }
    await pool.query("DELETE FROM public.tax_rate_reference WHERE hs_code = $1", [HS_CODE]).catch(() => {});
    await pool.query("DELETE FROM announcements WHERE created_by = $1", [TEST_ADMIN_EMAIL]).catch(() => {});
    if (tenantId) {
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [tenantId]);
      await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await pool.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  test("tax_rate create → update → delete each log an admin action", async () => {
    // create
    const createRes = await auth(request(app).post("/api/admin/tax-rates"))
      .send({ hs_code: HS_CODE, description_en: "Audit test rate", federal_gst: 17 });
    expect(createRes.status).toBe(200);
    const rateId = createRes.body.id;
    const createLog = await waitForLog("tax_rate_created", { targetId: rateId });
    expect(createLog).toBeTruthy();
    expect(createLog.target_type).toBe("tax_rate");

    // update
    const updRes = await auth(request(app).put(`/api/admin/tax-rates/${rateId}`))
      .send({ description_en: "Audit test rate (edited)" });
    expect(updRes.status).toBe(200);
    expect(await waitForLog("tax_rate_updated", { targetId: rateId })).toBeTruthy();

    // delete
    const delRes = await auth(request(app).delete(`/api/admin/tax-rates/${rateId}`));
    expect(delRes.status).toBe(200);
    expect(await waitForLog("tax_rate_deleted", { targetId: rateId })).toBeTruthy();
  });

  test("tax_suggestion_reviewed logs an admin action", async () => {
    const { rows: [sug] } = await pool.query(
      `INSERT INTO ${SCHEMA}.tax_rate_suggestions (reference_id, field_name, suggested_value, status)
       VALUES (1, 'federal_gst', 18, 'pending') RETURNING id`
    );
    const res = await auth(request(app).put(`/api/admin/tax-rate-suggestions/${sug.id}`))
      .send({ status: "rejected", tenant_slug: SLUG });
    expect(res.status).toBe(200);
    const log = await waitForLog("tax_suggestion_reviewed", { targetId: sug.id });
    expect(log).toBeTruthy();
    expect(log.target_type).toBe("tax_suggestion");
  });

  test("announcement_updated logs an admin action", async () => {
    const createRes = await auth(request(app).post("/api/admin/announcements"))
      .send({ message: "Audit announcement", type: "info" });
    expect(createRes.status).toBe(201);
    const annId = createRes.body.id;

    const updRes = await auth(request(app).put(`/api/admin/announcements/${annId}`))
      .send({ message: "Audit announcement (edited)" });
    expect(updRes.status).toBe(200);
    expect(await waitForLog("announcement_updated", { targetId: annId })).toBeTruthy();
  });

  test("ticket_status_updated logs an admin action", async () => {
    const { rows: [ticket] } = await pool.query(
      `INSERT INTO ${SCHEMA}.support_tickets (type, message, status)
       VALUES ('bug', 'Audit test ticket', 'open') RETURNING id`
    );
    const res = await auth(request(app).put(`/api/admin/support-tickets/${tenantId}/${ticket.id}`))
      .send({ status: "acknowledged" });
    expect(res.status).toBe(200);
    const log = await waitForLog("ticket_status_updated", { targetId: ticket.id });
    expect(log).toBeTruthy();
    expect(log.target_type).toBe("support_ticket");
  });

  test("setup_token_regenerated logs an admin action", async () => {
    const res = await auth(request(app).post(`/api/admin/tenants/${tenantId}/regenerate-setup-token`)).send({});
    expect(res.status).toBe(200);
    expect(await waitForLog("setup_token_regenerated", { targetId: tenantId })).toBeTruthy();
  });

  test("note_deleted logs an admin action", async () => {
    const createRes = await auth(request(app).post(`/api/admin/tenants/${tenantId}/notes`))
      .send({ note: "Audit test note" });
    expect(createRes.status).toBe(201);
    const noteId = createRes.body.id;

    const delRes = await auth(request(app).delete(`/api/admin/tenants/${tenantId}/notes/${noteId}`));
    expect(delRes.status).toBe(200);
    expect(await waitForLog("note_deleted", { targetId: tenantId })).toBeTruthy();
  });

  test("email_queue_retried logs an admin action (when pgboss.job is present)", async () => {
    if (!hasPgbossJob) {
      console.warn("[audit-coverage] pgboss.job absent — skipping email_queue_retried live check");
      return;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO pgboss.job (id, name, state, data, retry_count, retry_limit, start_after, created_on)
         VALUES (gen_random_uuid(), 'email', 'failed', '{"type":"test"}'::jsonb, 1, 2, NOW(), NOW())
         RETURNING id`
      );
      pgbossJobId = rows[0].id;
    } catch (e) {
      console.warn("[audit-coverage] could not seed pgboss.job (partition/queue) — skipping:", e.message);
      return;
    }
    const res = await auth(request(app).post(`/api/admin/email-queue/${pgbossJobId}/retry`));
    expect(res.status).toBe(200);
    expect(await waitForLog("email_queue_retried", { targetId: pgbossJobId })).toBeTruthy();
  });
});
