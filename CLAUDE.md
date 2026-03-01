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
│   │   ├── attendance.js         # /api/attendance
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
│   └── migrate55.js              # Latest DB migration — READ THIS for schema questions
└── frontend/
    └── src/
        ├── components/           # Reusable UI components (all small, < 200 lines)
        └── pages/                # Full page views
            ├── Reports.jsx           # (~2999 lines - largest frontend file)
            ├── ShopifyIntegration.jsx # (~2108 lines)
            ├── POS.jsx               # (~1867 lines)
            └── [other pages]
```

## Key Architecture Facts
- All API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` is now just an orchestrator (324 lines) — no routes defined there
- Database schema: read only `backend/migrate55.js` (latest), never older migrations
- SQLite DB file: `backend/oneshop.db`
- Frontend: port 5173 (Vite dev), Backend: port 3001

## When Working on Backend
- Find which file owns the route: check the table in this file above
- Read ONLY that route file — do not read registerAllRoutes.js for route logic
- Schema questions → `backend/migrate55.js` only
- Server middleware/config → `backend/index.js`
- Shopify API calls → `backend/shopify/client.js`, webhook/retry logic → `backend/shopify/utils.js`

## When Working on Frontend
- Pages are in `frontend/src/pages/`
- Shared components are in `frontend/src/components/`
- Always tell Claude the exact component name and approximate line number

## Do NOT Read (already in .claudeignore)
- `node_modules/` in either folder
- `backend/exports/` (generated CSV reports)
- `backend/backups/` (database backups)
- `frontend/dist/` (build output)
- Any migration file except `migrate55.js`
- Test files (`*_test.js`, `e2e_*.js`, etc.)
- Diagnostic scripts (`check_*.js`, `diagnose_*.js`, `dumpDb*.js`, etc.)

## Refactor History
- Feb 2026: Split registerAllRoutes.js (was 11,630 lines) into 26 focused files
- See `REFACTOR_NOTES.md` for full details
