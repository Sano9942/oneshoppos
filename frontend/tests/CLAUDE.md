# Test Suite Guide

## Critical: these are PRODUCTION tests

Every spec under `frontend/tests/*.spec.js` and `frontend/tests/smoke/` runs against the **live production site** — `https://sanopos.com` (frontend) and `https://api.sanopos.com` (backend). There is no local/staging Playwright target. Running these creates, mutates, and deletes real data on production. Only `tests/unit/` is safe to run freely (no network, fully mocked).

**The suite fails loudly when it cannot authenticate — by design.** `global-setup.js` **throws** if the shared-tenant login fails; it does not warn and continue. A run that cannot get a session proves nothing, so it must not be able to report green.

This replaced a long-lived hole (fixed 2026-07-25): the shared tenant `packagesmall` was deleted from production in Apr 2026, global setup only *warned*, and specs then proceeded with a stale or absent session — assertions no-op'd or skipped and runs looked green while testing nothing. Two changes close it: the tenant slug now lives in exactly one place (`helpers/auth.js:STORE_CODE`, env-overridable), and setup hard-fails.

Both directions are verified: a live tenant → setup logs in and the login specs pass; `E2E_TENANT=packagesmall` (the dead one) → the run aborts with exit 1 and an actionable message.

To point a run at a different tenant, no code change is needed:

```bash
E2E_TENANT=<slug> E2E_USERNAME="<Employee Name>" E2E_PASSWORD=<pw> E2E_PIN=<pin> npx playwright test
```

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

- **Config**: `frontend/playwright.config.js` — single config, no separate live/staging variants. `baseURL: https://sanopos.com`, `storageState: ./tests/auth.json`, `fullyParallel: false`, `workers: 1`, `retries: 0`, `testMatch: "*.spec.js"`, global `timeout: 60000`. Two projects:
  - `chromium` — the default project; `testIgnore: /sweep\//` so it never picks up the sweep spec.
  - `sweep` — matches only `sweep/*.spec.js`; headed-only, `storageState: undefined` (provisions its own tenant instead of reusing the shared session), 4-hour per-spec timeout, `slowMo: 200`, `trace: "on"`, video retained on failure. Must be run explicitly with `--project=sweep`.
- **Global setup** (`global-setup.js`): runs once before the `chromium` project, logs into `helpers/auth.js:STORE_CODE` via `loginMT`, and writes `auth.json` (browser storage state) + `token.json` (Bearer token) — both gitignored. **Throws on any failure**, including reaching `/dashboard` but finding no `authSession` token in localStorage (which would leave `helpers/api.js` sending `Bearer null` on every call). Skips entirely if the only project requested is `sweep` (detected by matching `--project=sweep` against `process.argv`) — so a hard failure here can never block the sweep, which provisions its own tenant.
- **Self-contained specs**: each spec sets up its own data via `helpers/api.js` calls — no shared fixtures beyond the login session.
- **Unit tests**: colocated under `tests/unit/`, run by Vitest, fully mocked — no server, no network. Environment is `jsdom` (`vite.config.js`'s `test` block), setup file `tests/setup.js` imports `@testing-library/jest-dom` and `fake-indexeddb/auto`.

## Test Tenant (production)

Defined **only** in `helpers/auth.js` — every value is env-overridable, and no spec should hardcode a tenant slug (import `STORE_CODE` instead).

| Field | Default | Env override |
|-------|---------|--------------|
| Store code | `livetestauto` | `E2E_TENANT` |
| Username | `Sweep Operator` (full display name, spaces, case-sensitive) | `E2E_USERNAME` |
| Password | `SweepRun123!` | `E2E_PASSWORD` |
| PIN | `1234` | `E2E_PIN` |
| Backend | `https://api.sanopos.com` | `E2E_BACKEND` |

Verified working 2026-07-25 (Administrator role, lands straight on `/dashboard`, no context selection). The previous tenant `packagesmall` was deleted in Apr 2026 — if you see that slug anywhere in this suite again, it's a regression of the single-source-of-truth rule.

## Helper Files (`tests/helpers/`)

### `auth.js`
Exports the credentials above (`STORE_CODE`, `USERNAME`, `PASSWORD`, `PIN`, `BACKEND`) plus `loginMT(page)`: navigates to `/login`, fills store code / username / password, clicks Sign In, waits for redirect to `/dashboard`.

Locators (the most fragile part of the suite — check these first if login-dependent specs break; source of truth is `frontend/src/pages/LoginPage.jsx`): store code `getByPlaceholder(/aceshardware/i)` or `getByLabel(/store code/i)`, username `getByPlaceholder(/employee (username|name)/i)` or `getByLabel(/username/i)`, password `getByPlaceholder(/password/i)` or `getByLabel(/password/i)`, submit `getByRole("button", { name: /sign in/i })`. Each field takes `.first()` so a future duplicate match can't throw a strict-mode error mid-run.

**Why the username regex spells both wordings**: the Square reskin renamed that placeholder to "Employee **username**" while every spec still looked for "employee **name**" — 45 call sites across 8 spec files timed out silently for months, invisible because global setup only warned. Widening the regex (rather than pinning the new string) means the next rename degrades to a still-passing match instead of a mass timeout.

### `api.js`
Direct REST helper used from spec setup/body code (not routed through the browser). Reads the Bearer token from `tests/token.json` (written by global setup).

- `api(method, path, body?)` → `{ status, ok, data }`
- `get`/`post`/`put`/`del` — shorthands
- Every request sends `Authorization: Bearer <token>`, `x-outlet-id: 1`, `x-scope-mode: outlet`
- `ensurePOSReady(outletId = 1)` — call in `test.beforeAll` before any POS spec. Opens a shift (`POST /api/shifts/open`, float 1000) if none active, then clocks in via `POST /api/attendance/pin-checkin?tenant=${STORE_CODE}` with `PIN` (note: NOT `/clock-in`) if not already `clocked_in`.

### `nav.js`
- `navigateTo(page, path)` — `page.goto` + wait for `networkidle`
- `waitForPageShell(page, titleText)` — waits for a heading role match, 15s timeout
- `clickSidebarLink(page, linkText)` — clicks a nav link by visible text, then waits for `networkidle`

## Spec Categories

### Top-level E2E specs (`tests/*.spec.js`)
Cover core POS/back-office domains end to end against production, one or more `test.describe` blocks per domain: `auth` (login page, valid/invalid login, forgot-password, logout, unauth redirect, kiosk PIN pad, context-select, PIN-validation API), `products` (Products & Inventory Page, Categories, Brands, Taxes, Attribute Sets, Promotions), `customers` (Customers), `inventory` (Stock Adjustments, Stock Transfers, Stock Counts, Reorder Alerts, Price Lists, Barcode Templates, Inventory API Validation), `purchasing` (Suppliers, Purchase Orders, Supplier Payables, Returned Stock), `orders` (Orders), `order-kiosk` (Customer order kiosk), `pos-core` / `pos-advanced` (POS Core — search/cart/subtotal via `openPOS()` helper that waits on the `Search by Name` placeholder; POS Advanced Features), `employees-hr` (Employees & HR), `crm` (CRM), `reports` (Dashboard, Reports), `accounting` (Accounting), `settings` (Settings), `billing` (Billing), `fbr` (FBR Integration), `integrations` (Integrations Hub, Shopify Integration, WooCommerce Integration), `import-export` (Import & Export), `permissions` (Permissions — Admin user, Permissions — Cashier user; asserts sidebar links + page access per role), `navigation-ux` (Sidebar Navigation, UX Features), `admin-panel` (Admin Panel, Authenticated Admin Pages), `public-pages` (Public Pages), `treatment-plans` (M10 — asserts the Clinical nav group is HIDDEN on the retail `packagesmall` tenant, direct `/treatment-plans/active` nav is gated, and `chart_areas` seed data has 32 adult teeth; a real clinical-tenant E2E is explicitly out of scope here and deferred to the `onboard-dental-clinic` spec), plus `onboard-free` / `onboard-starter` / `onboard-pro` / `onboard-dental-clinic` / `onboard-physiotherapy` / `onboard-veterinary` (signup → tier/preset walkthroughs).

Most `onboard-*` and `pos-core`/`pos-advanced` specs run `test.describe.serial` with `test.use({ storageState: undefined })` and drive their own signup/login rather than reusing `auth.json`, since they need a brand-new tenant or a specific PIN/session state.

**Onboarding specs create real tenants on production.** Each provisions a brand-new tenant via the signup flow. These are not auto-cleaned — delete the created tenant from `/admin` after every run, or they accumulate as dead tenants.

### Smoke specs (`tests/smoke/*.smoke.spec.js`)
Competitive/vertical feature coverage, one file per feature area: `bookings` (booking-service → availability → appointment → cancel, both authenticated and public/anonymous-context flows), `catalog-advanced`, `commissions-reports`, `draft-orders-returns`, `insights-dashboard`, `invoicing-subscriptions`, `m2-tickets-subscriptions` (service tickets + subscription polish), `marketing-messaging`, `omnichannel-admin`, `phase5-pakistan`, `pricing-promotions`, `service-workspace`, `storefront-public`, `workforce`, and a cluster of restaurant-specific specs each tagged with its build phase: `restaurant-shell` (Phase 2-R.0), `restaurant-void-comp` (2-R.2), `restaurant-pay-at-table` (2-R.3), `restaurant-reservations` (2-R.4), `restaurant-kds-analytics` (2-R.5), `restaurant-menu-schedules` (2-R.6), `restaurant-printer-routing` (2-R.7), `restaurant-menu-engineering` (2-R.10), `restaurant-86` (2-R.1), plus a general `restaurant.smoke.spec.js`.

Shared helpers live in `tests/smoke/helpers/`:
- `smokeRunId.js` — `SMOKE_RUN_ID` (`SMOKE-<iso-timestamp>-<random>`, unique per run) + `prefix(name)` for naming created resources so parallel/repeat runs don't collide
- `featureFlags.js` — `isFlagEnabled(key)` (fetches `GET /api/feature-flags` once, caches as a Map), `skipIfFlagOff(test, specName, ...keys)` for a whole-spec skip in `beforeAll`, `softSkip(test, specName, ...keys)` for a single-test runtime skip, `__resetFlagCache()` for teardown
- `cleanup.js` — `trackForCleanup(type, id)` pushes a resource onto an in-memory bag; `cleanupAll()` pops it in reverse (children before parents) and calls the matching `DELETERS[type]` entry, swallowing individual failures (404 counts as success) and warning with the `SMOKE-` prefix for any it couldn't remove. Check the `DELETERS` map in `cleanup.js` before adding a new resource type — it currently covers core/omnichannel, price lists/draft orders, smart collections/outlet tax profiles/scheduled changes/commission plans/POS layouts/report definitions, marketing/invoicing/subscriptions, restaurant (floor plans/tables/checks/sessions/KDS stations), bookings (services/appointments), service workspace (projects/contracts/contract templates), and Phase 5 (COD settlements, integration credentials)
- `mockPaymentGateway.js` — `page.route()` stubs for external services that must never be hit for real in a test: `mockXPay` (also intercepts `**/api/storefront/orders/*/pay` so server-side gateway calls are caught even without a browser-side xPay call), `mockJazzCash`, `mockEasypaisa`, `mockCourierAPI` (regex over all 13 courier adapter names), `mockSMSProvider`. Each returns a capture-bag array of parsed request bodies; assert on `bag.at(-1)` after triggering the flow

Most smoke specs don't call `skipIfFlagOff`/`softSkip` — check each spec individually before assuming a flag-gated feature is actually being exercised (some just accept a range of status codes instead of hard-skipping).

### Sweep (`tests/sweep/`)
A single very long-running spec (`functional-sweep.spec.js`, `test.describe("Full real-user functional sweep")`, `--project=sweep`) that signs up a fresh production tenant and walks the full merchant journey — signup → onboarding → upgrade → POS → inventory → reports — over many ordered steps, ~3-4 hours, headed-only, manually triggered (no CI). Requires operator interaction twice: clicking an email verification link (real inbox) and approving a sandbox payment popup. Writes step-by-step findings to `frontend/test-results/sweep-findings.json` and a human triage list to a dated markdown file under `docs/`; failure screenshots/traces land under `frontend/test-results/sweep/<step>/`. See `tests/sweep/README.md` for the full run procedure and `SWEEP_RESUME.md` if a prior run needs resuming. Has its own `helpers/` (`findings.js`, `manager-pin.js`, `nav.js`, `pause-for-email-verify.js`) and `fixtures/` (`test-product.jpg`) — separate from the top-level `tests/helpers/`.

### Unit tests (`tests/unit/*.test.jsx` / `.test.js`)
Vitest + `@testing-library/react`, fully mocked, no server. Covers: route guards (`auth_guards`), layout primitives (`layout` — `PageShell`, `NotificationBell`), design-system primitives (`primitives`, `primitives-modal` — `Button`/`Input`/`Badge`/`Modal`/`ConfirmDialog`/`TabBar`), the dental chart component (`dental-chart`), a clinical-subjects panel used by veterinary/dental presets (`customers-clinical-subjects`), the admin support-ticket screenshot renderer (`admin-support-screenshots` — regresses a bug where `{filename, url}` screenshot objects must render via the `url` string, not the object itself), Business Modules v2 per-outlet display helpers (`business-modules-outlets` — pure functions `showOutletControls`/`locationSummaryLabel`/`isOutletOverridden`/`showChecklist`/`checklistProgress` from `pages/redesign/businessModules.js`, asserting the "single-outlet tenant sees nothing new" invariant without mounting the API-driven page), per-outlet role-override helpers (`outlet-role-overrides` — `buildOutletRolesMap`/`overridesFromAssignments` from `pages/redesign/employeeOutletRoles.js`, which must always emit a key for every assigned outlet since the `PUT /api/employees/:id/outlets` write is bulk-replace, plus `AuthProvider.applyEffectiveSession` context-switch behavior), offline queue IndexedDB store + its hook (`offline-queue`, `use-offline-queue`, `offline-decoded-snapshot`), chunk-reload-failure detection/recovery (`chunk-reload`), POS restaurant open/close-check context logic (`pos-context-open-check`), restaurant cart seat/course grouping (`restaurant-cart-grouping`), the omni-input classifier for barcode/PLU/customer-code routing (`omniInputRouter`), a scale-barcode weight parser (`scale-parse`, `embeddedBarcode`), a standalone CSV parser extracted from the customer group price-book page (`parsePriceBookCsv`), the loyalty wallet rate hook (`useLoyaltyWallet-config`), and `cartMath.js` pure functions across three files (`cartMath`, `cartMath-tax-mode` — tax-mode regression suite, `cartMath-weighted`).

Naming gotcha: `contexts.test.jsx` is misleadingly named — most of its assertions actually cover `cartMath.js`, not React context providers in general.

## Common Gotchas

- Clock-in endpoint is `POST /api/attendance/pin-checkin?tenant=<slug>`, never `/clock-in`.
- A run that reaches the specs at all now has a real session — global setup throws otherwise, so "green" is meaningful again. If setup aborts, read its message: it names the tenant, the employee, the underlying cause, and the env-var override to point elsewhere.
- Never hardcode a tenant slug, employee name, or PIN in a spec — import from `helpers/auth.js`. That single-source rule is what makes retargeting a one-env-var change instead of a 15-file sweep, and it's why the dead-tenant rot went unnoticed for three months.
- `fullyParallel: false` / `workers: 1` in the config is deliberate — these tests mutate shared production state; don't override to parallel without understanding the collision risk.
- The `sweep` project is excluded from default runs (`testIgnore: /sweep\//` on `chromium`) — you must pass `--project=sweep` explicitly, and it ignores `storageState`/`auth.json` entirely.
- Onboarding specs and the sweep spec both create real production tenants that need manual deletion from `/admin`.
- `helpers/api.js`'s token comes from `tests/token.json`, which only gets written if `global-setup.js`'s login succeeds — if that tenant is unreachable, anything depending on `ensurePOSReady` or direct API helper calls will fail even though the browser-based parts of a spec might still partially run.
- Smoke `cleanupAll()` is best-effort: a delete that 404s is treated as success, but any other failure is only logged (with the `SMOKE-` prefix to help find orphaned resources later), not retried or surfaced as a test failure.
