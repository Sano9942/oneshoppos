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

# Wave 2 — Independent critical findings

With M1 unblocking the integration test suite, Wave 2 tackles the remaining
review criticals one by one with real Postgres verification. Each Pattern
below was scoped via the 3-question approval discipline before any code.

---

## Pattern Phase 2 C3 — SQL injection in scheduled_catalog_changes worker

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (3 commits: fix + test + docs)

### Decision log

- **2026-04-11 — Decision I: refactor scope (Option B over Option A)**
  - **Q:** Inline the allowlist check in `boot/workers.js` (Option A, minimal scope) or extract a service (Option B, same shape as Pattern A Decision E)?
  - **Chose: Option B.** Extract `applyScheduledChange(db, change)` into `backend/services/catalog-scheduler.js`. Three reasons: (1) testability — the worker is currently wrapped in a 60s `setInterval`, unit-testable only if the body becomes a pure function; (2) convention — Pattern A Decision E already established "worker loop = thin caller, logic = testable service" and doing it again here makes the pattern stick; (3) `boot/workers.js` is already 250+ lines of loop+logic soup, any bug added inline is pure cost.
  - **Impact:** ~35 new lines (service file) traded for 23 fewer lines in `boot/workers.js`. Net +1 small file, +7 unit tests that directly exercise the exact line where the injection lived.

- **2026-04-11 — Decision J: use Zod + `validate()` middleware, not a hand-rolled allowlist**
  - **Q:** Create `backend/shared/catalog-scheduler-fields.js` (initial plan, influenced by stale CLAUDE.md claiming `shared/` was reserved) or follow the codebase convention?
  - **User correction:** "The claude md files are old and stale please do research on code first instead of assumptions."
  - **Verified via live codebase grep:** `schemas/smart-collections.js:4` is the exact template — `field: z.enum([...])` for user-picks-a-column allowlists. `middleware/validate.js` already turns Zod errors into 400 `{error, details}`. 23 existing schema files use `validate(Schema)` via `bookings.js` / `auth.js` / etc. There is no parallel allowlist pattern in the codebase.
  - **Chose:** create `backend/schemas/scheduled-changes.js` as a normal Zod schema file, export `PRODUCT_FIELDS` and `VARIANT_FIELDS` arrays so the service can reuse them. Deleted the stray `backend/shared/` directory. This matches the "grep the codebase, not the docs" rule.

- **2026-04-11 — Decision K: allowlist membership — numbers + status + tags only**
  - **Chose the set:** `products`: price, cost_price, compare_at_price, stock, status, min_qty, max_qty, tags, vendor, product_type. `product_variants`: price, cost_price, compare_at_price, stock, barcode, weight.
  - **Deliberately excluded:** `name`, `sku` (scheduled renames break reporting joins and barcode lookups — should be interactive edits, not timers). `description_html` (stored XSS vector — renders on public product pages). FKs (`category_id`, `brand_id`, etc.) — require coordinated table edits. Timestamps and computed columns (`avg_rating`, `review_count`) — machine-managed.
  - **Rationale:** the feature the June 9 packagesmall rows actually use is "seasonal pricing / stock adjustments on a timer," not "generic field editor on a timer." The allowlist matches the narrow feature intent.

- **2026-04-11 — Decision L: defense in depth at both route and worker**
  - **Chose:** validate the allowlist once at the route (Zod `.superRefine()` cross-field check) AND re-validate inside the service (`applyScheduledChange` re-checks before building the SQL). Reason: the worker reads rows that may have been inserted days/weeks ago by code that has since been reverted, or via a non-route path (manual DB edit, future migration, direct INSERT). Service-layer check closes the window.

### Findings

- **Phase 2 C3** — `boot/workers.js:232` and `:234` interpolate `change.field_name` directly into `UPDATE` SQL → `fix`, 3-commit plan
  [verified 2026-04-11:
  • Bug exists in production code at the flagged lines.
  • Route `routes/scheduled-changes.js:33-54` performs zero validation on `field_name` — raw `req.body.field_name` flows directly to `INSERT`.
  • Production state: packagesmall has `phase2_scheduled_changes` feature flag **enabled** and **3 pending rows** (all benign — `field_name='price'`, `new_value='799'`, scheduled for June 9). Handicraft and khantoys have the flag disabled with zero rows.
  • Worker env: `SCHEDULED_CATALOG_WORKER_ENABLED` is **not set** in Railway production (verified via `railway variables`) — worker is currently off.
  • **Exposure shape: dormant.** Rows queue up indefinitely. Activation-day incident risk: the moment someone turns on the worker env (likely when packagesmall notices the June 9 prices haven't fired), every pending row runs its `field_name` as SQL. Pattern A Decision D "activation-day-incident" argument applies.]

- **DB CHECK constraint mismatch on `change_type` enum** → `fix`, drive-by (bundled into test commit)
  [verified 2026-04-11: `schema-pg.sql:2124` has CHECK `change_type IN ('price','visibility','status','tax')`. The initial Zod schema in fix commit used `['field_update','price','status','stock']` — copied from the review's repro example without verifying against the DB contract. Mismatch would have allowed valid Zod POSTs that 500'd at INSERT. No production rows affected (only `price` used by any tenant) but the contract was wrong. Fixed in the test commit where the integration test exposed it.]

- **Zod 4 API compat — `.refine()` dynamic message function form dropped** → `fix`, drive-by (bundled into test commit)
  [verified 2026-04-11: Zod 4 silently ignores the `(val) => ({message, path})` function form of `.refine()`'s second argument. Parses fine, emits generic "Invalid input" instead of the custom dynamic message. Discovered when the integration test expected `body.error` to match `/field_name/i` and got "Invalid input". Fixed by switching to `.superRefine((val, ctx) => ctx.addIssue({...}))` which is the Zod 4 pattern for dynamic cross-field messages. The `validate()` middleware already surfaces `issues[0].message` as `body.error`, so UX side is unchanged once the schema emits a meaningful message.]

### Commit plan

1. `fix(catalog-scheduler): allowlist field_name to prevent SQL injection` — [landed `ef1dc76`]
   - New: `backend/schemas/scheduled-changes.js` (Zod schema + exported allowlist arrays)
   - New: `backend/services/catalog-scheduler.js` (`applyScheduledChange(db, change)`)
   - Modified: `backend/routes/scheduled-changes.js` (uses `validate()` middleware)
   - Modified: `backend/boot/workers.js` (worker body replaced with service call)
   - Modified: `backend/schemas/CLAUDE.md`, `backend/services/CLAUDE.md` (sub-guide entries; services guide count corrected 9→31 and flagged for `/update-docs` refresh)
2. `test(catalog-scheduler): unit + integration tests for allowlist enforcement` — [landed `76045cb`]
   - New: `backend/tests/unit/services-catalog-scheduler.test.js` (7 Vitest tests, ~650ms)
   - New: `backend/tests/integration/pg-batch13-catalog-scheduler.test.js` (11 Jest + Postgres tests, ~9s)
   - Bundled drive-by fixes: schema `change_type` enum (DB CHECK match) and `.refine()` → `.superRefine()` (Zod 4 API)
3. `docs(review): close Phase 2 C3 with final disposition` — this update

### Test strategy

- **Vitest unit** (`tests/unit/services-catalog-scheduler.test.js`): injects fake db with recording `query()` + a `transaction()` that routes through a fake client. Tests exercise `applyScheduledChange(db, change)` directly with 7 scenarios — valid product/variant, non-allowlisted field, injection-shaped field, cross-field (status on variant), unknown entity_type, simulated UPDATE failure. Critical assertion: for the injection-shaped input, scan **every** recorded query and prove none contain `"UPDATE products"` or the malicious metacharacters.
- **Jest integration** (`tests/integration/pg-batch13-catalog-scheduler.test.js`): creates isolated Postgres schema with the real `scheduled_catalog_changes` DDL + CHECK constraints, mounts `routes/scheduled-changes.js` via supertest. 11 tests cover happy paths, allowlist rejects (id, deleted_at, description_html), cross-field, entity_type='bogus', change_type='field_update' (not in DB CHECK), scheduled_at in past, and injection-shaped field_name with row-count verification (confirms zero rows inserted on reject).
- **Both test suites passing**: 7/7 + 11/11 = 18/18. Combined runtime under 10s. Real Postgres verification is possible *because* M1 (Pattern M1) unblocked the pg-batch suite the same day.

### Deferred / documented-only

- **Worker does not exist in Railway env**: `SCHEDULED_CATALOG_WORKER_ENABLED=1` is a flip away from making this feature live. When that happens, the scheduled-changes feature should be re-tested end-to-end (not just the guard tests) against the 3 packagesmall pending rows.
- **`collection` and `price_list` entity_types are allowed by the DB CHECK but blocked by Zod**: the DB allows `entity_type IN ('product','variant','collection','price_list')` but my schema only accepts `product` and `variant`. The worker never handled the other two anyway (original inline if/else marked them failed). Narrowing is deliberate and safe — doesn't break existing rows — but if someone wants to extend the feature to collections or price lists, they'll need to extend both the Zod schema and the service resolver.
- **Feature flag `phase2_scheduled_changes` enabled on packagesmall only**: no action needed; just a reference for future debugging.

---

## Pattern Phase 4 C2 — QR source_token_id never populated

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (3 commits: fix + test + docs)

### Decision log

- **2026-04-11 — Decision M: Option B scope (service + split + migration, no route gate)**
  - **Q:** Minimal fix (Option A), tight fix with defense-in-depth (Option B), or wide fix with new `/qr` endpoint (Option C)?
  - **Chose: Option B.** `createRestaurantCheck` + `splitCheckByItem` + migration v28 + schema-pg.sql mirror. Rationale: split path has the same bug class and is cheaper to fix bundled; partial UNIQUE index is safe-additive (column is empty on all live tenants) and prevents future token collisions for near-zero cost; new `/qr` route in Option C would preempt a frontend design question I shouldn't answer unilaterally.

- **2026-04-11 — Decision N: drop public-route feature flag gate after codebase research (mid-implementation scope correction)**
  - **Q:** Should the public-restaurant route include `requireFeature('phase4_restaurant_qr')`?
  - **Initial plan:** yes, as a defense-in-depth gate.
  - **Codebase research:** grepped `routes/public-bookings.js` and `routes/storefront.js` (the only other public-before-auth routes). Neither gates by feature flag. Zero precedent for public-route feature gating in the codebase. Adding it only here would create a one-off asymmetric pattern — either we gate all public routes (scope creep, touches 2 unrelated files) or we gate none.
  - **User correction earlier in the session:** "the claude md files are old and stale please do research on code first instead of assumptions." Applied here: don't invent security patterns not present in the codebase.
  - **Chose: drop the gate.** Natural gate: "no token was written if the flag-writer didn't populate one." The token generation is unconditional on the write side (always populated for `dine_in`/`bar`) but the public URL only exists if a specific tenant workflow produces it. A tenant with the flag off won't have a front-end path that calls the QR URL, and a lookup with no token simply returns 404 (which it already did). Documented as a deviation.
  - **Alternative considered:** also querying `feature_flags` inside `createRestaurantCheck` to gate token generation at write time. Rejected: adds a DB round-trip to a hot path; the column is harmless when unused; future-proofs retroactive flag flips.

- **2026-04-11 — Decision O: include migration v28 partial UNIQUE index in the fix commit**
  - **Q:** Does the migration belong in the same commit as the service/schema fix, or separate?
  - **Chose: same commit.** Migration is strictly motivated by the fix (prevents collisions on the column we just started populating). Safe-additive: zero rows on any tenant have `source_token_id IS NOT NULL`, so `CREATE UNIQUE INDEX` runs against an empty column — no lock contention, no downtime, no data migration. A separate migration commit would have no visible "why" in its diff. Same reasoning as Phase 2 C3 Decision I (bundle motivation-linked changes).

- **2026-04-11 — Decision P: append tests to existing `pg-batch13-restaurant.test.js` instead of creating a new `pg-batch14-restaurant-qr.test.js`**
  - **Q:** New test file or extend the existing one?
  - **Verified via live `ls`:** `pg-batch13-restaurant.test.js` and `pg-batch14-bookings.test.js` already exist from main. Phase 2 C3 added `pg-batch13-catalog-scheduler.test.js` (naming collision on `13-` I didn't catch at the time). Creating yet another `pg-batch1x-restaurant-qr.test.js` would multiply the confusion.
  - **Chose: append to `pg-batch13-restaurant.test.js`.** Reuses the existing fixture scaffolding (feature flags seeded, routes mounted, table/floor-plan/session created), co-locates related tests, avoids a third filename cluster. The `describe("QR ordering — source_token_id lifecycle", ...)` block is clearly attributable to Phase 4 C2 via its name.
  - **Flagged for future cleanup:** the two `pg-batch13-*` filename collision (restaurant + catalog-scheduler) is a minor hygiene problem I introduced in Phase 2 C3. Not urgent but worth revisiting when the next wave renames test files or when someone runs `jest pg-batch13` and gets two unrelated suites.

### Findings

- **Phase 4 C2** — `routes/public-restaurant.js:17` and `:70` query `WHERE d.source_token_id = $1`, but no code writes the column → `fix`, 3-commit plan
  [verified 2026-04-11:
  • `grep -rn source_token_id backend/` shows 2 reads and 0 writes in live code (outside the migration/schema column definition).
  • `createRestaurantCheck` at `services/restaurant-checks.js:6-16` inserts into `draft_orders` without the column. `splitCheckByItem` at `:75-79` has the same omission.
  • Frontend grep for `source_token_id|qr_url|qr_token` returns zero hits — no UI surfaces the token today.
  • Production state: packagesmall has `phase4_restaurant=true` AND `phase4_restaurant_qr=true` (both enabled), but `tenant_packagesmall.draft_orders` has 0 rows in `order_context IN ('dine_in','bar')` and 0 rows with a non-NULL token. handicraft and khantoys have both flags disabled.
  • Worker env: `SCHEDULED_CATALOG_WORKER_ENABLED` not set — unrelated; no env var gates this feature. The only runtime gate is the two feature flags.
  • **Exposure shape**: feature is flag-live on packagesmall but code is dead. The first real dine-in check + QR scan would 404. Pattern A Decision D activation-day-incident shape.]

### Commit plan

1. `fix(restaurant): populate source_token_id on checks + splits (Phase 4 C2)` — [landed `9dc9846`]
   - Modified: `backend/services/restaurant-checks.js` (new `TOKEN_CONTEXTS` set, `makeSourceToken` helper, applied to both `createRestaurantCheck` and `splitCheckByItem`)
   - Modified: `backend/migrate-pg.js` (new migration v28 with partial UNIQUE index)
   - Modified: `backend/schema-pg.sql` (mirrors the new index after the existing `ALTER TABLE draft_orders` block)
   - Scope correction from Decision N documented in the commit trailer.
2. `test(restaurant): QR source_token_id lifecycle (Phase 4 C2)` — [landed `e2a1641`]
   - 8 new tests appended to `pg-batch13-restaurant.test.js` as a new `QR ordering — source_token_id lifecycle` describe block.
   - Two documented scaffolding subtleties: `MULTI_TENANT` env override (so `resolvePublicTenantDb` short-circuits to `deps.db`), and direct `UPDATE draft_orders SET table_id` (because `createCheckSchema` doesn't accept `table_id`, but the public menu JOIN requires it).
3. `docs(review): close Phase 4 C2 with final disposition` — this update.

### Test strategy

- **Integration only, real Postgres** via `pg-batch13-restaurant.test.js` + `createTestApp()` factory. No unit tests — the logic is "branch on order_context, generate UUID, pass through INSERT," which isn't interesting in isolation. The partial UNIQUE index is enforcement-infrastructure — unit-testing Postgres's UNIQUE constraint behavior is pointless.
- **Coverage shape** (8 tests): 5 write-path tests (dine_in / bar / takeout / delivery / uniqueness), 1 split-path test, 2 public-route tests (valid-token 200, bogus-token 404).
- **Scope-correction impact on test count**: started at 9 tests, dropped to 8 after removing the `phase4_restaurant_qr=off → 403` test (per Decision N, no gate was added).
- **Regression check**: Phase 2 C3's `pg-batch13-catalog-scheduler.test.js` — 11/11 still passing after the `restaurant-checks.js` edit. The `_catalog_scheduler_` file is completely unrelated to `_restaurant_` work, but both mount routes against a shared-pool test factory and I wanted to be sure.
- **Results**: 35/35 (27 pre-existing restaurant tests + 8 new QR tests) in 61s. All 8 new tests passed on the third iteration — first iteration (pre-env-fix) was 33/35, second (post-env-fix) was 34/35, third (after fixing the JOIN-on-table_id scaffolding) was 35/35.

### Deferred / documented-only

- **Frontend QR rendering**: no frontend component references `source_token_id` today. The fix produces the token server-side; whoever builds the "print QR code from tablet" UI needs to: (a) read `source_token_id` from the `createRestaurantCheck` response body, (b) construct `${PUBLIC_URL}/menu/${source_token_id}?tenant=${slug}` client-side, (c) render as QR via any library. No new backend route needed.
- **`createCheckSchema` doesn't accept `table_id`**: separate pre-existing quirk. The route takes `table_session_id` and leaves `draft_orders.table_id` NULL. The public menu query JOINs on `table_id`, so in practice the JOIN will fail for any check created through the POST route unless something *else* populates `table_id` later. Test 7 works around this via `UPDATE draft_orders SET table_id` as test scaffolding. A real fix would either derive `table_id` from `table_session_id` inside `createRestaurantCheck`, or add `table_id` to `createCheckSchema` with a foreign-key-existence check. Out of scope for Phase 4 C2 — this is a separate bug in the restaurant write path that the reviewer didn't flag.
- **pg-batch13 filename collision**: Phase 2 C3 created `pg-batch13-catalog-scheduler.test.js` while `pg-batch13-restaurant.test.js` already existed. Minor hygiene problem. Not fixed here because renaming a committed test file would create git history noise. Revisit during the next test-file reshuffle.
- **Feature flag `phase4_restaurant_qr` gate on the write side**: could be added inside `createRestaurantCheck` to suppress token generation when the flag is off. Skipped because querying the flag adds a DB round-trip to a hot path and the column is harmless when unused. See Decision N.

---

## Pattern Phase 4 C3 — KDS JOIN fan-out

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (3 commits: partial fix + revised junction fix + docs — scope corrected mid-implementation)

### Decision log

- **2026-04-11 — Decision Q: Option 1 (per-course ticket) over Option 2 (junction table) — LATER REVERSED**
  - **Initial Q:** "Which review direction to take — one-ticket-per-(draft_order, station, course) or add a `kds_ticket_items` junction table?"
  - **Initial chose: Option 1.** Reasoning at the time: the frontend UI (`KDSRedesign.jsx:134`) already renders one bump button per ticket with an items array underneath — per-item state from a junction table would be wasted. No schema change, no migration. `bumpTicket` already assumes "one ticket = one kitchen unit of work" so the grouping would clean up a pre-existing inconsistency.
  - **Committed as `3155263`** — `sendToKitchen` rewritten to group items by `(station_id, course_name)` and INSERT one ticket per group.
  - **Reversed by test 2**: the test asserted that station A's ticket contains only its own 2 items (Widget A+B, category 1) and station B's ticket contains only its 1 item (Snack D, category 2). Actual result: both tickets contained all 3 items. **The fix was incomplete.** `getTickets`'s read-side JOIN at `restaurant-kds.js:133-134` joins `draft_order_items di ON di.draft_order_id = kt.draft_order_id AND di.course_name = kt.course_name` — no station filter. So even with one ticket per station, the JOIN pulled every item in that course onto every station's ticket. The review's Option 1 direction only fixed the write side; the read side still fanned out.
  - **Key insight**: the reviewer implicitly assumed the JOIN would know about station routing, but neither the JOIN nor the underlying data model supports that without either (a) denormalizing `station_id` onto `draft_order_items` or (b) adding a junction table. The review omitted this.
  - **Pivoted to Option 2** (see Decision R below) after stopping the implementation and checking in with the user.

- **2026-04-11 — Decision R: revised scope after test 2 exposed the read-side gap**
  - **Q:** Revert `3155263` and ship a clean single commit, or leave it and add the junction-table fix on top?
  - **User chose:** leave `3155263`, add the junction fix on top.
  - **Rationale:** the user's blanket rule is "never amend, always new commit." Reverting would require a revert commit anyway. Adding on top preserves the reasoning trail — future readers see "the write-side grouping was intentional but insufficient; the junction was added as a follow-up" rather than a single mysterious commit that does both. It also matches how Pattern D and Pattern A handled scope expansion: add commits, don't retroactively edit.
  - **Cost paid:** one extra commit in history. Benefit: intellectual honesty + easier bisection if someone later wants to understand why the grouping exists.

- **2026-04-11 — Decision S: junction table shape — composite PK + second index**
  - **Q:** `SERIAL id + UNIQUE(ticket_id, draft_order_item_id)` or composite PK?
  - **Chose: composite PK** `PRIMARY KEY (ticket_id, draft_order_item_id)`.
  - **Rationale:** grep of the codebase showed `role_permissions`, `employee_outlets`, `channel_publications` all use composite keys or functional unique constraints for tight junction tables. Matches convention. Saves one column per row for a table that will never be referenced *from* anywhere else.
  - **Second index on `draft_order_item_id`**: PK covers "given a ticket, find its items" (left-anchored on ticket_id). The reverse lookup ("given this item, which tickets reference it") needs its own index. Currently unused in the codebase but costs ~1 row per item and enables reconciliation queries during future bump/recall edge cases.
  - **`ON DELETE CASCADE` on both FKs**: if either side is deleted, junction rows go with it. No dangling junction rows that would cause null-joins.

- **2026-04-11 — Decision T: JOIN defensive `FILTER ... COALESCE '[]'::json`**
  - **Q:** Can `getTickets` safely assume every ticket has junction entries?
  - **Chose: defend against empty junction.** Wrap `json_agg(...)` in `FILTER (WHERE kti.ticket_id IS NOT NULL)` and `COALESCE(..., '[]'::json)`.
  - **Reason:** without `FILTER`, a LEFT JOIN with no matching junction rows produces one output row with all NULL columns. `json_agg(json_build_object('id', NULL, ...))` then emits `[{"id":null,...}]` — a single-element array of a useless null-object that the frontend (`KDSRedesign.jsx:134`: `(ticket.items || []).map(...)`) would render as a ghost item row with empty fields. Defending now is cheap insurance against the sendToKitchen partial-failure case (Phase 4 H2 territory — outside this fix's scope) and future edge cases where a ticket might be inserted without its junction rows.
  - **Observation worth recording**: the pre-fix JOIN couldn't produce this case because `(draft_order_id, course_name)` always matched at least the items in that course. The new junction JOIN legitimately can produce an empty match. Every read-side refactor inherits new failure modes.

- **2026-04-11 — Decision U: fix test 6's fixture isolation inline instead of deferring**
  - **Q:** Test 6 fails (`expo.station_id 7 vs 2`) because `bumpTicket`'s expo-station lookup at `restaurant-kds.js:228` uses `LIMIT 1` with no `ORDER BY` and happens to pick the pre-existing "Expo Window" station (created by an earlier describe) instead of our dedicated `bumpExpoStation`. Fix it now or defer?
  - **Chose: fix now.** User explicitly approved "fix test 6" as part of the revised scope. Fix is one line in the test: `UPDATE kds_stations SET is_active = false WHERE name = 'Expo Window'` at test start. No production code change — the underlying `LIMIT 1 without ORDER BY` non-determinism is a separate issue (Phase 4 review would have flagged it as H-level at most) and out of scope for C3.

### Findings

- **Phase 4 C3 — KDS ticket-to-item JOIN fans out across stations** → `fix`, 3-commit plan
  [verified 2026-04-11:
  • `sendToKitchen` at `services/restaurant-kds.js:43-115` created one `kds_tickets` row per item (loop at line 77 with in-loop INSERT at 93-97).
  • `getTickets` at `services/restaurant-kds.js:127-140` joined `draft_order_items di ON di.draft_order_id = kt.draft_order_id AND di.course_name = kt.course_name` — no station filter.
  • Consequence: 3 items in 'main' course → 3 tickets, each ticket's aggregation includes ALL 3 items. Kitchen screen shows 3×3=9 item renderings. Bumping one ticket advances 1/3 of the state while the UI shows all 3 items gone.
  • Production state: packagesmall has `phase4_restaurant_kds` flag enabled but 0 kds_tickets and 0 kds_stations. handicraft and khantoys have flag disabled. Dormant bug — Pattern A Decision D activation-day shape.
  • Frontend consumer: `KDSRedesign.jsx:134` renders `ticket.items.map(...)` with a single bump button per ticket. This matches the ticket-per-course-per-station model Option 1 produces but doesn't match the read-side fan-out the JOIN was producing.]

- **Scope expansion discovered mid-implementation**: the initial write-side-only fix (`3155263`) left the read-side fan-out intact. Tests 2/5 expected the JOIN to respect station routing; the review direction didn't require a JOIN change. See Decision Q.

- **Test 6 fixture isolation bug** (not in the review) → `fix`, drive-by
  [verified 2026-04-11: `bumpTicket` at `services/restaurant-kds.js:218-230` picks an active expo station in the outlet via `LIMIT 1` with no `ORDER BY`. The earlier "KDS stations" describe at `pg-batch13-restaurant.test.js:301` creates an "Expo Window" station with `is_active=true` and a lower id than my dedicated `bumpExpoStation`. Postgres's `LIMIT 1` without ORDER BY is non-deterministic but in practice returns lower-id rows first, so the test routed to the wrong expo. Fixed test-side by deactivating "Expo Window" at test start. The underlying non-determinism in `bumpTicket` is a pre-existing issue outside Phase 4 C3 scope.]

### Commit plan

1. `fix(kds): collapse ticket-per-item into ticket-per-course (Phase 4 C3)` — [landed `3155263`, **incomplete fix**]
   - Modified: `services/restaurant-kds.js` (`sendToKitchen` grouping only)
   - Claimed to fix Phase 4 C3; actually fixed the write side only. Tests would have caught this if I'd run them before committing the code, but I wrote tests after. **Lesson: write at least one skeleton test for the critical assertion before committing the fix, or verify the fix runs against an existing test that would catch it.**
2. `fix(kds): add kds_ticket_items junction to complete Phase 4 C3 fix` — [landed `03b36f5`]
   - New: migration v29, schema-pg.sql mirror
   - Modified: `services/restaurant-kds.js` (sendToKitchen writes junction rows, getTickets joins via junction with FILTER/COALESCE guards)
   - Modified: `tests/integration/pg-batch13-restaurant.test.js` (new KDS ticket fan-out describe block with 6 tests, test 6 fixture isolation fix)
3. `docs(review): close Phase 4 C3 with final disposition` — this update.

### Test strategy

- **Integration only**, appended to `pg-batch13-restaurant.test.js` as a `KDS ticket fan-out — Phase 4 C3` describe block. No unit tests — the grouping is a `Map` build + loop and the JOIN rewrite is SQL, neither interesting in unit isolation.
- **6 tests:**
  1. 3 items / 1 station / main course → exactly 1 ticket with 3 items
  2. 3 items / 2 category-routed stations → 2 tickets, each with its own subset (2 items on station A, 1 on station B). **This is the test that exposed the incomplete fix.**
  3. 4 items / 1 station / 2 courses (main+dessert) → 2 tickets, each with 2 items, course-scoped
  4. Empty item list → `[]` return, 0 tickets created
  5. Two concurrent checks on same station+course → each ticket's items scoped to its own check (no cross-check fan-out)
  6. Bump→expo auto-routing with dedicated bumpPrep/bumpExpo stations
- **Runtime**: ~103s for the full 41-test file (was 61s before Phase 4 C2 tests, ~40s added for the 14 Phase 4 C2 + C3 tests combined).
- **Required env bump**: file-level `jest.setTimeout(20000)` added because KDS fan-out tests do 7+ supertest round-trips each and the default 5s ceiling is tight against remote Supabase.
- **Regression check**: all 27 pre-existing restaurant tests + all 8 Phase 4 C2 QR tests still passing after the junction changes.

### Deferred / documented-only

- **`bumpTicket` expo-station lookup non-determinism**: `SELECT ... FROM kds_stations WHERE ... LIMIT 1` without `ORDER BY` at `services/restaurant-kds.js:228`. In production with one expo station per outlet, this is harmless. In tests with multiple expo stations, it picks arbitrarily. A proper fix would `ORDER BY id LIMIT 1` or pick via explicit routing. Out of scope for Phase 4 C3 — flagged for a future KDS hygiene pass.
- **No per-item ticket state**: the junction table has only `(ticket_id, draft_order_item_id)`. If someone later wants per-item bump/ready state (kitchen marks one item ready before the others), the column can be added to `kds_ticket_items`. Not shipped today to avoid scope bloat the UI doesn't need. Pattern D Decision C lesson: don't ship unexercised code paths.
- **Phase 4 H2** (`sendToKitchen` not atomic): related but separate — the loop of INSERTs still runs outside a transaction, so a partial failure leaves orphaned tickets + junction rows. Junction changes didn't touch this; still Phase 4 H2 territory. The new FILTER/COALESCE defends the read path against the "ticket exists, no junction rows" state that partial failures could produce, which is a small incidental improvement.

---

## Pattern Phase 5 H1 — pakpost/bykea stub adapters return apparent success

**Status:** `done`
**Branch:** `review-fixes`
**Closed:** 2026-04-11 (3 commits: fix+drive-bys + test + docs)

### Decision log

- **2026-04-11 — Decision V: scope = Option B (adapter throws only, no route-level fall-through)**
  - **Q:** Option A (2-adapter throw, minimal), Option B (throw + make 501 actionable via `statusCode/code`), or Option C (sweep all 13 adapters for the same anti-pattern)?
  - **Verified via live code (all 13 adapter files):** 11 of 13 adapters (leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, dhl, fedex) make real HTTP calls and throw with `if (!res.ok) throw ...` style. Only `pakpost` and `bykea` use the defensive-null-success shape. Option C is unnecessary — no other bugs to fix in that class.
  - **Verified via Supabase MCP** on all 3 live tenants: pakpost and bykea rows have `supports_booking=false` and `enabled=false`. Dormant bug, activation-day-incident shape (same as Pattern A Decision D).
  - **Chose: Option B.** Throw with `statusCode: 501` + `code: 'COURIER_NO_BOOKING_API'` + actionable error message pointing the operator at manual entry. Do NOT add a route-level fall-through to the manual branch — that would mean the route inconsistently honors/ignores `supports_booking` depending on which error shape the adapter threw, creating asymmetric behavior. Operators should use the existing mechanism (flip `supports_booking=false` on the integrations hub row). Leave `getTracking`/`cancelShipment` alone — they return advisory shapes that the frontend renders as tracking URLs, which is correct behavior for couriers without APIs.
  - **Deferred explicitly:** P1/P2 low-pattern findings (P1: plaintext credentials in 3 route locations; P2: interface naming drift). Out of scope for H1 — separate hygiene passes.

- **2026-04-11 — Decision W: Zod validation of request bodies (user-raised question mid-approval)**
  - **Q (user):** "did you know about zod schema and did you consider this while fixing bugs?"
  - **Codebase research:** `routes/couriers.js` imports zero Zod schemas and uses zero `validate()` middleware. Every endpoint reads `req.body` directly with manual null checks. The book route at `:218` reads `{courier_id, weight}` without schema validation.
  - **Impact on H1:** none. H1 is an adapter-layer bug (adapter returns a defensive-null shape; route trusts the shape). No amount of Zod on `req.body` would catch a stub returning `{tracking_number: null}` — Zod validates inputs, not adapter outputs.
  - **Chose:** keep H1 scope at 2 adapter files + deferred note. Do NOT create `schemas/couriers.js` as part of H1. The missing-Zod-validation gap is pre-existing hygiene across ~8 courier endpoints and belongs in its own wave, not rolled into a narrow adapter fix. Same lesson as Phase 2 C3 user correction: don't invent patterns or rollouts beyond what the finding requires.
  - **Documented in the "Deferred / documented-only" section below.**

- **2026-04-11 — Decision X: bundle two drive-by route fixes discovered during testing into Commit 1**
  - **Q:** After pg-batch15 tests went red with two new errors (`FOR UPDATE cannot be applied to nullable side`, `column "name" does not exist`), fix-and-bundle or defer both?
  - **Context:** Both are pre-existing bugs in `routes/couriers.js` (lines 227 and 261) that were never caught because the book route had zero integration test coverage before pg-batch15. Both are in the exact code path H1 tests exercise. Both unreachable in production today: the FOR UPDATE bug requires a walk-in order (customer_id IS NULL) which no tenant has, and the company_name bug requires the book route to actually run (which is dormant because supports_booking=false everywhere).
  - **Chose: bundle both into Commit 1.** Same precedent as Pattern M1 Decision G (3 schema bugs bundled into one commit after full verification) and Pattern A Decision D (drive-by lastPollAt fix in Commit 4). Splitting them would create 3 commits with 1-line fixes each and fracture the "discovered while writing tests" narrative. The test file (Commit 2) would then depend on two unrelated fix commits, which complicates bisection more than bundling.
  - **Impact:** Commit 1 touches 3 files (2 adapters + `routes/couriers.js`) instead of 2. Commit message names both drive-bys explicitly so a future reader understands why the fix commit touched a third file.

- **2026-04-11 — Decision Y: file-level `jest.setTimeout(60000)` for slow beforeAll**
  - **Q:** The first real run (all schema + column bugs patched) hit a 30s beforeAll timeout because `createTestApp()` runs the full `schema-pg.sql` against remote Supabase on a cold connection (~35s).
  - **Chose:** bump to 60s at file level. Per-test budget stays tight since tests themselves are 1-2s each. Same precedent as Phase 4 C3 which bumped to 20s for 7-roundtrip tests; H1's driver is a single slow setup rather than many per-test roundtrips.

### Findings

- **Phase 5 H1** — `services/couriers/pakpost-adapter.js:9-14` and `services/couriers/bykea-adapter.js:9-16` return `{tracking_number: null, label_url: null, message: '...'}` instead of throwing → `fix`, 3-commit plan
  [verified 2026-04-11:
  • Both files confirmed to return the defensive-null shape.
  • GenericAdapter at `generic-adapter.js:4-10` returns the same shape — but pakpost/bykea are the only two adapters that inherit and don't override with a real API call. The other 11 adapters make real HTTP calls and throw on failure.
  • `routes/couriers.js:268-311` enters the `if (courier.supports_booking)` branch and blindly persists a row with `status='booked'` and null tracking.
  • `routes/couriers.js:354` fires SMS on `status==='booked' || tracking_number` — the null-tracking shipment triggers "Tracking: N/A" SMS.
  • Route outer catch at `:370` uses `err.statusCode || 500`, so throwing with `statusCode: 501` cleanly reaches the client.
  • Production state via Supabase MCP: all 3 tenants have pakpost/bykea with `supports_booking=false` and `enabled=false`. **Activation-day shape.** Bug is dormant; first tenant to flip `supports_booking=true` fires the bug.
  • Also observed: migration v25 at `migrate-pg.js:2524` explicitly excludes pakpost and bykea from the `supports_booking=true` UPDATE. Deliberate — the seed knows these are manual-entry couriers.]

- **Drive-by 1** (`routes/couriers.js:227` — `SELECT ... FROM web_orders wo LEFT JOIN customers c ON ... FOR UPDATE`) → `fix`, bundled into Commit 1
  [verified 2026-04-11: first pg-batch15 test run failed with `FOR UPDATE cannot be applied to the nullable side of an outer join`. Postgres disallows locking rows on the nullable side of a LEFT JOIN. Fixed by scoping the lock: `FOR UPDATE OF wo`. Pre-existing unreachable bug — live tenants never book orders with `customer_id IS NULL`, so the LEFT JOIN's nullable side is always empty in practice. Would fire on the first walk-in / guest checkout shipment booking. Not the H1 bug but in the same file and route path.]

- **Drive-by 2** (`routes/couriers.js:261` — `SELECT name, phone, address FROM company_profile LIMIT 1`) → `fix`, bundled into Commit 1
  [verified 2026-04-11: second pg-batch15 test run failed with `column "name" does not exist`. The canonical column is `company_name`, which is what every other route uses (grepped: `storefront.js`, `public-restaurant.js`, `public-bookings.js`, `fbr-export.js`, `admin/operations.js` all use `company_name`). Only `couriers.js:261` and `employees.js:451` use the wrong `name`. The book route's sender-info query has literally never executed successfully in production — would have 500'd on every real booking. Another pre-existing dead code path, uncovered by the same testing pass. Fixed both the SQL and the JS property name (`company.name` → `company.company_name`).]

### Commit plan

1. `fix(couriers): throw 501 from pakpost/bykea bookShipment stubs (Phase 5 H1)` — [landed `7b1c342`]
   - Modified: `services/couriers/pakpost-adapter.js` (throw with `statusCode: 501`, `code: 'COURIER_NO_BOOKING_API'`, actionable message)
   - Modified: `services/couriers/bykea-adapter.js` (same shape, different message)
   - Modified: `routes/couriers.js` (drive-by 1: `FOR UPDATE OF wo`; drive-by 2: `company_name` column + JS property rename)
2. `test(couriers): pg-batch15 integration tests for Phase 5 H1 regression coverage` — [landed `0139456`]
   - New: `backend/tests/integration/pg-batch15-couriers.test.js` (5 tests, ~41s runtime)
3. `docs(review): close Phase 5 H1 with final disposition` — this update

### Test strategy

- **Integration only, real Postgres** via `pg-batch15-couriers.test.js` + `createTestApp-pg.js` factory. This is the first integration test coverage for `routes/couriers.js` — previously zero coverage, which is why the two drive-by bugs survived undetected. No unit tests for the adapters because the logic is "throw with a specific statusCode" and unit-testing a one-line throw is pointless; the real failure mode the user cares about is "does the book route return a clean 501 with no DB side effects," which only an integration test can verify.
- **5 tests:**
  1. PakPost with `supports_booking=true` → 501 + actionable error message (matches `/Pakistan Post/i`, `/no booking API/i`, `/manual/i`).
  2. Bykea with `supports_booking=true` → 501 + actionable error message (matches `/Bykea/i`, same shape).
  3. Transaction rollback — the highest-value test. After 501: `order_shipments` empty, `web_orders.shipping_provider_status` NULL, `fulfillment_status='unfulfilled'`, `shipped_at` NULL, `active_shipment_id` NULL, `courier_id` NULL, `tracking_number` NULL. Proves the pre-fix failure mode (orphan row + tainted web_orders) cannot recur.
  4. Control — Leopards with bogus credentials → 500 (NOT 501), transaction rolled back. Proves the fix is scoped strictly to the two stubs.
  5. Control — PakPost with `supports_booking=false` → 200, manual fallback branch at `:314` still works. This is the production shape today — proves the fix doesn't disturb the currently-working path.
- **Result:** 5/5 passing in 40.9s against remote Supabase. Runtime verified reproducibly after a stash-pop clean re-run.
- **Regression check:** `cod-settlements.test.js` is the only other file that mounts `routes/couriers`. It fails 14/14 on **both** `main` and this branch with a pre-existing 5s `beforeEach` timeout. Verified via `git stash` + re-run on main. Not a regression from H1 — flagged in the deferred section below.

### Deferred / documented-only

- **`routes/couriers.js` has no Zod validation on any endpoint** — user-raised question during scope approval (Decision W). The route reads `req.body` directly with manual null checks across all 8-ish endpoints (book, test-booking, cancel, tracking refresh, webhook handlers, etc.). Should have a full `schemas/couriers.js` pass following the `smart-collections.js` / `scheduled-changes.js` convention established in Phase 2 C3. **Not H1 scope.** Pre-existing hygiene drift across 8 endpoints; H1 is a narrow 2-file fix. Revisit as a standalone pattern when the next wave of routes hygiene work lands.

- **bykea duplicate seed rows** — observed during Supabase verification (5 duplicates on handicraft and khantoys, 1 on packagesmall; pakpost has only 1 row per tenant). The `INSERT ... ON CONFLICT DO NOTHING` on `courier_integrations` at `schema-pg.sql:1081` seems to have a unique-constraint mismatch — bykea has no `tracking_url_template` (empty string) which may be evading the constraint. Not investigated further; pre-existing seed idempotency quirk unrelated to H1. Belongs in a seed-hygiene sweep when someone tackles courier integrations end-to-end.

- **`cod-settlements.test.js` pre-existing 5s timeout cascade** — 14/14 tests fail on both main and this branch because the file's `beforeEach` creates a fresh `createTestApp()` per test (not `beforeAll`) without adjusting `jest.setTimeout`. Against remote Supabase, 5s is far too tight for a full schema-pg.sql run. Not a regression from H1 (verified via `git stash`). The file is the only other integration coverage for `routes/couriers`; fixing it would expand H1's regression surface, but doing so would turn an adapter fix into a test-infra cleanup task. Out of scope; noting so the next courier-domain work knows the file needs a timeout bump before it can meaningfully run.

- **`employees.js:451` — same `company_profile.name` bug as drive-by 2** — during the drive-by 2 investigation I found `employees.js:451: SELECT name FROM company_profile WHERE id = 1`. Same class of bug as drive-by 2, different file. Not touched because employees.js is outside Phase 5 and the Phase 1 review didn't flag it. Pre-existing bug unrelated to H1; fixing it would widen scope beyond the file H1 was approved against.

- **Route-level fall-through to manual branch for adapters that throw `COURIER_NO_BOOKING_API`** — considered and rejected in Decision V. Would mean the route inconsistently honors/ignores `supports_booking` depending on which error the adapter threw. Cleaner to have operators flip `supports_booking=false` on the integrations hub row when a courier lacks an API. Worth revisiting only if UX feedback shows operators repeatedly hitting the 501 without understanding the fix.

- **`getTracking` / `cancelShipment` stubs on pakpost/bykea** — intentionally left alone. They return non-throwing advisory shapes (`"Track via Bykea app"`, `"Cancel via Bykea app"`) which are the *correct* behavior for couriers without APIs — the frontend can render them as tracking URLs. The review flagged only `bookShipment`, and widening to `getTracking`/`cancelShipment` would turn advisory responses into 501s for no user benefit.

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
- **2026-04-11 — Phase 2 C3: initial plan to use `backend/shared/`  discarded after user flagged stale CLAUDE.md**: my first scope proposal put a hand-rolled allowlist module at `backend/shared/catalog-scheduler-fields.js` because the root CLAUDE.md said `shared/` was "reserved — constants currently inline in middleware/…". Live codebase check showed (a) `shared/` was actually empty, not "reserved" — Write auto-created the directory; (b) the codebase already has a strong convention for this shape: Zod schemas in `backend/schemas/` + `validate()` middleware, and `schemas/smart-collections.js` uses `field: z.enum([...])` for exactly this kind of column-name allowlist. User correction: "the claude md files are old and stale please do research on code first instead of assumptions." Deleted the shared/ file, created `schemas/scheduled-changes.js` following the smart-collections template. Lesson: the docs are a starting hint, not a contract; verify against live grep before inventing a pattern.
- **2026-04-11 — Phase 2 C3: services/CLAUDE.md badly stale (9→31 files)**: the `backend/services/CLAUDE.md` claimed 9 files. Actual count is 31. This was a ~3x drift. Corrected the count in the fix commit and flagged for `/update-docs` refresh. Not updating the narrative for every file because that's out of scope for a security fix commit — the discipline is "don't turn bugfixes into documentation rewrites."
- **2026-04-11 — Phase 2 C3: tests caught two drive-by schema bugs**: the initial Zod schema had (a) `change_type` enum copied from the review repro example (`['field_update',...]`) instead of matching the DB CHECK (`['price','visibility','status','tax']`) and (b) used Zod 3 `.refine()` function-form dynamic messages which Zod 4 silently drops. Integration tests exposed both: (a) via reading the real DDL during test fixture setup, (b) via `expect(body.error).toMatch(/field_name/i)` asserting the 400 response was meaningful. Both fixed in the test commit as drive-bys. This is the third time in this session that "tests caught a bug the code review didn't" — Pattern A Commit 4's lastPollAt, M1's payment_intents ALTER, and now these two. Tests earn their keep.
- **2026-04-11 — Phase 2 C3: worker body refactor preserved atomicity**: the original inline worker wrapped the target UPDATE and the status='applied' update inside `tenantDb.transaction()` so they land atomically. My first draft of `applyScheduledChange` naively took a `db` argument and ran both queries sequentially on it — losing atomicity if the caller passed a pool. Corrected before commit: the service opens its own `db.transaction()` internally. Caught by re-reading the original worker flow carefully, not by tests (unit tests don't exercise real transaction semantics). Lesson: when extracting a function out of a worker loop, preserve the transaction boundary *as-is* or explicitly think about moving it.
- **2026-04-11 — Phase 4 C2: mid-implementation scope correction dropped the public-route feature flag gate**: original Option B approval included `requireFeature('phase4_restaurant_qr')` on the public-restaurant route as defense-in-depth. Before writing code I grepped `routes/public-bookings.js` and `routes/storefront.js` for similar gates and found **none** — the codebase has no precedent for public-route feature-flag gating. Adding it only on restaurant would create a one-off asymmetric pattern. Stopped, flagged the scope deviation to the user, got revised approval (drop the gate), documented as Decision N. This is the same lesson as Phase 2 C3's `backend/shared/` episode: don't invent patterns not present in the codebase, even when they sound "correct in isolation." User's earlier correction — "the claude md files are old and stale please do research on code first instead of assumptions" — applied here a second time.
- **2026-04-11 — Phase 4 C2: `public-tenant-context.js` reads `MULTI_TENANT` at module load**: test 7 and test 8 initially failed with 400 instead of their expected 200/404. Root cause: `backend/.env` sets `MULTI_TENANT=1`, dotenv injects it before Jest loads any test file, and `public-tenant-context.js:6` captures `IS_MULTI_TENANT = process.env.MULTI_TENANT === "1"` at require time. Delete/re-set inside `beforeAll` has no effect once the module is cached. Fix: delete `process.env.MULTI_TENANT` **before** the first `require("../../routes/public-restaurant")` call (which is the only path that transitively loads `public-tenant-context`). Lazy-require inside the describe's `beforeAll` so the env override takes effect. Restore in `afterAll`. This is a general gotcha for any module that reads env at top level — worth flagging in backend/tests CLAUDE.md eventually.
- **2026-04-11 — Phase 4 C2: test 7 hit a pre-existing `createCheckSchema` quirk**: `createCheckSchema` at `schemas/restaurant.js:41` accepts `table_session_id` but not `table_id`. The POST route inserts `draft_orders` with `table_id = NULL`. The public menu query at `routes/public-restaurant.js:17` JOINs on `table_id = restaurant_tables.id` — so the lookup never resolves even with a valid token. Worked around in test 7 with a direct `UPDATE draft_orders SET table_id` after the POST. The underlying bug (route should derive `table_id` from `table_session_id`, or the schema should accept `table_id` with an FK existence check) is **out of scope for Phase 4 C2** but documented as deferred. Worth noting: this bug would have 404'd every real QR scan in production the moment packagesmall tried to use the feature, *even after* the Phase 4 C2 fix. So the "fix completes the feature" claim has a caveat — it fixes the service/migration side, but the route/schema side still has a gap.
- **2026-04-11 — Phase 4 C2: pg-batch filename numbering is already cluttered**: both `pg-batch13-restaurant.test.js` and `pg-batch14-bookings.test.js` pre-exist on main. Phase 2 C3 added `pg-batch13-catalog-scheduler.test.js` (a 13- collision I introduced without noticing). Rather than compound the confusion with a new `pg-batch1x-restaurant-qr.test.js`, appended tests to the existing `pg-batch13-restaurant.test.js`. The 13- filename collision is documented as a deferred cleanup — low-priority hygiene, not blocking anything.
- **2026-04-11 — Phase 4 C2: iterated 3 times to get tests green**: first run 33/35 (tests 7-8 both 400 from `MULTI_TENANT` env issue), second run 34/35 (test 7 still 404 because of `table_id` JOIN), third run 35/35. Each iteration taught something the review didn't flag — the env-reads-at-load-time gotcha and the `createCheckSchema.table_id` quirk. Both recorded above. "Tests catch what reviews miss" pattern holds for the fourth time in this session: lastPollAt (Pattern A), payment_intents ALTER (M1), Zod 4 message API (Phase 2 C3), and these two quirks (Phase 4 C2).
- **2026-04-11 — Phase 4 C3: the review's Option 1 direction was insufficient**: the review said "one ticket per draft_order+station+course" would fix the fan-out. I took that direction and committed `3155263` implementing exactly that on the write side. Then I wrote tests and test 2 (the category-routing split test) failed: 1 ticket on station A, 1 ticket on station B, but **both** showed all 3 items. Root cause: the read-side JOIN in `getTickets` joins `draft_order_items` by `(draft_order_id, course_name)` with no station filter. Grouping the INSERT side doesn't help — the SELECT still fans out. **The review implicitly assumed the JOIN would respect routing, but neither the JOIN nor the data model supports that.** Pivoted to Option 2 (junction table) mid-implementation after stopping to re-verify with the user. Fifth time in this session tests caught what reviews missed: lastPollAt, payment_intents ALTER, Zod 4 message API, Phase 4 C2 env/table_id quirks, and now Phase 4 C3's read-side gap. **The broader pattern**: reviewer instructions describing "do X" are often describing the symptom fix, not the data-model fix. Always trace the full lifecycle (write AND read) before committing.
- **2026-04-11 — Phase 4 C3: "leave the incomplete commit alone, add the fix on top"**: the user's consistent rule "never amend, always new commit" applied here. `3155263` was a partial fix; reverting would require a revert commit anyway. Adding the junction-table fix on top in `03b36f5` preserves the reasoning trail — a future reader bisecting sees "write-side grouping was intentional but required a follow-up" rather than a single opaque commit. This is not a sunk-cost decision (the grouping code in `3155263` is still necessary and correct, just not sufficient). Worth contrasting with Phase 2 C3 where I bundled refactor + fix into one commit because they had the same motivation; here the two commits have genuinely different rationale (grouping fixes the write side, junction fixes the read side), so splitting is honest.
- **2026-04-11 — Phase 4 C3: file-level `jest.setTimeout(20000)` was required**: tests 2/3/5/6 initially failed with 5s timeouts because they do 7+ supertest round-trips each (seed check + insert items + POST send-to-kitchen + 2× GET kds/tickets). Against remote Supabase the default 5s ceiling is tight. Bumped to 20s at file level. Runtime for the full pg-batch13-restaurant file went from ~61s to ~103s. Not a regression — the tests are just doing more real work.
- **2026-04-11 — Phase 4 C3: orphaned test schemas caused a "41 all failed" cascade**: during iteration, failed test runs left `test_XXXXXX` schemas behind in Supabase. Three accumulated across runs, consuming connection/lock budget. A subsequent run of `pg-batch13-restaurant.test.js` had the top-level `beforeAll` time out because `createTestApp()` couldn't acquire resources, which cascaded into 41/41 failed tests with misleading "db is undefined" errors. Resolved by dropping the orphaned schemas via Supabase MCP. Lesson: the test factory's `afterAll` → `cleanup()` → `DROP SCHEMA ... CASCADE` isn't resilient to Jest crashes; an exit before `afterAll` leaves state on the server. Worth either (a) using a shared cleanup daemon or (b) adding a pre-test "DROP orphaned test_* schemas" step to the factory. Flagged for a future test-infra pass.
- **2026-04-11 — Phase 4 C3: composite PK over surrogate id on junction**: verified codebase convention by grepping for existing junction tables — `role_permissions`, `employee_outlets`, `channel_publications` all use composite keys. Followed the precedent. Wouldn't have occurred to me to check without the stale-CLAUDE.md lesson from Phase 2 C3. "Grep the codebase before inventing" is now a reflexive habit this session.
- **2026-04-11 — Phase 4 C3: JOIN `FILTER ... COALESCE` defensive guard**: the new junction JOIN can legitimately produce an empty match if a ticket has no junction rows (e.g., during a partial sendToKitchen failure — Phase 4 H2 territory). Without `FILTER (WHERE kti.ticket_id IS NOT NULL)` + `COALESCE(..., '[]'::json)`, `json_agg` emits `[{id:null,...}]` — a single null-object that the frontend would render as a ghost item row. The pre-fix JOIN couldn't produce this case because `(draft_order_id, course_name)` always matched at least one row. Every read-side refactor inherits new failure modes — defend against them inline. This is the subtle kind of bug that only shows up in production under unusual state, so it's worth writing the defense even without a specific test for it.
- **2026-04-11 — Phase 5 H1 scope narrowed to 2 adapter files after live research**: initial reading of the review finding suggested a possible 13-file sweep (one per adapter). After spot-checking all 13 adapter files I confirmed 11 of them (leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, dhl, fedex) make real HTTP calls and throw with `if (!res.ok) throw ...` style — only pakpost and bykea use the defensive-null-success shape. The review's "single out these two" framing was correct. Option C (13-file sweep) dropped to `not needed`. Scope confirmed as 2 files + deferred notes.
- **2026-04-11 — Phase 5 H1: 3 bugs in one route-code commit (1 H1 + 2 drive-bys)**: tests went red three times before turning green. First failure: `feature_flags.enabled` BOOLEAN column rejected integer literals in unbound SQL (fixed in test). Second failure: `routes/couriers.js:227` used `FOR UPDATE` on the nullable side of a LEFT JOIN, which Postgres rejects (fixed in production code as drive-by 1). Third failure: `routes/couriers.js:261` queried `company_profile.name` which doesn't exist — the column is `company_name` (fixed in production code as drive-by 2). Both drive-bys are pre-existing, both in the same file H1 was approved to touch, both in the same code path H1 tests exercise, and both unreachable in production today (walk-in orders with `customer_id IS NULL` don't exist; and `supports_booking=false` everywhere means the book route's sender-info query never runs). Bundled into Commit 1 per precedent from Pattern M1 Decision G and Pattern A Decision D drive-bys. **Seventh time in this review session that tests caught a bug the review didn't flag**: lastPollAt (Pattern A), payment_intents ALTER (M1), Zod 4 message API (Phase 2 C3), MULTI_TENANT env-read + table_id JOIN (Phase 4 C2), KDS read-side fan-out (Phase 4 C3), and now these two. "Tests earn their keep" remains the motto.
- **2026-04-11 — Phase 5 H1: Zod validation gap deferred explicitly after user-raised question**: user asked mid-approval "did you know about zod schema and did you consider this while fixing bugs?" Correct answer: H1 is an adapter-layer bug, not a request-validation bug — no Zod on `req.body` would catch a stub returning `{tracking_number: null}`. But the question surfaced a separate hygiene gap: `routes/couriers.js` has zero Zod schemas and zero `validate()` middleware across all 8-ish endpoints. That's pre-existing drift from the codebase convention (`schemas/<domain>.js` + `validate(Schema)` middleware) established in Phase 2 C3 and followed by 23 other schema files. Deferred to a standalone pattern rather than rolled into H1. Same discipline as Phase 4 C2 Decision N — don't invent scope that isn't in the finding.
- **2026-04-11 — Phase 5 H1: cod-settlements.test.js is broken on both main and this branch (pre-existing)**: `cod-settlements.test.js` is the only other integration test that mounts `routes/couriers`, and it fails 14/14 with a pre-existing 5s `beforeEach` timeout. Verified via `git stash` + re-run on main. Not a regression from H1 — the file creates a fresh `createTestApp()` per test without adjusting `jest.setTimeout`, and against remote Supabase 5s is too tight for a full schema-pg.sql run. Flagged in H1 deferred section so the next courier-domain work knows the file needs a timeout bump before it can meaningfully run.
- **2026-04-11 — Phase 5 H1: orphan test schemas left by the broken cod-settlements run**: running cod-settlements as a regression check left 12 orphan `test_*` schemas (14 tests × `beforeEach`, minus 2 successful cleanups before the cascade set in). Dropped one at a time via Supabase MCP per the Phase 4 C3 lesson — multi-drop in one transaction still hits "out of shared memory." Same test-factory resilience gap as Phase 4 C3 Decision. The test-infra cleanup discipline ("drop orphans before and after every iteration") is now a reflexive habit — I ran the sweep three times during this pattern (initial check, mid-iteration after the fix-test loop, final check before committing).
