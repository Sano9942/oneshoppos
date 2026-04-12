# Test Suite Guide

## Overview
24 self-contained Playwright specs (~290 tests) auditing every page and feature against production.

## Running Tests

```bash
# All specs
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# With headed browser
cd frontend && npx playwright test tests/auth.spec.js --headed

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

## Helper Exports

### `helpers/auth.js`
| Export | Type | Value / Purpose |
|--------|------|-----------------|
| `STORE_CODE` | const | `"packagesmall"` |
| `USERNAME` | const | `"hassan"` |
| `PASSWORD` | const | `"Danish11"` |
| `PIN` | const | `"2580"` |
| `BACKEND` | const | `"https://api.sanopos.com"` |
| `loginMT` | async fn | `(page) → void` — fills store code + credentials, clicks Sign In, waits for dashboard |

### `helpers/api.js`
| Export | Type | Purpose |
|--------|------|---------|
| `api` | async fn | `(method, path, body?) → { status, ok, data }` — raw REST call with Bearer token + outlet headers |
| `get` | async fn | `(path)` shorthand |
| `post` | async fn | `(path, body)` shorthand |
| `put` | async fn | `(path, body)` shorthand |
| `del` | async fn | `(path)` shorthand |
| `ensurePOSReady` | async fn | `(outletId=1) → void` — opens shift if none active, clocks in if not clocked in; call before navigating to `/pos` |

Token is read from `tests/token.json` (written by `global-setup.js`). Headers sent: `Authorization`, `x-outlet-id: 1`, `x-scope-mode: outlet`.

### `helpers/nav.js`
| Export | Type | Purpose |
|--------|------|---------|
| `navigateTo` | async fn | `(page, path)` — goto + waitForLoadState("networkidle") |
| `waitForPageShell` | async fn | `(page, titleText)` — waits for heading with text (15s timeout) |
| `clickSidebarLink` | async fn | `(page, linkText)` — clicks sidebar nav link by text + waits for load |

## Spec Files (24 specs)
`auth`, `products`, `customers`, `inventory`, `purchasing`, `orders`, `pos-core`, `pos-advanced`, `employees-hr`, `crm`, `reports`, `accounting`, `settings`, `billing`, `fbr`, `integrations`, `import-export`, `permissions`, `navigation-ux`, `admin-panel`, `public-pages`, `onboard-free`, `onboard-starter`, `onboard-pro`

## Smoke Tests (14 specs)
- Location: `tests/smoke/` — broader E2E coverage for competitive features
- Specs: `bookings`, `catalog-advanced`, `commissions-reports`, `draft-orders-returns`, `insights-dashboard`, `invoicing-subscriptions`, `marketing-messaging`, `omnichannel-admin`, `phase5-pakistan`, `pricing-promotions`, `restaurant`, `service-workspace`, `storefront-public`, `workforce`
- Smoke helpers: `tests/smoke/helpers/` — `cleanup.js`, `featureFlags.js`, `mockPaymentGateway.js`, `smokeRunId.js`

### Smoke Helper Exports

**`smokeRunId.js`**
| Export | Purpose |
|--------|---------|
| `SMOKE_RUN_ID` | Unique string per test run — format `SMOKE-{iso-ts}-{rnd6}` |
| `prefix(name)` | Returns `${SMOKE_RUN_ID}-${name}` — use for all created resource names |

**`featureFlags.js`** — cached flag lookup via `GET /api/feature-flags`
| Export | Purpose |
|--------|---------|
| `isFlagEnabled(key)` | async — returns `true`/`false`; caches result per run |
| `skipIfFlagOff(test, specName, ...flagKeys)` | Call in `beforeAll` — skips entire spec if any flag is off |
| `softSkip(test, specName, ...flagKeys)` | Call inside a `test()` — skips that single test if flag is off |
| `__resetFlagCache()` | Clears the in-memory cache (test teardown only) |

**`cleanup.js`** — best-effort resource teardown
| Export | Purpose |
|--------|---------|
| `trackForCleanup(type, id)` | Register a resource for deletion; `type` must be a key in `DELETERS` |
| `cleanupAll()` | async — deletes all tracked resources in reverse order (children before parents); swallows per-resource failures; call in `afterAll`/`afterEach` |
| `__clearBag()` | Empties the bag without deleting (test isolation) |

Resource types registered in `DELETERS` (38 types): `product`, `customer`, `category`, `return-policy`, `return-reason`, `schedule`, `price-list`, `price-list-assignment`, `draft-order`, `smart-collection`, `outlet-tax-profile`, `scheduled-change`, `commission-plan`, `product-affinity`, `pos-layout`, `report-definition`, `marketing-campaign`, `marketing-template`, `customer-invoice`, `subscription-plan`, `customer-subscription`, `restaurant-floor`, `restaurant-table`, `restaurant-check`, `restaurant-session`, `kds-station`, `booking-service`, `appointment`, `project`, `contract`, `contract-template`, `cod-settlement`, `integration-credential`.

**`mockPaymentGateway.js`** — Playwright route-interception stubs
| Export | Stubs | Returns |
|--------|-------|---------|
| `mockXPay(page)` | `/xpay|x-pay/` + `**/api/storefront/orders/*/pay` | capture bag array |
| `mockJazzCash(page)` | `/jazzcash/` | capture bag array |
| `mockEasypaisa(page)` | `/easypaisa/` | capture bag array |
| `mockCourierAPI(page)` | All 13 courier names (leopards→fedex) | capture bag array |
| `mockSMSProvider(page)` | `/(zong|jazz|ufone|telenor|twilio|sms-provider)/` | capture bag array |

Each returns a bag array that gets the request body pushed into it — assert on `bag.at(-1)` after the flow.

## Unit Tests (35 tests — 4 files, Vitest)
- Run: `npx vitest run tests/unit/`

| File | Tests | What it covers |
|------|-------|----------------|
| `auth_guards.test.jsx` | 5 | `RequireAuth` (loading/authenticated/redirect) + `RequirePerm` (allow/redirect-to-access-denied) |
| `contexts.test.jsx` | 19 | `cartMath.js` (calcGrossTotal×4, calcDiscountValue×4, calcTaxTotal×4, calcTotal×5) + `CurrencyContext` fmt()×2 |
| `layout.test.jsx` | 4 | `PageShell` (title+subtitle, right-side content) + `NotificationBell` (badge count, dropdown, empty state) |
| `primitives.test.jsx` | 7 | `Button` (render, click, primary/danger tones) + `Input` (placeholder, onChange) + `Badge` (3 tones) + `EmptyState` |

**Gotcha**: `contexts.test.jsx` is named "contexts" but its primary coverage is `cartMath.js` (17 of 19 tests). `CurrencyContext` is tested via `renderHook` with a stubbed `fetch`. No POSContext unit tests exist.

## Config
- Single config: `playwright.config.js` (production target)
- No separate live/onboarding configs
