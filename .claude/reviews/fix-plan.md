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

**Status:** `deferred`
**Blocker:** Sequencing rule from [findings/cross-phase-synthesis.md:130](findings/cross-phase-synthesis.md) — Pattern D must land first. Otherwise, new tenant-routed workers will hit `column does not exist` errors on any tenant whose migration lag we haven't verified. (Per Decision A we now know all live tenants are at v27, so the sequencing rule's original motivation is weaker than it was — but we're honoring the order anyway because Pattern A's own verification work hasn't started yet.)

**Next step when picked up:** re-read [findings/cross-phase-synthesis.md](findings/cross-phase-synthesis.md) Pattern A section and the Phase 3/4 worker findings, verify the affected workers' current state in production, then draft a plan following the same process (gather → verify → plan → approve → execute).

---

## Deviations from synthesis

Running log of where we've diverged from the reviewer findings, with dates and reasons:

- **2026-04-11 — Phase 5 C2 → `notabug`**: synthesis claimed COD auto-match joined on `web_orders.active_shipment_id`. Actual code in `routes/fulfillment.js:1114-1120` joins on `tracking_number`. Reviewer misdiagnosed the mechanism.
- **2026-04-11 — Pattern D scope 5→2 commits**: after verifying all live tenants at v27, Phase 1 C3 + `/pay` + courier-list guards dropped to `notabug`. Only Phase 5 H2 and C1 remain as actionable fixes.
- **2026-04-11 — Test format switched from integration (Jest) to unit (Vitest)**: pg-batch suite is currently broken at the seed-schema step due to Phase 1 M1. Rather than fix M1 as an unplanned prerequisite, we switched to Vitest unit tests for Commits 2 and 3. Trade-off: doesn't exercise real Postgres; mitigated by verifying column existence live via Supabase before each commit.
- **2026-04-11 — Phase 5 C1 dropped to `wontfix`**: production verification showed zero credential data on any tenant (`encrypted_config_json`, `api_key`, `api_secret` all empty). The silent-ignore bug is architecturally real but unreachable. Fixing it now would ship unexercised code protecting an unused feature. Documented the required fix for the future UI author. See Decision C.
- **2026-04-11 — Pattern D final tally**: 1 commit landed (Phase 5 H2), 1 `wontfix` (Phase 5 C1), 3 `notabug` (Phase 1 C3, Phase 1 /pay, Phase 5 C2). The review's original framing was "Pattern D unlocks half the criticals" — actual: 1 real critical in production out of 5 claimed. Verification-before-completion saved ~4 commits of unnecessary work.
