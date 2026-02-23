# OneShopPOS vs. Xstak — Gap Analysis & Roadmap

Original gap analysis was done against the live Xstak ShopDesk dashboard. This document tracks what was missing then, what has been built since, and what remains.

---

## Original Gap Analysis — Updated Status

### 1. Register

| Feature                                          | Was Missing | Status                                        |
| ------------------------------------------------ | ----------- | --------------------------------------------- |
| Sales History — view past transactions, reprints | Yes         | DONE — SalesHistory.jsx with void + reprint   |
| Cash Management — opening float, drawer tracking | Yes         | DONE — cash_shifts table + CashManagement.jsx |

### 2. Products

| Feature                        | Was Missing | Status                                            |
| ------------------------------ | ----------- | ------------------------------------------------- |
| LookUp (advanced search)       | Yes         | DONE — barcode scan + search filters in Inventory |
| Custom Fields / Attribute Sets | Yes         | Not built — not prioritized                       |

### 3. Stock Control

| Feature                             | Was Missing | Status                                                |
| ----------------------------------- | ----------- | ----------------------------------------------------- |
| Inventory Transfers (Outlet A to B) | Yes         | DONE — Transfers.jsx + inventory_transfers table      |
| Stock Adjustments (damage/loss)     | Yes         | DONE — StockAdjustments.jsx + stock_adjustments table |
| Returned Stock (RMAs to suppliers)  | Yes         | Not built — not prioritized                           |

### 4. Setup / Infrastructure

| Feature                     | Was Missing | Status                                                      |
| --------------------------- | ----------- | ----------------------------------------------------------- |
| Outlets (multi-location)    | Yes         | DONE — outlets table + Outlets.jsx                          |
| Employees (staff + PIN)     | Yes         | DONE — employees table + POS PIN login                      |
| Brands                      | Yes         | DONE — brands table + Brands.jsx                            |
| Barcode & Receipt Templates | Yes         | Partial — standard receipt format built, no template editor |

### 5. Reporting Suite

| Report                 | Was Missing | Status                      |
| ---------------------- | ----------- | --------------------------- |
| Sales Summary          | Yes         | DONE                        |
| Sales Detail           | Yes         | DONE                        |
| Sales & Stock          | Yes         | DONE                        |
| Inventory Dump         | Yes         | DONE                        |
| Category Wise          | Yes         | DONE                        |
| Item Wise              | Yes         | DONE                        |
| Product Specification  | Yes         | DONE                        |
| Product Performance    | Yes         | DONE                        |
| Employee Attendance    | Yes         | DONE                        |
| Order Wise             | Yes         | DONE (with Discount column) |
| Replenishment          | Yes         | DONE                        |
| On Hand Inventory      | Yes         | DONE                        |
| Customer Details       | Yes         | DONE                        |
| Supplier Wise          | Yes         | DONE                        |
| Inventory Loss         | Yes         | DONE                        |
| Product Movement       | Yes         | DONE                        |
| STR Report             | Yes         | DONE                        |
| Purchase Orders Report | Bonus       | DONE                        |
| GRN Report             | Bonus       | DONE                        |
| Attendance Report (HR) | Bonus       | DONE                        |

---

## Features Built Beyond Xstak Scope (Bonus)

These were not in the original Xstak gap analysis but were added:

- **Discount System** — Fixed $ or % discount applied at POS checkout, stored on sales, visible in reports
- **GRN (Goods Received Notes)** — Full audit trail for stock receiving with partial-receipt support
- **Employee Attendance Auto-Tracking** — POS PIN login/lock triggers clock-in/out automatically
- **Multi-Tender Payments** — Split payment between Cash + Card in a single transaction
- **Customer CRM** — Full customer profiles linked to sales and visible on checkout
- **Dashboard KPI Screen** — Real-time revenue, profit, sales count, inventory value, shift status, top sellers, low stock

---

## Remaining Gaps (Not Yet Built)

| Feature                                | Priority | Notes                                                     |
| -------------------------------------- | -------- | --------------------------------------------------------- |
| Custom Product Fields / Attribute Sets | Low      | Needed for clothing (size/color variants)                 |
| Returned Stock / RMA to Supplier       | Medium   | Return goods to supplier and deduct from supplier balance |
| Barcode Label Printing                 | Medium   | Print shelf labels with barcode from the system           |
| Receipt Template Editor                | Low      | Custom header/footer on printed receipts                  |
| Role-Based Access Control              | Medium   | Restrict what cashier vs. manager can see                 |
| Loyalty Points Redemption at POS       | Medium   | Column exists in customers table, logic not wired to POS  |
| Cloud Sync / Multi-PC                  | Low      | Currently single-machine SQLite only                      |
| Refunds / Returns from Customer        | High     | DONE — Full Returns flow built in Phase 6                 |

---

## Phased Roadmap (Next Sessions)

### Phase 6 — Returns & Refunds ✅ COMPLETE

- [x] Customer return flow on POS
- [x] Restock returned items to outlet_stock
- [x] Refund payment recorded

### Phase 7 — Access Control

- Manager vs. Cashier permission levels
- Lock discount/void behind manager PIN

### Phase 8 — Product Variants

- Size / Color attribute sets
- Variant-level stock tracking

### Phase 9 — Loyalty Points at POS

- Earn points on purchase (already stored)
- Redeem points as discount at checkout
