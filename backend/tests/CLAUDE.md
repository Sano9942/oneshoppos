# Tests — Claude Guide

Test runner is **Vitest** for both integration and unit tests, with one lone exception: `tests/integration/reports_accuracy.test.js` uses Jest syntax (still invoked via `npx vitest`, not a separate Jest runner — there is no active Jest script in `backend/package.json`). Integration tests require `DATABASE_URL`; unit tests need neither DB nor network.

```bash
# Integration — one file
npx vitest run backend/tests/integration/pg-batch1-crud.test.js

# Integration — all pg-batch files
npx vitest run backend/tests/integration/pg-batch*.test.js

# Unit tests — all
npx vitest run backend/tests/unit/
```

---

## Integration Tests (`tests/integration/`)

Each file spins up (via `createTestApp-pg.js`) an isolated Postgres schema, mounts the routes under test, and exercises the real HTTP layer with supertest. Grouped below by domain rather than listed file-by-file.

### Core commerce
Sales, returns/exchanges, refund caps, decimal-quantity sales, sale-get-with-refunds, promotions, purchase orders + credit limits, supplier payables/returns, GRN, inventory adjustments/transfers: `sales.test.js`, `sales-decimal-quantity.test.js`, `sales-get-with-refunds.test.js`, `returns.test.js`, `returns-exchange.test.js`, `returns-double-refund-cap.test.js`, `promotions.test.js`, `purchase-orders.test.js`, `po-credit-limit.test.js`, `supplier-payables.test.js`, `supplier-returns.js` (via crud tests), `inventory.test.js`, `crud_inventory.test.js`, `cod-settlements.test.js`.

### Auth, RBAC, and security
`auth.test.js`, `auth-jwt.test.js`, `rbac.test.js`, `security.test.js`, `context-enforcement.test.js`, `auditability.test.js`, `pg-tenant-isolation.test.js`, `pg-mode-gates.test.js`.

### Shifts, attendance, HR
`shifts.test.js`, `shift-linkage.test.js`, `shift-report-attribution.test.js`, `pg-shifts-validation.test.js`, `attendance.test.js`, `pg-attendance-validation.test.js`, `hr_approvals.test.js`, `crud_employees.test.js`.

### Reports
`reports_accuracy.test.js` (Jest syntax, only exception), `reports_governance.test.js`, plus every `pg-batch4-reports.test.js` and the restaurant-analytics reports below.

### CRUD / settings / generic
`crud_operations.test.js`, `crud_settings.test.js`, `customers.test.js`, `pg-brands.test.js`.

### Data integrity, concurrency, negative cases
`data-integrity.test.js`, `failure-handling.test.js`, `negative-cases.test.js`, `concurrency.test.js`.

### Compliance / FBR / SaaS lifecycle
`compliance.test.js`, `saas-phase1.test.js`, `pg-preset-engine.test.js`.

### Infra / health / connection
`health.test.js`, `pg-connection.test.js`, `pg-schema.test.js`, `pg-tenant-db.test.js`, `pg-test-app.test.js`, `pg-master-db.test.js`.

### Email / printer
`email.test.js`, `printer.test.js`, `pg-printer-open-drawer.test.js`.

### pg-batch* (broad end-to-end batches)
Each exercises a horizontal slice across many routes in one file: `pg-batch1-crud`, `pg-batch2-medium`, `pg-batch3-complex`, `pg-batch4-reports`, `pg-batch5-tier4` (accounting/CRM/HR), `pg-batch6-shopify`, `pg-batch7-order-service`, `pg-batch8-middleware`, `pg-batch9-audit-fixes`, `pg-batch10-wave2`, `pg-batch11-admin`, `pg-batch12-billing`, `pg-batch13-catalog-scheduler`, `pg-batch13-restaurant`, `pg-batch14-bookings`, `pg-batch15-couriers`.

### pg-batch-phaseN* / pg-batch-2gN* (targeted phase/wave slices)
`pg-batch-phase1-storefront-contracts`, `pg-batch-phase2-pos-hardening`, `pg-batch-phase3c-atomicity`, `pg-batch-phase4-storefront-tax`, `pg-batch-tax-snapshot`, `pg-batch-2g9-holds`, `pg-batch-2g10-commissions`, `pg-batch-2g11-barcode-lookup`, `pg-batch-2g13-quick-grid`, `pg-batch-2g14-competitor-import`, `pg-batch-2g15-error-states`, `pg-batch-2g16-retail-home`, `pg-batch-2g17-risk-controls`.

### phase2g-wave* (ledger, gift cards, loyalty, price books)
`phase2g-wave1-ledger`, `phase2g-wave2-gift-cards`, `phase2g-wave2-gift-cards-sales`, `phase2g-wave2-loyalty`, `phase2g-wave2-price-books`, `phase2g-wave2-price-books-routes`, `phase2g-wave2-schema`, `phase2g-wave3-price-override`, `phase2g-wave3-restock-toggle`, `phase2g-wave3-serialized-inventory`, `phase2g-wave3-variant-matrix`, `phase2g-wave3-variant-transfers-adjustments`.

### Restaurant
`pg-batch13-restaurant`, `pg-restaurant-86`, `pg-restaurant-kiosk`, `pg-restaurant-pay-at-table`, `pg-restaurant-printer-routing`, `pg-restaurant-reservations`, `pg-restaurant-void-comp`, `pg-phase21a-courses`, `pg-phase21a-modifiers`, `pg-phase21a-split`, `pg-phase21b-kds-routing`, `pg-phase21b-online-inbox`, `pg-phase21c-tips`, `pg-kds-analytics`, `pg-menu-engineering`, `pg-menu-schedules`, `pg-sale-seat-persistence`.

### Bookings / rentals / rooms / treatment plans / portal
`pg-preset-engine`, `pg-rental-contracts`, `pg-rental-deposit-sandbox`, `pg-room-bookings`, `pg-room-deposit-sandbox`, `pg-treatment-plans`, `pg-treatment-plan-deposit`, `pg-customer-portal`, `pg-portal-appointments`, `public-bookings.test.js`.

### Payments / sandbox / billing observability
`pg-sandbox-payment`, `pg-admin-payment-observability`, `pg-p35-loyalty-tiers-flag-gate`, `pg-sales-payment-validation`, `pg-wholesale-credit-limit`.

### Point fixes / regression tests (`pg-pNN-*`)
Small, targeted regression tests for specific production bugs: `pg-p22-report-tz-buckets` (renamed `p22-report-tz-buckets.test.js`), `p23-r2-image-pipeline`, `p24-storefront-snake-case`, `pg-p27-support-reply-notification`, `pg-p29-rate-limit-trust-proxy`, `pg-p30-webhook-rate-limit`, `pg-p31-support-svg-rejection`, `pg-p33-backup-log-insert-shapes`.

### Inventory intelligence / offline sync
`pg-phase2g8-abc`, `pg-phase2g8-cycle-counts`, `pg-phase2g8-hub`, `pg-phase2g8-reorder`, `pg-offline-sale-sync`, `pg-import-preview-shape`, `pg-migration-v82-products-sku-unique`.

### Admin panel (`pg-admin-*`)
Super-admin routes coverage, one concern per file: `pg-admin-2fa`, `pg-admin-adoption`, `pg-admin-announcement-targeting`, `pg-admin-audit-coverage`, `pg-admin-billing-lifecycle`, `pg-admin-dead-letters-coverage`, `pg-admin-flag-parity`, `pg-admin-impersonation-list`, `pg-admin-lifecycle-events`, `pg-admin-login-alert`, `pg-admin-payment-observability`, `pg-admin-session`, `pg-admin-vertical-usage`, `pg-admin-worker-status`.

### F0x foundations (kit/BOM, packages, forms, notifications, scheduling, batch/expiry)
`pg-f01-kit-bom`, `pg-f02-dunning`, `pg-f02-packages`, `pg-f02-packages-sales`, `pg-f02-portal-packages`, `pg-f05-notifications`, `pg-f06-scheduling`, `pg-f07-batch`, `pg-forms`.

### Vertical-depth (V01–V10, one file per vertical, several with a companion `-depth`/second-pass file)
`pg-v01-grocery-lane`, `pg-v02-backorders`, `pg-v02-van-pod`, `pg-v03-food-depth`, `pg-v04-salon`, `pg-v05-clinical`, `pg-v06-device-intake`, `pg-v06-estimate`, `pg-v06-parts-invoice`, `pg-v06-ticket-spine-baseline`, `pg-v06-warranty`, `pg-v07-gym`, `pg-v08-photography`, `pg-v09-rental-availability`, `pg-v09-rentals-depth`, `pg-v10-lodging-depth`, `pg-v10-lodging-race`.

### Money/stock-writer hardening (`pg-ws1*`) and full-audit domain tests
`pg-ws1a-stock-helper`, `pg-ws1b-sales-money`, `pg-ws1c-returns-money`, `pg-ws1d-adjacent-writers` (the shared `stock-ledger.js`/`tax-snapshot.js` extraction work — see `services/CLAUDE.md`), `pg-completion00-reports-gating`, `pg-completion04-void-ar-reversal`, `pg-wholesale-credit-limit`, `pg-ai-routes`, `feature-flags.test.js`, `pricing-unification.test.js`.

### Misc
`pg-public-receipts` (public receipt page), `pg-connection`, `pg-schema`, `smoke-gate.test.js` — **legacy, has pre-existing failures. Do NOT run or investigate unless explicitly asked.**

---

## Unit Tests (`tests/unit/`)

Vitest, no DB or network access — pure functions and fake injected dependencies only. Most files use ESM imports; a handful use CommonJS `require()` (directly or via `createRequire()`) because the module under test is itself CJS: `dockerfile-pg-dump.test.js`, `inventory-intelligence.test.js`, `pricing-service.test.js`, `tenant-auth-employee-email.test.js`, `services-catalog-scheduler.test.js`. No file here uses Jest.

**Core gotcha**: `vi.mock()` is unreliable for intercepting CJS `require()` calls made inside closures (as opposed to top-level imports). Two workarounds are used depending on the module:
- **Pattern A (default, most common)** — call the real exported function with a hand-built fake `db`/`boss`/`pool` (typically `vi.fn()` returning canned rows or recording the SQL it was called with). Used throughout services/worker tests.
- **Pattern B** — evict the module from `require.cache` and re-`require()` it fresh before each case, for modules with genuinely unavoidable module-level mutable state (an in-memory cache, sliding-window counter). Used in `middleware.test.js` and `services.test.js`.
- **Pattern C** — `vi.mock()` + `vi.hoisted()`, only for dependencies imported at module top-level (not inline `require()`). Used sparingly in `workers-email-worker-boss.test.js` for peripheral deps.

Default to Pattern A for new tests. Only reach for `require.cache` eviction if a fresh fake dependency genuinely can't reset the module's state on its own.

### What's under test (by area)
- **Middleware** — `validate.js`, `permissions.js`, `plan-limits.js`, `feature-flags.js`/`requireMode`, `upload-validation.js` (MIME/extension/magic-byte checks), `tenant-auth.js` (JWT error handling, employee email hydration).
- **Core services** — `alerting.js`, `payment-gateway.js` (xPay adapter), `fbr.js` (payload builders, retry backoff), `email.js` (sender routing, validation).
- **Email/templates** — `email-templates.js` registry, `receiptEmail.js`, `digestEmail.js`.
- **Timezone** — `utils/tz.js`: local-to-UTC boundary conversion, DST edge cases across multiple IANA zones, name validation.
- **Bookings/restaurant/rentals/rooms/treatment plans** — reminder processing, catalog scheduler field allowlist, tenant job context (`assertSafeSlug`, `withTenantContext`), late-fee/contract-number math, room rate resolution, treatment plan status transitions, folio recalculation.
- **Pricing/inventory** — price book overrides, auto-discount stacking, ABC classification, GMROI, lead-time/reorder logic.
- **Import mappers** — Shopify/Square field mapping for products and customers.
- **Tips** — regression test guarding a real production bug (capitalized tip method strings breaking a lowercase-only DB constraint).
- **Printer** — retry backoff, drawer-open failure modes.
- **Schemas** — Zod validation/coercion for shifts and sale payments.
- **Feature flag seeding** — exact retail/multi-outlet seed flag sets, idempotent upsert behavior.
- **Regression guards** — Dockerfile must install `postgresql-client` (pg_dump availability), `loadTenantAndPerms` must attach employee email.

---

## Key Helpers (`tests/helpers/`)

### `createTestApp-pg.js`
Exports: `createTestApp(options?)`, `DEFAULT_FEATURE_FLAGS`, `PERMISSION_RULES`

Creates an isolated Express app with a fresh Postgres schema (`test_<hex>`), runs full DDL, seeds fixtures, returns `{ app, db, deps, runtimeState, cleanup, schemaName }`.

- `app` — routes NOT pre-registered; each test calls `require('../../routes/X')(app, deps)` explicitly
- `db` — scoped proxy with `search_path` fixed to the test schema
- `cleanup()` — drops schema + releases pool client; call in `afterAll`
- `options.seed = false` — skip fixture seeding (DDL-only schema)

**Seeded fixtures**: company (id=1), outlets (id=1,2), 3 roles (Admin/Manager/Cashier) with permissions, 3 employees (id=1 Admin PIN 2580, id=2 Manager PIN 2222, id=3 Cashier PIN 3333), 5 products, outlet stock, 1 customer (100 loyalty pts, 500 balance).

**Stubbed deps** (always no-op): `requirePlanLimit`, `requireActiveSubscription`, `loadCompanyProfile` (sets `req.company = { timezone: "UTC" }`), `resolveContext`, `requireContextOutlet`, rate limiters, Shopify stubs.

**`db.getClient()` gotcha**: `release()` is a no-op on the test client — prevents routes from releasing the dedicated schema-scoped client back to the pool.

### `request.js`
Exports: `makeRequest(app, employeeId?)`, `ADMIN_ID` (1), `MANAGER_ID` (2), `CASHIER_ID` (3). Supertest wrapper that auto-sets `x-employee-id` on every call via Proxy.

### `seedSchema-pg.js`
Exports: `seedSchema(client)` — reads `backend/schema-pg.sql` at module load and runs full DDL.

### `globalTeardown.js`
Global teardown — drops orphaned `test_*` schemas left by crashes/timeouts.

### `vitest-setup.js`
Loads `backend/.env` before any test imports so `DATABASE_URL` is available. Prefers `backend/.env.test` (local Postgres) when present — keeps integration tests off production Supabase and dramatically faster.

---

## Key Gotchas

- **`smoke-gate.test.js`** has pre-existing failures on main — do not run or investigate unless explicitly asked
- **`DATABASE_URL`** is required for all integration tests; unit tests don't need it
- **Local vs. production DB**: `.env.test` (local Postgres) is preferred over `.env` (Supabase) — see `backend/CLAUDE.md` for the full local-vs-prod rule
- **"Decision II trap"**: deleting env vars inside `beforeAll` is safe only *after* `createTestApp()` has run. Deleting at module scope or before `createTestApp()` breaks module-level env reads
- **`require.cache` eviction pattern**: some unit tests (plan-limits, feature-flags, alerting, tenant-auth) evict and re-require modules between test cases because those modules hold module-level mutable state (connection caches, sliding windows, etc.)
- **`vi.mock()` vs CJS**: unreliable for CommonJS `require()` inside closures — use `require.cache` eviction + re-require instead
- **`reports_accuracy.test.js`** uses CommonJS plus global `describe`/`it` (Jest-flavored) which Vitest can also run — invoke with `npx vitest`, not a separate Jest command
- **Schema isolation**: each `createTestApp()` call creates a new `test_<hex>` schema; `cleanup()` drops it. No shared state between files
- **Upload dirs in tests**: `backend/uploads_test/products/` and `backend/uploads_test/company/` — NOT `backend/uploads/`
