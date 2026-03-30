# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
_Last updated: March 30 2026 — **Massive SaaS monetization day: Phase 1 (2-tier pricing, trial enforcement, subscription lifecycle), Phase 4 (landing page competitive rewrite), Phase 5 (payment gateway infrastructure). 32 commits across 3 initiatives.**_

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
- **#6 FBR Integration** — **COMPLETE** (Mar 28 2026) — FBR Digital Invoicing: real-time invoice posting, async queue with retry, category HS code inheritance, tax rate lookup, admin CRUD
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

| Feature                  | Priority  | Status                      |
| ------------------------ | --------- | --------------------------- |
| FBR e-invoicing          | 🔴 High   | **COMPLETE** (Mar 28 2026)  |
| Advance/layaway payments | 🟡 Medium | Deferred                    |
| Serial number per sale   | 🟢 Low    | Built (Mar 9 2026)          |
| Shopcast digital signage | 🟢 Low    | Not built                   |

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

## ✅ Multi-Tenant Go-Live — COMPLETE (Mar 13 2026)

**Strategy:** Multi-tenant is the ONLY mode going forward. Single-tenant was the development foundation. A "single store" customer = MT customer on Starter plan (`max_outlets=1`). No architectural difference — just plan limits.

**Business model:** Super-admin provisions tenant → assigns plan → sends setup token → customer onboards → works within plan limits. Upgrade = bump `max_outlets`/`max_employees`/`max_products` in master DB.

**Database:** Same Supabase Postgres instance. `public` schema = 6 master tables. `tenant_<slug>` schemas = per-tenant business data.

**Go-live completed Mar 13 2026:**

- 10 plan tasks executed (master-db-pg init, auth.js tenant DB resolution, loadCompanyProfile dynamic DB, plan-limits Postgres conversion, currency endpoint MT, seed-admin-pg, cleanup-public-schema, frontend env flip, smoke test, deploy)
- 3 bonus fixes (slug validation — no hyphens, Invalid Date in admin pages, public schema cleanup — 89 tables dropped)
- 4 production issues discovered and fixed during deployment (ALS proxy on health check, health endpoint ordering, provisioner token ON CONFLICT, setup wizard duplicate employee)
- First tenant: `packagesmall` (Packages Mall) — provisioned, setup wizard completed, POS login verified

All previous blockers resolved:

1. ~~Timezone Phase 2~~ — Resolved by Postgres migration
2. ~~Tenant isolation testing~~ — 7 integration tests
3. ~~Tenant onboarding flow~~ — Admin API setup URLs
4. ~~Tenant-aware scheduled jobs~~ — `forEachActiveTenant` helper
5. ~~Subdomain/slug routing~~ — Deferred; Store Code login sufficient
6. ~~Railway multi-DB volume~~ — Postgres schema-based
7. ~~Backup/restore per-tenant~~ — pg_dump/pg_restore
8. ~~Rate limiting~~ — Per-tenant keyed by `tenantSlug:IP`
9. ~~Feature flag cache per-tenant~~ — 60s TTL Map
10. **Timezone Phase 3** (nice-to-have) — write-path unification

---

## 🔮 Future: Subdomain Routing (post-go-live enhancement)

**Decision (Mar 12 2026):** Deferred. Store Code login (Notion/Linear/Stripe model) is sufficient for an internal POS tool. Employees don't share URLs externally.

**When to build:** After `MULTI_TENANT=1` is live and you have 5+ tenants requesting branded URLs.

**Approach:** Subdomain-based (`aces-hardware.sanopos.com`)

- Wildcard DNS: `*.sanopos.com` → Cloudflare (free)
- Wildcard SSL: Cloudflare auto-cert (free)
- Vercel: Needs Pro plan ($20/mo) or Cloudflare proxy
- Frontend: Parse `window.location.hostname.split('.')[0]` → auto-fill Store Code on login page (~10 lines)
- Backend: No changes needed — tenant resolution already works via JWT `tenant_id` claim
- CORS: Add `*.sanopos.com` to allowed origins

**Why not URL path (`/store/:slug`):** Requires re-nesting all frontend routes, longer URLs, harder to add custom domains later.

**Why not now:** Zero infra changes needed for Store Code login. Subdomain adds DNS/SSL/Vercel complexity with no functional benefit until tenants request it.

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

| File                              | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `backend/db-pg.js`                | pg.Pool wrapper — `query()`, `transaction()`, `getClient()` |
| `backend/schema-pg.sql`           | Full DDL + seed data + schema_version table                 |
| `backend/migrate-pg.js`           | Version-tracked migration runner                            |
| `backend/scripts/sqlite-to-pg.js` | One-time SQLite→Postgres data migration                     |
| `backend/tenant-db-manager-pg.js` | Schema-switching multi-tenant                               |
| `backend/tenant-db-proxy-pg.js`   | AsyncLocalStorage proxy for per-request DB routing          |
| `backend/master-db-pg.js`         | Postgres master DB for tenant registry                      |
| `docker-compose.yml`              | Local Postgres for testing                                  |

---

## ✅ First-Run Setup Wizard (Built Mar 10 2026)

Token-gated 4-step wizard: Store Identity → Time & Currency → First Outlet → Admin Account. `backend/routes/setup.js` + `frontend/src/pages/SetupWizard.jsx`. Works in both single-tenant (server logs setup URL on boot) and multi-tenant (super-admin provisions tenant → sends setup link from Admin Dashboard) modes. One-time token, 503 gate until complete.

---

## ✅ Phase 3 — Core Robustness (Mar 10 2026) — 14/14 items shipped

Split payment, brute-force throttling, soft deletes, idempotency on sales, end-of-day email digest, price change audit log, onboarding checklist, session timeout at POS, mobile/tablet POS layout, IP allowlisting, shrinkage report, customer-facing display, API key revocation — all built and live. Subscription billing layer shipped in Onboarding Polish (Mar 27 2026).

### Still Not Built

- **Weighing scale integration** — USB scale for weight-based pricing (grocery, pharmacy niche).

---

## ✅ Offline Sale Queuing (Mar 12 2026)

**Branch:** `feature/offline-queuing-health-monitoring`

- **localStorage queue** — `pos_offline_queue_${employeeId}` key, 50-sale cap, JSON array of sale payloads
- **completeSale offline path** — `navigator.onLine` check + TypeError catch → queues sale with provisional receipt (`invoiceNumber: "PENDING"`, `offline: true`)
- **Auto-sync** — `window.addEventListener('online', syncQueue)` iterates queue, POSTs each sale sequentially, dequeues on success or idempotency duplicate
- **Multi-tab sync** — `storage` event listener keeps banner in sync across tabs
- **POS banner** — amber "X sale(s) queued offline" banner with "Sync now" button + green success banner after sync
- **Wallet/points blocked offline** — both toggles disabled with tooltip when `!navigator.onLine`; `offline` event force-disables active toggles
- **Backend shift relaxation** — `POST /api/sales` accepts closed shifts when `idempotency_key` present (finds most recent shift for outlet); attendance check skipped for offline replays
- **Receipt offline indicator** — `buildReceiptSections` shows "PENDING (offline)" for invoice number + footer note

---

## ✅ Tenant Health Monitoring (Mar 12 2026)

**Branch:** `feature/offline-queuing-health-monitoring`

- **Expanded per-tenant stats** — `GET /api/admin/tenants/:id/stats` returns activity (last_login, last_sale, last_shift_opened, active_employees 7d/30d), revenue (today/week/month), capacity (employees/products/outlets vs plan limits), schema size (MB)
- **Needs Attention endpoint** — `GET /api/admin/attention` returns approaching_limits (>85%), dormant (14+ days), setup_pending across all tenants
- **Enriched tenant list** — `GET /api/admin/tenants` now includes last_login, revenue_this_month, setup_complete per tenant
- **AdminTenantDetail health dashboard** — 3-section UI: Activity (relative times + sales/revenue), Plan Usage (color-coded progress bars: green <70%, amber 70-90%, red >90%), Storage & Totals
- **AdminTenantList health columns** — health dot (green/amber/red/grey), revenue column, last activity column
- **AdminDashboard Needs Attention card** — approaching limits + dormant tenants + setup pending with counts and details

---

## ✅ Landing Page (Mar 15 2026)

**Branch:** `feature/landing-page` — merged to `main`.

- **`LandingPage.jsx`** — public one-pager replacing the bare login form at `/` and `/login`
- Sections: hero + login card, 8-feature grid, 3-step "How It Works", Setup Guide accordion (5 items), User Guide accordion (6 items), footer with nav links
- Login form extracted from `Login.jsx` logic — supports multi-tenant Store Code field
- Native `<details>/<summary>` for accordions (zero JS overhead)
- Responsive: grid collapses on mobile, sticky nav with scroll-aware background
- Cosmetic fix: reduced section padding, fixed browser `:visited` pseudo-class overriding accordion text color

---

## ✅ Infrastructure Monitoring (Mar 15 2026)

**Branch:** `feature/infra-monitoring` — merged to `main`.

- **`GET /api/admin/infra`** — gated by `requireAllowedIp` + `requireSuperAdmin`
- Queries: `pg_stat_activity` (connections by state), `pg_database_size`, `pg_statio_user_tables` (cache hit ratio), `pg_stat_user_tables` (dead tuples/vacuum), per-tenant schema sizes, active slow queries (>1s)
- Optional: `pg_stat_statements` (historical slow queries) — try/catch, skipped if extension unavailable
- **`InfrastructurePanel`** in `AdminDashboard.jsx` — 6 sections: DB connections (active/idle/max), DB size, per-tenant schema sizes, cache hit ratio, table health (dead tuples), slow queries
- Auto-refreshes every 30 seconds

---

## ✅ CSV Export (Mar 15 2026)

**Branch:** `feature/csv-export` — merged to `main`.

- **Shared utility**: `frontend/src/utils/csvExport.js` — `downloadCsv(headers, rows, filename)` with proper CSV escaping and timestamped filenames
- **Added to 16 pages**: Returns, Stock Adjustments, Transfers, Supplier Payables, Expenses, Action History, Employees, Quotations, Suppliers, Brands, Taxes, Categories, Outlets, Promotions, Parked Sales, Returned Stock
- Context-aware exports: Supplier Payables exports aging/invoices/ledger tabs, Expenses exports expenses/summary tabs
- Uses `<Download>` icon from lucide-react in `PageShell` `right` prop
- Exports visible/filtered rows (respects user's current search/filter)

---

## ✅ Performance Optimization (Mar 15 2026)

### Code Splitting
**Branch:** `perf/code-splitting` — merged to `main`.

- Converted ~50 static page imports in `App.jsx` to `React.lazy()` with dynamic `import()`
- `AppLayoutRedesign` `<Outlet>` wrapped in `<Suspense>` — covers all child routes with single fallback
- `xlsx` library (429 KB) dynamically imported in `InventoryRedesign.jsx` — only loads when user imports products or downloads template
- Vite `manualChunks` updated: recharts+d3 and xlsx+codepage in isolated chunks, removed catch-all vendor chunk
- **Result: initial JS load 1,574 KB → 253 KB (84% reduction)**

### Backend Compression
**Branch:** `perf/backend-compression` — merged to `main`.

- Added `compression()` middleware to Express — gzip/deflate on all API responses (~70% smaller payloads)

### Database Cleanup
- Dropped 27 orphaned `test_*` and `tenant_test_prov_*` schemas from Supabase
- **Result: DB size 146 MB → 77 MB (47% reduction)**

### Dead Workflow Removal
**Branch:** `chore/remove-api-parity-workflow` — merged to `main`.

- Removed `.github/workflows/api-parity.yml` — the `tools/api-parity-audit.js` script it referenced was deleted in a prior cleanup, causing every push to fail and generate email spam

---

## ✅ Plan Defaults & Auto-Apply (Mar 15 2026)

**Branch:** `feature/plan-defaults` — merged to `main`.

- **`PLAN_DEFAULTS` config** in `middleware/plan-limits.js` — single source of truth for plan limits:
  | | Free | Starter | Pro |
  |---|---|---|---|
  | Outlets | 1 | 3 | 10 |
  | Employees | 3 | 10 | 50 |
  | Products | 500 | 2,000 | Unlimited |
- **Auto-apply on provision** — `POST /api/admin/tenants` sets plan limits automatically based on selected plan
- **Auto-apply on plan change** — `PUT /api/admin/tenants/:id` applies new plan defaults when plan changes; explicit limits in the same request take precedence
- **`GET /api/admin/plan-defaults`** — read-only endpoint returning plan config for frontend display

---

## ✅ Password Auth + Resend Email (Mar 19 2026)

**Branch:** `feature/password-auth-resend` — merged to `main`.

- **Password login for web dashboard** — `password_hash` (bcrypt, nullable) column on employees table; dashboard login accepts password with graceful PIN fallback (if no password set yet, PIN still works); "Set Password" button + modal on Employees page; POS session-expired re-login and kiosk PIN login stay PIN-based via `/api/employees/validate-pin`
- **Admin password management** — admin can set password for any employee, or trigger password reset email via Resend
- **Resend email service** — system-level transactional emails via Resend API (`RESEND_API_KEY` env var); nodemailer/SMTP stays for tenant-level emails (receipts, digest, CRM). Default sender: `onboarding@resend.dev` (swap to custom domain later)
- **Forgot password flow** — `POST /api/auth/forgot-password` generates bcrypt-hashed reset token (1h TTL), sends email via Resend; `POST /api/auth/reset-password` consumes token, sets password, revokes existing sessions. Generic response on forgot-password prevents user enumeration
- **Employee email column** — nullable, unique (partial index); used for password reset delivery; admin sets via Employees page
- **Reset password page** — `/reset-password?token=xxx&tenant=slug` public page, no auth required
- **Employee change-password** — employees can change their own password via `PUT /api/employees/:id/change-password` (requires current password or PIN for verification)
- **Migration v3** — `ALTER TABLE employees ADD email, password_hash` + `password_reset_tokens` table

### Still Deferred

- ~~**Self-service signup**~~ — **COMPLETE** (Mar 19 2026, Roadmap Waves)
- ~~**Onboarding email**~~ — **COMPLETE** (Mar 28 2026, Unified Email Service — welcome email + drip series)

---

## ✅ UX & Onboarding Improvements (Mar 19 2026)

**Branch:** `feature/ux-onboarding` — merged to `main` (7 commits, 15 files, +535 lines).

- **Dark mode** — CSS variable theming via `[data-theme="dark"]` on `<html>`. Toggle in profile dropdown. `utils/theme.js` for get/set/toggle/init. Persisted in localStorage.
- **Global toast system** — `useToast()` context with success/error/warning/info types. Max 3 visible, 4s auto-dismiss. Replaces per-page alert patterns.
- **Profile dropdown** — replaces logout button + employee badge in header. Shows employee name/role, links to profile page, dark mode toggle, logout.
- **Employee profile page** — `/profile` route with account info, self-service PIN change (`PUT /api/employees/:id/change-pin`), password change. No admin permission required.
- **POS keyboard shortcuts** — F1=help, F2=discount, F3=park, F4=customer search, F5=parked sales, F8=remove last, F9=checkout, F10=clear cart, Esc=close modal. Work even when focus is in an input.
- **POS help overlay** — `POSShortcutsOverlay.jsx` modal showing all shortcuts. Triggered by F1 or Help button in POS header.
- **Breadcrumb navigation** — auto-derived from `useLocation().pathname`. Shows Home → current path. Skipped on dashboard, POS, kiosk, customer-display.

---

## ✅ Roadmap Waves 1-3 (Mar 19 2026)

**Branch:** `feature/roadmap-waves` — merged to `main` (19 commits, ~40 files).

### Wave 1: Customer Communication + Operational Foundation
- **Receipt email** — `POST /api/email/send-receipt-v2` with SMTP first, Resend fallback. Reuses `buildReceiptEmailHtml()`.
- **Shareable receipt URL** — `/receipt/:invoiceNumber` public page, no auth. Backend: `GET /api/receipts/:invoiceNumber/public?tenant=slug`.
- **WhatsApp sharing** — `wa.me/?text=` link in POS receipt modal. Zero infrastructure.
- **Bulk data import** — `/import` page (admin-only). CSV/XLSX upload with preview, error highlighting, downloadable templates. Products, customers, suppliers.
- **Backup status notifications** — `backup_log` table, dashboard card with amber/red warnings for stale backups.
- **FBR e-invoicing export** — `GET /api/reports/fbr-export?from=X&to=Y` with FBR-compliant CSV. Reports page tab.
- **Onboarding walkthrough** — dismissible checklist on dashboard (add product, set up outlet, open shift, make sale). Persisted via `company_profile.onboarding_dismissed`.
- **Self-service signup** — `POST /api/auth/signup` with tenant provisioning + welcome email via Resend. Gated by `SELF_SERVICE_SIGNUP=1`.

### Wave 2: Integrations
- **Cloud printing** — network TCP/IP via raw socket in `services/printer.js`. `POST /api/print/test` endpoint.
- **Payroll export** — `GET /api/hr/payroll-export?period_id=X` CSV download from HR page.
- **AI insight cards** — `GET /api/insights/auto` returns 5 pre-built analytics cards (revenue trend, top products, low stock, busiest hour, avg transaction).
- **AI chat panel** — `POST /api/insights/ask` proxies to Claude API. Feature-flagged `ai_insights`, rate-limited 20/day. Floating chat widget on dashboard.

### Wave 3: Multi-Channel & Advanced
- **PWA shell** — `manifest.webmanifest` + service worker. App is installable on mobile.
- **WooCommerce sync** — `routes/woocommerce.js` with connect, import products, sync stock. WooCommerce REST API v3.
- **Courier dispatch** — `courier_integrations` table with 10 pre-seeded Pakistan couriers. Adapter pattern (`services/couriers/`). Generic + Leopards adapters built. Tenants configure own couriers + API keys.

### Still Not Built (deferred)
- **WhatsApp Business API** — official API for automated alerts (wa.me links ship now)
- **FBR real-time API** — **COMPLETE** (Mar 28 2026) — async queue worker, category HS inheritance, tax rate lookup + suggestions. See `docs/plans/2026-03-28-fbr-digital-invoicing-design.md`
- **TikTok Shop / Instagram Shopping** — WooCommerce first, add others on demand
- **CRM/marketing sync** (Mailchimp, HubSpot) — deferred to tenant demand
- **Inventory marketplace listing** (Daraz, Facebook) — deferred
- **Dedicated mobile manager views** — PWA shell ships now, views later based on feedback
- **Multi-language support** (Urdu) — deferred
- **Payment gateway** — infrastructure BUILT (Mar 30 2026, xPay adapter). Pending: xPay account, Stripe/JazzCash adapters
- **Accounting software sync** (QuickBooks, Xero) — deferred
- **Weighing scale integration** — deferred
- **Customer/Supplier portals** — deferred
- **FBR sandbox test scenario UI** — automated scenario runner for FBR certification (after FBR integration ships)
- **Online channel FBR reporting** — Shopify/WooCommerce invoice posting to FBR (after FBR integration ships)
- **Provincial revenue integrations** — PRA (Punjab), SRB (Sindh), KPRA (KPK), BRA (Balochistan) portals
- **CCTV / loss prevention** — POS event timestamps for DVR cross-reference (Hikvision/Dahua). Start with timestamp-only, then deep link to DMSS app

## ✅ Onboarding Polish (Mar 27 2026)

**Branch:** `feature/onboarding-polish` — merged to `main`.

- **Self-service signup improvements** — rate limiting on signup endpoint, welcome email via Resend, dead tenant cleanup job (`backend/jobs/cleanup-dead-tenants.js`)
- **Subscription billing layer** — manual payment recording, plan management, tenant billing page. `payment_records` + `upgrade_requests` + `plan_pricing` tables (migration v7). `POST /api/admin/payments/:tenantId`, `PUT /api/admin/tenants/:id` plan/billing fields, `GET /api/billing/pricing` public endpoint. Frontend: `BillingRedesign.jsx` + admin payment/billing UI in `AdminTenantDetail.jsx`.

---

## ✅ Reliability & Support Tooling (Mar 28 2026)

**Branch:** `feature/reliability-support-tooling` — merged to `main` (15 commits, 26 files, ~3,000 lines).

**Goal:** Error tracking, structured logging, alerting, support tickets, and tenant impersonation — all at zero monthly cost.

### Infrastructure Layer
- **Request ID + Pino structured logging** — `backend/middleware/request-id.js` + `backend/services/logger.js`. Every request gets a UUID (`X-Request-Id` header), JSON logs in production, pretty-print in dev. Slow requests (>2s) logged at warn level. Tenant/employee context enriched after auth via `enrichReqLog` middleware.
- **Sentry integration** — `@sentry/node` (backend) + `@sentry/react` (frontend). Error capture only (no tracing/replay). No-op without `SENTRY_DSN`/`VITE_SENTRY_DSN`. Errors tagged with tenant slug + request ID.
- **Frontend ErrorBoundary** — `frontend/src/ui/ErrorBoundary.jsx`. Global (full-page) + page-level (compact card). Catches crashes, reports to Sentry, shows user-friendly fallback. Dark mode aware.
- **In-house alert system** — `backend/services/alerting.js` + `backend/utils/alertEmail.js`. In-memory sliding window counters. Alerts via Resend email on: error spikes (10+ in 5 min), DB connection pressure (>80%), health check failures. Cooldown prevents flooding.
- **Deep health check** — `GET /api/health?deep=true` checks Postgres + Resend with per-check timeouts via `Promise.allSettled`. Returns `ok`/`degraded`/`down` with latency per dependency.

### Support & Debugging
- **Support widget** — `frontend/src/ui/SupportWidget.jsx`. Floating button (bottom-right) on all authenticated pages. Bug/feature/question form with screenshot upload (R2), auto-captures page URL, browser info, last failed request ID.
- **Support ticket system** — `backend/routes/support.js` + `support_tickets` table (migration v8). `POST /api/support/tickets`, `POST /api/support/upload` (R2), `GET /api/support/tickets`. Alert email to `ALERT_EMAIL` on new tickets.
- **Admin ticket viewer** — `frontend/src/pages/admin/AdminSupportTickets.jsx`. Cross-tenant ticket list with status management (open → acknowledged → resolved), inline screenshots, quick-impersonate button.
- **Dead letter queue UI** — `frontend/src/pages/admin/AdminDeadLetters.jsx`. Failed webhook events table with retry/retry-all/dismiss actions.
- **Tenant impersonation** — `POST /api/admin/impersonate/:tenantId` creates 1-hour JWT. Opens tenant dashboard in new tab with amber warning banner (`ImpersonationBanner.jsx`). All actions tagged "(impersonated by Super-Admin)" in action_history. Full audit trail via `impersonation_sessions` table in master DB.

### External Services (all free tier)
- **Sentry** — sanopos.sentry.io, 2 projects (node-express + sanopos-frontend), 5K errors/month free
- **UptimeRobot** — monitors `https://oneshoppos-production.up.railway.app/api/health` every 5 min, email alerts on downtime
- **Resend** — existing service, now also used for alert emails (`ALERT_EMAIL` env var)

### DB Migration v8
- `support_tickets` table in tenant schemas
- `impersonation_sessions` table in public/master schema

---

## ✅ Onboarding E2E Tests + Production Bug Fixes (Mar 28 2026)

**Branch:** `feat/onboarding-e2e-tests` — merged to `main`.

### E2E Test Suite
- 3 new Playwright specs: `21-onboard-free.spec.js`, `22-onboard-starter.spec.js`, `23-onboard-pro.spec.js`
- New config `playwright.config.onboarding.js` (no globalSetup — runs without packagesmall login)
- 15 steps per plan: health → pricing page → signup → setup wizard → login → billing page → support widget → add products → open shift → clock in → make sale → verify sale → plan limit checks
- **45/45 tests passing** on live production

### Production Bugs Fixed
1. **Plan limits never enforced** — `requirePlanLimit` middleware existed in `middleware/plan-limits.js` but was never applied to any route. Added to `POST /api/outlets`, `POST /api/employees`, `POST /api/products`.
2. **Signup ignored selected plan** — `POST /api/auth/signup` always provisioned tenant with Free DB defaults (max_outlets=1, max_employees=3). Now runs `UPDATE tenants SET plan, max_outlets, max_employees, max_products` using `PLAN_DEFAULTS` after provisioning.

### Test Bugs Fixed
1. Health check: removed `?deep=true` (no tenant DB context on that endpoint)
2. Login placeholders: updated to match `LandingPage.jsx` login form (`"e.g. aceshardware"`, `"Enter your password"`, `"Sign In"`)
3. Clock-in endpoint: `/api/attendance/clock-in` doesn't exist — fixed to use `/api/attendance/pin-checkin?tenant=${slug}` (kiosk PIN-based, writes `attendance_sessions` which POS checkout validates)

### Infrastructure Fixed
- `khantoys` (Khan Toys) plan limits corrected via direct DB update — was provisioned before plan limit code existed
- Test tenant log: `docs/test-logs/2026-03-28-onboarding-tests.md`

---

## ✅ Custom Domain + Email Infrastructure (Mar 28 2026)

- **`sanopos.com`** purchased on Cloudflare Registrar
- **Resend domain verification** — Auto configure added SPF + DKIM records automatically. All DNS records verified (green) in Resend dashboard.
- **DMARC** — `_dmarc.sanopos.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@sanopos.com"` added via Cloudflare DNS API
- **Railway env var** — `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>` — all system emails now send from branded address
- **Email deliverability stack**: SPF ✓ DKIM ✓ DMARC ✓ — professional sender identity established
- **Cloudflare API token** stored in `.claude/settings.local.json` alongside Sentry/Supabase/UptimeRobot credentials

---

## ✅ Unified Email Service (Mar 28 2026)

**Branch:** `feat/unified-email-service` — merged to `main` (11 commits, 12 files, +783 lines).

**Goal:** Single `sendEmail()` entry point for all email types, tenant-branded receipt emails, onboarding drip series, billing notifications, support ticket lifecycle emails, and admin broadcast capabilities.

### New Files
- **`services/email.js`** — unified `sendEmail()` (immediate via Resend) + `enqueueEmail()` (deferred via `email_queue` table). `resolveFrom()` maps tenant→customer emails to `Store Name <slug@sanopos.com>`, platform→tenant emails to `SanoPOS <noreply@sanopos.com>`.
- **`services/email-templates.js`** — 10 HTML template functions with shared branded wrapper (`wrapEmailHtml()`). Green gradient header, white card body, footer.
- **`workers/email-worker.js`** — polls `email_queue` every 60s, sends via Resend. Daily billing check enqueues expiry warnings (7 days) and overdue notices with 24h deduplication. Inline mode (same pattern as FBR worker) gated by `EMAIL_WORKER_ENABLED=1`.

### 12 Email Types
| Category | Types | Trigger |
|----------|-------|---------|
| Tenant → Customer | `receipt`, `digest` | Branded sender: `slug@sanopos.com` |
| Drip (queued) | `drip_getting_started`, `drip_features` | Auto-enqueued on signup (day 2, day 5) |
| Billing (immediate) | `billing_payment_recorded`, `billing_plan_changed` | Admin records payment or changes plan |
| Billing (daily cron) | `billing_expiry_warning`, `billing_overdue` | Worker checks daily with dedup |
| Support | `support_received`, `support_resolved` | Ticket creation / admin resolve |
| Broadcast (queued) | `downtime`, `announcement` | `POST /api/admin/email/broadcast` |

### Modified Files
- `routes/email.js` — receipt Resend fallback now uses branded sender via `sendEmail()`
- `routes/auth.js` — signup enqueues 2 drip emails (+2d, +5d)
- `routes/admin.js` — billing emails on payment/plan change, ticket-resolved email, broadcast endpoint
- `routes/support.js` — ticket-received confirmation email + fixed admin link URL
- `migrate-pg.js` + `schema-pg.sql` — migration v10: `email_queue` table in public schema

### Database
- **`email_queue`** table in public schema (cross-tenant) with FK to `tenants(id)`. Partial index on `(send_at) WHERE sent_at IS NULL AND attempts < max_attempts` for efficient worker polling.
- **Railway env var:** `EMAIL_WORKER_ENABLED=1`

---

## ✅ Admin Email Queue Page (Mar 28 2026)

**Branch:** `feat/admin-email-page` — merged to `main`.

- **`GET /api/admin/email-queue`** — lists emails with `?status=pending|sent|failed` filter + summary counts (pending/sent/failed) via `COUNT(*) FILTER`
- **`POST /api/admin/email-queue/:id/retry`** — resets failed email attempts to 0 for worker retry
- **`AdminEmails.jsx`** — 3 summary stat cards (pending/sent/failed), broadcast form (type dropdown + subject + message), email queue table with color-coded type badges, status filter tabs, retry button for failed emails, auto-refresh 30s
- **Nav:** "Emails" link with Mail icon added to admin sidebar between Support and Dead Letters
- **Route:** `/admin/emails`

---

## ✅ Railway Region Migration — Singapore (Mar 29 2026)

Moved Railway backend from **EU West (Amsterdam)** to **Asia Southeast (Singapore)** — same region as Supabase database.

| Metric | Before (Amsterdam) | After (Singapore) |
|--------|--------------------|--------------------|
| API ↔ DB latency | ~150ms | ~12ms |
| Pakistan ↔ API | ~250ms | ~80ms |
| Total API round trip | ~400-500ms | ~100-160ms |

Changed via Railway Settings UI after removing `numReplicas` from `railway.toml` (was locking the Scale section).

---

## ✅ SaaS Phase 1 — 2-Tier Pricing & Trial Enforcement (Mar 30 2026)

**Commits:** 15 commits on `main` (no feature branch — rapid iteration).

**Goal:** Replace 3-tier pricing (Free/Starter/Pro) with a simpler 2-tier model (Free + Pro with 45-day trial), enforce subscription lifecycle, and protect revenue.

### Pricing Changes
- **Removed Starter tier entirely** — `PLAN_DEFAULTS` updated to 2 tiers only. Admin UI, signup page, billing page, pricing endpoint all updated.
- **Free plan**: All features unlocked, limited capacity (1 outlet, 3 employees, 100 products). Lead generation tool.
- **Pro plan**: Unlimited capacity, PKR 8,000/mo per outlet. 45-day free trial on self-service signup.

### Subscription Lifecycle
- **`requireActiveSubscription` middleware** — gates all business routes. Free plan always passes. Trial/active pass. Grace passes (7-day window). Expired = 403 "Subscription expired".
- **Trial lifecycle in email worker** — `runTrialCheck()`: trial warning (7 days left), trial→grace transition (on expiry), grace→expired transition (7 days after expiry). Auto-enqueues `trial_warning`, `trial_ended`, `account_locked` emails.
- **3 new email templates** — `trial_warning`, `trial_ended`, `account_locked` in `email-templates.js`.

### Frontend Changes
- **Subscription status in AuthProvider** — detects trial/grace/expired from billing API, exposes via `useAuth()`.
- **Global subscription banner** — amber (trial ending/grace) or red (expired) banner across all pages.
- **Billing page rewrite** — trial countdown progress bar, grace period warning, expired read-only notice, upgrade request flow.
- **Signup page** — 2-tier plan selection cards with "45-day free trial" badge.
- **Admin dashboard** — removed Starter plan count.

### Bug Fixes (same session)
- **Soft-delete slug conflict** — signup now checks `WHERE deleted_at IS NULL` so deleted store names can be reused.
- **master-db search_path leak** — all master DB queries now explicitly set `search_path = public`.
- **email_queue FK constraint** — removed `tenants` FK from `email_queue` (was blocking tenant provisioning).
- **Welcome email setup link** — fixed raw URL rendering.

---

## ✅ SaaS Phase 4 — Landing Page Competitive Rewrite (Mar 30 2026)

**Commits:** 10 commits on `main`.

**Goal:** Reposition landing page from generic POS to Pakistan-specific competitive advantage.

### Sections Added/Rewritten
- **Hero** — "The only POS built for Pakistan" with FBR compliance, offline reliability, no transaction fees messaging. Dual CTA (Start Free Trial + See Pricing).
- **Pain points** — 3-card section: offline reliability (power cuts, internet drops), FBR compliance (real-time digital invoicing, auto-HS codes), transparent pricing (no hidden fees, no per-transaction cuts).
- **Device compatibility** — tablet, laptop, phone illustrations showing POS works on any device.
- **Feature grid** — benefit-first copy rewrite: revenue & sales, inventory, team management, customer engagement, analytics, multi-store, compliance, integrations.
- **Comparison table** — SanoPOS vs Oscar POS vs EasyPOS vs Vend. Highlights: offline mode, FBR integration, free tier, WhatsApp receipts.
- **Stats bar** — 50+ reports, 50+ features, 14 keyboard shortcuts, 5-minute setup.
- **Expandable feature list** — 50+ features across 8 categories with show/hide toggle.
- **Updated pricing cards** — Free plan shows all features with capacity limits, Pro positioned as capacity upgrade with trial badge.

---

## ✅ Payment Integration Infrastructure (Mar 30 2026)

**Branch:** `feature/payment-integration` — merged to `main` (7 commits, 10 files, +693 lines).

**Goal:** Add automated one-time payments via gateway redirect checkout (xPay first, Stripe later), so tenants can self-service pay for Pro subscriptions without admin involvement.

### Backend
- **`services/payment-gateway.js`** (new) — gateway adapter pattern. `createCheckout()`, `verifyWebhook()`, `isEnabled()`. xPay implementation with HMAC-SHA256 verification. Feature-gated by `PAYMENT_GATEWAY` env var.
- **`routes/billing.js`** — `POST /api/billing/create-checkout` (creates payment intent, calls gateway, returns checkout URL), `GET /api/billing/payment-history` (returns up to 24 payment records). Double-pay guard (blocks if 7+ days remaining). `payment_enabled` flag in billing status response.
- **`routes/webhooks.js`** (new) — `POST /api/webhooks/xpay` webhook handler. Mounted before tenant middleware. Verifies signature, looks up payment intent, activates tenant (plan, limits, expiry), inserts payment record, enqueues confirmation email. Idempotent.
- **`index.js`** — raw body capture extended to `/api/webhooks/` paths.
- **`workers/email-worker.js`** — `runPaidExpiryCheck()` handles paid tenant lifecycle: renewal warning (7 days before expiry), active→grace transition on expiry. De-duplicated with existing `runBillingCheck` via `NOT EXISTS (SELECT 1 FROM payment_records)`.
- **`services/email-templates.js`** — 2 new templates: `renewal_due`, `renewal_overdue`.

### Frontend
- **`BillingRedesign.jsx`** — Pay Now buttons on trial/grace/expired banners (gated by `payment_enabled`), payment return polling (up to 15 attempts after gateway redirect), payment processing spinner, upcoming renewal card (7-day window), payment history table.

### Database
- **Migration v11** — `payment_intents` table in public schema with indexes on `gateway_ref` (partial) and `(tenant_id, status)`.
- **`master-db-pg.js`** — `payment_intents` DDL + updated `plan_pricing` seed (Pro only).

### Activation (pending)
- Set `PAYMENT_GATEWAY=xpay`, `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET` on Railway when xPay account is ready
- Configure webhook URL: `https://api.sanopos.com/api/webhooks/xpay`
- Until activated, system works exactly as today (manual admin payments)

---

## 📋 SaaS Monetization & Growth Strategy (Mar 30 2026)

### How POS SaaS Companies Monetize

**International (Square, Lightspeed, Vend, Toast):**
- Free tier = lead generation, limited features
- Paid tiers = $30-$100+/month per outlet
- Payment processing fees (2-3% per transaction) = the real money maker
- Add-ons sold separately (loyalty, advanced reporting, payroll)

**Pakistan (Oscar POS, EasyPOS, RetailPro PK):**
- Monthly subscriptions PKR 2,000-15,000/month (cash-heavy economy, no payment processing revenue)
- Per-outlet pricing common (PKR 3,000-5,000 per outlet/month)
- Annual discounts 15-25% to reduce churn
- Setup fees PKR 10,000-50,000 (onboarding, training, data migration)
- Hardware bundles (scanner + printer + tablet) sold at markup

### Phase 1 — Protect Revenue (Quick Wins) ✅ COMPLETE (Mar 30 2026)

- [x] **2-tier pricing (Free + Pro)** — removed Starter tier entirely. Free = all features, limited capacity (1 outlet, 3 employees, 100 products). Pro = unlimited, PKR 8,000/mo per outlet. 45-day free trial on Pro signup.
- [x] **Trial lifecycle enforcement** — `requireActiveSubscription` middleware on all business routes. Trial countdown, grace period (7 days), expired state = read-only. Email worker sends `trial_warning`, `trial_ended`, `account_locked` emails automatically.
- [x] **Global subscription banner** — amber/red banners in frontend for trial expiring, grace period, and expired states. AuthProvider detects subscription status.
- [x] **Billing page rewrite** — trial countdown progress bar, grace/expired warnings, upgrade request flow. `BillingRedesign.jsx`.
- [x] **Signup page updated** — 2-tier plan selection with "45-day free trial" badge on Pro.
- [x] **Admin UI updated** — removed Starter references from admin dashboard, tenant management.
- [x] **Fix soft-delete slug conflict** — `WHERE deleted_at IS NULL` check on signup so deleted store names can be reused.
- [x] **Manual payment recording** — already built (continues working via `/admin`).

### Phase 2 — Growth & Conversion

- [ ] **Demo store / sandbox** — read-only tenant anyone can log into without signup. Pre-loaded with sample products, sales, reports. Store code: `demo`, credentials: `guest` / `demo1234`. Best sales tool — zero friction
- [ ] **Referral program** — "Refer a store, get 1 month free." `referred_by` column on `tenants`. Both referrer and referred get credited
- [ ] **Setup fee / onboarding service** — charge PKR 10,000-25,000 for data migration, hardware setup, training call. Pure profit, standard in Pakistan POS market
- [x] **Per-outlet pricing** (Mar 31 2026) — billing page and checkout show per-outlet breakdown (outlets × price = total). Backend already computed `amount = pricePerOutlet × outletCount`; frontend now exposes it with monthly/annual toggle.
- [x] **Annual discount push** (Mar 31 2026) — Monthly/annual pricing toggle on billing page + landing page. Pro PKR 80,000/yr (save PKR 16,000). "Save 17%" badge on annual option.

### Phase 3 — Product Stickiness & Engagement

- [ ] **Daily/weekly email digest** — "Your store did PKR 45,000 yesterday, 23 transactions, top product: XYZ." Uses existing `email_queue` + sales data. Keeps owners engaged
- [ ] **WhatsApp notifications** — WhatsApp Business API for low-stock alerts, shift summaries, daily digests. Pakistan runs on WhatsApp — major differentiator
- [ ] **Digital receipts via WhatsApp** — proper WhatsApp template messages (not just wa.me links). Customer loyalty balance check via WhatsApp
- [ ] **Automated onboarding progress emails** — targeted drip based on what they haven't done: "You haven't added products yet" (day 2), "Ready to open your first shift?" (day 3). Reduces drop-off. Drip infrastructure already exists

### Phase 4 — Competitive Moats (Partially Complete)

- [x] **Landing page rewrite** (Mar 30 2026) — full competitive repositioning. Pakistan-specific hero ("The only POS built for Pakistan"), pain points section (offline, FBR, pricing advantages), device compatibility, comparison table (vs Oscar POS, EasyPOS, Vend), benefit-first feature grid, expandable 50+ feature list across 8 categories, stats bar (50+ reports, 50+ features, 14 shortcuts, 5-min setup).
- [x] **FBR integration as headline marketing** — featured prominently in landing page comparison table and feature list. Already built — positioned as #1 differentiator.
- [x] **Offline-first reliability marketing** — "Never lose a sale" messaging in landing page pain points section and feature list. Offline queuing already built.
- [ ] **Multi-language support (Urdu UI)** — POS screen especially: product names, receipt text, button labels. Most retail staff more comfortable in Urdu. Major differentiator
- [ ] **Inventory alerts via SMS** — low stock SMS via Twilio or local gateway (JazzCash SMS API). Store owners check SMS more reliably than email

### Phase 5 — Payment Integration & Scale

**Payment gateway infrastructure is BUILT** (Mar 30 2026). Gateway adapter pattern (`services/payment-gateway.js`) supports xPay now, Stripe/JazzCash later. Feature-gated by `PAYMENT_GATEWAY` env var — system works as today until activated.

#### To activate xPay:
1. Sign up at [xpay.pk](https://xpay.pk) — merchant account needs: business name, CNIC/NTN, bank account, website URL (`sanopos.com`)
2. After approval, get **API Key** and **Webhook Secret**
3. Configure webhook URL in xPay dashboard: `https://api.sanopos.com/api/webhooks/xpay`
4. Set Railway env vars: `PAYMENT_GATEWAY=xpay`, `XPAY_API_KEY=<key>`, `XPAY_WEBHOOK_SECRET=<secret>`
5. Test in xPay sandbox before going live
6. **Note:** May need to adjust endpoint URL or field names in `payment-gateway.js` once you have actual xPay API docs

#### What's built:
- [x] **Payment gateway adapter** — `services/payment-gateway.js` (xPay implementation, extensible to Stripe/JazzCash/EasyPaisa)
- [x] **Checkout flow** — `POST /api/billing/create-checkout` → gateway redirect → webhook confirms → tenant auto-activated
- [x] **Webhook handler** — `POST /api/webhooks/xpay` with HMAC-SHA256 verification, idempotent processing
- [x] **payment_intents table** — tracks checkout attempts (migration v11)
- [x] **Double-pay guard** — blocks checkout if subscription has 7+ days remaining
- [x] **Paid subscription expiry** — email worker transitions active→grace→expired with renewal emails
- [x] **Billing UI** — Pay Now buttons, payment return polling, payment history table

#### Remaining:
- [ ] **xPay account setup** — sign up, get credentials, configure webhook (see steps above)
- [ ] **Stripe / Paddle** — international card payments for overseas Pakistani diaspora stores (add adapter to `payment-gateway.js`)
- [ ] **JazzCash / EasyPaisa integration** — local mobile money (add adapter to `payment-gateway.js`)
- [ ] **Per-outlet add-on pricing** — transaction-based pricing for high-volume stores
- [ ] **White-label / enterprise tier** — for chains that want their own branding

### Technical Improvements

- [x] **Tenant analytics dashboard (super-admin)** (Mar 31 2026) — `GET /api/admin/tenants/:id/feature-usage` aggregates `action_history` by action_type (all time + 30d) + top users. Bar chart + user pills in `AdminTenantDetail.jsx` health panel.
- [x] **Signup flow: clear browser auth state** (Mar 31 2026) — `AuthProvider.jsx` fetch interceptor now excludes `/api/auth/signup`, `/api/auth/forgot-password`, `/api/auth/reset-password` from token injection. (Actual bug: employee JWT leaked into public auth endpoints, not admin session.)

---

## 📋 Discussed but Deferred

- **Payment gateway integration** — infrastructure built (Mar 30 2026), pending xPay account setup. See Phase 5 for activation steps
- **Advance / layaway payments** — installment-based sales
- **Shopcast / digital signage**
- **CCTV / loss prevention**

---

## 🔍 Audit History

| Date        | What                                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mar 9 2026  | Full 38-area backend↔frontend audit                  | 25+ gaps found, documented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mar 9 2026  | 6 parallel fix sessions                              | 11 gaps fixed, 18 files changed, 1,410 lines, zero regressions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mar 9 2026  | Merged + pushed to main                              | Live on Vercel + Railway                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Mar 9 2026  | Roadmap Phase 2 — 9 parallel sessions                | All 25 remaining items complete, 28 files changed, 2,936 lines, 395/395 tests passing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Mar 9 2026  | Merged feature/roadmap-phase2 → main                 | Live on Vercel + Railway                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Mar 9 2026  | **BUG FIX — POS product search broken**              | `POSContext.jsx` `triggerSearch()` called `fetch()` without `authHeaders()` → backend rejected with "Not found"; fixed in PR #3, merged + deployed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mar 9 2026  | **BUG FIX — POS Opening Gate empty branch dropdown** | `ContextSwitcher.jsx` called `/api/context/bootstrap` without `authHeaders()` → 401, no outlet stored in context → POS gate never cleared; fixed + pushed to main, deployed                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Mar 9 2026  | **Railway 502**                                      | Backend went down (unrelated to code); redeployed via Railway GraphQL API from CLI, back up within ~35 seconds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Mar 10 2026 | Phase 3 robustness backlog added                     | 14 items across P0–P3: offline queuing, split payment, brute-force throttling, soft deletes, idempotency, end-of-day digest, price audit log, onboarding checklist, session timeout, billing layer, tenant health monitoring, mobile layout, IP allowlisting, shrinkage report                                                                                                                                                                                                                                                                                                                                                                  |
| Mar 10 2026 | Phase 3 P0 deep audit                                | Split payment confirmed fully built (moved to shipped). Rate limiter found DISABLED (`skip: () => true` in index.js:191) — 1-line fix needed. Soft deletes, idempotency, offline queuing confirmed not built. Offline queuing worse than estimated — SW only handles GET, AuthProvider blocks POST with 503, no IndexedDB/queue/retry exists.                                                                                                                                                                                                                                                                                                   |
| Mar 10 2026 | **Phase 3 shipped**                                  | 8/9 items built on `feature/phase3-robustness` (8 commits, 27 files, 1,824 lines): rate limiter fix, idempotency on sales (migrate71), price audit log, email digest, session timeout at POS, onboarding checklist, setup wizard (migrate72), soft deletes (migrate73). Offline queuing deferred. 395/395 tests passing. Locally tested via Playwright.                                                                                                                                                                                                                                                                                         |
| Mar 10 2026 | **Phase 3 remaining shipped**                        | 5 items built on `feature/phase3-remaining` (4 commits, 21 files, 1,003 lines): mobile/tablet POS layout (3-tab nav, sticky pay button), IP allowlisting for /api/admin (CIDR matching), token revocation (migrate74, jti claim, revoke endpoints), stock shrinkage report (6-join SQL + ShrinkageTab), customer-facing display (/customer-display page + in-memory cart sync). 395/395 tests passing. Frontend build clean.                                                                                                                                                                                                                    |
| Mar 11 2026 | **Postgres migration — pre-merge tasks**             | 4 tasks completed on `feature/postgres-migration`: last SQLite files converted (email.js, printer routes, registerAllRoutes.js), migrate-pg.js migration runner, sqlite-to-pg.js cutover script + checklist, MT Postgres infra (tenant-db-manager-pg, tenant-db-proxy-pg). 340/340 pg tests passing.                                                                                                                                                                                                                                                                                                                                            |
| Mar 12 2026 | **Postgres migration merged + deployed**             | `feature/postgres-migration` merged to `main` (28 commits, 93 files, +23,188/-15,139 lines). Boot guard added (conditional db-pg/db import). dotenv load order fix (must load before boot guard). Supabase Postgres provisioned (ap-southeast-1). `DATABASE_URL` set on Railway, `DATA_DIR` removed. Fresh DB created via setup wizard. `schema-pg.sql` seed row fix for company_profile. Production live on Postgres.                                                                                                                                                                                                                          |
| Mar 12 2026 | **Currency/timezone centralization**                 | `feature/currency-timezone-centralization` branch (13 commits, ~58 files). CurrencyProvider context, all PKR hardcodes replaced, cash_denominations column (schema migration v2), IANA timezone dropdown, denomination chip editor.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Mar 12 2026 | **MT Phase 1 blocker fixes**                         | `feature/mt-phase1-blockers` branch (4 commits, 4 files). 6 cross-tenant data leak / broken-functionality blockers resolved: per-tenant `_companyCache` Map, per-tenant `_contextFlagCache` Map, boot IIFE guards, `auditLog()` uses masterDb, customer display keyed by `${tenantSlug}-${shiftId}`.                                                                                                                                                                                                                                                                                                                                            |
| Mar 12 2026 | **MT Phase 2 operations**                            | `feature/mt-phase2-operations` branch (9 commits, ~10 files). Setup token generation in tenant provisioner; admin API setup URL endpoints (get/regenerate); admin dashboard setup URL UI; setup wizard MT adaptation (tenant-scoped DB via URL param); tenant-scoped notification helpers; tenant-aware scheduled jobs (`forEachActiveTenant` helper); per-tenant rate limiting (`tenantSlug:IP`). pg-batch3 test fix (ON CONFLICT for company_profile seed). 55/55 pg-batch3 tests passing.                                                                                                                                                    |
| Mar 12 2026 | **MT Phase 3 hardening**                             | `feature/mt-phase3-hardening` branch. Per-tenant feature flag cache (60s TTL Map, invalidated on PUT). pg_dump/pg_restore backup/restore (replaces stubs, runtime availability check). 7 tenant isolation tests (API + DB + concurrent request safety). Only subdomain/slug routing remains before MULTI_TENANT=1.                                                                                                                                                                                                                                                                                                                              |
| Mar 13 2026 | **MT Go-Live — MULTI_TENANT=1 flipped**              | `feature/multi-tenant-golive` + `fix/mt-golive-polish` branches merged to `main`. 10 plan tasks + 3 bonus fixes + 4 production hotfixes. Super-admin seeded via Railway CLI. First tenant `packagesmall` (Packages Mall) provisioned, setup wizard completed, POS login verified. Public schema cleaned (89 stale tables dropped). `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel.                                                                                                                                                                                                                                                |
| Mar 15 2026 | **Landing page shipped**                              | `LandingPage.jsx` — public one-pager with hero, features grid, setup/user guide accordions, login form. Replaced bare login page. |
| Mar 15 2026 | **Infrastructure monitoring**                         | `GET /api/admin/infra` endpoint + `InfrastructurePanel` in admin dashboard. DB connections, cache ratio, dead tuples, slow queries, schema sizes. |
| Mar 15 2026 | **CSV export added to 16 pages**                      | Shared `downloadCsv()` utility + Export CSV button on all table pages missing it. Context-aware for multi-tab pages. |
| Mar 15 2026 | **Performance: code splitting + compression**         | React.lazy on ~50 routes (1.6 MB → 253 KB initial JS, -84%). Dynamic xlsx import. Backend gzip compression. Dead workflow removed. |
| Mar 15 2026 | **DB cleanup**                                        | 27 orphaned test schemas dropped from Supabase (146 MB → 77 MB, -47%). |
| Mar 15 2026 | **Plan defaults auto-apply**                          | `PLAN_DEFAULTS` config in `plan-limits.js`. Auto-applied on provision (POST) and plan change (PUT). New `GET /api/admin/plan-defaults` endpoint. Free (1/3/500), Starter (3/10/2000), Pro (10/50/unlimited). |
| Mar 14 2026 | **Live E2E test suite — all 20 specs passed**        | 20 Playwright specs (00–19) run sequentially against live production (`sanopos.vercel.app`, tenant `packagesmall`). ~120 individual tests, all passing. Covered: full POS day (shift open→sale→return→close), inventory, purchasing/GRN, customers/loyalty, gift cards, CRM, HR/payroll, attendance/kiosk, approvals, notifications, reports (dashboard/sales/inventory/P&L), audit log. One real bug found and fixed: kiosk `?tenant=` param needed in MT mode for unauthenticated PIN endpoint (`backend/index.js` resolveTenant + `KioskRedesign.jsx`). All other fixes were test files only — adapting specs to match actual API contracts. |
| Mar 19 2026 | **Password auth + Resend email shipped**              | `feature/password-auth-resend` branch. Migration v3 (email, password_hash, password_reset_tokens). Resend utility for system emails. Dashboard login accepts password (PIN fallback). Forgot-password + reset-password flow. Admin set-password/send-reset on Employees page. POS re-auth fixed to use validate-pin. |
| Mar 19 2026 | **Permission guards hardened**                         | Full RBAC audit. Added `requirePerm` to: email config (PUT/test → `all_access`), printer config (PUT → `all_access`), attribute sets (POST/PUT/DELETE → `manage_inventory`), barcode print jobs (POST → `manage_inventory`), action history (GET → `view_reports`, POST log → `all_access`). Roles CRUD confirmed admin-only. Self-role-change guard fixed to allow non-role edits on own profile. |
| Mar 19 2026 | **UX & onboarding improvements shipped**               | `feature/ux-onboarding` branch (7 commits, 15 files, +535 lines). Dark mode (CSS variable theming), global toast system, profile dropdown (replaces logout button), employee profile page (self-service PIN/password change), POS keyboard shortcuts (F1-F10 + Esc), POS help overlay, breadcrumb navigation. |
| Mar 19 2026 | **Roadmap Waves 1-3 shipped**                          | `feature/roadmap-waves` branch (19 commits, ~40 files). Wave 1: receipt email (SMTP+Resend), shareable receipt URL, WhatsApp sharing, bulk import (products/customers/suppliers with xlsx templates), backup notifications, FBR export, onboarding checklist, self-service signup. Wave 2: cloud printing (TCP/IP), payroll export, AI insight cards, Claude AI chat. Wave 3: PWA shell, WooCommerce sync, courier dispatch (10 Pakistan couriers + Leopards adapter). Migrations v4+v5. |
| Mar 27 2026 | **Onboarding polish shipped**                          | `feature/onboarding-polish` branch. Self-service signup improvements (rate limiting, welcome email, dead tenant cleanup). Subscription billing layer (manual payments, plan management, tenant billing page). Migrations v6+v7. |
| Mar 28 2026 | **Reliability & support tooling shipped**               | `feature/reliability-support-tooling` branch (15 commits, 26 files, ~3,000 lines). Request ID + Pino logging, Sentry (backend+frontend), ErrorBoundary, in-house alerting (error spikes, DB pressure), deep health checks, support widget + ticket system, dead letter queue UI, tenant impersonation with audit trail. Migration v8. External: Sentry (free), UptimeRobot (free). |
| Mar 28 2026 | **FBR Digital Invoicing shipped**                       | `feature/fbr-digital-invoicing` branch. Real-time FBR DI API posting, async queue (`fbr_invoices` table), exponential backoff retry (5 attempts), category-level HS code + tax inheritance (`resolveInheritedField()`), tax rate lookup/suggestions, admin CRUD for tax rates. Migration v9. `FBR_WORKER_ENABLED=1` on Railway. |
| Mar 28 2026 | **Onboarding E2E tests — 45/45 PASS**                  | New Playwright config (`playwright.config.onboarding.js`) without globalSetup. 3 specs: `21-onboard-free`, `22-onboard-starter`, `23-onboard-pro` (15 steps each). Ran against live production. **2 production bugs found and fixed**: (1) `requirePlanLimit` middleware was created but never applied to any route — outlets/employees/products POST routes now enforce plan caps; (2) `POST /api/auth/signup` always provisioned with Free defaults regardless of selected plan — now applies `PLAN_DEFAULTS` for chosen plan. 3 test bugs fixed (health check deep mode, login placeholders, clock-in endpoint). `khantoys` plan limits corrected (was on Free defaults, bumped to Pro via direct DB update). Test log: `docs/test-logs/2026-03-28-onboarding-tests.md`. |
| Mar 28 2026 | **Custom domain sanopos.com — email configured**        | Purchased `sanopos.com` on Cloudflare Registrar. Configured with Resend via "Auto configure" (SPF + DKIM added automatically). DMARC TXT record added via Cloudflare API (`_dmarc` → `v=DMARC1; p=none; rua=mailto:dmarc@sanopos.com`). Railway env var `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>` set. Welcome emails now deliver from branded address. Cloudflare API token stored in `.claude/settings.local.json`. |
| Mar 28 2026 | **Unified email service shipped**                       | `feat/unified-email-service` branch (11 commits, 12 files, +783 lines). Single `sendEmail()` + `enqueueEmail()` service, 10 HTML templates, email queue worker with daily billing checks. 12 email types: receipt (branded `slug@sanopos.com`), 2 drip, 4 billing, 2 support, 2 broadcast. Migration v10 (`email_queue` table). `EMAIL_WORKER_ENABLED=1` on Railway. |
| Mar 28 2026 | **Admin email queue page shipped**                      | `feat/admin-email-page` branch. `GET /api/admin/email-queue` (list + counts), `POST /api/admin/email-queue/:id/retry`. `AdminEmails.jsx` with summary cards, broadcast form, queue table, status filters, auto-refresh. Nav item added to admin sidebar. |
| Mar 30 2026 | **SaaS Phase 1 — 2-tier pricing shipped**                | 15 commits on `main`. Removed Starter tier. Free + Pro (45-day trial, PKR 8,000/mo). `requireActiveSubscription` middleware on all business routes. Trial lifecycle: email worker sends warning/ended/locked emails, transitions trial→grace→expired. Global subscription banners. Billing page rewrite with trial countdown. Signup updated to 2-tier. Admin UI cleaned. Bugs fixed: slug reuse, master-db search_path leak, email_queue FK, welcome email link. |
| Mar 30 2026 | **SaaS Phase 4 — Landing page rewrite**                  | 10 commits on `main`. Full competitive repositioning for Pakistan market. Hero ("The only POS built for Pakistan"), pain points (offline, FBR, pricing), device compatibility, benefit-first feature grid, comparison table (vs Oscar POS, EasyPOS, Vend), stats bar, expandable 50+ feature list, updated pricing cards. |
| Mar 30 2026 | **Payment integration shipped**                         | `feature/payment-integration` branch (7 commits, 10 files, +693 lines). Gateway adapter pattern (`services/payment-gateway.js`) with xPay implementation. `POST /api/billing/create-checkout` → gateway redirect → `POST /api/webhooks/xpay` webhook confirms → tenant auto-activated. `payment_intents` table (migration v11). Double-pay guard (7-day window). Email worker gains paid subscription expiry transitions (active→grace) with `renewal_due`/`renewal_overdue` templates. Billing UI: Pay Now buttons, payment return polling, payment history table. Feature-gated by `PAYMENT_GATEWAY` env var — zero impact until activated. Pending: xPay account signup + credentials. |
| Mar 29 2026 | **Railway moved to Singapore**                          | Backend region changed from EU West (Amsterdam) to Asia Southeast (Singapore). API↔DB latency dropped from ~150ms to ~12ms (same region as Supabase). Total API round trip for Pakistan users: ~400-500ms → ~100-160ms. |
| Mar 31 2026 | **Roadmap items 1, 5, 6, 8 shipped**                    | `feature/roadmap-items-1-5-6-8` branch. (1) Signup auth fix: fetch interceptor excludes public auth endpoints from token injection. (5) Tenant feature-usage analytics: `GET /api/admin/tenants/:id/feature-usage` + bar chart in AdminTenantDetail. (6) Annual pricing toggle on billing + landing pages. (8) Per-outlet breakdown on billing page. Backend `GET /api/billing/status` now returns `max_outlets`. |
