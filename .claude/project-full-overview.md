# OneShopPOS — Full Project Overview
> Generated: 2026-02-26 | Last full codebase read: session with thorough top-to-bottom exploration
> **To use:** Read this file at the start of a session for complete project context without re-exploring.

---

## 1. WHAT IS THIS PROJECT

OneShopPOS is a **local-first retail Point of Sale system** built for multi-outlet retail businesses. It runs fully offline on a local machine (SQLite, no cloud DB). Key capabilities:
- Full POS register (barcode, cart, discounts, split tender, parked sales)
- Multi-outlet inventory management (transfers, adjustments, reconciliation)
- Supplier & procurement workflow (POs, GRNs, supplier invoicing)
- Customer CRM (loyalty points, wallet balance, purchase history)
- Role-based access control (Admin, Manager, Cashier)
- Shopify integration (bi-directional stock sync, order pull, webhooks)
- Reports, expenses, attendance, shift management
- Feature flags for safe rollout of optional features

---

## 2. TECH STACK

| Layer | Technology | Version |
|---|---|---|
| Backend runtime | Node.js | Latest LTS |
| Backend framework | Express.js | v5.2.1 |
| Database | SQLite3 (file-based) | — |
| Frontend framework | React | 19.2.0 |
| Frontend build tool | Vite | 7.3.1 |
| CSS framework | Tailwind CSS | v4.2.0 |
| Icons | Lucide React | v0.575.0 |
| Charts | Recharts | v3.7.0 |
| Routing | React Router | v7.13.0 |

**Tailwind convention:** Always use `bg-linear-to-br` NOT `bg-gradient-to-br` (linter enforced).

---

## 3. STARTUP & ENVIRONMENT

- **Startup:** Run `start-pos.bat` from root directory
  - Backend: `npm start` → `node index.js` on port **5000**
  - Frontend: `npm run dev` → Vite dev server on port **5173**
- **Kill stuck processes:** `taskkill /F /IM node.exe`
- **DB file:** `backend/oneshop.db` (SQLite, local file)
- **Uploads:** `backend/uploads/products/` (product images)
- **Migrations:** Run via `backend/run_migrations.js`, sequential files `migrate.js` → `migrate45.js`
- **Pre-flight check:** `npm run preflight` in `backend/`
- **E2E tests:** `npm run test:e2e-full` in `backend/` (69 tests)

---

## 4. FILE TREE

```
oneshoppos/
├── START.bat / start-pos.bat            # Startup scripts
├── User_Manual.md                       # End-user manual
├── health_check.js                      # Health endpoint tester
├── backend/
│   ├── index.js                         # MAIN API — 7,137 lines, 193 endpoints
│   ├── db.js                            # SQLite connection + base schema
│   ├── run_migrations.js                # Migration runner
│   ├── migrate.js → migrate45.js        # 45 migration files (history below)
│   ├── preflight.js                     # Pre-launch validation
│   ├── e2e_test.js                      # Basic e2e tests
│   ├── e2e_full_test.js                 # Full 69-test suite
│   ├── shopify_utils_test.js            # Shopify util tests
│   ├── shopify_mock_integration_test.js # Integration scenario tests
│   ├── shopify/
│   │   ├── client.js                    # GraphQL Shopify client
│   │   └── utils.js                     # Retry, signatures, webhooks
│   ├── uploads/
│   │   └── products/                    # Uploaded product images
│   ├── package.json
│   └── oneshop.db                       # SQLite database (live data)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # Route definitions (all routes)
│   │   ├── main.jsx                     # Entry point, AuthProvider wrap
│   │   ├── auth/
│   │   │   ├── AuthProvider.jsx         # Auth context provider
│   │   │   └── authStore.js             # localStorage session persistence
│   │   ├── components/
│   │   │   ├── AppLayout.jsx            # Sidebar navigation + outlet
│   │   │   ├── RequireAuth.jsx          # Auth guard HOC
│   │   │   └── RequirePerm.jsx          # Permission guard HOC
│   │   └── pages/
│   │       ├── Dashboard.jsx
│   │       ├── POS.jsx                  # Standalone (no sidebar)
│   │       ├── Inventory.jsx
│   │       ├── Customers.jsx
│   │       ├── Categories.jsx
│   │       ├── Taxes.jsx
│   │       ├── Brands.jsx
│   │       ├── Suppliers.jsx
│   │       ├── PurchaseOrders.jsx
│   │       ├── SupplierPayables.jsx
│   │       ├── SalesHistory.jsx
│   │       ├── StockAdjustments.jsx
│   │       ├── Transfers.jsx
│   │       ├── Returns.jsx
│   │       ├── Reports.jsx              # 18 tabbed report views
│   │       ├── Attendance.jsx
│   │       ├── Employees.jsx
│   │       ├── Outlets.jsx
│   │       ├── Administrator.jsx        # Role & permission management
│   │       ├── ActionHistory.jsx        # Audit log
│   │       ├── BackupRestore.jsx
│   │       ├── ShopifyIntegration.jsx
│   │       ├── Approvals.jsx
│   │       ├── AttributeSets.jsx
│   │       ├── BarcodeTemplates.jsx
│   │       ├── ReceiptTemplates.jsx
│   │       ├── Promotions.jsx
│   │       ├── Expenses.jsx
│   │       ├── Orders.jsx
│   │       ├── CashManagement.jsx
│   │       ├── InvoiceView.jsx
│   │       ├── PlaceholderPage.jsx      # Not yet implemented stubs
│   │       ├── AccessDenied.jsx
│   │       └── Login.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── eslint.config.js
│   └── package.json
└── docs/
    ├── ARCHITECTURE.md
    ├── API_REFERENCE.md
    ├── STATUS.md
    ├── TESTING.md
    ├── SHOPIFY_*.md                     # Multiple Shopify guides
    ├── README.md
    └── archive/                         # Outdated docs
```

---

## 5. DATABASE SCHEMA (All Tables)

### Core Master Data
| Table | Key Columns | Purpose |
|---|---|---|
| `categories` | id, name, description | Product classification |
| `taxes` | id, name, rate, is_default | Tax rates |
| `brands` | id, name (UNIQUE), description | Brand master |
| `suppliers` | id, name, contact_person, phone, email, address | Vendor master |
| `outlets` | id, name, address, phone | Store locations |
| `employees` | id, name, role, pin_code (UNIQUE) | User accounts |
| `roles` | id, name | Role definitions |
| `role_permissions` | id, role_id, permission | RBAC mapping |

### Products
| Table | Key Columns | Purpose |
|---|---|---|
| `products` | id, barcode (UNIQUE), name, price, cost_price, gst, stock, category_id, tax_id, supplier_id, brand_id, description_html, product_type, vendor, tags, status, min_qty, max_qty, unit, compare_at_price, has_variants | Master product catalog |
| `product_variants` | id, product_id, sku, variant_name, variant_value, price, cost_price | Product variants |
| `attribute_sets` | id, name, attributes (JSON), entity_type | Custom product attributes |

### Inventory
| Table | Key Columns | Purpose |
|---|---|---|
| `outlet_stock` | id, product_id, outlet_id, quantity — UNIQUE(product_id, outlet_id) | Per-location stock levels |
| `stock_adjustments` | id, product_id, outlet_id, employee_id, quantity_change, reason, timestamp | Manual adjustments |
| `inventory_transfers` | id, from_outlet_id, to_outlet_id, product_id, quantity, status, created_at, transferred_at | Inter-outlet transfers |
| `inventory_reconciliation` | id, product_id, outlet_id, system_qty, actual_qty, discrepancy, status, resolution_status, resolution_note, resolved_by, resolved_at | Stock variance tracking |

### Sales & Transactions
| Table | Key Columns | Purpose |
|---|---|---|
| `sales` | id, total_amount, payment_method, timestamp, outlet_id, discount_amount, customer_id | Transaction records |
| `sale_items` | id, sale_id, product_id, quantity, price_at_sale, cost_price_at_sale, variant_id | Line items |
| `sale_payments` | id, sale_id, payment_method, amount | Split tender |
| `parked_sales` | id, outlet_id, customer_id, items (JSON), total, discount_amount, notes, created_at | Saved (held) carts |
| `returns` | id, sale_id, product_id, quantity, reason, status, created_at | Customer returns |

### Procurement
| Table | Key Columns | Purpose |
|---|---|---|
| `purchase_orders` | id, supplier_id, status, total_cost, created_at | PO records |
| `purchase_order_items` | id, po_id, product_id, quantity, cost_price | PO line items |
| `goods_received_notes` | id, po_id, received_qty, received_at, outlet_id | GRN records |
| `supplier_invoices` | id, po_id, invoice_number, invoice_date, amount, paid_amount, status | Invoice tracking |

### Customers & CRM
| Table | Key Columns | Purpose |
|---|---|---|
| `customers` | id, name, phone, email, address, loyalty_points, wallet_balance, referred_by | Customer master |
| `customer_wallet_ledger` | id, customer_id, transaction_type, amount, balance, created_at | Wallet transaction history |

### Shifts & Operations
| Table | Key Columns | Purpose |
|---|---|---|
| `cash_shifts` | id, outlet_id, opened_by, closed_by, opening_balance, closing_balance, status, opened_at, closed_at | Shift management |
| `shift_denominations` | id, shift_id, denomination_type, quantity, amount_collected | Cash denomination tally |
| `employee_attendance` | id, employee_id, check_in_time, check_out_time, date | Time tracking |
| `expenses` | id, category_id, amount, description, created_at, outlet_id | Expense records |
| `expense_categories` | id, name, description | Expense types |

### Promotions & Marketing
| Table | Key Columns | Purpose |
|---|---|---|
| `promotions` | id, name, discount_type, discount_value, min_qty, start_date, end_date, status | Discount/promo rules |

### System & Config
| Table | Key Columns | Purpose |
|---|---|---|
| `receipt_templates` | id, name, header, body, footer, is_active | Receipt formatting |
| `barcode_templates` | id, name, format, width, height, is_active | Barcode config |
| `feature_flags` | key, enabled, description, updated_by, updated_at | Feature rollout control |
| `action_history` | id, employee_id, action_type, resource_type, resource_id, old_value, new_value, timestamp | Audit log |
| `backup_log` | id, created_at, restored_at, file_path, restored_by | Backup history |
| `invoice_sequences` | outlet_id, next_sequence | Invoice numbering per outlet |

### Shopify Integration
| Table | Key Columns | Purpose |
|---|---|---|
| `shopify_connections` | id, shop_domain, access_token, api_version, created_at, updated_at | Shopify credentials |
| `shopify_product_mappings` | id, product_id, shopify_product_id, shopify_variant_id | Product sync mapping |
| `shopify_location_mappings` | id, outlet_id, shopify_location_id | Location sync mapping |
| `web_orders` | id, shopify_order_id, customer_id, total, status, stock_applied, created_at | Shopify order records |
| `external_sync_events` | id, event_type, sync_status, created_at, updated_at, attempt_count | Outbound sync queue |

---

## 6. MIGRATION HISTORY (45 Migrations)

| Range | What Was Added |
|---|---|
| M1–M9 | Core schema: categories, taxes, products, outlets, employees, brands, outlet_stock |
| M10–M15 | Multi-outlet inventory: outlet_stock seeding, stock transfers |
| M16 | Customers table with loyalty_points |
| M17–M20 | Suppliers, purchase orders, GRN, role permissions |
| M21–M25 | Attribute sets, product variants, returns |
| M26–M30 | Promotions, supplier invoicing, cash shifts |
| M31–M35 | Expense tracking, barcode templates, receipt templates |
| M36–M40 | Backup log, action history, Shopify integration tables |
| M41–M45 | external_sync_events (retry metadata), inventory_reconciliation, Shopify mappings, web_orders, performance indexes |

**Latest Indexes Added (M44–M45):**
- `idx_products_barcode` — fast barcode POS lookup
- `idx_sale_items_sale_id` — sale detail retrieval
- `idx_outlet_stock_product_outlet` — stock queries
- `idx_inventory_reconciliation_status` — reconciliation filtering

---

## 7. API ENDPOINTS (193 Total)

### Auth (3)
- `POST /api/auth/login` — PIN-based login
- `POST /api/auth/logout` — Logout
- `GET /api/auth/me` — Current session

### Products (12)
- CRUD: `GET /api/products`, `POST`, `PUT /:id`, `DELETE /:id`
- `POST /api/products/bulk-import` — CSV import
- `GET /api/products/search` — Text search
- `GET /api/products/scan/:barcode` — Barcode lookup
- `GET /api/products/:id/variants` — Variants
- `GET /api/products/:id/stock` — Stock by outlet
- `GET /api/products/:id/media` — Images
- `POST /api/products/:id/media` — Upload image
- `DELETE /api/products/:id/media/:mediaId` — Remove image

### Sales / POS (6)
- `GET /api/sales` — List
- `POST /api/sales` — Create (full cart posting)
- `GET /api/sales/:id` — Detail
- `PUT /api/sales/:id/void` — Void (perm: void_sales)
- `GET /api/sales/:id/invoice` — Invoice view
- `GET /api/sales/:id/invoice/export` — Export (feature flag)

### Customers (8)
- CRUD: `GET /api/customers`, `POST`, `PUT /:id`, `DELETE /:id`
- `GET /api/customers/:id/sales` — Purchase history
- `PUT /api/customers/:id/points` — Loyalty points update
- `GET /api/customers/:id/wallet` — Wallet balance
- `POST /api/customers/:id/wallet/topup` — Topup wallet

### Inventory (7)
- `GET /api/adjustments`, `POST /api/adjustments`
- `GET /api/transfers`, `POST /api/transfers`
- `POST /api/transfers/:id/submit` — Submit for approval (feature flag)
- `POST /api/transfers/:id/approve` — Approve (feature flag)

### Suppliers & POs (11)
- Suppliers CRUD (4), PO CRUD (4), GRN receive (1), Submit/Approve (2, feature flagged)

### Supplier Invoicing (4, feature flagged)
- List, detail, pay, aging report

### Returns (6)
- Customer returns CRUD (3), Supplier returns CRUD (3)

### Promotions (5)
- CRUD (4) + `POST /api/promotions/quote` — Calculate discount

### Reports (18)
- `/api/reports/dashboard` — KPI cards
- `/api/reports/top-salespeople`
- `/api/reports/sales-summary` — Daily summaries
- `/api/reports/sales-detail` — Itemized
- `/api/reports/sales-stock`
- `/api/reports/inventory-dump`
- `/api/reports/category-wise`
- `/api/reports/product-spec`
- `/api/reports/on-hand`
- `/api/reports/item-wise`
- `/api/reports/product-performance`
- `/api/reports/inventory-loss`
- `/api/reports/wastage`
- `/api/reports/replenishment`
- `/api/reports/supplier-wise`
- `/api/reports/customer-details`
- `/api/reports/customer-wise`
- `/api/reports/order-wise`

### Shifts & Attendance (8)
- `GET /api/shifts`, `GET /api/shifts/active`, `POST /api/shifts/open`, `POST /api/shifts/:id/close`
- `GET /api/shifts/:id/denominations`
- `GET /api/attendance`, `POST /api/attendance/checkin`, `POST /api/attendance/:id/checkout`

### Setup (CRUD groups)
- Categories (4), Taxes (4), Outlets (4), Brands (4), Employees (5), Roles & Permissions (6)
- Attribute Sets (4), Receipt Templates (5), Barcode Templates (4)

### Parked Sales (4, perm: pos_park)
- `GET /api/parked-sales`, `GET /:id`, `POST`, `DELETE /:id`

### Expenses (5)
- CRUD (4) + `GET /api/expenses/summary`

### Action History (2)
- `GET /api/action-history`, `POST /api/action-history`

### Backup & Restore (3, feature flagged)
- Download DB, Restore DB, Backup log

### Approvals (1, feature flagged)
- `GET /api/approvals` — Pending approvals queue

### Shopify Integration (25)
- Config CRUD (3), Status/Verify (3), Webhooks (2), Locations (1), UAT Checklist (1)
- Sync Events (3), Sync Controls (4 — push inventory, pull orders, retry, process pending)
- Product mappings (5), Location mappings (2), Customer mappings (2)

### Reconciliation (6)
- List, run, resolve, request-fix (feature flagged), approve-fix (feature flagged), audit trail

### Utilities
- `GET /api/feature-flags`, `PUT /api/feature-flags/:key`
- `POST /api/uploads/product-image`
- `GET /api/variance-reasons`
- `GET /api/health`

### Orders (8)
- CRUD + status update, mark complete, bulk update, transactions, fulfillments

### GRN (2)
- `GET /api/grn`, `GET /api/grn/:id`

---

## 8. FRONTEND ROUTES

### Public (No Auth)
- `/login` — Login page
- `/access-denied` — 403 page

### Authenticated (All Roles)
- `/` → redirect to dashboard or login
- `/pos` — POS register (standalone, no AppLayout sidebar)
- `/dashboard` — Home
- `/sales-history` — Transaction list
- `/cash-management` — Shift open/close
- `/customers` — Customer CRM
- `/reports/*` — 18 report tabs
- `/returns` — Returns
- `/attribute-sets` — Product attributes
- `/attendance` — Time tracking

### Permission-Gated (manage_inventory)
- `/inventory`, `/categories`, `/taxes`, `/brands`
- `/adjustments`, `/transfers`, `/promotions`, `/expenses`
- `/barcode-templates`, `/integrations/shopify`

### Permission-Gated (manage_orders)
- `/orders`, `/suppliers`, `/purchase-orders`
- `/supplier-payables`, `/approvals`, `/returned-stock`

### Permission-Gated (manage_employees)
- `/employees`, `/outlets`, `/administrator`
- `/action-history`, `/backup-restore`, `/receipt-templates`

---

## 9. AUTHENTICATION & RBAC

### Auth Flow
1. Employee enters name + PIN at `/login`
2. `POST /api/auth/login` validates, returns `{ employee, permissions }`
3. Session stored in `localStorage` under key `authSession`
4. `AuthProvider` bootstraps session on app load
5. All API calls send `x-employee-id` header
6. `RequireAuth` HOC guards authenticated routes
7. `RequirePerm` HOC guards permission-specific routes
8. POS has manager PIN override for discount escalation

### Default Roles & Permissions
| Role | Permissions |
|---|---|
| **Administrator** | `all_access` (unrestricted) |
| **Manager** | `manage_inventory`, `manage_orders`, `view_reports`, `manage_employees`, `pos_discount`, `void_sales`, `pos_park`, `pos_void` |
| **Cashier** | `view_reports`, `pos_discount`, `pos_park` |

### Backend Permission Middleware
- `loadEmployeePerms()` reads `x-employee-id`, loads from `role_permissions`
- `requirePerm(permission)` — exact permission check
- `requireAnyPerm([perms])` — any-of check
- Returns 403 if insufficient

### Frontend Permission Helpers
- `useAuth().hasPerm(permission)` — local check from cached session
- `useAuth().authHeaders()` — returns `{ 'x-employee-id': id }`

---

## 10. FEATURE FLAGS

| Flag Key | Default | Controls |
|---|---|---|
| `backup_restore` | enabled | DB backup/restore routes |
| `e_invoicing_export` | enabled | Invoice file export |
| `supplier_payables` | enabled | Supplier invoice routes |
| `approvals` | enabled | Multi-step approval workflow |

- Backend: `requireFeature(flagKey)` middleware, returns 503 if disabled
- Frontend: fetched from `GET /api/feature-flags` on load, used to conditionally render menu items

---

## 11. SHOPIFY INTEGRATION DETAILS

### Files
- `backend/shopify/client.js` — GraphQL transport, product/inventory/location sync
- `backend/shopify/utils.js` — Retry (exponential backoff + jitter), webhook HMAC verification, idempotency keys

### Key Config
- Shop domain, access token, API version (default: `2025-10`)
- Optional AES-256-GCM encryption of access token via `SHOPIFY_SECRET_KEY` env var
- Background sync worker (disabled by `SHOPIFY_SYNC_WORKER_DISABLED=1`)

### Sync Flow
1. Products mapped in `shopify_product_mappings` (OneShop product ↔ Shopify variant GID)
2. Outlets mapped in `shopify_location_mappings` (outlet ↔ Shopify location GID)
3. Stock changes → `external_sync_events` queue → background worker processes
4. Retry schedule: 1min, 5min, 15min, 60min, 240min (+ jitter), max 5 attempts
5. Orders pulled from Shopify → `web_orders` table, stock applied

### Webhook
- `POST /api/integrations/shopify/webhooks/orders-create`
- Validates timestamp (10 min window, 5 min future skew) + SHA256 HMAC signature

---

## 12. CRITICAL BUSINESS LOGIC

### Sale Posting (`POST /api/sales`)
1. Validate cart items (barcode, qty, outlet stock availability)
2. Calculate subtotal, tax, discount, final total
3. Handle promotions (auto-apply matching rules)
4. BEGIN TRANSACTION:
   - Insert `sales` record
   - Insert `sale_items` (with cost_price for margin)
   - Insert `sale_payments` (split tender support)
   - UPDATE `outlet_stock` (reduce qty)
   - Update customer loyalty points + deduct wallet if used
5. COMMIT → return receipt + invoice number

### Stock Transfer Flow
1. Validate outlets, products, quantities
2. BEGIN TRANSACTION:
   - Create `inventory_transfers` record
   - `outlet_stock` (from -= qty, to += qty)
   - If approval enabled: set status = 'pending'
3. COMMIT
4. Approval path: manager approves → finalize; reject → rollback

### GRN Receiving (`POST /api/purchase-orders/:id/receive`)
1. Create `goods_received_notes` record
2. BEGIN TRANSACTION:
   - Insert received items
   - UPDATE `outlet_stock` (add received qty)
   - Log to `action_history`
3. COMMIT

### Inventory Reconciliation
1. Run: compare `system_qty` vs `actual_qty` per outlet
2. Create `inventory_reconciliation` records with discrepancy
3. If variance > threshold AND approval enabled: block auto-fix, require approval
4. On approval: apply resolution, log to `action_history`

### Shift Closing
1. Tally `shift_denominations`
2. Calculate variance (expected cash vs actual)
3. Record closing balance, set shift status = 'closed'
4. Lock: no further sales against closed shift

---

## 13. CODING PATTERNS & CONVENTIONS

### Backend
- **sqlite3 API:** Callback-based (NOT promises) — `db.run()`, `db.get()`, `db.all()`
- **Transactions:** Explicit `BEGIN`/`COMMIT`/`ROLLBACK` strings
- **Error response:** `res.status(N).json({ error: 'message' })`
- **Success response:** `res.json({ [resource]: data })` or `res.json({ success: true })`
- **Foreign keys:** `PRAGMA foreign_keys = ON` in `db.js`
- Soft-delete pattern for products (preserve sales history)

### Frontend
- All state via React hooks (`useState`, `useEffect`, `useCallback`, `useMemo`)
- API calls with `fetch()` + `authHeaders()` for auth
- Local state for forms, no global state manager (no Redux/Zustand)
- Pagination: 50 items/page
- Barcode input: ref-based DOM access, 300ms timeout
- CSV bulk import via client-side parsing

### Naming
- **DB tables:** singular, lowercase_underscore (e.g. `sale_items`)
- **PK:** `id`, **FK:** `*_id`
- **Components:** PascalCase
- **Functions/state:** camelCase
- **API routes:** RESTful (`GET` list, `POST` create, `PUT /:id`, `DELETE /:id`)

---

## 14. PLACEHOLDER / NOT-YET-IMPLEMENTED PAGES

These routes exist in `App.jsx` but render `PlaceholderPage.jsx`:
- `/lookup` — Product lookup
- `/custom-fields` — Custom field management
- `/partners` — Partner management
- `/shopcast` — Not yet documented

---

## 15. KNOWN LIMITATIONS & NOTES

- `backend/index.js` is a **7,137-line monolith** — all 193 routes in one file (by design for local simplicity)
- No API rate limiting implemented
- Shopify sync queue has no auto-cleanup for old events
- Mobile/small screen optimizations incomplete (designed for desktop POS terminal)
- Large catalogs (5,000+ products) use 50-item pagination to avoid memory pressure
- No real-time updates (no WebSockets) — all data via manual fetch or page reload
- SQLite is single-writer, so concurrent users must wait on write operations

---

## 16. CONSTANTS AT A GLANCE

| Constant | Value |
|---|---|
| Backend port | 5000 |
| Frontend port | 5173 |
| DB path | `backend/oneshop.db` |
| Session localStorage key | `authSession` |
| Upload directory | `backend/uploads/products` |
| API base URL (frontend) | `http://localhost:5000` |
| Items per page | 50 |
| Barcode scan timeout | 300ms |
| Shopify API version | 2025-10 |
| Max Shopify retry attempts | 5 |
| Retry schedule | 1min, 5min, 15min, 60min, 240min |
