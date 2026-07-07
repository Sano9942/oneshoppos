/**
 * pg-admin-announcement-targeting.test.js
 *
 * Batch A / A2 — targeted announcements (per plan / per industry).
 *
 * announcements.audience_plan / audience_industry (NULL = everyone, else a
 * comma-separated allow-list) drive filtering in the public
 * GET /api/announcements/active endpoint, which resolves the caller's plan +
 * industry from ?tenant=<slug>.
 *
 * Two tenants: PRO (pro plan, restaurant industry) and FREE (free plan,
 * general_retail industry). Assertions check presence/absence by announcement
 * id (the endpoint returns platform-wide announcements, so never assert counts).
 */
const request = require("supertest");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../../db-pg");

const TEST_ADMIN_EMAIL = "test-admin-announce@example.com";
const SUFFIX = Date.now().toString(36);
const PRO_SLUG = "test_ann_pro_" + SUFFIX;   // pro plan + restaurant
const FREE_SLUG = "test_ann_free_" + SUFFIX; // free plan + general_retail
const JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";

describe("Targeted announcements (per plan / per industry)", () => {
  let app;
  let adminToken;
  let adminId;
  let proTenantId;
  let freeTenantId;
  const createdAnnIds = [];

  const auth = (r) => r.set("Authorization", `Bearer ${adminToken}`);

  async function createAnn(body) {
    const r = await auth(request(app).post("/api/admin/announcements")).send(body);
    expect(r.status).toBe(201);
    createdAnnIds.push(r.body.id);
    return r.body;
  }
  async function activeFor(slug) {
    const r = await request(app).get(`/api/announcements/active${slug ? `?tenant=${slug}` : ""}`);
    expect(r.status).toBe(200);
    return r.body;
  }
  const has = (list, id) => list.some((x) => x.id === id);

  beforeAll(async () => {
    const masterDb = require("../../master-db-pg");
    await masterDb.init(pool);

    const hash = await bcrypt.hash("TestPassAnn!", 4);
    const { rows: [sa] } = await pool.query(
      `INSERT INTO super_admins (email, password_hash, name)
       VALUES ($1, $2, 'Test Admin Announce')
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

    const proRes = await auth(request(app).post("/api/admin/tenants"))
      .send({ slug: PRO_SLUG, name: "Announce Pro", pin: "1234", plan: "pro" });
    expect(proRes.status).toBe(201);
    proTenantId = proRes.body.tenant.id;
    await pool.query(`UPDATE tenant_${PRO_SLUG}.company_profile SET industry_type = 'restaurant' WHERE id = 1`);

    const freeRes = await auth(request(app).post("/api/admin/tenants"))
      .send({ slug: FREE_SLUG, name: "Announce Free", pin: "1234", plan: "free" });
    expect(freeRes.status).toBe(201);
    freeTenantId = freeRes.body.tenant.id;
    await pool.query(`UPDATE tenant_${FREE_SLUG}.company_profile SET industry_type = 'general_retail' WHERE id = 1`);
  }, 90000);

  afterAll(async () => {
    if (createdAnnIds.length) {
      await pool.query("DELETE FROM announcements WHERE id = ANY($1)", [createdAnnIds]).catch(() => {});
    }
    for (const [id, slug] of [[proTenantId, PRO_SLUG], [freeTenantId, FREE_SLUG]]) {
      if (!id) continue;
      await pool.query("DELETE FROM tenant_audit_log WHERE tenant_id = $1", [id]).catch(() => {});
      await pool.query(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`).catch(() => {});
      await pool.query("DELETE FROM tenants WHERE id = $1", [id]).catch(() => {});
    }
    await pool.query("DELETE FROM admin_activity_log WHERE admin_email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM admin_security_log WHERE email = $1", [TEST_ADMIN_EMAIL]);
    await pool.query("DELETE FROM super_admins WHERE id = $1", [adminId]);
  });

  test("global announcement (no audience) is visible to every tenant and pre-login", async () => {
    const a = await createAnn({ message: "Global " + SUFFIX, type: "info" });
    expect(a.audience_plan).toBeNull();
    expect(a.audience_industry).toBeNull();

    expect(has(await activeFor(PRO_SLUG), a.id)).toBe(true);
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(true);
    expect(has(await activeFor(null), a.id)).toBe(true);

    // Public endpoint never leaks the audience columns.
    const list = await activeFor(PRO_SLUG);
    const row = list.find((x) => x.id === a.id);
    expect(row).not.toHaveProperty("audience_plan");
    expect(row).not.toHaveProperty("audience_industry");
  });

  test("pro-only announcement hidden from free tenant and pre-login", async () => {
    const a = await createAnn({ message: "Pro only " + SUFFIX, type: "info", audience_plan: "pro" });
    expect(a.audience_plan).toBe("pro");

    expect(has(await activeFor(PRO_SLUG), a.id)).toBe(true);
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(false);
    expect(has(await activeFor(null), a.id)).toBe(false); // unknown audience → targeted stays hidden
  });

  test("restaurant-only announcement hidden from retail tenant", async () => {
    const a = await createAnn({ message: "Resto only " + SUFFIX, type: "info", audience_industry: "restaurant" });
    expect(a.audience_industry).toBe("restaurant");

    expect(has(await activeFor(PRO_SLUG), a.id)).toBe(true);   // pro tenant is restaurant
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(false); // free tenant is general_retail
  });

  test("combined plan+industry targeting requires both to match", async () => {
    const a = await createAnn({ message: "Pro resto " + SUFFIX, type: "info", audience_plan: "pro", audience_industry: "restaurant" });
    expect(has(await activeFor(PRO_SLUG), a.id)).toBe(true);   // pro AND restaurant
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(false); // neither matches
  });

  test("comma-separated audience list matches any listed value", async () => {
    const a = await createAnn({ message: "Free or pro " + SUFFIX, type: "info", audience_plan: "free,pro" });
    expect(has(await activeFor(PRO_SLUG), a.id)).toBe(true);
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(true);
  });

  test("partial PUT (deactivate/edit) preserves existing audience targeting", async () => {
    const a = await createAnn({ message: "Preserve " + SUFFIX, type: "info", audience_plan: "pro" });
    const put = await auth(request(app).put(`/api/admin/announcements/${a.id}`))
      .send({ message: "Preserve edited " + SUFFIX }); // no audience keys
    expect(put.status).toBe(200);
    expect(put.body.audience_plan).toBe("pro"); // not wiped
  });

  test("explicit empty audience on PUT clears targeting back to everyone", async () => {
    const a = await createAnn({ message: "Clear " + SUFFIX, type: "info", audience_plan: "pro" });
    const put = await auth(request(app).put(`/api/admin/announcements/${a.id}`))
      .send({ audience_plan: "" });
    expect(put.status).toBe(200);
    expect(put.body.audience_plan).toBeNull();
    expect(has(await activeFor(FREE_SLUG), a.id)).toBe(true); // now visible to everyone
  });
});
