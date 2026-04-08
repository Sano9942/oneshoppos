# Postgres Migration — Remaining Work Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the last unconverted files (`order-service.js`, `index.js` middleware/startup, multi-tenant infra) from SQLite callbacks to Postgres async/await, completing the backend migration.

**Architecture:** All route files (Batches 1-6) are already converted. This plan converts the middleware layer, startup hooks, background workers, and the Shopify order service. Multi-tenant infra (`master-db`, `tenant-db-manager`) already have Postgres equivalents — we wire them in. Express v5.2.1 natively supports async middleware (no wrapper needed).

**Tech Stack:** `pg` (node-postgres), Express v5, async/await throughout.

**Branch:** `feature/postgres-migration` (continue existing work)

---

## Scope Summary

| File | LOC | What Changes | Priority |
|------|-----|-------------|----------|
| `order-service.js` | 424 | Full rewrite: callbacks → async/await, `db.prepare` → loop, `db.serialize` → `db.transaction` | Batch 7 |
| `index.js` middleware | ~340 | 6 functions: `loadEmployeePerms`, `loadTenantAndPerms`, `loadCompanyProfile`, `resolveContext`, `ensureDefaultRolePermissions`, helpers | Batch 8 |
| `index.js` startup/workers | ~130 | Startup hooks + `setInterval` workers → async | Batch 8 |
| `index.js` boot | ~30 | Switch `require("./db")` → `require("./db-pg")`, remove `sqlite3` import | Batch 8 |
| `tenant-db-proxy.js` | 82 | Zero changes — already DB-agnostic | N/A |
| `jwt-auth.js` | 88 | Zero changes — pure crypto | N/A |
| `master-db.js` | 115 | Not modified — replaced by `master-db-pg.js` (already exists) | N/A |
| `tenant-db-manager.js` | 105 | Not modified for now — MT Postgres uses schema-switching, not file pool | Future |
| `tenant-provisioner.js` | 291 | Not modified — `tenant-provisioner-pg.js` already exists | N/A |

**Files that need zero changes:** `tenant-db-proxy.js`, `jwt-auth.js`, `master-db.js`, `tenant-db-manager.js`, `tenant-provisioner.js`

**Total conversion:** ~900 lines across 2 files (`order-service.js` + `index.js`)

---

## Batch 7: order-service.js (Shopify Order Upsert + Stock Policy)

### Task 7.1: Write test file `pg-batch7-order-service.test.js`

**Files:**
- Create: `backend/tests/integration/pg-batch7-order-service.test.js`

**Step 1: Write the test file**

This test file covers:
- `upsertWebOrderFromShopifyPayload` — insert new order, upsert existing, line items, stock policy trigger
- `applyWebOrderStockPolicy` — apply stock, reverse stock, noop states, unmapped items
- `resolveWebOrderItemMapping` — by direct ID, by variant SKU, by variant barcode, by product barcode, unmapped
- `resolveWebOrderOutletId` — from order, from Shopify default location mapping

Test seed data requirements (add to `createTestApp-pg.js` or inline):
- A product with barcode + variant with SKU
- An outlet with `outlet_stock` row
- A `shopify_connections` row with `default_location_id`
- A `shopify_location_map` row linking location → outlet

```js
const createTestApp = require("../helpers/createTestApp-pg");

describe("Batch 7 — order-service (Postgres)", () => {
  let app, db, server, schema;

  beforeAll(async () => {
    ({ app, db, server, schema } = await createTestApp());
    // Seed extra data for order service tests
    await db.query(`
      INSERT INTO shopify_connections (shop_domain, access_token, is_active, default_location_id)
      VALUES ('test.myshopify.com', 'tok', true, '12345')
      ON CONFLICT DO NOTHING
    `);
    await db.query(`
      INSERT INTO shopify_location_map (shopify_location_id, outlet_id)
      VALUES ('12345', 1)
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    server?.close();
    if (schema) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  // ... test cases listed below
});
```

Key test cases (~20 tests):

1. **upsertWebOrderFromShopifyPayload — creates new web order**
2. **upsertWebOrderFromShopifyPayload — upserts existing order (updates fields)**
3. **upsertWebOrderFromShopifyPayload — inserts line items**
4. **upsertWebOrderFromShopifyPayload — replaces line items on re-upsert**
5. **upsertWebOrderFromShopifyPayload — missing order id returns error**
6. **upsertWebOrderFromShopifyPayload — empty line_items still creates order**
7. **applyWebOrderStockPolicy — applies stock for paid order (decrements outlet_stock)**
8. **applyWebOrderStockPolicy — reverses stock for refunded order**
9. **applyWebOrderStockPolicy — noop when already applied**
10. **applyWebOrderStockPolicy — noop when already reversed**
11. **applyWebOrderStockPolicy — noop for non-actionable state (pending)**
12. **applyWebOrderStockPolicy — handles unmapped items gracefully**
13. **resolveWebOrderItemMapping — resolves by direct product_id**
14. **resolveWebOrderItemMapping — resolves by variant SKU**
15. **resolveWebOrderItemMapping — resolves by variant barcode**
16. **resolveWebOrderItemMapping — resolves by product barcode**
17. **resolveWebOrderItemMapping — returns null for unmapped item**
18. **resolveWebOrderOutletId — uses order.outlet_id when present**
19. **resolveWebOrderOutletId — resolves from Shopify default location**
20. **shouldApplyWebOrderStock / shouldReverseWebOrderStock — state matrix**

**Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/integration/pg-batch7-order-service.test.js --no-cache`
Expected: FAIL — order-service.js still uses SQLite callbacks

---

### Task 7.2: Convert order-service.js to async/await

**Files:**
- Modify: `backend/shopify/order-service.js`

**Conversion map:**

| Before (SQLite) | After (Postgres) |
|-----------------|------------------|
| `module.exports = function createOrderService(db, getActiveShopifyConnection)` | Same signature but all internal functions become `async` |
| `db.get("SELECT ...", [params], (err, row) => {})` | `const { rows } = await db.query("SELECT ... WHERE x = $1", [params]); const row = rows[0];` |
| `db.all("SELECT ...", [params], (err, rows) => {})` | `const { rows } = await db.query("SELECT ...", [params]);` |
| `db.run("UPDATE ...", [params], callback)` | `await db.query("UPDATE ... WHERE x = $1", [params]);` |
| `db.serialize(() => { db.run("BEGIN"); ... db.run("COMMIT"); })` | `await db.transaction(async (client) => { ... });` |
| `db.prepare(sql); stmt.run([...]); stmt.finalize()` | `for (const r of items) { await client.query(sql, [...]); }` |
| `getActiveShopifyConnection((err, conn) => {})` | `const conn = await getActiveShopifyConnection();` (already dual-mode) |
| `datetime('now','localtime')` | `NOW()` |
| `?` params | `$1, $2, $3` numbered params |
| `ON CONFLICT(...) DO UPDATE SET` | Same syntax (Postgres-native) |
| Callback `cb(null, result)` / `cb(err)` | Return result / throw error |

**Key structural changes:**

1. **`resolveWebOrderOutletId`**: callback chain → `async function`, early returns
2. **`resolveWebOrderItemMapping`**: 3-level fallback chain → sequential `await` with early returns
3. **`applyWebOrderStockPolicy`**: deeply nested callback pyramid → flat `async function` with `db.transaction()`
4. **`upsertWebOrderFromShopifyPayload`**: `db.serialize` + `db.prepare` loop → `db.transaction()` + `for` loop with `await client.query()`

The factory still returns `{ upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy }` but both are now async (return Promises).

**Callers (already converted in Batch 6):**
- `routes/shopify/orders.js` — wraps call in `new Promise()` → change to direct `await`
- `routes/shopify/webhooks.js` — wraps call in `new Promise()` → change to direct `await`

**Step 3: Implement the conversion**

Full converted structure (pseudocode):

```js
module.exports = function createOrderService(db, getActiveShopifyConnection) {

  function shouldApplyWebOrderStock(order) { /* unchanged — pure logic */ }
  function shouldReverseWebOrderStock(order) { /* unchanged — pure logic */ }

  async function resolveWebOrderOutletId(order) {
    if (order?.outlet_id) return Number(order.outlet_id);
    const conn = await getActiveShopifyConnection(); // already async in PG mode
    if (!conn?.default_location_id) throw new Error("...");
    const { rows } = await db.query(
      "SELECT outlet_id FROM shopify_location_map WHERE shopify_location_id = $1 LIMIT 1",
      [String(conn.default_location_id)]
    );
    if (!rows[0]?.outlet_id) throw new Error("No outlet mapping...");
    return Number(rows[0].outlet_id);
  }

  async function resolveWebOrderItemMapping(item) {
    const directProduct = item?.product_id ? Number(item.product_id) : null;
    const directVariant = item?.variant_id ? Number(item.variant_id) : null;
    if (directProduct) return { product_id: directProduct, variant_id: directVariant };

    const sku = String(item?.sku || "").trim();
    const barcode = String(item?.barcode || "").trim();

    // Fallback 1: variant by SKU
    if (sku) {
      const { rows } = await db.query(
        "SELECT id AS variant_id, product_id FROM product_variants WHERE sku = $1 LIMIT 1", [sku]
      );
      if (rows[0]?.product_id) return { product_id: Number(rows[0].product_id), variant_id: Number(rows[0].variant_id) };
    }
    // Fallback 2: variant by barcode
    if (barcode) {
      const { rows } = await db.query(
        "SELECT id AS variant_id, product_id FROM product_variants WHERE barcode = $1 LIMIT 1", [barcode]
      );
      if (rows[0]?.product_id) return { product_id: Number(rows[0].product_id), variant_id: Number(rows[0].variant_id) };
    }
    // Fallback 3: product by barcode
    if (barcode) {
      const { rows } = await db.query(
        "SELECT id AS product_id FROM products WHERE barcode = $1 LIMIT 1", [barcode]
      );
      if (rows[0]?.product_id) return { product_id: Number(rows[0].product_id), variant_id: null };
    }
    return null;
  }

  async function applyWebOrderStockPolicy(webOrderId) {
    const { rows: [order] } = await db.query("SELECT * FROM web_orders WHERE id = $1", [webOrderId]);
    if (!order) throw new Error("Web order not found");

    const applied = order.stock_applied === true || Number(order.stock_applied) === 1;
    const shouldApply = shouldApplyWebOrderStock(order);
    const shouldReverse = shouldReverseWebOrderStock(order);

    if (shouldApply && applied) return { action: "noop_already_applied" };
    if (shouldReverse && !applied) return { action: "noop_already_reversed" };
    if (!shouldApply && !shouldReverse) return { action: "noop_state_not_actionable" };

    const direction = shouldApply ? -1 : 1;
    const nextAppliedState = shouldApply;
    const actionLabel = shouldApply ? "apply" : "reverse";

    let resolvedOutletId;
    try {
      resolvedOutletId = await resolveWebOrderOutletId(order);
    } catch (outletErr) {
      await db.query("UPDATE web_orders SET stock_policy_note = $1 WHERE id = $2",
        [String(outletErr.message), webOrderId]);
      throw outletErr;
    }

    const { rows: items } = await db.query(
      "SELECT * FROM web_order_items WHERE web_order_id = $1 ORDER BY id ASC", [webOrderId]
    );
    if (!items.length) return { action: "noop_no_items" };

    const resolved = [];
    const unresolved = [];
    for (const item of items) {
      const mapped = await resolveWebOrderItemMapping(item);
      if (!mapped?.product_id) { unresolved.push(item.id); continue; }
      await db.query(
        "UPDATE web_order_items SET product_id = COALESCE(product_id, $1), variant_id = COALESCE(variant_id, $2) WHERE id = $3",
        [mapped.product_id, mapped.variant_id || null, item.id]
      );
      resolved.push({ item_id: item.id, product_id: mapped.product_id, variant_id: mapped.variant_id || null, qty: Number(item.qty || 0) });
    }

    if (unresolved.length > 0) {
      const note = `Unmapped items (${unresolved.length}) - stock policy not applied`;
      await db.query("UPDATE web_orders SET stock_policy_note = $1 WHERE id = $2", [note, webOrderId]);
      throw new Error(note);
    }

    await db.transaction(async (client) => {
      for (const r of resolved) {
        const delta = direction * Number(r.qty || 0);
        await client.query(
          `INSERT INTO outlet_stock (product_id, outlet_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT(product_id, outlet_id) DO UPDATE SET quantity = outlet_stock.quantity + $4`,
          [r.product_id, resolvedOutletId, delta, delta]
        );
      }
      await client.query(
        `UPDATE web_orders
         SET stock_applied = $1, stock_applied_at = NOW(), stock_policy_note = $2,
             outlet_id = COALESCE(outlet_id, $3), updated_at = NOW()
         WHERE id = $4`,
        [nextAppliedState, `Stock policy ${actionLabel}d`, resolvedOutletId, webOrderId]
      );
    });

    return { action: actionLabel, outlet_id: resolvedOutletId, item_count: resolved.length };
  }

  async function upsertWebOrderFromShopifyPayload(payload) {
    // ... parse payload fields (unchanged) ...
    const result = await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO web_orders (...) VALUES ($1...$14)
         ON CONFLICT(source, external_order_id) DO UPDATE SET ...`,
        [...]
      );
      const { rows: [row] } = await client.query(
        "SELECT id FROM web_orders WHERE source = $1 AND external_order_id = $2",
        [source, externalOrderId]
      );
      const webOrderId = row.id;
      await client.query("DELETE FROM web_order_items WHERE web_order_id = $1", [webOrderId]);
      for (const item of lineItems) {
        await client.query("INSERT INTO web_order_items (...) VALUES ($1...$9)", [...]);
      }
      return { webOrderId, itemCount: lineItems.length };
    });

    // Stock policy runs AFTER the transaction commits (separate operation)
    let stockPolicy;
    try {
      stockPolicy = await applyWebOrderStockPolicy(result.webOrderId);
    } catch (policyErr) {
      stockPolicy = { error: policyErr.message };
    }
    return { web_order_id: result.webOrderId, item_count: result.itemCount, stock_policy: stockPolicy };
  }

  return { upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy };
};
```

**Step 4: Update callers to remove `new Promise()` wrappers**

In `routes/shopify/orders.js` — find the `new Promise()` wrapper around `upsertWebOrderFromShopifyPayload` and replace with direct `await`:

```js
// Before:
const result = await new Promise((resolve, reject) => {
  upsertWebOrderFromShopifyPayload(payload, (err, res) => {
    if (err) reject(err); else resolve(res);
  });
});

// After:
const result = await upsertWebOrderFromShopifyPayload(payload);
```

Same change in `routes/shopify/webhooks.js`.

Also remove the `new Promise()` wrapper around `applyWebOrderStockPolicy` if used directly.

**Step 5: Run tests**

Run: `cd backend && npx jest tests/integration/pg-batch7-order-service.test.js --no-cache`
Expected: All ~20 tests pass

**Step 6: Run all Postgres tests to verify no regressions**

Run: `cd backend && npx jest tests/integration/pg-batch --no-cache`
Expected: 297 + ~20 = ~317 tests pass, 0 failures

**Step 7: Commit**

```bash
git add backend/shopify/order-service.js backend/routes/shopify/orders.js backend/routes/shopify/webhooks.js backend/tests/integration/pg-batch7-order-service.test.js
git commit -m "feat: convert order-service.js to Postgres — Batch 7 (~20 tests)"
```

---

## Batch 8: index.js — Middleware, Startup, Boot Switch

### Task 8.1: Write test file `pg-batch8-middleware.test.js`

**Files:**
- Create: `backend/tests/integration/pg-batch8-middleware.test.js`

This tests the middleware and startup functions in their Postgres form. Key tests (~15 tests):

1. **loadEmployeePerms — loads permissions for valid employee**
2. **loadEmployeePerms — returns empty perms for missing employee**
3. **loadEmployeePerms — rejects invalid x-employee-id header**
4. **loadCompanyProfile — attaches company profile to req**
5. **loadCompanyProfile — returns 503 when setup_complete = false**
6. **resolveContext — reads context headers**
7. **resolveContext — enforces context when flag is on**
8. **resolveContext — exempts admin users from context requirement**
9. **ensureDefaultRolePermissions — seeds permissions for default roles**
10. **createNotification — inserts notification row**
11. **notifyLowStockForSale — creates notifications for low-stock products**
12. **cleanupSyncEvents — deletes old sync events**
13. **closeStaleAttendanceSessions — closes open sessions from previous days**
14. **health endpoint — returns OK**
15. **setup gate — blocks routes when setup_complete = false**

Note: `loadTenantAndPerms` and `resolveTenant` are MT-only and test coverage for them requires a different setup (master DB + tenant schemas). They can be tested separately or deferred to MT integration tests.

**Step 1: Write test skeleton**

```js
const createTestApp = require("../helpers/createTestApp-pg");
const request = require("supertest");

describe("Batch 8 — index.js middleware (Postgres)", () => {
  let app, db, server, schema;
  beforeAll(async () => {
    ({ app, db, server, schema } = await createTestApp());
  });
  afterAll(async () => {
    server?.close();
    if (schema) await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });

  // ... test cases
});
```

**Step 2: Run to verify failure**

Run: `cd backend && npx jest tests/integration/pg-batch8-middleware.test.js --no-cache`
Expected: FAIL

---

### Task 8.2: Convert index.js middleware functions

**Files:**
- Modify: `backend/index.js`

**Changes by function:**

#### 1. Boot: Switch DB import

```js
// Before:
const db = require("./db");
const sqlite3 = require("sqlite3").verbose();

// After:
const db = require("./db-pg");
// Remove sqlite3 import (no longer needed at top level)
```

Also update `deps.db` passed to `registerAllRoutes`:
```js
// Before:
db: IS_MULTI_TENANT ? dbProxy : db,

// After (single-tenant Postgres):
db: IS_MULTI_TENANT ? dbProxy : db,
// Same line — db-pg already exports the pool wrapper
```

Remove `sqlite3` from deps passed to `registerAllRoutes` if still referenced.

#### 2. loadEmployeePerms (lines 248-276)

```js
// Before: nested db.get/db.all callbacks
// After:
async function loadEmployeePerms(req, res, next) {
  const employeeId = req.headers["x-employee-id"];
  const parsed = parseInt(employeeId, 10);
  if (employeeId !== undefined && (isNaN(parsed) || parsed <= 0 || parsed > 999999)) {
    return res.status(400).json({ error: "Invalid employee ID header" });
  }
  if (!employeeId) {
    req.employeePerms = [];
    return next();
  }
  try {
    const { rows: [emp] } = await db.query(
      "SELECT role_id FROM employees WHERE id = $1", [employeeId]
    );
    if (!emp) { req.employeePerms = []; return next(); }
    const { rows } = await db.query(
      "SELECT permission FROM role_permissions WHERE role_id = $1", [emp.role_id]
    );
    req.employeePerms = rows.map(r => r.permission);
  } catch {
    req.employeePerms = [];
  }
  next();
}
```

#### 3. loadTenantAndPerms (lines 287-381)

Convert the inner callback chains to async/await. The outer try/catch for JWT verification stays.

```js
async function loadTenantAndPerms(req, res, next) {
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
    req.tokenScope = decoded.scope || "full";
    req.headers["x-employee-id"] = String(decoded.eid);
    if (decoded.oid) {
      req.context = req.context || {};
      req.context.outletId = decoded.oid;
      if (!req.headers["x-outlet-id"]) req.headers["x-outlet-id"] = String(decoded.oid);
    }
    if (req.tokenScope === "kiosk" && !KIOSK_ALLOWED_PATHS.some(rx => rx.test(req.path))) {
      return res.status(403).json({ error: "Kiosk scope: access denied", code: "KIOSK_RESTRICTED" });
    }

    const permDb = IS_MULTI_TENANT ? await tenantDbManager.getDb(decoded.tid) : db;

    // Token revocation checks
    if (decoded.jti) {
      try {
        const { rows: [revoked] } = await permDb.query(
          "SELECT 1 FROM revoked_tokens WHERE token_jti = $1", [decoded.jti]
        );
        if (revoked) return res.status(401).json({ error: "Token revoked", code: "TOKEN_REVOKED" });
      } catch { /* table may not exist */ }
    }
    try {
      const { rows: [emp] } = await permDb.query(
        "SELECT tokens_revoked_before FROM employees WHERE id = $1", [decoded.eid]
      );
      if (emp?.tokens_revoked_before && decoded.iat < Date.parse(emp.tokens_revoked_before) / 1000) {
        return res.status(401).json({ error: "All sessions revoked", code: "ALL_SESSIONS_REVOKED" });
      }
    } catch { /* column may not exist */ }

    // Load permissions
    const { rows: [empRow] } = await permDb.query(
      "SELECT role_id FROM employees WHERE id = $1", [decoded.eid]
    );
    if (!empRow) { req.employeePerms = []; return next(); }
    const { rows: permRows } = await permDb.query(
      "SELECT permission FROM role_permissions WHERE role_id = $1", [empRow.role_id]
    );
    req.employeePerms = permRows.map(r => r.permission);
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    }
    req.employeePerms = [];
    next();
  }
}
```

#### 4. resolveTenant (lines 390-424)

```js
async function resolveTenant(req, res, next) {
  if (!IS_MULTI_TENANT || !req.tenantId) return next();
  try {
    const tenantDb = await tenantDbManager.getDb(req.tenantId);
    // In Postgres MT mode: use master-db-pg instead of master-db
    const masterDb = require("./master-db-pg");
    const tenant = await masterDb.getTenantById(req.tenantId);
    if (!tenant) return res.status(403).json({ error: "Tenant not found.", code: "TENANT_NOT_FOUND" });

    req.tenantSlug = tenant.slug;
    req.tenantDir = path.join(__dirname, "tenants", `t_${tenant.slug}`);
    asyncStore.run({ db: tenantDb }, () => next());
  } catch (err) {
    if (err.message?.includes("is suspended")) {
      return res.status(403).json({ error: "Account suspended. Contact support.", code: "TENANT_SUSPENDED" });
    }
    if (err.message?.includes("is deleted")) {
      return res.status(403).json({ error: "Account not found.", code: "TENANT_DELETED" });
    }
    console.error("[resolveTenant]", err.message);
    return res.status(500).json({ error: "Failed to resolve tenant database" });
  }
}
```

#### 5. loadCompanyProfile (lines 467-488)

```js
// Startup eager load:
(async () => {
  try {
    const { rows: [row] } = await db.query("SELECT * FROM company_profile WHERE id = 1");
    if (row) {
      _cachedCompany = row;
      if (!row.setup_complete) {
        const setupToken = crypto.randomBytes(32).toString("hex");
        await db.query("UPDATE company_profile SET setup_token = $1 WHERE id = 1", [setupToken]);
        _cachedCompany = { ...row, setup_token: setupToken };
        const PORT_FOR_LOG = process.env.PORT || 5000;
        console.log(`\n===== SETUP URL: http://localhost:${PORT_FOR_LOG}/setup?token=${setupToken} =====\n`);
      }
    }
    _companyLastCheck = Date.now();
  } catch (err) {
    console.error("[loadCompanyProfile startup]", err.message);
  }
})();

// Middleware (mostly unchanged — fire-and-forget refresh):
function loadCompanyProfile(req, res, next) {
  const now = Date.now();
  if (now - _companyLastCheck > COMPANY_CACHE_MS) {
    _companyLastCheck = now;
    db.query("SELECT * FROM company_profile WHERE id = 1").then(({ rows: [row] }) => {
      if (row) _cachedCompany = row;
    }).catch(() => {});
  }
  req.company = _cachedCompany;
  if (_cachedCompany && !_cachedCompany.setup_complete &&
      !req.path.startsWith("/api/setup") && !req.path.startsWith("/api/health")) {
    return res.status(503).json({ error: "Setup required", code: "SETUP_REQUIRED" });
  }
  next();
}
```

#### 6. resolveContext (lines 516-559)

```js
// Startup eager load:
(async () => {
  try {
    const { rows: [row] } = await db.query(
      "SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'"
    );
    if (row) _contextEnforced = row.enabled === true;
    _contextFlagLoaded = true;
    _contextFlagLastCheck = Date.now();
  } catch { _contextFlagLoaded = true; }
})();

// Middleware:
function resolveContext(req, res, next) {
  // ... header reads unchanged ...

  // Refresh cached flag value periodically
  const now = Date.now();
  if (now - _contextFlagLastCheck > CONTEXT_FLAG_CACHE_MS) {
    _contextFlagLastCheck = now;
    db.query("SELECT enabled FROM feature_flags WHERE key = 'context_header_enforced'")
      .then(({ rows: [row] }) => { if (row) _contextEnforced = row.enabled === true; })
      .catch(() => {});
  }

  // ... enforcement logic unchanged (note: enabled is BOOLEAN in PG, use === true) ...
  next();
}
```

#### 7. ensureDefaultRolePermissions (lines 598-619)

```js
async function ensureDefaultRolePermissions() {
  try {
    const { rows: roles } = await db.query("SELECT id, name FROM roles");
    if (!roles?.length) return;
    const roleIdByName = {};
    roles.forEach(r => { roleIdByName[r.name] = r.id; });

    for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const roleId = roleIdByName[roleName];
      if (!roleId) continue;
      for (const perm of perms) {
        await db.query(
          "INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [roleId, perm]
        );
      }
    }
  } catch (err) {
    console.error("[ensureDefaultRolePermissions]", err.message);
  }
}
```

#### 8. createNotification + notifyLowStockForSale (lines 840-876)

```js
function createNotification(type, title, message, link) {
  db.query(
    "INSERT INTO notifications (type, title, message, link) VALUES ($1, $2, $3, $4)",
    [type, title, message, link || null]
  ).catch(() => {});
}

async function notifyLowStockForSale(cartItems, outletId) {
  const productIds = [...new Set(
    (cartItems || []).map(i => Number(i.original_product_id || i.product_id || i.id)).filter(Boolean)
  )];
  if (!productIds.length || !outletId) return;
  const placeholders = productIds.map((_, i) => `$${i + 2}`).join(",");
  try {
    const { rows } = await db.query(
      `SELECT os.product_id, os.quantity, p.name
       FROM outlet_stock os JOIN products p ON p.id = os.product_id
       WHERE os.outlet_id = $1 AND os.product_id IN (${placeholders}) AND COALESCE(os.quantity, 0) <= 10`,
      [outletId, ...productIds]
    );
    rows.forEach(row => {
      createNotification("low_stock", "Low Stock Alert", `${row.name} has ${row.quantity} units left`, "/inventory");
    });
  } catch { /* fire-and-forget */ }
}
```

**Step 3: Run tests**

Run: `cd backend && npx jest tests/integration/pg-batch8-middleware.test.js --no-cache`
Expected: All ~15 tests pass

---

### Task 8.3: Convert startup hooks and background workers

**Files:**
- Modify: `backend/index.js`

#### cleanupSyncEvents (lines 994-1005)

```js
async function cleanupSyncEvents() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await db.query(
      "DELETE FROM external_sync_events WHERE created_at < $1 AND status IN ('success', 'failed')",
      [cutoff]
    );
    if (rowCount > 0) console.log(`[SyncCleanup] Deleted ${rowCount} old sync events`);
  } catch (err) {
    console.error("[SyncCleanup] Error:", err.message);
  }
}
```

#### cleanupReportScheduleArtifacts (lines 1007-1074)

```js
async function cleanupReportScheduleArtifacts() {
  // ... retention day calculations unchanged ...
  try {
    const { rowCount: runsDeleted } = await db.query(
      "DELETE FROM report_schedule_runs WHERE COALESCE(run_finished_at, run_started_at) < $1",
      [runsCutoff]
    );
    if (runsDeleted > 0) console.log(`[ReportCleanup] Deleted ${runsDeleted} old schedule runs`);
  } catch (err) {
    console.error("[ReportCleanup] run cleanup error:", err.message);
  }

  try {
    const { rowCount: deliveryDeleted } = await db.query(
      "DELETE FROM report_delivery_log WHERE created_at < $1",
      [deliveryCutoff]
    );
    if (deliveryDeleted > 0) console.log(`[ReportCleanup] Deleted ${deliveryDeleted} old delivery logs`);
  } catch (err) {
    console.error("[ReportCleanup] delivery cleanup error:", err.message);
  }

  // File cleanup unchanged (fs operations)
}
```

Note: Removed `datetime(COALESCE(...))` and `datetime(?)` — in Postgres, TIMESTAMPTZ columns compare directly with ISO strings.

#### closeStaleAttendanceSessions (lines 1084-1093)

```js
async function closeStaleAttendanceSessions() {
  try {
    await db.query(
      `UPDATE attendance_sessions
       SET session_end = session_start, session_type = 'auto_closed'
       WHERE session_end IS NULL AND session_start::date < CURRENT_DATE`
    );
  } catch (err) {
    console.error("Stale session cleanup error:", err.message);
  }
}
```

Note: `date('now', 'localtime')` → `CURRENT_DATE` (Postgres uses server timezone, which is set via `TZ` env var).
`date(session_start)` → `session_start::date`.

#### Startup invocations

```js
// Before (callbacks, fire-and-forget):
runAutoBackup();
cleanupSyncEvents();
cleanupReportScheduleArtifacts();

// After (async, still fire-and-forget — don't block boot):
runAutoBackup(); // file copy, no DB — stays sync
cleanupSyncEvents().catch(e => console.error(e));
cleanupReportScheduleArtifacts().catch(e => console.error(e));
closeStaleAttendanceSessions().catch(e => console.error(e));
```

#### Background worker intervals

```js
// Before:
setInterval(cleanupSyncEvents, 24 * 60 * 60 * 1000);

// After (wrap async in error handler):
setInterval(() => cleanupSyncEvents().catch(e => console.error(e)), 24 * 60 * 60 * 1000);
setInterval(() => cleanupReportScheduleArtifacts().catch(e => console.error(e)), 24 * 60 * 60 * 1000);
setInterval(() => closeStaleAttendanceSessions().catch(e => console.error(e)), 24 * 60 * 60 * 1000);
```

#### runAutoBackup — decision

`runAutoBackup` copies a SQLite file. In Postgres mode, this function is **irrelevant** (pg_dump or Supabase handles backups). Options:
1. Skip it entirely when `DATABASE_URL` is set
2. Keep it as-is (harmless no-op if `DB_PATH` doesn't exist)

Recommended: guard with `if (!process.env.DATABASE_URL)` so it only runs in SQLite mode.

**Step 4: Run full test suite**

Run: `cd backend && npx jest tests/integration/pg-batch --no-cache`
Expected: All tests pass (~317+)

**Step 5: Commit**

```bash
git add backend/index.js backend/tests/integration/pg-batch8-middleware.test.js
git commit -m "feat: convert index.js middleware + startup to Postgres — Batch 8 (~15 tests)"
```

---

## Batch 9 (Optional): Remove SQLite `db.js` dependency, clean up dual-mode code

### Task 9.1: Remove dual-mode from shopify/utils.js

Once `order-service.js` is converted, `getActiveShopifyConnection` no longer needs the SQLite callback path. Remove the dual-mode detection:

```js
// Before:
if (typeof db.query === "function" && typeof db.get !== "function") {
  // Postgres path
} else {
  // SQLite callback path
}

// After:
// Only Postgres path
async function getActiveShopifyConnection() {
  const { rows } = await db.query("SELECT * FROM shopify_connections WHERE is_active = true LIMIT 1");
  return rows[0] || null;
}
```

### Task 9.2: Remove dual-mode from category-tree.js

Same pattern — remove SQLite detection, keep only Postgres path.

### Task 9.3: Clean up `db.js` references

- `index.js` already switched to `db-pg.js` (Task 8.2)
- `registerAllRoutes.js` receives `deps.db` which is now the pg pool
- No other files should import `db.js` directly (all routes receive `db` via deps)
- Keep `db.js` in the repo for SQLite fallback mode, but it's no longer the default

### Task 9.4: Update test helpers

Ensure `createTestApp-pg.js` seeds all data needed for Batch 7-8 tests. Verify no test references `db.js`.

### Task 9.5: Run full test suite + commit

Run: `cd backend && npx jest tests/integration/pg-batch --no-cache`
Expected: All tests pass

```bash
git add -A
git commit -m "chore: remove dual-mode SQLite/Postgres code from shopify/utils.js and category-tree.js"
```

---

## What's NOT in This Plan (Future Work)

1. **Multi-tenant Postgres infra** — `tenant-db-manager.js` needs a Postgres equivalent using schema-switching (`SET search_path`). `master-db-pg.js` already exists. This is a separate plan for when `MULTI_TENANT=1` is activated.

2. **Frontend API calls** — the API contract (request/response JSON) is identical between SQLite and Postgres. No frontend changes needed. The only difference is boolean values: Postgres returns `true`/`false` (JS booleans) while SQLite returned `1`/`0` (numbers). Most frontend code already handles both via truthy/falsy checks. If any strict `=== 1` comparisons exist, they'll need updating — but this is a frontend audit task, not a backend migration task.

3. **Production cutover** — switching Railway from SQLite to Postgres (Supabase). Requires: data migration script, env var changes, volume removal, DNS/connection string setup. Separate plan.

4. **Migration system** — `run_migrations.js` and all `migrate*.js` files are SQLite-specific. In Postgres, schema changes go into `schema-pg.sql` or a proper migration tool (e.g., `node-pg-migrate`). Not needed until production cutover.

5. **`admin.js` routes** — these use `master-db.js` (SQLite) directly for super-admin operations. In Postgres mode, they'd use `master-db-pg.js`. Low priority since super-admin is rarely used.

---

## Test Count Projection

| Batch | Tests | Cumulative |
|-------|-------|------------|
| Batches 1-6 (existing) | 297 | 297 |
| Batch 7 (order-service) | ~20 | ~317 |
| Batch 8 (middleware) | ~15 | ~332 |
| **Total** | **~332** | **~332** |
