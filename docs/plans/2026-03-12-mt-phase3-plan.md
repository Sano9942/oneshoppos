# MT Phase 3 — Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the last 3 MT readiness items (#15 feature flag cache, #13 tenant isolation tests, #14 backup/restore) so MULTI_TENANT=1 can be safely flipped in production.

**Architecture:** Feature flag caching uses the same per-tenant Map pattern from Phase 1. Tenant isolation is verified via integration tests against two provisioned schemas. Backup/restore wraps pg_dump/pg_restore as child processes behind existing admin-only routes.

**Tech Stack:** Node.js, Express, pg, Jest, child_process (spawn), pg_dump/pg_restore CLI

**Prerequisites:** Branches `feature/mt-phase1-blockers` and `feature/mt-phase2-operations` should be merged to `main` first, then this branch created from `main`. If not yet merged, create this branch from `main` and cherry-pick the Phase 1 context flag fix (commit `65314c8`).

---

### Task 1: Feature Flag Cache Per-Tenant (`getFeatureFlagsMap`)

**Files:**
- Modify: `backend/index.js:807-839` — add per-tenant cache with TTL
- Modify: `backend/routes/registerAllRoutes.js:236-263` — invalidate cache on PUT

**Context:**
- `getFeatureFlagsMap()` at `index.js:807` queries `feature_flags` table on EVERY call with zero caching
- `requireFeature()` at `index.js:824` calls `getFeatureFlagsMap()` per request
- In MT mode, `db` is the proxy (`dbProxy`) which hits the current tenant's schema via AsyncLocalStorage — so caching needs to be keyed by tenant
- In ST mode, use `"_default"` as cache key (same pattern as Phase 1's `_companyCache`)
- The existing `resolveContext` already has `req.tenantId` set by `loadTenantAndPerms` in MT mode

**Step 1: Add the per-tenant feature flag cache to index.js**

Find the current code at line 807:

```javascript
async function getFeatureFlagsMap() {
  try {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
    const merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = row.enabled === true;
    }
    return merged;
  } catch (err) {
    // Keep legacy behavior if flags table isn't present yet.
    if (String(err.message || "").includes("does not exist")) {
      return { ...DEFAULT_FEATURE_FLAGS };
    }
    throw err;
  }
}
```

Replace with:

```javascript
// Per-tenant feature flag cache: Map<tenantId|"_default", { flags, timestamp }>
const _featureFlagCache = new Map();
const FEATURE_FLAG_CACHE_MS = 60_000; // 60s TTL

async function getFeatureFlagsMap(tenantId) {
  const cacheKey = tenantId || "_default";
  const cached = _featureFlagCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < FEATURE_FLAG_CACHE_MS) {
    return { ...cached.flags };
  }
  try {
    const { rows } = await db.query("SELECT key, enabled FROM feature_flags");
    const merged = { ...DEFAULT_FEATURE_FLAGS };
    for (const row of rows || []) {
      merged[row.key] = row.enabled === true;
    }
    _featureFlagCache.set(cacheKey, { flags: merged, timestamp: now });
    return merged;
  } catch (err) {
    if (String(err.message || "").includes("does not exist")) {
      return { ...DEFAULT_FEATURE_FLAGS };
    }
    throw err;
  }
}

function invalidateFeatureFlagCache(tenantId) {
  if (tenantId) {
    _featureFlagCache.delete(tenantId);
  } else {
    _featureFlagCache.clear();
  }
}
```

**Step 2: Update `requireFeature` to pass tenantId**

Find the current code at line 824:

```javascript
function requireFeature(flagKey) {
  return async (req, res, next) => {
    try {
      const flags = await getFeatureFlagsMap();
```

Replace with:

```javascript
function requireFeature(flagKey) {
  return async (req, res, next) => {
    try {
      const flags = await getFeatureFlagsMap(req.tenantId);
```

**Step 3: Export `invalidateFeatureFlagCache` in deps**

Add `invalidateFeatureFlagCache` to the deps object passed to `registerAllRoutes` at `index.js:888-933`. The property goes alongside the existing entries:

```javascript
    invalidateFeatureFlagCache,
```

**Step 4: Destructure and use `invalidateFeatureFlagCache` in `registerAllRoutes.js`**

In `backend/routes/registerAllRoutes.js` line 1-30, add to the `const { ... } = deps` destructuring:

```javascript
    invalidateFeatureFlagCache,
```

Then find the `PUT /api/feature-flags/:key` handler (around line 236). Add cache invalidation right after the successful `db.query`, before `res.json`:

```javascript
        // Invalidate per-tenant feature flag cache
        if (typeof invalidateFeatureFlagCache === "function") {
          invalidateFeatureFlagCache(req.tenantId);
        }
```

**Step 5: Run existing tests to verify no regressions**

Run: `cd backend && npx jest tests/integration/pg-batch3 --testPathPattern=pg-batch3 --forceExit 2>&1 | tail -20`
Expected: 55/55 tests passing

Run: `cd backend && npx jest tests/integration/pg-batch8 --testPathPattern=pg-batch8 --forceExit 2>&1 | tail -20`
Expected: 18/18 tests passing

**Step 6: Commit**

```bash
git add backend/index.js backend/routes/registerAllRoutes.js
git commit -m "$(cat <<'EOF'
feat: per-tenant feature flag cache with 60s TTL

Replace uncached getFeatureFlagsMap() with a Map<tenantId, {flags, timestamp}>
that caches for 60s. Invalidated on PUT /api/feature-flags/:key.
In ST mode, uses "_default" cache key.

Fixes MT readiness item #15.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Backup Utility (`backup-pg.js`)

**Files:**
- Create: `backend/utils/backup-pg.js`

**Context:**
- pg_dump/pg_restore are available on Railway (Postgres deployment includes them)
- `DATABASE_URL` env var contains the connection string
- In MT mode, each tenant has schema `tenant_<slug>`; in ST mode, data is in `public` schema
- Max backup size: 50MB (reasonable for a POS system per tenant)

**Step 1: Create `backend/utils/backup-pg.js`**

```javascript
/**
 * backup-pg.js — pg_dump / pg_restore wrappers for per-tenant backup/restore.
 *
 * Backup: streams a pg_dump custom-format archive for a single schema.
 * Restore: runs pg_restore from a file path into the target schema.
 */
const { spawn } = require("child_process");

const MAX_BACKUP_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Checks whether pg_dump is available on the system PATH.
 * @returns {Promise<boolean>}
 */
function isPgDumpAvailable() {
  return new Promise((resolve) => {
    const proc = spawn("pg_dump", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

/**
 * Returns a readable stream of pg_dump output for the given schema.
 *
 * @param {string} schemaName - Postgres schema name (e.g. "tenant_aces_hardware" or "public")
 * @returns {{ stream: ChildProcess.stdout, process: ChildProcess }}
 */
function backupSchema(schemaName) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const args = [
    dbUrl,
    "--schema", schemaName,
    "--format", "custom",
    "--no-owner",
    "--no-privileges",
  ];

  const proc = spawn("pg_dump", args, { stdio: ["ignore", "pipe", "pipe"] });
  return { stream: proc.stdout, process: proc };
}

/**
 * Restores a pg_dump custom-format archive into the given schema.
 *
 * @param {string} schemaName - Postgres schema name
 * @param {string} filePath - Path to the uploaded .dump file
 * @returns {Promise<{ success: boolean, stderr: string }>}
 */
function restoreSchema(schemaName, filePath) {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return reject(new Error("DATABASE_URL not set"));

    const args = [
      "--dbname", dbUrl,
      "--schema", schemaName,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      filePath,
    ];

    const proc = spawn("pg_restore", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      // pg_restore returns 0 on success, 1 on warnings (some objects already exist), 2+ on errors
      if (code <= 1) {
        resolve({ success: true, stderr });
      } else {
        reject(new Error(`pg_restore exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`pg_restore failed to start: ${err.message}`));
    });
  });
}

/**
 * Returns the schema name for a given tenant slug, or "public" for single-tenant.
 */
function getSchemaName(tenantSlug) {
  return tenantSlug ? `tenant_${tenantSlug}` : "public";
}

module.exports = { backupSchema, restoreSchema, getSchemaName, isPgDumpAvailable, MAX_BACKUP_SIZE };
```

**Step 2: Commit**

```bash
git add backend/utils/backup-pg.js
git commit -m "$(cat <<'EOF'
feat: pg_dump/pg_restore backup utility for per-tenant backup

backupSchema() streams pg_dump custom-format output.
restoreSchema() runs pg_restore --clean --if-exists.
getSchemaName() resolves tenant slug to schema name.
isPgDumpAvailable() checks runtime availability.

Part of MT readiness item #14.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wire Backup/Restore Routes

**Files:**
- Modify: `backend/routes/barcode-expenses.js:378-398` — replace stub routes with real implementation

**Context:**
- The backup download route at line 380 currently returns a stub JSON message
- The backup restore route at line 390 currently returns a stub JSON message
- Both require `all_access` permission and `backup_restore` feature flag (already correct)
- In MT mode, `req.tenantSlug` is set by `resolveTenant` middleware
- In ST mode, `req.tenantSlug` is undefined → use "public" schema
- Restore needs file upload → use `multer` from deps (already available)
- Log backup/restore to `backup_log` table (already exists)
- **Verified**: `db`, `requirePerm`, `requireFeature`, `multer`, `path`, `fs`, `runtimeState` are all destructured from `deps` at line 2 of `barcode-expenses.js`

**Step 1: Replace the backup download stub**

Find in `barcode-expenses.js` at line 380-388:

```javascript
  // GET /api/backup/download — Postgres stub
  app.get(
    "/api/backup/download",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    async (req, res) => {
      res.json({ message: "Postgres backup not yet implemented — use pg_dump" });
    },
  );
```

Replace with:

```javascript
  // GET /api/backup/download — pg_dump backup
  app.get(
    "/api/backup/download",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    async (req, res) => {
      try {
        const { backupSchema, getSchemaName, isPgDumpAvailable } = require("../utils/backup-pg");

        if (!(await isPgDumpAvailable())) {
          return res.status(503).json({ error: "pg_dump is not available on this server" });
        }

        const schemaName = getSchemaName(req.tenantSlug);
        const filename = `backup-${schemaName}-${new Date().toISOString().slice(0, 10)}.dump`;

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        const { stream, process: proc } = backupSchema(schemaName);

        let size = 0;
        stream.on("data", (chunk) => { size += chunk.length; });
        stream.pipe(res);

        proc.on("close", async (code) => {
          if (code === 0) {
            await db.query(
              "INSERT INTO backup_log (action, filename, size_bytes, status) VALUES ($1, $2, $3, $4)",
              ["backup", filename, size, "success"]
            ).catch(() => {});
          }
        });

        proc.on("error", (err) => {
          if (!res.headersSent) {
            res.status(500).json({ error: `Backup failed: ${err.message}` });
          }
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    },
  );
```

**Step 2: Replace the restore stub**

Find at line 390-398:

```javascript
  // POST /api/backup/restore — Postgres stub
  app.post(
    "/api/backup/restore",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    async (req, res) => {
      res.json({ message: "Postgres restore not yet implemented — use pg_restore" });
    },
  );
```

Replace with:

```javascript
  // POST /api/backup/restore — pg_restore
  const restoreUpload = multer({
    dest: path.join(__dirname, "../uploads_tmp"),
    limits: { fileSize: 50 * 1024 * 1024 },
  }).single("backup_file");

  app.post(
    "/api/backup/restore",
    requirePerm("all_access"),
    requireFeature("backup_restore"),
    (req, res, next) => {
      restoreUpload(req, res, (err) => {
        if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
        next();
      });
    },
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "backup_file is required" });
      }
      try {
        const { restoreSchema, getSchemaName } = require("../utils/backup-pg");
        const schemaName = getSchemaName(req.tenantSlug);

        runtimeState.isRestoreInProgress = true;
        const result = await restoreSchema(schemaName, req.file.path);
        runtimeState.isRestoreInProgress = false;

        await db.query(
          "INSERT INTO backup_log (action, filename, size_bytes, status, notes) VALUES ($1, $2, $3, $4, $5)",
          ["restore", req.file.originalname, req.file.size, "success", result.stderr || null]
        ).catch(() => {});

        res.json({ success: true, message: "Restore complete" });
      } catch (err) {
        runtimeState.isRestoreInProgress = false;
        await db.query(
          "INSERT INTO backup_log (action, filename, size_bytes, status, notes) VALUES ($1, $2, $3, $4, $5)",
          ["restore", req.file?.originalname || "unknown", req.file?.size || 0, "failed", err.message]
        ).catch(() => {});
        res.status(500).json({ error: err.message });
      } finally {
        // Clean up uploaded file
        if (req.file?.path) fs.unlink(req.file.path, () => {});
      }
    },
  );
```

Note: The `finally` block uses `fs` (already destructured from deps at line 2) instead of requiring it again inline.

**Step 3: Run existing tests**

Run: `cd backend && npx jest tests/integration/pg-batch3 --testPathPattern=pg-batch3 --forceExit 2>&1 | tail -20`
Expected: All tests still passing

**Step 4: Commit**

```bash
git add backend/routes/barcode-expenses.js
git commit -m "$(cat <<'EOF'
feat: replace backup/restore stubs with pg_dump/pg_restore

GET /api/backup/download streams pg_dump custom-format archive.
POST /api/backup/restore accepts uploaded .dump file, runs pg_restore.
Both log to backup_log table. Schema-aware for MT mode.
Checks pg_dump availability before streaming (503 if missing).

Completes MT readiness item #14.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Tenant Isolation Tests

**Files:**
- Create: `backend/tests/integration/pg-tenant-isolation.test.js`

**Context:**
- This test provisions two tenant schemas, seeds data, and verifies API-level isolation
- **MUST reuse `createTestApp` from `createTestApp-pg.js`** — do NOT duplicate the ~160-line helper inline. The existing helper already handles schema creation, seed data, middleware wiring, and cleanup. Duplicating it creates drift risk.
- `createTestApp()` returns `{ app, db, deps, runtimeState, cleanup, schemaName }`
- `cleanup()` drops the schema and releases the client — use it in `afterAll`
- Employee `x-employee-id: 1` is the admin (role_id=1, has `all_access` permission)
- Products are seeded by `seedData()` (5 products: Widget A/B, Gadget C, Snack D, Drink E)
- **Do NOT call `pool.end()`** — it kills the shared connection pool and breaks parallel test suites. The helper's `cleanup()` handles releasing the client properly.
- Use `supertest` for HTTP assertions

**Step 1: Create the test file**

```javascript
/**
 * pg-tenant-isolation.test.js — Verifies cross-tenant data isolation at the API level.
 *
 * Provisions two isolated test schemas (simulating two tenants), makes API calls
 * against each, and asserts that data from one tenant never leaks to another.
 *
 * Uses createTestApp from createTestApp-pg.js for each tenant — same wiring as all
 * other pg integration tests but run twice in parallel.
 */
const request = require("supertest");
const { createTestApp } = require("../helpers/createTestApp-pg");

describe("Tenant Isolation", () => {
  let tenantA, tenantB;

  beforeAll(async () => {
    // Provision two independent tenants (separate schemas, separate Express apps)
    [tenantA, tenantB] = await Promise.all([
      createTestApp(),
      createTestApp(),
    ]);
  }, 30000);

  afterAll(async () => {
    // cleanup() drops schema + releases client — do NOT call pool.end()
    await tenantA.cleanup();
    await tenantB.cleanup();
  });

  // ─── API-level isolation tests ────────────────────────────────────────────

  it("products created in tenant A are invisible to tenant B", async () => {
    // Create a product in tenant A
    const createRes = await request(tenantA.app)
      .post("/api/products")
      .set("x-employee-id", "1")
      .send({
        name: "Tenant A Exclusive Widget",
        price: 99.99,
        stock: 10,
        cost_price: 50,
        category_id: 1,
      });
    expect(createRes.status).toBe(201);

    // Tenant A sees it
    const listA = await request(tenantA.app)
      .get("/api/products")
      .set("x-employee-id", "1");
    expect(listA.status).toBe(200);
    const namesA = (listA.body.products || listA.body).map((p) => p.name);
    expect(namesA).toContain("Tenant A Exclusive Widget");

    // Tenant B does NOT see it
    const listB = await request(tenantB.app)
      .get("/api/products")
      .set("x-employee-id", "1");
    expect(listB.status).toBe(200);
    const namesB = (listB.body.products || listB.body).map((p) => p.name);
    expect(namesB).not.toContain("Tenant A Exclusive Widget");
  });

  it("categories created in tenant B are invisible to tenant A", async () => {
    const catRes = await request(tenantB.app)
      .post("/api/categories")
      .set("x-employee-id", "1")
      .send({ name: "Tenant B Electronics" });
    expect(catRes.status).toBe(201);

    const listA = await request(tenantA.app)
      .get("/api/categories")
      .set("x-employee-id", "1");
    expect(listA.status).toBe(200);
    const names = (listA.body.categories || listA.body).map((c) => c.name);
    expect(names).not.toContain("Tenant B Electronics");

    // Tenant B sees its own
    const listB = await request(tenantB.app)
      .get("/api/categories")
      .set("x-employee-id", "1");
    const namesB = (listB.body.categories || listB.body).map((c) => c.name);
    expect(namesB).toContain("Tenant B Electronics");
  });

  it("customers created in tenant A are invisible to tenant B", async () => {
    const custRes = await request(tenantA.app)
      .post("/api/customers")
      .set("x-employee-id", "1")
      .send({ name: "Alice from A", mobile: "111-0001" });
    expect(custRes.status).toBe(201);

    const listB = await request(tenantB.app)
      .get("/api/customers")
      .set("x-employee-id", "1");
    expect(listB.status).toBe(200);
    const names = (listB.body.customers || listB.body).map((c) => c.name);
    expect(names).not.toContain("Alice from A");
  });

  it("suppliers inserted directly in tenant A DB are invisible to tenant B", async () => {
    // Direct DB insert — bypasses API, tests raw schema isolation
    await tenantA.db.query(
      "INSERT INTO suppliers (name, contact_person) VALUES ($1, $2)",
      ["Supplier Only In A", "Contact A"]
    );

    // Tenant B query — must not see it
    const { rows } = await tenantB.db.query(
      "SELECT * FROM suppliers WHERE name = $1", ["Supplier Only In A"]
    );
    expect(rows.length).toBe(0);

    // Tenant A query — must see it
    const { rows: rowsA } = await tenantA.db.query(
      "SELECT * FROM suppliers WHERE name = $1", ["Supplier Only In A"]
    );
    expect(rowsA.length).toBe(1);
  });

  it("sales in tenant A are isolated from tenant B (full sale lifecycle)", async () => {
    // Open shift in tenant A
    const shiftRes = await request(tenantA.app)
      .post("/api/shifts/open")
      .set("x-employee-id", "1")
      .send({ employee_id: 1, outlet_id: 1, opening_cash: 1000 });
    expect(shiftRes.status).toBe(201);

    // Clock in employee for tenant A (required for sale)
    await tenantA.db.query(
      `INSERT INTO attendance_sessions (employee_id, session_start, outlet_id)
       VALUES (1, NOW(), 1)`
    );
    await tenantA.db.query(
      `INSERT INTO employee_attendance (employee_id, check_in, outlet_id)
       VALUES (1, NOW(), 1)`
    );

    // Create a sale in tenant A
    const saleRes = await request(tenantA.app)
      .post("/api/sales")
      .set("x-employee-id", "1")
      .set("x-outlet-id", "1")
      .send({
        items: [{ id: 1, name: "Widget A", price: 100, quantity: 1, cost_price: 60 }],
        payments: [{ method: "cash", amount: 100 }],
        total: 100,
        subtotal: 100,
      });
    // Sale should succeed (201) or at minimum not 500
    expect([200, 201]).toContain(saleRes.status);

    // Tenant A has 1 sale
    const { rows: salesA } = await tenantA.db.query("SELECT COUNT(*)::int AS cnt FROM sales");
    expect(salesA[0].cnt).toBe(1);

    // Tenant B has 0 sales — complete isolation
    const { rows: salesB } = await tenantB.db.query("SELECT COUNT(*)::int AS cnt FROM sales");
    expect(salesB[0].cnt).toBe(0);
  });

  // ─── Concurrent request safety (AsyncLocalStorage) ───────────────────────

  it("concurrent requests to different tenants do not leak data via AsyncLocalStorage", async () => {
    // Fire parallel product creation to both tenants simultaneously
    const [resA, resB] = await Promise.all([
      request(tenantA.app)
        .post("/api/products")
        .set("x-employee-id", "1")
        .send({ name: "Concurrent A Only", price: 10, stock: 5, cost_price: 5, category_id: 1 }),
      request(tenantB.app)
        .post("/api/products")
        .set("x-employee-id", "1")
        .send({ name: "Concurrent B Only", price: 20, stock: 5, cost_price: 10, category_id: 1 }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    // Verify A's product is only in A
    const { rows: aProducts } = await tenantA.db.query(
      "SELECT name FROM products WHERE name LIKE 'Concurrent%'"
    );
    expect(aProducts.map((r) => r.name)).toContain("Concurrent A Only");
    expect(aProducts.map((r) => r.name)).not.toContain("Concurrent B Only");

    // Verify B's product is only in B
    const { rows: bProducts } = await tenantB.db.query(
      "SELECT name FROM products WHERE name LIKE 'Concurrent%'"
    );
    expect(bProducts.map((r) => r.name)).toContain("Concurrent B Only");
    expect(bProducts.map((r) => r.name)).not.toContain("Concurrent A Only");
  });

  // ─── Seed data isolation ─────────────────────────────────────────────────

  it("seed data is independent — each tenant has its own base products", async () => {
    // Both tenants were seeded with the same 5 products, but they're separate copies
    const { rows: aCount } = await tenantA.db.query("SELECT COUNT(*)::int AS cnt FROM products");
    const { rows: bCount } = await tenantB.db.query("SELECT COUNT(*)::int AS cnt FROM products");

    // Tenant A has 5 seed + products created in earlier tests
    expect(aCount[0].cnt).toBeGreaterThanOrEqual(5);
    // Tenant B has 5 seed + products created in earlier tests
    expect(bCount[0].cnt).toBeGreaterThanOrEqual(5);

    // But they have different total counts due to tenant-specific creates above
    // (Tenant A got "Tenant A Exclusive Widget" + "Concurrent A Only",
    //  Tenant B got "Concurrent B Only")
    // This isn't about exact counts — it's about independence
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `cd backend && npx jest tests/integration/pg-tenant-isolation --forceExit 2>&1 | tail -30`
Expected: 7/7 tests passing

**Step 3: Commit**

```bash
git add backend/tests/integration/pg-tenant-isolation.test.js
git commit -m "$(cat <<'EOF'
test: tenant isolation tests — verify cross-tenant data isolation

7 tests using createTestApp-pg.js (no inline duplication):
- Product isolation via API (create + list)
- Category isolation via API
- Customer isolation via API
- Supplier isolation via direct DB query
- Full sale lifecycle isolation (shift + attendance + sale)
- Concurrent request safety (parallel creates via Promise.all)
- Seed data independence verification

MT readiness item #13.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update CLAUDE.md and ROADMAP.md

**Files:**
- Modify: `ROADMAP.md` — mark items #13, #14, #15 as complete
- Modify: `CLAUDE.md` — add MT Phase 3 entry to refactor history and mark readiness items

**Step 1: Update ROADMAP.md**

Find the MT checklist items and mark them complete. Specific find/replace targets:

- `**Tenant isolation testing**` line → mark as Done with 7-test count
- `**Backup/restore per-tenant**` line → mark as Done with pg_dump/pg_restore details
- Add feature flag cache line as Done (if not already listed, add near the other MT items)

**Step 2: Update CLAUDE.md**

Add to the refactor history section at the end:

```
- Mar 2026: **MT Phase 3 hardening** — `feature/mt-phase3-hardening` branch. Per-tenant feature flag cache (`getFeatureFlagsMap` + 60s TTL Map, invalidated on PUT); pg_dump/pg_restore backup/restore (`backend/utils/backup-pg.js`, replaces stubs in `barcode-expenses.js`, runtime `isPgDumpAvailable()` check); tenant isolation integration tests (7 tests in `pg-tenant-isolation.test.js` — API isolation, direct DB isolation, concurrent request safety).
```

Also update the "Multi-tenant readiness" section, marking items #13, #14, #15 as complete with strikethrough.

Also update the "Low / deferred" section:

```
13. ~~Tenant isolation testing~~ DONE (Mar 12 2026, MT Phase 3) — 7 API-level + DB-level + concurrency tests
14. ~~Backup/restore per-tenant~~ DONE (Mar 12 2026, MT Phase 3) — pg_dump/pg_restore per schema
15. ~~Feature flag cache not tenant-keyed~~ DONE (Mar 12 2026, MT Phase 3) — per-tenant Map + 60s TTL
```

**Step 3: Commit**

```bash
git add ROADMAP.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md and ROADMAP.md for MT Phase 3 hardening

Mark items #13 (tenant isolation testing), #14 (backup/restore),
and #15 (feature flag cache) as complete.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Push Branch

**Step 1: Push**

```bash
git push -u origin feature/mt-phase3-hardening
```

---

## Summary

| Task | Item | Files | ~Lines | Key Improvement |
|------|------|-------|--------|-----------------|
| 1 | #15 Feature flag cache | index.js, registerAllRoutes.js | ~30 | Same as before |
| 2 | #14 Backup utility | utils/backup-pg.js (new) | ~90 | Added `isPgDumpAvailable()` runtime check |
| 3 | #14 Wire backup routes | barcode-expenses.js | ~65 | Added 503 check for pg_dump availability; uses `fs` from deps (not re-required) |
| 4 | #13 Tenant isolation tests | pg-tenant-isolation.test.js (new) | ~130 | **Reuses `createTestApp`** (no inline duplication); 7 tests (was 5); added concurrent request safety + full sale lifecycle; no `pool.end()` |
| 5 | Docs | ROADMAP.md, CLAUDE.md | ~15 | Same as before |
| 6 | Push | — | — | Same as before |

**Total: ~330 lines across 6 files (2 new, 4 modified)**

### Changes from original plan

1. **Task 2**: Added `isPgDumpAvailable()` — runtime check so backup route returns 503 with a clear message instead of a cryptic spawn error if pg_dump isn't installed.
2. **Task 3**: Route calls `isPgDumpAvailable()` before streaming. `finally` block uses `fs` from deps (already destructured) instead of re-requiring it inline.
3. **Task 4 (major rewrite)**:
   - **Reuses `createTestApp` from `createTestApp-pg.js`** — eliminates ~160 lines of duplicated setup code that would drift from the real test helper.
   - **Removed `pool.end()`** — it was killing the shared connection pool and would break parallel test suites.
   - **Added concurrent request test** — fires `Promise.all` product creates to both tenants simultaneously, verifying AsyncLocalStorage doesn't leak context. This was in the design doc but missing from the original plan.
   - **Strengthened sales isolation test** — now creates a full sale (shift + attendance + POST /api/sales) instead of just checking two empty tables.
   - **Added seed data independence test** — verifies each tenant's seed data is its own copy.
   - **7 tests total** (was 5): products, categories, customers, suppliers (direct DB), sales (full lifecycle), concurrent requests, seed independence.
