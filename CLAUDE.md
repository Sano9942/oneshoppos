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
│   │   ├── categories.js         # /api/categories
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
│   │   ├── reports.js            # ALL /api/reports/* (~2193 lines - largest backend file)
│   │   ├── returns.js            # /api/returns
│   │   ├── attendance.js         # /api/attendance + /api/attendance/pin-* (kiosk) + /api/employees/:id/attendance-config
│   │   ├── attribute-sets.js     # /api/attribute-sets
│   │   ├── receipt-templates.js  # /api/receipt-templates + action history
│   │   ├── supplier-returns.js   # /api/supplier-returns
│   │   ├── parked-sales.js       # /api/parked-sales
│   │   ├── orders.js             # /api/orders (~1407 lines)
│   │   ├── shopify.js            # /api/integrations/shopify* (~1909 lines)
│   │   ├── reconciliation.js     # /api/reconciliation + /api/approvals (~1101 lines)
│   │   ├── barcode-expenses.js   # Barcodes, expenses, backup/restore, e-invoicing
│   │   └── tier4.js              # Tier 4 features router (~1248 lines)
│   ├── shopify/
│   │   ├── client.js             # Shopify GraphQL API client (~525 lines)
│   │   └── utils.js              # Retry logic, webhook HMAC verification
│   └── migrate56.js              # Latest DB migration — READ THIS for schema questions
└── frontend/
    └── src/
        ├── components/           # Reusable UI components (all small, < 200 lines)
        ├── ui/
        │   └── primitives.jsx    # Shared design-system components (PageShell, Button, Input, etc.)
        └── pages/                # Full page views
            ├── Reports.jsx               # (~2999 lines) — wrapped by ReportsRedesign.jsx
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
                ├── InventoryRedesign.jsx
                ├── ReportsRedesign.jsx
                ├── AttendanceRedesign.jsx
                ├── ApprovalsRedesign.jsx
                ├── BarcodeTemplatesRedesign.jsx
                ├── ReceiptTemplatesRedesign.jsx
                └── [all other *Redesign.jsx files]
```

## Key Architecture Facts
- All API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` is now just an orchestrator (324 lines) — no routes defined there
- Database schema: read only `backend/migrate56.js` (latest), never older migrations
- SQLite DB file: `backend/oneshop.db`
- Frontend: port 5173 (Vite dev), Backend: port 5000

## When Working on Backend
- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate56.js` only
- Server middleware/config → `backend/index.js`
- Shopify API calls → `backend/shopify/client.js`, webhook/retry logic → `backend/shopify/utils.js`

## When Working on Frontend
- **Active pages** are in `frontend/src/pages/redesign/` — always edit the `*Redesign.jsx` file
- `*Route.jsx` files in `pages/` just render the redesign counterpart — no logic there
- Legacy originals in `pages/` (`Reports.jsx`, `ShopifyIntegration.jsx`, `Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`) — do NOT delete; they are imported by their Redesign counterparts
- All redesign wrappers use `PageShell` from `frontend/src/ui/primitives.jsx` and render the original as a child
- Nav is driven by `frontend/src/ui/nav-config.js` — add entries here to make pages visible in the sidebar
- Shared design-system primitives: `frontend/src/ui/primitives.jsx`
- Shared components: `frontend/src/components/`
- Tailwind v4: use `(--css-var)` syntax not `[var(--css-var)]`

## Do NOT Read (already in .claudeignore)
- `node_modules/` in either folder
- `backend/exports/` (generated CSV reports)
- `backend/backups/` (database backups)
- `frontend/dist/` (build output)
- Any migration file except `migrate56.js`
- Test files (`*_test.js`, `e2e_*.js`, etc.)
- Diagnostic scripts (`check_*.js`, `diagnose_*.js`, `dumpDb*.js`, etc.)

## Backend: Key Dependency Injection Notes
- `orders.js` exports `processPendingShopifyInventoryEvents` + `enqueueInventorySyncEvents` — captured by `registerAllRoutes.js` and passed to `shopify.js` via `shopifyDeps`
- `sales.js`, `returns.js`, `inventory.js`, `purchase-orders.js`, `supplier-returns.js` use a defensive wrapper for `enqueueInventorySyncEvents` — checks `deps.enqueueInventorySyncEvents`, no-ops gracefully if absent
- `reconciliation.js` has its own inlined `logActionHistory` (same impl as `orders.js`)
- `shopify/utils.js` exports `maskSecret` + `getActiveShopifyConnection` — used by `shopify.js` and `reconciliation.js` via thin wrappers

## Refactor History
- Feb 2026: Split registerAllRoutes.js (was 11,630 lines) into 26 focused files
- Mar 2026: Fixed 3 waves of post-refactor ReferenceErrors (enqueueInventorySyncEvents, getActiveShopifyConnection, maskSecret, logActionHistory, processPendingShopifyInventoryEvents)
- Mar 2026: Completed redesign migration — Attendance, Approvals, BarcodeTemplates, ReceiptTemplates now all have *Redesign.jsx wrappers; all routes in App.jsx point to redesign/
- Mar 2026: Added Attendance, Barcode Templates, Receipt Templates to nav-config.js; removed requiredFlag gate from Approvals so it shows for any manage_orders user
- Mar 2026: Full audit — all 36 nav entries, routes, redesign pages, and 26 backend modules confirmed wired. Gaps: 5 placeholder routes (lookup, custom-fields, partners, shopcast, reports/parent-report) and e-invoicing + supplier-returns have no frontend UI
- Mar 2026: Attendance module overhaul — PIN kiosk, session/break tracking, net hours, employee attendance config. migrate56.js is now latest. attendance.js properly registered (was dead code). See `REFACTOR_NOTES.md` for full details
- Mar 2026: POS and Kiosk nav entries use `newTab: true` — clicking them opens a new browser tab. `AppLayoutRedesign.jsx` renders `<a target="_blank">` for items with this flag instead of `<NavLink>`
- Mar 2026: SQLite `date()` in index fix — `idx_att_sessions_emp_date` was created with `date(session_start,'localtime')` which SQLite rejects as non-deterministic. Fixed to index on raw `session_start` column; `date()` in WHERE clauses is unaffected
