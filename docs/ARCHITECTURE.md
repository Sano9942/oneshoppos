# OneShopPOS — Architecture & Code Map

> A technical reference to orient yourself quickly in the codebase.

---

## Project Structure

```
oneshoppos/
├── START.bat                    ← Double-click to start both servers
├── frontend/
│   ├── src/
│   │   ├── pages/               ← One file per module (POS.jsx, Inventory.jsx, etc.)
│   │   ├── components/
│   │   │   └── AppLayout.jsx    ← Sidebar nav, layout wrapper, permission guard
│   │   └── main.jsx             ← React app bootstrap
│   │   └── App.jsx              ← React router and all page routes
│   └── index.html
├── backend/
│   ├── index.js                 ← ALL API endpoints (single file, ~4700 lines)
│   ├── oneshop.db               ← SQLite database (do NOT delete)
│   ├── migrate*.js              ← Migration scripts (run once at setup)
│   ├── e2e_test.js              ← E2E + RBAC test script (node e2e_test.js)
│   ├── e2e_full_test.js         ← Full regression suite
│   ├── preflight.js             ← Schema/integrity preflight checks
│   └── api_test.js              ← Earlier edge-case API test script
└── docs/
    ├── STATUS.md                ← START HERE when resuming
    ├── task.md                  ← Phase-by-phase build log + migration sequence
    ├── TESTING.md               ← All test results
    ├── ARCHITECTURE.md          ← This file
    └── PLAN.md                  ← Original project overview + feature list
```

---

## Backend Architecture

**Single file:** `backend/index.js`

All API endpoints follow REST conventions:

```
GET    /api/<resource>         — list all
GET    /api/<resource>/:id     — get one
POST   /api/<resource>         — create
PUT    /api/<resource>/:id     — update (uses COALESCE for partial updates)
DELETE /api/<resource>/:id     — delete
```

### Key API Groups

| Prefix                                       | Module                       |
| -------------------------------------------- | ---------------------------- |
| `/api/outlets`                               | Store locations              |
| `/api/employees`                             | Staff + PIN validation       |
| `/api/roles` + `/api/roles/:id/permissions`  | RBAC roles                   |
| `/api/products`                              | Product catalog              |
| `/api/products/scan/:barcode`                | Barcode scan (outlet-aware)  |
| `/api/adjustments`                           | Stock write-offs             |
| `/api/transfers`                             | Inter-outlet stock moves     |
| `/api/sales`                                 | Checkout, history, void      |
| `/api/shifts`                                | Cash shift open/close/active |
| `/api/customers`                             | CRM                          |
| `/api/purchase-orders` + `/receive`          | PO + GRN creation            |
| `/api/grn`                                   | GRN list/detail              |
| `/api/suppliers`                             | Supplier CRUD                |
| `/api/supplier-returns`                      | RMA to suppliers             |
| `/api/returns`                               | Customer returns             |
| `/api/attendance`                            | Clock-in/out records         |
| `/api/action-history`                        | Audit log                    |
| `/api/brands` `/api/categories` `/api/taxes` | Setup tables                 |
| `/api/feature-flags`                         | Feature flag governance      |
| `/api/health`                                | Runtime health checks        |
| `/api/dashboard`                             | Aggregated KPIs              |
| `/api/reports/*`                             | 20+ reporting endpoints      |

### Database Design Principles

- **SQLite** — single file, no server required
- Multi-outlet stock via the `outlet_stock` junction table (not a column on products)
- Transactions used for: sale processing, GRN receiving, sale void, permission updates
- No cascading deletes defined — if you delete a product, orphaned `outlet_stock` rows remain
- `action_history` table is append-only (no FK constraints), used as a simple audit trail

---

## Frontend Architecture

**Framework:** React 18 + Vite 7 + Tailwind CSS v4 + Lucide React icons

### Routing

All routes defined in `frontend/src/main.jsx`. Protected routes use `AppLayout` as the parent which:

1. Fetches the current user's role permissions from `/api/roles/:id/permissions`
2. Filters sidebar nav items based on `requiredPerm` field
3. Renders the `<Outlet />` for the matched route

### State Management

- **No global state library** — each page manages its own state with `useState` / `useEffect`
- POS.jsx is the largest/most complex component (~1560 lines) — manages cart, payments, discounts, customer, employee, override modal, clock-in/out
- Data fetching pattern: `useEffect(() => { fetchXxx(); }, [])` on mount — functions defined before the effect

### Key Design Patterns

- **CRUD pages** follow: list view → modal opens for create/edit → POST or PUT → refresh list
- **POS** has a separate full-screen layout (no sidebar) with its own PIN login overlay
- **Reports** uses a tab-based lazy-fetch pattern — data only fetched when tab is selected
- **Permission guard** in `AppLayout.jsx` filters sidebar items; individual pages do not re-check

---

## Database Schema Summary

```sql
-- Setup / configuration
outlets          (id, name, address, phone)
employees        (id, name, role_id FK→roles, pin_code UNIQUE, outlet_id FK→outlets)
roles            (id, name, is_system_role)
role_permissions (role_id FK→roles, permission TEXT)
brands           (id, name UNIQUE)
categories       (id, name, description)
taxes            (id, name, rate)

-- Products & Stock
products         (id, name, barcode UNIQUE, price, cost_price, brand_id FK, category_id FK, tax_id FK)
product_variants (id, product_id FK, name, price, stock)
outlet_stock     (product_id FK, outlet_id FK, quantity) ← per-outlet stock

-- Sales
sales            (id, total, discount_amount, discount_type, outlet_id FK, employee_id FK,
                  customer_id FK, payment_method, status, void_reason, created_at)
sale_items       (id, sale_id FK, product_id FK, variant_id FK, quantity, price, effective_tax_rate)
sale_payments    (id, sale_id FK, method, amount)

-- Returns
returns          (id, sale_id FK, employee_id FK, outlet_id FK, total_refund, payment_method, reason, created_at)
return_items     (id, return_id FK, product_id FK, variant_id FK, quantity, price)
supplier_returns (id, supplier_id FK, employee_id FK, outlet_id FK, return_date, status, reason, total_value, reference_number)
supplier_return_items (id, supplier_return_id FK, product_id FK, variant_id FK, quantity, unit_price, reason)

-- Purchasing
suppliers            (id, name, contact_person, phone, email, address)
purchase_orders      (id, supplier_id FK, total_cost, status, created_at)
purchase_order_items (id, po_id FK, product_id FK, quantity, cost_price)
goods_received_notes (id, grn_number UNIQUE, po_id FK, outlet_id FK, received_by FK→employees, notes, received_at)
grn_items            (id, grn_id FK, product_id FK, qty_ordered, qty_received, cost_price)

-- Operations
stock_adjustments    (id, product_id FK, outlet_id FK, employee_id FK, quantity_change, reason, timestamp)
inventory_transfers  (id, from_outlet_id FK, to_outlet_id FK, product_id FK, employee_id FK, quantity, notes, transferred_at)
cash_shifts          (id, outlet_id FK, opened_by FK→employees, closed_by FK→employees,
                      opening_float, total_cash_sales, total_card_sales, total_returns,
                      expected_cash, actual_closing_cash, variance, status, opened_at, closed_at)

-- HR & Audit
employee_attendance  (id, employee_id FK, outlet_id FK, check_in, check_out, hours, status)
customers            (id, name, mobile UNIQUE, email, address, loyalty_points)
action_history       (id, user_name, action_type, description, timestamp)
```

---

## Migration Sequence (Run Once, Already Applied)

```
migrate.js      → products, sales, sale_items (initial schema)
migrate2.js     → add cost_price to products
migrate3.js     → add barcode index
migrate4.js     → categories
migrate5.js     → taxes, add tax_id to products
migrate6.js     → outlets, employees, brands; add brand_id to products
migrate7.js     → effective_tax_rate support
migrate8.js     → sale_payments table (multi-tender)
migrate9.js     → employee_id, outlet_id, customer_id on sales
migrate10.js    → outlet_stock table
migrate11.js    → stock_adjustments table
migrate12.js    → inventory_transfers table
migrate13.js    → cash_shifts table
migrate14.js    → suppliers table
migrate15.js    → purchase_orders + purchase_order_items
migrate16.js    → customers table
migrate17.js    → employee_attendance table
migrate18.js    → discount_amount, discount_type on sales
migrate19.js    → goods_received_notes + grn_items tables
migrate20.js    → returns + return_items tables
+ inline        → roles, role_permissions, supplier_returns, supplier_return_items,
                   action_history, product_variants (added inline in index.js startup)
```
