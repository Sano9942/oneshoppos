# OneShopPOS — Master Build Log

All completed and pending work tracked here. Updated after every build session.

---

## Phase 1: Core Infrastructure ✅ COMPLETE

### 1. Outlets Management

- [x] `migrate6.js` — `outlets` table (`id`, `name`, `address`, `phone`)
- [x] Backend CRUD API `/api/outlets`
- [x] Frontend UI `Outlets.jsx`
- [x] Sidebar nav link added

### 2. Employee Management (Cashiers)

- [x] `migrate6.js` — `employees` table (`id`, `name`, `role`, `pin_code`)
- [x] Backend CRUD API `/api/employees` + PIN validation endpoint
- [x] Frontend UI `Employees.jsx`
- [x] Sidebar nav link added
- [x] PIN login overlay on POS terminal

### 3. Brands Management

- [x] `migrate6.js` — `brands` table (`id`, `name`)
- [x] Products table updated with `brand_id` FK
- [x] Backend CRUD API `/api/brands`
- [x] Frontend UI `Brands.jsx`
- [x] `Inventory.jsx` updated to select Brand during product creation

---

## Phase 2: Advanced Products & Stock Control ✅ COMPLETE

### 4. Multi-Outlet Inventory Architecture

- [x] `migrate10.js` — `outlet_stock` table (`product_id`, `outlet_id`, `quantity`)
- [x] Existing `products.stock` migrated into `outlet_stock`
- [x] `/api/sales` deducts stock from the correct outlet on checkout
- [x] `/api/products/scan/:barcode?outlet_id=` returns outlet-specific stock
- [x] Inventory UI shows stock per outlet

### 5. Stock Adjustments

- [x] `migrate11.js` — `stock_adjustments` table (reason, qty_change, type)
- [x] Backend API `/api/adjustments`
- [x] Frontend UI `StockAdjustments.jsx`
- [x] Sidebar nav link added

### 6. Inventory Transfers

- [x] `migrate12.js` — `inventory_transfers` table
- [x] Backend API `/api/transfers`
- [x] Frontend UI `Transfers.jsx`
- [x] Sidebar nav link added

---

## Phase 3: Advanced Register Operations ✅ COMPLETE

### 7. Cash Management & Shifts

- [x] `migrate13.js` — `cash_shifts` table (opening_float, closing_cash, variance, status)
- [x] Backend API `/api/shifts` (open, close, active shift query)
- [x] Frontend UI `CashManagement.jsx` (open/close shift, variance report)
- [x] POS terminal shows warning banner when no active shift
- [x] Dashboard shows active shift status banner

### 8. Sales History

- [x] Backend API `/api/sales` with pagination, date filters, search
- [x] Backend API `/api/sales/:id` (detail + void)
- [x] Frontend UI `SalesHistory.jsx` (receipt detail panel, void functionality)
- [x] Sidebar nav link added

### 9. Customer Management

- [x] `migrate16.js` — `customers` table (`id`, `name`, `mobile`, `email`, `address`, `loyalty_points`)
- [x] Backend CRUD API `/api/customers`
- [x] Frontend UI `Customers.jsx` (create, edit, order history per customer)
- [x] POS checkout updated with customer selector (search by name/mobile)
- [x] Sidebar nav link added

### 10. Suppliers & Purchase Orders

- [x] `migrate14.js` — `suppliers` table
- [x] `migrate15.js` — `purchase_orders` + `purchase_order_items` tables
- [x] Backend CRUD APIs `/api/suppliers`, `/api/purchase-orders`
- [x] Frontend UIs `Suppliers.jsx`, `PurchaseOrders.jsx`
- [x] Sidebar nav links added

---

## Phase 4: Reporting Engine ✅ COMPLETE

### 11. Reports Dashboard (20 tabs across 5 groups)

- [x] **Sales group:** Overview, Sales Summary, Sales Detail, Order Wise, Sales & Stock, Category Wise
- [x] **Customers group:** Customer Details, Customer Wise
- [x] **Inventory group:** Inventory Dump, On Hand, Item Wise, Product Performance, Product Specification, Replenishment
- [x] **Operations group:** Inventory Loss, Wastage, Product Movement, STR Report
- [x] **Procurement group:** Supplier Wise, Purchase Orders, GRN Report
- [x] **HR group:** Attendance Report
- [x] All tabs have date range filters; data fetches lazily on tab select

---

## Phase 5: Dashboard & Advanced Features ✅ COMPLETE

### 12. Real Dashboard (Home Screen)

- [x] Replaced placeholder with full KPI home screen
- [x] KPI cards: Revenue Today, Net Profit, Sales Count, Inventory Value
- [x] Active shift status banner (green = open, amber = no shift)
- [x] Top Selling Products panel (all-time)
- [x] Low Stock Alerts panel (≤ 10 units)
- [x] Quick action buttons: Open Register, View Reports

### 13. Employee Attendance

- [x] `migrate17.js` — `employee_attendance` table (employee_id FK, outlet_id FK, check_in, check_out, hours, status)
- [x] Backend APIs: `GET /api/attendance`, `POST /api/attendance/checkin`, `POST /api/attendance/:id/checkout`
- [x] POS terminal: auto clock-in after PIN login, "Clocked In" badge in top bar, auto clock-out on Lock Register
- [x] Frontend UI `Attendance.jsx` — filterable table by date range and employee, total hours footer
- [x] Route `/attendance` added; Sidebar nav link added
- [x] Attendance tab added to Reports (HR group)

### 14. Discount System

- [x] `migrate18.js` — `discount_amount` + `discount_type` columns added to `sales` table
- [x] `/api/sales` updated — accepts `discount_amount` + `discount_type`, calculates discounted total server-side
- [x] POS checkout modal: Fixed ($) / Percent (%) toggle with live preview of new total
- [x] Order Summary panel shows discount row when active
- [x] `SalesHistory.jsx` — Discount column added (shows `—` when no discount)
- [x] Reports Order Wise tab — Discount column added

### 15. GRN — Goods Received Notes

- [x] `migrate19.js` — `goods_received_notes` table (grn_number, po_id FK, outlet_id FK, received_by FK, received_at, notes) + `grn_items` table (grn_id, product_id, qty_ordered, qty_received, cost_price)
- [x] `POST /api/purchase-orders/:id/receive` updated — now creates a GRN record with per-item quantities and updates outlet_stock
- [x] Backend APIs: `GET /api/grn` (list with date filters), `GET /api/grn/:id` (detail with items)
- [x] `PurchaseOrders.jsx` — "Receive Items" button opens GRN modal: select outlet, employee, editable qty_received per item, notes
- [x] GRN Report tab added to Reports (Procurement group)

---

## Phase 6: Returns & Refunds ✅ COMPLETE

### 16. Returns Management

- [x] `migrate20.js` — `returns` and `return_items` tables
- [x] Backend APIs: `POST /api/returns`, `GET /api/returns`, `GET /api/returns/:id`
- [x] Restock: Auto-increments `outlet_stock` upon successful return
- [x] Cash Management Integration: Cash refunds auto-deduct from `expected_cash` during shift close
- [x] Frontend UI `Returns.jsx` — Dedicated tab to process and view standalone returns
- [x] Sales History Integration — "Return" button on past sales auto-fills the return modal
- [x] Sidebar nav link added
- [x] Full Returns API Health Check passed
- [x] **Bug Fix:** Moved POS discount inputs out of modal to the main Summary panel.
- [x] **Bug Fix:** Added Quantity (`+/-`) buttons to POS cart, enabling negative quantities (Returns/Exchanges) inside POS.

---

## Taxes & Categories (Setup) ✅ COMPLETE

- [x] `migrate7.js` — `taxes` table; Backend + `Taxes.jsx` UI
- [x] `migrate8.js` — `categories` table; Backend + `Categories.jsx` UI
- [x] Products linked to tax and category during create/edit

---

## Database Migration Sequence

```
migrate.js      → products, sales, sale_items (initial schema)
migrate2.js     → add cost_price to products
migrate3.js     → add barcode index
migrate4.js     → categories
migrate5.js     → taxes, add tax_id to products
migrate6.js     → outlets, employees, brands; add brand_id to products
migrate7.js     → add effective_tax_rate support
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
```

---

## How to Start the App

Double-click **`START.bat`** in the root folder. It starts both servers and opens the browser automatically.

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`
