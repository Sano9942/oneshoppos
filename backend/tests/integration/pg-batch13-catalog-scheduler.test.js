/**
 * pg-batch13-catalog-scheduler.test.js — Integration tests for the Phase 2 C3
 * fix: SQL injection prevention via field_name allowlist on
 *   POST /api/catalog/scheduled-changes
 *
 * Tests the route end-to-end via real Postgres: creates an isolated schema,
 * mounts the real route handler with stubbed permission + feature-flag
 * middleware, and asserts the Zod validator correctly accepts/rejects
 * payloads.
 *
 * Paired with tests/unit/services-catalog-scheduler.test.js which covers
 * the worker-side applyScheduledChange() service in isolation. Together
 * they exercise both injection entry points (route and worker).
 *
 * Pattern follows pg-batch12-billing.test.js — jest.mock db-pg to route
 * all queries through an isolated schema client.
 */

const request = require("supertest");
const express = require("express");
const crypto = require("crypto");

const realPool = jest.requireActual("../../db-pg");

jest.mock("../../db-pg", () => ({
  query: jest.fn(),
  pool: { query: jest.fn() },
}));

const mockDb = require("../../db-pg");

const SCHEDULED_DDL = `
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT UNIQUE NOT NULL,
  price NUMERIC(12,2),
  stock INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scheduled_catalog_changes (
  id SERIAL PRIMARY KEY,
  change_type TEXT NOT NULL CHECK (change_type IN ('price','visibility','status','tax')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product','variant','collection','price_list')),
  entity_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','failed')),
  created_by INTEGER REFERENCES employees(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

describe("Batch 13 — Scheduled catalog changes route (Postgres)", () => {
  let app, client, schemaName, testProductId;

  const dbQuery = (sql, params) => client.query(sql, params);

  beforeAll(async () => {
    schemaName = "test_catsched_" + crypto.randomBytes(4).toString("hex");
    client = await realPool.getClient();
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path = '${schemaName}'`);
    await client.query(SCHEDULED_DDL);

    // Seed a product so entity_id=42 resolves on the old_value lookup
    const { rows: [seed] } = await dbQuery(
      `INSERT INTO products (id, name, price, stock) VALUES (42, 'Test Product', 100, 10) RETURNING id`
    );
    testProductId = seed.id;
    await dbQuery("INSERT INTO employees (id, name) VALUES (1, 'Test Admin')");

    mockDb.query.mockImplementation((sql, params) => dbQuery(sql, params));
    mockDb.pool.query.mockImplementation((sql, params) => dbQuery(sql, params));

    app = express();
    app.use(express.json());

    // Inject employee context (simulates tenant-auth middleware)
    app.use((req, _res, next) => {
      req.employee = { id: 1, name: "Test Admin" };
      next();
    });

    // Build a deps shim: real db, noop permission + feature gates.
    // The route only uses deps.db, deps.requirePerm, deps.requireFeature.
    const noopMiddleware = () => (req, _res, next) => next();
    require("../../routes/scheduled-changes")(app, {
      db: mockDb,
      requirePerm: noopMiddleware,
      requireFeature: noopMiddleware,
    });
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

  // Clear rows between tests so inserts don't pile up.
  beforeEach(async () => {
    await dbQuery("DELETE FROM scheduled_catalog_changes");
  });

  const futureISO = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // ─────────────────────────────────────────────────────────────────────
  //  POST /api/catalog/scheduled-changes — happy path
  // ─────────────────────────────────────────────────────────────────────

  describe("POST /api/catalog/scheduled-changes — valid payloads", () => {
    it("accepts a product price change and inserts the row", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "price",
          new_value: "799",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(201);
      expect(res.body.change).toBeDefined();
      expect(res.body.change.field_name).toBe("price");
      expect(res.body.change.status).toBe("pending");

      const { rows } = await dbQuery("SELECT COUNT(*)::int AS n FROM scheduled_catalog_changes");
      expect(rows[0].n).toBe(1);
    });

    it("accepts a product status change (status is in the allowlist)", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "status",
          entity_type: "product",
          entity_id: 42,
          field_name: "status",
          new_value: "inactive",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(201);
    });

    it("coerces numeric new_value to string", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "price",
          new_value: 999, // numeric, not string
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(201);
      expect(res.body.change.new_value).toBe("999");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  POST — allowlist enforcement (the security-critical tests)
  // ─────────────────────────────────────────────────────────────────────

  describe("POST /api/catalog/scheduled-changes — allowlist enforcement", () => {
    it("rejects field_name='id' (attempt to rewrite primary keys)", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "id",
          new_value: "1",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/field_name/i);

      // Verify nothing was inserted
      const { rows } = await dbQuery("SELECT COUNT(*)::int AS n FROM scheduled_catalog_changes");
      expect(rows[0].n).toBe(0);
    });

    it("rejects field_name='deleted_at' (soft-delete hijack)", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "deleted_at",
          new_value: "NOW()",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/field_name/i);
    });

    it("rejects injection-shaped field_name with SQL metacharacters", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "price = 0, deleted_at = NOW()",
          new_value: "anything",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);

      // Crucial assertion: the row was NOT inserted (the original bug would
      // have queued this and fired it later).
      const { rows } = await dbQuery("SELECT COUNT(*)::int AS n FROM scheduled_catalog_changes");
      expect(rows[0].n).toBe(0);
    });

    it("rejects field_name='description_html' (deliberately excluded to prevent stored XSS)", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "description_html",
          new_value: "<script>alert(1)</script>",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);
    });

    it("rejects variant with field_name='status' — 'status' is product-only", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "status",
          entity_type: "variant",
          entity_id: 1,
          field_name: "status",
          new_value: "inactive",
          scheduled_at: futureISO(),
        });

      // status is in PRODUCT_FIELDS but NOT in VARIANT_FIELDS — cross-field
      // refine must catch this.
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/field_name/i);
    });

    it("rejects entity_type='bogus'", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "bogus",
          entity_id: 42,
          field_name: "price",
          new_value: "1",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);
      // Zod enum error bubbles out as 'Invalid option' or similar
    });

    it("rejects change_type='field_update' (not in the DB CHECK constraint)", async () => {
      // The original review reproduction example used change_type='field_update',
      // which isn't in the DB CHECK constraint and would have failed the INSERT
      // with 500 — now it fails validation with 400.
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "field_update",
          entity_type: "product",
          entity_id: 42,
          field_name: "price",
          new_value: "1",
          scheduled_at: futureISO(),
        });

      expect(res.status).toBe(400);
    });

    it("rejects scheduled_at in the past", async () => {
      const res = await request(app)
        .post("/api/catalog/scheduled-changes")
        .send({
          change_type: "price",
          entity_type: "product",
          entity_id: 42,
          field_name: "price",
          new_value: "799",
          scheduled_at: new Date(Date.now() - 1000).toISOString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/scheduled_at/i);
    });
  });
});
