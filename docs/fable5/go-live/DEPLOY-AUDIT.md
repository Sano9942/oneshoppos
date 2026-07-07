# Go-Live Audit — V01–V10 stack to production (v109 → v122)

> Produced 2026-07-07 by the pre-deploy audit session. Every claim below was verified
> against live git state, source code, local Postgres dry-runs, and read-only Supabase
> queries in that session — not against docs or memory.

## Verdict: GO (after the lost-fix recovery below)

---

## 1. Consolidation findings

**What ships:** local `main` is 42 commits ahead of `origin/main` (`1cd222b` → post-merge tip).
Contents: V01 (grocery lane), V02 (wholesale depth), V03 (food-service/aggregators), V04 (salon),
V05 (clinical), V07 (gym), V08 (photography), V09 (rentals), V10 (lodging), platform-study docs,
plus 3 recovery merges (below). V06, F01–F07, and the Square reskin are already inside origin/main @ v109.

**Lost-fix audit (`git branch --no-merged main`)** — second confirmed instance of the
consolidation-lost-fix pattern:

| Branch | Verdict | Action taken |
|---|---|---|
| `fix/completion-11` | **P0 fix was LOST** — the honest marketplace-sync worker rewrite (dcd1c61) existed only on the branch; main still ran the decorative worker. Proof: `git diff fix/completion-11...main -- backend/workers/marketplace-sync-worker-boss.js` was empty (main never touched the file). | **Merged to main 2026-07-07.** All 4 code files auto-merged clean; only the docs register conflicted. Verified: 11/11 growth tests green. |
| `fix/completion-08` | Test-only fix; main had independently superseded it with the better `vi.setConfig` form during V05. | Merged (kept main's version). 28/28 treatment-plans tests green. |
| `fix/completion-03` | Docs-only register line. | Merged. |
| `fix/completion-04` | Content already in main via the V02 re-port — verified by `pg-completion04-void-ar-reversal.test.js` in main's tree + AR-reversal code at `routes/sales.js:453-467`. Branch is STALE (pre-F01 sales.js). | **Do NOT merge. Safe to delete after deploy.** |
| `origin/probe/browser-feasibility` | One markdown report. | Ignore. |

## 2. Migration-chain verdict: CLEAN

- New migrations: **v110–v122, contiguous, no duplicates** (13 entries; verified by numeric scan of `MIGRATIONS`).
- Two scan anomalies are pre-existing and identical in origin/main (prod already ran past them):
  the "duplicate v32" is a code comment mentioning `version: 32`; v40–43 never existed (historical
  authoring gap; the runner applies by `version > current`, gaps are harmless).

### Local dry-run (Phase 4) — PASS on all four checks
Tenant sim = schema built from **origin/main's** `schema-pg.sql` (exact v109 shape) with
`schema_version` seeded 1..109; public sim = near-empty schema at 109.

1. v109 → v122 applied clean (all 13).
2. Second run: no-op ("up to date (version 122)").
3. Re-application idempotency (version reset to 109, chain re-run on the already-migrated schema): clean — crash-mid-run recovery is safe.
4. Public sim: warns-and-continues (`[migrate-pg v111] van sales schema skipped`) — the tenant-only guards work.
5. Materialization spot-check: all 12 new tables + `barcode_scheme` + `plu_code`/`age_restricted` + `client_visible`/`client_selected` present.

### Prod starting state (read-only Supabase, 2026-07-07)
All 7 schemas at exactly **v109**: `public`, `tenant_cafetestphase8` (cafe),
`tenant_grocerywalktest1778451` (grocery), `tenant_livetest1` (general_retail),
`tenant_livetestauto` (general_retail), `tenant_sanoposlivetest1778021564659` (restaurant),
`tenant_wholesalewalktest1778451` (wholesale). The prod migrate touches **6 tenants + public**.
Only the wholesale tenant fires a preset backfill (v110/v111 seed `wholesale_backorders` +
`wholesale_van_sales` ON). No gym/rental/lodging/clinical/salon/photography tenants exist,
so those backfills no-op.

## 3. Industry seeding matrix

Seeding paths (all verified in source):
- **Modes** — `setup.js` step 1c inserts `tenant_modes` from `INDUSTRY_PRESETS[x].modes`.
- **Mode-derived flags** — step 1d via `mode-registry.js:getFeatureFlagsForModes`.
- **PRESET_EXTRA_FLAGS** — step 1d-bis (`industry-config.js`); ALSO applied on preset switch (`tier4/company-profile.js`), with the `ALL_PRESET_EXTRA_FLAGS` reset on switch-away.
- **Bundles** — step 1f/1g: retail bundle (19 flags) for `general_retail/grocery/wholesale/butcher/sweet_shop/textile` + per-subtype engines (`RETAIL_SUBTYPE_FLAGS`); restaurant bundle (12, incl. `delivery_aggregators`) for restaurant/cafe; salon bundle (4, **signup-only by design** — never re-applied on preset switch); wholesale extras (6) on top of retail.
- **Templates** — clinical presets seed a "Patient Intake" form (1d-ter); photography seeds "Event Timeline" + "Shot List" (1d-quater).

**Fresh-signup walkthrough: 22/22 presets PASS** (real `POST /api/setup/complete` against a
fresh isolated schema per preset, local PG): exact mode match, every expected flag ON,
clinical/photography templates present. Presets walked: general_retail (control), grocery,
butcher, sweet_shop, textile, wholesale, restaurant, cafe, salon, clinic, dental_clinic,
veterinary, physiotherapy, gym, photography_studio, car_rental, equipment_hire,
furniture_rental, party_supplies, hotel, guesthouse, hostel.

**Backfills for EXISTING tenants** (verified in migrate-pg.js):

| Preset(s) | Backfill | Notes |
|---|---|---|
| wholesale | v110/v111 flags ON | fires for the 1 prod wholesale tenant |
| gym | v117 extras ON | no prod tenant |
| rental presets | v118: `rental_inspections` ON; `rental_online_booking` inserted **false** | no prod tenant |
| lodging presets | v119: channel-sync + guest-reg ON; `room_online_booking` inserted **false** | no prod tenant |
| dental/vet/physio | v120: recalls + forms (+vet vaccinations / physio handouts) ON | no prod tenant |
| generic clinic | **deliberately NOT backfilled** (approved: no overnight nav change; opt-in via preset re-apply) | — |
| salon | **no v121 flag backfill** (deliberate signup-only split) | no prod tenant |
| photography | v122 backfills the two questionnaire templates | no prod tenant |
| grocery/butcher/sweet_shop/textile | **no backfill** for V01 flags (`batch_expiry_tracking`/`kit_bom_engine`/retail bundle) — existing tenants opt in by re-applying the preset in Settings → Business Profile | prod grocery tenant `grocerywalktest1778451` will NOT gain batch flags on deploy |
| restaurant/cafe | `delivery_aggregators` not backfilled — turns ON automatically at aggregator connect (V03 enable-on-connect) | correct posture |

## 4. Env-var audit

**Railway — staged this session via `railway variables --set … --skip-deploys` (inert until deploy):**

| Var | Why |
|---|---|
| `RECALL_WORKER_ENABLED=1` | NEW (V05) — daily clinical recall outreach sweep |
| `SUBSCRIPTION_DUNNING_WORKER_ENABLED=1` | shipped v100–109 but never enabled — failed subscription charge retries (V07 gym billing assumes it) |
| `DEPOSIT_HOLD_EXPIRY_WORKER_ENABLED=1` | shipped, never enabled — hourly release of lapsed gateway deposit pre-auths (F04) |
| `EXPIRY_ALERT_WORKER_ENABLED=1` | shipped, never enabled — daily near-expiry batch scan (F07/V01) |
| `BOOKING_REMINDER_WORKER_ENABLED=1` | never enabled — appointment reminder processing (V04 salon 24h/1h reminders ride on it) |

Already set before this session: `CHANNEL_SYNC_WORKER_ENABLED=1`, `NIGHT_AUDIT_WORKER_ENABLED=1`.

**Deliberately NOT set (owner decision):** `SHIFT_AUTO_CLOSE_WORKER_ENABLED` — force-closes stale
open shifts for live tenants; behavior change unrelated to this deploy.
**Optional, has code default:** `RATE_LIMIT_MEMBER_KIOSK_MAX` (V07 kiosk rate-limit override).
**Known pre-existing gap (not this deploy):** `ANTHROPIC_API_KEY` absent → AI insights inactive.

**Vercel:** no new `VITE_*` variables. `frontend/src/config.js` reads the same four
(`VITE_API_BASE`, `VITE_MULTI_TENANT`, `VITE_SENTRY_DSN`, `VITE_TURNSTILE_SITE_KEY`); the
origin/main..main frontend diff introduces zero new env reads. Nothing to change on Vercel.

## 5. Dormant-gates posture (deploy-safe)

| Risky path | Proof of dormancy |
|---|---|
| Aggregator order injection | Webhook is fail-closed: `aggregator-orders.js:verifyWebhook` returns `no_secret_configured` rejection when no secret is set. Zero active `integration_settings` rows on any prod tenant (read-only check). `delivery_aggregators` default `false`; ON only for new F&B signups, still inert without a connected store. |
| FBR-on-aggregator | `fbr_integration` is **true on all 6 tenants** (PK country pack seeds it — expected, not drift), but the `enqueueFbrInvoice` W31 gate skips unless `tax_mode ≠ 'none'` AND `fbr_api_token` AND `ntn` are set. Verified: **zero prod tenants have a token or NTN** (5 are `tax_mode='none'`; livetest1 is `inclusive` but has no credentials). The FBR worker additionally halts at its credential check. |
| Rental online booking | `rental_online_booking: false` in `DEFAULT_FEATURE_FLAGS`; v118 inserts the row as `false`; not in `PRESET_EXTRA_FLAGS`. |
| Room direct booking | `room_online_booking: false`; v119 inserts `false`; not in `PRESET_EXTRA_FLAGS`. |

## 6. Post-deploy P1 follow-ups (tracked, NOT fixed in this deploy)

1. **Currency 401** — `GET /api/company-profile/currency?tenant=` 401s in prod → all dashboards show `$` instead of `Rs`. Live since ~2026-06-19 (suspected `?tenant=` lockdown regression). High visibility, low effort.
2. **Reservations availability TZ** — `public-reservations.js` availability mixes UTC-hardcoded slots with a TZ-dependent `::date` cast → booked slots can read available (double-book risk). Needs a focused TZ session.
3. V03 aggregator go-live gates (non-code): real foodpanda signature header/encoding + one test order; FBR sandbox validation before enabling FBR on an aggregator tenant. See `v03_food_service_open_gates` memory / V03-decisions.md.
4. `fix/completion-04` branch deletion (content confirmed in main).
5. `SHIFT_AUTO_CLOSE_WORKER_ENABLED` decision.

## 7. Production health baseline (2026-07-07 12:49 UTC)

`/api/health?deep=true` → `status: ok` (database 98 ms, Resend 398 ms). All 7 staged env vars
verified present in `railway variables` output.
