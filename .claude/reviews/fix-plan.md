# Fix Plan — Pattern-by-Pattern Execution Log

This document is the **live source of truth** for what we're doing about
the findings in [./findings/](./findings/). The findings themselves are
frozen snapshots of reviewer output; this file reflects actual decisions,
production verifications, and landed commits.

**Read order:**
1. [FINAL-REPORT.md](FINAL-REPORT.md) — review summary, headline numbers
2. [findings/cross-phase-synthesis.md](findings/cross-phase-synthesis.md) — 7 cross-phase patterns
3. [findings/phase{1..5}.md](findings/) — per-phase reviewer output
4. **This file** — what we're actually doing, verified against production

## Verification rule

Before any fix commit, the bug is re-verified against the **live production
state** — not the committed code, not the review, not memory. Every finding
in this file ends with an inline `[verified <date>: ...]` note describing
what was checked. If verification shows the bug doesn't exist in production,
the finding moves to `notabug` with the evidence recorded here.

## Vocabulary

**Pattern status:**
- `active` — currently being worked on
- `done` — all fixes landed and verified
- `deferred` — blocked or intentionally postponed (blocker named)

**Finding disposition:**
- `fix` — we're going to fix it
- `wontfix` — real bug, chosen not to fix (reason recorded)
- `notabug` — reviewer was wrong, verified in production
- `deferred` — will fix later (blocker named)

---

## Pattern D — Phase 5 column drift + Phase 1 schema assumptions

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (1 real fix landed, 1 wontfix, 3 notabug — see dispositions below)

### Decision log

- **2026-04-11 — Decision C: C1 (encrypted_config_json) scope**
  - **Q:** Should Commit 3 fix the adapter config builder to prefer the encrypted column?
  - **Verified via Supabase:** zero rows across all 3 live tenants (`packagesmall` 0/13, `handicraft` 0/53, `khantoys` 0/53) have values in `encrypted_config_json`, `api_key`, `api_secret`, or `config_json`. These are all pre-seeded adapter *definitions*, not configured integrations. No tenant has ever booked a shipment through this code path.
  - **Impact:** C1 is architecturally real but *pre-feature*. No user impact today. No rows at risk. The fix would ship code that never executes against real data — a worse risk than leaving it.
  - **Chose: `wontfix` with explicit documentation** in this file so whoever wires up the encrypted credentials UI finds the needed fix alongside the feature work.
  - **Side effect:** Pattern D collapses to 1 real commit + 1 documented-only entry. The review's "Pattern D unlocks half the criticals" framing was optimistic — most Pattern D criticals were unreachable in production.

- **2026-04-11 — Decision B: test strategy after hitting Phase 1 M1 block**
  - **Q:** Can Commit 2 be verified via the integration test suite (pg-batch3)?
  - **Finding:** `npx jest pg-batch3-complex.test.js` fails at seed time with
    `relation "web_order_allocations" does not exist` at
    `tests/helpers/seedSchema-pg.js:10`. This is Phase 1 finding M1
    (schema-pg.sql static snapshot FK ordering) — already flagged by the
    review as blocking every fresh-install integration test. The block is
    pre-existing on `main`, not introduced by our edits.
  - **Options considered:**
    - (1) Fix M1 first, then resume Commit 2 — pulls unplanned scope into
      Pattern D.
    - (2) Write a Vitest unit test that mounts the route on a mini-express
      with a mocked `db.query`, asserts SQL + param shape. No real DB.
    - (3) Commit untested — violates verification rule.
  - **Chose (2).** New test at
    `backend/tests/unit/routes-orders-transactions.test.js`. Mocks
    `db.query`, captures SQL and params, asserts (a) column list includes
    the three v25 columns, (b) payment_context defaults to 'billing',
    (c) param array length equals $1..$N placeholder count. 3 tests,
    1.18s runtime, 100% offline.
  - **Impact:** Phase 1 M1 lands in the backlog as a hard blocker for any
    future integration-test-backed fix. Worth lifting into its own fix
    (pg-batch suite has 22 test files blocked by it).

- **2026-04-11 — Decision A: v25 deployment state**
  - **Q:** Are live tenants at schema v25 or earlier? The review claimed
    Phase 1 storefront checkout would 500 on any schema `<v25`.
  - **Verified via Supabase:** `public`, `tenant_packagesmall`,
    `tenant_handicraft`, `tenant_khantoys` all at **v27** (two versions
    ahead of v25).
  - **Verified via `information_schema.columns`** on `tenant_packagesmall`:
    `flat_shipping_rate`, `encrypted_config_json`, `active_shipment_id`,
    `provider_ref`, `payment_context`, `webhook_event_id`, and the
    `storefront_payment_sessions` table all exist.
  - **Impact:** Phase 1 C3, `/pay`, and the courier-list queries are
    architecturally risky but *currently unreachable*. They drop from
    Critical to `notabug`. Scope shrinks from 5 commits to 2.

### Findings

- **Phase 5 H2** (`routes/orders.js:576` transaction INSERT missing v25 columns) → `fix`, Commit 2
  [verified 2026-04-11: columns `provider_ref`, `payment_context`,
  `webhook_event_id` exist on `tenant_packagesmall.web_order_transactions`;
  INSERT at `routes/orders.js:575-589` does not list them. Webhook handler
  at `routes/webhooks.js:94` *does* populate them on its own INSERT, so a
  POS-recorded transaction followed by a webhook creates two rows instead
  of one updated row.]

- **Phase 5 C1** (`encrypted_config_json` dead column) → `wontfix`
  [verified 2026-04-11: column exists on `courier_integrations` across
  all 3 live tenants; `routes/couriers.js:270-275` builds adapter
  config exclusively from plaintext `api_key`, `api_secret`,
  `api_base_url`, `config_json`. **BUT** zero rows on any live tenant
  have values in any credential column (packagesmall 0/13, handicraft
  0/53, khantoys 0/53). No tenant has ever booked a shipment through
  this code path. The silent-ignore behavior the reviewer flagged is
  architecturally real but unreachable.
  **Action required when this feature is built:** whoever wires up the
  encrypted credentials UI must also update `routes/couriers.js:270-275`
  to prefer `encrypted_config_json` (decrypt via `services/crypto.js`)
  with plaintext fallback. Not fixing now to avoid shipping unexercised
  code paths, which is its own bug-introduction risk. See Decision C.]

- **Phase 1 C3** (`services/quote.js:199` reads `flat_shipping_rate`) → `notabug`
  [verified 2026-04-11: `flat_shipping_rate` column present on all 3
  live tenants. The bug pattern (no schema guard, silent assumption) is
  architecturally real but not reachable in production. Not fixing per
  Decision A; re-evaluate if a legacy provisioner ever produces a fresh
  pre-v25 install.]

- **Phase 1 `/pay`** (`routes/storefront.js:852` inserts into `storefront_payment_sessions`) → `notabug`
  [verified 2026-04-11: `storefront_payment_sessions` table present on
  all 3 live tenants. Same analysis as Phase 1 C3.]

- **Phase 5 C2** (COD auto-match on `web_orders.active_shipment_id`) → `notabug`
  [verified 2026-04-11 by reading `routes/fulfillment.js:1114-1120`:
  the COD auto-match query joins on `web_orders.tracking_number`, not
  `active_shipment_id`, with a fallback on `external_order_number` at
  line 1129. The reviewer misdiagnosed the mechanism. The column
  `active_shipment_id` *is* written by `routes/couriers.js:304,332,341`
  during booking, but the auto-match never reads it. No fix required.]

### Commit plan

1. `docs(review): add fix-plan.md as living source of truth` — this file + link from FINAL-REPORT [landed `51fbfca`]
2. `fix(orders): populate v25 columns in transaction INSERT` — `routes/orders.js:575-593` + unit test at `tests/unit/routes-orders-transactions.test.js` (Vitest, mocked db, 3 tests) [landed `36bc3b0`]
3. ~~`fix(couriers): read encrypted_config_json with plaintext fallback`~~ **dropped per Decision C** — see C1 disposition above. Replaced by a docs-only commit closing Pattern D.
4. `docs(review): close Pattern D with final dispositions` — this file only.

### Test strategy

- **Vitest unit tests**, one file per fix commit, using the
  mini-express-with-mocked-db pattern. No real Postgres, sub-second runtime.
- **Integration test suite is blocked** by Phase 1 M1 (schema seed failure).
  Cannot verify via jest/pg-batch until M1 is fixed.
- **No manual scratch-DB testing** — guards dropped per Decision A.

### Deferred / documented-only

- **Schema-drift guard pattern** (`requireSchemaAtLeast(n)` or equivalent).
  The idea is valid — a storefront route or worker could refuse to serve
  if `schema_version < 25` — but there's no way to reach the failure mode
  in current production. If the legacy provisioner ever produces a fresh
  pre-v25 install, revisit.

- **Phase 1 M1 — schema-pg.sql FK ordering** is a hard blocker for the
  entire pg-batch integration test suite. Discovered 2026-04-11 when
  attempting to verify Commit 2 via `npx jest pg-batch3-complex.test.js`.
  Every test fails at seed time with `relation "web_order_allocations"
  does not exist`. Needs to be fixed as its own item before any
  future Pattern fix can use real integration tests. Tracked here
  until lifted into its own Pattern/Wave.

---

## Pattern A — Background workers bypass multi-tenant DB routing

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (4 code commits + 1 docs commit; all findings `fix` or `notabug`)

### Decision log

- **2026-04-11 — Decision D: scope of the full fix (Option 1)**
  - **Q:** Fix all Pattern A findings preventively even though production has zero data at risk, or `wontfix` like we did for C1?
  - **Context:** Unlike C1 (no UI, no data, pre-feature), Pattern A workers are *already registered and firing on schedule*. The bug is silent today but would become "subscription never renewed, customer not billed" the moment someone creates a subscription. Activation-day incident risk is real.
  - **Chose: full fix (Option 1).** 5-commit plan. Fix now while the code is fresh and the cost is limited; avoid activation-day incident pressure later.
  - **Impact:** Pattern A closes with 4 of 5 review findings fixed + 1 drive-by bug found during code reading.

- **2026-04-11 — Decision E: helper pattern for pg-boss workers**
  - **Q:** How should tenant-scoped pg-boss workers receive their scoped db? Three existing options in the codebase:
    - FBR worker: interpolate `tenant_${slug}.` into every SQL string (works but doesn't compose with service functions)
    - `forEachActiveTenant`: iterate all active tenants per poll (right for polls, wrong for per-event jobs)
    - `tenant-db-proxy-pg.js` AsyncLocalStorage: empty outside HTTP requests, throws inside workers
  - **Chose: new `workers/tenant-job-context.js` with `withTenantContext(pool, slug, fn)`.** Acquires a dedicated pool client, sets search_path, runs the callback with a scoped `db` proxy, resets search_path + releases client even on error. Service functions like `processRenewal(db, ...)` work unchanged.
  - **Rationale:** A per-event helper lets the service layer stay clean (no table-name prefixing, no per-query client churn). Security: `tenantSlug` is validated against `[a-z0-9_]` before interpolation into `SET search_path` (which can't be parameterized).

- **2026-04-11 — Decision F: job-shape split — per-event vs. poll**
  - **Q:** Do all Pattern A workers use the same helper?
  - **Answer: no.** Two job shapes:
    - **Per-event** (subscription-renewal, campaign-scheduled-send, invoice-reminder, campaign-email): workers that receive a specific `tenantSlug` in their pg-boss payload and process one unit of work. Use `withTenantContext(pool, tenantSlug, fn)`.
    - **Poll** (booking-reminders): workers that run on a fixed schedule and must iterate *all* active tenants. Use the existing `forEachActiveTenant` helper in `boot/workers.js` with a `setInterval` cadence, matching the `scheduled_catalog_changes` pattern.
  - **Impact:** Commit 3 (booking-reminders) follows a visibly different pattern than Commits 1-2. Documented in the commit message so a future reader doesn't try to unify them.

### Findings

- **Phase 3 C1 subscription-renewal** (`workers/email-worker-boss.js:358-369` — shim queries public, not tenant) → `fix`, Commit 2
  [verified 2026-04-11: `customer_subscriptions` table exists in both public and all 3 tenant schemas; `pool.query` shim at line 362 silently returned zero rows from empty public table on every job fire. Zero active subscriptions across all live tenants, so the bug was unreachable today but would fire on first real subscription creation.]

- **Phase 3 C1 campaign-scheduled-send** (`workers/email-worker-boss.js:343-355` — shim queries public) → `fix`, Commit 2
  [verified 2026-04-11: `marketing_campaigns` exists in both public and tenant schemas; same shim pattern at line 348. Would throw `Campaign not found` on first scheduled campaign fire.]

- **Phase 3 C1 invoice-reminder** (`workers/email-worker-boss.js:292-340` — direct pool.query against tenant tables) → `fix`, Commit 2
  [verified 2026-04-11: `customer_invoices` + `customer_invoice_reminders` exist in tenant schemas; worker ran `pool.query` directly with no schema prefix, so SELECT returned zero rows from empty public table. 0 pending reminders across all live tenants.]

- **campaign-email** (`workers/email-worker-boss.js:249-289`) → `fix`, Commit 2
  [**Found during code reading — not in the synthesis.** The synthesis said "three Phase 3 worker handlers" but there are four. `campaign-email` uses `pool.query` directly for both the delivery-row UPDATE and the campaign-status rollup. Same bug, same fix. Flagged as a deviation from synthesis below.]

- **Phase 4 C1 appointment reminders** (`services/booking-reminders.js:5` — dead code, unregistered) → `fix`, Commit 3
  [verified 2026-04-11: `processPendingReminders` is exported but never called; `boot/workers.js` has no reference to booking-reminders; appointments at `services/booking-services.js:39-43` insert rows into `appointment_reminders` that sit forever in `status='pending'`. Registered as a setInterval poll using forEachActiveTenant. 0 rows across all live tenants, so no user impact today.]

- **Phase 1 H2 worker-status visibility** (`routes/admin/system.js:8-35` — reads only 3 heartbeats) → `fix`, Commit 4
  [verified 2026-04-11 by reading the endpoint: response included `email`, `fbr`, `cleanup` only. The reservation, marketplace-sync workers already set their own global.__xxxWorkerStatus globals but were invisible to super-admin. Added three new reads (reservation, marketplace_sync, booking_reminder) to match.]

- **marketplace-sync-worker-boss.js lastPollAt format** (not in the review) → `fix`, Commit 4 (drive-by)
  [Found during Commit 4 verification: `marketplace-sync-worker-boss.js:77` stored `lastPollAt` as an ISO string (via `toISOString()`), but every other worker stored it as a millisecond number (`Date.now()`). The `workerInfo()` helper in `admin/system.js` computes `Date.now() - status.lastPollAt`, which with a string produces `NaN`. Exposed by Commit 4 adding marketplace_sync to the response — it would always have reported as "not running" even when healthy. Changed to `Date.now()` to match the convention.]

### Commit plan

1. `feat(workers): add withTenantContext helper for pg-boss jobs` — [landed `b9f81c6`]
2. `fix(workers): route email-worker-boss jobs through tenant context` — bundled refactor of 4 worker bodies + service signature changes + call-site updates + unit tests [landed `38b6d73`]
3. `feat(workers): register booking-reminders as tenant-aware poll job` — [landed `63e5273`]
4. `fix(admin): worker-status reads reservation/marketplace/booking-reminder heartbeats` — [landed `5414add`]
5. `docs(review): close Pattern A with final dispositions` — this update

### Test strategy

- **Vitest unit tests** for every code commit, following the patterns established in Pattern D Commit 2:
  - Commit 1: 12 tests (`workers-tenant-job-context.test.js`) — helper happy path, error release, transaction rollback, slug validation
  - Commit 2: 9 tests (`workers-email-worker-boss.test.js`) — defensive throws + end-to-end worker→helper→fake-pool chain
  - Commit 3: 5 tests (`services-booking-reminders.test.js`) — direct test of `processPendingReminders(db, boss)`
  - Commit 4: 5 tests (`routes-admin-worker-status.test.js`) — mini-express + heartbeat globals + response shape
- **Real Postgres integration tests still blocked** by Phase 1 M1 (schema seed failure) — same as Pattern D.
- **Vitest `vi.mock()` interop with CommonJS `require()` is unreliable in this repo** — I learned this the hard way in Commit 2's test after spending time debugging a mock that never intercepted. Works for built-in modules and simple factories; fails silently for user-code service mocks. The workaround is to let real modules run against fake injected dependencies (pool, boss) — which turns out to be a better test anyway because it exercises the whole chain end-to-end.

### Deferred / documented-only

- **processRenewal transaction wrapping** — `processRenewal` does 5 sequential INSERTs + 1 UPDATE without a transaction. A crash mid-renewal could produce an invoice row with no subscription_runs, or a subscription with an advanced period but no invoice. This is Pattern E territory (multi-step business flows lacking transactions), not Pattern A. Leave for Pattern E work.
- **Resend send + DB update atomicity** — the refactored `campaign-email` worker sends the email *outside* `withTenantContext` (to hold the pool client for a shorter window), then updates the delivery row inside. If the DB update fails after a successful send, pg-boss retries, which sends the email again. This was true before Pattern A and is still true after — not changed to avoid behavior drift. Revisit when someone reports duplicate emails.
- **SMS channel in booking-reminders** — `processPendingReminders` marks SMS-channel rows as `sent` without actually delivering them (no SMS send code exists). Pre-existing quirk, out of Pattern A scope. Will need attention when the SMS feature is actually wired up.

---

## Deviations from synthesis

Running log of where we've diverged from the reviewer findings, with dates and reasons:

- **2026-04-11 — Phase 5 C2 → `notabug`**: synthesis claimed COD auto-match joined on `web_orders.active_shipment_id`. Actual code in `routes/fulfillment.js:1114-1120` joins on `tracking_number`. Reviewer misdiagnosed the mechanism.
- **2026-04-11 — Pattern D scope 5→2 commits**: after verifying all live tenants at v27, Phase 1 C3 + `/pay` + courier-list guards dropped to `notabug`. Only Phase 5 H2 and C1 remain as actionable fixes.
- **2026-04-11 — Test format switched from integration (Jest) to unit (Vitest)**: pg-batch suite is currently broken at the seed-schema step due to Phase 1 M1. Rather than fix M1 as an unplanned prerequisite, we switched to Vitest unit tests for Commits 2 and 3. Trade-off: doesn't exercise real Postgres; mitigated by verifying column existence live via Supabase before each commit.
- **2026-04-11 — Phase 5 C1 dropped to `wontfix`**: production verification showed zero credential data on any tenant (`encrypted_config_json`, `api_key`, `api_secret` all empty). The silent-ignore bug is architecturally real but unreachable. Fixing it now would ship unexercised code protecting an unused feature. Documented the required fix for the future UI author. See Decision C.
- **2026-04-11 — Pattern D final tally**: 1 commit landed (Phase 5 H2), 1 `wontfix` (Phase 5 C1), 3 `notabug` (Phase 1 C3, Phase 1 /pay, Phase 5 C2). The review's original framing was "Pattern D unlocks half the criticals" — actual: 1 real critical in production out of 5 claimed. Verification-before-completion saved ~4 commits of unnecessary work.
- **2026-04-11 — Pattern A: fourth broken worker discovered**: the synthesis listed three broken workers in `email-worker-boss.js` (subscription-renewal, campaign-scheduled-send, invoice-reminder). Reading the actual code for Commit 2 revealed a fourth — `campaign-email` at lines 249-289 — with the exact same `pool.query` direct-to-public bug. Fixed as part of Commit 2. Good reason for the rule "always verify against actual code, not the review summary."
- **2026-04-11 — Pattern A: per-event vs. poll job shape split**: the synthesis said "Single helper `withTenantContext(slug, fn)`" for all Pattern A workers. Reality is two shapes — per-event (withTenantContext) and poll (forEachActiveTenant). The two helpers exist for different reasons and can't unify without a third helper that handles both. Documented as Decision F.
- **2026-04-11 — Pattern A: drive-by fix to marketplace-sync-worker-boss.js**: found while verifying Commit 4 that `lastPollAt` was stored as an ISO string instead of milliseconds. Breaks `Date.now() - status.lastPollAt` with NaN. Exposed by Commit 4 but pre-existing; fixed in the same commit since Commit 4 was the first time anyone would see the broken state.
- **2026-04-11 — Pattern A final tally**: 4 code commits landed (Commits 1-4) + 1 docs commit (Commit 5). All 5 review findings fixed plus 1 drive-by bug found during code reading. Zero `wontfix`, zero `notabug` — unlike Pattern D, Pattern A's bugs were all genuinely broken code paths that just didn't have users yet. The activation-day-incident argument for Option 1 (full fix) held up: fixing now while the code is fresh was cheaper than fixing later under pressure.
