# Unit Tests — Claude Guide

Vitest, no DB, no network. Pure functions and hand-built fake dependencies only. Run:

```bash
npx vitest run backend/tests/unit/
```

Most files use ESM imports (`describe`/`it`/`expect`/`vi`). Several use CommonJS `require()` (directly, or via `createRequire()` from an ESM file) because the module under test is itself CJS — e.g. `dockerfile-pg-dump.test.js`, `inventory-intelligence.test.js`, `pricing-service.test.js`, `tenant-auth-employee-email.test.js`, `services-catalog-scheduler.test.js`, `rentals.test.js`, `rooms.test.js`, `treatment-plans.test.js`, `treatment-folio.test.js`, `services-customer-notify.test.js`. No file here uses Jest — the repo's one Jest-syntax file (`reports_accuracy.test.js`) lives under `tests/integration/`, not here.

---

## The core gotcha: `vi.mock()` is unreliable for CJS `require()`

Many backend modules call `require()` inline inside function bodies/closures rather than at module top-level (plan-limits.js, feature-flags.js, catalog-scheduler.js, etc.). Vitest's `vi.mock()` intercepts the module registry at import time — it does not reliably intercept a `require()` fired later inside a closure, especially against a module with mutable module-level state. Three patterns are used depending on the situation:

### Pattern A (default, most common): real function + fake injected deps
Call the real exported function with a hand-built fake `db` (sometimes `boss`/`pool`/`client`) built from `vi.fn()`. The fake either returns canned rows keyed off a regex match on the SQL string, or just records every call so the test can assert on the exact SQL/param shape. This exercises real logic instead of a stubbed shell, and is the default choice for anything whose only real dependency is Postgres or pg-boss.

Examples: `services-catalog-scheduler.test.js` (allowlist gate on `applyScheduledChange`), `workers-tenant-job-context.test.js` (fake `pg.Pool`), `services-booking-reminders.test.js`, `services-customer-notify.test.js` (fake db + a `deps` object for `enqueueEmail`/`sendSms`/`sendWhatsApp` — the notify() function takes an explicit 3rd `deps` arg for exactly this reason), `treatment-plans.test.js`/`treatment-folio.test.js`, `rooms.test.js`/`rentals.test.js`, `anomaly-worker.test.js`, `pricing-service.test.js`, `inventory-intelligence.test.js`, `printer-service.test.js`, `services-tips-w24.test.js`, `services-ai.test.js` (fake Anthropic `client.messages.create`), `promo-engine-price-lock.test.js`, `workers-orphan-schema-scan.test.js`, `routes-admin-monitoring-infra-cache.test.js`, `workers-email-worker-boss.test.js` (fake `pg.Pool` + the *real* `withTenantContext` helper — deliberately not mocked, see below).

### Pattern B: `require.cache` eviction + re-require
When the module under test holds module-level mutable state (an in-memory cache, sliding-window counters) and/or does inline `require()` for its own dependencies, tests delete it from `require.cache` before each case and re-`require()` it fresh. This both resets internal state and lets a differently-shaped fake dependency be substituted (by writing a fake CJS module object into `require.cache` at the resolved absolute path *before* the re-require).

Used in: `middleware.test.js` (`plan-limits.js`, `feature-flags.js`, `tenant-auth.js` — each via `injectCjsMock(absPath, fakeExports)` / `removeCjsMock`), `services.test.js` (`alerting.js`'s sliding-window Map, `email.js`'s lazy Resend singleton — including replacing the cached `resend` package's exports with a fake `Resend` constructor), `tenant-auth-employee-email.test.js`.

### Pattern C: `vi.mock()` + `vi.hoisted()` (only for cleanly ESM-importable deps)
Used in `workers-email-worker-boss.test.js` for peripheral dependencies imported at module top-level (`resend`, `email-templates`, `subscriptions`, `marketing`) — `vi.mock()` works here because these are real top-level imports, not inline `require()`. The worker's actual tenant-scoping logic in the same file still goes through Pattern A (real `withTenantContext` + fake pool), because that's the part under test.

### `vi.stubGlobal`
`services.test.js` uses `vi.stubGlobal("fetch", vi.fn())` to intercept `payment-gateway.js`'s direct `global.fetch` call for the xPay adapter — there's no module boundary to mock since the HTTP call is inline.

**Rule of thumb for new tests**: default to Pattern A. Only reach for `require.cache` eviction if the module has genuinely unavoidable module-level state a fresh fake can't reset. Only use `vi.mock()`/`vi.hoisted()` on dependencies imported at module top-level.

---

## Other structural patterns

- **Real mini-Express + supertest** for a few route-layer tests: `routes-orders-transactions.test.js` (asserts exact INSERT column/param order for `POST /api/orders/:id/transactions`), `routes-admin-worker-status.test.js` (worker heartbeat endpoint — reads/restores `global.__*WorkerStatus` around each test).
- **Hand-rolled req/res/next stubs, no Express at all** for the rest of the route-handler tests: `routes-admin-monitoring-infra-cache.test.js` (calls the registered handler function directly; asserts `X-Infra-Cache: hit|miss` and that a 300s in-process cache is respected, bypassed only by `?force=1`), `middleware.test.js`. Faster, but only valid if the handler doesn't lean on real Express internals beyond what's stubbed.
- **No shared test helpers.** Nothing here imports from `tests/helpers/` (that's integration-test infrastructure — `createTestApp-pg.js`, `request.js`, etc.). Each file builds its own local fakes.
- **Source-scanning regression guards**, not behavioral tests: `dockerfile-pg-dump.test.js` (`fs.readFileSync`s the Dockerfile, asserts an `apk add` line installs `postgresql-client` in the production stage — pg_dump silently missing broke tenant backups for 50+ days undetected), `tz-date-boundary-guard.test.js` (walks `routes/`, `services/`, `workers/`, `boot/`, `utils/` line-by-line with regexes banning the UTC-"today" idiom, bare SQL `CURRENT_DATE`/`now()::date`, and bare `::date`/`date(col)` casts on a hardcoded list of TIMESTAMPTZ column names; has a per-file/per-line-substring `ALLOW` allowlist for deliberate UTC-bucket uses — read the allowlist comments before deciding a hit is a false positive).
- **Pure functions, no mocking at all**: `tz.test.js`, `utils.test.js`, `utils-ics.test.js`, `mode-registry.test.js`, `industry-config.test.js`, `portal-presets.test.js`, `schemas-shifts.test.js`, `schemas-sales-payments.test.js`, `import-mappers.test.js`, `subscriptions-compute-period.test.js`, `embedded-barcode.test.js`, `retail-flag-preset.test.js` (its `seed*Flags` cases still pass a fake `client`, but the flag-list constants themselves are asserted as pure data).

---

## What's under test, by area

**Middleware** (`middleware.test.js`) — `validate.js` (Zod factory, coercion, 400 shape), `permissions.js` (`requirePerm`/`requireAnyPerm`, `all_access` bypass), `plan-limits.js` (`requirePlanLimit`, `requireActiveSubscription`), `feature-flags.js` (`requireFeature`, cache invalidation, `DEFAULT_FEATURE_FLAGS` all-boolean check), `upload-validation.js` (MIME/extension/magic-byte checks across image, raster-only, and clinical-doc filters — rejects EXE-as-image, SVG XSS, PDF-as-something-else), `tenant-auth.js` (`loadTenantAndPerms` JWT error taxonomy: expired vs malformed vs bad-signature vs no-header, each must resolve to a specific 401 code or an empty-perms `next()` — never a silent fall-through).

**Modes/flags** (`feature-flags-modes.test.js`, `mode-registry.test.js`) — `requireMode` DB-backed gate with cache + a backward-compat fallthrough when `tenant_modes` doesn't exist yet or is empty; `MODE_REGISTRY`/`getFeatureFlagsForModes` shape and cross-check that every mode any preset references actually exists in the registry.

**Core services** (`services.test.js`) — `alerting.js` (sliding-window error/DB-pressure thresholds, cooldown-then-reset), `payment-gateway.js` (xPay adapter: `isEnabled`, `createCheckout`, `verifyWebhook`), `fbr.js` (invoice/credit-note payload builders, retry backoff schedule), `email.js` (`resolveFrom` sender routing — tenant-branded vs platform `noreply@`, `RESEND_FROM_EMAIL` override — and `sendEmail` validation/dispatch).

**Email/templates** (`utils.test.js`) — `email-templates.js` registry completeness + HTML wrapper, `receiptEmail.js`/`digestEmail.js` HTML builders.

**Timezone** (`tz.test.js`, `tz-date-boundary-guard.test.js`) — `utils/tz.js`: `toUtcStart`/`toUtcEnd` local-to-UTC boundary conversion across many IANA zones including DST spring-forward/fall-back and half-hour/+14 offsets, `tenantToday`/`todayBounds` (the tz-bug-class fix helpers), `addDaysStr`, `pgDateToStr` (guards the local-midnight-Date round-trip trap), `isValidTz`, `getUtcOffsetMinutes`. Plus the repo-wide static guard described above.

**Booking/reminders/notifications** — `services-booking-reminders.test.js` (`processPendingReminders`: enqueues email jobs, marks rows sent/failed; SMS-channel reminders route through the F05 notification engine and are marked truthfully — `sent` only on a real dispatch, `failed` otherwise, never a false-positive `sent`), `services-customer-notify.test.js` (`notify()`: feature-flag short-circuit, per-channel rule matching with `channelHints` filtering, phone normalization to E.164 (`normalizePhone`), and a `customer_notifications` status truth log — `queued`/`sent`/`skipped` (no provider, no recipient, rule disabled) vs `failed` (provider errored) are distinct outcomes, never conflated).

**Subscriptions** (`subscriptions-compute-period.test.js`) — `computeNextPeriod`: calendar-month anchoring (not "+30 days"), end-of-month clamping (Jan 31 → Feb 28/29, and the clamp doesn't resurrect day 30/31 on the next rollover), quarterly/yearly/`intervalCount` stepping, unknown-interval fallback.

**Workers** — `workers-tenant-job-context.test.js` (`assertSafeSlug` strict validation, `withTenantContext` search_path set-before-callback/reset-in-finally/client-release-on-error-or-reset-failure, transaction proxy BEGIN/COMMIT/ROLLBACK wrapping), `workers-email-worker-boss.test.js` (four tenant-scoped job handlers each throw if `tenantSlug` is missing from the job payload, then run their real service call inside `withTenantContext` against a fake `pg.Pool` — assertions check query ordering relative to the `SET search_path` calls, not just that a query fired), `workers-orphan-schema-scan.test.js` (diffs `information_schema.schemata` against `public.tenants`, writes results to `public.infra_cache` instead of the caller re-scanning inline), `anomaly-worker.test.js` (z-score outlier detection on void/refund rates; skips outlets with fewer than 3 peer employees since z-scores are meaningless on a tiny sample; threshold is caller-overridable).

**Routes** — `routes-orders-transactions.test.js` (exact INSERT column list/param order/positional defaults for a payment-transactions endpoint — a prior version omitted three v25 columns, causing duplicate rows via a later webhook), `routes-admin-worker-status.test.js` (worker heartbeat endpoint: each worker slot's `enabled`/`running` is derived from a `global.__<name>WorkerStatus` object and a per-worker freshness window — e.g. reservation/booking-reminder use a tighter window than the 5-minute marketplace-sync poll), `routes-admin-monitoring-infra-cache.test.js` (5-minute in-process cache in front of the heaviest admin introspection endpoint — miss/hit/`force=1`-bypass).

**Customer portal auth** (`customer-portal-auth.test.js`) — token signing/verification with a distinct scope (`"customer"`) and secret from staff auth, refresh-token SHA-256 hashing, OTP hash/format contract, shape check on the three portal-specific rate limiters.

**Industry presets / mode registry / portal** (`industry-config.test.js`, `mode-registry.test.js`, `portal-presets.test.js`) — every preset has the required shape (labels, dashboard widgets, onboarding steps, POS layout mode); presets that dropped decorative dashboard-widget keys with no real dashboard consumer (`floor_plan`, `appointments_today`, `active_treatment_plans`, `overdue_sessions`) assert those keys are now `undefined`, not `false` — don't reintroduce them without wiring an actual consumer; unknown-preset fallback to `general_retail`; clinical-preset `clinical_config` (chart preset, subject-type default, consent templates) per vertical (dental/vet/physio); portal tab/label resolution per preset including rental/room/clinical additions.

**Vertical domain services** — `rentals.test.js` (`computeLateFee` day-rounding via `Math.ceil` + quantity multiplication, `generateContractNumber` zero-padded sequence formatting, rental preset shape/labels), `rooms.test.js` (`resolveRateForDate` override-vs-base rate resolution with NUMERIC-string coercion, `calculateStayTotal` night-by-night iteration with partial-overlap override windows, `daysBetween`/`addDaysISO` pure date helpers, `generateBookingNumber`), `treatment-plans.test.js` (`validateStatusTransition` state machine incl. terminal states like `invoiced`/`discontinued`, `calculateSessionCompletionPct` with denormalization-drift capping at 100%, consent template catalog lookup, clinical preset config), `treatment-folio.test.js` (`upsertFolioForPlan` idempotency — no duplicate INSERT when an open folio exists, `recalcFolioTotals` param order/sign conventions including the V05 exclusive-vs-inclusive snapshot-tax split, `resolveNextSessionNumber`, `generatePlanNumber` zero-padded format).

**Pricing/inventory/promotions** — `pricing-service.test.js` (`applyPriceBookOverrides`: variant-scoped beats product-level, min-qty gate, never applies an *upward* override, ignores bundle items, resolves `original_product_id` after bundle-expansion id rewriting; `composeAutoDiscountPercent`: additive group+tier stacking capped at 100%, each side individually suppressible via an `apply*=false` flag), `inventory-intelligence.test.js` (`assignAbcRanks` 80/15/5 Pareto split with stable product_id tie-break and null rank for zero revenue, `computeVelocity`, `computeGmroi`, `resolveLeadTime` priority chain product-override → supplier-default → tenant-default → hardcoded 7, `suggestReorderQty`), `promo-engine-price-lock.test.js` (`evaluatePromotions` excludes `price_locked` line items — scale/weight-priced packs with a final embedded price — from storewide percent, slab-percent tier-qualifying quantity, and flat-fixed cart discounts, across all three promo types).

**Barcode decoding** (`embedded-barcode.test.js`) — `decodeEmbeddedBarcode`/`ean13CheckDigit`/`normalizeScheme` for price- and weight-embedded EAN-13 labels (grocery scale integration): check-digit validation (skippable), scheme-geometry validation (`malformed` when prefix+item+value+check ≠ 13), and explicit non-error fall-through reasons (`disabled`, `not_embedded`) for ordinary barcodes — mirrored by a frontend test that must be kept in sync.

**AI** (`services-ai.test.js`) — `parseJsonFromText` (bare JSON, fenced ```json blocks, JSON-with-leading-prose), `generateProductContent` (prompt assembly, tag normalization: lowercased/trimmed/blanks dropped, required-field validation), `extractInvoiceLineItems` (vision-model image block construction, canonical-field mapping for the import pipeline, bad-number coercion to 0, nameless-row dropping) — all against a fake Anthropic client, no network/API key needed.

**Tips** (`services-tips-w24.test.js`) — regression test: the frontend sent capitalized tip-method strings that violated a lowercase-only DB CHECK constraint, and a swallowed error hid the failure silently. Asserts lowercase normalization before INSERT, explicit typed-error rejection for methods outside the allowlist, and an early-return no-op for non-positive tip amounts.

**Printer** (`printer-service.test.js`) — `withRetry` exponential-backoff/attempt-count semantics (including `retries=0` = single attempt), `openDrawer` failure modes (unconfigured, inactive, drawer disabled in config, DB error), factory shape.

**Schemas** (`schemas-shifts.test.js`, `schemas-sales-payments.test.js`) — Zod validation/coercion for shift open/close/variance-approval and sale payment lines, including string-to-number coercion and backward-compatible optional fields (a sale with no `payments` field at all must still parse).

**ICS calendar** (`utils-ics.test.js`) — `buildIcsEvent`/`escapeIcsText`/`toIcsUtcStamp`: RFC 5545 CRLF line-ending and character-escaping correctness, required-field validation.

**Import mappers** (`import-mappers.test.js`) — per-source field mapping (Shopify, Square) for products and customers — variant-title suffixing, Draft→inactive status mapping, currency-symbol stripping, multi-location stock-column picking, company-name customer fallback — plus the mapper/template registry lookup functions (`getMapper`, `getTemplate`, `listSources`).

**Feature flag seeding** (`retail-flag-preset.test.js`) — exact retail/restaurant/multi-outlet/per-subtype (grocery/butcher/sweet_shop/textile) seed flag-set membership (guards against accidental drift when flags are added/removed) and that seeding issues idempotent `ON CONFLICT (key) DO UPDATE SET enabled = true` upserts, one per flag.

**Dockerfile** (`dockerfile-pg-dump.test.js`) — see "source-scanning regression guards" above.

**Tenant auth email hydration** (`tenant-auth-employee-email.test.js`) — regression test asserting `loadTenantAndPerms` selects and attaches the employee's `email` onto `req.employee`; an earlier version of the query omitted it, silently disabling a downstream support-ticket confirmation email that reads `req.employee.email`.

---

## Writing a new unit test here

1. Default to Pattern A: call the real function, pass a fake `db`/`boss`/`pool`/`client` built from `vi.fn()`. Assert on both the return value and the recorded call arguments/SQL where the query shape itself matters (column order, param positions, ordering relative to `SET search_path`).
2. Only use `require.cache` eviction if the module has module-level mutable state you need to reset between cases, or does inline `require()` you must intercept with a differently-shaped fake.
3. Only use `vi.mock()`/`vi.hoisted()` for dependencies imported at module top-level — never for inline `require()`.
4. Don't depend on `tests/helpers/` — that's integration-test-only infrastructure. Keep unit tests self-contained with local fakes.
5. If a test guards a specific past production bug, say so in a comment near the assertion (most files here do). It stops a well-meaning "fix" from reverting the guarded behavior by someone unaware of the history.
6. If you're adding a regex/source-scan-style regression guard (like the tz-date-boundary or Dockerfile tests), keep the allowlist mechanism next to the scan and require a one-line justification comment at each allowlisted call site, not just in the test file.
