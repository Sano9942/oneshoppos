# SanoPOS Full-Day Store Operations Simulation Plan

> **Purpose**: Exhaustive Playwright-driven E2E audit of every module, feature, and report tab in SanoPOS.
> Simulates a complete day of real store operations — from opening to close — testing 335+ scenarios across 20 phases.
>
> **Target**: `http://localhost:5173` (frontend) / `http://localhost:5000` (backend)
>
> **Last updated**: 2026-03-07

---

## Skipped Sections (Hardware / External Services Not Available)

The following tests are **skipped** during this simulation run because the required hardware or external services are not connected/configured:

| Category | What's Skipped | Reason |
| --- | --- | --- |
| **Shopify Integration** | Phase 18 entirely (tests 18.1–18.4) | Shopify account not connected/configured |
| **Email Receipts (SMTP)** | Test 1.70 (Email Settings SMTP fields), Test 1.71 (Test email button), Tests 3.38–3.40 (Email Receipt from POS) | SMTP not configured — no email provider set up |
| **Printer Hardware (ESC/POS)** | Test 1.68 (Printer Settings nav), Test 1.69 (Printer config USB/TCP) — hardware-send parts only | No physical thermal printer connected |
| **Barcode Scanner Hardware** | Test 3.4 (Barcode scanner rapid keystroke simulation) | No physical barcode scanner connected |

**Still tested** (no hardware needed):
- Barcode Templates page (UI rendering, template CRUD)
- Receipt Templates page (UI rendering, template CRUD)
- Browser print popup (receipt rendering via `buildReceiptHtml`)
- Printer Settings page **navigation** (just skip actual hardware send/test buttons)
- Email config form **rendering** (just skip send/test actions)

**Adjusted test count**: ~335 scenarios (down from ~352)

---

## Table of Contents

- [Phase 0: Pre-Flight & Environment Verification](#phase-0-pre-flight--environment-verification)
- [Phase 1: Store Setup — Master Data Configuration](#phase-1-store-setup--master-data-configuration)
- [Phase 2: Opening the Day — Shift & Attendance](#phase-2-opening-the-day--shift--attendance)
- [Phase 3: POS Operations — Full Sales Lifecycle](#phase-3-pos-operations--full-sales-lifecycle)
- [Phase 4: Returns & Exchanges](#phase-4-returns--exchanges)
- [Phase 5: Inventory Management](#phase-5-inventory-management)
- [Phase 6: Customers Module](#phase-6-customers-module)
- [Phase 7: Orders Module](#phase-7-orders-module)
- [Phase 8: Expenses](#phase-8-expenses)
- [Phase 9: Sales History & Cash Management](#phase-9-sales-history--cash-management)
- [Phase 10: End of Day — Close Operations](#phase-10-end-of-day--close-operations)
- [Phase 11: Reports — Every Single Tab (67 tabs)](#phase-11-reports--every-single-tab-67-tabs)
- [Phase 12: Dashboard Deep Verification](#phase-12-dashboard-deep-verification)
- [Phase 13: Accounting & Finance](#phase-13-accounting--finance)
- [Phase 14: Tier 4 Feature-Flagged Modules](#phase-14-tier-4-feature-flagged-modules)
- [Phase 15: RBAC & Security Testing](#phase-15-rbac--security-testing)
- [Phase 16: Backup & Restore](#phase-16-backup--restore)
- [Phase 17: Action History & Audit Trail](#phase-17-action-history--audit-trail)
- [Phase 18: Shopify Integration (Smoke Test)](#phase-18-shopify-integration-smoke-test)
- [Phase 19: Reconciliation](#phase-19-reconciliation)
- [Phase 20: Edge Cases & Stress Tests](#phase-20-edge-cases--stress-tests)
- [Summary](#summary)
- [Bug Report Template](#bug-report-template)

---

## Phase 0: Pre-Flight & Environment Verification

> Before any store operations — verify the system boots and the authenticated shell works.

| #   | Test                                            | Expected Result                                          | Status |
| --- | ----------------------------------------------- | -------------------------------------------------------- | ------ |
| 0.1 | `GET /api/health` returns 200                   | `{"status":"ok","missing_tables":[]}`                    | [ ]    |
| 0.2 | Frontend loads login page at `/login`            | Login form renders with PIN field and employee dropdown  | [ ]    |
| 0.3 | Login as Administrator (Hassan, PIN)             | Redirects to `/context-select`                           | [ ]    |
| 0.4 | Context Select — pick outlet                    | Sets `x-outlet-id` header, redirects to `/dashboard`    | [ ]    |
| 0.5 | Dashboard loads with no JS errors                | `/api/reports/dashboard` returns 200, widgets render     | [ ]    |
| 0.6 | `GET /api/feature-flags` returns all flags       | JSON array with keys: `accounting_core`, `crm_quotations`, `advanced_hr`, `multi_company`, `backup_restore`, `supplier_payables`, `context_header_enforced`, etc. | [ ]    |
| 0.7 | Sidebar renders all nav groups                   | 8 groups visible: Overview, Commerce, Inventory, Stock Control, Procurement, Insights, Operations, Setup, Admin | [ ]    |

### Pre-flight validation details

- **Backend process**: `cd backend && npm start` — should bind port 5000
- **Frontend process**: `cd frontend && npm run dev` — should bind port 5173
- **Database**: `backend/sanopos.db` exists, 70 migrations applied
- **Auth session**: stored in `localStorage["authSession"]` — contains employee object + permissions
- **Context**: stored in `localStorage["activeContext"]` — contains `outlet_id`, `scope_mode`

---

## Phase 1: Store Setup — Master Data Configuration

> An owner setting up their store from scratch. Tests every CRUD page in the Setup and Inventory nav groups.

### Phase 1A: Company Profile & Settings

| #    | Test                                                          | Route / API                          | Expected Result                                  | Status |
| ---- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ------ |
| 1.1  | Navigate to Company Settings                                  | `/company-settings`                  | Page loads, form renders with current values      | [ ]    |
| 1.2  | Update company name, address, phone, email                    | `PUT /api/company-profile`           | Toast: "Saved", values persist on reload         | [ ]    |
| 1.3  | Set timezone to `Asia/Karachi`                                | `PUT /api/company-profile`           | Dropdown shows IANA timezones, saves correctly    | [ ]    |
| 1.4  | Upload company logo                                           | `POST /api/company-profile/logo`     | Logo preview updates, file stored in uploads/     | [ ]    |
| 1.5  | Set Dashboard Targets section                                 | `PUT /api/company-profile`           | `monthly_sales_target`, `margin_threshold_pct`, `refund_threshold_pct`, `void_threshold_pct` fields save | [ ]    |
| 1.6  | Reload page — verify all saved values persist                 | `/company-settings`                  | All fields populated with saved values            | [ ]    |

**What this validates**: Company profile CRUD, file upload, timezone persistence, dashboard target columns (migrate69).

---

### Phase 1B: Outlets

| #    | Test                                              | Route / API                    | Expected Result                              | Status |
| ---- | ------------------------------------------------- | ------------------------------ | -------------------------------------------- | ------ |
| 1.7  | Navigate to Outlets                                | `/outlets`                     | Page loads, shows existing outlets            | [ ]    |
| 1.8  | Create Outlet "Main Store" (name, address, phone)  | `POST /api/outlets`            | Outlet appears in list                       | [ ]    |
| 1.9  | Create Outlet "Branch 2"                           | `POST /api/outlets`            | Second outlet appears                        | [ ]    |
| 1.10 | Edit outlet — change address                       | `PUT /api/outlets/:id`         | Updated address shows in list                | [ ]    |
| 1.11 | Verify both outlets in Context Select dropdown     | `GET /api/context/bootstrap`   | Both outlets available for selection          | [ ]    |

**What this validates**: Outlet CRUD, context bootstrap integration.

---

### Phase 1C: Employees & Roles

| #    | Test                                                       | Route / API                     | Expected Result                                   | Status |
| ---- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------- | ------ |
| 1.12 | Navigate to Employees                                       | `/employees`                    | Page loads, shows employee table                   | [ ]    |
| 1.13 | View existing employees (at least Hassan/Administrator)      | `GET /api/employees`            | Employee list renders with name, role, outlet      | [ ]    |
| 1.14 | Create employee — role: Cashier, assign outlet, set PIN      | `POST /api/employees`           | New employee in list, PIN set for kiosk login      | [ ]    |
| 1.15 | Create employee — role: Manager                              | `POST /api/employees`           | Manager appears with correct role badge            | [ ]    |
| 1.16 | Edit employee — change outlet assignment                     | `PUT /api/employees/:id`        | Outlet changes, reflected in list                  | [ ]    |
| 1.17 | Navigate to Administrator page                               | `/administrator`                | Roles & permissions matrix visible                 | [ ]    |
| 1.18 | Verify RBAC matrix — Cashier has limited perms, Admin has all | `/administrator`               | Permission checkboxes match role definitions        | [ ]    |

**What this validates**: Employee CRUD, PIN assignment (for kiosk), role-permission mapping, `requirePerm("all_access")` guard on this page.

---

### Phase 1D: Taxes

| #    | Test                                                  | Route / API              | Expected Result                              | Status |
| ---- | ----------------------------------------------------- | ------------------------ | -------------------------------------------- | ------ |
| 1.19 | Navigate to Taxes                                      | `/taxes`                 | Page loads, tax list visible                  | [ ]    |
| 1.20 | Create tax: "GST 17%", rate=17, type=percentage        | `POST /api/taxes`        | Tax appears in list                           | [ ]    |
| 1.21 | Create tax: "Service Tax 5%", rate=5                   | `POST /api/taxes`        | Second tax appears                            | [ ]    |
| 1.22 | Edit tax — change rate from 5% to 7%                   | `PUT /api/taxes/:id`     | Rate updates in list                          | [ ]    |
| 1.23 | Delete "Service Tax"                                   | `DELETE /api/taxes/:id`  | Tax removed from list                         | [ ]    |

**What this validates**: Tax CRUD, tax application on products later in POS.

---

### Phase 1E: Categories (Hierarchical Tree)

| #    | Test                                                          | Route / API                    | Expected Result                                                 | Status |
| ---- | ------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- | ------ |
| 1.24 | Navigate to Categories                                         | `/categories`                  | Tree view renders (or empty state)                               | [ ]    |
| 1.25 | Create root category "Electronics"                             | `POST /api/categories`         | Node appears at root level                                       | [ ]    |
| 1.26 | Create child "Electronics > Mobile Phones" (parent=Electronics) | `POST /api/categories`        | Child indented under parent, breadcrumb: "Electronics > Mobile Phones" | [ ]    |
| 1.27 | Create child "Electronics > Accessories"                       | `POST /api/categories`         | Second child under Electronics                                   | [ ]    |
| 1.28 | Create root category "Groceries"                               | `POST /api/categories`         | Second root node                                                 | [ ]    |
| 1.29 | Create child "Groceries > Snacks"                              | `POST /api/categories`         | Child under Groceries                                            | [ ]    |
| 1.30 | Verify tree renders with breadcrumb paths                      | `/categories`                  | Path labels like "Electronics > Mobile Phones" visible            | [ ]    |
| 1.31 | In product creation — parent nodes disabled for assignment      | `/inventory` (product form)    | "Electronics" is not selectable; only "Mobile Phones", "Accessories", "Snacks" are | [ ]    |
| 1.32 | Edit category name                                             | `PUT /api/categories/:id`      | Name updates in tree                                             | [ ]    |
| 1.33 | Delete empty leaf category                                     | `DELETE /api/categories/:id`   | Node removed from tree                                           | [ ]    |

**What this validates**: Hierarchical category CRUD (`backend/category-tree.js`), leaf-only assignment rule, breadcrumb path rendering (`frontend/src/utils/categoryTree.js`).

---

### Phase 1F: Brands

| #    | Test                                       | Route / API               | Expected Result                    | Status |
| ---- | ------------------------------------------ | ------------------------- | ---------------------------------- | ------ |
| 1.34 | Navigate to Brands                          | `/brands`                 | Page loads, brand list visible      | [ ]    |
| 1.35 | Create brands: "Samsung", "Apple", "Local"  | `POST /api/brands`        | All three appear in list            | [ ]    |
| 1.36 | Edit brand name "Local" to "Local Brand"    | `PUT /api/brands/:id`     | Name updates                        | [ ]    |
| 1.37 | Delete unused brand                         | `DELETE /api/brands/:id`  | Brand removed                       | [ ]    |

**What this validates**: Brand CRUD, brand dropdown population in product form.

---

### Phase 1G: Attribute Sets

| #    | Test                                                                       | Route / API                    | Expected Result                                      | Status |
| ---- | -------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------- | ------ |
| 1.38 | Navigate to Attribute Sets                                                  | `/attribute-sets`              | Page loads                                            | [ ]    |
| 1.39 | Create attribute set "Color-Size" with: Color (Red, Blue, Black), Size (S, M, L, XL) | `POST /api/attribute-sets` | Attribute set appears with 3 colors x 4 sizes = 12 combos | [ ]    |
| 1.40 | Verify attributes render in list view                                       | `/attribute-sets`              | Color and Size groups visible with values              | [ ]    |

**What this validates**: Attribute set CRUD, variant generation foundation for products.

---

### Phase 1H: Suppliers

| #    | Test                                                              | Route / API                | Expected Result                           | Status |
| ---- | ----------------------------------------------------------------- | -------------------------- | ----------------------------------------- | ------ |
| 1.41 | Navigate to Suppliers                                              | `/suppliers`               | Page loads, supplier list visible          | [ ]    |
| 1.42 | Create supplier: "Tech Distributors" (name, phone, email, credit_limit=50000) | `POST /api/suppliers` | Supplier appears with credit limit shown  | [ ]    |
| 1.43 | Create supplier: "Snack Corp" (payment_type=credit)                | `POST /api/suppliers`      | Credit supplier appears                    | [ ]    |
| 1.44 | Edit supplier — update credit limit to 75000                       | `PUT /api/suppliers/:id`   | Limit updates                              | [ ]    |

**What this validates**: Supplier CRUD, credit limit field (used for PO warnings in Phase 5).

---

### Phase 1I: Products

| #    | Test                                                                          | Route / API                     | Expected Result                                           | Status |
| ---- | ----------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------- | ------ |
| 1.45 | Navigate to Products                                                           | `/inventory`                    | Product list with SKU + Cost columns visible               | [ ]    |
| 1.46 | Create simple product: "iPhone 15" — barcode, SKU, price=150000, cost=120000, category=Mobile Phones, brand=Apple, tax=GST 17%, opening stock=10 | `POST /api/products` | Product appears in list with correct fields | [ ]    |
| 1.47 | Attempt to create product with price=0 — validation blocks                     | `POST /api/products`            | 400 error: price must be > 0                               | [ ]    |
| 1.48 | Create variant product: "T-Shirt" — attribute set Color-Size, generate variants, set per-variant stock=20, price=1500 each | `POST /api/products` | Product with 12 variants (3 colors x 4 sizes) created | [ ]    |
| 1.49 | Create product: "Chips Packet" — category=Snacks, brand=Local Brand, price=50, stock=100 | `POST /api/products` | Product appears | [ ]    |
| 1.50 | Create product: "Samsung Galaxy A55" — barcode=123456789, price=85000, stock=5 | `POST /api/products`           | Product with barcode                                       | [ ]    |
| 1.51 | Create 2-3 more products for POS testing: "Headphones" (price=2500, stock=30), "Water Bottle" (price=100, stock=200), "Laptop Stand" (price=5000, stock=15) | `POST /api/products` | All products created | [ ]    |
| 1.52 | Edit "Headphones" — change price from 2500 to 2800                             | `PUT /api/products/:id`         | Price updates in list                                      | [ ]    |
| 1.53 | Upload product image for "iPhone 15"                                           | `POST /api/products/:id/image`  | Image preview shows in product card                        | [ ]    |
| 1.54 | Bulk import via CSV — download CSV template, fill with 3 products, upload       | `POST /api/products/import`     | Results modal shows: 3 imported, 0 errors                  | [ ]    |
| 1.55 | Verify SKU + Cost columns visible in product list table                        | `/inventory`                    | Columns present, values match                              | [ ]    |
| 1.56 | Create product with duplicate barcode (same as iPhone 15) — should succeed      | `POST /api/products`            | No UNIQUE constraint error (migrate68 removed it)          | [ ]    |

**What this validates**: Product CRUD, variant generation, price>0 validation, CSV bulk import, SKU/Cost columns (migrate68), duplicate barcode allowance, image upload.

---

### Phase 1J: Promotions

| #    | Test                                                                             | Route / API                 | Expected Result                                    | Status |
| ---- | -------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------- | ------ |
| 1.57 | Navigate to Promotions                                                            | `/promotions`               | Page loads, promotion list visible                  | [ ]    |
| 1.58 | Create percentage promotion: "10% off Electronics" — target category=Electronics, discount_pct=10, date range=today to +7 days | `POST /api/promotions` | Promotion appears with correct dates | [ ]    |
| 1.59 | Create fixed-amount promotion: "Rs. 50 off Chips" — target product=Chips Packet, discount_amount=50 | `POST /api/promotions` | Promotion appears | [ ]    |
| 1.60 | Create buy-X-get-Y or min-quantity promotion (if supported)                       | `POST /api/promotions`      | Promotion created or graceful "not supported" state | [ ]    |
| 1.61 | Verify promotions list with correct dates, types, targets                         | `/promotions`               | All promotions visible with status (active/upcoming) | [ ]    |

**What this validates**: Promotion CRUD, category-level and product-level targeting, date range validation.

---

### Phase 1K: Receipt Templates

| #    | Test                                                       | Route / API                      | Expected Result                                | Status |
| ---- | ---------------------------------------------------------- | -------------------------------- | ---------------------------------------------- | ------ |
| 1.62 | Navigate to Receipt Templates                               | `/receipt-templates`             | Page loads, template list visible               | [ ]    |
| 1.63 | Create/edit template — set header_text="SanoPOS Store", footer_text="Thank you for shopping!", show_barcode=true | `PUT /api/receipt-templates/:id` | Template saves with all fields | [ ]    |
| 1.64 | Preview receipt template                                    | `/receipt-templates`             | Preview panel shows formatted receipt           | [ ]    |

**What this validates**: Receipt template CRUD, `header_text`/`footer_text`/`show_barcode` fields that flow into POS receipt rendering (`frontend/src/utils/receipt.js`).

---

### Phase 1L: Barcode Templates

| #    | Test                                                 | Route / API                       | Expected Result                          | Status |
| ---- | ---------------------------------------------------- | --------------------------------- | ---------------------------------------- | ------ |
| 1.65 | Navigate to Barcode Templates                         | `/barcode-templates`              | Page loads                                | [ ]    |
| 1.66 | Create barcode label template (format, size, fields)  | `POST /api/barcode-templates`     | Template appears in list                  | [ ]    |
| 1.67 | Print/preview barcode labels for "iPhone 15"          | Barcode generation UI             | Label preview renders with product data   | [ ]    |

**What this validates**: Barcode template CRUD, label generation.

---

### Phase 1M: Printer & Email Settings

| #    | Test                                                        | Route / API                    | Expected Result                                | Status |
| ---- | ----------------------------------------------------------- | ------------------------------ | ---------------------------------------------- | ------ |
| 1.68 | Navigate to Printer Settings                                 | `/printer-settings`            | Page loads with printer config form             | [ ]    |
| 1.69 | ~~View printer config options (USB / TCP connection type)~~   | `GET /api/print/config`        | **SKIP — no physical printer connected**        | [SKIP] |
| 1.70 | ~~Email Settings section visible — SMTP host, port, user, pass~~ | `GET /api/email/config`     | **SKIP — SMTP not configured**                  | [SKIP] |
| 1.71 | ~~Test email button (sends test email if SMTP configured)~~   | `POST /api/email/test`         | **SKIP — SMTP not configured**                  | [SKIP] |

**What this validates**: Printer config CRUD (`printer_config` table, migrate64), email config CRUD (`email_config` table, migrate65), password security (never exposed to frontend).

---

## Phase 2: Opening the Day — Shift & Attendance

> Morning routine: open the cash register, staff clock in via kiosk, verify dashboard reflects live status.

| #    | Test                                                        | Route / API                                | Expected Result                                       | Status |
| ---- | ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- | ------ |
| 2.1  | Open POS in new tab                                          | `/pos`                                     | POS page loads, opening gate modal appears             | [ ]    |
| 2.2  | POS Opening Gate — select outlet (if multi-outlet)           | POSOpeningGateModal                        | Outlet selector dropdown populated                     | [ ]    |
| 2.3  | Open new shift — enter opening cash denomination breakdown    | `POST /api/shifts` (with denominations)    | Shift created, POS header shows shift ID + outlet      | [ ]    |
| 2.4  | Verify shift is active in POS header                         | POS UI                                     | Shift badge shows "Open" with start time               | [ ]    |
| 2.5  | Open Kiosk in separate tab                                   | `/kiosk`                                   | Kiosk PIN entry screen renders                         | [ ]    |
| 2.6  | Clock in Employee 1 (Cashier) via PIN                        | `POST /api/attendance/pin-clock-in`        | Success message, employee status = "clocked_in"        | [ ]    |
| 2.7  | Clock in Employee 2 (Manager) via PIN                        | `POST /api/attendance/pin-clock-in`        | Success message                                        | [ ]    |
| 2.8  | Clock in Administrator (Hassan) via PIN                      | `POST /api/attendance/pin-clock-in`        | Success message                                        | [ ]    |
| 2.9  | Dashboard → Staff Today shows all 3 as "In"                  | `/dashboard` → DashboardAttendance         | 3 cards with green "In" badges                         | [ ]    |
| 2.10 | Attendance page shows today's records                        | `/attendance` with date filter = today     | 3 employee rows with check_in times                    | [ ]    |
| 2.11 | Dashboard → Ops Readiness shows shift open + staff count      | `/dashboard` → DashboardOpsReadiness       | "Shift: Open", "Staff: 3 in"                           | [ ]    |
| 2.12 | Kiosk: clock Employee 1 to "break"                           | `POST /api/attendance/pin-break`           | Status changes to "on_break"                           | [ ]    |
| 2.13 | Dashboard refreshes → Employee 1 shows "Break"               | `/dashboard` → DashboardAttendance         | Employee 1 card shows yellow "Break" badge             | [ ]    |
| 2.14 | Kiosk: end break — resume work                               | `POST /api/attendance/pin-resume`          | Status returns to "clocked_in"                         | [ ]    |
| 2.15 | Dashboard → Employee 1 shows "In" again                      | `/dashboard` → DashboardAttendance         | Green "In" badge restored                              | [ ]    |

**What this validates**: Shift opening with denominations, kiosk PIN clock-in/break/resume, dashboard attendance widget (the UTC-boundary bug fix), ops readiness widget, attendance page date filtering (the `date(check_in)` fix).

**Critical bugs to watch for**:
- Attendance sessions after 19:00 local time in UTC+ timezones not showing (the bug we just fixed)
- `date(session_start, 'localtime')` double-conversion (must use `date(session_start)` only)

---

## Phase 3: POS Operations — Full Sales Lifecycle

> The core of the business: selling products through the Point of Sale terminal.

### Phase 3A: Basic Sales — Product Search & Cart

| #    | Test                                                     | Component                     | Expected Result                                  | Status |
| ---- | -------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | ------ |
| 3.1  | Search product by name "iPhone" in POS search bar         | POSSearchArea                 | iPhone 15 appears in results                      | [ ]    |
| 3.2  | Click product to add to cart                              | POSSearchArea → POSCartTable  | Item appears in cart with qty=1                    | [ ]    |
| 3.3  | Search product by barcode number (type "123456789")       | POSSearchArea                 | Samsung Galaxy A55 appears                         | [ ]    |
| 3.4  | ~~Simulate barcode scanner — rapid keystroke injection~~   | POSContext keydown listener   | **SKIP — no physical barcode scanner connected**    | [SKIP] |
| 3.5  | Add variant product "T-Shirt" — select Color: Red, Size: M | POSSearchArea variant picker | Specific variant added with correct price           | [ ]    |
| 3.6  | Change quantity in cart (+/- buttons or manual entry)       | POSCartTable                  | Quantity updates, line total recalculates           | [ ]    |
| 3.7  | Remove item from cart (X button)                           | POSCartTable                  | Item removed, totals update                        | [ ]    |
| 3.8  | Verify cart totals: subtotal + tax = grand total            | POSCartTable / POSSidebar     | Math is correct, GST 17% applied to eligible items | [ ]    |

**What this validates**: Product search by name/barcode, barcode scanner simulation (`POSContext.jsx` keydown listener with 100ms debounce), variant selection, cart CRUD, tax calculation.

---

### Phase 3B: Discounts

| #    | Test                                                       | Component            | Expected Result                                    | Status |
| ---- | ---------------------------------------------------------- | -------------------- | -------------------------------------------------- | ------ |
| 3.9  | Apply line-item percentage discount (10%) via Discount modal | POSDiscountModal     | Line shows discount, total reduced by 10%           | [ ]    |
| 3.10 | Apply line-item fixed amount discount (Rs. 500)             | POSDiscountModal     | Line total reduced by 500                           | [ ]    |
| 3.11 | Apply cart-level discount                                   | POSDiscountModal     | Grand total reduced, discount line shown             | [ ]    |
| 3.12 | Verify promotion auto-applies (10% off Electronics)          | POSCartTable         | iPhone 15 gets automatic 10% discount               | [ ]    |
| 3.13 | Verify discount breakdown in cart summary                    | POSSidebar           | Subtotal, discount amount, tax, total all visible    | [ ]    |

**What this validates**: Manual discounts (line + cart level), automatic promotion application, discount stacking behavior.

---

### Phase 3C: Cart Notes

| #    | Test                                          | Component      | Expected Result                     | Status |
| ---- | --------------------------------------------- | -------------- | ----------------------------------- | ------ |
| 3.14 | Add note to sale via Note modal                | POSNoteModal   | Note icon appears on cart            | [ ]    |
| 3.15 | Verify note text persists until checkout       | POSCartTable   | Note visible in cart summary         | [ ]    |

---

### Phase 3D: Checkout — Multiple Payment Methods

| #    | Test                                                         | Component            | Expected Result                                         | Status |
| ---- | ------------------------------------------------------------ | -------------------- | ------------------------------------------------------- | ------ |
| 3.16 | Checkout with **Cash** — enter amount tendered                | POSCheckoutModal     | Change calculated correctly, sale completed               | [ ]    |
| 3.17 | Checkout with **Card**                                        | POSCheckoutModal     | Sale completed with payment_method=card                   | [ ]    |
| 3.18 | Checkout with **Split payment** — part cash (5000), part card (remainder) | POSCheckoutModal | Both payment methods recorded, total matches | [ ]    |
| 3.19 | Add customer to sale before checkout                          | POSCheckoutModal     | Customer name appears on sale                             | [ ]    |
| 3.20 | Receipt modal appears after sale                              | POSReceiptModal      | Receipt shows: items, totals, header/footer from template | [ ]    |
| 3.21 | Print receipt (browser popup fallback)                        | `buildReceiptHtml()` | Popup opens with formatted receipt                        | [ ]    |
| 3.22 | Sale appears in Recent Sales panel                            | POSRecentSalesPanel  | Latest sale at top with correct total                     | [ ]    |
| 3.23 | Receipt shows correct `header_text`, `footer_text`, `show_barcode` | POSReceiptModal | Matches template from Phase 1K                            | [ ]    |

**What this validates**: Checkout flow, multiple payment methods, split payments, receipt rendering (`frontend/src/utils/receipt.js`), template field propagation, `POST /api/sales` with `shift_id` linkage.

---

### Phase 3E: Customer Association

| #    | Test                                                     | Route / API              | Expected Result                              | Status |
| ---- | -------------------------------------------------------- | ------------------------ | -------------------------------------------- | ------ |
| 3.24 | Create new customer from POS checkout                     | `POST /api/customers`    | Customer created, available for selection      | [ ]    |
| 3.25 | Search and attach existing customer to new sale            | POS customer search      | Customer name shown on sale                    | [ ]    |
| 3.26 | Complete sale with customer — verify customer in receipt    | POSReceiptModal          | Customer name printed on receipt               | [ ]    |

---

### Phase 3F: Park & Retrieve Sales

| #    | Test                                                  | Route / API                | Expected Result                                 | Status |
| ---- | ----------------------------------------------------- | -------------------------- | ----------------------------------------------- | ------ |
| 3.27 | Add items to cart, click "Park Sale"                   | `POST /api/parked-sales`   | Cart cleared, parked sale saved                  | [ ]    |
| 3.28 | Start new cart — add different items                    | POS UI                     | Fresh empty cart                                  | [ ]    |
| 3.29 | Open Parked Sales modal — retrieve first parked sale    | `GET /api/parked-sales`    | Parked items restored to cart                     | [ ]    |
| 3.30 | Complete the retrieved parked sale                      | `POST /api/sales`          | Sale completed, parked sale removed from list     | [ ]    |
| 3.31 | Park multiple sales, verify list, retrieve specific one  | POSParkedModal            | Multiple parked sales listed, correct one restored | [ ]    |

**What this validates**: Parked sales CRUD (`backend/routes/parked-sales.js`), park/retrieve lifecycle.

---

### Phase 3G: Void Sale

| #    | Test                                                      | Route / API                   | Expected Result                                  | Status |
| ---- | --------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | ------ |
| 3.32 | Complete a sale, then void it from Recent Sales panel       | `PUT /api/sales/:id/void`     | Sale marked as voided                             | [ ]    |
| 3.33 | Verify voided sale shows in history with void flag          | `GET /api/sales`              | `voided=1` flag visible, styled differently       | [ ]    |
| 3.34 | Verify stock reverts after void                             | `GET /api/products/:id`       | Stock quantity increases by voided amount          | [ ]    |

**What this validates**: Void flow, stock reversion, voided sale display.

---

### Phase 3H: Blocked States (Guardrails)

| #    | Test                                                        | Component              | Expected Result                              | Status |
| ---- | ----------------------------------------------------------- | ---------------------- | -------------------------------------------- | ------ |
| 3.35 | Close shift → attempt checkout → should be **blocked**       | POSCheckoutModal       | Error: "No active shift" or checkout disabled | [ ]    |
| 3.36 | Re-open shift, clock out employee → attempt checkout → **blocked** | POSCheckoutModal | Error: "Employee not clocked in"             | [ ]    |
| 3.37 | Clock back in → verify checkout works again                  | POSCheckoutModal       | Sale completes successfully                   | [ ]    |

**What this validates**: POS operational guardrails — shift gating + attendance gating enforced in `POST /api/sales`.

---

### Phase 3I: Email Receipt

| #    | Test                                                      | Component                  | Expected Result                              | Status |
| ---- | --------------------------------------------------------- | -------------------------- | -------------------------------------------- | ------ |
| 3.38 | ~~From Recent Sales → click Email Receipt button~~         | POSRecentSalesPanel        | **SKIP — SMTP not configured**                | [SKIP] |
| 3.39 | ~~Enter email address in modal~~                           | POSEmailReceiptModal       | **SKIP — SMTP not configured**                | [SKIP] |
| 3.40 | ~~Click Send (or verify form renders if SMTP not configured)~~ | `POST /api/email/send-receipt` | **SKIP — SMTP not configured**          | [SKIP] |

**What this validates**: Email receipt flow (`backend/routes/email.js`, `backend/utils/receiptEmail.js`), server-side HTML receipt builder.

---

### Phase 3J: POS Lock Screen

| #    | Test                                   | Component       | Expected Result                        | Status |
| ---- | -------------------------------------- | --------------- | -------------------------------------- | ------ |
| 3.41 | Trigger POS lock screen (idle/manual)   | POSLockScreen   | Lock overlay covers POS                 | [ ]    |
| 3.42 | Unlock with PIN                         | POSLockScreen   | POS restores to previous state          | [ ]    |

---

### Phase 3K: Volume Sales (Data Generation)

| #    | Test                                                               | Component  | Expected Result                           | Status |
| ---- | ------------------------------------------------------------------ | ---------- | ----------------------------------------- | ------ |
| 3.43 | Complete 5-8 sales with varying products, quantities, payment types | POS        | All sales recorded correctly               | [ ]    |
| 3.44 | Include at least 1 sale with tax applied (iPhone with GST 17%)     | POS        | Tax line visible in receipt                 | [ ]    |
| 3.45 | Include at least 1 sale with promotional discount auto-applied      | POS        | Promotion discount shows on receipt         | [ ]    |
| 3.46 | Include at least 1 sale per outlet (switch context between outlets) | POS + Context Switch | Sales linked to correct outlet    | [ ]    |

**Why this matters**: Generates realistic data for Reports verification in Phase 11. Without volume, report tabs will show empty states.

---

## Phase 4: Returns & Exchanges

> Handling customer returns, refunds, and exchanges through the POS.

| #   | Test                                                            | Route / API                   | Expected Result                                         | Status |
| --- | --------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- | ------ |
| 4.1 | Open Return/Exchange modal from POS Recent Sales panel           | POSReturnExchangeModal        | Modal opens with sale items listed                        | [ ]    |
| 4.2 | **Full refund** — select all items, process refund               | `POST /api/returns`           | Refund created, full amount returned                      | [ ]    |
| 4.3 | Verify refund appears in Returns page                            | `/returns`                    | Return record with sale reference, refund amount          | [ ]    |
| 4.4 | Verify stock increments after refund                             | `GET /api/products/:id`       | Returned items added back to stock                        | [ ]    |
| 4.5 | **Partial refund** — select subset of items from a different sale | `POST /api/returns`           | Only selected items refunded, remaining items unaffected  | [ ]    |
| 4.6 | **Exchange** — return item + add replacement, settle balance      | Return + new `POST /api/sales` | Return created + new sale for replacement               | [ ]    |
| 4.7 | Verify exchange creates both a return and a new sale              | `/returns` + `/sales-history` | Both records present with cross-references                | [ ]    |
| 4.8 | Verify `returns.shift_id` is populated correctly                  | DB check or API               | shift_id matches the active shift at time of return       | [ ]    |

**What this validates**: Return/refund flow, exchange flow (return + replacement sale), stock reversion, `shift_id` linkage (migrate63), `POSReturnExchangeModal.jsx`.

---

## Phase 5: Inventory Management

> Stock control: adjustments, transfers, purchase orders, GRN, supplier returns.

### Phase 5A: Stock Verification

| #   | Test                                                        | Route / API                | Expected Result                                    | Status |
| --- | ----------------------------------------------------------- | -------------------------- | -------------------------------------------------- | ------ |
| 5.1 | Navigate to Products                                         | `/inventory`               | Product list loads                                  | [ ]    |
| 5.2 | Verify stock levels reflect sales + returns from Phase 3-4    | Product list stock column  | Stock = opening - sold + returned                   | [ ]    |
| 5.3 | Search products by name, barcode, SKU                         | Product search/filter      | Results filter correctly                             | [ ]    |
| 5.4 | Filter by category "Electronics", then by brand "Apple"       | Product filter dropdowns   | Only matching products shown                         | [ ]    |

---

### Phase 5B: Stock Adjustments

| #   | Test                                                                    | Route / API                  | Expected Result                               | Status |
| --- | ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------- | ------ |
| 5.5 | Navigate to Stock Adjustments                                            | `/adjustments`               | Page loads, adjustment list visible             | [ ]    |
| 5.6 | Create adjustment: increase "Chips Packet" by 50 (reason: stock received) | `POST /api/adjustments`     | Adjustment recorded, stock +50                  | [ ]    |
| 5.7 | Create adjustment: decrease "iPhone 15" by 2 (reason: damaged)            | `POST /api/adjustments`     | Adjustment recorded, stock -2                   | [ ]    |
| 5.8 | Verify adjustments appear in list with reason + quantity                   | `/adjustments`              | Both adjustments visible                         | [ ]    |
| 5.9 | Navigate to Products — verify stock levels updated                        | `/inventory`                | Chips=+50, iPhone=-2 from previous levels       | [ ]    |

---

### Phase 5C: Stock Transfers (Inter-Outlet)

| #    | Test                                                                   | Route / API                | Expected Result                                    | Status |
| ---- | ---------------------------------------------------------------------- | -------------------------- | -------------------------------------------------- | ------ |
| 5.10 | Navigate to Transfers                                                   | `/transfers`               | Page loads, transfer list visible                    | [ ]    |
| 5.11 | Create transfer: Main Store → Branch 2, "Headphones" qty=5              | `POST /api/transfers`      | Transfer record created with status                  | [ ]    |
| 5.12 | Verify transfer appears in list                                         | `/transfers`               | Transfer with source, destination, items, status      | [ ]    |
| 5.13 | Verify stock: Main Store -5, Branch 2 +5 for Headphones                 | `GET /api/products` (per outlet) | Stock deducted from source, added to destination | [ ]    |

---

### Phase 5D: Purchase Orders & Goods Received Notes (GRN)

| #    | Test                                                                        | Route / API                    | Expected Result                                     | Status |
| ---- | --------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- | ------ |
| 5.14 | Navigate to Purchase Orders                                                  | `/purchase-orders`             | Page loads, PO list visible                          | [ ]    |
| 5.15 | Create PO to "Tech Distributors" — add "Samsung Galaxy A55" qty=10, cost=70000 each | `POST /api/purchase-orders` | PO created with total = 700,000                  | [ ]    |
| 5.16 | Verify credit limit warning if supplier's running balance + PO total > credit_limit | Response `{ warning: "..." }` | Warning shown but PO still created (advisory) | [ ]    |
| 5.17 | Submit PO — change status to submitted/confirmed                              | `PUT /api/purchase-orders/:id` | PO status updates                                   | [ ]    |
| 5.18 | Receive PO → create GRN (Goods Received Note)                                | `POST /api/grn`                | GRN created, linked to PO                            | [ ]    |
| 5.19 | Verify stock increases after GRN (Samsung +10)                                | `GET /api/products`            | Samsung stock = 5 + 10 = 15                          | [ ]    |
| 5.20 | Verify PO status updates to received/completed                                | `/purchase-orders`             | PO shows "received" or "completed" status            | [ ]    |

**What this validates**: PO lifecycle, credit limit advisory warning, GRN creation with stock increase, PO status workflow.

---

### Phase 5E: Supplier Returns

| #    | Test                                                        | Route / API                     | Expected Result                          | Status |
| ---- | ----------------------------------------------------------- | ------------------------------- | ---------------------------------------- | ------ |
| 5.21 | Navigate to Returned Stock                                   | `/returned-stock`               | Page loads                                | [ ]    |
| 5.22 | Create supplier return — select items from the GRN            | `POST /api/supplier-returns`    | Return recorded                           | [ ]    |
| 5.23 | Verify stock adjusted (decreased by returned qty)             | `GET /api/products`             | Stock decreases for returned items        | [ ]    |

---

### Phase 5F: Supplier Payables

| #    | Test                                                            | Route / API                          | Expected Result                          | Status |
| ---- | --------------------------------------------------------------- | ------------------------------------ | ---------------------------------------- | ------ |
| 5.24 | Navigate to Supplier Payables                                    | `/supplier-payables`                 | Page loads (flag: `supplier_payables`)    | [ ]    |
| 5.25 | View payable invoices from received POs                          | `GET /api/reconciliation/payables`   | Invoice list with amounts                 | [ ]    |
| 5.26 | Record a payment against an invoice                              | `POST /api/reconciliation/payments`  | Payment recorded, balance reduced         | [ ]    |

---

### Phase 5G: Inventory Alerts on Dashboard

| #    | Test                                                                 | Component                    | Expected Result                            | Status |
| ---- | -------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ | ------ |
| 5.27 | Set low stock threshold on "Water Bottle" (min_stock=150), sell 60+   | Product edit or adjustment   | Stock drops below 150                       | [ ]    |
| 5.28 | Dashboard → Inventory Alerts widget shows low-stock warning            | DashboardInventoryAlerts     | "Water Bottle" appears with low stock alert | [ ]    |

---

## Phase 6: Customers Module

> Customer data management outside of POS.

| #   | Test                                                    | Route / API                | Expected Result                               | Status |
| --- | ------------------------------------------------------- | -------------------------- | --------------------------------------------- | ------ |
| 6.1 | Navigate to Customers                                    | `/customers`               | Page loads, customer list visible              | [ ]    |
| 6.2 | Customers from POS sales (Phase 3E) appear in list       | `GET /api/customers`       | At least 1 customer from POS visible           | [ ]    |
| 6.3 | Create new customer (name, email, phone, address)         | `POST /api/customers`      | Customer created, appears in list              | [ ]    |
| 6.4 | Edit customer details                                     | `PUT /api/customers/:id`   | Updated fields persist                         | [ ]    |
| 6.5 | View customer purchase history / linked sales              | Customer detail / reports  | Sales from Phase 3 linked to customer          | [ ]    |
| 6.6 | Search / filter customers by name, phone                   | Customer search            | Results filter correctly                        | [ ]    |

---

## Phase 7: Orders Module

> Web/manual orders management.

| #   | Test                                      | Route / API           | Expected Result                       | Status |
| --- | ----------------------------------------- | --------------------- | ------------------------------------- | ------ |
| 7.1 | Navigate to Orders                         | `/orders`             | Page loads                             | [ ]    |
| 7.2 | View order list                            | `GET /api/orders`     | Order list renders (may be empty)      | [ ]    |
| 7.3 | Create manual order (if form is available)  | `POST /api/orders`    | Order created with products + total    | [ ]    |
| 7.4 | Verify order status workflow               | Order detail          | Status can be changed (pending→done)   | [ ]    |

---

## Phase 8: Expenses

> Track business expenses separate from inventory/sales.

| #   | Test                                                       | Route / API              | Expected Result                       | Status |
| --- | ---------------------------------------------------------- | ------------------------ | ------------------------------------- | ------ |
| 8.1 | Navigate to Expenses                                        | `/expenses`              | Page loads                             | [ ]    |
| 8.2 | Create expense: amount=5000, category="Utilities", note="Electric bill", date=today | `POST /api/expenses` | Expense appears in list | [ ]    |
| 8.3 | Create another expense: amount=2000, category="Supplies"     | `POST /api/expenses`     | Second expense visible                 | [ ]    |
| 8.4 | Edit expense — change amount                                 | `PUT /api/expenses/:id`  | Amount updates in list                 | [ ]    |

**What this validates**: Expense CRUD (`backend/routes/barcode-expenses.js` handles expenses).

---

## Phase 9: Sales History & Cash Management

> Review the day's activity from management pages.

| #   | Test                                                         | Route / API              | Expected Result                                  | Status |
| --- | ------------------------------------------------------------ | ------------------------ | ------------------------------------------------ | ------ |
| 9.1 | Navigate to Sales History                                     | `/sales-history`         | Page loads, sales list visible                    | [ ]    |
| 9.2 | Verify all sales from Phase 3 appear (8-12 sales expected)    | `GET /api/sales`         | Correct count, amounts match                      | [ ]    |
| 9.3 | Filter by date (today), payment method (cash only)             | Sales History filters    | Filtered results match                            | [ ]    |
| 9.4 | Click sale to view detail — items, totals, payment, customer   | Sale detail view         | All fields present, timestamps formatted correctly | [ ]    |
| 9.5 | Navigate to Cash Management                                    | `/cash-management`       | Page loads                                        | [ ]    |
| 9.6 | View cash drawer status — opening balance, sales, refunds      | Cash management UI       | Numbers align with shift + sales data             | [ ]    |
| 9.7 | Verify cash movements tracked (cash in from sales, cash out from refunds) | Cash management UI | Movement log visible                     | [ ]    |

**What this validates**: Sales history list/detail, date/payment filters, cash management view, timestamp display (must use `fmtDateTime` from `frontend/src/utils/dates.js` — not raw `new Date()`).

**Critical bug to watch for**: Timestamps showing wrong time zone — `sales.timestamp` is UTC, must be displayed via `fmtDateTime()` which appends "Z" before parsing.

---

## Phase 10: End of Day — Close Operations

> Closing the shift, counting cash, clocking out staff.

| #    | Test                                                          | Route / API                          | Expected Result                                  | Status |
| ---- | ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ------ |
| 10.1 | Open POS → click "Close Shift"                                | POSCloseShiftModal                   | Close shift modal opens                           | [ ]    |
| 10.2 | Enter closing cash denomination breakdown                      | POSCloseShiftModal                   | Denomination grid accepts values                  | [ ]    |
| 10.3 | Verify expected vs actual cash — difference calculated          | POSCloseShiftModal                   | Expected=opening+cash_sales-cash_refunds, difference shown | [ ]    |
| 10.4 | Confirm shift closure                                          | `PUT /api/shifts/:id/close`          | Shift status = "closed", closing data saved       | [ ]    |
| 10.5 | Attempt checkout in POS — should be blocked (no active shift)   | POS                                  | Checkout disabled or error message                 | [ ]    |
| 10.6 | Kiosk: clock out all 3 employees                               | `POST /api/attendance/pin-clock-out` | All employees status = "clocked_out"               | [ ]    |
| 10.7 | Dashboard → Staff Today shows all "Out"                        | DashboardAttendance                  | 3 cards with "Out" badges                          | [ ]    |
| 10.8 | Attendance page → verify work hours calculated                  | `/attendance`                        | Hours worked column shows non-zero values           | [ ]    |

**What this validates**: Shift closing with denominations, cash audit (expected vs actual), shift-blocks-checkout guardrail, kiosk clock-out, work hours calculation.

---

## Phase 11: Reports — Every Single Tab (67 Tabs)

> The most comprehensive phase. Every report tab must load without errors and return data from the day's operations.

### Test approach for each tab:
1. Navigate to `/reports`
2. Click the tab
3. Verify: no JS errors, no "Failed to load" messages
4. Verify: data renders (tables/charts populated from Phase 3-10 operations)
5. Verify: filters work (date range, outlet, category, etc.)

---

### 11A: Sales Reports (11 tabs)

| #     | Tab ID                | Tab Label           | API Endpoint                              | Status |
| ----- | --------------------- | ------------------- | ----------------------------------------- | ------ |
| 11.1  | `overview`            | Overview            | `/api/reports/dashboard` (partial)        | [ ]    |
| 11.2  | `daily-operations`    | Daily Operations    | `/api/reports/sales-summary` + date group | [ ]    |
| 11.3  | `sales-summary`       | Sales Summary       | `/api/reports/sales-summary`              | [ ]    |
| 11.4  | `sales-detail`        | Sales Detail        | `/api/reports/sales-detail`               | [ ]    |
| 11.5  | `order-wise`          | Order Wise          | `/api/reports/sales-detail` (grouped)     | [ ]    |
| 11.6  | `item-wise`           | Item Wise           | `/api/reports/item-wise-sales`            | [ ]    |
| 11.7  | `category-wise`       | Category Wise       | `/api/reports/category-wise`              | [ ]    |
| 11.8  | `subcategory-wise`    | Sub-Category Wise   | `/api/reports/category-wise` (sub)        | [ ]    |
| 11.9  | `monthly-mop-matrix`  | Monthly MOP Matrix  | `/api/reports/sales-summary` (monthly)    | [ ]    |
| 11.10 | `cashier-wise`        | Cashier Wise        | `/api/reports/cashier-wise`               | [ ]    |
| 11.11 | `refunds-voids`       | Refunds & Voids     | `/api/reports/refunds-voids`              | [ ]    |

---

### 11B: Shift & Cash Reports (7 tabs)

| #     | Tab ID                    | Tab Label          | API Endpoint                           | Status |
| ----- | ------------------------- | ------------------ | -------------------------------------- | ------ |
| 11.12 | `shift-summary`           | Shift Summary      | `/api/reports/shifts`                  | [ ]    |
| 11.13 | `shift-sales`             | Shift Sales        | `/api/reports/shift-sales`             | [ ]    |
| 11.14 | `payment-summary`         | Payment Summary    | `/api/reports/payment-summary`         | [ ]    |
| 11.15 | `cash-flow`               | Cash Flow          | `/api/reports/cash-drawer`             | [ ]    |
| 11.16 | `cash-audit`              | Cash Audit         | `/api/reports/cash-drawer` (audit)     | [ ]    |
| 11.17 | `denominations`           | Denominations      | `/api/reports/shifts` (denominations)  | [ ]    |
| 11.18 | `current-session-zreport` | Session Z-Report   | `/api/reports/shifts` (current)        | [ ]    |

---

### 11C: Customer Reports (5 tabs)

| #     | Tab ID                | Tab Label           | API Endpoint                           | Status |
| ----- | --------------------- | ------------------- | -------------------------------------- | ------ |
| 11.19 | `customer-details`    | Customer Details    | `/api/customers/report`                | [ ]    |
| 11.20 | `customer-wise`       | Customer Wise       | `/api/customers/report` (grouped)      | [ ]    |
| 11.21 | `customer-rfm`        | RFM Analysis        | `/api/customers/rfm`                   | [ ]    |
| 11.22 | `customer-retention`  | Customer Retention  | `/api/customers/retention`             | [ ]    |
| 11.23 | `customer-capture`    | Capture Rate        | `/api/customers/capture-rate`          | [ ]    |

---

### 11D: Inventory & Catalog Reports (12 tabs)

| #     | Tab ID                    | Tab Label              | API Endpoint                              | Status |
| ----- | ------------------------- | ---------------------- | ----------------------------------------- | ------ |
| 11.24 | `performance-workspace`   | Merchandising          | `/api/reports/inventory-*` (composite)    | [ ]    |
| 11.25 | `product-performance`     | Product Performance    | `/api/reports/product-performance`        | [ ]    |
| 11.26 | `brand-wise`              | Brand Wise             | `/api/reports/brand-wise`                 | [ ]    |
| 11.27 | `retail-matrix`           | Retail Matrix          | `/api/reports/comparative-trends`         | [ ]    |
| 11.28 | `pricing-margin`          | Pricing Matrix         | `/api/reports/inventory-dump` (margin)    | [ ]    |
| 11.29 | `sales-stock`             | Sales & Stock          | `/api/reports/sales-stock`                | [ ]    |
| 11.30 | `inventory-dump`          | Inventory Dump         | `/api/reports/inventory-dump`             | [ ]    |
| 11.31 | `on-hand`                 | On Hand                | `/api/reports/on-hand`                    | [ ]    |
| 11.32 | `product-spec`            | Product Spec           | `/api/reports/product-spec`               | [ ]    |
| 11.33 | `history-cost`            | History Cost           | `/api/reports/history-cost`               | [ ]    |
| 11.34 | `history-sale`            | History Sale           | `/api/reports/history-sale`               | [ ]    |
| 11.35 | `product-audit`           | Product Audit          | `/api/reports/product-audit`              | [ ]    |

---

### 11E: Replenishment & Forecasting Reports (6 tabs)

| #     | Tab ID                 | Tab Label            | API Endpoint                            | Status |
| ----- | ---------------------- | -------------------- | --------------------------------------- | ------ |
| 11.36 | `replenishment`        | Replenishment        | `/api/reports/replenishment`            | [ ]    |
| 11.37 | `dead-stock`           | Dead Stock           | `/api/reports/dead-stock`               | [ ]    |
| 11.38 | `stock-aging`          | Stock Aging          | `/api/reports/stock-aging`              | [ ]    |
| 11.39 | `stockout-risk`        | Stockout Risk        | `/api/reports/stockout-risk`            | [ ]    |
| 11.40 | `forecast-demand`      | Forecast Demand      | `/api/reports/forecast-demand`          | [ ]    |
| 11.41 | `replenishment-smart`  | Replenishment Smart  | `/api/reports/replenishment-smart`      | [ ]    |

---

### 11F: Operations Reports (5 tabs)

| #     | Tab ID              | Tab Label           | API Endpoint                            | Status |
| ----- | ------------------- | ------------------- | --------------------------------------- | ------ |
| 11.42 | `outlet-comparison` | Outlet Comparison   | `/api/reports/outlet-comparison`        | [ ]    |
| 11.43 | `inventory-loss`    | Inventory Loss      | `/api/reports/inventory-loss`           | [ ]    |
| 11.44 | `wastage`           | Wastage             | `/api/reports/wastage`                  | [ ]    |
| 11.45 | `product-movement`  | Product Movement    | `/api/reports/product-movement`         | [ ]    |
| 11.46 | `str-report`        | STR Report          | `/api/reports/str`                      | [ ]    |

---

### 11G: Purchasing Reports (7 tabs)

| #     | Tab ID                    | Tab Label              | API Endpoint                              | Status |
| ----- | ------------------------- | ---------------------- | ----------------------------------------- | ------ |
| 11.47 | `total-purchases`         | Total Purchases        | `/api/reports/total-purchases`            | [ ]    |
| 11.48 | `itemwise-purchases`      | Itemwise Purchases     | `/api/reports/itemwise-purchases`         | [ ]    |
| 11.49 | `po-workflow`             | PO Workflow            | `/api/reports/po-workflow`                | [ ]    |
| 11.50 | `procurement-parity`      | Procurement Parity     | `/api/reports/procurement-parity`         | [ ]    |
| 11.51 | `supplier-wise`           | Supplier Wise          | `/api/reports/supplier-wise`              | [ ]    |
| 11.52 | `purchase-orders-report`  | Purchase Orders Report | `/api/reports/purchase-orders`            | [ ]    |
| 11.53 | `grn-report`              | GRN Report             | `/api/reports/grn`                        | [ ]    |

---

### 11H: Finance Reports (6 tabs)

| #     | Tab ID                         | Tab Label             | API Endpoint                            | Status |
| ----- | ------------------------------ | --------------------- | --------------------------------------- | ------ |
| 11.54 | `settlement-overview`          | Settlement Overview   | `/api/reports/profit-loss`              | [ ]    |
| 11.55 | `payables-receivables`         | Payables/Receivables  | `/api/reports/payables-receivables`     | [ ]    |
| 11.56 | `supplier-payments-invoices`   | Supplier Payments     | `/api/reports/supplier-payments`        | [ ]    |
| 11.57 | `finance-payment-mix`          | Finance Payment Mix   | `/api/reports/payment-mix`              | [ ]    |
| 11.58 | `gst-output`                   | GST Output            | `/api/reports/tax-summary`              | [ ]    |
| 11.59 | `gst-type-summary`             | GST Type Summary      | `/api/reports/tax-type-summary`         | [ ]    |

---

### 11I: Staff Reports (3 tabs)

| #     | Tab ID               | Tab Label           | API Endpoint                          | Status |
| ----- | -------------------- | ------------------- | ------------------------------------- | ------ |
| 11.60 | `attendance`         | Attendance          | `/api/reports/attendance`             | [ ]    |
| 11.61 | `labor-performance`  | Labor Performance   | `/api/reports/labor-performance`      | [ ]    |
| 11.62 | `loss-prevention`    | Loss Prevention     | `/api/reports/loss-prevention`        | [ ]    |

---

### 11J: Audit & Governance Reports (3 tabs)

| #     | Tab ID              | Tab Label          | API Endpoint                          | Status |
| ----- | ------------------- | ------------------ | ------------------------------------- | ------ |
| 11.63 | `governance`        | Audit Controls     | `/api/reports/schedules` + saved views | [ ]    |
| 11.64 | `discount-leakage`  | Discount Leakage   | `/api/reports/discount-leakage`       | [ ]    |
| 11.65 | `exceptions`        | Exceptions         | `/api/reports/exceptions`             | [ ]    |

---

### 11K: Analytics Reports (4 tabs)

| #     | Tab ID                | Tab Label           | API Endpoint                          | Status |
| ----- | --------------------- | ------------------- | ------------------------------------- | ------ |
| 11.66 | `comparative-trends`  | Comparative Trends  | `/api/reports/comparative-trends`     | [ ]    |
| 11.67 | `heatmaps`            | Sales Heatmap       | `/api/reports/heatmaps`               | [ ]    |
| 11.68 | `revenue-leaks`       | Revenue Leaks       | `/api/reports/revenue-leaks`          | [ ]    |
| 11.69 | `product-mix`         | Product Mix         | `/api/reports/product-mix`            | [ ]    |

---

### 11L: Report Infrastructure & Filters

| #     | Test                                                         | Expected Result                              | Status |
| ----- | ------------------------------------------------------------ | -------------------------------------------- | ------ |
| 11.70 | Global filter bar — set date range (today)                    | All tabs filter to today's data               | [ ]    |
| 11.71 | Multi-outlet filter — select 1 outlet                         | Data scoped to selected outlet                | [ ]    |
| 11.72 | Category filter — select "Electronics"                        | Data filtered to electronics products         | [ ]    |
| 11.73 | Brand filter — select "Apple"                                 | Data filtered to Apple products               | [ ]    |
| 11.74 | Supplier filter — select "Tech Distributors"                  | Purchasing reports filter correctly            | [ ]    |
| 11.75 | Employee filter — select specific cashier                     | Cashier-wise data filters                     | [ ]    |
| 11.76 | Shift filter — select today's shift                           | Shift reports scope to selected shift         | [ ]    |
| 11.77 | Search within reports — type product name                     | Results filter in table                        | [ ]    |
| 11.78 | CSV export on Sales Summary tab                               | CSV file downloads with correct data          | [ ]    |
| 11.79 | CSV export on Inventory Dump tab                              | CSV file downloads                             | [ ]    |
| 11.80 | URL params — navigate to `/reports?tab=sales-summary&date=today` | Correct tab opens with date pre-set       | [ ]    |
| 11.81 | Time filter — set timeFrom=09:00, timeTo=17:00                | Sales within time window only                  | [ ]    |
| 11.82 | Reset filters button — click Reset                            | All filters cleared, full data shown           | [ ]    |

---

## Phase 12: Dashboard Deep Verification

> Verify every dashboard widget renders correctly with real data from the day's operations.

| #     | Test                                                         | Component                    | Expected Result                                    | Status |
| ----- | ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------- | ------ |
| 12.1  | KPI Cards — today's sales total                               | DashboardKPICards            | Matches sum of sales from Phase 3                   | [ ]    |
| 12.2  | KPI Cards — order count                                       | DashboardKPICards            | Matches number of completed sales                   | [ ]    |
| 12.3  | KPI Cards — average basket size                               | DashboardKPICards            | Total sales / order count                           | [ ]    |
| 12.4  | KPI Cards — margin %                                          | DashboardKPICards            | Calculated from cost vs selling price                | [ ]    |
| 12.5  | KPI comparison arrows — vs yesterday same-elapsed-time         | DashboardKPICards            | Arrows show up/down/neutral correctly                | [ ]    |
| 12.6  | Ops Readiness — shift status per outlet                        | DashboardOpsReadiness        | Shows "Closed" after Phase 10                        | [ ]    |
| 12.7  | Ops Readiness — staff count                                    | DashboardOpsReadiness        | Shows correct in/break/out counts                    | [ ]    |
| 12.8  | Attention Queue — prescriptive alerts                          | DashboardAttention           | Relevant alerts based on thresholds + data           | [ ]    |
| 12.9  | Quick Actions — role-aware buttons                             | DashboardQuickActions        | Admin sees all actions, cashier sees limited set      | [ ]    |
| 12.10 | Exceptions — refund/void/discount ratios                       | DashboardExceptions          | Ratios calculated as pct_of_sales / pct_of_orders    | [ ]    |
| 12.11 | Outlet Ranking (all-branches mode only)                        | DashboardOutletRanking       | Outlets ranked by sales                              | [ ]    |
| 12.12 | Trends — 7-day sales chart                                     | DashboardTrends              | Today has data point, previous 6 days may be zero    | [ ]    |
| 12.13 | Contribution — payment method breakdown                        | DashboardContribution        | Pie/bar chart: cash vs card vs split                 | [ ]    |
| 12.14 | Contribution — category breakdown                              | DashboardContribution        | Category proportions match sales                     | [ ]    |
| 12.15 | Inventory Alerts — low stock items                             | DashboardInventoryAlerts     | Items below threshold shown                          | [ ]    |
| 12.16 | Staff Today — attendance cards                                 | DashboardAttendance          | All employees with correct status + hours            | [ ]    |
| 12.17 | Recent Sales — last 10 sales                                   | DashboardRecentSales         | Most recent sales listed with amounts                | [ ]    |
| 12.18 | Auto-refresh — wait 60 seconds                                 | DashboardRedesign            | Data refreshes silently (no loading skeleton)        | [ ]    |
| 12.19 | Manual refresh button — click refresh icon                     | DashboardRedesign            | Spinner animates, "Updated HH:MM" timestamp shows    | [ ]    |
| 12.20 | Currency symbol shows correctly (Rs.)                          | DashboardKPICards            | Currency from company_profile used throughout        | [ ]    |

---

## Phase 13: Accounting & Finance

> Tier 4 feature behind `accounting_core` flag.

| #    | Test                                     | Route / API            | Expected Result                          | Status |
| ---- | ---------------------------------------- | ---------------------- | ---------------------------------------- | ------ |
| 13.1 | Navigate to Accounting                    | `/accounting`          | Page loads (flag: `accounting_core`)      | [ ]    |
| 13.2 | View accounting entries                   | `GET /api/accounting/*`| Entries from sales/expenses visible       | [ ]    |
| 13.3 | Verify page is guarded by `view_reports`  | RBAC                   | Cashier cannot access                     | [ ]    |

---

## Phase 14: Tier 4 Feature-Flagged Modules

> Modules gated behind feature flags. Test that they load and function when flags are enabled.

### 14A: CRM

| #    | Test                                   | Route / API          | Expected Result                          | Status |
| ---- | -------------------------------------- | -------------------- | ---------------------------------------- | ------ |
| 14.1 | Navigate to CRM                         | `/crm`               | Page loads (flag: `crm_quotations`)       | [ ]    |
| 14.2 | View CRM contacts/pipeline               | `GET /api/crm/*`     | Customer data visible                     | [ ]    |

### 14B: Quotations

| #    | Test                                       | Route / API              | Expected Result                       | Status |
| ---- | ------------------------------------------ | ------------------------ | ------------------------------------- | ------ |
| 14.3 | Navigate to Quotations                      | `/quotations`            | Page loads (flag: `crm_quotations`)    | [ ]    |
| 14.4 | Create quotation with products + customer    | `POST /api/quotations`   | Quotation created with total           | [ ]    |

### 14C: HR Management

| #    | Test                                     | Route / API          | Expected Result                         | Status |
| ---- | ---------------------------------------- | -------------------- | --------------------------------------- | ------ |
| 14.5 | Navigate to HR                            | `/hr`                | Page loads (flag: `advanced_hr`)         | [ ]    |
| 14.6 | View HR features (leave, payroll, etc.)    | `GET /api/hr/*`      | HR dashboard renders                     | [ ]    |

### 14D: Approvals

| #    | Test                                      | Route / API                | Expected Result                     | Status |
| ---- | ----------------------------------------- | -------------------------- | ----------------------------------- | ------ |
| 14.7 | Navigate to Approvals                      | `/approvals`               | Page loads                           | [ ]    |
| 14.8 | Create approval request                    | `POST /api/approvals`      | Request created, pending status      | [ ]    |
| 14.9 | Approve/reject a request                   | `PUT /api/approvals/:id`   | Status changes to approved/rejected  | [ ]    |

---

## Phase 15: RBAC & Security Testing

> Verify permission boundaries work correctly across roles.

| #    | Test                                                              | Expected Result                                       | Status |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| 15.1 | Logout as Admin → Login as **Cashier** (created in Phase 1C)       | Login succeeds, redirected to context select            | [ ]    |
| 15.2 | Cashier CANNOT see: Employees, Outlets, Company Settings, Admin    | Nav items hidden, direct URL → Access Denied            | [ ]    |
| 15.3 | Cashier CAN see: POS, Dashboard (limited widgets), own attendance  | POS + Dashboard load, admin widgets hidden              | [ ]    |
| 15.4 | Dashboard hides admin-only widgets for Cashier                     | No Exceptions, Trends, Contribution, Inventory Alerts   | [ ]    |
| 15.5 | Direct URL `/employees` → Access Denied page                      | Access Denied page renders (not 404)                    | [ ]    |
| 15.6 | Cashier Dashboard → Staff Today shows only own record              | `isCashier` filter: `details.filter(e => e.id === currentEmployeeId)` | [ ]    |
| 15.7 | Logout → Login as **Manager** (created in Phase 1C)                | Login succeeds                                          | [ ]    |
| 15.8 | Manager CAN see: Reports, Attendance, Inventory, Products          | All these pages load correctly                          | [ ]    |
| 15.9 | Manager CANNOT see: Employee management, Company Settings           | Nav items hidden, direct URL → Access Denied            | [ ]    |
| 15.10| Outlet-scoped data — Manager sees only their outlet's data         | Dashboard, sales, inventory scoped to assigned outlet   | [ ]    |

**What this validates**: `RequirePerm` component, `requirePerm` backend middleware, `hasPerm()` frontend checks, dashboard role-aware widget visibility, cashier attendance self-filter.

---

## Phase 16: Backup & Restore

> Data safety features.

| #    | Test                                            | Route / API                      | Expected Result                       | Status |
| ---- | ----------------------------------------------- | -------------------------------- | ------------------------------------- | ------ |
| 16.1 | Navigate to Backup & Restore                     | `/backup-restore`                | Page loads (flag: `backup_restore`)    | [ ]    |
| 16.2 | Create backup                                    | `POST /api/backup`               | Backup file generated                  | [ ]    |
| 16.3 | Download backup file                             | Backup download                  | .db or .zip file downloads             | [ ]    |

---

## Phase 17: Action History & Audit Trail

> Verify that the system logs important actions.

| #    | Test                                                     | Route / API                  | Expected Result                              | Status |
| ---- | -------------------------------------------------------- | ---------------------------- | -------------------------------------------- | ------ |
| 17.1 | Navigate to Action History                                | `/action-history`            | Page loads, action log visible                | [ ]    |
| 17.2 | Verify actions from today appear (sales, adjustments, shifts, etc.) | `GET /api/action-history` | Log entries with timestamps + actor + action | [ ]    |
| 17.3 | Filter by action type or employee                         | Action History filters       | Results filter correctly                      | [ ]    |

---

## Phase 18: Shopify Integration (Smoke Test) — SKIPPED

> **ENTIRE PHASE SKIPPED** — Shopify account not connected/configured. No tests in this phase will run.

| #    | Test                                                      | Route / API                           | Expected Result                              | Status  |
| ---- | --------------------------------------------------------- | ------------------------------------- | -------------------------------------------- | ------- |
| 18.1 | ~~Navigate to Shopify Integration~~                        | `/integrations/shopify`               | **SKIP — Shopify not configured**             | [SKIP]  |
| 18.2 | ~~All tabs render~~                                        | Shopify tab navigation                | **SKIP — Shopify not configured**             | [SKIP]  |
| 18.3 | ~~Settings/Config page loads~~                             | `GET /api/integrations/shopify/config` | **SKIP — Shopify not configured**            | [SKIP]  |
| 18.4 | ~~No JS console errors on any Shopify tab~~                | Browser console                       | **SKIP — Shopify not configured**             | [SKIP]  |

**What this validates**: ~~Shopify module graceful degradation~~ — **Skipped: Shopify not connected.**

---

## Phase 19: Reconciliation

> Reconciliation module verification.

| #    | Test                                                   | Route / API                    | Expected Result                     | Status |
| ---- | ------------------------------------------------------ | ------------------------------ | ----------------------------------- | ------ |
| 19.1 | Check reconciliation API responds                       | `GET /api/reconciliation`      | 200 response (may be empty data)    | [ ]    |
| 19.2 | Verify reconciliation UI loads (if page exists)          | Reconciliation page            | Page renders without errors          | [ ]    |

---

## Phase 20: Edge Cases & Stress Tests

> Things that break in real stores — boundary conditions, double-clicks, large data, special characters.

| #     | Test                                                              | Expected Result                                     | Status |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------- | ------ |
| 20.1  | POS: Add product with quantity = 0 → attempt checkout              | Validation blocks: "Quantity must be at least 1"     | [ ]    |
| 20.2  | API: POST sale with negative price → should be blocked             | 400 error from backend validation                    | [ ]    |
| 20.3  | POS: Double-click checkout button rapidly                          | Only 1 sale created (not duplicate)                  | [ ]    |
| 20.4  | POS: Very large cart — add 20+ different products                  | Cart renders correctly, totals are accurate           | [ ]    |
| 20.5  | POS: Product with 0 stock → check behavior                        | Either blocks sale or allows negative stock (document which) | [ ]    |
| 20.6  | Create product with special characters: "Test & <Script> Product"  | Product saves correctly, no XSS in display            | [ ]    |
| 20.7  | Create customer with very long name (200+ characters)              | UI doesn't overflow, name truncated gracefully        | [ ]    |
| 20.8  | Navigate rapidly between 10 different pages                        | No crashes, no stale data, no memory leaks            | [ ]    |
| 20.9  | Refresh browser mid-checkout (F5 after adding items)               | Cart state — document if preserved or lost            | [ ]    |
| 20.10 | API: Send malformed JSON body to `POST /api/sales`                 | 400 error, not 500 crash                              | [ ]    |
| 20.11 | Product name with Unicode: "Laptop 💻 Stand"                       | Saves and displays correctly                          | [ ]    |
| 20.12 | Create product with barcode containing leading zeros: "0012345"    | Barcode preserved as string, not stripped              | [ ]    |

---

## Summary

| Phase | Description                         | Test Count |
| ----- | ----------------------------------- | ---------- |
| 0     | Pre-Flight & Environment            | 7          |
| 1     | Store Setup — Master Data           | 71         |
| 2     | Opening the Day — Shift & Attendance | 15        |
| 3     | POS Operations — Full Sales Lifecycle | 46        |
| 4     | Returns & Exchanges                 | 8          |
| 5     | Inventory Management                | 28         |
| 6     | Customers Module                    | 6          |
| 7     | Orders Module                       | 4          |
| 8     | Expenses                            | 4          |
| 9     | Sales History & Cash Management     | 7          |
| 10    | End of Day — Close Operations       | 8          |
| 11    | Reports — 67 Tabs + Filters/Export  | 82         |
| 12    | Dashboard Deep Verification         | 20         |
| 13    | Accounting & Finance                | 3          |
| 14    | Tier 4 Feature-Flagged Modules      | 9          |
| 15    | RBAC & Security Testing             | 10         |
| 16    | Backup & Restore                    | 3          |
| 17    | Action History & Audit Trail        | 3          |
| 18    | ~~Shopify Integration (Smoke)~~     | ~~4~~ SKIP |
| 19    | Reconciliation                      | 2          |
| 20    | Edge Cases & Stress Tests           | 12         |
|       | **TOTAL**                           | **~335** (17 skipped) |

---

## Bug Report Template

For each issue found during simulation, log it here:

### Bug #___: [Short Title]

| Field          | Value                              |
| -------------- | ---------------------------------- |
| **Phase**      | Phase X, Test #X.X                 |
| **Severity**   | Critical / High / Medium / Low     |
| **Page/Route** | `/page-name`                       |
| **API**        | `GET/POST /api/endpoint`           |
| **Component**  | `ComponentName.jsx`                |
| **Description**| What happened                      |
| **Expected**   | What should have happened          |
| **Actual**     | What actually happened             |
| **Screenshot** | (if applicable)                    |
| **Console**    | JS errors (if any)                 |
| **Steps**      | 1. Go to... 2. Click... 3. See... |
| **Fix Notes**  | (filled in after fixing)           |

---

## Execution Notes

- **Execution tool**: Playwright MCP (browser automation via Claude Code)
- **Browser**: Chromium (Playwright default)
- **Viewport**: 1280x720 (desktop)
- **Concurrency**: Sequential (phases depend on previous data)
- **Data persistence**: SQLite `backend/sanopos.db` — all operations persist across phases
- **Time estimate**: Full run covers ~335 test scenarios (17 skipped — no Shopify, no SMTP, no printer, no barcode scanner)
- **Pause points**: After Phase 1, 4, 10, 11, 20 (5 checkpoints)

### Key technical notes for Playwright execution:

1. **Login flow**: PIN-based auth → context select → dashboard
2. **POS opens in same tab** (not new tab) for Playwright — override `newTab: true` behavior
3. **Kiosk**: PIN entry terminal — needs numeric keypad interaction
4. **Receipt popup**: `buildReceiptHtml()` opens `window.open()` — Playwright must handle popup
5. **Auto-refresh**: Dashboard refreshes every 60s — wait for network idle after navigation
6. **File downloads**: CSV export triggers download — Playwright must capture download event
7. **File uploads**: Product image + CSV import — Playwright `setInputFiles()` needed
8. **Barcode scanner simulation**: Rapid `page.keyboard.type()` with < 100ms between chars
