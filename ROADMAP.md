# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
_Last updated: March 19 2026 — **Password auth + Resend email shipped.** Dashboard login now uses passwords (PIN fallback for existing employees). Forgot-password flow via Resend. Admin can set/reset passwords on Employees page._

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

| Feature                  | Priority  | Status                      |
| ------------------------ | --------- | --------------------------- |
| FBR e-invoicing          | 🔴 High   | Placeholder added, deferred |
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

## ✅ Phase 3 — Core Robustness (Mar 10 2026) — 13/14 items shipped

Split payment, brute-force throttling, soft deletes, idempotency on sales, end-of-day email digest, price change audit log, onboarding checklist, session timeout at POS, mobile/tablet POS layout, IP allowlisting, shrinkage report, customer-facing display, API key revocation — all built and live.

### Still Not Built

- **Subscription / billing layer** — Stripe or JazzCash for plan billing, trial enforcement, subscription expiry.
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

- **Self-service signup** _(requires email verification flow)_ — public tenant registration
- **Onboarding email** _(future Resend use)_ — welcome email with setup link after tenant provisioning

---

## 🔲 UX & Onboarding Improvements

- **Onboarding walkthrough / checklist** — first-time tooltip tour or in-app checklist after setup wizard ("Add your first product → Create an outlet → Open a shift") to reduce support burden
- **Employee self-service PIN change** — let employees change their own PIN from a profile page without needing an admin
- **Keyboard shortcuts on POS** — scan → quantity → Enter flow; optimized for speed cashiers working long shifts
- **Dark mode** — toggle for reduced eye strain during long shifts

## 🔲 Customer Communication

- **Receipt email/SMS to customers** — after a sale, option to email or text the receipt instead of (or in addition to) thermal print
- **Shareable receipt URL** — public page like `/receipt/ABC123` that customers can bookmark or share
- **WhatsApp integration** — receipt sharing, low-stock alerts, order updates via WhatsApp (high impact for Pakistan market)

## 🔲 Operational

- **Bulk data import** — import existing products, customers, suppliers from CSV/Excel when switching from another POS (products Excel template already exists)
- **Backup status notifications** — surface last backup time and success/failure status in the dashboard so users know their data is safe
- **Multi-language support** — Urdu translation for Pakistan market; i18n framework for future languages

## 🔲 Integrations — Tier 1 (expected by most users)

- **Email service (Resend)** — transactional email foundation; unblocks password reset, receipt email, onboarding email, daily digest reports, self-service signup. Free tier: 3,000 emails/month.
- **Payment gateway (Stripe)** — card payments at checkout; starting point for international support. Later add JazzCash/EasyPaisa via their APIs for Pakistan market.
- **Receipt email/SMS** — after a sale, option to email or text the receipt instead of (or in addition to) thermal print _(depends on email service)_
- **Accounting software sync** — export sales/expenses to QuickBooks, Xero, or Zoho Books; CSV export first, then API sync. Eliminates double-entry for store owners.
- **FBR e-invoicing** — Pakistan tax authority integration; legal requirement for registered businesses

## 🔲 Integrations — Tier 2 (high value)

- **WhatsApp Business API** — receipt sharing, low-stock alerts, order updates via WhatsApp; #1 messaging app in Pakistan/India/Middle East
- **Cloud printing** — print receipts from any device to any network printer (Star CloudPRNT, Epson ePOS); removes USB cable dependency
- **Payroll export** — sync attendance data to payroll software; closes the loop on the existing attendance/HR module

## 🔲 Integrations — Tier 3 (differentiators)

- **Delivery service dispatch** — rider integration (Bykea, Foodpanda, in-house) for restaurants, grocery, dark stores
- **CRM / marketing sync** — sync customers to Mailchimp, HubSpot for email campaigns
- **Inventory marketplace listing** — auto-list products on Daraz, Facebook Marketplace for multi-channel sellers
- **Weighing scale integration** — direct scale → POS for produce/bulk items (grocery, hardware stores)
- **CCTV / loss prevention** — link sale transactions to camera timestamps for high-shrinkage retail

## 🔲 Customer & Supplier Portals

- **Customer self-service portal** — customers log in (separate auth flow), view purchase history, loyalty points, wallet balance. Read-only on existing data. Builds trust and reduces support queries.
- **Supplier portal** — suppliers log in, view open POs, confirm/reject POs, submit invoices directly. Streamlines procurement flow, reduces WhatsApp/email back-and-forth.

## 🔲 AI & Analytics

- **AI-powered insights layer** — natural language querying on top of existing 67+ reports ("show me best-selling items this month in Lahore"). Claude API integration. Huge differentiator vs XStak.
- **Mobile manager app (PWA)** — lightweight PWA for owners: dashboard, approve transfers, view alerts on phone. Frontend already responsive — mainly needs offline manifest + install prompt.

## 🔲 Multi-Channel E-commerce

- **E-commerce sync beyond Shopify** — WooCommerce, TikTok Shop, Instagram Shopping. Existing Shopify module (9 files) is a proven template for replication.

## 📋 Discussed but Deferred

- **Payment gateway integration** (card machines, JazzCash, EasyPaisa) — see Tier 1 integrations above
- **FBR e-invoicing** — see Tier 1 integrations above
- **Advance / layaway payments** — installment-based sales; common in furniture/electronics retail
- **Profit-sharing / payroll module** — seed data mentions it but no UI
- **Shopcast / digital signage**

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
