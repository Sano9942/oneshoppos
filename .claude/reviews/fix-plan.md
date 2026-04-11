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

- ~~**Phase 1 M1 — schema-pg.sql FK ordering**~~ **lifted into its own
  Pattern M1 below (closed 2026-04-11).**

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

## Pattern M1 — schema-pg.sql cannot be applied end-to-end

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (1 bundled fix + docs commit; full-audit scope — 3 bugs in one file)

### Decision log

- **2026-04-11 — Decision G: scope expansion from 1 bug to 3 after live verification**
  - **Q:** Does "M1 schema-pg.sql FK ordering" stop at the one known symptom (`web_order_allocations`), or do we sweep the whole file for the same class of bug?
  - **Context:** Before starting the fix I delegated an Explore scan across the 3142-line file for all forward-reference FKs. It reported two candidates: picklist_items → web_order_allocations (the known one) and web_orders → courier_integrations. Reading the second in context revealed courier_integrations is actually defined *twice* (lines 1068 and 1170) — the scan hit the second copy, but the first already satisfies the FK. Not a forward reference; a duplicate table. Cleanup opportunity, not a bug.
  - **Then live verification surfaced a third bug the scan missed**: `ALTER TABLE payment_intents` at schema-pg.sql:3075 targets a *master-schema* table from within a *tenant-schema* context. `payment_intents` is only defined in `master-db-pg.js` and `migrate-pg.js` — schema-pg.sql has no `CREATE TABLE payment_intents`. The ALTER tries to resolve the unqualified name in `tenant_<slug>` and fails with `relation "payment_intents" does not exist`. This only became visible after fixing the first two bugs (the scratch apply got far enough to hit it).
  - **Chose: bundle all three into one commit** per the "bundled" answer to the pre-fix 3-question discipline. All three are in the same file, all are schema-pg.sql hygiene, all are proved safe by the same verification (fresh apply + unchanged test outcomes on main). Splitting into three commits would add ceremony without adding reviewability.
  - **Impact:** Pattern M1 grew from 1 bug to 3. This is exactly why the "full verification before commit" rule exists — if I had fixed only the allocation_id FK and committed, the next person to touch schema-pg.sql would have hit the payment_intents bug in isolation and wondered why.

- **2026-04-11 — Decision H: commit the verification script as a drive-by utility**
  - **Q:** Do we commit the `verify-schema-apply.js` script I wrote to reproduce the failures?
  - **Context:** The script is 35 lines, does a throwaway schema apply that mirrors what `tenant-provisioner-pg.js` does, and is the only automated way to catch this class of bug before the integration test suite catches fire. No existing script does end-to-end apply.
  - **Chose: commit it** alongside the fix. Added a CLAUDE.md entry under `backend/scripts/` describing when to run it ("after any edit to schema-pg.sql"). Leaving it uncommitted means the next person rediscovers this work.
  - **Followup not taken:** adding this to CI as a pre-merge check would prevent regression permanently, but that's Wave 2+ territory. Flagged here for future consideration.

### Findings

- **Phase 1 M1a** — `picklist_items.allocation_id REFERENCES web_order_allocations(id)` at `schema-pg.sql:1736` (old line) with target defined 92 lines later at `:1828` (old line) → `fix`, bundled commit
  [verified 2026-04-11: `DROP SCHEMA IF EXISTS tenant_m1_test CASCADE; CREATE SCHEMA tenant_m1_test; SET search_path = tenant_m1_test; <apply file>` fails with `relation "web_order_allocations" does not exist`. Introduced by commit `c91406b` (Apr 9, "feat(omnichannel): connect storefront shipping orders to picklist flow") which added the column without reordering. Fixed by moving the `CREATE TABLE web_order_allocations` + its two indexes from after `inventory_reservations` to immediately before the `-- Fulfillment (Pick/Pack/Dispatch)` section. Preserved the semantic grouping of `picklists` + `picklist_items` + `loadsheets` + `loadsheet_orders` by moving the lighter block (allocations) rather than the heavier group.]

- **Phase 1 M1b** — duplicate `courier_integrations` block at `schema-pg.sql:1168-1197` (old lines) → `fix`, bundled commit (cleanup)
  [verified 2026-04-11: `CREATE TABLE IF NOT EXISTS courier_integrations` and its seed `INSERT ... ON CONFLICT DO NOTHING` appear twice in the file, at lines 1068-1095 and 1170-1197. The second is a silent no-op today, but the two blocks will drift if someone edits only one copy. Deleted the second block (32 lines removed). Not strictly an M1 bug since the table is always defined by the first occurrence, but it's in-scope file hygiene with the same verification.]

- **Phase 1 M1c** — stray `ALTER TABLE payment_intents` at `schema-pg.sql:3075` (old lines) → `fix`, bundled commit
  [verified 2026-04-11 after M1a+M1b were fixed: scratch apply still failed with `relation "payment_intents" does not exist`. `payment_intents` is a **master-schema** table defined only in `master-db-pg.js:104` and `migrate-pg.js:390`. schema-pg.sql has no `CREATE TABLE payment_intents` — the provider/provider_status/last_event_at extension at line 3075 was copy-pasted from the v11 migration into the wrong file. Deleted the ALTER (5 lines removed). Live tenants are unaffected because `migrate-pg.js` applied this ALTER to the public schema directly when v11 ran. Not in the original Explore scan because the scan was looking for `REFERENCES <later_table>` patterns, not `ALTER TABLE <master_table>` leaks.]

- **Drive-by** — added `backend/scripts/verify-schema-apply.js` + CLAUDE.md entry
  [end-to-end smoke test for schema-pg.sql. Drops+creates throwaway schema `tenant_m1_test`, sets search_path, runs `client.query(SCHEMA_SQL)`, counts created tables, drops the schema. Same code path as `tenant-provisioner-pg.js:58`, so this catches exactly the class of bug that breaks fresh tenant provisioning. Run: `node backend/scripts/verify-schema-apply.js`. Documented in `backend/scripts/CLAUDE.md`.]

### Commit plan

1. `fix(schema): apply schema-pg.sql end-to-end — 3 bugs + verification script` — bundled single commit covering M1a/M1b/M1c + `verify-schema-apply.js` + CLAUDE.md entry.
2. `docs(review): close Pattern M1 with final dispositions` — this file only.

### Test strategy

- **Live scratch-apply via `verify-schema-apply.js`**: the authoritative test, because it's a byte-for-byte match of what `tenant-provisioner-pg.js` does in production for new tenant signup. After fix: `[OK] schema applied cleanly. 213 tables created.`
- **Previously-blocked integration tests**:
  - `pg-batch3-complex.test.js`: **55/55 passing** (was blocked at seed time on main — 0 tests could run).
  - `pg-batch1-crud.test.js`: **passing** (was blocked at seed time on main).
  - `pg-batch12-billing.test.js`: **60/64 passing** — the 4 failures are pre-existing on main (`git stash` + re-run on main gave the same 4/29 pattern), not regressions. Our fix reached **35 more tests than main could reach** (64 attempted vs 29 attempted before seed failure blocked the rest).
- **No production state to verify**: M1 only affects fresh tenant provisioning. Live tenants (packagesmall, handicraft, khantoys) are at v27, built incrementally via `migrate-pg.js`, and were never apply-tested against `schema-pg.sql`. Their schemas are correct regardless.

### Deferred / documented-only

- **CI pre-merge check** that runs `verify-schema-apply.js` — would prevent future recurrences of this exact class of bug permanently. Left for a later Wave because (a) adding CI scope here drifts from the "fix bugs, don't redesign pipelines" rule, (b) GitHub Actions DATABASE_URL provisioning is non-trivial and would need a separate Supabase branch. The script is committed and documented, so a future CI task has everything it needs.

- **Fresh-tenant regression test**: the real end-to-end check would be `tenant-provisioner-pg.js --slug m1_smoke_test --name test --pin 9999` against production Supabase, then immediately delete the tenant. Not done in this session because provisioning a real tenant touches `public.tenants` and `admin_activity_log`, creating cleanup work. `verify-schema-apply.js` covers the schema-apply portion without touching public tables, which is the only part of provisioning M1 affects.

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
- **2026-04-11 — Pattern M1 scope expanded from 1 bug to 3**: the Phase 1 review flagged M1 as a single FK-ordering issue (`picklist_items` → `web_order_allocations`). Full-file verification surfaced two more bugs that broke the same code path: a duplicate `courier_integrations` block (silent no-op, not a production bug but drift risk) and a stray `ALTER TABLE payment_intents` that leaked from `migrate-pg.js` v11 into `schema-pg.sql` (real bug — `payment_intents` is master-schema-only, so the ALTER fails inside any tenant schema context). All three landed in one bundled commit. The review underestimated the scope by 2×.
- **2026-04-11 — Pattern M1: Explore scan missed the third bug**: the pre-fix Explore agent search specifically looked for `REFERENCES <later_table>` patterns. The third bug was a *cross-schema table leak* from an `ALTER TABLE` — a different pattern the scan wasn't designed to catch. Lesson for future scans: don't trust a grep-shaped scan to find the last bug of a given class; always finish with a scratch apply against real Postgres. `verify-schema-apply.js` was written to make this cheap for next time.
- **2026-04-11 — Pattern M1: integration test unblock quantified**: pg-batch3-complex went from 0 tests runnable (seed crash) → 55/55 passing. pg-batch12-billing went from 29 tests attempted → 64 attempted (35 newly-reachable). The 4 pre-existing pg-batch12 failures are billing-code issues unrelated to M1 and verified to exist on `main` via `git stash` + re-run. M1 is the single biggest integration-test unlock on this branch so far.
