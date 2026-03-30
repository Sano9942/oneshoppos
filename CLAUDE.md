# SanoPOS - Project Guide for Claude

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + PostgreSQL (via `pg` pool, `backend/db-pg.js`)
- Frontend: React 19 + Vite 7 + Tailwind CSS v4
- **Database: Postgres ONLY** — SQLite legacy files exist in repo but are never executed. See `backend/CLAUDE.md` for the skip list.
- **Multi-tenant is LIVE** — `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel
- Schema source of truth: `backend/schema-pg.sql`

## Sub-Guides (loaded automatically when working in those directories)

- **`backend/CLAUDE.md`** — file skip lists, Postgres query patterns, backend gotchas, test suites, production env
- **`frontend/CLAUDE.md`** — route wrapper skip list, conventions (Tailwind v4, timestamps, currency, API calls), POS architecture, test suites

## Project Structure

```
oneshoppos/
├── backend/
│   ├── index.js                  # Main Express server (~749 lines)
│   ├── db-pg.js                  # Postgres connection pool (query, transaction, getClient)
│   ├── schema-pg.sql             # Full DDL — single source of truth
│   ├── migrate-pg.js             # Postgres migration runner
│   ├── jwt-auth.js               # JWT sign/verify utilities
│   ├── category-tree.js          # Category tree enrichment + resolveInheritedField (FBR)
│   ├── routes/
│   │   ├── registerAllRoutes.js  # Orchestrator only (~324 lines)
│   │   ├── admin.js              # /api/admin/* (super-admin, mounted BEFORE tenant middleware)
│   │   ├── auth.js               # /api/auth/*
│   │   ├── sales.js              # /api/sales
│   │   ├── products.js           # /api/products (~912 lines)
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
│   │   ├── reports/              # /api/reports/* (12 files, modular — includes fbr-export)
│   │   ├── shopify/              # /api/integrations/shopify* (9 files, modular)
│   │   ├── tier4/                # Tier 4 features (7 files, modular)
│   │   └── [other domain files]  # taxes, categories, outlets, roles, brands, suppliers, promotions, orders, etc.
│   ├── middleware/plan-limits.js  # Tenant plan cap + subscription enforcement
│   ├── services/payment-gateway.js # Payment gateway adapter (xPay, extensible)
│   ├── middleware/request-id.js   # Request ID + Pino logging middleware
│   ├── tenant-db-proxy-pg.js     # AsyncLocalStorage + Proxy for MT DB routing
│   ├── tenant-db-manager-pg.js   # Shared pg.Pool + per-request search_path
│   ├── master-db-pg.js           # Master tenant registry
│   ├── tenant-provisioner-pg.js  # Schema-based provisioning
│   ├── services/printer.js       # ESC/POS thermal + network TCP/IP printer
│   ├── services/couriers/        # Courier adapter pattern (base, generic, leopards)
│   ├── services/logger.js        # Pino logger instance
│   ├── services/alerting.js      # In-house alert system (error spikes, DB pressure)
│   ├── services/email.js          # Unified sendEmail() + enqueueEmail() orchestrator
│   ├── services/email-templates.js # HTML builder functions for 14 email types
│   ├── services/fbr.js           # FBR API client, payload builders, queue helper
│   ├── workers/email-worker.js    # Email queue worker + trial/paid expiry lifecycle (inline or standalone)
│   ├── workers/fbr-worker.js     # FBR background worker (inline or standalone)
│   ├── scripts/seed-tax-rates.js # One-time seed for tax_rate_reference (~96 HS codes)
│   └── utils/                    # tz.js, receiptEmail.js, digestEmail.js, backup-pg.js, resendEmail.js, alertEmail.js
└── frontend/src/
    ├── App.jsx                   # Route orchestrator
    ├── auth/AuthProvider.jsx     # Global fetch interceptor + JWT auth
    ├── auth/authStore.js         # Token storage helpers
    ├── config.js                 # API base URL, IS_MULTI_TENANT
    ├── contexts/CurrencyContext.jsx  # useCurrency() → { symbol, code, fmt, refresh }
    ├── contexts/ToastContext.jsx    # useToast() → { toast, success, error, warning }
    ├── ui/primitives.jsx         # Design system (PageShell, Button, Input, etc.)
    ├── ui/Breadcrumbs.jsx        # Route-based breadcrumb nav (auto-derived from pathname)
    ├── ui/ErrorBoundary.jsx      # React error boundary (global + page-level)
    ├── ui/SupportWidget.jsx      # Floating support ticket widget
    ├── ui/ImpersonationBanner.jsx # Amber banner during tenant impersonation
    ├── ui/nav-config.js          # Sidebar nav entries
    ├── utils/
    │   ├── dates.js              # UTC + LOCAL timestamp formatters
    │   ├── receipt.js            # Receipt rendering (buildReceiptSections, buildReceiptHtml)
    │   ├── categoryTree.js       # Category tree UI helpers
    │   ├── offlineQueue.js       # Offline sale queue
    │   ├── csvExport.js          # Shared CSV download utility (downloadCsv)
    │   └── theme.js              # Dark mode: getTheme, setTheme, toggleTheme, initTheme
    └── pages/
        ├── redesign/             # ALL active pages live here (*Redesign.jsx)
        │   ├── POSRedesign.jsx
        │   ├── pos/POSContext.jsx # 130+ exports — all POS state + keyboard shortcuts
        │   ├── pos/POSShortcutsOverlay.jsx # F-key help modal
        │   ├── ProfileRedesign.jsx  # Employee profile page (PIN/password change)
        │   ├── ImportRedesign.jsx   # Bulk CSV/XLSX import (products, customers, suppliers)
        │   ├── CourierSettingsRedesign.jsx # Delivery courier configuration
        │   ├── WooCommerceIntegrationRedesign.jsx # WooCommerce sync
        │   ├── FBRSettingsRedesign.jsx # FBR config (NTN, token, province, enable toggle)
        │   ├── FBRDashboardRedesign.jsx # FBR invoice queue dashboard
        │   ├── TaxLookupRedesign.jsx # Tax rate lookup (province-aware search)
        │   └── [all other *Redesign.jsx]
        ├── reports/              # Report domain modules (includes FBRExportTab)
        ├── dashboard/            # Dashboard components (15 files — includes InsightCards, AIChatPanel, BackupStatusCard)
        ├── shopify/              # Shopify tab modules
        ├── admin/                # Super-admin panel (separate auth, infra monitoring, tax rates CRUD)
        ├── LandingPage.jsx       # Public landing page (competitive positioning, pricing, login)
        ├── ResetPassword.jsx     # Public password reset page (/reset-password?token=xxx)
        ├── ReceiptPublicPage.jsx # Public shareable receipt (/receipt/:invoiceNumber)
        ├── SignupPage.jsx        # Public self-service signup (/signup)
        ├── Reports.jsx           # Reports orchestrator (NOT legacy)
        └── [*Route.jsx]          # 31 thin wrappers — never edit
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` is an orchestrator only — no route logic
- **Super-admin routes** (`admin.js`) and **webhook routes** (`webhooks.js`) mounted BEFORE `loadTenantAndPerms`/`resolveTenant` middleware
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
- **Courier dispatch**: `routes/couriers.js` — CRUD couriers, ship orders, get tracking. `services/couriers/` adapter pattern (base → generic → leopards). `courier_integrations` table with 10 pre-seeded Pakistan couriers.
- **FBR export**: `GET /api/reports/fbr-export?from=X&to=Y` — generates FBR-compliant CSV data.
- **FBR Digital Invoicing**: Real-time invoice posting to FBR DI API. Feature-flagged per tenant (`fbr_integration`). Sales/returns/voids enqueue payloads to `fbr_invoices` table. Background worker (`workers/fbr-worker.js`, inline or standalone) polls queue with exponential backoff retry (5 attempts). Routes: `routes/fbr.js` (config, dashboard, retry), `routes/tax-lookup.js` (HS code search, suggest corrections). Admin: `routes/admin.js` has tax rate CRUD + FBR health endpoint. Category-level HS code + tax inheritance via `category-tree.js:resolveInheritedField()`. Tax rate reference table (`tax_rate_reference`) in public schema with ~100 seeded HS codes. Migration v9. Frontend: `/settings/fbr` (config), `/fbr` (invoice queue dashboard), `/tax-lookup` (rate search), `/admin/tax-rates` (super-admin CRUD).
- **AI insights**: `GET /api/insights/auto` (5 pre-built analytics cards). `POST /api/insights/ask` (Claude AI chat, feature-flagged `ai_insights`, requires `ANTHROPIC_API_KEY`).
- **Self-service signup**: `POST /api/auth/signup` — creates tenant + admin employee + welcome email. Gated by `SELF_SERVICE_SIGNUP=1` env var. Rate-limited. 2-tier plans: Free (1 outlet, 3 employees, 100 products) or Pro (unlimited, 45-day trial). Dead tenant cleanup job (`backend/jobs/cleanup-dead-tenants.js`) removes tenants that never complete setup after 7 days.
- **Subscription lifecycle**: `requireActiveSubscription` middleware gates all business routes. Trial (45 days) → grace (7 days) → expired (read-only). Email worker sends `trial_warning`, `trial_ended`, `account_locked` automatically. Renewal emails (`renewal_due`, `renewal_overdue`) for paid tenants. Global subscription status banner in frontend.
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
- **Tenant impersonation**: `POST /api/admin/impersonate/:tenantId` — 1-hour JWT, amber banner, audit trail in `impersonation_sessions` table. Actions tagged "(impersonated by Super-Admin)".

## Running Tests

### Postgres Integration Tests (primary — 340 tests)
- `npx jest backend/tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)
- 8 test files: `pg-batch1` through `pg-batch8`, plus `pg-tenant-isolation`

### Live E2E Tests (~120 tests — full stack against production)
- `cd frontend && npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- 20 Playwright specs (00–19), targets `sanopos.com` (tenant `packagesmall`)

### Onboarding E2E Tests (45 tests — full signup→sale flow, all 3 plans)
- `cd frontend && npx playwright test tests/live/2N-onboard-*.spec.js --config=playwright.config.onboarding.js`
- 3 specs: `21-onboard-free`, `22-onboard-starter`, `23-onboard-pro` (15 steps each)
- No globalSetup required — creates real test tenants from scratch each run
- After each run, delete test tenants from `/admin` before re-running
- Test log: `docs/test-logs/2026-03-28-onboarding-tests.md`

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

- **Roles**: Administrator (`all_access`), Manager (8 permissions), Cashier (3 permissions)
- **Middleware**: `requirePerm("perm")` and `requireAnyPerm(["perm1", "perm2"])` in route handlers
- **Frontend**: `hasPerm("perm")` from `useAuth()` — returns true if `all_access` or specific permission
- **Admin-only routes**: employees CRUD, outlets, email config, printer config, roles, action-history logging
- **Manager+Admin routes**: products (write), orders, purchase orders, inventory, attribute sets, barcode print jobs
- **All authenticated**: view reports, read-only data, send receipts, POS operations

## Migrations

- **Current version**: 11 (v3: password_hash/email, v4: onboarding_dismissed/backup_log, v5: courier_integrations/order shipping columns, v6: setup_token_expires_at, v7: billing tables, v8: support_tickets/impersonation_sessions, v9: FBR digital invoicing — fbr_invoices queue, category tax/HS inheritance, tax_rate_reference, tax_rate_suggestions, v10: email_queue for unified email service, v11: payment_intents for gateway checkout tracking)
- **migrate-pg.js CLI**: `node backend/migrate-pg.js` — migrates public schema AND all active tenant schemas
- **Tenant migration gotcha**: existing tenants need `schema_version` table seeded with previous versions before first run

## Live API Contracts (confirmed Mar 14 2026)

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
- **Database**: Supabase Postgres, `public` schema = 7 master tables (incl. `payment_intents`), tenant data in `tenant_<slug>` schemas
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
