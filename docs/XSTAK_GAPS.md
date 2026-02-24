# Xstak ShopDesk — Feature Gap Analysis & Implementation Roadmap

**Research Date: 2026-02-24**
**Source: Live app at https://xap.xstak.com/shopdesk/dashboard**

This document captures everything observed in the live Xstak ShopDesk app and identifies what we need to build next.

---

## Xstak Full Sidebar Navigation (Exact Order)

```
Dashboard
Register
  ├── Sell (POS Terminal)
  ├── Sales History
  └── Cash Management
Orders
Categories
Suppliers
Taxes
Products
  ├── Product Listing
  ├── LookUp
  ├── Custom Fields/DropDowns
  └── Attribute Sets
Customers
Stock Control
  ├── Purchase Orders
  ├── Inventory Transfer
  ├── Stock Adjustments
  └── Returned Stock
Reports
  └── (many sub-reports)
Setup
  ├── Outlets
  ├── Employees
  ├── Barcode Templates
  ├── Receipt Templates
  ├── Partners
  ├── Brands
  └── Shopcast
Administrator
Action History
```

---

## Screenshots Captured

All screenshots saved in the brain folder:

- `xstak_dashboard_full` — Dashboard with KPI cards and sidebar
- `xstak_pos_sell` — POS register terminal
- `xstak_pos_more_actions` — POS More Actions dropdown
- `xstak_product_listing` — Products table with all columns
- `xstak_customers` — Customers table with all fields
- `xstak_purchase_orders` — Stock Control with 4 tabs visible
- `xstak_inventory_transfers` — Inventory Transfer tab
- `xstak_stock_adjustments_tab` — Stock Adjustment tab
- `xstak_returned_stock_tab` — Returned Stock tab
- `xstak_sales_summary_report` — Reports section
- `xstak_inventory_dump_report` — Inventory Dump report
- `xstak_administrator_screen` — Administrator (approval workflows)
- `xstak_action_history_screen` — Action History audit log
- `xstak_employees_setup` — Employees setup page
- `xstak_receipt_templates_setup` — Receipt Templates designer
- `xstak_cash_management_screen` — Cash Management page

---

## Module-by-Module Feature Comparison

### 1. Dashboard

| Feature                        | Xstak Has                                                    | We Have         | Gap                               |
| ------------------------------ | ------------------------------------------------------------ | --------------- | --------------------------------- |
| All Sales Gross Profit KPI     | ✅                                                           | ✅ (Net Profit) | Minor — label differs             |
| All Sales Total KPI            | ✅                                                           | ✅              | ✅ Match                          |
| **All Parked Sales Total KPI** | ✅                                                           | ❌              | **Gap — we have no parked sales** |
| **Top Sales Peoples table**    | ✅ (Name, Revenue, Products Sold, Transactions, Basket Size) | ❌              | **Gap**                           |
| Sales trend charts             | ✅                                                           | ❌              | Gap — we have no charts           |
| Low Stock alerts               | ❌ shown                                                     | ✅              | We have extra                     |
| Top Selling Products           | ❌ shown                                                     | ✅              | We have extra                     |
| Active Shift banner            | ❌ shown                                                     | ✅              | We have extra                     |

---

### 2. POS / Register — Sell Screen

| Feature                        | Xstak Has                                                         | We Have | Gap                                           |
| ------------------------------ | ----------------------------------------------------------------- | ------- | --------------------------------------------- |
| Product search by name/barcode | ✅                                                                | ✅      | ✅ Match                                      |
| Cart with qty, price, subtotal | ✅                                                                | ✅      | ✅ Match                                      |
| Customer search & select       | ✅                                                                | ✅      | ✅ Match                                      |
| Discount (% and Fixed)         | ✅ (both shown simultaneously: Discount % + Discount Amount rows) | ✅      | ✅ Match                                      |
| GST line on checkout           | ✅                                                                | ✅      | ✅ Match                                      |
| Tax Exclusive/Inclusive toggle | ✅ (toggle in POS header)                                         | ❌      | **Gap — we don't have a per-sale tax toggle** |
| **Park Sale**                  | ✅ "Park Sale" button saves cart for later                        | ❌      | **HIGH PRIORITY GAP**                         |
| **Previously Parked Sales**    | ✅ "Previously Parked Sales" button to retrieve                   | ❌      | **HIGH PRIORITY GAP**                         |
| **Add Note**                   | ✅ "Add Note" button on the order                                 | ❌      | **Gap — no order-level notes**                |
| Date picker on POS             | ✅ (date shown in header of sell screen)                          | ❌      | Minor                                         |
| Multi-tender payment           | ✅                                                                | ✅      | ✅ Match                                      |
| Thermal receipt printing       | ✅                                                                | ✅      | ✅ Match                                      |
| Lock Register / PIN login      | ✅                                                                | ✅      | ✅ Match                                      |

---

### 3. Products / Inventory

| Feature                             | Xstak Has                                   | We Have                    | Gap                                                          |
| ----------------------------------- | ------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| Product Image                       | ✅ (column in table)                        | ❌                         | Gap                                                          |
| Product Name                        | ✅                                          | ✅                         | ✅                                                           |
| Category                            | ✅                                          | ✅                         | ✅                                                           |
| QTY (stock)                         | ✅                                          | ✅                         | ✅                                                           |
| **Min QTY**                         | ✅                                          | ❌                         | **Gap — reorder point field**                                |
| **Max QTY**                         | ✅                                          | ❌                         | **Gap — max stock level field**                              |
| **Unit** (unit of measure)          | ✅                                          | ❌                         | **Gap — e.g. piece, kg, litre**                              |
| **Variants**                        | ✅ (column shown)                           | ❌                         | **Gap — existing `product_variants` table exists but no UI** |
| Barcode                             | ✅                                          | ✅                         | ✅                                                           |
| Ex. Tax Retail Price                | ✅                                          | ✅ (we store & show price) | ✅                                                           |
| Ex. Tax Selling Price               | ✅ (separate retail vs selling price)       | ❌                         | **Gap — we have one price field**                            |
| **Export CSV**                      | ✅                                          | ❌                         | Gap                                                          |
| **Download Catalogue**              | ✅                                          | ❌                         | Gap                                                          |
| **Discount (bulk)**                 | ✅ "Discount" button for bulk pricing rules | ❌                         | Gap                                                          |
| **Bulk Upload**                     | ✅ CSV import for products                  | ❌                         | **HIGH PRIORITY GAP**                                        |
| **Bulk Barcode Print**              | ✅                                          | ❌                         | Gap                                                          |
| **Bulk Tax Update**                 | ✅                                          | ❌                         | Gap                                                          |
| **LookUp** (advanced search/filter) | ✅                                          | ❌                         | Gap                                                          |
| **Custom Fields/DropDowns**         | ✅                                          | ❌                         | Low priority                                                 |
| **Attribute Sets**                  | ✅ (size, color for variants)               | ❌                         | Gap — needed for clothing                                    |

---

### 4. Customers

| Feature                              | Xstak Has    | We Have | Gap                                         |
| ------------------------------------ | ------------ | ------- | ------------------------------------------- |
| Name                                 | ✅           | ✅      | ✅                                          |
| Phone                                | ✅           | ✅      | ✅                                          |
| Email                                | ✅           | ✅      | ✅                                          |
| **Age**                              | ✅           | ❌      | Gap                                         |
| **Balance** (customer credit/wallet) | ✅           | ❌      | **Gap — no customer wallet/credit balance** |
| Address                              | ✅           | ✅      | ✅                                          |
| **CNIC** (national ID)               | ✅           | ❌      | Gap — relevant for Pakistani market         |
| **Occupation**                       | ✅           | ❌      | Gap                                         |
| Loyalty Points                       | ✅ (implied) | ✅      | ✅                                          |
| Export CSV                           | ✅           | ❌      | Gap                                         |
| Order history per customer           | ✅           | ✅      | ✅                                          |

---

### 5. Stock Control

> **Key structural note:** In Xstak, Stock Control is a SINGLE page with 4 tabs:
> Purchase Orders | Inventory Transfers | Stock Adjustment | Returned Stock
>
> We have these as 4 separate sidebar items. Xstak's approach is cleaner.

| Feature                             | Xstak Has               | We Have            | Gap                                                    |
| ----------------------------------- | ----------------------- | ------------------ | ------------------------------------------------------ |
| Purchase Orders tab                 | ✅                      | ✅                 | ✅                                                     |
| **PO Due Date field**               | ✅ (column: "Due date") | ❌                 | **Gap — we have no due date on POs**                   |
| **PO GRN Date field**               | ✅ (column: "GRN date") | ✅ (via GRN table) | Partial match                                          |
| Supplier on PO                      | ✅                      | ✅                 | ✅                                                     |
| Status on PO                        | ✅                      | ✅                 | ✅                                                     |
| Inventory Transfers tab             | ✅                      | ✅                 | ✅                                                     |
| Stock Adjustments tab               | ✅                      | ✅                 | ✅                                                     |
| Returned Stock (RMA) tab            | ✅                      | ✅                 | ✅                                                     |
| Export CSV (POs)                    | ✅                      | ❌                 | Gap                                                    |
| **Administrator Approval for POs**  | ✅                      | ❌                 | **Gap — manager must approve POs before they're live** |
| **Administrator Approval for STRs** | ✅                      | ❌                 | **Gap — manager must approve transfers**               |

---

### 6. Reports

Both apps have ~20 reports. Full parity.

| Xstak Report        | We Have |
| ------------------- | ------- |
| Sales Summary       | ✅      |
| Sales Detail        | ✅      |
| Sale and Stock      | ✅      |
| Category-wise       | ✅      |
| Order-wise          | ✅      |
| Inventory Dump      | ✅      |
| On Hand Inventory   | ✅      |
| Inventory Loss      | ✅      |
| Product Movement    | ✅      |
| Product Performance | ✅      |
| Employee Attendance | ✅      |
| Customer Details    | ✅      |
| Customer Wise       | ✅      |
| Supplier Wise       | ✅      |
| Replenishment       | ✅      |
| Item Wise           | ✅      |
| Wastage             | ✅      |
| GRN Report          | ✅      |
| STR Report          | ✅      |

---

### 7. Setup

| Feature               | Xstak Has                            | We Have | Gap                                             |
| --------------------- | ------------------------------------ | ------- | ----------------------------------------------- |
| Outlets               | ✅                                   | ✅      | ✅                                              |
| Employees             | ✅                                   | ✅      | ✅                                              |
| **Barcode Templates** | ✅                                   | ❌      | **Gap — print shelf labels with custom layout** |
| **Receipt Templates** | ✅ designer UI                       | ❌      | **Gap — we hardcode the receipt HTML**          |
| **Partners**          | ✅ (delivery/3rd party integrations) | ❌      | Low priority                                    |
| **Shopcast**          | ✅ (internal messaging/broadcast)    | ❌      | Low priority                                    |
| Brands                | ✅                                   | ✅      | ✅                                              |

---

### 8. Administrator (Approval Workflow)

| Feature               | Xstak Has                           | We Have | Gap     |
| --------------------- | ----------------------------------- | ------- | ------- |
| **PO Approval flow**  | ✅ Manager approves Purchase Orders | ❌      | **Gap** |
| **STR Approval flow** | ✅ Manager approves stock transfers | ❌      | **Gap** |
| Role management       | ✅                                  | ✅      | ✅      |

---

## Prioritized Implementation Backlog

### 🔴 HIGH PRIORITY (Core business value)

| #   | Feature                            | Module    | Effort                                               |
| --- | ---------------------------------- | --------- | ---------------------------------------------------- |
| 1   | **Park Sale / Parked Sales**       | POS       | Medium — save cart to DB, retrieve list              |
| 2   | **Order Notes**                    | POS       | Low — add `notes` column to sales, show in receipt   |
| 3   | **Product Variants UI**            | Products  | High — `product_variants` table exists, need full UI |
| 4   | **Min QTY / Max QTY on Products**  | Products  | Low — 2 new DB columns, show in table                |
| 5   | **Unit of Measure**                | Products  | Low — 1 new DB column (pcs, kg, litre)               |
| 6   | **Bulk CSV Upload for Products**   | Products  | Medium — parse CSV, validate, insert                 |
| 7   | **Customer Wallet / Balance**      | Customers | Medium — credit/debit system per customer            |
| 8   | **CNIC + Occupation on Customers** | Customers | Low — 2 new DB columns                               |

### 🟡 MEDIUM PRIORITY (Quality improvements)

| #   | Feature                                    | Effort                                                       |
| --- | ------------------------------------------ | ------------------------------------------------------------ |
| 9   | **PO Due Date**                            | Low — 1 column on purchase_orders                            |
| 10  | **PO / STR Approval Workflow**             | Medium — status machine: Draft → Pending Approval → Approved |
| 11  | **Export CSV** on Products, Customers, POs | Medium — CSV generation per page                             |
| 12  | **Tax Exclusive/Inclusive toggle in POS**  | Low — already computed, just need UI toggle                  |
| 13  | **Top Sales Peoples widget on Dashboard**  | Low — SQL query by employee                                  |
| 14  | **Sales trend chart on Dashboard**         | Medium — need a charting library                             |
| 15  | **Separate Retail Price vs Selling Price** | Medium — DB schema change on products                        |

### 🟢 LOW PRIORITY (Nice to have)

| #   | Feature                         | Effort |
| --- | ------------------------------- | ------ |
| 16  | Receipt Template designer       | High   |
| 17  | Barcode label template designer | High   |
| 18  | Product Image upload            | Medium |
| 19  | Bulk Barcode Print              | Medium |
| 20  | Bulk Tax Update                 | Low    |
| 21  | Customer Age field              | Low    |
| 22  | Attribute Sets (size/color)     | High   |
| 23  | Custom Fields/DropDowns         | High   |

---

## Quick Wins (Can Build This Session)

These are small gaps, high value, low effort — perfect to tackle immediately:

1. ✅ **Order Notes** — add `notes` TEXT column to `sales`, show in POS checkout and receipt
2. ✅ **Min QTY / Max QTY on Products** — 2 columns, used for Replenishment report threshold
3. ✅ **Unit of Measure** — 1 column, shown in product table and POS cart
4. ✅ **PO Due Date** — 1 column on `purchase_orders`
5. ✅ **CNIC + Occupation on Customers** — 2 columns
6. ✅ **Top Sales Peoples widget** — Dashboard query grouped by employee_id

## The Big Feature: Park Sale

This is the most impactful missing feature in our POS. In Xstak:

- Cashier clicks "Park Sale" → current cart is saved with a reference
- Cart is cleared so cashier can serve next customer
- "Previously Parked Sales" button shows a list of all saved carts
- Cashier clicks a parked sale to resume it

**DB needed:** `parked_sales` (id, employee_id, outlet_id, notes, created_at) + `parked_sale_items` (id, parked_sale_id, product_id, quantity, price)
**APIs needed:** POST /api/parked-sales, GET /api/parked-sales, DELETE /api/parked-sales/:id
**Frontend:** "Park Sale" button in POS → saves and clears. "Parked Sales" button → shows list modal to resume.
