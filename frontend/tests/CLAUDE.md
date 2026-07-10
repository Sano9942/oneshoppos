# Test Suite Guide

## Critical: these are PRODUCTION tests

Every spec under `frontend/tests/*.spec.js` and `frontend/tests/smoke/` runs against the **live production site** — `https://sanopos.com` (frontend) and `https://api.sanopos.com` (backend). There is no local/staging Playwright target. Running these creates, mutates, and deletes real data on production. Only `tests/unit/` is safe to run freely (no network, fully mocked).

**Known issue**: the shared test tenant `packagesmall` was deleted from production. `global-setup.js` will log this as a warning and continue (it does not hard-fail the run), but every legacy spec that depends on `auth.json`/`token.json` from that login will fail at the point it needs an authenticated session. Before trusting a "failing" run, check whether the failure is `packagesmall`-related or a real regression. If you need a working authenticated target, either provision a fresh tenant (see `sweep/`) and point the login helper at it, or ask the user for a current test tenant.

## Running Tests

```bash
# All E2E specs (chromium project only — sweep is excluded by testIgnore)
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# Headed browser
cd frontend && npx playwright test tests/auth.spec.js --headed

# Sweep (must be requested explicitly — never picked up by default)
cd frontend && npx playwright test --project=sweep

# Unit tests (Vitest, safe/local)
cd frontend && npx vitest run tests/unit/

# Show HTML report after a run
cd frontend && npx playwright show-report
```

## Architecture

- **Config**: `frontend/playwright.config.js` — single config, no separate live/staging variants. `baseURL: https://sanopos.com`, `storageState: ./tests/auth.json`, `fullyParallel: false`, `workers: 1`, `retries: 0`, `testMatch: "*.spec.js"`. Two projects:
  - `chromium` — the default project; `testIgnore: /sweep\//` so it never picks up the sweep spec.
  - `sweep` — matches only `sweep/*.spec.js`; headed-only, `storageState: undefined` (provisions its own tenant instead of reusing the shared session), 4-hour per-spec timeout, `slowMo: 200`, `trace: "on"`, video retained on failure. Must be run explicitly with `--project=sweep`.
- **Global setup** (`global-setup.js`): runs once before the `chromium` project, logs into `packagesmall` via `helpers/auth.js:loginMT`, and writes `auth.json` (browser storage state) + `token.json` (Bearer token) — both gitignored. If login fails (e.g. tenant deleted), it warns and continues rather than aborting the whole run, so the `sweep` project is never blocked by a dead shared tenant. Skips entirely if the only project requested is `sweep` (detected via `--project=sweep` in argv).
- **Self-contained specs**: each spec sets up its own data via `helpers/api.js` calls — no shared fixtures beyond the login session.
- **Unit tests**: colocated under `tests/unit/`, run by Vitest, fully mocked — no server, no network. Setup file is `frontend/tests/setup.js` (imports `@testing-library/jest-dom` and `fake-indexeddb/auto`), wired via `vite.config.js`'s `test.setupFiles`.

## Test Tenant (production)

| Field | Value |
|-------|-------|
| Store code | `packagesmall` |
| Username | `hassan` |
| Password | `Danish11` |
| PIN | `2580` |
| Backend | `https://api.sanopos.com` |

This tenant has been deleted from production (see warning above) — these credentials are what every legacy spec is hardcoded to use, not a guarantee they currently work.

## Helper Files (`tests/helpers/`)

### `auth.js`
Exports the credentials above plus `loginMT(page)`: navigates to `/login`, fills store code / employee name / password, clicks Sign In, waits for redirect to `/dashboard`.

Locators (fragile — check these first if login-dependent specs break): store code via `getByPlaceholder(/aceshardware/i)` (falls back to `getByLabel(/store code/i)`), username via `getByPlaceholder(/employee name/i)`, password via `getByPlaceholder(/password/i)`, submit via `getByRole("button", { name: /sign in/i })`.

### `api.js`
Direct REST helper used from spec `beforeAll`/setup blocks (not routed through the browser). Reads the Bearer token from `tests/token.json` (written by global setup).

- `api(method, path, body?)` → `{ status, ok, data }`
- `get`/`post`/`put`/`del` — shorthands
- Every request sends `Authorization: Bearer <token>`, `x-outlet-id: 1`, `x-scope-mode: outlet`
- `ensurePOSReady(outletId = 1)` — call in `test.beforeAll` before any POS spec. Opens a shift (`POST /api/shifts/open`, float 1000) if none active, then clocks in via `POST /api/attendance/pin-checkin?tenant=packagesmall` (note: NOT `/clock-in`) if not already `clocked_in`.

### `nav.js`
- `navigateTo(page, path)` — `page.goto` + wait for `networkidle`
- `waitForPageShell(page, titleText)` — waits for a heading role match, 15s timeout
- `clickSidebarLink(page, linkText)` — clicks a nav link by visible text, then waits for `networkidle`

## Spec Categories

### Top-level E2E specs (`tests/*.spec.js`)
Cover core POS/back-office domains end to end against production, one `test.describe` block (or several) per domain: `auth` (Authentication), `products` (Products & Inventory Page, Categories, Brands, Taxes, Attribute Sets, Promotions), `customers` (Customers), `inventory` (Stock Adjustments, Stock Transfers, Stock Counts, Reorder Alerts, Price Lists, Barcode Templates, Inventory API Validation), `purchasing` (Suppliers, Purchase Orders, Supplier Payables, Returned Stock), `orders` (Orders), `order-kiosk` (Customer order kiosk), `pos-core` / `pos-advanced` (POS Core, POS Advanced Features), `employees-hr` (Employees & HR), `crm` (CRM), `reports` (Dashboard, Reports), `accounting` (Accounting), `settings` (Settings), `billing` (Billing), `fbr` (FBR Integration), `integrations` (Integrations Hub, Shopify Integration, WooCommerce Integration), `import-export` (Import & Export), `permissions` (Permissions — Admin user, Permissions — Cashier user), `navigation-ux` (Sidebar Navigation, UX Features), `admin-panel` (Admin Panel, Authenticated Admin Pages), `public-pages` (Public Pages), `treatment-plans` (M10 Treatment Plans — retail tenant nav-hidden check, M10 seed data integrity), plus six `onboard-*` specs (free/starter/pro tiers and three vertical presets: dental clinic, physiotherapy, veterinary).

**Onboarding specs create real tenants on production.** Each provisions a brand-new tenant via the signup flow. These are not auto-cleaned — delete the created tenant from `/admin` after every run, or they accumulate as dead tenants.

### Smoke specs (`tests/smoke/*.smoke.spec.js`)
Competitive/vertical feature coverage, one file per feature area: `bookings`, `catalog-advanced`, `commissions-reports`, `draft-orders-returns`, `insights-dashboard`, `invoicing-subscriptions`, `m2-tickets-subscriptions` (service tickets + subscription polish), `marketing-messaging`, `omnichannel-admin`, `phase5-pakistan`, `pricing-promotions`, `service-workspace`, `storefront-public`, `workforce`, and a cluster of restaurant-specific specs each tagged with its build phase: `restaurant-shell` (Phase 2-R.0), `restaurant-void-comp` (2-R.2), `restaurant-pay-at-table` (2-R.3), `restaurant-reservations` (2-R.4), `restaurant-kds-analytics` (2-R.5), `restaurant-menu-schedules` (2-R.6), `restaurant-printer-routing` (2-R.7), `restaurant-menu-engineering` (2-R.10), `restaurant-86` (2-R.1), plus a general `restaurant.smoke.spec.js`.

Shared helpers live in `tests/smoke/helpers/`:
- `smokeRunId.js` — `SMOKE_RUN_ID` (unique per run) + `prefix(name)` for naming created resources so parallel/repeat runs don't collide
- `featureFlags.js` — `isFlagEnabled(key)` (cached), `skipIfFlagOff(test, specName, ...keys)` for whole-spec skip in `beforeAll`, `softSkip` for single-test skip, `__resetFlagCache()` for teardown
- `cleanup.js` — `trackForCleanup(type, id)` registers a resource for teardown; `cleanupAll()` deletes everything tracked in reverse order (children before parents), swallowing individual failures; call from `afterAll`/`afterEach`. Supports a large set of resource types (products, customers, categories, price lists, draft orders, restaurant floors/tables/checks/sessions, KDS stations, bookings, projects, contracts, subscriptions, etc.) — check the `DELETERS` map in `cleanup.js` before adding a new type
- `mockPaymentGateway.js` — `page.route()` stubs for external services that must never be hit for real in a test: `mockXPay`, `mockJazzCash`, `mockEasypaisa`, `mockCourierAPI` (all 13 courier adapter names), `mockSMSProvider`. Each returns a capture bag; assert on `bag.at(-1)` after triggering the flow

Most smoke specs don't call `skipIfFlagOff` — check each spec individually before assuming a flag-gated feature is actually being exercised.

### Sweep (`tests/sweep/`)
A single very long-running spec (`functional-sweep.spec.js`, `test.describe("Full real-user functional sweep")`, `--project=sweep`) that signs up a fresh production tenant and walks the full merchant journey — signup → onboarding → upgrade → POS → inventory → reports — over many ordered steps, ~3-4 hours, headed-only, manually triggered (no CI). Requires operator interaction twice: clicking an email verification link (real inbox) and approving a sandbox payment popup. Writes step-by-step findings to `frontend/test-results/sweep-findings.json` and a human triage list to `docs/sweep-findings-YYYY-MM-DD.md`; failure screenshots/traces land under `frontend/test-results/sweep/<step>/`. See `tests/sweep/README.md` for the full run procedure and `SWEEP_RESUME.md` if a prior run needs resuming. Has its own `helpers/` (`findings.js`, `manager-pin.js`, `nav.js`, `pause-for-email-verify.js`) and `fixtures/` (`test-product.jpg`) — separate from the top-level `tests/helpers/`.

### Unit tests (`tests/unit/*.test.jsx` / `.test.js`)
Vitest + `@testing-library/react`, fully mocked, no server. Covers: route guards (`auth_guards`), layout primitives (`layout` — `PageShell`, `NotificationBell`), design-system primitives (`primitives`, `primitives-modal` — `Button`/`Input`/`Badge`/`Modal`/`ConfirmDialog`/`TabBar`), the dental chart component (`dental-chart`), a clinical-subjects panel used by veterinary/dental presets (`customers-clinical-subjects`), offline queue IndexedDB store + its hook (`offline-queue`, `use-offline-queue`, `offline-decoded-snapshot`), chunk-reload-failure detection/recovery (`chunk-reload`), POS restaurant open/close-check context logic (`pos-context-open-check`), restaurant cart seat/course grouping (`restaurant-cart-grouping`), the omni-input classifier for barcode/PLU/customer-code routing (`omniInputRouter`), a scale-barcode weight parser (`scale-parse`, `embeddedBarcode`), a standalone CSV parser extracted from the customer group price-book page (`parsePriceBookCsv`), the loyalty wallet rate hook (`useLoyaltyWallet-config`), and `cartMath.js` pure functions across three files (`cartMath`, `cartMath-tax-mode` — tax-mode regression suite, `cartMath-weighted`).

Naming gotcha: `contexts.test.jsx` is misleadingly named — most of its assertions actually cover `cartMath.js`, not React context providers in general.

## Common Gotchas

- Clock-in endpoint is `POST /api/attendance/pin-checkin?tenant=<slug>`, never `/clock-in`.
- Don't assume a failing legacy spec is a new regression — first rule out the `packagesmall` deletion (see top of this file).
- `fullyParallel: false` / `workers: 1` in the config is deliberate — these tests mutate shared production state; don't override to parallel without understanding the collision risk.
- The `sweep` project is excluded from default runs (`testIgnore: /sweep\//` on `chromium`) — you must pass `--project=sweep` explicitly, and it ignores `storageState`/`auth.json` entirely.
- Onboarding specs and the sweep spec both create real production tenants that need manual deletion from `/admin`.
- `helpers/api.js`'s token comes from `tests/token.json`, which only gets written if `global-setup.js`'s login succeeds — if that tenant is unreachable, anything depending on `ensurePOSReady` or direct API helper calls will fail even though the browser-based parts of a spec might still partially run.
