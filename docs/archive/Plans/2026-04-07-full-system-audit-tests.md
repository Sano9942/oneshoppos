# Full System Audit — Playwright Test Suite

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire old test suite with 24 self-contained Playwright specs (~290 tests) that audit every page, route, and feature in SanoPOS against production.

**Architecture:** Production-only tests against `sanopos.com` / `api.sanopos.com`. Single Playwright config. Global setup handles authentication via MT login (tenant: `packagesmall`). Each spec is self-contained — sets up its own data via API, tests UI, no shared state between specs.

**Tech Stack:** Playwright 1.58, Chromium only, ESM imports, Node.js native fetch for API helpers.

---

## Infrastructure

### Directory Structure (after cleanup)

```
frontend/
├── playwright.config.js          # Single config targeting sanopos.com
├── tests/
│   ├── CLAUDE.md                  # Keep (test guide)
│   ├── helpers/
│   │   ├── auth.js                # MT login helper + credentials
│   │   ├── api.js                 # Authenticated API helper (Node fetch)
│   │   └── nav.js                 # Navigation helpers (sidebar click, wait)
│   ├── global-setup.js            # Login + save storageState + token
│   ├── auth.spec.js
│   ├── pos-core.spec.js
│   ├── pos-advanced.spec.js
│   ├── products.spec.js
│   ├── inventory.spec.js
│   ├── purchasing.spec.js
│   ├── customers.spec.js
│   ├── orders.spec.js
│   ├── employees-hr.spec.js
│   ├── accounting.spec.js
│   ├── reports.spec.js
│   ├── settings.spec.js
│   ├── integrations.spec.js
│   ├── fbr.spec.js
│   ├── import-export.spec.js
│   ├── admin-panel.spec.js
│   ├── crm.spec.js
│   ├── navigation-ux.spec.js
│   ├── permissions.spec.js
│   ├── billing.spec.js
│   ├── public-pages.spec.js
│   ├── onboard-free.spec.js
│   ├── onboard-starter.spec.js
│   └── onboard-pro.spec.js
└── unit/                          # Keep unit tests untouched
```

### Files to Delete

- `frontend/tests/e2e/` — entire directory
- `frontend/tests/live/` — entire directory
- `frontend/tests/setup.js`
- `frontend/playwright.config.live.js`
- `frontend/playwright.config.onboarding.js`

### Files to Keep

- `frontend/tests/CLAUDE.md`
- `frontend/tests/unit/` — all 4 unit test files

---

## Task 1: Clean Up Old Tests + Build Infrastructure

### Step 1: Delete old test files

```bash
rm -rf frontend/tests/e2e/
rm -rf frontend/tests/live/
rm -f frontend/tests/setup.js
rm -f frontend/playwright.config.live.js
rm -f frontend/playwright.config.onboarding.js
```

### Step 2: Create `frontend/playwright.config.js` (overwrite)

```javascript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.js",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  globalSetup: "./tests/global-setup.js",

  timeout: 60000,

  use: {
    baseURL: "https://sanopos.com",
    storageState: "./tests/auth.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

### Step 3: Create `frontend/tests/global-setup.js`

```javascript
import { chromium } from "@playwright/test";
import { loginMT, BACKEND, STORE_CODE, USERNAME, PASSWORD } from "./helpers/auth.js";
import { writeFileSync } from "fs";
import { resolve } from "path";

const AUTH_FILE = resolve(import.meta.dirname, "auth.json");
const TOKEN_FILE = resolve(import.meta.dirname, "token.json");

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: "https://sanopos.com" });
  const page = await context.newPage();

  console.log("\n[setup] Logging in to sanopos.com ...");
  await loginMT(page);
  console.log("[setup] Login OK — saving session");

  await context.storageState({ path: AUTH_FILE });

  const token = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("authSession") || "{}");
    return s.token || null;
  });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token }, null, 2));

  await browser.close();
}
```

### Step 4: Create `frontend/tests/helpers/auth.js`

```javascript
export const STORE_CODE = "packagesmall";
export const USERNAME = "hassan";
export const PASSWORD = "Danish11";
export const PIN = "2580";
export const BACKEND = "https://api.sanopos.com";

export async function loginMT(page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const storeCodeInput = page
    .getByPlaceholder(/aceshardware/i)
    .or(page.getByLabel(/store code/i));
  if (await storeCodeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await storeCodeInput.fill(STORE_CODE);
  }

  await page.getByPlaceholder(/employee name/i).fill(USERNAME);
  await page.getByPlaceholder(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/.*dashboard/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}
```

### Step 5: Create `frontend/tests/helpers/api.js`

```javascript
import { readFileSync } from "fs";
import { resolve } from "path";
import { BACKEND } from "./auth.js";

const TOKEN_FILE = resolve(import.meta.dirname, "../token.json");

function getToken() {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")).token || null;
  } catch {
    return null;
  }
}

export async function api(method, path, body = null) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
    "x-outlet-id": "1",
    "x-scope-mode": "outlet",
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(`${BACKEND}${path}`, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: r.status, ok: r.ok, data };
}

export const get = (path) => api("GET", path);
export const post = (path, body) => api("POST", path, body);
export const put = (path, body) => api("PUT", path, body);
export const del = (path) => api("DELETE", path);
```

### Step 6: Create `frontend/tests/helpers/nav.js`

```javascript
/**
 * Navigate to an app page via URL and wait for load.
 * Preferred over sidebar clicking for self-contained tests.
 */
export async function navigateTo(page, path) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Wait for page shell heading to appear (most redesign pages use PageShell).
 */
export async function waitForPageShell(page, titleText) {
  await page.getByRole("heading", { name: titleText }).waitFor({ timeout: 15000 });
}

/**
 * Click a sidebar nav link by its visible text.
 */
export async function clickSidebarLink(page, linkText) {
  await page.getByRole("link", { name: linkText }).click();
  await page.waitForLoadState("networkidle");
}
```

### Step 7: Update `frontend/tests/CLAUDE.md`

```markdown
# Test Suite Guide

## Overview
24 self-contained Playwright specs (~290 tests) auditing every page and feature against production (`sanopos.com`).

## Running Tests

```bash
# All specs
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# With UI mode
cd frontend && npx playwright test --ui

# Show report
cd frontend && npx playwright show-report
```

## Test Tenant
- Store: `packagesmall`
- User: `hassan` / `Danish11`
- PIN: `2580`

## Architecture
- **Production-only**: all tests hit `sanopos.com` + `api.sanopos.com`
- **Self-contained**: each spec sets up its own data via API, no shared state
- **Global setup**: `global-setup.js` logs in once, saves `auth.json` + `token.json`
- **Helpers**: `helpers/auth.js` (credentials), `helpers/api.js` (REST), `helpers/nav.js` (navigation)

## Specs
| Spec | Domain | Tests |
|------|--------|-------|
| auth | Login, logout, forgot password, kiosk, context-select | 10 |
| pos-core | Shift, search, cart, sale, receipt, customer-display | 14 |
| pos-advanced | Returns, exchanges, discounts, park, wallet, gift card | 15 |
| products | CRUD, variants, attribute sets, categories, brands, taxes, promotions | 15 |
| inventory | Adjustments, transfers, stock counts, reorder alerts, price lists | 12 |
| purchasing | PO→GRN, supplier payables, supplier returns, suppliers CRUD | 12 |
| customers | CRUD, groups, loyalty, wallet, blacklist, ledger | 12 |
| orders | Quotations, order list, fulfillment | 12 |
| employees-hr | Employees, kiosk, attendance, leave, approvals, roles | 12 |
| accounting | Chart of accounts, journals, notes, cheques, expenses | 10 |
| reports | 17 standalone reports + dashboard KPIs | 20 |
| settings | Company, printer, email, receipt/barcode templates, outlets, backup | 14 |
| integrations | Hub, 5 channels, 13 couriers, Shopify, WooCommerce | 20 |
| fbr | Config, dashboard, tax lookup | 8 |
| import-export | Bulk import, templates, CSV export | 8 |
| admin-panel | Admin login/dashboard/tenants/support/emails/dead-letters/tax-rates/activity | 15 |
| crm | Leads, activities, pipeline | 8 |
| navigation-ux | Sidebar links, breadcrumbs, dark mode, profile, support widget, notifications | 22 |
| permissions | Cashier/Manager/Admin visibility | 10 |
| billing | Status, pricing, upgrade | 6 |
| public-pages | Landing, signup, reset-password, public receipt, setup, my-tickets | 10 |
| onboard-free | Full Free plan signup→sale flow | 15 |
| onboard-starter | Full Starter plan signup→sale flow | 15 |
| onboard-pro | Full Pro plan signup→sale flow | 15 |
```

### Step 8: Commit

```bash
git add -A frontend/tests/ frontend/playwright.config.js
git commit -m "chore: replace old test suite with new infrastructure for full system audit"
```

---

## Task 2: auth.spec.js (~10 tests)

**File:** `frontend/tests/auth.spec.js`

Tests:
1. Login page renders with store code, username, password fields
2. Login with valid credentials redirects to dashboard
3. Login with wrong password shows error message
4. Login with wrong store code shows error message
5. Forgot password modal opens and accepts username
6. Logout redirects to login page
7. Context-select page loads after fresh login (if multiple outlets)
8. Kiosk page loads with outlet selector and PIN pad
9. Kiosk PIN login works (clock in)
10. Direct /dashboard without auth redirects to /login

---

## Task 3: pos-core.spec.js (~14 tests)

**File:** `frontend/tests/pos-core.spec.js`

Pre-requisite: Login, navigate to POS, handle shift gate.

Tests:
1. POS page loads with search bar, cart area, sidebar
2. Opening gate modal appears if no active shift
3. Can open shift with denomination entry
4. Product search returns results
5. Adding product to cart updates cart table
6. Cart shows correct subtotal
7. Quantity can be changed in cart
8. Remove item from cart works
9. Checkout modal opens on F9 / checkout button
10. Cash payment completes sale
11. Receipt modal shows after sale with invoice number
12. Recent sales panel shows the new sale
13. Customer display endpoint responds (API check)
14. Shift close modal works with denomination entry

---

## Task 4: pos-advanced.spec.js (~15 tests)

**File:** `frontend/tests/pos-advanced.spec.js`

Tests:
1. Apply line-item discount via F2
2. Apply cart-level discount
3. Park sale (F3) and verify parked
4. Resume parked sale (F5) and complete
5. Attach customer to sale (F4)
6. Customer wallet payment (if customer has balance)
7. Split payment (cash + card)
8. Return from recent sales panel
9. Exchange flow (return + new sale)
10. Gift card redemption in POS
11. Sale with promotion applied
12. Add note to sale
13. POS keyboard shortcuts overlay (F1)
14. POS lock screen appears on session timeout
15. Clear cart (F10) empties cart

---

## Task 5: products.spec.js (~15 tests)

**File:** `frontend/tests/products.spec.js`

Tests:
1. Inventory page loads with product table
2. Product search/filter works
3. Add new product form loads (/products/new)
4. Create simple product via form
5. Edit product details
6. Product status toggle (active/inactive)
7. Categories page loads with tree
8. Create category
9. Brands page loads
10. Create brand
11. Taxes page loads
12. Create tax rate
13. Attribute sets page loads
14. Create attribute set with options
15. Promotions page loads and create promotion

---

## Task 6: inventory.spec.js (~12 tests)

**File:** `frontend/tests/inventory.spec.js`

Tests:
1. Stock adjustments page loads
2. Create stock adjustment (increase)
3. Transfers page loads
4. Create transfer between outlets (if multiple)
5. Stock counts page loads
6. Create stock count
7. Reorder alerts page loads
8. Reorder alerts show low-stock products (or empty state)
9. Price lists page loads
10. Create price list
11. Barcode templates page loads
12. Create barcode template

---

## Task 7: purchasing.spec.js (~12 tests)

**File:** `frontend/tests/purchasing.spec.js`

Tests:
1. Suppliers page loads with table
2. Create supplier
3. Purchase orders page loads
4. Create draft PO
5. Submit PO for approval
6. Approve PO (admin)
7. GRN page — receive goods against PO
8. Verify stock increased after GRN
9. Supplier payables page loads
10. Supplier payables show GRN-based payable
11. Returned stock page loads
12. Create supplier return

---

## Task 8: customers.spec.js (~12 tests)

**File:** `frontend/tests/customers.spec.js`

Tests:
1. Customers page loads with table
2. Create customer
3. Edit customer
4. Customer profile/ledger loads
5. Customer groups page loads
6. Create customer group
7. Loyalty tiers page loads
8. Create loyalty tier
9. Wallet topup via API
10. Customer wallet balance visible
11. Blacklist customer toggle
12. Review moderation page loads

---

## Task 9: orders.spec.js (~12 tests)

**File:** `frontend/tests/orders.spec.js`

Tests:
1. Orders page loads
2. Quotations page loads
3. Create quotation via API, verify in list
4. Accept quotation
5. Convert quotation to sale
6. Fulfillment page loads
7. Unfulfilled orders list loads
8. Create picklist from orders
9. Picklist detail page loads
10. Complete picking flow
11. Loadsheets page loads
12. Parked sales page loads with any parked sales

---

## Task 10: employees-hr.spec.js (~12 tests)

**File:** `frontend/tests/employees-hr.spec.js`

Tests:
1. Employees page loads with table
2. Create employee
3. Edit employee
4. Assign outlets to employee
5. Roles are visible (Administrator, Manager, Cashier)
6. Kiosk terminal page loads with PIN pad
7. Attendance page loads with records
8. HR page loads (leave management)
9. Submit leave request
10. Approve leave request
11. Approvals page loads
12. Action history page loads with log entries

---

## Task 11: accounting.spec.js (~10 tests)

**File:** `frontend/tests/accounting.spec.js`

Tests:
1. Accounting page loads
2. Chart of accounts page loads
3. Create account in chart
4. Journal entries page loads
5. Create journal entry
6. Credit/debit notes page loads
7. Create credit note
8. Postdated cheques page loads
9. Create postdated cheque
10. Expenses page loads with categories and records

---

## Task 12: reports.spec.js (~20 tests)

**File:** `frontend/tests/reports.spec.js`

Tests: Navigate to each standalone report URL and verify it loads:
1. Dashboard KPIs load (/dashboard)
2. /reports main page loads with tabs
3. /reports/sales-summary
4. /reports/sales-detail
5. /reports/sales-and-stock
6. /reports/inventory-dump
7. /reports/category-wise
8. /reports/product-specification
9. /reports/order-wise
10. /reports/replenishment
11. /reports/on-hand-inventory
12. /reports/customer-details
13. /reports/customer-wise
14. /reports/supplier-wise
15. /reports/inventory-loss
16. /reports/item-wise
17. /reports/wastage
18. /reports/product-movement
19. /reports/product-performance
20. /reports/parent-report

---

## Task 13: settings.spec.js (~14 tests)

**File:** `frontend/tests/settings.spec.js`

Tests:
1. Company settings page loads with form
2. Company name field is populated
3. Save company settings (no change)
4. Outlets page loads
5. Outlet details visible
6. Email config page loads
7. Printer settings page loads
8. Receipt templates page loads
9. Create receipt template
10. Barcode templates page loads (also in inventory, cross-check)
11. Courier settings page loads
12. Courier list shows 13 pre-seeded couriers
13. Backup/restore page loads
14. Administrator page loads

---

## Task 14: integrations.spec.js (~20 tests)

**File:** `frontend/tests/integrations.spec.js`

Tests:
1. Integrations hub page loads (/settings/integrations)
2. All tab renders with integration cards
3. Marketplaces tab shows Daraz, Shopify
4. Social Commerce tab shows Facebook
5. Messaging tab shows WhatsApp
6. Product Feeds tab shows Google Merchant
7. Couriers tab shows courier cards
8. Click Daraz card — config modal/form renders
9. Click Facebook card — config modal/form renders
10. Click WhatsApp card — config modal/form renders
11. Click Google Merchant card — config modal/form renders
12. Shopify integration page loads (/integrations/shopify)
13. Shopify overview tab renders
14. Shopify import tab renders
15. Shopify mappings tab renders
16. Shopify sync tab renders
17. Shopify events tab renders
18. Shopify reconciliation tab renders
19. Shopify settings tab renders
20. WooCommerce page loads with connection form (/integrations/woocommerce)

---

## Task 15: fbr.spec.js (~8 tests)

**File:** `frontend/tests/fbr.spec.js`

Tests:
1. FBR settings page loads (/settings/fbr)
2. FBR config form has NTN, token, province fields
3. FBR dashboard page loads (/fbr)
4. Dashboard shows status summary (pending/sent/failed counts)
5. Invoice list table renders
6. Tax lookup page loads (/tax-lookup)
7. Tax lookup search returns results for common HS code
8. Tax lookup shows province-specific rates

---

## Task 16: import-export.spec.js (~8 tests)

**File:** `frontend/tests/import-export.spec.js`

Tests:
1. Import page loads (/import)
2. Products import tab is visible
3. Customers import tab is visible
4. Suppliers import tab is visible
5. Template download link works for products (API check)
6. Template download link works for customers (API check)
7. Preview mode shows validation results (upload mock or API)
8. CSV export from inventory page triggers download

---

## Task 17: admin-panel.spec.js (~15 tests)

**File:** `frontend/tests/admin-panel.spec.js`

**Note:** This spec handles its own auth (admin login), does NOT use global storageState.

Tests:
1. Admin login page loads (/admin/login)
2. Admin login with valid credentials
3. Admin dashboard loads with stat cards
4. Tenant list page loads (/admin/tenants)
5. Tenant list shows packagesmall
6. Tenant detail page loads (/admin/tenants/:id)
7. Tenant detail shows billing info
8. Support tickets page loads (/admin/support)
9. Emails page loads (/admin/emails)
10. Dead letters page loads (/admin/dead-letters)
11. Tax rates page loads (/admin/tax-rates)
12. Activity page loads (/admin/activity)
13. Worker status is visible on dashboard
14. Infrastructure stats visible on dashboard
15. Admin logout works

---

## Task 18: crm.spec.js (~8 tests)

**File:** `frontend/tests/crm.spec.js`

Tests:
1. CRM page loads (/crm)
2. Lead pipeline/kanban renders
3. Create new lead
4. Lead detail shows contact info
5. Add activity to lead
6. Move lead to next stage
7. Lead filtering works
8. Lead search works

---

## Task 19: navigation-ux.spec.js (~22 tests)

**File:** `frontend/tests/navigation-ux.spec.js`

Tests — sidebar navigation:
1. Dashboard link works
2. Inventory link works
3. Sales History link works
4. Customers link works
5. Orders link works
6. Purchase Orders link works
7. Employees link works
8. Reports link works
9. Settings section expands

Tests — UX features:
10. Breadcrumbs show on inventory page
11. Breadcrumbs show on customers page
12. Profile dropdown opens on click
13. Profile dropdown shows role
14. Profile link navigates to /profile
15. Dark mode toggle switches theme
16. Dark mode persists after navigation
17. Support widget (floating button) is visible
18. Support widget opens ticket form
19. Notifications bell is visible
20. Notifications page loads (/notifications)
21. Toast notification appears after action
22. Subscription banner visible (trial/active state)

---

## Task 20: permissions.spec.js (~10 tests)

**File:** `frontend/tests/permissions.spec.js`

**Note:** Needs a Cashier employee. Create via API at start, login as Cashier.

Tests:
1. Cashier can access POS
2. Cashier can access sales history
3. Cashier CANNOT access employees page (redirect or denied)
4. Cashier CANNOT access company settings
5. Cashier CANNOT access import page
6. Manager can access products
7. Manager can access inventory
8. Manager can access purchase orders
9. Admin sees all sidebar items
10. Admin can access all settings pages

---

## Task 21: billing.spec.js (~6 tests)

**File:** `frontend/tests/billing.spec.js`

Tests:
1. Billing page loads (/billing)
2. Current plan is displayed
3. Subscription status shown (trial/active/expired)
4. Pricing section visible
5. Payment history section visible
6. Upgrade request button works (opens form or modal)

---

## Task 22: public-pages.spec.js (~10 tests)

**File:** `frontend/tests/public-pages.spec.js`

**Note:** These tests do NOT use storageState (public pages, no auth).

Tests:
1. Landing page loads (/) with login form
2. Landing page shows feature highlights
3. Signup page loads (/signup) with form fields
4. Signup form validates required fields
5. Reset password page loads (/reset-password)
6. Reset password shows error without valid token
7. Public receipt page loads (/receipt/test) — shows "not found" gracefully
8. Access denied page loads (/access-denied)
9. My tickets page loads (/my-tickets) — requires auth, shows tickets list
10. Setup wizard page loads (/setup) — redirects if already setup

---

## Task 23: onboard-free.spec.js (~15 tests)

**File:** `frontend/tests/onboard-free.spec.js`

**Note:** No storageState. Creates a real test tenant.

Tests:
1. Navigate to /signup
2. Fill signup form (Free plan)
3. Submit signup — success screen shows
4. Login with new credentials
5. Setup wizard loads
6. Complete setup wizard steps
7. Dashboard loads after setup
8. Add first product
9. Open shift
10. Kiosk clock-in
11. Complete first POS sale
12. Verify billing shows Free plan
13. Verify employee limit (3 max)
14. Verify outlet limit (1 max)
15. Support widget accessible

---

## Task 24: onboard-starter.spec.js (~15 tests)

**File:** `frontend/tests/onboard-starter.spec.js`

Same structure as onboard-free but with Starter plan limits (3 outlets, 10 employees, 2000 products).

---

## Task 25: onboard-pro.spec.js (~15 tests)

**File:** `frontend/tests/onboard-pro.spec.js`

Same structure as onboard-free but with Pro plan (no practical limits, advanced features accessible).

---

## Execution Order

1. **Task 1**: Infrastructure (delete old, create config + helpers)
2. **Tasks 2-25**: Specs (can be built in any order, all self-contained)
3. **Final**: Run full suite, document pass/fail results

## Run Commands

```bash
# Full suite
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# With headed browser (watch)
cd frontend && npx playwright test tests/auth.spec.js --headed

# Show HTML report
cd frontend && npx playwright show-report
```
