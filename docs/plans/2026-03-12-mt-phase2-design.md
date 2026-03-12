# MT Phase 2 — Onboarding & Operations (Design Plan)

**Date:** March 12, 2026
**Goal:** Enable the core MT workflow: provisioning tenants with setup tokens, tenant-aware background jobs, tenant-scoped notifications, and per-tenant rate limiting.
**Branch:** `feature/mt-phase2-operations`

---

## Overview

5 items across 6 files. Items #7 and #8 are tightly coupled (provisioning generates the token, setup wizard consumes it). The rest are independent.

---

## Item 7: Super-admin tenant onboarding — setup token flow

**Files:** `backend/routes/admin.js`, `backend/tenant-provisioner-pg.js`
**Problem:** `POST /api/admin/tenants` provisions a tenant but doesn't generate a setup token. The super-admin has no way to give the tenant owner a URL to customize their store.

### Fix

**Step 1 — Provisioner generates setup token:**

In `tenant-provisioner-pg.js`, after inserting the `company_profile` row, generate a setup token:

```js
// After: INSERT INTO company_profile (id, company_name, timezone) ...
const setupToken = require("crypto").randomBytes(32).toString("hex");
await client.query(
  "UPDATE company_profile SET setup_token = $1, setup_complete = false WHERE id = 1",
  [setupToken]
);
```

Return `setupToken` in the result alongside `tenantId`, `employeeId`, `outletId`.

**Step 2 — Admin API returns setup token + URL:**

In `admin.js`, `POST /api/admin/tenants` response:

```js
return res.status(201).json({
  message: "Tenant provisioned",
  tenant: { id: result.tenantId, slug, name, status: "active", plan: plan || "free" },
  setup_token: result.setupToken,
  setup_url: `${process.env.FRONTEND_URL || "https://sanopos.vercel.app"}/setup?tenant=${slug}&token=${result.setupToken}`,
});
```

**Step 3 — Admin dashboard shows setup URL after provisioning:**

In `AdminTenantList.jsx`, after successful create:
- Show a success modal/alert with the setup URL
- Include a "Copy URL" button
- The URL format: `https://sanopos.vercel.app/setup?tenant=<slug>&token=<token>`

**Step 4 — Add setup token visibility on tenant detail:**

In `admin.js`, add `GET /api/admin/tenants/:id/setup-token` endpoint:

```js
app.get("/api/admin/tenants/:id/setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
  const tenant = await masterDb.getTenantById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const tenantDb = await tenantDbManager.getDb(tenant.id);
  const { rows: [profile] } = await tenantDb.query(
    "SELECT setup_token, setup_complete FROM company_profile WHERE id = 1"
  );

  if (!profile || profile.setup_complete) {
    return res.json({ setup_complete: true, setup_token: null, setup_url: null });
  }
  res.json({
    setup_complete: false,
    setup_token: profile.setup_token,
    setup_url: `${process.env.FRONTEND_URL || "https://sanopos.vercel.app"}/setup?tenant=${tenant.slug}&token=${profile.setup_token}`,
  });
});
```

Also add `POST /api/admin/tenants/:id/regenerate-setup-token` to regenerate if the token is lost:

```js
app.post("/api/admin/tenants/:id/regenerate-setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
  const tenant = await masterDb.getTenantById(req.params.id);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const tenantDb = await tenantDbManager.getDb(tenant.id);
  const newToken = require("crypto").randomBytes(32).toString("hex");
  await tenantDb.query(
    "UPDATE company_profile SET setup_token = $1, setup_complete = false WHERE id = 1",
    [newToken]
  );

  await auditLog(tenant.id, "setup_token_regenerated", { slug: tenant.slug }, `admin:${req.admin.email}`);

  res.json({
    setup_token: newToken,
    setup_url: `${process.env.FRONTEND_URL || "https://sanopos.vercel.app"}/setup?tenant=${tenant.slug}&token=${newToken}`,
  });
});
```

In `AdminTenantDetail.jsx`, show a "Setup Status" card:
- If `setup_complete`: green badge "Setup Complete"
- If not: show the setup URL with copy button + "Regenerate Token" button

**Key point:** `tenantDbManager` is already imported in `admin.js` via `require("../tenant-db-manager-pg")`. However, it currently isn't — we need to add that import and initialize it.

---

## Item 8: Setup wizard MT adaptation

**Files:** `backend/routes/setup.js`, `frontend/src/pages/SetupWizard.jsx`
**Problem:** The setup wizard only works in single-tenant mode. In MT mode, `db` is the tenant proxy, but the setup wizard routes run without tenant context (no JWT, no `resolveTenant`), so the proxy has no ALS context → hits public schema.

### Fix

**Backend (`setup.js`):**

The setup routes need to resolve the tenant from the `tenant` query param (not from JWT — the user isn't logged in yet):

```js
module.exports = function createSetupRouter(db, { IS_MULTI_TENANT, tenantDbManager } = {}) {
  const router = express.Router();

  // Helper: get the right db for this setup request
  async function getSetupDb(req) {
    if (!IS_MULTI_TENANT) return db;
    const slug = req.query.tenant || req.body?.tenant;
    if (!slug) throw new Error("tenant slug required in MT mode");
    const masterDb = require("../master-db-pg");
    const tenant = await masterDb.getTenantBySlug(slug);
    if (!tenant) throw new Error(`Tenant "${slug}" not found`);
    return tenantDbManager.getDb(tenant.id);
  }

  // GET /api/setup/status
  router.get('/status', async (req, res) => {
    try {
      const setupDb = await getSetupDb(req);
      const { rows: [row] } = await setupDb.query(
        'SELECT setup_complete FROM company_profile WHERE id = 1'
      );
      // ...same logic, using setupDb
    } catch (err) { ... }
  });

  // POST /api/setup/complete
  router.post('/complete', async (req, res) => {
    try {
      const setupDb = await getSetupDb(req);
      // ...same transaction logic, using setupDb instead of db
    } catch (err) { ... }
  });
};
```

**Key change:** Replace all `db.query(...)` / `db.transaction(...)` calls with `setupDb.query(...)` / `setupDb.transaction(...)`.

**Pass dependencies from `index.js`:** When mounting setup routes:

```js
// index.js — where setup router is mounted
const setupRouter = require("./routes/setup")(
  IS_MULTI_TENANT ? dbProxy : db,
  { IS_MULTI_TENANT, tenantDbManager }
);
app.use("/api/setup", setupRouter);
```

**Frontend (`SetupWizard.jsx`):**

Read `tenant` and `token` from URL params:

```js
const [searchParams] = useSearchParams();
const tenantSlug = searchParams.get("tenant");
const tokenFromUrl = searchParams.get("token");
```

Pass `tenant` to all API calls:

```js
// Status check
const statusUrl = tenantSlug
  ? `${API}/api/setup/status?tenant=${tenantSlug}`
  : `${API}/api/setup/status`;

// Complete
const completeUrl = tenantSlug
  ? `${API}/api/setup/complete?tenant=${tenantSlug}`
  : `${API}/api/setup/complete`;
```

Also pre-fill the token field from URL and auto-submit it (so the tenant owner just fills in their store details, not the token).

**Setup gate behavior in MT mode:** The Phase 1 fix already made the 503 setup gate per-tenant. In MT mode, when a tenant hasn't completed setup:
- Only that tenant's requests get 503'd
- The setup wizard routes are exempt (`/api/setup` is whitelisted)
- Other tenants are unaffected

---

## Item 9: Tenant-aware scheduled jobs

**File:** `backend/index.js` (lines 1002-1130)
**Problem:** 4 background workers use global `db`:

| Worker | Interval | Current code |
|--------|----------|-------------|
| `closeStaleAttendanceSessions` | daily | `db.query("UPDATE attendance_sessions ...")` |
| `cleanupSyncEvents` | daily | `db.query("DELETE FROM external_sync_events ...")` |
| `cleanupReportScheduleArtifacts` | daily | `db.query("DELETE FROM report_schedule_runs ...")` + `db.query("DELETE FROM report_delivery_log ...")` |
| `processPendingShopifyInventoryEvents` | 30s | Called from `registerAllRoutes` return value |
| `processPendingReportSchedules` | 60s | Called from `registerAllRoutes` return value |

### Fix

Create a shared helper `forEachActiveTenant` in `index.js`:

```js
async function forEachActiveTenant(label, fn) {
  if (!IS_MULTI_TENANT || !tenantDbManager) {
    // Single-tenant: run against global db
    await fn(db, null);
    return;
  }
  try {
    const masterDb = require("./master-db-pg");
    const { rows: tenants } = await masterDb.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    for (const tenant of tenants) {
      try {
        const tenantDb = await tenantDbManager.getDb(tenant.id);
        await fn(tenantDb, tenant);
      } catch (err) {
        console.error(`[${label}] Error for tenant ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[${label}] Error loading tenants:`, err.message);
  }
}
```

**Adapt each worker:**

```js
async function closeStaleAttendanceSessions() {
  await forEachActiveTenant("StaleSessionCleanup", async (tenantDb) => {
    await tenantDb.query(
      `UPDATE attendance_sessions
       SET session_end = session_start, session_type = 'auto_closed'
       WHERE session_end IS NULL AND session_start::date < CURRENT_DATE`
    );
  });
}

async function cleanupSyncEvents() {
  await forEachActiveTenant("SyncCleanup", async (tenantDb) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await tenantDb.query(
      "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'failed')",
      [cutoff]
    );
    if (rowCount > 0) console.log(`[SyncCleanup] Deleted ${rowCount} old sync events`);
  });
}
```

Same pattern for `cleanupReportScheduleArtifacts`.

**Shopify and report schedule workers:** These are returned from `registerAllRoutes` and called in setInterval loops. They already receive `db` as a dep (which is `dbProxy` in MT mode). However, the Shopify worker and report scheduler process pending events — they query tables like `external_sync_events` and `report_schedules`. In MT mode, these need to iterate tenants.

The cleanest approach: wrap the setInterval callbacks with `forEachActiveTenant`:

```js
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(async () => {
    await forEachActiveTenant("ShopifyWorker", async (tenantDb) => {
      await processPendingShopifyInventoryEvents(20, () => {}, tenantDb);
    });
  }, 30000);
}
```

This requires `processPendingShopifyInventoryEvents` to accept an optional `dbOverride` param. Currently it closes over the `db` from deps — we'd pass `tenantDb` explicitly when in MT mode. In single-tenant mode, it uses the existing closure.

**Note for future (Option B):** When tenant count exceeds ~30, replace `forEachActiveTenant`'s sequential `for` loop with chunked `Promise.allSettled` (concurrency=3). This is a 5-line change to the helper — no worker modifications needed.

---

## Item 10: Notification helpers use global `db`

**File:** `backend/index.js` (lines 851-884)
**Problem:** `createNotification()` and `notifyLowStockForSale()` call `db.query()` directly. In MT mode, `db` is the raw pool (public schema) — notifications go to the wrong place.

### Fix

These functions are passed as deps to `registerAllRoutes`, which passes them into route closures. They need to use the proxy `db` (which routes through ALS to the correct tenant).

**Simple fix:** Change `db.query(...)` to use the proxy-aware `db`:

```js
// These are defined AFTER the proxy is set up
const effectiveDb = IS_MULTI_TENANT ? dbProxy : db;

function createNotification(type, title, message, link) {
  effectiveDb.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}

function notifyLowStockForSale(cartItems, outletId) {
  const productIds = [
    ...new Set(
      (cartItems || [])
        .map((i) => Number(i.original_product_id || i.product_id || i.id))
        .filter(Boolean),
    ),
  ];
  if (!productIds.length || !outletId) return;
  const placeholders = productIds.map((_, i) => "$" + (i + 2)).join(",");
  effectiveDb.query(
    `SELECT os.product_id, os.quantity, p.name
     FROM outlet_stock os
     JOIN products p ON p.id = os.product_id
     WHERE os.outlet_id = $1 AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
    [outletId, ...productIds]
  ).then(({ rows }) => {
    if (!rows) return;
    rows.forEach((row) => {
      createNotification(
        "low_stock",
        "Low Stock Alert",
        `${row.name} has ${row.quantity} units left`,
        "/inventory",
      );
    });
  }).catch(() => {});
}
```

**Key insight:** These notification helpers are called within request handlers (e.g., `POST /api/sales`), which means AsyncLocalStorage already has the tenant context set by `resolveTenant`. Using `dbProxy` (instead of raw `db`) means the notifications go to the correct tenant schema automatically.

**Important ordering:** `createNotification` and `notifyLowStockForSale` are defined at module level and passed as deps. They need to be defined AFTER `dbProxy` is created (line 24) but BEFORE they're passed to `registerAllRoutes` (line 896). Currently they're at lines 851-884, which is fine positionally — we just need to change `db.query` to `effectiveDb.query`.

---

## Item 11: Per-tenant rate limiting

**File:** `backend/index.js` (lines 188-204)
**Problem:** `globalLimiter` and `authLimiter` use IP as the key (express-rate-limit default). Tenant A's traffic eats into a shared bucket, potentially rate-limiting Tenant B.

### Fix

Add a custom `keyGenerator` that includes the tenant slug:

```js
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: (req) => isPosBurstPath(req.path || ""),
  keyGenerator: (req) => {
    const tenantKey = IS_MULTI_TENANT ? (req.tenantSlug || "unknown") : "st";
    return `${tenantKey}:${req.ip}`;
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => {
    const tenantKey = IS_MULTI_TENANT ? (req.tenantSlug || "unknown") : "st";
    return `${tenantKey}:${req.ip}`;
  },
});
```

**Note on middleware ordering:** `globalLimiter` runs BEFORE `resolveTenant` (which sets `req.tenantSlug`). So `req.tenantSlug` won't be set for the global limiter.

**Solution:** For `globalLimiter`, extract the tenant slug from the JWT or the `x-tenant-slug` header (which is set by the frontend in MT mode) rather than relying on `req.tenantSlug`:

```js
function extractTenantKey(req) {
  if (!IS_MULTI_TENANT) return "st";
  // Try header first (set by frontend), then fall back to JWT
  const slug = req.headers["x-tenant-slug"];
  if (slug) return slug;
  // Fall back to IP-only if no tenant info available
  return "unknown";
}

const globalLimiter = rateLimit({
  // ...
  keyGenerator: (req) => `${extractTenantKey(req)}:${req.ip}`,
});
```

For `authLimiter`, which gates `/api/auth/*` routes — these are where the tenant slug is determined from login, so using `req.body.store_code` (the login form's tenant slug field) is appropriate:

```js
const authLimiter = rateLimit({
  // ...
  keyGenerator: (req) => {
    const tenantKey = IS_MULTI_TENANT
      ? (req.body?.store_code || req.headers["x-tenant-slug"] || "unknown")
      : "st";
    return `${tenantKey}:${req.ip}`;
  },
});
```

**Single-tenant behavior:** Uses `"st"` as prefix — functionally identical to current IP-only keying.

---

## Implementation Sequence

| Step | Items | Files | Commit |
|------|-------|-------|--------|
| 1 | #7 | `tenant-provisioner-pg.js`, `admin.js` | `feat: setup token generation on tenant provisioning` |
| 2 | #7 | `AdminTenantList.jsx`, `AdminTenantDetail.jsx` | `feat: setup URL display + copy in admin dashboard` |
| 3 | #8 | `setup.js`, `index.js`, `SetupWizard.jsx` | `feat: setup wizard MT adaptation (tenant-scoped db)` |
| 4 | #10 | `index.js` | `fix: notification helpers use proxy db in MT mode` |
| 5 | #9 | `index.js` | `fix: tenant-aware scheduled jobs via forEachActiveTenant` |
| 6 | #11 | `index.js` | `feat: per-tenant rate limiting (tenantSlug:IP key)` |

**Total changes:** ~6-8 files modified, ~150-200 lines changed/added. No new dependencies. No schema changes. No new migrations.

---

## Testing Strategy

1. **Syntax/build check:** `node -c backend/index.js`, `npm run build` in frontend/
2. **Existing tests:** `npx jest backend/tests/integration/pg-batch8` (middleware tests), `npx jest backend/tests/integration/pg-batch3` (auth + setup tests)
3. **Manual smoke test:**
   - Set `MULTI_TENANT=1` locally
   - Provision a tenant via admin dashboard → verify setup URL is shown
   - Open setup URL → verify wizard loads and writes to correct tenant schema
   - Check stale session cleanup runs for all tenants
   - Verify notifications go to the correct tenant

---

## Risk Assessment

- **Low risk:** All changes are additive. Single-tenant mode uses existing code paths with `"st"` or `"_default"` keys.
- **No breaking changes:** API contracts unchanged. No schema changes. No new env vars required (FRONTEND_URL is optional with sensible default).
- **Rollback:** `MULTI_TENANT=0` reverts to single-tenant behavior. All new code paths are gated behind `IS_MULTI_TENANT`.
