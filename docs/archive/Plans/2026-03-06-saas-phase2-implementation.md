# SaaS Phase 2: JWT Authentication — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `x-employee-id` header auth with JWT tokens, hash all PINs with bcrypt, and add token refresh — toggled by `MULTI_TENANT` env var so single-tenant mode is unchanged.

**Architecture:** Dual-mode auth via env flag. `MULTI_TENANT=0` keeps current behavior (PIN login, `x-employee-id` header). `MULTI_TENANT=1` activates JWT auth with tenant lookup in master.db, bcrypt PIN verification, access/refresh tokens. Permissions loaded from DB per-request (not embedded in JWT).

**Tech Stack:** `jsonwebtoken`, `bcryptjs` (npm), Node.js `crypto` (built-in for SHA-256 hashing refresh tokens)

**Design doc:** `docs/plans/2026-03-06-saas-phase2-jwt-auth-design.md`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `backend/package.json`

**Step 1: Install jsonwebtoken and bcryptjs**

Run:
```bash
cd backend && npm install jsonwebtoken bcryptjs
```

**Step 2: Verify installation**

Run:
```bash
node -e "require('jsonwebtoken'); require('bcryptjs'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add jsonwebtoken and bcryptjs for Phase 2 JWT auth"
```

---

## Task 2: PIN Hashing Migration (migrate66.js)

**Files:**
- Create: `backend/migrate66.js`

**Step 1: Write the migration**

Create `backend/migrate66.js`:

```javascript
/**
 * migrate66.js — Hash employee PINs with bcrypt
 *
 * Adds pin_hash column to employees table, hashes all existing plaintext
 * pin_code values. pin_code column kept for backward compat but no longer read.
 */
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "oneshop.db");
const db = new sqlite3.Database(DB_PATH);
const BCRYPT_ROUNDS = 10;

async function migrate() {
  // 1. Add pin_hash column
  await run("ALTER TABLE employees ADD COLUMN pin_hash TEXT");
  console.log("migrate66: added pin_hash column.");

  // 2. Read all employees with plaintext PINs
  const rows = await all("SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL");
  console.log(`migrate66: hashing ${rows.length} PINs...`);

  // 3. Hash each PIN and update
  for (const row of rows) {
    const hash = await bcrypt.hash(String(row.pin_code), BCRYPT_ROUNDS);
    await run("UPDATE employees SET pin_hash = ? WHERE id = ?", [hash, row.id]);
  }
  console.log("migrate66: all PINs hashed.");
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

migrate()
  .then(() => {
    db.close((err) => {
      if (err) console.error("migrate66: close error:", err.message);
      else console.log("migrate66: done.");
    });
  })
  .catch((err) => {
    console.error("migrate66: FAILED:", err.message);
    db.close(() => process.exit(1));
  });
```

**Step 2: Run the migration**

Run:
```bash
cd backend && node migrate66.js
```
Expected: `migrate66: added pin_hash column.`, `migrate66: hashing N PINs...`, `migrate66: all PINs hashed.`, `migrate66: done.`

**Step 3: Verify PINs are hashed**

Run:
```bash
cd backend && node -e "
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./oneshop.db');
db.all('SELECT id, name, pin_code, pin_hash FROM employees LIMIT 3', [], (e,r) => {
  r.forEach(row => console.log(row.name, '| pin_code:', row.pin_code, '| pin_hash:', row.pin_hash ? row.pin_hash.substring(0,20)+'...' : 'NULL'));
  db.close();
});
"
```
Expected: Each row shows `pin_hash: $2a$10$...` (bcrypt hash)

**Step 4: Commit**

```bash
git add backend/migrate66.js
git commit -m "feat: migrate66 — hash employee PINs with bcrypt (pin_hash column)"
```

---

## Task 3: Update master.db Schema (tenant_refresh_tokens)

**Files:**
- Modify: `backend/master-db.js:43-88` (MASTER_SCHEMA constant)

**Step 1: Write a test for master.db schema**

We'll add to the existing `saas-phase1.test.js` or verify manually. For now, verify the schema change manually after modifying.

**Step 2: Add tenant_refresh_tokens table to MASTER_SCHEMA**

In `backend/master-db.js`, add to the `MASTER_SCHEMA` string (after the `schema_migrations` table):

```sql
CREATE TABLE IF NOT EXISTS tenant_refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  employee_id INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

**Step 3: Verify by reinitializing master.db**

Run:
```bash
cd backend && node -e "
const { initMasterDb, closeMasterDb } = require('./master-db');
initMasterDb().then(() => {
  const { getMasterDb } = require('./master-db');
  const db = getMasterDb();
  db.all(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\", [], (e,r) => {
    console.log('Tables:', r.map(x=>x.name).join(', '));
    closeMasterDb();
  });
}).catch(e => console.error(e));
"
```
Expected: Tables list includes `tenant_refresh_tokens`

**Step 4: Commit**

```bash
git add backend/master-db.js
git commit -m "feat: add tenant_refresh_tokens table to master.db schema"
```

---

## Task 4: Create JWT Auth Utility Module

**Files:**
- Create: `backend/jwt-auth.js`

**Step 1: Write the failing test**

Create `backend/tests/integration/auth-jwt.test.js`:

```javascript
/**
 * auth-jwt.test.js — Integration tests for JWT auth (Phase 2)
 *
 * Tests run with MULTI_TENANT=0 by default (testing bcrypt PIN flow).
 * JWT-specific tests create their own setup with MULTI_TENANT=1 simulation.
 */
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createTestApp, closeDb, dbRun, dbGet } = require("../helpers/createTestApp");
const { makeRequest, ADMIN_ID } = require("../helpers/request");

const TEST_JWT_SECRET = "test-jwt-secret-that-is-at-least-64-characters-long-for-security-purposes-here";
const TEST_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-64-characters-long-for-security-purposes";

let app, db;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;

  // Hash all existing PINs with bcrypt (simulates migrate66)
  const rows = await new Promise((resolve, reject) => {
    db.all("SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL", [], (e, r) => e ? reject(e) : resolve(r));
  });
  for (const row of rows) {
    const hash = await bcrypt.hash(String(row.pin_code), 4); // low rounds for test speed
    await dbRun(db, "UPDATE employees SET pin_hash = ? WHERE id = ?", [hash, row.id]);
  }
});

afterAll(async () => {
  await closeDb(db);
});

describe("bcrypt PIN verification", () => {
  it("login succeeds with correct PIN after bcrypt migration", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "2580" });

    expect(res.status).toBe(200);
    expect(res.body.employee).toBeDefined();
    expect(res.body.employee.name).toBe("Hassan");
  });

  it("login fails with wrong PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/auth/login")
      .send({ username: "Hassan", pin: "9999" });

    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage
```
Expected: FAIL — `pin_hash` column doesn't exist in in-memory test DB yet (seedSchema needs updating)

**Step 3: Write the jwt-auth module**

Create `backend/jwt-auth.js`:

```javascript
/**
 * jwt-auth.js — JWT utilities for signing, verifying, and refreshing tokens.
 *
 * Used by routes/auth.js and index.js middleware.
 * All functions are pure (no DB access) — DB calls live in the caller.
 */
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const defaults = {
  accessExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
};

/**
 * Sign an access token.
 * @param {{ tid: number, eid: number, rid: number, oid: number|null, scope?: string }} payload
 * @param {string} secret — JWT_SECRET env var
 * @returns {string} signed JWT
 */
function signAccessToken(payload, secret) {
  return jwt.sign(
    { tid: payload.tid, eid: payload.eid, rid: payload.rid, oid: payload.oid || null, scope: payload.scope || "full" },
    secret,
    { expiresIn: defaults.accessExpiresIn }
  );
}

/**
 * Sign a refresh token and return both the raw token and its SHA-256 hash.
 * The hash is stored in DB; the raw token is sent to the client (httpOnly cookie).
 * @param {{ tid: number, eid: number }} payload
 * @param {string} secret — JWT_REFRESH_SECRET env var
 * @returns {{ token: string, hash: string, expiresAt: string }}
 */
function signRefreshToken(payload, secret) {
  const token = jwt.sign(
    { tid: payload.tid, eid: payload.eid, type: "refresh" },
    secret,
    { expiresIn: defaults.refreshExpiresIn }
  );
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  // Calculate expiry for DB storage
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();
  return { token, hash, expiresAt };
}

/**
 * Verify an access token.
 * @param {string} token
 * @param {string} secret
 * @returns {{ tid: number, eid: number, rid: number, oid: number|null, scope: string }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyAccessToken(token, secret) {
  return jwt.verify(token, secret);
}

/**
 * Verify a refresh token.
 * @param {string} token
 * @param {string} secret
 * @returns {{ tid: number, eid: number, type: string }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyRefreshToken(token, secret) {
  return jwt.verify(token, secret);
}

/**
 * Hash a refresh token for DB storage.
 * @param {string} token
 * @returns {string} SHA-256 hex hash
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  defaults,
};
```

**Step 4: Commit**

```bash
git add backend/jwt-auth.js backend/tests/integration/auth-jwt.test.js
git commit -m "feat: jwt-auth utility module + initial auth-jwt test scaffold"
```

---

## Task 5: Update Test Helpers (seedSchema + pin_hash)

**Files:**
- Modify: `backend/tests/helpers/seedSchema.js` — add `pin_hash TEXT` column to employees table
- Modify: `backend/tests/helpers/seedData.js` — add bcrypt-hashed PINs to seed employees

**Step 1: Add pin_hash column to test schema**

In `backend/tests/helpers/seedSchema.js`, find the `CREATE TABLE employees` statement and add `pin_hash TEXT` after `pin_code`.

**Step 2: Hash PINs in seed data**

In `backend/tests/helpers/seedData.js`, after inserting employees with plaintext `pin_code`, add a step that hashes each `pin_code` into `pin_hash`:

```javascript
// Hash all employee PINs (simulates migrate66)
const bcrypt = require("bcryptjs");
const empRows = await dbAll(db, "SELECT id, pin_code FROM employees WHERE pin_code IS NOT NULL");
for (const row of empRows) {
  const hash = await bcrypt.hash(String(row.pin_code), 4); // low rounds for test speed
  await dbRun(db, "UPDATE employees SET pin_hash = ? WHERE id = ?", [hash, row.id]);
}
```

Note: Use `bcrypt.hashSync` if the seed function is synchronous, or convert to async.

**Step 3: Run existing auth tests to verify no regression**

Run:
```bash
cd backend && npx jest tests/integration/auth.test.js --no-coverage
```
Expected: All existing auth tests PASS (they still use plaintext `pin_code` comparison for now)

**Step 4: Run auth-jwt test**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage
```
Expected: FAIL — auth.js still compares plaintext, not bcrypt

**Step 5: Commit**

```bash
git add backend/tests/helpers/seedSchema.js backend/tests/helpers/seedData.js
git commit -m "test: add pin_hash column to test schema + seed bcrypt hashes"
```

---

## Task 6: Update auth.js Login to Use bcrypt

**Files:**
- Modify: `backend/routes/auth.js:1-45`

**Step 1: Update login to use bcrypt.compare**

Replace the login handler in `backend/routes/auth.js`. The key change is:
- Query employee by username only (don't match `pin_code` in SQL)
- Use `bcrypt.compare(pin, employee.pin_hash)` to verify
- Fall back to plaintext `pin_code` comparison if `pin_hash` is null (transition safety)

```javascript
const bcrypt = require("bcryptjs");

module.exports = function registerAuthRoutes(app, deps) {
  const { db, authLimiter } = deps;

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const { username, pin } = req.body || {};
    if (!username || !pin) {
      return res.status(400).json({ error: "username and pin are required" });
    }

    try {
      const employee = await new Promise((resolve, reject) => {
        db.get(
          `SELECT e.id, e.name, e.role_id, e.pin_code, e.pin_hash, r.name as role, NULL as outlet_id
           FROM employees e
           LEFT JOIN roles r ON e.role_id = r.id
           WHERE LOWER(e.name) = LOWER(?)`,
          [String(username).trim()],
          (err, row) => (err ? reject(err) : resolve(row))
        );
      });

      if (!employee) {
        return res.status(401).json({ error: "Invalid username or PIN" });
      }

      // Verify PIN: prefer pin_hash (bcrypt), fall back to plaintext pin_code
      let pinValid = false;
      if (employee.pin_hash) {
        pinValid = await bcrypt.compare(String(pin).trim(), employee.pin_hash);
      } else if (employee.pin_code) {
        pinValid = String(pin).trim() === String(employee.pin_code).trim();
      }

      if (!pinValid) {
        return res.status(401).json({ error: "Invalid username or PIN" });
      }

      const permissions = await new Promise((resolve, reject) => {
        db.all(
          "SELECT permission FROM role_permissions WHERE role_id = ?",
          [employee.role_id || 3],
          (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.permission)))
        );
      });

      return res.json({
        employee: {
          id: employee.id,
          name: employee.name,
          role_id: employee.role_id,
          outlet_id: employee.outlet_id || null,
        },
        permissions,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ... rest of auth routes unchanged (logout, context/bootstrap, auth/me)
```

Important: Keep the rest of the file (`logout`, `context/bootstrap`, `auth/me`) unchanged. Only replace the login handler.

**Step 2: Run auth-jwt tests**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage
```
Expected: PASS — bcrypt comparison now works

**Step 3: Run existing auth tests**

Run:
```bash
cd backend && npx jest tests/integration/auth.test.js --no-coverage
```
Expected: PASS — fallback to plaintext still works for tests without pin_hash

**Step 4: Run full test suite**

Run:
```bash
cd backend && npx jest tests/integration/ --no-coverage
```
Expected: 283+ tests pass (no regressions)

**Step 5: Commit**

```bash
git add backend/routes/auth.js
git commit -m "feat: auth login uses bcrypt PIN verification with plaintext fallback"
```

---

## Task 7: Update employees.js to Hash PINs on Create/Update

**Files:**
- Modify: `backend/routes/employees.js:76-133` (POST and PUT handlers)

**Step 1: Write failing test**

Add to `backend/tests/integration/auth-jwt.test.js`:

```javascript
describe("employee PIN hashing on create/update", () => {
  it("creating an employee hashes the PIN", async () => {
    const res = await makeRequest(app, ADMIN_ID)
      .post("/api/employees")
      .send({ name: "JWTTestEmp", pin_code: "7777", role_id: 3 });

    expect(res.status).toBe(200);
    const emp = await dbGet(db, "SELECT pin_hash FROM employees WHERE id = ?", [res.body.id]);
    expect(emp.pin_hash).toBeTruthy();
    expect(emp.pin_hash.startsWith("$2")).toBe(true); // bcrypt prefix
  });

  it("updating an employee PIN re-hashes it", async () => {
    // Create first
    const create = await makeRequest(app, ADMIN_ID)
      .post("/api/employees")
      .send({ name: "JWTUpdateEmp", pin_code: "8888", role_id: 3 });
    const empId = create.body.id;

    // Update PIN
    await makeRequest(app, ADMIN_ID)
      .put(`/api/employees/${empId}`)
      .send({ pin_code: "9999" });

    const emp = await dbGet(db, "SELECT pin_hash FROM employees WHERE id = ?", [empId]);
    expect(emp.pin_hash).toBeTruthy();

    // Verify new PIN works
    const valid = await bcrypt.compare("9999", emp.pin_hash);
    expect(valid).toBe(true);

    // Verify old PIN doesn't work
    const invalid = await bcrypt.compare("8888", emp.pin_hash);
    expect(invalid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage -t "employee PIN hashing"
```
Expected: FAIL — `pin_hash` is null (employees.js doesn't hash yet)

**Step 3: Update POST /api/employees**

In `backend/routes/employees.js`, add `const bcrypt = require("bcryptjs");` at the top of the module function, then modify the POST handler:

```javascript
  app.post("/api/employees", requirePerm("all_access"), async (req, res) => {
    const { name, role_id, pin_code, salary_type, monthly_salary, hourly_rate, daily_rate } = req.body;
    try {
      const pin_hash = pin_code ? await bcrypt.hash(String(pin_code), 10) : null;
      await new Promise((resolve, reject) => {
        db.run(
          "INSERT INTO employees (name, role_id, pin_code, pin_hash, salary_type, monthly_salary, hourly_rate, daily_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [name, role_id || 3, pin_code, pin_hash, salary_type || "monthly", Number(monthly_salary || 0), Number(hourly_rate || 0), Number(daily_rate || 0)],
          function (err) {
            if (err) return reject(err);
            resolve(this.lastID);
          }
        );
      }).then(id => res.json({ id, name, role_id }));
    } catch (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "PIN code must be unique" });
      }
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Update PUT /api/employees/:id**

Similar pattern — when `pin_code` is provided, hash it and update both `pin_code` and `pin_hash`:

```javascript
    if (pin_code !== undefined && pin_code !== "") {
      const pin_hash = await bcrypt.hash(String(pin_code), 10);
      query += ", pin_code = ?, pin_hash = ?";
      params.push(pin_code, pin_hash);
    }
```

**Step 5: Run tests**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage
```
Expected: All PASS

Run:
```bash
cd backend && npx jest tests/integration/ --no-coverage
```
Expected: No regressions

**Step 6: Commit**

```bash
git add backend/routes/employees.js
git commit -m "feat: hash PINs with bcrypt on employee create/update"
```

---

## Task 8: Update validate-pin Endpoint to Use bcrypt

**Files:**
- Modify: `backend/routes/employees.js:62-73` (validate-pin handler)

**Step 1: Write failing test**

Add to `auth-jwt.test.js`:

```javascript
describe("POST /api/employees/validate-pin (bcrypt)", () => {
  it("validates PIN using bcrypt hash", async () => {
    const res = await makeRequest(app)
      .post("/api/employees/validate-pin")
      .send({ pin_code: "2580" }); // Hassan's PIN

    expect(res.status).toBe(200);
    expect(res.body.employee.name).toBe("Hassan");
  });

  it("rejects wrong PIN", async () => {
    const res = await makeRequest(app)
      .post("/api/employees/validate-pin")
      .send({ pin_code: "0000" });

    expect(res.status).toBe(401);
  });
});
```

**Step 2: Update validate-pin to use bcrypt**

The current implementation does `WHERE e.pin_code = ?` — with bcrypt, we need to load all employees and compare:

```javascript
  app.post("/api/employees/validate-pin", async (req, res) => {
    const { pin_code } = req.body;
    if (!pin_code) return res.status(400).json({ error: "pin_code is required" });

    try {
      const employees = await new Promise((resolve, reject) => {
        db.all(
          "SELECT e.id, e.name, e.role_id, e.pin_hash, e.pin_code, r.name as role FROM employees e LEFT JOIN roles r ON e.role_id = r.id",
          [],
          (err, rows) => (err ? reject(err) : resolve(rows || []))
        );
      });

      for (const emp of employees) {
        let match = false;
        if (emp.pin_hash) {
          match = await bcrypt.compare(String(pin_code), emp.pin_hash);
        } else if (emp.pin_code) {
          match = String(pin_code) === String(emp.pin_code);
        }
        if (match) {
          return res.json({ employee: { id: emp.id, name: emp.name, role_id: emp.role_id, role: emp.role } });
        }
      }
      return res.status(401).json({ error: "Invalid PIN" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Performance note:** This scans all employees — fine for typical POS installations (< 100 employees). For kiosk use, this is the same pattern as the kiosk login in the design doc.

**Step 3: Run tests**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage -t "validate-pin"
```
Expected: PASS

**Step 4: Commit**

```bash
git add backend/routes/employees.js
git commit -m "feat: validate-pin endpoint uses bcrypt comparison"
```

---

## Task 9: Add JWT Login/Refresh/Logout (Multi-Tenant Mode)

**Files:**
- Modify: `backend/routes/auth.js`

**Step 1: Write failing tests**

Add to `auth-jwt.test.js`:

```javascript
describe("JWT token operations (unit-level)", () => {
  const { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require("../../jwt-auth");

  it("signs and verifies an access token", () => {
    const token = signAccessToken({ tid: 1, eid: 42, rid: 1, oid: 3 }, TEST_JWT_SECRET);
    const decoded = verifyAccessToken(token, TEST_JWT_SECRET);
    expect(decoded.tid).toBe(1);
    expect(decoded.eid).toBe(42);
    expect(decoded.rid).toBe(1);
    expect(decoded.oid).toBe(3);
    expect(decoded.scope).toBe("full");
  });

  it("signs and verifies a refresh token", () => {
    const { token, hash, expiresAt } = signRefreshToken({ tid: 1, eid: 42 }, TEST_REFRESH_SECRET);
    const decoded = verifyRefreshToken(token, TEST_REFRESH_SECRET);
    expect(decoded.tid).toBe(1);
    expect(decoded.eid).toBe(42);
    expect(decoded.type).toBe("refresh");
    expect(hash).toBeTruthy();
    expect(expiresAt).toBeTruthy();
  });

  it("rejects token with wrong secret", () => {
    const token = signAccessToken({ tid: 1, eid: 42, rid: 1, oid: null }, TEST_JWT_SECRET);
    expect(() => verifyAccessToken(token, "wrong-secret")).toThrow();
  });

  it("hashToken produces consistent SHA-256 hex", () => {
    const h1 = hashToken("test-token");
    const h2 = hashToken("test-token");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });
});
```

**Step 2: Run to verify they pass**

Run:
```bash
cd backend && npx jest tests/integration/auth-jwt.test.js --no-coverage -t "JWT token operations"
```
Expected: PASS (these test jwt-auth.js which is already written)

**Step 3: Add multi-tenant login route to auth.js**

Add to `backend/routes/auth.js` — new endpoints that only activate when `process.env.MULTI_TENANT === "1"`:

```javascript
  // --- Multi-tenant JWT endpoints (only when MULTI_TENANT=1) ---
  if (process.env.MULTI_TENANT === "1") {
    const { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } = require("../jwt-auth");
    const { getMasterDb } = require("../master-db");
    const TenantDbManager = require("../tenant-db-manager");

    // POST /api/auth/mt-login — multi-tenant login with Store Code
    app.post("/api/auth/mt-login", authLimiter, async (req, res) => {
      const { tenant_slug, username, pin } = req.body || {};
      if (!tenant_slug || !username || !pin) {
        return res.status(400).json({ error: "tenant_slug, username, and pin are required" });
      }
      // ... (lookup tenant, verify PIN, sign JWT, store refresh token)
    });

    // POST /api/auth/refresh — exchange refresh token for new access token
    app.post("/api/auth/refresh", async (req, res) => {
      // ... (read cookie, verify, check DB, sign new access token)
    });

    // POST /api/auth/update-context — re-sign JWT with new outlet_id
    app.post("/api/auth/update-context", async (req, res) => {
      // ... (verify current token, sign new one with oid)
    });

    // POST /api/auth/kiosk-login — kiosk PIN-only login (limited scope)
    app.post("/api/auth/kiosk-login", authLimiter, async (req, res) => {
      // ... (lookup tenant, scan employees by PIN, sign kiosk-scoped JWT)
    });
  }
```

The full implementation of each endpoint follows the design doc sections 3.1, 3.3, 4.3, and 6.

**Step 4: Write integration tests for mt-login**

These tests need a master.db with a test tenant. Create a helper that sets up an in-memory master.db. (This is the most complex test setup — may require a `createMultiTenantTestApp` helper.)

**Step 5: Run all tests**

Run:
```bash
cd backend && npx jest tests/integration/ --no-coverage
```
Expected: All pass. Multi-tenant tests only run when the routes are registered (which requires `MULTI_TENANT=1` env in the test).

**Step 6: Commit**

```bash
git add backend/routes/auth.js backend/tests/integration/auth-jwt.test.js
git commit -m "feat: JWT login, refresh, kiosk-login, and update-context endpoints"
```

---

## Task 10: Add loadTenantAndPerms Middleware to index.js

**Files:**
- Modify: `backend/index.js:209-233`

**Step 1: Add the middleware function**

Add `loadTenantAndPerms` alongside existing `loadEmployeePerms` in `backend/index.js`. Toggle which one is used based on `MULTI_TENANT`:

```javascript
// JWT auth middleware (Phase 2) — used when MULTI_TENANT=1
function loadTenantAndPerms(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.employeePerms = [];
    return next();
  }

  try {
    const { verifyAccessToken } = require("./jwt-auth");
    const decoded = verifyAccessToken(authHeader.slice(7), process.env.JWT_SECRET);

    req.tenantId = decoded.tid;
    req.employee = { id: decoded.eid, role_id: decoded.rid };
    req.tokenScope = decoded.scope;

    // Set context from JWT claims
    if (decoded.oid) {
      req.context = req.context || {};
      req.context.outletId = decoded.oid;
    }

    // Set x-employee-id header equivalent for downstream compatibility
    req.headers["x-employee-id"] = String(decoded.eid);

    // Load permissions from DB (same as loadEmployeePerms)
    db.get("SELECT role_id FROM employees WHERE id = ?", [decoded.eid], (err, emp) => {
      if (err || !emp) {
        req.employeePerms = [];
        return next();
      }
      db.all("SELECT permission FROM role_permissions WHERE role_id = ?", [emp.role_id], (err2, rows) => {
        req.employeePerms = err2 ? [] : rows.map(r => r.permission);
        next();
      });
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Invalid token", code: "TOKEN_INVALID" });
  }
}
```

Then in the middleware registration section, toggle:

```javascript
const authMiddleware = process.env.MULTI_TENANT === "1" ? loadTenantAndPerms : loadEmployeePerms;
app.use(authMiddleware);
```

**Step 2: Add JWT exempt paths**

Update the context exempt paths to include JWT auth paths:

```javascript
const CONTEXT_EXEMPT_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/context\//,
  /^\/api\/feature-flags/,
  /^\/api\/attendance\/pin-/,
  /^\/api\/roles\/\d+\/permissions/,
  /^\/api\/outlets$/,
];
```

These are already correct — `/api/auth/*` is exempt.

**Step 3: Run full test suite**

Run:
```bash
cd backend && npx jest tests/integration/ --no-coverage
```
Expected: All pass (default `MULTI_TENANT` is not `"1"`, so `loadEmployeePerms` is used)

**Step 4: Commit**

```bash
git add backend/index.js
git commit -m "feat: loadTenantAndPerms JWT middleware (toggled by MULTI_TENANT env)"
```

---

## Task 11: Create .env.example

**Files:**
- Create: `backend/.env.example`

**Step 1: Write the file**

```env
# OneShopPOS Backend Environment Variables

# Server
PORT=5000
NODE_ENV=development

# Multi-tenant mode (0 = single-tenant, 1 = multi-tenant with JWT)
MULTI_TENANT=0

# JWT Secrets (required when MULTI_TENANT=1)
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=
JWT_REFRESH_SECRET=

# JWT Token Lifetimes
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Shopify (optional)
SHOPIFY_SECRET_KEY=

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_GLOBAL_MAX=600
```

**Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "docs: add .env.example with JWT and multi-tenant config"
```

---

## Task 12: Update CLAUDE.md and MEMORY.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `C:\Users\HP\.claude\projects\d--newprojects-oneshoppos\memory\MEMORY.md`

**Step 1: Update CLAUDE.md**

Update the "Current Status Snapshot" section:
- Change latest migration to `migrate66.js`
- Add Phase 2 completion entry
- Update test count
- Add `jwt-auth.js` to project structure

**Step 2: Update MEMORY.md**

Add Phase 2 completion notes.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 2 JWT auth status"
```

---

## Task 13: Final Integration Test Pass

**Step 1: Run full test suite**

Run:
```bash
cd backend && npx jest tests/integration/ --no-coverage
```
Expected: 290+ tests pass (283 existing + ~10 new JWT tests), 2 pre-existing failures (concurrency.test.js vitest format)

**Step 2: Manual smoke test (optional)**

```bash
cd backend && node -e "
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const secret = 'test-secret-for-smoke';

// Simulate login flow
const hash = bcrypt.hashSync('2580', 10);
const valid = bcrypt.compareSync('2580', hash);
const token = jwt.sign({ tid: 1, eid: 1, rid: 1, oid: null, scope: 'full' }, secret, { expiresIn: '24h' });
const decoded = jwt.verify(token, secret);

console.log('PIN hash valid:', valid);
console.log('JWT decoded:', decoded);
console.log('Smoke test PASSED');
"
```

**Step 3: Final commit**

If any fixes were needed during integration, commit them.

---

## Summary of All Commits

1. `chore: add jsonwebtoken and bcryptjs for Phase 2 JWT auth`
2. `feat: migrate66 — hash employee PINs with bcrypt (pin_hash column)`
3. `feat: add tenant_refresh_tokens table to master.db schema`
4. `feat: jwt-auth utility module + initial auth-jwt test scaffold`
5. `test: add pin_hash column to test schema + seed bcrypt hashes`
6. `feat: auth login uses bcrypt PIN verification with plaintext fallback`
7. `feat: hash PINs with bcrypt on employee create/update`
8. `feat: validate-pin endpoint uses bcrypt comparison`
9. `feat: JWT login, refresh, kiosk-login, and update-context endpoints`
10. `feat: loadTenantAndPerms JWT middleware (toggled by MULTI_TENANT env)`
11. `docs: add .env.example with JWT and multi-tenant config`
12. `docs: update CLAUDE.md with Phase 2 JWT auth status`

## Verification Checklist

- [ ] `npm install` succeeds
- [ ] `node migrate66.js` hashes all existing PINs
- [ ] Login works with bcrypt PINs (single-tenant mode)
- [ ] Employee create/update hashes PINs
- [ ] validate-pin uses bcrypt
- [ ] JWT utility module signs/verifies tokens correctly
- [ ] `MULTI_TENANT=0` preserves all existing behavior
- [ ] Full test suite passes (283+ existing + new JWT tests)
- [ ] `.env.example` documents all new env vars
