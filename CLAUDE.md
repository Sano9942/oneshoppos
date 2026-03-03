# OneShopPOS - Project Guide for Claude

## What This Is

A full-stack Point of Sale (POS) system with Shopify integration.

- Backend: Node.js + Express v5 + SQLite3
- Frontend: React 19 + Vite 7 + Tailwind CSS v4

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
│   └── migrate59.js              # Latest DB migration — READ THIS for schema questions
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
- Database schema: read only `backend/migrate59.js` (latest), never older migrations
- Internal product categories are hierarchical; products and category promotions may target leaf categories only
- `migrate58.js` changed categories from global name uniqueness to sibling-level uniqueness
- `migrate59.js` repairs category foreign keys after the category-table rebuild
- Parent category filters expand to descendant leaves in products and reports
- SQLite DB file: `backend/oneshop.db`
- Frontend: port 5173 (Vite dev), Backend: port 5000

## When Working on Backend

- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate59.js` only
- Category tree logic → `backend/category-tree.js`
- Server middleware/config → `backend/index.js`
- Shopify API calls → `backend/shopify/client.js`, webhook/retry logic → `backend/shopify/utils.js`
- Shopify routes → `backend/routes/shopify/`
- Reports routes → `backend/routes/reports/`
- Tier 4 routes → `backend/routes/tier4/`
- Shopify order upsert service → `backend/shopify/order-service.js`

## When Working on Frontend

- **Active pages** are in `frontend/src/pages/redesign/` — always edit the `*Redesign.jsx` file
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
- Any migration file except `migrate60.js`
- Test files (`*_test.js`, `e2e_*.js`, etc.)
- Diagnostic scripts (`check_*.js`, `diagnose_*.js`, `dumpDb*.js`, etc.)

## Backend: Key Dependency Injection Notes

- `orders.js` exports `processPendingShopifyInventoryEvents` + `enqueueInventorySyncEvents` + `upsertWebOrderFromShopifyPayload` — all three captured by `registerAllRoutes.js` and passed to `routes/shopify/` via `shopifyDeps`
- `backend/shopify/order-service.js` is the canonical home of `upsertWebOrderFromShopifyPayload` and its 5 helper functions (stock policy, outlet resolution, item mapping). Instantiated via factory: `require('./order-service')(db, getActiveShopifyConnection)`
- `sales.js`, `returns.js`, `inventory.js`, `purchase-orders.js`, `supplier-returns.js` use a defensive wrapper for `enqueueInventorySyncEvents` — checks `deps.enqueueInventorySyncEvents`, no-ops gracefully if absent
- `reconciliation.js` has its own inlined `logActionHistory` (same impl as `orders.js`)
- `shopify/utils.js` exports `maskSecret` + `getActiveShopifyConnection` — used by `routes/shopify/index.js` and `reconciliation.js` via thin wrappers

## Refactor History

- Feb 2026: Split registerAllRoutes.js (was 11,630 lines) into 26 focused files
- Mar 2026: Fixed 3 waves of post-refactor ReferenceErrors (enqueueInventorySyncEvents, getActiveShopifyConnection, maskSecret, logActionHistory, processPendingShopifyInventoryEvents)
- Mar 2026: Completed redesign migration — Attendance, Approvals, BarcodeTemplates, ReceiptTemplates now all have \*Redesign.jsx wrappers; all routes in App.jsx point to redesign/
- Mar 2026: Added Attendance, Barcode Templates, Receipt Templates to nav-config.js; removed requiredFlag gate from Approvals so it shows for any manage_orders user
- Mar 2026: Full audit — all 36 nav entries, routes, redesign pages, and 26 backend modules confirmed wired. Remaining intentional gaps are the 5 placeholder routes (`/lookup`, `/custom-fields`, `/partners`, `/shopcast`, `/reports/parent-report`).
- Mar 2026: Attendance module overhaul — PIN kiosk, session/break tracking, net hours, employee attendance config. `migrate56.js` introduced the attendance schema changes at that stage, and `attendance.js` was properly registered after previously being dead code. See `REFACTOR_NOTES.md` for full details.
- Mar 2026: POS and Kiosk nav entries use `newTab: true` — clicking them opens a new browser tab. `AppLayoutRedesign.jsx` renders `<a target="_blank">` for items with this flag instead of `<NavLink>`
- Mar 2026: SQLite `date()` in index fix — `idx_att_sessions_emp_date` was created with `date(session_start,'localtime')` which SQLite rejects as non-deterministic. Fixed to index on raw `session_start` column; `date()` in WHERE clauses is unaffected
- Mar 2026: Hierarchical internal categories shipped. `migrate57.js` adds `categories.parent_id`, `sort_order`, `is_active`; `backend/category-tree.js` is the shared tree utility. Category CRUD is tree-aware, products and category promotions are leaf-only, and parent-category filters expand to descendant leaves in products and reports.
- Mar 2026: Frontend category flows updated for hierarchy. `CategoriesRedesign.jsx` now manages a tree, inventory and promotions show path labels and leaf-only assignment, and reports use category selectors with descendant-aware filtering.
- Mar 2026: Migration reliability and E2E coverage improved. `migrate54.js` is rerun-safe, a hierarchical-categories Playwright smoke spec was added, and shared admin login lives in `frontend/tests/e2e/helpers/auth.js`.
- Mar 2026: Category schema hardening shipped. `migrate58.js` replaces global category-name uniqueness with sibling-level uniqueness, which is required for repeated leaf names like `Shoes` or `Jeans` under different parents.
- Mar 2026: Post-migrate58 FK repair shipped. `migrate59.js` fixes `products.category_id` and `promotions.category_id` references back to `categories` after the category table rebuild. `run_migrations.js` now includes both migrations.
- Mar 2026: Toy-store rollout completed on the live DB. Shopify-style internal categories were imported, `Toys & Games` was added as the primary top-level tree, sample products were reclassified into toy leaves, and recommended toy brands/tags were seeded.
- Mar 2026: Shopify import path made hierarchy-safe. `shopify.js` no longer auto-creates categories from Shopify `product_type`; it only assigns `category_id` when there is exactly one matching existing leaf, otherwise it preserves product metadata and leaves category assignment unchanged/null.
- Mar 2026: Permanent inventory/reports smoke coverage added. `frontend/tests/e2e/inventory-reports-smoke.spec.js` verifies inventory editing of `product_type`/`vendor`/`tags` plus category-wise CSV export and report API validity.
- Mar 2026: Shopify Integration V2 Phase 2 — backend modularization complete. `backend/routes/shopify.js` (1,929-line monolith) deleted and replaced with `backend/routes/shopify/` (8 focused modules: `index`, `config`, `health`, `sync`, `orders`, `webhooks`, `import`, `mappings`). Critical bug fixed: `upsertWebOrderFromShopifyPayload` extracted to `backend/shopify/order-service.js` and correctly threaded through `registerAllRoutes.js` → `shopifyDeps` → all Shopify route modules.
- Mar 2026: Shopify Integration V2 Phase 3 — data model hardening. `migrate60.js` creates `shopify_product_metadata` (Shopify-native taxonomy: handle, status, product_type, vendor, tags, published_at, updated_at) with `ON DELETE CASCADE` + unique index. `client.js` now returns `shopify_handle` from product queries. `import.js` fire-and-forgets a metadata upsert after every product write. `run_migrations.js` updated.
- Mar 2026: Advanced Reporting Dashboard Shipped. Implemented 11 new industry-standard reporting features across backend (`backend/routes/reports.js`) and frontend (`frontend/src/pages/Reports.jsx`). Includes: Comparative Trends (DoD/WoW), Hourly Heatmaps, Revenue Leaks (Voids/Discounts), Product Mix (Market Basket), Retail Matrix (Stars/Dogs), Customer Retention (New vs returning), Capture Rate, Labor Performance (Rev/Hr), and Loss Prevention (Risk Ratio).
- Mar 2026: Reports V2 Modularization. `Reports.jsx` monolithic file (~4000 lines) split into domain-specific modules in `frontend/src/pages/reports/`. Reduced main orchestrator to ~540 lines and restored production build stability by resolving duplicate declarations.
- Mar 2026: Phase 6.1: Reports restoration & data key unification. Backend Reports endpoints corrected to return keys expected by the frontend (`items`, `sales`, `orders`). Fixed critical aggregation logic for `sales-summary` and `comparative-trends`. Added missing `grn-report`.
- Mar 2026: Phase 7: Final Global Verification. Completed modularization of Reports, Shopify, and Tier 4. Global syntax check and export audit confirmed. Cleanup of debug logs and final system stabilization. Project now fully modularized.
- Mar 2026: Shopify Import Enhancement. `backend/routes/shopify/import.js` updated to support SKU-only products. Implemented 3-stage lookup (Shopify Map -> Barcode -> SKU) and explicit UPDATE/INSERT strategy to bypass the barcode-only unique constraint. Variants with neither barcode nor SKU are skipped.
