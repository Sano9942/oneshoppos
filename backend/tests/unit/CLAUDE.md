# Unit Tests — Claude Guide

Vitest, no DB or network access — pure functions and fake injected dependencies only. Run:

```bash
npx vitest run backend/tests/unit/
```

Most files use ESM imports (`describe`/`it`/`expect`/`vi`). Several use CommonJS `require()` (directly or via `createRequire()`) because the module under test is itself CJS: `dockerfile-pg-dump.test.js`, `inventory-intelligence.test.js`, `pricing-service.test.js`, `tenant-auth-employee-email.test.js`, `services-catalog-scheduler.test.js`.

No file in this directory uses Jest — the one Jest exception in the repo (`reports_accuracy.test.js`) lives under `tests/integration/`, not here.

---

## The core gotcha: `vi.mock()` is unreliable for CJS `require()`

Several backend modules do inline `require()` calls inside function bodies/closures rather than at module top-level. Vitest's `vi.mock()` intercepts the ESM/CJS module registry at import time — it does **not** reliably intercept a `require()` call made later, inside a closure, especially when the target module holds mutable module-level state. Two different workarounds are used depending on the situation:

### Pattern A (preferred, most common): real function + fake injected deps
Call the real exported function with a hand-built fake `db` (and sometimes fake `boss`/`pool`) object instead of mocking the module. The fake is typically a `vi.fn()` for `query`/`transaction` that either returns canned rows or records the SQL string it was called with, so assertions can check both behavior and the exact query shape. This is the default choice for any service/worker whose only real dependency is Postgres — it exercises the actual logic instead of a stubbed shell.

Used throughout: `services-booking-reminders.test.js`, `services-catalog-scheduler.test.js`, `workers-tenant-job-context.test.js`, `treatment-plans.test.js`, `treatment-folio.test.js`, `rooms.test.js`, `rentals.test.js`, `anomaly-worker.test.js`, `pricing-service.test.js`, `inventory-intelligence.test.js`, `printer-service.test.js`, `services-tips-w24.test.js`, `workers-email-worker-boss.test.js` (fake `pg.Pool` + the real `withTenantContext`).

### Pattern B: `require.cache` eviction + re-require
When the module under test holds module-level mutable state (an in-memory `Map`, a cache, a sliding window counter) and does inline `require()` for its own dependencies, tests delete the module from `require.cache` before each case and re-`require()` it fresh — this both resets internal state and lets a differently-shaped fake dependency be injected in its place (assigning a fake module into `require.cache` before the re-require, or swapping global/env state the closure reads at call time).

Used in: `middleware.test.js` (`plan-limits.js`, `feature-flags.js`, `tenant-auth.js`), `services.test.js` (`alerting.js`, `email.js`), `tenant-auth-employee-email.test.js`.

### Pattern C: `vi.mock()` + `vi.hoisted()` (only where the module is cleanly ESM-importable)
Used in `workers-email-worker-boss.test.js` for its peripheral dependencies (`resend`, `email-templates`, `subscriptions`, `marketing`) — these are imported normally at module top-level, so `vi.mock()` works. The worker's core tenant-scoping logic in the same file still goes through Pattern A (fake `pg.Pool`) rather than being mocked, because that's the part actually under test.

### `vi.stubGlobal`
`services.test.js` uses `vi.stubGlobal("fetch", vi.fn())` to intercept the payment-gateway service's direct `global.fetch` call — there's no module to mock, since the HTTP call is inline.

**Rule of thumb for new tests**: default to Pattern A (real function, fake `db`). Only reach for `require.cache` eviction if the module has genuinely unavoidable module-level state that a fresh fake dependency can't reset on its own. Don't reach for `vi.mock()` on anything that uses inline `require()`.

---

## Other structural patterns

- **No real Express app in most files.** `routes-orders-transactions.test.js` and `routes-admin-worker-status.test.js` mount a real mini-Express app and use supertest against it. `routes-admin-monitoring-infra-cache.test.js` and the orphan-schema worker test instead call the handler function directly against a hand-rolled minimal app/req/res stub — faster, no real HTTP, but only correct if the handler doesn't depend on Express internals beyond what's stubbed.
- **No shared test helpers.** None of these files import anything from `tests/helpers/` (that's integration-test infrastructure — `createTestApp-pg.js`, `request.js`, etc.). Each unit test file builds its own local fakes inline.
- **Pure functions, no mocking at all**: `tz.test.js`, `utils.test.js`, `utils-ics.test.js`, `mode-registry.test.js`, `industry-config.test.js`, `portal-presets.test.js`, `schemas-shifts.test.js`, `schemas-sales-payments.test.js`, `import-mappers.test.js`. `dockerfile-pg-dump.test.js` reads a static file (`fs.readFileSync` on the Dockerfile) rather than exercising code at all.

---

## What's under test, by area

**Middleware** (`middleware.test.js`) — `validate.js` (Zod middleware factory, type coercion, 400 shape), `permissions.js` (`requirePerm`/`requireAnyPerm`, `all_access` bypass), `plan-limits.js` (`requirePlanLimit`, `requireActiveSubscription` — subscription status gating), `feature-flags.js` (`requireFeature`, cache invalidation, `DEFAULT_FEATURE_FLAGS`), `upload-validation.js` (MIME/extension/magic-byte checks — rejects EXE-as-image, SVG XSS vectors), `tenant-auth.js` (`loadTenantAndPerms` JWT error handling, employee email hydration).

**Core services** (`services.test.js`) — `alerting.js` (sliding-window error/DB-pressure thresholds), `payment-gateway.js` (xPay adapter: `isEnabled`, `createCheckout`, `verifyWebhook`), `fbr.js` (invoice/credit-note payload builders, retry backoff schedule), `email.js` (`resolveFrom` sender routing, `sendEmail` validation).

**Email/templates** (`utils.test.js`) — `email-templates.js` registry completeness + HTML wrapper, `receiptEmail.js` and `digestEmail.js` HTML builders.

**Timezone** (`tz.test.js`) — `utils/tz.js`: local-date-to-UTC-boundary conversion, DST spring-forward/fall-back edge cases across multiple IANA zones (including half-hour and +14 offsets), IANA name validation.

**Booking/reminders/scheduler** — `services-booking-reminders.test.js` (`processPendingReminders`: enqueues email jobs, marks rows sent/failed — note a known pre-existing bug where the SMS channel silently marks rows sent without enqueueing; this is intentionally documented behavior, don't "fix" without updating the test), `services-catalog-scheduler.test.js` (`applyScheduledChange`: field-name allowlist per entity type blocks unlisted/injected field names before any UPDATE runs, never throws — always resolves `{status, reason?}`).

**Workers** — `workers-tenant-job-context.test.js` (`assertSafeSlug` strict slug validation, `withTenantContext` search_path set/reset-in-finally/client-release-on-error), `workers-email-worker-boss.test.js` (tenant-scoped job handlers set/reset `search_path`, reject jobs missing `tenantSlug`), `workers-orphan-schema-scan.test.js` (compares live tenant schemas against the tenant registry, writes results to a cross-tenant cache table rather than the caller re-scanning inline), `anomaly-worker.test.js` (z-score outlier detection on void/refund rates, skips outlets with too few peer employees for a meaningful sample).

**Routes** — `routes-orders-transactions.test.js` (exact INSERT param shape/order/defaults for a transactions endpoint), `routes-admin-worker-status.test.js` (worker heartbeat status endpoint: enabled/running derived from global heartbeat state and a per-worker freshness threshold), `routes-admin-monitoring-infra-cache.test.js` (cache miss vs hit vs forced-bypass behavior on an expensive introspection endpoint).

**Customer portal auth** (`customer-portal-auth.test.js`) — token signing/verification with a distinct scope/secret from staff auth, refresh token hashing, OTP format, portal-specific rate limiters.

**Feature flags / modes** (`feature-flags-modes.test.js`) — `requireMode` middleware: DB-backed mode gate, cache TTL, graceful fallthrough when the modes table doesn't exist yet (pre-migration compat).

**Industry presets / mode registry** (`industry-config.test.js`, `mode-registry.test.js`, `portal-presets.test.js`) — preset shape validation (every preset has labels, dashboard widgets, onboarding steps, POS layout mode), unknown-preset fallback to a default, cross-check that every mode referenced by a preset actually exists in the mode registry, portal tab/label resolution per preset.

**Vertical domain services** — `rentals.test.js` (`computeLateFee` day-rounding/quantity math, `generateContractNumber` sequence formatting, rental preset shape), `rooms.test.js` (`resolveRateForDate` override-vs-base-rate resolution and NUMERIC-string coercion, `calculateStayTotal` night-by-night rate iteration, date helpers), `treatment-plans.test.js` (status transition state machine including terminal states, session completion percent with denormalization-drift capping, consent template lookup, clinical preset config), `treatment-folio.test.js` (folio upsert idempotency, totals recalculation param order/sign conventions, sequence number generation).

**Pricing/inventory** — `pricing-service.test.js` (`applyPriceBookOverrides`: variant-scoped overrides beat product-level, quantity/bundle/rewritten-id edge cases; `composeAutoDiscountPercent`: additive stacking capped at 100%), `inventory-intelligence.test.js` (ABC Pareto classification with stable tie-break, sales velocity, GMROI, lead-time resolution priority chain, reorder quantity suggestion).

**Import mappers** (`import-mappers.test.js`) — per-source field mapping for bulk import (Shopify, Square) across products and customers, plus the mapper/template registry lookup functions.

**Tips** (`services-tips-w24.test.js`) — regression test for a real production bug: the frontend sent capitalized tip method strings that violated a lowercase-only DB constraint, and a swallowed error hid the failure. Asserts normalization to lowercase before insert, explicit rejection of invalid methods with a typed error code, and an early-return no-op for non-positive tip amounts.

**Printer** (`printer-service.test.js`) — `withRetry` exponential backoff/attempt-count semantics, `openDrawer` failure modes (no printer row, inactive, drawer disabled, DB error), service factory shape.

**Schemas** (`schemas-shifts.test.js`, `schemas-sales-payments.test.js`) — Zod schema validation/coercion rules for shift open/close/variance-approval and sale payment lines, including backward-compatible optional fields.

**ICS calendar** (`utils-ics.test.js`) — `buildIcsEvent`/`escapeIcsText`/`toIcsUtcStamp`: RFC 5545 line-ending and escaping correctness, required-field validation.

**Feature flag seeding** (`retail-flag-preset.test.js`) — asserts the exact retail and multi-outlet seed flag sets (used to guard against accidental drift when flags are added/removed) and that seeding issues idempotent `ON CONFLICT DO UPDATE` inserts.

**Dockerfile** (`dockerfile-pg-dump.test.js`) — regression guard asserting the production Docker stage installs a `postgresql-client` package, because `pg_dump` being absent from the container silently broke tenant backup export for an extended period without raising any error.

**Tenant auth email hydration** (`tenant-auth-employee-email.test.js`) — regression test asserting `loadTenantAndPerms` selects and attaches the employee's email to the request; a prior version of the query omitted it, which silently disabled a downstream confirmation email that reads `req.employee.email`.

---

## Writing a new unit test here

1. Default to Pattern A: call the real function, pass a fake `db`/`boss`/`pool` built from `vi.fn()`. Assert on both return value and the recorded call arguments/SQL where the shape of the query matters.
2. Only use `require.cache` eviction if the module has module-level mutable state you need to reset between cases, or does inline `require()` you must intercept.
3. Only use `vi.mock()`/`vi.hoisted()` for dependencies that are imported at module top-level (not inline `require()`).
4. Don't add a dependency on `tests/helpers/` — those are integration-test-only; keep unit tests self-contained with local fakes.
5. If a test is guarding a specific past production bug, say so in a comment near the assertion — several existing files do this and it stops the "fix" from being reverted by someone who doesn't know the history.
