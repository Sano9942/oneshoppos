# SanoPOS — Product Roadmap & Feature Backlog

This file tracks everything we want to build, fix, or improve for SanoPOS.
Updated as we discuss new ideas.

---

## ✅ Already Built (Reference)

- POS sell screen with shift/attendance gating
- Park Sale + Previously Parked Sales
- Sales History with Returns & Exchanges
- Cash Management (denomination-based open/close)
- Purchase Orders → GRN flow
- Stock Adjustments, Transfers, Returned Stock
- Supplier Payables
- Attendance + Kiosk PIN clock-in
- Barcode scanner (auto keydown detection)
- ESC/POS thermal printer + email receipts
- Receipt Templates (header/footer/barcode)
- Shopify integration (import, sync, webhooks)
- Hierarchical categories (tree, leaf-only assignment)
- Variant products (attribute sets, cartesian generation)
- Promotions / discount rules
- Reports V2 (67 tabs across Sales, Inventory, Finance, Purchasing, Staff, Analytics)
- Operations Dashboard (auto-refresh, KPIs, outlet ranking, exceptions)
- SaaS Phase 1–5 (multi-tenant ready, JWT auth, super-admin dashboard)
- Customer wallet (balance + ledger + debit on sale)
- Loyalty points (earn/redeem on sales, stored per customer)

---

## 🔴 High Priority — Build Next

### 1. Loyalty & Wallet Frontend
**Status:** Backend fully built, no frontend UI
**What's needed:**
- Show customer's points balance + wallet balance when selected at POS checkout
- UI to redeem points at checkout (apply as discount)
- Dedicated sidebar page: Customers → Loyalty & Wallet
- Configure earn rate (e.g. 1 point per PKR 100 spent)
- Wallet top-up UI on customer profile page

### 2. Profit & Loss Report
**Status:** Not built (backend or frontend)
**What's needed:**
- Backend: `GET /api/reports/profit-loss` — Revenue - COGS (cost_price × qty sold) - Expenses = Net Profit
- Grouped by day/week/month
- Frontend tab in Reports → Finance section
- Show: Gross Revenue, COGS, Gross Profit, Expenses, Net Profit

### 3. Reorder Alerts Page
**Status:** Data exists, no dedicated page
**What's needed:**
- Products where current stock ≤ reorder threshold
- Sidebar entry under Stock Control
- Quick "Create PO" button from the alert
- Optional: add `reorder_point` column to products table

---

## 🟡 Medium Priority

### 4. Advance / Layaway Payments
**Status:** Not built
**What's needed:**
- Accept partial payment on a sale (advance amount)
- Track outstanding balance per customer
- Allow customer to return and pay remaining balance
- XStak ShopDesk has this — common for toy shops (pre-orders, birthday gifts)

### 5. FBR Integration (Pakistan E-Invoicing)
**Status:** Feature flag exists (`e_invoicing_export: true`), not connected to FBR
**What's needed:**
- Send sale data to FBR API on each completed sale
- FBR invoice number stored on sale record
- "FBR Resync" button on Sales History for failed submissions
- Required for tax compliance in Pakistan

### 6. Parked Sales Management Page
**Status:** POS uses parked sales but no standalone admin page
**What's needed:**
- Sidebar entry under Commerce
- List all parked sales across outlets
- Delete/resume/expire old parked sales

### 7. STR Report (Stock Transfer Report)
**Status:** Data exists in `inventory_transfers` table, no dedicated report tab
**What's needed:**
- Add "Stock Transfer" tab to Reports → Inventory
- Filter by outlet, date range
- Columns: date, from outlet, to outlet, product, qty, transferred by

### 8. Parent / Category Rollup Report
**Status:** Not built
**What's needed:**
- Sales and stock rolled up by top-level category
- Useful for toy shop (Toys vs Baby vs Stationery comparison)
- Add tab to Reports → Sales or Catalog section

---

## 🐛 Bugs / Incomplete Features — Dashboard

Backend computes these fields and sends them in `/api/reports/dashboard` but **no frontend component displays them**.
Found via audit on March 9 2026.

| Backend Field | What It Contains | Suggested Widget |
|--------------|-----------------|-----------------|
| `yesterdaySaleCount` | Yesterday's transaction count | KPI cards — comparison delta |
| `monthPurchases` | Total purchases this month | Finance KPI card |
| `monthGrossMargin` | Gross margin % for the month | Finance KPI card |
| `zReport` | Today's Z-report summary | End-of-day dashboard widget |
| `todayGrossProfit` | Today gross profit (vs `todayProfit`) | KPI cards |
| `todayExpenses` | Today's expenses total | Exceptions / finance widget |
| `taxInclusive` / `taxExclusive` | Revenue split by tax type | Finance KPI |
| `inventoryValue` | Stock cost + retail value totals | Inventory widget |
| `currentStockUnits` | Total units currently in stock | Inventory alerts header |
| `topSelling` | Top selling products today | Top products widget |
| `topProducts` | Top products (similar to topSelling) | Top products widget |
| `salePurchaseComparison` | Buy vs sell comparison by period | Trends widget |
| `categoryPerformance` | Category performance matrix | Contribution widget |
| `inventory` | total_products + low_stock_items count | Inventory alerts header |

---

## 🐛 Bugs / Incomplete Features — Reports

These report tabs are **visible in the frontend but broken** — the backend endpoint was never built.
Found via audit on March 9 2026.

| Tab | Section | Missing Endpoint | Effort |
|-----|---------|-----------------|--------|
| **Dead Stock** | Inventory | `GET /api/reports/dead-stock` | Small — products with no sales in X days |
| **Pricing & Margin** | Inventory | `GET /api/reports/pricing-margin` | Small — cost vs sell price per product |
| **Purchase Orders Report** | Procurement | `GET /api/reports/purchase-orders-report` | Small — PO list with filters |
| **Forecast Demand** | Inventory | `GET /api/reports/forecast-demand` | Medium — avg daily sales × lead time |
| **Replenishment Smart** | Inventory | `GET /api/reports/replenishment-smart` | Medium — AI-style reorder suggestions |

---

## 🟢 Lower Priority / Nice to Have

### 9. Notifications Centre
**Status:** Feature flag exists (`notifications: true`), no page or sidebar entry
**What's needed:**
- Sidebar entry under Operations
- In-app notifications (low stock alerts, PO approvals, shift exceptions)

### 10. Serial Number Tracking
**Status:** Not built
**What's needed:**
- Assign serial number to specific products (electronics, high-value items)
- Record serial number at point of sale
- Search sales by serial number

### 11. Gift Cards / Vouchers
**Status:** Not built
**What's needed:**
- Generate gift card codes with fixed value
- Redeem at POS checkout
- Common in toy shops for birthdays

### 12. Purchase Order Templates
**Status:** Not built
**What's needed:**
- Save a PO as a template (same supplier + same items)
- One-click reorder for regular stock runs

### 13. Shopcast / Digital Signage
**Status:** Not built (XStak has this)
**What's needed:**
- Display current promotions on a screen at the store entrance
- Stretch goal — low priority for now

---

## 🔵 Competitor Gap Analysis (vs XStak ShopDesk)

Features XStak has that we're missing:
| Feature | Priority |
|---------|----------|
| FBR e-invoicing | 🔴 High (Pakistan compliance) |
| Advance/layaway payments | 🟡 Medium |
| Serial number per sale | 🟢 Low |
| Partner/loyalty codes (external) | 🟢 Low |
| Shopcast digital signage | 🟢 Low |

Features **we have that XStak doesn't:**
- Supplier Payables
- Multi-level Approvals workflow
- Attendance + Kiosk terminal
- Shift denomination capture
- 67 report tabs (vs their 22)
- SaaS / multi-tenant architecture
- ESC/POS thermal printer integration
- Email receipts

---

## 📋 Discussed but Deferred

- **Multi-tenant go-live (MULTI_TENANT=1):** Needs timezone Phase 2, tenant isolation testing, subdomain routing, Railway volume strategy — see CLAUDE.md for full checklist
- **Profit-sharing / payroll module** — mentioned in seed data but not built as a UI
- **Shopcast / digital signage**
- **Payment gateway integration** (card machines, JazzCash, EasyPaisa)

---

---

# 🔍 Full Backend ↔ Frontend Gap Audit (March 9 2026)

*Produced by systematic read of all 25 areas: backend route files + frontend pages/components*

---

## Area-by-Area Findings

### 1. Dashboard
- ✅ Backend endpoints: `GET /api/reports/dashboard` (single endpoint returning 40+ fields — KPIs, attendance, exceptions, trends, targets, inventory status)
- ✅ Frontend covers: 12 components in `frontend/src/pages/dashboard/` — KPIs, OpsReadiness, Exceptions, Trends, InventoryAlerts, Attendance, QuickActions, OutletRanking, Contribution
- ❌ Missing in frontend: `topSelling`, `topProducts`, `hourly breakdown`, `categoryPerformance`, `salePurchaseComparison`, `inventoryValue`, `currentStockUnits`, `monthPurchases`, `monthGrossMargin`, `yesterdayRevenue/Count/Profit`, `zReport`, `todayGrossProfit`, `todayExpenses`, `taxInclusive/Exclusive` — 14 data fields returned by backend, never rendered
- ❌ Missing in backend: Nothing — endpoint is comprehensive
- ⚠️ Partial/broken: `DashboardRecentSales` fetches sales via a separate `GET /api/sales` call instead of using `recentSales` already in the dashboard response (double API call); dashboard line 101 & 552 use `'localtime'` modifier on GROUP BY (will break multi-tenant timezone in Phase 2)

---

### 2. POS
- ✅ Backend endpoints: `POST /api/sales`, `PUT /api/sales/:id/void`, `GET /api/shifts/active`, `POST /api/shifts/open`, `POST /api/shifts/:id/close`, `GET /api/shifts/:id/denominations`, `GET /api/variance-reasons`, `GET /api/parked-sales`, `POST /api/parked-sales`, `DELETE /api/parked-sales/:id`, `GET /api/parked-sales/:id`, `POST /api/returns` (17 total)
- ✅ Frontend covers: `POSContext.jsx` (152 exported values), 15 POS components — full checkout flow, barcode scanner, denominations, shift open/close, recent sales, returns, email receipt, hardware print
- ❌ Missing in frontend: No exchange flow (returns only, no swap-product UI); no denomination history display; no "edit open shift" UI
- ❌ Missing in backend: No bulk parked-sales deletion; barcode product lookup uses list endpoint (`GET /api/products?barcode=X`) instead of a dedicated scan endpoint
- ⚠️ Partial/broken: Race condition edge case — if shift closes between add-to-cart and checkout, sale fails; attendance checked at checkout time only (not at add-to-cart)

---

### 3. Sales History
- ✅ Backend endpoints: `GET /api/sales` (paginated, searchable), `GET /api/sales/:id`, `PUT /api/sales/:id/void`
- ✅ Frontend covers: `SalesHistoryRedesign.jsx` — table with search, date filters, pagination, void action, detail drawer, reprint, CSV export, invoice view modal
- ❌ Missing in frontend: No filter by payment method; no filter by employee; no filter by customer; CSV export excludes payment breakdown
- ❌ Missing in backend: Nothing

---

### 4. Cash Management
- ✅ Backend endpoints: `GET /api/shifts`, `GET /api/shifts/active`, `POST /api/shifts/open`, `POST /api/shifts/:id/close`, `GET /api/shifts/:id/denominations`, `GET /api/variance-reasons`
- ✅ Frontend covers: `CashManagementRedesign.jsx` — shifts table, open/close modals with denomination counters, KPI cards, CSV export
- ❌ Missing in frontend: No subtotal display per denomination (count × value); no auto-calculation of expected float; no denomination history browsing
- ❌ Missing in backend: No `PUT /api/shifts/:id` to edit after opening; no approval enforcement on variance (approved_by is a free text field only)
- ⚠️ Partial/broken: Variance not enforced — shift can be closed with any variance amount; no permission check for who can approve variances

---

### 5. Customers
- ✅ Backend endpoints: `GET /api/customers`, `POST /api/customers`, `PUT /api/customers/:id`, `DELETE /api/customers/:id`, `PUT /api/customers/:id/points`, `GET /api/customers/:id/wallet`, `POST /api/customers/:id/wallet/topup`, `GET /api/customers/:id/sales`
- ✅ Frontend covers: `CustomersRedesign.jsx` — CRUD, wallet topup, points adjust, sales history, ledger, search, pagination, CSV export
- ❌ Missing in frontend: No wallet ledger date-range filter (shows last 50 only); no `GET /api/customers/:id` single-fetch endpoint (requires list); bulk delete checkbox UI exists but no backend support
- ❌ Missing in backend: No `GET /api/customers/:id` single-record endpoint; no bulk delete endpoint
- ⚠️ Partial/broken: Bulk delete checkbox rendered but non-functional (no backend)

---

### 6. Returns
- ✅ Backend endpoints: `POST /api/returns`, `GET /api/returns`, `GET /api/returns/:id`
- ✅ Frontend covers: `ReturnsRedesign.jsx` — returns list, date filters, detail drawer, create modal (bill-linked or no-bill mode, barcode scanner, refund method selector)
- ❌ Missing in frontend: No edit or cancel after creation; no void/reverse return
- ❌ Missing in backend: No `PUT /api/returns/:id`; no `DELETE /api/returns/:id`; no restocking reversal; wallet refund amount not validated against balance
- ⚠️ Partial/broken: Returns can be created with zero total_refund (no backend validation); wallet refund bypasses balance check

---

### 7. Products / Inventory
- ✅ Backend endpoints: `GET /api/products`, `GET /api/products/:id`, `GET /api/products/:id/variants`, `GET /api/products/:id/stock`, `GET /api/products/search`, `GET /api/products/scan/:barcode`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`, `POST /api/bulk-import`
- ✅ Frontend covers: `InventoryRedesign.jsx` — product list, search, filters, CSV import/export; `ProductFormPage.jsx` — full two-column create/edit with variant management, image upload, multi-outlet stock
- ❌ Missing in frontend: No "stock by outlet" detail popup from product list; no batch price update; no bulk variant import/pricing workflow
- ❌ Missing in backend: No batch price update endpoint; product images use string URL (no `multer` file upload for product images — only brand logos have it)
- ⚠️ Partial/broken: POS barcode scanner calls `GET /api/products?barcode=X` (list endpoint) instead of dedicated `/api/products/scan/:barcode`; CSV import may lose leading zeros on barcodes in plain CSV (no normalization)

---

### 8. Categories
- ✅ Backend endpoints: `GET /api/categories`, `POST /api/categories`, `PUT /api/categories/:id`, `DELETE /api/categories/:id`, `POST /api/categories/create-child-and-move`
- ✅ Frontend covers: `CategoriesRedesign.jsx` — hierarchical tree, create root/child, edit (with parent move + cycle prevention), delete, guided conversion modal, search
- ❌ Missing in frontend: No drag-to-reorder; no bulk product re-assignment across categories; no "deactivate all descendants" action
- ❌ Missing in backend: No PATCH for sort_order only
- ⚠️ Partial/broken: Category deletion does not warn if products exist (can orphan products); leaf validation only enforced at product assignment, not category creation

---

### 9. Purchase Orders
- ✅ Backend endpoints: `GET /api/purchase-orders`, `GET /api/purchase-orders/:id`, `POST /api/purchase-orders` (with credit-limit warning), `DELETE /api/purchase-orders/:id`, `POST /api/purchase-orders/:id/receive` (partial receive, creates GRN + auto-invoice)
- ✅ Frontend covers: `PurchaseOrdersRedesign.jsx` — PO list/create/detail, product cart, receive modal (per-item quantities), GRN inline creation, CSV export
- ❌ Missing in frontend: No credit limit warning displayed in create flow; no PO edit after creation; no PO approve action; no partial delivery tracking for future receives
- ❌ Missing in backend: No `PUT /api/purchase-orders/:id` for editing; no approval endpoint (Draft → Approved transition); no partial delivery carry-forward
- ⚠️ Partial/broken: Credit limit check returns `{ warning: "..." }` in response but frontend never parses or displays it; GRN auto-creates supplier invoice but if insert fails (best-effort), PO is still marked Received

---

### 10. Stock Adjustments
- ✅ Backend endpoints: `GET /api/adjustments`, `POST /api/adjustments`
- ✅ Frontend covers: `StockAdjustmentsRedesign.jsx` — adjustment list, reason filter, product search, create modal (product, outlet, qty, reason)
- ❌ Missing in frontend: No edit/delete for adjustments; no reason description field in modal
- ❌ Missing in backend: No `GET /api/adjustments/:id`; no `PUT`/`DELETE`; no reason validation enum (any string accepted)

---

### 11. Transfers
- ✅ Backend endpoints: `GET /api/transfers`, `POST /api/transfers` (atomic, validates source stock)
- ✅ Frontend covers: `TransfersRedesign.jsx` — transfer list, create modal (from/to outlet, product, qty, note), date/outlet/product filters
- ❌ Missing in frontend: No edit/delete; no transfer reversal
- ❌ Missing in backend: No `GET /api/transfers/:id`; no `PUT`/`DELETE`; no reverse-transfer endpoint

---

### 12. Supplier Payables
- ✅ Backend endpoints: `GET /api/supplier-invoices`, `GET /api/supplier-invoices/:id`, `POST /api/supplier-invoices/:id/pay`, `GET /api/supplier-aging`, `GET /api/supplier-ledger/:supplier_id`
- ✅ Frontend covers: `SupplierPayablesRedesign.jsx` — aging tab, invoices tab (with pay modal), ledger tab (date range + supplier dropdown)
- ❌ Missing in frontend: No invoice creation (auto-created from PO receive only); no payment reversal; no bulk payment entry
- ❌ Missing in backend: No `PUT /api/supplier-invoices/:id`; no payment deletion/reversal; no supplier credit note; no late fee calculation
- ⚠️ Partial/broken: Ledger `page_index` param not fully handled (offset query incomplete); payment amount allows small over-payment due to floating-point epsilon

---

### 13. Suppliers
- ✅ Backend endpoints: `GET /api/suppliers`, `POST /api/suppliers`, `PUT /api/suppliers/:id`, `DELETE /api/suppliers/:id`
- ✅ Frontend covers: `SuppliersRedesign.jsx` — supplier list/create/edit/delete, credit limit/days, payment terms, running balance display, search
- ❌ Missing in frontend: No supplier performance metrics; no active/inactive status toggle
- ❌ Missing in backend: No supplier status field; no contact history; can delete supplier with outstanding invoices (orphans payables)
- ⚠️ Partial/broken: Running balance calculation counts full invoice amount even on partial-paid invoices

---

### 14. Expenses
- ✅ Backend endpoints: `GET /api/expense-categories`, `POST /api/expense-categories`, `PUT /api/expense-categories/:id`, `DELETE /api/expense-categories/:id`, `GET /api/expenses`, `POST /api/expenses`, `PUT /api/expenses/:id`, `DELETE /api/expenses/:id`, `GET /api/expenses/summary`
- ✅ Frontend covers: `ExpensesRedesign.jsx` — expenses tab (list/create/edit, category/outlet/date filters), summary tab (per-category breakdown), category manager sub-panel
- ❌ Missing in frontend: No bulk CSV import; no receipt image upload; no expense approval workflow
- ❌ Missing in backend: No receipt image storage; no expense status/approval endpoint; no budget vs actual tracking
- ⚠️ Partial/broken: `shift_id` exists in expenses table but not exposed in UI; summary endpoint response structure may mismatch frontend expectation (raw array vs `{ summary, grand_total }`)

---

### 15. Employees
- ✅ Backend endpoints: `GET /api/employees`, `POST /api/employees`, `PUT /api/employees/:id`, `DELETE /api/employees/:id`, `GET /api/employees/:id/outlets`, `PUT /api/employees/:id/outlets`, `POST /api/employees/validate-pin`, `GET /api/employees/:id/attendance-config`, `PUT /api/employees/:id/attendance-config`
- ✅ Frontend covers: `EmployeesRedesign.jsx` — full CRUD, role/salary/outlet assignment, attendance config (work hours, leave allowance), search
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 16. Attendance
- ✅ Backend endpoints: `GET /api/attendance`, `GET /api/attendance/sessions`, `POST /api/attendance/pin-status`, `POST /api/attendance/pin-checkin`, `POST /api/attendance/pin-checkout`, `PUT /api/attendance/:id`, `POST /api/attendance/checkin` (legacy), `POST /api/attendance/:id/checkout` (legacy)
- ✅ Frontend covers: `AttendanceRedesign.jsx` — day-level records, session view, date/employee filters, edit modal; `KioskRedesign.jsx` — PIN clock-in/out, break types, elapsed time display
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 17. Reports (Full Audit)
- ✅ Backend endpoints: 56 total across dashboard, sales (15), inventory (14), analytics (13), finance (6), purchasing (4), staff (2), shifts (7), governance (infrastructure)
- ✅ Frontend covers: 40+ tabs in `Reports.jsx` + 10 module files covering all major categories
- ❌ Missing in frontend (backend built, no UI tab): `POST /api/reports/schedules` (governance scheduling); `GET /api/reports/saved-views` (saved view library — not a dedicated tab)
- ❌ Missing in backend (frontend tab exists, no endpoint): `GET /api/reports/forecast-demand`, `GET /api/reports/replenishment-smart`, `GET /api/reports/dead-stock` (partial), `GET /api/reports/pricing-margin` (partial), `GET /api/reports/purchase-orders-report` (partial)
- ⚠️ Partial/broken: Feature-gated endpoints (`discount-leakage`, `exceptions`) always visible in frontend regardless of feature flag — will return 403 on click with no UI indicator; governance scheduling/saved-views have no dedicated management UI

---

### 18. Promotions
- ✅ Backend endpoints: `GET /api/promotions`, `POST /api/promotions`, `PUT /api/promotions/:id`, `DELETE /api/promotions/:id`, `POST /api/promotions/quote`
- ✅ Frontend covers: `PromotionsRedesign.jsx` — full CRUD, all promotion types (percent, fixed, threshold, BXGY), category scoping, date ranges, quote tester with cart builder
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 19. Receipt Templates
- ✅ Backend endpoints: `GET /api/receipt-templates`, `GET /api/receipt-templates/active`, `POST /api/receipt-templates`, `PUT /api/receipt-templates/:id`, `DELETE /api/receipt-templates/:id`, `POST /api/action-history`, `GET /api/action-history`
- ✅ Frontend covers: `ReceiptTemplatesRedesign.jsx` → `ReceiptTemplates.jsx` — full CRUD, set active, preview, action history
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 20. Barcode Templates
- ✅ Backend endpoints: `GET /api/barcode-templates`, `POST /api/barcode-templates`, `PUT /api/barcode-templates/:id`, `DELETE /api/barcode-templates/:id`, `POST /api/barcode-print-jobs`
- ✅ Frontend covers: `BarcodeTemplatesRedesign.jsx` → `BarcodeTemplates.jsx` — full CRUD, set default, batch print job logging, label preview
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 21. Shopify Integration
- ✅ Backend endpoints: 25 total across config (3), health (6), webhooks (1), sync events (5), orders (1), import (3), mappings (9)
- ✅ Frontend covers: 6 tabs — Overview, Connection, Import & Sync, Mappings, Reconciliation, Event Log
- ❌ Missing in frontend: Customer mapping UI exists as placeholder but not fully implemented; location mapping assumes single outlet context (multi-outlet incomplete)
- ❌ Missing in backend: Nothing
- ⚠️ Partial/broken: Permission gating not enforced in frontend (tabs always visible, 403 on click); customer mapping (`GET/PUT /api/integrations/mappings/customers`) endpoints not actively used

---

### 22. Roles & Permissions
- ✅ Backend endpoints: `GET /api/roles`, `POST /api/roles`, `PUT /api/roles/:id`, `DELETE /api/roles/:id`, `GET /api/roles/:id/permissions`, `PUT /api/roles/:id/permissions`
- ✅ Frontend covers: `AdministratorRedesign.jsx` — full CRUD, permission matrix grouped by category, protects default roles (1/2/3) from deletion
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 23. Company Settings
- ✅ Backend endpoints: `GET /api/company-profile`, `PUT /api/company-profile`, `POST /api/company-profile/logo`
- ✅ Frontend covers: `CompanySettingsRedesign.jsx` — Business Identity, Tax & Legal, Branding & Currency, Regional Settings, Dashboard Targets sections
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 24. Printer Settings
- ✅ Backend endpoints: `GET /api/print/config`, `PUT /api/print/config`, `GET /api/print/status`, `POST /api/print/receipt`
- ✅ Frontend covers: `PrinterSettingsRedesign.jsx` — connection type, network/USB config, paper size, cash drawer toggle, test print
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

### 25. Email Settings
- ✅ Backend endpoints: `GET /api/email/config`, `PUT /api/email/config`, `POST /api/email/test`, `POST /api/email/send-receipt`
- ✅ Frontend covers: Email Settings section inside `PrinterSettingsRedesign.jsx` — SMTP config, masked password, from_name, test email button
- ❌ Missing in frontend: Nothing identified
- ❌ Missing in backend: Nothing identified

---

## 📊 Master Gap Summary Table

*Sorted by Priority. "Area" = which section of the app.*

| Priority | Area | Gap | Type | Effort |
|----------|------|-----|------|--------|
| 🔴 HIGH | Dashboard | 14 data fields from API never rendered (topSelling, hourlySales, salePurchaseComparison, inventoryValue, etc.) | Missing UI | Medium |
| 🔴 HIGH | Reports | `forecast-demand` & `replenishment-smart` tabs visible but backend endpoint missing — will 404 | Broken (missing backend) | Medium |
| 🔴 HIGH | Reports | `dead-stock`, `pricing-margin`, `purchase-orders-report` tabs exist in frontend but no backend | Broken (missing backend) | Small |
| 🔴 HIGH | Purchase Orders | Credit limit warning returned by backend (`{ warning }`) but frontend never displays it | Missing UI | Tiny |
| 🔴 HIGH | Customers | Bulk delete checkbox rendered in UI but no backend endpoint — non-functional button | Broken (missing backend) | Tiny |
| 🔴 HIGH | Products | Product image upload: backend only accepts a string URL, no `multer` route for actual file upload | Missing backend | Small |
| 🟡 MEDIUM | Dashboard | `DashboardRecentSales` fetches via separate `GET /api/sales` instead of using `recentSales` from dashboard response | Inefficiency (double API call) | Tiny |
| 🟡 MEDIUM | Sales History | No filter by payment method, employee, or customer | Missing UI | Small |
| 🟡 MEDIUM | Purchase Orders | No PO edit after creation (`PUT` endpoint missing); no approval (Draft → Approved) flow | Missing backend + UI | Medium |
| 🟡 MEDIUM | Returns | No void/cancel/edit after creation; wallet refund bypasses balance validation | Missing backend | Small |
| 🟡 MEDIUM | Expenses | Summary endpoint response structure mismatch risk (`{ summary, grand_total }` vs raw array) | Potential bug | Tiny |
| 🟡 MEDIUM | Suppliers | Can delete supplier with outstanding invoices — orphans payable records | Data integrity | Small |
| 🟡 MEDIUM | Categories | Deletion doesn't warn if products exist — can orphan products | Data integrity | Small |
| 🟡 MEDIUM | Cash Management | Variance not enforced — shift closes regardless of cash discrepancy; no approval workflow | Missing feature | Small |
| 🟡 MEDIUM | Reports | Feature-gated tabs (`discount-leakage`, `exceptions`) always visible regardless of feature flags — shows 403 on click with no UI warning | Broken UX | Tiny |
| 🟡 MEDIUM | Shopify | Customer mapping endpoints exist but UI incomplete/unused | Partial feature | Small |
| 🟡 MEDIUM | POS | Barcode scanner calls `GET /api/products?barcode=X` (list endpoint); dedicated `/scan/:barcode` endpoint not used | Inconsistency | Tiny |
| 🟡 MEDIUM | Supplier Payables | Ledger `page_index` param not fully handled — offset query incomplete | Potential bug | Tiny |
| 🟢 LOW | Stock Adjustments | No edit/delete after creation; no reason description field | Missing feature | Small |
| 🟢 LOW | Transfers | No edit/delete or reverse-transfer after creation | Missing feature | Small |
| 🟢 LOW | Supplier Payables | No payment reversal/void; no credit notes | Missing feature | Medium |
| 🟢 LOW | Attendance | No GET /api/attendance/my-status exposed in main attendance UI (only used in POS gating) | Minor gap | Tiny |
| 🟢 LOW | Reports | Governance schedule management / saved-view library has no dedicated UI tab | Missing UI | Medium |
| 🟢 LOW | Products | "Stock by outlet" data fetched but no popup/breakdown UI in inventory list | Missing UI | Small |
| 🟢 LOW | Cash Management | Denomination subtotal (count × value) not calculated/displayed in UI | Missing UI | Tiny |
| 🟡 MEDIUM | Orders | Order detail modal missing transactions/fulfillments display; no `PUT /api/orders/:id` for inline edits | Missing UI + backend | Small |
| 🟡 MEDIUM | Quotations | "Send" action has no side effects (no email/notification delivery) | Missing feature | Small |
| 🟡 MEDIUM | Accounting | Only `GET /api/accounting/pnl` exists; Cashflow and AP/AR tabs in UI have no backend | Missing backend | Medium |
| 🟡 MEDIUM | HR | Payroll periods UI is a stub (no line items, no payout history); leave balance has no calculation endpoint | Missing backend | Medium |
| 🟡 MEDIUM | Action History | No date-range filter; many operations don't write to action_history (sales, returns, adjustments) | Missing feature | Small |
| 🟢 LOW | Returned Stock | RMA is append-only — no update/delete after creation; no stock restoration on deletion | Missing feature | Small |
| 🟢 LOW | Approvals | Only covers PO and transfer approvals — not extensible to other entities | Architecture | Medium |
| 🟢 LOW | CRM | Activity log is free text only — no typed activity categories (call, email, meeting) | Missing feature | Small |
| 🟢 LOW | Backup & Restore | No progress indicator during long restores — UI appears hung | UX gap | Small |

---

## ✅ Areas With No Gaps Found

These areas are complete — backend and frontend fully aligned:

| Area | Status |
|------|--------|
| Employees | ✅ Complete |
| Attendance | ✅ Complete |
| Promotions | ✅ Complete |
| Roles & Permissions | ✅ Complete |
| Company Settings | ✅ Complete |
| Printer Settings | ✅ Complete |
| Email Settings | ✅ Complete |
| Receipt Templates | ✅ Complete |
| Barcode Templates | ✅ Complete |
| Outlets | ✅ Complete |
| Brands | ✅ Complete |
| Taxes | ✅ Complete |
| Attribute Sets | ✅ Complete |
| Supplier Returns / Returned Stock | ✅ Complete (read-only gaps are minor) |

---

## 📋 Nav Items Audit (Added March 9 2026)

*These 13 nav items were not in the original 25-area audit. All are implemented.*

### 26. Orders
- ✅ Backend endpoints: `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `PUT /api/orders/:id/status`, `POST /api/orders/mark-complete`, `POST /api/orders/bulk-update`, `POST /api/orders/:id/transactions`, `POST /api/orders/:id/fulfillments`, `POST /api/uploads/product-image`
- ✅ Frontend covers: `OrdersRedesign.jsx` — list with search, status/payment/fulfillment filters, date range, bulk actions, detail modal, CSV export
- ❌ Missing in frontend: Transactions and fulfillments data returned but no display UI in detail modal
- ❌ Missing in backend: No `PUT /api/orders/:id` for inline field edits

### 27. Returned Stock (Supplier Returns)
- ✅ Backend endpoints: `GET /api/supplier-returns`, `GET /api/supplier-returns/:id`, `POST /api/supplier-returns`
- ✅ Frontend covers: `ReturnedStockRedesign.jsx` — RMA list, create modal (supplier/outlet/reason/items), stock deduction on save, detail view
- ❌ Missing in backend: No `PUT`/`DELETE` — RMA is append-only; no stock restoration if deleted

### 28. Approvals
- ✅ Backend endpoints: `GET /api/approvals`, `POST /api/purchase-orders/:id/submit`, `POST /api/purchase-orders/:id/approve`, `POST /api/transfers/:id/submit`, `POST /api/transfers/:id/approve`
- ✅ Frontend covers: `ApprovalsRedesign.jsx` → `Approvals.jsx` — pending list, approve/reject modal with reason, action history logging
- ⚠️ Partial/broken: Covers PO and transfer approvals only — not extensible to expenses, adjustments, etc.

### 29. Accounting
- ✅ Backend endpoints: `GET /api/accounting/pnl`
- ✅ Frontend covers: `AccountingRedesign.jsx` → `Accounting.jsx` — P&L tab, Cashflow tab, AP/AR tab
- ❌ Missing in backend: Cashflow and AP/AR tabs have no backend endpoints — data likely calculated client-side or stubs

### 30. CRM
- ✅ Backend endpoints: `GET /api/crm/leads`, `POST /api/crm/leads`, `PUT /api/crm/leads/:id`, `GET /api/crm/leads/:id/activities`, `POST /api/crm/leads/:id/activities`
- ✅ Frontend covers: `CRMRedesign.jsx` — lead list, create/edit modal, stage/priority filters, activity timeline
- ❌ Missing in backend: No `DELETE /api/crm/leads/:id`

### 31. Quotations
- ✅ Backend endpoints: `GET /api/quotations`, `POST /api/quotations`, `GET /api/quotations/:id`, `PUT /api/quotations/:id`, `PUT /api/quotations/:id/status`, `DELETE /api/quotations/:id`, `POST /api/quotations/:id/convert`
- ✅ Frontend covers: `QuotationsRedesign.jsx` — full CRUD, status filter, item cart, discount handling, convert-to-sale action
- ❌ Missing in frontend: No "send quotation" email action (backend sets status only, no delivery)
- ⚠️ Partial/broken: Convert-to-sale backend exists; verify "Convert" button is visible in accepted/sent status states

### 32. HR
- ✅ Backend endpoints: `GET /api/hr/leave`, `POST /api/hr/leave`, `PUT /api/hr/leave/:id/status`, `GET /api/hr/payroll/periods`, `POST /api/hr/payroll/periods`
- ✅ Frontend covers: `HRManagementRedesign.jsx` — Leave Requests tab (create/approve/reject), Leave Balance tab, Payroll tab, Attendance Summary tab
- ❌ Missing in backend: No leave balance calculation endpoint; no payroll line items or payout history (periods are stubs)

### 33. Outlets
- ✅ Backend endpoints: `GET /api/outlets`, `POST /api/outlets`, `PUT /api/outlets/:id`, `DELETE /api/outlets/:id` (with reassign_to param)
- ✅ Frontend covers: `OutletsRedesign.jsx` — full CRUD, delete with reassign flow
- ❌ Missing: Nothing

### 34. Backup & Restore
- ✅ Backend endpoints: `GET /api/backup/download`, `POST /api/backup/restore`, `GET /api/backup/log`
- ✅ Frontend covers: `BackupRestoreRedesign.jsx` — download button, restore modal (file upload, auto pre-backup), restore log display
- ⚠️ Partial/broken: No progress indicator during restore — long operations appear hung

### 35. Action History
- ✅ Backend endpoints: `GET /api/action-history`
- ✅ Frontend covers: `ActionHistoryRedesign.jsx` — audit log viewer, search, 500-entry cap, refresh button
- ❌ Missing in frontend: No date-range filter; no action_type filter
- ⚠️ Partial/broken: Many operations (sales, returns, stock adjustments) don't write to action_history — log is incomplete

### 36. Brands
- ✅ Full CRUD: `GET/POST/PUT/DELETE /api/brands` ↔ `BrandsRedesign.jsx` — complete

### 37. Taxes
- ✅ Full CRUD: `GET/POST/PUT/DELETE /api/taxes` ↔ `TaxesRedesign.jsx` — complete

### 38. Attribute Sets
- ✅ Full CRUD: `GET/POST/PUT/DELETE /api/attribute-sets` ↔ `AttributeSetsRedesign.jsx` — complete, with nested attribute + options management

---

*Full audit updated: March 9 2026 — 38 nav items covered, ~250 endpoints checked*
