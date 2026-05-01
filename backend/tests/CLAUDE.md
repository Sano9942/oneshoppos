# Tests — Claude Guide

Test runner is **Vitest** (not Jest) for both integration and unit tests. Integration tests require `DATABASE_URL`. Run from repo root.

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

### Legacy domain tests (non-pg-prefixed)

Cover business logic against a real DB with domain-specific focus:

| File(s) | Domain |
|---------|--------|
| `auth.test.js`, `auth-jwt.test.js` | Authentication + JWT lifecycle |
| `sales.test.js`, `returns.test.js`, `returns-exchange.test.js` | Sales, returns, exchanges |
| `rbac.test.js`, `security.test.js` | Permission enforcement, attack surface |
| `shifts.test.js`, `shift-linkage.test.js`, `shift-report-attribution.test.js` | Shift management + report attribution |
| `attendance.test.js` | Employee clock-in/out |
| `customers.test.js` | Customer CRUD + loyalty |
| `inventory.test.js`, `crud_inventory.test.js` | Stock adjustments + transfers |
| `purchase-orders.test.js`, `po-credit-limit.test.js` | PO workflow + credit cap |
| `promotions.test.js` | Discount + promotion logic |
| `reports_accuracy.test.js`, `reports_governance.test.js` | Report correctness + scheduled governance |
| `crud_operations.test.js`, `crud_settings.test.js`, `crud_employees.test.js` | Generic CRUD + settings + employee ops |
| `hr_approvals.test.js` | HR approval workflow |
| `email.test.js` | Email queue + delivery |
| `printer.test.js` | Thermal printer + open-drawer |
| `auditability.test.js`, `context-enforcement.test.js` | Audit trail + outlet context |
| `data-integrity.test.js`, `failure-handling.test.js`, `negative-cases.test.js` | Edge cases, DB integrity, failure modes |
| `concurrency.test.js` | Race conditions + stock locking |
| `compliance.test.js` | FBR compliance flows |
| `saas-phase1.test.js` | SaaS multi-tenant + subscription lifecycle |
| `supplier-payables.test.js` | GRN + supplier payable workflow |
| `health.test.js` | Health check endpoints |
| `cod-settlements.test.js` | COD reconciliation |
| `sales-decimal-quantity.test.js` | Decimal/weighted quantity sales |
| `public-bookings.test.js` | Public booking endpoint |
| `smoke-gate.test.js` | **Legacy smoke test — has pre-existing failures. Do NOT run or investigate unless explicitly asked.** |

### pg-batch* tests (core Postgres batches)

Each file exercises a focused slice of the API end-to-end against an isolated tenant schema. CommonJS, route-on-demand pattern (`require('../../routes/X')(app, deps)`):

| File | Focus |
|------|-------|
| `pg-batch1-crud.test.js` | Basic CRUD across core resources |
| `pg-batch2-medium.test.js` | Mid-complexity flows (sales, returns, POs) |
| `pg-batch3-complex.test.js` | Complex multi-step operations |
| `pg-batch4-reports.test.js` | Report endpoints |
| `pg-batch5-tier4.test.js` | Tier4 features (accounting, CRM, HR) |
| `pg-batch6-shopify.test.js` | Shopify integration routes |
| `pg-batch7-order-service.test.js` | Order + transaction service |
| `pg-batch8-middleware.test.js` | Middleware chain behavior |
| `pg-batch9-audit-fixes.test.js` | Audit + review fix regression tests |
| `pg-batch10-wave2.test.js` | Wave-2 feature routes (commissions, price books, etc.) |
| `pg-batch12-billing.test.js` | Subscription billing routes |
| `pg-batch13-catalog-scheduler.test.js` | Scheduled catalog changes |
| `pg-batch13-restaurant.test.js` | Restaurant core routes |
| `pg-batch14-bookings.test.js` | Appointment bookings |
| `pg-batch15-couriers.test.js` | Courier dispatch + tracking |

### pg-* standalone tests (feature-specific)

Each file is a focused, self-contained test for a specific subsystem:

| File | What it tests |
|------|--------------|
| `pg-brands.test.js` | Brand CRUD |
| `pg-connection.test.js` | DB connection pool behavior |
| `pg-schema.test.js` | Schema DDL integrity |
| `pg-tenant-db.test.js` | Tenant DB proxy |
| `pg-test-app.test.js` | `createTestApp` helper itself |
| `pg-tenant-isolation.test.js` | Cross-tenant data isolation |
| `pg-preset-engine.test.js` | Industry preset seeding |
| `pg-mode-gates.test.js` | `requireMode` middleware |
| `pg-offline-sale-sync.test.js` | Offline sale queue sync |
| `pg-shifts-validation.test.js` | Shift open/close validation |
| `pg-attendance-validation.test.js` | Attendance session validation |
| `pg-sales-payment-validation.test.js` | Payment line validation on sales |
| `pg-admin-payment-observability.test.js` | Admin payment records + visibility |
| `pg-sandbox-payment.test.js` | Sandbox payment gateway flow |
| `pg-printer-open-drawer.test.js` | Cash drawer open via API |
| `pg-rental-contracts.test.js` | Rental contract CRUD + overdue |
| `pg-rental-deposit-sandbox.test.js` | Rental deposit via sandbox gateway |
| `pg-customer-portal.test.js` | Customer portal auth + data |
| `pg-portal-appointments.test.js` | Portal-side appointment booking |
| `pg-room-bookings.test.js` | Room booking + folio |
| `pg-room-deposit-sandbox.test.js` | Room deposit via sandbox gateway |
| `pg-treatment-plans.test.js` | Treatment plan CRUD + workflow |
| `pg-treatment-plan-deposit.test.js` | Treatment plan deposit flow |

### Restaurant-specific tests

| File | What it tests |
|------|--------------|
| `pg-phase21a-courses.test.js` | Course-based ordering |
| `pg-phase21a-modifiers.test.js` | Item modifiers |
| `pg-phase21a-split.test.js` | Bill splitting |
| `pg-phase21b-kds-routing.test.js` | KDS station routing |
| `pg-phase21b-online-inbox.test.js` | Online order inbox |
| `pg-phase21c-tips.test.js` | Tips on restaurant checks |
| `pg-restaurant-86.test.js` | 86'd (out-of-stock) items |
| `pg-sale-seat-persistence.test.js` | Seat assignment persistence |
| `pg-menu-schedules.test.js` | Time-gated menu schedules |
| `pg-restaurant-printer-routing.test.js` | Kitchen printer routing |
| `pg-restaurant-void-comp.test.js` | Void + comp item flows |
| `pg-kds-analytics.test.js` | KDS throughput analytics |
| `pg-menu-engineering.test.js` | Menu engineering reports |
| `pg-restaurant-pay-at-table.test.js` | Pay-at-table QR flow |
| `pg-restaurant-reservations.test.js` | Table reservations |

### Phase-batch and phase2g tests

| File | What it tests |
|------|--------------|
| `pg-batch-phase1-storefront-contracts.test.js` | Storefront + contract public flow |
| `pg-batch-phase2-pos-hardening.test.js` | POS edge cases + hardening |
| `pg-batch-phase3c-atomicity.test.js` | Transaction atomicity |
| `phase2g-wave1-ledger.test.js` | Ledger / accounting entries |
| `phase2g-wave2-gift-cards-sales.test.js` | Gift card issuance + redemption in sales |
| `phase2g-wave2-loyalty.test.js` | Loyalty points earn/redeem |
| `phase2g-wave2-price-books-routes.test.js` | Price book API routes |
| `phase2g-wave2-price-books.test.js` | Price book logic + override resolution |

---

## Unit Tests (`tests/unit/`)

Vitest with ESM imports (`import { describe, it, expect, vi }`). No DB or network — pure functions and injected fake deps. Exception: `routes-orders-transactions.test.js`, `routes-admin-worker-status.test.js`, and `routes-admin-monitoring-infra-cache.test.js` mount mini-Express apps.

### Coverage map

| File | What it covers |
|------|---------------|
| `middleware.test.js` | `validate.js`, `permissions.js`, `plan-limits.js`, `feature-flags.js`, `upload-validation.js`, `tenant-auth.js` |
| `services.test.js` | `services/alerting.js`, `services/payment-gateway.js`, `services/fbr.js`, `services/email.js` |
| `utils.test.js` | `services/email-templates.js` (TEMPLATES + wrapEmailHtml), `utils/receiptEmail.js`, `utils/digestEmail.js` |
| `tz.test.js` | `utils/tz.js` — UTC boundary conversion, DST edge cases, IANA validation |
| `routes-admin-worker-status.test.js` | `GET /api/admin/worker-status` — 8 worker slots, global heartbeat state |
| `routes-orders-transactions.test.js` | `POST /api/orders/:id/transactions` — 11-param INSERT shape |
| `routes-admin-monitoring-infra-cache.test.js` | `/api/admin/infra` — cache miss/hit/force behavior |
| `services-booking-reminders.test.js` | `services/booking-reminders.js` — `processPendingReminders` |
| `services-catalog-scheduler.test.js` | `services/catalog-scheduler.js` — `applyScheduledChange`, allowlist enforcement |
| `workers-email-worker-boss.test.js` | Email worker handlers — search_path scoping, error recovery |
| `workers-tenant-job-context.test.js` | `assertSafeSlug`, `withTenantContext` — search_path + client release |
| `workers-orphan-schema-scan.test.js` | Orphan schema detection → `infra_cache` write |
| `customer-portal-auth.test.js` | `middleware/customer-auth.js` — token sign/verify, OTP, rate limiters |
| `feature-flags-modes.test.js` | `requireMode` — mode cache, DB fallback, backward compat |
| `industry-config.test.js` | 23 presets — required shape, M5/M7/M9/M10 helpers |
| `mode-registry.test.js` | `MODE_REGISTRY`, `getModeConfig`, `getFeatureFlagsForModes` |
| `portal-presets.test.js` | Portal labels + enabled tabs per preset |
| `rentals.test.js` | `computeLateFee`, `generateContractNumber`, rental presets |
| `rooms.test.js` | `resolveRateForDate`, `calculateStayTotal`, `generateBookingNumber` |
| `treatment-plans.test.js` | Status transitions, completion %, consent templates, clinical presets |
| `treatment-folio.test.js` | `upsertFolioForPlan`, `recalcFolioTotals`, `generatePlanNumber` |
| `utils-ics.test.js` | `buildIcsEvent`, `escapeIcsText`, `toIcsUtcStamp` |
| `schemas-shifts.test.js` | `OpenShiftSchema`, `CloseShiftSchema`, `VarianceApproveSchema` |
| `schemas-sales-payments.test.js` | `PaymentLineSchema`, `CreateSaleSchema` |
| `printer-service.test.js` | `withRetry`, `openDrawer`, printer factory |
| `pricing-service.test.js` | `applyPriceBookOverrides`, `composeAutoDiscountPercent` |
| `inventory-intelligence.test.js` | ABC ranks, velocity, GMROI, reorder qty |
| `anomaly-worker.test.js` | `runAnomalyWorkerForDb` — z-score flagging, peer sample size |
| `import-mappers.test.js` | Shopify + Square product/customer mappers, mapper registry |
| `retail-flag-preset.test.js` | `RETAIL_SEED_FLAGS` (19 entries), `MULTI_OUTLET_SEED_FLAGS` (5 entries), seed functions |
| `dockerfile-pg-dump.test.js` | Dockerfile must include `postgresql-client` in prod stage |
| `tenant-auth-employee-email.test.js` | P28: `loadTenantAndPerms` must SELECT and attach `req.employee.email` |

---

## Key Helpers (`tests/helpers/`)

### `createTestApp-pg.js`
Exports: `createTestApp(options?)`, `DEFAULT_FEATURE_FLAGS`, `PERMISSION_RULES`

Creates an isolated Express app with a fresh Postgres schema (`test_<6-byte-hex>`), runs full DDL, seeds fixtures, returns `{ app, db, deps, runtimeState, cleanup, schemaName }`.

- `app` — routes NOT pre-registered; each test calls `require('../../routes/X')(app, deps)` explicitly
- `db` — scoped proxy with `search_path` fixed to the test schema
- `cleanup()` — drops schema + releases pool client; call in `afterAll`
- `options.seed = false` — skip fixture seeding (DDL-only schema)

**Seeded fixtures**: company (id=1), outlets (id=1,2), 3 roles (Admin/Manager/Cashier) with permissions, 3 employees (id=1 Admin PIN 2580, id=2 Manager PIN 2222, id=3 Cashier PIN 3333), 5 products, outlet stock, 1 customer (100 loyalty pts, 500 balance).

**Stubbed deps** (always no-op): `requirePlanLimit`, `requireActiveSubscription`, `loadCompanyProfile` (sets `req.company = { timezone: "UTC" }`), `resolveContext`, `requireContextOutlet`, rate limiters, Shopify stubs.

**`db.getClient()` gotcha**: `release()` is a no-op on the test client — prevents routes from releasing the dedicated schema-scoped client back to the pool.

### `request.js`
Exports: `makeRequest(app, employeeId?)`, `ADMIN_ID` (1), `MANAGER_ID` (2), `CASHIER_ID` (3)

Supertest wrapper that auto-sets `x-employee-id` on every call via Proxy.

### `seedSchema-pg.js`
Exports: `seedSchema(client)` — reads `backend/schema-pg.sql` at module load and runs full DDL.

### `globalTeardown.js`
Jest global teardown — drops orphaned `test_*` schemas left by crashes/timeouts.

### `vitest-setup.js`
Loads `backend/.env` before any test imports so `DATABASE_URL` is available. Prefers `backend/.env.test` (local Postgres) when present — keeps integration tests off production Supabase and ~20× faster.

---

## Key Gotchas

- **`smoke-gate.test.js`** has pre-existing failures on main — do not run or investigate unless explicitly asked
- **DATABASE_URL** is required for all integration tests; unit tests don't need it
- **"Decision II trap"**: deleting env vars inside `beforeAll` is safe only *after* `createTestApp()` has run. Deleting at module scope or before `createTestApp()` breaks module-level env reads
- **`require.cache` eviction pattern**: some unit tests (plan-limits, feature-flags, alerting, tenant-auth) evict and re-require modules between test cases because those modules hold module-level mutable state (connection caches, sliding windows, etc.)
- **`vi.mock()` vs CJS**: `vi.mock()` is unreliable for CommonJS `require()` inside closures — use `require.cache` eviction + re-require instead
- **`reports_accuracy.test.js`** is the only integration file that uses Jest syntax — run with `npx jest` not `npx vitest`
- **Schema isolation**: each `createTestApp()` call creates a new `test_<hex>` schema; `cleanup()` drops it. No shared state between files
- **Upload dirs in tests**: `backend/uploads_test/products/` and `backend/uploads_test/company/` — NOT `backend/uploads/`
