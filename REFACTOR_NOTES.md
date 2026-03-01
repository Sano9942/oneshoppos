# OneShopPOS — Refactor Notes

## What Was Done & Why

### Problem
The user was hitting Claude Pro usage caps very quickly when working on this project.
Root cause: `backend/routes/registerAllRoutes.js` was a single 11,630-line file (400 KB).
Every backend task required Claude to read the entire file, consuming massive amounts of tokens.

---

### Solution: Split registerAllRoutes.js into 26 focused route files

**Date:** February 2026

**Before:** `registerAllRoutes.js` = 11,630 lines — one monolithic file with all 226+ API routes.

**After:** `registerAllRoutes.js` = 324 lines — a pure orchestrator that just:
1. Sets up global middleware (permissions, restore lock, telemetry)
2. Calls `require('./routeFile')(app, deps)` for each domain
3. Returns `{ processPendingShopifyInventoryEvents, processPendingReportSchedules }`

---

### Route Files Created (in `backend/routes/`)

| File | Lines | Domain |
|------|-------|--------|
| `taxes.js` | ~52 | Tax CRUD |
| `categories.js` | ~52 | Category CRUD |
| `outlets.js` | ~52 | Outlet CRUD |
| `auth.js` | ~82 | Login / logout / /me |
| `employees.js` | ~93 | Employee management |
| `roles.js` | ~163 | Roles & permissions |
| `brands.js` | ~62 | Brand CRUD |
| `products.js` | ~912 | Products, variants, media, bulk import |
| `suppliers.js` | ~60 | Supplier CRUD |
| `purchase-orders.js` | ~255 | Purchase orders |
| `grn.js` | ~288 | Goods Received Notes + Supplier Payables |
| `promotions.js` | ~199 | Promotions engine |
| `customers.js` | ~302 | Customers + customer reports |
| `sales.js` | ~411 | Sales history routes |
| `inventory.js` | ~246 | Inventory transfers + stock adjustments |
| `reports.js` | ~2193 | All reports (dashboard, cash, attendance, extended) |
| `returns.js` | ~189 | Sales returns |
| `attribute-sets.js` | ~250 | Attribute sets |
| `receipt-templates.js` | ~144 | Receipt templates + action history |
| `supplier-returns.js` | ~160 | Supplier returns (RMA) |
| `parked-sales.js` | ~117 | Parked sales |
| `orders.js` | ~1407 | Orders (includes processPendingShopifyInventoryEvents) |
| `shopify.js` | ~1909 | Shopify connector, imports, mappings |
| `reconciliation.js` | ~1101 | Reconciliation + approvals |
| `barcode-expenses.js` | ~792 | Barcodes, expenses, backup/restore, e-invoicing |
| `attendance.js` | ~89 | Employee attendance |
| `tier4.js` | ~1,248 | Notifications, HR, CRM, quotations, attachments |

---

### How the Pattern Works

Every route file exports a single function:
```js
module.exports = function registerXxxRoutes(app, deps) {
  const { db, requirePerm, ... } = deps;
  // routes here
};
```

`registerAllRoutes.js` calls them like:
```js
require('./taxes')(app, deps);
require('./products')(app, deps);
// etc.
```

The `deps` object contains all shared dependencies (db, multer, requirePerm, etc.)
and is passed through unchanged — no refactoring of individual routes was needed.

---

### Special Cases

**`orders.js`** — defines `processPendingShopifyInventoryEvents` internally and returns it:
```js
const { processPendingShopifyInventoryEvents } = require('./orders')(app, deps) || {};
```

**`reports.js`** — defines `processPendingReportSchedules` internally and returns it:
```js
const { processPendingReportSchedules } = require('./reports')(app, deps) || {};
```

Both are then returned from `registerAllRoutes` to `index.js` as before.

---

### Other Files Created in Session

- **`.claudeignore`** — tells Claude to never read `node_modules/`, `dist/`, `backups/`, `exports/`, lock files, old migrations
- **`CLAUDE.md`** — project map loaded every session so Claude understands the project without scanning code
- **`backend/shopify/utils.js`** — retry logic and webhook HMAC verification (companion to `client.js`)

---

### When Working on This Project

- **Backend route issue?** → Read only the relevant route file (e.g. `backend/routes/products.js`)
- **Global middleware?** → Read `backend/routes/registerAllRoutes.js` (324 lines)
- **Database schema?** → Read only `backend/migrate55.js` (latest migration, 55 total)
- **Frontend page issue?** → Read the specific page in `frontend/src/pages/`
- **Server startup/config?** → Read `backend/index.js`

Use `/clear` between unrelated tasks and `/compact` when conversations get long.

---

## Remaining Refactor Work (Not Done Yet)

### Backend Route Files — Candidates for Further Splitting

These are still large and worth splitting when you actively work on them.
No need to split a file you're not currently touching.

| File | Lines | Suggested Split |
|------|-------|----------------|
| `reports.js` | ~2,193 | `reports-dashboard.js` + `reports-extended.js` + `cash-management.js` |
| `shopify.js` | ~1,909 | `shopify-config.js` + `shopify-import.js` + `shopify-mappings.js` |
| `orders.js` | ~1,407 | Order creation vs order sync/Shopify logic |
| `tier4.js` | ~1,248 | By feature: notifications, HR, CRM, quotations, attachments |
| `reconciliation.js` | ~1,101 | `reconciliation.js` + `approvals.js` |

### Frontend Pages — Candidates for Component Splitting

| File | Lines | Notes |
|------|-------|-------|
| `Reports.jsx` | ~2,999 | Largest frontend file — split if working on reports often |
| `ShopifyIntegration.jsx` | ~2,108 | Split if Shopify UI work is frequent |
| `POS.jsx` | ~1,867 | Core POS screen — split carefully into cart, tender, items |

### Already Done (Session Feb 2026)
- ✅ Split `registerAllRoutes.js` (11,630 → 323 lines, 27 route files including `tier4.js`)
- ✅ Created `.claudeignore` (blocks node_modules, dist, backups, exports, lock files)
- ✅ Updated `.claudeignore` to block all old migrations, test files, diagnostic scripts
- ✅ Created `CLAUDE.md` project guide
- ✅ Updated `CLAUDE.md` to reflect new route file structure
- ✅ Database grown to 55 migrations (`migrate55.js` is current latest)

### Bug Fixes Applied (Session Mar 2026) — Post-Refactor ReferenceError Audit

After the refactor split, several route files had bare calls to helper functions that were private to `orders.js`. These caused silent `ReferenceError` crashes at runtime (not at startup), visible as 500 errors from the frontend.

**Root cause:** `getActiveShopifyConnection`, `maskSecret`, and `enqueueInventorySyncEvents` were defined inside `orders.js`'s closure. After the split, other modules called them as bare names — no import, no local definition.

**Fixes applied:**

| Helper | Fix |
|--------|-----|
| `getActiveShopifyConnection` | Moved to `backend/shopify/utils.js` (exported). `shopify.js` and `reconciliation.js` now `require()` it and bind `db`+`decryptShopifySecret` in thin local wrappers. |
| `maskSecret` | Same — moved to `backend/shopify/utils.js`. `shopify.js` wraps it with injected `decryptShopifySecret`. |
| `enqueueInventorySyncEvents` | Added defensive wrapper (same pattern as `sales.js`) to `returns.js`, `inventory.js`, `purchase-orders.js`, `supplier-returns.js`. Gracefully no-ops if Shopify is not active. |

**Files changed:**
- `backend/shopify/utils.js` — added `maskSecret(secret, decryptFn)` and `getActiveShopifyConnection(db, decryptFn, cb)`
- `backend/routes/shopify.js` — top-level `require('../shopify/utils')` + local wrappers
- `backend/routes/reconciliation.js` — top-level `require('../shopify/utils')` + local wrapper + added `decryptShopifySecret` to destructure
- `backend/routes/returns.js` — added `enqueueInventorySyncEvents` defensive wrapper
- `backend/routes/inventory.js` — added `enqueueInventorySyncEvents` defensive wrapper
- `backend/routes/purchase-orders.js` — added `enqueueInventorySyncEvents` defensive wrapper
- `backend/routes/supplier-returns.js` — added `enqueueInventorySyncEvents` defensive wrapper

**Note:** `sales.js` already had the defensive wrapper from the original refactor session — it was the only file that was correctly handled at the time.
