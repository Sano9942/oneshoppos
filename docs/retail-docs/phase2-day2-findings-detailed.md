# Phase 2 Day 2 — Per-page Findings (Detailed)

> Companion to `docs/pre-launch-walkthrough-plan-2026-04-27.md` (Findings Log → Phase 2 — Day 2 section). The plan doc has the consolidated severity buckets and shipped-fixes table; **this file preserves the granular per-page observations** captured during the 2026-04-28 sidebar walkthrough on `livetest1`.
>
> Use the canonical plan doc for triage scope and severity ranking. Use this file when you need to recall a specific page's detail (KPIs visible, tab structure, exact CTA wording, button colors, etc.) without re-walking.

**Date:** 2026-04-28
**Operator:** Hassan
**Tenant:** `livetest1` (Free tier; 5 sample products; 1 open shift; 4 deduped loyalty tiers)
**Coverage:** 50 / ~50 nav items, all 9 nav groups

**Severity legend:**
- ✅ — clean, no action needed
- ✅ ⚠️ — clean overall but with minor note(s)
- ⚠️ — minor issue(s)
- ⚠️ MEDIUM — functional issue, merchant-facing
- 🔴 — critical
- ✅✅ FIXED — was an issue, fix shipped this session
- Screenshot filenames are under `.playwright-mcp/`

---

## Login + sidebar entry

- **Login** ⚠️ — One console error during login → dashboard redirect: `401 /api/context/bootstrap`. Different code path from Day-1 fix `6afdd70` (which gated PresetProvider). Harmless but Sentry sees it.
- **Service Tickets** ✅ — Verified NOT in sidebar (correctly mode-gated for retail mode). The Day-1 brief listed it as visible — that brief was outdated. No action needed.

---

## Commerce (3 walked Day 2)

### 1. Gift Cards ✅
- 2 CTAs in header: Register Range, New Card
- Tabs: Cards (0), Ranges (0)
- Filters: All types (Digital/Physical), All states (Active/Pre-printed/Issued/Depleted)
- Empty-state copy: "No gift cards yet. Click New Card to issue a digital gift, or Register Range to import a pre-printed batch."
- New Card modal: Type (Digital auto-generated code / Physical), Initial Value (default 500), Recipient email (optional)
- Subtitle: "Issue digital codes or register pre-printed physical card batches." (capitalized ✓)
- Screenshots: `phase2-commerce-gift-cards.png`, `phase2-commerce-gift-cards-newcard-modal.png`

### 2. Returns ✅
- 2 CTAs in header: Export CSV, Process Return
- Filters: search, From/To dates
- Side-panel inspector: "Select a return — Click a return row to inspect restocked items and metadata."
- Process Return modal: search by name/barcode/SKU, "Original sale id (optional)", outlet (Main Store), Processed by (optional), Customer id (optional), payment method (Cash default), Reason, Total Refund, "0 items in draft" indicator
- **Initially flagged "(optional)" as UI/contract mismatch — WITHDRAWN after git check.** Backend [routes/returns.js:153](backend/routes/returns.js#L153) treats `original_sale_id` as nullable and explicitly handles web-order returns + no-receipt returns. UI label is correct. The OpenAPI doc string at lines 27/37 is the stale source; CLAUDE.md was quoting the doc. **Doc-fix candidate**, not UX bug.
- Subtitle: "Process customer returns and restock inventory." (capitalized ✓)
- Screenshots: `phase2-commerce-returns.png`, `phase2-commerce-returns-process-modal.png`

### 3. Sales History ✅
- 3 KPI cards: Transactions / Visible Rows / Voided
- Filters: search receipt/cashier/outlet, From/To dates, All Methods, All Employees, status tabs (All / Completed / Voided)
- Columns: Receipt / Timestamp / Cashier / Outlet / Items / Total / Status / FBR
- Side-panel inspector: "Select a sale — Click a row to inspect items and actions."
- Pagination: Previous / Next, "Page 1 of 1"
- 2 header CTAs: Export CSV, Refresh
- Subtitle: "View all completed sales with void, return, and invoice actions." (capitalized ✓)
- Screenshot: `phase2-commerce-sales-history.png`

---

## Inventory (8)

### 4. Products ✅ ⚠️
- 5 sample products visible: Backpack (Sample) / Headphones (Sample) / Phone Case (Sample) / T-Shirt (Sample) / Watch (Sample)
- Columns: Product / Barcode (—) / SKU (—) / Price / Cost (Rs 0.00) / Stock / Category / Status / Tools
- All 5 products show Stock as **`100.000`** (3 trailing zeros from migration v45 NUMERIC(10,3) widening). Should display integer when fractional == 0.
- Header CTAs: Products / Gift Cards toggle, Template, Import, Export all, **Add Product** (green-fill)
- Filters: search name/barcode/SKU, All statuses, All categories, All locations, sort (Name A-Z)
- "5 items" counter
- Add Product → opens FULL PAGE (not modal) at `/products/new`. Sections:
  - Basic Info: Product Name (required), Description (textarea)
  - Media: Upload image
  - Pricing: Selling Price (required), Cost Price, Compare-at Price, **GST %** ← **country-coupled hardcoded label** (should be generic "Tax %")
  - Bundle / Kit (toggle)
  - Status: Active dropdown
  - Organization: Category, Brand, Product Type, Vendor, Tags
  - Supplier dropdown
- Subtitle: "Manage products, pricing, stock levels, and variants." (capitalized ✓)
- Screenshots: `phase2-inventory-products.png`, `phase2-inventory-products-add.png`

### 5. Categories ✅
- 4 KPIs: Total Categories / Top Level / Leaf Categories / Visible (all = 3)
- 3 seeded rows: Accessories (Direct 3 / Rollup 3), Clothing (Direct 1 / Rollup 1), Electronics (Direct 1 / Rollup 1) — all "Leaf", all "Active"
- Per-row actions: Add Child, Move Products, Edit, Delete (red)
- Header CTAs: Export CSV, **Add Category** (green-fill)
- Helper text: "Delete is blocked when children or products exist"
- Subtitle: "Hierarchical internal category tree for product organization and reporting." (capitalized ✓)
- Screenshot: `phase2-inventory-categories.png`

### 6. Brands ✅ ⚠️
- 3 KPIs: Total Brands / Visible / With Description (all = 0)
- Empty state: "No brands. Create a brand to improve product labeling."
- Header CTAs: Export CSV, **Add Brand** (green-fill)
- ⚠️ **Lowercase subtitle:** "**brand** taxonomy with consistent CRUD and search behavior."
- Source: [BrandsRedesign.jsx:103](frontend/src/pages/redesign/BrandsRedesign.jsx#L103)
- Screenshot: `phase2-inventory-brands.png`

### 7. Taxes ⚠️
- 3 KPIs: Total Rules (2) / Default Rules (**0**) / Visible (2)
- 2 rows visible: Default Tax 0.00% (status: optional) + GST 17.00% (status: optional)
- ⚠️ **Default Rules: 0** — neither tax marked as default. Pre-fix residue from before Day-1 fix #3 (`520d3e5`). Needs fresh-tenant verification at end of phase.
- Per-row actions: Edit, Delete (red)
- Header CTAs: Export CSV, **Add Tax Rule** (green-fill)
- ⚠️ **Lowercase subtitle:** "**tax** profiles with default control and fast editing."
- Source: [TaxesRedesign.jsx:105](frontend/src/pages/redesign/TaxesRedesign.jsx#L105)
- Screenshot: `phase2-inventory-taxes.png`

### 8. Attribute Sets ✅ ⚠️
- Empty state: "No attribute sets. Create your first set to manage product variants."
- Side-panel inspector: "Select an attribute set — Click a set to inspect attributes and options."
- Filters: search attribute sets, "0 sets" counter
- Columns: Set / Attributes / Actions
- Header CTA: **+ New Set** (green-fill)
- ⚠️ **Lowercase subtitle:** "**variant** schema management with nested attributes and options."
- Source: [AttributeSetsRedesign.jsx:176](frontend/src/pages/redesign/AttributeSetsRedesign.jsx#L176)
- Screenshot: `phase2-inventory-attribute-sets.png`

### 9. Promotions ✅ ⚠️
- 3 KPIs: Total Promotions (0) / Active (0) / Inactive (0)
- Filters: search by name/type/applies-to, "0 rows" counter
- Columns: Name / Type / Value / Applies To / Validity / Status / Actions
- Empty state: "No promotions. Create your first promotion rule to start discount campaigns."
- **Quote Test panel** (nice diagnostic UX): Cart Total: Rs 0.00, "Select product" dropdown + qty input + Add button, Evaluation Result side-panel ("Runs active promotions for the sample cart using backend quote logic.") with Run Quote / Clear buttons
- Header CTAs: Export CSV, Refresh, **+ Add Promotion** (green-fill)
- ⚠️ **Lowercase subtitle:** "**manage** discount rules and test promotion outcomes on sample carts."
- Source: [PromotionsRedesign.jsx:312](frontend/src/pages/redesign/PromotionsRedesign.jsx#L312)
- Screenshot: `phase2-inventory-promotions.png`

### 10. Price Lists ⚠️
- ⚠️ **Visibly inconsistent with sibling Inventory pages:** no KPI strip, simpler search-only layout
- Search only: "Search price lists..."
- Empty state: "No price lists yet. Create one to get started." (with tag icon)
- Header CTA: **+ New Price List** ← **outline-style** (not green-fill — drift from other Inventory pages)
- Subtitle: "Manage custom pricing for customer groups, volume tiers, and promotions." (capitalized ✓)
- Reads as an older page that didn't get the Inventory redesign treatment.
- Screenshot: `phase2-inventory-price-lists.png`

### 11. Review Moderation ⚠️
- ⚠️ **Most stripped-down page in Inventory.** No subtitle, no KPIs, no primary CTA.
- Just tabs (Pending / Approved / Rejected / All) and "No pending reviews found." text
- Older layout, hasn't been redesigned to match the rest of Inventory.
- Screenshot: `phase2-inventory-review-moderation.png`

---

## Stock Control (8)

### 12. Purchase Orders ✅ ⚠️
- 3 KPIs: Total POs (0) / Pending Approval (0) / Received (0)
- Filters: search by PO/supplier/status, "0 rows" counter
- Columns: PO / Supplier / Date / Status / Total / Actions
- Empty state: "No purchase orders. Create a PO to start procurement workflow."
- Header CTAs: Export, Templates, **+ Create PO** (green-fill)
- ⚠️ **Lowercase subtitle:** "manage supplier ordering lifecycle from draft to GRN."
- Screenshot: `phase2-stock-purchase-orders.png`

### 13. Inventory Audit ⚠️
- ⚠️ **Page largely blank below the title.** No KPIs, no table, no empty state copy.
- ⚠️ **1st nav-vs-title mismatch today:** breadcrumb says "Stock Counts" (URL slug `/stock-counts`), page title is "Inventory Audit"
- Single header CTA: **Start Count** ← **outline-style** (drift)
- Subtitle: "Physical stock counts via barcode scanning" (capitalized ✓ but no period)
- 3 sub-issues to address: blank page body, name mismatch, CTA style.
- Screenshot: `phase2-stock-inventory-audit.png`

### 14. Stock Adjustments ✅ ⚠️
- ⚠️ **No KPI strip** (Stock Control has uneven layouts across siblings).
- Filters: search product or barcode, "All reasons" dropdown, "0 entries" counter
- Columns: Date / Product / Outlet / Reason / Adjustment / Employee / Actions
- Empty state: "No adjustments. Create an adjustment to update outlet stock."
- Header CTAs: Export CSV, **+ New Adjustment** (green-fill)
- ⚠️ **Lowercase subtitle:** "auditable shrink/gain adjustments per outlet."
- Screenshot: `phase2-stock-adjustments.png`

### 15. Transfers ✅ ⚠️
- Filters: search product/barcode/outlet, "0 transfers" counter
- Columns: Date / Product / From / To / Qty / Note / Employee / Actions
- Empty state: "No transfers. Create a transfer to move stock between outlets."
- Header CTAs: Export CSV, **+ New Transfer** (green-fill)
- ⚠️ **Lowercase subtitle:** "stock movement between outlets with full traceability."
- Screenshot: `phase2-stock-transfers.png`

### 16. Returned Stock ✅ ⚠️
- Filters: search supplier/reference, "0 returns" counter
- Columns: RMA / Supplier / Outlet / Items / Value / Date / Status
- Side-panel inspector: "Select an RMA — Click a row to inspect returned items."
- Empty state: "No supplier returns. Create an RMA to send stock back to a supplier."
- Header CTAs: Export CSV, **+ New Supplier Return** (green-fill)
- ⚠️ **Lowercase subtitle:** "supplier return (RMA) workflow and stock-out tracking."
- Screenshot: `phase2-stock-returned-stock.png`

### 17. Supplier Payables ✅ ⚠️
- 3 KPIs: Suppliers With Due (0) / Open Invoices (0) / Total Outstanding (Rs 0.00)
- 3 view tabs: Aging Summary / All Invoices / Supplier Ledger
- Helper text: "Click a supplier row to expand invoices"
- Columns: Supplier / Phone / Invoices / Invoiced / Paid / Outstanding / Details
- Empty state: "No outstanding payables. Supplier aging will appear here when invoices are generated."
- Header CTAs: Export CSV, Refresh
- ⚠️ **Lowercase subtitle:** "monitor supplier outstanding balances and record invoice payments."
- Screenshot: `phase2-stock-supplier-payables.png`

### 18. Reorder Alerts ✅
- Single empty-state card: "No products require reordering."
- No CTAs needed (informational page)
- Subtitle: "Products sorted by urgency (most critical first)" (**properly capitalized ✓** — exception to the lowercase pattern)
- Screenshot: `phase2-stock-reorder-alerts.png`

### 19. Inventory Intelligence ✅
- ✅ **Best-styled page in Stock Control.**
- 4 KPI cards: Needs Reorder (0) / Next Cycle Count (—) / Dead Stock Items (0) / Stock Value At Risk (Rs 0.00)
- 4 tabs: ABC Analysis / Reorder / Cycle Counts / Aging
- ABC Analysis tab: search by product name, "All ranks" dropdown, "Dead stock only" checkbox, Export CSV
- Columns: Product / SKU / Rank / Revenue % / Units Sold / Sell-Through / GMROI / Days Since Sale
- Empty state: "No data yet — the nightly worker runs at 02:00 UTC."
- Subtitle: "ABC classification, velocity-based reorder, cycle counts, and aging — refreshed nightly at 02:00 UTC" (capitalized ✓)
- Screenshot: `phase2-stock-intelligence.png`

---

## Procurement (3)

### 20. Suppliers ✅
- 4 KPIs: Total Suppliers (0) / Credit Suppliers (0) / Cash Suppliers (0) / Total Outstanding (Rs 0.00)
- Filters: search supplier/contact/phone
- Columns: Supplier / Contact / Terms / Outstanding / Actions
- Empty state: "No suppliers. Add a supplier to manage procurement workflows."
- Header CTAs: Export CSV, **+ Add Supplier** (green-fill)
- Subtitle: "Manage supplier accounts, credit terms, and outstanding balances." (capitalized ✓)
- Screenshot: `phase2-procurement-suppliers.png`

### 21. Expenses ✅ ⚠️
- Date range default: 04/01/2026 to 04/27/2026 (today = 04/28; 1-day off — benign, page may have loaded before midnight)
- Filters: From/To, Category, Outlet, Expense List / Summary toggle
- "0 records" counter, "Filtered Total: Rs 0.00"
- Columns: Date / Category / Description / Outlet / Employee / Amount / Actions
- Empty state: "No expenses found. Adjust filters or add a new expense."
- Header CTAs: Export CSV, Categories, Refresh, **+ Add Expense** (green-fill)
- ⚠️ **Lowercase subtitle:** "operating expense tracking with filterable list, category summary, and maintenance tools."
- Screenshot: `phase2-procurement-expenses.png`

### 22. Approvals ✅✅ FIXED (commit `00dad32`)
- **Was duplicated header bug.** Fixed by stripping inner `<h1>` from [Approvals.jsx:88](frontend/src/pages/Approvals.jsx#L88), kept Refresh button right-aligned via `flex justify-end`.
- 3 tabs: Pending / Approved / Rejected
- Empty state: "No pending approvals found" (with clock icon)
- Header CTA: Refresh (now alone)
- Subtitle: "Review and approve purchase orders, stock transfers, and reconciliation fixes" (missing trailing period — bundle into polish)
- Screenshots: `phase2-procurement-approvals.png` (before), `phase2-procurement-approvals-FIXED.png` (after)

---

## Insights (6)

### 23. Reports ⚠️
- ⚠️ **Subtitle missing space:** "77 reports across**sales**, customers, inventory, operations, procurement, finance, hr, governance, multi-channel, restaurant."
- ⚠️ **Stale copy:** subtitle lists "restaurant" reports even though the rail correctly omits the Restaurant tab for retail mode. Subtitle should be retail-mode-aware.
- ⚠️ **Console warning:** `Revenue Forecast` chart container has width(-1)/height(-1) — Recharts/EChart sizing race. Chart still renders visually.
- 4 KPI cards: Today's Sales (Rs 0.00 / 0 tenders) / Average Bill (Rs 0.00 / 0 active hours) / Current Stock (500 / 5 products tracked) / Month Gross Margin (Rs 0.00 / Sales Rs 0.00)
- Side rail with 9 categories: Sales / Customers / Inventory / Operations / Procurement / Finance / HR / Governance / Multi-Channel
- Sales tab has 17+ sub-reports: Overview / Daily Operations / Comparative Trends / Sales Heatmap / Revenue Leaks / Product Mix / Sales Summary / Sales Detail / Order Wise / Item Wise / Category Wise / Sub-Category Wise / Monthly MOP Matrix / Cashier Wise / Refunds & Voids / Shift Summary / Shift Sales / Payment Summary / Cash Flow / Cash Audit / Denominations / Session Z-Report
- Filters bar: Global search, time range, date range, outlet, category, brands, suppliers, staff, shifts
- Revenue Forecast chart with "Store revenue trend for the last 6 months"
- Executive KPI Rail (right): Low Stock Items (0 / 500 stock units live), Month Purchases (Rs 0.00 / Month sales Rs 0.00)
- Screenshot: `phase2-insights-reports.png`

### 24. Accounting ⚠️ MEDIUM
- ⚠️ **API 400 on page load:** `GET /api/accounting/cashflow/daily?from=2026-03-31&to=2026-04-27` returns **400**. Visible KPIs render (P&L tab default), but Cash Flow tab data is broken on first hit. Possible `accounting_core` feature flag gap or validation bug. Fires unconditionally on page load.
- 9 tabs: P&L / Cash Flow / AP & AR / Balance Sheet / Expense Ledger / AP Aging / Tax Ledger / Supplier Payments / Accounting Periods
- P&L tab default: From/To filters, All outlets dropdown
- Revenue Breakdown card: Gross Sales, Discounts, Returns, Net Revenue, COGS, Gross Profit (all Rs 0.00)
- Operating Expenses card: Total Opex, Net Profit (all Rs 0.00)
- Subtitle: "Profit & Loss, cash flow, and accounts payable/receivable." (capitalized ✓)
- Screenshot: `phase2-insights-accounting.png`

### 25. Chart of Accounts ✅✅ FIXED (commit `cd6f4bd`)
- **Was triplicate seeds (63 → 21 rows).** Fixed via UNIQUE(code) + ON CONFLICT (code) DO NOTHING in 3 sites + v80 dedupe migration. FK-safe via UPDATE-then-DELETE on `journal_entry_lines.account_id` and self-FK `parent_id`. Manual SQL applied to `tenant_livetest1`.
- ⚠️ Subtitle missing trailing period: "Manage your account structure for double-entry bookkeeping"
- ⚠️ **Breadcrumb shows "Chart Of Accounts" (capital O) vs page title "Chart of Accounts"** — typography mismatch
- Header CTAs: Export, **+ Add Account** ← outline-style (drift)
- Search: "Search by name or code..."
- Sections (after fix, each appearing exactly once):
  - Assets: 1000 Cash on Hand / 1010 Bank Account / 1100 Accounts Receivable / 1200 Inventory / 1300 Fixed Assets
  - Liabilities: 2000 Accounts Payable / 2100 Sales Tax Payable / 2200 Other Payables
  - Equity: 3000 Owner's Equity / 3100 Retained Earnings
  - Revenue: 4000 Sales Revenue / 4100 Service Revenue / 4200 Other Revenue
  - Expenses: 5000 Cost of Goods Sold / 5100 Salaries & Wages / 5200 Rent / 5300 Utilities / 5400 Marketing / 5500 Office Supplies / 5600 Depreciation / 5900 Other Expenses
- Each row has lock icon (is_system=true) + edit pencil
- Screenshots: `phase2-insights-chart-of-accounts.png` (before), `phase2-insights-chart-of-accounts-FIXED.png` (after)

### 26. Journal Entries ⚠️
- 2 tabs: Journal Entries / Trial Balance
- Filters: search by entry number/description, All Statuses, From/To dates
- ⚠️ **Layout drift:** Export + New Entry CTAs are mid-page (under date range filters) instead of header top-right (other tier-2 pages keep CTAs in header)
- Empty state below filters has no copy at all
- Subtitle: "Double-entry bookkeeping — create, post, and review journal entries." (capitalized ✓)
- Screenshot: `phase2-insights-journal-entries.png`

### 27. Credit/Debit Notes ⚠️
- ⚠️ **Naming inconsistency (3 different forms!):**
  - Sidebar: "Credit/Debit Notes"
  - Breadcrumb: "Credit Debit Notes"
  - Page title: "Credit & Debit Notes"
- 2 tabs: Credit Notes / Debit Notes
- Filters: search notes, All Statuses
- Empty state: "No credit notes"
- Header CTAs: Export, **+ New Note** ← outline-style (drift)
- ⚠️ Subtitle "Manage purchase and sales adjustments" missing trailing period
- Screenshot: `phase2-insights-credit-debit-notes.png`

### 28. Post-Dated Cheques ⚠️
- ⚠️ **3 silent 503s on bootstrap fetches:**
  - `/api/accounting/cheques/upcoming`
  - `/api/suppliers`
  - `/api/customers?limit=500`
- Same pattern as Day-1 fix #5 (`58e6c9d`) — should be gated on `accounting_core` feature flag
- Filters: search cheques, All Statuses, All Types
- Empty state: "No cheques found"
- Header CTAs: Export, **+ New Cheque** ← outline-style (drift)
- ⚠️ Subtitle "Track receivable and payable post-dated cheques" missing trailing period
- Screenshot: `phase2-insights-postdated-cheques.png`

---

## Operations (6)

### 29. Kiosk ✅
- Opens in new tab (correct — kiosk hardware runs standalone session)
- Dark theme (slate-900 background)
- Header: Store dropdown ("Select your store..."), live clock ("01:20 AM Tuesday, April 28")
- Big PIN keypad: 4 dots (PIN length indicator) above 0–9 + Back + OK buttons
- Title: "Attendance Kiosk"
- Helper: "Enter your PIN to clock in, break, or clock out"
- No issues, clean.
- Screenshot: `phase2-operations-kiosk.png`

### 30. CRM ✅
- Sales Pipeline with Kanban-style 5-stage columns:
  - New (0, Rs 0.00)
  - Contacted (0, Rs 0.00)
  - Qualified (0, Rs 0.00)
  - Converted (0, Rs 0.00)
  - Lost (0, Rs 0.00)
- Each stage has a colored badge (new=gray, contacted=gray, qualified=yellow, converted=green, lost=red) and lead column with empty state ("No leads")
- Header CTA: **+ Add Lead** (green-fill)
- Subtitle: "Sales pipeline and lead activity tracking." (capitalized ✓)
- Screenshot: `phase2-operations-crm.png`

### 31. Quotations ✅
- Filters: search quotations, All statuses dropdown, "0 quotations" counter
- Columns: # / Customer / Status / Valid Until / Total / Actions
- Empty state: "No quotations. Create your first quotation to get started."
- Header CTAs: Export CSV, **+ New Quotation** (green-fill)
- Subtitle: "Create and manage price quotations for customers." (capitalized ✓)
- Screenshot: `phase2-operations-quotations.png`

### 32. Attendance ✅ ⚠️
- ⚠️ **Apply button is BLUE** (every other primary CTA in the app is GREEN — color drift)
- Filter strip: From (04/28/2026), To (04/28/2026), Employee dropdown (All Employees), Apply button, search employee/outlet
- Net Work Hours summary in corner: "0h 0m"
- Empty state: "No attendance records for the selected period" (with clock icon)
- "0 records" counter
- ⚠️ Subtitle "Clock-in and clock-out records from the POS terminal" missing trailing period
- Screenshot: `phase2-operations-attendance.png`

### 33. HR ✅ ⚠️
- ⚠️ **2nd nav-vs-title mismatch:** page title = "HR Management", sidebar/breadcrumb = "HR"
- 4 tabs: Leave Requests / Leave Balance / Payroll / Attendance Summary
- Leave Requests tab: two-column layout
  - Left: Submit Leave Request form (Select employee dropdown, "annual" type dropdown, From/To dates, days input, Reason textarea, Submit Leave button)
  - Right: Requests (0) table — Employee / Type / Dates / Status / Actions, empty state "No leave requests. Leave requests will appear here."
- Subtitle: "Leave requests, payroll, balances and attendance summary." (capitalized ✓)
- Screenshot: `phase2-operations-hr.png`

### 34. Notifications ⚠️
- ⚠️ **"outlet #1" ID leak in body text** — leaks numeric DB ID instead of outlet name. Should resolve to "Main Store".
- Real notification visible: "**Shift Opened**" with Info + New badges, body "Shift opened at outlet #1", timestamp "4/27/2026, 7:16:37 PM"
- Per-row action: Mark as Read button
- Header: "1 unread" badge + Refresh CTA (outline-style)
- Subtitle: "System alerts, stock warnings, and activity updates." (capitalized ✓)
- Screenshot: `phase2-operations-notifications.png`

---

## Setup (11)

### 35. Employees ✅
- 4 KPIs: Total (1) / Visible (1) / Roles (3) / Active (1)
- Filter: search employees, "1 employees" counter
- Single row visible: Hassan / Admin badge / oneshop349@gmail.com / Password auth badge
- Per-row actions (5): Edit / Password / Reset / Revoke / Archive (red-tinted last two)
- Header CTAs: Export CSV, **+ Add Employee** (green-fill)
- Subtitle: "Manage staff accounts, roles and PIN codes." (capitalized ✓)
- Screenshot: `phase2-setup-employees.png`

### 36. Outlets ✅
- 3 KPIs: Total Outlets (1) / Visible (1) / With Address (0)
- "With Address: 0" because we skipped that step during onboarding
- Filter: search outlets, "1 outlets" counter
- Single row: id=1 / Main Store / Address — / Phone —
- Per-row actions: Edit, Delete (red)
- Header CTAs: Export CSV, **+ Add Outlet** (green-fill)
- Subtitle: "Manage store locations and branches." (capitalized ✓)
- Screenshot: `phase2-setup-outlets.png`

### 37. Company Profile ⚠️
- ⚠️ **3rd nav-vs-title mismatch:** page title = "Company **Settings**", sidebar/breadcrumb = "Company **Profile**"
- Sections:
  - Business Identity: Business Type (Retail Store), Company Name (Live Test 1), Trading Name placeholder (Acme), Phone placeholder, Email (oneshop349@gmail.com), Website placeholder, Address placeholder, City placeholder (Karachi), Country (Pakistan)
  - Tax & Legal: NTN placeholder (1234567-8), STRN placeholder (12-34-5678-001-90) — **PK-specific but country-aware so OK**
  - Branding & Currency: Currency Symbol (Rs), Currency Code (PKR)
- Header CTA: **Save Profile** (green-fill)
- Subtitle: "Branding, tax, regional and financial settings." (capitalized ✓)
- Screenshot: `phase2-setup-company-profile.png`

### 38. Integrations ✅ ⚠️
- 7 category tabs: All / Marketplaces & Stores / Social Commerce / Messaging / Product Feeds / Couriers / Payments / SMS
- Provider cards (12 in PROVIDER_META: daraz, shopify, woocommerce, facebook, instagram, whatsapp, google_merchant, xpay, jazzcash, easypaisa, zong_sms, jazz_sms, twilio):
  - Daraz, Facebook Shop, WhatsApp Business, Google Merchant Center: blue **Connect** button + "Manual sync only — click Pull Orders to fetch new orders. Automatic background sync coming soon."
  - Shopify, WooCommerce: outline **Manage** button (separate dedicated pages)
  - Instagram Shopping: "Managed via Facebook Shop connection" (no CTA)
  - WhatsApp pricing notice (yellow): "WhatsApp Business API charges per conversation. First 1,000 service conversations/month are free." — **nice transparency**
- ⚠️ Subtitle "Connect your store to marketplaces, social channels, messaging, and courier services" missing trailing period
- Screenshot: `phase2-setup-integrations.png`

### 39. Courier Settings ✅✅ FIXED (commit `593062a`)
- **Was triplicate seeds (39 → 13 rows).** Fixed via UNIQUE(adapter_key) + ON CONFLICT (adapter_key) DO NOTHING in 3 sites + v81 dedupe migration. FK-safe via UPDATE-then-DELETE on `web_orders`, `loadsheets`, `order_shipments`, `cod_settlement_batches`. Manual SQL applied to `tenant_livetest1`.
- ⚠️ **"+ Add Custom Courier" CTA is BLUE** (secondary-style — same drift class as Price Lists, Inventory Audit)
- Page title: "Delivery Couriers"
- 13 unique courier rows (after fix), each with: name + adapter key + "Tracking URL configured" link + Disabled toggle
- Couriers visible (alphabetical): BlueEx, Bykea, Call Courier, DHL Express, FedEx, Leopards Courier, M&P, Pakistan Post, PostEx, plus 4 more below fold (Rider, Swyft, TCS, Trax)
- Subtitle: "Configure courier integrations for order dispatch" (capitalized ✓ but no period)
- Screenshots: `phase2-setup-courier-settings.png` (before), `phase2-setup-courier-settings-FIXED.png` (after)

### 40. Barcode Templates ✅✅ FIXED (commit `00dad32`)
- **Was duplicated header.** Fixed by stripping inner `<h1>` from [BarcodeTemplates.jsx:305](frontend/src/pages/BarcodeTemplates.jsx#L305).
- ⚠️ **4th nav-vs-title mismatch:** page title = "Barcode Label Designer", sidebar/breadcrumb = "Barcode Templates"
- ⚠️ **Multi-color CTAs in same row:**
  - Refresh: white-outline
  - Print Labels: green-outline
  - **+ New Template:** **BLUE**
- Empty state: "No templates yet. Create one to get started." (with tag icon)
- Columns: Template Name / Size (mm) / Shows / Default / Actions
- Subtitle: "Configure label templates and print product barcodes in batch" (capitalized ✓ but no period)
- Screenshot: `phase2-setup-barcode-templates.png` (before)

### 41. Receipt Templates ✅✅ FIXED (commit `00dad32`)
- **Was duplicated header inside a card.** Fixed by stripping the entire inner header card from [ReceiptTemplates.jsx:194](frontend/src/pages/ReceiptTemplates.jsx#L194).
- ⚠️ **+ New Template CTA is PURPLE/VIOLET** (yet another button color — drift)
- Default template card visible: "Default" name + "ACTIVE" badge, Edit pencil + Delete trash icon
- Sample receipt preview: "Thank you for shopping! Receipt #1042" with sample line items (2x Sample Item Rs 40.00, 1x Another Item Rs 15.00), Subtotal Rs 55.00, Tax Rs 2.75, TOTAL Rs 57.75, Cash Rs 60.00, CHANGE Rs 2.25, FBR Ref: (sample) + QR placeholder, "Please come again."
- Subtitle: "Customize how receipts look when printed from the POS" (capitalized ✓ but no period)
- Screenshot: `phase2-setup-receipt-templates.png` (before)

### 42. Printer Settings ⚠️
- ⚠️ **No subtitle at all** (other Setup pages have subtitles)
- ⚠️ **Form is bare HTML** — raw checkboxes/labels, no design-system primitives. Older layout, drift class as Price Lists / Review Moderation / Inventory Audit.
- ⚠️ **Save Settings button is BLUE** (yet another primary CTA color)
- Form fields:
  - Enable Hardware Printing checkbox
  - Connection Type: radio (Network / WiFi (TCP) | USB)
  - Paper Size dropdown (Custom default), char count input ("Enter chars per line (e.g. 40)")
  - Purpose dropdown ("Receipt (default)") + helper "Kitchen stations map to fire-chit printers via KDS station config."
  - Kick Cash Drawer on Sale checkbox
  - Save Settings button (blue) + Test Print (outline)
- Email Settings section embedded at bottom:
  - Enable Email Receipts checkbox
  - SMTP Host (smtp.gmail.com placeholder), SMTP Port (587 placeholder)
- Screenshot: `phase2-setup-printer-settings.png`

### 43. Import Data ✅
- 5 tabs: Products / Customers / Suppliers / Expenses / Payments
- Each tab: drag-drop uploader card with "Click to upload or drag and drop" + "CSV, XLSX, or XLS files" + Download Template button (right-aligned)
- Helper: "Download the template to see the expected format, then upload your filled file."
- Subtitle: "Upload CSV or Excel files to bulk import products, customers, suppliers, expenses, and payments." (capitalized ✓)
- Screenshot: `phase2-setup-import-data.png`

### 44. Import from Shopify/Square ✅
- Excellent migration UX
- Form: Exporting from dropdown (Shopify default) + Data type dropdown (Products default)
- Helper: "Don't have an export yet? Grab a template shaped like a real Shopify CSV." + Download Shopify template button (right)
- Drag-drop uploader: "Click to upload or drag and drop — CSV, XLSX, or XLS exported from Shopify"
- Subtitle: "Switching from Shopify or Square? Export your data from their dashboard and upload it here." (capitalized ✓)
- Screenshot: `phase2-setup-import-from-competitor.png`

### 45. Backup & Restore ✅ ⚠️
- ⚠️ **5th nav-vs-title mismatch today:** breadcrumb = "Backup", page title = "Backup & Restore"
- Two-card layout:
  - Download Backup card: "Export current database as backup file" + **Download Backup button (GREEN ✓ correct design-system color)**
  - Restore from Backup card: "Replace current data with a backup file" + Choose File button + red warning "⚠ This will permanently overwrite all current data."
- Backup Log card: "0 entries", columns Timestamp / Type / Performed By / Size, empty state "No backup history. Your backup activity will appear here."
- Header CTA: Refresh Log (outline)
- Subtitle: "Download a database backup or restore from a previous backup file." (capitalized ✓)
- Screenshot: `phase2-setup-backup-restore.png`

---

## Online Store (1)

### 46. View Storefront ⚠️ MEDIUM
- Opens in new tab (correct — public-facing storefront)
- ⚠️ **UX trap for new tenants.** Welcome page renders cleanly:
  - Top nav: "Live Test 1" logo + "All Products" link + cart icon
  - Hero: "Welcome to Live Test 1" + "Browse our collection of products and find what you need." + **Shop Now button (PURPLE)**
  - "Featured Products" section: "**No products available yet.**" + View all link
- All Products page (`/store/livetest1/products`):
  - Search products + Newest sort
  - Empty state: "**No products found. Try adjusting your search or filters.**" ← **misleading — no filters active**
  - Footer: "Live Test 1 / Powered by SanoPOS"
- Backend reality (verified via DB):
  - Tenant has 5 products in inventory
  - But `channel_publications` table has **0 rows** (no products published to storefront channel)
  - Storefront query joins `products → channel_publications cp → sales_channels sc` filtered by `cp.is_published=true AND sc.code='storefront'`
  - Working as designed — products require explicit publishing
- ⚠️ **Real issues:**
  - Empty-state copy is misleading ("Try adjusting filters" when there are none)
  - No clear path FROM Inventory TO publish a product to the online store
  - New tenants see 5 sample products in dashboard but empty storefront — confusing
- Suggested fix: better empty-state copy + "Publish to online store" toggle on product cards in Inventory
- Screenshots: `phase2-online-store-storefront.png`, `phase2-online-store-all-products.png`

---

## Compliance (2)

### 47. FBR Settings ✅ ⚠️
- ⚠️ **Breadcrumb shows "Fbr"** (lowercase 'br') instead of "FBR" — minor typography
- Sections (cards):
  - Enable FBR Integration: green toggle (currently ON)
  - Connection Status: gray dot + "Not Tested"
  - Tax Registration: NTN input (placeholder "National Tax Number"), STRN input (placeholder "Sales Tax Registration Number"), helper "From your company profile" under each
  - API Configuration: Province dropdown ("Select Province"), Environment toggle (Sandbox green-fill / Production outline), FBR API Token input (placeholder "Enter your FBR API token"), helper "Don't have an API token yet? Apply through the FBR IRIS portal.", Default HS Code field (below fold)
- ⚠️ Subtitle "Configure FBR (Federal Board of Revenue) integration for tax compliance" missing trailing period
- Screenshot: `phase2-compliance-fbr-settings.png`

### 48. Tax Lookup ✅ ⚠️
- ⚠️ **6th nav-vs-title mismatch today:** page title = "Tax Rate Lookup", sidebar = "Tax Lookup"
- Filter strip: Province dropdown (Punjab default), search box (bilingual EN/UR with placeholder "e.g. 0402, milk, dairy, دودھ") + green search icon button
- Columns: HS Code / Description (EN) / Description (UR) / Federal GST / Punjab Rate / Exemption Notes / Actions
- Empty state: "Enter a search term above to look up tax rates."
- Header CTA: Download Full Schedule
- Subtitle: "Search Pakistan federal and provincial tax rates by product, HS code, or category" (capitalized ✓ but no period)
- Screenshot: `phase2-compliance-tax-lookup.png`

---

## Admin (5)

### 49. Administrator ✅
- Page = roles/permissions management
- Filter: search roles, "3 roles" counter
- 3 system roles visible:
  - **Admin** (System badge): "Full access admin role" — perms: all_access, manage_customers, manage_employees, manage_inventory, +6 more
  - **Manager** (System badge): "Access to most features except admin settings" — perms: manage_inventory, manage_orders, view_reports, manage_employees, +5 more
  - **Cashier** (System badge): "Access to POS and basic features" — perms: view_reports, pos_discount, pos_park (3 total)
- Per-row action: Edit
- Header CTA: **+ Add Role** (green-fill)
- Subtitle: "Manage roles and permission assignments." (capitalized ✓)
- Screenshot: `phase2-admin-administrator.png`

### 50. Action History ✅ ⚠️
- Audit log table with 4 entries (all "Hassan logged in"):
  - 4/28/2026, 12:43:56 AM
  - 4/27/2026, 7:11:31 PM
  - 4/27/2026, 7:07:02 PM
  - 4/27/2026, 6:25:01 PM
- Filters: From/To dates, action type dropdown (All), search actions/employees/entities, "4 entries" counter
- Columns: Timestamp / Employee (System) / Action (—) / Entity (—) / Details
- ⚠️ **Action and Entity columns are blank for login events.** Could be by design (text in Details column) but visually odd — every row shows "—" in those columns.
- Header CTAs: Export CSV, Refresh
- Subtitle: "Audit log of all system actions and events." (capitalized ✓)
- Screenshot: `phase2-admin-action-history.png`

### 51. Retail Risk ✅
- 3 tabs: No-Sale Events / Anomaly Flags / Settings
- No-Sale Events tab (default): From/To dates (default 04/20/2026 – 04/27/2026 = last 7 days), Apply button, "0 events" counter
- Empty state: "No events in range. Try widening the date range or check another outlet."
- Subtitle: "Monitor cash-drawer opens, refund approvals, and employee anomaly flags." (capitalized ✓)
- Screenshot: `phase2-admin-retail-risk.png`

### 52. Billing ⚠️
- ⚠️ **No subtitle on this page**
- Current Plan card: "Free" badge + "You're on the Free plan (1 outlet, 3 employees, 100 products). Upgrade to Pro for unlimited access."
- Upgrade to Pro section: "Unlimited employees, unlimited products, and all advanced features. Pricing per outlet — choose a billing cycle:"
- 4 pricing tier cards (left to right):
  - **Annual PKR 80,000** + "BEST VALUE" pill, PKR 6,667/mo equivalent, 17% OFF, Save PKR 16,000
  - **Monthly PKR 8,000**, PKR 8,000/mo
  - **Quarterly PKR 21,600** ← **PRE-SELECTED with green border**, PKR 7,200/mo, 10% OFF, Save PKR 2,400
  - **Semi-Annual PKR 40,800**, PKR 6,800/mo, 15% OFF, Save PKR 7,200
- Action button: "**Upgrade Now — PKR 21,600/quarter**" (green-fill, matches Quarterly)
- ⚠️ **Wrong default selection:** "BEST VALUE" pill is on Annual (17% off, save 16k), but Quarterly is the highlighted/default cycle (only 10% off). Default should match the recommended pill.
- Per code comment: "Annual cycle is RECOMMENDED_CYCLE" — UI doesn't match.
- Screenshot: `phase2-admin-billing.png`

### 53. My Tickets ✅
- Empty state with chat-bubble icon: "**No tickets submitted yet.** Use the support widget to submit a ticket"
- Subtitle: "Support tickets you have submitted" (capitalized ✓ but no period)
- Screenshot: `phase2-admin-my-tickets.png`

---

## Cross-page polish-bundle summary

### Lowercase-leading subtitle pattern (9 pages)
- Brands → [BrandsRedesign.jsx:103](frontend/src/pages/redesign/BrandsRedesign.jsx#L103) — "brand taxonomy with consistent CRUD and search behavior."
- Taxes → [TaxesRedesign.jsx:105](frontend/src/pages/redesign/TaxesRedesign.jsx#L105) — "tax profiles with default control and fast editing."
- Attribute Sets → [AttributeSetsRedesign.jsx:176](frontend/src/pages/redesign/AttributeSetsRedesign.jsx#L176) — "variant schema management with nested attributes and options."
- Promotions → [PromotionsRedesign.jsx:312](frontend/src/pages/redesign/PromotionsRedesign.jsx#L312) — "manage discount rules and test promotion outcomes on sample carts."
- Purchase Orders — "manage supplier ordering lifecycle from draft to GRN."
- Stock Adjustments — "auditable shrink/gain adjustments per outlet."
- Transfers — "stock movement between outlets with full traceability."
- Returned Stock — "supplier return (RMA) workflow and stock-out tracking."
- Supplier Payables — "monitor supplier outstanding balances and record invoice payments."

Pages WITHOUT the issue (correctly capitalized): Gift Cards, Returns, Sales History, Categories, Reorder Alerts, Inventory Intelligence, Suppliers, Quotations, CRM, HR, Employees, Outlets, Company Profile, Import Data, Import from Shopify/Square, Backup & Restore, Administrator, Action History, Retail Risk, My Tickets.

### Subtitles missing trailing period (10 pages)
- Inventory Audit, Approvals, Reports, Accounting (already capitalized so just period), Chart of Accounts, Credit/Debit Notes, Post-Dated Cheques, Attendance, Integrations, Tax Lookup, Courier Settings, Barcode Templates, Receipt Templates, FBR Settings, My Tickets

### Nav-vs-title mismatches (6 pages)
1. Inventory Audit → "Stock Counts" (URL slug)
2. HR → "HR Management"
3. Company Profile → "Company Settings"
4. Barcode Templates → "Barcode Label Designer"
5. Backup & Restore → "Backup" (breadcrumb)
6. Tax Lookup → "Tax Rate Lookup"

Plus: FBR breadcrumb shows "Fbr" instead of "FBR", Chart of Accounts breadcrumb shows "Chart Of Accounts" (capital O).

### Layout drift on older pages (4 pages)
- Price Lists — no KPI strip, outline-style CTA
- Review Moderation — no subtitle, no KPIs, no CTA
- Inventory Audit — largely blank below the title
- Printer Settings — bare HTML form, no design-system primitives

### CTA color drift (5+ styles across primary actions)
- Green-fill (correct, design-system standard): Add Product, Add Category, Save Profile, Add Lead, etc.
- Green-outline: Print Labels (Barcode Templates)
- Blue: New Template (Barcode Templates), Add Custom Courier, Apply (Attendance), Save Settings (Printer Settings), Connect (Integrations)
- Purple/violet: New Template (Receipt Templates), Shop Now (Storefront)
- White-outline: Refresh (multiple)

### Outline-style "+ New X" CTAs that should be green-fill (drift)
- Price Lists → "+ New Price List"
- Inventory Audit → "Start Count"
- Chart of Accounts → "+ Add Account"
- Credit/Debit Notes → "+ New Note"
- Post-Dated Cheques → "+ New Cheque"

### Other cosmetic nits
- Stock display `100.000` — trailing zeros on Products page
- "GST %" hardcoded label on Add Product Pricing section
- "outlet #1" ID leak in Notifications body text
- Login `/api/context/bootstrap` 401 (harmless noise)
- Reports subtitle missing space ("acrosssales") + lists "restaurant" reports for retail
- Revenue Forecast chart width(-1)/height(-1) sizing race
- Post-Dated Cheques 3 silent 503s on bootstrap (suppliers, customers, cheques/upcoming)
- Action History blank Action/Entity columns for login events

---

## Outstanding medium issues (functional)

| # | Page | Issue |
|---|---|---|
| 1 | Insights → Accounting | `GET /api/accounting/cashflow/daily?from=…&to=…` returns **400** on page load |
| 2 | Stock Control → Inventory Audit | Page largely blank below title; breadcrumb mismatch ("Stock Counts" vs "Inventory Audit"); outline-style CTA |
| 3 | Online Store → Storefront | Empty state copy misleading ("Try adjusting your search or filters" when no filters active); no clear path from Inventory to publish products to storefront channel |
| 4 | Admin → Billing | Wrong default cycle — "BEST VALUE" pill on Annual but Quarterly is pre-selected |

---

## Withdrawn finding (not a bug)

- **Returns "Original sale id (optional)" UI label** — git/code check confirmed [routes/returns.js:153](backend/routes/returns.js#L153) treats `original_sale_id` as nullable (handles web-order returns + no-receipt returns). UI label is correct. The OpenAPI doc string at lines 27/37 is the stale source; CLAUDE.md was quoting the doc. **Doc-fix candidate**, not UX bug.

---

## Pre-launch verifications still pending

1. **Day-1 fix #3 (Default Tax `is_default=true`) verification** — sign up a fresh test tenant and confirm provisioner inserts Default Tax 0% with `is_default=true`. livetest1 has pre-fix residue (both Default Tax 0% and GST 17% present, neither marked default). Defer to Phase 8 cleanup window.
2. **livetest1 v69 migration block** — make v69 idempotent against partial-schema state before onboarding any real existing tenants. Not a launch blocker (livetest1 gets nuked in Phase 8) but a hidden trap.

---

## Meta-insight: provisioner-loop bug class

3 instances of the same class in 2 days:
- v79: loyalty_tiers (Day 1)
- v80: chart_of_accounts (Day 2)
- v81: courier_integrations (Day 2)

Cross-table audit during the v81 fix confirmed couriers was the **last** vulnerable seed table. Other seed tables verified clean: chart_areas (97/97), role_permissions (22/22), void_reason_codes (10/10), return_reasons (6/6), no_sale_reasons (4/4), override_reasons (4/4).

**Suggested follow-up:** add a unit test that runs the provisioner end-to-end and asserts no duplicate seed rows for any natural key. Would have caught all three at PR time.
