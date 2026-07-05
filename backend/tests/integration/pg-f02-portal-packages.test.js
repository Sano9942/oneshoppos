/**
 * Integration test — customer portal "My Packages" endpoint (F02).
 * Owner-isolated balance + redemption history read.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const supertest = require("supertest");
const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");

const STUB_TENANT = { id: 999, slug: "acme", name: "Acme Co" };
const publicTenantCtx = require("../../services/public-tenant-context");
const originalResolve = publicTenantCtx.resolvePublicTenantDb;

let testDb;
publicTenantCtx.resolvePublicTenantDb = async () => ({ db: testDb, tenant: STUB_TENANT });

let app, cleanup, req, token, customerId, otherId;

async function makePackage(customer, credits, used) {
  const { rows: [tpl] } = await testDb.query(
    "INSERT INTO package_templates (name, price, credits) VALUES ('Pass', 1000, $1) RETURNING id", [credits]);
  const { rows: [pkg] } = await testDb.query(
    `INSERT INTO customer_packages (customer_id, package_template_id, credits_total, credits_used, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [customer, tpl.id, credits, used]);
  for (let i = 0; i < used; i += 1) {
    await testDb.query(
      "INSERT INTO package_redemptions (customer_package_id, credits) VALUES ($1, 1)", [pkg.id]);
  }
  return pkg.id;
}

beforeAll(async () => {
  process.env.CUSTOMER_PORTAL_JWT_SECRET = "pkg-test-secret";
  const result = await createTestApp();
  app = result.app;
  testDb = result.db;
  cleanup = result.cleanup;

  app.use(cookieParser());
  require("../../routes/customer-portal/auth")(app, {});
  require("../../routes/customer-portal/packages")(app, {});
  req = supertest(app);

  const pwHash = await bcrypt.hash("Pass1234!", 4);
  const { rows: [c] } = await testDb.query(
    `INSERT INTO customers (name, email, portal_password_hash, portal_enabled_at, portal_email_verified_at)
     VALUES ('Owner', 'owner@x.co', $1, NOW(), NOW()) RETURNING id`, [pwHash]);
  customerId = c.id;
  const { rows: [o] } = await testDb.query(
    "INSERT INTO customers (name, email) VALUES ('Other', 'other@x.co') RETURNING id");
  otherId = o.id;

  const loginRes = await req.post("/api/portal/auth/login?tenant=acme")
    .send({ email: "owner@x.co", password: "Pass1234!" }).expect(200);
  token = loginRes.body.access_token;
}, 60000);

afterAll(async () => {
  publicTenantCtx.resolvePublicTenantDb = originalResolve;
  if (cleanup) await cleanup();
  delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
}, 30000);

describe("F02 — portal My Packages", () => {
  test("returns only the authenticated customer's packages with remaining + history", async () => {
    const mine = await makePackage(customerId, 5, 2);
    await makePackage(otherId, 8, 0); // must NOT appear

    const res = await req.get("/api/portal/me/packages?tenant=acme")
      .set("Authorization", `Bearer ${token}`).expect(200);

    expect(Array.isArray(res.body.packages)).toBe(true);
    expect(res.body.packages).toHaveLength(1);
    const p = res.body.packages[0];
    expect(p.id).toBe(mine);
    expect(Number(p.credits_remaining)).toBe(3);
    expect(p.template_name).toBe("Pass");
    expect(Array.isArray(p.history)).toBe(true);
    expect(p.history.length).toBe(2);
  });

  test("requires auth", async () => {
    const res = await req.get("/api/portal/me/packages?tenant=acme");
    expect(res.status).toBe(401);
  });
});
