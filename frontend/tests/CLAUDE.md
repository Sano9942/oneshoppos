# Test Suite Guide

## Running Tests

```bash
# All E2E specs
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# Headed browser
cd frontend && npx playwright test tests/auth.spec.js --headed

# All unit tests (Vitest)
cd frontend && npx vitest run tests/unit/

# Show Playwright report
cd frontend && npx playwright show-report
```

## Architecture

- **E2E (Playwright)**: all specs hit `https://sanopos.com` + `https://api.sanopos.com` — production only
- **Unit (Vitest)**: no server; mocks all network dependencies via `vi.mock`
- **Self-contained**: each E2E spec sets up its own data via API helper calls, no shared fixtures
- **Global setup**: `global-setup.js` logs in once, writes `auth.json` (browser storage state) + `token.json` (Bearer token) — both gitignored. Token used by `helpers/api.js` for API helper calls
- **Config**: single `playwright.config.js` — no separate live/onboarding configs

## Test Tenant

| Field | Value |
|-------|-------|
| Store code | `packagesmall` |
| Username | `hassan` |
| Password | `Danish11` |
| PIN | `2580` |
| Backend | `https://api.sanopos.com` |

---

## Helper Files

### `helpers/auth.js`

| Export | Type | Notes |
|--------|------|-------|
| `STORE_CODE` | const | `"packagesmall"` |
| `USERNAME` | const | `"hassan"` |
| `PASSWORD` | const | `"Danish11"` |
| `PIN` | const | `"2580"` |
| `BACKEND` | const | `"https://api.sanopos.com"` |
| `loginMT` | async fn | `(page) → void` — fills store code + credentials, clicks Sign In, waits for `/dashboard` URL |

Login locators: store code via `getByPlaceholder(/aceshardware/i)`, username via `getByPlaceholder(/employee name/i)`, password via `getByPlaceholder(/password/i)`, button via `getByRole("button", { name: /sign in/i })`.

### `helpers/api.js`

| Export | Type | Notes |
|--------|------|-------|
| `api` | async fn | `(method, path, body?) → { status, ok, data }` — REST call with Bearer token |
| `get` | async fn | Shorthand for `api("GET", path)` |
| `post` | async fn | Shorthand for `api("POST", path, body)` |
| `put` | async fn | Shorthand for `api("PUT", path, body)` |
| `del` | async fn | Shorthand for `api("DELETE", path)` |
| `ensurePOSReady` | async fn | `(outletId=1)` — opens shift if none active + clocks in if not clocked in; call in `test.beforeAll` before any POS test |

Token read from `tests/token.json` (written by global-setup). All requests include headers: `Authorization: Bearer`, `x-outlet-id: 1`, `x-scope-mode: outlet`.

`ensurePOSReady` flow:
1. `GET /api/shifts/active?outlet_id=N` — if no shift, `POST /api/shifts/open` with `{ outlet_id, opening_float: 1000 }`
2. `GET /api/attendance/my-status?outlet_id=N` — if not `clocked_in`, `POST /api/attendance/pin-checkin?tenant=packagesmall` with `{ pin_code: "2580", outlet_id }`

### `helpers/nav.js`

| Export | Type | Notes |
|--------|------|-------|
| `navigateTo` | async fn | `(page, path)` — goto + waitForLoadState("networkidle") |
| `waitForPageShell` | async fn | `(page, titleText)` — waits for `getByRole("heading")` with 15s timeout |
| `clickSidebarLink` | async fn | `(page, linkText)` — clicks nav link by text + waitForLoadState |

### `setup.js`

Vitest setup file. Imports `@testing-library/jest-dom` (adds `toBeInTheDocument`, `toHaveClass`, etc.) and `fake-indexeddb/auto` (polyfills IndexedDB for `offlineQueue` tests).

---

## Smoke Test Helpers (`smoke/helpers/`)

### `smokeRunId.js`

| Export | Notes |
|--------|-------|
| `SMOKE_RUN_ID` | Unique string per run: `SMOKE-{iso-ts}-{rnd6}` |
| `prefix(name)` | Returns `${SMOKE_RUN_ID}-${name}` — use for all resource names created in smoke tests |

### `featureFlags.js`

Cached flag lookup via `GET /api/feature-flags` (re-uses the `helpers/api.js` token). Cache is per-run (in-memory `Map`).

| Export | Notes |
|--------|-------|
| `isFlagEnabled(key)` | async — `true`/`false`; cached after first call |
| `skipIfFlagOff(test, specName, ...flagKeys)` | Call in `test.beforeAll` — skips entire spec if any flag is off; logs `SKIP: specName (key=false)` |
| `softSkip(test, specName, ...flagKeys)` | Call inside `test()` — skips that single test if flag is off |
| `__resetFlagCache()` | Empties cache — for test teardown only |

### `cleanup.js`

Best-effort teardown for resources created during smoke tests.

| Export | Notes |
|--------|-------|
| `trackForCleanup(type, id)` | Register a resource. `type` must match a key in `DELETERS`. `id=null` is a no-op |
| `cleanupAll()` | async — deletes all tracked resources in reverse order (children before parents); swallows individual failures; call in `afterAll`/`afterEach` |
| `__clearBag()` | Empties the bag without deleting |

Registered resource types (all backed by `helpers/api.del`):

`product`, `customer`, `category`, `return-policy`, `return-reason`, `schedule`, `price-list`, `price-list-assignment`, `draft-order`, `smart-collection`, `outlet-tax-profile`, `scheduled-change`, `commission-plan`, `product-affinity`, `pos-layout`, `report-definition`, `marketing-campaign`, `marketing-template`, `customer-invoice`, `subscription-plan`, `customer-subscription`, `restaurant-floor`, `restaurant-table`, `restaurant-check`, `restaurant-session`, `kds-station`, `booking-service`, `appointment`, `project`, `contract`, `contract-template`, `cod-settlement`, `integration-credential`

### `mockPaymentGateway.js`

Playwright `page.route()` stubs for external services. Each returns a capture bag array — push is automatic; assert on `bag.at(-1)` after the flow.

| Export | Intercepts | Returns |
|--------|-----------|---------|
| `mockXPay(page)` | `/xpay\|x-pay/i` + `**/api/storefront/orders/*/pay` | bag; stub returns `{ intent_id, redirect_url, status: "pending" }` |
| `mockJazzCash(page)` | `/jazzcash/i` | bag; stub returns `{ pp_ResponseCode: "000", pp_TxnRefNo, pp_RedirectURL }` |
| `mockEasypaisa(page)` | `/easypaisa/i` | bag; stub returns `{ orderId, redirectUrl }` |
| `mockCourierAPI(page)` | All 13 courier names (leopards→fedex) | bag; stub returns `{ tracking_number, status: "booked", label_url }` |
| `mockSMSProvider(page)` | `/(zong\|jazz\|ufone\|telenor\|twilio\|sms-provider)/i` | bag; stub returns `{ message_id, status: "delivered" }` |

---

## E2E Spec Files (28 specs)

| Spec | What it tests |
|------|---------------|
| `auth.spec.js` | Login page fields, valid login redirect, wrong password error |
| `products.spec.js` | Product CRUD, variants, categories, barcode |
| `customers.spec.js` | Customer list, create, edit, loyalty, wallet, blacklist |
| `inventory.spec.js` | Stock levels, transfers, adjustments, stock count |
| `purchasing.spec.js` | Purchase orders, GRN, supplier payables |
| `orders.spec.js` | Web orders, fulfillment, dispatch |
| `pos-core.spec.js` | POS loads, search bar, cart area; uses `ensurePOSReady()` in `beforeAll` |
| `pos-advanced.spec.js` | POS discounts, park/resume, customer attach, receipts, returns |
| `employees-hr.spec.js` | Employee CRUD, attendance, leave, payroll |
| `crm.spec.js` | Customer notes, tags, activity history |
| `reports.spec.js` | All report tabs render, date filters, CSV export |
| `accounting.spec.js` | Chart of accounts, journal entries, credit notes, postdated cheques |
| `settings.spec.js` | Outlet config, receipt templates, printer, roles |
| `billing.spec.js` | Subscription status, payment history, upgrade request |
| `fbr.spec.js` | FBR config, invoice queue, retry, tax lookup |
| `integrations.spec.js` | Integrations hub, Shopify connect flow, WooCommerce |
| `import-export.spec.js` | Product/customer/supplier/expense/payment import wizard |
| `permissions.spec.js` | Role-based access: cashier/manager/admin see correct UI |
| `navigation-ux.spec.js` | Sidebar nav links, breadcrumbs, dark mode toggle |
| `admin-panel.spec.js` | Super-admin login, tenant list, tenant detail, feature flags |
| `public-pages.spec.js` | Shareable receipt, booking widget, restaurant QR menu |
| `onboard-free.spec.js` | Full free-tier onboarding flow; **delete test tenant from `/admin` after run** |
| `onboard-starter.spec.js` | Starter-tier onboarding; **delete after run** |
| `onboard-pro.spec.js` | Pro-tier onboarding; **delete after run** |
| `onboard-dental-clinic.spec.js` | Dental clinic preset onboarding; **delete after run** |
| `onboard-physiotherapy.spec.js` | Physiotherapy preset onboarding; **delete after run** |
| `onboard-veterinary.spec.js` | Veterinary preset onboarding; **delete after run** |
| `treatment-plans.spec.js` | Treatment plan CRUD, sessions, lab orders, consent |

**Onboarding spec gotcha**: each creates a real tenant on production. Must be deleted manually from `/admin` after each run — they are not auto-cleaned.

---

## Smoke Spec Files (`smoke/` — 17 specs)

All smoke specs call `skipIfFlagOff` in `beforeAll` to skip when the required feature flag is off on `packagesmall`. All use `trackForCleanup` + `cleanupAll` for teardown.

| Spec | Feature area |
|------|-------------|
| `bookings.smoke.spec.js` | Appointment booking services, public booking widget |
| `catalog-advanced.smoke.spec.js` | Smart collections, scheduled changes, price lists, POS layouts |
| `commissions-reports.smoke.spec.js` | Commission plans, payout reports |
| `draft-orders-returns.smoke.spec.js` | Draft orders (parked sales), returns & exchanges |
| `insights-dashboard.smoke.spec.js` | AI chat panel, insight cards |
| `invoicing-subscriptions.smoke.spec.js` | Customer invoices, subscription plans, billing portal |
| `marketing-messaging.smoke.spec.js` | Marketing campaigns, messaging inbox |
| `omnichannel-admin.smoke.spec.js` | Integrations hub, Daraz/Meta/WooCommerce credential setup |
| `phase5-pakistan.smoke.spec.js` | COD settlements, FBR digital invoicing, xPay gateway (mocked) |
| `pricing-promotions.smoke.spec.js` | Promotions, discount rules, outlet tax profiles |
| `restaurant.smoke.spec.js` | Floor plans, table sessions, checks, KDS |
| `restaurant-shell.smoke.spec.js` | Restaurant layout shell, floor/check nav |
| `restaurant-86.smoke.spec.js` | 86 (void) item from active check |
| `restaurant-menu-schedules.smoke.spec.js` | Menu scheduling (happy hour, daypart) |
| `restaurant-printer-routing.smoke.spec.js` | KDS station printer routing |
| `restaurant-void-comp.smoke.spec.js` | Comp and void flows on checks |
| `restaurant-kds-analytics.smoke.spec.js` | KDS prep-time analytics |
| `restaurant-menu-engineering.smoke.spec.js` | Menu engineering scatter chart |
| `restaurant-pay-at-table.smoke.spec.js` | Pay-at-table QR flow |
| `restaurant-reservations.smoke.spec.js` | Reservation management |
| `service-workspace.smoke.spec.js` | Projects, contracts, service tickets |
| `storefront-public.smoke.spec.js` | Public storefront: browse, add-to-cart, checkout |
| `workforce.smoke.spec.js` | HR: payroll, leave management, scheduling |
| `m2-tickets-subscriptions.smoke.spec.js` | Service tickets (M2 preset), subscriptions |

---

## Unit Test Files (`unit/` — Vitest)

All use `@testing-library/react` + `vitest`. `fake-indexeddb/auto` imported where IndexedDB is used (either directly in the test or via `setup.js`).

| File | Tests | What it covers |
|------|-------|---------------|
| `auth_guards.test.jsx` | 5 | `RequireAuth`: loading state (isBootstrapping), authenticated render, redirect to login. `RequirePerm`: allow when hasPerm true, redirect to `/access-denied` when false |
| `contexts.test.jsx` | 19 | `cartMath.js` (17 tests): `calcGrossTotal`×4, `calcDiscountValue`×4, `calcTaxTotal`×4, `calcTotal`×5. `CurrencyContext` (2 tests): `fmt()` formats integers + zero via `renderHook` with stubbed fetch |
| `layout.test.jsx` | 5 | `PageShell`: title+subtitle render, right-side content. `NotificationBell`: unread badge count, dropdown open shows notifications, empty state text |
| `primitives.test.jsx` | 8 | `Button`: render, click, primary tone class, danger tone class. `Input`: placeholder, onChange. `Badge`: success/warning/danger tones. `EmptyState`: title+body |
| `primitives-modal.test.jsx` | 18 | `Modal`: open/closed state, Escape closes, backdrop click closes, inner click no-op, `closeOnBackdrop=false`, close button default/hidden, size prop, Escape cleanup after unmount. `ConfirmDialog`: render, danger tone, onConfirm, busy state. `TabBar`: labels, aria-selected, onChange, count badge. `Button` extensions: iconOnly padding, link tone |
| `dental-chart.test.jsx` | 11 | `DentalChart` adult preset (32 teeth, upper/lower rows, click → onToothClick, colored markers, title attrs, string/numeric area_code). Primary preset (20 A-T teeth, no adult teeth). Legend rendering |
| `offline-queue.test.js` | 7 | `utils/offlineQueue` (IndexedDB): enqueue+getQueue, MAX_QUEUED overflow throws, markSyncing, markSynced removes row, markFailed sets state, getQueueByState filters, migrateFromLocalStorage imports + clears + idempotent, clearQueue is employee-scoped |
| `use-offline-queue.test.js` | 4 | `useOfflineQueue` hook: enqueueSale increments count, syncQueue on 200 clears queue + calls `/api/sales`, syncQueue on 500 marks failed, 409 with duplicate:true treated as synced |
| `omniInputRouter.test.js` | 12 | `classifyOmniInput`: EAN-13/UPC-A/EAN-8/GTIN-14, PLU 4-5 digits, `#` prefix customer, text ≥2 chars, empty/whitespace noop, ambiguity (4-5 digit → PLU, 6-7 digit → text, 8+ digits → barcode) |
| `cartMath.test.jsx` | 4 | Bulk-scan toggle logic (mirrors `useCart.addToCart` branch): `increment` mode bumps existing line, `new_line` mode creates separate line per scan, missing key falls back to increment, no deviceId falls back to `"default"` which has no mode key |
| `cartMath-tax-mode.test.js` | 5 | `calcTaxTotal` exclusive mode (was returning 0 before P8 fix), exclusive multi-line sum, inclusive 3.14 fixture (17%+5%), zero rate, `calcTotal` exclusive end-to-end regression |
| `parsePriceBookCsv.test.js` | 8 | Inline parser from `CustomerGroupPriceBookRedesign.jsx`: empty input, 2-col rows, 3-col with variant_id, header row skip (product_id/id keywords), malformed row counting, Windows CRLF, empty variant_id → null |
| `useLoyaltyWallet-config.test.js` | 5 | `useLoyaltyWallet` hook: default rates when no config, default rates when config=null, tenant-configured earn+redeem rates, tier multiplier applied on top, string rate coercion (NUMERIC columns from pg driver arrive as strings) |
| `chunk-reload.test.js` | 8 | `utils/chunkReload`: `looksLikeChunkLoadFailure` matches Chrome/Firefox/Safari/Webpack/Vite chunk error messages, rejects unrelated errors + null/undefined. `reloadOnceForChunkFailure`: triggers on first call, suppresses within 30s guard, allows again after 30s, returns false when no storage |
| `pos-context-open-check.test.jsx` | 4 | `POSContext` openCheck/closeCheck/ensureDraftOrder: `openCheck` sets orderContext+tableSessionId+seatCount, takeout leaves table null, `closeCheck` resets all restaurant fields, `ensureDraftOrder` lazily POSTs to `/api/draft-orders` and is idempotent |
| `restaurant-cart-grouping.test.js` | 6 | `cartGrouping.js` `groupCartBySeatAndCourse`: empty cart, groups by seat then course, subtotal+itemCount per group, course number derived from `course_N` string, null seat → seat 0, missing/`"main"` course_name → course 1 |
| `customers-clinical-subjects.test.jsx` | 3 | `CustomersRedesign` clinical subjects panel: shows Add button on veterinary preset with empty-state copy, submits correct payload (customer_id, subject_type, name, species, null optional fields), defaults to `dependent` on dental preset + hides pet fields, hides section on non-clinical preset |
| `admin-support-screenshots.test.jsx` | 1 | `AdminSupportTickets` screenshot rendering: `screenshots` array with `{filename, url}` objects renders `<img src=url>` — guards against `[object Object]` regression |

**Important gotcha**: `contexts.test.jsx` is named "contexts" but covers `cartMath.js` (17 of 19 tests). No POSContext integration tests exist as unit tests — the POSContext is tested via `pos-context-open-check.test.jsx` (open/close/ensureDraftOrder only).
