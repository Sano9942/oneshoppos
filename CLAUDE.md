# OneShopPOS - Project Guide for Claude

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + SQLite3
- Frontend: React 19 + Vite 7 + Tailwind CSS v4

## Current Status Snapshot (March 2026)

- Latest migration is `backend/migrate65.js`
- **Test suite: 283/285 Jest integration tests passing (2 pre-existing vitest-format failures in concurrency.test.js)**
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
│   │   ├── attendance.js         # /api/attendance + /api/attendance/pin-* (kiosk) + /api/employees/:id/attendance-config
│   │   ├── attribute-sets.js     # /api/attribute-sets
│   │   ├── receipt-templates.js  # /api/receipt-templates + action history
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
│   ├── schema-full.js            # Extracts live oneshop.db schema via sqlite_master (for new tenant DBs)
│   ├── master-db.js              # Lazy-init master.db — tenant registry (getMasterDb, closeMasterDb, initMasterDb)
│   ├── tenant-db-manager.js      # In-memory connection pool for tenant SQLite DBs (getDb, closeDb, closeAll, healthCheck)
│   ├── tenant-provisioner.js     # CLI: provisions new tenant (directory, schema, seed data, master.db registration)
│   ├── category-tree.js          # Category tree enrichment, descendants, leaf validation
│   ├── services/
│   │   └── printer.js            # PrinterService — ESC/POS USB+TCP, paper-width-aware formatting, cash drawer
│   ├── utils/
│   │   ├── tz.js                 # Timezone utils — toUtcStart/toUtcEnd for SaaS date filters
│   │   └── receiptEmail.js       # Server-side HTML receipt builder for email (inline CSS, no scripts)
│   └── migrate65.js              # Latest DB migration — READ THIS for schema questions
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
- `registerAllRoutes.js` is now just an orchestrator (324 lines) — no routes defined there. Each domain is loaded via its modular directory.
- Database schema: read only `backend/migrate65.js` (latest), never older migrations
- Internal product categories are hierarchical; products and category promotions may target leaf categories only
- Parent category filters expand to descendant leaves in products and reports
- SQLite DB file: `backend/oneshop.db`
- Frontend: port 5173 (Vite dev), Backend: port 5000

## When Working on Backend

- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate65.js` (latest)
- Email receipt HTML builder (server-side) → `backend/utils/receiptEmail.js`
- Category tree logic → `backend/category-tree.js`
- Server middleware/config → `backend/index.js`
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
- Shared components: `frontend/src/components/`
- Category tree UI helpers: `frontend/src/utils/categoryTree.js`
- UTC timestamp display helpers: `frontend/src/utils/dates.js` — use `fmtDate`/`fmtTime`/`fmtDateTime` (never `new Date(x.timestamp)` directly)
- Tailwind v4: use `(--css-var)` syntax not `[var(--css-var)]`

## Running Tests

- Use `npx jest <path>` for integration tests in `backend/tests/integration/` — these use Jest
- `npm test` in `backend/` runs vitest — only works for files using vitest import syntax
- 10+ test files use vitest `import` syntax (attendance, customers, promotions, etc.) — these FAIL under Jest; pre-existing and expected
- Confirmed passing baseline: 283 Jest integration tests, 2 pre-existing failures (concurrency.test.js vitest format)

## Common Gotchas

### Global fetch interceptor (AuthProvider)
- `AuthProvider.jsx` patches `window.fetch` to inject `x-outlet-id` + `x-scope-mode` headers
- Headers are ONLY injected when the URL contains `/api/` — missing the prefix = no context headers = "Context required" error
- Always use `${API}/api/<route>` not `${API}/<route>` in frontend fetch calls

### Sales table schema
- The sale timestamp column is named `timestamp`, NOT `created_at` — using `created_at` silently returns undefined

### Timezone architecture (SaaS-ready)
- All business-critical timestamps (`sales`, `returns`, `cash_shifts`, `stock_adjustments`, `inventory_transfers`) are stored as **UTC** via `CURRENT_TIMESTAMP`
- `attendance_sessions` and `employee_attendance` store **local time** (server OS) — this is intentional and self-consistent; do NOT change their write paths
- `backend/utils/tz.js` provides `toUtcStart(dateStr, tz)` and `toUtcEnd(dateStr, tz)` — converts a local `YYYY-MM-DD` string in any IANA timezone to UTC boundary strings for direct `timestamp >= ?` / `timestamp < ?` SQL comparisons
- `req.company.timezone` (IANA string, e.g. `'America/New_York'`) is set by the `loadCompanyProfile` middleware — use it in all date filter queries; **never use `date(col,'localtime')` for new queries on UTC-stored columns**

### Displaying UTC timestamps in the frontend (CRITICAL — recurring bug)
- **NEVER** use `new Date(x.timestamp)` or `new Date(x.created_at)` directly on values from the API — SQLite UTC strings like `"2026-03-06 08:56:04"` have no `Z` suffix, so browsers parse them as local time and `.toLocaleString()` shows the wrong (UTC) hour
- **ALWAYS** use the shared utility at `frontend/src/utils/dates.js`:
  - `fmtDateTime(str)` — date + time
  - `fmtDate(str)` — date only
  - `fmtTime(str, opts?)` — time only
- Exception: `attendance_sessions` / `employee_attendance` fields are stored in local time — `new Date(dt)` is correct there

### POS architecture (`redesign/pos/`)
- All POS state lives in `POSContext.jsx` — 128+ exported values. Add new state/functions here, mount new modals in `POSRedesign.jsx`
- New POS components must call all hooks (`useMemo`, `useCallback`, etc.) BEFORE any conditional early return
- `POST /api/sales` requires: active shift + clocked-in employee — exchange sales from return flow will fail if shift is closed
- `POST /api/sales` stock deduction: uses `item.variant_id` for variant stock (`product_variants` table), `item.id` for `outlet_stock` — always pass `variant_id` when known
- POS Recent Sales + Return/Exchange flow: `POSRecentSalesPanel.jsx` + `POSReturnExchangeModal.jsx` (both new, Mar 2026)
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
