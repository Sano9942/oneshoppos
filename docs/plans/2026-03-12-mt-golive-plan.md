# Multi-Tenant Go-Live Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 6 blockers preventing `MULTI_TENANT=1` from working, then flip the flag in production.

**Architecture:** Schema-based Postgres multi-tenancy. `public` schema = master tables. `tenant_<slug>` schemas = per-tenant data. AsyncLocalStorage proxy routes DB calls per request. Pre-auth routes (login, refresh, currency, setup) must manually resolve tenant DB since they run before the ALS middleware.

**Tech Stack:** Node.js, Express, PostgreSQL (`db-pg.js` pool), JWT auth, bcryptjs, React + Vite frontend.

---

### Task 1: Initialize master-db-pg at boot

The master DB module (`master-db-pg.js`) must be initialized at startup so that `getTenantBySlug()` and `getTenantById()` work. Currently `init(db)` is only called by `tenantDbManager.init(db)` indirectly — but `masterDbPg.init()` is never called directly, so routes that import `master-db-pg` and call `query()`/`getTenantBySlug()` get "Not initialized."

**Files:**
- Modify: `backend/index.js:18-35`

**Step 1: Add masterDbPg init call**

In `backend/index.js`, inside the `if (IS_MULTI_TENANT)` block (line 18), after the existing code, add the master DB init:

```js
// Inside the if (IS_MULTI_TENANT) { if (HAS_POSTGRES) { ... } } block, after line 26:
const masterDbPg = require("./master-db-pg");
masterDbPg.init(db);
```

The full block (lines 18-35) should become:

```js
if (IS_MULTI_TENANT) {
  if (HAS_POSTGRES) {
    // Postgres schema-switching mode
    const proxyMod = require("./tenant-db-proxy-pg");
    asyncStore = proxyMod.asyncStore;
    createDbProxy = proxyMod.createDbProxy;
    dbProxy = createDbProxy();
    tenantDbManager = require("./tenant-db-manager-pg");
    tenantDbManager.init(db);
    // Initialize master DB so getTenantBySlug/query work globally
    const masterDbPgBoot = require("./master-db-pg");
    masterDbPgBoot.init(db);
  } else {
    // Legacy SQLite file-pool mode
    const proxyMod = require("./tenant-db-proxy");
    asyncStore = proxyMod.asyncStore;
    createDbProxy = proxyMod.createDbProxy;
    dbProxy = createDbProxy();
    tenantDbManager = require("./tenant-db-manager");
  }
}
```

**Step 2: Verify manually**

Start the backend with `MULTI_TENANT=1 DATABASE_URL=<your-url> node backend/index.js` and confirm it boots without "Not initialized" errors.

**Step 3: Commit**

```bash
git add backend/index.js
git commit -m "fix: initialize master-db-pg at boot in MT+Postgres mode"
```

---

### Task 2: Fix auth.js MT routes — resolve tenant DB manually

`mt-login`, `refresh`, and `kiosk-login` in `auth.js` use `deps.db` (the ALS proxy) to query tenant tables. But these routes run BEFORE `resolveTenant` middleware, so there's no ALS context. Fix: look up tenant from master DB by slug, then use `tenantDbManager.getDb(tenantId)` to get a scoped DB object.

**Files:**
- Modify: `backend/routes/auth.js:159-400`

**Step 1: Add tenantDbManager import at top of MT block**

At line 162, after `const masterDb = require("../master-db-pg");`, add:

```js
const tenantDbMgr = process.env.DATABASE_URL
  ? require("../tenant-db-manager-pg")
  : require("../tenant-db-manager");
```

**Step 2: Fix mt-login (lines 176-247)**

After looking up the tenant from master DB (line 178-184, which sets `tenant`), replace the employee query on line 187 and permission query on line 207 to use a scoped DB:

Replace line 187's `await db.query(...)` with:
```js
const tenantDb = await tenantDbMgr.getDb(tenant.id);
const { rows: [employee] } = await tenantDb.query(
  `SELECT e.id, e.name, e.role_id, e.pin_hash
   FROM employees e
   WHERE LOWER(e.name) = LOWER($1)`,
  [String(username).trim()]
);
```

Replace line 207's `await db.query(...)` with:
```js
const { rows: permRows } = await tenantDb.query(
  "SELECT permission FROM role_permissions WHERE role_id = $1",
  [employee.role_id || 3]
);
```

**Step 3: Fix refresh (lines 249-310)**

After decoding the refresh token (line 264, which gives `decoded.tid`), the employee lookup on line 289 uses `db.query()`. Replace with:

```js
const tenantDb = await tenantDbMgr.getDb(decoded.tid);
const { rows: [employee] } = await tenantDb.query(
  "SELECT id, role_id FROM employees WHERE id = $1",
  [decoded.eid]
);
```

**Step 4: Fix kiosk-login (lines 348-400)**

After looking up tenant from master DB (line 361-367, which sets `tenant`), the employee scan on line 370 uses `db.query()`. Replace with:

```js
const tenantDb = await tenantDbMgr.getDb(tenant.id);
const { rows: employees } = await tenantDb.query(
  "SELECT id, name, role_id, pin_hash FROM employees",
  []
);
```

**Step 5: Commit**

```bash
git add backend/routes/auth.js
git commit -m "fix: auth.js MT routes resolve tenant DB manually instead of proxy"
```

---

### Task 3: Fix loadCompanyProfile to use tenant-scoped DB

`loadCompanyProfile` in `index.js` (line 489) always queries the raw `db` pool, which hits `public.company_profile` (doesn't exist in MT mode — each tenant has its own). In MT mode, it should use `dbProxy` (which reads from ALS context set by `resolveTenant`).

**Files:**
- Modify: `backend/index.js:481-509`

**Step 1: Replace the db.query call**

Change line 489 from:
```js
db.query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
```
to:
```js
const _companyDb = IS_MULTI_TENANT ? dbProxy : db;
```

Place this line ABOVE the `loadCompanyProfile` function definition (e.g., after line 454), then inside the function at line 489 replace `db.query(...)` with `_companyDb.query(...)`:

```js
_companyDb.query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
```

**Step 2: Also fix resolveContext (line 561)**

The context flag lookup at line 561 has the same problem — it queries `db` directly. Apply the same fix:

```js
_companyDb.query("SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'")
```

**Step 3: Also fix getFeatureFlagsMap (line 840)**

Line 840 queries `db.query("SELECT key, enabled FROM feature_flags")`. Replace with `_companyDb`:

```js
const { rows } = await _companyDb.query("SELECT key, enabled FROM feature_flags");
```

**Step 4: Commit**

```bash
git add backend/index.js
git commit -m "fix: loadCompanyProfile and flag queries use tenant-scoped DB in MT mode"
```

---

### Task 4: Convert plan-limits.js from SQLite to Postgres

`plan-limits.js` imports SQLite modules (`master-db`, `tenant-db-proxy`). These crash in Postgres mode. Convert to use the Postgres equivalents and async/await.

**Files:**
- Modify: `backend/middleware/plan-limits.js`

**Step 1: Rewrite plan-limits.js**

Replace the entire file with:

```js
/**
 * middleware/plan-limits.js — Enforce tenant plan limits (Postgres).
 *
 * Called on creation endpoints (POST /api/employees, POST /api/outlets, POST /api/products)
 * to ensure the tenant hasn't exceeded their plan's caps.
 *
 * Reads limits from public.tenants row (max_employees, max_outlets, max_products).
 * Counts current resources via the ALS-scoped tenant DB proxy.
 *
 * Usage in route files:
 *   app.post("/api/employees", requirePlanLimit("employees"), ...)
 */

const RESOURCE_CONFIG = {
  employees: {
    limitColumn: "max_employees",
    countSql: "SELECT COUNT(*) AS cnt FROM employees WHERE deleted_at IS NULL",
    label: "employees",
  },
  outlets: {
    limitColumn: "max_outlets",
    countSql: "SELECT COUNT(*) AS cnt FROM outlets",
    label: "outlets",
  },
  products: {
    limitColumn: "max_products",
    countSql: "SELECT COUNT(*) AS cnt FROM products WHERE deleted_at IS NULL",
    label: "products",
  },
};

/**
 * Returns Express middleware that checks the tenant's plan limit for `resource`.
 * Passes through silently when MULTI_TENANT is not "1".
 *
 * @param {"employees"|"outlets"|"products"} resource
 */
function requirePlanLimit(resource) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw new Error(`Unknown plan-limit resource: ${resource}`);

  return async (req, res, next) => {
    // Skip in single-tenant mode
    if (process.env.MULTI_TENANT !== "1") return next();

    const tenantId = req.tenantId;
    if (!tenantId) return next(); // No tenant context — let downstream auth handle it

    try {
      const masterDb = require("../master-db-pg");
      const { rows: [tenant] } = await masterDb.query(
        `SELECT ${config.limitColumn} AS "planLimit" FROM tenants WHERE id = $1`,
        [tenantId]
      );
      if (!tenant) return next();

      const limit = tenant.planLimit;
      if (limit == null || limit <= 0) return next(); // No limit = unlimited

      // Count current resources — use the ALS-proxied DB (already in tenant context at this point)
      const tenantDbMgr = require("../tenant-db-manager-pg");
      const tenantDb = await tenantDbMgr.getDb(tenantId);
      const { rows: [row] } = await tenantDb.query(config.countSql);
      const current = Number(row?.cnt || 0);

      if (current >= limit) {
        return res.status(403).json({
          error: `Plan limit reached: maximum ${limit} ${config.label} allowed`,
          code: "PLAN_LIMIT_REACHED",
          limit,
          current,
        });
      }
      next();
    } catch (err) {
      // Best-effort — don't block on lookup failure
      console.error("[plan-limits]", err.message);
      next();
    }
  };
}

module.exports = { requirePlanLimit };
```

**Step 2: Commit**

```bash
git add backend/middleware/plan-limits.js
git commit -m "fix: convert plan-limits.js from SQLite callbacks to Postgres async/await"
```

---

### Task 5: Fix currency endpoint for MT mode

`GET /api/company-profile/currency` is public (no auth). In MT mode, it uses `deps.db` (the proxy) which has no ALS context because this endpoint runs without authentication. Fix: accept `?tenant=<slug>` query param and manually resolve the tenant DB.

**Files:**
- Modify: `backend/routes/tier4/company-profile.js:28-44`
- Modify: `frontend/src/contexts/CurrencyContext.jsx:22`

**Step 1: Update the backend currency endpoint**

Replace lines 28-44 in `company-profile.js` with:

```js
  // GET /api/company-profile/currency — public (no auth)
  // Used by CurrencyProvider on frontend mount
  // In MT mode, requires ?tenant=<slug> to resolve correct schema
  router.get("/api/company-profile/currency", async (req, res) => {
    try {
      let queryDb = db;
      if (process.env.MULTI_TENANT === "1" && req.query.tenant) {
        const masterDb = require("../../master-db-pg");
        const tenantDbMgr = require("../../tenant-db-manager-pg");
        const tenant = await masterDb.getTenantBySlug(req.query.tenant);
        if (!tenant) return res.status(404).json({ error: "Tenant not found" });
        queryDb = await tenantDbMgr.getDb(tenant.id);
      }
      const { rows: [row] } = await queryDb.query(
        "SELECT currency_symbol, currency_code, cash_denominations FROM company_profile WHERE id = 1"
      );
      if (!row) return res.json({ symbol: "$", code: "USD", denominations: [100, 50, 20, 10, 5, 1] });
      let denominations;
      try { denominations = JSON.parse(row.cash_denominations || "[]"); } catch { denominations = [100, 50, 20, 10, 5, 1]; }
      res.json({
        symbol: row.currency_symbol || "$",
        code: row.currency_code || "USD",
        denominations,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load currency" });
    }
  });
```

**Step 2: Update CurrencyContext.jsx to pass tenant slug**

In `frontend/src/contexts/CurrencyContext.jsx`, update the import and the fetch URL:

Add import at top:
```js
import { IS_MULTI_TENANT } from "../config";
```

Note: The file uses `const API = import.meta.env.VITE_API_URL || "";` — but the project standard is `VITE_API_BASE`. Fix this to use the correct env var:

```js
const API = import.meta.env.VITE_API_BASE || "";
```

Update the fetch call in `load()` (line 22) to append tenant slug:
```js
  const load = useCallback(async () => {
    try {
      let url = `${API}/api/company-profile/currency`;
      if (IS_MULTI_TENANT) {
        // Read tenant slug from localStorage session
        const raw = localStorage.getItem("authSession");
        const slug = raw ? JSON.parse(raw)?.tenant_slug : null;
        if (slug) url += `?tenant=${encodeURIComponent(slug)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCurrency({
          symbol: data.symbol || "$",
          code: data.code || "USD",
          denominations: Array.isArray(data.denominations) ? data.denominations : [100, 50, 20, 10, 5, 1],
        });
      }
    } catch {
      // Silently use defaults on failure
    }
  }, []);
```

**Step 3: Commit**

```bash
git add backend/routes/tier4/company-profile.js frontend/src/contexts/CurrencyContext.jsx
git commit -m "fix: currency endpoint resolves tenant DB manually in MT mode"
```

---

### Task 6: Create seed-admin-pg.js

The existing `seed-admin.js` uses SQLite. Create a Postgres version for seeding the first super-admin.

**Files:**
- Create: `backend/seed-admin-pg.js`

**Step 1: Create the file**

```js
/**
 * backend/seed-admin-pg.js — CLI to create the first super-admin in public.super_admins (Postgres).
 *
 * Usage:
 *   node backend/seed-admin-pg.js --email admin@example.com --password secret123 --name "Super Admin"
 */
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const bcrypt = require("bcryptjs");
const db = require("./db-pg");
const masterDbPg = require("./master-db-pg");

const BCRYPT_ROUNDS = 10;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    email: get("--email"),
    password: get("--password"),
    name: get("--name") || "Super Admin",
  };
}

async function main() {
  const args = parseArgs();
  if (!args.email || !args.password) {
    console.error("Usage: node seed-admin-pg.js --email <email> --password <password> [--name <name>]");
    process.exit(1);
  }
  if (args.password.length < 8) {
    console.error("Password must be at least 8 characters");
    process.exit(1);
  }

  // Initialize master DB tables
  await masterDbPg.init(db);

  // Check if email already exists
  const { rows: [existing] } = await db.query(
    "SELECT id FROM super_admins WHERE email = $1",
    [args.email.toLowerCase().trim()]
  );

  if (existing) {
    console.log(`Super-admin with email "${args.email}" already exists (id=${existing.id}).`);
    await db.end();
    return;
  }

  const passwordHash = await bcrypt.hash(args.password, BCRYPT_ROUNDS);

  const { rows: [row] } = await db.query(
    "INSERT INTO super_admins (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id",
    [args.email.toLowerCase().trim(), passwordHash, args.name]
  );

  console.log(`Super-admin created: ${args.name} <${args.email}> (id=${row.id})`);
  await db.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add backend/seed-admin-pg.js
git commit -m "feat: add seed-admin-pg.js for Postgres super-admin seeding"
```

---

### Task 7: Create cleanup-public-schema.js

One-time script to drop stale single-tenant business tables from the `public` schema. Only master tables remain.

**Files:**
- Create: `backend/cleanup-public-schema.js`

**Step 1: Create the file**

```js
/**
 * backend/cleanup-public-schema.js — Drop stale single-tenant tables from public schema.
 *
 * Run ONCE after switching to MT mode. Keeps only master tables:
 *   tenants, super_admins, tenant_audit_log, schema_migrations, tenant_refresh_tokens
 *
 * Usage:
 *   node backend/cleanup-public-schema.js [--dry-run]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const db = require("./db-pg");

const MASTER_TABLES = new Set([
  "tenants",
  "super_admins",
  "tenant_audit_log",
  "schema_migrations",
  "tenant_refresh_tokens",
]);

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );

  const toDrop = rows
    .map(r => r.tablename)
    .filter(t => !MASTER_TABLES.has(t));

  if (toDrop.length === 0) {
    console.log("No tables to drop — public schema is clean.");
    await db.end();
    return;
  }

  console.log(`\nTables to drop from public schema (${toDrop.length}):`);
  toDrop.forEach(t => console.log(`  - ${t}`));

  if (dryRun) {
    console.log("\n[DRY RUN] No tables dropped.");
    await db.end();
    return;
  }

  // Drop all at once with CASCADE (handles FK deps)
  const dropSql = `DROP TABLE IF EXISTS ${toDrop.map(t => `public."${t}"`).join(", ")} CASCADE`;
  console.log(`\nExecuting: ${dropSql.slice(0, 200)}...`);
  await db.query(dropSql);

  console.log(`\n✅ Dropped ${toDrop.length} tables from public schema.`);

  // Also drop any sequences left behind
  const { rows: seqs } = await db.query(
    `SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`
  );
  const seqsToDrop = seqs
    .map(s => s.sequencename)
    .filter(s => !s.startsWith("tenants_") && !s.startsWith("super_admins_") &&
                 !s.startsWith("tenant_audit_log_") && !s.startsWith("schema_migrations_") &&
                 !s.startsWith("tenant_refresh_tokens_"));

  if (seqsToDrop.length > 0) {
    const seqSql = `DROP SEQUENCE IF EXISTS ${seqsToDrop.map(s => `public."${s}"`).join(", ")} CASCADE`;
    await db.query(seqSql);
    console.log(`Dropped ${seqsToDrop.length} orphan sequences.`);
  }

  await db.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add backend/cleanup-public-schema.js
git commit -m "feat: add cleanup-public-schema.js for MT go-live"
```

---

### Task 8: Update frontend env + CORS

**Files:**
- Modify: `frontend/.env.production:3`

**Step 1: Set VITE_MULTI_TENANT=1**

Change line 3 in `frontend/.env.production` from:
```
VITE_MULTI_TENANT=0
```
to:
```
VITE_MULTI_TENANT=1
```

**Step 2: Verify CORS on Railway**

Confirm the `CORS_ORIGIN` env var on Railway is set to `https://sanopos.vercel.app` (the production frontend URL). If not set, it defaults to `http://localhost:5173` which will block production requests.

Run this check locally:
```bash
echo "CORS_ORIGIN must be set on Railway to: https://sanopos.vercel.app"
echo "JWT_SECRET and JWT_REFRESH_SECRET must also be set on Railway"
```

**Step 3: Commit**

```bash
git add frontend/.env.production
git commit -m "feat: enable VITE_MULTI_TENANT=1 for production"
```

---

### Task 9: Smoke test the full flow locally

Before deploying, run the backend in MT mode locally to verify the boot sequence works.

**Step 1: Create a local .env for testing**

Ensure `backend/.env` has:
```
DATABASE_URL=<your-supabase-url>
MULTI_TENANT=1
JWT_SECRET=<your-jwt-secret>
JWT_REFRESH_SECRET=<your-refresh-secret>
CORS_ORIGIN=http://localhost:5173
```

**Step 2: Boot the backend**

```bash
cd backend && node index.js
```

Expected: Server starts without errors. No "Not initialized" or "No tenant DB in async context" errors.

**Step 3: Seed the super-admin**

```bash
node backend/seed-admin-pg.js --email sano9942@hotmail.com --password Danish11 --name Hassan
```

Expected: `Super-admin created: Hassan <sano9942@hotmail.com> (id=1)`

**Step 4: Provision a test tenant**

```bash
node backend/tenant-provisioner-pg.js --slug test-store --name "Test Store" --pin 1234
```

Expected: Tenant provisioned successfully with schema `tenant_test_store`.

**Step 5: Test MT login**

```bash
curl -X POST http://localhost:5000/api/auth/mt-login \
  -H "Content-Type: application/json" \
  -d '{"tenant_slug":"test-store","username":"Admin","pin":"1234"}'
```

Expected: JSON response with `token`, `employee`, `permissions`, `tenant`.

**Step 6: Test currency endpoint**

```bash
curl "http://localhost:5000/api/company-profile/currency?tenant=test-store"
```

Expected: JSON response with `symbol`, `code`, `denominations`.

**Step 7: Clean up public schema (optional, run with dry-run first)**

```bash
node backend/cleanup-public-schema.js --dry-run
```

Review the output, then run without `--dry-run` if satisfied.

**Step 8: Commit any fixes**

If any issues were found during smoke testing, fix and commit.

---

### Task 10: Deploy to production

**Step 1: Push the branch**

```bash
git push -u origin feature/multi-tenant-golive
```

**Step 2: Merge to main (user does this manually)**

The user merges `feature/multi-tenant-golive` into `main`.

**Step 3: Set Railway env vars**

On Railway dashboard, set:
- `MULTI_TENANT=1`
- `CORS_ORIGIN=https://sanopos.vercel.app`
- Verify `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
- Verify `DATABASE_URL` is set

**Step 4: Deploy Vercel**

Vercel auto-deploys from `main` push. The `VITE_MULTI_TENANT=1` in `.env.production` will be picked up.

**Step 5: Seed super-admin on Railway**

Use Railway's CLI or console to run:
```bash
node backend/seed-admin-pg.js --email sano9942@hotmail.com --password Danish11 --name Hassan
```

**Step 6: Verify production**

1. Visit `https://sanopos.vercel.app` — should show the MT login page (with Store Code field)
2. Visit `https://sanopos.vercel.app/admin` — log in as super-admin
3. Provision a tenant from the admin dashboard
4. Complete the setup wizard for the new tenant
5. Log in as the new tenant's admin via POS login

**Rollback if needed:**
- Railway: Set `MULTI_TENANT=0`
- Vercel: Revert `.env.production` to `VITE_MULTI_TENANT=0` and redeploy
- No data changes need reverting (fresh start)
