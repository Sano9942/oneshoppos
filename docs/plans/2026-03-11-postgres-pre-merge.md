# Postgres Pre-Merge Tasks — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete 4 pre-merge tasks so the `feature/postgres-migration` branch can ship: boolean audit, migration system, production cutover script, and multi-tenant Postgres infrastructure.

**Architecture:** The backend is fully converted to Postgres async/await (340/340 tests). However, 4 files were missed during conversion (`email.js`, `printer.js` routes+service, `registerAllRoutes.js` feature flags/health/outlet-check). These still use SQLite `db.get/run/all` callbacks and must be converted to `await db.query()` before the boolean audit makes sense. The migration system replaces SQLite's `migrate*.js` files with a `schema_version` table. The cutover script migrates data from SQLite to Postgres. The MT infra replaces file-based SQLite tenant DBs with Postgres schema-switching.

**Tech Stack:** `pg` (node-postgres), Express v5, async/await, `better-sqlite3` (for one-time data migration reader).

**Branch:** `feature/postgres-migration` (continue existing work)

---

## Task 1: Boolean Audit + Convert Remaining SQLite Files

### Discovery

**Frontend:** All `.jsx`/`.js` files use the defensive `Number(value || 0) === 1` pattern — **zero frontend fixes needed**. The `Number()` wrapper handles both SQLite integers and Postgres booleans identically.

**Backend — 4 files still use SQLite callbacks and `? 1 : 0` boolean coercion:**

| File | SQLite calls | Boolean issues | Lines |
|------|-------------|----------------|-------|
| `backend/routes/email.js` | 6 (`db.get`, `db.run`, `db.all`) | `enabled ? 1 : 0`, `is_active = 1` | 28, 67, 71, 125, 138, 145, 152-153 |
| `backend/routes/printer.js` | 2 (`db.get`, `db.run`) | `cash_drawer ? 1 : 0`, `is_active ? 1 : 0` | 45, 59-79 |
| `backend/services/printer.js` | 1 (`db.get` via Promise wrapper) | None (reads only) | 21 |
| `backend/routes/registerAllRoutes.js` | 4 (`db.get`, `db.all`, `db.run`) | `? 1 : 0` on `enabled`, `sqlite_master` query, `datetime('now')` | 92-105, 194-229, 239-257, 269-289 |
| `backend/routes/barcode-expenses.js` | 0 (already PG async/await) | `show_* ? 1 : 0`, `is_default ? 1 : 0` | 39, 47-53, 87, 95-101 |

### Task 1.1: Convert `email.js` to Postgres async/await

**Files:**
- Modify: `backend/routes/email.js`

**Step 1: Convert the file**

Full conversion — replace all `db.get/run/all` callbacks with `await db.query()`:

```js
/**
 * Email routes — SMTP receipt delivery
 */
const nodemailer = require("nodemailer");
const { buildReceiptEmailHtml } = require("../utils/receiptEmail");

module.exports = function emailRoutes(app, deps) {
  const { db } = deps;

  function authGuard(req, res) {
    const employeeId = Number(req.headers["x-employee-id"] || 0);
    if (!employeeId) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  async function getConfig() {
    const { rows } = await db.query("SELECT * FROM email_config WHERE id = 1");
    return rows[0] || null;
  }

  function makeTransport(cfg) {
    return nodemailer.createTransport({
      host: cfg.smtp_host,
      port: Number(cfg.smtp_port || 587),
      secure: Number(cfg.smtp_port) === 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    });
  }

  // GET /api/email/config
  app.get("/api/email/config", async (req, res) => {
    if (!authGuard(req, res)) return;
    try {
      const cfg = (await getConfig()) || {};
      if (cfg.smtp_pass) cfg.smtp_pass = "*****";
      res.json(cfg);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/email/config
  app.put("/api/email/config", async (req, res) => {
    if (!authGuard(req, res)) return;
    const { smtp_host, smtp_port, smtp_user, smtp_pass, from_name, enabled } =
      req.body || {};

    const updatePass = smtp_pass && smtp_pass !== "*****";
    const passClause = updatePass ? ", smtp_pass = $6" : "";
    // $1=smtp_host, $2=smtp_port, $3=smtp_user, $4=from_name, $5=enabled
    // $6=smtp_pass (optional)
    const params = [
      smtp_host || "smtp.gmail.com",
      Number(smtp_port || 587),
      smtp_user || null,
      from_name || "SanoPOS",
      enabled != null ? (enabled ? true : false) : false,
    ];
    if (updatePass) params.push(smtp_pass);

    try {
      const { rowCount } = await db.query(
        `UPDATE email_config SET
           smtp_host = $1, smtp_port = $2, smtp_user = $3${passClause},
           from_name = $4, enabled = $5
         WHERE id = 1`,
        // Reorder params: when passClause is present, smtp_pass is $6 but
        // from_name and enabled stay at $4/$5 — we need to adjust.
        // Simpler: always use numbered params in order.
        updatePass
          ? [params[0], params[1], params[2], params[3], params[4], params[5]]
          : params
      );
      if (rowCount === 0)
        return res.status(500).json({ error: "Config row missing. Run schema-pg.sql." });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/email/test
  app.post("/api/email/test", async (req, res) => {
    if (!authGuard(req, res)) return;
    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }
      const transport = makeTransport(cfg);
      await transport.sendMail({
        from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
        to: cfg.smtp_user,
        subject: "SanoPOS — Email Test",
        html: "<p>Email is configured correctly!</p>",
      });
      res.json({ ok: true, message: "Test email sent to " + cfg.smtp_user });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/email/send-receipt
  app.post("/api/email/send-receipt", async (req, res) => {
    if (!authGuard(req, res)) return;
    const { saleId, toEmail } = req.body || {};

    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: "Valid email address is required." });
    }
    if (!saleId) return res.status(400).json({ error: "saleId is required." });

    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.enabled || !cfg.smtp_user || !cfg.smtp_pass) {
        return res.status(503).json({ error: "Email not configured. Go to Settings → Email." });
      }

      const { rows: [sale] } = await db.query(
        `SELECT s.*, o.name as outlet_name, e.name as employee_name,
                c.name as customer_name
         FROM sales s
         LEFT JOIN outlets o ON s.outlet_id = o.id
         LEFT JOIN employees e ON s.employee_id = e.id
         LEFT JOIN customers c ON s.customer_id = c.id
         WHERE s.id = $1`,
        [saleId]
      );
      if (!sale) return res.status(404).json({ error: "Sale not found." });

      const { rows: items } = await db.query(
        `SELECT si.*, p.name as product_name FROM sale_items si
         JOIN products p ON si.product_id = p.id WHERE si.sale_id = $1`,
        [saleId]
      );

      const { rows: payments } = await db.query(
        "SELECT * FROM sale_payments WHERE sale_id = $1",
        [saleId]
      );

      const { rows: [template] } = await db.query(
        "SELECT * FROM receipt_templates WHERE is_active = true LIMIT 1"
      );

      const html = buildReceiptEmailHtml(sale, items || [], payments || [], template || null);

      const transport = makeTransport(cfg);
      await transport.sendMail({
        from: `"${cfg.from_name || "SanoPOS"}" <${cfg.smtp_user}>`,
        to: toEmail,
        subject: `Receipt #${sale.invoice_number || sale.id} from ${cfg.from_name || "SanoPOS"}`,
        html,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
```

Key changes:
- `getConfig` is now `async` returning `rows[0]` directly (no callback)
- `enabled ? 1 : 0` → `enabled ? true : false`
- `is_active = 1` → `is_active = true`
- `?` params → `$1, $2, $3` numbered params
- All route handlers are `async`, nested callback pyramids flattened
- `db.get/run/all` → `await db.query()`

---

### Task 1.2: Convert `services/printer.js` to Postgres

**Files:**
- Modify: `backend/services/printer.js`

**Step 1: Convert `loadConfig` from SQLite callback to Postgres**

Only 1 change — the `loadConfig` function:

```js
// Before:
function loadConfig() {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM printer_config WHERE id = 1", (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

// After:
async function loadConfig() {
  const { rows } = await db.query("SELECT * FROM printer_config WHERE id = 1");
  return rows[0] || null;
}
```

Rest of the file is pure JS logic (ESC/POS formatting, TCP pings) — no DB calls.

---

### Task 1.3: Convert `routes/printer.js` to Postgres async/await

**Files:**
- Modify: `backend/routes/printer.js`

**Step 1: Convert GET/PUT config routes**

```js
// GET /api/print/config — convert from db.get callback to async
app.get("/api/print/config", async (req, res) => {
  const employeeId = Number(req.headers["x-employee-id"] || 0);
  if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await db.query("SELECT * FROM printer_config WHERE id = 1");
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/print/config — convert from db.run callback to async, fix booleans
app.put("/api/print/config", async (req, res) => {
  const employeeId = Number(req.headers["x-employee-id"] || 0);
  if (!employeeId) return res.status(401).json({ error: "Unauthorized" });
  const {
    connection_type, host, port, usb_vendor_id, usb_product_id,
    paper_width, cash_drawer, is_active,
  } = req.body || {};
  try {
    await db.query(
      `UPDATE printer_config SET
        connection_type = $1, host = $2, port = $3,
        usb_vendor_id = $4, usb_product_id = $5,
        paper_width = $6, cash_drawer = $7, is_active = $8
       WHERE id = 1`,
      [
        connection_type || "network",
        host || "192.168.1.100",
        Number(port) || 9100,
        usb_vendor_id || null,
        usb_product_id || null,
        Number(paper_width) || 48,
        cash_drawer ? true : false,
        is_active ? true : false,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

Key changes:
- `cash_drawer ? 1 : 0` → `cash_drawer ? true : false`
- `is_active ? 1 : 0` → `is_active ? true : false`
- `db.get/run` callbacks → `await db.query()` with `$N` params
- Both routes now `async`

---

### Task 1.4: Convert `registerAllRoutes.js` SQLite calls to Postgres

**Files:**
- Modify: `backend/routes/registerAllRoutes.js`

**4 SQLite calls to convert:**

#### 1. Outlet assignment check (lines 92-105)

```js
// Before: db.get callback
db.get(
  "SELECT 1 FROM employee_outlets WHERE employee_id = ? AND outlet_id = ? LIMIT 1",
  [employeeId, outletId],
  (err, row) => { ... }
);

// After: async middleware (Express v5 supports async)
app.use(async (req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path.startsWith("/api/attendance/pin-")) return next();
  const employeeId = Number(req.headers["x-employee-id"] || 0);
  if (!employeeId) return next();
  const perms = req.employeePerms || [];
  if (perms.includes("all_access")) return next();

  const headerOutletId = Number(req.headers["x-outlet-id"] || 0);
  const contextOutletId = Number(req.context?.outletId || 0);
  const queryOutletId = Number(req.query?.outlet_id || 0);
  const bodyOutletId = Number(req.body?.outlet_id || 0);
  const outletId = contextOutletId || headerOutletId || queryOutletId || bodyOutletId;
  if (!outletId) return next();

  try {
    const { rows } = await db.query(
      "SELECT 1 FROM employee_outlets WHERE employee_id = $1 AND outlet_id = $2 LIMIT 1",
      [employeeId, outletId]
    );
    if (!rows[0]) {
      return res.status(403).json({
        error: "Forbidden: outlet is not assigned to this employee account.",
      });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 2. GET /api/feature-flags (lines 189-230)

```js
app.get("/api/feature-flags", async (req, res) => {
  const employeeId = Number(req.headers["x-employee-id"] || 0);
  if (!employeeId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { rows } = await db.query(
      "SELECT key, enabled, description, updated_by, updated_at FROM feature_flags ORDER BY key ASC"
    );
    const rowMap = new Map((rows || []).map((r) => [r.key, r]));
    const mergedDefaults = Object.keys(DEFAULT_FEATURE_FLAGS).map((key) => {
      const existing = rowMap.get(key);
      if (existing) return existing;
      return {
        key,
        enabled: DEFAULT_FEATURE_FLAGS[key] ? true : false,
        description: null,
        updated_by: null,
        updated_at: null,
      };
    });
    const extras = (rows || []).filter(
      (r) => !Object.prototype.hasOwnProperty.call(DEFAULT_FEATURE_FLAGS, r.key),
    );
    return res.json({ flags: [...mergedDefaults, ...extras] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

Key changes:
- Removed `"no such table"` error fallback (Postgres tables always exist via schema-pg.sql)
- `? 1 : 0` → `? true : false`
- `db.all` callback → `await db.query()`

#### 3. PUT /api/feature-flags/:key (lines 232-258)

```js
app.put(
  "/api/feature-flags/:key",
  requirePerm("all_access"),
  async (req, res) => {
    const { key } = req.params;
    const { enabled, description, updated_by } = req.body || {};
    const enabledBool = enabled ? true : false;
    try {
      await db.query(
        `INSERT INTO feature_flags (key, enabled, description, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT(key) DO UPDATE SET
           enabled = EXCLUDED.enabled,
           description = COALESCE(EXCLUDED.description, feature_flags.description),
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [key, enabledBool, description || null, updated_by || null]
      );
      res.json({ message: "Feature flag updated", key, enabled: enabledBool });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);
```

Key changes:
- `enabledInt` → `enabledBool` (`true`/`false`)
- `datetime('now')` → `NOW()`
- `excluded.` → `EXCLUDED.` (Postgres convention, case doesn't matter but be consistent)
- `?` → `$1, $2, $3, $4`
- `db.run` callback with `function(err)` → `await db.query()`

#### 4. GET /api/health (lines 260-289)

```js
app.get("/api/health", async (req, res) => {
  const requiredTables = [
    "sales", "sale_items", "sale_payments",
    "backup_log", "invoice_sequences", "feature_flags",
  ];
  try {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = CURRENT_SCHEMA()
         AND table_name = ANY($1)`,
      [requiredTables]
    );
    const found = new Set((rows || []).map((r) => r.table_name));
    const missingTables = requiredTables.filter((t) => !found.has(t));
    const ok = missingTables.length === 0;
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      database: "reachable",
      restore_lock: runtimeState.isRestoreInProgress,
      missing_tables: missingTables,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});
```

Key change:
- `sqlite_master WHERE type='table'` → `information_schema.tables WHERE table_schema = CURRENT_SCHEMA()`
- `name` → `table_name`
- Uses `ANY($1)` with array param instead of `IN (?,?,?)`

---

### Task 1.5: Fix boolean coercion in `barcode-expenses.js`

**Files:**
- Modify: `backend/routes/barcode-expenses.js`

This file is already Postgres async/await but still writes `? 1 : 0` for boolean columns.

**POST route (lines 47-53):** Change 6 values:
```js
// Before:
show_name ? 1 : 0,
show_price ? 1 : 0,
show_barcode ? 1 : 0,
show_sku ? 1 : 0,
show_brand ? 1 : 0,
// ...
is_default ? 1 : 0,

// After:
show_name ? true : false,
show_price ? true : false,
show_barcode ? true : false,
show_sku ? true : false,
show_brand ? true : false,
// ...
is_default ? true : false,
```

Also fix the `is_default` reset inside the transaction (line 39):
```js
// Before:
await client.query("UPDATE barcode_templates SET is_default = 0");
// After:
await client.query("UPDATE barcode_templates SET is_default = false");
```

**PUT route (lines 87, 95-101):** Same 6+1 changes.

---

### Task 1.6: Run Postgres tests to verify no regressions

**Step 1:** Run all existing pg tests:

```bash
cd backend && DATABASE_URL=postgresql://localhost:5432/oneshoppos_test npx jest tests/integration/pg-batch --no-cache
```

Expected: 340/340 tests pass, 0 failures

**Step 2:** Commit

```bash
git add backend/routes/email.js backend/routes/printer.js backend/services/printer.js backend/routes/registerAllRoutes.js backend/routes/barcode-expenses.js
git commit -m "fix: frontend+backend boolean audit for Postgres true/false compatibility

Convert 4 remaining SQLite-callback files (email.js, printer.js routes+service,
registerAllRoutes.js) to Postgres async/await. Fix boolean coercion (? 1 : 0 →
? true : false) in barcode-expenses.js. Frontend requires zero changes — all
Number(val || 0) === 1 patterns handle both SQLite and Postgres."
```

---

## Task 2: Migration System Replacement

### Task 2.1: Add `schema_version` table to `schema-pg.sql`

**Files:**
- Modify: `backend/schema-pg.sql`

**Step 1: Add at the end of schema-pg.sql:**

```sql
-- ── Schema versioning ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Task 2.2: Create `backend/migrate-pg.js`

**Files:**
- Create: `backend/migrate-pg.js`

```js
#!/usr/bin/env node
/**
 * migrate-pg.js — Postgres schema migration runner.
 *
 * Replaces the SQLite-specific run_migrations.js for Postgres deployments.
 * Reads schema_version table to determine current version, then applies
 * any unapplied migrations in order.
 *
 * Usage:
 *   node backend/migrate-pg.js              # runs against DATABASE_URL
 *   DATABASE_URL=... node backend/migrate-pg.js
 *
 * Version 1 = initial schema from schema-pg.sql (idempotent — all CREATE IF NOT EXISTS).
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_SQL_PATH = path.join(__dirname, "schema-pg.sql");

/**
 * Ordered list of migrations. Each entry:
 *   { version: number, description: string, up: async (client) => void }
 *
 * Version 1 applies the full schema-pg.sql — safe to re-run because every
 * statement uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema from schema-pg.sql",
    up: async (client) => {
      const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
      await client.query(sql);
    },
  },
  // Future migrations go here:
  // {
  //   version: 2,
  //   description: "Add foo column to bar table",
  //   up: async (client) => {
  //     await client.query("ALTER TABLE bar ADD COLUMN IF NOT EXISTS foo TEXT");
  //   },
  // },
];

async function migrate(db) {
  // Ensure schema_version table exists (bootstrap)
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get current version
  const { rows } = await db.query(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
  );
  const currentVersion = rows[0]?.version || 0;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(`[migrate-pg] Schema is up to date (version ${currentVersion}).`);
    return currentVersion;
  }

  console.log(
    `[migrate-pg] Current version: ${currentVersion}, applying ${pending.length} migration(s)...`
  );

  for (const m of pending) {
    console.log(`[migrate-pg]   v${m.version}: ${m.description}`);
    await db.transaction(async (client) => {
      await m.up(client);
      await client.query(
        "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [m.version]
      );
    });
    console.log(`[migrate-pg]   v${m.version}: ✓ applied`);
  }

  const finalVersion = pending[pending.length - 1].version;
  console.log(`[migrate-pg] Migration complete. Schema version: ${finalVersion}`);
  return finalVersion;
}

// CLI entry point
if (require.main === module) {
  const db = require("./db-pg");
  migrate(db)
    .then(() => db.end())
    .catch((err) => {
      console.error("[migrate-pg] FATAL:", err.message);
      process.exit(1);
    });
}

module.exports = { migrate, MIGRATIONS };
```

---

### Task 2.3: Update `start.sh` for Postgres mode

**Files:**
- Modify: `backend/start.sh`

```bash
#!/bin/sh
# Production startup: run migrations then start server
set -e

# Set timezone explicitly so datetime functions return correct local time
export TZ="${TZ:-Asia/Karachi}"

if [ -n "$DATABASE_URL" ]; then
  # ── Postgres mode ──
  echo "[startup] Postgres mode (DATABASE_URL set)"
  echo "[startup] Running Postgres migrations..."
  node migrate-pg.js
  echo "[startup] Starting server..."
  exec node index.js
else
  # ── SQLite mode (legacy) ──
  mkdir -p "${DATA_DIR:-/data}"
  DB_FILE="${DATA_DIR:-/data}/sanopos.db"
  ln -sf "$DB_FILE" /app/sanopos.db
  echo "[startup] DB path: $DB_FILE"
  echo "[startup] Running SQLite migrations..."
  node run_migrations.js || echo "[startup] Migrations completed (some may have been already applied)"
  echo "[startup] Starting server..."
  exec node index.js
fi
```

---

### Task 2.4: Wire migration into `index.js` boot (optional — start.sh handles it)

No changes to `index.js` needed — `start.sh` runs `migrate-pg.js` before `index.js`. The schema_version table is created by `migrate-pg.js` at boot.

---

### Task 2.5: Run tests + commit

```bash
cd backend && DATABASE_URL=postgresql://localhost:5432/oneshoppos_test npx jest tests/integration/pg-batch --no-cache
```

Expected: 340/340 pass (schema-pg.sql change is additive — IF NOT EXISTS)

```bash
git add backend/schema-pg.sql backend/migrate-pg.js backend/start.sh
git commit -m "feat: add Postgres migration system with schema_version tracking

- Add schema_version table to schema-pg.sql
- Create migrate-pg.js — ordered migration runner with transaction safety
- Version 1 = initial schema (idempotent via IF NOT EXISTS)
- Update start.sh to detect DATABASE_URL and run migrate-pg.js
- SQLite mode preserved when DATABASE_URL is not set"
```

---

## Task 3: Production Cutover Preparation

### Task 3.1: Install `better-sqlite3` as optional dependency

**Step 1:**

```bash
cd backend && npm install --save-optional better-sqlite3
```

Why `better-sqlite3` instead of the existing `sqlite3` module: synchronous reads are much simpler for a one-time migration script — no callback nesting. The existing `sqlite3` async module would require deep callback pyramids for reading 40+ tables.

---

### Task 3.2: Create `backend/scripts/sqlite-to-pg.js`

**Files:**
- Create: `backend/scripts/sqlite-to-pg.js`

This is a one-time data migration script. It:
1. Opens SQLite `sanopos.db` with `better-sqlite3` (synchronous reads)
2. Connects to Postgres via `DATABASE_URL`
3. Runs `schema-pg.sql` to ensure all tables exist
4. For each table: reads all rows from SQLite, inserts into Postgres with type conversion
5. Resets SERIAL sequences after bulk insert
6. Wraps each table's migration in a transaction

```js
#!/usr/bin/env node
/**
 * sqlite-to-pg.js — One-time data migration from SQLite to Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node backend/scripts/sqlite-to-pg.js [path/to/sanopos.db]
 *
 * Defaults to backend/sanopos.db if no path argument given.
 */

const fs = require("fs");
const path = require("path");

// Table migration order — respects foreign key dependencies.
// Tables with no FK deps come first; tables referencing them come after.
const TABLE_ORDER = [
  // Foundation (no FK deps)
  "categories",
  "taxes",
  "brands",
  "suppliers",
  "roles",
  "company_profile",

  // Depends on roles
  "role_permissions",

  // Depends on roles, categories
  "employees",

  // Depends on employees
  "employee_outlets",
  "employee_attendance",
  "attendance_sessions",

  // Depends on categories, brands, taxes
  "products",
  "product_variants",
  "product_images",
  "product_taxes",
  "attribute_sets",
  "attribute_set_values",

  // Outlets
  "outlets",
  "outlet_stock",

  // Customers
  "customers",
  "customer_wallet",
  "loyalty_points",
  "loyalty_transactions",

  // Sales
  "invoice_sequences",
  "cash_shifts",
  "sales",
  "sale_items",
  "sale_payments",
  "sale_commissions",
  "returns",
  "return_items",

  // Inventory
  "inventory_transfers",
  "transfer_items",
  "stock_adjustments",
  "adjustment_items",

  // Purchase orders
  "purchase_orders",
  "purchase_order_items",
  "goods_received_notes",
  "grn_items",
  "supplier_invoices",
  "supplier_payments",

  // Promotions
  "promotions",
  "promotion_categories",
  "promotion_products",
  "promotion_outlets",

  // Feature flags
  "feature_flags",

  // Shopify
  "shopify_connections",
  "shopify_location_map",
  "shopify_product_metadata",
  "external_sync_events",
  "web_orders",
  "web_order_items",

  // Reports & governance
  "report_schedules",
  "report_schedule_runs",
  "report_delivery_log",
  "saved_report_views",

  // Misc
  "action_history",
  "notifications",
  "parked_sales",
  "parked_sale_items",
  "barcode_templates",
  "receipt_templates",
  "printer_config",
  "email_config",
  "backup_log",
  "expenses",

  // Tier 4
  "crm_activities",
  "quotations",
  "quotation_items",
  "accounting_journal",
  "payroll_items",
  "approval_requests",
  "approval_steps",

  // Reconciliation
  "inventory_reconciliation",
  "reconciliation_items",
  "reconciliation_adjustments",

  // Serial numbers & gift cards
  "serial_numbers",
  "gift_cards",

  // Supplier returns
  "supplier_returns",
  "supplier_return_items",

  // Token revocation
  "revoked_tokens",

  // Schema version
  "schema_version",
];

// Boolean columns per table (SQLite stores as 0/1, Postgres needs true/false)
const BOOLEAN_COLUMNS = {
  categories: ["is_active"],
  taxes: ["is_default"],
  employees: ["is_active"],
  employee_outlets: ["is_primary"],
  products: ["is_active"],
  product_variants: ["is_active"],
  promotions: ["active", "auto_apply"],
  feature_flags: ["enabled"],
  shopify_connections: ["is_active"],
  receipt_templates: ["is_active", "show_barcode", "show_logo"],
  barcode_templates: ["show_name", "show_price", "show_barcode", "show_sku", "show_brand", "is_default"],
  printer_config: ["cash_drawer", "is_active"],
  email_config: ["enabled"],
  notifications: ["is_read"],
  web_orders: ["stock_applied"],
  company_profile: ["setup_complete"],
  outlets: ["is_active"],
  sales: ["is_exchange"],
  returns: ["voided"],
  roles: [],
  suppliers: [],
  brands: [],
};

async function main() {
  // Lazy-require so script fails fast with a helpful message if not installed
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error("ERROR: better-sqlite3 is required. Run: npm install better-sqlite3");
    process.exit(1);
  }

  const sqlitePath = process.argv[2] || path.join(__dirname, "..", "sanopos.db");
  if (!fs.existsSync(sqlitePath)) {
    console.error(`ERROR: SQLite DB not found at ${sqlitePath}`);
    process.exit(1);
  }

  const db = require("../db-pg");
  const schemaSql = fs.readFileSync(path.join(__dirname, "..", "schema-pg.sql"), "utf8");

  console.log(`[sqlite-to-pg] Source: ${sqlitePath}`);
  console.log(`[sqlite-to-pg] Target: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}\n`);

  // Step 1: Ensure Postgres schema exists
  console.log("[sqlite-to-pg] Applying schema-pg.sql...");
  await db.query(schemaSql);

  // Step 2: Open SQLite
  const sqlite = new Database(sqlitePath, { readonly: true });

  // Step 3: Get list of tables that actually exist in SQLite
  const sqliteTables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  );

  let totalRows = 0;
  let tablesProcessed = 0;

  for (const table of TABLE_ORDER) {
    if (!sqliteTables.has(table)) {
      console.log(`  [skip] ${table} — not in SQLite`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`  [skip] ${table} — empty`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const boolCols = new Set(BOOLEAN_COLUMNS[table] || []);

    // Convert values
    function convertValue(col, val) {
      if (val === null || val === undefined) return null;
      if (boolCols.has(col)) return val === 1 || val === true || val === "1";
      return val;
    }

    // Bulk insert in a transaction
    const placeholderRow = columns.map((_, i) => `$${i + 1}`).join(", ");
    const insertSql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholderRow}) ON CONFLICT DO NOTHING`;

    await db.transaction(async (client) => {
      for (const row of rows) {
        const values = columns.map((col) => convertValue(col, row[col]));
        await client.query(insertSql, values);
      }
    });

    // Reset sequence for SERIAL columns
    try {
      await db.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
    } catch {
      // Table may not have a serial 'id' column — ignore
    }

    totalRows += rows.length;
    tablesProcessed++;
    console.log(`  [done] ${table} — ${rows.length} rows`);
  }

  sqlite.close();
  console.log(`\n[sqlite-to-pg] Migration complete: ${tablesProcessed} tables, ${totalRows} rows`);

  // Step 4: Insert schema version
  await db.query(
    "INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING"
  );

  await db.end();
}

main().catch((err) => {
  console.error("[sqlite-to-pg] FATAL:", err.message);
  process.exit(1);
});
```

---

### Task 3.3: Create cutover checklist

**Files:**
- Create: `docs/POSTGRES-CUTOVER-CHECKLIST.md`

```markdown
# Postgres Cutover Checklist

One-time migration from Railway SQLite to Postgres. Target downtime: < 5 minutes.

## Pre-Cutover

- [ ] Provision Postgres instance (Supabase free tier or Railway Postgres addon)
- [ ] Note the `DATABASE_URL` connection string
- [ ] Install `better-sqlite3` locally: `cd backend && npm install better-sqlite3`
- [ ] Download production SQLite DB from Railway volume (`/data/sanopos.db`)
- [ ] Test migration locally:
  ```bash
  DATABASE_URL=postgresql://localhost:5432/oneshoppos_staging \
    node backend/scripts/sqlite-to-pg.js path/to/downloaded/sanopos.db
  ```
- [ ] Verify data integrity: spot-check row counts for `sales`, `products`, `employees`
- [ ] Run the app locally against the staging Postgres to verify all flows work

## Cutover (During Maintenance Window)

1. **Announce maintenance** — brief POS downtime notice
2. **Stop Railway deployment** — pause the service to prevent new writes
3. **Download latest SQLite DB** — `railway volume download sanopos.db`
4. **Run migration script:**
   ```bash
   DATABASE_URL=<production_postgres_url> \
     node backend/scripts/sqlite-to-pg.js sanopos.db
   ```
5. **Set Railway env vars:**
   - `DATABASE_URL=<production_postgres_url>`
   - Remove `DATA_DIR` (no longer needed)
   - Keep `TZ=Asia/Karachi`
   - Keep `MULTI_TENANT=0`
6. **Redeploy Railway** — `start.sh` will detect `DATABASE_URL` and run `migrate-pg.js`
7. **Verify:** `GET /api/health` → `{"status":"ok","missing_tables":[]}`
8. **Test:** Login, make a test sale, check reports

## Post-Cutover

- [ ] Keep Railway SQLite volume for 1 week as rollback safety net
- [ ] Monitor error logs for 24 hours
- [ ] After 1 week with no issues, remove the SQLite volume from Railway
- [ ] Remove `better-sqlite3` from `package.json` (optional dependency, only needed for migration)
- [ ] Update `VITE_API_BASE` in Vercel if backend URL changes

## Rollback Plan

If critical issues are found after cutover:
1. Remove `DATABASE_URL` env var from Railway
2. Re-add `DATA_DIR=/data`
3. Redeploy — app will boot in SQLite mode using the preserved volume
4. Investigate and fix the Postgres issue before retrying
```

---

### Task 3.4: Commit

```bash
git add backend/scripts/sqlite-to-pg.js docs/POSTGRES-CUTOVER-CHECKLIST.md backend/package.json
git commit -m "feat: add SQLite-to-Postgres data migration script and cutover checklist

- backend/scripts/sqlite-to-pg.js: one-time migration using better-sqlite3
  (synchronous reads) → Postgres (async writes). Handles boolean 0/1→true/false
  conversion, FK-ordered table insertion, SERIAL sequence resets.
- docs/POSTGRES-CUTOVER-CHECKLIST.md: step-by-step production cutover guide
  with rollback plan."
```

---

## Task 4: Multi-Tenant Postgres Infrastructure

### Task 4.1: Create `backend/tenant-db-manager-pg.js`

**Files:**
- Create: `backend/tenant-db-manager-pg.js`

This replaces the SQLite file-pool approach with Postgres schema-switching. Key difference: instead of opening separate DB files per tenant, we use a single shared `pg.Pool` and `SET search_path` per request.

```js
/**
 * tenant-db-manager-pg.js — Postgres schema-based multi-tenant DB manager.
 *
 * Instead of separate SQLite files per tenant, all tenants share one Postgres
 * instance with separate schemas (tenant_<slug>). Per-request isolation is
 * achieved via SET search_path.
 *
 * This module provides a thin wrapper that creates schema-scoped "db" objects
 * which prepend SET search_path before every query.
 */

const masterDbPg = require("./master-db-pg");

let _pool = null;

// Cache of tenantId → { slug, status }
const _tenantCache = new Map();
const CACHE_TTL_MS = 60_000;
const _cacheTimestamps = new Map();

/**
 * Initialize with the shared pg.Pool wrapper (db-pg.js).
 */
function init(db) {
  _pool = db;
}

/**
 * Returns a scoped DB object for a tenant that prepends SET search_path
 * to every transaction/query. The returned object has the same API as db-pg.js:
 *   { query, transaction, getClient }
 */
async function getDb(tenantId) {
  if (!_pool) throw new Error("[tenant-db-manager-pg] Not initialized — call init(db) first");

  // Resolve tenant slug (with cache)
  const cached = _tenantCache.get(tenantId);
  const now = Date.now();
  let tenant;

  if (cached && (now - (_cacheTimestamps.get(tenantId) || 0)) < CACHE_TTL_MS) {
    tenant = cached;
  } else {
    tenant = await masterDbPg.getTenantById(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    _tenantCache.set(tenantId, tenant);
    _cacheTimestamps.set(tenantId, now);
  }

  if (tenant.status === "suspended") throw new Error(`Tenant ${tenantId} is suspended`);
  if (tenant.status === "deleted" || tenant.deleted_at) throw new Error(`Tenant ${tenantId} is deleted`);

  const schemaName = `tenant_${tenant.slug}`;

  // Return a scoped db-like object
  return {
    /**
     * Run a query with search_path scoped to this tenant's schema.
     */
    query: async (sql, params) => {
      const client = await _pool.pool.connect();
      try {
        await client.query(`SET search_path TO '${schemaName}', public`);
        return await client.query(sql, params);
      } finally {
        await client.query("SET search_path TO public").catch(() => {});
        client.release();
      }
    },

    /**
     * Run a transaction scoped to this tenant's schema.
     */
    transaction: async (fn) => {
      const client = await _pool.pool.connect();
      try {
        await client.query(`SET search_path TO '${schemaName}', public`);
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        await client.query("SET search_path TO public").catch(() => {});
        client.release();
      }
    },

    /**
     * Get a client with search_path pre-set. Caller MUST release.
     */
    getClient: async () => {
      const client = await _pool.pool.connect();
      await client.query(`SET search_path TO '${schemaName}', public`);
      return client;
    },
  };
}

/**
 * Health check for a tenant schema.
 */
async function healthCheck(tenantId) {
  const db = await getDb(tenantId);
  const { rows } = await db.query("SELECT 1 AS alive");
  if (!rows[0]) throw new Error(`Health check failed for tenant ${tenantId}`);
  return { ok: true, tenantId };
}

/**
 * Clear tenant cache (e.g., after suspend/activate).
 */
function clearCache(tenantId) {
  if (tenantId) {
    _tenantCache.delete(tenantId);
    _cacheTimestamps.delete(tenantId);
  } else {
    _tenantCache.clear();
    _cacheTimestamps.clear();
  }
}

/**
 * No-op for Postgres — the shared pool is managed by db-pg.js.
 * Provided for API compatibility with the SQLite tenant-db-manager.
 */
function closeDb() { return Promise.resolve(); }
function closeAll() { return Promise.resolve(); }

module.exports = { init, getDb, healthCheck, clearCache, closeDb, closeAll };
```

---

### Task 4.2: Create `backend/tenant-db-proxy-pg.js`

**Files:**
- Create: `backend/tenant-db-proxy-pg.js`

This is the Postgres equivalent of `tenant-db-proxy.js`. Same AsyncLocalStorage pattern, but the proxied methods are `query`, `transaction`, `getClient` instead of `get`, `run`, `all`, `serialize`.

```js
/**
 * tenant-db-proxy-pg.js — AsyncLocalStorage-based DB proxy for Postgres multi-tenant.
 *
 * When MULTI_TENANT=1 and DATABASE_URL is set, this module's `dbProxy` replaces
 * the singleton `db` in deps. All route closures that captured `db` at boot time
 * now transparently hit the current request's tenant-scoped DB via AsyncLocalStorage.
 */
const { AsyncLocalStorage } = require("async_hooks");

const asyncStore = new AsyncLocalStorage();

/**
 * Returns the tenant-scoped DB object from the current async context.
 * Throws if called outside a request context.
 */
function getCurrentDb() {
  const store = asyncStore.getStore();
  if (!store || !store.db) {
    throw new Error("[tenant-db-proxy-pg] No tenant DB in async context");
  }
  return store.db;
}

// Postgres db-pg.js methods that route handlers use:
const PROXIED_METHODS = ["query", "transaction", "getClient"];

/**
 * Creates a Proxy that looks like a db-pg.js pool wrapper but delegates
 * every call to the tenant's scoped DB from AsyncLocalStorage.
 */
function createDbProxy() {
  const handler = {
    get(_target, prop) {
      if (PROXIED_METHODS.includes(prop)) {
        return function (...args) {
          const realDb = getCurrentDb();
          return realDb[prop](...args);
        };
      }
      // For any other property, delegate to current tenant DB
      const realDb = getCurrentDb();
      const val = realDb[prop];
      return typeof val === "function" ? val.bind(realDb) : val;
    },
  };

  return new Proxy({}, handler);
}

module.exports = { asyncStore, createDbProxy, getCurrentDb };
```

---

### Task 4.3: Update `index.js` to wire Postgres MT infra

**Files:**
- Modify: `backend/index.js` (lines 13-15, multi-tenant imports)

The existing code at the top of index.js:

```js
const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
let asyncStore, createDbProxy, dbProxy, tenantDbManager;
```

**Change to:**

```js
const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
const HAS_POSTGRES = !!process.env.DATABASE_URL;
let asyncStore, createDbProxy, dbProxy, tenantDbManager;
```

Then, where the MT modules are lazy-loaded (find the block that does `if (IS_MULTI_TENANT)`):

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

Also update the `resolveTenant` middleware to use the correct master DB module:

```js
// In resolveTenant, where it requires master-db:
if (HAS_POSTGRES) {
  const masterDb = require("./master-db-pg");
  // ... use masterDb.getTenantById
} else {
  // ... existing SQLite master-db logic
}
```

---

### Task 4.4: Run tests + commit

```bash
cd backend && DATABASE_URL=postgresql://localhost:5432/oneshoppos_test npx jest tests/integration/pg-batch --no-cache
```

Expected: 340/340 pass (MT code paths are gated behind `MULTI_TENANT=1` which is off in tests)

```bash
git add backend/tenant-db-manager-pg.js backend/tenant-db-proxy-pg.js backend/index.js
git commit -m "feat: add Postgres schema-switching for multi-tenant infrastructure

- tenant-db-manager-pg.js: shared pg.Pool with per-request SET search_path
  (replaces SQLite file-pool). Tenant cache with 60s TTL, same API surface.
- tenant-db-proxy-pg.js: AsyncLocalStorage proxy for Postgres (query/transaction/
  getClient instead of SQLite get/run/all/serialize).
- index.js: detect DATABASE_URL to choose PG vs SQLite MT modules.
- MULTI_TENANT=1 is NOT flipped — infrastructure only."
```

---

## What's NOT in This Plan

1. **Flipping `MULTI_TENANT=1`** — requires full end-to-end tenant isolation testing
2. **`admin.js` routes** — still use `master-db.js` (SQLite) for super-admin; low priority
3. **Deleting old SQLite files** — `db.js`, `migrate*.js`, `run_migrations.js`, `tenant-db-manager.js`, `tenant-db-proxy.js` stay until production cutover is verified
4. **Frontend env changes** — `VITE_API_BASE` stays the same; no frontend changes needed

---

## Test Count Projection

| Task | New Tests | Total |
|------|-----------|-------|
| Existing pg tests | 340 | 340 |
| Task 1 (boolean audit) | 0 (covered by existing) | 340 |
| Task 2 (migration system) | 0 (infra script) | 340 |
| Task 3 (cutover script) | 0 (one-time script) | 340 |
| Task 4 (MT infra) | 0 (gated behind flag) | 340 |
| **Total** | **340** | **340** |
