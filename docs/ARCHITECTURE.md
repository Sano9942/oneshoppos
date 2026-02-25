# OneShopPOS Architecture and Code Map

Last audited: 2026-02-25

This document is the architectural overview of the current codebase.
For complete endpoint and route lists, use `docs/API_REFERENCE.md`.

## 1. System Overview

OneShopPOS is a local-first retail POS system with:
- Frontend: React 19 + Vite 7 + Tailwind 4 + React Router 7
- Backend: Node.js + Express 5 + sqlite3
- Database: SQLite file at `backend/oneshop.db`
- Integration layer: Shopify connector (GraphQL + webhook + sync queue + reconciliation)

Architecture style:
- Backend is monolithic: `backend/index.js` (~7,137 lines).
- Frontend is page-oriented and route-composed in `frontend/src/App.jsx`.
- Data model evolved incrementally via `migrate.js` to `migrate45.js`.

## 2. Repository Layout (Current)

```text
oneshoppos/
|-- START.bat
|-- start-pos.bat
|-- health_check.js
|-- User_Manual.md
|-- backend/
|   |-- index.js
|   |-- db.js
|   |-- oneshop.db
|   |-- run_migrations.js
|   |-- migrate.js ... migrate45.js
|   |-- preflight.js
|   |-- e2e_test.js
|   |-- e2e_full_test.js
|   |-- shopify_utils_test.js
|   |-- shopify_mock_integration_test.js
|   |-- shopify/
|   |   |-- client.js
|   |   `-- utils.js
|   |-- uploads/
|   `-- .env.shopify.example
|-- frontend/
|   |-- src/
|   |   |-- App.jsx
|   |   |-- main.jsx
|   |   |-- auth/
|   |   |   |-- AuthProvider.jsx
|   |   |   `-- authStore.js
|   |   |-- components/
|   |   |   |-- AppLayout.jsx
|   |   |   |-- RequireAuth.jsx
|   |   |   `-- RequirePerm.jsx
|   |   `-- pages/*.jsx
|   |-- index.html
|   |-- vite.config.js
|   `-- eslint.config.js
`-- docs/
    |-- README.md
    |-- STATUS.md
    |-- TESTING.md
    |-- ARCHITECTURE.md
    |-- API_REFERENCE.md
    |-- SHOPIFY_ALIGNMENT_PLAN.md
    |-- SHOPIFY_SYNC_PLAN.md
    |-- SHOPIFY_LIVE_RUNBOOK.md
    |-- odoo.md
    `-- archive/
```

Important:
- `backend/database.sqlite` exists as a zero-byte legacy file and is not used by runtime code.
- Runtime DB path in code is `backend/oneshop.db`.

## 3. Runtime and Startup Flow

### 3.1 Local startup scripts

- `START.bat`
  - Starts backend with `node index.js`
  - Starts frontend with `npm run dev`
  - Opens `http://localhost:5173`

- `start-pos.bat`
  - Verifies Node is installed
  - Starts backend (`npm start`) and frontend (`npm run dev`)
  - On keypress, kills all `node.exe` processes

### 3.2 Backend startup (`backend/index.js`)

Execution order:
1. Load dependencies and Shopify helpers.
2. Configure `cors()` and `express.json()` (captures `rawBody` for Shopify webhook routes).
3. Install permission context middleware (`loadEmployeePerms`).
4. Seed default role permissions if missing (`ensureDefaultRolePermissions`).
5. Install route-level permission rules (`PERMISSION_RULES`).
6. Install restore lock middleware (`isRestoreInProgress`).
7. Register API routes.
8. Start HTTP server on `PORT` (default 5000).
9. Start Shopify background worker unless `SHOPIFY_SYNC_WORKER_DISABLED=1`.

## 4. Backend Architecture

### 4.1 Data access and transaction style

- Uses sqlite3 callback API via shared `db` object from `backend/db.js`.
- Uses explicit transactions (`BEGIN/COMMIT/ROLLBACK`) in critical financial/inventory flows:
  - sales posting and sale void
  - GRN receiving
  - inventory transfers
  - approvals
  - wallet operations
  - backup/restore actions

### 4.2 Auth, RBAC, and feature flags

- Auth model: employee name + PIN (`/api/auth/login`).
- Session storage: frontend `localStorage`.
- Request identity: `x-employee-id` header (injected by auth provider for API calls).
- Authorization:
  - global method/path rules in `PERMISSION_RULES`
  - endpoint-level `requirePerm` / `requireAnyPerm`
- Feature flags in `feature_flags` table with `requireFeature` middleware:
  - `backup_restore`
  - `e_invoicing_export`
  - `supplier_payables`
  - `approvals`

### 4.3 API surface location

- Full, exact backend endpoint list is documented in `docs/API_REFERENCE.md`.
- Source of truth remains `backend/index.js`.

## 5. Shopify Integration Architecture

Implementation files:
- `backend/shopify/client.js`: Shopify GraphQL transport and operations
- `backend/shopify/utils.js`: retry policy, signature verification, idempotency helpers
- Shopify routes in `backend/index.js` under `/api/integrations/*`

Capabilities currently implemented:
- Connection/config management
- Optional secret encryption with `SHOPIFY_SECRET_KEY`
- Live verify/location discovery
- Product/location/customer mapping
- Push inventory / pull orders
- Webhook ingestion (`orders-create`) with idempotency handling
- Outbound queue (`external_sync_events`) with retry metadata
- Inventory reconciliation and approval-assisted corrective actions
- Background worker polling every 30 seconds

## 6. Frontend Architecture

### 6.1 App shell and auth model

- Entry: `frontend/src/main.jsx`
- Router: `frontend/src/App.jsx`
- Auth context: `frontend/src/auth/AuthProvider.jsx`
- Route guards:
  - `RequireAuth` for authentication
  - `RequirePerm` for permission-based access
- Sidebar and feature-flag-aware nav: `frontend/src/components/AppLayout.jsx`

Session behavior:
- Persists `authSession` in `localStorage`
- Also writes `currentEmployee` for backward compatibility
- Adds `x-employee-id` to API requests through a fetch wrapper

### 6.2 Complexity hotspots (by page size)

- `Reports.jsx` (~2,213 lines)
- `POS.jsx` (~1,601 lines)
- `ShopifyIntegration.jsx` (~1,216 lines)
- `Inventory.jsx` (~1,196 lines)

### 6.3 Frontend route location

- Full frontend route map is documented in `docs/API_REFERENCE.md`.
- Source of truth remains `frontend/src/App.jsx`.

## 7. Database Architecture (Live `oneshop.db`)

### 7.1 Core master data

- `products`, `product_variants`, `product_media`
- `categories`, `brands`, `taxes`
- `outlets`, `outlet_stock`
- `employees`, `roles`, `role_permissions`
- `customers`, `customer_wallet_ledger`
- `suppliers`

### 7.2 Sales and POS

- `sales`, `sale_items`, `sale_payments`
- `returns`, `return_items`
- `parked_sales`, `parked_sale_items`
- `receipt_templates`
- `promotions`
- `invoice_sequences`

### 7.3 Inventory and procurement

- `stock_adjustments`
- `inventory_transfers`
- `purchase_orders`, `purchase_order_items`
- `goods_received_notes`, `grn_items`
- `supplier_returns`, `supplier_return_items`
- `supplier_invoices`, `supplier_payments`

### 7.4 Operations and governance

- `cash_shifts`, `shift_denominations`
- `employee_attendance`
- `action_history`
- `feature_flags`
- `backup_log`
- `approval_requests`, `approval_actions`

### 7.5 Shopify sync and staging

- `shopify_connections`, `shopify_sync_runs`
- `shopify_product_map`, `shopify_location_map`, `shopify_customer_map`, `shopify_order_map`
- `web_orders`, `web_order_items`, `web_order_transactions`, `web_order_fulfillments`
- `external_sync_events`
- `inventory_reconciliation`

Schema notes:
- Multi-outlet stock source of truth is `outlet_stock`.
- Legacy columns remain for backward compatibility.
- `db.js` bootstraps baseline tables; migrations provide full current shape.
- FK cascade behavior is mixed (some tables cascade, many do not).

## 8. Migration Strategy

- Runner: `backend/run_migrations.js`
- Order: `migrate.js` through `migrate45.js`

Progressive evolution:
- Core POS and inventory base
- Multi-outlet stock and operations
- RBAC, approvals, parked sales, wallet, supplier payables
- Promotions, barcode templates, expenses, invoice numbering, feature flags
- Shopify alignment, mapping, sync queue, and reconciliation fields

## 9. Testing and Operational Scripts

Backend scripts (`backend/package.json`):
- `npm start`
- `npm run preflight`
- `npm run test:e2e-full`
- `npm run test:shopify-utils`
- `npm run test:shopify-mock`

Important supporting scripts:
- `backend/e2e_test.js`
- `backend/e2e_full_test.js`
- `backend/preflight.js`
- `backend/health_check.js`
- root `health_check.js`

## 10. Current Constraints and Technical Debt

- Backend monolith (`index.js`) remains large, raising regression risk.
- Frontend API base URL is hardcoded in many files.
- Auth model is header-based and localStorage-backed (not hardened for internet-facing deployments).
- `backend/database.sqlite` legacy file can cause confusion.
- Some schema snapshot files are stale (`schema_dump.txt`, `readable_schema.txt`).
- `frontend/README.md` is still template content.

## 11. Practical Navigation Guide

1. Read `backend/index.js` for API behavior.
2. Read `frontend/src/App.jsx` and `components/AppLayout.jsx` for route and permission visibility.
3. Verify schema changes in migrations and in live `oneshop.db`.
4. Run `npm run preflight` and `npm run test:e2e-full` before release.
5. For API and route inventory, use `docs/API_REFERENCE.md`.
