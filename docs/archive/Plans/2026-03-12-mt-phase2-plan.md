# MT Phase 2 — Onboarding & Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable the core MT workflow: provisioning tenants with setup tokens, tenant-aware background jobs, tenant-scoped notifications, and per-tenant rate limiting.

**Architecture:** 5 items across ~8 files. The provisioner generates a setup token on tenant creation; the setup wizard resolves the tenant from URL params and writes to the correct schema; background workers iterate all active tenants via a shared `forEachActiveTenant` helper; notification helpers use `dbProxy` instead of raw `db`; rate limiters key by `tenantSlug:IP`.

**Tech Stack:** Node.js/Express, PostgreSQL (schema-based multi-tenancy via `SET search_path`), React 19, `express-rate-limit`

**Design doc:** `docs/plans/2026-03-12-mt-phase2-design.md`

---

### Task 1: Setup token generation in provisioner

**Files:**
- Modify: `backend/tenant-provisioner-pg.js:42-135`

**Step 1: Add crypto import and setup token generation**

At the top of `tenant-provisioner-pg.js`, `crypto` is not imported. Add it and modify the `provision` function to generate a setup token after inserting the company_profile row.

In `tenant-provisioner-pg.js`, find this block (around line 96-99):

```js
    // Company profile
    await client.query(
      "INSERT INTO company_profile (id, company_name, timezone) VALUES (1, $1, $2) ON CONFLICT DO NOTHING",
      [name, timezone || "UTC"]
    );
```

Replace with:

```js
    // Company profile with setup token
    const crypto = require("crypto");
    const setupToken = crypto.randomBytes(32).toString("hex");
    await client.query(
      "INSERT INTO company_profile (id, company_name, timezone, setup_token, setup_complete) VALUES (1, $1, $2, $3, false) ON CONFLICT DO NOTHING",
      [name, timezone || "UTC", setupToken]
    );
```

Then update the return at line 126 to include `setupToken`:

```js
    return { tenantId, employeeId, outletId, setupToken };
```

**Step 2: Verify syntax**

Run: `node -c backend/tenant-provisioner-pg.js`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/tenant-provisioner-pg.js
git commit -m "feat: generate setup token during tenant provisioning"
```

---

### Task 2: Admin API returns setup URL + new endpoints

**Files:**
- Modify: `backend/routes/admin.js:46-188`

**Step 1: Add tenantDbManager import**

After the existing imports at line 51, add:

```js
  const tenantDbManager = require("../tenant-db-manager-pg");
  tenantDbManager.init(db);
```

**Step 2: Update POST /api/admin/tenants response**

In `admin.js`, find the response in `POST /api/admin/tenants` (around line 181-184):

```js
      return res.status(201).json({
        message: "Tenant provisioned",
        tenant: { id: result.tenantId, slug, name, status: "active", plan: plan || "free" },
      });
```

Replace with:

```js
      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      return res.status(201).json({
        message: "Tenant provisioned",
        tenant: { id: result.tenantId, slug, name, status: "active", plan: plan || "free" },
        setup_token: result.setupToken,
        setup_url: `${frontendUrl}/setup?tenant=${slug}&token=${result.setupToken}`,
      });
```

**Step 3: Add GET /api/admin/tenants/:id/setup-token endpoint**

After the existing `app.get("/api/admin/tenants/:id/stats", ...)` endpoint, add:

```js
  app.get("/api/admin/tenants/:id/setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterDb.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const { rows: [profile] } = await tenantDb.query(
        "SELECT setup_token, setup_complete FROM company_profile WHERE id = 1"
      );

      if (!profile || profile.setup_complete) {
        return res.json({ setup_complete: true, setup_token: null, setup_url: null });
      }

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      res.json({
        setup_complete: false,
        setup_token: profile.setup_token,
        setup_url: `${frontendUrl}/setup?tenant=${tenant.slug}&token=${profile.setup_token}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 4: Add POST /api/admin/tenants/:id/regenerate-setup-token endpoint**

```js
  app.post("/api/admin/tenants/:id/regenerate-setup-token", requireAllowedIp, requireSuperAdmin, async (req, res) => {
    try {
      const tenant = await masterDb.getTenantById(req.params.id);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const tenantDb = await tenantDbManager.getDb(tenant.id);
      const crypto = require("crypto");
      const newToken = crypto.randomBytes(32).toString("hex");
      await tenantDb.query(
        "UPDATE company_profile SET setup_token = $1, setup_complete = false WHERE id = 1",
        [newToken]
      );

      await auditLog(tenant.id, "setup_token_regenerated", { slug: tenant.slug }, `admin:${req.admin.email}`);

      const frontendUrl = process.env.FRONTEND_URL || "https://sanopos.vercel.app";
      res.json({
        setup_token: newToken,
        setup_url: `${frontendUrl}/setup?tenant=${tenant.slug}&token=${newToken}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
```

**Step 5: Verify syntax**

Run: `node -c backend/routes/admin.js`
Expected: No errors

**Step 6: Commit**

```bash
git add backend/routes/admin.js
git commit -m "feat: admin API returns setup URL, add setup-token + regenerate endpoints"
```

---

### Task 3: Admin dashboard — setup URL display

**Files:**
- Modify: `frontend/src/pages/admin/AdminTenantList.jsx`
- Modify: `frontend/src/pages/admin/AdminTenantDetail.jsx`

**Step 1: AdminTenantList — show setup URL after provisioning**

In `AdminTenantList.jsx`, add state for the created tenant's setup URL:

```js
  const [createdSetupUrl, setCreatedSetupUrl] = useState("");
```

In the `handleCreate` function, after `setShowCreate(false)`, capture the setup URL from the response:

Find:
```js
      if (!res.ok) throw new Error(data.error || "Failed to create tenant");
      setShowCreate(false);
      setForm({ slug: "", name: "", owner_email: "", timezone: "UTC", pin: "", plan: "free" });
      loadTenants();
```

Replace with:
```js
      if (!res.ok) throw new Error(data.error || "Failed to create tenant");
      setShowCreate(false);
      setForm({ slug: "", name: "", owner_email: "", timezone: "UTC", pin: "", plan: "free" });
      if (data.setup_url) setCreatedSetupUrl(data.setup_url);
      loadTenants();
```

After the `{showCreate && (...)}` block (before the closing `</div>`), add a success modal:

```jsx
      {createdSetupUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreatedSetupUrl("")}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-emerald-700">Tenant Created!</h2>
            <p className="mb-3 text-sm text-slate-600">Send this setup URL to the tenant owner so they can configure their store:</p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                readOnly
                value={createdSetupUrl}
                className="flex-1 bg-transparent text-sm text-slate-700 outline-none"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(createdSetupUrl); }}
                className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
              >
                Copy
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setCreatedSetupUrl("")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
```

**Step 2: AdminTenantDetail — show setup status card**

In `AdminTenantDetail.jsx`, add state:

```js
  const [setupInfo, setSetupInfo] = useState(null);
```

In `loadTenant`, after loading stats, fetch setup token status:

After the `if (statsRes.ok) { ... }` block, add:

```js
      try {
        const setupRes = await adminFetch(`/api/admin/tenants/${id}/setup-token`);
        if (setupRes.ok) {
          const setupData = await setupRes.json();
          setSetupInfo(setupData);
        }
      } catch {}
```

Add a "Setup Status" card. Find the `{/* Actions */}` comment (line 207). Insert BEFORE it:

```jsx
          {/* Setup Status */}
          {setupInfo && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Setup Status</h2>
              {setupInfo.setup_complete ? (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">Setup Complete</span>
              ) : (
                <div className="space-y-3">
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">Pending Setup</span>
                  {setupInfo.setup_url && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <input
                        readOnly
                        value={setupInfo.setup_url}
                        className="flex-1 bg-transparent text-xs text-slate-600 outline-none"
                        onClick={(e) => e.target.select()}
                      />
                      <button
                        onClick={() => navigator.clipboard.writeText(setupInfo.setup_url)}
                        className="shrink-0 rounded bg-violet-600 px-2 py-1 text-xs font-semibold text-white hover:bg-violet-500"
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      const res = await adminFetch(`/api/admin/tenants/${id}/regenerate-setup-token`, { method: "POST" });
                      if (res.ok) {
                        const data = await res.json();
                        setSetupInfo({ setup_complete: false, ...data });
                      }
                    }}
                    className="text-xs font-medium text-violet-600 hover:text-violet-500"
                  >
                    Regenerate Token
                  </button>
                </div>
              )}
            </div>
          )}
```

**Step 3: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/AdminTenantList.jsx frontend/src/pages/admin/AdminTenantDetail.jsx
git commit -m "feat: setup URL display + copy in admin dashboard"
```

---

### Task 4: Setup wizard MT adaptation — backend

**Files:**
- Modify: `backend/routes/setup.js`
- Modify: `backend/routes/registerAllRoutes.js:50-51`

**Step 1: Update setup.js to accept MT deps and resolve tenant**

Replace the entire module export signature and add a `getSetupDb` helper. The function signature changes from:

```js
module.exports = function createSetupRouter(db) {
```

To:

```js
module.exports = function createSetupRouter(db, { IS_MULTI_TENANT, tenantDbManager } = {}) {
```

Add `getSetupDb` helper right after `const router = express.Router();`:

```js
  async function getSetupDb(req) {
    if (!IS_MULTI_TENANT) return db;
    const slug = req.query.tenant || req.body?.tenant;
    if (!slug) throw new Error("tenant slug required in MT mode");
    const masterDb = require("../master-db-pg");
    const tenant = await masterDb.getTenantBySlug(slug);
    if (!tenant) throw new Error(`Tenant "${slug}" not found`);
    return tenantDbManager.getDb(tenant.id);
  }
```

In `GET /status` handler, replace `db.query(...)` with:

```js
      const setupDb = await getSetupDb(req);
      const { rows: [row] } = await setupDb.query(
        'SELECT setup_complete FROM company_profile WHERE id = 1',
        []
      );
```

In `POST /complete` handler, replace `db.query(...)` and `db.transaction(...)`:

```js
      const setupDb = await getSetupDb(req);
      // Verify token
      const { rows: [profile] } = await setupDb.query(
        'SELECT setup_complete, setup_token FROM company_profile WHERE id = 1',
        []
      );
      // ... same validation logic ...

      await setupDb.transaction(async (client) => {
        // ... exact same transaction body — all client.query() calls stay the same ...
      });
```

**Step 2: Update registerAllRoutes.js to pass MT deps**

In `backend/routes/registerAllRoutes.js`, find lines 50-51:

```js
  const createSetupRouter = require("./setup");
  app.use("/api/setup", createSetupRouter(db));
```

Replace with:

```js
  const createSetupRouter = require("./setup");
  const IS_MULTI_TENANT = process.env.MULTI_TENANT === "1";
  let setupTenantDbManager;
  if (IS_MULTI_TENANT && process.env.DATABASE_URL) {
    setupTenantDbManager = require("../tenant-db-manager-pg");
  }
  app.use("/api/setup", createSetupRouter(db, { IS_MULTI_TENANT, tenantDbManager: setupTenantDbManager }));
```

**Step 3: Verify syntax**

Run: `node -c backend/routes/setup.js && node -c backend/routes/registerAllRoutes.js`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/routes/setup.js backend/routes/registerAllRoutes.js
git commit -m "feat: setup wizard MT adaptation — tenant-scoped db via URL param"
```

---

### Task 5: Setup wizard MT adaptation — frontend

**Files:**
- Modify: `frontend/src/pages/SetupWizard.jsx:102-230`

**Step 1: Read tenant slug from URL and pass to API calls**

In `SetupWizard.jsx`, find the token extraction at line 112:

```js
  const token = new URLSearchParams(window.location.search).get("token") || "";
```

Replace with:

```js
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token") || "";
  const tenantSlug = searchParams.get("tenant") || "";
```

Find the status check at line 144:

```js
    fetch(`${API}/setup/status`)
```

Replace with:

```js
    fetch(`${API}/api/setup/status${tenantSlug ? `?tenant=${tenantSlug}` : ""}`)
```

**IMPORTANT**: The current code uses `${API}/setup/status` without `/api/` prefix — but `API` is defined in `config.js` and already includes the base URL. Looking at the route mount (`app.use("/api/setup", ...)`), the correct URL should include `/api/`. Check if `API` already ends with `/api` — if `API = "http://localhost:5000"`, the current fetch URL is wrong. If `API = "http://localhost:5000/api"`, it's correct and becomes `${API}/setup/status`. **Read `frontend/src/config.js` to verify.**

Find the submit function at line 198:

```js
      const res = await fetch(`${API}/setup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
```

Replace with:

```js
      const res = await fetch(`${API}/api/setup/complete${tenantSlug ? `?tenant=${tenantSlug}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          tenant: tenantSlug || undefined,
```

**Again — verify the `API` variable format from `config.js` first.** If `API` already ends with `/api`, use `${API}/setup/...` not `${API}/api/setup/...`.

**Step 2: Verify frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/pages/SetupWizard.jsx
git commit -m "feat: SetupWizard passes tenant slug in MT mode"
```

---

### Task 6: Notification helpers use proxy db

**Files:**
- Modify: `backend/index.js:851-884`

**Step 1: Replace `db.query` with proxy-aware db**

In `index.js`, find `createNotification` at line 851:

```js
function createNotification(type, title, message, link) {
  db.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}
```

Replace with:

```js
const _notifDb = IS_MULTI_TENANT ? dbProxy : db;

function createNotification(type, title, message, link) {
  _notifDb.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}
```

Find `notifyLowStockForSale` at line 858 — replace the two `db.query` calls:

```js
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
  _notifDb.query(
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

**Key insight:** These functions are called from route handlers where ALS context is already active. Using `dbProxy` means the proxy resolves the correct tenant DB via AsyncLocalStorage. In single-tenant mode, `_notifDb` is `db` (raw pool) — identical to current behavior.

**Step 2: Verify syntax**

Run: `node -c backend/index.js`
Expected: No errors

**Step 3: Commit**

```bash
git add backend/index.js
git commit -m "fix: notification helpers use proxy db in MT mode"
```

---

### Task 7: Tenant-aware scheduled jobs

**Files:**
- Modify: `backend/index.js:1002-1130`

**Step 1: Add `forEachActiveTenant` helper**

Insert this function BEFORE `closeStaleAttendanceSessions` (before line 1092):

```js
// Helper: run a function for each active tenant (or once for single-tenant)
async function forEachActiveTenant(label, fn) {
  if (!IS_MULTI_TENANT || !tenantDbManager) {
    try {
      await fn(db, null);
    } catch (err) {
      console.error(`[${label}]`, err.message);
    }
    return;
  }
  try {
    const masterMod = require("./master-db-pg");
    const { rows: tenants } = await masterMod.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    for (const tenant of tenants) {
      try {
        const tenantDb = await tenantDbManager.getDb(tenant.id);
        await fn(tenantDb, tenant);
      } catch (err) {
        console.error(`[${label}] tenant ${tenant.slug}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[${label}] Error loading tenants:`, err.message);
  }
}
```

**Step 2: Wrap `closeStaleAttendanceSessions`**

Replace the existing function:

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
```

**Step 3: Wrap `cleanupSyncEvents`**

Replace:

```js
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

**Step 4: Wrap `cleanupReportScheduleArtifacts`**

The report cleanup has 3 queries + a file cleanup. Wrap only the DB queries (file cleanup is global, not tenant-scoped):

```js
async function cleanupReportScheduleArtifacts() {
  const runsRetentionDays = Math.max(1, Number(process.env.REPORT_RUNS_RETENTION_DAYS || 45));
  const deliveryRetentionDays = Math.max(1, Number(process.env.REPORT_DELIVERY_RETENTION_DAYS || 60));
  const filesRetentionDays = Math.max(1, Number(process.env.REPORT_EXPORT_FILES_RETENTION_DAYS || 30));
  const runsCutoff = new Date(Date.now() - runsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deliveryCutoff = new Date(Date.now() - deliveryRetentionDays * 24 * 60 * 60 * 1000).toISOString();

  await forEachActiveTenant("ReportCleanup", async (tenantDb) => {
    try {
      const { rowCount: runsDeleted } = await tenantDb.query(
        "DELETE FROM report_schedule_runs WHERE COALESCE(run_finished_at, run_started_at) < $1::timestamptz",
        [runsCutoff]
      );
      if (runsDeleted > 0) console.log(`[ReportCleanup] Deleted ${runsDeleted} old schedule runs`);
    } catch (err) {
      console.error("[ReportCleanup] run cleanup error:", err.message);
    }
    try {
      const { rowCount: deliveryDeleted } = await tenantDb.query(
        "DELETE FROM report_delivery_log WHERE created_at < $1::timestamptz",
        [deliveryCutoff]
      );
      if (deliveryDeleted > 0) console.log(`[ReportCleanup] Deleted ${deliveryDeleted} old delivery logs`);
    } catch (err) {
      console.error("[ReportCleanup] delivery cleanup error:", err.message);
    }
  });

  // File cleanup is global (export files are not tenant-scoped)
  const exportsDir = path.resolve(__dirname, "exports", "reports");
  const filesCutoffMs = Date.now() - filesRetentionDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(exportsDir)) return;
  let deleted = 0;
  for (const fileName of fs.readdirSync(exportsDir)) {
    const filePath = path.join(exportsDir, fileName);
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) continue;
      if (st.mtimeMs < filesCutoffMs) { fs.unlinkSync(filePath); deleted += 1; }
    } catch (e) {
      console.error("[ReportCleanup] file cleanup error:", e.message);
    }
  }
  if (deleted > 0) console.log(`[ReportCleanup] Deleted ${deleted} old export files`);
}
```

**Step 5: Wrap Shopify + report schedule workers**

The Shopify worker (`processPendingShopifyInventoryEvents`) and report scheduler (`processPendingReportSchedules`) close over `db` from `registerAllRoutes` deps. In MT mode, `db` is `dbProxy`. We need to wrap each call in `asyncStore.run()` so the proxy resolves correctly.

Find the Shopify interval (around line 1120):

```js
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(() => {
    processPendingShopifyInventoryEvents(20, () => {});
  }, 30000);
}
```

Replace with:

```js
if (!SHOPIFY_WORKER_DISABLED) {
  setInterval(async () => {
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingShopifyInventoryEvents(20, () => {});
      return;
    }
    try {
      const masterMod = require("./master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingShopifyInventoryEvents(20, () => {});
          });
        } catch (err) {
          console.error(`[ShopifyWorker] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ShopifyWorker] Error loading tenants:", err.message);
    }
  }, 30000);
}
```

Find the report schedule interval (around line 1127):

```js
if (!REPORT_SCHEDULE_WORKER_DISABLED) {
  setInterval(() => {
    processPendingReportSchedules(5, () => {});
  }, 60000);
}
```

Replace with the same pattern:

```js
if (!REPORT_SCHEDULE_WORKER_DISABLED) {
  setInterval(async () => {
    if (!IS_MULTI_TENANT || !tenantDbManager) {
      processPendingReportSchedules(5, () => {});
      return;
    }
    try {
      const masterMod = require("./master-db-pg");
      const { rows: tenants } = await masterMod.query("SELECT id, slug FROM tenants WHERE status = 'active'");
      for (const tenant of tenants) {
        try {
          const tenantDb = await tenantDbManager.getDb(tenant.id);
          await asyncStore.run({ db: tenantDb }, async () => {
            await processPendingReportSchedules(5, () => {});
          });
        } catch (err) {
          console.error(`[ReportScheduler] tenant ${tenant.slug}:`, err.message);
        }
      }
    } catch (err) {
      console.error("[ReportScheduler] Error loading tenants:", err.message);
    }
  }, 60000);
}
```

**Step 6: Verify syntax**

Run: `node -c backend/index.js`
Expected: No errors

**Step 7: Commit**

```bash
git add backend/index.js
git commit -m "fix: tenant-aware scheduled jobs via forEachActiveTenant"
```

---

### Task 8: Per-tenant rate limiting

**Files:**
- Modify: `backend/index.js:188-212`

**Step 1: Add tenant key extractor**

Before the `globalLimiter` definition (around line 188), add:

```js
function extractTenantKey(req) {
  if (!IS_MULTI_TENANT) return "st";
  return req.headers["x-tenant-slug"] || req.tenantSlug || "unknown";
}
```

**Step 2: Add `keyGenerator` to globalLimiter**

Find `globalLimiter` (line 188):

```js
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: (req) => isPosBurstPath(req.path || ""),
});
```

Add `keyGenerator`:

```js
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_GLOBAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: (req) => isPosBurstPath(req.path || ""),
  keyGenerator: (req) => `${extractTenantKey(req)}:${req.ip}`,
});
```

**Step 3: Add `keyGenerator` to authLimiter**

Find `authLimiter` (line 197):

```js
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: () => process.env.NODE_ENV === 'test',
});
```

Add `keyGenerator`:

```js
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitExceededHandler,
  skip: () => process.env.NODE_ENV === 'test',
  keyGenerator: (req) => {
    if (!IS_MULTI_TENANT) return req.ip;
    const tenantKey = req.body?.store_code || req.headers["x-tenant-slug"] || "unknown";
    return `${tenantKey}:${req.ip}`;
  },
});
```

**Step 4: Verify syntax**

Run: `node -c backend/index.js`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/index.js
git commit -m "feat: per-tenant rate limiting keyed by tenantSlug:IP"
```

---

### Task 9: Verification & final checks

**Step 1: Run backend syntax check**

Run: `node -c backend/index.js && node -c backend/routes/admin.js && node -c backend/routes/setup.js && node -c backend/routes/registerAllRoutes.js && node -c backend/tenant-provisioner-pg.js`
Expected: All pass

**Step 2: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Run existing middleware tests**

Run: `cd backend && npx jest tests/integration/pg-batch8 --no-coverage 2>/dev/null`
Expected: All tests pass (these test `loadCompanyProfile`, `resolveContext`, etc.)

**Step 4: Run batch3 tests (auth + setup)**

Run: `cd backend && npx jest tests/integration/pg-batch3 --no-coverage 2>/dev/null`
Expected: All tests pass

**Step 5: Final commit (if any lint/fix changes)**

If any fixes were needed during verification, commit them with an appropriate message.

---

## Summary

| Task | Commit | Files |
|------|--------|-------|
| 1 | `feat: generate setup token during tenant provisioning` | `tenant-provisioner-pg.js` |
| 2 | `feat: admin API returns setup URL, add setup-token + regenerate endpoints` | `admin.js` |
| 3 | `feat: setup URL display + copy in admin dashboard` | `AdminTenantList.jsx`, `AdminTenantDetail.jsx` |
| 4 | `feat: setup wizard MT adaptation — tenant-scoped db via URL param` | `setup.js`, `registerAllRoutes.js` |
| 5 | `feat: SetupWizard passes tenant slug in MT mode` | `SetupWizard.jsx` |
| 6 | `fix: notification helpers use proxy db in MT mode` | `index.js` |
| 7 | `fix: tenant-aware scheduled jobs via forEachActiveTenant` | `index.js` |
| 8 | `feat: per-tenant rate limiting keyed by tenantSlug:IP` | `index.js` |
| 9 | Verification — no commit unless fixes needed | — |

**Total:** ~8 files modified, ~200 lines changed/added. No new dependencies. No schema changes. No migrations.
