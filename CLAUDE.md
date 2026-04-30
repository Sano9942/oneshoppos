# SanoPOS - Project Guide for Claude

> **Last updated**: April 16, 2026, 02:30 UTC  
> **Note**: This guide is accurate as of the date above, but code evolves fast. When in doubt, check actual source files (`backend/migrate-pg.js` for migrations, `package.json` for test tools, route files for API contracts). Always verify against code before making critical implementation decisions.

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + PostgreSQL (via `pg` pool, `backend/db-pg.js`)
- Frontend: React 19 + Vite 7 + Tailwind CSS v4
- **Database: Postgres ONLY (active)** — SQLite archives exist (`backend/archive/`, `backend/legacy/`) for historical purposes, but all active code uses Postgres only. Schema source of truth: `backend/schema-pg.sql`.
- **Multi-tenant is LIVE** — `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel
- Schema source of truth: `backend/schema-pg.sql`

## Sub-Guides (loaded automatically when working in those directories)

- **`backend/CLAUDE.md`** — Postgres query patterns, backend gotchas, test suites (74 integration files + 20 unit files), production env
- **`frontend/CLAUDE.md`** — route wrapper skip list, conventions (Tailwind v4, timestamps, currency, API calls), POS architecture, test suites

## Efficiency Rules (Read First)

### Model Usage
- **Default to Sonnet** for all implementation tasks — code edits, file reads, bug fixes, route changes
- **Switch to Opus only** for architecture decisions, planning multi-step features, or when genuinely stuck on a complex design problem
- Once a plan is approved and execution starts, stay on Sonnet

### Reading Files
- **Grep first** — before reading any file, grep for the specific function/route/table name. Only read the file if grep result is insufficient
- **Read only what's needed** — never read a whole directory; read the single relevant file
- **No re-read after edit** — after a successful Edit or Write, do not re-read the file. Trust the tool unless it returned an error
- **One reference rule** — when adding a new route or component, read ONE similar existing file as reference, not multiple
- **Trust CLAUDE.md** — if the answer is documented here or in sub-guides, don't read source files to verify it

### Off-Limits Unless Explicitly Needed
- `backend/index.js` — middleware order and boot sequence are documented here; don't read unless task is specifically about server config
- `backend/routes/registerAllRoutes.js` — route mounting is documented here; never read for domain-level changes
- `frontend/src/App.jsx` — composition only; route definitions in `frontend/src/routes/*.jsx`. Don't read unless task is about routing guards

### Response Style
- No trailing summaries ("Here's what I did...") — the diff speaks for itself
- No restating the task before acting — just do it

## Project Structure

```
oneshoppos/
├── backend/
│   ├── index.js                  # Main Express server (~292 lines — orchestrator; worker startup in boot/workers.js, auth/perms/flags in middleware/)
│   ├── db-pg.js                  # Postgres connection pool (query, transaction, getClient)
│   ├── schema-pg.sql             # Full DDL — single source of truth
│   ├── migrate-pg.js             # Postgres migration runner (v1-v49)
│   ├── jwt-auth.js               # JWT sign/verify utilities
│   ├── category-tree.js          # Category tree enrichment + resolveInheritedField (FBR)
│   ├── routes/
│   │   ├── registerAllRoutes.js  # Orchestrator only (~626 lines)
│   │   ├── admin/                # /api/admin/* — 10 files (auth, tenants, monitoring, billing, operations, compliance, messaging, system, helpers, index) — mounted BEFORE tenant middleware
│   │   ├── auth.js               # /api/auth/*
│   │   ├── sales.js              # /api/sales
│   │   ├── products.js           # /api/products (~1579 lines)
│   │   ├── returns.js            # /api/returns
│   │   ├── customers.js          # /api/customers
│   │   ├── employees.js          # /api/employees
│   │   ├── attendance.js         # /api/attendance + kiosk PIN endpoints
│   │   ├── inventory.js          # /api/transfers + /api/adjustments
│   │   ├── purchase-orders.js    # /api/purchase-orders
│   │   ├── grn.js                # GRN + supplier payables
│   │   ├── setup.js              # /api/setup/* (first-run wizard)
│   │   ├── receipts.js           # /api/receipts (public shareable receipt)
│   │   ├── import.js             # /api/import (bulk CSV/XLSX import)
│   │   ├── couriers.js           # /api/couriers (delivery dispatch)
│   │   ├── woocommerce.js        # /api/integrations/woocommerce
│   │   ├── insights.js           # /api/insights/auto (pre-built analytics cards)
│   │   ├── insights-ai.js        # /api/insights/ask (Claude AI chat)
│   │   ├── support.js            # /api/support/* (tickets + screenshot upload)
│   │   ├── billing.js            # /api/billing/* (subscription billing + payment checkout)
│   │   ├── webhooks.js           # /api/webhooks/* (payment gateway webhooks, no auth)
│   │   ├── fbr.js                # /api/fbr/* (FBR config, dashboard, retry)
│   │   ├── tax-lookup.js         # /api/tax-lookup (HS code search, suggest)
│   │   ├── fulfillment.js        # /api/fulfillment/* (picklists, loadsheets, dispatch)
│   │   ├── receipt-templates.js  # /api/receipt-templates
│   │   ├── supplier-returns.js   # /api/supplier-returns
│   │   ├── customer-display.js   # /api/customer-display
│   │   ├── reports/              # /api/reports/* (15 report files incl. helpers + index, modular — includes fbr-export, clinical)
│   │   ├── integrations/          # /api/integrations/* (hub, credentials, daraz, facebook, whatsapp, google-merchant)
│   │   ├── shopify/              # /api/integrations/shopify* (9 files, modular)
│   │   ├── tier4/                # Tier 4 features (7 files, modular)
│   │   └── [other domain files]  # taxes, categories, outlets, roles, brands, suppliers, promotions, orders, attribute-sets, barcode-expenses, parked-sales, shifts, service-tickets, rentals, rooms, treatment-plans, treatment-plan-templates, country-packs, sandbox, etc.
│   ├── middleware/plan-limits.js  # Tenant plan cap + subscription enforcement
│   ├── middleware/rate-limit.js   # Rate limiter config (global, auth, webhook)
│   ├── middleware/tenant-auth.js  # JWT auth, tenant resolution, company profile cache, context resolution
│   ├── middleware/permissions.js  # requirePerm, requireAnyPerm, PERMISSION_RULES, role defaults
│   ├── middleware/feature-flags.js # Feature flag cache, requireFeature, notification helpers
│   ├── middleware/validate.js     # Zod validation helper — validate(schema) middleware factory
│   ├── middleware/upload-validation.js # Centralized MIME + extension whitelist for file uploads
│   ├── schemas/                   # Zod schemas (28 files): auth, billing, employees, products, sales, returns, customers, purchase-orders, inventory, orders, admin, integrations, bookings, commissions, contracts, customer-invoices, marketing, messaging, projects, restaurant, scheduled-changes, smart-collections, subscriptions, customer-portal, rentals, rooms, service-tickets, treatment-plans
│   ├── boot/workers.js            # All worker startup (email, FBR, cleanup, Shopify, scheduled tasks)
│   ├── shopify/crypto.js          # Shopify secret encryption/decryption + event logging
│   ├── services/crypto.js          # Generalized AES-256-GCM encryption (all integrations)
│   ├── services/payment-gateway.js # Payment gateway adapter (xPay, extensible)
│   ├── services/marketplace/       # Marketplace API clients (base, daraz, meta-commerce, whatsapp, google-merchant)
│   ├── middleware/request-id.js   # Request ID + Pino logging middleware
│   ├── tenant-db-proxy-pg.js     # AsyncLocalStorage + Proxy for MT DB routing
│   ├── tenant-db-manager-pg.js   # Shared pg.Pool + per-request search_path
│   ├── tenant-db-pg.js           # Older ALS-based tenant proxy (pool client per request)
│   ├── tenant-multer.js          # Multer storage factories for MT file uploads
│   ├── master-db-pg.js           # Master tenant registry
│   ├── tenant-provisioner-pg.js  # Schema-based provisioning
│   ├── services/printer.js       # ESC/POS thermal + network TCP/IP printer
│   ├── services/couriers/        # Courier adapter pattern (base, generic, 13 adapters)
│   ├── services/logger.js        # Pino logger instance
│   ├── services/alerting.js      # In-house alert system (error spikes, DB pressure)
│   ├── services/email.js          # Unified sendEmail() + enqueueEmail() orchestrator
│   ├── services/email-templates.js # HTML builder functions for 14 email types
│   ├── services/fbr.js           # FBR API client, payload builders, queue helper
│   ├── services/boss.js            # pg-boss instance factory (shared Postgres-backed job queue)
│   ├── workers/email-worker.js    # Email queue worker (legacy inline — see email-worker-boss.js)
│   ├── workers/email-worker-boss.js # Email queue worker (pg-boss backed)
│   ├── workers/fbr-worker.js     # FBR background worker (legacy inline — see fbr-worker-boss.js)
│   ├── workers/fbr-worker-boss.js # FBR background worker (pg-boss backed)
│   ├── workers/cleanup-worker-boss.js # Dead tenant cleanup (pg-boss backed)
│   ├── workers/marketplace-sync-worker-boss.js # Marketplace order poll + feed check (pg-boss)
│   ├── workers/rental-overdue-worker-boss.js # Rental contract overdue checker (pg-boss, daily 8 AM UTC)
│   ├── workers/room-overdue-checkout-worker-boss.js # Room booking overdue checker (pg-boss, daily 11 AM UTC)
│   ├── workers/subscription-grace-worker-boss.js # Customer subscription grace transitions (pg-boss, hourly)
│   ├── workers/treatment-plan-worker-boss.js # Treatment plan reminders + overdue (pg-boss, daily 9 AM UTC)
│   ├── scripts/seed-tax-rates.js # One-time seed for tax_rate_reference (~96 HS codes)
│   ├── shared/                   # (reserved — constants currently inline in middleware/permissions.js + middleware/feature-flags.js)
│   └── utils/                    # tz.js, r2.js, receiptEmail.js, digestEmail.js, backup-pg.js, resendEmail.js, alertEmail.js
└── frontend/src/
    ├── App.jsx                   # Route orchestrator (composition only — route defs in routes/*.jsx)
    ├── api.js                    # Centralized API service layer — api.get/post/put/del/upload/raw (replaces raw fetch, handles URL/auth/JSON/errors)
    ├── auth/AuthProvider.jsx     # Global fetch interceptor + JWT auth
    ├── auth/authStore.js         # Token storage helpers
    ├── config.js                 # API_BASE, IS_MULTI_TENANT, SENTRY_DSN, ENV_MODE, IS_PROD, IS_DEV — sole import.meta.env reader
    ├── types/                    # TypeScript declarations: auth.ts, api.ts (tsconfig: allowJs + noEmit)
    ├── auth/adminAuthStore.js    # Admin session storage helpers (extracted from AdminLogin.jsx)
    ├── routes/                   # Route config split: publicRoutes.jsx, appRoutes.jsx, adminRoutes.jsx, RouteLoading.jsx
    ├── contexts/CurrencyContext.jsx  # useCurrency() → { symbol, code, fmt, refresh, denominations }
    ├── contexts/ToastContext.jsx    # useToast() → { toast, success, error, warning }
    ├── contexts/PresetContext.jsx   # usePreset() → { labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode }
    ├── auth/customerPortalStore.js  # Portal session storage (slug-scoped localStorage)
    ├── ui/primitives.jsx         # Design system (PageShell, Button, Input, etc.)
    ├── ui/Breadcrumbs.jsx        # Route-based breadcrumb nav (auto-derived from pathname)
    ├── ui/ErrorBoundary.jsx      # React error boundary (global + page-level)
    ├── ui/SupportWidget.jsx      # Floating support ticket widget
    ├── ui/ImpersonationBanner.jsx # Amber banner during tenant impersonation
    ├── ui/AnnouncementBanner.jsx  # Platform announcement banners (fetches /api/announcements/active)
    ├── ui/nav-config.js          # Sidebar nav entries
    ├── utils/
    │   ├── dates.js              # UTC + LOCAL timestamp formatters
    │   ├── receipt.js            # Receipt rendering (buildReceiptSections, buildReceiptHtml)
    │   ├── categoryTree.js       # Category tree UI helpers
    │   ├── offlineQueue.js       # Offline sale queue
    │   ├── csvExport.js          # Shared CSV download utility (downloadCsv)
    │   └── theme.js              # Dark mode: getTheme, setTheme, toggleTheme, initTheme
    └── pages/
        ├── redesign/             # Most active tenant UI pages live here (*Redesign.jsx); also see admin/, portal/, and public pages in other dirs
        │   ├── POSRedesign.jsx
        │   ├── pos/POSContext.jsx # 130+ exports — all POS state + keyboard shortcuts
        │   ├── pos/POSShortcutsOverlay.jsx # F-key help modal
        │   ├── ProfileRedesign.jsx  # Employee profile page (PIN/password change)
        │   ├── MyTicketsRedesign.jsx # Tenant-side support ticket viewer (/my-tickets)
        │   ├── ImportRedesign.jsx   # Bulk CSV/XLSX import (products, customers, suppliers)
        │   ├── IntegrationsHubRedesign.jsx # Unified integrations hub (/settings/integrations)
        │   ├── CourierSettingsRedesign.jsx # Delivery courier configuration
        │   ├── WooCommerceIntegrationRedesign.jsx # WooCommerce sync
        │   ├── FBRSettingsRedesign.jsx # FBR config (NTN, token, province, enable toggle)
        │   ├── FBRDashboardRedesign.jsx # FBR invoice queue dashboard
        │   ├── TaxLookupRedesign.jsx # Tax rate lookup (province-aware search)
        │   └── [all other *Redesign.jsx]
        ├── reports/              # Report domain modules (includes FBRExportTab)
        ├── dashboard/            # Dashboard components (17 files — includes InsightCards, AIChatPanel, BackupStatusCard)
        ├── shopify/              # Shopify tab modules
        ├── admin/                # Super-admin panel (10 files — AdminLogin, AdminLayout, AdminDashboard, AdminTenantList, AdminTenantDetail, AdminActivity, AdminEmails, AdminSupportTickets, AdminDeadLetters, AdminTaxRates)
        ├── LandingPage.jsx       # Public landing page (competitive positioning, pricing, login)
        ├── ResetPassword.jsx     # Public password reset page (/reset-password?token=xxx)
        ├── ReceiptPublicPage.jsx # Public shareable receipt (/receipt/:invoiceNumber)
        ├── SignupPage.jsx        # Public self-service signup (/signup)
        ├── Reports.jsx           # Reports orchestrator (NOT legacy)
        ├── portal/               # Customer self-service portal (separate auth via PortalAuthProvider)
        └── [*Route.jsx]          # ~64 thin wrappers — never edit (includes MyTicketsRoute.jsx)
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` is an orchestrator only — no route logic
- **Super-admin routes** (`routes/admin/` — 10 files) and **webhook routes** (`webhooks.js`) mounted BEFORE `loadTenantAndPerms`/`resolveTenant` middleware
- **Multi-tenant DB routing**: `deps.db` is a Proxy that delegates to tenant DB via AsyncLocalStorage. Middleware order: `loadTenantAndPerms` → `resolveTenant` → tenant `/uploads` → `loadCompanyProfile` → `resolveContext`
- Internal product categories are hierarchical; leaf-only assignment
- Frontend: port 5173 (Vite dev), Backend: port 5000

## UX Features

- **Dark mode**: CSS variable theming via `[data-theme="dark"]` on `<html>`. Toggle in profile dropdown. `utils/theme.js` for get/set/toggle/init. Persisted in `localStorage("sanopos_theme")`.
- **Toast notifications**: `useToast()` from `contexts/ToastContext.jsx` → `{ success, error, warning, toast }`. Max 3 visible, 4s auto-dismiss. Provider wraps inside `CurrencyProvider`, outside `AuthProvider`.
- **Profile dropdown**: Replaces old logout button + employee badge in header. Shows role, links to `/profile`, dark mode toggle, logout.
- **Employee profile page**: `/profile` route — account info, change PIN (`PUT /api/employees/:id/change-pin`), change password. Self-service, no admin perm required.
- **POS keyboard shortcuts**: F1=help, F2=discount, F3=park, F4=customer search, F5=parked sales, F8=remove last, F9=checkout, F10=clear cart, Esc=close modal. Work even when focus is in an input.
- **Breadcrumbs**: Auto-derived from `useLocation().pathname` via label map in `ui/Breadcrumbs.jsx`. Skipped on dashboard, POS, kiosk, customer-display.

## Customer Communication

- **Receipt email**: `POST /api/email/send-receipt-v2` — SMTP first (tenant `email_config`), Resend fallback. Reuses `buildReceiptEmailHtml()`.
- **Shareable receipt URL**: `/receipt/:invoiceNumber` public page. Backend: `GET /api/receipts/:invoiceNumber/public?tenant=slug`. No auth.
- **WhatsApp sharing**: `wa.me/?text=` link in POS receipt modal. Zero infrastructure — pure frontend link builder.

## Integrations

- **Bulk import**: `/import` page (admin-only). `POST /api/import/{products,customers,suppliers}` with `?preview=1` support. `GET /api/import/template/:entity` downloads .xlsx template.
- **WooCommerce**: `routes/woocommerce.js` — connect, import products, sync stock. Uses WooCommerce REST API v3 with consumer key/secret.
- **Cloud printing**: `services/printer.js` has `printToNetwork(host, port, buffer)` via raw TCP socket. `POST /api/print/test` for testing.
- **Courier dispatch**: `routes/couriers.js` — CRUD couriers, ship orders, get tracking. `services/couriers/` adapter pattern (base → generic → 13 adapters: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex). `courier_integrations` table with 13 pre-seeded couriers.
- **Integrations Hub**: Unified hub at `/settings/integrations` with 5 marketplace/channel + 13 courier integrations. Feature-flagged `marketplace_integrations`. Routes: `routes/integrations/` (hub.js, credentials.js, daraz.js, facebook.js, whatsapp.js, google-merchant.js). Marketplace clients: `services/marketplace/` (base, daraz, meta-commerce, whatsapp, google-merchant). Credentials encrypted via `services/crypto.js` (AES-256-GCM). Background worker: `workers/marketplace-sync-worker-boss.js` (pg-boss, `MARKETPLACE_SYNC_WORKER_ENABLED=1`). Webhooks: `POST /api/webhooks/{daraz,meta,whatsapp}`. Migration v17.
- **FBR export**: `GET /api/reports/fbr-export?from=X&to=Y` — generates FBR-compliant CSV data.
- **FBR Digital Invoicing**: Real-time invoice posting to FBR DI API. Feature-flagged per tenant (`fbr_integration`). Sales/returns/voids enqueue payloads to `fbr_invoices` table. Background worker (`workers/fbr-worker.js`, inline or standalone) polls queue with exponential backoff retry (5 attempts). Routes: `routes/fbr.js` (config, dashboard, retry), `routes/tax-lookup.js` (HS code search, suggest corrections). Admin: `routes/admin/compliance.js` has tax rate CRUD + FBR health endpoint. Category-level HS code + tax inheritance via `category-tree.js:resolveInheritedField()`. Tax rate reference table (`tax_rate_reference`) in public schema with ~100 seeded HS codes. Migration v9. Frontend: `/settings/fbr` (config), `/fbr` (invoice queue dashboard), `/tax-lookup` (rate search), `/admin/tax-rates` (super-admin CRUD).
- **AI insights**: `GET /api/insights/auto` (5 pre-built analytics cards). `POST /api/insights/ask` (Claude AI chat, feature-flagged `ai_insights`, requires `ANTHROPIC_API_KEY`).
- **Self-service signup**: `POST /api/auth/signup` — creates tenant + admin employee + welcome email. Gated by `SELF_SERVICE_SIGNUP=1` env var. Rate-limited. 2-tier plans: Free (1 outlet, 3 employees, 100 products) or Pro (1 outlet default, unlimited employees/products, 45-day trial). Dead tenant cleanup job (`backend/jobs/cleanup-dead-tenants.js`) removes tenants that never complete setup after 7 days.
- **Subscription lifecycle**: `requireActiveSubscription` middleware gates all business routes. Trial (45 days) → grace (7 days) → expired (read-only). Email worker sends `trial_warning`, `trial_ended`, `account_locked` automatically. Renewal emails (`renewal_due`, `renewal_overdue`) for paid tenants. `ui/SubscriptionBanner.jsx` shows trial countdown / grace warning / expired state globally.
- **Subscription billing**: `routes/billing.js` — `GET /api/billing/status` (includes `payment_enabled`, trial/grace status), `GET /api/billing/pricing`, `GET /api/billing/payment-history`, `POST /api/billing/request-upgrade` (manual path), `POST /api/billing/create-checkout` (gateway path). Admin billing UI in `AdminTenantDetail.jsx`. Tables: `plan_pricing`, `payment_records`, `upgrade_requests` (migration v7), `payment_intents` (migration v11).
- **Payment integration**: `services/payment-gateway.js` — gateway adapter (xPay implementation, extensible). `routes/webhooks.js` — `POST /api/webhooks/xpay` (HMAC-verified, mounted before tenant middleware). Feature-gated by `PAYMENT_GATEWAY` env var — when unset, system uses manual admin payments. Checkout flow: create intent → gateway redirect → webhook confirms → tenant auto-activated + payment record + confirmation email.
- **Unified Email Service**: `services/email.js` — single `sendEmail()` for all email types. Tenant->customer emails from `slug@sanopos.com`, platform->tenant from `noreply@sanopos.com`. 14 email types: receipt, digest, 3 drip, 6 billing (payment_recorded, plan_changed, expiry_warning, overdue, renewal_due, renewal_overdue), 3 lifecycle (trial_warning, trial_ended, account_locked), 2 support, 2 broadcast. `email_queue` table + `workers/email-worker.js` (inline, `EMAIL_WORKER_ENABLED=1`). Migration v10.
- **PWA**: `manifest.webmanifest` + service worker for installable app.

## Reliability & Monitoring

- **Structured logging**: Pino via `services/logger.js` + `middleware/request-id.js`. Every request gets UUID (`X-Request-Id` header). JSON in prod, pretty-print in dev. Tenant/employee context enriched after auth.
- **Error tracking**: Sentry (`@sentry/node` + `@sentry/react`). No-op without `SENTRY_DSN`/`VITE_SENTRY_DSN`. Errors tagged with tenant slug + request ID.
- **ErrorBoundary**: `ui/ErrorBoundary.jsx` — global (full-page) + page-level (compact card). Reports to Sentry.
- **Alerting**: `services/alerting.js` — in-memory sliding window counters. Emails via Resend on error spikes (10+/5min), DB pressure (>80%), health check failures. `ALERT_EMAIL` env var.
- **Health checks**: `GET /api/health` (quick), `GET /api/health?deep=true` (checks Postgres + Resend with timeouts).
- **Uptime monitoring**: UptimeRobot pings `/api/health` every 5 min, emails on downtime.
- **Support tickets**: `POST /api/support/tickets` + `POST /api/support/upload` (R2). Floating widget on all authenticated pages. Admin viewer at `/admin/support`.
- **Dead letter queue**: `/admin/dead-letters` — failed webhook events with retry/dismiss actions.
- **Tenant impersonation**: `POST /api/admin/impersonate/:tenantId` — 1-hour JWT, amber banner, audit trail in `impersonation_sessions` table. Actions tagged "(impersonated by Super-Admin)". Impersonation JWT is verified server-side (not decoded via atob() client-side).
- **Admin activity logging**: All admin mutations logged to `admin_activity_log` table. Security events (login success/failure) logged to `admin_security_log`. Cross-tenant activity via `GET /api/admin/tenant-activity`.
- **Worker monitoring**: `GET /api/admin/worker-status` reads heartbeat globals (`__emailWorkerStatus`, `__fbrWorkerStatus`, `__cleanupWorkerStatus`, `__marketplaceSyncWorkerStatus`, `__reservationWorkerStatus`, `__bookingReminderWorkerStatus`, `__rentalOverdueWorkerStatus`, `__roomOverdueWorkerStatus`, `__treatmentPlanWorkerStatus`). `queueDepth` is a real `SELECT COUNT(*)` from the queue table (not always-0). Dashboard shows running/stopped status, real queue depth, processed today.
- **Cleanup worker**: `CLEANUP_WORKER_ENABLED=1` env var. Runs `jobs/cleanup-dead-tenants.js` every 24h inline.
- **Orphaned schema detection**: `GET /api/admin/orphaned-schemas` + `POST /api/admin/orphaned-schemas/cleanup`.
- **Announcements**: `GET/POST/PUT/DELETE /api/admin/announcements` (admin), `GET /api/announcements/active` (public, no auth). Tenant-side banner via `ui/AnnouncementBanner.jsx` in AppLayout.
- **Tenant notes**: `GET/POST/DELETE /api/admin/tenants/:id/notes` — admin-only CRM notes per tenant.
- **Support ticket replies**: `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` + in-app notification. Tenant-side "My Tickets" page at `/my-tickets`.

## Running Tests

### Postgres Integration Tests (primary — 74 files) + Unit Tests (20 backend + 6 frontend)
- `npm test` or `npx vitest run backend/tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)
- 74 integration files: 19 pg-batch files (16 numbered + 3 phase batches), 39 full-audit domain tests, 15 pg-standalone, 1 legacy smoke-gate
- Unit tests: `backend/tests/unit/` (20 files — Vitest) + `frontend/tests/unit/` (6 files — Vitest)
- **Note**: Backend uses **Vitest**, not Jest (see `backend/package.json:12`)

### Production E2E Tests (28 specs, ~324 tests — full system audit against production)
- `cd frontend && npx playwright test tests/auth.spec.js`
- 28 self-contained Playwright specs at `frontend/tests/*.spec.js`, targets `sanopos.com` (tenant `packagesmall`)
- Single config: `playwright.config.js` (no separate live/onboarding configs)
- Global setup: `global-setup.js` logs in once, saves `auth.json` + `token.json`
- Helpers: `helpers/auth.js`, `helpers/api.js`, `helpers/nav.js`
- Includes 6 onboarding specs (`onboard-free`, `onboard-starter`, `onboard-pro`, `onboard-dental-clinic`, `onboard-physiotherapy`, `onboard-veterinary`) — create real test tenants, delete from `/admin` after each run

### Legacy SQLite Tests (do not use unless explicitly asked)
- `smoke-gate.test.js` has **22/25 pre-existing failures on main** — do NOT investigate

## Authentication System

- **Dashboard login**: password-based (`POST /api/auth/login` or `/api/auth/mt-login` with `{ username, password }`)
- **Graceful fallback**: if no `password_hash` set, the password field is treated as a PIN (transition period)
- **Kiosk login**: PIN-only (`POST /api/auth/kiosk-login`) — unchanged, never uses passwords
- **POS session re-auth**: PIN-only via `/api/employees/validate-pin` — NOT `/api/auth/login`
- **Forgot password**: `POST /api/auth/forgot-password` → sends Resend email → `POST /api/auth/reset-password`
- **Reset page**: `/reset-password?token=xxx&tenant=slug` (public, no auth)
- **Resend email service**: system-level transactional emails (`RESEND_API_KEY` env var on Railway)
- **Nodemailer/SMTP**: tenant-level emails (receipts, digest, CRM) — uses `email_config` table per tenant

## Permission System

- **Roles**: Administrator (`all_access`), Manager (17 permissions), Cashier (3 permissions)
- **Middleware**: `requirePerm("perm")` and `requireAnyPerm(["perm1", "perm2"])` in route handlers
- **Frontend**: `hasPerm("perm")` from `useAuth()` — returns true if `all_access` or specific permission
- **Admin-only routes**: employees CRUD, outlets, email config, printer config, roles, action-history logging
- **Manager+Admin routes**: products (write), orders, purchase orders, inventory, attribute sets, barcode print jobs, restaurant ops (`manage_restaurant`), KDS (`manage_kds`), bookings (`manage_bookings`), projects (`manage_projects`), contracts (`manage_contracts`), service tickets (`manage_tickets`), rentals (`manage_rentals`), room management (`manage_rooms`), treatment plans (`manage_treatment_plans`)
- **All authenticated**: view reports, read-only data, send receipts, POS operations

## Migrations

- **Current version**: 49 (check `backend/migrate-pg.js` for authoritative descriptions)
- **v1-v30**: Core features (auth, billing, FBR, email, KDS, products, feature flags, etc.)
- **v31-v39**: M1-M10 tenant preset engine waves (M1 preset engine, M2 service_tickets, M4 clinic extension, M5 decimal quantities, M6 SanoPay, M7 rentals, M8 portal auth, M9 rooms, M10 treatment_plans)
- **v40-v43**: (Internal/skipped in current timeline)
- **v44-v49**: April 2026 recent completions:
  - v44: Mode-gate backfill — seed tenant_modes for existing tenants using phase4 flags before defaults flip false
  - v45: Widen weighted-quantity columns to NUMERIC(10,3) — outlet_stock, return_items, stock_adjustments, product_variants
  - v46: Treatment plan templates — reusable clinical plan templates for clone-to-create
  - v47: Appointments + booking services deposit columns — mirror room_bookings for public booking deposit flow
  - v48: Tax-inclusive room rates — room_types.tax_inclusive flag
  - v49: Walk-in service staff assignment on POS — sale_items.staff_id
- **migrate-pg.js CLI**: `node backend/migrate-pg.js` — migrates public schema AND all active tenant schemas
- **Tenant migration gotcha**: existing tenants need `schema_version` table seeded with previous versions before first run
- **Source of truth**: Always check `backend/migrate-pg.js` for exact descriptions — CLAUDE.md migrations section can drift

## Live API Contracts (last verified Mar 14 2026 — check actual route files for current behavior)

- **Sales POST**: body uses `cartItems` (not `items`), item `id` (not `product_id`), item `price` (not `unit_price`)
- **Returns POST**: needs `original_sale_id`, `total_refund`, `refund_method`; items need `refund_price`
- **Dashboard fields**: `totalRevenueToday`, `saleCount`, `averageBill`
- **Accounting**: `from`/`to` params (not `start`/`end`); requires `accounting_core` feature flag
- **Shifts**: no status filter on `GET /api/shifts` — use `GET /api/shifts/active?outlet_id=1`
- **Action history**: `date_from`/`date_to` params
- **Notifications mark-read**: `PUT /api/notifications/read-all` (not POST)
- **Kiosk MT mode**: `/kiosk?tenant=<slug>` required for unauthenticated endpoints
- **Reports that exist**: `item-wise`, `inventory-dump`, `product-movement`, `cash-flow`, `shift-summary` (needs `session_id`), `shrinkage`
- **Quotations**: must PUT status to `accepted` before `convert` works
- **Infra monitoring**: `GET /api/admin/infra` — super-admin only, Postgres system stats

## Production Deployment

- **Frontend**: `https://sanopos.com` (Vercel, custom domain — `sanopos.vercel.app` still works as fallback)
- **Backend**: `https://api.sanopos.com` (Railway custom domain; `oneshoppos-production.up.railway.app` still works as fallback)
- **Super-admin**: `https://sanopos.com/admin`
- **Database**: Supabase Postgres, `public` schema = 12 master tables (incl. `payment_intents`, `admin_activity_log`, `admin_security_log`, `tenant_notes`, `announcements`, `broadcast_log`), tenant data in `tenant_<slug>` schemas
- **Resend**: `RESEND_API_KEY` env var on Railway for system emails (password reset, alerts, welcome). Sender: `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>` (custom domain, SPF/DKIM/DMARC verified on `sanopos.com` via Cloudflare)
- **Sentry**: `SENTRY_DSN` on Railway (backend), `VITE_SENTRY_DSN` on Vercel (frontend) — sanopos.sentry.io
- **Alerts**: `ALERT_EMAIL` env var on Railway — receives error spike / DB pressure / support ticket notifications
- **Uptime**: UptimeRobot monitors `/api/health` every 5 min
- See `backend/CLAUDE.md` for Railway env vars and deployment gotchas

## CLI Tools & Service Access

Claude has authenticated CLI access to the full production stack. Credentials stored in `.claude/settings.local.json` (gitignored).

| Service | Tool | What It Does |
|---------|------|-------------|
| **GitHub** | `gh` CLI | PRs, issues, repo management (account: Sano9942) |
| **Vercel** | MCP tools | Deployments, build logs, runtime logs |
| **Railway** | `railway` CLI | Deploy logs, env vars, service status (project: `oneshoppos`) |
| **Supabase** | `npx supabase` | DB management, project info (project ref: `tpjewvfoqtskscmwjtjj`) |
| **Sentry** | `sentry-cli` | Error tracking, issues, releases (org: `sanopos`, projects: `node-express` + `sanopos-frontend`) |
| **UptimeRobot** | REST API via curl | Monitor status, uptime history (monitor-specific key) |
| **Cloudflare** | REST API via curl | DNS management for `sanopos.com` (token in `settings.local.json`) |

## Infrastructure Capacity (as of Apr 2026)

> **⚠️ Always verify tier before relying on this section.** Supabase / Railway / Vercel plans change. Confirm via:
> - Supabase: project dashboard → Billing, or `mcp__claude_ai_Supabase__get_organization` (returns subscription plan)
> - Railway: `railway status` + dashboard billing
> - Vercel: `mcp__claude_ai_Vercel__list_teams` returns plan info
> Don't quote this table in launch decisions without re-checking.

### Current Stack Tier (verified 2026-04-30)

| Service | Plan | Key Limit |
|---------|------|-----------|
| **Supabase** | **Pro** ($25/mo) | Daily auto-backups + 7-day PITR, 8GB DB included, ~200 max Postgres connections, no auto-pause |
| **Railway** | Hobby/Pro | Single Node.js instance, single-threaded event loop |
| **Vercel** | Pro | 100GB bandwidth/mo — not a bottleneck |
| **Cloudflare R2** | Free tier | 10M reads/mo free, then $0.015/M — negligible at current scale |

### DB Connection Pool

- Pool size: **20 connections** (hardcoded in `backend/db-pg.js`)
- All tenants share this pool — no per-tenant pooling
- Supabase Pro allows ~200 direct connections (compute add-on dependent); current 20-conn pool is comfortably under cap
- With Supabase Transaction Pooler (port 6543), effective capacity scales much further

### Realistic Pro Tenant Capacity

| Scenario | Tenant Count |
|----------|-------------|
| Safe, no changes | 50–100 Pro tenants |
| With Supabase Transaction Pooler enabled | 300+ tenants |

**Quick win:** Enable Transaction Pooler (Supabase dashboard → Settings → Database → Connection Pooling, mode=Transaction), then update Railway `DATABASE_URL` to port 6543. Frees direct-connection budget for workers + admin tools.

### Supabase storage budget

Pro tier includes **8 GB** of database storage. Current usage is well under 1% of that — not a concern at launch scale. Indicative growth per active Pro tenant:

| Source | Estimated Size |
|--------|---------------|
| Schema overhead per tenant | ~50–100KB |
| Sales data (1000 sales/tenant) | ~2–5MB |
| Email queue HTML bodies | ~50KB/email (clears after delivery) |
| FBR payloads | ~5KB/invoice (unbounded growth) |
| Shopify raw_payload JSONB | ~20KB/order |
| WhatsApp messages | ~1KB/message |

At 20 active Pro tenants: estimated **200–350MB within 6–12 months** — small fraction of the 8 GB Pro allowance.

### Backups (Supabase Pro)

- **Daily automated backups** retained 7 days (configurable to 14/30 in dashboard)
- **Point-in-time recovery (PITR)** for the last 7 days
- Restore via Supabase dashboard → Database → Backups, or `pg_restore` from a downloaded snapshot
- App-level `pg_dump` to R2 (`POST /api/admin/backup` + `POST /api/backup/download`) is supplementary for tenant-self-export, not the primary DR strategy

## Storage Destination Map

### Supabase PostgreSQL — all transactional and config data

- **Sales**: `sales`, `sale_items`, `sale_payments` — every transaction, FBR IRN + QR code
- **Customers**: personal info, loyalty points, wallet balance, CRM notes, purchase history
- **Products**: data, variants, pricing — `image_url` is a text column pointing to R2 URL
- **Inventory**: stock levels per outlet, transfers, adjustments, stock counts
- **HR**: employee records, hashed PINs (`pin_hash`), hashed passwords (`password_hash`), attendance, leave, payroll
- **Finance**: POs, GRNs, supplier invoices/payments, expenses, journal entries, chart of accounts, postdated cheques
- **Encrypted credentials** (AES-256-GCM in DB): Shopify tokens, Daraz/Facebook/WooCommerce API keys, courier API keys — format: `enc:v1:{iv}:{tag}:{ciphertext}`
- **Background queues** (public schema, cross-tenant): `email_queue` (full HTML body stored until sent), `fbr_invoices` (FBR API payloads), `pgboss` job tables
- **Logs**: `admin_activity_log`, `admin_security_log`, `action_history`, `impersonation_sessions`, `backup_log` (metadata only)
- **JSONB blobs**: `support_tickets.screenshots` (R2 URLs), `fbr_invoices.payload/fbr_response`, `web_orders.raw_payload`, `integration_settings.config_json`

### Cloudflare R2 — binary files only

Bucket: `sanopos-uploads` (env var `R2_BUCKET`)

| File Type | Path Pattern | Size Limit |
|-----------|-------------|-----------|
| Product images (WebP converted) | `products/{product_id}.webp` | 10MB |
| Additional product media | `products/{variant_id}/{filename}` | 10MB |
| Company/store logo | `company/{account_id}/logo.{ext}` | 5MB |
| Support ticket screenshots | `support/{random_id}.{ext}` | 5MB |
| Database backups | `backups/tenant_{slug}/backup_YYYYMMDD.sql.gz` | — |

**⚠️ Fallback risk:** if R2 env vars missing on Railway, files fall to `backend/exports/` on the local filesystem — wiped on every Railway deploy. Always verify `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are set.

### Resend — transient delivery only, no permanent storage

Fires and forgets. Email HTML is stored in `email_queue` (Postgres) pre-send, then deleted after delivery.

| Email Type | Trigger |
|-----------|---------|
| Receipt | Customer purchase |
| Password reset | Forgot password |
| Welcome | New tenant signup |
| Trial warning / ended / locked | Subscription lifecycle (auto) |
| Payment recorded / expiry warning | Billing events |
| Renewal due / overdue | Billing cycle |
| Support ticket received / reply | Ticket flow |
| Daily digest | Scheduled report worker |
| Alert emails | Error spikes, DB pressure |

### What is NOT stored anywhere (by design)

| Thing | Why |
|-------|-----|
| Receipt PDFs | Rendered on-the-fly from DB data — no file saved |
| Report CSVs | Generated on demand, streamed to browser — not saved |
| Payment card data | Never touched — handled entirely by xPay gateway |
| Raw passwords/PINs | bcrypt hashes only |
| Resend email history | Not archived — `email_queue` is pre-send only |
