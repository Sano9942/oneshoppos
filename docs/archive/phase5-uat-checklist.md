# Phase 5 UAT Smoke Checklist

All redesign flags are now ON. Use this checklist to validate each module before removing legacy code.

**Rollback**: To revert any single module, set its flag to `false` in `useFeatureFlags.js` `DEFAULT_FLAGS`, or toggle it off via the feature-flags admin UI.

---

## How to Use

- [ ] Start the app: run `start-pos.bat` from the root directory
- [ ] Log in as **Admin** role first, then re-test critical flows as **Cashier** and **Manager** roles
- For each module, tick all boxes before marking it ✅

---

## Wave A — Core Commerce

### POS `/pos`
- [ ] Page loads with product grid
- [ ] Add item to cart, change quantity, remove item
- [ ] Apply discount, apply promotion
- [ ] Complete a cash sale — receipt generated
- [ ] Complete a card sale
- [ ] Hold order and retrieve it
- [ ] Cashier role: can create sale; cannot access admin pages

### Orders `/orders`
- [ ] Orders list loads with search/filter
- [ ] Open an existing order — details correct
- [ ] Void an order (with confirm dialog)
- [ ] Export/print order

### Customers `/customers`
- [ ] Customer list loads, search works
- [ ] Create new customer
- [ ] Edit customer
- [ ] Delete customer (with confirm)
- [ ] View customer order history

### Sales History `/sales-history`
- [ ] Table loads with date filter
- [ ] Search by receipt/customer
- [ ] Open sale detail / invoice view

### Cash Management `/cash-management`
- [ ] Current shift summary shows correctly
- [ ] Open/close cash drawer
- [ ] Cash in / cash out entry works

### Returns `/returns`
- [ ] Returns list loads
- [ ] Create a return against an existing sale
- [ ] Return confirmation dialog works
- [ ] Returned items reflect in stock

---

## Wave B — Inventory & Procurement

### Inventory `/inventory`
- [ ] Product list loads with search, sort, pagination
- [ ] Create new product
- [ ] Edit product (name, price, stock)
- [ ] Bulk select + delete
- [ ] Export CSV

### Categories `/categories`
- [ ] List loads, create/edit/delete works
- [ ] Category assignment in product works

### Brands `/brands`
- [ ] List loads, create/edit/delete works

### Taxes `/taxes`
- [ ] List loads, create/edit/delete works
- [ ] Tax applied correctly at POS

### Attribute Sets `/attribute-sets`
- [ ] List loads, create/edit/delete works

### Stock Adjustments `/adjustments`
- [ ] List loads
- [ ] Create adjustment (increase/decrease)
- [ ] Reason required on decrease

### Transfers `/transfers`
- [ ] List loads
- [ ] Create transfer between outlets
- [ ] Transfer status transitions (pending → completed)

### Returned Stock `/returned-stock`
- [ ] List loads with correct data

### Suppliers `/suppliers`
- [ ] List loads, create/edit/delete works

### Purchase Orders `/purchase-orders`
- [ ] List loads
- [ ] Create PO with line items
- [ ] Receive PO — stock updated

### Supplier Payables `/supplier-payables`
- [ ] List loads with outstanding amounts
- [ ] Record payment

### Promotions `/promotions`
- [ ] List loads, create/edit/delete works
- [ ] Promotion applies at POS

### Expenses `/expenses`
- [ ] List loads, create/edit/delete works
- [ ] Category filter works

---

## Wave C — Analytics & Admin

### Dashboard `/dashboard`
- [ ] KPI cards load (today's sales, orders, customers, low stock)
- [ ] 7-day sales bar chart renders
- [ ] Low stock alerts panel shows items
- [ ] Recent transactions list loads

### Reports `/reports`
- [ ] Report tabs load (Sales Summary, Sales Detail, etc.)
- [ ] Date range filter works on each tab
- [ ] Export to CSV/PDF works

### Standalone Report Routes
- [ ] `/reports/sales-summary` loads
- [ ] `/reports/sales-detail` loads
- [ ] `/reports/inventory-dump` loads
- [ ] Other report sub-routes load correctly

### Employees `/employees`
- [ ] List loads with role badges
- [ ] Create employee with PIN
- [ ] Edit employee (PIN optional on edit)
- [ ] Delete employee (with confirm)

### Outlets `/outlets`
- [ ] List loads
- [ ] Create/edit/delete outlet

### Administrator `/administrator`
- [ ] Roles list loads with permission badges
- [ ] Create new role
- [ ] Edit role permissions (toggle matrix)
- [ ] Cannot delete system roles (Admin/Manager/Cashier)

### Action History `/action-history`
- [ ] Audit log table loads
- [ ] Search/filter by user or action works

### Backup/Restore `/backup-restore`
- [ ] Download backup button works
- [ ] Upload restore file + confirm dialog
- [ ] Backup log table loads

### Shopify Integration `/integrations/shopify`
- [ ] Page loads with connection status
- [ ] Sync controls visible

---

## Wave D — Tier 4 Modules

### Accounting `/accounting`
- [ ] P&L tab loads with data
- [ ] Cash Flow tab loads
- [ ] AP/AR tab loads

### CRM `/crm`
- [ ] Kanban columns load (New, Contacted, Qualified, Converted, Lost)
- [ ] Add new lead — appears in correct column
- [ ] Move lead between stages
- [ ] Convert lead action works
- [ ] Activity log drawer opens

### Quotations `/quotations`
- [ ] Quotations list loads
- [ ] Create new quotation with line items
- [ ] Subtotal/tax/discount/grand total calculate correctly
- [ ] Send quotation (draft → sent)
- [ ] Convert accepted quotation to order
- [ ] Delete quotation

### HR Management `/hr/leave` and `/hr/payroll`
- [ ] Leave tab: requests list loads
- [ ] Submit leave request
- [ ] Approve/Reject leave (pending only)
- [ ] Payroll tab: periods list loads
- [ ] Create payroll period
- [ ] View payroll lines (gross, deductions, net)

### Company Settings `/company-settings`
- [ ] Form loads with saved values
- [ ] Edit and Save Profile — changes persist after reload
- [ ] Upload logo — logo appears
- [ ] NTN/STRN fields save correctly

---

## Cross-Module / Global Checks

- [ ] No console errors on any page
- [ ] Navigation sidebar: all links work, active state correct
- [ ] Role-based visibility: Cashier cannot see /employees, /administrator, etc.
- [ ] Feature flags: disable one flag (e.g. `ui_redesign_crm: false`) → legacy page shown; re-enable → redesign shown
- [ ] `ui_redesign_enabled: false` in DEFAULT_FLAGS → confirm it gates the whole redesign appropriately (per AppLayoutSwitch logic)
- [ ] Browser back/forward navigation works on all pages
- [ ] Page titles correct in browser tab
- [ ] No broken imports (run `npm run build` — zero errors)

---

## Build Check

```bash
cd frontend && npm run build
```

Expected: zero errors, zero unresolved imports.

---

## Sign-off

| Wave | Tester | Date | Status |
|------|--------|------|--------|
| Wave A — Core Commerce | | | ⬜ |
| Wave B — Inventory & Procurement | | | ⬜ |
| Wave C — Analytics & Admin | | | ⬜ |
| Wave D — Tier 4 Modules | | | ⬜ |
| Cross-Module / Global | | | ⬜ |
| Build Check | | | ⬜ |

Once all rows are ✅, proceed to **Phase 5 Step 5**: legacy file removal.
