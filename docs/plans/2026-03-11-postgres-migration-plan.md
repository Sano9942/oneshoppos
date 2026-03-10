# PostgreSQL Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace SQLite with PostgreSQL (Supabase) and enable schema-per-tenant multi-tenancy from day one.

**Architecture:** Single Supabase PostgreSQL database. `public` schema = master DB (tenant registry). `tenant_<slug>` schemas = per-tenant data. `pg.Pool` shared connection pool. AsyncLocalStorage sets `search_path` per request. All route handlers converted from sqlite3 callbacks to async/await with `pg` driver.

**Tech Stack:** `pg` (node-postgres), Supabase free tier, Docker Compose for local dev, PostgreSQL 15+.

**Design doc:** `docs/plans/2026-03-11-postgres-migration-design.md`

**Restore point:** `git tag v1.0-sqlite-working`

---

## Task 1: Local Postgres + Install `pg` driver

**Files:**
- Create: `docker-compose.yml`
- Modify: `backend/package.json`
- Create: `backend/.env.example` (update with DATABASE_URL)

**Step 1: Create docker-compose.yml for local Postgres**

```yaml
# docker-compose.yml (project root)
version: "3.8"
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: sanopos
      POSTGRES_PASSWORD: sanopos_dev
      POSTGRES_DB: sanopos_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

**Step 2: Start Postgres**

Run: `docker compose up -d`
Expected: Postgres running on localhost:5432

**Step 3: Install pg driver**

Run: `cd backend && npm install pg`
Expected: `pg` added to package.json dependencies

**Step 4: Add DATABASE_URL to .env**

Add to `backend/.env`:
```
DATABASE_URL=postgresql://sanopos:sanopos_dev@localhost:5432/sanopos_dev
```

Update `backend/.env.example` to document the new var.

**Step 5: Commit**

```bash
git add docker-compose.yml backend/package.json backend/package-lock.json backend/.env.example
git commit -m "chore: add Docker Postgres + pg driver for migration"
```

---

## Task 2: Create `db-pg.js` — Postgres connection pool + query helpers

**Files:**
- Create: `backend/db-pg.js`

**Step 1: Write the failing test**

Create `backend/tests/integration/pg-connection.test.js`:

```js
const { describe, it, expect, afterAll } = require("vitest");

// This test verifies the pg connection layer works
describe("db-pg connection", () => {
  let db;

  it("connects and runs a simple query", async () => {
    db = require("../../db-pg");
    const result = await db.query("SELECT 1 AS alive");
    expect(result.rows[0].alive).toBe(1);
  });

  it("runs a transaction that commits", async () => {
    const result = await db.transaction(async (client) => {
      await client.query("CREATE TEMP TABLE _test_tx (id SERIAL PRIMARY KEY, val TEXT)");
      await client.query("INSERT INTO _test_tx (val) VALUES ($1)", ["hello"]);
      const { rows } = await client.query("SELECT val FROM _test_tx WHERE id = 1");
      return rows[0];
    });
    expect(result.val).toBe("hello");
  });

  it("rolls back a transaction on error", async () => {
    try {
      await db.transaction(async (client) => {
        await client.query("CREATE TEMP TABLE _test_rb (id SERIAL)");
        throw new Error("deliberate rollback");
      });
    } catch (err) {
      expect(err.message).toBe("deliberate rollback");
    }
    // Table should not exist after rollback
    const result = await db.query(
      "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_test_rb') AS exists"
    );
    expect(result.rows[0].exists).toBe(false);
  });

  afterAll(async () => {
    if (db) await db.end();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-connection.test.js`
Expected: FAIL — `db-pg.js` does not exist yet

**Step 3: Write `db-pg.js`**

```js
// backend/db-pg.js
// PostgreSQL connection pool + query/transaction helpers.
// Connects via DATABASE_URL env var.

const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
});

pool.on("error", (err) => {
  console.error("[db-pg] Unexpected pool error:", err.message);
});

module.exports = {
  /**
   * Run a single query. Returns { rows, rowCount, ... }.
   */
  query: (sql, params) => pool.query(sql, params),

  /**
   * Check out a client for manual multi-statement work.
   * Caller MUST call client.release() when done.
   */
  getClient: () => pool.connect(),

  /**
   * Run `fn(client)` inside BEGIN/COMMIT. Rolls back on error.
   * Returns whatever `fn` returns.
   */
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Shut down pool. Call on process exit.
   */
  end: () => pool.end(),

  /**
   * Expose pool for advanced usage (e.g., listen/notify).
   */
  pool,
};
```

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-connection.test.js`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/db-pg.js backend/tests/integration/pg-connection.test.js
git commit -m "feat: add db-pg.js — Postgres connection pool with transaction helper"
```

---

## Task 3: Create `schema-pg.sql` — Full Postgres DDL

**Files:**
- Create: `backend/schema-pg.sql`
- Reference: `backend/tests/helpers/seedSchema.js` (957 lines — the definitive table list)
- Reference: `backend/migrate74.js` (latest migration)

**Step 1: Write the failing test**

Create `backend/tests/integration/pg-schema.test.js`:

```js
const { describe, it, expect, beforeAll, afterAll } = require("vitest");
const db = require("../../db-pg");
const fs = require("fs");
const path = require("path");

const TEST_SCHEMA = "test_schema_" + Date.now();

describe("schema-pg.sql", () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await db.query(`SET search_path = '${TEST_SCHEMA}'`);
    const sql = fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8");
    await db.query(sql);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await db.end();
  });

  it("creates all core tables", async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [TEST_SCHEMA]
    );
    const tables = rows.map((r) => r.table_name);
    // Spot-check essential tables
    expect(tables).toContain("categories");
    expect(tables).toContain("products");
    expect(tables).toContain("sales");
    expect(tables).toContain("sale_items");
    expect(tables).toContain("employees");
    expect(tables).toContain("customers");
    expect(tables).toContain("outlets");
    expect(tables).toContain("cash_shifts");
    expect(tables).toContain("roles");
    expect(tables).toContain("role_permissions");
    expect(tables).toContain("company_profile");
    expect(tables.length).toBeGreaterThanOrEqual(40);
  });

  it("can insert and query a product", async () => {
    // Need a category and tax first
    await db.query(
      `INSERT INTO categories (name) VALUES ('General')`
    );
    await db.query(
      `INSERT INTO taxes (name, rate) VALUES ('Default', 0)`
    );
    await db.query(
      `INSERT INTO products (barcode, name, price, stock, category_id, tax_id)
       VALUES ('123456', 'Test Product', 10.00, 100, 1, 1)`
    );
    const { rows } = await db.query("SELECT * FROM products WHERE barcode = '123456'");
    expect(rows[0].name).toBe("Test Product");
    expect(Number(rows[0].price)).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-schema.test.js`
Expected: FAIL — `schema-pg.sql` does not exist yet

**Step 3: Create `schema-pg.sql`**

Convert every table from `seedSchema.js` (957 lines) to Postgres DDL. This is the largest single file in the migration. Key conversions for every table:

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `TEXT` timestamp columns → `TIMESTAMPTZ DEFAULT NOW()`
- `REAL` money columns → `NUMERIC(12,2)`
- `BOOLEAN DEFAULT 0` → `BOOLEAN DEFAULT FALSE`
- `datetime('now')` → `NOW()`
- `datetime('now','localtime')` → `NOW()` (everything UTC now)
- Remove `PRAGMA` statements
- `CREATE UNIQUE INDEX IF NOT EXISTS` works the same in Postgres

Reference `backend/tests/helpers/seedSchema.js` for the complete table list (lines 11-900+). Include all 43+ tables plus all indexes.

The file should be a single SQL script that can be run with `SET search_path = 'tenant_slug'; \i schema-pg.sql`.

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-schema.test.js`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add backend/schema-pg.sql backend/tests/integration/pg-schema.test.js
git commit -m "feat: add schema-pg.sql — complete Postgres DDL for all 43+ tables"
```

---

## Task 4: Create `master-db-pg.js` — Master DB (public schema)

**Files:**
- Create: `backend/master-db-pg.js`
- Reference: `backend/master-db.js` (current SQLite version, 114 lines)

**Step 1: Write the failing test**

Create `backend/tests/integration/pg-master-db.test.js`:

```js
const { describe, it, expect, beforeAll, afterAll } = require("vitest");
const db = require("../../db-pg");

describe("master-db-pg", () => {
  let masterDb;

  beforeAll(async () => {
    masterDb = require("../../master-db-pg");
    await masterDb.init(db);
  });

  afterAll(async () => {
    // Clean up test data
    await db.query("DELETE FROM tenants WHERE slug LIKE 'test_%'");
    await db.end();
  });

  it("creates master tables in public schema", async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('tenants', 'super_admins', 'tenant_audit_log', 'schema_migrations', 'tenant_refresh_tokens')
       ORDER BY table_name`
    );
    expect(rows.length).toBe(5);
  });

  it("inserts and queries a tenant", async () => {
    const slug = "test_" + Date.now();
    await masterDb.createTenant({
      slug,
      name: "Test Store",
      ownerEmail: "test@example.com",
      timezone: "UTC",
    });
    const tenant = await masterDb.getTenantBySlug(slug);
    expect(tenant.name).toBe("Test Store");
    expect(tenant.status).toBe("active");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-master-db.test.js`
Expected: FAIL — `master-db-pg.js` does not exist

**Step 3: Write `master-db-pg.js`**

Port `master-db.js` to Postgres. Key changes:
- No lazy init — receives pool reference from `db-pg.js`
- `init(db)` runs `CREATE TABLE IF NOT EXISTS` for all 5 master tables (in `public` schema)
- `createTenant({slug, name, ownerEmail, timezone})` — uses transaction to insert tenant + audit log atomically, returns tenant_id via `RETURNING id`
- `getTenantBySlug(slug)` — simple `SELECT`
- `getTenantById(id)` — simple `SELECT`
- Schema: same 5 tables as current `master-db.js` lines 44-100, converted to Postgres types

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-master-db.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/master-db-pg.js backend/tests/integration/pg-master-db.test.js
git commit -m "feat: add master-db-pg.js — tenant registry in public schema"
```

---

## Task 5: Create `tenant-db-pg.js` — Schema-per-tenant proxy

**Files:**
- Create: `backend/tenant-db-pg.js`
- Reference: `backend/tenant-db-proxy.js` (current SQLite proxy, 81 lines)
- Reference: `backend/tenant-db-manager.js` (current SQLite pool, 104 lines)

**Step 1: Write the failing test**

Create `backend/tests/integration/pg-tenant-db.test.js`:

```js
const { describe, it, expect, beforeAll, afterAll } = require("vitest");
const db = require("../../db-pg");
const fs = require("fs");
const path = require("path");

describe("tenant-db-pg schema isolation", () => {
  const SLUG_A = "test_tenant_a_" + Date.now();
  const SLUG_B = "test_tenant_b_" + Date.now();
  let tenantDb;

  beforeAll(async () => {
    tenantDb = require("../../tenant-db-pg");
    const schema = fs.readFileSync(path.join(__dirname, "../../schema-pg.sql"), "utf8");

    // Provision two test tenant schemas
    for (const slug of [SLUG_A, SLUG_B]) {
      await db.query(`CREATE SCHEMA IF NOT EXISTS tenant_${slug}`);
      const client = await db.getClient();
      try {
        await client.query(`SET search_path = 'tenant_${slug}'`);
        await client.query(schema);
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG_A} CASCADE`);
    await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG_B} CASCADE`);
    await db.end();
  });

  it("isolates data between tenant schemas via runWithTenant", async () => {
    // Insert into tenant A
    await tenantDb.runWithTenant(db, SLUG_A, async () => {
      const proxy = tenantDb.getProxy();
      await proxy.query(
        "INSERT INTO categories (name) VALUES ($1)", ["Tenant A Category"]
      );
    });

    // Insert into tenant B
    await tenantDb.runWithTenant(db, SLUG_B, async () => {
      const proxy = tenantDb.getProxy();
      await proxy.query(
        "INSERT INTO categories (name) VALUES ($1)", ["Tenant B Category"]
      );
    });

    // Verify isolation: tenant A should not see tenant B's data
    await tenantDb.runWithTenant(db, SLUG_A, async () => {
      const proxy = tenantDb.getProxy();
      const { rows } = await proxy.query("SELECT name FROM categories");
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("Tenant A Category");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-tenant-db.test.js`
Expected: FAIL — `tenant-db-pg.js` does not exist

**Step 3: Write `tenant-db-pg.js`**

Key design:
- Uses `AsyncLocalStorage` (same pattern as current `tenant-db-proxy.js`)
- `runWithTenant(db, slug, fn)` — checks out a client from pool, sets `SET search_path = 'tenant_<slug>'`, stores client in ALS, runs `fn`, releases client
- `getProxy()` — returns object from ALS that has `query(sql, params)` and `transaction(fn)` methods, all scoped to the tenant schema
- No per-tenant pool — single shared pool, schema switching per-request
- Replaces both `tenant-db-manager.js` and `tenant-db-proxy.js`

```js
// backend/tenant-db-pg.js
const { AsyncLocalStorage } = require("async_hooks");
const asyncStore = new AsyncLocalStorage();

function getStore() {
  const store = asyncStore.getStore();
  if (!store || !store.client) {
    throw new Error("[tenant-db-pg] No tenant client in async context");
  }
  return store;
}

function getProxy() {
  const store = getStore();
  return {
    query: (sql, params) => store.client.query(sql, params),
    transaction: async (fn) => {
      await store.client.query("BEGIN");
      try {
        const result = await fn(store.client);
        await store.client.query("COMMIT");
        return result;
      } catch (err) {
        await store.client.query("ROLLBACK");
        throw err;
      }
    },
  };
}

async function runWithTenant(db, slug, fn) {
  const client = await db.getClient();
  try {
    await client.query(`SET search_path = 'tenant_${slug}'`);
    return await asyncStore.run({ client, slug }, fn);
  } finally {
    // Reset search_path before returning to pool
    await client.query("SET search_path = 'public'").catch(() => {});
    client.release();
  }
}

module.exports = { asyncStore, getProxy, getStore, runWithTenant };
```

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-tenant-db.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/tenant-db-pg.js backend/tests/integration/pg-tenant-db.test.js
git commit -m "feat: add tenant-db-pg.js — schema-per-tenant proxy via AsyncLocalStorage"
```

---

## Task 6: Create `tenant-provisioner-pg.js` — Schema-based provisioning

**Files:**
- Create: `backend/tenant-provisioner-pg.js`
- Reference: `backend/tenant-provisioner.js` (current SQLite version, 290 lines)

**Step 1: Write the failing test**

Add to `backend/tests/integration/pg-master-db.test.js` (extend):

```js
it("provisions a new tenant schema with seed data", async () => {
  const provisioner = require("../../tenant-provisioner-pg");
  const slug = "test_prov_" + Date.now();
  const result = await provisioner.provision(db, {
    slug,
    name: "Provisioned Store",
    ownerEmail: "owner@example.com",
    timezone: "Asia/Karachi",
    pin: "1234",
  });
  expect(result.tenantId).toBeGreaterThan(0);
  expect(result.employeeId).toBeGreaterThan(0);

  // Verify schema exists with data
  const { rows } = await db.query(
    `SELECT company_name FROM tenant_${slug}.company_profile WHERE id = 1`
  );
  expect(rows[0].company_name).toBe("Provisioned Store");

  // Cleanup
  await db.query(`DROP SCHEMA IF EXISTS tenant_${slug} CASCADE`);
  await db.query("DELETE FROM tenants WHERE slug = $1", [slug]);
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-master-db.test.js`
Expected: FAIL — `tenant-provisioner-pg.js` does not exist

**Step 3: Write `tenant-provisioner-pg.js`**

Port `tenant-provisioner.js` to Postgres. Key changes:
- `provision(db, { slug, name, ownerEmail, timezone, pin })` — all in one function
- Step 1: `CREATE SCHEMA IF NOT EXISTS tenant_<slug>`
- Step 2: Run `schema-pg.sql` scoped to the new schema
- Step 3: Seed data (outlet, admin role, permissions, employee with bcrypt PIN, company_profile, default tax)
- Step 4: Insert into `public.tenants` + `public.tenant_audit_log` (transaction)
- No filesystem operations — no directories, no SQLite files
- Returns `{ tenantId, employeeId, outletId }`
- Also export a CLI `main()` for `node tenant-provisioner-pg.js --slug ... --name ... --pin ...`

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-master-db.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/tenant-provisioner-pg.js
git commit -m "feat: add tenant-provisioner-pg.js — schema-based tenant provisioning"
```

---

## Task 7: Create test helpers for Postgres — `createTestApp-pg.js`

**Files:**
- Create: `backend/tests/helpers/createTestApp-pg.js`
- Create: `backend/tests/helpers/seedSchema-pg.js`
- Reference: `backend/tests/helpers/createTestApp.js` (270 lines)
- Reference: `backend/tests/helpers/seedSchema.js` (957 lines)
- Reference: `backend/tests/helpers/seedData.js`

**Step 1: Write `seedSchema-pg.js`**

This wraps `schema-pg.sql` for test use:

```js
// backend/tests/helpers/seedSchema-pg.js
const fs = require("fs");
const path = require("path");
const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "../../schema-pg.sql"), "utf8"
);

async function seedSchema(client) {
  await client.query(SCHEMA_SQL);
}

module.exports = { seedSchema };
```

**Step 2: Write `createTestApp-pg.js`**

Port `createTestApp.js` to Postgres. Key changes:
- Creates a unique test schema per call: `test_<random>`
- Uses `db-pg.js` pool with `SET search_path` per test schema
- Builds the same `deps` object but with a Postgres-backed `db` proxy
- `db.query(sql, params)` replaces `db.run/get/all`
- Exports `createTestApp`, `closeTestApp` (drops schema), `dbQuery`, `dbQueryOne`
- Same stubs for Shopify, same middleware setup
- Same `PERMISSION_RULES`, `DEFAULT_FEATURE_FLAGS`

The `deps.db` object must expose the same interface route files will use after conversion:
```js
deps.db = {
  query: (sql, params) => client.query(sql, params),
  transaction: async (fn) => { /* BEGIN/fn/COMMIT or ROLLBACK */ },
};
```

**Step 3: Write a smoke test**

Create `backend/tests/integration/pg-test-app.test.js`:

```js
const { describe, it, expect, afterAll } = require("vitest");
const { createTestApp, closeTestApp } = require("../helpers/createTestApp-pg");

describe("Postgres test app", () => {
  let app, db, cleanup;

  it("creates test app and queries brands", async () => {
    ({ app, db, cleanup } = await createTestApp());
    // Seed a brand
    await db.query("INSERT INTO brands (name) VALUES ($1)", ["TestBrand"]);
    const { rows } = await db.query("SELECT * FROM brands");
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("TestBrand");
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });
});
```

**Step 4: Run test**

Run: `cd backend && npx vitest run tests/integration/pg-test-app.test.js`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/tests/helpers/createTestApp-pg.js backend/tests/helpers/seedSchema-pg.js backend/tests/integration/pg-test-app.test.js
git commit -m "feat: add Postgres test helpers — createTestApp-pg + seedSchema-pg"
```

---

## Task 8: Convert first route file — `brands.js` (template for all others)

**Files:**
- Modify: `backend/routes/brands.js` (61 lines — smallest CRUD route, perfect template)

This is the **template conversion** that establishes the pattern for all subsequent route files. Every route file follows this same transformation.

**Step 1: Write the failing test**

Create `backend/tests/integration/pg-brands.test.js`:

```js
const { describe, it, expect, beforeAll, afterAll } = require("vitest");
const request = require("supertest");
const { createTestApp, closeTestApp } = require("../helpers/createTestApp-pg");

describe("brands API (Postgres)", () => {
  let app, db, cleanup;

  beforeAll(async () => {
    ({ app, db, cleanup } = await createTestApp());
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("GET /api/brands returns empty array", async () => {
    const res = await request(app)
      .get("/api/brands")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
    expect(res.body.brands).toEqual([]);
  });

  it("POST /api/brands creates a brand", async () => {
    const res = await request(app)
      .post("/api/brands")
      .set("x-employee-id", "1")
      .send({ name: "Nike", description: "Sportswear" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.name).toBe("Nike");
  });

  it("PUT /api/brands/:id updates a brand", async () => {
    const res = await request(app)
      .put("/api/brands/1")
      .set("x-employee-id", "1")
      .send({ name: "Nike Updated" });
    expect(res.status).toBe(200);
  });

  it("PUT /api/brands/:id returns 404 for missing brand", async () => {
    const res = await request(app)
      .put("/api/brands/9999")
      .set("x-employee-id", "1")
      .send({ name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/brands/:id deletes a brand", async () => {
    const res = await request(app)
      .delete("/api/brands/1")
      .set("x-employee-id", "1");
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/integration/pg-brands.test.js`
Expected: FAIL — `brands.js` still uses sqlite3 callbacks

**Step 3: Convert `brands.js` to Postgres async/await**

Before (SQLite, 61 lines):
```js
module.exports = function registerBrandRoutes(app, deps) {
  const { db, requirePerm } = deps;
  app.post("/api/brands", requirePerm("manage_inventory"), (req, res) => {
    db.run("INSERT INTO brands (name, description) VALUES (?, ?)",
      [name, description], function (err) {
        if (err) { ... }
        res.json({ id: this.lastID, name, description });
      });
  });
};
```

After (Postgres):
```js
module.exports = function registerBrandRoutes(app, deps) {
  const { db, requirePerm } = deps;

  app.get("/api/brands", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM brands ORDER BY name ASC");
      res.json({ brands: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/brands", requirePerm("manage_inventory"), async (req, res) => {
    const { name, description } = req.body;
    try {
      const { rows } = await db.query(
        "INSERT INTO brands (name, description) VALUES ($1, $2) RETURNING id",
        [name, description]
      );
      res.json({ id: rows[0].id, name, description });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Brand name must be unique" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/brands/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    try {
      const { rowCount } = await db.query(
        "UPDATE brands SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3",
        [name, description, id]
      );
      if (rowCount === 0) return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand updated successfully" });
    } catch (err) {
      if (err.constraint) {
        return res.status(400).json({ error: "Brand name must be unique" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/brands/:id", requirePerm("manage_inventory"), async (req, res) => {
    const { id } = req.params;
    try {
      const { rowCount } = await db.query("DELETE FROM brands WHERE id = $1", [id]);
      if (rowCount === 0) return res.status(404).json({ error: "Brand not found" });
      res.json({ message: "Brand deleted" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
```

**Conversion checklist (apply to EVERY route file):**
1. `(req, res) =>` → `async (req, res) =>`
2. `db.run(sql, params, function(err) { ... })` → `const { rows, rowCount } = await db.query(sql, params)`
3. `db.get(sql, params, (err, row) => { ... })` → `const { rows: [row] } = await db.query(sql, params)`
4. `db.all(sql, params, (err, rows) => { ... })` → `const { rows } = await db.query(sql, params)`
5. `this.lastID` → add `RETURNING id` to INSERT, read `rows[0].id`
6. `this.changes` → read `rowCount`
7. `?` placeholders → `$1, $2, $3, ...` (numbered)
8. `LIKE` → `ILIKE` (for search filters)
9. `datetime('now')` → `NOW()`
10. `db.serialize(() => { db.run("BEGIN")... })` → `await db.transaction(async (client) => { ... })`
11. Error: `err.message.includes("UNIQUE constraint")` → `err.constraint` (Postgres constraint violation)
12. Wrap handler body in `try { ... } catch (err) { res.status(500).json({ error: err.message }); }`

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/integration/pg-brands.test.js`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/routes/brands.js backend/tests/integration/pg-brands.test.js
git commit -m "feat: convert brands.js to Postgres async/await"
```

---

## Task 9–49: Convert remaining route files

Each task follows the **exact same pattern as Task 8**. Convert route file + write/update its Postgres test.

Order by priority and dependency (core routes first, then reports, then integration):

### Batch 1 — Core CRUD (smallest, least complex)

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 9 | `routes/taxes.js` | ~80 | Simple CRUD, same as brands |
| 10 | `routes/suppliers.js` | ~130 | CRUD + delete guard (`this.changes`) |
| 11 | `routes/receipt-templates.js` | ~150 | CRUD + action_history INSERT |
| 12 | `routes/parked-sales.js` | ~100 | CRUD + `datetime('now','localtime')` |
| 13 | `routes/shifts.js` | ~290 | `db.serialize`, `this.lastID`, `datetime('now')` |
| 14 | `routes/roles.js` | ~80 | Simple CRUD |
| 15 | `routes/customer-display.js` | ~60 | In-memory Map, minimal DB |

### Batch 2 — Medium complexity

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 16 | `routes/customers.js` | 214 | CRUD + soft delete (`deleted_at`) |
| 17 | `routes/employees.js` | 350 | CRUD + bcrypt + `deleted_at` + token revocation |
| 18 | `routes/categories.js` | 415 | Recursive tree queries, `db.serialize` |
| 19 | `routes/promotions.js` | 234 | CRUD + date queries |
| 20 | `routes/attribute-sets.js` | 249 | `db.prepare()` / `stmt.run()` / `stmt.finalize()` |
| 21 | `routes/returns.js` | 264 | Transaction + `this.lastID` + stock adjustment |
| 22 | `routes/inventory.js` | 369 | Transfers + adjustments + `db.serialize` transactions |

### Batch 3 — Complex routes

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 23 | `routes/auth.js` | 479 | JWT + bcrypt + context bootstrap + `INSERT OR IGNORE` |
| 24 | `routes/setup.js` | 244 | First-run wizard + `db.serialize` transaction |
| 25 | `routes/grn.js` | 454 | GRN + supplier payables + `this.lastID` chains |
| 26 | `routes/purchase-orders.js` | 572 | PO CRUD + approval + credit limit + templates |
| 27 | `routes/attendance.js` | 672 | `datetime('now','localtime')` heavy + session queries |
| 28 | `routes/sales.js` | 677 | Most complex — transactions, invoice gen, stock deduction |
| 29 | `routes/products.js` | 1036 | Largest — CRUD + variants + bulk import + `json_group_array` |
| 30 | `routes/orders.js` | 995 | Shopify orders + `sqlite3` direct import + multer |
| 31 | `routes/barcode-expenses.js` | 977 | Backup/restore (fs.copyFileSync → pg_dump) + barcodes + expenses |
| 32 | `routes/admin.js` | 577 | Uses master DB directly + tenant CRUD + `sqlite3` import |

### Batch 4 — Reports (read-heavy, many date functions)

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 33 | `routes/reports/helpers.js` | 169 | Shared SQL builders — `toUtcStart/toUtcEnd` usage |
| 34 | `routes/reports/index.js` | 34 | Entry point — wires sub-modules |
| 35 | `routes/reports/shifts.js` | 218 | Shift reports + `shift_id` FK queries |
| 36 | `routes/reports/staff.js` | 224 | Labor performance + attendance queries |
| 37 | `routes/reports/purchasing.js` | 549 | Procurement reports + date grouping |
| 38 | `routes/reports/dashboard.js` | 721 | `strftime`, `julianday`, complex aggregations |
| 39 | `routes/reports/analytics.js` | 816 | `strftime('%w')`, `strftime('%H')`, heatmaps |
| 40 | `routes/reports/governance.js` | 843 | Scheduled reports + email digest |
| 41 | `routes/reports/finance.js` | 1149 | P&L + tax reports + date grouping |
| 42 | `routes/reports/sales.js` | 1429 | Largest report file — many `strftime`, `date()` |
| 43 | `routes/reports/inventory.js` | 1495 | Shrinkage + stock reports + `julianday` |

### Batch 5 — Shopify integration

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 44 | `routes/shopify/index.js` | ~30 | Entry point |
| 45 | `routes/shopify/config.js` | ~150 | CRUD + encrypt/decrypt |
| 46 | `routes/shopify/health.js` | ~200 | Status + validation |
| 47 | `routes/shopify/sync.js` | ~300 | Events + retry + push inventory |
| 48 | `routes/shopify/orders.js` | ~250 | Order pull |
| 49 | `routes/shopify/webhooks.js` | ~200 | HMAC verification + idempotency |
| 50 | `routes/shopify/import.js` | ~300 | Product import |
| 51 | `routes/shopify/mappings.js` | ~400 | Product/location mappings |

### Batch 6 — Tier 4 modules

| Task | File | Lines | Key patterns |
|------|------|-------|-------------|
| 52 | `routes/tier4/index.js` | 21 | Entry point |
| 53 | `routes/tier4/notifications.js` | 76 | Simple CRUD |
| 54 | `routes/tier4/approvals.js` | ~200 | Approval workflow |
| 55 | `routes/tier4/company-profile.js` | ~300 | Profile CRUD + multer |
| 56 | `routes/tier4/accounting.js` | ~400 | Journal entries + P&L |
| 57 | `routes/tier4/hr.js` | 519 | Leave + payroll + `strftime` |
| 58 | `routes/tier4/crm.js` | 849 | CRM + quotations + email |

For each task above:
1. Read the route file
2. Apply the **conversion checklist from Task 8 Step 3**
3. Convert all `?` → `$1, $2, ...` (count carefully — off-by-one breaks everything)
4. Convert all SQLite-specific SQL (see design doc reference table)
5. Write/port the corresponding Postgres test
6. Run the test, fix issues
7. Commit

---

## Task 59: Convert `registerAllRoutes.js` + `index.js`

**Files:**
- Modify: `backend/routes/registerAllRoutes.js` (413 lines)
- Modify: `backend/index.js` (~749 lines)

**Step 1: Update `registerAllRoutes.js`**

Key changes:
- Remove `sqlite3` from deps
- Replace `deps.sqlite3` references with `deps.db` (Postgres pool)
- Remove any `PRAGMA` calls
- Feature flags query: `db.all(sql, params, callback)` → `await db.query(sql, params)`
- `loadEmployeePerms` middleware: convert callback to async
- `loadCompanyProfile` middleware: convert callback to async

**Step 2: Update `index.js`**

Key changes:
- Replace `require("./db")` with `require("./db-pg")`
- Replace `require("sqlite3")` — remove entirely
- Replace `require("./tenant-db-proxy")` with `require("./tenant-db-pg")`
- Replace `require("./tenant-db-manager")` — remove entirely
- Replace `require("./master-db")` with `require("./master-db-pg")`
- Multi-tenant middleware: `resolveTenant` uses `tenant-db-pg.runWithTenant()` instead of opening SQLite file
- `loadTenantAndPerms` middleware: check JWT, resolve tenant from master-db-pg
- Remove `DB_PATH`, `DATA_DIR` SQLite file references
- Remove `start.sh` symlink logic references
- Add `db.end()` on process shutdown

**Step 3: Run existing Postgres tests to verify nothing broke**

Run: `cd backend && npx vitest run tests/integration/pg-*.test.js`
Expected: All PASS

**Step 4: Commit**

```bash
git add backend/routes/registerAllRoutes.js backend/index.js
git commit -m "feat: update index.js + registerAllRoutes.js for Postgres"
```

---

## Task 60: Convert test infrastructure — port all 37 test suites

**Files:**
- Modify: All 37 files in `backend/tests/integration/*.test.js`

For each test file:
1. Replace `require("../helpers/createTestApp")` with `require("../helpers/createTestApp-pg")`
2. Replace `dbAll(db, sql, params)` with `db.query(sql, params)` + `.rows`
3. Replace `dbGet(db, sql, params)` with `db.query(sql, params)` + `.rows[0]`
4. Replace `dbRun(db, sql, params)` with `db.query(sql, params)`
5. Replace `?` placeholders in test SQL with `$1, $2, ...`
6. Replace `closeDb(db)` with `cleanup()` (from createTestApp-pg)
7. Run each test file individually, fix failures

Order: Start with simplest test files (health.test.js, smoke-gate.test.js), then CRUD tests, then complex ones.

**Run all tests after conversion:**

Run: `cd backend && npx vitest run`
Target: All 395 tests pass (or equivalent count in Postgres)

**Commit after each batch of 5-8 test files.**

---

## Task 61: Update `package.json` — remove `sqlite3`, clean up scripts

**Files:**
- Modify: `backend/package.json`

**Step 1: Remove sqlite3 dependency**

Run: `cd backend && npm uninstall sqlite3`

**Step 2: Update scripts**

No changes needed to test/start scripts — they still work with Postgres.

**Step 3: Verify**

Run: `cd backend && npm start` (should connect to local Postgres)
Run: `cd backend && npx vitest run` (all tests pass)

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: remove sqlite3 dependency, pg is the only DB driver"
```

---

## Task 62: Delete old SQLite files

**Files to delete:**
- `backend/db.js`
- `backend/master-db.js`
- `backend/tenant-db-manager.js`
- `backend/tenant-db-proxy.js`
- `backend/schema-full.js`
- `backend/migrate.js` through `backend/migrate74.js` (all 74 migration files)
- `backend/run_migrations.js`
- `backend/tenant-migrate.js`
- `backend/start.sh` (or update to remove symlink logic)
- `backend/tests/helpers/createTestApp.js` (replaced by pg version)
- `backend/tests/helpers/seedSchema.js` (replaced by pg version)

**Step 1: Delete files**

```bash
cd backend
git rm db.js master-db.js tenant-db-manager.js tenant-db-proxy.js schema-full.js
git rm run_migrations.js tenant-migrate.js
git rm migrate.js migrate2.js migrate3.js migrate4.js migrate5.js migrate6.js migrate7.js migrate8.js migrate9.js migrate10.js migrate11.js migrate12.js migrate13.js migrate14.js migrate15.js migrate16.js migrate17.js migrate18.js migrate19.js migrate20.js migrate21.js migrate22.js migrate23.js migrate24.js migrate25.js migrate26.js migrate27.js migrate28.js migrate29.js migrate30.js migrate31.js migrate32.js migrate33.js migrate34.js migrate35.js migrate36.js migrate37.js migrate38.js migrate39.js migrate40.js migrate41.js migrate42.js migrate43.js migrate44.js migrate45.js migrate46.js migrate47.js migrate48.js migrate49.js migrate50.js migrate51.js migrate52.js migrate53.js migrate54.js migrate55.js migrate56.js migrate57.js migrate58.js migrate59.js migrate60.js migrate61.js migrate62.js migrate63.js migrate64.js migrate65.js migrate66.js migrate67.js migrate68.js migrate69.js migrate70.js migrate71.js migrate72.js migrate73.js migrate74.js
git rm tests/helpers/createTestApp.js tests/helpers/seedSchema.js
```

**Step 2: Verify nothing references deleted files**

Run: `grep -r "require.*db\.js\|require.*master-db\|require.*tenant-db-manager\|require.*tenant-db-proxy\|require.*schema-full\|require.*migrate" backend/ --include="*.js" --exclude-dir=node_modules`

Fix any remaining references.

**Step 3: Run tests**

Run: `cd backend && npx vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove all SQLite files — 74 migrations, old DB layer, old test helpers"
```

---

## Task 63: Supabase setup + Railway deployment

**Files:**
- Modify: `backend/.env.example`
- Modify: Railway environment variables

**Step 1: Create Supabase project**

1. Go to supabase.com, create a free project
2. Copy the connection string from Settings → Database → Connection String (URI)
3. Format: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`

**Step 2: Initialize master schema on Supabase**

Run locally:
```bash
DATABASE_URL="postgresql://..." node -e "
  const masterDb = require('./master-db-pg');
  const db = require('./db-pg');
  masterDb.init(db).then(() => { console.log('Master schema created'); db.end(); });
"
```

**Step 3: Provision your first tenant**

```bash
DATABASE_URL="postgresql://..." node tenant-provisioner-pg.js --slug main-store --name "Main Store" --timezone "Asia/Karachi" --pin 2580 --email admin@example.com
```

**Step 4: Update Railway env vars**

```
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
MULTI_TENANT=1
NODE_ENV=production
```

Remove: `DATA_DIR`, `SQLITE_*` vars (if any)

**Step 5: Deploy**

Push branch to Railway, verify backend starts and connects to Supabase.

**Step 6: Commit**

```bash
git add backend/.env.example
git commit -m "chore: update env config for Supabase PostgreSQL"
```

---

## Task 64: Update CLAUDE.md + MEMORY.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: Memory files

Update all documentation to reflect:
- Database is now PostgreSQL (Supabase), not SQLite
- Schema file is `backend/schema-pg.sql` (not migrate74.js)
- Connection via `DATABASE_URL` env var
- Multi-tenant via schema-per-tenant
- No more migration files — single schema file + `migrate-pg.js` for future changes
- Test infrastructure uses real Postgres (Docker local, Supabase CI)
- `db.query(sql, params)` is the DB API (not `db.run/get/all`)
- `RETURNING id` for inserts (not `this.lastID`)
- `result.rowCount` for updates/deletes (not `this.changes`)
- `ILIKE` for searches (not `LIKE`)
- All timestamps are `TIMESTAMPTZ` stored as UTC
- No more dual UTC/LOCAL timestamp system

**Commit:**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for PostgreSQL architecture"
```

---

## Summary

| Phase | Tasks | What |
|-------|-------|------|
| **Foundation** | 1–7 | New DB layer, schema, master DB, tenant proxy, provisioner, test helpers |
| **Route conversion** | 8–58 | All 51 route files converted (SQL dialect + async/await) |
| **Wiring** | 59 | `index.js` + `registerAllRoutes.js` updated |
| **Tests** | 60 | All 37 test suites ported to Postgres |
| **Cleanup** | 61–62 | Remove `sqlite3`, delete 80+ old files |
| **Deploy** | 63 | Supabase setup, Railway config, first tenant |
| **Docs** | 64 | CLAUDE.md + memory updated |

**Total: 64 tasks, each independently committable and testable.**
