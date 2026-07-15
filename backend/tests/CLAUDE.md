# Tests — Claude Guide

Test runner is **Vitest** for both integration and unit tests, with one lone exception: `tests/integration/reports_accuracy.test.js` uses Jest-style syntax but still runs fine under Vitest (there is no separate Jest script). Integration tests require a live Postgres connection; unit tests need neither a database nor network access.

```bash
# Integration — one file
npx vitest run backend/tests/integration/pg-batch1-crud.test.js

# Integration — a whole naming-pattern group
npx vitest run backend/tests/integration/pg-batch*.test.js

# Unit tests — all
npx vitest run backend/tests/unit/
```

Run integration tests from the `backend/` directory — running Vitest from the repo root fails with a "describe is not defined" error, since the test config lives under `backend/`.

---

## Integration Tests (`tests/integration/`)

Each file spins up an isolated Postgres schema via the shared test-app factory, mounts the routes under test, and exercises the real HTTP layer with supertest against a live database. Grouped below by naming pattern rather than listed file-by-file — there are over 200 files.

### Core commerce
Sales, returns/exchanges, refund caps, decimal-quantity sales, sale-get-with-refunds, promotions, purchase orders + credit limits, supplier payables/returns, GRN, inventory adjustments/transfers, COD settlements: `sales.test.js`, `sales-decimal-quantity.test.js`, `sales-get-with-refunds.test.js`, `returns.test.js`, `returns-exchange.test.js`, `returns-double-refund-cap.test.js`, `promotions.test.js`, `purchase-orders.test.js`, `po-credit-limit.test.js`, `supplier-payables.test.js`, `inventory.test.js`, `crud_inventory.test.js`, `cod-settlements.test.js`.

### Auth, RBAC, and security
`auth.test.js`, `auth-jwt.test.js`, `rbac.test.js`, `security.test.js`, `context-enforcement.test.js`, `auditability.test.js`, `pg-tenant-isolation.test.js`, `pg-mode-gates.test.js`, `pg-roles-permissions.test.js`, `pg-step2-delegation-field-split.test.js`, `pg-step4-report-split.test.js`, `pg-step9-outlet-gating.test.js`, `pg-step12-outlet-copy-drift.test.js`, `pg-step12-outlet-copy-settings.test.js`, `pg-step13-outlet-roles.test.js`.

### Shifts, attendance, HR
`shifts.test.js`, `shift-linkage.test.js`, `shift-report-attribution.test.js`, `pg-shifts-validation.test.js`, `attendance.test.js`, `pg-attendance-validation.test.js`, `hr_approvals.test.js`, `crud_employees.test.js`.

### Reports
`reports_accuracy.test.js` (the Jest-syntax exception), `reports_governance.test.js`, `pg-kds-analytics.test.js`, `pg-menu-engineering.test.js`, `p22-report-tz-buckets.test.js`, plus the broad `pg-batch4-reports.test.js`.

### CRUD / settings / generic
`crud_operations.test.js`, `crud_settings.test.js`, `customers.test.js`, `pg-brands.test.js`.

### Data integrity, concurrency, negative cases
`data-integrity.test.js`, `failure-handling.test.js`, `negative-cases.test.js`, `concurrency.test.js`.

### Compliance / tax-authority / SaaS lifecycle
`compliance.test.js`, `saas-phase1.test.js`, `pg-preset-engine.test.js`, `pg-migration-v82-products-sku-unique.test.js`.

### Infra / health / connection
`health.test.js`, `pg-connection.test.js`, `pg-schema.test.js`, `pg-tenant-db.test.js`, `pg-test-app.test.js`, `pg-master-db.test.js`.

### Email / printer
`email.test.js`, `printer.test.js`, `pg-printer-open-drawer.test.js`.

### Broad end-to-end batches (`pg-batch*`)
Each file exercises a horizontal slice across many routes in one pass — core CRUD, medium-complexity flows, complex multi-step flows, reports, accounting/CRM/HR, Shopify, order-service, middleware, audit-fix regressions, admin, billing, catalog scheduler, restaurant, bookings, couriers. Numbered sequentially rather than by topic — check the file's own describe blocks for what it actually covers rather than inferring purely from the filename.

### Targeted horizontal slices (`pg-batch-*`)
Smaller batches targeting a specific cross-cutting concern: storefront contracts, POS hardening, transaction atomicity, storefront tax, the tax-snapshot extraction, holds, commissions, barcode lookup, quick grid entry, competitor-import mapping, error-state handling, the retail home dashboard, risk controls.

### Gift cards, loyalty, price books, serialized inventory
`phase2g-wave1-ledger.test.js`, `phase2g-wave2-gift-cards.test.js`, `phase2g-wave2-gift-cards-sales.test.js`, `phase2g-wave2-loyalty.test.js`, `phase2g-wave2-price-books.test.js`, `phase2g-wave2-price-books-routes.test.js`, `phase2g-wave2-schema.test.js`, `phase2g-wave3-price-override.test.js`, `phase2g-wave3-restock-toggle.test.js`, `phase2g-wave3-serialized-inventory.test.js`, `phase2g-wave3-variant-matrix.test.js`, `phase2g-wave3-variant-transfers-adjustments.test.js`.

### Restaurant
`pg-batch13-restaurant.test.js`, `pg-restaurant-86.test.js`, `pg-restaurant-kiosk.test.js`, `pg-restaurant-pay-at-table.test.js`, `pg-restaurant-printer-routing.test.js`, `pg-restaurant-reservations.test.js`, `pg-restaurant-void-comp.test.js`, `pg-phase21a-courses.test.js`, `pg-phase21a-modifiers.test.js`, `pg-phase21a-split.test.js`, `pg-phase21b-kds-routing.test.js`, `pg-phase21b-online-inbox.test.js`, `pg-phase21c-tips.test.js`, `pg-menu-schedules.test.js`, `pg-sale-seat-persistence.test.js`.

### Bookings / rentals / rooms / treatment plans / portal
`pg-rental-contracts.test.js`, `pg-rental-deposit-sandbox.test.js`, `pg-room-bookings.test.js`, `pg-room-deposit-sandbox.test.js`, `pg-treatment-plans.test.js`, `pg-treatment-plan-deposit.test.js`, `pg-customer-portal.test.js`, `pg-portal-appointments.test.js`, `public-bookings.test.js`.

### Payments / sandbox / billing observability
`pg-sandbox-payment.test.js`, `pg-admin-payment-observability.test.js`, `pg-p35-loyalty-tiers-flag-gate.test.js`, `pg-sales-payment-validation.test.js`, `pg-wholesale-credit-limit.test.js`.

### Point-fix regression tests (`pg-pNN-*`)
Small, targeted regression tests for a specific past production bug, one concern per file: report timezone bucketing, the R2 image pipeline, storefront snake-case field shape, the support-reply notification, rate-limit trust-proxy handling, webhook rate limiting, SVG-upload rejection on the support endpoint, backup-log insert shapes.

### Inventory intelligence / offline sync
`pg-phase2g8-abc.test.js`, `pg-phase2g8-cycle-counts.test.js`, `pg-phase2g8-hub.test.js`, `pg-phase2g8-reorder.test.js`, `pg-offline-sale-sync.test.js`, `pg-import-preview-shape.test.js`.

### Admin panel (`pg-admin-*`)
Super-admin routes coverage, one concern per file: two-factor auth, feature-adoption snapshot, announcement audience targeting, audit coverage, billing lifecycle, dead-letter queue coverage, flag-parity checks, impersonation session listing, lifecycle-event recording, login-alert behavior, module locks, payment observability, session management, vertical-usage counts, worker-status reporting.

### Foundational feature groups (kit/BOM, packages, forms, notifications, scheduling, batch/expiry)
`pg-f01-kit-bom.test.js`, `pg-f02-dunning.test.js`, `pg-f02-packages.test.js`, `pg-f02-packages-sales.test.js`, `pg-f02-portal-packages.test.js`, `pg-f05-notifications.test.js`, `pg-f06-scheduling.test.js`, `pg-f07-batch.test.js`, `pg-forms.test.js`.

### Vertical depth (one file per industry vertical, several with a companion second-pass file)
`pg-v01-grocery-lane.test.js`, `pg-v02-backorders.test.js`, `pg-v02-van-pod.test.js`, `pg-v03-food-depth.test.js`, `pg-v04-salon.test.js`, `pg-v05-clinical.test.js`, `pg-v06-device-intake.test.js`, `pg-v06-estimate.test.js`, `pg-v06-parts-invoice.test.js`, `pg-v06-ticket-spine-baseline.test.js`, `pg-v06-warranty.test.js`, `pg-v07-gym.test.js`, `pg-v08-photography.test.js`, `pg-v09-rental-availability.test.js`, `pg-v09-rentals-depth.test.js`, `pg-v10-lodging-depth.test.js`, `pg-v10-lodging-race.test.js`.

### Money/stock-writer hardening and cross-domain audits
`pg-ws1a-stock-helper.test.js`, `pg-ws1b-sales-money.test.js`, `pg-ws1c-returns-money.test.js`, `pg-ws1d-adjacent-writers.test.js` (the shared `stock-ledger.js`/`tax-snapshot.js` extraction — see `services/CLAUDE.md`), `pg-completion00-reports-gating.test.js`, `pg-completion04-void-ar-reversal.test.js`, `pg-w0a-audit-security.test.js`, `pg-ai-routes.test.js`, `feature-flags.test.js`, `pricing-unification.test.js`.

### Misc
`pg-public-receipts.test.js` (public receipt page), `pg-connection.test.js`, `pg-schema.test.js`, `smoke-gate.test.js` — **legacy, has pre-existing failures. Do NOT run or investigate unless explicitly asked.**

---

## Unit Tests (`tests/unit/`)

See `tests/unit/CLAUDE.md` for the full breakdown. Summary: Vitest, no DB or network access — pure functions and hand-built fake dependencies only. Most files use ESM imports; a handful use CommonJS `require()` (directly, or via `createRequire()`) because the module under test is itself CJS.

**Core gotcha**: `vi.mock()` is unreliable for intercepting a CJS `require()` call made inside a function body or closure (as opposed to a top-level import) — several backend modules do exactly that. Three patterns cover it:
- **Pattern A (default, most common)** — call the real exported function with a hand-built fake `db`/`boss`/`pool`/`client` built from `vi.fn()`, either returning canned rows keyed off the SQL shape or just recording every call for assertion. Exercises real logic instead of a stubbed shell.
- **Pattern B** — evict the module from `require.cache` and re-`require()` it fresh before each test case, for modules holding genuinely unavoidable module-level mutable state (an in-memory cache, a sliding-window counter) and/or doing their own inline `require()` that needs a differently-shaped fake substituted in.
- **Pattern C** — `vi.mock()` + `vi.hoisted()`, reserved for dependencies imported at module top-level, never for inline `require()`.

Default to Pattern A for new tests; only reach for cache eviction when a fresh fake genuinely can't reset the module's own state.

**Drift-guard tests** are a distinct, architecturally important category — not behavioral unit tests but source-scanning or cross-reference checks that fail when something elsewhere in the codebase falls out of sync: the business-modules catalog must classify every feature flag exactly once; every flag must have a real runtime consumer or a justified exemption; every backend endpoint must be reachable from some frontend caller (baseline-diffed, so the class can shrink but never silently regrow); every permission string used in a route guard must be registered in the permissions catalog; the production Dockerfile must install a Postgres client binary in the final image stage; and a repo-wide regex scan bans the common timezone-boundary bug patterns (UTC-only "today," a bare date cast on a business timestamp column, bare `CURRENT_DATE` in SQL) with a per-line allowlist requiring a justification comment for each exception.

Full per-area breakdown (middleware, core services, timezone helpers, booking/notification services, subscriptions, workers, routes, tenant-auth, industry presets, vertical domain services, pricing/inventory/promotions, barcode decoding, AI, tips, printer, schemas, ICS calendar, import mappers, feature-flag seeding) lives in `tests/unit/CLAUDE.md` — read that before adding a new unit test so you match the existing pattern for the area you're touching.

---

## Key Helpers (`tests/helpers/`)

### `createTestApp-pg.js`
Exports: `createTestApp(options?)`, `DEFAULT_FEATURE_FLAGS`, `PERMISSION_RULES`

Creates an isolated Express app with a fresh Postgres schema (a randomly-named `test_<hex>` schema), runs the full DDL against it, seeds fixtures, and returns `{ app, db, deps, runtimeState, cleanup, schemaName }`.

- `app` — routes are NOT pre-registered; each test explicitly mounts the route module it's exercising against `deps`.
- `db` — a scoped proxy with `search_path` fixed to the test schema.
- `cleanup()` — drops the schema and releases the pool client; call in `afterAll`.
- `options.seed = false` — skip fixture seeding, leaving a DDL-only schema.

**Seeded fixtures**: one company, two outlets, three roles (Administrator/Manager/Cashier) with their default permissions, three employees (one per role, each with a fixed test PIN), five products, outlet stock rows, and one customer with loyalty points and a wallet balance.

**Stubbed deps** (always no-op in tests): plan-limit enforcement, active-subscription enforcement, company-profile loading (returns a fixed UTC timezone), context resolution, context-outlet backfill, rate limiters, Shopify client stubs.

**Test-client gotcha**: `db.getClient()`'s returned client has a no-op `release()` — this prevents a route under test from releasing the dedicated schema-scoped client back to the shared pool.

### `request.js`
Exports: `makeRequest(app, employeeId?)`, plus fixed id constants for the admin/manager/cashier seeded employees. A supertest wrapper that auto-attaches the employee-id header on every call via a Proxy.

### `seedSchema-pg.js`
Exports: `seedSchema(client)` — reads the DDL source file at module load and runs it in full against the given client.

### `globalTeardown.js`
Global teardown — drops orphaned test schemas left behind by a crashed or timed-out run.

### `vitest-setup.js`
Loads environment variables before any test module imports, so a database connection string is available at import time. Prefers a local `.env.test` (local Postgres) over the regular `.env` (Supabase) when present — keeps integration tests off the production-adjacent database and dramatically faster.

---

## Local vs. Supabase Test Database

`tests/helpers/vitest-setup.js` prefers `backend/.env.test` (a local Postgres instance) when present, falling back to `backend/.env` (Supabase) otherwise. Both files are gitignored. Running the full integration suite against Supabase works but is far slower and consumes connection-pool headroom shared with anything else touching the same database — set up a local Postgres and a `.env.test` pointing at it for day-to-day test runs.

---

## Key Gotchas

- **`smoke-gate.test.js`** has pre-existing failures — do not run or investigate unless explicitly asked.
- **A live database connection is required** for all integration tests; unit tests need neither a database nor network access.
- **Env-var deletion inside `beforeAll`** is only safe *after* `createTestApp()` has already run — deleting a var at module scope or before the app factory runs can break a module-level env read elsewhere.
- **`require.cache` eviction pattern**: several unit test files (covering plan-limits, feature-flags, alerting, tenant-auth) evict and re-require the module under test between cases, specifically because those modules hold module-level mutable state (connection caches, sliding windows) that would otherwise leak across test cases.
- **`vi.mock()` vs. CJS**: unreliable for a CommonJS `require()` fired inside a closure — use the cache-eviction pattern instead for those modules.
- **Schema isolation**: each `createTestApp()` call creates a fresh randomly-named schema; `cleanup()` drops it. No shared state between test files.
- **Upload directories in tests**: test uploads go to dedicated test upload directories, never the real uploads directory used by the running app.
