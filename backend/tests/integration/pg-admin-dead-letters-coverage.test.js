/**
 * pg-admin-dead-letters-coverage.test.js
 *
 * Chunk 4 (admin refresh) — dead-letter coverage for the two previously
 * invisible stores:
 * - GET  /api/admin/dead-letters/aggregator     (external_sync_events)
 * - POST /api/admin/dead-letters/aggregator/:tenantId/:id/dismiss
 * - GET  /api/admin/dead-letters/channel-sync   (channel_sync_dead_letters)
 * - PUT  /api/admin/dead-letters/channel-sync/:tenantId/:id
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-deadletters@example.com";
const SLUG = "test_dl_" + Date.now().toString(36);
const SCHEMA = `tenant_${SLUG}`;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Admin dead-letter coverage (aggregator + channel-sync)", () => {
  let app;
  let adminToken;
  let adminId;
  let tenantId;
  let aggregatorEventId;
  let channelDeadLetterId;

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassDl!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin DL')
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
      .send({ slug: SLUG, name: "Dead Letter Test", pin: "1234", plan: "free" });
    expect(createRes.status).toBe(201);
    tenantId = createRes.body.tenant.id;

    // Aggregator dead letter (V03 order-injection failure shape).
    const { rows: [agg] } = await pool.query(
      `INSERT INTO ${SCHEMA}.external_sync_events
         (direction, entity_type, idempotency_key, status, error_message, attempt_count)
       VALUES ('inbound', 'aggregator_order', 'dl-test-' || $1, 'dead_letter', 'menu item not mapped', 3)
       RETURNING id`,
      [SLUG]
    );
    aggregatorEventId = agg.id;

    // Channel-sync conflict (V10 OTA import) — needs a feed row for the FK.
    const { rows: [feed] } = await pool.query(
      `INSERT INTO ${SCHEMA}.room_channel_feeds (direction, name, channel_name, url)
       VALUES ('import', 'Test OTA feed', 'Booking.com', 'https://example.com/cal.ics')
       RETURNING id`
    );
    const { rows: [dl] } = await pool.query(
      `INSERT INTO ${SCHEMA}.channel_sync_dead_letters
         (feed_id, external_uid, start_date, end_date, summary, reason, status)
       VALUES ($1, 'uid-123', '2026-08-01', '2026-08-03', 'OTA booking', 'overlaps confirmed booking', 'open')
       RETURNING id`,
      [feed.id]
    );
    channelDeadLetterId = dl.id;
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

  test("aggregator list surfaces dead-lettered sync events with tenant info", async () => {
    const res = await request(app)
      .get("/api/admin/dead-letters/aggregator")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ev = res.body.events.find((e) => e.tenant_id === tenantId && e.id === aggregatorEventId);
    expect(ev).toBeTruthy();
    expect(ev.entity_type).toBe("aggregator_order");
    expect(ev.error_message).toBe("menu item not mapped");
    expect(ev.tenant_slug).toBe(SLUG);
  });

  test("aggregator dismiss marks the event failed (reaped by 30d cleanup)", async () => {
    const res = await request(app)
      .post(`/api/admin/dead-letters/aggregator/${tenantId}/${aggregatorEventId}/dismiss`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT status FROM ${SCHEMA}.external_sync_events WHERE id = $1`, [aggregatorEventId]);
    expect(rows[0].status).toBe("failed");

    // Second dismiss → 404 (no longer dead_letter).
    const again = await request(app)
      .post(`/api/admin/dead-letters/aggregator/${tenantId}/${aggregatorEventId}/dismiss`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(again.status).toBe(404);
  });

  test("channel-sync list surfaces open OTA conflicts", async () => {
    const res = await request(app)
      .get("/api/admin/dead-letters/channel-sync")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ev = res.body.events.find((e) => e.tenant_id === tenantId && e.id === channelDeadLetterId);
    expect(ev).toBeTruthy();
    expect(ev.external_uid).toBe("uid-123");
    expect(ev.reason).toBe("overlaps confirmed booking");
  });

  test("channel-sync resolve updates status; invalid status rejected", async () => {
    const bad = await request(app)
      .put(`/api/admin/dead-letters/channel-sync/${tenantId}/${channelDeadLetterId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "vanished" });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .put(`/api/admin/dead-letters/channel-sync/${tenantId}/${channelDeadLetterId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "resolved" });
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT status FROM ${SCHEMA}.channel_sync_dead_letters WHERE id = $1`, [channelDeadLetterId]);
    expect(rows[0].status).toBe("resolved");
  });

  test("requires super-admin auth", async () => {
    const res = await request(app).get("/api/admin/dead-letters/aggregator");
    expect(res.status).toBe(401);
  });
});
