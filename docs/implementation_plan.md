# OneShopPOS — Implementation Reference

This document records the technical architecture, API contract, and database schema as actually built. It reflects the real system, not the original plan.

---

## Database Schema (SQLite — 19 Migrations)

### Core Tables

**products**
- id, barcode (UNIQUE + indexed), name, price, cost_price, stock (legacy), category_id FK, brand_id FK, tax_id FK, effective_tax_rate

**sales**
- id, total_amount, payment_method, timestamp, outlet_id FK, employee_id FK, customer_id FK, voided (0/1), void_reason, discount_amount, discount_type

**sale_items**
- id, sale_id FK, product_id FK, quantity, price_at_sale, cost_price_at_sale

**sale_payments** (multi-tender)
- id, sale_id FK, payment_method, amount

### Stock Control

**outlet_stock**
- product_id FK, outlet_id FK, quantity — UNIQUE(product_id, outlet_id)

**stock_adjustments**
- id, product_id FK, outlet_id FK, adjustment_type, quantity_change, reason, adjusted_at

**inventory_transfers**
- id, from_outlet_id FK, to_outlet_id FK, product_id FK, quantity, transferred_at, notes

### Setup / Infrastructure

**outlets** — id, name, address, phone
**employees** — id, name, role, pin_code
**brands** — id, name
**categories** — id, name, description
**taxes** — id, name, rate, is_default

### Customer & Suppliers

**customers** — id, name, mobile, email, address, loyalty_points, created_at
**suppliers** — id, name, contact_person, phone, email, address

### Purchasing

**purchase_orders** — id, supplier_id FK, status (Draft/Received), total_cost, created_at
**purchase_order_items** — id, po_id FK, product_id FK, quantity, cost_price

**goods_received_notes** — id, grn_number (UNIQUE), po_id FK, outlet_id FK, received_by FK employees, received_at, notes
**grn_items** — id, grn_id FK, product_id FK, qty_ordered, qty_received, cost_price

### Register Operations

**cash_shifts** — id, outlet_id FK, employee_id FK, status (open/closed), opening_float, closing_cash, expected_cash, variance, opened_at, closed_at, notes

### HR

**employee_attendance** — id, employee_id FK, outlet_id FK, check_in DATETIME, check_out DATETIME, hours REAL, status (present/absent/late), comment

---

## API Endpoint Reference

### Products
- GET /api/products — paginated list with search
- GET /api/products/scan/:barcode?outlet_id= — POS barcode lookup
- POST /api/products — create
- PUT /api/products/:id — update
- DELETE /api/products/:id — delete

### Sales
- POST /api/sales — checkout: creates sale + sale_items + sale_payments + deducts outlet_stock. Accepts: cartItems, payments, outlet_id, employee_id, customer_id, discount_amount, discount_type
- GET /api/sales — paginated history with date/search filters, returns discount_amount
- GET /api/sales/:id — detail with items and payments
- POST /api/sales/:id/void — void a sale

### Attendance
- GET /api/attendance?date_from&date_to&employee_id — list records
- POST /api/attendance/checkin — clock in (employee_id, outlet_id)
- POST /api/attendance/:id/checkout — clock out, auto-calculates hours

### Outlets / Employees / Brands / Categories / Taxes / Suppliers / Customers
- Standard GET (list) / POST (create) / PUT :id (update) / DELETE :id per resource

### Cash Shifts
- GET /api/shifts?outlet_id — list shifts
- GET /api/shifts/active?outlet_id — get current open shift
- POST /api/shifts/open — open a shift
- POST /api/shifts/:id/close — close a shift with closing_cash

### Purchase Orders
- GET /api/purchase-orders — list
- GET /api/purchase-orders/:id — detail with items
- POST /api/purchase-orders — create with items
- POST /api/purchase-orders/:id/receive — receive PO, creates GRN record, updates outlet_stock
- DELETE /api/purchase-orders/:id — delete (Draft only)

### GRN
- GET /api/grn?date_from&date_to — list all GRNs
- GET /api/grn/:id — detail with items

### Reports
- GET /api/reports/dashboard — KPIs for home screen
- GET /api/reports/sales-summary — per-sale headers
- GET /api/reports/sales-detail — line items per sale
- GET /api/reports/sales-stock — sales vs stock comparison
- GET /api/reports/inventory-dump — full inventory snapshot
- GET /api/reports/category-wise — revenue by category
- GET /api/reports/product-spec — product details
- GET /api/reports/on-hand — current stock levels
- GET /api/reports/item-wise — units sold + revenue + profit per product
- GET /api/reports/product-performance — margin analysis
- GET /api/reports/inventory-loss — write-off history
- GET /api/reports/wastage — wastage totals
- GET /api/reports/replenishment — low stock reorder suggestions
- GET /api/reports/supplier-wise — spend per supplier
- GET /api/reports/order-wise — per-order with discount column
- GET /api/transfers — for product movement and STR reports

---

## Frontend Page Map

| Route | File | Description |
|---|---|---|
| / | Dashboard.jsx | KPI home screen |
| /pos | POS.jsx | Register terminal (full screen) |
| /inventory | Inventory.jsx | Product management |
| /adjustments | StockAdjustments.jsx | Stock write-offs |
| /transfers | Transfers.jsx | Inter-outlet transfers |
| /sales-history | SalesHistory.jsx | Past sales + void |
| /cash-management | CashManagement.jsx | Shift management |
| /customers | Customers.jsx | CRM |
| /attendance | Attendance.jsx | Clock-in/out log |
| /suppliers | Suppliers.jsx | Supplier CRUD |
| /purchase-orders | PurchaseOrders.jsx | PO create + GRN receive |
| /reports | Reports.jsx | 20-tab reporting engine |
| /outlets | Outlets.jsx | Outlet setup |
| /employees | Employees.jsx | Employee setup |
| /brands | Brands.jsx | Brand setup |
| /categories | Categories.jsx | Category setup |
| /taxes | Taxes.jsx | Tax rate setup |

---

## Key Design Decisions

1. **outlet_stock over products.stock** — Stock is tracked per outlet, not globally. The legacy `products.stock` column is unused; all stock reads/writes go to `outlet_stock`.

2. **discount stored on sales table** — Both `discount_amount` (actual $ value deducted) and `discount_type` are stored, not just the percentage, so historical reports always show the correct number regardless of future price changes.

3. **GRN as audit trail** — Receiving a PO creates a GRN record instead of directly updating stock. This gives a complete history of when goods arrived, who received them, and how many per item.

4. **Attendance auto-driven by POS** — Clock-in/out is automatic on PIN login/lock, so cashiers never have to remember to clock themselves in/out.

5. **tax-inclusive pricing** — Prices are stored inclusive of tax. Tax is reverse-calculated from the price for display on receipts and reports.
