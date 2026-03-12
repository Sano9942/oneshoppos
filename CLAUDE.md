# SanoPOS - Project Guide for Claude

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + PostgreSQL (via `pg` pool, `backend/db-pg.js`). SQLite legacy code preserved for rollback.
- Frontend: React 19 + Vite 7 + Tailwind CSS v4

## Current Status Snapshot (March 2026)

- Latest migration (SQLite) is `backend/migrate74.js`
- **Postgres migration COMPLETE and LIVE** (Mar 12 2026) — merged to `main`, production running on Supabase Postgres. Boot guard in `index.js` conditionally loads `db-pg` (Postgres) or `db` (SQLite) based on `DATABASE_URL`. 340/340 pg integration tests passing.
- **Production database: Supabase Postgres** — `DATABASE_URL` set on Railway, `DATA_DIR` removed. Fresh DB via setup wizard (no SQLite data migrated). SQLite volume still mounted on Railway as safety net.
- **Currency/timezone centralization complete (Mar 12 2026)** — `CurrencyProvider` context live; all ~58 PKR/PKRs hardcodes replaced; `cash_denominations` column added (schema migration v2); setup wizard and company settings have full IANA timezone dropdown + denomination chip editor.
- **Offline sale queuing complete (Mar 12 2026)** — localStorage queue (50-sale cap), `completeSale` offline path with provisional receipts, auto-sync on reconnect via `online` event, multi-tab sync via `storage` event, amber POS banner with Sync Now button, wallet/points blocked offline, backend shift/attendance relaxation for offline replays, receipt shows "PENDING (offline)".
- **Tenant health monitoring complete (Mar 12 2026)** — expanded `GET /api/admin/tenants/:id/stats` (activity, revenue, capacity, schema size), new `GET /api/admin/attention` (approaching limits, dormant, setup pending), enriched tenant list (last_login, revenue_this_month), AdminTenantDetail 3-section health dashboard (activity + plan usage bars + storage), AdminTenantList health dot/revenue/last activity columns, AdminDashboard "Needs Attention" card.
- **MT Phase 1 blockers fixed (Mar 12 2026)** — 6 cross-tenant data leak / broken-functionality blockers resolved: per-tenant `_companyCache` Map (replaces global `_cachedCompany`), per-tenant `_contextFlagCache` Map (replaces global `_contextEnforced`), boot IIFEs guarded with `!IS_MULTI_TENANT`, `auditLog()` uses `masterDb.query()`, customer display keyed by `${tenantSlug}-${shiftId}`.
- **MT Phase 2 operations complete (Mar 12 2026)** — 9 tasks across ~10 files: setup token generation in tenant provisioner, admin API setup URL endpoints (get/regenerate), admin dashboard setup URL UI, setup wizard MT adaptation (tenant-scoped DB via URL param), tenant-scoped notification helpers, tenant-aware scheduled jobs (`forEachActiveTenant` helper), per-tenant rate limiting (`tenantSlug:IP` key generator). 55/55 pg-batch3 tests passing.
- **MT Phase 3 hardening complete (Mar 12 2026)** — per-tenant feature flag cache (60s TTL, invalidated on PUT), pg_dump/pg_restore backup/restore (replaces stubs), 7 tenant isolation integration tests (API isolation, DB isolation, concurrent request safety). Only subdomain/slug routing remains before MULTI_TENANT=1 can be flipped.
- `schema-pg.sql` includes seed INSERT for `company_profile` row (required for setup wizard token generation at boot).
- **Phase 3 Remaining complete (Mar 10 2026)**: 5 items shipped — mobile/tablet POS layout, IP allowlisting for admin API, JWT token revocation (migrate74), stock shrinkage report, customer-facing display
- **Roadmap Phase 3 complete (Mar 10 2026)**: 8 of 9 core robustness items shipped (offline queuing deferred) — rate limiter activation, session timeout at POS, idempotency on sales, price change audit log, end-of-day email digest, onboarding checklist, setup wizard, soft deletes
- **Roadmap Phase 2 complete (Mar 9 2026)**: All 25 remaining roadmap items shipped in 9 parallel sessions — loyalty/wallet frontend, security fixes (SEC6+SEC8), reorder alerts, accounting/HR wire-up, PO edit+approval, orders detail tabs, quotations email, parked sales page, stock/transfer/supplier/category guards, CRM typed activities, backup progress, notifications, serial numbers, gift cards, PO templates, stock-by-outlet popup, action history logging, reports governance UI
- **Test suite: 395/395 Jest integration tests passing (37 suites, 0 failures)**
  - 7 new test files added in Phase 6: data-integrity, negative-cases, security, auditability, concurrency, failure-handling, compliance
  - `shift-linkage.test.js` added: 3 tests verifying `shift_id` written to sales and returns at creation
  - `printer.test.js` added: 9 tests for `/api/print/*` routes
  - `email.test.js` added: 12 tests for `/api/email/*` routes
  - `saas-phase1.test.js` added: 14 tests for schema extraction, master DB, provisioner, db manager
  - `POST /api/sales` validates numeric price/quantity — non-numeric input returns 400
  - B-VARIANT production bug fixed: variant sales now decrement both `product_variants.stock` AND `outlet_stock`
  - `sales.shift_id` and `returns.shift_id` added (migrate63) and **written at sale/return creation** — shift reports use direct FK, not time-window matching
- Reports V2 core implementation is complete:
  - governance is integrated into the main reports workspace
  - report tabs were aligned to live backend payloads
  - report shell lazy-loading and chunk splitting are in place
  - report smoke Playwright coverage is passing
- POS operating flow is enforced:
  - branch selection happens inside POS
  - checkout is blocked unless a shift is open
  - checkout is blocked unless the logged-in employee is clocked in
  - opening and closing cash denominations are stored as auditable shift data
- Cash Management now uses the same denomination-based opening flow as POS
- Category selectors use breadcrumb paths, alphabetical ordering, and show all categories while disabling parent nodes for product assignment
- Shopify backend is modularized and metadata-safe:
  - `shopify_product_metadata` is live
  - SKU-only imports are supported
  - leading zeros in SKU/barcode are preserved
- Shopify frontend is partially modularized:
  - `frontend/src/pages/ShopifyIntegration.jsx` is the active workspace orchestrator
  - `frontend/src/pages/shopify/*` contains the active tab modules
  - `ShopifyIntegrationRedesign.jsx` is still mainly a shell wrapper
- Context Unification is live — mandatory post-login branch selection, backend enforcement via `x-outlet-id` header, kiosk context lock
- Current live E2E batches passing include report smokes plus `pos.spec.js`, `kiosk.spec.js`, and `rbac.spec.js`
- POS Recent Sales panel and Return/Exchange modal shipped (Mar 2026)
- Receipt system unified (Mar 2026): `frontend/src/utils/receipt.js` is the single source of truth for all receipt rendering — `buildReceiptSections(slip, template)` + `buildReceiptHtml(slip, template)` + `printToHardware(slip, template)`; POSContext fetches the active template on mount; Receipt Templates `header_text`, `footer_text`, `show_barcode` are now live in both print popup and modal
- ESC/POS thermal printer integration (Mar 2026): `backend/services/printer.js` (PrinterService, USB+TCP, paper-width-aware), `backend/routes/printer.js` (`/api/print/receipt`, `/api/print/status`, `/api/print/config`), `printer_config` table (migrate64); `POSContext.printSlip` tries hardware first, falls back to browser popup; Printer Settings page at `/printer-settings` (all_access only)
- Barcode scanner in POS (Mar 2026): `POSContext.jsx` global keydown listener — rapid keystroke detection (100ms debounce), calls `GET /api/products?barcode=<code>`, auto-adds first match to cart
- Cross-outlet reports (Mar 2026): all report endpoints now accept `outlet_id=1,2,3` (comma-separated); `buildReportFilterParts()` in `helpers.js` emits `IN(?,?)` for multi, `= ?` for single; `applyOutletFilter()` local helper in inventory, analytics, governance, sales, purchasing, staff; dashboard and finance use inline array expansion; frontend `Reports.jsx` uses `filters.outletIds[]` (array) with checkbox popover replacing single `<select>`
- Email receipts (Mar 2026): `backend/routes/email.js` (`/api/email/config`, `/api/email/test`, `/api/email/send-receipt`), `email_config` table (migrate65), `backend/utils/receiptEmail.js` (server-side HTML builder); `POSEmailReceiptModal.jsx` — on-demand send from Recent Sales panel + Receipt Modal; Email Settings section in Printer Settings page; nodemailer SMTP (Gmail/Outlook compatible); password never stored in frontend state
- SaaS Phase 1 complete (Mar 2026): `backend/schema-full.js` (live schema extractor via sqlite_master), `backend/master-db.js` (lazy-init master.db — tenant registry, 4 tables), `backend/tenant-db-manager.js` (in-memory connection pool, WAL+FK pragmas, graceful shutdown), `backend/tenant-provisioner.js` (CLI provisioner — directory, schema, seed data, transactional master.db registration); SCHEMA_VERSION=65; zero existing files modified; design at `docs/plans/2026-03-06-saas-phase1-design.md`
- SaaS Phase 2 complete (Mar 2026): JWT auth infrastructure — `backend/jwt-auth.js` (sign/verify access+refresh tokens, SHA-256 hash); `migrate66.js` (bcrypt `pin_hash` column on `employees`); `master-db.js` gets `tenant_refresh_tokens` table; `routes/auth.js` — bcrypt PIN verification with plaintext fallback, plus multi-tenant routes (`mt-login`, `refresh`, `update-context`, `kiosk-login`) gated behind `MULTI_TENANT=1`; `index.js` — `loadTenantAndPerms` JWT middleware (toggled by env flag), `cookie-parser` for httpOnly refresh cookie; `backend/.env.example` documents all new env vars; design at `docs/plans/2026-03-06-saas-phase2-jwt-auth-design.md`
- SaaS Phase 5 complete (Mar 2026): Super-Admin Dashboard — `backend/routes/admin.js` (13 endpoints: login, tenant CRUD, suspend/activate, migration runner, stats, PIN reset); `backend/tenant-migrate.js` (CLI + programmatic multi-tenant migration runner); `backend/seed-admin.js` (CLI super-admin seeder); frontend admin panel at `/admin/*` (5 pages: login, layout, dashboard, tenant list, tenant detail); admin JWT uses `jwt.sign()` directly with `role: "super_admin"` claim; routes mounted before tenant middleware in `index.js`; provisioner detects `pin_hash` column via PRAGMA for backward compat; `adminFetch` shared helper exported from `AdminLogin.jsx`; 296/298 tests passing
- SaaS Phase 3+4 complete (Mar 2026): Multi-tenant DB proxy + frontend JWT integration — `backend/tenant-db-proxy.js` (AsyncLocalStorage + Proxy pattern, routes all DB calls to tenant DB transparently); `backend/tenant-multer.js` (tenant-aware upload storage factories); `backend/middleware/plan-limits.js` (enforces max_employees/products/outlets from master.db plan); `resolveTenant` middleware in `index.js` wraps each request in ALS context; `registerAllRoutes.js` wires tenant-scoped `/uploads` serving; upload destinations in `orders.js`, `barcode-expenses.js`, `tier4/company-profile.js` made tenant-aware; frontend: `AuthProvider.jsx` rewritten for JWT Bearer auth + silent refresh (401 retry with httpOnly cookie) + `window._nativeFetch` anti-recursion; `Login.jsx` gains Store Code field (VITE_MULTI_TENANT env var); `ContextSelect.jsx` calls `/api/auth/update-context` to re-sign JWT with outlet; `config.js` exports `IS_MULTI_TENANT`; `authStore.js` gains `readToken`/`writeToken`/`readTenantSlug` helpers; `.env.development` + `.env.production` files added; 296/298 tests passing (zero regressions)
- Operations Dashboard complete (Mar 2026): `DashboardRedesign.jsx` rewritten as ~130-line thin orchestrator; 12 focused components in `frontend/src/pages/dashboard/` (KPICards, OpsReadiness, QuickActions, Exceptions, OutletRanking, Contribution, Trends, InventoryAlerts, Attendance, RecentSales, Attention, Shared); dashboard API extended with currency, targets, yesterday comparison (same-elapsed-time window), operationalReadiness[], exception pct_of_sales/pct_of_orders; `migrate69.js` adds monthly_sales_target + margin/refund/void threshold columns to company_profile and outlets; Company Settings gains Dashboard Targets section; Reports.jsx reads ?tab=&date=today&outlet_id= URL params on mount via TAB_ALIASES map
- Attendance double-localtime bug fixed (Mar 2026): `attendance_sessions.session_start` and `employee_attendance.check_in` are stored in local time (DEFAULT datetime('now','localtime')) — all queries now use `date(session_start)` / `date(check_in)` with NO 'localtime' modifier; using `date(col,'localtime')` on already-local values shifts dates forward by UTC offset causing wrong-day lookups; `migrate70.js` closes all stale open sessions from previous days (data artifact of the old bug)
- Attendance UTC-boundary bug fixed (Mar 2026): `GET /api/attendance`, `GET /api/attendance/sessions`, dashboard `attendanceToday` and `operationalReadiness` staffCounts queries were using `toUtcStart/toUtcEnd` on local-time columns — when company timezone is non-UTC (e.g. `Asia/Karachi` UTC+5), sessions after 19:00 local were excluded because the UTC end-of-day `"2026-03-07 19:00:00"` < local `"2026-03-07 21:xx:xx"`. Fix: all four queries now use `date(col) = ?` / `date(col) >= ?` / `date(col) <= ?` with plain YYYY-MM-DD strings — no UTC conversion for local-time columns
- Dashboard auto-refresh added (Mar 2026): `DashboardRedesign.jsx` auto-fetches every 60 seconds (silent background refresh via `refreshKey` state + `setInterval`) and shows a manual refresh button with last-updated timestamp in the subtitle
- Product form page (Mar 2026): `ProductFormPage.jsx` at `/products/new` + `/products/:id` — full-page Shopify-style two-column layout replacing the old compact modal; variant management UI with cartesian product generation from attribute sets; `GET /api/products/:id` added to backend; `InventoryRedesign.jsx` navigates to route instead of opening modal
- Repo cleanup (Mar 2026): deleted `reports.monolith.bak.js`, `reports.stable.bak.js`, `tier4.monolith.bak.js`, `ShopifyIntegration.monolith.bak.jsx` (dead backup files); deleted one-off debug scripts (`repro_zeros.js`, `test_zeros.js`, `verify_zeros_fix.js`, `preflight.js`, `setup_toy_store_defaults.js`, etc.); deleted 2,247 accumulated CSV exports; `backend/exports/`, `backend/uploads/`, `backend/test_results*.json` added to `.gitignore`
- Attendance UTC-boundary bug fixed (Mar 2026): `GET /api/attendance`, `GET /api/attendance/sessions` (both in `backend/routes/attendance.js`) and dashboard `attendanceToday` + `operationalReadiness` staffCounts (in `backend/routes/reports/dashboard.js`) were incorrectly filtering local-time columns using `toUtcStart/toUtcEnd` UTC boundaries — sessions after local 19:00 in `Asia/Karachi` were excluded. Fixed to use `date(col) = ?` / `date(col) >= ?` / `date(col) <= ?` with plain YYYY-MM-DD strings. RULE: **never use `toUtcStart/toUtcEnd` on `session_start` or `check_in` — those columns are local time**
- Dashboard auto-refresh (Mar 2026): `DashboardRedesign.jsx` now silently re-fetches every 60 seconds via `refreshKey` state + `setInterval`; manual refresh button in subtitle with spinning icon + last-updated timestamp
- Timezone Phase 1 complete (Mar 2026): All single-tenant timezone correctness bugs fixed (Sections A-F + J from `TIMEZONE-AUDIT.md`): backend UTC/LOCAL query fixes across 10 route files, `dates.js` dual-parser rewrite (UTC+LOCAL formatters), 13 frontend display fixes (C1-C5), stale attendance session auto-close (F1+F2), shared `applyUtcDateFilter`/`applyLocalDateFilter` helpers in `reports/helpers.js`; 292/298 tests passing (zero new regressions). **Sections J1/J2 + 2 additional files were missed in the original commit and fixed separately (Mar 9 2026):** `Attendance.jsx`, `KioskRedesign.jsx`, `ReportsStaff.jsx` all had `new Date(dt)` on LOCAL-time columns — Chrome parses space-separated SQLite strings as UTC causing -5h display shift; fixed by importing `parseLocalDate`/`fmtLocalTime`/`fmtLocalDate` from `dates.js`. `HRManagementRedesign.jsx` and `DashboardTrends.jsx` use `new Date(d + "T00:00:00")` which is correct for date-only strings — left unchanged.
- Multi-tenant readiness: Before flipping `MULTI_TENANT=1` in production, the following are still needed: (1) ~~Timezone Phase 2~~ RESOLVED by Postgres migration; (2) ~~`loadCompanyProfile` cache per-tenant~~ FIXED (Mar 12 2026); (3) ~~tenant onboarding from super-admin dashboard~~ DONE (Mar 12 2026, MT Phase 2); (4) ~~tenant-aware scheduled jobs~~ DONE (Mar 12 2026, MT Phase 2); (5) subdomain/slug routing; (6) ~~Railway multi-DB volume~~ RESOLVED by Postgres schema-based multi-tenancy; (7) ~~backup/restore per-tenant~~ DONE (Mar 12 2026, MT Phase 3); (8) ~~per-tenant rate limiting~~ DONE (Mar 12 2026, MT Phase 2); (9) ~~feature flag cache per-tenant~~ DONE (Mar 12 2026, MT Phase 3); (10) ~~tenant isolation testing~~ DONE (Mar 12 2026, MT Phase 3)
- MT Phase 1 blocker fixes (Mar 2026): `_companyCache` Map replaces `_cachedCompany` (keyed by `tenantId`); `_contextFlagCache` Map replaces `_contextEnforced`/`_contextFlagLoaded`/`_contextFlagLastCheck`; boot IIFEs guarded with `if (!IS_MULTI_TENANT)`; `auditLog()` in `admin.js` uses `masterDb.query()` (public schema); `master-db-pg.js` exports `query()`; customer display `displayStore` keyed by `${tenantSlug}-${shiftId}` (was bare `shift_id`); `CustomerDisplayPage.jsx` passes `&tenant=<slug>` in MT mode
- **New pages/routes added in Phase 2** (all wired in `App.jsx`, all have nav entries):
  - `/reorder-alerts` — `ReorderAlertsRedesign.jsx` (Stock Control section)
  - `/parked-sales` — `ParkedSalesRedesign.jsx` (Sales section)
  - `/notifications` — `NotificationsRedesign.jsx` (top-level, gated by `notifications` feature flag)
  - Serial numbers + gift cards backend routes in `barcode-expenses.js`; frontend in `InventoryRedesign.jsx`
  - PO templates: `GET/POST/DELETE /api/purchase-orders/templates` in `purchase-orders.js`
  - Stock by outlet popup: `GET /api/products/:id/stock` UI in `InventoryRedesign.jsx`
  - Action history logging: expanded inserts in `sales.js`, `returns.js`, `inventory.js`
  - Reports governance: `frontend/src/pages/reports/ReportsGovernance.jsx` (schedule manager + saved views)
- **Security** (SEC6 + SEC8 both fixed and tested):
  - SEC6: `x-employee-id` header validated as positive integer in `loadEmployeePerms` (`index.js` line ~248)
  - SEC8: `GET /api/feature-flags` returns 401 if no `x-employee-id` header (`registerAllRoutes.js` line ~187)
- **Loyalty & Wallet at POS**: `POSCheckoutModal.jsx` shows points balance + wallet balance; redeem toggle applies points as discount; `POSContext.jsx` fetches customer wallet/points on customer select; `CustomersRedesign.jsx` has Loyalty & Wallet history tab
- **PO Edit + Approval**: `PUT /api/purchase-orders/:id` edits draft POs; `POST /api/purchase-orders/:id/approve` transitions Draft→Approved (manager/admin only); `PurchaseOrdersRedesign.jsx` shows status badge + approve button
- **Orders detail**: `OrdersRedesign.jsx` detail modal has Transactions tab + Fulfillments tab fed from `GET /api/orders/:id`
- **Quotations email**: `POST /api/quotations/:id/send` in `tier4/crm.js` sends HTML email via nodemailer; Send button in `QuotationsRedesign.jsx`
- **CRM typed activities**: `crm_activities.type` column exists since migrate46; `CRMRedesign.jsx` shows type selector (Call, Email, Meeting, Demo, Follow-up, Note)
- **Transfer reverse + Stock adj delete + Supplier payment void**: all in `inventory.js` / `grn.js`; delete guards for suppliers (`suppliers.js`) and categories (`categories.js`) block deletes when dependent records exist
- **Phase 3 — Core Robustness (Mar 10 2026)**:
  - Rate limiter activated: `index.js` line 191 changed `skip: () => true` → `skip: () => process.env.NODE_ENV === 'test'` — 429 after 20 req/15min in production, skipped in tests
  - Idempotency on `POST /api/sales`: `migrate71.js` adds `idempotency_key TEXT` + unique index to `sales`; frontend generates `crypto.randomUUID()` per sale; backend checks for duplicate before insert, returns `{ duplicate: true }` if found
  - Price change audit log: `products.js` PUT route compares old/new price+cost, inserts into `action_history` with `action_type = "price_change"` and descriptive text
  - End-of-day email digest: `backend/utils/digestEmail.js` builds HTML email (revenue, payment breakdown, top 5 products, exceptions, low stock); `reports/governance.js` sends via nodemailer when `schedule.recipient` is email + `report_key = "eod-digest"`
  - Session timeout at POS: `POSContext.jsx` detects 401 during `completeSale`, stores pending sale in `pendingSaleRef`, shows `POSSessionExpiredModal.jsx` (PIN re-login → auto-retry sale, or park sale → logout)
  - Onboarding checklist: `DashboardOnboarding.jsx` — 5-step checklist (store, product, employees, shift, sale), progress bar, dismiss via localStorage, auto-dismiss after 3s when all complete; shown on dashboard for admin/manager
  - Setup wizard: `migrate72.js` adds `setup_complete` + `setup_token` to `company_profile`; `backend/routes/setup.js` — `GET /api/setup/status` (no auth) + `POST /api/setup/complete` (token-gated, transactional seed of company/outlet/roles/employee/receipt template); `index.js` 503 gate blocks all routes except `/api/setup` + `/api/health` when `setup_complete=0`; boot-time token generation logs setup URL to console; `frontend/src/pages/SetupWizard.jsx` — 4-step wizard (Store Identity → Time & Currency → First Outlet → Admin Account); `App.jsx` HomeRedirect checks setup status
  - Soft deletes: `migrate73.js` adds `deleted_at DATETIME DEFAULT NULL` to products, customers, employees + indexes; `DELETE` endpoints changed to `UPDATE SET deleted_at = datetime('now')`; listings filter `WHERE deleted_at IS NULL`; frontend "Delete" → "Archive" wording; report JOINs untouched (historical data preserved); 3 test files updated for soft-delete semantics
  - Offline sale queuing: **deferred** (3-5 day effort — needs SW rewrite, IndexedDB, Background Sync)
- **Phase 3 — Remaining Items (Mar 10 2026)**:
  - Mobile/tablet POS layout: 3-tab navigation (Cart/Search/Pay) on `<768px`, sticky pay button, touch-friendly qty controls, 2-col search grid; desktop unchanged; `POSRedesign.jsx` `activeTab` state, responsive CSS in 6 POS components
  - IP allowlisting: `ADMIN_ALLOWED_IPS` env var (comma-separated IPs/CIDR), `requireAllowedIp` middleware in `admin.js`, IPv4 CIDR matching via `ipInCidr()`, backward compatible (empty = allow all)
  - Token revocation: `migrate74.js` creates `revoked_tokens` table + `tokens_revoked_before` column on `employees`; `jwt-auth.js` `signAccessToken` adds `jti: crypto.randomUUID()`; `loadTenantAndPerms` checks revoked tokens (MT mode only); `POST /api/employees/:id/revoke-token` + `revoke-all-tokens` endpoints; Revoke button in `EmployeesRedesign.jsx`
  - Shrinkage report: `GET /api/reports/shrinkage` in `reports/inventory.js` — 6 LEFT JOIN subqueries (sales, returns, GRN, adjustments, transfers in/out); `ShrinkageTab` in `ReportsInventory.jsx` with color-coded variance + CSV export; wired in `Reports.jsx` under Inventory tabs
  - Customer-facing display: `backend/routes/customer-display.js` (in-memory Map keyed by shift_id, 8h auto-cleanup); `POST /api/pos/customer-display` (auth required) + `GET` (no auth, 2s poll); `CustomerDisplayPage.jsx` dark-theme standalone page at `/customer-display`; `POSContext.jsx` debounced (500ms) cart state push

## Completed Baseline Before Testing Plan (as of 2026-03-05)

This is the confirmed state that existed before introducing `ONESHOPPOS_TESTING_STRATEGY.md`:

- Backend is already modularized by domain, with centralized route registration in `backend/routes/registerAllRoutes.js`
- Frontend routing and guard chain is active:
  - `RequireAuth` for session protection
  - `RequirePerm` for permission-gated pages
  - `RequireContext` for branch-context enforcement (flag-controlled)
- Backend permission enforcement is active via:
  - `loadEmployeePerms`
  - `requirePerm` / `requireAnyPerm`
  - centralized `PERMISSION_RULES` request middleware
- Context unification is active end-to-end:
  - `/api/context/bootstrap` feeds context selection
  - `AuthProvider` injects `x-company-id`, `x-outlet-id`, `x-scope-mode`
  - backend can enforce outlet context via feature flags
- Critical POS operational guardrails are implemented:
  - checkout blocked without open shift
  - checkout blocked when employee is not clocked in
  - shift opening/closing supports denomination capture
- Existing automated tests already cover major flows:
  - backend integration suites in `backend/tests/integration/*.test.js` (auth, rbac, sales, shifts, attendance, returns, reports, etc.)
  - frontend unit suites in `frontend/tests/unit/*.test.jsx`
  - frontend Playwright suites in `frontend/tests/e2e/*.spec.js` (auth, rbac, pos, kiosk, reports/governance, inventory/report smoke)
- Known bug-regression checks already exist in tests for historical issues (for example stock, wallet, and shift edge cases), providing a base to harden further

## Project Structure

```
oneshoppos/
├── backend/
│   ├── index.js                  # Main Express server (~749 lines)
│   ├── routes/
│   │   ├── registerAllRoutes.js  # Orchestrator only (~324 lines) - reads deps, calls require()
│   │   ├── taxes.js              # /api/taxes
│   │   ├── categories.js         # /api/categories (hierarchical internal categories)
│   │   ├── outlets.js            # /api/outlets
│   │   ├── admin.js              # /api/admin/* (13 endpoints — super-admin auth, tenant CRUD, migrations)
│   │   ├── auth.js               # /api/auth/*
│   │   ├── employees.js          # /api/employees
│   │   ├── roles.js              # /api/roles
│   │   ├── brands.js             # /api/brands
│   │   ├── products.js           # /api/products (~912 lines)
│   │   ├── suppliers.js          # /api/suppliers
│   │   ├── purchase-orders.js    # /api/purchase-orders
│   │   ├── grn.js                # GRN + supplier payables
│   │   ├── promotions.js         # /api/promotions
│   │   ├── customers.js          # /api/customers + customer reports
│   │   ├── sales.js              # /api/sales history
│   │   ├── inventory.js          # /api/transfers + /api/adjustments
│   │   ├── reports/                  # /api/reports/* (modular — 11 files)
│   │   │   ├── index.js              # Entry point — wires sub-modules, shared deps, exports scheduler
│   │   │   ├── dashboard.js          # /api/reports/dashboard
│   │   │   ├── sales.js              # /api/reports/sales-*
│   │   │   ├── inventory.js          # /api/reports/inventory-*
│   │   │   ├── analytics.js          # /api/reports/comparative-trends, /api/reports/heatmaps, etc.
│   │   │   ├── finance.js            # /api/reports/profit-loss, /api/reports/tax-*, etc.
│   │   │   ├── purchasing.js         # /api/reports/total-purchases, /api/reports/procurement-*
│   │   │   ├── staff.js              # /api/reports/labor-performance, /api/reports/loss-prevention
│   │   │   ├── governance.js         # /api/reports/schedules, /api/reports/saved-views
│   │   │   ├── shifts.js             # /api/reports/shifts, /api/reports/cash-drawer
│   │   │   └── helpers.js            # Shared SQL builders and formatters
│   │   ├── returns.js            # /api/returns
│   │   ├── customer-display.js   # /api/pos/customer-display (in-memory cart state for secondary screen)
│   │   ├── attendance.js         # /api/attendance + /api/attendance/pin-* (kiosk) + /api/employees/:id/attendance-config
│   │   ├── attribute-sets.js     # /api/attribute-sets
│   │   ├── receipt-templates.js  # /api/receipt-templates + action history
│   │   ├── setup.js              # /api/setup/* (first-run wizard — status + complete)
│   │   ├── printer.js            # /api/print/* (receipt, status, config)
│   │   ├── email.js              # /api/email/* (config, test, send-receipt)
│   │   ├── supplier-returns.js   # /api/supplier-returns
│   │   ├── parked-sales.js       # /api/parked-sales
│   │   ├── orders.js             # /api/orders
│   │   ├── shopify/              # /api/integrations/shopify* (modular — 8 files)
│   │   │   ├── index.js          # Entry point — wires sub-modules, shared deps
│   │   │   ├── config.js         # GET/PUT /config, POST /disconnect
│   │   │   ├── health.js         # /status, /verify, /live-validation, /webhooks/setup, /uat-checklist
│   │   │   ├── sync.js           # /events, /retry-event, /process-pending, /retry-failed, /push-inventory
│   │   │   ├── orders.js         # POST /sync/pull-orders
│   │   │   ├── webhooks.js       # POST /webhooks/orders-create (HMAC + idempotency + replay window)
│   │   │   ├── import.js         # POST/DELETE /import/products, POST /import/inventory
│   │   │   └── mappings.js       # /mappings/products (CRUD + auto + live + apply), /locations, /customers
│   │   ├── reconciliation.js     # /api/reconciliation + /api/approvals (~1101 lines)
│   │   ├── barcode-expenses.js   # Barcodes, expenses, backup/restore, e-invoicing
│   │   └── tier4/                # Tier 4 modularized
│   │       ├── index.js          # Router entry
│   │       ├── notifications.js
│   │       ├── hr.js
│   │       ├── crm.js
│   │       ├── accounting.js
│   │       ├── company-profile.js
│   │       └── approvals.js
│   ├── shopify/
│   │   ├── client.js             # Shopify GraphQL API client (~525 lines)
│   │   ├── utils.js              # Retry logic, webhook HMAC verification
│   │   └── order-service.js      # upsertWebOrderFromShopifyPayload + stock policy helpers (factory)
│   ├── schema-full.js            # Extracts live sanopos.db schema via sqlite_master (for new tenant DBs)
│   ├── master-db.js              # Lazy-init master.db — tenant registry (getMasterDb, closeMasterDb, initMasterDb)
│   ├── tenant-db-manager.js      # In-memory connection pool for tenant SQLite DBs (getDb, closeDb, closeAll, healthCheck)
│   ├── tenant-provisioner.js     # CLI: provisions new tenant (directory, schema, seed data, master.db registration)
│   ├── tenant-migrate.js        # CLI + programmatic multi-tenant migration runner (reads backend/migrations/)
│   ├── seed-admin.js            # CLI: seeds first super-admin in master.db
│   ├── tenant-db-proxy.js        # AsyncLocalStorage + Proxy — routes all DB calls to per-request tenant DB
│   ├── tenant-multer.js          # Tenant-aware multer storage factories (product images, logos, restore)
│   ├── jwt-auth.js               # JWT utilities — signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken
│   ├── middleware/
│   │   └── plan-limits.js        # Enforces tenant plan caps (max_employees, max_products, max_outlets)
│   ├── category-tree.js          # Category tree enrichment, descendants, leaf validation
│   ├── services/
│   │   └── printer.js            # PrinterService — ESC/POS USB+TCP, paper-width-aware formatting, cash drawer
│   ├── utils/
│   │   ├── tz.js                 # Timezone utils — toUtcStart/toUtcEnd for SaaS date filters
│   │   ├── receiptEmail.js       # Server-side HTML receipt builder for email (inline CSS, no scripts)
│   │   └── digestEmail.js        # End-of-day HTML digest email builder (revenue, top products, exceptions)
│   ├── migrate71.js              # Idempotency key on sales table
│   ├── migrate72.js              # Setup wizard (setup_complete + setup_token on company_profile)
│   ├── migrate73.js              # Soft deletes (deleted_at on products, customers, employees)
│   └── migrate74.js              # Token revocation (revoked_tokens table + tokens_revoked_before on employees) — READ THIS for schema questions
└── frontend/
    └── src/
        ├── components/           # Reusable UI components (all small, < 200 lines)
        ├── ui/
        │   └── primitives.jsx    # Shared design-system components (PageShell, Button, Input, etc.)
        └── pages/                # Full page views
            ├── Reports.jsx               # (~540 lines) — Clean orchestrator for domain modules
            ├── reports/                  # Domain-specific reporting modules
            │   ├── ReportShared.jsx      # Shared UI primitives and export utilities
            │   ├── ReportsSales.jsx
            │   ├── ReportsInventory.jsx
            │   ├── ReportsCatalog.jsx
            │   ├── ReportsOperations.jsx
            │   ├── ReportsAnalytics.jsx
            │   ├── [Other Reports*.jsx files]
            ├── ShopifyIntegration.jsx    # (~2108 lines) — wrapped by ShopifyIntegrationRedesign.jsx
            ├── Accounting.jsx            # wrapped by AccountingRedesign.jsx
            ├── Attendance.jsx            # wrapped by AttendanceRedesign.jsx
            ├── Approvals.jsx             # wrapped by ApprovalsRedesign.jsx
            ├── BarcodeTemplates.jsx      # wrapped by BarcodeTemplatesRedesign.jsx
            ├── ReceiptTemplates.jsx      # wrapped by ReceiptTemplatesRedesign.jsx
            ├── [*Route.jsx]              # Route files — each renders its redesign/ counterpart
            ├── admin/                    # Super-admin dashboard (separate auth, separate layout)
            │   ├── AdminLogin.jsx        # Login + shared adminFetch/getAdminSession/getAdminToken exports
            │   ├── AdminLayout.jsx       # Sidebar layout with auth guard + <Outlet />
            │   ├── AdminDashboard.jsx    # Stats cards, plan distribution, recent activity
            │   ├── AdminTenantList.jsx   # Searchable table + provision modal
            │   └── AdminTenantDetail.jsx # Details, edit, actions, usage stats, audit log
            ├── dashboard/
            │   ├── DashboardOnboarding.jsx  # 5-step onboarding checklist (auto-detects from API data)
            │   └── [11 other dashboard components]
            ├── SetupWizard.jsx              # 4-step first-run wizard (unauthenticated, token-gated)
            ├── CustomerDisplayPage.jsx      # Customer-facing display (dark theme, polls cart state, no auth)
            └── redesign/                 # Active UI — ALL pages now rendered here
                ├── POSRedesign.jsx
                ├── KioskRedesign.jsx         # PIN clock-in terminal (standalone, no sidebar)
                ├── CategoriesRedesign.jsx    # Tree-based category manager
                ├── InventoryRedesign.jsx
                ├── ReportsRedesign.jsx
                ├── AttendanceRedesign.jsx
                ├── ApprovalsRedesign.jsx
                ├── BarcodeTemplatesRedesign.jsx
                ├── ReceiptTemplatesRedesign.jsx
                └── [all other *Redesign.jsx files]
        └── utils/
            ├── categoryTree.js    # Frontend helpers for flattening/rendering category trees
            ├── dates.js           # UTC timestamp display helpers — fmtDate, fmtTime, fmtDateTime
            └── receipt.js         # Single source of truth for receipt rendering — buildReceiptSections, buildReceiptHtml
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- Shopify integration routes are **modular**: `backend/routes/shopify/` (8 files).
- Reports routes are **modular**: `backend/routes/reports/` (11 files).
- Tier 4 routes are **modular**: `backend/routes/tier4/` (7 files).
- `registerAllRoutes.js` is now just an orchestrator (~340 lines) — no routes defined there. Each domain is loaded via its modular directory. In MT mode, also wires `resolveTenant` + tenant-scoped `/uploads` serving.
- **Super-admin routes**: `backend/routes/admin.js` is mounted in `index.js` BEFORE `registerAllRoutes` — this ensures admin endpoints bypass `loadTenantAndPerms`/`resolveTenant` middleware. Admin JWT uses `jwt.sign()` directly (not `signAccessToken`) because the shared utility strips custom claims like `role`/`aid`/`email`.
- **Multi-tenant DB routing**: When `MULTI_TENANT=1`, `deps.db` is a Proxy (`tenant-db-proxy.js`) that delegates all calls to the tenant DB resolved from AsyncLocalStorage. Route closures that captured `db` at boot time transparently hit the correct tenant DB. Middleware order: `loadTenantAndPerms` (JWT verify) → `resolveTenant` (ALS context + `req.tenantDir`) → tenant-scoped `/uploads` → `loadCompanyProfile` → `resolveContext`.
- Database schema: read only `backend/migrate74.js` (latest), never older migrations
- Internal product categories are hierarchical; products and category promotions may target leaf categories only
- Parent category filters expand to descendant leaves in products and reports
- SQLite DB file: `backend/sanopos.db`
- Frontend: port 5173 (Vite dev), Backend: port 5000

## When Working on Backend

- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate74.js` (latest)
- Products API: `GET /api/products/:id` exists (added Mar 2026) — returns `{ product: { ...fields, total_stock } }`; route is registered BEFORE `/:id/variants` in `products.js` — preserve this order when adding new routes
- Email receipt HTML builder (server-side) → `backend/utils/receiptEmail.js`
- Category tree logic → `backend/category-tree.js`
- Server middleware/config → `backend/index.js`
- Super-admin API → `backend/routes/admin.js` (13 endpoints, uses master.db directly)
- Tenant migration runner → `backend/tenant-migrate.js` (CLI + programmatic)
- Super-admin seeder → `backend/seed-admin.js`
- Multi-tenant DB proxy → `backend/tenant-db-proxy.js` (AsyncLocalStorage + Proxy)
- Tenant-aware uploads → `backend/tenant-multer.js` (storage factories)
- Plan limit enforcement → `backend/middleware/plan-limits.js`
- Timezone utilities → `backend/utils/tz.js` (`toUtcStart`, `toUtcEnd`, `toLocalDateStr`, `isValidTz`)
- Shopify API calls → `backend/shopify/client.js`, webhook/retry logic → `backend/shopify/utils.js`
- Shopify routes → `backend/routes/shopify/`
- Reports routes → `backend/routes/reports/`
- Tier 4 routes → `backend/routes/tier4/`
- Shopify order upsert service → `backend/shopify/order-service.js`

## When Working on Frontend

- **Active pages** are in `frontend/src/pages/redesign/` — always edit the `*Redesign.jsx` file
- Reports logic lives in `frontend/src/pages/reports/`
- Shopify logic lives in `frontend/src/pages/shopify/`
- `*Route.jsx` files in `pages/` just render the redesign counterpart — no logic there
- Legacy originals in `pages/` (`ShopifyIntegration.jsx`, `Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`) — do NOT delete; they are imported by their Redesign counterparts
- `Reports.jsx` is no longer a legacy monolith; it is now a clean orchestrator for modules in `pages/reports/`
- All redesign wrappers use `PageShell` from `frontend/src/ui/primitives.jsx` and render the original as a child
- Nav is driven by `frontend/src/ui/nav-config.js` — add entries here to make pages visible in the sidebar
- Shared design-system primitives: `frontend/src/ui/primitives.jsx`
  - `PageShell` props: `title`, `subtitle`, `right` (action buttons) — no `actions` prop
  - `SectionCard` props: `children`, `className` only — no `title` prop; use a `<p>` heading inside children
- Shared components: `frontend/src/components/`
- Category tree UI helpers: `frontend/src/utils/categoryTree.js`
- UTC timestamp display helpers: `frontend/src/utils/dates.js` — use `fmtDate`/`fmtTime`/`fmtDateTime` (never `new Date(x.timestamp)` directly)
- Tailwind v4 class renames (linter enforced — old names work but get flagged):
  - `(--css-var)` NOT `[var(--css-var)]`
  - `shrink-0` NOT `flex-shrink-0`, `grow` NOT `flex-grow`
  - `bg-linear-to-br` NOT `bg-gradient-to-br`
  - `text-ellipsis` NOT `overflow-ellipsis`
  - `z-200` NOT `z-[200]` (arbitrary z-index values are now first-class)
- **Super-admin pages**: `frontend/src/pages/admin/` — completely separate from POS auth and layout. Use `adminFetch` from `AdminLogin.jsx` for API calls. Admin session stored in `localStorage["adminSession"]` (not POS `"authSession"`). Routes at `/admin/*` in `App.jsx` bypass `RequireAuth`/`RequireContext`.

## Running Tests

- Use `npx jest <path>` for integration tests in `backend/tests/integration/` — these use Jest
- `npm test` in `backend/` runs vitest — only works for files using vitest import syntax
- 10+ test files use vitest `import` syntax (attendance, customers, promotions, etc.) — these FAIL under Jest; pre-existing and expected
- Confirmed passing baseline: 283 Jest integration tests, 2 pre-existing failures (concurrency.test.js vitest format)
- `smoke-gate.test.js` has **22/25 pre-existing failures on main** — do NOT investigate unless you changed auth/session code
- `pg-batch*.test.js` require a live Postgres `DATABASE_URL` — always fail locally without it; run only in CI/Railway

## Currency System (live — Mar 12 2026)

- `frontend/src/contexts/CurrencyContext.jsx` — `useCurrency()` returns `{ symbol, code, denominations, fmt, refresh }`
- `GET /api/company-profile/currency` — public endpoint (no auth), fetched by `CurrencyProvider` on mount
- `cash_denominations` column on `company_profile` — JSON array string; added in schema migration v2
- **NEVER hardcode `PKR`/`PKRs`/`Rs` in display code** — use `const { fmt } = useCurrency()` in React components
- Non-component utilities (e.g. `frontend/src/utils/receipt.js`) accept `currencySymbol` as a parameter from the calling component
- `CurrencyProvider` wraps OUTSIDE `AuthProvider` in `main.jsx` — so unauthenticated pages (SetupWizard, CustomerDisplay) can format currency
- After saving company profile, call `refresh()` from `useCurrency()` to propagate currency changes across the app immediately
- POS context exports `currencyDenominations` and `currencySymbol` from `useCurrency()` — use these in POS shift modals instead of hardcoded arrays

## Common Gotchas

### Global fetch interceptor (AuthProvider)
- `AuthProvider.jsx` patches `window.fetch` to inject `x-outlet-id` + `x-scope-mode` headers
- In MT mode (`IS_MULTI_TENANT`), also injects `Authorization: Bearer <token>` and `credentials: "include"` (for httpOnly refresh cookie)
- Headers are ONLY injected when the URL contains `/api/` — missing the prefix = no context headers = "Context required" error
- Always use `${API}/api/<route>` not `${API}/<route>` in frontend fetch calls
- **Silent refresh**: On 401 with `TOKEN_EXPIRED` code, interceptor calls `POST /api/auth/refresh` via `window._nativeFetch` (bypasses interceptor), stores new access token, retries original request. Uses module-level `_refreshPromise` lock to prevent concurrent refreshes.
- **Do NOT add `token` to the `useEffect` deps array** — the interceptor reads it live via `readToken()`. Adding it causes re-wrapping on every refresh.

### Sales table schema
- The sale timestamp column is named `timestamp`, NOT `created_at` — using `created_at` silently returns undefined

### Timezone architecture (SaaS-ready)
- All business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) are stored as **UTC** via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store **local time** (server OS) — this is intentional and self-consistent; do NOT change their write paths
- `backend/utils/tz.js` provides `toUtcStart(dateStr, tz)` and `toUtcEnd(dateStr, tz)` — converts a local `YYYY-MM-DD` string in any IANA timezone to UTC boundary strings for direct `timestamp >= ?` / `timestamp < ?` SQL comparisons
- `req.company.timezone` (IANA string, e.g. `'America/New_York'`) is set by the `loadCompanyProfile` middleware — use it in all date filter queries; **never use `date(col,'localtime')` for new queries on UTC-stored columns**
- **CRITICAL — attendance date queries**: `attendance_sessions.session_start` and `employee_attendance.check_in` default to `datetime('now','localtime')` — already local. Always write `date(session_start)` and `date(check_in)` with NO modifier. Writing `date(session_start,'localtime')` applies UTC→local conversion a second time, shifting dates forward by your UTC offset and breaking clock-in for anyone in UTC+ timezones

### Displaying timestamps in the frontend (CRITICAL — recurring bug)
The DB has two timestamp storage systems. You MUST use the matching formatter or display will be off by 5 hours.

**UTC columns** (`sales.timestamp`, `returns.timestamp`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`, `action_history`, etc.):
- **NEVER** use `new Date(x.timestamp)` directly — SQLite UTC strings have no `Z` suffix so Chrome parses them as local time, showing the wrong hour
- **ALWAYS** use `fmtUtcDateTime` / `fmtUtcDate` / `fmtUtcTime` from `frontend/src/utils/dates.js` (aliases: `fmtDateTime`, `fmtDate`, `fmtTime`)

**LOCAL columns** (`attendance_sessions.session_start`, `employee_attendance.check_in`, `expenses`, `GRN`, `parked_sales`, etc.):
- **NEVER** use `new Date(dt)` directly — Chrome also parses space-separated SQLite local strings as UTC, shifting display back by 5 hours (confirmed production bug Mar 2026)
- **ALWAYS** use `fmtLocalDateTime` / `fmtLocalDate` / `fmtLocalTime` / `parseLocalDate` from `frontend/src/utils/dates.js`
- The old note saying "`new Date(dt)` is correct for attendance" was WRONG and has been removed — it caused the production bug

**Exception:** `new Date(d + "T00:00:00")` is correct ONLY for plain date-only strings (`YYYY-MM-DD` with no time) used purely as labels — e.g. `HRManagementRedesign.jsx` leave dates, `DashboardTrends.jsx` chart axis labels.

### POS architecture (`redesign/pos/`)
- All POS state lives in `POSContext.jsx` — 128+ exported values. Add new state/functions here, mount new modals in `POSRedesign.jsx`
- New POS components must call all hooks (`useMemo`, `useCallback`, etc.) BEFORE any conditional early return
- `POST /api/sales` requires: active shift + clocked-in employee — exchange sales from return flow will fail if shift is closed
- `POST /api/sales` stock deduction: uses `item.variant_id` for variant stock (`product_variants` table), `item.id` for `outlet_stock` — always pass `variant_id` when known
- POS Recent Sales + Return/Exchange flow: `POSRecentSalesPanel.jsx` + `POSReturnExchangeModal.jsx` (both new, Mar 2026)
- POS Session Expired modal: `POSSessionExpiredModal.jsx` — shown on 401 during checkout; PIN re-login auto-retries pending sale; "Park sale & go to login" option
- Receipt rendering: **all receipt logic lives in `frontend/src/utils/receipt.js`** — `buildReceiptSections(slip, template)` returns data, `buildReceiptHtml(slip, template)` opens the browser popup, `printToHardware(slip, template)` sends to hardware via `/api/print/receipt`; `POSContext.printSlip` tries hardware first (fallback to browser popup if `result.fallback`); `POSReceiptModal` calls `buildReceiptSections` for `storeName`/`footerText`/`showBarcode`; never duplicate receipt logic elsewhere

### reports_accuracy.test.js uses vitest syntax
- This file uses `import { describe, it, expect } from "vitest"` — it **always fails under `npx jest`** with `SyntaxError: Cannot use import statement outside a module`; this is pre-existing and expected
- To run its tests, use `npm test` from `backend/` (vitest runner), not `npx jest`

### Migration db.close pattern
- Always use `db.close((err) => { ... })` with a callback — without callback, close errors are silently swallowed and no completion log appears; see `migrate63.js` for the correct pattern

### SQLite prepared statement finalize
- Always use `stmt.finalize((err) => { ... })` with a callback — without callback, post-insert rollback logic is unreachable because `hasError` is checked synchronously before async run callbacks fire

### sales.js / returns.js shift_id scope
- `POST /api/sales`: `activeShift` is fetched inside a `try {}` block — declare `let activeShift` BEFORE the try so it's in scope for the `db.serialize()` callback that follows
- `POST /api/returns`: shift lookup uses `db.get()` BEFORE `db.serialize()` — never call `db.get()` inside an active transaction

### Purchase order credit limit
- `POST /api/purchase-orders` warns (but allows) when a credit supplier's running balance + new PO total exceeds `credit_limit` — response includes `{ warning: "..." }` field
- `running_balance` counts only invoiced/received POs (via `supplier_invoices`), not draft POs — acceptable for advisory model

## Production Deployment (Railway + Vercel)

### Live URLs
- Frontend: `https://oneshoppos.vercel.app` (Vercel, root dir: `frontend`)
- Backend: `https://oneshoppos-production.up.railway.app` (Railway, root dir: `/backend`)

### Railway gotchas
- Volume must be created manually in Railway UI (project canvas → Add → Volume, mount `/data`) — `railway.toml` `[[volumes]]` alone does NOT provision it
- All 66 migration files hardcode `path.resolve(__dirname, "oneshop.db")` — `start.sh` symlinks `/app/oneshop.db` and `/app/sanopos.db` → `$DATA_DIR/sanopos.db` before migrations run
- Railway's `PORT` env var overrides the app's PORT — server will bind to 8080 even if `PORT=5000` is set; this is fine
- Employee API (`PUT /api/employees/:id`, `DELETE`) requires Administrator session token — cannot be called unauthenticated even from curl
- To bootstrap a first Administrator when locked out: add a temp `POST /api/setup/owner` endpoint gated by `SETUP_SECRET` env var, deploy, call it, then remove the endpoint

## Refactor History

Full changelog: see `REFACTOR_NOTES.md`. Key milestones:

- Feb 2026: Backend modularized — 26 route files extracted from registerAllRoutes.js
- Mar 2026: All frontend pages migrated to `redesign/` wrappers
- Mar 2026: Hierarchical categories shipped (tree CRUD, leaf-only assignment)
- Mar 2026: Shopify V2 — backend modularized (8 files), data model hardened (migrate60)
- Mar 2026: Reports V2 — 11 backend + 10 frontend modules, 67 tabs, 74 endpoints
- Mar 2026: POS opening/closing workflow hardened (branch + shift + attendance gating)
- Mar 2026: Context Unification shipped — mandatory post-login branch context, role-scope enforcement, header propagation (migrate61, 3 flags live)
- Mar 2026: POS Recent Sales + Return/Exchange flow shipped — reprint bills, full refund, exchange with balance settlement
- Mar 2026: SaaS timezone fix — all date filters converted from `date(col,'localtime')` (server OS timezone) to UTC range expansion via `backend/utils/tz.js`; `loadCompanyProfile` middleware added; `company_profile.timezone` (IANA string) now drives all date boundaries
- Mar 2026: Shift linkage — `shift_id` added to `sales` and `returns` (migrate63); written at creation time; historical rows backfilled; replaces fragile time-window matching for shift reports
- Mar 2026: PO credit limit enforcement — `POST /api/purchase-orders` warns when credit supplier exceeds limit; shift reports rewritten to use `shift_id` FK directly
- Mar 2026: Receipt system unified — `frontend/src/utils/receipt.js` created as single source of truth; POSContext fetches active template; Receipt Templates `header_text`/`footer_text`/`show_barcode` now live in print popup and modal
- Mar 2026: ESC/POS printer integration — `backend/services/printer.js` + `backend/routes/printer.js` + `printer_config` table (migrate64); `printToHardware()` in receipt.js; hardware-first print with browser fallback; Printer Settings at `/printer-settings`
- Mar 2026: Barcode scanner — `POSContext.jsx` global keydown listener with 100ms debounce; calls existing products barcode endpoint; adds matched product to cart
- Mar 2026: Email receipts — on-demand HTML email via SMTP (nodemailer); `email_config` table (migrate65); `backend/routes/email.js` (config CRUD + test + send-receipt); `backend/utils/receiptEmail.js` (server-side HTML builder); `POSEmailReceiptModal.jsx`; Email button in Recent Sales panel + Receipt Modal; Email Settings section in Printer Settings page
- Mar 2026: SaaS Phase 1 — master.db tenant registry (4 tables), lazy-init connection pool, CLI provisioner with transactional registration, schema-full extractor; 14 integration tests; SCHEMA_VERSION=65; zero existing files modified
- Mar 2026: SaaS Phase 2 — JWT auth overhaul; bcrypt PIN hashing (migrate66); `jwt-auth.js` utility module; multi-tenant routes (`mt-login`, `refresh`, `kiosk-login`, `update-context`) gated behind `MULTI_TENANT=1`; `loadTenantAndPerms` middleware toggles with env flag; `cookie-parser` for httpOnly refresh cookies; `.env.example` added; 13 new tests; 296/298 passing
- Mar 2026: SaaS Phase 3+4 — Multi-tenant DB proxy (`tenant-db-proxy.js`, AsyncLocalStorage + Proxy pattern); `resolveTenant` middleware wraps requests in ALS; `tenant-multer.js` tenant-aware upload factories; `plan-limits.js` enforces plan caps; tenant-scoped `/uploads` serving; upload destinations in `orders.js`, `barcode-expenses.js`, `company-profile.js` made tenant-aware; frontend JWT integration — `AuthProvider.jsx` silent refresh + Bearer auth; `Login.jsx` Store Code field (VITE_MULTI_TENANT); `ContextSelect.jsx` JWT re-sign on outlet select; `.env.development` + `.env.production`; 296/298 passing (zero regressions)
- Mar 2026: SaaS Phase 5 — Super-Admin Dashboard; `routes/admin.js` (13 endpoints: login, tenant CRUD, suspend/activate/delete, migration runner, stats, PIN reset); `tenant-migrate.js` (CLI + programmatic migration runner, reads `backend/migrations/`); `seed-admin.js` (super-admin seeder); admin JWT uses `jwt.sign()` directly with `role: "super_admin"` claim; routes mounted before tenant middleware; frontend: 5 admin pages at `/admin/*` (Login, Layout, Dashboard, TenantList, TenantDetail); `adminFetch` shared helper; separate auth session in localStorage; provisioner now detects `pin_hash` column via PRAGMA; SCHEMA_VERSION=66; 296/298 passing
- Mar 2026: Phase 6 deployment — Railway backend + Vercel frontend live; `start.sh` symlinks legacy DB names (`oneshop.db`, `sanopos.db`) to `$DATA_DIR/sanopos.db` (volume); Railway volume must be provisioned manually in UI; `DATA_DIR=/data`, `MULTI_TENANT=0` for single-tenant mode; frontend env at `frontend/.env.production`
- Mar 2026: Products table improvements — `migrate68.js` removes `UNIQUE` constraint on `products.barcode` (table recreate, duplicate barcodes now allowed); `POST /api/products` validates `price > 0` (400 if missing/zero); bulk-import route adds `sku` field + plain INSERT (removed `ON CONFLICT` upsert which required the now-dropped UNIQUE); `InventoryRedesign.jsx` replaces Min Qty column with SKU + Cost columns; bulk import UI added (CSV Template download + Import CSV button + results modal)
- Mar 2026: Phase 3 Core Robustness — `migrate71.js` (idempotency_key on sales), `migrate72.js` (setup wizard — setup_complete + setup_token on company_profile), `migrate73.js` (soft deletes — deleted_at on products/customers/employees); rate limiter activated (`skip: () => process.env.NODE_ENV === 'test'`); price change audit log in `products.js` PUT; end-of-day email digest in `reports/governance.js` + `utils/digestEmail.js`; POS session timeout handling (`POSSessionExpiredModal.jsx`); dashboard onboarding checklist (`DashboardOnboarding.jsx`); first-run setup wizard (`routes/setup.js` + `SetupWizard.jsx`); soft deletes on products/customers/employees (DELETE → UPDATE SET deleted_at, frontend "Archive" wording); 3 test files updated; 395/395 tests passing
- Mar 2026: Phase 3 Remaining — mobile/tablet POS layout (3-tab nav: Cart/Search/Pay, sticky pay button, touch-friendly controls, 2-col mobile grid); IP allowlisting for `/api/admin` (`ADMIN_ALLOWED_IPS` env var, CIDR matching, `requireAllowedIp` middleware in `admin.js`); JWT token revocation (`migrate74.js` — `revoked_tokens` table + `tokens_revoked_before` on employees, `jti` claim in `signAccessToken`, revocation check in `loadTenantAndPerms`, `POST /api/employees/:id/revoke-token` + `revoke-all-tokens` endpoints, Revoke button in `EmployeesRedesign.jsx`); stock shrinkage report (`GET /api/reports/shrinkage` with 6-join SQL in `reports/inventory.js`, `ShrinkageTab` in `ReportsInventory.jsx`); customer-facing display (`backend/routes/customer-display.js` in-memory Map, `CustomerDisplayPage.jsx` dark-theme poll page at `/customer-display`, `POSContext.jsx` debounced cart push)
- Mar 2026: **Postgres migration complete (backend)** — `feature/postgres-migration` branch; Batches 1-9 convert entire backend from SQLite callbacks to Postgres async/await; `schema-pg.sql` (full DDL), `db-pg.js` (pg.Pool wrapper), `tenant-provisioner-pg.js` (schema-based provisioning); 340/340 pg integration tests across 8 test files; Batch 7 converted order-service.js; Batch 8 converted index.js middleware/startup/workers + switched boot to `db-pg`; Batch 9 removed dual-mode SQLite/Postgres detection from shopify/utils.js, category-tree.js, and callers
- Mar 2026: **MT Phase 1 blocker fixes** — `feature/mt-phase1-blockers` branch (4 commits, 4 files); per-tenant `_companyCache` Map + `_contextFlagCache` Map replace module-level globals; boot IIFEs guarded with `!IS_MULTI_TENANT`; `auditLog()` uses `masterDb.query()`; `master-db-pg.js` exports `query()`; customer display `displayStore` keyed by `${tenantSlug}-${shiftId}` (was bare `shift_id`); `CustomerDisplayPage.jsx` passes `&tenant=<slug>` in MT mode
- Mar 2026: **MT Phase 2 operations** — `feature/mt-phase2-operations` branch (9 commits, ~10 files); `tenant-provisioner-pg.js` generates setup token during provisioning; `admin.js` gains 3 new endpoints (POST returns setup_url, GET setup-token, POST regenerate-setup-token); `AdminTenantList.jsx` shows setup URL modal after provisioning; `AdminTenantDetail.jsx` shows setup status card with copy/regenerate; `setup.js` gains `getSetupDb()` helper for MT mode (resolves tenant DB from `?tenant=` param); `SetupWizard.jsx` passes tenant slug to API calls; `index.js` notification helpers use `_notifDb` (proxy in MT, direct in ST); 3 scheduled workers wrapped with `forEachActiveTenant` + `asyncStore.run()`; rate limiters keyed by `tenantSlug:IP` via `extractTenantKey`; `createTestApp-pg.js` uses `ON CONFLICT` for company_profile seed (fixes pre-existing pg-batch3 failures); 55/55 pg-batch3 tests passing
- Mar 2026: **MT Phase 3 hardening** — `feature/mt-phase3-hardening` branch. Per-tenant feature flag cache (`getFeatureFlagsMap` + 60s TTL Map, invalidated on PUT); pg_dump/pg_restore backup/restore (`backend/utils/backup-pg.js`, replaces stubs in `barcode-expenses.js`, runtime `isPgDumpAvailable()` check); tenant isolation integration tests (7 tests in `pg-tenant-isolation.test.js` — API isolation, direct DB isolation, concurrent request safety).

## Postgres Migration

### Overview
The backend is being migrated from SQLite3 to PostgreSQL on branch `feature/postgres-migration`. Each route file is converted from callback-based `db.run/get/all` to async/await `db.query()` with `$1, $2` params.

### Key Files
- `backend/db-pg.js` — shared `pg.Pool` connection pool (`DATABASE_URL` env var), exports `query()`, `transaction()`, `getPool()`
- `backend/schema-pg.sql` — full DDL for all tables, indexes, constraints
- `backend/tenant-provisioner-pg.js` — schema-based multi-tenant provisioning (`CREATE SCHEMA tenant_<slug>`)
- `backend/tests/helpers/createTestApp-pg.js` — test app factory (isolated schema per test, full seed data)
- `backend/tests/helpers/seedSchema-pg.js` — runs schema-pg.sql into a test schema

### Conversion Status (340/340 tests passing — backend fully converted)
- **Batch 1** (35 tests, `pg-batch1-crud.test.js`): taxes, suppliers, receipt-templates, parked-sales, shifts, roles, brands
- **Batch 2** (53 tests, `pg-batch2-medium.test.js`): customers, employees, categories, promotions, attribute-sets, returns, inventory
- **Batch 3** (48 tests, `pg-batch3-complex.test.js`): auth, setup, grn, purchase-orders, attendance, sales, products, orders, barcode-expenses, admin
- **Batch 4** (60 tests, `pg-batch4-reports.test.js`): all 11 reports/ files (helpers, index, dashboard, sales, inventory, analytics, finance, purchasing, staff, governance, shifts) + `category-tree.js`
- **Batch 5** (58 tests, `pg-batch5-tier4.test.js`): all 7 tier4/ files (notifications, company-profile, approvals, hr, crm, accounting, index)
- **Batch 6** (43 tests, `pg-batch6-shopify.test.js`): all 8 shopify/ route files (config, health, sync, orders, webhooks, import, mappings, reconciliation) + `shopify_product_metadata` DDL
- **Batch 7** (25 tests, `pg-batch7-order-service.test.js`): `shopify/order-service.js` fully async — upsert, stock policy, item mapping, outlet resolution
- **Batch 8** (18 tests, `pg-batch8-middleware.test.js`): `index.js` middleware (loadEmployeePerms, loadTenantAndPerms, loadCompanyProfile, resolveContext, ensureDefaultRolePermissions), startup hooks, background workers, boot switch to `db-pg`
- **Batch 9** (0 new tests): Removed dual-mode SQLite/Postgres detection from `shopify/utils.js`, `category-tree.js`, and callers (`products.js`, `categories.js`, `promotions.js`, `orders.js`)

### SQLite → Postgres Conversion Patterns
| SQLite | Postgres |
|--------|----------|
| `db.run/get/all` callbacks | `await db.query(sql, params)` → `{ rows, rowCount }` |
| `?` placeholders | `$1, $2, $3` numbered params |
| `this.lastID` | `RETURNING id` clause |
| `this.changes` | `rowCount` from query result |
| `db.serialize()` + `BEGIN/COMMIT` | `await db.transaction(async (client) => { ... })` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |
| `LIKE` | `ILIKE` (case-insensitive) |
| `datetime('now')` / `datetime('now','localtime')` | `NOW()` |
| `date(col)` | `col::date` |
| `json_group_array(json_object(...))` | `json_agg(json_build_object(...))` |
| `GROUP_CONCAT(...)` | `string_agg(..., ',')` |
| `printf('%04d', id)` | `LPAD(id::text, 4, '0')` |
| `COLLATE NOCASE` | `LOWER()` or `ILIKE` |
| `= 1` / `= 0` (booleans) | `= true` / `= false` |
| `db.prepare()/stmt.run()/stmt.finalize()` | `for` loop with `await client.query()` |
| `strftime('%Y-%m', col)` | `TO_CHAR(col, 'YYYY-MM')` |
| `strftime('%H', col)` | `EXTRACT(HOUR FROM col)::int` |
| `strftime('%w', col)` | `EXTRACT(DOW FROM col)::int` |
| `julianday('now') - julianday(col)` | `EXTRACT(EPOCH FROM (NOW() - col)) / 86400.0` |
| `ROUND(SUM(...), 2)` | `ROUND(SUM(...)::numeric, 2)` (ROUND requires numeric) |
| `(? \|\| ' minutes')::interval` | `make_interval(mins => $N)` (avoids type ambiguity) |

### Postgres-Specific Gotchas
- **Boolean columns are strict**: `is_active`, `is_primary`, `is_default`, `voided`, `show_barcode`, `show_logo` — MUST use `= true`/`= false`, never `= 1`/`= 0`
- **NUMERIC returns strings**: Postgres NUMERIC/DECIMAL columns return JS strings — always wrap with `Number()` before arithmetic (e.g. gift card `remaining_value`)
- **GROUP BY**: All non-aggregated SELECT columns MUST appear in GROUP BY (Postgres enforces this, SQLite doesn't)
- **Reserved words**: `read` → `is_read` (in notifications table)
- **Timezone**: `TIMESTAMPTZ` stores UTC internally. `session_start::date` extracts the UTC date. JS must use `toISOString().slice(0,10)` (UTC date) not `toLocaleDateString()` (local date) for comparisons
- **HAVING clause**: Postgres does not allow column aliases in HAVING — must repeat the full expression
- **ROUND()**: Postgres `ROUND()` requires `numeric` type — cast with `::numeric` (e.g. `ROUND(SUM(amount)::numeric, 2)`)
- **FK constraints on bulk delete**: SQLite used `PRAGMA foreign_keys = OFF` to bypass FK checks during bulk deletes; Postgres enforces FKs always — must explicitly delete from referencing tables (e.g. `inventory_reconciliation`, `shopify_product_metadata`) before deleting from `products`
- **category-tree.js**: Postgres-only — uses `dbAllAsync`/`dbGetAsync` wrappers around `db.query()` with `.rows` extraction
- **shopify/utils.js**: Postgres-only — `getActiveShopifyConnection` is a simple async function returning `rows[0] || null`
- **order-service.js**: Fully async/await. Factory: `createOrderService(db, getActiveShopifyConnection)` → `{ upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy }`. `stock_applied` uses `true`/`false` (BOOLEAN). Callers use direct `await` (no `new Promise()` wrappers)
- **index.js**: Boot import is `require("./db-pg")`. All middleware (`loadEmployeePerms`, `loadTenantAndPerms`, `resolveTenant`, `loadCompanyProfile`, `resolveContext`) are async. Startup hooks and background workers use async with `.catch()`. `sqlite3` import removed. `runAutoBackup` guarded with `if (!process.env.DATABASE_URL)`
- **registerAllRoutes.js**: All 4 SQLite calls converted to `await db.query()`. `sqlite_master` → `information_schema.tables` in health endpoint. Feature flags use `true`/`false` booleans. Outlet middleware is `async`.
- **email.js**: Fully async/await. Nested callback pyramid (config → sale → items → payments → template) flattened to sequential `await` calls.
- **printer.js** (routes + service): `loadConfig()` is async with `db.query()`. PUT config uses `$1-$8` params with `true`/`false` booleans.
- **barcode-expenses.js**: All `? 1 : 0` → `? true : false` for 6 boolean columns (`show_name`, `show_price`, `show_barcode`, `show_sku`, `show_brand`, `is_default`). `SET is_default = 0` → `SET is_default = false`.

### Pre-Merge Infrastructure (all complete — Mar 11 2026)
- **Migration system**: `backend/migrate-pg.js` — ordered migration runner with `schema_version` table tracking. `start.sh` detects `DATABASE_URL` and branches between `migrate-pg.js` (Postgres) and `run_migrations.js` (SQLite).
- **Cutover script**: `backend/scripts/sqlite-to-pg.js` — one-time data migration using `better-sqlite3` (sync reads) → Postgres (async writes). FK-ordered table insertion, boolean 0/1→true/false conversion, SERIAL sequence resets. See `docs/POSTGRES-CUTOVER-CHECKLIST.md`.
- **MT Postgres infra**: `backend/tenant-db-manager-pg.js` (shared pg.Pool + `SET search_path TO tenant_<slug>` per request, 60s tenant cache, same API as SQLite version). `backend/tenant-db-proxy-pg.js` (AsyncLocalStorage proxy for `query`/`transaction`/`getClient`). `index.js` uses `HAS_POSTGRES = !!process.env.DATABASE_URL` to choose PG vs SQLite MT modules.

### Boot Guard (index.js line 2)
- `require("dotenv").config(...)` loads `.env` BEFORE the conditional import on line 5
- `const db = process.env.DATABASE_URL ? require("./db-pg") : require("./db")` — loads Postgres or SQLite based on env
- Railway has `DATABASE_URL` set → runs Postgres. Local dev without `.env` → falls back to SQLite.
- `start.sh` also branches: Postgres mode runs `migrate-pg.js` → `index.js`; SQLite mode runs symlinks + `run_migrations.js` → `index.js`

### Production Deployment (Live Mar 12 2026)
- **Database**: Supabase Postgres (ap-southeast-1 region)
- `DATABASE_URL` set on Railway, `DATA_DIR` removed
- Fresh DB created via setup wizard (no SQLite data migrated — test data was discarded)
- `schema-pg.sql` seeds a `company_profile` row with `setup_complete = false` for first-run token generation
- SQLite volume still mounted on Railway as safety net — can be removed after 1 week
