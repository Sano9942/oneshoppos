/**
 * pg-batch12-billing.test.js — Billing tenant-facing route tests (Postgres).
 *
 * billing.js requires db-pg, master-db-pg, and payment-gateway via require()
 * inside its module body (not through deps). Since jest.mock() for db-pg would
 * also break createTestApp-pg.js (which imports the real db-pg pool), we skip
 * createTestApp and set up an isolated schema directly using the real pool.
 */

const request = require("supertest");
const express = require("express");
const crypto = require("crypto");

// jest.requireActual bypasses the mock to get the real pg pool
const realPool = jest.requireActual("../../db-pg");

// ── Module mocks ────────────────────────────────────────────────────────
jest.mock("../../db-pg", () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));
jest.mock("../../master-db-pg", () => ({
  getTenantById: jest.fn(),
  query: jest.fn(),
}));
jest.mock("../../services/payment-gateway", () => ({
  isEnabled: jest.fn(() => false),
  createCheckout: jest.fn(),
}));

const mockDb = require("../../db-pg");
const mockMasterDb = require("../../master-db-pg");
const mockPaymentGateway = require("../../services/payment-gateway");

// ── Billing tables DDL ──────────────────────────────────────────────────
const BILLING_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  owner_email     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  plan            TEXT NOT NULL DEFAULT 'free',
  max_outlets     INTEGER DEFAULT 1,
  max_employees   INTEGER DEFAULT 3,
  max_products    INTEGER DEFAULT 500,
  billing_cycle   TEXT,
  plan_expires_at TIMESTAMPTZ,
  trial_ends_at   TIMESTAMPTZ,
  grace_ends_at   TIMESTAMPTZ,
  payment_status  TEXT DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_pricing (
  id            SERIAL PRIMARY KEY,
  plan          TEXT NOT NULL,
  cycle         TEXT NOT NULL,
  price         NUMERIC(12,2) NOT NULL,
  currency_code TEXT DEFAULT 'PKR',
  is_active     BOOLEAN DEFAULT true,
  UNIQUE(plan, cycle)
);

INSERT INTO plan_pricing (plan, cycle, price) VALUES
  ('pro', 'monthly', 8000),
  ('pro', 'annual', 80000)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS upgrade_requests (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  requested_plan  TEXT NOT NULL,
  requested_cycle TEXT NOT NULL,
  message         TEXT,
  status          TEXT DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT
);

CREATE TABLE IF NOT EXISTS payment_records (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency_code   TEXT DEFAULT 'PKR',
  plan            TEXT NOT NULL,
  cycle           TEXT NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  payment_method  TEXT,
  reference_note  TEXT,
  recorded_by     TEXT,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  amount        NUMERIC(12,2) NOT NULL,
  currency_code TEXT DEFAULT 'PKR',
  plan          TEXT NOT NULL,
  cycle         TEXT NOT NULL,
  outlet_count  INTEGER DEFAULT 1,
  status        TEXT DEFAULT 'pending',
  gateway       TEXT NOT NULL,
  gateway_ref   TEXT,
  gateway_data  JSONB,
  return_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);
`;

describe("Batch 12 — Billing tenant-facing routes (Postgres)", () => {
  let app, client, schemaName;
  let testTenantId;

  // Scoped query helper (runs within the test schema)
  const dbQuery = (sql, params) => client.query(sql, params);

  beforeAll(async () => {
    schemaName = "test_billing_" + crypto.randomBytes(4).toString("hex");

    // Get a dedicated client and create an isolated schema
    client = await realPool.getClient();
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path = '${schemaName}'`);

    // Create billing tables
    await client.query(BILLING_DDL);

    // Seed a test tenant
    const { rows: [tenant] } = await dbQuery(
      `INSERT INTO tenants (slug, name, owner_email, plan, payment_status, max_outlets)
       VALUES ('billing_test', 'Billing Test Store', 'billing@test.com', 'free', 'active', 1)
       RETURNING id`
    );
    testTenantId = tenant.id;

    // ── Wire mocks to the test schema ─────────────────────────────────
    mockDb.query.mockImplementation((sql, params) => dbQuery(sql, params));
    mockDb.pool.query.mockImplementation((sql, params) => dbQuery(sql, params));

    mockMasterDb.getTenantById.mockImplementation(async (id) => {
      const { rows } = await dbQuery("SELECT * FROM tenants WHERE id = $1", [id]);
      return rows[0] || null;
    });
    mockMasterDb.query.mockImplementation((sql, params) => dbQuery(sql, params));

    // Build a minimal Express app
    app = express();
    app.use(express.json());

    // Inject req.tenantId from header (simulates multi-tenant middleware)
    app.use((req, _res, next) => {
      const tid = req.headers["x-tenant-id"];
      if (tid) req.tenantId = Number(tid);
      next();
    });

    // Register billing routes
    require("../../routes/billing")(app, {});
  }, 30000);

  afterAll(async () => {
    if (client) {
      try {
        await client.query(`SET search_path = 'public'`);
        await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } finally {
        client.release();
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  GET /api/billing/pricing (public — no tenantId needed)
  // ═══════════════════════════════════════════════════════════════════════

  describe("GET /api/billing/pricing", () => {
    it("returns active pricing rows", async () => {
      const res = await request(app).get("/api/billing/pricing");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({ plan: "pro", cycle: "annual" });
      expect(res.body[1]).toMatchObject({ plan: "pro", cycle: "monthly" });
    });

    it("excludes inactive pricing", async () => {
      await dbQuery(
        "INSERT INTO plan_pricing (plan, cycle, price, is_active) VALUES ('legacy', 'monthly', 5000, false)"
      );
      const res = await request(app).get("/api/billing/pricing");

      expect(res.status).toBe(200);
      const plans = res.body.map((r) => r.plan);
      expect(plans).not.toContain("legacy");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  GET /api/billing/status
  // ═══════════════════════════════════════════════════════════════════════

  describe("GET /api/billing/status", () => {
    it("returns 400 without tenant context", async () => {
      const res = await request(app).get("/api/billing/status");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tenant context/i);
    });

    it("returns billing status for a free-plan tenant", async () => {
      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe("free");
      expect(res.body.payment_status).toBe("active");
      expect(res.body.upgrade_options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ plan: "pro" }),
        ])
      );
      expect(res.body.pending_request).toBeNull();
      expect(res.body.max_outlets).toBe(1);
    });

    it("returns 404 for non-existent tenant", async () => {
      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", "99999");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("shows trial_days_left for trial tenants", async () => {
      const trialEnd = new Date(Date.now() + 10 * 86400000).toISOString();
      await dbQuery(
        "UPDATE tenants SET payment_status = 'trial', trial_ends_at = $1 WHERE id = $2",
        [trialEnd, testTenantId]
      );

      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.payment_status).toBe("trial");
      expect(res.body.trial_days_left).toBeGreaterThanOrEqual(9);
      expect(res.body.trial_days_left).toBeLessThanOrEqual(11);

      // Reset
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', trial_ends_at = NULL WHERE id = $1",
        [testTenantId]
      );
    });

    it("shows grace_days_left for grace tenants", async () => {
      const graceEnd = new Date(Date.now() + 3 * 86400000).toISOString();
      await dbQuery(
        "UPDATE tenants SET payment_status = 'grace', grace_ends_at = $1 WHERE id = $2",
        [graceEnd, testTenantId]
      );

      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.payment_status).toBe("grace");
      expect(res.body.grace_days_left).toBeGreaterThanOrEqual(2);
      expect(res.body.grace_days_left).toBeLessThanOrEqual(4);

      // Reset
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', grace_ends_at = NULL WHERE id = $1",
        [testTenantId]
      );
    });

    it("includes pending upgrade request when one exists", async () => {
      await dbQuery(
        "INSERT INTO upgrade_requests (tenant_id, requested_plan, requested_cycle) VALUES ($1, 'pro', 'monthly')",
        [testTenantId]
      );

      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.pending_request).toBeTruthy();
      expect(res.body.pending_request.requested_plan).toBe("pro");

      // Cleanup
      await dbQuery("DELETE FROM upgrade_requests WHERE tenant_id = $1", [testTenantId]);
    });

    it("shows no upgrade options for pro-plan tenant", async () => {
      await dbQuery("UPDATE tenants SET plan = 'pro' WHERE id = $1", [testTenantId]);

      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe("pro");
      expect(res.body.upgrade_options).toHaveLength(0);

      // Reset
      await dbQuery("UPDATE tenants SET plan = 'free' WHERE id = $1", [testTenantId]);
    });

    it("includes payment_enabled flag", async () => {
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      const res = await request(app)
        .get("/api/billing/status")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body.payment_enabled).toBe(true);

      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  POST /api/billing/request-upgrade
  // ═══════════════════════════════════════════════════════════════════════

  describe("POST /api/billing/request-upgrade", () => {
    afterEach(async () => {
      await dbQuery("DELETE FROM upgrade_requests WHERE tenant_id = $1", [testTenantId]);
    });

    it("returns 400 without tenant context", async () => {
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .send({ plan: "pro", cycle: "monthly" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tenant context/i);
    });

    it("creates an upgrade request", async () => {
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "monthly", message: "Ready to go Pro!" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const { rows } = await dbQuery(
        "SELECT * FROM upgrade_requests WHERE tenant_id = $1", [testTenantId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].requested_plan).toBe("pro");
      expect(rows[0].requested_cycle).toBe("monthly");
      expect(rows[0].message).toBe("Ready to go Pro!");
      expect(rows[0].status).toBe("pending");
    });

    it("rejects duplicate pending request", async () => {
      // First request
      await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "monthly" });

      // Duplicate
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "annual" });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/pending/i);
    });

    it("allows new request after previous one is resolved", async () => {
      await dbQuery(
        "INSERT INTO upgrade_requests (tenant_id, requested_plan, requested_cycle, status) VALUES ($1, 'pro', 'monthly', 'approved')",
        [testTenantId]
      );

      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "annual" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("rejects invalid plan", async () => {
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "enterprise", cycle: "monthly" });

      expect(res.status).toBe(400);
    });

    it("rejects invalid cycle", async () => {
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "weekly" });

      expect(res.status).toBe(400);
    });

    it("works without optional message", async () => {
      const res = await request(app)
        .post("/api/billing/request-upgrade")
        .set("x-tenant-id", String(testTenantId))
        .send({ plan: "pro", cycle: "annual" });

      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  POST /api/billing/create-checkout
  // ═══════════════════════════════════════════════════════════════════════

  describe("POST /api/billing/create-checkout", () => {
    it("returns 400 without tenant context", async () => {
      const res = await request(app)
        .post("/api/billing/create-checkout")
        .send({ cycle: "monthly" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tenant context/i);
    });

    it("returns 400 when payment gateway is disabled", async () => {
      mockPaymentGateway.isEnabled.mockReturnValue(false);
      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "monthly" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not configured/i);
    });

    it("creates checkout session when gateway is enabled", async () => {
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      mockPaymentGateway.createCheckout.mockResolvedValue({
        checkout_url: "https://pay.example.com/checkout/abc",
        gateway_ref: "gw_ref_123",
      });

      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "monthly" });

      expect(res.status).toBe(200);
      expect(res.body.checkout_url).toBe("https://pay.example.com/checkout/abc");
      expect(res.body.payment_intent_id).toBeTruthy();

      // Verify payment intent was recorded
      const { rows } = await dbQuery(
        "SELECT * FROM payment_intents WHERE id = $1",
        [res.body.payment_intent_id]
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(8000);
      expect(rows[0].plan).toBe("pro");
      expect(rows[0].cycle).toBe("monthly");
      expect(rows[0].gateway_ref).toBe("gw_ref_123");

      // Cleanup
      await dbQuery("DELETE FROM payment_intents WHERE tenant_id = $1", [testTenantId]);
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });

    it("calculates annual price correctly", async () => {
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      mockPaymentGateway.createCheckout.mockResolvedValue({
        checkout_url: "https://pay.example.com/checkout/xyz",
        gateway_ref: "gw_ref_456",
      });

      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "annual" });

      expect(res.status).toBe(200);
      const { rows } = await dbQuery(
        "SELECT * FROM payment_intents WHERE id = $1",
        [res.body.payment_intent_id]
      );
      expect(Number(rows[0].amount)).toBe(80000);

      // Cleanup
      await dbQuery("DELETE FROM payment_intents WHERE tenant_id = $1", [testTenantId]);
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });

    it("scales price by outlet count", async () => {
      await dbQuery("UPDATE tenants SET max_outlets = 3 WHERE id = $1", [testTenantId]);
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      mockPaymentGateway.createCheckout.mockResolvedValue({
        checkout_url: "https://pay.example.com/checkout/multi",
        gateway_ref: "gw_ref_789",
      });

      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "monthly" });

      expect(res.status).toBe(200);
      const { rows } = await dbQuery(
        "SELECT * FROM payment_intents WHERE id = $1",
        [res.body.payment_intent_id]
      );
      expect(Number(rows[0].amount)).toBe(24000);
      expect(rows[0].outlet_count).toBe(3);

      // Reset
      await dbQuery("UPDATE tenants SET max_outlets = 1 WHERE id = $1", [testTenantId]);
      await dbQuery("DELETE FROM payment_intents WHERE tenant_id = $1", [testTenantId]);
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });

    it("blocks checkout when subscription has 7+ days remaining", async () => {
      const future = new Date(Date.now() + 30 * 86400000).toISOString();
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', plan_expires_at = $1 WHERE id = $2",
        [future, testTenantId]
      );
      mockPaymentGateway.isEnabled.mockReturnValue(true);

      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "monthly" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/active until/i);

      // Reset
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', plan_expires_at = NULL WHERE id = $1",
        [testTenantId]
      );
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });

    it("allows checkout when subscription expires within 7 days", async () => {
      const soon = new Date(Date.now() + 3 * 86400000).toISOString();
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', plan_expires_at = $1 WHERE id = $2",
        [soon, testTenantId]
      );
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      mockPaymentGateway.createCheckout.mockResolvedValue({
        checkout_url: "https://pay.example.com/renew",
        gateway_ref: "gw_renew",
      });

      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", String(testTenantId))
        .send({ cycle: "monthly" });

      expect(res.status).toBe(200);
      expect(res.body.checkout_url).toBeTruthy();

      // Reset
      await dbQuery(
        "UPDATE tenants SET payment_status = 'active', plan_expires_at = NULL WHERE id = $1",
        [testTenantId]
      );
      await dbQuery("DELETE FROM payment_intents WHERE tenant_id = $1", [testTenantId]);
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });

    it("returns 404 for non-existent tenant", async () => {
      mockPaymentGateway.isEnabled.mockReturnValue(true);
      const res = await request(app)
        .post("/api/billing/create-checkout")
        .set("x-tenant-id", "99999")
        .send({ cycle: "monthly" });

      expect(res.status).toBe(404);
      mockPaymentGateway.isEnabled.mockReturnValue(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  GET /api/billing/payment-history
  // ═══════════════════════════════════════════════════════════════════════

  describe("GET /api/billing/payment-history", () => {
    it("returns 400 without tenant context", async () => {
      const res = await request(app).get("/api/billing/payment-history");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/tenant context/i);
    });

    it("returns empty array for tenant with no payments", async () => {
      const res = await request(app)
        .get("/api/billing/payment-history")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns payment records ordered by most recent first", async () => {
      const now = new Date();
      const oneMonthAgo = new Date(now - 30 * 86400000);
      const twoMonthsAgo = new Date(now - 60 * 86400000);

      await dbQuery(
        `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, recorded_at)
         VALUES ($1, 8000, 'pro', 'monthly', $2, $3, 'bank_transfer', $2)`,
        [testTenantId, twoMonthsAgo.toISOString(), oneMonthAgo.toISOString()]
      );
      await dbQuery(
        `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method, recorded_at)
         VALUES ($1, 8000, 'pro', 'monthly', $2, $3, 'bank_transfer', $2)`,
        [testTenantId, oneMonthAgo.toISOString(), now.toISOString()]
      );

      const res = await request(app)
        .get("/api/billing/payment-history")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      // Most recent first
      expect(new Date(res.body[0].recorded_at).getTime())
        .toBeGreaterThan(new Date(res.body[1].recorded_at).getTime());
      expect(Number(res.body[0].amount)).toBe(8000);
      expect(res.body[0].plan).toBe("pro");
      expect(res.body[0].cycle).toBe("monthly");

      // Cleanup
      await dbQuery("DELETE FROM payment_records WHERE tenant_id = $1", [testTenantId]);
    });

    it("limits results to 24 records", async () => {
      const now = new Date();
      // Batch insert 30 records in a single query to avoid timeout
      const values = [];
      const params = [testTenantId];
      for (let i = 0; i < 30; i++) {
        const start = new Date(now - (i + 1) * 30 * 86400000).toISOString();
        const end = new Date(now - i * 30 * 86400000).toISOString();
        const baseIdx = params.length;
        params.push(start, end);
        values.push(`($1, 8000, 'pro', 'monthly', $${baseIdx + 1}, $${baseIdx + 2}, 'bank_transfer')`);
      }
      await dbQuery(
        `INSERT INTO payment_records (tenant_id, amount, plan, cycle, period_start, period_end, payment_method)
         VALUES ${values.join(", ")}`,
        params
      );

      const res = await request(app)
        .get("/api/billing/payment-history")
        .set("x-tenant-id", String(testTenantId));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(24);

      // Cleanup
      await dbQuery("DELETE FROM payment_records WHERE tenant_id = $1", [testTenantId]);
    });
  });
});
