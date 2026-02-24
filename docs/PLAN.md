# OneShopPOS — Project Overview & Current Status

**Last Updated: 2026-02-24**

**Status: Phase 12 Complete — Performance, Rollout, and Governance Delivered**

OneShopPOS is a custom Point of Sale (POS) software for daily retail operations. It runs 100% offline on a Windows PC as a local web app, inspired by Xstak/ERPNext in design and feature depth.

---

## Latest Delivery Snapshot (Phase 12)

- Feature flags introduced for high-risk modules (backup/restore, invoice export, approvals, supplier payables)
- Health endpoint added: `GET /api/health`
- Preflight checks added: `npm run preflight`
- Hotspot DB indexes added via `migrate40.js`
- Full E2E regression now at **69 passed, 0 failed**

---

## Technology Stack (Final)

- **Frontend:** React + Vite 7.x, Tailwind CSS v4, Lucide React icons
- **Backend:** Node.js + Express 5.x
- **Database:** SQLite — single file `backend/oneshop.db`, zero setup, 100% offline
- **Environment:** dotenv

---

## Original MVP Goals vs. What Was Built

| Original Goal                                 | Status                                       |
| --------------------------------------------- | -------------------------------------------- |
| Product & Inventory Management (~5,000 items) | Done — with per-outlet stock tracking        |
| Sales & Checkout System                       | Done — multi-tender, discounts, taxes        |
| Barcode Scanning Support                      | Done                                         |
| Receipt Printing                              | Done — thermal-style browser print           |
| Single User Account                           | Expanded into full multi-employee PIN system |

The project far exceeded the original MVP scope and now rivals a commercial ERP.

---

## Complete Feature List (All Built & Working)

### POS Terminal (Register)

- Multi-employee PIN login with Lock Register
- Auto clock-in on login, auto clock-out on lock (attendance)
- Barcode scanner — auto-focused input, always ready
- Cart with quantity management and line-item deletion
- Multi-tender payments: Cash + Card split in one sale
- Discount: Fixed ($) or Percentage (%) per sale with live preview
- Tax: per-product, tax-inclusive calculation
- Customer selector on checkout (search by name or mobile)
- Thermal-style receipt printing
- Active shift warning banner when no shift is open

### Inventory

- Full product CRUD (name, barcode, price, cost, category, brand, tax)
- Paginated table — handles 5,000+ products without crashing
- Per-outlet stock via outlet_stock table
- Stock Adjustments — damage/loss write-offs with reason logging
- Inventory Transfers — move stock from Outlet A to Outlet B

### Purchasing & Receiving

- Supplier CRUD
- Purchase Orders with line items and cost prices
- GRN (Goods Received Note) — partial receipts supported, per-item qty, auto-updates outlet stock and product cost

### Setup

- Outlets (multiple store locations)
- Employees (name, role, PIN code)
- Brands, Categories, Taxes — all fully configurable

### Customer Management

- Customer profiles (name, mobile, email, address, loyalty points)
- Per-customer order history in the CRM page
- Customer linkage on POS checkout

### Cash Management

- Shift open/close with opening float input
- Cash sales auto-summed per shift period
- Variance calculation (expected cash vs actual closing cash)
- Full shift history log

### Sales History

- Paginated with date range and search filters
- Receipt detail panel with all line items and payments
- Void sale with reason logging

### Employee Attendance

- Auto clock-in tied to POS PIN login, auto clock-out on Lock Register
- "Clocked In" badge shown in POS top bar while on shift
- Attendance management page — filterable by date and employee, shows total hours

### Reporting Engine — 20 tabs, 6 groups

- **Sales:** Overview, Sales Summary, Sales Detail, Order Wise, Sales & Stock, Category Wise
- **Customers:** Customer Details, Customer Wise
- **Inventory:** Inventory Dump, On Hand, Item Wise, Product Performance, Product Spec, Replenishment
- **Operations:** Inventory Loss, Wastage, Product Movement, STR Report
- **Procurement:** Supplier Wise, Purchase Orders, GRN Report
- **HR:** Attendance Report

---

## How to Start

Double-click **START.bat** in the project root. It starts both servers and opens the browser automatically.

- Backend: http://localhost:5000
- Frontend: http://localhost:5173
