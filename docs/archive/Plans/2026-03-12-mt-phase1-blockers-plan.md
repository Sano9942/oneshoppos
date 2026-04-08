# MT Phase 1 — Fix HIGH Blockers (Design Plan)

**Date:** March 12, 2026
**Goal:** Fix all 6 cross-tenant data leak / broken-functionality blockers so `MULTI_TENANT=1` can be safely flipped.
**Branch:** `feature/mt-phase1-blockers`

---

## Overview

All 6 blockers are in 3 files: `index.js` (4 issues), `admin.js` (1 issue), `customer-display.js` (1 issue). The fixes are independent — no ordering dependencies between them.

---

## Blocker 1: `loadCompanyProfile` per-tenant cache

**File:** `backend/index.js:442-489`
**Problem:** Single `_cachedCompany` variable + `_companyLastCheck` timestamp shared across all tenants. Tenant A's timezone/currency/thresholds bleed to Tenant B.
**Severity:** HIGH — wrong timezone = wrong date filters = wrong reports for every tenant after the first.

### Fix

Replace single-value cache with a `Map<tenantId, { profile, lastCheck }>`:

```js
// BEFORE (single-tenant):
let _cachedCompany = { timezone: "UTC" };
let _companyLastCheck = 0;

// AFTER (multi-tenant safe):
const _companyCache = new Map(); // key: tenantId|"_default", value: { profile, lastCheck }
const COMPANY_CACHE_MS = 5 * 60 * 1000;
```

**`loadCompanyProfile` middleware changes:**
```js
function loadCompanyProfile(req, res, next) {
  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  const entry = _companyCache.get(cacheKey) || { profile: { timezone: "UTC" }, lastCheck: 0 };
  const now = Date.now();

  if (now - entry.lastCheck > COMPANY_CACHE_MS) {
    entry.lastCheck = now; // prevent concurrent refreshes
    _companyCache.set(cacheKey, entry);
    db.query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
      if (row) {
        entry.profile = row;
        _companyCache.set(cacheKey, entry);
      }
    }).catch(() => {});
  }

  req.company = entry.profile;

  // Setup gate — only applies to THIS tenant's profile
  if (
    entry.profile &&
    !entry.profile.setup_complete &&
    !req.path.startsWith("/api/setup") &&
    !req.path.startsWith("/api/health")
  ) {
    return res.status(503).json({ error: "Setup required", code: "SETUP_REQUIRED" });
  }

  next();
}
```

**Key point:** In MT mode, `db` is the tenant proxy — `db.query("SELECT * FROM company_profile WHERE id = 1")` already hits the correct tenant schema via AsyncLocalStorage. The cache just needs to be keyed per-tenant to prevent cross-bleed.

**This also fixes Blocker 4** (setup gate) — the gate now checks `entry.profile` for the current tenant, not a global `_cachedCompany`.

---

## Blocker 2: Context enforcement flag global

**File:** `backend/index.js:501-516`
**Problem:** `_contextEnforced`, `_contextFlagLoaded`, `_contextFlagLastCheck` are module-level globals. One tenant enabling `context_header_enforced` forces it on all tenants.

### Fix

Same `Map` pattern — key by tenantId:

```js
// BEFORE:
let _contextEnforced = false;
let _contextFlagLoaded = false;
let _contextFlagLastCheck = 0;

// AFTER:
const _contextFlagCache = new Map(); // key: tenantId|"_default", value: { enforced, lastCheck }
```

**In `resolveContext`:**
```js
function resolveContext(req, res, next) {
  req.context = { companyId: null, outletId: null, scopeMode: null };

  const cacheKey = IS_MULTI_TENANT ? (req.tenantId || "_default") : "_default";
  let flagEntry = _contextFlagCache.get(cacheKey);
  const now = Date.now();

  if (!flagEntry || (now - flagEntry.lastCheck > CONTEXT_FLAG_CACHE_MS)) {
    // Async refresh — non-blocking
    const newEntry = flagEntry || { enforced: false, lastCheck: now };
    newEntry.lastCheck = now;
    _contextFlagCache.set(cacheKey, newEntry);

    db.query("SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'")
      .then(({ rows: [row] }) => {
        if (row) newEntry.enforced = row.enabled === true;
      }).catch(() => {});
    flagEntry = newEntry;
  }

  // ... rest of resolveContext uses flagEntry.enforced instead of _contextEnforced
}
```

---

## Blocker 3: Boot-time eager load hits wrong DB

**File:** `backend/index.js:447-466`
**Problem:** The IIFE `(async () => { ... })()` runs at boot time with no tenant context. In MT mode, `db` is the tenant proxy, but AsyncLocalStorage has no tenant set → query hits `public` schema (master DB) which has no `company_profile` row → setup token never generated, fails silently.

### Fix

Guard the eager load to only run in single-tenant mode:

```js
if (!IS_MULTI_TENANT) {
  (async () => {
    try {
      const { rows: [row] } = await db.query("SELECT * FROM company_profile WHERE id = 1");
      if (row) {
        _companyCache.set("_default", { profile: row, lastCheck: Date.now() });
        if (!row.setup_complete) {
          const setupToken = crypto.randomBytes(32).toString("hex");
          await db.query("UPDATE company_profile SET setup_token = $1 WHERE id = 1", [setupToken]);
          _companyCache.set("_default", { profile: { ...row, setup_token: setupToken }, lastCheck: Date.now() });
          const PORT_FOR_LOG = process.env.PORT || 5000;
          console.log(`\n===== SETUP URL: http://localhost:${PORT_FOR_LOG}/setup?token=${setupToken} =====\n`);
        }
      }
    } catch (err) {
      console.error("[loadCompanyProfile startup]", err.message);
    }
  })();
}
```

**In MT mode:** Each tenant's profile loads lazily on first request via the `loadCompanyProfile` middleware (Blocker 1 fix). Setup tokens for new tenants are generated during `POST /api/setup/complete` (tenant provisioning flow), not at boot.

---

## Blocker 4: Setup gate is global

**Resolved by Blocker 1 fix.** The setup gate is inside `loadCompanyProfile` and now uses per-tenant cached profile. A new tenant with `setup_complete=false` only blocks its own requests, not other tenants'.

---

## Blocker 5: `admin.js` auditLog wrong DB

**File:** `backend/routes/admin.js:69-73`
**Problem:** `auditLog()` calls `db.query()` — but `db` is `require("../db-pg")` (the raw pool, public schema). That actually happens to be correct for inserting into `tenant_audit_log` (which lives in `public` schema). However, the function should use `masterDb` for clarity and correctness.

### Current code
```js
async function auditLog(tenantId, action, details, actor) {
  await db.query(
    "INSERT INTO tenant_audit_log (tenant_id, action, details, actor) VALUES ($1, $2, $3, $4)",
    [tenantId, action, details ? JSON.stringify(details) : null, actor]
  );
}
```

### Fix
```js
async function auditLog(tenantId, action, details, actor) {
  await masterDb.query(
    "INSERT INTO tenant_audit_log (tenant_id, action, details, actor) VALUES ($1, $2, $3, $4)",
    [tenantId, action, details ? JSON.stringify(details) : null, actor]
  );
}
```

**Note:** `masterDb` is already imported at line 48 (`const masterDb = require("../master-db-pg")`). However, `master-db-pg.js` doesn't export a `query()` method — it wraps the pool internally. We need to either:
- (a) Add a `query()` export to `master-db-pg.js` that delegates to `_db.query()`, or
- (b) Since `db` in `admin.js` is `require("../db-pg")` (the raw pool, always public schema), and `tenant_audit_log` IS in public schema, the current code is technically correct. Just add a comment for clarity.

**Decision:** Option (a) — add `query()` to `master-db-pg.js` and use it. This is more explicit:

```js
// master-db-pg.js — add export:
function query(sql, params) {
  return _getDb().query(sql, params);
}
module.exports = { init, createTenant, getTenantBySlug, getTenantById, query };
```

Then in `admin.js`, change `db.query(...)` to `masterDb.query(...)` in `auditLog`.

---

## Blocker 6: Customer display shift ID collision

**File:** `backend/routes/customer-display.js:12, 31, 52`
**Problem:** In-memory `displayStore` Map is keyed by bare `shift_id` (e.g., `"1"`, `"2"`). Two tenants can have the same shift IDs → Tenant A's cashier sees Tenant B's cart on the customer display.

### Fix

Key by `${tenantSlug}-${shiftId}`:

```js
// Helper to build composite key
function displayKey(req, shiftId) {
  const prefix = req.tenantSlug || "_st"; // "_st" = single-tenant
  return `${prefix}-${shiftId}`;
}
```

**POST handler:**
```js
app.post("/api/pos/customer-display", (req, res) => {
  const employeeId = Number(req.headers["x-employee-id"] || 0);
  if (!employeeId) return res.status(401).json({ error: "Unauthorized" });

  cleanup();
  const { shift_id, items, subtotal, tax, total, status } = req.body;
  if (!shift_id) return res.status(400).json({ error: "shift_id required" });

  displayStore.set(displayKey(req, shift_id), {
    // ... same payload
  });
  res.json({ ok: true });
});
```

**GET handler:**
```js
app.get("/api/pos/customer-display", (req, res) => {
  const { shift_id } = req.query;
  if (!shift_id) return res.status(400).json({ error: "shift_id required" });

  const data = displayStore.get(displayKey(req, shift_id));
  // ... same response logic
});
```

**Note:** `req.tenantSlug` is set by `resolveTenant` middleware (index.js:410). The GET endpoint has no auth, but the customer display page passes `shift_id` via query param. In MT mode, the display URL should also include the tenant slug (e.g., `?tenant=acme&shift_id=5`). However, since the GET endpoint is after `resolveTenant` in the middleware chain, `req.tenantSlug` should already be set from the JWT/cookie. If not (unauthenticated GET), we need to accept `tenant` as a query param:

```js
function displayKey(req, shiftId) {
  const prefix = req.tenantSlug || req.query.tenant || "_st";
  return `${prefix}-${shiftId}`;
}
```

And the frontend `CustomerDisplayPage.jsx` should pass `tenant` in the polling URL when in MT mode.

---

## Blocker 7 (bonus): Eager context flag load hits wrong DB

**File:** `backend/index.js:507-516`
**Same problem as Blocker 3** — the IIFE loads `context_header_enforced` at boot with no tenant context. In MT mode, the proxy has no ALS context → hits public schema → no `feature_flags` table → flag stays `false`.

### Fix

Guard like Blocker 3:

```js
if (!IS_MULTI_TENANT) {
  (async () => {
    try {
      const { rows: [row] } = await db.query(
        "SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'"
      );
      if (row) {
        _contextFlagCache.set("_default", { enforced: row.enabled === true, lastCheck: Date.now() });
      }
    } catch {}
  })();
}
```

In MT mode, the flag loads lazily per-tenant on first request via `resolveContext`.

---

## Implementation Sequence

All 6 fixes are independent, but for clean git history:

| Step | Blocker(s) | File | Commit |
|------|-----------|------|--------|
| 1 | #1 + #3 + #4 | `index.js` | `fix: per-tenant company profile cache + lazy load in MT mode` |
| 2 | #2 + #7 | `index.js` | `fix: per-tenant context enforcement flag cache` |
| 3 | #5 | `admin.js` + `master-db-pg.js` | `fix: auditLog uses masterDb for public schema writes` |
| 4 | #6 | `customer-display.js` + `CustomerDisplayPage.jsx` | `fix: tenant-scoped customer display keys` |

**Total changes:** ~4 files modified, ~80 lines changed/added. No new dependencies. No schema changes. No frontend changes except `CustomerDisplayPage.jsx` (pass `tenant` query param in MT mode).

---

## Testing Strategy

1. **Unit-level:** Add to existing `pg-batch8-middleware.test.js`:
   - Test `loadCompanyProfile` returns different profiles for different tenants
   - Test setup gate blocks only the incomplete tenant
   - Test context flag is independent per tenant

2. **Integration:** After all fixes, provision 2 test tenants with different timezones/currencies and verify:
   - Tenant A's profile doesn't bleed to Tenant B
   - Tenant A completing setup doesn't affect Tenant B's 503 gate
   - Customer display data is isolated

3. **Manual smoke test:** Flip `MULTI_TENANT=1` locally, create 2 tenants, verify isolation.

---

## Risk Assessment

- **Low risk:** These are all additive changes — Map-based caching is a superset of single-value caching. Single-tenant mode (`IS_MULTI_TENANT=false`) uses `"_default"` key and behaves identically to current code.
- **No breaking changes:** API contracts unchanged. No schema changes. No new env vars.
- **Rollback:** Flip `MULTI_TENANT=0` reverts to single-tenant behavior with the same `"_default"` key path.
