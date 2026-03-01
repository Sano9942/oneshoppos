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
| `attendance.js` | ~340 | Employee attendance — PIN kiosk, session/break tracking, attendance config |
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
- **Database schema?** → Read only `backend/migrate56.js` (latest migration, 56 total)
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
- ✅ Database grown to 56 migrations (`migrate56.js` is current latest)

### Frontend Redesign Migration Completed (Session Mar 2026)

**Problem:** 4 pages (`Attendance`, `Approvals`, `BarcodeTemplates`, `ReceiptTemplates`) bypassed the `redesign/` shell entirely — their routes in `App.jsx` pointed directly to the old page files, so they rendered without the sidebar, header, or shared `PageShell` chrome.

**Fix:** Created thin `*Redesign.jsx` wrappers in `frontend/src/pages/redesign/` for all 4:

| New File | Wraps | Route |
|----------|-------|-------|
| `AttendanceRedesign.jsx` | `Attendance.jsx` | `/attendance` |
| `ApprovalsRedesign.jsx` | `Approvals.jsx` | `/approvals` |
| `BarcodeTemplatesRedesign.jsx` | `BarcodeTemplates.jsx` | `/barcode-templates` |
| `ReceiptTemplatesRedesign.jsx` | `ReceiptTemplates.jsx` | `/receipt-templates` |

Each wrapper uses `PageShell` from `primitives.jsx` and renders the original as a child — zero business logic duplicated.

**`App.jsx` changes:** Swapped 4 direct imports + JSX usages to point to the redesign counterparts.

**Status:** All routes in `App.jsx` now render through `redesign/`. No pages bypass the shell.

### Nav Visibility Fix (Session Mar 2026)

**Problem:** Even with redesign wrappers in place and routes defined, the 3 pages were invisible — they had no entries in `frontend/src/ui/nav-config.js` (the sidebar nav source of truth). Approvals had a nav entry but was hidden behind `requiredFlag: "approvals"` unnecessarily.

**Fixes in `nav-config.js`:**
- Added `Attendance` → Operations group (`requiredPerm: "manage_employees"`)
- Added `Barcode Templates` → Setup group (`requiredPerm: "manage_inventory"`)
- Added `Receipt Templates` → Setup group (`requiredPerm: "manage_inventory"`)
- Removed `requiredFlag: "approvals"` from Approvals — flag is always-on by default anyway

**Key rule:** A page needs 3 things to be visible: (1) a route in `App.jsx`, (2) a `*Redesign.jsx` wrapper, and (3) an entry in `nav-config.js`.

### Full Wiring Audit (Session Mar 2026)

Confirmed all 36 nav entries, all App.jsx routes, all 37 redesign pages, and all 26 backend route modules are properly connected. No silent gaps.

**Known incomplete features (intentional — no frontend UI):**

| Gap | Type | Notes |
|-----|------|-------|
| `/lookup` | PlaceholderPage | Not in nav, not built |
| `/custom-fields` | PlaceholderPage | Not in nav, not built |
| `/partners` | PlaceholderPage | Not in nav, not built |
| `/shopcast` | PlaceholderPage | Not in nav, not built |
| `/reports/parent-report` | PlaceholderPage | Report tab, not built |
| E-Invoicing | Backend only | `POST /api/e-invoicing/validate` + `/transmit` in `barcode-expenses.js` — no frontend page |
| Supplier Returns | Backend only | `supplier-returns.js` mounted, no `/supplier-returns` route or nav entry |

---

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

### Additional Fixes (Session Mar 2026 — follow-up)

**`logActionHistory`** — private to `orders.js`, found crashing in `reconciliation.js:295` when bulk-resolving reconciliation rows (caused server crash + auth rate-limit lockout).
- **Fix:** Inlined directly into `reconciliation.js` (only depends on `db`).

**`processPendingShopifyInventoryEvents` + `enqueueInventorySyncEvents`** — both defined and used inside `orders.js`, also called bare in `shopify.js`. `orders.js` only returned `processPendingShopifyInventoryEvents`; `enqueueInventorySyncEvents` was never exported. The defensive wrappers in `sales.js` / `returns.js` / etc. silently no-op'd because the function was never injected into deps.
- **Fix:** `orders.js` now returns both functions. `registerAllRoutes.js` captures both and passes them via `shopifyDeps` to `shopify.js`. `shopify.js` destructures both from deps.

**Files changed (follow-up):**
- `backend/routes/orders.js` — return now includes `enqueueInventorySyncEvents`
- `backend/routes/registerAllRoutes.js` — captures both, builds `shopifyDeps = { ...deps, processPendingShopifyInventoryEvents, enqueueInventorySyncEvents }`, passes to `shopify.js`
- `backend/routes/shopify.js` — added both to deps destructure
- `backend/routes/reconciliation.js` — inlined `logActionHistory`

**Status of defensive wrappers in sales/returns/inventory/purchase-orders/supplier-returns:**
These still work correctly — they check `deps.enqueueInventorySyncEvents` at call time. With the real function now injected into deps, they will use it instead of the no-op fallback.

---

## Attendance Module Overhaul (Session Mar 2026)

### Problem
The attendance module had multiple critical issues:
1. `backend/routes/attendance.js` existed but was **never registered** in `registerAllRoutes.js` — live endpoints were duplicates inside `reports.js` (lines 393–476)
2. Only one check-in/check-out per day — no break tracking
3. No PIN-based self-service for employees — required admin interaction
4. Employee records had no `work_hours_per_day` or `monthly_leave_allowance` fields
5. `hours` stored gross time (check_in → check_out) with no break deduction

### Solution

**Database — `backend/migrate56.js` (new, now the latest migration):**
- `ALTER TABLE employees ADD COLUMN work_hours_per_day REAL DEFAULT 8`
- `ALTER TABLE employees ADD COLUMN monthly_leave_allowance INTEGER DEFAULT 2`
- New `attendance_sessions` table — tracks every individual work/break segment within a day:
  - `session_type`: `'work'` | `'break'`
  - `break_reason`: `'lunch'` | `'prayer'` | `'bathroom'` | `'personal'` | `'other'` | NULL
  - `session_start`, `session_end`, `duration_hours`
  - `attendance_id` FK → `employee_attendance` (day-level record kept for payroll compat)

**Backend — `backend/routes/attendance.js` (rewritten, 10 endpoints):**

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/attendance` | manage_employees | Day-level records (now includes `work_sessions` + `break_hours` sub-queries) |
| `GET /api/attendance/sessions` | manage_employees | Session-level records with filters |
| `POST /api/attendance/pin-status` | None (PIN = auth) | Kiosk: look up employee state by PIN |
| `POST /api/attendance/pin-checkin` | None (PIN = auth) | Kiosk: clock in or return from break |
| `POST /api/attendance/pin-checkout` | None (PIN = auth) | Kiosk: go on break or end of day |
| `PUT /api/attendance/:id` | manage_employees | Manager manually corrects a day record |
| `GET /api/employees/:id/attendance-config` | manage_employees | Get work_hours_per_day + monthly_leave_allowance |
| `PUT /api/employees/:id/attendance-config` | manage_employees | Update those fields |
| `POST /api/attendance/checkin` | — | Legacy admin check-in (kept for compatibility) |
| `POST /api/attendance/:id/checkout` | — | Legacy admin check-out (kept for compatibility) |

**Key logic — `pin-checkin`:**
- Open `session_type='work'` → 400 Already clocked in
- Open `session_type='break'` → close it, then open new work session (returning from break)
- No open session → find/create day record, open new work session

**Key logic — `pin-checkout`:**
- `break_reason` provided → close work session, immediately open a break session
- `break_reason` null → close work session, UPDATE `employee_attendance.hours` with net work hours (payroll-safe)
- Net work hours = SUM of all completed `session_type='work'` durations for today

**Routing fixes:**
- Added `require("./attendance")(app, deps)` to `registerAllRoutes.js`
- Removed the duplicate attendance block from `reports.js` (lines 393–476)
- Added 3 new PERMISSION_RULES entries in `backend/index.js` for PUT + attendance-config endpoints
- `POST /api/attendance/pin-*` intentionally left ungated — PIN is the authentication

**Frontend changes:**

| File | Change |
|------|--------|
| `frontend/src/pages/redesign/KioskRedesign.jsx` | **New** — full-screen PIN terminal, 4-view state machine (idle → status → break_select → confirmation), outlet dropdown, auto-reset after 5s |
| `frontend/src/App.jsx` | Added `/kiosk` route outside `AppLayoutRedesign` group (standalone, like POS) |
| `frontend/src/ui/nav-config.js` | Added `Kiosk` entry (no requiredPerm) to Operations group |
| `frontend/src/pages/Attendance.jsx` | Added Sessions, Break, Net Hours columns; manager edit modal (`PUT /api/attendance/:id`); updated hours formatter to `Xh Ym` |
| `frontend/src/pages/redesign/EmployeesRedesign.jsx` | Added attendance config section (hours/day + leave/month) to employee edit modal |

**Kiosk flow:**
1. Admin opens `/kiosk`, selects outlet from dropdown — stays on terminal all day
2. Employee types PIN on large numeric pad (touchscreen-friendly)
3. Status shown: "Not clocked in" / "Clocked in Xh Ym" / "On Lunch break Ym"
4. Actions: Clock In | Go on Break (→ pick reason) | End of Day Clock Out
5. Confirmation banner auto-resets in 5 seconds
6. Break feedback includes "You've worked Xh Ym today"

**Payroll compatibility:** `employee_attendance.hours` is now written as **net work hours** (breaks excluded) at end-of-day checkout. `tier4.js` payroll generation reads this field unchanged — more accurate than before.

**Bug fix — SQLite non-deterministic index:**
`migrate56.js` originally created `idx_att_sessions_emp_date` using `date(session_start,'localtime')` in the index definition. SQLite rejects this with `SQLITE_ERROR: non-deterministic use of date() in an index`. Fixed: index now uses the raw `session_start` column. `date()` filtering in WHERE clauses is unaffected (only index *definitions* are restricted). The broken index was also dropped and recreated on the live DB.

### New Tab Navigation Pattern (Session Mar 2026)

**Problem:** Clicking POS or Kiosk in the sidebar navigated away from the back-office, disrupting any ongoing admin work.

**Solution:** Added `newTab: true` flag to nav-config entries. `AppLayoutRedesign.jsx` checks this flag and renders `<a href target="_blank" rel="noopener noreferrer">` instead of `<NavLink>` — opens a new browser tab without leaving the current page.

**Files changed:**
- `frontend/src/ui/nav-config.js` — added `newTab: true` to POS and Kiosk entries
- `frontend/src/components/AppLayoutRedesign.jsx` — conditional render: `item.newTab` → `<a>`, else `<NavLink>`

**Pattern is reusable** — any future nav entry for a full-screen terminal page can use `newTab: true`.

---

## Comprehensive Test Plan (Session Mar 2026)

### Context

The app has 193+ API endpoints across 26 backend route modules, 39 frontend pages, RBAC with 19 permission rules, 36 feature flags, and zero formal test infrastructure. The goal is to build a real test suite that catches functionality and logic flaws across the entire application lifecycle — from startup to shutdown. Shopify integration is excluded (tested separately).

During code review, **15 probable bugs** were identified in the source code. The test plan is ordered to surface these bugs as early as possible.

### Bugs Found During Code Review

| ID | File | Severity | Description |
|----|------|----------|-------------|
| B1 | sales.js | HIGH | `hasError` race condition — flag set in async SQLite callbacks but checked synchronously after `stmt.finalize()`. Partial commits possible on item/stock errors. Same pattern in purchase-orders.js, returns.js, supplier-returns.js |
| B2 | sales.js | HIGH | Stock deduction has no `WHERE quantity >= ?` guard — selling 10 units with 3 in stock creates negative `outlet_stock.quantity` |
| B3 | sales.js | HIGH | Wallet payment debits `customers.balance` without checking sufficient balance — customers can overdraw to negative |
| B4 | purchase-orders.js | MEDIUM | TOCTOU race on PO receive — status check before transaction. Two concurrent receives both pass the "Draft" check |
| B5 | purchase-orders.js | MEDIUM | Partial receive broken — omitted items fall back to FULL ordered quantity instead of zero |
| B6 | grn.js | MEDIUM | Supplier invoice INSERT runs outside the transaction — GRN commits but invoice creation can silently fail |
| B7 | attendance.js | MEDIUM | PIN clock-in has no transaction wrapping — crash between steps leaves orphaned sessions/records |
| B8 | attendance.js | LOW | Clock-out day-record UPDATE uses work session's `outlet_id` — mismatched outlets cause zero-row UPDATE |
| B10 | promotions.js | MEDIUM | BXGY treats cart lines independently — same product split across 2 lines doesn't combine quantities |
| B11 | reports.js | MEDIUM | Dashboard Z-Report query missing `WHERE voided = 0` — voided sales inflate revenue |
| B12 | reports.js | MEDIUM | Shift close cash expected has no upper-bound timestamp — multi-day open shifts include all subsequent sales |
| B14 | tier4.js | LOW | Payroll `date(check_in)` uses UTC, not localtime — midnight-crossing shifts attributed to wrong day |
| B15 | supplier-returns.js | LOW | Stock deduction has no negative-stock guard (same as B2) |
| B16 | returns.js | MEDIUM | No validation that returned items actually belong to the original sale — can return arbitrary products/quantities |
| B17 | reconciliation.js | LOW | Self-approval check skipped for all_access users — administrators can approve their own requests |

### Framework Choices

| Layer | Framework | Why |
|-------|-----------|-----|
| Backend unit/integration | **Vitest + Supertest** | Fast, native ESM, same API as Jest. Supertest mounts Express in-process — no live server needed |
| Frontend component tests | **Vitest + @testing-library/react + jsdom** | Standard React testing. Vitest integrates with Vite config |
| Frontend E2E | **Playwright** (already installed) | Real browser tests for full user journeys |

### Test Database Isolation Strategy

Leverage the existing dependency injection pattern (`registerAllRoutes(app, deps)`) to inject an in-memory SQLite DB per test suite. Each test file gets its own isolated DB. No production data touched.

### Directory Structure

```
backend/
  vitest.config.js
  tests/
    helpers/
      createTestApp.js          # App factory with in-memory DB
      seedSchema.js             # Schema from db.js + migrate56.js
      seedData.js               # Standard fixtures
      request.js                # Supertest wrapper with auth headers
    unit/
      promotions-engine.test.js
      attendance-calc.test.js
    integration/
      auth.test.js, rbac.test.js, feature-flags.test.js
      sales.test.js, returns.test.js, inventory.test.js
      promotions.test.js, attendance.test.js, shifts.test.js
      purchase-orders.test.js, supplier-payables.test.js
      customers.test.js, reports-dashboard.test.js, reports-detail.test.js
      hr-payroll.test.js, reconciliation.test.js, orders.test.js
      crud-modules.test.js

frontend/
  vitest.config.js
  tests/
    setup.js
    unit/
      AuthProvider.test.jsx, RequireAuth.test.jsx, RequirePerm.test.jsx
      AppLayout.test.jsx, KioskRedesign.test.jsx
    e2e/
      playwright.config.js
      auth.spec.js, pos-checkout.spec.js
      kiosk-attendance.spec.js, rbac-access.spec.js
```

### Implementation Phases (13 total, ~250 test cases)

| Phase | Focus | Test Cases | Bug Targets | Status |
|-------|-------|------------|-------------|--------|
| 1 | Test infrastructure setup | Config, helpers, npm scripts | — | **DONE** ✓ (9/9 pass) |
| 2 | Sales, Stock & Returns | 44 | B1, B2, B3, B16 | **DONE** ✓ (44/44 pass) |
| 3 | Auth, RBAC & Feature Flags | 27 | — | **DONE** ✓ (27/27 pass) |
| 4 | Promotions Engine | 17 | B10 | **DONE** ✓ (17/17 pass) |
| 5 | Attendance & Kiosk | 29 | B7, B8 | Pending |
| 6 | Shifts / Cash Management | 15 | B12 | **DONE** ✓ (15/15 pass) |
| 7 | Purchase Orders & Supplier Payables | 20 | B4, B5, B6 | **DONE** ✓ (20/20 pass) |
| 8 | Customer Loyalty & Wallet | 14 | B3 | Pending |
| 9 | Reports Accuracy | 16 | B11 | Pending |
| 10 | HR Payroll & Approvals | 19 | B14, B17 | Pending |
| 11 | CRUD Modules (catch-all) | ~50 | — | Pending |
| 12 | Frontend Component Tests | 12 | — | Pending |
| 13 | E2E Browser Tests (Playwright) | 19 | — | Pending |

### Execution Priority (bug-finding value)

| Order | Phase | Why First |
|-------|-------|-----------|
| 1 | Phase 1 (Infrastructure) | Everything depends on this |
| 2 | Phase 2 (Sales/Stock/Returns) | Money bugs — checkout is the core path |
| 3 | Phase 3 (Auth/RBAC) | Security foundation |
| 4 | Phase 6 (Shifts) | Financial reporting bug |
| 5 | Phase 4 (Promotions) | Revenue loss bug |
| 6 | Phase 7 (PO/Payables) | Supplier data integrity |
| 7 | Phase 5 (Attendance) | Data corruption risk |
| 8 | Phase 9 (Reports) | Dashboard accuracy |
| 9 | Phase 8 (Customers) | Wallet integrity |
| 10 | Phase 10 (HR/Approvals) | Compliance risk |
| 11 | Phase 11 (CRUD) | Completeness |
| 12 | Phase 12 (Frontend unit) | Component correctness |
| 13 | Phase 13 (E2E) | Full integration; slowest to write/run |

Full detailed test cases for each phase are in the plan file at `.claude/plans/starry-stirring-octopus.md`.
