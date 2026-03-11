# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
*Last updated: March 12 2026 — MT Phase 1 blockers fixed. Multi-tenant go-live plan finalized. All foundation phases shipped.*

---

## ✅ Already Built & Shipped

- POS sell screen with shift/attendance gating
- Park Sale + Previously Parked Sales
- Sales History with Returns & Exchanges (bill-linked + no-bill)
- Cash Management (denomination-based open/close, variance capture)
- Purchase Orders → GRN flow (partial receive, auto-invoice)
- Stock Adjustments, Transfers, Returned Stock (RMA)
- Supplier Payables (aging, ledger, payment recording) — pagination fixed
- Attendance + Kiosk PIN clock-in/out with breaks
- Barcode scanner (global keydown, 100ms debounce) — now uses `/scan/:barcode`
- ESC/POS thermal printer + email receipts (nodemailer SMTP)
- Receipt Templates (header/footer/barcode, active template)
- Shopify integration (import, sync, webhooks, reconciliation, event log)
- Hierarchical categories (tree CRUD, leaf-only assignment)
- Variant products (attribute sets, cartesian generation)
- Promotions / discount rules (percent, fixed, threshold, BXGY) + quote tester
- Reports V2 — 67 tabs + 5 new endpoints added: dead-stock, pricing-margin, forecast-demand, replenishment-smart, purchase-orders-report
- Operations Dashboard (auto-refresh, KPIs, outlet ranking, exceptions) + top products, yesterday deltas, inventory value card now wired up
- SaaS Phase 1–5 (multi-tenant ready, JWT auth, super-admin dashboard)
- Customer wallet (balance + ledger + debit on sale)
- Loyalty points (earn/redeem on sales, stored per customer)
- Quotations (full CRUD + convert-to-sale)
- Orders (web orders, bulk status update, fulfillments)
- CRM (leads, stages, activity timeline)
- HR (leave requests, leave balance, payroll periods + line items)
- Accounting (P&L, Cashflow daily, AP/AR summary)
- Action History (audit log) — date range + action type filters added
- Sales History — employee + payment method filters added
- Cash Management — denomination subtotals (count × value) added
- Product image upload route (multer, backend/uploads/products/)
- Customers — broken bulk delete UI removed

---

## ✅ Roadmap Phase 2 — All 25 Items Complete (Mar 9 2026)

### 🔴 High Priority (all done)
- **#1 Loyalty & Wallet Frontend** — POS checkout shows points + wallet balance, redeem toggle, Customers loyalty/wallet tab
- **#2 Security Fixes** — SEC6 (x-employee-id header injection) + SEC8 (feature-flags requires auth) — all 8 security tests pass
- **#3 Reorder Alerts Page** — sidebar entry under Stock Control, lists products with <14 days stock, Create PO button

### 🟡 Medium Priority (all done)
- **#4 Accounting Cashflow + AP/AR** — `Accounting.jsx` Cashflow + AP/AR tabs now fetch from live backend endpoints
- **#5 HR Leave Balance + Payroll Lines** — `HRManagementRedesign.jsx` Leave Balance + Payroll tabs wired to live endpoints
- **#6 FBR Integration** — placeholder comment added, deferred for future implementation
- **#7 Advance / Layaway Payments** — deferred (not in this phase)
- **#8 Purchase Orders Edit + Approval** — `PUT /api/purchase-orders/:id`, approve button (manager/admin), Draft→Approved→Received badges
- **#9 Orders Detail Transactions + Fulfillments** — Transactions tab + Fulfillments tab inside order detail modal
- **#10 Quotations Email Send** — `POST /api/quotations/:id/send` backend + Send button in UI using nodemailer

### 🟢 Low Priority (all done)
- **#11 Parked Sales Management Page** — standalone admin page at `/parked-sales`, view/delete across outlets
- **#12 Stock Adjustments Delete** — admin delete action with confirmation
- **#13 Transfers Reverse** — Reverse Transfer action moves stock back
- **#14 Supplier Payables Payment Void** — void action with reason on recorded payments
- **#15 Supplier Delete Protection** — guard blocks delete when outstanding invoices exist
- **#16 Category Delete Protection** — guard blocks delete when products are assigned
- **#17 CRM Typed Activities** — activity types: Call, Email, Meeting, Demo, Follow-up
- **#18 Backup Progress Indicator** — spinner + status message during restore
- **#19 Notifications Centre** — page + sidebar entry at `/notifications`
- **#20 Serial Number Tracking** — backend routes + frontend assignment at POS
- **#21 Gift Cards / Vouchers** — backend routes + frontend redeem UI
- **#22 Purchase Order Templates** — save/load PO templates
- **#23 Products Stock by Outlet Popup** — outlet stock breakdown in inventory list
- **#24 Action History Logging** — expanded logging for sales, returns, adjustments
- **#25 Reports Governance UI** — schedule manager + saved views UI in Reports

---

## ✅ Currency & Timezone Centralization (Mar 12 2026)

**Branch:** `feature/currency-timezone-centralization` — 13 commits, ~58 files modified.

- **`CurrencyProvider` context** — `frontend/src/contexts/CurrencyContext.jsx` wraps the whole app (outside `AuthProvider`). `useCurrency()` returns `{ symbol, code, denominations, fmt, refresh }`.
- **Public currency endpoint** — `GET /api/company-profile/currency` (no auth) serves current currency symbol, code, and cash denominations. Works on unauthenticated pages (SetupWizard, CustomerDisplay).
- **`cash_denominations` column** — Added to `company_profile` (schema migration v2). JSON array string. Configurable per tenant.
- **All ~58 PKR/PKRs hardcodes removed** — Backend email builders, printer service, quotation emails, GRN error messages all use `req.company.currency_symbol`. Frontend components use `useCurrency()`. Non-component utilities (receipt.js) accept `currencySymbol` as parameter.
- **Setup wizard** — Full IANA timezone searchable dropdown (`Intl.supportedValuesOf("timeZone")`). Denomination chip editor with per-country presets. Denominations sent to backend on wizard completion.
- **Company Settings** — Same timezone dropdown + denomination editor. Calls `refresh()` after save so currency changes propagate app-wide immediately.

---

## 🔵 Competitor Gap Analysis (vs XStak ShopDesk)

| Feature | Priority | Status |
|---------|----------|--------|
| FBR e-invoicing | 🔴 High | Placeholder added, deferred |
| Advance/layaway payments | 🟡 Medium | Deferred |
| Serial number per sale | 🟢 Low | Built (Mar 9 2026) |
| Shopcast digital signage | 🟢 Low | Not built |

**We have that XStak doesn't:**
- Supplier Payables with aging + ledger
- Multi-level Approvals workflow
- Attendance + Kiosk terminal
- Shift denomination capture
- 67+ report tabs (vs their 22)
- SaaS / multi-tenant architecture
- ESC/POS thermal printer integration
- Email receipts via SMTP

---

## 🚀 Multi-Tenant Go-Live — The Plan

**Strategy (decided Mar 12 2026):** Multi-tenant is the ONLY mode going forward. Single-tenant was the development foundation. A "single store" customer = MT customer on Starter plan (`max_outlets=1`). No architectural difference — just plan limits.

**Business model:** Super-admin provisions tenant → assigns plan → sends setup token → customer onboards → works within plan limits. Upgrade = bump `max_outlets`/`max_employees`/`max_products` in master DB.

**Database:** Same Supabase Postgres instance. `public` schema = master tables. `tenant_<slug>` schemas = per-tenant business data. Current test data (Hassan, Packages Mall) becomes the first real tenant.

---

### ✅ MT Phase 1 — Fix HIGH Blockers (Mar 12 2026) — All 6 Fixed

Branch: `feature/mt-phase1-blockers` — 4 commits, 4 files modified.

| # | Item | Fix Applied |
|---|------|------------|
| 1 | ~~`loadCompanyProfile` per-tenant cache~~ | `_companyCache` Map keyed by `tenantId\|"_default"` replaces global `_cachedCompany` |
| 2 | ~~Context enforcement flag global~~ | `_contextFlagCache` Map keyed by `tenantId\|"_default"` replaces global `_contextEnforced` |
| 3 | ~~Boot-time eager load hits wrong DB~~ | Guarded with `if (!IS_MULTI_TENANT)` — MT tenants load lazily on first request |
| 4 | ~~Setup gate is global~~ | Now checks `entry.profile` from per-tenant cache, not global variable |
| 5 | ~~`admin.js` auditLog wrong DB~~ | Changed to `masterDb.query()` — `master-db-pg.js` exports `query()` |
| 6 | ~~Customer display shift ID collision~~ | Keyed by `${tenantSlug}-${shiftId}` — frontend passes `&tenant=` in MT mode |

---

### 🟡 MT Phase 2 — Onboarding & Operations

These enable the core MT workflow: provisioning tenants, managing plans, running background jobs per-tenant.

| # | Item | Description |
|---|------|-------------|
| 7 | **Super-admin tenant onboarding UI** | Currently CLI-only (`tenant-provisioner-pg.js`). Add "Create Tenant" flow in `/admin` dashboard — select plan, provision schema, generate setup token, display/copy link |
| 8 | **Setup wizard MT adaptation** | Current wizard is single-tenant boot. In MT: tenant-scoped token from super-admin, setup writes to tenant schema, no global 503 gate |
| 9 | **Tenant-aware scheduled jobs** | Stale attendance session cleanup, sync event cleanup, Shopify inventory worker, EOD digest — all currently run on global `db`. Must iterate all active tenants via `tenant-db-manager-pg` |
| 10 | **Notification helpers use global `db`** | `createNotification()` and `notifyLowStockForSale()` in `index.js:830-864` call global `db` — notifications go to wrong tenant. Must use proxy or pass tenant DB |
| 11 | **Per-tenant rate limiting** | Current rate limiter is global (20 req/15min). Need per-tenant buckets keyed by `tenantSlug + IP` so one busy tenant doesn't starve others |

---

### 🟢 MT Phase 3 — Production Hardening & Scale

These aren't blockers for initial go-live but needed for production-grade multi-tenant operation.

| # | Item | Description |
|---|------|-------------|
| 12 | **Subdomain/slug routing** | Incoming requests resolve to tenant via subdomain (`store1.sanopos.com`) or URL path. Frontend `Login.jsx` already has Store Code field gated by `VITE_MULTI_TENANT` |
| 13 | **Tenant isolation testing** | Automated tests: provision 2 tenants, verify no cross-tenant data leakage across all major endpoints (sales, products, employees, reports). Run AFTER Phase 1 fixes |
| 14 | **Backup/restore per-tenant** | Current backup is SQLite-only. Need `pg_dump --schema=tenant_<slug>` scoped to individual tenant schema. Restore = `pg_restore` into same schema |
| 15 | **Feature flag cache per-tenant** | `getFeatureFlagsMap()` in `index.js:796` queries feature flags but cache isn't tenant-keyed. Low risk (no caching currently) but should be formalized |
| 16 | **Subscription / billing layer** | Stripe or JazzCash integration for plan billing, trial enforcement, subscription expiry. Build after stable MT operation |
| 17 | **Tenant health monitoring** | Super-admin visibility: DAU/MAU per tenant, last login, failed jobs, plan limit proximity, schema size |

---

### ✅ MT Prerequisites — Already Done

- ~~SaaS Phases 1-5~~ — master DB, JWT auth, DB proxy, plan limits, super-admin dashboard (built Mar 2026)
- ~~Timezone Phase 1~~ — UTC vs LOCAL correctness across all routes
- ~~Timezone Phase 2~~ — **RESOLVED** by Postgres migration (eliminated all SQLite `'localtime'` modifiers)
- ~~MT Postgres infra~~ — `tenant-db-manager-pg.js`, `tenant-db-proxy-pg.js`, `index.js` branching
- ~~MT auth routes~~ — `auth.js` fully converted to async/await Postgres (`mt-login`, `refresh`, `kiosk-login`, `update-context`)
- ~~Railway multi-DB volume~~ — **RESOLVED** by Postgres schema-based multi-tenancy (`SET search_path TO tenant_<slug>`)
- ~~Plan limits middleware~~ — `plan-limits.js` enforces `max_employees`/`max_products`/`max_outlets` from `tenant_plans`

---

## ✅ Postgres Migration — Complete & Live (Mar 12 2026)

**Branch:** `feature/postgres-migration` — merged to `main` (28 commits, 93 files, +23,188 / -15,139 lines).

**Production:** Railway backend now runs on Supabase Postgres (ap-southeast-1). Fresh DB created via setup wizard.

### What Was Done
- **Batches 1-9**: All backend route files converted from SQLite callbacks (`db.run/get/all`) to Postgres async/await (`db.query()` with `$1,$2` params). 340/340 pg tests passing.
- **Pre-merge tasks**: `migrate-pg.js` (migration runner), `scripts/sqlite-to-pg.js` (data migration), `tenant-db-manager-pg.js` + `tenant-db-proxy-pg.js` (MT Postgres infra), boolean audit across all files.
- **Boot guard**: `index.js` conditionally loads `db-pg` or `db` based on `DATABASE_URL`. `dotenv` loaded first (line 1) to ensure env vars are available.
- **Cutover**: `DATABASE_URL` set on Railway, `DATA_DIR` removed. Setup wizard created store, outlet, admin account.

### Key New Files
| File | Purpose |
|------|---------|
| `backend/db-pg.js` | pg.Pool wrapper — `query()`, `transaction()`, `getClient()` |
| `backend/schema-pg.sql` | Full DDL + seed data + schema_version table |
| `backend/migrate-pg.js` | Version-tracked migration runner |
| `backend/scripts/sqlite-to-pg.js` | One-time SQLite→Postgres data migration |
| `backend/tenant-db-manager-pg.js` | Schema-switching multi-tenant |
| `backend/tenant-db-proxy-pg.js` | AsyncLocalStorage proxy for per-request DB routing |
| `backend/master-db-pg.js` | Postgres master DB for tenant registry |
| `docker-compose.yml` | Local Postgres for testing |

### SQLite Cleanup (deferred)
- `backend/db.js` (SQLite module) still exists — boot guard falls back to it without `DATABASE_URL`
- SQLite volume still mounted on Railway as safety net
- After 1 week with no issues: remove volume, remove `db.js`, remove `better-sqlite3` from package.json

---

## ✅ First-Run Setup Wizard (Built Mar 10 2026)

`migrate72.js` + `backend/routes/setup.js` + `frontend/src/pages/SetupWizard.jsx` — token-gated 4-step wizard.

### The Problem It Solves
1. Fresh database has no employees — nobody can log in to configure the store
2. Default timezone (`Asia/Karachi`) is wrong for any non-Pakistan deployment
3. Default currency (`PKR`) is wrong for international stores
4. Previously required a temporary `SETUP_SECRET` endpoint hack to bootstrap the first admin
5. Users who never visit Company Settings run with incorrect defaults forever

### Design: Invitation Link (One-Time Token)

**Single-tenant mode (`MULTI_TENANT=0`):**
- Server boots, sees `setup_complete = 0`, generates a random setup token
- Token stored in `company_profile.setup_token`
- Server logs a setup URL to console: `https://your-app.com/setup?token=a8f3c9...`
- Deployer clicks the link or sends it to the store owner
- Wizard validates token → runs setup → deletes token → sets `setup_complete = 1`
- Link is dead forever after first use

**Multi-tenant mode (`MULTI_TENANT=1`):**
- No public wizard — tenants are provisioned by super-admin
- Super-admin provisions tenant → gets a setup link from Admin Dashboard
- Tenant owner clicks link → same wizard → configures their own store
- Same token mechanism, same wizard code — works identically for both modes

**Server restart safety:** If `setup_complete = 0`, server regenerates and logs a new token on every boot (in case the deployer lost the original).

### Wizard Screens (4 steps, cannot be skipped)

**Screen 1 — Store Identity**
- Store name (required)
- Country (dropdown — auto-suggests timezone + currency on next screen)
- City
- Phone / Email

**Screen 2 — Time, Location & Currency**
- Timezone — searchable dropdown, pre-filtered by country from screen 1
- **Live clock preview:** "Current time in Asia/Karachi: 11:42 PM, Mar 9" — user sees immediately if it's correct
- Currency symbol + currency code (auto-filled from country, can override)
- Fiscal year start month
- Primary tax name + rate (optional — "Skip, I'll add later" button)

**Screen 3 — First Outlet**
- Outlet name (default: "Main Store")
- Outlet address (optional — appears on receipts)

**Screen 4 — Administrator Account**
- Your name (required)
- Choose PIN — 4-6 digits, with confirm field
- Auto-assigned: Administrator role + assigned to outlet from screen 3

### What `POST /api/setup/complete` Creates (in one transaction)

1. Updates `company_profile` — store name, country, city, timezone, currency, fiscal year, tax
2. Creates first outlet (or updates existing if seed created one)
3. Creates default roles: Administrator, Manager, Cashier + permission sets
4. Creates first employee (Administrator) with chosen PIN + assigns to outlet
5. Creates default receipt template (so POS print works on day one)
6. Seeds feature flags with sane defaults
7. Sets `setup_complete = 1`, deletes `setup_token`
8. Returns `{ success: true }` → frontend redirects to `/login`

### Security

- Wizard endpoint only works when `setup_complete = 0` AND token matches
- Once used, token is deleted — endpoint permanently rejects all future calls
- No env var secrets needed — token is auto-generated
- Backend rejects ALL other API calls with `503 Setup required` until wizard completes

### Backend middleware check

```
if (!MULTI_TENANT && !company.setup_complete) {
  // Only allow /api/setup/* endpoints
  // Everything else → 503 "Setup required"
}
```

### Important: server TZ env var still needed

The wizard sets `company_profile.timezone` which fixes all report date filters. But `attendance_sessions` uses SQLite `datetime('now','localtime')` which reads the **server OS timezone**. The wizard should display a reminder on the final screen:

> "For attendance times to be stored correctly, ensure your server's `TZ` environment variable is set to `Asia/Karachi`."

In multi-tenant mode, Timezone Phase 2 (GROUP BY localtime → tenant tz) must also be completed.

### Files to Create/Modify

| File | Action |
|------|--------|
| `backend/migrate71.js` | Add `setup_complete INTEGER DEFAULT 0` + `setup_token TEXT` to `company_profile`; existing deployments auto-set `setup_complete = 1` |
| `backend/routes/setup.js` | `GET /api/setup/status`, `POST /api/setup/complete` (token-gated, creates all seed data) |
| `backend/index.js` | Middleware: if `!setup_complete`, block all routes except `/api/setup/*` with 503; on boot if `setup_complete = 0`, generate token + log URL |
| `frontend/src/pages/SetupWizard.jsx` | 4-step wizard with live timezone preview |
| `frontend/src/App.jsx` | Add `/setup` route (unauthenticated, before `RequireAuth`) |
| `backend/run_migrations.js` | Add `migrate71.js` to migration array |
| `backend/tenant-provisioner.js` | Generate setup token for new tenants, return it to super-admin |
| `frontend/src/pages/admin/AdminTenantDetail.jsx` | Show/regenerate setup link for provisioned tenants |

### How existing deployments are handled

`migrate71.js` should:
```sql
ALTER TABLE company_profile ADD COLUMN setup_complete INTEGER DEFAULT 0;
ALTER TABLE company_profile ADD COLUMN setup_token TEXT;
-- Auto-complete for existing stores (they're already configured)
UPDATE company_profile SET setup_complete = 1 WHERE company_name != 'My Store' OR timezone != 'Asia/Karachi';
-- Safety: if ANY employees exist, store is already set up
UPDATE company_profile SET setup_complete = 1 WHERE (SELECT COUNT(*) FROM employees) > 0;
```

---

## 🐛 Known Live Bugs (Production)

### ~~BUG-1~~: `ContextSwitcher` calls `/api/context/bootstrap` without auth headers — ✅ FIXED Mar 9 2026
**File:** `frontend/src/components/ContextSwitcher.jsx`
**Root cause:** Missing `{ headers: authHeaders() }` — caused POS Opening Gate to show empty branch dropdown, blocking the entire POS flow including product search
**Fix applied:** Added `authHeaders` from `useAuth()` and passed it to the fetch call

### ~~BUG-2~~: Dashboard KPIs show "No sales yet today" despite recent sales existing — ✅ RESOLVED (auto-fixed by BUG-1)
**Root cause:** Caused by BUG-1 — no outlet context stored after login so `/api/reports/dashboard` had no `x-outlet-id`; resolved automatically when BUG-1 (ContextSwitcher auth headers) was fixed.

### ~~BUG-3~~: `ReportsSales.jsx` calls report endpoints without explicit auth headers — ✅ FIXED Mar 10 2026
**Fix applied:** Added `import { useAuth }` and `const { authHeaders } = useAuth()` to all 10 tab components; each `fetch()` call now passes `{ headers: authHeaders() }` explicitly. No longer dependent solely on the `window.fetch` patch race condition.

---

## ✅ Phase 3 — Core Robustness (Mar 10 2026) — 8/9 items shipped

These items make the product reliable for the current single-tenant production deployment. Built on `feature/phase3-robustness` branch (8 commits, 27 files, 1,824 lines).

### P0 — Do First (Highest Impact)

- ~~**Split payment at POS**~~ — ✅ **Already built** (verified Mar 10 2026). `POST /api/sales` accepts `payments[]` array, `sale_payments` table stores each tender, frontend `POSCheckoutModal.jsx` has full multi-tender UI, receipts show breakdown, reports aggregate by method. Minor gap: returns only support single `refund_method` (no split refunds).
- ~~**Login brute-force throttling**~~ — ✅ **Fixed** (Mar 10 2026). Changed `skip: () => true` → `skip: () => process.env.NODE_ENV === 'test'` — rate limiter now active in production (429 after 20 req/15min), disabled during test runs.
- **Offline sale queuing** — ⏳ **Deferred** (3-5 day effort). Service worker only handles GET, no IndexedDB queue, no Background Sync. Needs full SW rewrite + reconnect sync + offline indicator UI.
- ~~**Soft deletes on core tables**~~ — ✅ **Built** (Mar 10 2026). `migrate73.js` adds `deleted_at DATETIME DEFAULT NULL` to products, customers, employees. DELETE endpoints → UPDATE SET deleted_at. Listings filter `WHERE deleted_at IS NULL`. Frontend "Delete" → "Archive" wording. Report JOINs untouched (historical data preserved). 3 test files updated.
- ~~**Idempotency on POST /api/sales**~~ — ✅ **Built** (Mar 10 2026). `migrate71.js` adds `idempotency_key TEXT` + unique index on `sales`. Frontend generates `crypto.randomUUID()` per sale. Backend checks for duplicate before insert, returns `{ duplicate: true }` if found.

### P1 — High Value, Low Effort (all done)

- ~~**End-of-day email digest**~~ — ✅ **Built** (Mar 10 2026). `backend/utils/digestEmail.js` builds HTML email; `reports/governance.js` sends via nodemailer when `schedule.recipient` is email + `report_key = "eod-digest"`.
- ~~**Price change audit log**~~ — ✅ **Built** (Mar 10 2026). `products.js` PUT compares old/new price+cost, inserts into `action_history` with `action_type = "price_change"`.
- ~~**In-app onboarding checklist**~~ — ✅ **Built** (Mar 10 2026). `DashboardOnboarding.jsx` — 5-step checklist, progress bar, dismiss via localStorage, auto-dismiss after 3s when all complete.
- ~~**Session timeout handling at POS**~~ — ✅ **Built** (Mar 10 2026). `POSSessionExpiredModal.jsx` — PIN re-login auto-retries pending sale; "Park sale & go to login" option.

### P2 — Important But Can Wait

- **Subscription / billing layer** — Stripe or JazzCash integration for plan billing, trial enforcement, subscription expiry. Build after tenant isolation is complete.
- **Tenant health monitoring** — Super-admin visibility into tenant DAU/MAU, last login, failed jobs, plan limit proximity, DB size. Build after stable multi-tenant infrastructure.
- ~~**Mobile / tablet POS layout**~~ — ✅ **Built** (Mar 10 2026). 3-tab nav (Cart/Search/Pay) on `<768px`, sticky pay button, touch-friendly qty controls, 2-col mobile grid; desktop unchanged.
- ~~**IP allowlisting for /api/admin**~~ — ✅ **Built** (Mar 10 2026). `ADMIN_ALLOWED_IPS` env var (comma-separated IPs/CIDR), `requireAllowedIp` middleware in `admin.js`, backward compatible (empty = allow all).
- ~~**Stock discrepancy / shrinkage report**~~ — ✅ **Built** (Mar 10 2026). `GET /api/reports/shrinkage` (6-join SQL), `ShrinkageTab` in `ReportsInventory.jsx`, color-coded variance + CSV export.

### P3 — Nice to Have

- ~~**Customer-facing display**~~ — ✅ **Built** (Mar 10 2026). `backend/routes/customer-display.js` (in-memory Map, 8h auto-cleanup), `CustomerDisplayPage.jsx` dark-theme at `/customer-display`, `POSContext.jsx` debounced (500ms) cart push.
- **Weighing scale integration** — USB scale support for weight-based pricing. Niche (grocery, pharmacy) but expands addressable market.
- ~~**API key revocation**~~ — ✅ **Built** (Mar 10 2026). `migrate74.js` (`revoked_tokens` table + `tokens_revoked_before`), `jti` claim in `signAccessToken`, revocation check in `loadTenantAndPerms`, revoke endpoints in `employees.js`, Revoke button in `EmployeesRedesign.jsx`.

---

## 📋 Discussed but Deferred

- **Offline sale queuing** — needs full SW rewrite + IndexedDB + Background Sync (3-5 day effort)
- **Payment gateway integration** (card machines, JazzCash, EasyPaisa)
- **Profit-sharing / payroll module** — seed data mentions it but no UI
- **Shopcast / digital signage**
- **FBR e-invoicing** — placeholder added; needed for Pakistan tax compliance but deferred
- **Advance / layaway payments** — installment-based sales; common in furniture/electronics retail
- **Weighing scale integration** — USB scale for weight-based pricing (grocery, pharmacy)

---

## 🔍 Audit History

| Date | What | Result |
|------|------|--------|
| Mar 9 2026 | Full 38-area backend↔frontend audit | 25+ gaps found, documented |
| Mar 9 2026 | 6 parallel fix sessions | 11 gaps fixed, 18 files changed, 1,410 lines, zero regressions |
| Mar 9 2026 | Merged + pushed to main | Live on Vercel + Railway |
| Mar 9 2026 | Roadmap Phase 2 — 9 parallel sessions | All 25 remaining items complete, 28 files changed, 2,936 lines, 395/395 tests passing |
| Mar 9 2026 | Merged feature/roadmap-phase2 → main | Live on Vercel + Railway |
| Mar 9 2026 | **BUG FIX — POS product search broken** | `POSContext.jsx` `triggerSearch()` called `fetch()` without `authHeaders()` → backend rejected with "Not found"; fixed in PR #3, merged + deployed |
| Mar 9 2026 | **BUG FIX — POS Opening Gate empty branch dropdown** | `ContextSwitcher.jsx` called `/api/context/bootstrap` without `authHeaders()` → 401, no outlet stored in context → POS gate never cleared; fixed + pushed to main, deployed |
| Mar 9 2026 | **Railway 502** | Backend went down (unrelated to code); redeployed via Railway GraphQL API from CLI, back up within ~35 seconds |
| Mar 10 2026 | Phase 3 robustness backlog added | 14 items across P0–P3: offline queuing, split payment, brute-force throttling, soft deletes, idempotency, end-of-day digest, price audit log, onboarding checklist, session timeout, billing layer, tenant health monitoring, mobile layout, IP allowlisting, shrinkage report |
| Mar 10 2026 | Phase 3 P0 deep audit | Split payment confirmed fully built (moved to shipped). Rate limiter found DISABLED (`skip: () => true` in index.js:191) — 1-line fix needed. Soft deletes, idempotency, offline queuing confirmed not built. Offline queuing worse than estimated — SW only handles GET, AuthProvider blocks POST with 503, no IndexedDB/queue/retry exists. |
| Mar 10 2026 | **Phase 3 shipped** | 8/9 items built on `feature/phase3-robustness` (8 commits, 27 files, 1,824 lines): rate limiter fix, idempotency on sales (migrate71), price audit log, email digest, session timeout at POS, onboarding checklist, setup wizard (migrate72), soft deletes (migrate73). Offline queuing deferred. 395/395 tests passing. Locally tested via Playwright. |
| Mar 10 2026 | **Phase 3 remaining shipped** | 5 items built on `feature/phase3-remaining` (4 commits, 21 files, 1,003 lines): mobile/tablet POS layout (3-tab nav, sticky pay button), IP allowlisting for /api/admin (CIDR matching), token revocation (migrate74, jti claim, revoke endpoints), stock shrinkage report (6-join SQL + ShrinkageTab), customer-facing display (/customer-display page + in-memory cart sync). 395/395 tests passing. Frontend build clean. |
| Mar 11 2026 | **Postgres migration — pre-merge tasks** | 4 tasks completed on `feature/postgres-migration`: last SQLite files converted (email.js, printer routes, registerAllRoutes.js), migrate-pg.js migration runner, sqlite-to-pg.js cutover script + checklist, MT Postgres infra (tenant-db-manager-pg, tenant-db-proxy-pg). 340/340 pg tests passing. |
| Mar 12 2026 | **Postgres migration merged + deployed** | `feature/postgres-migration` merged to `main` (28 commits, 93 files, +23,188/-15,139 lines). Boot guard added (conditional db-pg/db import). dotenv load order fix (must load before boot guard). Supabase Postgres provisioned (ap-southeast-1). `DATABASE_URL` set on Railway, `DATA_DIR` removed. Fresh DB created via setup wizard. `schema-pg.sql` seed row fix for company_profile. Production live on Postgres. |
| Mar 12 2026 | **Currency/timezone centralization** | `feature/currency-timezone-centralization` (13 commits, ~58 files). All ~58 hardcoded PKR/PKRs/Rs display references replaced. `CurrencyContext` + public `/api/company-profile/currency` endpoint. Schema migration v2 adds `cash_denominations` TEXT to `company_profile`. Setup wizard enhanced with full IANA timezone searchable dropdown + denomination chip editor. Company Settings gains same controls + calls `refresh()` to propagate changes app-wide. Backend email/printer/quotation templates now use `req.company.currency_symbol`. Frontend build clean, zero new test failures. |
| Mar 12 2026 | **MT go-live plan finalized** | Deep audit of `index.js`, `admin.js`, `auth.js`, `customer-display.js`, `setup.js` for MT readiness. Found 6 HIGH blockers (cross-tenant cache leaks, global setup gate, auditLog wrong DB, shift ID collision), 5 MEDIUM items, 6 LOW/deferred. Decision: multi-tenant is the ONLY mode — single-tenant was dev foundation. "Single store" = Starter plan with `max_outlets=1`. 3-phase plan: Phase 1 fix blockers → Phase 2 onboarding + operations → Phase 3 hardening + scale. |
| Mar 12 2026 | **MT Phase 1 blockers fixed** | `feature/mt-phase1-blockers` branch (4 commits, 4 files). All 6 HIGH blockers resolved: per-tenant `_companyCache` Map, per-tenant `_contextFlagCache` Map, boot IIFEs guarded with `!IS_MULTI_TENANT`, `auditLog()` uses `masterDb.query()`, `master-db-pg.js` exports `query()`, customer display keyed by `${tenantSlug}-${shiftId}`, `CustomerDisplayPage.jsx` passes `tenant` query param. Frontend build clean. Backend syntax check passed. |
