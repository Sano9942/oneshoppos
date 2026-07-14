# Business Modules v2 — Deferred Items Implementation Plan (D1–D8)

> Executes ALL eight items from PLAN.md's "Deferred to v2" table (owner decision 2026-07-11:
> full scope, one plan, grandfather-style D4 migration, full v1-style verification tail).
> Read [PLAN.md](PLAN.md) (v1) and [FEATURE-CATALOG.md](FEATURE-CATALOG.md) before executing any
> step — every v1 fingerprint this plan builds on (scope metadata, saved_flags, permission
> catalog, state enum) is documented there.
> Branch: `feat/business-modules-v2`. Planning session: 2026-07-11. Migration head at planning: **v132**.
>
> **Amended 2026-07-11 (second-opinion review, owner-approved)**: (a) D6 moved AFTER D1 (its
> verticals are outlet-scoped — checklist queries must be born outlet-aware, not rebuilt);
> (b) one shared validated "requested outlet" resolver, consumed by context resolution,
> outlet-assignment enforcement, outlet gating, and D2 role resolution — never three
> interpretations of the same header; (c) outlet-scoped OPERATIONAL routes fail closed
> (`403 OUTLET_CONTEXT_REQUIRED`) when no outlet resolves — company-level fallback only on an
> explicit settings/reports/admin allowlist; (d) `hybrid`-scoped cards (9 in the catalog,
> `business-modules.js:783-925` — FBR/Shopify/Woo/couriers/payments/channels) stay TENANT-WIDE
> in v2 and reject outlet operations; per-outlet operational enablement for hybrids is a v3
> contract (E4); (e) `default_outlet_enabled` gets a real write path + defined sparse-row
> semantics; (f) D4 posture changed by owner ruling: pristine-default Cashier roles migrate to
> sales-only, customized roles grandfathered (see Step 4); D4a classifies returned DATA, not
> just route guards, and inventories tests/types too; (g) D8 implements only the module-override
> copy, pausing BEFORE any wider allowlist; (h) D2 contract hardened: `ON DELETE SET NULL`,
> base+effective identity in payloads, effective permissions served by a context-aware bootstrap
> (AuthProvider's `/api/roles/:id/permissions` fetch cannot represent overrides), 6-case
> no-context/reverse-override test matrix; (i) query budgets: bulk queries + query-count
> assertions on the GET payload and checklists; (j) delivery = one branch, THREE owner-gated
> merge/deploy gates (governance → per-outlet → per-outlet roles) so request-wide auth changes
> never ship in one giant release.
>
> **Amended 2026-07-11 (audit integration, owner-approved — see AUDIT-FINDINGS.md)**: the same-day
> consolidated audit is folded into this plan so v2 and the audit complete together: (k) a new
> **Wave 0** (Steps W0a/W0b + **Gate 0**) ships the independent CONFIRMED defects — S1
> `pos_discount` enforcement, S4 admin self-lockout guard, C1 employees-guard relax, P1 POS-redirect
> fix, C3/C5/C7 — to `main` BEFORE Step 1 branches (a live security hole does not wait behind
> Gate 1's migrations); (l) S3 Field Rep split (`execute_field_sales`) folded into Step 2; (m) the
> C2 Manager-page rulings, the C6 `manage_employees` split, and the unguarded-mutation trio are
> batched into Step 3's ratification pause and applied in Step 4 (with the C4
> `DEFAULT_ROLE_PERMISSIONS` durability rule named); (n) S5 cost-free sales-only product reads →
> Step 4; (o) new Step 6b adds the capability-registry drift tests + truthless-flag disposition;
> (p) Step 11's checklists REPLACE the `DashboardOnboarding.jsx` proxies (delete, don't run in
> parallel); (q) C8 permission-change refresh folded into Step 14; (r) the 78-endpoint frontend
> coverage clusters are explicitly EXCLUDED from v2 → separate plan (E7); preset operator roles →
> E8; (s) the **audit-disposition table** (end of file) is the completeness contract — Step 15
> walks it so no finding drops silently.
>
> **Guiding rules (carried from v1, owner-adopted)**: bundles recommend, customers decide;
> disabling preserves configuration; enabling never causes hidden side effects; hide-not-delete;
> a module toggle never grants or revokes any permission. **New v2 rules**: company-level OFF
> wins at every outlet; an outlet override can only narrow, never widen, what the company
> enabled; a per-outlet role override is scoping, NOT a security demotion — hard demotion =
> change the base role.

## Progress tracker

| Step | Title | Status | Pause? |
|---|---|---|---|
| 0 | Commit this plan + audit docs (docs-only, to main) | ☑ done | — |
| W0a | Wave 0 — backend security fixes (S1 `pos_discount`, S4 admin lockout, C1 employees guard) | ☑ done (verified) | **PAUSE before** (money-path + auth guards, destined for main) |
| W0b | Wave 0 — frontend correctness fixes (P1 POS redirect, C3, C5, C7, kiosk-login disposition, v1 erratum) | ☑ done (verified) | — |
| — | **GATE 0: merge + deploy Wave 0 to `main` (pre-branch)** | ☑ done (merged 5befd903, deployed) | **PAUSE — owner-gated merge/deploy/watch** |
| 1 | Create working branch (off post-Gate-0 main) | ☑ done (`feat/business-modules-v2`) | — |
| 2 | D7 + S3 — Delegation permissions (`manage_integrations`, `manage_roles`, reserve `manage_outlet_modules`) + Field Rep split (`execute_field_sales`) | ☑ done (committed f691a4b4, migration v133) | **PAUSE before** (auth-guard changes) |
| 3 | D4a — Report-permission taxonomy + data-level classification + mapping table + audit-rulings batch (C2, C6, unguarded trio) | ☑ done — **RATIFIED by owner 2026-07-12, all recommendations as written** ([REPORT-PERMS.md](REPORT-PERMS.md) header block) | **PAUSE after** (owner ratifies taxonomy + mapping + pristine-Cashier detection + audit rulings) — ✅ cleared |
| 4 | D4b — Split-posture migration + guard sweep (34 route files) + frontend perms + ratified audit rulings (C2/C6/S5, C4 rule) | ✅ DONE (local, committed) — migration v134 idempotent + both postures verified on `sanopos_dev` (47 pristine / 95 grandfathered / 0 residual `view_reports`), drift green, 13/13 focused split+S5 test | **PAUSE before deploy** (Gate 1 still ahead) — migration + guard changes verified locally, not deployed |
| 5 | D5 — Full mode normalization (materialize rows, `requireMode` fail-closed) | ☑ done (committed a8d7a084, migration v135) — **warn-and-pass posture shipped**; the hard-fail-closed flip is a SEPARATE release with its own spec + prompt → see **"Post-Gate-2 release — D5 follow-up"** (after the GATE 2 section). Evidence-gated, not calendar-gated; blocker = proving the v135 provisioning seeders in prod | **PAUSE before** — ✅ cleared (owner picked warn-and-pass) |
| 6 | D3 — Sub-toggle "Customize" polish (descriptions, collapse, parent-off states) | ☑ done (committed f755525d) | — |
| 6b | Capability-registry drift tests + truthless-flag disposition | ☑ done (committed d2454f9b + 2ddbd8d7) — drift tests + truthless-flag ruling executed | **PAUSE mid-step** — ✅ cleared (wire-vs-retire ruled + executed) |
| — | **GATE 1: merge + deploy governance slice (D7+S3+D4+D5+D3+6b)** | ☑ done — merged `31bdc884` + DEPLOYED 2026-07-12 (Railway + Vercel READY; migrations v133/v134/v135 applied to all 29 prod tenants → schema_version 135; post-deploy read-only checks green: Cashier splits, Field Rep execute_field_sales, modes 10/10, zero stale view_reports, health deep ok, no empty-modes warns) | **PAUSE — cleared (owner go given)** |
| 7 | D1a — Per-outlet schema + catalog groundwork (migration, hybrid rule, sparse-row rule) | ☑ done (committed b0cffda4, migration v136; pushed, NOT deployed — Gate 2 ahead) | **PAUSE before** — ✅ treated pre-approved (prompt froze the DDL + rules verbatim) |
| 8 | D1b — Backend per-outlet read + toggle paths (resolution service, default write path, query budget) | ☑ done (committed da56dd45; 18/18 new tests, v1 suites byte-compat) | **PAUSE before** — ✅ cleared (clear=lock-exempt; column-scoped default upsert) |
| 9 | D1c — Shared outlet resolver + outlet-aware enforcement (fail-closed, workers, surface audit) | ☑ done (committed `013f83f3`; pushed, NOT deployed) — resolver + outlet-aware gates + 9-site allowlist + 8 workers filtered + surfaces; 22/22 new tests; full-suite 63/27 vs baseline 65/31 (strictly fewer); see Step 9 as-built | **PAUSE before** — ✅ cleared (owner approved design + Rulings 1–3 as recommended) |
| 10 | D1d — Frontend per-outlet UI ("On at 2 of 5 locations", location matrix, defaults control) | ☑ done (committed `8bf95eb2`; pushed, NOT deployed) — location summary + matrix Drawer + defaults control + delegation perm wired end-to-end; browser-verified on a seeded 3-outlet golv_restaurant + single-outlet golv_salon + a manage_outlet_modules-only role; frontend units 185/185. See Step 10 as-built | — |
| 11 | D6 — Guided setup checklists (outlet-aware from birth; REPLACES DashboardOnboarding proxies) | ☑ done (verified) — `c6557946` | — |
| 12 | D8 — "Copy settings from" flow (modules only; allowlist pause) | ☑ done (verified) — Phase 1 `3e0b101a`, ruling + Gate-2 prompt `b061363d`, 5-table follow-up `ae897d25`. **Pause CLEARED 2026-07-14** (all 11 tables ruled; see the as-built ruling table) | **PAUSE mid-step** — ✅ cleared (owner ruled table-by-table; 5 COPY / 7 NEVER / approval_policies→after-D2 / modifier_groups→E6) |
| — | **GATE 2: merge + deploy per-outlet slice (D1+D6+D8)** | ◐ in progress (2026-07-14) — ledger reconciled (4 drifts fixed, E9 added), code-review + verification subset running | **PAUSE — owner-gated merge/deploy/watch** |
| 13 | D2a — Per-outlet roles backend (investigate → pause → implement) | ☐ not started | **PAUSE mid-step** (auth-model design sign-off after Phase 1 findings) |
| 14 | D2b — Per-outlet roles frontend (bootstrap-driven perms) + role-surface audit + C8 refresh | ☐ not started | — |
| 15 | End-to-end verification (fresh-context verifier + full v1+v2 regression + prod read-only + audit-disposition sweep) | ☐ not started | **PAUSE after** (owner reviews VERIFICATION-V2.md) |
| 16 | Docs, memory, final review — **GATE 3: merge + deploy D2 slice** | ☐ not started | **PAUSE** (push/merge owner-gated) |

Status values: `☐ not started` / `◐ in progress` / `☑ done (verified)` / `⊘ skipped`. Update this table at the start and end of every session.

**Commit policy** (playbook §3, same as v1): approving this plan pre-authorizes **local commits to `feat/business-modules-v2`** (and to `fix/audit-wave0` for Steps W0a/W0b) at the end of each verified step. Pushes, merges, deploys, and PRs stay explicitly owner-gated (the four Gates).

**Gate protocol** (each of the four Gates — Gate 0 = Wave 0 to main; Gates 1–3 = the v2 slices): (1) `/code-review` on the slice diff — fix or justify findings; (2) run the slice's verification subset (named per gate below) + full backend suite diffed against the ~57-failure baseline; (3) update the affected CLAUDE.md sections for the slice (full docs sweep still happens in Step 16); (4) STOP — owner gives explicit go; (5) push branch, merge to main, watch Railway + Vercel deploys, run the slice's post-deploy live check on a golv_* tenant (read-only on real tenants); (6) continue the same branch from the merged state. Deploy-day notes per gate: Gate 0 runs NO migrations (see its section for the two behavioral changes + the pre-deploy blast-radius check); Gate 1 runs the D4 + D5 migrations plus the Step 2 Field Rep migration on prod boot (behavioral the moment they run); Gate 2 runs the D1 schema migration (inert until toggles are used); Gate 3 runs the D2 column migration (inert until overrides are assigned).

**Standing rules for every step prompt**: run on the branch from Step 1; local Postgres only (`backend/.env.test` / `sanopos_dev`) for tests and migrations — NEVER run migrations against prod; Supabase read-only; verify against code not docs (v1's PLAN.md as-built notes supersede its goal text where they conflict); audit ALL call paths when touching flags/modes/perms/visibility (the recurring bug class: POS fixed, storefront/field-rep/kiosk still broken); any new feature flag must be classified in `backend/config/business-modules.js` and any new permission registered in `backend/config/permissions-catalog.js` — the v1 bidirectional tests enforce both at CI level; all UI uses `ui/primitives` + `--ui-*` tokens (Square design rule, no raw colors, no dark mode); backend integration tests run from `backend/` cwd.

**Model key**: `claude-fable-5` (a.k.a. Fable; substitute Opus 4.8 only if Fable capacity is unavailable) for correctness-critical / auth / schema / cross-cutting steps; `sonnet` for routine implementation against a finished spec. **Fallback rule (owner-requested, applies to every step)**: when a Fable step must run on Opus 4.8, raise the listed effort one level (medium → high, high → xhigh; xhigh stays xhigh **plus** a mandatory self-review pass of the full diff before commit). `sonnet` steps are unaffected by Fable availability; if a sonnet step needs an upgrade for judgment reasons, use Opus 4.8 at the step's listed effort.

---

## Step 0 — Commit this plan

PLAN-V2.md is untracked at planning time; Step 1 requires a clean tree. Commit this file **plus the audit deliverables** — `AUDIT-FINDINGS.md`, `docs/fable5/frontend-coverage-audit/` (Step 6b reuses `scan.cjs` as the registry-test engine), `docs/fable5/role-audit/` (Steps W0a/3/4 consume its `REPORT.md` + `role-matrix.json`) — to `main` — docs-only, no code — before Wave 0 starts. One command, no prompt needed.

---

## Step W0a — Wave 0: backend security fixes (S1 + S4 + C1) — on `main`, before branching

> Wave 0 exists because these are live defects independent of every v2 feature: S1 is a
> production security hole (any authenticated employee can apply arbitrary discounts), and none of
> them should queue behind Gate 1's migrations and pauses. Branch `fix/audit-wave0` off main;
> Gate 0 merges + deploys it; Step 1 branches v2 AFTER that, so the fixes sit inside v2's baseline
> — no merge headache, no lost-fix risk (memory lesson `feedback_consolidation_lost_fix`).

- **Goal**: (1) **S1 — enforce `pos_discount`** (AUDIT §4A): `POST /api/sales` applies body `discount_amount` and line-level discounts with no permission check (`sales.js:593,601,1319` — re-grep, don't trust line numbers). Manual discounts (order- and line-level) now require `pos_discount` (`all_access` bypasses; default Cashier already holds it, so only custom roles lacking the perm are affected — matching what the POS UI already implies). System-computed discounts (promo engine, schemes, price books, loyalty redemptions) are NOT gated. Violation behavior: **403 `DISCOUNT_NOT_PERMITTED`** (reject, never silently strip). **All-call-paths rule** (memory `feedback_parallel_paths`): inventory EVERY writer that creates sales or carries a discount into one — POS, field-rep order capture (`routes/field.js` → `POST /api/sales`), storefront cart, customer-portal reorder, restaurant tabs/kiosk, draft-order convert, quotation convert, subscriptions billing — and document per path whether a manual discount can arrive there and how it is now handled. If a path cannot distinguish manual from system-computed, stop and report instead of guessing. (2) **S4 — admin self-lockout guard** (AUDIT §4A): `PUT /api/roles/:id/permissions` (`roles.js:161`) rejects with 400 `CANNOT_REMOVE_LAST_ADMIN` any update that would leave zero roles holding `all_access`; the built-in Administrator role must always retain `all_access`. (3) **C1 — staff-dropdown guard relax** (AUDIT §4B, highest-impact one-liner): `GET /api/employees` (`employees.js:45`) from `all_access` to `requireAnyPerm(["manage_employees"])` — fixes the empty staff filter on 21 Manager pages.
- **Touches**: `backend/routes/sales.js` (+ any sibling sale-writer the inventory implicates), `backend/routes/roles.js`, `backend/routes/employees.js`; tests.
- **Model/effort**: claude-fable-5 / high (Fable unavailable → Opus 4.8 / xhigh) — money-path enforcement + auth guards.
- **Pause**: **YES, before starting** — money-path + auth changes destined for `main`.
- **Verify**: integration: token without `pos_discount` posting `discount_amount > 0` → 403 `DISCOUNT_NOT_PERMITTED`; same token, zero discount → 200; token holding the perm → 200; promo-engine-applied discount unaffected for both tokens; line-discount path passes the same matrix; the call-path inventory table filed (every sale writer, manual discount reachable y/n, handling); roles PUT stripping the last `all_access` → 400 while any other Administrator-role edit still works; `GET /api/employees` 200 for Manager, 403 for Cashier; browser spot-check 2–3 of the 21 Manager pages' staff dropdowns; full backend suite diffed against the ~57-failure baseline.
- **Done when**: ☐ all three fixes green; ☐ call-path table filed; ☐ zero new suite failures.

**Prompt:**
```
Effort: high. Model: claude-fable-5 (if unavailable: Opus 4.8 at effort xhigh + a self-review pass of the diff before commit).

Why: three CONFIRMED audit defects independent of Business Modules v2 that must not wait behind it. S1 is a live security hole: POST /api/sales trusts body discount_amount with no pos_discount check, so any authenticated employee — even a custom role explicitly denied the discount permission — can apply arbitrary discounts. S4 lets an Administrator accidentally strip all_access from the last admin role (boot re-seeding is the only accidental recovery). C1 blanks the staff dropdown on 21 Manager pages.

Task: Create branch fix/audit-wave0 off main and work on it. Per docs/fable5/business-modules/PLAN-V2.md Step W0a (the spec) + docs/fable5/role-audit/REPORT.md:
1. S1: FIRST inventory every code path that creates a sale or carries a discount into one: routes/sales.js (order-level discount_amount ~:593,601 and the line-level path ~:1319 — re-grep), field-rep order capture (routes/field.js posts to /api/sales), storefront cart, customer-portal reorder, restaurant tabs + kiosk, draft-order convert, quotation convert, subscriptions billing. Report the table (path, manual discount reachable y/n, gate applied or why not). Then enforce: manual order-level and line-level discounts require pos_discount (all_access bypasses); violation → 403 { code: "DISCOUNT_NOT_PERMITTED" }. Do NOT gate system-computed discounts (promo engine, schemes, price books, loyalty) — distinguish by source; if a path can't distinguish manual from computed, STOP and report options instead of guessing.
2. S4: routes/roles.js PUT /api/roles/:id/permissions — reject (400 CANNOT_REMOVE_LAST_ADMIN) any update that would leave zero roles holding all_access; the built-in Administrator role always retains all_access.
3. C1: routes/employees.js:45 GET /api/employees guard from all_access to requireAnyPerm(["manage_employees"]).

Scope: exactly these three fixes + their tests. No refactors, no other audit items (W0b handles the frontend set), no v2 work.
Autonomy: run fully; local PG tests from backend/ cwd; diff against the ~57 baseline; browser spot-check two Manager pages' staff dropdowns. Commit locally to fix/audit-wave0 when green. Do not push.
Report: outcome first — the S1 call-path table, then the three fixes' test evidence.
```

---

## Step W0b — Wave 0: frontend correctness fixes (P1 POS redirect + C3 + C5 + C7) + v1 erratum

- **Goal**: (1) **P1 — POS redirect replaces the retail till** (AUDIT §3, most important finding): `POSRoute.jsx:19` redirects to `/pos/restaurant` on `hasMode("restaurant") && flags.phase4_restaurant`; `enabled_modes` comes from the `tenant_modes` table (`auth.js:213`), so a retail tenant that enables the Restaurant module gets its POS replaced — contradicting v1's gate-only decision, the shipped card copy, and v1 VERIFICATION.md item 1 (a verification miss). Fix: key the redirect on `pos_layout_mode` from PresetContext (or preset industry / an explicit tenant choice) — FIRST verify what real restaurant tenants carry (`golv_restaurant`, the restaurant + cafe test tenants) so genuine restaurant presets KEEP the restaurant POS; if the data is ambiguous, stop and report options instead of guessing. Also: correct the v1 Restaurant card copy in `config/business-modules.js` if it still overpromises, and file an erratum note in v1 `VERIFICATION.md` (item 1 passed on a miss). (2) **C3** — `DashboardRedesign.jsx:47` infers "manager view" from `view_reports`, giving Cashiers owner cards: gate each widget by its real permission, never infer role (Step 4 re-sweeps these when `view_reports` splits — use today's real perms, not future split names). (3) **C5** — `AppLayoutRedesign.jsx:33` hardcodes id 1=Admin/2=Manager/else Cashier in the account drawer: display the backend `role_name`. (4) **C7** — align the 4 nav/route mismatches (Attribute Sets, Recalls, Handouts, Receipt Templates) per `role-matrix.json`: route wrapper and nav guard must agree. (5) **kiosk-login disposition** (AUDIT §2): `POST /api/auth/kiosk-login` has zero frontend callers though CLAUDE.md documents it as the kiosk login — investigate (git history, kiosk pages, possible external/PWA callers) and RECOMMEND remove vs wire; report only, owner rules at Gate 0.
- **Touches**: `frontend/src/routes/` (POSRoute wrapper), `DashboardRedesign.jsx`, `AppLayoutRedesign.jsx`, `ui/nav-config.js` + `routes/appRoutes.jsx` (C7), `config/business-modules.js` (card copy if needed), v1 `VERIFICATION.md` (erratum note); tests.
- **Model/effort**: claude-fable-5 / high (Fable unavailable → Opus 4.8 / xhigh) — the P1 re-keying has real judgment: restaurant tenants must keep their POS.
- **Pause**: no (same branch, runs after W0a).
- **Verify**: browser: a retail tenant with the Restaurant module ON lands on the retail POS (restaurant surfaces still reachable via nav); a restaurant-preset tenant still lands on `/pos/restaurant`; Cashier login shows no owner cards on the dashboard; a custom role shows its actual name in the account drawer; the 4 C7 pages' route access matches nav visibility per role; kiosk-login recommendation filed with evidence; frontend unit tests green.
- **Done when**: ☐ all four fixes browser-verified both directions; ☐ erratum + card copy done; ☐ kiosk-login recommendation filed.

**Prompt:**
```
Effort: high. Model: claude-fable-5 (if unavailable: Opus 4.8 at effort xhigh + a self-review pass of the diff before commit).

Why: the audit's P1 finding — a retail tenant that enables the Restaurant module gets its POS silently REPLACED by the restaurant POS, because the redirect keys on the tenant_modes row instead of what kind of business the tenant is. Plus three confirmed UX-correctness defects (Cashiers see owner dashboard cards; custom roles are mislabeled "Cashier"; four pages' nav and route guards disagree).

Task: On branch fix/audit-wave0 (after W0a), per docs/fable5/business-modules/PLAN-V2.md Step W0b (the spec):
1. P1: POSRoute.jsx:19 — FIRST inspect pos_layout_mode / preset industry values on real tenants (local golv_* set; Supabase READ-ONLY for prod restaurant tenants) and report what distinguishes a true restaurant business from a retail tenant with the Restaurant module enabled. Then re-key the redirect on that signal (pos_layout_mode from PresetContext is the expected answer — verify, don't assume). A restaurant-preset tenant MUST still land on /pos/restaurant; a retail tenant with the module on MUST get the retail till. If the data is ambiguous, STOP and present options. Then: correct the Restaurant card copy in config/business-modules.js if it overpromises, and add an erratum note to docs/fable5/business-modules/VERIFICATION.md item 1.
2. C3: DashboardRedesign.jsx:47 — remove the view_reports→"manager view" inference; gate each owner card/widget by its real permission (today's perms).
3. C5: AppLayoutRedesign.jsx:33 — replace the hardcoded id→label map with the backend role_name.
4. C7: align nav-config vs route wrappers for Attribute Sets, Recalls, Handouts, Receipt Templates per docs/fable5/role-audit/role-matrix.json (route wrapper and nav guard must agree; pick the stricter of the two unless the audit table says otherwise).
5. kiosk-login: investigate POST /api/auth/kiosk-login's zero frontend callers (git history, kiosk pages, PWA/external callers). Recommend remove vs wire with evidence. DO NOT remove it in this step.

Scope: exactly these items. No backend guard changes (W0a owns those), no v2 work.
Autonomy: browser-verify every item per the PLAN-V2.md Step W0b verify list (both redirect directions); screenshots; frontend unit tests. Commit locally to fix/audit-wave0 when verified. Do not push.
Report: outcome first — the redirect keying decision + evidence, screenshots, then the kiosk-login recommendation.
```

---

## GATE 0 — Merge + deploy Wave 0 to `main` (pre-branch)

Follow the Gate protocol. Slice verification subset: W0a + W0b verify lists + full-suite baseline diff. Deploy-day notes: **NO migrations**; the two behavioral changes are (a) the discount 403 for roles lacking `pos_discount` — BEFORE deploy, count prod roles missing `pos_discount` across tenants (Supabase READ-ONLY) so the blast radius is known (expected: default Cashier/Manager/Administrator all pass; only custom roles hit it) and the owner can pre-warn affected tenants if any exist; (b) the POS-redirect re-keying — post-deploy, verify a restaurant golv_* tenant still lands on the restaurant POS AND a retail golv_* tenant with Restaurant enabled lands on the retail till. Owner also rules on the W0b kiosk-login recommendation here (removal, if chosen, lands in a later step — not rushed into this deploy). Owner go → merge `fix/audit-wave0` to `main`, watch Railway + Vercel, run the live spot-checks. **Step 1 branches only after this gate completes.**

---

## Step 1 — Create working branch

- **Goal**: `feat/business-modules-v2` off post-Gate-0 `main`, clean start.
- **Touches**: git only.
- **Model/effort**: sonnet / low.
- **Pause**: no.
- **Verify**: `git status` clean on the new branch; `git log -1` matches main head (must include the v1 merge `c3d8e925` or later, the Step 0 plan commit, AND the Gate 0 Wave-0 merge).
- **Done when**: ☐ branch exists locally and every later step runs on it.

**Prompt:**
```
Effort: low.
Create branch feat/business-modules-v2 off main in D:\newprojects\oneshoppos and check it out. Do not push. Confirm with git status + git log -1 (head must contain the Business Modules v1 merge c3d8e925 or later, the PLAN-V2.md commit, and the Gate 0 Wave-0 merge).
```

---

## Step 2 — D7 + S3: Delegation permissions beyond modules + Field Rep split

- **Goal**: register and wire the finer delegation permissions the v1 catalog reserved space for. (1) `manage_integrations` — gates the Integrations Hub credential/config surfaces (today a mix of `all_access` and `manage_inventory` — verified: `routes/integrations/credentials.js:9,64,119` use `all_access`, `:84,143` and `hub.js:7` use `manage_inventory`), plus WooCommerce, courier settings, Shopify settings routes. (2) `manage_roles` — delegable role editing: the five `all_access` mutations in `routes/roles.js` (`:13,26,33,54,76,161`) become `requireAnyPerm(["manage_roles"])`-reachable (Administrators still pass via `all_access` bypass). (3) `manage_outlet_modules` — REGISTER ONLY (catalog entry, no route consumes it yet; Step 10 wires it). All three granted to NO default role (same posture as `manage_business_modules`). Bucket C cards in `config/business-modules.js` gain `manage_integrations` in their `permissions: []` so `roles_with_access` reflects the new delegation (this also closes the C8 empty-`permissions:[]` misreport for those cards). (4) **S3 — Field Rep split (AUDIT §4A)**: `manage_field_sales` currently does double duty — rep-self endpoints AND owner/admin endpoints (`GET /api/field/visits` all-reps view, `POST/GET /api/admin/field-routes`) — and holders skip outlet-assignment enforcement (`registerAllRoutes.js:276`). Register `execute_field_sales` (rep-self surfaces: own check-in/out, own visits, own order capture in `routes/field.js`); `manage_field_sales` keeps ONLY the owner/admin surfaces. The Field Rep default role swaps to `execute_field_sales` — BOTH in `DEFAULT_ROLE_PERMISSIONS` (**C4 rule**: change the constant, or `ensureDefaultRolePermissions` re-adds the old perm at next boot) AND via a data migration for existing pristine Field Rep roles (same pristine-vs-customized posture as D4: a Field Rep role whose permission set is exactly `manage_field_sales` converts; customized roles are grandfathered with both perms). The outlet-assignment-enforcement skip re-keys to `execute_field_sales` (reps roam outlets by design), and field-order writes stay scoped to the rep's own visit.
- **Touches**: `backend/config/permissions-catalog.js`; `backend/routes/roles.js`; `backend/routes/integrations/*` + `woocommerce.js` + `couriers.js` + `routes/shopify/` settings surfaces (grep-driven inventory first); `routes/field.js` + the admin field-routes surfaces; `middleware/permissions.js` (Field Rep default + PERMISSION_RULES if applicable); `registerAllRoutes.js` (outlet-assignment skip); `backend/migrate-pg.js` (Field Rep data migration); `config/business-modules.js` (permissions field on Bucket C cards); tests.
- **Model/effort**: claude-fable-5 / high — auth-adjacent guard changes on existing endpoints; the v1 Step 7 catalog test will fail the build if anything is missed, which is the safety net.
- **Pause**: **YES, before starting** — permission-guard changes to existing endpoints (playbook §3). Owner approves this step's design as written; if the integration-surface grep finds a consumer that makes a guard swap ambiguous, stop and report instead of guessing.
- **Verify**: unit: permissions-catalog drift test still green with 33 permissions (29 + 4); integration: a custom role holding only `manage_integrations` can list/save integration credentials and 403s on roles endpoints; a custom role holding only `manage_roles` can PUT role permissions and 403s on credentials; Manager (neither perm) 403s on both; Administrator unaffected. S3: a token holding only `execute_field_sales` can check in/out and post its own visit orders but 403s on `GET /api/field/visits` (all-reps) and `/api/admin/field-routes`; a `manage_field_sales` holder reaches the admin surfaces; the Field Rep migration is idempotent locally (run twice) and converts pristine roles while grandfathering customized ones; a rep cannot write a field order against another rep's visit. Frontend role editor renders the four new entries (it reads the catalog endpoint — no hardcoded list since v1 Step 7).
- **Done when**: ☐ 4 perms registered + drift test green; ☐ integration guards swapped without breaking a verified consumer; ☐ roles delegable; ☐ `manage_outlet_modules` reserved; ☐ Field Rep split migrated both postures + own-visit scoping proven.

**Prompt:**
```
Effort: high.

Why: v1 shipped manage_business_modules so module management is delegable without full admin. D7 extends the same trust model to integrations and role editing — a business owner should be able to delegate "connect our courier account" or "maintain staff roles" without handing over all_access. manage_outlet_modules is registered now so the per-outlet steps have their permission waiting. S3 (audit): manage_field_sales currently lets every field rep reach owner/admin surfaces (all-reps visit logs, route planning) — the split separates doing field sales from managing them.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 2 (the spec — read its full goal + verify list):
1. Register manage_integrations, manage_roles, manage_outlet_modules, execute_field_sales in backend/config/permissions-catalog.js (category "System" or a new "Delegation" category for the first three, "Field Sales" grouping for the fourth — match the existing grouping style). The first three granted to NO default role. The v1 drift test must stay green.
2. FIRST grep every integration-surface route guard: backend/routes/integrations/, woocommerce.js, couriers.js, routes/shopify/ settings/config endpoints, and the frontend pages that consume them (IntegrationsHubRedesign, CourierSettingsRedesign, WooCommerceIntegrationRedesign, Shopify tabs). Report the inventory. Then swap credential/config WRITE guards to requireAnyPerm(["manage_integrations"]) — all_access bypasses requireAnyPerm so Administrators keep working; where a guard is currently manage_inventory (hub.js:7, credentials.js:84,143), decide per-endpoint whether it is a data-read (keep) or a config surface (swap) and justify each in the report.
3. routes/roles.js: swap the all_access guards on POST/PUT/DELETE /api/roles* and PUT /api/roles/:id/permissions to requireAnyPerm(["manage_roles"]). Do NOT touch the v1 self-or-admin guard on GET /api/roles/:id/permissions (AuthProvider boot dependency — see v1 PLAN.md Step 7 as-built note 1). GET /api/roles moves to requireAnyPerm(["manage_roles", "manage_employees"]) only if the consumer grep confirms EmployeesRedesign needs it; otherwise leave all_access-reachable via the same requireAnyPerm.
4. config/business-modules.js: add manage_integrations to the permissions[] of every Bucket C card so roles_with_access reflects delegation. The v1 bidirectional card↔permission test must stay green.
5. S3 Field Rep split: grep routes/field.js + the admin field-routes surfaces and re-guard — rep-self endpoints (own check-in/out, own visits, own order capture) → execute_field_sales; owner surfaces (all-reps visits list, field-routes CRUD) → manage_field_sales. Swap the Field Rep entry in DEFAULT_ROLE_PERMISSIONS to execute_field_sales (the C4 rule: the constant, not just role_permissions rows, or boot re-adds it). New migration (check MIGRATIONS head): pristine Field Rep roles (permission set exactly {manage_field_sales}) convert to execute_field_sales; customized roles keep both (grandfather); idempotent, per-tenant, classification logged. Re-key the outlet-assignment skip in registerAllRoutes.js:276 to execute_field_sales. Verify field-order writes are scoped to the rep's own visit; add the scoping if missing.

Scope: guard swaps + catalog registration + the S3 split/migration only. No new endpoints, no frontend changes (role editor reads the catalog dynamically). No default-role grants for the three delegation perms.
Autonomy: run fully; local PG tests from backend/ cwd; run the Field Rep migration twice on sanopos_dev ONLY (never Supabase); diff failures against the ~57 pre-existing baseline. Commit locally when green.
Report: outcome first — the guard inventory table (endpoint, old guard, new guard, justification) including the field.js split, then the migration classification log, then test results.
```

**Step 2 as-built notes (2026-07-12, commit f691a4b4):**
1. **Frontend deviation (S3-necessitated)**: "no frontend changes" didn't survive the split — the rep PWA pages (`/field/today`, `/field/check-in`, `/field/order`, `/field/van`), their nav entries, and their inline `hasPerm("manage_field_sales")` gates would lock a converted Field Rep out entirely. `hasPerm()` now accepts an any-of array; rep pages/nav accept `["execute_field_sales","manage_field_sales"]`; owner pages (Visits, Routes, dashboard field summary) stay manage-only. Role editor untouched as planned.
2. **Rep-self endpoints accept BOTH perms** (`requireAnyPerm(["execute_field_sales","manage_field_sales"])`), not execute-only — an execute-only rep still 403s on every owner surface (the audit's point), while Managers/owners doing double duty keep the rep surfaces they have today. Zero-regression direction.
3. **Bucket C `permissions[]`**: `manage_integrations` added to 7 of 9 cards. Excluded: `online_payments` (platform env gate — no tenant credential surface exists to delegate) and `room_channel_sync` (setup lives in the Rooms UI behind `manage_rooms`) — listing them would recreate the C8 misreport in the opposite direction. `fbr_digital_invoicing` included by ALSO widening `fbr.js` config/test-connection from all_access to `requireAnyPerm(["manage_integrations"])` (dashboard/retry stay all_access). Catalog gained a `module_keys` (plural) cross-module linkage; drift test enforces it bidirectionally.
4. **Guard-swap rule applied**: all_access credential/config writes → `requireAnyPerm(["manage_integrations"])` (purely additive); manage_inventory config-surface reads (hub, credential test/status, channel `/test`, Woo status, Shopify config GET/PUT/disconnect) → widened to include `manage_integrations` (Managers keep access); channel DATA ops (sync/push/pull-orders/import/mappings/reconciliation) unchanged — a credentials delegate cannot move inventory or pull orders.
5. **Outlet-assignment skip re-key side effect (flag for Gate 1 blast radius)**: default Managers hold `manage_field_sales`, so they silently bypassed outlet-assignment enforcement since Tier 1.1; re-keying to `execute_field_sales` puts Managers back through the `employee_outlets` check. Managers created without outlet assignments would start 403ing on outlet-scoped calls — count them in prod before deploy (Gate 0-style query).
6. **Own-visit scoping added in sales.js** (was missing): `POST /api/sales` with `field_visit_id` (or resolved `field_visit_uuid`) 403s `FIELD_VISIT_NOT_OWN` unless the visit belongs to the caller or the caller holds `manage_field_sales`/`all_access` (manager keying a phoned-in order stays possible).
7. **Migration v133**: name='Field Rep' + set exactly `{manage_field_sales}` → converted; name='Field Rep' customized → both perms (also gets `execute` re-added at boot via the new default constant); other roles (Manager etc.) untouched. Verified 2× on sanopos_dev + a scratch-schema posture matrix. Note: local `public` schema carries legacy roles tables, so the guarded pass converted `public.roles` id 1 — harmless (nothing reads public.roles), same table-existence guard precedent as v132.
8. `GET /api/roles` + `GET /api/permissions-catalog` moved to `requireAnyPerm(["manage_roles"])` (a role editor needs both); the v1 self-or-admin guard on `GET /api/roles/:id/permissions` untouched. EmployeesRedesign needed no `manage_employees` widening (it sits behind a perm("all_access") route).

---

## Step 3 — D4a: Report-permission taxonomy + data-level classification + audit-rulings batch

- **Goal**: design the `view_reports` split WITHOUT changing any behavior yet. Grounding: `view_reports` appears in **34 backend route files** (sales.js, returns.js, inventory.js, purchase-orders.js, grn.js, customers.js, orders.js, attendance.js, commissions.js, loyalty.js, holds.js, batches.js, recalls.js, backorders.js, product-serials.js, receipt-templates.js, barcode-expenses.js, packages.js, handouts.js, client-service-records.js, insights.js, insights-ai.js, risk-controls.js, report-builder.js, reports/* ×7, shopify/reconciliation.js, tier4/accounting.js) plus `middleware/permissions.js` (×4) and 7 frontend files — and **~166 total textual occurrences** across source, tests, types, and docs: the inventory covers ALL of them (tests and type declarations get updated in Step 4 even where they aren't guard consumers). Produce: (1) the split taxonomy — proposed: `view_sales_reports`, `view_inventory_reports`, `view_financial_reports`, `view_hr_reports`, `view_customer_reports` (adjust to what the call-site inventory actually supports; fewer well-fitting perms beat many fuzzy ones); (2) a complete call-site → new-perm mapping table (every occurrence, file:line, chosen perm, rationale) — **classifying the RETURNED DATA, not just the route**: an endpoint mixing sales + margin + staff data is flagged `mixed` and gets an explicit per-endpoint decision (split the endpoint, permission-dependent response filtering, or a documented composite mapping with justification) — mapping a mixed dashboard wholesale to `view_sales_reports` without examining its payload is the failure mode this exists to prevent; (3) **pristine-Cashier detection** (owner ruling 2026-07-11): define the exact predicate for "unmodified default Cashier role" (name + permission set equal to `DEFAULT_ROLE_PERMISSIONS` Cashier) that Step 4's migration uses to decide sales-only vs grandfather — and validate the predicate read-only against local tenants; (4) the new perms registered in `permissions-catalog.js` (check the drift test's tolerance for registered-but-unused perms FIRST — defer registration to Step 4 if it would fail); (5) proposed new `DEFAULT_ROLE_PERMISSIONS`: Cashier → `view_sales_reports` only; Manager → all splits; Field Rep unchanged (its S3 split already happened in Step 2). (6) **Audit-rulings batch (C2 + C6 + unguarded trio — AUDIT §4B/§4C)**: the same ratification pause rules on (a) the ~12 Manager-page `all_access` mutations from `role-audit/REPORT.md` (edit customer, edit attendance, save receipt template, reverse transfer, void supplier payment, connect integration, approve COD, configure risk, …) — per item: relax to a named Manager perm OR keep admin-only and hide the control; (b) **C6** — inventory `manage_employees`'s non-HR call sites (accounting mutations, credit/debit notes, postdated cheques, report scheduling) with the same data-classification discipline and propose narrower perms (e.g. `manage_finance`) — a staff perm must not confer financial authority; (c) the three unguarded-mutation candidates (`billing/add-outlet`, `billing/create-checkout`, `commissions/calculate`) — guard vs documented-open. All rulings are APPLIED in Step 4's sweep, none here.
- **Touches**: `backend/config/permissions-catalog.js` (registration only, if test-compatible), a mapping table in this file's Step 3 as-built notes (or `REPORT-PERMS.md` alongside if >150 rows). NO route/guard/migration changes.
- **Model/effort**: claude-fable-5 / xhigh — a mis-mapped call site silently locks a Cashier out of the POS dashboard or leaks financials to them; the whole D4 correctness hangs on this table.
- **Pause**: **YES, after** — owner ratifies the taxonomy, the mapping table (mixed-endpoint decisions explicitly), the pristine-Cashier predicate, AND the audit-rulings batch (each C2 item, the C6 split proposal, the unguarded trio) before Step 4 applies anything.
- **Verify**: mapping table covers 100% of a fresh grep (report occurrence count vs mapped count — must match); every proposed perm has ≥3 call sites (else fold it into a sibling); every `mixed` endpoint has an explicit decision; the Dashboard (`totalRevenueToday` etc.) and POS-adjacent reads a Cashier legitimately needs are mapped to `view_sales_reports`; the pristine-Cashier predicate correctly classifies local tenants' roles; the C2 table carries a proposed ruling per row; the `manage_employees` (C6) inventory is complete (fresh grep count vs classified count) with a split proposal; the unguarded trio each has a recommendation.
- **Done when**: ☐ taxonomy + complete data-classified mapping table + pristine predicate + audit-rulings batch reported; ☐ owner ratified all of it.

**Prompt:**
```
Effort: xhigh.

Why: splitting view_reports (deferred D4) changes what every Cashier in production can see. Before any migration or guard edit, the owner ratifies exactly which of the 34 route files' checks map to which new permission — including what DATA each endpoint returns, because a wrong mapping either locks cashiers out of their POS dashboard or exposes financials/HR data to them through a "sales" endpoint that also returns margin and payroll fields.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 3 (the spec). Fresh-grep every occurrence of view_reports across backend/ (requirePerm, requireAnyPerm incl. multi-line arrays, inline employeePerms.includes), frontend/src (hasPerm, perm(...) route wrappers, nav-config requiredPerm), AND tests/type declarations (~166 total occurrences — inventory all, even non-guard ones, so Step 4's sweep is complete). Design the split taxonomy (start from view_sales_reports / view_inventory_reports / view_financial_reports / view_hr_reports / view_customer_reports; merge or drop categories the call sites don't support). Produce the complete mapping table: file:line → occurrence → RETURNED-DATA classification → chosen new perm → one-line rationale. For endpoints returning mixed data classes (dashboards, analytics, insights-ai), flag them "mixed" and propose per-endpoint: split the endpoint, filter the response by permission, or document a composite mapping — do not silently map by filename. Pay specific attention to: dashboard endpoints a Cashier needs (view_sales_reports, but verify their payloads), tier4/accounting.js + financial reports (view_financial_reports), attendance/commissions (view_hr_reports). Define + locally validate the pristine-Cashier predicate: a role named Cashier whose permission set exactly equals the DEFAULT_ROLE_PERMISSIONS Cashier set — Step 4's migration will move ONLY those to sales-only and grandfather everything else (owner ruling). Propose new DEFAULT_ROLE_PERMISSIONS (Cashier → view_sales_reports only; Manager → all splits). Check backend/tests/unit/permissions-catalog.test.js FIRST: if registering not-yet-consumed perms breaks it, defer registration to Step 4 and say so. Write the table into PLAN-V2.md "Step 3 as-built notes" or docs/fable5/business-modules/REPORT-PERMS.md if >150 rows.

ALSO prepare the audit-rulings batch for the same ratification pause (analysis only, per docs/fable5/role-audit/REPORT.md):
(a) C2 — the ~12 Manager-page all_access mutations: per item, verify the endpoint + consumer, then propose relax-to-named-Manager-perm vs keep-admin-and-hide-control, with a one-line rationale each.
(b) C6 — fresh-grep every manage_employees call site; classify the non-HR ones (accounting mutations, credit/debit notes, postdated cheques, report scheduling) by RETURNED/WRITTEN data class; propose the narrower perms (e.g. manage_finance) with the same discipline as the view_reports table.
(c) The unguarded trio (billing/add-outlet, billing/create-checkout, commissions/calculate): recommend guard vs documented-open, each with rationale.

Scope: analysis + catalog registration (if test-compatible) ONLY. Zero route, migration, frontend, or default-role changes.
Autonomy: run fully; commit the doc/catalog change locally.
Report: outcome first — taxonomy chosen, occurrence count vs mapped count (must match), every mixed-endpoint decision, the pristine-Cashier predicate + its local validation, the 5 most judgment-call mappings called out explicitly, then the audit-rulings batch (C2 table, C6 proposal, trio recommendations). END THE TURN; the owner ratifies before Step 4.
```

**Step 3 as-built notes (2026-07-12 — analysis complete, awaiting ratification):**

1. **Full deliverable lives in [REPORT-PERMS.md](REPORT-PERMS.md)** (mapping table >150 rows-equivalent → separate file per the Touches clause). Taxonomy: all five proposed perms kept (each has ≥3 call sites), plus two canon boundary rules — the **margin rule** (any cost/margin/profit analysis → `view_financial_reports`; stock *valuation* stays inventory) and the **POS-adjacency rule** (POS-terminal reads gain `view_sales_reports` in their anyPerm arrays so a sales-only Cashier keeps a working POS).
2. **Fresh grep found 417 occurrences / 106 files, not ~166** — the estimate predated the role-audit artifacts (`role-matrix.json` alone: 106). Reconciled 100%: 95 backend route guards (exactly the 34 files the plan named), 9 backend non-route source, 44 backend + 2 frontend test occurrences, 24 frontend source, 14 CLAUDE.md docs, 229 frozen docs/audit history.
3. **Load-bearing discovery**: `PERMISSION_RULES` is LIVE blanket middleware (`registerAllRoutes.js:308`), and most `routes/reports/*` files have **no inline guard** — the whole `/api/reports/*` surface hangs on one `["view_reports","manage_employees"]` rule. Step 4 must add per-domain inline guards (table in REPORT-PERMS.md §3.8) and demote the blanket rule to an any-split backstop. This is extra Step 4 surface the "34 route files" framing didn't capture.
4. **Pristine-Cashier predicate** (name `Cashier` exact + perm set exactly `{view_reports, pos_discount, pos_park}`) validated read-only against all 48 local `sanopos_dev` tenant schemas: 47 pristine, 0 customized, 1 schema with no Cashier role (no-ops correctly). Prod re-validation is a Step 4 pre-deploy gate item.
5. **Catalog registration done this step** (drift test verified tolerant first — it only enforces call-site → catalog): the five splits registered in `permissions-catalog.js`, `view_reports` relabeled "(legacy — being split)". `manage_finance`/`manage_reports` (C6 proposals) deliberately NOT registered pending ratification. Both catalog suites green (26/26).
6. **Owner must explicitly rule on** (beyond ratifying the table): (a) clinic/salon front-desk surfaces — recommend migration seeds `view_customer_reports` onto pristine Cashiers of appointments-mode tenants (REPORT-PERMS.md §8 #2); (b) notifications bell mapping vs. dropping its guard (§7 #7); (c) each C2 row, the C6 two-perm split (`manage_finance`, `manage_reports`, both defaulted to Manager), and the unguarded-trio guards (§9).
7. **RATIFIED 2026-07-12**: owner ratified the entire deliverable as written — all recommendations accepted, including §8 #2 option (b) (appointments-mode Cashier seeding), §7 #7 keep-guard (`view_sales_reports`), all 12 C2 rulings, the C6 split, and the trio guards. Full ruling record in the REPORT-PERMS.md header block. Step 4's pause is cleared.

---

## Step 4 — D4b: Split-posture migration + guard sweep + frontend permissions + ratified audit rulings

- **Goal**: apply the ratified mapping with the **owner-ruled split posture**: pristine-default Cashier roles migrate to `view_sales_reports` only; every OTHER role holding `view_reports` (customized roles, non-default roles) is grandfathered with ALL split perms — nobody outside pristine Cashiers loses anything, and the built-in role converges on least-privilege. (1) Migration (next head after current — check `migrate-pg.js` first): per-tenant-schema data migration — for each role with `view_reports` rows: if it matches the ratified pristine-Cashier predicate → insert `view_sales_reports` only; else → insert all split perms; then DELETE the `view_reports` rows; idempotent, one transaction per tenant; the migration LOGS every role it classified (tenant, role, posture) so the deploy has an audit trail. (2) `DEFAULT_ROLE_PERMISSIONS` in `middleware/permissions.js` updated per ratified defaults; verify `ensureDefaultRolePermissions` has seeded all prod roles (v1 Step 7 as-built note 4 — re-verify) so the by-name fallback is cold. (3) Every backend call site from the Step 3 table switched to its mapped perm, including the ratified mixed-endpoint treatments — `view_reports` must have ZERO remaining consumers (remove it from `permissions-catalog.js` so the drift test fails any straggler at CI). (4) Frontend: nav-config `requiredPerm`, appRoutes `perm(...)` wrappers, and the pages' `hasPerm` calls per mapping. (5) Tests/types: update the ~non-guard occurrences inventoried in Step 3. (6) Wizard/provisioner: grep `tenant-provisioner-pg.js` + `setup.js` for `view_reports` seeding and update. (7) **Apply the ratified audit rulings**: each C2 relaxation/hide per ruling; the C6 `manage_employees` split per the ratified proposal (new perms registered, guards swept, frontend controls aligned) — **C4 rule, named**: any permission removed from a default role must ALSO be removed from `DEFAULT_ROLE_PERMISSIONS` in `middleware/permissions.js`, otherwise `ensureDefaultRolePermissions` re-seeds it at next boot and the migration silently undoes itself; the unguarded-trio rulings. (8) **S5 — cost-free sales-only product reads (AUDIT §4A)**: `GET /api/products` (`products.js:267`, `SELECT p.*`) stops exposing cost/margin fields to tokens holding only sales-class report perms — permission-dependent field filtering or a dedicated POS-shaped response, per the Step 3 ratification; POS flows (cart, scan, search) must be regression-tested against the slimmer payload.
- **Touches**: `backend/migrate-pg.js` (new version), `middleware/permissions.js`, the 34 route files + the C2/C6 guard sites, `routes/products.js` (S5), `config/permissions-catalog.js`, `frontend/src/ui/nav-config.js`, `routes/appRoutes.jsx`, affected pages, tests/types; `schema-pg.sql` if defaults are declared there (verify).
- **Model/effort**: claude-fable-5 / xhigh — a 34-file auth sweep + data migration touching every tenant's roles.
- **Pause**: **YES, before starting** — cleared automatically by the Step 3 ratification (this step applies the ratified table + predicate verbatim; any deviation = stop and report).
- **Verify**: migration idempotent on local `sanopos_dev` (run twice); integration: a pristine local Cashier post-migration reaches sales reports (200) and 403s financial/HR; a CUSTOMIZED role that held `view_reports` post-migration holds all splits and reaches its old endpoints; fresh-provisioned Cashier = sales-only; Manager reaches everything; grep proves zero `view_reports` remaining outside the migration file + historical docs; drift test green; mixed-endpoint treatments behave per ratification (filtered fields absent for a sales-only token where filtering was chosen); S5: a sales-only token's `GET /api/products` response contains no cost/margin fields while POS cart/scan/search still work; every C2/C6 ruling implemented exactly as ratified (spot-check each swapped guard + the C4 constant rule); frontend: Cashier login shows Reports nav (sales) but not accounting pages; affected pg-batch suites diffed against the ~57 baseline.
- **Done when**: ☑ migration idempotent + classification log present; ☑ zero remaining `view_reports` consumers; ☑ both postures (pristine → sales-only, customized → grandfathered) integration-tested; ☑ C2/C6/S5 rulings applied + verified; ☑ frontend consistent.

> ### As-built (2026-07-12, feat/business-modules-v2, local + committed — NOT deployed)
> - **Migration v134** (head was v133): per-tenant `role_permissions` split. Ran twice on local `sanopos_dev` — idempotent (version-gated; post-run 0 `view_reports` rows so the up() body is a no-op anyway). Classification log present per role. Real-DB result matched §10 exactly: **47 pristine Cashiers** (32 retail → `view_sales_reports`; **15 appointments-mode → `view_sales_reports` + `view_customer_reports`** per §8 #2 ruling b), **95 grandfathered** (Managers/Admins/custom → all five splits), 1 schema with no Cashier (no-op).
> - **Guard sweep**: 93 backend guard occurrences swept across 34 route files (count-verified) + per-domain guards added to every `routes/reports/*` file with the blanket `PERMISSION_RULES` rule demoted to an any-split backstop. `view_reports` removed from `permissions-catalog.js`; the catalog drift test now fails any straggler at CI (green: 0 stragglers). Dashboard = permission-filtered response (§7 mixed #1, own-attendance carve-out); report-builder = per-dataset enforcement + `manage_reports` on definition writes.
> - **C2/C6/S5 rulings**: all 12 C2 + the C6 `manage_finance`/`manage_reports` split (registered, defaulted to Manager) + the unguarded trio applied and verified. S5 strips `cost_price`/`component_cost` from all six `GET /api/products*` reads for sales-only tokens; POS scan/search regression-tested green.
> - **C4 rule**: only `view_reports` was removed from a default role, and it is gone from `DEFAULT_ROLE_PERMISSIONS`; Manager's new `manage_finance`/`manage_reports`/`manage_customers` come from `ensureDefaultRolePermissions` at boot (runs after `migrate-pg.js` in `start.sh`). No re-seed of `view_reports`.
> - **Tests**: new `pg-step4-report-split.test.js` (13/13 — both postures + S5). Catalog/middleware unit drift 116/116 green. Mechanical swaps applied to the Step-3-inventoried test/type occurrences. `attendance.test.js` + `context-enforcement.test.js` + `crud_employees.test.js` are dead pre-existing files (require the deleted SQLite `../helpers/createTestApp`) — edits are forward-correct but the files don't run; part of the ~57 baseline. pg-batch8:357 `"5.000"` numeric failure is pre-existing/unrelated.
> - **Remaining before Gate 1**: prod re-validation of the pristine-Cashier count (read-only script against Supabase, mirroring the Gate-0 blast-radius count) and a live Cashier browser check (Reports nav shows sales tabs, not accounting) — both are pre-deploy gate items, not blockers to the local commit.
>
> ### Code-review fix (2026-07-12, commit `9c3cf6e7`) — CRITICAL regression caught + fixed
> `/code-review high` on the isolated Step 4 diff found one POS-blocking regression: the D4 blanket-rule change (`GET /api/attendance` → `view_hr_reports`) also caught **`/api/attendance/my-status`**, which is SELF-scoped and drives the POS shift gate (`useShiftGate` → `isReadyForCheckout` needs `attendanceCode === "clocked_in"`). A sales-only Cashier post-split holds `view_sales_reports`, not `view_hr_reports`, so `my-status` would 403 and **no Cashier could ever check out**. §8 #3 keeps self clock-in unaffected, so `my-status` must stay reachable. Fix: negative-lookahead exemption `/^\/api\/attendance(?!\/my-status(?:$|[/?]))(\/|$)/` in both `middleware/permissions.js` and the `createTestApp` mirror; team list/sessions stay HR-gated. Regression test added (Cashier reaches my-status 200, still 403s team attendance — 14/14). Slipped the first pass because the focused test hit `/api/attendance` base not `my-status`, and the legacy `attendance.test.js` is a dead SQLite-helper file. **Lesson**: a blanket path-regex `PERMISSION_RULES` entry catches self-scoped sub-endpoints — when tightening its perm, audit self endpoints under the prefix.

**Prompt:**
```
Effort: xhigh.

Why: applying the owner-ratified view_reports split with the split posture: pristine default Cashiers converge to least-privilege (sales-only) while customized roles are grandfathered so no deliberate owner choice is silently revoked. The catalog removal converts "did we get every call site" from a grep hope into a CI guarantee.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 4 and the RATIFIED Step 3 mapping table + pristine-Cashier predicate (apply verbatim — if you disagree with a mapping, stop and report, don't improvise):
1. New migration in backend/migrate-pg.js (check current MIGRATIONS head; v132 at planning): per-tenant data migration — for each role with view_reports in role_permissions: pristine-Cashier predicate match → insert view_sales_reports only; anything else → insert ALL ratified split perms (ON CONFLICT DO NOTHING); then delete the view_reports rows; one transaction per tenant schema via the normal MIGRATIONS path; console-log each classified role (tenant, role name, posture) for the deploy audit trail. Idempotent by construction.
2. middleware/permissions.js DEFAULT_ROLE_PERMISSIONS: ratified defaults (Cashier → view_sales_reports only; Manager → all splits). Re-verify ensureDefaultRolePermissions seeds all roles; report any unseeded path before relying on the migration alone.
3. Sweep every backend call site per the mapping table, implementing the ratified mixed-endpoint treatments (endpoint splits / permission-dependent response filtering / documented composites). Then REMOVE view_reports from config/permissions-catalog.js and add the split perms there — any straggler call site now fails the drift test.
4. Frontend per the mapping: ui/nav-config.js, routes/appRoutes.jsx perm(...) wrappers, hasPerm call sites (DashboardRedesign, HandoutsRedesign, RecallsRedesign, RetailRiskRedesign, treatment/VaccinationCardRedesign — re-grep, don't trust this list).
5. Update the test/type occurrences inventoried in Step 3; grep tenant-provisioner-pg.js + routes/setup.js for view_reports seeding and update.
6. Apply the ratified audit rulings verbatim: each C2 guard relaxation or control-hide; the C6 manage_employees split (register the ratified perms, sweep its guards, align frontend controls) — C4 rule: any perm removed from a default role comes out of DEFAULT_ROLE_PERMISSIONS too, or boot re-seeds it; the unguarded-trio rulings.
7. S5: per the ratified treatment, strip cost/margin fields from GET /api/products for sales-only tokens (field filtering or POS-shaped response). Regression-test POS cart, scan, and search against the slimmer payload.
Run the migration ONLY against local Postgres. Never against Supabase.

Scope: exactly the ratified mapping + posture + rulings. No taxonomy changes, no unratified perm work.
Autonomy: run fully; migration twice on sanopos_dev; integration tests per PLAN-V2.md Step 4 verify list incl. BOTH postures; browser-check a Cashier login. Commit locally when green.
Report: outcome first — migration version, classification-log sample, files-swept count vs Step 3's occurrence count (must match), Cashier before/after access table, the C2/C6/S5 rulings-applied table, test results.
```

---

## Step 5 — D5: Full mode normalization

- **Goal**: retire the modes empty→enforcing transition trap permanently. Grounding: `requireMode` falls through when the modes map is empty (`middleware/feature-flags.js:311-313`); v1's Step 6 backfill handles the first-write transition; prod drift is **0 of 29 tenants** (VERIFICATION.md), so materializing is safe now. (1) Migration: for every tenant schema, materialize an explicit `tenant_modes` row for EVERY mode in the registry — `enabled=true` where the mode's registry flags are already on for that tenant (reuse the exact predicate from v1's `backfillModesIfFirstRowTx` in `services/business-modules.js` — do not reimplement it), `enabled=false` otherwise. (2) Flip `requireMode` to fail-closed: remove the empty-map fall-through (or keep it behind a loud Sentry-tagged warning for one release — executor proposes, owner decides at the pause). (3) Provisioning: verify + ensure every new-tenant path (`tenant-provisioner-pg.js`, `setup.js` wizard, `services/preset-apply.js`) seeds the full mode-row set so a fresh tenant is never modeless. (4) The v1 backfill helper stays in place as a no-op safety net.
- **Touches**: `backend/migrate-pg.js` (new version), `middleware/feature-flags.js` (`requireMode`), `tenant-provisioner-pg.js` / `setup.js` / `preset-apply.js` (verify/seed), tests.
- **Model/effort**: claude-fable-5 / high — small diff, but it changes gate semantics for every mode-gated route on every tenant; the failure mode (403 storm) is loud and immediate, which caps the risk.
- **Pause**: **YES, before starting** — migration + gate-semantics change. Owner also picks: hard fail-closed vs one-release warn-and-pass on empty map.
- **Verify**: migration idempotent locally; after migration every local tenant has exactly `|VALID_MODES|` rows; integration: mode-gated route 403s on a tenant whose mode row is `enabled=false` and 200s where `true`; a FRESH provisioned tenant (each preset family: retail, restaurant, clinic) has full rows and its vertical routes work immediately; the business-modules toggle path still round-trips (enable/disable Restaurant); zero new pg-batch failures vs baseline.
- **Done when**: ☐ every tenant fully materialized; ☐ `requireMode` fail-closed (or owner-chosen variant); ☐ all provisioning paths seed modes; ☐ toggle round-trip green.

> ### As-built (2026-07-12, feat/business-modules-v2, local + committed — NOT deployed)
> - **Posture (the pause decision)**: owner delegated the choice; executor recommendation adopted = **warn-and-pass for one release**, not hard fail-closed. `requireMode`'s empty-map branch now emits a Sentry-tagged `warning` (+ logger.warn) via `reportEmptyModes()` then still `next()`s — a failed per-tenant migration or an unseeded path degrades to "flags are the sole gate" instead of a 403 storm. Gated `NODE_ENV==='test'` so the integration harness (which never seeds `tenant_modes`) stays quiet and Sentry no-ops without a DSN. **Queued Step-5 follow-up → now has its own spec + prompt: see "Post-Gate-2 release — D5 follow-up" (after the GATE 2 section).** ⚠️ This note originally said "flip once prod Sentry reads zero warns" — **that instrument was SUPERSEDED 2026-07-14** (`c8714cda`): Sentry silence is absence of evidence and cannot distinguish "no problem" from "nobody hit the path". The flip is evidence-gated on POSITIVE proof (29/29 tenants at 10/10 mode rows — already met) and its real blocker is that the v135 provisioning seeders have never run in prod. Read the dedicated section, not this line.
> - **Migration v135** (head was v134): full mode materialization. Ran on local `sanopos_dev` (48 active tenants) → **every tenant now 10/10 rows (`|VALID_MODES|`), modeless 10→0, not-full 48→0, 0 per-tenant failures**. Enabled counts preserved exactly (only `enabled=false` rows added); existing explicit rows preserved via `ON CONFLICT (mode) DO NOTHING` (e.g. `golv_restaurant` kept its 3, added 7; `squaretest` kept 5, added 5). Idempotent both ways: version-gate re-run = "up to date"; direct `up()` re-run on an already-materialized schema inserts 0. The local `public` schema happened to carry a `tenant_modes` table so it materialized too (harmless; `requireMode` only reads tenant schemas). `enabled=true` iff `modeActiveForFlags(mode, liveFlags)` where `liveFlags = DEFAULT_FEATURE_FLAGS ⊕ feature_flags rows` — same predicate as `backfillModesIfFirstRowTx`.
> - **Shared predicate (no duplication)**: extracted `modeActiveForFlags(modeName, flags)` + `fullModeRows(enabledModeNames)` into `config/mode-registry.js`; `services/business-modules.js:backfillModesIfFirstRowTx` refactored to call `modeActiveForFlags` (behavior-preserving — `pg-business-modules-toggle` backfill assertions still green). The backfill helper stays in place as a dead-man safety net (item 4).
> - **Provisioning**: `routes/setup.js` (1c) and `services/preset-apply.js` now seed the **full** row set via `fullModeRows(preset.modes)` (preset modes enabled, the rest disabled), so a fresh/reset tenant is never modeless. `tenant-provisioner-pg.js` left unchanged and **verified sufficient** — it doesn't seed modes, but `setup.js` seeds before `setup_complete=true` and `loadCompanyProfile`'s `SETUP_REQUIRED` gate blocks all mode-gated routes during the pre-setup window. `routes/auth.js` and `routes/admin/tenants.js` only *read*/per-mode-PUT `tenant_modes` (not bulk seeders), so no change needed there.
> - **Tests**: `pg-preset-engine` updated to the full-materialization invariant (restaurant → all 10 rows, only `restaurant` enabled; retail → all 10 rows, none enabled) + **new `dental_clinic` fresh-provision case** covering the clinic preset family (10 rows; `appointments`+`treatment_plans` enabled) — completing the retail/restaurant/clinic verify trio. `pg-mode-gates` two stale `503`→`403` expectations corrected (the exact Step-5 verify shape: mode row `enabled=false` → 403 `body.mode`, `enabled=true` → 200); file now 4/4 green (was 2/4 on baseline). `pg-business-modules-toggle`, `pg-admin-flag-parity`, and the `requireMode` unit test all green unchanged (empty map still falls through). Vertical suites (`pg-rental-contracts`, `pg-batch13-restaurant`, `pg-batch14-bookings`, `pg-treatment-plans`) show **only PRE-EXISTING failures, proven via `git stash` on clean `main`** — all in the stale-`503`/`requireFeature` class (503-expected, real 403) or unrelated booking-availability/reschedule bugs; **zero new failures from D5**.
> - **Remaining before Gate**: run migration v135 on prod (Supabase) via the normal `start.sh` deploy path; watch prod Sentry for "empty tenant_modes" warns (expected zero) before scheduling the hard-fail-closed flip. The stale-`503` `requireFeature` test class (pg-batch13/14 etc.) is a separate pre-existing cleanup, out of D5 scope.

**Prompt:**
```
Effort: high.

Why: v1 mitigated the tenant_modes empty→enforcing trap with a first-write backfill; D5 retires the trap entirely. Prod drift was measured at 0/29 tenants (VERIFICATION.md), so materializing explicit rows for everyone is safe, and requireMode can stop trusting an empty table.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 5 (the spec):
1. New migration (check MIGRATIONS head): for every tenant schema, insert a tenant_modes row for every mode in config/mode-registry.js — enabled=true iff that mode's registry feature_flags_to_enable are already enabled for the tenant, using the SAME predicate as backfillModesIfFirstRowTx in services/business-modules.js (import/extract, don't duplicate); enabled=false rows for the rest. ON CONFLICT (mode) DO NOTHING — never overwrite an existing explicit row.
2. middleware/feature-flags.js requireMode: remove the empty-map fall-through at :311-313 per the owner's pause decision (hard fail-closed vs one-release Sentry-warn-and-pass). Keep the flag-gate half unchanged.
3. Verify every new-tenant path seeds full mode rows: tenant-provisioner-pg.js, routes/setup.js wizard, services/preset-apply.js. Add seeding where missing — a fresh tenant must never be modeless.
4. Leave backfillModesIfFirstRowTx in place (now a dead-man safety net).
Run migrations ONLY on local Postgres.

Scope: exactly this. Do not change mode-registry contents or any flag defaults.
Autonomy: run fully; migration twice locally; integration tests per PLAN-V2.md Step 5 verify list including a fresh-provision test per preset family; commit locally when green.
Report: outcome first — row counts before/after per local tenant, the fail-closed variant implemented, fresh-tenant test results.
```

---

## Step 6 — D3: Sub-toggle "Customize" polish

- **Goal**: finish the sub-toggle UX. **Scope check (verified)**: v1 Step 9 as-built note 1 already shipped inline WRITABLE sub-toggle switches (`BusinessModulesRedesign.jsx:79-81`) with dependency previews — D3's remaining substance is presentation, not plumbing: (1) merchant-facing `description` per sub_toggle in `config/business-modules.js` (catalog data only; the bidirectional test must stay green); (2) collapse sub-toggle lists behind a per-card "Customize" expander when a card has >3 sub_toggles — short lists stay inline; (3) explicit disabled-with-tooltip state for sub-toggles while the parent card is off ("Enable <module> first"); (4) surface `skipped_restores` from the toggle response (v1 Step 6 as-built note 5) as an info toast naming the sub-toggles kept off and why.
- **Touches**: `config/business-modules.js` (descriptions), `frontend/src/pages/redesign/BusinessModulesRedesign.jsx`; nothing else.
- **Model/effort**: sonnet / medium — presentation work against finished plumbing.
- **Pause**: no.
- **Verify**: browser: Restaurant card collapses its sub-toggles behind Customize, expands, toggles round-trip; a parent-off card shows disabled sub-toggles with the tooltip; saved_flags round-trip still visible; frontend unit tests green; catalog unit test green.
- **Done when**: ☐ descriptions on every sub_toggle; ☐ expander live; ☐ disabled states + skipped_restores toast; ☐ no regression to the v1 walkthrough behaviors.

**Prompt:**
```
Effort: medium.

Why: v1 already made sub-toggles inline-writable; D3's remainder is making them self-explanatory — descriptions, a Customize expander for long lists, honest disabled states, and surfacing skipped_restores so a merchant understands why a restored sub-toggle stayed off.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 6 (the spec — read the v1 PLAN.md Step 8+9 as-built notes first so you don't rebuild what exists):
1. backend/config/business-modules.js: give every sub_toggle a merchant-facing description (one sentence, plain language — mirror the card descriptions' tone). Keep backend/tests/unit/business-modules-catalog.test.js green.
2. BusinessModulesRedesign.jsx: cards with >3 sub_toggles collapse them behind a "Customize" expander (ui/primitives only); ≤3 stay inline as today. Render the new descriptions under each sub-toggle label.
3. While the parent card is off: sub-toggles render disabled with a Tooltip "Enable <module> first".
4. After a toggle whose response contains skipped_restores: info toast naming each skipped sub-toggle and its missing prerequisite.

Scope: these two files only. No backend route/service changes, no new endpoints.
Autonomy: browser-verify on the local stack (restaurant + retail test tenants); screenshot; frontend unit tests. Commit locally when verified.
Report: outcome first + screenshots (collapsed, expanded, parent-off states).
```

---

## Step 6b — Capability-registry drift tests + truthless-flag disposition (audit §3 systemic)

- **Goal**: extend the v1 drift-test family with the two directions the audit exposed as missing. (1) **Flag → runtime-consumer test**: every key in `DEFAULT_FEATURE_FLAGS` (and DB-seeded flags like `fbr_integration`) must have ≥1 runtime consumer (`requireFeature`/`requireMode` mapping, worker gate, or a documented frontend consumer) or sit on an explicit in-test exemption list with a stated reason. Known offenders that seed the work: `phase4_restaurant_seats`, `receipt_designer_v2`, `phase4_contract_ai` (grep of backend minus tests/config = empty). (2) **Capability → surface test**: commit the frontend-coverage scanner (`docs/fable5/frontend-coverage-audit/scan.cjs`) as a CI-runnable test with the current 78 orphans as a FROZEN baseline file — the test fails only on NEW orphans; the existing 78 are E7's burn-down list, not this step's problem. (3) **Truthless-flag disposition (pause)**: for each of the three flags, report wire-vs-retire with evidence; owner rules; execute the ruling — retirement = remove from `DEFAULT_FEATURE_FLAGS` + the catalog classification, with a saved_flags-safe cleanup (check `tenant_business_modules.saved_flags` snapshots reference none of them before deleting keys); wiring = a real consumer, not a token one.
- **Touches**: `backend/tests/unit/` (two new drift tests + baseline file), the scanner adapted as test engine, `middleware/feature-flags.js` + `config/business-modules.js` (only if a retirement is ruled); tests.
- **Model/effort**: claude-fable-5 / medium (Fable unavailable → Opus 4.8 / high).
- **Pause**: **YES, mid-step** — after the disposition report, before executing the wire/retire rulings.
- **Verify**: both tests run locally in CI mode and pass on the current tree (baseline frozen); negative tests: removing a flag's consumer makes test 1 fail, adding a fake orphan route makes test 2 fail; rulings executed per owner decision; the v1 catalog/permission drift tests still green.
- **Done when**: ☐ both tests committed + negative-tested; ☐ 3 flags ruled + rulings executed; ☐ 78-orphan baseline documented as E7's burn-down input.

**Prompt:**
```
Effort: medium. Model: claude-fable-5 (if unavailable: Opus 4.8 at effort high).

Why: the audit proved "0 orphan flags" only tested classification, not reachability — three flags have no runtime consumer at all, and 78 backend endpoints have no frontend surface. v1's drift tests guard catalog membership; this step adds the missing directions as CI guarantees so the class can't regrow.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 6b (the spec):
1. New unit test: every DEFAULT_FEATURE_FLAGS key (+ DB-seeded flags like fbr_integration — enumerate them) has ≥1 runtime consumer: requireFeature/requireMode via classifyFlag, a worker gate, or a frontend consumer (flags./flags[ usage) — else it must be on an in-test exemption list with a reason. Expect phase4_restaurant_seats, receipt_designer_v2, phase4_contract_ai to fail initially; put them on a TEMPORARY exemption list pending the ruling below.
2. Adapt docs/fable5/frontend-coverage-audit/scan.cjs into a CI-runnable test with the current 78 orphans frozen as a committed baseline file; the test fails only on NEW orphans. Document the baseline as the E7 burn-down list.
3. Negative-test both (remove a consumer locally / add a fake orphan route → each test fails), then restore.
4. Report wire-vs-retire for the three truthless flags with evidence (what each was for, git history, whether any tenant has it enabled or in saved_flags snapshots — local + Supabase READ-ONLY). END THE TURN for the owner's ruling, then execute it: retire = remove from DEFAULT_FEATURE_FLAGS + catalog + exemption list (verify saved_flags snapshots are clean first); wire = implement the real consumer.

Scope: tests + the ruled flag work only. No endpoint building (E7 owns the 78), no other flag changes.
Autonomy: run fully up to the ruling pause; local PG from backend/ cwd; commit locally when green.
Report: outcome first — both tests' status + negative-test proof, then the three-flag evidence table for the ruling.
```

---

## GATE 1 — Merge + deploy the governance slice (D7 + S3 + D4 + D5 + D3 + registry tests)

Follow the Gate protocol (top of file). Slice verification subset: Step 2/4/5/6/6b verify lists + full-suite baseline diff. Deploy-day: the D4 + D5 + Step 2 Field Rep migrations run on prod boot and are behavioral immediately — the D4 and Field Rep classification logs are the audit trail; post-deploy live check = Cashier-role access spot-check on a golv_* tenant + one real tenant READ-ONLY (Supabase: confirm role classifications match the Step 15-style expectations), plus a mode-gated route spot-check and a field-rep endpoint spot-check (execute_field_sales rep-self 200, admin surface 403). Owner gives explicit go before push/merge; owner watches or delegates the deploy watch.

---

## Step 7 — D1a: Per-outlet schema + catalog groundwork

- **Goal**: the two-table inherit model exactly as the v1 fingerprint specified (PLAN.md D1 row): (1) `tenant_business_modules` gains `default_outlet_enabled BOOLEAN NOT NULL DEFAULT TRUE` (the default new/unlisted outlets inherit — its write path ships in Steps 8+10, its sparse-row rule is defined HERE: **a module with no `tenant_business_modules` row at all behaves as `default_outlet_enabled = TRUE`** — the table is sparse today and stays legal-sparse); (2) new tenant-schema table `outlet_business_modules (outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE, module_key TEXT NOT NULL, enabled BOOLEAN NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (outlet_id, module_key))`. Resolution semantics (frozen here, implemented Step 8): **effective(outlet) = company-enabled AND (explicit outlet row ?? default_outlet_enabled ?? TRUE)** — explicit row wins, missing row inherits, company-off wins everywhere. **Scope participation rule (amendment d)**: ONLY `scope: "outlet"` cards (13 in the catalog) participate; `tenant` (25), `device` (3), **and `hybrid` (9 — FBR/Shopify/Woo/couriers/payments/channels, `business-modules.js:783-925`)** are ALL rejected from outlet operations with 409 `TENANT_SCOPED` — hybrid's "tenant credentials + per-outlet operational enablement" model is explicitly a v3 contract (E4), not smuggled into D1. No behavior change in this step — schema + DDL only.
- **Touches**: `backend/migrate-pg.js` (new version), `backend/schema-pg.sql`; tests (shape only).
- **Model/effort**: claude-fable-5 / high — schema step; small but the resolution + participation semantics frozen here bind Steps 8–12.
- **Pause**: **YES, before starting** — schema/migration (playbook §3). Owner approves both shapes + the resolution rule + the outlet-only participation rule (hybrid stays tenant-wide).
- **Verify**: migration idempotent locally across all tenant schemas; both DDL changes in `schema-pg.sql`; existing v1 toggle tests still green (the new column has a default — nothing reads it yet).
- **Done when**: ☐ migration idempotent; ☐ DDL in schema file; ☐ zero behavior change proven by the untouched v1 test matrix.

**Prompt:**
```
Effort: high.

Why: per-outlet module activation (D1) starts with its data model. v1 deliberately left fingerprints for exactly this shape (scope metadata on every card, tenant_business_modules as the company-level anchor) — this step adds the outlet override table and the inherit default, no behavior yet. The frozen rules: effective(outlet) = company AND (override ?? default_outlet_enabled ?? TRUE); ONLY scope:"outlet" cards participate — tenant, device, AND hybrid cards are tenant-wide in v2 (hybrid per-outlet enablement is a v3 contract).

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 7 (the spec):
1. New migration (check MIGRATIONS head): (a) ALTER tenant_business_modules ADD COLUMN default_outlet_enabled BOOLEAN NOT NULL DEFAULT TRUE; (b) CREATE TABLE outlet_business_modules (outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE, module_key TEXT NOT NULL, enabled BOOLEAN NOT NULL, updated_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (outlet_id, module_key)). Both via the normal per-tenant MIGRATIONS path.
2. Matching DDL in schema-pg.sql.
3. A shape test (columns exist post-migration) and a full run of the existing business-modules integration suite to prove zero behavior change.
Run migrations ONLY on local Postgres.

Scope: schema + DDL + shape test only. No service, route, or frontend changes — resolution logic is Step 8.
Autonomy: run fully; migration twice locally; commit when green.
Report: outcome first — migration version, both shapes, v1 suite result.
```

---

## Step 8 — D1b: Backend per-outlet read + toggle paths

- **Goal**: the resolution service + API surface. (1) `services/business-modules.js` gains the effective-state resolver: for outlet-scoped cards, `effective(outlet) = company AND (override ?? default_outlet_enabled ?? TRUE)`; company disable CLEARS nothing (overrides persist dormant — same hide-not-delete philosophy as saved_flags); tenant/device/**hybrid**-scoped keys are rejected from outlet operations with 409 `TENANT_SCOPED`. (2) `GET /api/business-modules` gains per-card `outlets: [{outlet_id, name, effective, override}]` + `enabled_outlet_count`/`outlet_count` + `default_outlet_enabled` (only for outlet-scoped cards, only when the tenant has >1 active outlet — single-outlet tenants see the v1 payload unchanged). **Query budget (amendment i)**: the whole per-outlet augmentation adds a FIXED number of bulk queries (one for all overrides, one for outlets — never per-card or per-outlet); an integration test asserts the query count. (3) New `POST /api/business-modules/:key/outlet-toggle { outlet_id, enabled }` — upserts the override row; `enabled: null` clears the override (single endpoint, no separate DELETE). (4) New write path for the default (**amendment e**): the same endpoint accepts `{ default_outlet_enabled }` (no `outlet_id`) to set the card's default for unlisted/new outlets — upserting the `tenant_business_modules` row if sparse. Perm for both: `requireAnyPerm(["manage_business_modules","manage_outlet_modules"])`. Platform locks apply to enable-direction changes (override AND default). Audit row per write in `action_history`. (5) `GET /:key/impact` gains `?outlet_id=` — disable-direction counts scoped to that outlet where the impact_query's table has an outlet column (mark the rest `"tenant_wide": true`). (6) Company-level toggle behavior unchanged (v1 tests stay green); `depends_on` stays company-level in v2 (deferred E1).
- **Touches**: `services/business-modules.js`, `routes/business-modules.js`, `schemas/business-modules.js`; tests.
- **Model/effort**: claude-fable-5 / xhigh — the write path; inherit semantics + lock interplay + audit are the subtle-bug category.
- **Pause**: **YES, before starting** — new tenant write path (playbook §3). Owner approves this design summary.
- **Verify**: integration: single-outlet tenant payload byte-compatible with v1 (regression guard — write it first); multi-outlet: override off at outlet B → effective false at B, true at A; company off → effective false everywhere regardless of overrides; company re-enable → B's dormant override still off; `enabled:null` clears the override (row gone, inherits default); `default_outlet_enabled:false` + no override → new/unlisted outlets effective-off, explicitly-on outlet stays on; sparse-row module (no `tenant_business_modules` row) resolves as default TRUE; tenant/device/hybrid key → 409 `TENANT_SCOPED`; unknown outlet → 404; lock blocks enable-direction override AND default flip; audit rows written; perm matrix; impact `?outlet_id=` scopes counts; **query-count assertion** on GET.
- **Done when**: ☐ resolver + endpoints green on the full matrix; ☐ v1 suite untouched-green; ☐ query budget asserted; ☐ fresh-context verifier subagent has read the resolver against this spec.

**Prompt:**
```
Effort: xhigh.

Why: the per-outlet write path. The inherit semantics (explicit row wins, missing inherits the card's default, sparse rows mean TRUE, company-off wins everywhere, dormant overrides survive company off/on cycles) must be exactly right server-side — the UI is untrusted and Step 9 hangs enforcement off this resolver.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 8 (the spec — read its full goal + verify list; the resolution + participation rules were frozen at Step 7's pause):
1. services/business-modules.js: resolveOutletStates(tenantCtx) → per outlet-scoped card, per active outlet: effective = companyEnabled AND (override ?? default_outlet_enabled ?? TRUE). Reject tenant, device, AND hybrid-scoped keys from all outlet operations (409 TENANT_SCOPED). Company disable must NOT delete or rewrite outlet_business_modules rows. Bulk queries only: one query for all overrides, one for outlets — never per-card/per-outlet loops.
2. GET /api/business-modules: outlet-scoped cards gain outlets[] {outlet_id, name, effective, override} + enabled_outlet_count/outlet_count + default_outlet_enabled, ONLY when the tenant has >1 active outlet — single-outlet tenants' payload must remain byte-compatible with v1 (write that regression test first). Add a query-count assertion test.
3. POST /api/business-modules/:key/outlet-toggle: Zod schema; requireAnyPerm(["manage_business_modules","manage_outlet_modules"]); two shapes: {outlet_id, enabled:true|false|null} (null clears the override) and {default_outlet_enabled:bool} (sets the unlisted-outlets default, upserting a sparse tenant_business_modules row). Validate outlet belongs to tenant + active; platform-lock check on enable direction for BOTH shapes (reuse the v1 lock helper); action_history audit row (actor, module, outlet or "default", direction); invalidate flag/mode caches for the tenant.
4. GET /:key/impact?outlet_id=: scope disable-direction counts to the outlet for every impact_query whose table has outlet_id (check schema-pg.sql per query); mark the rest "tenant_wide": true. Report which.
5. depends_on stays company-level (documented deferral E1 — one line in the catalog docs).

Scope: services/routes/schemas + tests. No middleware, worker, or frontend changes (Steps 9-10). Company-level toggle code paths untouched.
Autonomy: full integration matrix from PLAN-V2.md Step 8 verify list on local PG; then spawn a fresh-context verifier subagent with only PLAN-V2.md Steps 7-8 + the changed files. Commit locally when green.
Report: outcome first, then the verifier's findings verbatim, then the tenant-wide impact-query list and the GET query count.
```

---

## Step 9 — D1c: Shared outlet resolver + outlet-aware enforcement (the correctness-critical core of D1)

- **Goal**: make an outlet-level OFF actually mean off — the v2 analogue of v1 Step 3. (1) **Shared requested-outlet resolver (amendment b)**: ONE validated resolver (new `backend/middleware/outlet-context.js` or equivalent) that runs early enough for permission loading and is the ONLY interpreter of outlet context — precedence: validated `x-outlet-id` header → JWT `oid` claim → none; validation = integer, belongs to tenant, active, and (for non-`all_access` staff) within the employee's assignments. Grounding: today `loadTenantAndPerms` (chain pos. 11) reads the raw header/JWT before `resolveContext` (pos. 15) builds `req.context` (`tenant-auth.js:110-117`, `:343-348`) — refactor `resolveContext` and the outlet-assignment enforcement in `registerAllRoutes.js` to CONSUME the shared resolver (behavior-preserving for them), and Step 13's role resolution reuses it. (2) **Fail-closed rule (amendment c)**: for flags mapping to outlet-scoped cards, OPERATIONAL routes require a resolved outlet — none resolves → `403 OUTLET_CONTEXT_REQUIRED`; company-level fallback applies ONLY to an explicit allowlist (settings/config, cross-outlet reports, admin surfaces — the executor builds the allowlist from the gated-route inventory and it ships in the report). Grounding for why: login bakes a primary-outlet `oid` into every staff JWT (`auth.js:261-268` — null only for zero-outlet all_access accounts) and `tenant-auth` backfills the header, so normal clients always resolve; but the context-switch re-mint can produce `oid:null` tokens, so a deliberate client could otherwise un-scope itself. (3) **Middleware**: `requireFeature` (and `requireMode` for outlet-scoped Bucket A cards' modes) evaluate the Step 8 effective state for the resolved outlet; flag-cache payload grows to carry the override map + defaults (one extra query per cache fill, zero per request; both toggle shapes invalidate). 403 body gains `outlet_scoped: true`. Tenant/device/hybrid-mapped flags NEVER outlet-gated. (4) **Surface audit** (the recurring-bug lesson): POS `posFlags`, `GET /api/feature-flags`, `PresetContext` bootstrap, storefront, customer portal, field-rep PWA, kiosk + restaurant kiosk + customer display, `nav-config.js` — each presents outlet-effective state for its outlet context or is documented tenant-level-by-design (public/pre-tenant surfaces). (5) **Workers**: the v1-Step-3-gated vertical workers gain per-outlet filtering where their work items carry `outlet_id` (verify per worker against schema; the filter composes with the v1 tenant gate).
- **Touches**: new shared resolver, `middleware/feature-flags.js`, `middleware/tenant-auth.js` (resolveContext consumes resolver), `registerAllRoutes.js` outlet-assignment enforcement (consumes resolver), audited frontend surfaces, the listed workers; tests.
- **Model/effort**: claude-fable-5 / xhigh — touches every gated request on every tenant; THE riskiest step in this plan.
- **Pause**: **YES, before starting** — owner approves: the resolver precedence + validation, the fail-closed rule + proposed allowlist criteria, the 403 shape, and the surface list before any middleware edit.
- **Verify**: integration: outlet-scoped route with `x-outlet-id` of a disabled outlet → 403 `outlet_scoped:true`; enabled outlet → 200; **no header + JWT oid → resolves via oid (not company fallback)**; **no header + `oid:null` token on an operational outlet-scoped route → 403 `OUTLET_CONTEXT_REQUIRED`**; **malformed header (`abc`, `-1`) → 400/403, never silent fallback**; **foreign/unassigned outlet id → rejected by the resolver**; allowlisted settings route with no context → company behavior; tenant/hybrid-scoped flags never outlet-gated; cache invalidation on both toggle shapes; per-worker two-outlet test (processes only the enabled outlet's items); resolveContext + outlet-assignment enforcement behavior-preserving through the refactor (their existing tests green); single-outlet tenants: zero behavior change across the whole suite (the real regression gate); POS browser check: outlet with module off hides the feature, switching outlet context flips it without logout.
- **Done when**: ☐ shared resolver is the single interpreter (grep proves no other `x-outlet-id` reader remains outside it); ☐ fail-closed live with documented allowlist; ☐ every audited surface listed with its resolution; ☐ workers outlet-filtered where dimensioned; ☐ full-suite regression green.

**Prompt:**
```
Effort: xhigh.

Why: Step 8 stored per-outlet state; this step makes it real AND closes the bypass class before it exists: today three different places interpret outlet context (loadTenantAndPerms reads the raw header/JWT before resolveContext even runs), and a deliberate client with an oid:null token could omit the header to escape outlet-level OFF. One shared validated resolver + fail-closed on operational routes ends both. Single-outlet tenants must feel ZERO change — this is the highest-blast-radius step in the plan.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 9 (the spec — read its full goal + verify list; the design was approved at the pause):
1. Build the shared requested-outlet resolver (backend/middleware/outlet-context.js): precedence validated x-outlet-id header → JWT oid → none; validation: integer, tenant-owned, active, within the employee's assignments for non-all_access staff. Refactor resolveContext (tenant-auth.js:343-348) and the outlet-assignment enforcement in registerAllRoutes.js to consume it — behavior-preserving (their existing tests must stay green). Grep for every other x-outlet-id reader and route it through the resolver; report the list.
2. middleware/feature-flags.js: extend the cached per-tenant payload with the outlet override map + per-module default_outlet_enabled (same cache-fill pass, 60s TTL kept). requireFeature: flag maps (classifyFlag) to an outlet-scoped card → resolve outlet: resolved → evaluate effective(outlet); none resolved → if the route is on the explicit company-fallback allowlist (settings/config/cross-outlet reports/admin — build it from the gated-route inventory, justify each entry) → company-level; otherwise 403 {code:"OUTLET_CONTEXT_REQUIRED"}. requireMode: same for outlet-scoped Bucket A modes. Outlet-denied 403s carry outlet_scoped:true. Tenant/device/hybrid-mapped flags: company-level exactly as today, never outlet-gated. Both Step 8 toggle shapes invalidate this cache.
3. Surface audit — enumerate and verify EVERY one (do not stop at POS): POS posFlags fetch, GET /api/feature-flags, PresetContext bootstrap, storefront, customer portal, field-rep PWA (routes/field.js), kiosk, restaurant kiosk, customer display, ui/nav-config.js gating. For each: how it resolves outlet context, whether it now reflects outlet-effective state, or why it stays tenant-level by design (public/pre-tenant-middleware surfaces). Fix read paths presenting stale tenant-level state for outlet-scoped modules.
4. Workers: for each v1-Step-3-gated vertical worker, add outlet filtering where its work items have an outlet dimension (verify per worker against schema-pg.sql: rental-overdue, room-overdue-checkout, night-audit, reservation, reservation-reminder, hold-expiry, kds-load-snapshot, course-release; treatment-plan + channel-sync only if dimensioned). Composes with the v1 per-tenant gate.
5. Regression gate: the ENTIRE existing backend integration suite green vs the ~57-failure baseline — single-outlet tenants provably untouched.

Scope: exactly this. No new endpoints, no UI redesign (Step 10), no changes to the Step 8 resolver's semantics.
Autonomy: full matrix from PLAN-V2.md Step 9 verify list incl. the omitted/malformed/foreign-header and oid:null cases and two-outlet worker tests; POS browser spot-check; commit locally when green.
Report: outcome first — the resolver consumer list, the fallback allowlist with justifications, the surface-audit table, worker filter list, regression diff.
```

> ### Step 9 as-built notes (2026-07-14, feat/business-modules-v2, local + committed — NOT deployed; Gate 2 ahead)
>
> Owner approved the pause design with three rulings: **(1) all_access exemption** — the fail-closed rule applies to non-`all_access` principals only (`all_access` with no resolved outlet evaluates company-level; the bypass threat is staff escaping an outlet OFF via an `oid:null` re-mint, and admins can toggle modules anyway); **(2) allowlist semantics** — `companyLevel: true` call sites ALWAYS evaluate company state, even when an outlet resolves (a cross-outlet report must not 403 by viewer position); mechanism is a per-call-site option, not a central path-regex; **(3) public kiosk surfaces** — outlet-gate only where the token/session binds an outlet.
>
> 1. **Resolver** (`backend/middleware/outlet-context.js`): exports `resolveRequestedOutlet` (pure — Step 13 reuses it from loadTenantAndPerms), `resolveOutletContext()` middleware (mounted after `loadCompanyProfile`, before `resolveContext`), `enforceOutletAssignment()` (the registerAllRoutes inline enforcement, moved here to consume the resolver), `invalidateOutletCache` (wired into outlets.js CRUD). Precedence: validated `x-outlet-id` header → JWT `oid` → none → `req.outletContext = {outletId, source}`. Validation: non-integer → **400 INVALID_OUTLET_CONTEXT**; not tenant-owned/`is_active=false` → **403 INVALID_OUTLET_CONTEXT** (same code — no existence leak; 60s per-tenant outlets cache); unassigned non-all_access (execute_field_sales exempt, as in the old enforcement) → **403 OUTLET_NOT_ASSIGNED** (legacy message kept). Vans resolve (they can't hold override rows → follow the default). **Stale JWT oid degrades to none** (server-minted, not client input — hard-rejecting would brick sessions until re-login; fail-closed still catches gated routes; deliberate behavior delta from the old "403 everything on revoked-assignment oid"). Skips: non-/api, MT-without-tenant-scope (public ?tenant= paths), no employee. `loadTenantAndPerms` now sets `req.jwtOid` — the oid→header backfill is GONE; `resolveContext` consumes `req.outletContext` (legacy raw-header fallback only when the resolver isn't mounted — standalone/unit-test chains). Enforcement keeps checking explicit query/body `outlet_id` with the original precedence (context wins, exactly one id checked). Per-request query delta ≈ 0 (the enforcement's employee_outlets query moved into the resolver; outlets from cache). `products.js` + `import.js` raw header reads → `req.context.outletId`. **Grep proof**: outlet-context.js is the only x-outlet-id reader (+ the documented resolveContext fallback).
> 2. **Gates** (`middleware/feature-flags.js`): cache entry grew to `{flags, outletOverrides, moduleDefaults}` — same 60s fill, +2 small queries per fill, zero per request; both Step 8 toggle shapes already invalidate it. `requireFeature`/`requireMode` map the key via static `OUTLET_FLAG_TO_CARD`/`OUTLET_MODE_TO_CARD` (card flags AND sub_toggle keys; 13 outlet-scoped cards, 7 outlet-scoped modes); outlet resolved → Step 8 effective rule; none resolved → all_access company-level, else `403 {code:"OUTLET_CONTEXT_REQUIRED"}`; outlet-disabled refusals carry `outlet_scoped:true` + `outlet_id`. Tenant/device/hybrid keys untouched. `req.outletContext === undefined` (portals/harnesses) ⇒ exact pre-Step-9 behavior — and `requireMode` only fetches the bundle when the resolver ran, so resolver-less chains keep the old query profile (this kept feature-flags-modes unit tests green untouched). New exports: `getEffectiveFlagsMap`, `getEffectiveModesMap`, `isModuleOffAtOutlet`, `outletCardForFlag`.
> 3. **Allowlist** (`companyLevel: true` + justification comment at each site): reports/clinical, reports/kds-analytics, reports/menu-engineering, reports/recipe-costing (cross-outlet reports); treatment-plan-templates, modifiers (read+write), restaurant/menu-schedules, price-books (tenant catalog config); restaurant-kiosk token issuance (config surface). Everything else in the gated-route inventory = operational, outlet-evaluated + fail-closed.
> 4. **Surfaces**: `GET /api/feature-flags` gains **`effective`** per row (outlet overlay only when a validated outlet resolved — anonymous ?tenant= bootstrap never reads the wrong source); `enabled` stays company truth for the admin editor. `useFeatureFlags` consumes `effective ?? enabled` → nav + page gates outlet-aware with zero per-page changes. `/api/context/bootstrap` filters `enabled_modes` by outlet-effective state → `hasMode()` nav gates. **ContextSwitcher** now fires `refreshFeatureFlags()` + `refreshPreset()` on outlet switch → nav flips in place without logout (browser-verified). Storefront/customer portal/field-rep PWA/attendance kiosk: tenant-level by design (pre-tenant chains or tenant-scoped cards). **public-restaurant QR routes** (menu/items/submit): gated by `isModuleOffAtOutlet(tenant,'restaurant',ctx.outletId)` — **outlet-level resolution ONLY**; company-level gating of stale kiosk tokens is a separate PRE-EXISTING gap (composing it would break tenants/tests that never touch per-outlet state) — noted as a follow-up. **member-kiosk**: NO outlet binding (check-ins write `outletId:null`) → tenant-level by design per Ruling 3. Customer display: rides the already-gated POS session.
> 5. **Workers**: `services/business-modules.js:getDisabledOutletIds(db, cardKey)` deny-list helper (fast path `[]` ⇒ no filter at all; NULL-outlet items follow company state; composes with the v1 tenant flag gate). Filtered: rental-overdue + room-overdue-checkout + treatment-plan (JS filters on the service rows; `getUpcomingSessionsNeedingReminder` gained `p.outlet_id`), hold-expiry + kds-load-snapshot + reservation-reminder + booking-reminders (SQL filters), course-release (`releaseHeldCourses` gained `excludeOutletIds`, both MT+ST call sites). **Excluded with justification**: night-audit (`night_audit_snapshots` is ONE tenant-wide row per date — filtering would corrupt the aggregate), channel-sync (hybrid card, tenant-wide in v2), reservation-worker (stock releaser, deliberately ungated in v1).
> 6. **Verification**: new `pg-step9-outlet-gating.test.js` **22/22** (full pause matrix: malformed `abc`/`-1`→400, foreign→403, unassigned→403 OUTLET_NOT_ASSIGNED, oid resolution NOT company fallback, `oid:null` fail-closed vs all_access fallback, stale-oid degrade, tenant flag never gated, companyLevel, BOTH Step 8 toggle shapes through the middleware cache, enforcement query/body preservation, `getDisabledOutletIds` matrix + hold-expiry/reservation-reminder/booking-reminders/rental-overdue two-outlet worker tests — the other filtered workers share the identical helper+deny-list mechanics). Targeted regressions across ~20 touched integration files: every encountered failure (6) **stash-proven identical on the clean tree**. Units 627/630 (3 documented pre-existing); two unit files updated to the new contract (middleware.test.js cache fill = 3 queries; services-booking-reminders.test.js +3 deny-list reads). **Full-suite diff: clean-tree baseline 65 failed files / 31 failed tests vs branch 63 / 27 — strictly fewer on both axes** (file-level subset diff in the Step 9 report). Frontend units 173/173. **Browser (local golv_restaurant + seeded 2nd outlet)**: Restaurant nav present at Main, disappears IN PLACE on switch to the disabled branch, gated API returns `403 {outlet_scoped:true, outlet_id:2, mode:"restaurant"}`, switch back restores — no logout, zero console errors; tenant restored after. **Prod read-only diagnostic (29 tenants)**: zero-outlet all_access = 0, zero-outlet non-admin = 1 (wholesalewalktest Field Rep — tenant-scoped surfaces only) ⇒ fail-closed blast radius ≈ 0.
> 7. **Gotchas for later steps**: `frontend-coverage-baseline.json` carries a TEMPORARY entry for `POST /api/business-modules/:key/outlet-toggle` — **Step 10 must remove it** when the UI lands. The Step-8-endpoint orphan test only fired now because Step 8's run didn't include the drift suite. backend/CLAUDE.md + middleware/CLAUDE.md chain docs updated (14b resolveOutletContext).

---

## Step 10 — D1d: Frontend per-outlet UI

- **Goal**: the "enabled at 2 of 5 locations" experience. On multi-outlet tenants only: outlet-scoped cards show a location summary line ("On at 2 of 5 locations") and a "Manage locations" control opening a Drawer with the per-outlet matrix — outlet name, Inherited/Override badge, effective state, a Toggle per row posting `{outlet_id, enabled}`, "Reset to company default" posting `{outlet_id, enabled: null}`, the outlet-scoped impact confirm on disable when counts exist, **and the "New locations start with this module On/Off" control (amendment e)** posting `{default_outlet_enabled}`. Locked cards keep their v1 treatment (no outlet controls). Single-outlet tenants see no new UI. Wire `manage_outlet_modules`: a custom role holding only it sees the page with only the location matrix + defaults control writable (nav/route perm relaxed via the catalog to match the API's `requireAnyPerm`).
- **Touches**: `BusinessModulesRedesign.jsx` (+ small subcomponents if the file is getting long), `routes/appRoutes.jsx` perm wrapper, `ui/nav-config.js`; tests.
- **Model/effort**: claude-fable-5 / high — the matrix Drawer + override/inherit/default visual language has real judgment in it, and it must reuse the v1 confirm flows without duplicating them.
- **Pause**: no.
- **Verify**: browser on a 3-outlet local tenant: summary counts correct; override at one outlet flips its row + the summary without reload; reset-to-default restores inherit; flipping the new-locations default changes unlisted outlets' effective state (visible in the matrix) without touching explicit overrides; disable-with-data at an outlet shows the scoped impact confirm; company toggle from the same page still works (v1 flows intact); single-outlet tenant renders the v1 page pixel-identical; custom `manage_outlet_modules`-only role can drive the matrix + default but not company toggles; frontend unit tests green.
- **Done when**: ☐ matrix + defaults control live; ☐ v1 flows regression-free; ☐ single-outlet unchanged; ☐ delegation perm wired end-to-end.

**Prompt:**
```
Effort: high.

Why: the merchant-facing half of per-outlet modules. The design bar: a single-outlet tenant must see literally nothing new; a multi-outlet tenant gets one summary line + one Drawer, reusing every existing confirm pattern.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 10 (the spec — reuse the v1 confirm flows; do not fork them):
1. BusinessModulesRedesign.jsx: on outlet-scoped cards when outlets[] is present (backend only sends it for multi-outlet tenants), render "On at {enabled_outlet_count} of {outlet_count} locations" + a "Manage locations" button opening a Drawer (ui/primitives): per-outlet rows with name, Inherited/Override badge, effective-state Toggle → POST outlet-toggle {outlet_id, enabled}, outlet-scoped disable-impact confirm (GET /:key/impact?outlet_id=) when counts exist, "Reset to company default" per overridden row ({outlet_id, enabled:null}), and a "New locations start with this module On/Off" control at the top of the Drawer ({default_outlet_enabled}).
2. Perms: relax the /settings/business-modules route wrapper + nav-config entry so a role holding manage_outlet_modules (or manage_business_modules) reaches the page, matching the API's requireAnyPerm; a manage_outlet_modules-only role gets the matrix + defaults control writable and company-level toggles disabled with a tooltip.
3. Locked cards: no outlet controls (v1 treatment stands).

Scope: this page + route/nav perm wiring. No backend changes — the API shapes shipped in Step 8; if one is missing, stop and report.
Autonomy: browser-verify per PLAN-V2.md Step 10 verify list on a 3-outlet local tenant AND a single-outlet tenant; screenshots; frontend unit tests. Commit locally when verified.
Report: outcome first + screenshots (summary line, Drawer, override badge, defaults control, reset action).
```

> ### Step 10 as-built notes (2026-07-14, feat/business-modules-v2, local + committed — NOT deployed; Gate 2 ahead)
>
> 1. **UI** (`BusinessModulesRedesign.jsx` + new pure helper `redesign/businessModules.js`): outlet-scoped cards that are company-ON on a multi-outlet tenant render `On at {enabled_outlet_count} of {outlet_count} locations` + a **Manage locations** button opening a `ui/primitives` `Drawer`. The Drawer is rendered ONCE at page level (driven by `locationsKey`, module looked up fresh from `data` so it re-renders after an in-place patch), so only one is ever mounted. Rows: outlet name, **Inherited/Override** `Badge` (override = explicit true/false; null = inherited), an effective-state `Toggle`, and a **Reset to default** link on overridden rows. Top of the Drawer: the **New locations start On/Off** default control (amendment e). Gating helper `showOutletControls(m)` = `Array.isArray(m.outlets) && !m.locked && (state on|attention_required)` — so a company-OFF or locked card shows NO location UI (locked keeps its v1 treatment), and a single-outlet tenant (backend omits `outlets[]`) shows literally nothing new.
> 2. **Reused the v1 confirm flow, didn't fork it**: the outlet disable-with-data path extends the SAME page-level `ConfirmDialog` + `confirm` state with `{scope:"outlet", outletId, outletName}`; `handleOutletToggle` fetches `GET /:key/impact?outlet_id=` and only opens the confirm when a count > 0 (enable + reset are direct writes, no confirm — enabling never has side effects). Each write patches just that card's outlet fields from the toggle echo (`{outlets, outlet_count, enabled_outlet_count, default_outlet_enabled}`) → summary + Drawer update in place, no reload; then fires `refreshFeatureFlags()` + `refreshPreset()` so the current session's nav flips if it toggled its own active outlet.
> 3. **Delegation perm — wired END-TO-END, and it needed backend perm-wiring the "no backend changes" scope line didn't anticipate** (Step 2 explicitly deferred this perm: "no route consumes it yet; **Step 10 wires it**"). Three deliberate, additive, local-only backend edits: (a) `GET /api/business-modules` + (b) `GET /:key/impact` widened `requirePerm("manage_business_modules")` → `requireAnyPerm(["manage_business_modules","manage_outlet_modules"])`; (c) **THE load-bearing one** — the `PERMISSION_RULES` blanket rule (`permissions.js`, applied at `registerAllRoutes.js:278`) that gateways the WHOLE `/api/business-modules` prefix admitted only `manage_business_modules`, so a `manage_outlet_modules`-only role 403'd at the blanket layer BEFORE ever reaching a route's own guard (the recurring blanket-rule trap — see memory `feedback_blanket_rule_self_endpoint`/`feedback_parallel_paths`). Added `manage_outlet_modules` to the blanket `anyPerms`; the per-route guards keep the finer split (company `POST /:key/toggle` stays `requirePerm("manage_business_modules")`, so a delegate 403s there — defense in depth). Verified matrix (API + browser): delegate GET 200, impact?outlet_id 200, company toggle **403**, outlet-toggle/reset/default **200**; the page renders company `Toggle`s + Bucket C **Set up** disabled with a "You can manage locations only" tooltip, while the location matrix + default control are writable. Frontend `perm(...)`/`RequirePerm` + nav `requiredPerm` already accept an any-of array (Step 2 as-built), so those were one-line array swaps.
> 4. **Diagnosis detour worth recording**: the delegate's perms loaded correctly (`req.employeePerms=["manage_outlet_modules"]` confirmed via a temp DEBUG log, since reverted) yet still 403'd — because the blanket `PERMISSION_RULES` middleware runs BEFORE the route guard and emits the identical `"Forbidden: insufficient permissions"` message. A local-dev red herring first suspected (legacy `public.role_permissions` has one stray `role_id 1 → execute_field_sales` row) was ruled out — `getDb` search_path is `<schema>, public` so the tenant schema wins, proven by reproducing the exact middleware perm-load.
> 5. **Baseline cleanup (Step 9 hand-off done)**: removed the temporary `POST /api/business-modules/:key/outlet-toggle` entry from `backend/tests/unit/frontend-coverage-baseline.json` (+ updated the `_comment` NOTE + `count` 145→144). Verified the scanner now detects the new `api.post` template-literal caller (normalizes to `/api/business-modules/*/outlet-toggle`, matches the `:key` route) so it drops out of the orphan set; drift guard green.
> 6. **Tests/verify**: new `frontend/tests/unit/business-modules-outlets.test.js` (11) covers the pure helpers (show/hide gating incl. single-outlet omission, summary label + pluralization, inherited-vs-override); full frontend unit suite **185/185**. Backend units affected by the perms change green (permissions-catalog + frontend-coverage-drift + middleware + feature-flags-modes = 105/105). Browser proof on a seeded 3-outlet `golv_restaurant`: summary 3/3; override Branch B → row Override + summary 2/3 in place; reset → Inherited + 3/3; default OFF → all inheriting outlets effective-off, summary 0/3, no overrides created; disable-with-data (seeded 1 open table session at Branch B) → outlet-scoped confirm "Open table sessions: 1" → confirm writes; company toggle opens the v1 confirm (tenant-wide count + "Delivery Aggregators stays connected"), Cancel = no side effect; single-outlet `golv_salon` shows zero location UI. All local seed data (2 extra outlets, the delegate role/employee, the restaurant floor/table/session) cleaned up — `golv_restaurant` restored to pristine single-outlet.
> 7. **NOT screenshotted**: the browser pane's screenshot action timed out repeatedly with the Drawer scrim open (a pane limitation, no console errors) — verification is DOM-text + network-based instead, which is stronger than a pixel check for this.

---

## Step 11 — D6: Guided setup checklists for Bucket A verticals (outlet-aware from birth)

> Moved AFTER D1 (amendment a): Restaurant/Rooms/Rentals/Appointments are outlet-scoped —
> checklist queries born tenant-wide would falsely complete outlet B's checklist from outlet A's
> floor plan and would need rebuilding. Built once, outlet-aware.

- **Goal**: "get started" flows beyond Bucket C credential setup, data-driven (no wizard framework): each covered Bucket A card gains a catalog `setup_checklist` — ordered `{ id, label, required: true|false, scope: "tenant"|"outlet", done_query (named SQL EXISTS snippet with a declared outlet column when scope:"outlet"), route }`. `GET /api/business-modules` computes `checklist` per enabled covered card — outlet-scoped items evaluated per the request's resolved outlet (falling back to tenant-wide summary on the settings page, which is allowlisted outlet-less); batched queries within the Step 8 query budget. **State rule (amendment g)**: `attention_required` while ANY `required` item is un-done (not just when all are); optional items never hold the state. **Coverage (amendment g)**: v2 covers Restaurant, Rooms, Rentals, Appointments; the remaining Bucket A verticals are an explicit v3 item (E5), not silently "done". Frontend: enabled covered cards with incomplete required items show "Get started — N of M done" expanding to the checklist with deep-links (outlet-scoped items labeled with the outlet they're evaluated against); first-enable success routes attention to the checklist (highlight/scroll — no new modal). **Replacement rule (AUDIT §3)**: these checklists REPLACE the `DashboardOnboarding.jsx` proxy heuristics (`:101` — hardcoded membership `done:false`, any-contract-row rental proxy, room-count rate proxy): the dashboard onboarding card is rewired to read the same checklist payload (default) or removed if the owner prefers, and the proxy logic is DELETED — two parallel "is it set up" computations must not coexist.
- **Touches**: `config/business-modules.js` (setup_checklist metadata), `routes/business-modules.js` + `services/business-modules.js` (checklist computation in GET), `BusinessModulesRedesign.jsx`; tests.
- **Model/effort**: sonnet / high — additive read-only queries + UI against established patterns; care points: query budget and the outlet dimension.
- **Pause**: no.
- **Verify**: integration: fresh restaurant tenant → Restaurant card `attention_required` with 0/N; creating a floor plan at outlet A flips that item for A but NOT for outlet B (two-outlet test — the reason this step moved); all required done → state returns to on/connected semantics; optional item un-done does NOT hold `attention_required`; checklist absent for disabled cards and non-covered buckets; query-count assertion still green. Browser: progress line, expansion, deep-links land, outlet labeling correct. Grep proves `DashboardOnboarding.jsx` no longer computes its own done-ness (proxies deleted; card reads the checklist payload).
- **Done when**: ☐ checklists live for the 4 covered verticals, outlet-aware; ☐ `attention_required` follows the required-items rule; ☐ onboarding proxies REPLACED, not paralleled; ☐ E5 recorded; ☐ deep-links verified.

**Prompt:**
```
Effort: high.

Why: enabling Rooms or Restaurant gives a merchant working-but-empty pages with no guidance. D6 adds data-driven "get started" checklists — built AFTER per-outlet activation on purpose, so a floor plan at outlet A can never falsely complete outlet B's checklist.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 11 (the spec):
1. config/business-modules.js: setup_checklist on Restaurant (floor plan exists, menu items exist, KDS station configured), Rooms (rooms added, rates set), Rentals (rental assets added), Appointments (bookable services defined, staff schedulable). Each item: { id, label, required, scope: "tenant"|"outlet", done_query (named SQL EXISTS snippet; scope:"outlet" items declare their outlet column — verify table/column names against schema-pg.sql), route (verify against routes/appRoutes.jsx) }.
2. services + routes: GET /api/business-modules computes checklist ONLY for enabled covered cards; outlet-scoped items evaluate per resolved outlet, tenant-wide summary when outlet-less (the settings page is on the Step 9 allowlist); batched queries — the Step 8 query-count assertion must stay green (adjust its budget explicitly if needed, justify). State: attention_required while ANY required item is un-done; optional items never hold it; locked still wins (v1 state×lock rule).
3. BusinessModulesRedesign.jsx: "Get started — N of M done" on enabled covered cards with incomplete required items, expanding to the checklist with deep-links; outlet-scoped items labeled with their outlet; scroll/highlight after a first enable. ui/primitives only.
4. REPLACE the DashboardOnboarding.jsx proxy heuristics (:101 — membership done:false hardcode, rental any-contract proxy, room-count proxy): rewire the dashboard onboarding card to read the same checklist payload and DELETE the local proxy logic. Grep-prove no parallel done-ness computation survives.
5. Add "remaining Bucket A verticals" to PLAN-V2.md's Deferred-to-v3 table (E5) with the list of un-covered cards.

Scope: catalog metadata + GET computation + this page + the DashboardOnboarding rewire. No new endpoints, no writes, no wizard framework, no toggle-path changes.
Autonomy: integration tests incl. the two-outlet independence test; browser walkthrough on a local restaurant tenant. Commit locally when verified.
Report: outcome first — per-card checklist table (with required/scope flags) + the outlet-independence proof.
```

> ### Step 11 as-built notes (2026-07-14, feat/business-modules-v2, local + committed — NOT deployed; Gate 2 ahead)
>
> **Per-card checklist (the four covered verticals, `config/business-modules.js`):**
>
> | Card | Item id | Required | Scope | Table (verified vs schema-pg.sql) | Deep-link (verified vs appRoutes.jsx) |
> |------|---------|----------|-------|-----------------------------------|----------------------------------------|
> | restaurant | floor_plan | ✅ req | outlet (`outlet_id`) | `restaurant_floor_plans` | `/restaurant/floor` |
> | restaurant | menu_items | ✅ req | tenant | `products WHERE deleted_at IS NULL` | `/products/new` |
> | restaurant | kds_station | optional | outlet (`outlet_id`) | `kds_stations` | `/kds` |
> | appointments | services | ✅ req | outlet (`outlet_id`) | `booking_services WHERE is_active` | `/appointments/services` |
> | appointments | staff | optional | tenant | `booking_staff_assignments` | `/appointments/services` |
> | rentals | rental_items | ✅ req | outlet (`outlet_id`) | `rental_items WHERE is_active` | `/rentals/items` |
> | rooms_lodging | rooms | ✅ req | outlet (`outlet_id`) | `rooms` | `/rooms` |
> | rooms_lodging | rates | ✅ req | outlet (`outlet_id`) | `room_types WHERE base_rate > 0` | `/rooms/rates` |
>
> **Scope-table note (deviation worth recording):** the prompt's parenthetical said "Rentals (rental **assets** added)", but `rental_assets` has **no `outlet_id`** (it FKs `rental_item_id`), so it can't be outlet-scoped by a simple predicate — and it's not the meaningful "get started" step anyway (you rent from `rental_items`, which carries `outlet_id` + `total_quantity`). Used `rental_items`. Appointments "staff schedulable" = `booking_staff_assignments` which has no `outlet_id` either, so it's `scope:"tenant"` (a join would be needed to scope it; deferred). Mix by design: 6 outlet-scoped + 2 tenant-scoped, 6 required + 2 optional — enough to exercise every branch (the two optional items prove "optional never holds `attention_required`").
>
> 1. **Computation (`services/business-modules.js:computeChecklists`)**: a SINGLE batched `SELECT EXISTS(...) AS i0, EXISTS(...) AS i1, …` — one column per item across every ENABLED covered card, so it never scales with card OR outlet count. Zero queries when no covered card is enabled (the retail fast path → the Step 8 query-budget assertion stays green untouched, no budget bump needed). Missing-table fallback runs items individually (each failure = not-done) so one absent table can't blank the whole checklist. Outlet dimension: `scope:"outlet"` items get `AND <outlet_column> = $1` when a concrete `outletId` is passed; tenant items never do.
> 2. **State rule (route)**: an ENABLED covered card with ANY required item un-done → `attention_required`; optional items never hold it. Locked still wins structurally — a locked card is off/setup, so its checklist never runs (LOCKED and ATTENTION can't co-occur). `checklist` is attached to the payload ONLY for enabled covered cards.
> 3. **Route is tenant-wide (`outletId: null`)** — the settings page is Step-9 allowlisted outlet-less, so the "get started" roll-up is across all locations; outlet-scoped items are labelled "· all locations". The per-outlet dimension lives in the service and is proven by the integration suite (not the route) — matches "tenant-wide summary on the settings page, which is allowlisted outlet-less".
> 4. **Two-outlet independence (the reason D6 moved after D1)** — proven at the service layer in `pg-business-modules-checklist.test.js`: a floor plan seeded ONLY at outlet 1 → `computeChecklists(outletId:1).floor_plan=true`, `outletId:2 → false`, `outletId:null → true`. Outlet A's floor plan can never complete outlet B's item.
> 5. **UI (`BusinessModulesRedesign.jsx` + `businessModules.js` helpers `showChecklist`/`checklistProgress`)**: enabled covered cards with an incomplete required item show a "Get started — N of M done" expander → checklist rows with a done tick / open circle, `· optional` + `· all locations` scope labels, and a "Set up →" deep-link on incomplete rows only. `attention_required` is treated as an ON state everywhere (the toggle's `checked`, the sub-toggle gate, and — the load-bearing fix — the `onToggle` enabling test: clicking an attention card's toggle now DISABLES, does not re-enable). First-enable success flags the card (`highlightKey`) → auto-expands + `scrollIntoView` + a ring highlight for 2.6 s (no new modal).
> 6. **Onboarding proxies REPLACED, not paralleled (AUDIT §3, `DashboardOnboarding.jsx`)**: the card now fetches `/api/business-modules` (admin-only surface — it renders only for `all_access`, who can load it) and sources the vertical SETUP steps' done-ness from `card.checklist` via `CHECKLIST_STEP_SOURCE` (`floor_plan`,`menu_item`,`room`,`rate`,`rental_item`). The three flagged proxies are gone: the room-count `rate` proxy → real `base_rate>0` checklist signal; the any-contract-row `checkout` step → **deleted**; the hardcoded `membership: done:false` step → **deleted** (E5 gives memberships a real checklist in v3). Grep-clean: no `roomCount`/`floorPlanCount`/`membership`-step/`checkout`-step done-ness computation survives (only removal comments). Non-covered/first-use steps (`contract`,`checkin`,`booking`,`ticket`,`chart`,`plan`) keep their genuine dashboard-data counts — those were never the flagged proxies.
> 7. **Tests**: new `tests/unit/business-modules-checklist.test.js` (10 — catalog structure + computeChecklists: enablement/zero-query, single-batched-query budget, required-vs-optional state rule, tenant/outlet `$1` injection, missing-table fallback) + `tests/integration/pg-business-modules-checklist.test.js` (4 — attention_required 0/N, checklist absent for disabled/non-covered, the two-outlet independence proof, all-required-done → back to `on`). Updated `pg-business-modules-read.test.js` (restaurant now reads `attention_required` with no floor plan; rentals test seeds a rental item to stay `on`). Frontend `business-modules-outlets.test.js` +7 (`showChecklist`/`checklistProgress`). All green: backend affected units 46/46, frontend units 191/191, the outlet + toggle + read integration suites, and the Step-8 query-budget assertion.
> 8. **Browser (local golv tenants, DOM-text + network verified; screenshot timed out with the same known browser-pane limitation as Step 10)**: `golv_cafe` (restaurant, floor plan missing) → card "Attention" + "Get started — 2 of 3 done"; expander rows correct (floor plan "· all locations" + Set up→ lands on `/restaurant/floor`; menu items done, no scope tag; KDS "· optional · all locations", done); Restaurant toggle → "Turn off Restaurant?" (attention treated as on). Dashboard onboarding on `golv_cafe`: "Add your first menu item" done (from checklist, overriding the deleted inline proxy). `golv_hotel` (rooms+rates set): dashboard onboarding "Add rooms and room types" + "Set your nightly rates" both done from the checklist — the audit-flagged room-count `rate` proxy demonstrably replaced. No console errors on any page. No tenant data mutated (all confirms cancelled).

---

## Step 12 — D8: "Copy settings from" flow on new-outlet creation

- **Goal**: when adding an outlet, offer inheritance from an existing one. **v2 implements ONLY the module-override copy (amendment g)**: `POST /api/outlets` (grounded: `outlets.js:44`, `all_access` + `requirePlanLimit("outlets")`) accepts optional `copy_from_outlet_id`; in the SAME transaction as outlet creation, clone the source outlet's `outlet_business_modules` rows. Stock/employee/sales data NEVER copies. Absent the param, the new outlet inherits per module `default_outlet_enabled` (D1's model — no rows). Audit row records source outlet + row count. **Then Phase 2 (investigation, owner-gated)**: grep the schema for other outlet-keyed CONFIG tables (`outlet_tax_profiles`, receipt-template assignments, `outlet_visibility`, outlet-keyed quick grids, …) and produce a proposal table — per table: FK/uniqueness constraints, secret/credential content, ownership semantics, copy recommendation. **STOP with the proposal — implementing ANY additional copy requires the owner's explicit per-table approval** (the judgment must not be encoded before the pause). Frontend: the add-outlet form gains a "Copy settings from <outlet>" Select defaulting to "Start fresh".
- **Touches**: `routes/outlets.js`, possibly a small `services/` helper, the outlets page, `schemas/` if outlets has one; tests.
- **Model/effort**: claude-fable-5 / high — a write path inside the creation transaction; the allowlist investigation needs judgment but encodes none of it before the pause.
- **Pause**: **YES, mid-step** — after the modules-only implementation + investigation, before any additional table copies.
- **Verify**: integration: create outlet with copy_from → module override rows match source; without → zero rows, inherits defaults; copy_from an invalid/foreign/inactive outlet → 400/404; plan limit still enforced; transaction atomicity (induced failure mid-clone leaves no orphan outlet); audit row present. Browser: Select renders, copied overrides visible in the Step 10 matrix.
- **Done when**: ☐ modules-only clone live + atomic; ☐ investigation table filed + owner ruling recorded (approved tables implemented in a follow-up commit, or deferred to E6); ☐ inherit-by-default path proven.

**Prompt:**
```
Effort: high.

Why: D8 — a merchant opening their 3rd location shouldn't rebuild module choices by hand. v2 copies ONLY module overrides; every other candidate setting gets investigated and put to the owner BEFORE any of it is implemented — each table has its own FK, uniqueness, secret, and ownership questions, and that judgment is the owner's.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 12 (the spec):
PHASE 1 (implement): POST /api/outlets (routes/outlets.js:44) accepts optional copy_from_outlet_id — validate existing/active/tenant-owned; in the SAME transaction as creation, clone outlet_business_modules rows source→new; audit to action_history (source outlet, row count). No copy_from → create exactly as today. Frontend add-outlet form: "Copy settings from" Select (existing outlets + "Start fresh" default), Square primitives. Integration tests per the verify list incl. induced-failure atomicity; browser round-trip (copied outlet's overrides visible in the Manage-locations matrix).
PHASE 2 (investigate, then STOP): grep schema-pg.sql for outlet-keyed CONFIG tables (outlet_tax_profiles, receipt-template assignment, outlet_visibility, outlet-keyed quick grids, anything else outlet_id-keyed that is configuration not data). Produce a proposal table: table, what it holds, FK/uniqueness constraints, secrets y/n, copy recommendation + risk. Do NOT implement any of them. END THE TURN with the proposal — the owner approves per-table (implement in a follow-up commit) or defers to v3 (E6).

Scope: outlet-creation path + this form + the investigation. No changes to the D1 resolver or toggle endpoints.
Autonomy: Phase 1 fully autonomous incl. tests + browser check, commit when green; Phase 2 report-only.
Report: outcome first — Phase 1 test results, then the Phase 2 proposal table.
```

---

### Step 12 as-built (Phase 1 — `3e0b101a`; Phase 2 AWAITING OWNER RULING)

**Phase 1 (shipped)**: `POST /api/outlets` takes optional `copy_from_outlet_id`; the source's
`outlet_business_modules` rows clone inside the SAME transaction as the outlet INSERT (one
set-based `INSERT … SELECT`, re-stamped with the acting employee), plus one `action_history`
row (`action_type='outlet_settings_copied'`) naming source + row count. Response gains
`copied_from_outlet_id` + `copied_module_overrides`. Frontend: "Copy settings from" Select on
the add-outlet form, "Start fresh" default, store outlets only.

Rulings taken inside Phase 1 (each defensible, each reversible):
1. **"Valid source" = exists AND non-van** — the SAME predicate the D1 resolver uses for its
   outlet set (`loadActiveOutlets`), NOT `outlets.is_active`. The spec said "active"; adopting
   `is_active` would have created a THIRD interpretation of "active outlet" (amendment b's
   whole point) and would reject sources the Step 10 matrix happily lists.
2. **Source validation runs INSIDE the transaction** — a source deleted mid-flight fails the
   whole create (404) rather than silently producing an outlet with zero copied overrides.
3. **Copying INTO a van is rejected (400)** — vans carry no per-outlet module state, so the
   rows would be dead data nothing reads.

**Phase 2 investigation (filed, no code)**: 68 `outlet_id`-bearing tables; ~15 are configuration
rather than data. Three findings that change the spec's own assumptions:
- **`receipt_templates` has no `outlet_id`** — the "receipt-template assignment" the spec lists
  as a copy candidate **does not exist**. Nothing to copy. (`printer_config` is likewise
  tenant-wide — a separate multi-outlet gap, not D8's.)
- **Two outlet-scoped tables are invisible to an `outlet_id` grep** — `pos_layouts` and
  `price_list_assignments` scope via polymorphic `scope_type='outlet'` + `scope_id`. Any future
  copy allowlist must name them explicitly.
- **Exactly one outlet-keyed secret exists**: `restaurant_kiosk_slots.slot_token` (UNIQUE, a live
  capability token). No outlet-keyed table holds credentials — `integration_settings` and
  `courier_integrations` are tenant-wide.

**OWNER RULING 2026-07-14 (the record — asked table-by-table, all 11 answers matched the
recommendation):**

| Table | Ruling | Reason given at the pause |
|---|---|---|
| `pos_layouts` (scope='outlet') | **COPY** | One row per outlet, pure UI preference; no money/tax/auth effect |
| `outlet_product_visibility` | **COPY** | Absent row = visible, so "fresh" exposes SKUs the source deliberately hides — copying is the safer default |
| `price_list_assignments` (scope='outlet') | **COPY** | Pricing consistency is the common case; accepted caveat: time-boxed promo lists follow |
| `tip_pool_distribution_rules` | **COPY** | House policy; partial unique (one default/outlet) satisfied since the target starts empty |
| `kds_stations` | **COPY** | Sane starting point; it's an OPTIONAL checklist item, so pre-filling never marks a REQUIRED step done |
| `outlet_tax_profiles` (+`_lines`) | **NEVER** | The table exists BECAUSE outlets differ on tax — copying defeats its purpose. Absent profile = normal tenant-wide cascade (a sane default). A wrong inherited profile mis-charges tax silently, with FBR exposure |
| `menu_schedules` | **NEVER** | Schedules are RESTRICTIONS (no rows = always available), so copying can silently make items unavailable; hours differ per location |
| `booking_services`, `booking_resources`, `room_types`, `rental_items` | **NEVER** | These ARE the Step 11 REQUIRED checklist items — copying marks a new outlet "set up" without a human confirming it offers those services/rooms at those prices; no unique constraints ⇒ duplicates |
| `restaurant_floor_plans` | **NEVER** | `layout_json` describes a different physical room |
| `booking_availability_rules` | **NEVER** | References `employee_id` — would copy STAFF schedules, breaking "employee data never copies" |
| `shopify_location_map` | **NEVER** | Would sync the new outlet's stock to the SOURCE's physical Shopify location |
| `restaurant_kiosk_slots` | **NEVER** | Clones a live capability token (`slot_token`) — the one outlet-keyed secret |
| `pos_device_registry` | **NEVER** | `device_uuid` = physical hardware, exists in one place |
| `approval_policies` | **DEFER → revisit after D2** | Authorization keyed by (outlet, role) — exactly what Steps 13–14 rewire. Ruling now would encode a posture about to change; meanwhile the tenant-wide default still applies, so nothing is unguarded |
| `modifier_groups` | **DEFER → E6** | Needs a deep copy (groups → options → product links) with no unique constraint against duplicates — a multi-table graph clone, beyond v2's one-table scope |

**Durable rule from this ruling** (applies to any future copy candidate): a table whose *existence
is justified by per-outlet divergence* (tax profiles) or that *represents physical/personal
reality* (floor plans, devices, staff schedules, kiosk tokens, channel identity) is never
copyable — and copying must never silently satisfy a REQUIRED Step 11 setup-checklist item.

The 5 COPY tables are implemented in the Step 12 follow-up commit (`ae897d25`); `approval_policies`
is revisited after Gate 3, `modifier_groups` → E6.

**Follow-up as-built (`ae897d25`)**: WHAT is copyable now lives in `services/outlet-copy.js` —
`COPY_SPECS` is the single allowlist AND a contract: every column of every copied table must be
classified `scope`/`copy`/`stamp`/`skip`, enforced by `pg-step12-outlet-copy-drift.test.js`
(negative-tested — dropping a column from a spec fails it with an actionable message). This is
load-bearing: an explicit column list silently drops columns a later migration adds, and
**`kds_stations` already carries four columns its `CREATE TABLE` doesn't show** (`printer_id`,
`balance_strategy`, `target_prep_seconds`, `last_assigned_at`).

Two exclusions decided INSIDE an approved table, applying the durable rule above:
- `kds_stations.printer_id` — `printer_config` is TENANT-WIDE and holds a `host`/`port`, so
  carrying it would point the new outlet's station at hardware standing in the source outlet.
  FK is `ON DELETE SET NULL`, so NULL is an expected state; the merchant picks the printer on site.
- `kds_stations.last_assigned_at` — runtime load-balancing state, not configuration.

Response keeps `copied_module_overrides` (Phase 1 contract) and adds `copied_settings` (per-table
map) + `copied_settings_total`; the audit row names each table and count. A test asserts the seven
NEVER tables stay empty after a copy — the ruling is enforced, not just documented.

---

## GATE 2 — Merge + deploy the per-outlet slice (D1 + D6 + D8)

Follow the Gate protocol. Slice verification subset: Steps 7–12 verify lists + the single-outlet zero-change regression (the whole suite) + POS browser spot-check. Deploy-day: the D1 schema migration is inert until outlet toggles are used; post-deploy live check = Business Modules page on a golv_* tenant, then add a second outlet on a test tenant and drive one override round-trip, plus read-only confirmation that no real tenant's payload changed shape unexpectedly. Owner go required before push/merge.

> **⚠️ Correction to the "single-outlet: identical to v1" check (Gate 2 ledger walk, 2026-07-14).**
> "Identical to v1" is true of **D1 only**, and only that part is outlet-count-gated:
> `outletStates` is computed solely when `activeOutlets.length > 1`
> (`routes/business-modules.js`), so a single-outlet tenant gets no
> `outlets[]`/`enabled_outlet_count`/`default_outlet_enabled` — asserted by the
> byte-compat test in `pg-business-modules-outlet.test.js`.
> **D6 is NOT outlet-gated and deliberately changes the single-outlet payload**: any
> tenant with an ENABLED covered vertical (restaurant / rooms_lodging / rentals /
> appointments) gains a `checklist` field and reads `attention_required` while a
> required item is un-done. Step 11 browser-verified exactly this on the
> then-single-outlet `golv_cafe` ("Attention" + "Get started — 2 of 3 done").
> So: run the "identical to v1" check on a single-outlet tenant with **no covered
> vertical enabled** (`golv_general_retail`, `golv_grocery`, `golv_textile`,
> `golv_butcher`, `golv_sweet_shop`, `golv_wholesale`). On `golv_restaurant` /
> `golv_hotel` / a clinic preset, a "Get started" line and an Attention chip are the
> CORRECT post-deploy result — not a regression, and not a reason to roll back.
>
> Measured on the local v136 DB at the Gate 2 walk (live `GET /api/business-modules`):
>
> | Tenant | Store outlets | Top-level keys | cards w/ `outlets[]` | cards w/ `checklist` | `attention_required` |
> |---|---|---|---|---|---|
> | `golv_general_retail` | 1 | `industry_type,modules,outlet_count` | 0 | 0 | none |
> | `golv_restaurant` | 1 | *(same v1 shape)* | 0 | 1 (`restaurant`) | none — its required items are already done |
> | `golv_cafe` | 3 | *(same v1 shape)* | 13 | 1 (`restaurant`) | `restaurant` |
>
> Note the top-level shape never changes (the v2 fields are per-CARD), the 13 cards
> match the catalog's 13 `scope:"outlet"` entries exactly, and `attention_required`
> depends on the DATA (un-done required item), not on the tenant being multi-outlet —
> `golv_restaurant` carries a checklist yet still reads `on`.

**Prompt:**
```
Effort: high.

Why: GATE 2 merges + deploys the per-outlet slice (D1 + D6 + D8 — Steps 7–12). This is the
second of three owner-gated releases; the whole point of the three-gate split is that
request-wide gating changes never ship in one giant release. Steps 7–12 are COMMITTED and
PUSHED on `feat/business-modules-v2` but have NEVER run in production.

Read FIRST (do not skip, do not trust this prompt over source): docs/fable5/business-modules/
PLAN-V2.md — the "Gate protocol" paragraph (top of file), the Steps 7–12 as-built notes, and
the GATE 2 section. Then verify state against git/source, not against docs.

State at hand-off (verify, don't assume):
- Branch `feat/business-modules-v2`, pushed, in sync with origin. Contains 100% of main
  (`git log HEAD..origin/main` is empty). main is at Gate 1 + kiosk-removal.
- Slice commits: b0cffda4 (Step 7, migration v136) · da56dd45 (8) · 013f83f3 (9) · 8bf95eb2 (10)
  · c6557946 (11) · 3e0b101a (12 Phase 1) · + Step 12's 5-table copy follow-up.
- Migration head = v136 (D1 schema; inert until outlet toggles are used).

Do, in this order:
1. LEDGER RECONCILIATION (cheap, do it first — this drifts silently and already drifted once:
   Step 11 shipped with its tracker row still reading "not started"). Walk the PLAN-V2 tracker
   rows for Steps 7–12 against `git log` reality; confirm every deferred item has a home (E5/E6/
   E7/E8, the queued requireMode fail-closed flip, approval_policies→after-D2, the Gate-1
   COD-approve revert). Fix drift in PLAN-V2.md.
2. Gate protocol (1): /code-review on the slice diff vs main (`git diff origin/main...HEAD`) —
   fix or justify every finding.
3. Gate protocol (2): the slice verification subset — Steps 7–12 verify lists + the
   single-outlet zero-change regression + POS browser spot-check. Then the FULL backend suite,
   diffed against the ~57-failing-file / ~32-failing-test baseline (run `--no-file-parallelism`;
   parallel runs deadlock in seedSchema — infra artifact, not a regression). Known-pre-existing,
   do NOT chase: crud_settings/attendance/context-enforcement/crud_employees (dead files
   requiring the deleted SQLite `../helpers/createTestApp`), routes-admin-worker-status ×2,
   services payment-gateway isEnabled. Backend tests run from `backend/` cwd or Vitest throws
   "describe is not defined".
4. Gate protocol (3): CLAUDE.md slice sweep — root CLAUDE.md still says migration head v130
   (actual v136) and does not mention outlet_business_modules, the per-outlet endpoints, the D8
   copy param, or the setup checklists. Verify every sentence you write against source. (The
   FULL docs sweep is Step 16 — keep this to the slice.)
5. Gate protocol (4): STOP. Report and get the owner's explicit go. Do NOT push to main or
   merge before that word.
6. Gate protocol (5): merge to main (no PR — git-workflow rule), watch Railway + Vercel, then
   the post-deploy live check: Business Modules page on a golv_* tenant (single-outlet payload
   must be IDENTICAL to v1); then add a second outlet on a TEST tenant and drive one override
   round-trip; plus read-only Supabase confirmation that no real tenant's payload shape changed.
   Real tenants are READ-ONLY, always.

Standing rules: local Postgres only (backend/.env.test / sanopos_dev) for tests + migrations —
NEVER run migrations against prod; Supabase read-only; all UI via ui/primitives + --ui-* tokens.
Local `golv_cafe` was mutated during Step 12 verification and NOT reverted (outlets "Downtown"
+ "Airport", a restaurant override at Main+Airport, multi-outlet flags seeded, max_outlets 1→4)
— it is local-only and disposable; prefer a different golv_* tenant for a clean single-outlet check.

Out of scope: the requireMode fail-closed flip (deliberately NOT in this gate — it touches the
same requireMode function Step 9 rewired; it ships as its own release AFTER Gate 2 stabilizes,
and is blocked on two things: seeding tenant_modes in createTestApp, and proving the v135
provisioning seeders in prod — no tenant has been provisioned since 2026-07-07). Steps 13–14 (D2).

Report: outcome first — ledger drift found/fixed, review verdict, verification subset results,
full-suite diff vs baseline, docs touched; then the explicit "Gate 2 ready, awaiting go" statement.
```

---

## Post-Gate-2 release — D5 follow-up: flip `requireMode` to hard fail-closed

- **Goal**: retire the Step 5 "warn-and-pass for one release" posture. `requireMode`'s empty-map
  branch currently warns (Sentry + logger) then **falls through**, leaving feature flags as the sole
  gate; this makes it 403.
- **Why its OWN release, not part of a gate**: Step 9 rewired the *same* `requireMode` function
  (the outlet gate). Shipping both together makes a post-deploy 403 ambiguous — outlet resolver or
  mode flip? — and costs surgical rollback. Do it **after Gate 2 has deployed and stabilised**, on
  its own branch off the fresh `main` (NOT on `feat/business-modules-v2`, which continues to
  Steps 13–14 → Gate 3; otherwise this rides Gate 3). Afterwards, merge `main` back into the v2
  branch (the same "Merge main" the branch already did once after Gate 1).
- **Recommended slot**: during the Gate 2 bake window, BEFORE Step 13 — if it waits behind
  13 → 14 → Gate 3 it is buried for weeks, and this item has already been parked once.
- **Not urgent, and not a one-liner**: it closes no live hole (see precondition 1 — the branch is
  provably unreachable today); its value is guarding FUTURE drift.
- **Preconditions — VERIFY, don't assume** (evidence-gated, not calendar-gated):
  1. ✅ **Met as of 2026-07-14**: every active tenant has a full mode-row set. Positive proof beats
     Sentry silence (absence of warns can't distinguish "no problem" from "nobody hit the path").
     Re-run before flipping — read-only:
     ```sql
     SELECT t.table_schema,
            (xpath('/row/cnt/text()', query_to_xml(format('SELECT COUNT(*) AS cnt FROM %I.tenant_modes', t.table_schema), false, true, '')))[1]::text::int AS mode_rows
     FROM information_schema.tables t
     WHERE t.table_name='tenant_modes' AND t.table_schema LIKE 'tenant_%' ORDER BY mode_rows ASC;
     ```
     Also confirm no active tenant's schema LACKS the table (that also yields an empty map). Result
     2026-07-14: **29/29 active at 10/10 rows, 0 schemas missing the table**; Sentry: zero warns.
  2. ❌ **THE BLOCKER — the provisioning path has never run in prod since v135.** Newest tenant =
     **2026-07-07**; v135 shipped **2026-07-12**. Step 5 also changed `setup.js` + `preset-apply.js`
     to seed `fullModeRows`, and that code has ZERO production evidence. No amount of waiting proves
     it — only a real provision does. Provision one throwaway tenant on prod (signup → wizard),
     confirm 10/10 rows, delete it from `/admin`. If the seeder is broken, the victim of the flip is
     a brand-new customer 403-storming during onboarding.
  3. ❌ **Harness gap** — `createTestApp` never seeds `tenant_modes` (verified 2026-07-14; Step 9 did
     not add it) and **31 route files** use `requireMode`. Today the empty map falls through, which is
     exactly why every vertical suite is green. Flip without seeding ⇒ they all 403 for the wrong reason.
- **The work**:
  1. **Harness first**: `tests/helpers/createTestApp-pg.js` seeds the full row set via
     `config/mode-registry.js:fullModeRows` (don't reimplement). Seeding all-enabled preserves today's
     behavior for any test that doesn't write its own rows; tests wanting a mode OFF write it (as
     `pg-mode-gates.test.js` does). Watch for tests that wrote a PARTIAL row set — those already got a
     403 for unlisted modes and will now pass instead.
  2. **Then flip**: remove the fall-through in `requireMode`. Keep `reportEmptyModes()` firing — you
     still want telemetry after the flip.
  3. **Decide and state the refusal shape**: an empty map returning the plain
     `Mode not enabled: <name>` is indistinguishable from a legitimately-off mode. Recommend a
     DISTINCT code (e.g. `MODES_NOT_SEEDED`) so ops can tell a seeding failure from a normal refusal.
  4. **Handle the two things the fall-through also silently protected** (name them, don't discover
     them in prod): (a) `getModesMap` returns `{}` when `init()` was never called — some harnesses
     build an app without feature-flags deps; (b) a MISSING `tenant_modes` table also yields `{}`
     (`getModesMap` swallows it, so `requireMode`'s "does not exist" catch never sees it). The
     pre-setup window is covered by the `SETUP_REQUIRED` gate, but a failed per-tenant migration on a
     LIVE tenant now 403-storms — that IS fail-closed working as intended, but make it a deliberate,
     stated decision.
  5. Drop the `NODE_ENV==='test'` gate on the warn only if the harness genuinely can't produce an
     empty map any more.
- **Verify**: full backend suite diffed against the ~57-file baseline — the blast radius is every
  mode-gated route, so the vertical suites (restaurant/bookings/rentals/rooms/treatment/gym) are the
  canary; `pg-mode-gates.test.js` green; one browser spot-check on a mode-gated page.
- **Deploy**: own release, own deploy watch, Sentry watched for a 403 spike. Rollback = revert the
  one commit.
- **Done when**: ☐ harness seeds modes; ☐ provisioning proven in prod; ☐ fall-through gone + refusal
  code decided; ☐ full suite ≤ baseline; ☐ deployed with zero 403 spike; ☐ Step 5's tracker row +
  as-built + `backend/CLAUDE.md` + `backend/middleware/CLAUDE.md` updated to drop "warn-and-pass".

**Prompt:**
```
Effort: high.

Why: D5 shipped a deliberate one-release posture — requireMode warns then FALLS THROUGH on an
empty tenant_modes map, leaving feature flags as the sole gate. This retires it. It is NOT
urgent (it closes no live hole — every active tenant provably has a full mode-row set) and it is
NOT a one-liner: the fall-through is load-bearing for the test harness and silently protects two
other cases. It ships as its OWN release because Step 9 rewired the same requireMode function —
bundling makes a post-deploy 403 ambiguous and costs surgical rollback.

Read FIRST (verify against source, not docs): docs/fable5/business-modules/PLAN-V2.md — the
"Post-Gate-2 release — D5 follow-up" section (the spec, incl. the preconditions and the two
silently-protected cases) + the Step 5 as-built; backend/middleware/feature-flags.js
(requireMode + reportEmptyModes + getModesMap); backend/middleware/CLAUDE.md.

PRECONDITIONS — verify all three and REPORT before writing the flip:
1. Re-run the read-only cross-schema query in the spec: every active tenant has a full
   tenant_modes row set AND no active tenant's schema lacks the table. (2026-07-14: 29/29 at
   10/10, zero missing, zero Sentry warns.)
2. THE BLOCKER: prove the provisioning path. No tenant has been provisioned in prod since
   2026-07-07 and v135 shipped 2026-07-12, so setup.js + preset-apply.js fullModeRows seeding has
   NEVER run in production. Provision ONE throwaway tenant on prod (signup → wizard), confirm
   10/10 mode rows, then delete it from /admin. If this fails, STOP and report — do not flip.
3. Confirm Gate 2 is deployed and stable, and that you are on a NEW branch off the CURRENT main
   (e.g. chore/require-mode-fail-closed) — NOT feat/business-modules-v2, which continues to
   Steps 13-14/Gate 3.

THEN do the work in the spec's order: harness seeding FIRST (createTestApp-pg.js via
config/mode-registry.js:fullModeRows — never reimplement the predicate), then the flip, then
decide the refusal code (recommend a distinct MODES_NOT_SEEDED so ops can tell a seeding failure
from a normal "mode is off"), and explicitly handle/state the two cases the fall-through also
protected (uninitialised feature-flags deps; a missing tenant_modes table). Keep reportEmptyModes
firing after the flip.

Verify: full backend suite diffed against the ~57-failing-file baseline (run
--no-file-parallelism, from backend/ cwd) — the vertical suites are the canary; pg-mode-gates
green; one browser spot-check on a mode-gated page. Known-pre-existing, do NOT chase:
crud_settings/attendance/context-enforcement/crud_employees (dead SQLite-helper imports),
routes-admin-worker-status x2, payment-gateway isEnabled.

Then update Step 5's tracker row + as-built, backend/CLAUDE.md and backend/middleware/CLAUDE.md
to drop the "warn-and-pass" language, and the memory topic file.

Standing rules: local Postgres only for tests/migrations — NEVER migrate prod; Supabase
READ-ONLY on real tenants (the throwaway tenant you create is yours to delete). Owner go before
push/merge to main. No PR.
Autonomy: preconditions + report, then implement autonomously once precondition 2 passes; STOP
for the owner's go before merge/deploy.
Report: outcome first — the three precondition results (with the provisioning proof called out),
what the flip changed, refusal-code decision, full-suite diff vs baseline; then "ready, awaiting go".
```

---

## Step 13 — D2a: Per-outlet roles backend (the auth-model change)

- **Goal**: regional managers / per-outlet role overrides. Grounding: `employee_outlets` exists at the right grain (`schema-pg.sql:1317`); the blocker is policy + resolution. (1) Schema: `employee_outlets` gains `role_id INTEGER NULL REFERENCES roles(id) ON DELETE SET NULL` (**amendment h** — a deleted role must degrade the override to inherit, not make roles undeletable; NULL = inherit `employees.role_id`; zero cost for existing rows). (2) Resolution: `loadTenantAndPerms` (executor MUST first read `middleware/tenant-auth.js` + `backend/middleware/CLAUDE.md` for the current perm-load + cache design) resolves the effective role per request **via the Step 9 shared outlet resolver** — if the resolved outlet has an override row for this employee, permissions load from THAT role; else from `employees.role_id`. Design constraints frozen: JWT `rid` stays the base role (no token-shape change); **payloads expose BOTH `base_role_id` and `effective_role_id` (amendment h)**; no resolvable outlet → base role — and the plan says out loud: *a per-outlet override is scoping, not a hard demotion; to hard-demote, change the base role* (the Step 9 fail-closed rule already prevents header-omission games on operational routes); perm cache keying must include the resolved role (verify how/if perms are cached before touching anything). (3) **Effective-permissions endpoint (amendment h)**: the context bootstrap (`/api/context/bootstrap` or equivalent — executor locates it) returns the effective role + its permission set for the current outlet context, because AuthProvider's boot fetch of `/api/roles/:id/permissions` (base role) cannot represent overrides — Step 14 consumes this. (4) **API contract frozen at the pause (amendment h)**: `PUT /api/employees/:id/outlets` gains an optional per-outlet `role_id` map — exact request/response shapes, validation (role exists, tenant-owned), and transaction behavior are specified in the Phase 1 report and approved before implementation. (5) Policy relax: `employees.js:211-214` — multi-outlet assignment becomes legal; the old rule's intent is preserved by outlet-assignment enforcement (exists in `registerAllRoutes.js`, now resolver-backed). (6) Kiosk/PIN and portal auth scopes OUT of scope.
- **Touches**: `backend/migrate-pg.js` (new version), `schema-pg.sql`, `middleware/tenant-auth.js`, `routes/employees.js`, the bootstrap route; tests.
- **Model/effort**: claude-fable-5 / xhigh — touches every authenticated request's permission resolution; the single most auth-sensitive step SanoPOS has taken since multi-tenancy.
- **Pause**: **YES, mid-step** — Phase 1 investigates and reports (current perm-load/cache design, proposed resolution + cache-key + invalidation, the frozen API contract, the exact policy-relax wording); owner approves; Phase 2 implements.
- **Verify (the 6-case no-context matrix — amendment h — plus function tests)**: (a) base Cashier + Manager-override at B: B-context passes Manager gates, A-context 403s, no-context = Cashier; (b) **base Manager + Cashier-override at B: B-context gets ONLY Cashier perms; A-context Manager; no-context on an operational outlet-scoped route → the Step 9 fail-closed 403 (header omission does NOT restore Manager there); no-context on an allowlisted tenant-level admin endpoint → base Manager, documented**; (c) unassigned-outlet context → rejected by the resolver; (d) invalid/malformed outlet context → rejected, never silent fallback; (e) override removal reverts immediately (cache invalidation on the assignment PUT); (f) role deletion → override degrades to inherit (SET NULL path). Plus: multi-outlet Manager assignment accepted; single-role employees (no overrides) — ENTIRE suite green vs baseline (NULL overrides must cost nothing); JWT shape unchanged (decode test); bootstrap returns base + effective identity and effective perms per context.
- **Done when**: ☐ override resolution live via the shared resolver + cached safely; ☐ 6-case matrix green; ☐ bootstrap serves effective perms; ☐ policy relaxed without weakening outlet-assignment enforcement; ☐ zero-override tenants provably untouched; ☐ fresh-context verifier has read the auth diff.

**Prompt:**
```
Effort: xhigh.

Why: D2 — regional managers. An employee can hold a different role per outlet (Manager at the branch they run, Cashier elsewhere). This rewires permission resolution on every authenticated request, so it runs read-first: report the current design + the frozen API contract, pause for owner sign-off, then implement. Both directions matter: an override that GRANTS at one outlet, and an override that RESTRICTS at one outlet — the restricting direction must not be escapable by omitting outlet context on operational routes (the Step 9 fail-closed rule is the backstop; reuse it, don't duplicate it).

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 13 (the spec — frozen: JWT rid stays base role; resolution uses the Step 9 shared outlet resolver; no resolvable outlet → base role, with the "override is scoping, not demotion" rule documented; payloads expose base_role_id AND effective_role_id; employee_outlets.role_id is ON DELETE SET NULL; kiosk/portal scopes untouched):
PHASE 1 (investigate, then STOP and report): read middleware/tenant-auth.js loadTenantAndPerms end-to-end + backend/middleware/CLAUDE.md — how are permissions loaded, cached, keyed, invalidated? Locate the context bootstrap endpoint AuthProvider/PresetContext use. Then report: (1) proposed resolution design (where the shared resolver hooks in relative to perm loading, cache-key change, invalidation points); (2) the FROZEN API contract for PUT /api/employees/:id/outlets with per-outlet role_id map (request/response shapes, validation, transaction) and the bootstrap's new effective-role fields; (3) exact relaxed wording for the employees.js:211-214 policy. END THE TURN.
PHASE 2 (after owner approval):
1. Migration (check head): ALTER employee_outlets ADD COLUMN role_id INTEGER NULL REFERENCES roles(id) ON DELETE SET NULL. schema-pg.sql updated.
2. loadTenantAndPerms: effective role via the approved design; invalidate on the assignment PUT and on role deletion.
3. routes/employees.js: the approved PUT contract; policy relaxed per approved wording; GET /:id/outlets returns role overrides (base + effective visible).
4. Bootstrap endpoint: current-context effective role + permission set (base_role_id + effective_role_id + permissions).
5. Full verify list from PLAN-V2.md Step 13 — the 6-case no-context matrix INCLUDING the reverse-override (base Manager, Cashier at B) cases, and the zero-override whole-suite regression gate (non-negotiable).
Then spawn a fresh-context verifier subagent with only PLAN-V2.md Step 13 + the auth diff.

Scope: tenant-employee JWT path only. No kiosk, portal, or admin auth changes. No frontend (Step 14).
Autonomy: Phase 1 autonomous then hard stop; Phase 2 autonomous after approval; local PG only; commit when green.
Report: Phase 1 — findings + the three proposals. Phase 2 — outcome first, verifier findings verbatim, 6-case matrix results, regression diff.
```

---

## Step 14 — D2b: Per-outlet roles frontend + role-surface audit + C8 permission-refresh

- **Goal**: (1) Employee editor (`EmployeesRedesign.jsx` — verify location) exposes per-outlet role overrides: the outlet-assignment UI gains an optional role Select per assigned outlet ("Inherit (Cashier)" default), writing the Step 13 contract. (2) **Effective-perms consumption (amendment h)**: on outlet-context switch, the frontend refreshes nav + guards from the Step 13 bootstrap's effective role/permissions — NOT from `/api/roles/:id/permissions` (that fetch serves only the boot path for the base role; verified: `AuthProvider.jsx` loads base-role perms today). Trace where outlet context changes (ContextSelect / token re-mint flow) and hook the refresh there — without changing AuthProvider's boot contract. (3) **Role-surface audit both directions** (memory lesson `feedback_field_rep_perm_audit`): Cashier-base + Manager-override-at-B walks Manager surfaces under B (visible/200) and under A (hidden/403); **Manager-base + Cashier-override-at-B walks the same surfaces inverted** — both documented. (4) `roles_with_access` on Business Modules cards: verify it remains truthful (overrides don't change role definitions — prove, no code change expected). (5) **C8 — permission-change refresh (AUDIT §4B)**: a role-permission save in the roles editor and a per-outlet override assignment refresh the affected session's nav + guards without re-login where the session is the editor's own; other employees pick up changes at their next bootstrap/context switch — implement the minimal honest version on the same context-refresh machinery built in (2) and DOCUMENT the chosen semantics (the audit's "works only after reload" must at least become "immediate for the editing admin, next-bootstrap for others").
- **Touches**: `EmployeesRedesign.jsx`, the roles editor save path, the context-switch refresh path, tests.
- **Model/effort**: claude-fable-5 / high — the refresh path across auth caches is the tricky half; the editor UI is routine.
- **Pause**: no.
- **Verify**: browser: assign override, switch context, nav gains/loses groups in-place both directions; editor round-trips overrides showing "Inherit (<base>)" vs explicit; the Step 13 matrix's browser mirror (403/200 both directions); frontend unit tests green.
- **Done when**: ☐ editor live; ☐ context-switch refresh proven without logout, bootstrap-driven; ☐ both-direction browser audit documented.

**Prompt:**
```
Effort: high.

Why: the merchant-facing half of per-outlet roles. The hard part is the refresh: an employee switching outlet context must get their outlet's EFFECTIVE role reflected in nav and page guards immediately, sourced from the context-aware bootstrap — the old base-role permissions fetch structurally cannot represent overrides. "Works after re-login" is a failed feature.

Task: Per docs/fable5/business-modules/PLAN-V2.md Step 14 (the spec):
1. EmployeesRedesign.jsx outlet-assignment UI: per assigned outlet, an optional role Select defaulting to "Inherit (<base role>)", persisting via the Step 13 PUT contract. Square primitives.
2. Context-switch refresh: find where outlet context changes (ContextSelect / token re-mint flow) and refresh effective perms + nav there from the Step 13 bootstrap fields (base_role_id, effective_role_id, permissions). Do NOT change AuthProvider's boot contract; add the minimal context-switch hook. If a needed backend affordance is missing, stop and report first.
3. Role-surface audit BOTH directions (memory: feedback_field_rep_perm_audit): (a) Cashier-base + Manager-override-at-B: Manager surfaces (products write, POs, inventory) visible/200 under B, hidden/403 under A; (b) Manager-base + Cashier-override-at-B: the same surfaces inverted. Document every surface checked.
4. Prove roles_with_access on the Business Modules page is unaffected (overrides don't alter role definitions).
5. C8: after a role-permission save in the roles editor (and after assigning a per-outlet override), refresh the editing session's nav/guards in place using the same refresh machinery as (2); document that other employees converge at next bootstrap/context switch. Browser-prove: edit own role's perms → nav updates without reload.

Scope: employee editor + roles-editor save hook + context-switch refresh only. No backend changes.
Autonomy: browser walkthrough per the verify list; screenshots; frontend unit tests. Commit locally when verified.
Report: outcome first — the refresh mechanism, then the two-direction audit table + screenshots.
```

---

## Step 15 — End-to-end verification (fresh-context verifier + prod read-only)

- **Goal**: prove the whole v2 against this plan with eyes that didn't build it, on local test tenants; read-only prod sanity via Supabase MCP; file `VERIFICATION-V2.md`. Note: Gates 1–2 slices are already live in prod by now — their items re-verify against prod READ-ONLY where possible, locally otherwise.
- **Touches**: nothing (verification only; fixes loop back to the relevant step).
- **Model/effort**: claude-fable-5 / high.
- **Pause**: **YES, after** — owner reviews the report before Step 16 / Gate 3.
- **Verify (the matrix)**: (1) **D7**: custom role with only `manage_integrations` drives credentials, 403s roles; only `manage_roles` vice-versa. (2) **D4**: pristine local Cashier → sales-only; customized role grandfathered with all splits; fresh Cashier sales-only; dashboard works for Cashier; mixed-endpoint treatments hold (no financial fields for a sales-only token where filtering was ratified); zero `view_reports` consumers (grep); role editor shows split perms. (3) **D5**: every local tenant fully materialized; explicit-false mode 403s; fresh tenant per preset family works immediately; empty-map path per owner variant. (4) **D3**: expander, parent-off tooltips, skipped_restores toast, saved_flags round-trip intact. (5) **D6**: fresh restaurant tenant `attention_required` 0/N; floor plan at outlet A completes A's item, NOT B's; optional items don't hold the state; deep-links land. (6) **D1**: two-outlet tenant — override off at B: B blocked (`outlet_scoped:true`), A works; company-off wins; dormant override survives company off/on; `default_outlet_enabled:false` gates unlisted outlets; sparse-row module = default TRUE; **no-header + `oid:null` token → `OUTLET_CONTEXT_REQUIRED` on operational routes; malformed/foreign outlet ids rejected**; hybrid card outlet-op → 409 `TENANT_SCOPED`; single-outlet tenant payload + UX byte-identical to v1; workers process only enabled outlets; matrix Drawer + defaults control round-trip; `manage_outlet_modules`-only role drives matrix, not company toggles; locks block enable-direction overrides AND default flips; GET query-count assertion. (7) **D8**: copied outlet matches source module overrides; uncopied inherits clean; atomicity under induced failure; Phase 2 ruling implemented or E6-deferred. (8) **D2**: the full 6-case no-context matrix INCLUDING reverse-override (base Manager + Cashier-at-B: B-context restricted, header-omission does NOT restore Manager on operational routes); context switch updates in-place from bootstrap; role deletion degrades override to inherit; zero-override tenant untouched (suite diff); JWT unchanged. (9) **v1 regression sweep**: the entire v1 Step 10 matrix (15 items) re-run — especially saved_flags, legacy PUT lockdown, locks, single-outlet flows. (10) **Prod read-only** (Supabase MCP, SELECT only): post-Gate-1 — confirm role classifications match the D4 + Field Rep migration log expectations on every real tenant; post-Gate-2 — confirm no real tenant has unexpected `outlet_business_modules` rows; count multi-outlet tenants; confirm the pending Gate-3 migration's preconditions. (11) **Audit-disposition sweep**: walk the audit-disposition table at the end of this file — every finding routed to Wave 0 or a Step must show live evidence (Wave-0 items re-verified against prod: discount 403 for a perm-less token, last-admin guard, employees guard, POS-redirect keying both directions, dashboard gating, role labels, nav parity; folded items via their step's as-built evidence); E7/E8 rows confirmed present in the deferred tables. Any unaccounted finding = FAIL.
- **Done when**: ☐ `VERIFICATION-V2.md` filed with pass/fail + evidence per item; ☐ all fails fixed and re-verified or explicitly owner-waived.

**Prompt:**
```
Effort: high.

Why: pre-Gate-3 proof for the whole v2 wave. Fresh-context verification — you did not build this; trust live behavior over the implementation's claims. v2 changed auth resolution, gate semantics, and a 34-file permission sweep across three deployments: the v1 regression half and the cross-gate interactions matter as much as the new features.

Task: Read docs/fable5/business-modules/PLAN-V2.md (all Step as-built notes) + PLAN.md's Step 10 matrix + FEATURE-CATALOG.md. On the local stack, provision/reuse: a general_retail tenant, a restaurant tenant, a THREE-outlet tenant, and one fresh signup per preset family. Execute every item in PLAN-V2.md Step 15's matrix end-to-end — browser for UI items, direct API calls for gates (both x-outlet-id directions, omitted/malformed headers, oid:null tokens, reverse-role-override cases), manual worker-poll invocations for outlet filters, induced-failure for D8 atomicity. Re-run the complete v1 Step 10 matrix (15 items) as the regression half. Walk the audit-disposition table (end of PLAN-V2.md): re-verify every Wave-0 fix live (read-only API probes + browser) and confirm every folded finding's step evidence exists — an unaccounted finding is a FAIL. For prod: READ-ONLY via Supabase MCP — verify Gate 1's role classifications on real tenants, Gate 2's payload neutrality, multi-outlet tenant count, and Gate 3 migration preconditions. Never write to prod.

Scope: verification only. File docs/fable5/business-modules/VERIFICATION-V2.md with pass/fail + evidence per item. Do not fix anything — report.
Autonomy: run the whole matrix; end the turn with the report. The owner reviews before Gate 3.
Report: verdict first (ship / fix-first, worst finding named), then the per-item table, then the prod numbers.
```

---

## Step 16 — Docs, memory, final review — GATE 3: merge + deploy the D2 slice

- **Goal**: close out: `/code-review` on the remaining branch diff (fix or justify each finding); update root + `backend/` + `frontend/` + affected sub-directory `CLAUDE.md` files (new perms + retired `view_reports`, outlet tables + resolver + fail-closed gate semantics, the shared outlet resolver, hybrid v2 rule, per-outlet roles resolution + bootstrap contract, `requireMode` fail-closed, new endpoints, D8 param, checklists — verify every sentence against source); memory files per one-lesson-per-file convention (at minimum: the shared-resolver + fail-closed design; D1 inherit-resolution + cache shape; D2 effective-role resolution + bootstrap-driven refresh; D4's catalog-removal-as-drift-enforcement; whatever Step 15 taught) + MEMORY.md pointers; update this file's tracker + as-built notes; tidy history. **Then Gate 3 per the Gate protocol**: owner go → push, merge, deploy watch, post-deploy live check (assign a test override on a golv_* tenant, verify both directions live, remove it). No PR (git-workflow rule).
- **Touches**: CLAUDE.md files, memory dir, git.
- **Model/effort**: sonnet / medium — the code-review skill does the heavy lifting.
- **Pause**: **YES** — push/merge owner-gated.
- **Verify**: review findings triaged; docs verified against code, not this plan; memory follows convention.
- **Done when**: ☐ review clean or accepted; ☐ docs + memory updated; ☐ Gate 3 executed after owner go.

**Prompt:**
```
Effort: medium.

Why: close out the Business Modules v2 build — review, docs, memory, and the final gate.

Task: On feat/business-modules-v2: (1) run /code-review on the branch diff since Gate 2 and fix or explicitly justify each finding; (2) update root CLAUDE.md, backend/CLAUDE.md, frontend/CLAUDE.md, and the affected sub-guides (middleware/, routes/, services/, config/) for: the view_reports split + delegation perms, outlet_business_modules + default_outlet_enabled + the effective-state rule + hybrid's tenant-wide v2 status, the shared outlet resolver + OUTLET_CONTEXT_REQUIRED fail-closed rule + allowlist, requireMode fail-closed, employee_outlets.role_id (SET NULL) + effective-role resolution + the bootstrap contract, the new/changed endpoints, and setup checklists — verify every sentence against source, not against PLAN-V2.md; (3) write memory files per the one-lesson-per-file convention (minimum: shared-resolver + fail-closed design; D1 inherit rule + cache payload; D2 bootstrap-driven effective perms; D4 catalog-removal drift enforcement; Step 15 lessons) + MEMORY.md pointers; (4) update PLAN-V2.md's tracker to final states; (5) tidy history if needed. STOP before pushing — report and wait for my explicit go, then execute Gate 3: push, merge to main, watch Railway + Vercel, post-deploy live check (temporary role override on a golv_* tenant, both directions, then remove). No PR.

Scope: docs/memory/review/git only — no feature-code changes except review fixes.
Report: outcome first — review verdict, docs touched, memory files added; then the Gate-3-ready statement.
```

---

## Open questions / accepted defaults (owner can override at any pause)

1. **Locked by owner 2026-07-11 (initial)**: full D1–D8 scope; one umbrella plan; sequential steps, commit-per-step; full v1-style verification tail.
2. **Locked by owner 2026-07-11 (second-opinion review)**: D4 = SPLIT posture (pristine-default Cashiers → sales-only; customized roles grandfathered; migration logs every classification); delivery = one branch with THREE merge/deploy gates (governance → per-outlet → per-outlet roles); all review amendments (a)–(j) in the header adopted.
3. **Accepted defaults from planning (override if wrong)**: D1 resolution rule = company-enabled AND (override ?? default_outlet_enabled ?? TRUE), overrides dormant through company off/on, sparse `tenant_business_modules` row = default TRUE; hybrid cards tenant-wide in v2 (E4); outlet-scoped operational routes fail closed without a resolved outlet, allowlist for settings/reports/admin; `depends_on` company-level (E1); D2 JWT unchanged, both identities exposed, effective perms via bootstrap, `ON DELETE SET NULL`, tenant-employee JWT path only, "override is scoping not demotion"; D7 perms granted to no default role; D6 checklists data-driven with required/optional + tenant/outlet scope per item, `attention_required` until all required done, 4 verticals covered (E5); D3 presentation-only; D8 modules-only copy with owner-gated allowlist expansion (E6 if deferred).
4. **Decisions parked at their pauses**: D5 hard-fail-closed vs one-release warn (Step 5); D4 taxonomy + mapping + mixed-endpoint treatments + pristine predicate (Step 3 pause-after); Step 9 fallback allowlist contents; D8 Phase 2 per-table rulings (Step 12); D2 resolution/caching design + API contract (Step 13 Phase 1).
5. **Biggest risks surfaced by grounding + review**: (a) Step 9 — `requireFeature` on every gated request + the resolver refactor of `resolveContext`/outlet-assignment enforcement; the single-outlet zero-change whole-suite gate is the non-negotiable net. (b) Step 13 — permission resolution on every authenticated request; investigate→pause→implement, 6-case matrix incl. reverse overrides. (c) D4's 34-file surface; catalog removal converts the grep problem into a CI guarantee. (d) `oid:null` tokens exist via the context-switch re-mint (`auth.js:~595`) — the fail-closed rule is what stops deliberate un-scoping; normally-issued tokens always carry a primary-outlet `oid` (`auth.js:261-268`).
6. **Known interactions with open follow-ups**: `GET /api/feature-flags`'s weak header-only auth remains out of scope (pre-existing); Playwright shared tenant `packagesmall` still deleted — Step 15 relies on local + fresh-provisioned tenants.
7. **Not in scope, noted**: location-aware `depends_on`; per-outlet activation for device- and hybrid-scoped cards; kiosk/portal auth scopes in D2; industry switching (v1's restaurant gate-only caveat stands).
8. **Locked by owner 2026-07-11 (audit integration)**: the consolidated audit (AUDIT-FINDINGS.md) is folded into this plan — Wave 0 (W0a/W0b + Gate 0) ships the independent CONFIRMED defects to `main` BEFORE Step 1 branches; S3 → Step 2; C2/C6/unguarded-trio rulings → Step 3's pause, applied in Step 4; S5 → Step 4; onboarding-proxy replacement → Step 11; C8 → Step 14; registry drift tests + truthless-flag disposition → Step 6b; the 78-endpoint coverage clusters are EXCLUDED → separate plan (E7); preset operator roles → E8. The audit-disposition table below is the completeness contract — Step 15 walks it and fails on any unaccounted finding.

## Deferred to v3 (running list — add here during execution, never silently drop)

| # | Item | Source |
|---|---|---|
| E1 | Location-aware `depends_on` (outlet-level prerequisite cascades) | Step 8 explicit deferral |
| E2 | Per-outlet activation for device-scoped cards (per-register modules) | Scope rule, Step 7 |
| E3 | Kiosk/portal-scope awareness of per-outlet roles | Step 13 scope rule |
| E4 | Hybrid-card contract: tenant-wide credentials + per-outlet operational enablement (FBR/Shopify/Woo/couriers/payments/channels) | Second-opinion amendment (d) |
| E5 | Setup checklists for the remaining Bucket A verticals (Step 11 covers Restaurant/Rooms/Rentals/Appointments only). Un-covered Bucket A cards awaiting checklists: `subscriptions_memberships`, `clinical`, `service_tickets`, `projects_contracts`, `commissions`, `wholesale_credit`, `field_sales`. (The dashboard `membership` onboarding step was a permanent `done:false` proxy and was **removed** in Step 11 — memberships get their real checklist here.) | Second-opinion amendment (g) |
| E6 | D8 extended copy allowlist: **`modifier_groups` only** (deferred at the Step 12 ruling — needs a groups→options→product-links deep copy). The other 12 candidates were RULED at the Step 12 pause 2026-07-14 (5 COPY → shipped in Step 12's follow-up commit; 7 NEVER — see the Step 12 as-built ruling table). **`approval_policies` is NOT an E6 item — it is explicitly parked for re-decision AFTER D2 lands (post-Gate 3), because Steps 13–14 rewire the (outlet, role) grain it is keyed on.** | Second-opinion amendment (g) + owner ruling 2026-07-14 |
| E7 | **Frontend coverage clusters — separate remediation plan** (NOT v2 scope): the 78 orphaned endpoints (clinical/treatment 11, Shopify ops console 8, rentals asset layer 7, packages/prepaid 6, rooms group-booking 5, approvals 4 + dead `POSApprovalModal.jsx`, courier tracking 4, van reconciliation 2, workflow dead-ends incl. cycle-count completion) + public rental booking page + recipe-costing report tab. Step 6b freezes them as the registry-test baseline; the separate plan burns them down per-cluster, owner-prioritized. | AUDIT-FINDINGS §2 + §3 |
| E8 | Preset-specific operator roles (Restaurant Server, Receptionist, Clinician, Technician, Rental Agent, Front Desk) — the permission-wave roadmap item, not a defect | AUDIT-FINDINGS §4C |
| E9 | **Company-level module gating for the public QR/kiosk restaurant surface** (`routes/public-restaurant.js`). Step 9 gave `kioskOrderingOff()` the OUTLET half of the rule (`isModuleOffAtOutlet`, which by contract resolves `override ?? default ?? TRUE` and leaves company state "checked separately by the caller" — `feature-flags.js:306-315`). The caller never checks it, so disabling the Restaurant module company-wide does NOT stop an already-issued kiosk token from ordering. **Not a v2 regression — strictly an improvement**: on pre-slice `main` this surface had NO module gate at all (only `phase4_restaurant_day_parting`). Composing the company flag was deliberately left out of Step 9 because it changes behavior for tenants/tests that never touch per-outlet state, which is outside a step whose gate was "single-outlet tenants feel zero change". Fix = AND the company-level `restaurant` flag into `kioskOrderingOff` + a stale-token test. | Step 9 as-built note 4 (was named as "a follow-up" with no home until the Gate 2 ledger walk) |

---

## Audit-findings disposition table (AUDIT-FINDINGS.md, 2026-07-11) — the completeness contract

Every audit finding lands in exactly one place. Step 15 verify item (11) walks this table; an
unaccounted finding fails verification. **Bold** = Wave 0 (ships to main at Gate 0, before v2 branches).

| Finding | Disposition |
|---|---|
| S1 `pos_discount` not enforced | **Step W0a** (403 `DISCOUNT_NOT_PERMITTED` + all-call-paths inventory) |
| S2 outlet-conflict validation | Step 9 (shared validated resolver + fail-closed — was already planned) |
| S3 Field Rep over-reach | Step 2 (`execute_field_sales` split + migration + skip re-key) |
| S4 admin self-lockout | **Step W0a** (400 `CANNOT_REMOVE_LAST_ADMIN`) |
| S5 cost/data over-exposure via `view_reports` | Step 3 (data classification) + Step 4 (cost-free sales-only product reads) |
| C1 `GET /api/employees` needs `all_access` | **Step W0a** (relax to `manage_employees`) |
| C2 ~12 Manager-page `all_access` mutations | Step 3 pause (per-item rulings) → Step 4 (apply) |
| C3 dashboard infers Manager from `view_reports` | **Step W0b** (per-widget real-perm gating) |
| C4 default-role edits not durable | Step 4 named rule (also applied to Step 2's Field Rep change) |
| C5 custom roles labeled "Cashier" | **Step W0b** (backend `role_name`) |
| C6 `manage_employees` overloaded | Step 3 (inventory + split proposal) → Step 4 (apply) |
| C7 4 nav/route mismatches | **Step W0b** |
| C8 perm changes need reload + `roles_with_access` misreport | Step 14 (refresh) + Step 2 (Bucket C `permissions:[]` fill) |
| §3 P1 POS redirect replaces retail till | **Step W0b** (re-key on `pos_layout_mode`/preset + card copy + VERIFICATION.md erratum) |
| §3 onboarding proxies (`DashboardOnboarding.jsx`) | Step 11 (checklists REPLACE; proxies deleted) |
| §3 truthless flags (`phase4_restaurant_seats`, `receipt_designer_v2`, `phase4_contract_ai`) | Step 6b (wire-vs-retire ruling + execution) |
| §3 flag→runtime-consumer + capability→surface registry tests (systemic rec) | Step 6b |
| §3 public rental booking has no page | E7 (coverage plan) |
| §3 recipe-costing reports have no tab | E7 (coverage plan) |
| §2 coverage clusters (78 orphaned endpoints) | E7 — separate plan, explicitly OUT of v2; frozen as Step 6b's test baseline |
| §2 kiosk-login doc contradiction | **Step W0b** filed evidence (zero frontend callers; sole issuer of the `kiosk` JWT scope; mints a working credential from a 4-digit PIN; already archived "backend_only_by_design"). **RULED at Gate 1 prep 2026-07-12: REMOVE.** Execution DEFERRED to a dedicated post-Gate-1 commit (delete `POST /api/auth/kiosk-login` + `KioskLoginSchema` + the now-dead `kiosk`-scope branch in `tenant-auth.js`, and correct the root `CLAUDE.md` kiosk-login line) — kept OUT of the governance slice so it doesn't widen the auth-sensitive Gate 1 deploy. |
| §4C preset operator roles | E8 (roadmap, permission wave) |
| §4C unguarded-mutation trio (`billing/add-outlet`, `billing/create-checkout`, `commissions/calculate`) | Step 3 pause (ruling) → Step 4 (apply) |

**Rule for all future work (unchanged from v1)**: any new feature flag must be classified in `backend/config/business-modules.js`; any new permission string must be registered in `backend/config/permissions-catalog.js` — the CI tests enforce both.
