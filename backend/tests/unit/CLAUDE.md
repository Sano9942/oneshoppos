# Unit Tests — Claude Guide

- **20 files**, Vitest with ESM imports (`import { describe, it, expect, vi }`), no DB/network
- **Run**: `npx vitest run backend/tests/unit/`
- **Pattern**: Pure function testing with `vi.fn()` / `vi.mock()` / `vi.spyOn()`. No supertest, no Express

---

## `middleware.test.js`

Tests 8 modules across 3 middleware files:

**`middleware/validate.js`** (6 tests)
- `validate(schema)` + `LoginSchema` — happy path + validation failure returns `400 { error, details }`

**`middleware/permissions.js`** (8 tests)
- `requirePerm("perm")` — allows matching perm + `all_access`; 403 otherwise
- `requireAnyPerm(["p1","p2"])` — allows if any perm matches; 403 otherwise

**`middleware/plan-limits.js`** (5 tests)
- `requirePlanLimit(resource)` — checks outlet/employee/product caps
- **CJS require.cache injection pattern**: `plan-limits.js` does inline `require()` inside closures; `vi.mock()` doesn't intercept this. Tests evict the module from `require.cache`, then re-require with a fake `db.query` injected, to reset module-level state between test cases.

**`middleware/plan-limits.js`** — `requireActiveSubscription` (4 tests)
- Active, trial, grace → passes through. `payment_status = 'expired'` → 403

**`middleware/feature-flags.js`** (6 tests)
- `requireFeature('flag_name')` — tests use `init(deps)` DI pattern (passes a fake `db.query`) + call `invalidateFeatureFlagCache()` between test cases to reset in-memory cache. Without invalidation, tests bleed flag state.

**`middleware/upload-validation.js`** (20 tests)
- `imageFileFilter(req, file, cb)` — 10 tests: accepts valid MIME types, rejects unknown types, passes error to callback
- `safeExtension(filename)` — 7 tests: normalizes extension, strips path traversal, handles edge cases
- `ALLOWED_IMAGE_MIMES` — 3 tests: verifies set contents

---

## `services.test.js`

Tests 4 service modules:

**`services/alerting.js`** — `recordError`, `recordDbPressure`
- `recordError`: threshold 10 per 5-min window. Fires alert on 10th event, resets window (next event starts fresh)
- `recordDbPressure`: threshold 1 — first call with `pressure >= threshold` always alerts. Cooldown logic prevents repeat alerts within window

**`services/payment-gateway.js`** — `isEnabled`, `createCheckout`, `verifyWebhook`
- `isEnabled()` — false when `PAYMENT_GATEWAY` unset, true when set to `"xpay"` etc.
- `createCheckout()` — `"manual"` mode throws; `"xpay"` calls `fetch`
- `verifyWebhook(payload, sig)` — HMAC verification using `XPAY_WEBHOOK_SECRET`

**`services/fbr.js`** — `buildInvoicePayload`, `buildCreditNotePayload`, `getNextRetryDelay`, `BACKOFF_DELAYS`
- `BACKOFF_DELAYS` is an **exported constant** (array): `[60, 300, 900, 3600, 14400]` seconds
- `getNextRetryDelay(attempt)` reads from `BACKOFF_DELAYS` by index
- `buildInvoicePayload` / `buildCreditNotePayload` — pure functions, no DB/network

**`services/email.js`** — `resolveFrom`, `sendEmail`
- `resolveFrom(tenantSlug)` — tenant slug → `slug@sanopos.com`; no slug → `noreply@sanopos.com`
- `sendEmail({type, to, ...})` — throws on unknown email type; throws if `RESEND_API_KEY` unset; calls Resend mock on success

---

## `tz.test.js`

Tests `utils/tz.js`: `toUtcStart`, `toUtcEnd`, `toLocalDateStr`, `getUtcOffsetMinutes`, `isValidTz`

Coverage includes: UTC, Asia/Karachi, America/New_York, America/Los_Angeles, Pacific/Auckland, Pacific/Kiritimati (UTC+14), Pacific/Fakaofo, Pacific/Honolulu, Europe/London. DST edge cases: spring-forward (23h day span), fall-back (25h day span). Invalid timezone falls back to UTC. `toUtcStart(null)` returns null.

---

## `utils.test.js`

Tests 3 utility modules:

**`utils/receiptEmail.js`** — `buildReceiptEmailHtml(sale, company, items)` — pure HTML builder, no network

**`utils/digestEmail.js`** — `buildDigestEmailHtml(data, company)` — daily summary email HTML builder

**`services/email-templates.js`** — `wrapEmailHtml(title, body)`, `TEMPLATES`
- `TEMPLATES` registry is validated to have exactly **15 keys**: `receipt`, `password_reset`, `welcome`, `trial_warning`, `trial_ended`, `account_locked`, `payment_recorded`, `plan_changed`, `expiry_warning`, `overdue`, `renewal_due`, `renewal_overdue`, `support_received`, `support_reply`, `digest`

---

## `routes-admin-worker-status.test.js`

Tests `GET /api/admin/worker-status` in `routes/admin/system.js`

6 worker slots tested: `email`, `fbr`, `cleanup`, `reservation`, `marketplace_sync`, `booking_reminder`

**Response shape per slot**:
- `{ enabled, running, last_poll_ago_seconds, processed_today, queue_depth }`
- `enabled: false, running: false` when global (`global.__<name>WorkerStatus`) is unset
- `running: true` when `lastPollAt` is within freshness threshold
- `running: false` when `lastPollAt` is stale (e.g. 2h old)

---

## `routes-orders-transactions.test.js`

Tests `POST /api/orders/:id/transactions` in `routes/orders.js`

- Verifies INSERT uses exactly **11 params** (`$1..$11`): order_id, amount, payment_method, status, provider_ref, payment_context, webhook_event_id, + 4 others
- `payment_context` defaults to `"billing"` when omitted from request body
- Tests v25 schema columns: `provider_ref`, `payment_context`, `webhook_event_id`

---

## `services-booking-reminders.test.js`

Tests `services/booking-reminders.js` — `processPendingReminders(db, boss)`

- Returns count of rows processed (not count of notifications actually sent)
- **Known SMS pre-existing bug**: SMS channel skips the actual enqueue call but still marks the reminder row as `sent = true`. This is documented in the test as expected behavior to prevent regression — do not "fix" this without a corresponding test update.

---

## `services-catalog-scheduler.test.js`

Tests `services/catalog-scheduler.js` — `applyScheduledChange(db, change)`

- **Non-throwing contract**: always returns `{ status, reason? }`. Caller iterates rows safely; one bad row won't abort the batch
- **Allowlist enforcement**: field names not in `CHANGE_TYPES` allowlist (from `schemas/scheduled-changes.js`) → skips `db.transaction()`, returns `{ status: 'failed', reason: 'invalid_field' }` at pool level
- **Happy path**: valid field → runs `db.transaction()` with UPDATE + mark-applied atomically
- **Security**: injection attempt (e.g. `field_name: "price = 0; DROP TABLE products -- "`) → allowlist rejects before any UPDATE runs

---

## `workers-email-worker-boss.test.js`

Tests tenant-scoped job handlers in `workers/email-worker-boss.js`

Job handlers tested: `subscription-renewal`, `campaign-scheduled-send`, `invoice-reminder`, `campaign-email`

All handlers require `tenantSlug` in job payload — missing slug → error.

**Mock pattern**: Uses `vi.hoisted()` + `vi.mock()` for ESM-compatible hoisting of Resend, email-templates, subscriptions, and marketing mocks. This is different from the CJS `require.cache` pattern used in `middleware.test.js`.

**withTenantContext verification**: tests use real `withTenantContext` with a fake pool. Assert that `SET search_path TO tenant_{slug}` runs before the handler callback, and `SET search_path TO public` runs in the finally block after.

---

## `workers-tenant-job-context.test.js`

Tests `workers/tenant-job-context.js` — `assertSafeSlug`, `withTenantContext`

**`assertSafeSlug(slug)` rejections**: hyphens (`my-tenant`), uppercase (`MyTenant`), spaces, semicolons, SQL injection strings, Unicode — all throw. Accepts lowercase a–z, 0–9, underscores only.

**`withTenantContext(slug, pool, callback)`**:
- Happy path: sets `search_path TO tenant_{slug}`, runs callback, resets to `public` in finally
- Error path: callback throws → still resets search_path, rethrows
- Transaction proxy: `client.transaction()` wraps in `BEGIN`/`COMMIT`/`ROLLBACK`

---

## `customer-portal-auth.test.js`

Tests customer portal auth middleware (`middleware/customer-auth.js`). Covers: missing token → 401, invalid token → 401, wrong scope → 401, valid `scope: "customer"` → passes through with `req.customer` populated.

---

## `feature-flags-modes.test.js`

Tests mode-based feature flag resolution from `middleware/feature-flags.js`. Covers: flags enabled by active modes, flags disabled when mode absent, flag cache invalidation.

---

## `industry-config.test.js`

Tests industry/business model configuration resolution. Covers: preset lookup by `industry_type`, fallback to defaults when type unknown, label overrides per industry.

---

## `mode-registry.test.js`

Tests `config/mode-registry.js` — `getFeatureFlagsForModes`, `VALID_MODES`. Covers: flags returned for each mode, invalid mode returns empty, combined mode flag union.

---

## `portal-presets.test.js`

Tests customer portal preset defaults and label resolution. Covers: `DEFAULT_PRESET` shape, `label(key)` fallback behavior, `hasMode(mode)` logic when `enabled_modes` is populated vs empty.

---

## `rentals.test.js`

Tests `services/rental-service.js` — status transition logic, `computeLateFee`, `generateContractNumber`. Covers: valid transitions (`confirmed → checked_out → returned → completed`), invalid transitions throw, late fee calculation with daily rate.

---

## `rooms.test.js`

Tests `services/room-service.js` — `resolveRateForDate`, `calculateStayTotal`, `checkRoomAvailability`. Covers: rate override precedence (date-specific > day-of-week > base), stay total with tax, availability gap detection.

---

## `treatment-folio.test.js`

Tests `services/treatment-plan-service.js` folio sub-system — `computeFolioTotals`, `recalcFolioTotals`, `writeSessionFeeLine`. Covers: line item aggregation, tax calculation, folio balance after settlement.

---

## `treatment-plans.test.js`

Tests `services/treatment-plan-service.js` core — `validateStatusTransition`, `calculateSessionCompletionPct`, `generatePlanNumber`. Covers: valid/invalid status transitions, completion percentage for partial/full sessions, plan number format.

---

## `utils-ics.test.js`

Tests `utils/ics.js` — `buildIcsEvent`, `escapeIcsText`, `toIcsUtcStamp`. Covers: required field validation (throws on missing uid/start/end/summary), UTC timestamp formatting (Z suffix), text escaping (commas, semicolons, newlines), full VEVENT output shape.

---

## Mocking Patterns Reference

| Pattern | Used In | Why |
|---------|---------|-----|
| `vi.mock()` at module scope | `workers-email-worker-boss.test.js` | ESM imports resolved at module load — `vi.mock()` hoists via `vi.hoisted()` |
| `require.cache` eviction + re-require | `middleware.test.js` (plan-limits, feature-flags) | CJS inline `require()` inside closures bypasses `vi.mock()` interception |
| Real function + fake deps injection | `workers-email-worker-boss.test.js`, `workers-tenant-job-context.test.js` | Tests actual ALS + search_path behavior with a fake pool |
