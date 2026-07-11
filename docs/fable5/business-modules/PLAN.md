# Business Modules — Implementation Plan

> Self-service "Business Modules" settings page: tenant Administrators turn SanoPOS capabilities
> on/off themselves (Square-style). Spec + owner decisions are frozen in
> [FEATURE-CATALOG.md](FEATURE-CATALOG.md) — read it before executing any step.
> Branch: `feat/business-modules`. Planning session: 2026-07-10.
>
> **Amended 2026-07-10 (second-opinion review, owner-approved)**: plan restructured 10 → 11 steps.
> Adopted now: legacy flag-endpoint lockdown, config-preservation on disable (`saved_flags`),
> `scope` + state-enum catalog metadata, dependency change-preview before apply, bidirectional
> catalog test, and a new Roles & Permissions contract step. Deferred items live in the
> "Deferred to v2" section at the bottom — they are decisions, not omissions.
> Migration step moved BEFORE the toggle step (toggle needs `tenant_business_modules` to exist).
>
> **Guiding rule (owner-adopted)**: bundles recommend, customers decide; disabling preserves
> configuration; enabling never causes hidden side effects.

## Progress tracker

| Step | Title | Status | Pause? |
|---|---|---|---|
| 1 of 11 | Create working branch | ☑ done (verified) | — |
| 2 of 11 | Re-verify catalog → `backend/config/business-modules.js` (+ scope, state, bidirectional test) | ☑ done (verified) — owner RATIFIED v1 card list 2026-07-10 (commit c124583b) | **PAUSE after** (owner ratifies v1 module list) — CLEARED |
| 3 of 11 | Surface-cleanliness fixes (workers + POS loyalty + page guards) | ☑ done (verified, zero new test failures; commit 9609136d) | — |
| 4 of 11 | Backend read path: `GET /api/business-modules` (state enum) | ☑ done (verified, 10 integration tests green; commit 99fc5253) | — |
| 5 of 11 | Migration: platform lock table + `tenant_business_modules` + admin backstop | ☑ done (verified — v131 idempotent on local sanopos_dev, 48 tenant schemas; admin CRUD+UI live, 6 tests green; commit 3d6ac331). Owner pre-approved 2026-07-10 | **PAUSE before** (schema/migration) — CLEARED |
| 6 of 11 | Backend toggle path (atomic flag+mode, saved_flags restore, deps preview, lock, legacy-endpoint lockdown) | ☑ done (verified — 17-test matrix green incl. all 12 PLAN cases; fresh-context verifier ran twice: 3 should-fix findings found (double-disable snapshot clobber, stale-snapshot re-enable, Bucket C cascade dead-end) and FIXED + regression-tested. Design deviations logged in Step 6 notes below. Owner approved design 2026-07-10) | **PAUSE before** (tenant write-path design sign-off) — CLEARED |
| 7 of 11 | Roles & permissions contract (permission catalog, role-editor fix, guards, `manage_business_modules`) | ☑ done (verified — 26 unit + 42 integration tests green; role editor browser-verified, 29-perm catalog + drift guard; commit 7c7c1d56). Consumer-grep resolved the pause: `/api/roles` all_access-only, `/:id/permissions` self-or-admin (AuthProvider boot dependency) | **PAUSE before** (permission-guard changes to existing endpoints) — CLEARED |
| 8 of 11 | Frontend read-only page | ☑ done (verified in browser on golv_party_supplies (retail-family: Rentals recommended+On, Restaurant Off) and golv_restaurant (Restaurant recommended+On); Bucket C shows Needs setup, staff-access lines render, console clean; commit 8f0472cc) | — |
| 9 of 11 | Frontend interactive (toggles, enable-preview + disable-impact confirms, setup cards, refresh) | ☑ done (verified — browser walkthrough on golv_restaurant: enable-preview confirm BEFORE POST (Van Sales names Field Sales), disable confirm with dependents + cascade, saved_flags round-trip visible in UI, nav gains AND loses groups in-place without logout, FBR Set up navigates; 173 frontend unit tests green; commit 59e97f16) | — |
| 10 of 11 | End-to-end verification on test tenant | ☐ not started | **PAUSE after** (owner reviews verification report) |
| 11 of 11 | Docs, memory, final review, commit & push | ☐ not started | **PAUSE** (push is owner-gated) |

Status values: `☐ not started` / `◐ in progress` / `☑ done (verified)` / `⊘ skipped`. Update this table at the start and end of every session.

**Commit policy** (playbook §3): approving this plan pre-authorizes **local commits to `feat/business-modules`** at the end of each verified step (small, revertable checkpoints). Pushes, merges, and PRs stay explicitly owner-gated (Step 11). Strike this paragraph if you want per-step commit approval instead.

**Standing rules for every step prompt**: run on the branch from Step 1; local Postgres only (`backend/.env.test`) for tests; Supabase read-only; never run migrations against prod; verify against code not docs; audit all call paths when touching flags/modes/visibility (the recurring bug: POS fixed, storefront/field-rep still broken).

---

## Step 1 — Create working branch

- **Goal**: `feat/business-modules` off current `main`, clean start.
- **Touches**: git only.
- **Model/effort**: sonnet / low — one command.
- **Pause**: no.
- **Verify**: `git status` clean on the new branch; `git log -1` matches main head.
- **Done when**: ☐ branch exists locally and every later step runs on it.

**Prompt:**
```
Effort: low.
Create branch feat/business-modules off main in D:\newprojects\oneshoppos and check it out. Do not push. Confirm with git status + git log -1.
```

---

## Step 2 — Re-verify catalog and encode it as `backend/config/business-modules.js`

- **Goal**: turn FEATURE-CATALOG.md into a single data module (no routes yet): module key → `{ bucket, title, description, scope, mode?, flags[], sub_toggles[], depends_on[], impact_queries[], setup_route?, connected_check?, preset_recommended }` — after re-verifying every flag/mode/gate claim against current source. **Amendment additions**: (a) every entry carries `scope: "tenant" | "outlet" | "hybrid" | "device"` — v1 enforces everything tenant-wide regardless; scope is forward metadata so per-outlet activation later needs no catalog redesign; (b) the config also exports `UNMANAGED_FLAGS` — an explicit allowlist of `DEFAULT_FEATURE_FLAGS` keys deliberately outside the module system (structural/core/platform keys); (c) the config documents the card state enum (`off / on / setup_required / connected / locked / attention_required`) and what `setup_required` means per Bucket C card.
- **Touches**: new `backend/config/business-modules.js`; updates to `docs/fable5/business-modules/FEATURE-CATALOG.md` if drift found. Reads: `middleware/feature-flags.js`, `config/mode-registry.js`, `config/industry-config.js` (PRESET_EXTRA_FLAGS), `services/preset-apply.js`, route gate call sites.
- **Model/effort**: claude-fable-5 / xhigh — the whole feature's correctness hangs on this classification; a mis-bucketed flag becomes a bare toggle on a credentials-requiring feature.
- **Pause**: **YES, after** — owner ratifies which cards ship in v1 (especially: anything moved between buckets, anything excluded for leaks).
- **Verify**: a unit test (`backend/tests/unit/business-modules-catalog.test.js`) asserting **bidirectionally**: (a) every catalog flag exists in `DEFAULT_FEATURE_FLAGS` or is a documented DB-only key (`fbr_integration`), (b) every Bucket A card's mode ∈ `VALID_MODES` and its flags ⊇ that mode's `feature_flags_to_enable`, (c) no Bucket D flag appears in any card, (d) `depends_on` references resolve and contain no cycles, (e) **every key in `DEFAULT_FEATURE_FLAGS` is classified exactly once** — as a module primary flag, a bundle flag, a `sub_toggle`, a Bucket C flag, a Bucket D flag, or a member of `UNMANAGED_FLAGS` — the test FAILS on any unclassified key, so a future feature cannot ship a flag outside the customer-choice system without an explicit decision, (f) every entry has a valid `scope`.
- **Done when**: ☐ config file + passing catalog test + owner sign-off on the v1 card list.

**Prompt:**
```
Effort: xhigh.

Why: building the self-service Business Modules page. The catalog config is the single source of truth every later step consumes — a wrong bucket or a missed mode/flag pairing ships a broken toggle. The bidirectional test is the permanent enforcement mechanism keeping ALL future flags inside the customer-choice system.

Task: Read docs/fable5/business-modules/FEATURE-CATALOG.md (including its Amendments section) and PLAN.md (Step 2). Re-verify every classification against current code — middleware/feature-flags.js DEFAULT_FEATURE_FLAGS, config/mode-registry.js, config/industry-config.js PRESET_EXTRA_FLAGS, services/preset-apply.js expectedFlagsForPreset, and the requireFeature/requireMode call sites for each flag. Then write backend/config/business-modules.js exporting: (1) the module catalog (bucket, title, merchant-facing description, scope: "tenant"|"outlet"|"hybrid"|"device", mode, flags, sub_toggles, depends_on, impact_queries as named SQL snippets, setup_route + connected_check for Bucket C, preset_recommended derivation) — classify scope per FEATURE-CATALOG.md's Amendments section (v1 enforces tenant-wide; scope is forward metadata only); (2) UNMANAGED_FLAGS — the explicit allowlist of structural/core keys deliberately outside the module system (context_* enforcement keys, multi_company, offline_returns, and anything else you find that must not be merchant-facing but isn't in a card); (3) a documented STATE enum (off/on/setup_required/connected/locked/attention_required). Bucket D flags must NOT appear in any card (they belong in UNMANAGED_FLAGS or the Bucket D list). Add backend/tests/unit/business-modules-catalog.test.js per PLAN.md Step 2's verify list — including the bidirectional check (e): every DEFAULT_FEATURE_FLAGS key classified exactly once, test fails on unclassified keys. Update FEATURE-CATALOG.md where you find drift and flag it in your report.

Scope: data module + test only. No routes, no schema, no frontend. Do not change mode-registry.js or feature-flags.js.
Autonomy: run fully; commit locally on feat/business-modules when the test passes.
Report: outcome first — any bucket changes vs FEATURE-CATALOG.md, then the final card count per bucket and the UNMANAGED_FLAGS list. END THE TURN after reporting; the owner ratifies the v1 list before Step 3.
```

---

## Step 3 — Surface-cleanliness fixes for the flags we expose

- **Goal**: make OFF actually mean off for every exposed module: per-tenant flag/mode checks in the table-presence-gated workers; gate the POS loyalty/wallet UI on `phase2g_loyalty`; add inline self-guards to accounting sub-pages; decide+apply a guard for report deep-links.
- **Touches**: `backend/workers/` (`rental-overdue`, `room-overdue-checkout`, `night-audit`, `treatment-plan`, `channel-sync`, `kds-load-snapshot`, `course-release`, `reservation`, `reservation-reminder`, `hold-expiry`) + `boot/workers.js` booking-reminders path; `frontend/src/pages/redesign/pos/POSContext.jsx` + `hooks/useLoyaltyWallet.js`; `ChartOfAccountsRedesign.jsx`, `JournalEntriesRedesign.jsx`, `CreditDebitNotesRedesign.jsx`, `PostdatedChequesRedesign.jsx`; `ReportTabStandaloneRoute` guard.
- **Model/effort**: claude-fable-5 / xhigh — cross-cutting shared-concern sweep; the recurring bug class here is exactly "one path fixed, another still broken".
- **Pause**: no (reversible code, no schema/auth).
- **Verify**: copy the existing flag-check pattern from `abc-worker-boss.js:40` (six workers already do it right); unit/integration tests per worker where the suite pattern exists; POS manual check that loyalty UI hides with flag off and still works with flag on; run the affected pg-batch tests against local PG and diff failures against the ~57 pre-existing baseline (memory: followup_main_integration_baseline).
- **Done when**: ☐ all listed workers no-op for tenants with the module off; ☐ POS loyalty UI gated; ☐ sub-pages self-guard; ☐ zero NEW test failures.

**Prompt:**
```
Effort: xhigh.

Why: the Business Modules page lets merchants turn modules OFF. Today several vertical workers gate on table presence, not flags — a tenant who disables Rentals keeps getting rental-overdue processing — and the POS loyalty/wallet UI ignores phase2g_loyalty entirely.

Task: Per docs/fable5/business-modules/PLAN.md Step 3 and FEATURE-CATALOG.md "Known leaks":
1. Add a per-tenant feature-flag (or mode) check to each listed worker before it acts on a tenant, copying the exact pattern from backend/workers/abc-worker-boss.js:40. Booking-reminders runs inline from boot/workers.js via services/booking-reminders.js — gate it there. Match each worker to its module's primary flag from backend/config/business-modules.js.
2. Gate the POS loyalty/points/wallet checkout UI on phase2g_loyalty (POSContext.jsx useLoyaltyWallet path + any wallet UI in the checkout modal). POS reads its own posFlags — use that, not useFeatureFlags.
3. Add the standard inline self-guard (if (!flags.accounting_core) Navigate to "/") to ChartOfAccountsRedesign, JournalEntriesRedesign, CreditDebitNotesRedesign, PostdatedChequesRedesign, following OutletTaxProfilesRedesign.jsx's pattern. Add a flag guard to the standalone report-tab route using the tab registry's flag field.

Scope: exactly these gates. No refactors of worker internals, no new abstractions. Audit ALL the listed paths — do not stop after the workers.
Autonomy: run fully; tests against local PG (.env.test) from backend/ cwd; diff failures against the known pre-existing baseline before treating red as yours. Commit locally when green.
Report: outcome first — each leak closed with file:line, plus any leak you found that the plan missed.
```

---

## Step 4 — Backend read path: `GET /api/business-modules`

- **Goal**: one endpoint returning the full page payload: catalog cards + **computed `state` per card** (the Step 2 enum: `off / on / setup_required / connected / locked / attention_required` — not a bare boolean) + `scope` + `preset_recommended` chips + platform-lock state (stubbed `locked:false` until Step 5/6) + Bucket C connected-status + `depends_on` graph.
- **Touches**: new `backend/routes/business-modules.js` (mount in `registerAllRoutes.js` in the tenant chain), consuming `config/business-modules.js`, `getFeatureFlagsMap`, `getModesMap`, `expectedFlagsForPreset` (`services/preset-apply.js`), and per-provider connected checks (reuse the integrations hub's aggregation queries — `routes/integrations/hub.js`).
- **Model/effort**: claude-fable-5 / high — straightforward composition but touches four subsystems; read-only so low blast radius.
- **Pause**: no.
- **Verify**: integration test (createTestApp-pg pattern): fresh tenant shows defaults; seeding a mode+flags flips card state; a Bucket C card without credentials returns `state:"setup_required"`, with credentials `state:"connected"`; recommended chips match the tenant's `industry_type`; perm-gated (401/403 tests — do NOT copy the weak x-employee-id-only pattern of `GET /api/feature-flags`). Gate with `requirePerm("all_access")` for now — Step 7 switches this to `requirePerm("manage_business_modules")` (Administrators pass via the `all_access` bypass either way).
- **Done when**: ☐ endpoint returns a correct payload (incl. state enum) for a retail and a restaurant test tenant; ☐ perm-gated; ☐ integration tests green.

**Prompt:**
```
Effort: high.

Why: the Business Modules page needs one read endpoint composing catalog + live state; the frontend must never derive bucket rules itself.

Task: Add backend/routes/business-modules.js with GET /api/business-modules per PLAN.md Step 4. Gate with requirePerm("all_access") (Step 7 will switch this to a dedicated permission — leave a one-line comment saying so). Compose: config/business-modules.js catalog; getFeatureFlagsMap + getModesMap (middleware/feature-flags.js) for state; per card return the computed STATE enum from config/business-modules.js (off/on/setup_required/connected/locked/attention_required) plus the card's scope — never a bare boolean; services/preset-apply.js expectedFlagsForPreset for "recommended for your industry" chips; connected-status for Bucket C cards by reusing the integrations hub aggregation queries (routes/integrations/hub.js) plus shopify_connections / company_profile FBR config / courier_integrations; locked:false placeholder for every card (Steps 5-6 wire the real lock). Register in routes/registerAllRoutes.js after tenant middleware, mirroring a sibling route module. Read ONE similar route file as reference, not several. Integration tests per PLAN.md Step 4 verify list.

Scope: read endpoint only — no writes, no schema, no frontend.
Autonomy: run fully; local PG tests; commit locally when green.
Report: outcome first — payload shape example for one Bucket A, one B, one C card showing the state enum.
```

---

## Step 5 — Migration: platform lock table + `tenant_business_modules` + super-admin backstop

> Moved before the toggle step (was Step 6): the toggle path needs `tenant_business_modules`
> to exist for the config-preservation (`saved_flags`) semantics.

- **Goal**: two tables. (1) The backstop that does not exist today (verified): public-schema table `platform_module_locks` (`module_key`, `locked_at`, `locked_by`, `reason`, optional `tenant_id` for per-tenant locks, NULL = global). (2) **Amendment**: per-tenant-schema table `tenant_business_modules` (`module_key TEXT PRIMARY KEY`, `enabled BOOLEAN NOT NULL`, `saved_flags JSONB`, `updated_by TEXT`, `updated_at TIMESTAMPTZ DEFAULT NOW()`) — module state + the pre-disable flag snapshot that makes "disabling preserves configuration; re-enabling restores the exact previous setup" possible. Plus admin lock CRUD endpoints + a minimal lock list in the admin UI. RLS on the new public table (repo rule — the every-deploy sweep re-covers it, but declare it in the migration anyway).
- **Touches**: `backend/migrate-pg.js` (new version — check current head, v130 at last check), `backend/schema-pg.sql`, `routes/admin/` (new lock endpoints + `logAdminAction`), `AdminTenantDetail.jsx` or a small admin page for lock management.
- **Model/effort**: claude-fable-5 / xhigh — schema/migration + a security boundary (tenant must not bypass platform decision).
- **Pause**: **YES, before starting** — schema/migration (playbook §3). Owner approves both table shapes and lock semantics (lock = "tenant cannot self-ENABLE"; already-on tenants are untouched — force-off remains the existing admin per-tenant flag write).
- **Verify**: migration runs cleanly on local `sanopos_dev` + test schemas (both tables; `tenant_business_modules` lands in every tenant schema via the MIGRATIONS array); admin CRUD perm-gated (`requireAllowedIp + requireSuperAdmin`) and audit-logged; direct SQL checks that lock rows round-trip. Lock ENFORCEMENT tests live in Step 6 (the service doesn't exist yet). NEVER run against prod in this step.
- **Done when**: ☐ migration idempotent locally; ☐ both tables in `schema-pg.sql`; ☐ admin CRUD live + audited.

**Prompt:**
```
Effort: xhigh.

Why: two prerequisites for the toggle path. (1) The owner's backstop requirement — a tenant must not self-enable what the platform has locked; no kill-switch mechanism exists today (verified in planning). (2) The config-preservation amendment — disabling a module must snapshot its flag choices so re-enable restores them exactly; that snapshot needs a home before the toggle path is built.

Task: Per docs/fable5/business-modules/PLAN.md Step 5 (the spec):
- New migration (check backend/migrate-pg.js MIGRATIONS head first) creating:
  (a) public.platform_module_locks (module_key TEXT, tenant_id INT NULL — NULL=global, locked_by TEXT, reason TEXT, locked_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY sensible for the two shapes) + ENABLE ROW LEVEL SECURITY (repo rule for public tables);
  (b) tenant-schema table tenant_business_modules (module_key TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL, saved_flags JSONB, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()) — this one goes through the normal per-tenant MIGRATIONS path so every active tenant schema gets it.
- Matching DDL in schema-pg.sql for both.
- Admin CRUD for locks (routes/admin/, requireAllowedIp + requireSuperAdmin, call logAdminAction): GET/PUT/DELETE locks. Small admin UI surface for it (follow the existing admin page conventions — adminFetch, not api.js).
Run the migration ONLY against local Postgres (sanopos_dev / test schemas). Never against Supabase.

Scope: exactly these two tables + admin CRUD + admin UI. No toggle logic, no services/business-modules.js — that is Step 6.
Autonomy: implement + tests per PLAN.md Step 5 verify list; commit locally when green.
Report: outcome first — migration version number, both table shapes, lock semantics recap, test results.
```

---

## Step 6 — Backend toggle path (the correctness-critical core)

- **Goal**: `POST /api/business-modules/:key/toggle` `{ enabled }` + `GET /api/business-modules/:key/impact`. Enforces every rule server-side: catalog-only keys (Bucket D unreachable); Bucket C rejects bare enable (409 → "use setup flow"); Bucket A flips mode row AND registry-bundle flags in ONE transaction; **config preservation (amendment)**: on disable, snapshot the card's current flag values into `tenant_business_modules.saved_flags` before turning them off — on re-enable, restore from the snapshot (full bundle defaults only on FIRST enable when no snapshot exists), so a merchant's sub-toggle choices survive an off/on cycle; `depends_on` handling with **change-preview (amendment)**: the impact endpoint covers BOTH directions — disable returns live counts + enabled dependents, enable returns the prerequisites that would also be enabled — so the UI can confirm before anything changes; enabling never silently changes other modules without the confirm having listed them; hide-not-delete (never touches domain data, never DELETEs `tenant_modes` rows); mode-backfill on first mode insert (the empty→enforcing transition trap — FEATURE-CATALOG "Critical transition trap"); audit row in `action_history`; invalidates flag AND mode caches; **real platform-lock check** (table exists from Step 5): locked → 403 `MODULE_LOCKED` on enable, disable always allowed, GET marks locked cards. **Legacy-endpoint lockdown (amendment)**: `PUT /api/feature-flags/:key` (`registerAllRoutes.js:431`) must reject any catalog-managed key (module primary flags, bundle flags, Bucket D flags) with 409 `{ code: "MANAGED_BY_BUSINESS_MODULES" }` — it remains usable only for `sub_toggles` and `UNMANAGED_FLAGS` keys, so the old endpoint can no longer bypass bucket rules, dependencies, mode sync, locks, or audit.
- **Touches**: `routes/business-modules.js`, new `services/business-modules.js` (toggle logic — keep the route thin), `schemas/business-modules.js` (Zod), `routes/registerAllRoutes.js` (the legacy PUT guard — the ONE sanctioned edit to that route), tests.
- **Model/effort**: claude-fable-5 / xhigh — flag+mode atomicity, the bucket-D gate, saved_flags restore, and the modes-transition trap are exactly the subtle-bug-is-expensive category.
- **Pause**: **YES, before starting** — this is a new tenant write path with mode semantics (playbook §3: multi-tenant/auth-adjacent). Owner approves the approach summary (this step's design as written), then execution proceeds.
- **Verify**: integration tests: (a) enabling Restaurant on a modeless retail tenant writes mode row + all 13 bundle flags in one tx and BACKFILLS mode rows for any already-enabled drifted flags; (b) disabling sets `enabled=false`, never deletes, domain tables untouched, and writes `saved_flags`; (c) re-enable restores access to pre-existing data; (d) **saved_flags round-trip**: turn a sub-flag off while the module is on → disable module → re-enable → the sub-flag is still off (NOT blanket-re-enabled); (e) Bucket C key → 409; (f) unknown/Bucket-D key → 404; (g) depends_on: impact endpoint lists prerequisites on enable direction; enabling wholesale_van_sales enables wholesale_field_sales (and the response names it); disabling a prerequisite returns dependent warning, proceeds only with `{cascade:true}`; (h) both caches invalidated (subsequent requireFeature/requireMode reflect the change within the same test); (i) audit row written; (j) perm-gated; (k) **legacy PUT lockdown**: `PUT /api/feature-flags/:key` with a module primary flag, a bundle flag, and a Bucket D flag each → 409/rejected; with a sub_toggle or UNMANAGED key → still works; (l) **locks**: global lock blocks enable for all tenants, per-tenant lock blocks one, locked module still DISABLEs fine, GET shows `locked:true`.
- **Done when**: ☐ all twelve test cases green; ☐ fresh-context verifier subagent has read `services/business-modules.js` against this step's spec and found no discrepancy.

**Prompt:**
```
Effort: xhigh.

Why: this is the write path of the self-service Business Modules feature. Every safety rule the owner agreed to (bucket enforcement, atomic flag+mode, hide-not-delete, config preservation, dependency preview, platform lock, closing the legacy bypass) lives here, server-side — the frontend is untrusted.

Task: Per docs/fable5/business-modules/PLAN.md Step 6 (read its full goal + verify list first — it is the spec):
- POST /api/business-modules/:key/toggle {enabled} and GET /api/business-modules/:key/impact in routes/business-modules.js, logic in a new services/business-modules.js, Zod schema in schemas/business-modules.js, same perm gate as the GET route.
- Bucket A: inside ONE deps.db.transaction, upsert the tenant_modes row (INSERT ... ON CONFLICT (mode) DO UPDATE SET enabled=$x — never DELETE) and upsert the card's flags, mirroring the super-admin cascade at routes/admin/tenants.js:686-719. Then invalidateFeatureFlagCache AND invalidateModeCache for req.tenantId.
- Config preservation: on DISABLE, first read the current values of every flag the card manages (bundle flags + sub_toggles) and write them to tenant_business_modules.saved_flags (upsert the row, enabled=false), THEN set those flags false. On ENABLE: if a saved_flags snapshot exists, restore exactly those values; only on first enable (no row / null snapshot) apply the full registry-bundle defaults. Update the row enabled=true either way.
- Modes-transition trap: if this insert creates the tenant's FIRST tenant_modes row, first backfill enabled=true rows for every mode whose registry flags are already enabled on this tenant (requireMode stops fall-through the moment one row exists — middleware/feature-flags.js:313).
- Bucket B: same saved_flags semantics, flags only, no mode row. Bucket C keys: reject toggle with 409 {code:"REQUIRES_SETUP", setup_route}. Keys not in the catalog (incl. every Bucket D flag): 404.
- depends_on + change preview: GET /:key/impact returns, for disable: the card's impact_queries counts (open tabs, checked-out rentals, upcoming bookings...) + currently-enabled dependents; for enable (?direction=enable): the prerequisites that would also be enabled. Toggle: enable auto-enables prerequisites (returned in the response so the UI names them — Step 9 shows them in the confirm BEFORE posting); disable with enabled dependents returns their list and proceeds only if body has {cascade:true}, which also disables the dependents (with their own saved_flags snapshots). Toggle never blocks on counts — the confirm UX is Step 9's job.
- Platform lock (real, table from Step 5): before an ENABLE, check global + per-tenant lock in public.platform_module_locks via masterDb; locked → 403 {code:"MODULE_LOCKED"}. DISABLE always allowed. Replace the Step 4 locked:false stub in GET /api/business-modules with the real check.
- Legacy-endpoint lockdown: in registerAllRoutes.js, the existing PUT /api/feature-flags/:key must consult config/business-modules.js and reject module primary flags, bundle flags, and Bucket D flags with 409 {code:"MANAGED_BY_BUSINESS_MODULES", module_key} — sub_toggles and UNMANAGED_FLAGS keys keep working. This is the ONE sanctioned edit to that route.
- Hide-not-delete: the toggle must never write to any domain table. Audit: one action_history row per toggle (actor, module, direction, flags touched).

Scope: exactly this. Do not modify mode-registry.js or preset-apply.js.
Autonomy: implement + full integration test matrix from PLAN.md Step 6 verify list (twelve cases) against local PG. Then spawn a fresh-context verifier subagent with only PLAN.md Step 6 + the new files to confirm the rules hold. Commit locally when green.
Report: outcome first, then the verifier's findings verbatim.
```

**Step 6 as-built notes (2026-07-10)** — deviations/resolutions, all surfaced to the owner in the step report:
1. **Toggle endpoint also accepts sub_toggle keys** (not just card keys). Required to make verify case (g) reachable: the only real dependency edges in the v1 catalog are sub_toggle→card (`wholesale_van_sales`→`field_sales`) and BucketC→card — there are no card→card edges among A/B. Bundle flags, UNMANAGED keys and unknown keys still 404.
2. **Legacy PUT lockdown scope**: rejects module primary + bundle flags (both `classifyFlag` role "primary", incl. Bucket C primaries like `marketplace_integrations`) with 409 `MANAGED_BY_BUSINESS_MODULES`. UNMANAGED_FLAGS (= Bucket D — Step 2 merged the two sets) and sub_toggles stay writable, per the ratified Step 2 config contract + the owner-approved design summary; the goal text's "Bucket D flags rejected" wording lost to that. Grep of frontend + backend found ZERO callers of this PUT for primary flags (FBR writes its flag via `/api/fbr/config`), so the guard breaks nothing.
3. **Lock check** uses the request's own db handle with an explicit `public.platform_module_locks` qualifier instead of masterDb — search_path-independent, equivalent in prod, and works in the test harness where master-db is not initialised.
4. **Bucket C dependents are NOT cascaded off** on a prerequisite disable (e.g. Delivery Aggregators under Restaurant): this endpoint can't re-enable a C card (409 REQUIRES_SETUP) and the legacy PUT rejects its primary flag, so zeroing it would be un-undoable from any tenant-facing surface. They are returned as `left_connected` for the UI to warn ("still connected — disconnect via its setup page"). Found by the fresh-context verifier.
5. **Idempotency guards** (verifier findings): a repeated disable no longer clobbers `saved_flags` with zeros (snapshot only overwritten when the module was effectively ON, or no snapshot existed); enable clears the snapshot after consuming it so a redundant enable can never re-apply stale values; a restored-true sub_toggle whose prerequisite is neither on nor being enabled in the same request is kept off and reported in `skipped_restores`.
6. **GET state×lock interplay**: `locked:true` on every locked card; state becomes `"locked"` only when the card is otherwise off/setup_required — a locked-but-running module keeps its real state (locks block self-enable, never force-off).

---

## Step 7 — Roles & permissions contract (NEW — second-opinion amendment)

- **Goal**: make module access delegable and the permission system self-consistent before the UI ships. (1) Central permission catalog: `backend/config/permissions-catalog.js` — every live permission string with `{ id, label, category, module_key? }`, sourced from `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_RULES`, and a grep of every `requirePerm`/`requireAnyPerm` call site. (2) New permission `manage_business_modules` registered in the catalog, granted to NO default role (Administrators pass via the `all_access` bypass) — switch the Step 4/6 business-modules routes from `requirePerm("all_access")` to `requirePerm("manage_business_modules")` so module management can later be delegated without full admin. (3) `GET /api/permissions-catalog` endpoint (perm-gated) and the role editor (`AdministratorRedesign.jsx`) consumes it instead of its stale 17-entry hardcoded list (verified missing at least 11 live permissions: `manage_rentals`, `manage_rooms`, `manage_tickets`, `manage_treatment_plans`, `manage_tips`, `manage_gift_cards`, `manage_field_sales`, `manage_forms`, `override_price`, `override_credit_limit`, `override_void_comp`). (4) `PUT /api/roles/:id/permissions` validates every submitted string against the catalog (400 on unknown — stops drift at the source). (5) Guard the two unguarded role reads (`GET /api/roles`, `GET /api/roles/:id/permissions` — `roles.js:5,86`) — grep frontend consumers FIRST to pick the right guard without breaking legit non-admin flows. (6) Each business-modules catalog entry gains a `permissions: []` field (the perms that grant use of that module), and `GET /api/business-modules` returns `roles_with_access` per card (role names whose permission set — DB `role_permissions` merged with defaults — intersects the module's perms, plus Administrator always), powering Step 9's "Staff roles that will gain access" confirm line. **Invariant: a module toggle never grants or revokes any permission — role assignments stay dormant while a module is off and work again on re-enable (same hide-not-delete principle as data).**
- **Touches**: new `backend/config/permissions-catalog.js`; `routes/roles.js`; `routes/business-modules.js` (perm switch + roles_with_access); `config/business-modules.js` (permissions field); `middleware/permissions.js` (register the new perm string in `PERMISSION_RULES` if applicable); `frontend/src/pages/redesign/AdministratorRedesign.jsx`; tests.
- **Model/effort**: claude-fable-5 / high — auth-adjacent but mostly additive; the risky edit is guarding existing role reads.
- **Pause**: **YES, before starting** — permission-guard changes to existing endpoints (playbook §3: auth-adjacent). Owner approves the chosen guard for the role GETs after the consumer grep is reported.
- **Verify**: unit test: every permission string appearing in any `requirePerm(...)`/`requireAnyPerm([...])` call site across `backend/routes/` exists in the permission catalog (the same bidirectional-enforcement idea as Step 2, applied to perms); integration tests: `PUT /api/roles/:id/permissions` rejects an unknown string; guarded role GETs 403 for a Cashier token and pass for the role editor's actual consumer; business-modules endpoints now pass with a custom role holding only `manage_business_modules` and 403 a Manager without it; `roles_with_access` on the Rentals card lists Administrator + Manager (Manager holds `manage_rentals` by default). Frontend: role editor renders the full catalog grouped by category (browser check).
- **Done when**: ☑ catalog + endpoint live; ☑ role editor complete; ☑ PUT validated; ☑ role reads guarded without breaking a verified consumer; ☑ `manage_business_modules` wired; ☑ `roles_with_access` in the GET payload.

**Prompt:**
```
Effort: high.

Why: the Business Modules page decides WHAT the business uses; roles decide WHO may use it. Three verified pre-existing gaps undermine that second half: the role editor's hardcoded permission list is missing 11+ live permissions (admins cannot build custom roles for half the verticals), PUT /api/roles/:id/permissions accepts arbitrary strings, and two role read endpoints have no permission guard. This step also creates manage_business_modules so module management is delegable without full admin.

Task: Per docs/fable5/business-modules/PLAN.md Step 7 (the spec — read its full goal + verify list):
1. backend/config/permissions-catalog.js: every live permission string as { id, label, category, module_key? }. Source it by combining DEFAULT_ROLE_PERMISSIONS + PERMISSION_RULES (middleware/permissions.js) with a grep of every requirePerm/requireAnyPerm call site under backend/routes/. Include manage_business_modules (new — category "System", granted to no default role). Add a unit test asserting every permission string used in any requirePerm/requireAnyPerm call site exists in the catalog — fails on drift.
2. GET /api/permissions-catalog (tenant chain, perm-gated to match the role editor's access level).
3. routes/roles.js: FIRST grep the frontend for every consumer of GET /api/roles and GET /api/roles/:id/permissions (AdministratorRedesign, EmployeesRedesign, anything else — check ContextSelect/attendance flows too), report what you find, then guard both GETs with the tightest permission that doesn't break a verified consumer (all_access if only admin pages consume them; otherwise requireAnyPerm as needed). PAUSE IS ALREADY CLEARED for the approach — but if the grep reveals a non-admin consumer that makes the guard ambiguous, stop and report instead of guessing.
4. PUT /api/roles/:id/permissions: validate the submitted array against the catalog; 400 listing the unknown strings.
5. Switch routes/business-modules.js from requirePerm("all_access") to requirePerm("manage_business_modules") (Administrators still pass — all_access bypasses requirePerm).
6. config/business-modules.js: add permissions: [] per card (the perms granting use of that module, e.g. Rentals → manage_rentals). GET /api/business-modules returns roles_with_access per card: role names whose effective permission set (role_permissions rows merged with DEFAULT_ROLE_PERMISSIONS) intersects the card's permissions, plus Administrator. A module toggle must never write to role_permissions — assignments stay dormant while off.
7. AdministratorRedesign.jsx: replace the hardcoded AVAILABLE_PERMISSIONS list with a fetch of GET /api/permissions-catalog (keep the existing grouped-by-category UI; Square primitives only).

Scope: exactly this. No changes to how requirePerm/requireAnyPerm evaluate; no default-role permission changes (Cashier keeps view_reports — splitting it is explicitly deferred to v2).
Autonomy: run fully; local PG tests; browser-check the role editor; commit locally when green.
Report: outcome first — the consumer-grep findings for the role GETs and the guard you chose, then the catalog size and test results.
```

**Step 7 as-built notes (2026-07-10)** — deviations/resolutions:
1. **Role-GET consumer grep** (the pause-gated decision): `GET /api/roles` is consumed only by AdministratorRedesign + EmployeesRedesign, both behind `perm("all_access")` routes → guarded `requirePerm("all_access")`. `GET /api/roles/:id/permissions` is consumed by **AuthProvider.refreshPermissions on every boot for every role** (Cashier/Field Rep included — this is also why the path was already in tenant-auth's `CONTEXT_EXEMPT_PATHS`), so an admin-only guard would break all non-admin logins. Guard chosen: self-or-admin — `all_access`/`manage_employees` read any role; anyone else only their own (`req.employee.role_id` on the JWT path, `x-employee-id` → employees lookup on the ST/harness path). A Cashier reading another role 403s, per the verify case.
2. **Catalog = 29 permissions** in `config/permissions-catalog.js`: the 25 from `DEFAULT_ROLE_PERMISSIONS`, plus 3 live route-guard strings outside any default role (`manage_customers`, `manage_products`, `manage_returns` — `manage_customers` is also in the provisioner's ALL_PERMISSIONS), plus new `manage_business_modules`. Inline `employeePerms.includes(...)` checks and PERMISSION_RULES contributed no additional strings. The unit test scans routes for `requirePerm`/`requireAnyPerm` (incl. multi-line arrays) AND inline `.includes("...")` checks.
3. **Card↔permission linkage is bidirectional**: catalog entries carry `module_key`; cards carry `permissions` (via `MODULE_PERMISSIONS` in config/business-modules.js — 11 cards have dedicated perms, the rest `[]`); the unit test fails on any one-sided edit. Cards with `permissions: []` list only all_access roles under `roles_with_access` — Step 9's UI should render that as "Administrators" (or "All staff" where the module has no perm gate at all), not imply lock-out.
4. **`roles_with_access` uses DB rows when a role has ANY role_permissions rows, defaults-by-name only as fallback** (goal text said "merged"). Blind merging would resurrect permissions an admin deliberately removed; DB-first matches what requirePerm actually enforces (loadTenantAndPerms reads only the DB). Production roles are fully seeded by ensureDefaultRolePermissions, so the fallback only covers pre-seed tenants.
5. **Two pg-batch8-middleware tests asserted the OLD open behavior** of `GET /api/roles` ("Roles GET doesn't require perms") — updated to expect the 403; their real point (empty perms must not crash the chain) still holds.
6. **PERMISSION_RULES gained a `/api/business-modules` entry** (`anyPerms: ["manage_business_modules"]`) — note the createTestApp harness auto-applies PERMISSION_RULES as middleware, so this is enforced in tests ahead of the route guard (same perm, consistent).
7. Browser-verified on local golv_party_supplies: role editor renders all 29 permissions in 12 category groups; saving the Manager role round-trips its 24 seeded permissions through the new PUT validation (200) — live proof no seeded permission is missing from the catalog.

---

## Step 8 — Frontend read-only Business Modules page

- **Goal**: `/settings/business-modules` renders the full picture with NO write actions: cards grouped (Recommended-for-your-industry first, then by bucket group), state badges driven by the backend `state` enum (On / Off / Locked / Needs setup / Connected), sub-toggle lists shown read-only, `depends_on` shown as "Requires X", **"Staff access: <roles_with_access>" line per card** (from Step 7's payload).
- **Touches**: new `frontend/src/pages/redesign/BusinessModulesRedesign.jsx` + thin `pages/BusinessModulesRoute.jsx`; route in `routes/appRoutes.jsx` (`perm("all_access", ...)` — the page is admin-facing; the API enforces `manage_business_modules`); nav entry in `ui/nav-config.js` Setup group. Style reference: `OutletTaxProfilesRedesign.jsx` (ui/primitives + `--ui-*` tokens only — Square design rule).
- **Model/effort**: sonnet / medium — routine UI composition against a finished endpoint; read-only first cut de-risks Step 9.
- **Pause**: no.
- **Verify**: browser preview against a local backend + test tenant: retail tenant shows Restaurant OFF + recommended chips matching its preset; restaurant tenant shows it ON; a Bucket C card shows "Set up" not a toggle; staff-access line renders; page absent for non-admin roles.
- **Done when**: ☐ page renders correct state for two differently-preset test tenants; ☐ Square-design compliant (primitives + tokens only).

**Prompt:**
```
Effort: medium.

Why: Business Modules page, read-only first — prove the data + layout before any write exists in the UI.

Task: Per docs/fable5/business-modules/PLAN.md Step 8. Build pages/redesign/BusinessModulesRedesign.jsx consuming GET /api/business-modules, plus the thin BusinessModulesRoute.jsx wrapper, route registration in routes/appRoutes.jsx as perm("all_access", ...), and a nav-config.js Setup-group entry. Use OutletTaxProfilesRedesign.jsx as the single style reference: PageShell/SectionCard/Badge/Button from ui/primitives, --ui-* tokens, no raw colors, no dark mode. Layout: "Recommended for your industry" section first (preset_recommended cards), then grouped cards with state badges driven by the backend state enum (On/Off/Locked/Needs setup/Connected), read-only sub-toggle lists, "Requires <module>" hints from depends_on, and a "Staff access: <roles_with_access joined>" line per card. No onClick writes anywhere.

Scope: read-only UI only. Do not touch useFeatureFlags, PresetContext, or any backend file.
Autonomy: verify in the browser preview against the local dev servers with a retail and a restaurant local test tenant; screenshot as proof. Commit locally when verified.
Report: outcome first + screenshot.
```

---

## Step 9 — Frontend interactive: toggles, confirm flows, setup cards, refresh

- **Goal**: wire the writes. Bucket A/B cards get toggles. **On DISABLE**: fetch `/impact` and show the warn+confirm dialog with live counts + enabled dependents + hide-not-delete copy (owner decision: warn+confirm, never block, never silent). **On ENABLE (amendment — change preview)**: if the card has `depends_on` or non-trivial `roles_with_access`, fetch `/impact?direction=enable` FIRST and show a confirm naming (a) "Will also enable: <prerequisites>" and (b) "Staff roles that will gain access: <roles_with_access>" — the POST fires only after confirm; enabling never silently changes other modules or surprises the owner about staff access. Bucket C cards are "Set up / Connect" buttons navigating to the existing flows (`setup_route`). Post-toggle propagation: refetch page state; add a `refresh()` to `useFeatureFlags` (window event the hook subscribes to, rewriting its localStorage cache) and a bootstrap re-fetch in `PresetContext` so nav + `hasMode` update without logout; note on-screen that open POS sessions pick changes up on next reload (POS fetches flags separately, plus the backend 60s cache).
- **Touches**: `BusinessModulesRedesign.jsx`; `hooks/useFeatureFlags.js` (additive refresh only); `contexts/PresetContext.jsx` (expose a `refreshPreset()`); `ui/primitives` ConfirmDialog reuse.
- **Model/effort**: claude-fable-5 / high — the refresh mechanics cross three cache layers (hook localStorage, PresetContext, backend 60s cache) and regressions here look like "toggle did nothing".
- **Pause**: no.
- **Verify**: browser walkthrough: enable Appointments on a retail tenant → nav gains the group without logout; enable Van Sales → confirm names Field Sales as auto-enabled BEFORE the POST; disable Rentals on a tenant with a checked-out contract → confirm dialog shows the count, data intact after; re-enable Rentals → previously-off sub-toggle still off (saved_flags visible in UI state); Bucket C card navigates to its setup page; locked card unclickable. Console/network clean.
- **Done when**: ☐ full toggle round-trip works in the browser with nav updating in-place; ☐ both confirm directions show real data; ☐ no regression to `useFeatureFlags` consumers (the inline-`{}` authHeaders trap — keep the hook's dep contract unchanged).

**Prompt:**
```
Effort: high.

Why: the interactive half of the Business Modules page. The risky part is post-toggle propagation across three cache layers (useFeatureFlags localStorage hook, PresetContext bootstrap, backend 60s flag/mode cache) — a toggle that "does nothing" until re-login is a failed feature.

Task: Per docs/fable5/business-modules/PLAN.md Step 9 (the spec — read its goal + verify list). Wire toggles for Bucket A/B cards to POST /api/business-modules/:key/toggle. DISABLE flow: first GET /:key/impact, show a ConfirmDialog (ui/primitives) with the named live counts, enabled dependents, and hide-not-delete copy ("data and settings are kept and restored on re-enable"). ENABLE flow: if the card has depends_on or roles_with_access beyond Administrator, first GET /:key/impact?direction=enable and show a confirm naming "Will also enable: <prereqs>" and "Staff roles that will gain access: <roles_with_access>" — POST only after confirm; a bare enable with no deps and admin-only access may skip the dialog. Bucket C cards: "Set up / Connect" button navigating to setup_route — no toggle. Locked cards: disabled control + "Contact support" hint. After a successful toggle: refetch the page payload; fire the new flags-refresh event — add an additive refresh() to hooks/useFeatureFlags.js (window event subscription + localStorage cache rewrite; do NOT change its existing dep contract, see the inline-{} authHeaders gotcha) — and call a new refreshPreset() exposed from contexts/PresetContext.jsx (re-fetch /api/context/bootstrap) so nav flag+mode gates update without logout. Add a small inline note that other open devices/POS sessions pick up changes on their next reload.

Scope: these files only. No backend changes. If a toggle appears not to propagate, the fix is in the refresh path — do not add polling.
Autonomy: full browser-preview verification per PLAN.md Step 9 verify list on local test tenants; commit locally when verified.
Report: outcome first + the walkthrough evidence (screenshots/network).
```

**Step 8+9 as-built notes (2026-07-11)** — deviations/resolutions:

1. **Sub-toggles are writable, not read-only** (extension beyond the Step 9 goal text, which only named card toggles). The backend deliberately makes sub_toggles reachable via `resolveToggleTarget`, so inline switches were wired: enabled only while the parent card is on; an enable with `depends_on` (Van Sales → Field Sales) runs the same `/impact?direction=enable` preview confirm as a card. This is NOT deferred item D3 (the expandable "Customize" editor) — just inline switches on the already-rendered list.
2. **`left_connected` surfaced as a warning toast** after a cascading disable ("X stays connected — disconnect it from its setup page"), completing the UI half of the Step 6 verifier finding on Bucket C cascade dead-ends.
3. **Enable-preview trigger rule as implemented**: dialog shows when `depends_on` is non-empty OR `roles_with_access` has any role besides Administrator; toggle POST sends `cascade:true` only on a confirmed disable that listed dependents.
4. **Not exercised in the Step 9 walkthrough** (deferred to the Step 10 matrix): disable-impact live counts > 0 (no local tenant had rental/appointment data — the counts rendering path filters to `count > 0` and is code-verified), and locked-card behavior (no platform locks seeded locally; the locked UI states exist from Step 8).
5. **Dev-only artifact**: editing `useFeatureFlags`'s hook list under Vite HMR threw one-time Rules-of-Hooks console errors on already-mounted components (module swap changes hook order mid-lifecycle). Fresh loads are clean — the new hook order is unconditional; 173 frontend unit tests green.

---

## Step 10 — End-to-end verification (fresh-context verifier + test-tenant walkthrough)

- **Goal**: prove the whole feature against the owner's spec with eyes that didn't build it, on local test tenants (and a read-only sanity pass against prod data via Supabase MCP for drifted-flag prevalence — no writes).
- **Touches**: nothing (verification only; fixes loop back into the relevant step).
- **Model/effort**: claude-fable-5 / high — verifier work; breadth matters more than depth per item.
- **Pause**: **YES, after** — owner reviews the verification report before docs/commit.
- **Verify (the matrix)**: (1) retail tenant enables Restaurant → mode+13 flags atomic, nav appears in-place, restaurant API 200s, POS layout UNCHANGED (gate-only decision); (2) disable with an open tab → warn+confirm with count, data intact, workers skip the tenant (run the worker poll locally, assert no-op); (3) re-enable → old data visible again; (4) **saved_flags round-trip in the UI**: sub-toggle off → disable module → re-enable → sub-toggle still off; (5) Bucket C card never bare-enables; FBR card launches `/settings/fbr`; (6) platform lock blocks enable, shows greyed card; (7) depends_on both directions, enable-preview confirm names prerequisites BEFORE the POST; (8) modeless-tenant first-mode backfill (seed a drifted flag first); (9) Bucket D flags unreachable via the new endpoints; (10) **legacy PUT `/api/feature-flags/:key` rejects a module flag, a bundle flag, and a Bucket C primary flag (409 MANAGED_BY_BUSINESS_MODULES); still accepts a sub_toggle AND a Bucket D flag — Bucket D keys are unmanaged by the new page, so the legacy endpoint stays their only writer (this line originally said D should be rejected; corrected after Step 10 verification to match the ratified as-built contract)**; (11) action_history rows present; (12) non-admin sees no page and gets 403s; a custom role holding only `manage_business_modules` CAN toggle; (13) **role editor shows the full permission catalog; `PUT /api/roles/:id/permissions` rejects a bogus string; guarded role GETs 403 a Cashier**; (14) **enable confirm shows "Staff roles that will gain access"; toggling wrote nothing to `role_permissions`**; (15) expired-tenant PUT blocked (subscription middleware) — confirm acceptable UX.
- **Done when**: ☐ verifier report filed under `docs/fable5/business-modules/VERIFICATION.md` with pass/fail per matrix item; ☐ all fails fixed and re-verified or explicitly waived by owner.

**Prompt:**
```
Effort: high.

Why: pre-merge proof. Fresh-context verification per playbook §4 — you did not build this; trust live behavior over the implementation's claims.

Task: Read docs/fable5/business-modules/PLAN.md Step 10 verification matrix and FEATURE-CATALOG.md. On the local stack (local Postgres, backend + frontend dev servers), provision or reuse two test tenants (one general_retail, one restaurant preset) and execute every matrix item end-to-end — browser walkthrough for UI items, direct API calls for gate items (including the legacy PUT /api/feature-flags/:key lockdown and the roles/permissions items), a manual worker-poll invocation for the worker-silence item. For prod, do READ-ONLY checks via Supabase MCP: count tenants with mode-flag drift (flags on without their mode row) to size the Step 6 backfill's real-world exposure. Never write to prod.

Scope: verification only. File docs/fable5/business-modules/VERIFICATION.md with pass/fail + evidence per item. Do not fix anything — report.
Autonomy: run the whole matrix; end the turn with the report. The owner reviews before anything is committed further.
Report: verdict first (ship / fix-first, worst finding named), then the per-item table.
```

---

## Step 11 — Docs, memory, final review, commit & push

- **Goal**: close out: update `backend/CLAUDE.md` + `frontend/CLAUDE.md` + root `CLAUDE.md` (new route file, config modules incl. permissions catalog, lock + module-state tables, legacy PUT restriction, refresh mechanics), write memory files per convention (at minimum: the modes empty→enforcing transition trap + the three-cache refresh path + the saved_flags restore semantics), run `/code-review` on the branch diff, tidy commits, push `feat/business-modules` (no PR — git-workflow rule).
- **Touches**: CLAUDE.md files, memory dir, git.
- **Model/effort**: sonnet / medium — routine doc/memory work; the code-review skill does the heavy lifting.
- **Pause**: **YES** — push only on explicit owner go; owner also decides merge timing (no PR unless asked).
- **Verify**: code-review findings triaged (fix or explicitly accept); docs match source (verify claims against code, not this plan); memory files follow one-fact-per-file + MEMORY.md pointers.
- **Done when**: ☐ review clean or accepted; ☐ docs + memory updated; ☐ branch pushed after owner go.

**Prompt:**
```
Effort: medium.

Why: close out the Business Modules build — docs, memory, review, push.

Task: On feat/business-modules: (1) run /code-review on the branch diff and fix or explicitly justify each finding; (2) update backend/CLAUDE.md, frontend/CLAUDE.md, and root CLAUDE.md for the new route/config/service files (business-modules + permissions-catalog), the platform_module_locks + tenant_business_modules tables, the PUT /api/feature-flags/:key catalog-managed-key restriction, and the flags-refresh mechanics — verify every sentence against source, not against PLAN.md; (3) write memory files per the existing one-lesson-per-file convention (at minimum: tenant_modes empty→enforcing transition trap; the three-cache post-toggle refresh path; saved_flags config-preservation semantics; anything Step 10 taught) + MEMORY.md pointers; (4) tidy the branch history if needed. STOP before pushing — report and wait for my explicit go, then push the branch only (no PR).

Scope: docs/memory/review/git only — no feature-code changes except review fixes.
Report: outcome first — review verdict, docs touched, memory files added; then the push-ready statement.
```

---

## Open questions / accepted defaults (owner can override at any pause)

1. **Defaults locked by owner 2026-07-10**: curated bundles; warn+confirm (never block) on disable; gate-only mode enabling; simple depends_on.
2. **Amendments locked by owner 2026-07-10 (second-opinion review)**: legacy flag-endpoint lockdown; saved_flags config preservation; scope + state-enum catalog metadata; enable-direction change preview; bidirectional catalog + permission tests; roles & permissions contract step; `manage_business_modules` permission; module toggles never touch `role_permissions`. Deferred items are listed below — they were considered and postponed, not missed.
3. **Accepted defaults (from planning, override if wrong)**: toggles audited to `action_history` + visible to super-admin; refresh in place with reload fallback note; Bucket C connected-state derived from stored credentials; lock semantics = "cannot self-ENABLE" (force-off stays the existing admin per-tenant flag write); expired paid tenants cannot toggle (existing subscription middleware — by design).
4. **Biggest risk surfaced by grounding**: the `tenant_modes` empty→enforcing transition + existing flag drift (a drifted `phase4_*` flag without its mode row 403s the moment ANY first mode row is written). Mitigated by the Step 6 backfill; Step 10 sizes real-world drift on prod read-only.
5. **Restaurant gate-only caveat**: enabling Restaurant on a retail tenant gives fully working floor/checks/KDS pages but the POS itself keeps the retail layout (`pos_layout_mode` is static per industry preset — `auth.js:227`). Card copy should say so. Full restaurant POS = industry switch, out of v1 scope by decision.
6. **Not in scope, noted**: `GET /api/feature-flags`'s weak header-only auth (pre-existing — its PUT sibling IS being restricted in Step 6, but the GET's auth model is untouched); any re-skinning.

---

## Deferred to v2 (explicit decisions, 2026-07-10 — NOT omissions)

Each deferral leaves its fingerprints in the v1 data model (noted per item) so adopting it later
costs no schema redesign or backfill against live tenants.

| # | Deferred item | Why deferred | v1 fingerprint that keeps it cheap |
|---|---|---|---|
| D1 | **Per-outlet module activation** (outlet override table, "enabled at 2 of 5 locations" UI, per-location impact counts, outlet-aware worker gating, location-aware depends_on) | Roughly the size of the entire v1 plan; current tenants haven't asked; would triple the Step 10 matrix | `scope` field on every catalog entry (Step 2). Adopt later via the two-table inherit model: `tenant_business_modules.default_outlet_enabled` + an `outlet_business_modules(outlet_id, module_key, enabled)` override table — explicit row wins, missing row inherits, company-off wins everywhere |
| D2 | **Per-outlet role overrides / regional managers** (`role_id` on `employee_outlets`, relaxing the Manager/Cashier single-outlet policy at `employees.js:212`) | HR/auth-model change touching every authenticated request; its own project with its own verification | Permission catalog (Step 7) is the prerequisite and ships in v1; `employee_outlets` already exists with the right grain |
| D3 | **Sub-toggle "Customize" editing in the module UI** (expandable per-card child options) | Additive UI; the substantive complaint ("disable erases my choices") is solved by saved_flags in v1 | GET already returns `sub_toggles`; legacy PUT still writes them; saved_flags preserves them across off/on cycles |
| D4 | **Splitting `view_reports`** into `view_sales_reports` / `view_inventory_reports` / `view_financial_reports` / etc. (Cashier default review) | Orthogonal to modules; changes new-tenant defaults; deserves its own small effort + comms | Permission catalog (Step 7) gives the registry the split lands in; no schema change needed |
| D5 | **Full mode normalization** (materialize explicit mode rows for ALL tenants, then make `requireMode` fail closed on missing rows) | Transition backfill (Step 6) is the safe v1 posture; normalize after Step 10's read-only prod drift count sizes the blast radius | Step 6 first-mode backfill + the drift count from Step 10 are the migration's input data |
| D6 | **Guided setup wizards for Bucket A verticals** (Rooms/Rentals/Restaurant "get started" flows beyond Bucket C credential setup) | Content/UX work, not architecture; nothing blocks it later | `setup_required` / `attention_required` states exist in the enum from day one |
| D7 | **Delegation permissions beyond modules** (`manage_integrations`, `manage_outlet_modules`, `manage_roles` as separate trusted perms) | v1 delegation need is covered by `manage_business_modules`; finer slicing follows real demand | Permission catalog (Step 7) is the registry they slot into |
| D8 | **New-branch "copy settings from" flow** (module + config inheritance when adding an outlet) | Depends on D1; meaningless while modules are tenant-wide | `scope` metadata + D1's inherit model define the copy semantics |

**Rule for all future work**: any new feature flag must be classified in `backend/config/business-modules.js` (card, sub_toggle, or `UNMANAGED_FLAGS`) — the Step 2 bidirectional test enforces this at CI level. Any new permission string must be registered in `backend/config/permissions-catalog.js` — the Step 7 test enforces that.
