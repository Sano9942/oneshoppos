# Phase 20: Unit Test Coverage — Design

**Date:** 2026-04-03
**Branch:** fix/audit-phases-13-21
**Approach:** Wave-by-wave, sequential (A)

## Goal

Reach 30%+ unit test coverage across `backend/utils/`, `backend/services/`, `backend/middleware/`, and key frontend contexts. Currently: 37 unit tests (19 in `tz.test.js`, 18 in `frontend/tests/unit/`), zero coverage for services/middleware/utils beyond `tz.js`.

---

## Infrastructure Setup (one-time, before wave 1)

- Install `@vitest/coverage-v8` as devDependency in `backend/`
- Add to `backend/package.json`:
  - `"test:unit": "vitest run tests/unit"`
  - `"test:coverage": "vitest run tests/unit --coverage"`
- Configure `vitest.config.js` coverage to include only: `utils/`, `services/`, `middleware/`, `category-tree.js`
- Exclude: `routes/`, `workers/`, `index.js`, `migrate-pg.js`
- Run baseline before wave 1 to establish starting coverage number

---

## Wave 1: `backend/utils/` — Pure Functions

**File:** `backend/tests/unit/utils.test.js`

| Target | What to test | Mock needed |
|--------|-------------|-------------|
| `tz.js` — `getUtcOffsetMinutes` | UTC, Karachi (+300), NY winter/summer, DST boundaries | None |
| `email-templates.js` | Builder functions return strings with correct content: subject lines, amounts, tenant names. Cover: `receipt`, `trial_warning`, `account_locked`, `payment_recorded` | None |
| `alerting.js` window logic | `getWindow` resets after windowMs, `inCooldown` blocks re-alerts, `addError` deduplicates | Mock `sendAlertEmail` at module boundary |
| `receiptEmail.js` | HTML builder output contains expected fields | None |
| `digestEmail.js` | HTML builder output contains expected fields | None |

**Skip:** `r2.js`, `resendEmail.js`, `alertEmail.js` — thin transport wrappers, no business logic.

**Estimated tests:** ~30

---

## Wave 2: `backend/services/`

**File:** `backend/tests/unit/services.test.js`

| Target | What to test | Mock needed |
|--------|-------------|-------------|
| `payment-gateway.js` — `isEnabled()` | `PAYMENT_GATEWAY=xpay` → true; unset/manual → false | None |
| `payment-gateway.js` — `createCheckout()` manual | Throws "not configured" message | None |
| `payment-gateway.js` — `createCheckout()` xpay | Correct URL, headers, `reference_id` mapping; happy path + error | `vi.stubGlobal('fetch', ...)` |
| `payment-gateway.js` — `verifyWebhook()` | Valid signature passes, tampered body fails, unknown gateway → `{ valid: false }` | `vi.stubGlobal('fetch', ...)` |
| `alerting.js` — `recordError` | Below threshold → no send; at threshold → sends once; cooldown blocks second; window expiry resets | `vi.mock('../utils/alertEmail')` |
| `fbr.js` — payload builders | Correct FBR invoice shape, NTN field mapping, tax amounts | `vi.stubGlobal('fetch', ...)` |
| `email.js` — routing logic | Tenant email: SMTP first, Resend fallback on failure; platform email: always Resend; subject/from per type | Mock `nodemailer` + `Resend` |

**Skip:** `logger.js` (Pino wrapper), `printer.js` (TCP socket), `boss.js` (pg-boss wrapper).

**Estimated tests:** ~30

---

## Wave 3: `backend/middleware/`

**File:** `backend/tests/unit/middleware.test.js`

Pattern: mock `req`/`res`/`next` triple, call middleware, assert on what was called.

| Target | What to test | Mock needed |
|--------|-------------|-------------|
| `validate.js` | Valid body → `next()`; invalid body → 400 with Zod error | None |
| `permissions.js` — `requirePerm` | Has perm → `next()`; has `all_access` → `next()`; missing → 403 | None |
| `permissions.js` — `requireAnyPerm` | Any matching perm → `next()`; none match → 403 | None |
| `plan-limits.js` | `MULTI_TENANT !== "1"` skips; limit=0 passes; count < limit passes; count >= limit → 403 | Mock `masterDb.query` + tenant DB |
| `feature-flags.js` | Flag enabled → `next()`; disabled → 403; missing key → 403 | Mock `req.company` |
| `upload-validation.js` | Valid MIME passes; invalid MIME blocked; oversized file blocked | None |

**Skip:** `request-id.js`, `rate-limit.js`, `tenant-auth.js`.

**Estimated tests:** ~28

---

## Wave 4: Frontend Contexts

**Setup:** `@vitest/coverage-v8` + `jsdom` environment in `frontend/vitest.config.js`. Uses `@testing-library/react` `renderHook`.

**File:** `frontend/tests/unit/contexts.test.jsx`

| Target | What to test | Mock needed |
|--------|-------------|-------------|
| `CurrencyContext` — `fmt()` | PKR symbol + comma formatting; zero/negative/decimal; fallback when unloaded | Mock `fetch` for initial currency load |
| `POSContext` — cart math | Line total (qty × price), subtotal, discount (% and flat, cannot exceed subtotal), tax on post-discount subtotal, grand total | Extract to `pos/cartMath.js` if not already standalone |

**Refactor gate:** If cart math is embedded in the hook, extract to `frontend/src/pages/redesign/pos/cartMath.js` as part of this wave before writing tests.

**Skip:** Keyboard shortcut dispatch, modal state, park/retrieve flow — covered by Playwright E2E.

**Estimated tests:** ~15

---

## Coverage Target Tracking

Run `npm run test:coverage` after each wave. Checkpoint targets:

| After wave | Expected coverage |
|------------|-------------------|
| Baseline | ~5% |
| Wave 1 | ~15% |
| Wave 2 | ~22% |
| Wave 3 | ~28% |
| Wave 4 | 30%+ |

---

## Decisions Made

- **Approach A** (wave-by-wave sequential) over parallel subagents — wave patterns inform the next wave's mocking strategy
- **Mock at I/O boundary only** — never mock pure JS logic; mock DB, fetch, SMTP transports
- **POSContext: pure math only** — extract cart math to standalone module if needed; skip React lifecycle tests (E2E covers those)
- **Coverage reporter wired at start** — live feedback throughout all waves, not just at the end
- **Transport utils skipped in wave 1** — `r2.js`, `resendEmail.js`, `alertEmail.js` are thin wrappers with no testable business logic
