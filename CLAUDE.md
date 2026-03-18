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
│   ├── category-tree.js          # Category tree enrichment
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
│   │   ├── reports/              # /api/reports/* (11 files, modular)
│   │   ├── shopify/              # /api/integrations/shopify* (9 files, modular)
│   │   ├── tier4/                # Tier 4 features (7 files, modular)
│   │   └── [other domain files]  # taxes, categories, outlets, roles, brands, suppliers, promotions, orders, etc.
│   ├── middleware/plan-limits.js  # Tenant plan cap enforcement
│   ├── tenant-db-proxy-pg.js     # AsyncLocalStorage + Proxy for MT DB routing
│   ├── tenant-db-manager-pg.js   # Shared pg.Pool + per-request search_path
│   ├── master-db-pg.js           # Master tenant registry
│   ├── tenant-provisioner-pg.js  # Schema-based provisioning
│   ├── services/printer.js       # ESC/POS thermal printer
│   └── utils/                    # tz.js, receiptEmail.js, digestEmail.js, backup-pg.js, resendEmail.js
└── frontend/src/
    ├── App.jsx                   # Route orchestrator
    ├── auth/AuthProvider.jsx     # Global fetch interceptor + JWT auth
    ├── auth/authStore.js         # Token storage helpers
    ├── config.js                 # API base URL, IS_MULTI_TENANT
    ├── contexts/CurrencyContext.jsx  # useCurrency() → { symbol, code, fmt, refresh }
    ├── ui/primitives.jsx         # Design system (PageShell, Button, Input, etc.)
    ├── ui/nav-config.js          # Sidebar nav entries
    ├── utils/
    │   ├── dates.js              # UTC + LOCAL timestamp formatters
    │   ├── receipt.js            # Receipt rendering (buildReceiptSections, buildReceiptHtml)
    │   ├── categoryTree.js       # Category tree UI helpers
    │   ├── offlineQueue.js       # Offline sale queue
    │   └── csvExport.js          # Shared CSV download utility (downloadCsv)
    └── pages/
        ├── redesign/             # ALL active pages live here (*Redesign.jsx)
        │   ├── POSRedesign.jsx
        │   ├── pos/POSContext.jsx # 128+ exports — all POS state
        │   └── [all other *Redesign.jsx]
        ├── reports/              # Report domain modules
        ├── dashboard/            # Dashboard components (12 files)
        ├── shopify/              # Shopify tab modules
        ├── admin/                # Super-admin panel (separate auth, infra monitoring)
        ├── LandingPage.jsx       # Public landing page (product info, setup/user guide, login)
        ├── ResetPassword.jsx     # Public password reset page (/reset-password?token=xxx)
        ├── Reports.jsx           # Reports orchestrator (NOT legacy)
        └── [*Route.jsx]          # 31 thin wrappers — never edit
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` is an orchestrator only — no route logic
- **Super-admin routes** (`admin.js`) mounted BEFORE `loadTenantAndPerms`/`resolveTenant` middleware
- **Multi-tenant DB routing**: `deps.db` is a Proxy that delegates to tenant DB via AsyncLocalStorage. Middleware order: `loadTenantAndPerms` → `resolveTenant` → tenant `/uploads` → `loadCompanyProfile` → `resolveContext`
- Internal product categories are hierarchical; leaf-only assignment
- Frontend: port 5173 (Vite dev), Backend: port 5000

## Running Tests

### Postgres Integration Tests (primary — 340 tests)
- `npx jest backend/tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)
- 8 test files: `pg-batch1` through `pg-batch8`, plus `pg-tenant-isolation`

### Live E2E Tests (~120 tests — full stack against production)
- `cd frontend && npx playwright test tests/live/NN-name.spec.js --config=playwright.config.live.js`
- 20 Playwright specs (00–19), targets `sanopos.vercel.app` (tenant `packagesmall`)

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

- **Current version**: 3 (password_hash, email on employees + password_reset_tokens table)
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

- **Frontend**: `https://sanopos.vercel.app` (Vercel)
- **Backend**: `https://oneshoppos-production.up.railway.app` (Railway)
- **Super-admin**: `https://sanopos.vercel.app/admin`
- **Database**: Supabase Postgres, `public` schema = 6 master tables, tenant data in `tenant_<slug>` schemas
- **Resend**: `RESEND_API_KEY` env var on Railway for system emails (password reset)
- See `backend/CLAUDE.md` for Railway env vars and deployment gotchas
