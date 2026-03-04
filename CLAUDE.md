# OneShopPOS - Project Guide for Claude

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + SQLite3
- Frontend: React 19 + Vite 7 + Tailwind CSS v4

## Current Status Snapshot (March 2026)

- Latest migration is `backend/migrate61.js`
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
│   │   ├── reports/                  # /api/reports/* (modular — 8 files)
│   │   │   ├── index.js              # Entry point — wires sub-modules, shared deps, exports scheduler
│   │   │   ├── dashboard.js          # /api/reports/dashboard
│   │   │   ├── sales.js              # /api/reports/sales-*
│   │   │   ├── inventory.js          # /api/reports/inventory-*
│   │   │   ├── analytics.js          # /api/reports/comparative-trends, /api/reports/heatmaps, etc.
│   │   │   ├── governance.js         # /api/reports/schedules, /api/reports/saved-views
│   │   │   ├── shifts.js             # /api/reports/shifts, /api/reports/cash-drawer
│   │   │   └── helpers.js            # Shared SQL builders and formatters
│   │   ├── returns.js            # /api/returns
│   │   ├── attendance.js         # /api/attendance + /api/attendance/pin-* (kiosk) + /api/employees/:id/attendance-config
│   │   ├── attribute-sets.js     # /api/attribute-sets
│   │   ├── receipt-templates.js  # /api/receipt-templates + action history
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
│   │   ├── reconciliation.js     # /api/reconciliation + /api/approvals (legacy — moved to shopify/reconciliation.js)
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
│   ├── category-tree.js          # Category tree enrichment, descendants, leaf validation
│   └── migrate61.js              # Latest DB migration — READ THIS for schema questions
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
            └── categoryTree.js    # Frontend helpers for flattening/rendering category trees
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- Shopify integration routes are **modular**: `backend/routes/shopify/` (8 files).
- Reports routes are **modular**: `backend/routes/reports/` (8 files).
- Tier 4 routes are **modular**: `backend/routes/tier4/` (7 files).
- `registerAllRoutes.js` is now just an orchestrator (324 lines) — no routes defined there. Each domain is loaded via its modular directory.
- Database schema: read only `backend/migrate61.js` (latest), never older migrations
- Internal product categories are hierarchical; products and category promotions may target leaf categories only
- Parent category filters expand to descendant leaves in products and reports
- SQLite DB file: `backend/oneshop.db`
- Frontend: port 5173 (Vite dev), Backend: port 5000

## When Working on Backend

- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate61.js` (latest)
- Category tree logic → `backend/category-tree.js`
- Server middleware/config → `backend/index.js`
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
- Tailwind v4: use `(--css-var)` syntax not `[var(--css-var)]`

## Do NOT Read (already in .claudeignore)

- `node_modules/` in either folder
- `backend/exports/` (generated CSV reports)
- `backend/backups/` (database backups)
- `frontend/dist/` (build output)
- Any migration file except `migrate61.js`
- Test files (`*_test.js`, `e2e_*.js`, etc.)
- Diagnostic scripts (`check_*.js`, `diagnose_*.js`, `dumpDb*.js`, etc.)

## Backend: Key Dependency Injection Notes

- `orders.js` exports `processPendingShopifyInventoryEvents` + `enqueueInventorySyncEvents` + `upsertWebOrderFromShopifyPayload` — all three captured by `registerAllRoutes.js` and passed to `routes/shopify/` via `shopifyDeps`
- `backend/shopify/order-service.js` is the canonical home of `upsertWebOrderFromShopifyPayload` and its 5 helper functions (stock policy, outlet resolution, item mapping). Instantiated via factory: `require('./order-service')(db, getActiveShopifyConnection)`
- `sales.js`, `returns.js`, `inventory.js`, `purchase-orders.js`, `supplier-returns.js` use a defensive wrapper for `enqueueInventorySyncEvents` — checks `deps.enqueueInventorySyncEvents`, no-ops gracefully if absent
- `reconciliation.js` has its own inlined `logActionHistory` (same impl as `orders.js`)
- `shopify/utils.js` exports `maskSecret` + `getActiveShopifyConnection` — used by `routes/shopify/index.js` and `reconciliation.js` via thin wrappers

## Refactor History

Full changelog: see `REFACTOR_NOTES.md`. Key milestones:

- Feb 2026: Backend modularized — 26 route files extracted from registerAllRoutes.js
- Mar 2026: All frontend pages migrated to `redesign/` wrappers
- Mar 2026: Hierarchical categories shipped (tree CRUD, leaf-only assignment)
- Mar 2026: Shopify V2 — backend modularized (8 files), data model hardened (migrate60)
- Mar 2026: Reports V2 — 8 backend + 6 frontend modules, 67 tabs, 74 endpoints
- Mar 2026: POS opening/closing workflow hardened (branch + shift + attendance gating)
- Mar 2026: Context Unification shipped — mandatory post-login branch context, role-scope enforcement, header propagation (migrate61, 3 flags live)
