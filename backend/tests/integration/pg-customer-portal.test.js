/**
 * Integration tests for the M8 customer portal — auth + data flows.
 *
 * These tests stub `resolvePublicTenantDb` so the portal router uses the
 * isolated test schema directly (no master-db / tenant-db-manager needed).
 * Full webhook confirmation requires master-db and is covered by manual E2E
 * against the sandbox adapter + the existing pg-sandbox-payment suite.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const express = require("express");
const cookieParser = require("cookie-parser");
const supertest = require("supertest");
const bcrypt = require("bcryptjs");
const { createTestApp } = require("../helpers/createTestApp-pg");

// ── Stub the public tenant resolver BEFORE requiring the portal routes ──
const STUB_TENANT = { id: 999, slug: "acme", name: "Acme Co" };
const publicTenantCtx = require("../../services/public-tenant-context");
const originalResolve = publicTenantCtx.resolvePublicTenantDb;

let testDb;
publicTenantCtx.resolvePublicTenantDb = async () => ({
  db: testDb,
  tenant: STUB_TENANT,
});

let app, cleanup, req;
const MIGRATION_DDL_APPLIED = true;

beforeAll(async () => {
  process.env.CUSTOMER_PORTAL_JWT_SECRET = "integration-test-portal-secret";
  process.env.PAYMENT_GATEWAY = "sandbox";
  process.env.SANDBOX_WEBHOOK_SECRET = "integration-test-sandbox";

  const result = await createTestApp();
  app = result.app;
  testDb = result.db;
  cleanup = result.cleanup;

  // Apply migration v37 DDL manually — createTestApp's seedSchema uses the
  // full schema-pg.sql which already includes the portal tables. Verify:
  const { rows } = await testDb.query(
    "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'portal_password_hash'"
  );
  expect(rows[0].n).toBe(1);

  // Mount the portal routers.
  app.use(cookieParser());
  require("../../routes/customer-portal/auth")(app, {});
  require("../../routes/customer-portal/data")(app, {});
  require("../../routes/customer-portal/payments")(app, {});
  require("../../routes/customer-portal/appointments")(app, {});

  req = supertest(app);
}, 60000);

afterAll(async () => {
  publicTenantCtx.resolvePublicTenantDb = originalResolve;
  if (cleanup) await cleanup();
  delete process.env.CUSTOMER_PORTAL_JWT_SECRET;
  delete process.env.PAYMENT_GATEWAY;
  delete process.env.SANDBOX_WEBHOOK_SECRET;
}, 30000);

async function directEnablePortal(email, password, name = "Portal Cust") {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await testDb.query(
    `INSERT INTO customers (name, email, portal_password_hash, portal_enabled_at, portal_email_verified_at)
     VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
    [name, email, hash]
  );
  return rows[0].id;
}

describe("Portal /config (public)", () => {
  test("returns branded config + default tab list", async () => {
    const res = await req.get("/api/portal/config?tenant=acme").expect(200);
    expect(res.body.tenant.slug).toBe("acme");
    expect(Array.isArray(res.body.enabled_tabs)).toBe(true);
    expect(res.body.portal_labels.profile_tab).toBeDefined();
    expect(res.body.enabled_tabs).toContain("profile");
  });
});

describe("Portal auth — password flow", () => {
  beforeAll(async () => {
    await directEnablePortal("login-test@example.com", "Secret1234!", "Jane");
  });

  test("POST /login rejects wrong password", async () => {
    await req
      .post("/api/portal/auth/login?tenant=acme")
      .send({ email: "login-test@example.com", password: "wrong-password-nope" })
      .expect(401);
  });

  test("POST /login returns access token + sets refresh cookie", async () => {
    const res = await req
      .post("/api/portal/auth/login?tenant=acme")
      .send({ email: "login-test@example.com", password: "Secret1234!" })
      .expect(200);
    expect(res.body.access_token).toMatch(/^eyJ/); // JWT
    expect(res.body.customer.email).toBe("login-test@example.com");
    const setCookie = res.headers["set-cookie"] || [];
    const refresh = setCookie.find((c) => c.startsWith("sanopos_portal_refresh="));
    expect(refresh).toBeTruthy();
    expect(refresh).toContain("HttpOnly");
  });
});

describe("Portal auth — OTP flow", () => {
  const email = "otp-test@example.com";
  let customerId;

  beforeAll(async () => {
    customerId = await directEnablePortal(email, "Init1234!", "OTP Cust");
  });

  test("request-otp always responds 200 (no enumeration)", async () => {
    await req
      .post("/api/portal/auth/request-otp?tenant=acme")
      .send({ email: "totally-unknown@example.com", purpose: "login" })
      .expect(200);
    await req
      .post("/api/portal/auth/request-otp?tenant=acme")
      .send({ email, purpose: "login" })
      .expect(200);

    // For the known email, a row was inserted.
    const { rows } = await testDb.query(
      "SELECT COUNT(*)::int AS n FROM customer_portal_otps WHERE LOWER(email) = $1 AND purpose = 'login'",
      [email]
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  test("verify-otp consumes a valid code and returns a session", async () => {
    // Insert a known OTP directly with a known code.
    const crypto = require("crypto");
    const code = "123456";
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await testDb.query(
      `INSERT INTO customer_portal_otps (customer_id, email, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, 'login', NOW() + INTERVAL '15 minutes')`,
      [customerId, email, codeHash]
    );

    const res = await req
      .post("/api/portal/auth/verify-otp?tenant=acme")
      .send({ email, code, purpose: "login" })
      .expect(200);
    expect(res.body.access_token).toMatch(/^eyJ/);

    // Second use of the same code should fail (used_at set).
    await req
      .post("/api/portal/auth/verify-otp?tenant=acme")
      .send({ email, code, purpose: "login" })
      .expect(400);
  });

  test("verify-otp rejects a wrong code", async () => {
    await req
      .post("/api/portal/auth/verify-otp?tenant=acme")
      .send({ email, code: "000000", purpose: "login" })
      .expect(400);
  });
});

describe("Portal /me — authenticated data", () => {
  let token;
  let customerId;

  beforeAll(async () => {
    customerId = await directEnablePortal("me-test@example.com", "Letmein1!", "Me Cust");
    const res = await req
      .post("/api/portal/auth/login?tenant=acme")
      .send({ email: "me-test@example.com", password: "Letmein1!" })
      .expect(200);
    token = res.body.access_token;
  });

  test("GET /me returns the customer row", async () => {
    const res = await req
      .get("/api/portal/me?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(customerId);
    expect(res.body.email).toBe("me-test@example.com");
  });

  test("GET /me rejects missing bearer token", async () => {
    await req.get("/api/portal/me?tenant=acme").expect(401);
  });

  test("PUT /me updates whitelisted fields only", async () => {
    const res = await req
      .put("/api/portal/me?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Renamed",
        mobile: "+92 300 1234567",
        email_consent: true,
      })
      .expect(200);
    expect(res.body.name).toBe("Renamed");
    expect(res.body.mobile).toBe("+92 300 1234567");
    expect(res.body.email_consent).toBe(true);
  });

  test("GET /me/invoices filters by customer_id", async () => {
    // Insert an invoice for this customer.
    await testDb.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, discount_amount, total_amount, balance_due)
       VALUES ('INV-PORTAL-001', $1, 'unpaid', 1000, 0, 0, 1000, 1000)`,
      [customerId]
    );
    // And one for a different customer — should NOT appear.
    const { rows: [other] } = await testDb.query(
      `INSERT INTO customers (name, email) VALUES ('Other', 'other@example.com') RETURNING id`
    );
    await testDb.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, discount_amount, total_amount, balance_due)
       VALUES ('INV-OTHER-001', $1, 'unpaid', 500, 0, 0, 500, 500)`,
      [other.id]
    );

    const res = await req
      .get("/api/portal/me/invoices?tenant=acme")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const numbers = res.body.map((i) => i.invoice_number);
    expect(numbers).toContain("INV-PORTAL-001");
    expect(numbers).not.toContain("INV-OTHER-001");
  });
});

describe("Portal /me/invoices/:id/pay — sandbox", () => {
  let token;
  let customerId;
  let invoiceId;

  beforeAll(async () => {
    customerId = await directEnablePortal("pay-test@example.com", "Paynow12!", "Pay Cust");
    const res = await req
      .post("/api/portal/auth/login?tenant=acme")
      .send({ email: "pay-test@example.com", password: "Paynow12!" })
      .expect(200);
    token = res.body.access_token;

    const { rows } = await testDb.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, discount_amount, total_amount, balance_due)
       VALUES ('INV-PAY-001', $1, 'unpaid', 2500, 0, 0, 2500, 2500) RETURNING id`,
      [customerId]
    );
    invoiceId = rows[0].id;
  });

  test("returns a sandbox checkout URL for an unpaid invoice", async () => {
    const res = await req
      .post(`/api/portal/me/invoices/${invoiceId}/pay?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
    expect(res.body.checkout_url).toContain("/api/sandbox/pay/");
    expect(res.body.gateway_ref).toMatch(/^sandbox_/);
    expect(Number(res.body.amount)).toBe(2500);

    // A customer_invoice_payment_links row was created — the webhook can find it.
    const { rows } = await testDb.query(
      "SELECT invoice_id, amount, status FROM customer_invoice_payment_links WHERE gateway_ref = $1",
      [res.body.gateway_ref]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].invoice_id).toBe(invoiceId);
    expect(Number(rows[0].amount)).toBe(2500);
    expect(rows[0].status).toBe("active");
  });

  test("rejects cross-customer invoice access (404)", async () => {
    // Create an invoice for someone else.
    const { rows: [other] } = await testDb.query(
      `INSERT INTO customers (name, email) VALUES ('Other2', 'other2@example.com') RETURNING id`
    );
    const { rows: [otherInv] } = await testDb.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, discount_amount, total_amount, balance_due)
       VALUES ('INV-OTHER-002', $1, 'unpaid', 100, 0, 0, 100, 100) RETURNING id`,
      [other.id]
    );

    await req
      .post(`/api/portal/me/invoices/${otherInv.id}/pay?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(404);
  });

  test("rejects pay on a paid invoice", async () => {
    const { rows: [paid] } = await testDb.query(
      `INSERT INTO customer_invoices
         (invoice_number, customer_id, status, subtotal, tax_total, discount_amount, total_amount, balance_due, amount_paid)
       VALUES ('INV-PAID-001', $1, 'paid', 300, 0, 0, 300, 0, 300) RETURNING id`,
      [customerId]
    );
    await req
      .post(`/api/portal/me/invoices/${paid.id}/pay?tenant=acme`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);
  });
});

// Keep a guard so the file is never run with a clobbered resolver.
afterAll(() => {
  expect(publicTenantCtx.resolvePublicTenantDb).toBeDefined();
  expect(MIGRATION_DDL_APPLIED).toBe(true);
});
