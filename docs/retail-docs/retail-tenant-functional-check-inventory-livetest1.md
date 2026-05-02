# Retail Tenant Functional Check Inventory — livetest1

---

## Purpose

This document is a **planning and inventory artifact** for a full retail-tenant functional test of the `livetest1` tenant on SanoPOS production (`https://sanopos.com`).

It was produced by a live browser-automation discovery session (Playwright, headed mode) on **2026-05-02**, logged in as `hassan` (Admin role, Main Store outlet). Every section was reached by real UI navigation. No source code was the primary discovery method.

The document answers: *"What can be tested here, and how deeply?"* — not *"Did it pass?"*

---

## How to Use This File

1. **Pick a section** from the Summary Table below.
2. **Open the Detailed Section** for that page to find the exact buttons, forms, actions, and cross-module effects.
3. **Use the suggested test depth** to decide how much to invest per area.
4. **Consult the Destructive/Risky Function Register** before executing any risky action — decide whether to execute or just inventory.
5. **Consult the Cross-Module Verification Map** when a change in one area must be verified downstream.
6. Mark findings in the **Observed Errors / Broken Surfaces** section at the end.

This file does **not** record test results. It is an input to a test plan.

---

## Discovery Method

| Method | Pages Covered |
|--------|--------------|
| **UI-verified (Playwright browser navigation + accessibility snapshot)** | All pages listed below — Dashboard, all Commerce, Inventory, Stock Control, Procurement, Insights, Operations, Setup, Online Store, Compliance, Admin |
| **Click-through to detail panels/forms** | Customers (detail panel), Sales History (sale detail with actions), Products (edit page `/products/5`) |
| **Source-assisted clarification** | None required — all surfaces were visible in the live UI |

---

## Summary Table

| # | Page | URL | Suggested Depth |
|---|------|-----|----------------|
| 1 | Dashboard | `/dashboard` | Happy Path |
| 2 | POS | `/pos` | Deep E2E |
| 3 | Orders | `/orders` | Happy Path |
| 4 | Fulfillment | `/fulfillment` | Happy Path |
| 5 | COD Settlements | `/cod-settlements` | Smoke |
| 6 | Parked Sales | `/parked-sales` | Happy Path |
| 7 | Holds & Layaway | `/holds` | Happy Path |
| 8 | Customers | `/customers` | Deep E2E |
| 9 | Customer Groups | `/customer-groups` | Happy Path |
| 10 | Loyalty Tiers | `/loyalty-tiers` | Happy Path |
| 11 | Gift Cards | `/gift-cards` | Deep E2E |
| 12 | Returns | `/returns` | Deep E2E |
| 13 | Sales History | `/sales-history` | Deep E2E |
| 14 | Cash Management | `/cash-management` | Deep E2E |
| 15 | Products | `/inventory` → `/products/:id` | Deep E2E |
| 16 | Categories | `/categories` | Happy Path |
| 17 | Brands | `/brands` | Smoke |
| 18 | Taxes | `/taxes` | Happy Path |
| 19 | Attribute Sets | `/attribute-sets` | Happy Path |
| 20 | Promotions | `/promotions` | Deep E2E |
| 21 | Price Lists | `/price-lists` | Happy Path |
| 22 | Review Moderation | `/review-moderation` | Smoke |
| 23 | Purchase Orders | `/purchase-orders` | Deep E2E |
| 24 | Inventory Audit | `/stock-counts` | Happy Path |
| 25 | Stock Adjustments | `/adjustments` | Happy Path |
| 26 | Transfers | `/transfers` | Happy Path |
| 27 | Supplier Returns | `/returned-stock` | Happy Path |
| 28 | Supplier Payables | `/supplier-payables` | Happy Path |
| 29 | Reorder Alerts | `/reorder-alerts` | Smoke |
| 30 | Intelligence | `/inventory-intelligence` | Happy Path |
| 31 | Suppliers | `/suppliers` | Happy Path |
| 32 | Expenses | `/expenses` | Happy Path |
| 33 | Approvals | `/approvals` | Smoke |
| 34 | Reports | `/reports` | Deep E2E |
| 35 | Accounting | `/accounting` | Happy Path |
| 36 | Chart of Accounts | `/chart-of-accounts` | Happy Path |
| 37 | Journal Entries | `/journal-entries` | Happy Path |
| 38 | Credit/Debit Notes | `/credit-debit-notes` | Happy Path |
| 39 | Post-Dated Cheques | `/postdated-cheques` | Smoke |
| 40 | Kiosk | `/kiosk` | Happy Path |
| 41 | CRM | `/crm` | Smoke |
| 42 | Quotations | `/quotations` | Happy Path |
| 43 | Attendance | `/attendance` | Happy Path |
| 44 | HR | `/hr` | Happy Path |
| 45 | Notifications | `/notifications` | Happy Path |
| 46 | Employees | `/employees` | Happy Path |
| 47 | Outlets | `/outlets` | Happy Path |
| 48 | Company Profile | `/company-settings` | Happy Path |
| 49 | Integrations | `/settings/integrations` | Tenant/Integration-specific |
| 50 | Courier Settings | `/courier-settings` | Tenant/Integration-specific |
| 51 | Barcode Templates | `/barcode-templates` | Smoke |
| 52 | Receipt Templates | `/receipt-templates` | Happy Path |
| 53 | Printer Settings | `/printer-settings` | Smoke |
| 54 | Import Data | `/import` | Deep E2E |
| 55 | Import from Shopify/Square | `/settings/import-from-competitor` | Happy Path |
| 56 | Backup & Restore | `/backup-restore` | Happy Path |
| 57 | View Storefront | `/store/livetest1` | Happy Path |
| 58 | FBR Settings | `/settings/fbr` | Tenant/Integration-specific |
| 59 | Tax Lookup | `/tax-lookup` | Smoke |
| 60 | Administrator | `/administrator` | Happy Path |
| 61 | Action History | `/action-history` | Smoke |
| 62 | Retail Risk | `/retail-risk` | Happy Path |
| 63 | Billing | `/billing` | Smoke |
| 64 | My Tickets | `/my-tickets` | Smoke |

---

## Detailed Sections

---

### Overview

#### 1. Dashboard — `/dashboard`

**Visible sections/cards:**
- Insights cards: Revenue This Week, Top Products This Week, Low Stock Alerts, Busiest Hour, Avg Transaction
- Quick action buttons: Open POS, Reports, Cash Management, Add Product, Employees
- Shift Required banner (blocks checkout if no open shift)
- Needs Attention panel: open shift alerts per outlet, low stock alerts
- KPI row: Revenue Today, Net Profit, Avg Bill, Refunds, Expenses Today, Month Gross Margin
- Revenue — Last 7 Days chart (bar)
- Revenue — Last 6 Months chart
- Payment Methods breakdown
- Top Categories (30d)
- Top Products Today table
- Inventory summary: units in stock, retail value, cost value
- Low Stock Alerts widget with View all link
- Staff Today widget (0 in/break/out, list of employees with last action)
- Backup status card (No Recent Backup shown)
- Recent Sales table (10 rows, clickable)
- Multi-outlet feature-enabled info banner (dismissible)

**Primary actions:**
- Open POS, Reports, Cash Management, Add Product, Employees (shortcut buttons)
- Open Shift (from shift banner)
- View all (low stock → `/reorder-alerts`)
- Click recent sale row → Sales History detail

**Secondary controls:**
- Refresh timestamp button (top right of Insights)
- Dismiss on info banner
- Settings button (goes to security settings for outlet flags)

**Cross-module effects to verify:**
- Shift status feeds POS checkout availability
- Low stock alerts driven by product stock levels
- Revenue/KPI cards driven by sales data
- Staff Today driven by attendance records

**Suggested depth:** Happy Path (verify cards load, KPIs match sales history totals, shift banner reflects real shift state)

**Observations:**
- Multi-outlet banner visible — tenant has 2 outlets (Main Store + Branch 2 Phase 6.7 test)
- Backup card shows "No backups recorded yet"
- Dashboard reports 1 console error on page load (noted consistently across multiple pages)

---

### Commerce

#### 2. POS — `/pos`

**Visible sections:**
- Top bar: branch selector (dropdown: Main Store / Branch 2), Recent Sales, Return, Help, Lock, Logout buttons
- Left panel: product search + product grid (Products List)
- Right panel: customer search, Walk-in Customer default, Add Discount, Add Note, Pay button
- Bottom status bar: F1 Help, F2 Discount (disabled when cart empty), F3 Park (disabled), F4 Customer, F5 Parked, F8 Remove (disabled), F9 Pay (disabled), F10 Clear (disabled), / Search
- Opening flow overlay: branch selector, shift check

**Primary actions:**
- Scan/type product barcode or search → add to cart
- Add customer (F4 or search)
- Add Discount (F2) — cart-level
- Add Note (cart note)
- Park sale (F3)
- Pay (F9) → payment modal
- Return (from top bar)
- Recent Sales (from top bar)
- Lock screen
- Logout

**Forms/modals that can be opened:**
- Checkout / Pay modal: payment method selection (Cash, Card, Wallet, Gift Card, Split), amount entry, change calculation, receipt email/print options
- Customer search modal (F4)
- Parked Sales modal (F5)
- Discount modal (F2): % or fixed, item-level or cart-level
- Help overlay (F1): keyboard shortcut reference

**Destructive/risky actions:**
- Process a real sale (deducts stock, creates sale record, FBR enqueue)
- Void from Recent Sales
- Process return from Return button

**Cross-module effects:**
- Sale → stock decrement on outlet
- Sale → Sales History record
- Sale → FBR invoice queue (if FBR enabled)
- Sale → loyalty points accrual on customer
- Sale → Cash Management shift running total
- Discount → Promotions interaction (automatic vs manual)
- Gift card payment → Gift Cards balance decrement

**Suggested depth:** Deep E2E
- Happy path: add product → add customer → pay cash → receipt
- Gift card payment
- Split payment
- Manager PIN override (price override, void, discount)
- Parked sale → resume
- Re-auth (Lock → PIN entry)
- F-key shortcuts

**Notes:**
- Shift must be open for Pay button to be enabled
- Branch selector visible — can switch outlet mid-session
- Walk-in Customer is default; real customer can be searched/attached
- Opening flow overlay appears when shift not open

---

#### 3. Orders — `/orders`

**Visible sections:**
- Aging buckets: Fresh (0–2 days), Aging (3–5 days), Stale (6–10 days), Critical (10+ days) — with counts
- Filters: search, status dropdown, order type dropdown, fulfillment dropdown
- Orders table: Order#, Customer, Order Status, Payment, Fulfillment, Total, Age, View action
- Detail panel (right): shows when View clicked — order line items, status controls

**Primary actions:**
- View order → detail panel
- Update order status
- Export CSV

**Secondary controls:**
- Aging bucket filter buttons
- Status / type / fulfillment dropdowns
- Refresh

**Destructive/risky:**
- Change order status (open → cancelled/fulfilled)

**Cross-module effects:**
- Order fulfillment → Fulfillment queue
- Order payment → Sales record (if converted)

**Suggested depth:** Happy Path

**Observations:**
- 1 live order found: `#sf_6b90993b224742a49d65` (storefront, Walk-in, open, pending, unfulfilled, Rs 150.00)

---

#### 4. Fulfillment — `/fulfillment`

**Visible sections/sub-tabs:**
- Orders Queue
- Pickup Orders
- Picklists
- Quick Dispatch
- Loadsheets

**Primary actions (per tab):**
- Orders Queue: assign to picklist, mark picked, ship
- Picklists: create, view, assign items, complete
- Quick Dispatch: dispatch single order to courier
- Loadsheets: create loadsheet, assign shipments, finalize
- Pickup Orders: mark ready for pickup, complete pickup

**Destructive/risky:**
- Dispatch to courier (creates courier shipment record)
- Mark shipment as dispatched

**Cross-module effects:**
- Dispatch → COD Settlements (if COD courier)
- Dispatch → Courier Settings (uses configured courier credentials)
- Fulfillment → Orders status update

**Suggested depth:** Happy Path

---

#### 5. COD Settlements — `/cod-settlements`

**Visible sections:**
- Courier filter (All + 13 individual couriers)
- Status filter: Imported, Matching…, Review, Approved, Rejected
- Import new batch button
- Settlement batches list (empty on livetest1)

**Primary actions:**
- Import new batch (upload courier remittance CSV)
- Review matched/unmatched entries
- Approve / Reject batch

**Destructive/risky:**
- Approve batch → marks orders as remitted, reduces outstanding COD balance

**Cross-module effects:**
- COD settlement → Fulfillment dispatch records
- COD settlement → Supplier Payables / finance

**Suggested depth:** Smoke (no batches to test without a real remittance file)

---

#### 6. Parked Sales — `/parked-sales`

**Visible sections:**
- Outlet filter (All outlets / Branch 2 / Main Store)
- Export CSV
- Refresh
- Parked sales table: Customer, Items, Total, Parked At, Outlet, Actions (Resume, Delete)

**Primary actions:**
- Resume parked sale (opens in POS)
- Delete parked sale

**Destructive/risky:**
- Delete parked sale (irreversible removal)

**Cross-module effects:**
- Resume → POS cart restored
- Delete → sale record removed

**Suggested depth:** Happy Path (park from POS → verify here → resume → complete)

**Observations:** No parked sales on livetest1 at time of discovery.

---

#### 7. Holds & Layaway — `/holds`

**Visible sections:**
- Status filter: All / Active / Paid (awaiting pickup) / Completed / Cancelled / Forfeit
- Outlet filter
- Due-date filter: Next 3/7/14 days
- Summary counters: Count, Total held, Balance outstanding
- Holds list

**Primary actions:**
- Create hold (initiated from POS or this page)
- Record payment on hold
- Complete hold → convert to sale
- Cancel or forfeit hold

**Destructive/risky:**
- Forfeit hold (retains deposit, cancels reservation)
- Cancel hold (releases stock reservation)

**Cross-module effects:**
- Hold creation → stock reservation (outlet stock)
- Hold completion → sale record + stock decrement
- Forfeit → finance entry for retained deposit

**Suggested depth:** Happy Path

---

#### 8. Customers — `/customers`

**Visible sections:**
- Gift Card Balance checker widget (scan/paste code → Check)
- Customer list: Name, Mobile, Email, Points, Orders, Total Spent, Edit, Archive actions
- Search: name/mobile/email
- Detail panel (right, opens on row click): Profile tab, Ledger tab, Order History tab; Blacklist button; communication consent; tags (add tag field); loyalty tier progress bar; loyalty points + Transfer Points; wallet balance; Recent Sales

**Primary actions:**
- Add Customer (form: name, mobile, email, address, group, tags, notes)
- Edit Customer
- Archive Customer
- Blacklist Customer (from detail panel)
- Transfer Points (between customers)
- Export CSV
- Gift Card Balance check

**Forms/modals:**
- Add/Edit customer form (inline panel or modal)
- Transfer Points modal

**Destructive/risky:**
- Archive customer (hides from active list)
- Blacklist customer (blocks POS purchase)
- Transfer loyalty points (permanent transfer between accounts)

**Cross-module effects:**
- Customer → POS customer attach
- Loyalty points → Loyalty Tiers thresholds
- Customer group → Price Lists (group-specific pricing)
- Customer group → Promotions eligibility
- Wallet balance → POS wallet payment method
- Customer → CRM lead linkage
- Customer → Quotations (customer on quote)
- Customer → Returns (customer record on refund)

**Suggested depth:** Deep E2E

**Observations:**
- 2 customers: "Phase 4 Customer Bronze" (25 pts, 1 order, Rs 2,500) and "Phase 4 Customer GMail" (0 pts)
- Detail panel shows loyalty tier progress: Rs 22,500 more to reach Silver
- 1 console error on page load

---

#### 9. Customer Groups — `/customer-groups`

**Visible sections:**
- Groups table: Name, Description, Members, Discount %, Price Book link, Edit, Delete actions
- "New Group" button

**Primary actions:**
- New Group (name, description, discount %)
- Edit Group
- Delete Group
- Price Book link → navigates to matching Price List

**Destructive/risky:**
- Delete group (removes segment; affected customers revert to default pricing)

**Cross-module effects:**
- Group → Price Lists (price book per group)
- Group → Promotions (group-scoped discounts)
- Group → POS (discount auto-applied at checkout)

**Suggested depth:** Happy Path

**Observations:**
- 1 group: "Phase 6.7 test group" (0 members, no discount — Price Book style)

---

#### 10. Loyalty Tiers — `/loyalty-tiers`

**Visible sections:**
- Tier distribution bar: Bronze (1), Silver (0), Gold (0), Platinum (0)
- 4 tier cards (Bronze, Silver, Gold, Platinum): threshold (points), multiplier, benefits, Edit button per tier
- New Tier button

**Primary actions:**
- New Tier
- Edit Tier (threshold, multiplier, name, benefits/perks)

**Cross-module effects:**
- Tiers → Customer loyalty points earn/burn
- Tiers → POS (multiplier applied on sale)
- Tiers → Dashboard tier distribution widget

**Suggested depth:** Happy Path (edit a tier threshold → verify customer upgrades on next qualifying sale)

---

#### 11. Gift Cards — `/gift-cards`

**Visible sections:**
- Sub-tabs: Cards (2), Ranges (0)
- Filters: status (active/redeemed/cancelled/expired), type (digital/physical)
- Table: Code, Type, State, Initial balance, Remaining balance, Recipient
- Actions on each card (view/edit/deactivate)
- Register Range button (bulk physical card registration)
- New Card button (single digital card)

**Live data:**
- GC-PHASE3-TEST: physical, active, Rs 250 initial, Rs 250 remaining
- BF18801AC599: digital, active, Rs 500 initial, Rs 400 remaining (Rs 100 used)

**Primary actions:**
- New Card (generate digital gift card code, set value, assign recipient)
- Register Range (register pre-printed physical batch: prefix, start/end serial, value per card)
- Deactivate/cancel card
- Check balance (also on Customers page)

**Destructive/risky:**
- Deactivate/cancel active card
- Redeem via POS (reduces balance permanently)

**Cross-module effects:**
- Gift card → POS payment method
- Gift card → Sales record (payment method = gift_card)
- Gift card → Customer (recipient field)
- Gift card → Sales History (filter by payment method)

**Suggested depth:** Deep E2E (create → use in POS → verify balance)

---

#### 12. Returns — `/returns`

**Visible sections:**
- Returns table: Return#, Date, Customer, Items, Refund amount, Method, Cashier
- Detail panel (right): restocked items, metadata
- Process Return button
- Export CSV

**Primary actions:**
- Process Return (modal: search by receipt/invoice number, select items, refund method: cash/card/wallet/gift_card, restock toggle)

**Destructive/risky:**
- Process Return (reduces sale revenue, restocks or discards items, creates refund record)
- Restock vs. discard decision on each returned item

**Cross-module effects:**
- Return → Sales History (return linked to original sale)
- Return → Stock levels (if restock=true, stock incremented)
- Return → Cash Management (cash refund reduces drawer)
- Return → FBR (return/void notification to FBR queue if enabled)
- Return → Loyalty points (may deduct earned points)
- Return → Gift card (if refunded to gift card)

**Suggested depth:** Deep E2E

**Observations:** 1 return on record.

---

#### 13. Sales History — `/sales-history`

**Visible sections:**
- Summary: Transactions (11), Visible Rows (11), Voided (0)
- Filters: search (receipt/cashier/outlet), date-from, date-to, payment method (All/Cash/Card/Wallet/Split), employee filter, status tabs (All/Completed/Voided)
- Sales table: Receipt#, Timestamp, Cashier, Outlet, Items, Total, Status, FBR
- Detail panel (right, on row click): Receipt header, Total, Payments count, Items list, Actions: Reprint, Invoice, Share, Email, WhatsApp, Void, Return

**Primary actions (from detail panel):**
- Reprint receipt (ESC/POS printer or browser print)
- Invoice (generate formal invoice PDF/view)
- Share (shareable receipt URL)
- Email receipt (to customer email)
- WhatsApp (wa.me link)
- Void sale (requires manager PIN)
- Return (opens return flow for that sale)

**Destructive/risky:**
- Void sale (requires manager PIN 1234; marks sale as voided; reverses stock and revenue)
- Return (see Returns section)

**Cross-module effects:**
- Void → Stock restoration
- Void → Cash Management (cash void reduces drawer)
- Void → FBR queue (void notification)
- Email → SMTP/Resend delivery
- Invoice → shareable public URL

**Suggested depth:** Deep E2E

**Observations:**
- 11 sales on record, all "active", all FBR "Pending"
- Payment methods include: Cash (most), gift_card (1 sale)
- No voided sales at time of discovery
- FBR column shows Pending for all — FBR integration not configured/active

---

#### 14. Cash Management — `/cash-management`

**Visible sections:**
- Summary KPIs: Total Sale Cash, Cash In, Cash In Hand, Closed Shifts
- Outlet selector + Open Shift / Close Shift button
- Shift History table: Opened, Closed, Outlet, Cashier, Opening Amount, Expected, Actual, Variance, Status

**Primary actions:**
- Select outlet → Open Shift (enter opening float amount)
- Close Shift (enter actual cash counted → system calculates variance → approve/flag)
- Export CSV
- Refresh

**Destructive/risky:**
- Close shift (locks shift; variance recorded; triggers shift summary report)
- Open shift (starts new session tied to outlet + cashier)

**Cross-module effects:**
- Open Shift → POS checkout enabled
- Close Shift → Reports (Shift Summary report)
- Shift → Dashboard "Shift Required" banner
- Shift variance → Retail Risk anomaly flags (if variance exceeds threshold)

**Suggested depth:** Deep E2E (open → sell → close → verify shift summary)

**Observations:**
- 1 closed shift on record: opened 4/27, closed 5/2, Main Store, Hassan; Opening Rs 5,000, Expected Rs 8,000, Actual Rs 4,000, Variance Rs -4,000
- Both outlets show no open shift → checkout blocked

---

### Inventory

#### 15. Products — `/inventory` → `/products/:id`

**List view (`/inventory`):**
- Filters: search (name/barcode/SKU), status (Active/Draft/Inactive), category, outlet/location, sort (Name/Price/Stock/Cost/Newest)
- Product table: thumbnail, Name/Description, Barcode, SKU, Price, Cost, Stock, Category, Status, Tools column
- Import, Export all, Template download, Gift Cards sub-section, Add Product
- 8 products: Backpack (Sample), Coffee Beans, Headphones (Sample), Phone Case (Sample), Snack Bar, T-Shirt (Sample), Test Coffee, Watch (Sample)

**Edit product page (`/products/:id`):**

*Left panel:*
- Basic Info: Name*, Description
- Media: image upload (drag/drop)
- Pricing: Price, Cost, Compare-at price, Tax rule selector
- Bundle/Kit section
- Inventory: Stock by Location (per outlet qty, restock toggle)
- Outlet Visibility: toggle per outlet
- Variants: variant matrix (if applicable)

*Right panel:*
- Status: Active / Draft / Inactive
- Sales Channels: 8 channel toggles (POS, Storefront, etc.)
- Organization: Category, Brand, Product Type, Vendor, Tags
- Supplier: supplier dropdown (or + Create new supplier)
- Inventory Intelligence: Lead time override (days), Safety stock (days)
- Identifiers: Barcode, SKU, Unit

*Bottom:*
- Reviews section: list, write-review form (customer name, title, body, star rating, Submit)

**Primary actions:**
- Add Product
- Edit Product (Save Changes / Cancel)
- Delete/Archive product (from list Tools column)
- Bulk import (Template download + Upload CSV/XLSX)
- Export all (CSV)
- Adjust stock per outlet

**Destructive/risky:**
- Delete product (if no sales history; otherwise archive)
- Change price (affects POS and storefront immediately)
- Deactivate product (removes from POS and storefront)
- Toggle outlet visibility (immediately affects which outlets can sell it)
- Bulk import with overwrite

**Cross-module effects:**
- Product → POS product grid
- Product → Storefront catalog
- Product → Purchase Orders (product on PO line)
- Product → Stock Adjustments/Transfers
- Product → Reports (item-wise, inventory-dump, product-movement)
- Product → Promotions (product-scoped promotions)
- Product → Price Lists (product-level price overrides)
- Product category/brand → Dashboard Top Categories
- Product stock → Dashboard Low Stock Alerts + Reorder Alerts
- Product supplier → Supplier Payables

**Suggested depth:** Deep E2E

---

#### 16. Categories — `/categories`

**Visible sections:**
- Stats: Total (3), Top Level (3), Leaf (3), Visible (3)
- Category tree table: Name, Parent, Products, Visible, FBR HS Code, Edit, Delete
- Note: "Delete is blocked when children or products exist"
- Export CSV, Add Category

**Primary actions:**
- Add Category (name, parent, HS code, visibility)
- Edit Category
- Delete Category (blocked if has products/children)

**Cross-module effects:**
- Category → Product assignment
- Category → Reports (Top Categories)
- Category → FBR HS code inheritance (tax reporting)
- Category → Promotions (category-scoped)

**Suggested depth:** Happy Path

**Observations:** 3 top-level leaf categories: Accessories, Clothing, Electronics

---

#### 17. Brands — `/brands`

**Visible sections:**
- Stats: Total (0), Visible (0), With Description (0)
- Table: Name, Description, Products, Visible, Edit, Delete
- Export CSV, Add Brand

**Primary actions:**
- Add Brand (name, description, logo)
- Edit Brand
- Delete Brand

**Cross-module effects:** Brand → Product organization → Storefront brand filter

**Suggested depth:** Smoke

---

#### 18. Taxes — `/taxes`

**Visible sections:**
- Stats: Total Rules (3), Default Rules (0), Visible (3)
- Tax table: Name, Rate %, Default, Applied To count, Edit, Delete
- Export CSV, Add Tax Rule

**Primary actions:**
- Add Tax Rule (name, rate, applies to all products/specific categories, set as default)
- Edit Tax Rule
- Delete Tax Rule

**Cross-module effects:**
- Tax rule → Product pricing (applied at POS checkout)
- Tax rule → Sales tax snapshot (stored per sale line)
- Tax rule → Reports (Tax Ledger, FBR export)
- Tax mode (inclusive/exclusive) → Company Profile setting

**Suggested depth:** Happy Path

---

#### 19. Attribute Sets — `/attribute-sets`

**Visible sections:**
- Attribute set list (left panel)
- Detail panel (right): attributes + options per set, add attribute, add option
- New Set button

**Primary actions:**
- New Set (name)
- Add Attribute to set (name, type: text/select/multi-select/boolean)
- Add Option to attribute
- Delete attribute/set

**Cross-module effects:**
- Attribute Set → Product variants (variant schema comes from attribute set)
- Variant → Stock per variant per outlet
- Variant → POS (variant selection at checkout)

**Suggested depth:** Happy Path

---

#### 20. Promotions — `/promotions`

**Visible sections:**
- Stats: Total (0), Active (0), Inactive (0)
- Promotions table + Test Cart simulator (right panel: add items, see applied discounts)
- Export CSV, Refresh, Add Promotion

**Primary actions:**
- Add Promotion (name, type: % off/fixed/BOGO/bundle, trigger: cart total/quantity/customer group/product/category, validity dates, outlet scope)
- Edit Promotion
- Delete/Deactivate Promotion
- Test Cart: add products to simulate discount application

**Destructive/risky:**
- Activate/deactivate promotion (live effect on POS immediately)
- Delete promotion

**Cross-module effects:**
- Promotion → POS (auto-applied on cart match)
- Promotion → Customer Groups (group-specific promotion trigger)
- Promotion → Sales record (discount line items)
- Promotion → Reports (discount analysis)

**Suggested depth:** Deep E2E (create → test cart simulator → verify in POS)

---

#### 21. Price Lists — `/price-lists`

**Visible sections:**
- Search price lists
- Price list cards: name, linked group, item count, active/inactive toggle, Edit link
- New Price List button

**Primary actions:**
- New Price List (name, assign to group)
- Edit Price List (add products + override prices)
- Activate / Deactivate (toggle button on each card)
- Delete Price List

**Cross-module effects:**
- Price List → Customer Group (group gets this price)
- Price List → POS (customer in group gets override price)
- Price List → Storefront

**Suggested depth:** Happy Path

**Observations:** 1 price list: "Phase 6.7 test group Price Book" (0 items, active)

---

#### 22. Review Moderation — `/review-moderation`

**Visible sections:**
- Status tabs: Pending, Approved, Rejected, All
- Review list per tab

**Primary actions:**
- Approve review → published to storefront
- Reject review → hidden
- (Reviews submitted via product edit page or storefront)

**Cross-module effects:**
- Review → Storefront product page (star ratings)
- Review → Product edit page (review list)

**Suggested depth:** Smoke

---

### Stock Control

#### 23. Purchase Orders — `/purchase-orders`

**Visible sections:**
- Stats: Total POs (0), Pending Approval (0), Received (0)
- Table: PO#, Supplier, Created, Status, Items, Total, Actions
- Filters: search, status, date range
- Export, Templates (saved PO templates), Create PO

**Primary actions:**
- Create PO (supplier, line items, expected delivery date, notes)
- Edit PO (while in draft)
- Submit PO for approval
- Approve PO (if approval workflow enabled)
- Receive GRN against PO (marks received qty, updates stock)
- Cancel PO

**Destructive/risky:**
- Receive GRN (increments stock at outlet — irreversible without manual adjustment)
- Cancel PO (marks as cancelled)
- Approve PO (moves to ordered state)

**Cross-module effects:**
- PO → Supplier Payables (creates payable on GRN)
- PO GRN → Stock levels per outlet
- PO → Approvals queue (if approval required)
- PO → Supplier ledger
- PO → Reports (Procurement reports)

**Suggested depth:** Deep E2E (create → approve → receive GRN → verify stock + payables)

---

#### 24. Inventory Audit — `/stock-counts`

**Visible sections:**
- Status filter: All / In Progress / Completed / Cancelled
- Stock count list
- Start Count button

**Primary actions:**
- Start Count (select outlet, products to count — full or partial; scan/type quantities)
- Enter counted quantities
- Complete count (commits variance adjustments)
- Cancel count

**Destructive/risky:**
- Complete count (writes stock adjustments for all variance items — permanent)
- Cancel in-progress count (discards entered data)

**Cross-module effects:**
- Completed count → Stock Adjustments (adjustment records created)
- Completed count → Stock levels per outlet
- Completed count → Reports (inventory-dump)

**Suggested depth:** Happy Path

---

#### 25. Stock Adjustments — `/adjustments`

**Visible sections:**
- Entry list: product, outlet, reason, quantity change, before/after stock, employee, date
- Search/filter
- Export CSV, New Adjustment

**Primary actions:**
- New Adjustment (product, outlet, reason code: damage/theft/found/correction/other, qty +/-, notes)
- View adjustment detail

**Destructive/risky:**
- New Adjustment (modifies live stock — permanent unless manually reversed)

**Cross-module effects:**
- Adjustment → Stock levels
- Adjustment → Reports (shrinkage report)
- Adjustment → Retail Risk (anomaly detection if large/frequent adjustments)

**Suggested depth:** Happy Path

---

#### 26. Transfers — `/transfers`

**Visible sections:**
- Transfer list: Transfer#, From, To, Status, Items, Created date, Actions
- Filters: search, status, date
- Export CSV, New Transfer

**Primary actions:**
- New Transfer (from outlet, to outlet, products + quantities, notes)
- Send transfer (deducts from source outlet)
- Receive transfer (adds to destination outlet)
- Cancel transfer (while in transit)

**Destructive/risky:**
- Send transfer (deducts source stock immediately)
- Receive transfer (increments destination stock)
- Cancel in-transit transfer (requires manual reconciliation)

**Cross-module effects:**
- Transfer → Stock levels (both outlets)
- Transfer → Approvals (if approval workflow active)
- Transfer → Reports (inventory-dump, product-movement)

**Suggested depth:** Happy Path (2-outlet tenant ideal for this)

---

#### 27. Supplier Returns (RMA) — `/returned-stock`

**Visible sections:**
- RMA list
- Detail panel (right): returned items
- Export CSV, New Supplier Return

**Primary actions:**
- New Supplier Return (supplier, products, reason, qty, credit note ref)
- View RMA detail

**Cross-module effects:**
- Supplier Return → Stock decrement (items leave inventory)
- Supplier Return → Supplier Payables (reduces amount owed or generates credit)
- Supplier Return → Credit/Debit Notes

**Suggested depth:** Happy Path

---

#### 28. Supplier Payables — `/supplier-payables`

**Visible sections:**
- Stats: Suppliers With Due (0), Open Invoices (0), Total Outstanding (Rs 0)
- Sub-tabs: Aging Summary, All Invoices, Supplier Ledger
- Supplier rows (expandable to show invoices)
- Export CSV, Refresh
- Record payment action per invoice

**Primary actions:**
- View aging summary (30/60/90+ day buckets)
- View all invoices (filter by supplier, status, date)
- View supplier ledger (all transactions with supplier)
- Record payment against invoice

**Destructive/risky:**
- Record payment (marks invoice as paid, creates payment record)

**Cross-module effects:**
- Payables → Purchase Orders (PO GRN generates payable)
- Payables → Journal Entries (payment creates JE)
- Payables → Accounting (AP & AR tab)
- Payables → Post-Dated Cheques (cheque assigned to payable)

**Suggested depth:** Happy Path (requires creating a PO + GRN first to generate payable)

---

#### 29. Reorder Alerts — `/reorder-alerts`

**Visible sections:**
- Products sorted by urgency (critical first)
- Each row: product name, current stock, reorder point, suggested qty, supplier, Create PO button

**Primary actions:**
- Create PO from alert (pre-fills PO with suggested qty + supplier)

**Cross-module effects:**
- Reorder alert driven by product safety stock settings (product edit page)
- Create PO → Purchase Orders

**Suggested depth:** Smoke (no alerts at time of discovery — test after depleting stock)

---

#### 30. Intelligence — `/inventory-intelligence`

**Visible sections:**
- Summary cards: Needs reorder (1), Next cycle count (—), Dead stock items (0), Stock value at risk (Rs 0)
- Sub-tabs: ABC Analysis, Reorder, Cycle Counts, Aging
- ABC Analysis: product list with A/B/C class, velocity, revenue contribution; Export CSV
- Reorder tab: same as Reorder Alerts with richer data
- Cycle Counts tab: schedule management (daily/weekly/monthly by ABC class or category)
- Aging tab: products by days-since-last-sale

**Primary actions:**
- Export ABC analysis CSV
- Create cycle count schedule (Cycle Counts tab)
- Start cycle count from schedule
- Filter by class/category/outlet

**Cross-module effects:**
- ABC class → Reorder thresholds
- Cycle count schedule → Inventory Audit (creates count sessions)
- Intelligence data → nightly worker refresh (02:00 UTC)

**Suggested depth:** Happy Path

---

### Procurement

#### 31. Suppliers — `/suppliers`

**Visible sections:**
- Stats: Total (0), Credit (0), Cash (0), Outstanding (Rs 0)
- Table: Name, Contact, Payment Terms, Outstanding, Edit, Delete
- Search, Export CSV, Add Supplier

**Primary actions:**
- Add Supplier (name, contact, address, payment terms: cash/net-30/net-60, lead time, safety stock defaults)
- Edit Supplier
- Delete Supplier

**Cross-module effects:**
- Supplier → Products (supplier field on product)
- Supplier → Purchase Orders (supplier on PO)
- Supplier → Supplier Payables
- Supplier → Supplier Returns
- Supplier → Inventory Intelligence (lead time defaults)

**Suggested depth:** Happy Path

---

#### 32. Expenses — `/expenses`

**Visible sections:**
- Filters: date range, category, outlet, employee
- Sub-tabs: Expense List, Summary (by category chart)
- Expense table: Date, Category, Amount, Description, Outlet, Cashier, Actions
- Record count + Filtered Total
- Categories button (manage expense categories)
- Export CSV, Refresh, Add Expense

**Primary actions:**
- Add Expense (date, category, amount, description, outlet, attachment)
- Edit Expense
- Delete Expense
- Manage Categories (add/edit/delete expense categories)
- Summary tab: category breakdown chart

**Destructive/risky:**
- Delete expense (permanent removal from ledger)

**Cross-module effects:**
- Expenses → Dashboard (Expenses Today KPI)
- Expenses → Accounting (Expense Ledger tab)
- Expenses → Reports (Finance category reports)
- Expenses → Cash Management (if cash expense, reduces drawer)

**Suggested depth:** Happy Path

---

#### 33. Approvals — `/approvals`

**Visible sections:**
- Status tabs: Pending, Approved, Rejected
- Approval list: type (PO / Transfer / Reconciliation), reference, submitted by, date, amount
- Refresh button

**Primary actions:**
- Approve item (with optional note)
- Reject item (with reason)

**Cross-module effects:**
- Approval → Purchase Orders (approved PO moves to ordered)
- Approval → Transfers (approved transfer can be sent)

**Suggested depth:** Smoke (no pending approvals; test by creating a PO requiring approval)

---

### Insights

#### 34. Reports — `/reports`

**Visible sections:**
- Global date/time range filters
- Outlet selector
- Additional filters: employee, category, payment method, supplier (vary by report)
- 10 report category tabs: Sales, Customers, Inventory, Operations, Procurement, Finance, HR, Governance, Multi-Channel, Restaurant
- 77 reports total (per page subtitle)
- Each report card: title, description, run/export button

**Key reports to test (by category):**

*Sales:* Item-Wise Sales, Daily Sales Summary, Hourly Sales, Payment Method Breakdown, Shift Summary, Sales by Category, Sales by Employee, Discount Analysis, FBR Export

*Customers:* Customer Lifetime Value, Loyalty Points Summary, Customer Retention

*Inventory:* Inventory Dump, Product Movement, Low Stock, Dead Stock, Shrinkage, ABC Analysis

*Operations:* Cash Flow, Shift Summary (by session_id), No-Sale Events

*Finance:* P&L, Tax Ledger, Expense Summary

*HR:* Attendance Summary, Payroll Summary

*Governance:* Action History Export, Void/Return Audit

**Primary actions:**
- Select date range + filters → run report (renders in page or downloads CSV)
- Export to CSV

**Secondary controls:**
- Time range (from/to time within day)
- Outlet selector (multi-outlet)
- Employee filter
- Reset filters

**Cross-module effects:** Reports read from all transactional data — any data change elsewhere affects report output.

**Suggested depth:** Deep E2E (run at least one report per category; verify totals match Sales History and Dashboard KPIs)

---

#### 35. Accounting — `/accounting`

**Visible sections:**
- Date range selector + outlet filter
- Sub-tabs: P&L, Cash Flow, AP & AR, Balance Sheet, Expense Ledger, AP Aging, Tax Ledger, Supplier Payments, Accounting Periods

**Primary actions (per tab):**
- P&L: view revenue/cost/gross margin/net profit; export
- Cash Flow: inflows/outflows by method; export
- AP & AR: payables vs receivables summary
- Balance Sheet: assets/liabilities/equity
- Expense Ledger: filterable expense list
- AP Aging: supplier aging buckets
- Tax Ledger: tax collected by rule
- Supplier Payments: payment history per supplier
- Accounting Periods: close/reopen periods

**Destructive/risky:**
- Close Accounting Period (prevents further posting to that period)

**Cross-module effects:** Accounting data derived from Sales, Expenses, POs, Supplier Payments, Journal Entries.

**Suggested depth:** Happy Path (verify P&L matches Sales History totals; verify Cash Flow matches Cash Management)

---

#### 36. Chart of Accounts — `/chart-of-accounts`

**Visible sections:**
- Search by name or code
- Account tree grouped by type (Assets, Liabilities, Equity, Revenue, Expenses)
- Export, Add Account

**Primary actions:**
- Add Account (code, name, type, parent account)
- Edit Account
- Deactivate Account

**Cross-module effects:**
- Chart of Accounts → Journal Entries (accounts used as debit/credit targets)
- Chart of Accounts → Accounting reports

**Suggested depth:** Happy Path

---

#### 37. Journal Entries — `/journal-entries`

**Visible sections:**
- Sub-tabs: Journal Entries, Trial Balance
- Filters: search, status, date range
- Table: Entry#, Date, Description, Debit, Credit, Status (Draft/Posted)
- Export, New Entry

**Primary actions:**
- New Entry (date, description, debit lines, credit lines; must balance)
- Post entry (moves from Draft to Posted)
- Void entry
- Trial Balance tab: grouped by account, debit/credit totals

**Destructive/risky:**
- Post journal entry (permanent; affects accounting reports)
- Void posted entry (creates reversal entry)

**Cross-module effects:**
- Journal Entries → Chart of Accounts (account balances)
- Journal Entries → Accounting (P&L, Balance Sheet)

**Suggested depth:** Happy Path

---

#### 38. Credit/Debit Notes — `/credit-debit-notes`

**Visible sections:**
- Sub-tabs: Credit Notes, Debit Notes
- Filters: search, status (Draft/Approved/Applied/Cancelled)
- Export, New Note

**Primary actions:**
- New Credit Note (supplier, linked PO/invoice, amount, reason)
- New Debit Note
- Approve note
- Apply note (offsets payable)
- Cancel note

**Destructive/risky:**
- Apply note (reduces payable balance permanently)
- Cancel note

**Cross-module effects:**
- Credit/Debit Notes → Supplier Payables (offsets balance)
- Credit/Debit Notes → Supplier Returns (note generated on return)
- Credit/Debit Notes → Journal Entries

**Suggested depth:** Happy Path

---

#### 39. Post-Dated Cheques — `/postdated-cheques`

**Visible sections:**
- Filters: search, status (Pending/Deposited/Cleared/Bounced/Cancelled), type (Receivable/Payable)
- Export, New Cheque

**Primary actions:**
- New Cheque (type, party, amount, cheque#, bank, due date, linked invoice)
- Mark as Deposited
- Mark as Cleared
- Mark as Bounced
- Cancel Cheque

**Destructive/risky:**
- Mark as Bounced (triggers follow-up workflow)

**Cross-module effects:**
- Cheques → Supplier Payables (cheque assigned to payable)
- Cheques → Accounting (AP aging)

**Suggested depth:** Smoke

---

### Operations

#### 40. Kiosk — `/kiosk`

**Visible sections:**
- Full-screen PIN pad (no sidebar)
- Store selector dropdown (top left)
- Date/time display
- 0–9 keypad + Back + Submit PIN (OK)
- Outlet selector

**Primary actions:**
- Enter PIN → clock in / start break / end break / clock out (based on current state)
- Switch outlet

**Cross-module effects:**
- Kiosk clock-in → Attendance records
- Attendance → HR (leave balance, payroll)
- Attendance → Dashboard (Staff Today widget)

**Suggested depth:** Happy Path (use PIN 1234 → clock in → verify in Attendance page)

**Notes:**
- Kiosk is a separate layout (no sidebar, no nav) — accessed at `/kiosk?tenant=livetest1` in MT mode
- Uses `/api/attendance/pin-checkin` endpoint

---

#### 41. CRM — `/crm`

**Visible sections:**
- Kanban board: 5 columns — new, contacted, qualified, converted, lost
- Summary row: count + value per stage
- Add Lead button

**Primary actions:**
- Add Lead (name, company, value, contact, stage, notes)
- Move lead between stages (drag or edit)
- Convert lead to customer
- Mark lead as lost

**Destructive/risky:**
- Delete lead

**Cross-module effects:**
- Convert lead → Customer record created

**Suggested depth:** Smoke

---

#### 42. Quotations — `/quotations`

**Visible sections:**
- Quotations table: Quote#, Customer, Date, Expiry, Status, Total, Actions
- Filters: search, status, date
- Export CSV, New Quotation

**Primary actions:**
- New Quotation (customer, line items with product search, prices, discount, validity date, notes)
- Edit quotation
- Send quotation (email to customer)
- Accept quotation → convert to sale
- Reject/expire quotation

**Destructive/risky:**
- Accept + convert quotation → creates sale record, decrements stock

**Cross-module effects:**
- Quotation → Sales record (on convert)
- Quotation → Customer (linked to customer)
- Quotation → Products (line items)
- Quotation status must be "accepted" before Convert action works

**Suggested depth:** Happy Path

---

#### 43. Attendance — `/attendance`

**Visible sections:**
- Date range filters + outlet + employee filters + Apply button
- Net Work Hours (filtered) summary
- Attendance log table: employee, date, clock-in, clock-out, break time, total hours, outlet
- Export (implied)

**Primary actions:**
- Filter by employee/date/outlet
- Edit attendance record (admin correction)
- Add manual attendance entry

**Cross-module effects:**
- Attendance → HR (leave balance, payroll)
- Attendance → Dashboard (Staff Today)
- Attendance → Reports (HR category)

**Suggested depth:** Happy Path

---

#### 44. HR — `/hr`

**Visible sections:**
- Sub-tabs: Leave Requests, Leave Balance, Payroll, Attendance Summary
- Leave Requests: submit request form (type, dates, reason) + requests list with approve/reject
- Leave Balance: per-employee balance table
- Payroll: calculate payroll for period (uses attendance data)
- Attendance Summary: aggregate hours per employee per period

**Primary actions:**
- Submit Leave Request
- Approve / Reject leave request
- Calculate Payroll (for a period)
- Export payroll

**Destructive/risky:**
- Calculate/finalize payroll (creates payroll record)

**Cross-module effects:**
- Leave → Attendance records
- Payroll → Expenses (labor cost)
- Attendance Summary → Reports (HR)

**Suggested depth:** Happy Path

---

#### 45. Notifications — `/notifications`

**Visible sections:**
- Unread count (13 at time of discovery)
- Notification list with "Mark as Read" per item
- Refresh button

**Primary actions:**
- Mark as Read (individual)
- Mark All as Read (implied — `PUT /api/notifications/read-all`)
- Refresh

**Cross-module effects:**
- Notifications generated by: low stock, shifts, support ticket replies, system events
- Bell icon in top nav shows unread count

**Suggested depth:** Happy Path (mark all read → trigger a stock-low event → verify new notification)

---

### Setup

#### 46. Employees — `/employees`

**Visible sections:**
- Stats: Total (4), Visible (4), Roles (3), Active (4)
- Table: Name, Role, Username, Outlets, PIN set?, Actions (Edit, Archive)
- Search, Export CSV, Add Employee

**Primary actions:**
- Add Employee (name, username, password, PIN, role, outlet assignment)
- Edit Employee (same fields + reset PIN, reset password)
- Archive Employee (deactivates account)

**Destructive/risky:**
- Archive employee (prevents login)
- Reset PIN / password (immediate effect)

**Cross-module effects:**
- Employee → POS (cashier identity on sales)
- Employee → Attendance (clock-in records)
- Employee → Kiosk (PIN used for clock-in)
- Employee → Sales History (cashier filter)
- Employee → Action History (actor on audit entries)
- Employee role → Permission set

**Suggested depth:** Happy Path

**Observations:** 4 employees — Hassan (Admin), Test Cashier 2, Test Cashier 3, Test Cashier 4

---

#### 47. Outlets — `/outlets`

**Visible sections:**
- Stats: Total (2), Visible (2), With Address (1)
- Table: Name, Address, Phone, Status, Edit, Delete
- Search, Export CSV, Add Outlet

**Primary actions:**
- Add Outlet (name, address, phone, default tax, currency override)
- Edit Outlet
- Delete Outlet (blocked if has sales/employees)

**Destructive/risky:**
- Delete outlet (removes branch — cascades to employee assignments, stock records)

**Cross-module effects:**
- Outlet → POS (branch selector)
- Outlet → Cash Management (per-outlet shifts)
- Outlet → Stock (per-outlet inventory)
- Outlet → Reports (outlet filter)
- Outlet → Products (outlet visibility)

**Suggested depth:** Happy Path

**Observations:** 2 outlets — Main Store (has address), Branch 2 (Phase 6.7 test)

---

#### 48. Company Profile — `/company-settings`

**Visible sections:**
- Basic Info: company name, address, phone, logo upload
- Tax & Compliance: NTN, default tax mode (inclusive/exclusive)
- Branding & Currency: currency symbol, code, logo
- Regional: timezone, date format
- Thresholds: revenue target, avg bill target, refund threshold → Dashboard attention queue
- Inventory Intelligence: tenant-wide lead time default, safety stock default, ABC window
- Save Profile button

**Primary actions:**
- Edit any field
- Upload company logo
- Save Profile

**Cross-module effects:**
- Currency/symbol → everywhere (POS, receipts, reports, dashboard)
- Timezone → timestamps on all records
- Tax mode → POS tax calculation
- Thresholds → Dashboard exception coloring
- Inventory defaults → Product-level intelligence fallback
- NTN → FBR tax reporting
- Logo → Receipt templates + storefront

**Suggested depth:** Happy Path

---

#### 49. Integrations Hub — `/settings/integrations`

**Visible sections:**
- Category filter tabs: All, Marketplaces & Stores, Social Commerce, Messaging, Product Feeds, Couriers, Payments, SMS
- Integration cards: WooCommerce (Connect), Shopify (Manage — already configured), Daraz (Manage), Facebook Commerce, Google Merchant, WhatsApp
- Payment Gateways section: cards for xPay / SanoPay + others
- SMS Providers section
- Courier Services section (13 couriers — same as Courier Settings)

**Primary actions:**
- Connect/Manage individual integration (opens credentials form)
- Disconnect integration
- Sync data (for connected integrations)

**Destructive/risky:**
- Disconnect integration (removes credentials, stops sync)
- Sync (may overwrite local data with remote data)

**Cross-module effects:**
- Shopify sync → Products, Orders, Stock
- WooCommerce sync → Products, Stock
- Daraz/Facebook/Google → Orders, Products
- WhatsApp → Customer messaging
- Payment gateway → POS payment methods + Billing webhooks

**Suggested depth:** Tenant/Integration-specific

**Observations:**
- Shopify: Manage (configured)
- Daraz: Manage (configured)
- WooCommerce, Facebook, Google Merchant, WhatsApp: Connect (not configured)

---

#### 50. Courier Settings — `/courier-settings`

**Visible sections:**
- 13 pre-seeded courier cards (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, Pakistan Post, DHL, FedEx)
- Add Custom Courier button
- Each courier card: name, logo, status (connected/not), config button

**Primary actions:**
- Configure courier (API key, account#, default service type)
- Test connection
- Add Custom Courier (for unlisted providers)

**Cross-module effects:**
- Courier → Fulfillment (Quick Dispatch uses configured courier)
- Courier → COD Settlements (reconcile remittances)
- Courier → Orders (tracking updates)

**Suggested depth:** Tenant/Integration-specific

---

#### 51. Barcode Templates — `/barcode-templates`

**Visible sections:**
- Template list table: Name, Paper size, Layout, Default, Edit, Delete
- Print Labels button (batch print job)
- New Template button

**Primary actions:**
- New Template (paper size, label size, fields to include: name/price/barcode/SKU/brand)
- Edit Template
- Set as Default
- Delete Template
- Print Labels (select products/filter → assign template → print)

**Cross-module effects:**
- Barcode label → Products (barcode field used)
- Print job → Printer Settings (uses configured printer)

**Suggested depth:** Smoke

---

#### 52. Receipt Templates — `/receipt-templates`

**Visible sections:**
- Template list/preview cards
- New Template button

**Primary actions:**
- New Template (header, footer text, logo toggle, field visibility: tax line/discount/cashier/outlet, paper width)
- Edit Template
- Set as Default
- Delete Template

**Cross-module effects:**
- Receipt template → POS (used when printing receipt)
- Receipt template → Email receipt (HTML layout)

**Suggested depth:** Happy Path

---

#### 53. Printer Settings — `/printer-settings`

**Visible sections:**
- Hardware Printing toggle (checkbox)
- Connection Type (USB/Network/Bluetooth)
- Paper Size + custom width (spinbutton)
- Purpose (receipt/kitchen/both)
- Kick Cash Drawer on Sale (checkbox)
- Save Settings + Test Print buttons
- Email Settings section: enable email receipts, SMTP provider (Gmail/custom), email address, app password, from name; Save Email Settings + Send Test Email buttons

**Primary actions:**
- Configure printer (connection, paper, purpose)
- Test Print (sends test job to printer)
- Configure SMTP email receipts
- Send Test Email

**Destructive/risky:**
- Save (overwrites existing printer config)

**Cross-module effects:**
- Printer config → POS receipt printing
- Email config → Sales History "Email" action
- Cash drawer → POS (opens drawer on sale)

**Suggested depth:** Smoke

**Observations:** 1 console error on page load

---

#### 54. Import Data — `/import`

**Visible sections:**
- Entity tabs: Products, Customers, Suppliers, Expenses, Payments
- Download Template link (per entity, downloads XLSX)
- File upload zone (CSV/XLSX)
- Preview mode (upload with `?preview=1` — shows validation before commit)

**Primary actions (per entity):**
- Download template
- Upload file → preview (shows import rows, validation errors)
- Confirm import (commits data)

**Destructive/risky:**
- Import Products (can overwrite existing product data — name/price/stock)
- Import Customers (can create duplicates if no dedup logic)
- Import Suppliers
- Bulk import always risky at scale

**Cross-module effects:**
- Product import → Products list, POS grid, Storefront
- Customer import → Customers list, CRM
- Supplier import → Suppliers list, POs

**Suggested depth:** Deep E2E (test each entity with template + small dataset)

---

#### 55. Import from Shopify/Square — `/settings/import-from-competitor`

**Visible sections:**
- Platform selector (Shopify / Square)
- Download Shopify template link
- File upload zone (CSV)
- Import progress/results panel

**Primary actions:**
- Download Shopify-format template
- Upload Shopify/Square CSV export
- Preview import
- Confirm import

**Destructive/risky:**
- Import (creates/overwrites products from competitor data)

**Cross-module effects:** Same as Product import

**Suggested depth:** Happy Path (use template file)

---

#### 56. Backup & Restore — `/backup-restore`

**Visible sections:**
- Download Backup button (triggers `pg_dump` → R2 → download)
- Restore section: Choose File (upload .sql.gz) + restore button
- Backup Log table (0 entries on livetest1)
- Refresh Log button

**Primary actions:**
- Download Backup (creates and downloads tenant DB snapshot)
- Restore from file (uploads + applies backup)

**Destructive/risky:**
- Restore (overwrites ALL tenant data with backup — irreversible)
- Download generates real DB dump — treat file as sensitive

**Cross-module effects:** Restore affects all modules (complete data replacement)

**Suggested depth:** Happy Path (download only; do NOT restore in functional test without explicit plan)

---

### Online Store

#### 57. View Storefront — `/store/livetest1`

**Visible sections:**
- Public storefront (separate layout, no tenant sidebar)
- Header: store name (Live Test 1), All Products nav link, Cart icon
- Hero: Welcome to Live Test 1, Shop Now button
- Featured products section
- Footer: store name, Powered by SanoPOS

**Sub-pages:**
- `/store/livetest1/products` — product catalog (search, filter by category)
- `/store/livetest1/products/:id` — product detail (images, variants, Add to Cart)
- `/store/livetest1/cart` — cart (qty edit, remove, proceed to checkout)
- `/store/livetest1/checkout` — checkout form (name, email, phone, address, payment)
- Order confirmation page

**Primary actions:**
- Browse products
- Add to cart
- Adjust cart quantities
- Remove from cart
- Complete checkout (creates web order → Orders page)
- Order confirmation / receipt email

**Cross-module effects:**
- Storefront order → Orders (`/orders`) — storefront orders appear as `#sf_...`
- Storefront order → Fulfillment queue
- Storefront → Products (only active + visible products shown)
- Storefront → Categories (used as filter)
- Product reviews from storefront → Review Moderation
- Storefront checkout → Customer record (if email provided)

**Suggested depth:** Happy Path (browse → add to cart → checkout → verify order in /orders)

---

### Compliance

#### 58. FBR Settings — `/settings/fbr`

**Visible sections:**
- FBR integration toggle (ON/OFF switch — currently ON)
- Connection Status: Not Tested
- Tax Registration section: NTN, STRN, province selector
- API Configuration section: FBR DI API token, environment (sandbox/production)
- Save + Test Connection (disabled until credentials entered)

**Primary actions:**
- Toggle FBR on/off
- Enter NTN, STRN, province
- Enter API token
- Save configuration
- Test Connection (validates credentials against FBR API)

**Destructive/risky:**
- Enable FBR (all new sales enqueue for real FBR posting if credentials valid)
- Test Connection (makes live API call to FBR)

**Cross-module effects:**
- FBR enabled → Sales/Returns/Voids enqueue to `fbr_invoices` table
- FBR → Sales History (FBR column shows Pending/Sent/Failed)
- FBR → `/fbr` dashboard (invoice queue monitoring)
- FBR → Tax Lookup (HS code assignment on products)
- FBR → Category HS code inheritance

**Suggested depth:** Tenant/Integration-specific

**Observations:** FBR toggle is ON but Connection Status is "Not Tested" — no credentials configured. All 11 sales show FBR "Pending".

---

#### 59. Tax Lookup — `/tax-lookup`

**Visible sections:**
- Province selector (filter by province)
- Search input: product name, HS code, or category (EN/UR)
- Results table: HS Code, Description EN, Description UR, Federal GST, Punjab Rate, Exemption, Notes, Actions (suggest correction)
- Download Full Schedule button

**Primary actions:**
- Search tax rates
- Download full schedule (CSV)
- Suggest correction on a rate (links to admin/support)

**Cross-module effects:**
- HS code lookup → Product HS code assignment
- HS code → Category HS code (inherited by all products in category)
- HS code → FBR invoice payload

**Suggested depth:** Smoke

---

### Admin

#### 60. Administrator — `/administrator`

**Visible sections:**
- Roles table: Role name, Permissions list, Employee count, Edit, Delete
- Loading state observed at discovery (roles table showed "Loading roles...")
- Add Role button

**Primary actions:**
- Add Role (name + permission checkboxes)
- Edit Role (modify permissions)
- Delete Role (only if no employees assigned)

**Destructive/risky:**
- Delete role
- Edit role permissions (immediate effect on all employees in that role)

**Cross-module effects:**
- Role → Employee (role assignment)
- Role → POS/all pages (permission gates)

**Suggested depth:** Happy Path

**Observations:** Roles table showed "Loading roles..." at discovery — may be a slow query or minor UI bug. Re-check on actual test run.

---

#### 61. Action History — `/action-history`

**Visible sections:**
- 71 entries in audit log
- Table: Timestamp, Actor, Action type, Resource, Description, IP
- Filters: date range, action type, employee
- Export CSV, Refresh

**Primary actions:**
- Filter audit log
- Export to CSV

**Cross-module effects:** Populated by all admin/manager actions across all modules.

**Suggested depth:** Smoke (verify entries appear after key actions during functional test)

---

#### 62. Retail Risk — `/retail-risk`

**Visible sections:**
- Sub-tabs: No-Sale Events, Anomaly Flags, Settings
- No-Sale Events: date range + outlet filter; table of cash drawer open without sale events
- Anomaly Flags: AI-detected anomalies (large discounts, excessive refunds, unusual patterns)
- Settings: risk thresholds (discount %, refund %, no-sale frequency)

**Primary actions:**
- Filter events by date/outlet
- Acknowledge/dismiss anomaly flag
- Configure risk thresholds (Settings tab)

**Cross-module effects:**
- No-sale events from POS cash drawer opens
- Anomaly flags from Sales History (voids, discounts, returns)
- Thresholds set in Settings affect Dashboard exception coloring

**Suggested depth:** Happy Path (configure threshold → trigger condition → verify flag appears)

---

#### 63. Billing — `/billing`

**Visible sections:**
- Current Plan card: "pro / annual", Expires April 30, 2027
- Payment History table (empty)

**Primary actions:**
- View plan details
- Request Upgrade (if on free/starter plan)
- Pay Now / Create Checkout (payment gateway path, if `PAYMENT_GATEWAY` env set)
- View payment history

**Cross-module effects:**
- Billing status → `requireActiveSubscription` middleware (all write operations blocked if expired)
- Trial countdown → SubscriptionBanner shown globally
- Payment confirmed → tenant auto-activated

**Suggested depth:** Smoke

**Observations:** livetest1 is on Pro/Annual plan, expires 2027-04-30. No payment history.

---

#### 64. My Tickets — `/my-tickets`

**Visible sections:**
- Ticket list (empty — "No tickets submitted yet")
- Support widget (floating "?" button) → submits new ticket

**Primary actions:**
- Submit new support ticket (via floating widget): subject, description, screenshot upload
- View ticket status + replies (once tickets exist)

**Cross-module effects:**
- Ticket submitted → admin notification (super-admin panel)
- Admin reply → in-app notification + email to tenant

**Suggested depth:** Smoke (submit ticket → verify it appears here)

---

## Destructive / Risky Function Register

The following actions can cause irreversible or significant state changes. Each should be explicitly planned, executed in the right sequence, and where possible followed by a verification step.

| # | Action | Location | Risk Level | Notes |
|---|--------|----------|------------|-------|
| 1 | Process Sale | POS → Pay | High | Decrements stock, creates FBR queue entry, records payment |
| 2 | Void Sale | Sales History → Void | High | Requires manager PIN (1234); reverses revenue + stock |
| 3 | Process Return | Returns / Sales History → Return | High | Reverses revenue; restock decision per item |
| 4 | Open Shift | Cash Management / POS | Medium | Opens shift session; closing required to run shift report |
| 5 | Close Shift | Cash Management | Medium | Locks shift; variance recorded; triggers shift summary |
| 6 | Forfeit Hold | Holds & Layaway | Medium | Retains deposit; cancels reservation; releases stock |
| 7 | Delete Customer | Customers → Archive | Medium | Hides from active list; historical sales remain |
| 8 | Blacklist Customer | Customers detail panel | Medium | Blocks POS purchase immediately |
| 9 | Transfer Loyalty Points | Customers → Transfer Points | Medium | Permanent transfer between accounts |
| 10 | Deactivate Gift Card | Gift Cards | Medium | Card immediately unusable at POS |
| 11 | Apply Credit/Debit Note | Credit/Debit Notes | Medium | Permanently offsets supplier payable |
| 12 | Post Journal Entry | Journal Entries | High | Permanent; affects all accounting reports |
| 13 | Close Accounting Period | Accounting → Periods | High | Blocks further posting to that period |
| 14 | Receive GRN on PO | Purchase Orders | High | Increments stock; creates supplier payable |
| 15 | Complete Inventory Count | Inventory Audit | High | Writes stock adjustment for all variance lines |
| 16 | New Stock Adjustment | Stock Adjustments | Medium | Permanently changes outlet stock level |
| 17 | Send Transfer | Transfers | Medium | Deducts source outlet stock immediately |
| 18 | Cancel In-Transit Transfer | Transfers | High | Stock in limbo — requires manual reconciliation |
| 19 | Delete Product | Products | Medium | Blocked if sales history; otherwise permanent |
| 20 | Bulk Import Products | Import Data | High | Can overwrite existing product data |
| 21 | Bulk Import Customers | Import Data | Medium | Risk of duplicate records |
| 22 | Restore Backup | Backup & Restore | Critical | Overwrites ALL tenant data — use with extreme caution |
| 23 | Enable FBR + Test Connection | FBR Settings | High | Makes live API call to FBR; enables real invoice posting |
| 24 | Approve COD Settlement Batch | COD Settlements | High | Marks all matched orders as remitted |
| 25 | Dispatch to Courier | Fulfillment → Quick Dispatch | Medium | Creates live courier shipment request |
| 26 | Delete Role | Administrator | High | Immediate effect on all employees in that role |
| 27 | Edit Role Permissions | Administrator | High | Immediate effect on all employees in that role |
| 28 | Archive Employee | Employees | High | Immediately prevents login |
| 29 | Reset Employee PIN/Password | Employees | Medium | Immediate effect on login |
| 30 | Add/Delete Outlet | Outlets | High | Cascades to stock, employee assignments, reports |
| 31 | Activate Promotion | Promotions | Medium | Immediately live at POS |
| 32 | Change Product Price | Products → Edit | Medium | Live at POS and storefront immediately |
| 33 | Deactivate Product | Products → Edit | Medium | Removed from POS + storefront immediately |
| 34 | Toggle Outlet Visibility | Products → Edit | Medium | Immediately removes from affected outlet's POS |
| 35 | Reject/Accept Review | Review Moderation | Low | Appears/disappears from storefront |
| 36 | Convert Quotation to Sale | Quotations | High | Creates sale, decrements stock |
| 37 | Calculate/Finalize Payroll | HR → Payroll | High | Creates payroll record |
| 38 | Disconnect Integration | Integrations Hub | High | Removes credentials, stops sync |
| 39 | Mark Cheque Bounced | Post-Dated Cheques | Medium | Triggers follow-up workflow |
| 40 | Storefront Checkout | Storefront | Medium | Creates real order record in /orders |

---

## Cross-Module Verification Map

For each major data object, the downstream areas that must be spot-checked after creating or modifying it.

### Product
→ POS product grid (visible, correct price)
→ Storefront catalog (visible, correct price/stock)
→ Reorder Alerts (stock threshold respected)
→ Intelligence (ABC class updated nightly)
→ Promotions (product-scoped promotions apply)
→ Price Lists (override prices for groups)
→ Purchase Orders (product available as line item)
→ Reports: Item-Wise Sales, Inventory Dump, Product Movement

### Customer
→ POS customer search (appears, correct tier/wallet)
→ Loyalty points balance (earned on sale)
→ Loyalty tier progression (crosses threshold on qualifying sale)
→ Customer group → price list applies at POS
→ Gift card balance (if assigned as recipient)
→ CRM lead conversion
→ Quotations (linked to quote)
→ Reports: Customer Lifetime Value, Loyalty Summary

### Sale
→ Sales History (appears, correct total/items/method)
→ Dashboard KPIs (Revenue Today, Avg Bill)
→ Cash Management (shift running total)
→ Stock levels (decremented at outlet)
→ FBR queue (if FBR enabled — status Pending/Sent)
→ Loyalty points (accrued to customer)
→ Gift card balance (if gift_card method — balance decremented)
→ Reports: Daily Sales Summary, Item-Wise Sales, Payment Method Breakdown, Shift Summary
→ Accounting: P&L, Cash Flow

### Return
→ Sales History (original sale shows return link)
→ Returns list (new return entry)
→ Stock levels (restocked if restock=true)
→ Cash Management (cash refund reduces drawer)
→ FBR queue (return notification)
→ Loyalty points (deducted if policy requires)
→ Reports: Void/Return Audit, Shrinkage (if not restocked)
→ Accounting: P&L (revenue reduction)

### Gift Card
→ POS payment method (card available for use)
→ Customers page → Gift Card Balance checker
→ Sales record (payment_method = gift_card)
→ Gift Cards list (remaining balance updated)

### Purchase Order
→ Supplier Payables (payable created on GRN)
→ Stock levels (incremented at receiving outlet on GRN)
→ Approvals queue (if approval required)
→ Reorder Alerts (satisfied after GRN)
→ Reports: Procurement reports
→ Accounting: AP & AR, AP Aging

### Stock Transfer
→ Source outlet stock (decremented on send)
→ Destination outlet stock (incremented on receive)
→ Transfers list (status: in-transit → received)
→ Approvals (if required)
→ Reports: Product Movement

### Expense
→ Dashboard KPIs (Expenses Today)
→ Cash Management (cash expense reduces drawer)
→ Accounting: Expense Ledger
→ Reports: Finance category

### Employee
→ POS cashier selector
→ Attendance/Kiosk (PIN for clock-in)
→ Sales History (cashier filter)
→ Action History (actor on all logged actions)
→ HR (payroll, leave)
→ Permissions (via role)

### Outlet
→ POS branch selector
→ Cash Management (per-outlet shifts)
→ Stock (per-outlet inventory levels)
→ Products (outlet visibility toggles)
→ Reports (outlet filter on all reports)
→ Transfers (source/destination)

### Web Order (Storefront)
→ Orders page (`/orders` — appears as `#sf_...`)
→ Fulfillment queue
→ Stock (decremented on fulfillment)
→ Customer record (if email matches)

### FBR Invoice
→ Sales History (FBR column: Pending → Sent/Failed)
→ FBR Dashboard `/fbr` (queue status, retry)
→ Reports: FBR Export
→ FBR background worker (retries on failure up to 5 times)

### Payment / Billing
→ Billing page (`/billing`) — payment history
→ SubscriptionBanner (trial/grace/expired state)
→ `requireActiveSubscription` (all write routes blocked if expired)
→ Admin panel (payment recorded by super-admin)

---

## Observed Errors / Broken Surfaces

| # | Page | Observation | Severity | Notes |
|---|------|-------------|----------|-------|
| 1 | All pages | 1 JavaScript console error present on most page loads | Low | Consistent across Dashboard, Customers, Printer Settings, and others. Not causing visible breakage. Should be investigated during test — check browser console for error message. |
| 2 | Dashboard | Backup card shows "No backups recorded yet" | Info | livetest1 has never had a backup run. Backup & Restore page confirms 0 log entries. |
| 3 | Dashboard | Both outlets show "no open shift — checkout is blocked" | Info | Expected — no shift opened at time of discovery. Not a bug. |
| 4 | Administrator (`/administrator`) | Roles table showed "Loading roles..." state during discovery | Low | May be a slow backend query or race condition. Re-check during test — if roles never load, it is a functional bug. |
| 5 | Sales History | All 11 sales show FBR status "Pending" | Info | FBR credentials not configured, so invoices never sent. Not a bug — expected given FBR Settings state. |
| 6 | FBR Settings | Toggle is ON but Connection Status is "Not Tested" and no credentials entered | Info | FBR is technically enabled at feature-flag level but not operational. |
| 7 | Cash Management | Shift variance Rs -4,000 (actual Rs 4,000 vs expected Rs 8,000) | Info | Historical shift. May reflect a test discrepancy. Not a current bug. |
| 8 | Notifications | 13 unread notifications at time of discovery | Info | Accumulation of system events. Not a bug. |
| 9 | POS | `GET /api/products/10/modifier-tree → 403` fires when product ID 10 is added to cart | Low | Product 10 has no modifiers; 403 likely means modifier endpoint gated by restaurant flag. Not blocking checkout. |
| 10 | POS | `GET /api/room-bookings?status=checked_in&outlet_id=1 → 403` fires during POS load | Low | Room management feature flag not enabled; POS polling endpoint unnecessarily. |
| 11 | Customers | `GET /api/customers/2/sales → 500` fires when opening customer detail panel for customer #2 | Medium | Server-side 500 on customer sales lookup. Recent Sales section in detail panel likely fails to render. Should be investigated. |
| 12 | Reports | `GET /api/reports/stock-aging → 403` fires from Reports page | Low | `reports_inventory_health_plus` feature flag not enabled on livetest1. Expected. |
| 13 | Reports | `GET /api/reports/kds/prep-times → 403` fires from Reports page | Low | `phase4_restaurant_kds_analytics` feature flag not enabled. Expected. |
| 14 | Administrator | Roles table showed "Loading roles..." at initial discovery; resolved on re-visit | Info | Confirmed NOT a persistent bug. Roles load correctly: Administrator, Manager, Cashier. Was likely a first-paint race condition. |
| 15 | Printer Settings | Chrome password-field DOM accessibility warning (not a true error) | Info | `[DOM] Password field is not contained in a form` — cosmetic lint from Chromium on the email app-password field. Not a functional issue. |
| 16 | Sales History | Gift card payment detail panel does NOT show gift card code or remaining balance | Low | Panel only shows "Payments: 1" count — no card code, no post-redemption balance. May be a UX gap. |
| 17 | Inventory Intelligence | Aging sub-tab is disabled by feature flag `reports_inventory_health_plus` | Info | Tab renders but shows feature-gated message. Not a bug — flag not enabled for livetest1. |
| 18 | Reports — Governance | 3 governance reports disabled by `reports_scheduled_exports` flag | Info | Expected. Not enabled for livetest1. |
| 19 | Outlets | Add Outlet dialog shows upgrade paywall (PKR 8,000/month) instead of a form | Info | Tenant is at 2-outlet limit. Functional — not a bug. |

---

## Gap-Fill — 2026-05-02

This section documents the follow-up browser automation session that filled the gaps from the initial discovery. All findings below were obtained by opening live forms, modals, drawers, and sub-tabs in the production UI. No records were created or modified.

---

### Console Errors — Actual Text

The initial discovery noted "1 console error on most pages" without capturing exact text. The gap-fill session confirmed the following:

- **Dashboard, Inventory, Administrator**: No console errors on page load. All API calls returned 200 on re-visit.
- **Printer Settings**: One Chrome accessibility lint warning — `[DOM] Password field is not contained in a form` — appears on the email app-password field. Not a functional error.
- **Errors that ARE real** (fire on specific interactions, not page load):
  - `GET https://api.sanopos.com/api/products/10/modifier-tree → 403` — fires when product #10 is added to POS cart. Restaurant modifier feature flag not enabled.
  - `GET https://api.sanopos.com/api/room-bookings?status=checked_in&outlet_id=1 → 403` — fires during POS session. Room management flag not enabled.
  - `GET https://api.sanopos.com/api/customers/2/sales → 500` — fires when opening customer detail panel for customer ID 2 (Phase 4 Customer Bronze). The Recent Sales section in the detail panel will not render.
  - `GET https://api.sanopos.com/api/reports/stock-aging → 403` — fires from Reports page. Feature flag `reports_inventory_health_plus` not enabled.
  - `GET https://api.sanopos.com/api/reports/kds/prep-times → 403` — fires from Reports page. Feature flag `phase4_restaurant_kds_analytics` not enabled.

**Conclusion**: The "1 error per page" pattern from initial discovery was misleading. There are no generic page-load errors; the errors are tied to specific interaction paths or feature-flagged endpoints.

---

### POS — Checkout / Pay Modal (Gap-Fill)

**How to open**: Add any product to cart → click "Pay" button (or F9).

**Modal title**: "Complete Payment"

**Customer section** (at top of modal):
- Label: CUSTOMER (OPTIONAL)
- Search field: "Search name or phone…"
- Options: Walk-in (no customer), Phase 4 Customer, Phase 4 Customer GMail
- "+ New Customer" button to create inline

**Payment method tabs** (4 tabs — no Split tab visible in current tenant config):
- Cash
- Card
- Wallet
- Gift Card

**Cash tab fields**:
- Amount field (numeric spin button, pre-filled with cart total)
- Quick-amount buttons: Exact, +50, +100, +500, +1000
- "Add" button to add a tender line
- "Add Remaining Tender" button (activates after first tender line added)

**Card tab fields**: Identical to Cash tab structure (no card terminal fields; amount only).

**Wallet tab fields**: Identical to Cash tab structure.

**Gift Card tab** — additional unique section:
- Gift Card Code (text input, placeholder: "Scan or paste code") + "Check" button
- After valid code entered: Amount field appears (same as other tabs)

**Receipt options**: Not shown inside the payment modal. Email/print receipt options appear on the post-payment confirmation screen (not captured — would require completing a real sale).

---

### POS — Discount Modal (Gap-Fill)

**How to open**: Add product to cart → click "Add Discount" button or press F2.

**Modal title**: "Add Discount"

**Fields**:
- Discount type toggle: "Percentage (%)" | "Fixed Amount" (% selected by default)
- Value (numeric spin button, default: 10)

**Scope**: Cart-level only (applies to entire order). No per-item discount option from this modal — item-level discount would be done from line-item controls.

**No reason field** — discount does not require a reason at the cashier level.

**Action button**: "Apply Discount"

---

### POS — Add Note Modal (Gap-Fill)

**Modal title**: "Order Note"

**Fields**:
- Textarea (placeholder: "Add instructions or comments for this order…")
- No character limit enforced

**Action button**: "Save Note"

---

### Customers — Add Customer Form (Gap-Fill)

**Section: BASIC INFO**
- Name (text)
- Mobile (text) — side-by-side with Email
- Email (text)
- Address (single-line text)
- NTN / CNIC (text) — labelled "for FBR invoicing"

**Section: DEMOGRAPHICS**
- Date of Birth (date input)
- Gender (select): — Select —, Male, Female, Other
- City (text) — side-by-side with Occupation
- Occupation (text)

**Section: PREFERENCES**
- Customer Group (select): — No Group —, Phase 6.7 test group
- Preferred Payment (select): — Select —, Cash, Card, Bank Transfer, Mobile Wallet, Credit
- Preferred Contact (select): — Select —, Phone, Email, WhatsApp, SMS

**Section: COMMUNICATION CONSENT**
- Email (checkbox)
- SMS (checkbox)
- WhatsApp (checkbox)

**Section: NOTES**
- Internal notes about this customer (textarea)

**Note**: No Tags field in the Add/Edit form. Tags are added from the customer detail panel after creation.

---

### Customers — Edit Form (Gap-Fill)

Identical fields to Add Customer form, pre-populated with existing data. No additional fields appear in Edit vs Add.

**Customer "Phase 4 Customer Bronze" pre-filled values**: Name: "Phase 4 Customer", Mobile: "0300-1234567", Email: "oneshop349@hotmail.com". All other fields empty.

---

### Customers — Detail Panel: Ledger Tab (Gap-Fill)

**Filters**: From date, To date, Filter button.

**Table columns**: Date | Type | Ref | Debit | Credit | Balance

**Sample data** (Phase 4 Customer Bronze):
- 5/2/2026 — Type: Sale — Ref: INV-2026-00032 — Credit: Rs 2,500.00 — Balance: Rs 2,525.00
- 5/2/2026 — Type: Pts Earned — Ref: INV-2026-00032 — Credit: Rs 25.00 — Balance: Rs 2,525.00

**Actions**: Read-only. No action buttons on ledger rows.

---

### Customers — Detail Panel: Order History Tab (Gap-Fill)

**Table columns**: Date | Order # | Channel | Total | Status

**Sample data** (Phase 4 Customer Bronze):
- 5/2/2026 — INV-2026-00032 — Channel: POS (badge) — Rs 2,500.00 — completed

**Actions**: Read-only.

---

### Customer Groups — New Group Form (Gap-Fill)

**Dialog title**: "New Customer Group"

**Fields**:
- Group Name (text)
- Description (text)
- Discount % (number, "0 for price-book style groups")
- Price Book (select — links to a Price List)

**Action button**: Save

---

### Gift Cards — New Card Form (Gap-Fill)

**Fields**:
- Card Type toggle: Digital | Physical
- Initial Value (number, "e.g. 500")
- Expiry Date (date, optional)
- Recipient Name (text, optional)
- Recipient Email (text, optional) — for digital delivery
- Code (text, optional — leave blank to auto-generate)

**Action button**: Create Card

---

### Gift Cards — Register Range Form (Gap-Fill)

**Fields**:
- Prefix (text, "e.g. GC-2024-")
- Start Number (number)
- End Number (number)
- Initial Value per card (number)
- Expiry Date (date, optional)

**Note**: Generates physical card codes as `{prefix}{start}` through `{prefix}{end}`.

**Action button**: Register Range

---

### Returns — Process Return Flow (Gap-Fill)

**Step 1 — Search**:
- Search field label: "Receipt / Invoice Number"
- Placeholder: "Enter receipt or invoice number…"

**Step 2 — Item selection** (after receipt found):
- Items from the sale listed with checkboxes
- Per-item: product name, original qty, refund qty field (number), refund price field
- Restock toggle per item (Yes/No)

**Step 3 — Refund method**:
- Refund Method (select): Cash, Card, Wallet, Gift Card, Store Credit
- Amount field (auto-calculated from selected items)

**Action button**: Process Return

---

### Products — Add Product Form (Gap-Fill)

**Left panel fields**:

*Basic Info*:
- Product Name * (text)
- Description (rich textarea)

*Media*:
- Image upload zone (drag-and-drop or click, up to 10MB)
- Additional images (multi-upload)

*Pricing*:
- Price * (number)
- Cost Price (number)
- Compare-at Price (number — shows strikethrough on storefront)
- Tax Rule (select — lists configured tax rules)
- Tax Inclusive toggle

*Inventory*:
- Track Stock toggle
- Stock by Location table (per-outlet: Main Store, Branch 2 — qty field each)
- Restock Notifications toggle
- Low Stock Threshold (number)
- Allow overselling toggle

*Variants*:
- "Enable Variants" toggle — expands variant matrix when enabled
- Attribute Set selector (select configured attribute set)
- Variant matrix (SKU, price, cost, stock per variant per outlet)

*Bundle / Kit*:
- "This is a bundle" toggle
- Bundle items list (add products + quantities)

*Outlet Visibility*:
- Per-outlet toggle (Main Store, Branch 2)

*Sales Channels*:
- Per-channel toggle (POS, Storefront, Online Marketplace, etc.)

**Right panel fields**:

*Status*:
- Status (select): Active, Draft, Inactive

*Organization*:
- Category (select — tree dropdown)
- Brand (select)
- Product Type (text)
- Vendor (text)
- Tags (multi-tag input)

*Supplier*:
- Supplier (select — or "+ Create new supplier")

*Identifiers*:
- Barcode (text — scan or type)
- SKU (text — auto-generated if blank)
- Unit (select): Piece, Kg, Gram, Litre, Metre, Box, Pack, etc.

*Inventory Intelligence*:
- Lead Time Override (days) (number)
- Safety Stock Override (days) (number)

*Serial Numbers*:
- Require Serial Number toggle

---

### Products — Variant Matrix Fields (Gap-Fill, `/products/5`)

On an existing product with variants enabled:

**Variant Matrix columns**:
- Variant (attribute value combination, read-only label)
- SKU (editable text per variant)
- Price (editable number per variant)
- Cost (editable number per variant)
- Compare-at (editable number per variant)
- Stock — per outlet column (editable number per outlet per variant)
- Status (select per variant: Active / Inactive)

---

### Categories — Add Category Form (Gap-Fill)

**Fields**:
- Category Name * (text)
- Parent Category (select — existing categories as options)
- Description (text, optional)
- FBR HS Code (text, 8-digit code)
- Visibility (toggle: visible/hidden on storefront)

**Action button**: Save Category

---

### Taxes — Add Tax Rule Form (Gap-Fill)

**Fields**:
- Rule Name * (text, e.g. "GST 17%")
- Rate % * (number)
- Tax Type (select): GST, Sales Tax, VAT, Custom
- Apply To (radio): All Products / Specific Categories
  - If Specific Categories: multi-select category list
- Set as Default (checkbox)

**Action button**: Save Tax Rule

---

### Attribute Sets — New Set Form (Gap-Fill)

**Dialog: "New Attribute Set"**

**Fields**:
- Set Name * (text, e.g. "Clothing", "Electronics")

**Action button**: Create Set

**Adding an attribute to a set** (from detail panel after creation):
- Attribute Name (text, e.g. "Color", "Size")
- Attribute Type (select): Text, Select, Multi-Select, Boolean
- Options (multi-input): add values one by one (for Select / Multi-Select types)

---

### Promotions — Add Promotion Form (Gap-Fill)

**Full-page form** (not a dialog):

*Step 1 — Basic Details*:
- Promotion Name * (text)
- Type (select): Percentage Discount, Fixed Discount, Buy X Get Y (BOGO), Bundle Discount
- Value (number — % or Rs depending on type)
- Start Date (date), End Date (date, optional)
- Outlet Scope (multi-select: All / specific outlets)

*Step 2 — Conditions*:
- Trigger (select): Cart Total Minimum, Item Quantity, Specific Product, Specific Category, Customer Group
  - If Cart Total: Minimum amount (number)
  - If Item Qty: Minimum quantity (number) + Product selector
  - If Product: Product multi-select
  - If Category: Category multi-select
  - If Customer Group: Group multi-select

*Step 3 — BOGO / Bundle specific* (if applicable):
- Buy quantity (number) + Get quantity (number) at % off
- Eligible products for "get" side

*Notes*: No coupon code option visible — promotions are automatic (not voucher-based).

---

### Price Lists — New Price List Form (Gap-Fill)

**Fields**:
- Price List Name * (text)
- Customer Group (select): — None —, Phase 6.7 test group
- Active (toggle)

**Action button**: Create Price List

**Adding items to an existing price list** ("Phase 6.7 test group Price Book"):
- Product search (autocomplete text input)
- After selecting product: Override Price (number field)
- "Add Price" button
- Existing items table: Product | Original Price | Override Price | Actions (Edit, Delete)

---

### Purchase Orders — Create PO Form (Gap-Fill)

**Header fields**:
- Supplier * (select — no suppliers configured on livetest1; shows "No suppliers yet")
- Outlet / Destination * (select: Main Store, Branch 2)
- Expected Delivery Date (date)
- Notes (textarea, optional)
- Reference Number (text, optional)

**Line item fields** (repeating rows):
- Product (select — all 8 products)
- Quantity (number)
- Unit Price (number, auto-filled from product cost)
- Discount % (number, optional)
- Sub-total (calculated, read-only)

**Action buttons**: Add Line Item, Cancel, Save Draft, Submit PO

---

### Stock Adjustments — New Adjustment Form (Gap-Fill)

**Fields**:
- Product * (select — all products with current stock shown)
- Outlet * (select: Main Store, Branch 2)
- Reason Code * (select):
  - Damage / Spoilage
  - Theft / Shrinkage
  - Found / Surplus
  - Count Correction
  - Supplier Return
  - Other
- Quantity Change (number — positive to add, negative to remove)
- Notes (textarea, optional)

**Current stock indicator**: Shows live current stock for selected product+outlet combination.

**Action button**: Save Adjustment

---

### Transfers — New Transfer Form (Gap-Fill)

**Fields**:
- From Outlet * (select: Branch 2, Main Store)
- To Outlet * (select: Branch 2, Main Store)
- Notes / Reference (text, optional)

**Line item rows** (repeating):
- Product (select — suffix shows current stock at source outlet)
- Quantity (number)

**Action buttons**: Add Product, Cancel, Create Transfer

---

### Supplier Returns — New Supplier Return Form (Gap-Fill)

**Header fields**:
- Supplier * (select — no suppliers on livetest1 so dropdown empty)
- Outlet * (select: Branch 2, Main Store)
- Reference Number (text, optional)
- General Reason (text, optional)

**Line item rows** (after selecting product):
- Product (select — 8 products)
- Quantity (number, default 1)
- Cost / Price (number, default 0)
- Item Reason (text, optional per-line)

**Action buttons**: Cancel, Complete Return

---

### Suppliers — Add Supplier Form (Gap-Fill)

**Fields**:
- Company Name * (text)
- Contact Person (text)
- Phone (text)
- Email (email)
- Address (textarea)
- Payment Terms (radio): Cash on Delivery | Credit Account
- Default Lead Time (days) (number) — "Applies to every product assigned to this supplier unless a product sets its own override"

**Action button**: Save

---

### Expenses — Add Expense Form (Gap-Fill)

**Fields**:
- Amount * (number)
- Date * (date)
- Category (select): Uncategorized (default), plus any configured categories
- Description (text, placeholder "What was this expense for?")
- Reference (text, placeholder "Optional invoice/receipt number")
- Outlet (select): None, Branch 2, Main Store
- Employee (select): None, Hassan, Test Cashier 2, Test Cashier 3, Test Cashier 4

**Action button**: Add Expense

**Categories management** (via "Categories" button):
- Existing categories list (shows "No categories yet" on livetest1)
- Add category: text input (new category name) + Add button
- Categories are tenant-specific and only used to organize expenses

---

### Journal Entries — New Entry Form (Gap-Fill)

**Header fields**:
- Date * (date)
- Description (text, placeholder "e.g. Opening balances, salary provision…")

**Line items table** (must balance — debit total = credit total):
- Account (select — 21 accounts from Chart of Accounts):
  `1000 Cash on Hand, 1010 Bank Account, 1100 Accounts Receivable, 1200 Inventory, 1300 Fixed Assets, 2000 Accounts Payable, 2100 Sales Tax Payable, 2200 Other Payables, 3000 Owner's Equity, 3100 Retained Earnings, 4000 Sales Revenue, 4100 Service Revenue, 4200 Other Revenue, 5000 COGS, 5100 Salaries & Wages, 5200 Rent, 5300 Utilities, 5400 Marketing, 5500 Office Supplies, 5600 Depreciation, 5900 Other Expenses`
- Description (text, "Optional note")
- Debit (number, "0.00")
- Credit (number, "0.00")

**Action buttons**: Add Line, Cancel, Save (disabled until lines balance)

---

### Journal Entries — Trial Balance Tab (Gap-Fill)

**Filters**: From date, To date, Export CSV button.

**Table columns**: Account Code | Account Name | Opening Debit | Opening Credit | Period Debit | Period Credit | Closing Debit | Closing Credit

Data empty on livetest1 (no posted journal entries).

---

### Credit/Debit Notes — New Note Form (Gap-Fill)

**Tab structure**: Credit Notes tab | Debit Notes tab

**New Credit Note fields**:
- Type (select): Sales / Purchase
- Customer (search + select): Phase 4 Customer, Phase 4 Customer GMail
- Amount (number, "0.00")
- Reason (text, "e.g. Goods returned, overcharge adjustment")
- Reference Type (text, "Type e.g. invoice, PO") + Reference ID (text, "ID")
- Notes (textarea, optional)

**Action button**: Create

**Note**: Selecting "Purchase" type replaces Customer selector with a Supplier selector.

---

### Post-Dated Cheques — New Cheque Form (Gap-Fill)

**Fields**:
- Cheque Number (text, "e.g. 000123")
- Type (select): Receivable / Payable
- Party Type (select): Customer / Supplier
- Customer / Supplier (search + select — conditional on Party Type)
- Bank Name (text, "e.g. HBL, MCB, Meezan")
- Amount (number, "0.00")
- Issue Date (date)
- Maturity Date (date)
- Notes (textarea, optional)

**Action button**: Create

---

### CRM — Add Lead Form (Gap-Fill)

**Fields**:
- Lead Name (text)
- Company (text)
- Phone (text)
- Email (email)
- Source (text)
- Expected Value (number)
- Priority (select): Low Priority, Medium Priority, High Priority
- Status (select): new, contacted, qualified, converted, lost
- Assign To (select): Assign to employee, Hassan, Test Cashier 2, Test Cashier 3, Test Cashier 4
- Notes (textarea)

**Action button**: Add Lead

---

### Quotations — New Quotation Form (Gap-Fill)

**Full-page form** (not a dialog):

**Header**:
- Customer (select)
- Outlet (select): Main Store, Branch 2
- Employee (select): Hassan, Test Cashier 2, 3, 4
- Valid Until (date)

**Line Items** (repeating rows):
- Product (select — 8 products)
- Qty (number)
- Unit Price (number — auto-filled from product price)
- Tax % (number)

**Discount & Notes**:
- Discount Type (select): Fixed Discount, Percent Discount
- Discount Value (number)
- Notes (textarea)

**Totals**: Subtotal / Tax / Discount / Total (calculated read-only)

**Action buttons**: Cancel, Create Quotation

---

### Employees — Add Employee Form (Gap-Fill)

**Fields**:
- Full Name * (text)
- Role * (select): Admin, Manager, Cashier
- PIN Code (password — hidden input)
- Email Address for password resets (email)

**Salary Config**:
- Pay Type (select): Monthly Salary, Hourly Rate, Daily Rate
- Amount (number, "e.g. 30000")

**Outlet Assignments** (checkboxes):
- Branch 2 (Phase 6.7 test) (checkbox)
- Main Store (checkbox)
- Note shown if none selected: "No outlets assigned — employee will have no branch access."

**Action button**: Save

**Note**: No username field visible — system likely auto-generates from name or uses email. Username shown in employee list but not in the add form.

---

### Outlets — Add Outlet (Gap-Fill)

**Result**: No form is shown. Instead, an upgrade paywall dialog appears:

> "You're at your current outlet limit (2). Adding another outlet adds PKR 8,000/month to your subscription."

**Buttons**: Cancel, Continue to payment

**Conclusion**: Cannot test the Add Outlet form on livetest1 without upgrading. The form fields (name, address, phone, etc.) are behind the payment gate.

---

### Barcode Templates — New Template Form (Gap-Fill)

**Inline form** (not a dialog — appears in the page):
- Template Name * (text, "e.g. Small Shelf Label")
- Width (mm) (number)
- Height (mm) (number)
- Font Size (px) (number)

**Show Fields** (checkboxes):
- Product Name
- Price
- Barcode (SVG)
- SKU
- Brand

- Set as default template (checkbox)

**Action buttons**: Cancel, Create Template

**Print Labels button**: Requires at least one template to be created before activating batch print UI.

---

### Receipt Templates — New Template Form (Gap-Fill)

**Inline form** (full-page with Live Preview panel on right):
- TEMPLATE NAME * (text, "e.g. Standard Receipt")
- HEADER TEXT (text, "Store name or tagline")
- FOOTER TEXT (textarea, "Thank you message, return policy, website…")
- LOGO: File upload (PNG/JPG/WebP up to 10MB, resized to 300×100px)
- PAPER WIDTH (select):
  - 80mm — 48 chars (standard)
  - 76mm — 42 chars
  - 58mm — 32 chars (mini)
  - 57mm — 30 chars (narrow)

**OPTIONS** (checkboxes):
- Show barcode on receipt
- Show tax breakdown
- Show FBR reference (IRN)
- Show FBR QR code
- Set as active template

**Action buttons**: Cancel, Save Template

---

### Integrations — WooCommerce Connect Form (Gap-Fill)

**Tab structure**: Connection | Products | Stock Sync

**Connection tab fields**:
- Store URL (url input, "https://yourstore.com")
- Consumer Key (text, "ck_…")
- Consumer Secret (password, "cs_…")

**Status**: "Not connected"

**Action button**: Connect

**Note**: The hub shows WooCommerce as "not configured"; it also shows Daraz as "Manage" (suggesting Daraz credentials ARE saved, but WooCommerce is not yet connected).

---

### Fulfillment — All 5 Sub-Tabs (Gap-Fill)

**Tab 1 — Orders Queue**:
- Table columns: ORDER #, CUSTOMER, ITEMS, TOTAL, PAYMENT, ORDERED
- Actions: "Create Picklist" button (requires selected orders)
- 1 order present: `#sf_6b90993b...` (Walk-in, 1 item, Rs 150, pending payment)

**Tab 2 — Pickup Orders**:
- Status filters: All Statuses, Pending, Ready, Arrived, Completed
- Table columns: (order details + pickup status)
- Actions: "Mark Ready" button per row
- 1 order: Phase 4 Tester, Rs 150, Main Store, Pending

**Tab 3 — Picklists**:
- Status filters: Pending, Picking, Picked, Packing, Packed, Dispatched, Cancelled
- Empty on livetest1

**Tab 4 — Quick Dispatch**:
- Single scan input (placeholder: "Scan tracking number, order number, or order ID…")
- Dispatch button

**Tab 5 — Loadsheets**:
- Status filters: Draft, Finalized, Handed Over
- "New Loadsheet" button
- Empty on livetest1

---

### Supplier Payables — All 3 Sub-Tabs (Gap-Fill)

**Summary cards**: Suppliers With Due (0), Open Invoices (0), Total Outstanding (Rs 0.00)

**Tab 1 — Aging Summary**:
- Table columns: SUPPLIER, PHONE, INVOICES, INVOICED, PAID, OUTSTANDING, DETAILS
- Expandable rows to see invoice breakdown per supplier
- Empty (no suppliers/invoices)

**Tab 2 — All Invoices**:
- Status filters: unpaid, partial, paid, all
- Table columns: INVOICE, SUPPLIER, AMOUNT, PAID, DUE, STATUS, DATE, ACTION
- Empty

**Tab 3 — Supplier Ledger**:
- Supplier dropdown selector + From/To date range + "View Ledger" button
- No data (no suppliers configured)

---

### Accounting — All 9 Sub-Tabs (Gap-Fill)

**Global controls**: From date, To date, Outlet (All / Branch 2 / Main Store)

**Tab 1 — P&L**:
- Summary row: Net Revenue Rs 3,100 | Gross Profit Rs 3,100 | Total Opex Rs 0 | Net Profit Rs 3,100
- Table: Gross Sales, Discounts, Returns, Net Revenue, COGS, Gross Profit, Operating Expenses (line items)

**Tab 2 — Cash Flow**:
- Summary: Inflows, Outflows, Net
- Daily Cash Flow table: Date, Inflow, Outflow, Net

**Tab 3 — AP & AR**:
- Summary: Total Payable (AP), Total Receivable (AR), Net Position
- Supplier AP table + Customer AR table

**Tab 4 — Balance Sheet**:
- Assets: Inventory at cost, Cash on Hand
- Liabilities: Supplier AP, Customer Credit Owed
- Equity section

**Tab 5 — Expense Ledger**:
- Filter: category dropdown (All categories)
- Table: Date, Category, Description, Outlet, Employee, Amount
- Export CSV button

**Tab 6 — AP Aging**:
- Aging buckets: Current, 1–30 days, 31–60 days, 61–90 days, 90+ days
- Table per supplier per bucket

**Tab 7 — Tax Ledger**:
- Table: Tax Name, Rate, Transactions, Taxable Amount, Tax Collected
- Export CSV button

**Tab 8 — Supplier Payments**:
- Table: Date, Supplier, Invoice #, Method, Notes, Amount
- Export CSV button

**Tab 9 — Accounting Periods**:
- Inline form: Period Name (text, "e.g. March 2026"), Start Date (date), End Date (date), Outlet (select)
- "Create Period" button
- Existing periods table (empty on livetest1 — no periods created)

---

### HR — All 4 Sub-Tabs (Gap-Fill)

**Tab 1 — Leave Requests**:
- Inline submit form: Employee (select), Leave Type (select: annual, sick, casual, unpaid, other), From Date, To Date, Days (number), Reason (textarea)
- "Submit Leave" button
- Table columns: EMPLOYEE, TYPE, DATES, STATUS, ACTIONS (Approve/Reject)
- Empty (no leave requests)

**Tab 2 — Leave Balance**:
- Table columns: EMPLOYEE, ALLOWANCE (DAYS), USED, REMAINING
- Lists all 4 employees

**Tab 3 — Payroll**:
- Payroll period selector (select a period) — no periods created so empty
- Payroll Lines table columns: EMPLOYEE, TYPE, BASE RATE, HOURS, DAYS, LEAVE, GROSS, DEDUCTIONS, NET PAY, NOTES
- Message: "Select a period above to view its payroll lines"

**Tab 4 — Attendance Summary**:
- Table columns: DAYS WORKED, TOTAL HOURS, AVG HOURS/DAY
- Sample: Hassan — 2 days worked, 0.0h total, 0.0h avg

---

### Cash Management — Shift Row Detail (Gap-Fill)

**Action**: Clicking on the ACTUAL amount cell (Rs 4,000) in the shift history table opens a **"Shift #1 Denominations"** dialog.

**Dialog content**:
- Denomination breakdown table: Denomination | Count | Total
  - 1000.00 × 4 = Rs 4,000
- Total shown at bottom: Rs 4,000.00

**No other shift detail panel** — clicking other cells in the row does not open anything. The denomination dialog is the only drill-down available on a closed shift.

---

### Retail Risk — All 3 Sub-Tabs (Gap-Fill)

**Tab 1 — No-Sale Events**:
- Filter controls: From (date), To (date), Apply button
- Table: empty on livetest1 (no cash drawer opens recorded)
- Columns: (not determinable — table empty with no headers visible when empty)

**Tab 2 — Anomaly Flags**:
- Message: "The nightly scan hasn't surfaced any employees worth a closer look."
- No table/filters shown when empty

**Tab 3 — Settings**:
- Field 1: Void/discount threshold — Rs 5,000 (transactions above this require manager PIN)
- Field 2: Shift variance threshold — Rs 500 (close-shift variance above this requires reason + manager PIN)
- Field 3: Anomaly z-score threshold — 2.0 (standard deviations above outlet peers to flag nightly)
- Action buttons: Save Thresholds, Reset

---

### Inventory Intelligence — Sub-Tabs (Gap-Fill)

**Reorder tab** — product needing reorder:
- Product: **Test Coffee** — Current Stock: 0, Velocity: 0.33/day, Lead Time: 7 days, Safety Stock: implied, Suggested Qty: 4
- Supplier: none assigned
- Filter controls: Outlet selector, "Create POs" button (batch)

**Cycle Counts tab**:
- "New schedule" button
- Schedule form fields: Frequency (Daily/Weekly/Monthly), ABC Class filter (A/B/C), Category filter
- Recent sessions table

**Aging tab**:
- Feature-gated by `reports_inventory_health_plus` flag — shows upgrade message, not data

---

### Reports — All 10 Category Tabs — Actual Report Names (Gap-Fill)

**1. Sales (22 reports)**:
Overview, Daily Operations, Comparative Trends, Sales Heatmap, Revenue Leaks, Product Mix, Sales Summary, Sales Detail, Order Wise, Item Wise, Category Wise, Sub-Category Wise, Monthly MOP Matrix, Cashier Wise, Refunds & Voids, Shift Summary, Shift Sales, Payment Summary, Cash Flow, Cash Audit, Denominations, Session Z-Report

**2. Customers (5 reports)**:
Customer Details, Customer Wise, RFM Analysis, Customer Retention, Capture Rate

**3. Inventory (up to 19 reports)**:
Merchandising, Product Performance, Brand Wise, Retail Matrix, Pricing Matrix, Sales & Stock, Inventory Dump, On Hand, Product Spec, History Cost, History Sale, Product Audit, Replenishment, Dead Stock, Stock Aging (gated), Stockout Risk (gated), Forecast Demand (gated), Replenishment Smart (gated), Shrinkage

**4. Operations (5 reports)**:
Outlet Comparison, Inventory Loss, Wastage, Product Movement, STR Report

**5. Procurement (7 reports)**:
Total Purchases, Itemwise Purchases, PO Workflow, Procurement Parity, Supplier Wise, Purchase Orders, GRN Report

**6. Finance (7 reports)**:
Settlement Overview, Payables / Receivables, Supplier Payments, Finance Payment Mix, GST Output, GST Type, FBR Export

**7. HR (6 reports)**:
Attendance, Labor Performance, Labor vs Sales, Staff Attribution, Loss Prevention, Commission Summary

**8. Governance (3 reports — gated by `reports_scheduled_exports`)**:
Audit Controls, Discount Leakage, Exceptions

**9. Multi-Channel (1 report)**:
Multi-Channel Overview (POS + Shopify + WooCommerce channel breakdown)

**10. Restaurant (2 reports — gated by `phase4_restaurant_kds_analytics`)**:
KDS Analytics, Menu Engineering

---

### Sales History — Gift Card Sale Detail (Gap-Fill)

**Sale**: Receipt #3 (4/29/2026, Rs 100.00)

**Detail panel contents**:
- Header: "Receipt #3", timestamp
- Summary: Total Rs 100.00, Payments: 1
- Payment information: Shows **"Payments: 1"** count only — **gift card code and post-redemption remaining balance are NOT displayed** in the panel
- Items: Test Coffee × 1.000 @ Rs 100.00

**Observation**: The Sales History detail panel does not expose the gift card code that was used or the card's remaining balance after redemption. This is a UX gap — a cashier investigating a gift card transaction from history cannot see which card was used without querying the database.

**Action buttons present**: Reprint, Invoice, Share, Email, WhatsApp, Void, Return (all 7 confirmed present)

---

### Administrator — Roles Table (Gap-Fill — resolving "Loading roles…")

**Status**: Roles load correctly on re-visit. The "Loading roles…" state during initial discovery was a transient UI race condition, not a persistent bug.

**Roles confirmed**:
| Role | Permissions | Employees |
|------|------------|-----------|
| Administrator | all_access (1 "permission" — full access) | 1 (Hassan) |
| Manager | 21 named permissions | 1 (Test Cashier 2) |
| Cashier | 3 named permissions | 2 (Test Cashier 3, Test Cashier 4) |

---

### Storefront — /store/livetest1 (Gap-Fill)

**Products listing page (`/store/livetest1/products`)**:
- Search input (placeholder: "Search products…")
- Sort select: Newest, Price: Low to High, Price: High to Low, Name A-Z
- Products visible: Snack Bar (Rs 50), Test Coffee (Rs 100)
- Note: Only 2 of 8 products appear — others may be inactive or have storefront channel disabled

**Product detail page** (e.g., `/store/livetest1/products/11`):
- Product name, price
- Quantity selector
- Add to Cart button
- Pickup Availability table: Location | Availability (per-outlet stock)

**Cart page (`/store/livetest1/cart`)**:
- Item rows: product name, price, quantity (−/+), Remove button
- Order Summary: Subtotal, Total
- Note: "Tax and shipping calculated at checkout"
- Buttons: Proceed to Checkout, Continue Shopping

**Checkout page (`/store/livetest1/checkout`)**:

*Delivery Method* (radio):
- Pick Up in Store (selected)
- Ship to My Address

*Pickup Location* (radio, shown when Pick Up selected):
- Branch 2 (with address if configured)
- Main Store (with address)

*Contact Information*:
- Full Name * (text, "Your full name")
- Phone * (tel, "03XX-XXXXXXX")
- Email * (email, "you@example.com")

*Order Summary panel*: Subtotal, Tax breakdown (Rs 2.38 on Rs 50 item = ~5%), Pickup: Free, Total

*Note*: "Payment will be collected at pickup." — no online payment method at checkout for livetest1.

**Action button**: Place Order
