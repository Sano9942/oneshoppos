# Business Modules v2 — End-to-End Verification (PLAN-V2 Step 15)

> Fresh-context verification, 2026-07-15. Verifier did not build the wave; every claim below was
> re-derived from live behavior, fresh test runs, or read-only prod queries — implementation
> as-built notes are cited only where re-execution was impossible or redundant, and are tagged as
> such. Branch under test: `feat/business-modules-v2` @ `d3069123` (Steps 13–14, NOT merged);
> prod under test: `main` @ Gate 2 + D5-flip (all 29 tenants @ v136).

## VERDICT: **SHIP** — Gate 3 ready

Zero blocking findings. Every Step 15 matrix item passes; the v1 Step 10 regression matrix holds;
every audit finding is accounted for with live or fresh-suite evidence; prod read-only numbers are
exactly what the Gate 1/Gate 2 deploy records predict (including 0 outlet-override rows and 0
residual `view_reports` grants). The worst finding is **non-blocking doc staleness**
(`frontend/src/routes/CLAUDE.md:53` still describes a `view_reports` front-desk read — the perm no
longer exists) plus one **cross-feature behavior worth documenting in Step 16** (finding F-2 below).

### Evidence-type key

| Tag | Meaning |
|---|---|
| LIVE | Direct API probe against the running local stack (sanopos_dev, golv tenants), this session |
| SUITE | Fresh local test-suite run, this session (not a cited prior run) |
| BROWSER | Browser walkthrough on the local stack, this session (DOM/network evidence; the pane's screenshot action times out with overlays open — same documented limitation as Steps 10/11/14) |
| PROD-RO | Read-only SQL via Supabase MCP or unauthenticated prod HTTP probe, this session |
| RECORD | Prior step/gate as-built evidence, cited where re-execution adds nothing (each use justified inline) |

### Fresh test-run summary (this session)

| Run | Result |
|---|---|
| 12 v2 integration suites (`pg-step4-report-split`, `pg-mode-gates`, `pg-preset-engine`, `pg-step9-outlet-gating`, `pg-step13-outlet-roles`, `pg-business-modules-{toggle,read,outlet,checklist}`, `pg-migration-v136`, `pg-step12-outlet-copy-{settings,drift}`) | **153/153 pass** (first pass 120 + 28 skipped from 3 hook-timeout files — timeouts were CPU contention from the verifier's own concurrent vitest runs; all 3 files re-run in isolation = 33/33, incl. `pg-step13-outlet-roles` 20/20 and `pg-preset-engine` 8/8) |
| `pg-w0a-audit-security` (Wave-0 S1/S4/C1 matrix incl. line-level discount + promo-path) | **17/17 pass** |
| Backend units (`tests/unit`, 45 files) | **641/644** — the 3 fails are exactly the documented pre-existing set (`routes-admin-worker-status` ×2, payment-gateway `isEnabled`), individually re-confirmed |
| Frontend units (24 files) | **199/199** |
| Live API probes (7 scripted runs) | 49 distinct assertions, all pass after 6 probe-targeting corrections (each misfire traced to a wrong probe target, never to product behavior — details in the matrix) |

---

## 1) Step 15 matrix — per-item results

### (1) D7 — delegation permissions ✅

| Check | Result | Evidence |
|---|---|---|
| `manage_integrations`-only role reaches integrations hub | ✅ 200 | LIVE C1 (`GET /api/integrations/hub`) |
| …and 403s on `GET /api/roles` + `PUT /api/roles/:id/permissions` | ✅ 403/403 | LIVE C2, C3 |
| `manage_roles`-only role edits roles (GET 200, PUT perms 200) | ✅ | LIVE C4, C5 |
| …and 403s on integrations hub | ✅ 403 | LIVE C6 |
| Bogus permission string rejected | ✅ 400 | LIVE C7 |
| Catalog serves split perms, no `view_reports` | ✅ | LIVE C8 (`GET /api/permissions-catalog` as `manage_roles`-only) |

### (2) D4 — report-permission split ✅

| Check | Result | Evidence |
|---|---|---|
| Pristine Cashier → sales-only | ✅ | LIVE D1 (item-wise 200), D1br (accounting P&L 403), D1bi (shrinkage/inventory 403), D2 (team attendance 403); SUITE pg-step4 13/13 (both postures) |
| `my-status` self carve-out (POS shift gate) survives | ✅ 200 | LIVE D3 |
| Customized roles grandfathered with all splits | ✅ | SUITE pg-step4; PROD-RO: **0 roles hold a partial split set** (any role with `view_financial_reports` also holds hr/inventory/customer) |
| Fresh-provisioned Cashier sales-only | ✅ | SUITE pg-preset-engine (fresh provision per preset family) |
| Dashboard works for Cashier (filtered) | ✅ | SUITE pg-step4 (permission-filtered dashboard response); RECORD Gate-1 browser check |
| S5 — no cost fields for sales-only token; POS reads intact | ✅ | LIVE D4 (`GET /api/products` zero `cost_price`/`component_cost` keys) vs D5 (owner keeps them) |
| Zero `view_reports` consumers | ✅ | Fresh grep: backend hits only in `migrate-pg.js` (migration), comments (`permissions.js:42`, `tenant-provisioner-pg.js:27`, `permissions-catalog.js:99`), and the step-4 test; frontend hits only a comment in `DashboardRedesign.jsx` + one stale doc line (finding F-1) |
| Role editor shows split perms | ✅ | LIVE C8 catalog payload |
| Prod classification correct on every real tenant | ✅ | PROD-RO: 0 `view_reports` rows across 29 tenants; 29/29 Cashier roles hold `view_sales_reports`; 0 Cashiers hold financial/HR; all 7 appointments-mode tenants' Cashiers hold `view_customer_reports`, 0 others do |

### (3) D5 — mode normalization + fail-closed ✅

| Check | Result | Evidence |
|---|---|---|
| Every tenant fully materialized | ✅ | PROD-RO 29/29 at 10/10 mode rows; local golv tenants @ v137 |
| Explicit-false mode 403s (not `MODES_NOT_SEEDED`) | ✅ | LIVE F1r (`GET /api/rental-items` on retail → 403 `mode:"rentals"`) |
| Fresh tenant per preset family works immediately | ✅ | SUITE pg-preset-engine 8/8 (retail / restaurant / dental_clinic all 10 rows, correct enabled set) |
| Empty-map path per owner variant (`MODES_NOT_SEEDED`, distinct from mode-off) | ✅ | SUITE pg-mode-gates 5/5 (fail-closed pinned + distinct-code case a2); RECORD D5-flip deploy: prod blast radius 0/29, Sentry clean |

### (4) D3 — sub-toggle polish ✅

| Check | Result | Evidence |
|---|---|---|
| Customize expander on >3 sub_toggles | ✅ | BROWSER: Wholesale card renders "Customize (4)", expands to 4 sub-toggles with merchant descriptions |
| Descriptions on every sub_toggle | ✅ | BROWSER (expanded card shows per-toggle descriptions); backend catalog unit tests fresh-green |
| Parent-off disabled state + tooltip | ✅ | BROWSER: 7 disabled sub-toggle switches on off cards; DOM contains "Enable Appointments & Booking first", "Enable Rentals first", "Enable Rooms & Lodging first", "Enable Clinical / Treatment Plans first", "Enable Wholesale / B2B Credit first" |
| skipped_restores toast + saved_flags round-trip | ✅ | SUITE pg-business-modules-toggle (saved_flags snapshot/restore incl. skipped_restores payload); RECORD Step 6 browser walkthrough for the toast rendering (presentation-only; payload proven fresh) |

### (5) D6 — setup checklists ✅

| Check | Result | Evidence |
|---|---|---|
| Restaurant tenant `attention_required` with open required item | ✅ | LIVE A1b (golv_cafe: `state=attention_required`, checklist `floor_plan:open, menu_items:done, kds_station:done`); BROWSER "Attention" chip + "Get started — 2 of 3 done" |
| Floor plan at outlet A completes A, NOT B | ✅ | SUITE pg-business-modules-checklist (two-outlet independence proof) |
| Optional items never hold the state | ✅ | SUITE (checklist unit + integration); LIVE: kds_station done+optional does not affect state derivation |
| Deep-links land; scope labels correct | ✅ | BROWSER: expander rows show "· all locations" / "· optional" labels and a "Set up →" only on the incomplete item; route targets verified against `appRoutes.jsx` in the Step 11 table (RECORD) |
| Onboarding proxies replaced, not paralleled | ✅ | Fresh grep: `DashboardOnboarding.jsx` sources done-ness from `CHECKLIST_STEP_SOURCE`; membership/room-count/any-contract proxies deleted (only removal comments remain) |

### (6) D1 — per-outlet module activation ✅

| Check | Result | Evidence |
|---|---|---|
| Override off at B → B blocked `outlet_scoped:true`, A works | ✅ | LIVE A2/A3 (403 body `{mode:"restaurant", outlet_scoped:true, outlet_id:2}`) + A10 (enabled outlet 200); note: initial "A4 fail" was the probe hitting Main, which carries a REAL pre-existing local override — the 403 there was the gate being right |
| Dormant overrides persist | ✅ | LIVE: golv_cafe's Step-12-era overrides (Main+Airport off) still present and enforced months of sessions later; SUITE pg-business-modules-outlet (company off/on dormancy case) |
| Company-off wins everywhere; re-enable restores overrides dormant | ✅ | SUITE pg-business-modules-outlet |
| `default_outlet_enabled:false` gates unlisted outlets; sparse row = TRUE | ✅ | SUITE pg-business-modules-outlet + pg-migration-v136 |
| No-header + `oid:null` → `OUTLET_CONTEXT_REQUIRED` on operational routes | ✅ | SUITE pg-step9-outlet-gating 22/22 (oid:null fail-closed vs all_access company fallback) |
| Malformed / foreign outlet ids rejected | ✅ | LIVE A5 (`abc` → 400 `INVALID_OUTLET_CONTEXT`), A6 (999 → 403 same code, no existence leak) |
| Hybrid card outlet-op → 409 `TENANT_SCOPED` | ✅ | LIVE A7 (shopify); device card too: A8 (pos_addons) |
| Single-outlet tenant payload byte-identical to v1 | ✅ | LIVE F3 (golv_general_retail: 49 cards, 0 `outlets[]`, 0 `checklist`, top keys `industry_type,outlet_count,modules`); SUITE byte-compat test |
| Workers process only enabled outlets | ✅ | SUITE pg-step9 (getDisabledOutletIds matrix + hold-expiry/reservation-reminder/booking-reminders/rental-overdue two-outlet worker tests — the remaining filtered workers share the identical helper mechanics) |
| Matrix Drawer + defaults control round-trip | ✅ | BROWSER: drawer rows Main=Override/Reset, Downtown=Inherited, Airport=Override/Reset + "New locations — When you add a location, Restaurant starts On there", exactly matching the API state; write round-trip proven LIVE at the API (A2→A9→A10 override/reset/restore). The drawer renders in a portal the pane's a11y tree misses, so the in-drawer click was not re-executed here — the identical click path is RECORD (Step 10 + Gate 2 browser walks) |
| `manage_outlet_modules`-only role drives matrix, not company toggles | ✅ | SUITE pg-business-modules-outlet perm matrix + unit blanket-rule tests; RECORD Step 10 browser matrix (delegate: GET 200 / outlet-toggle 200 / company toggle 403 + tooltip) |
| Locks block enable-direction overrides AND default flips | ✅ | SUITE pg-business-modules-outlet lock cases |
| GET query-count assertion | ✅ | SUITE (Step 8 query-budget test, fresh-green in pg-business-modules-outlet run) |

### (7) D8 — copy settings from ✅

| Check | Result | Evidence |
|---|---|---|
| Copied outlet matches source module overrides; uncopied inherits clean | ✅ | SUITE pg-step12-outlet-copy-settings 17/17 |
| Atomicity under induced failure | ✅ | SUITE: trigger-`RAISE` mid-clone → no orphan outlet (test at :331) |
| 5 ruled COPY tables copy; 7 NEVER tables provably stay empty | ✅ | SUITE (explicit NEVER-tables-empty assertion); COPY_SPECS column-classification drift test negative-tested (pg-step12-outlet-copy-drift) |
| Phase 2 ruling implemented or E6-deferred | ✅ | Ruling table in PLAN-V2 Step 12 as-built: 5 COPY shipped (`ae897d25`), 7 NEVER enforced, `modifier_groups`→E6, `approval_policies`→ parked for after-D2 re-decision (explicitly NOT E6) |

### (8) D2 — per-outlet roles ✅

| Check | Result | Evidence |
|---|---|---|
| Cashier-base + Manager@B: B 200, A/C 403, bootstrap exposes base+effective | ✅ | LIVE B4–B7 (`purchase-orders` 403@1, 200@2, 403@3; bootstrap `base=3 eff=2 "Manager"`) |
| **Reverse**: Manager-base + Cashier@B: B restricted, others Manager | ✅ | LIVE B10/B11 (200@1, 403@2 — restricting override holds on the same live token) |
| Header-omission does NOT restore Manager on operational routes | ✅ | SUITE pg-step13-outlet-roles 20/20 (fail-closed interplay cases) — not re-probed live because minting an `oid:null` token requires the context-switch re-mint flow; the suite drives it directly |
| Context switch updates session in place from bootstrap | ✅ | BROWSER: ContextSwitcher Airport→Downtown flipped cached `phase4_restaurant` effective false→true without reload (same applier path as perms); RECORD Step 14 two-direction nav audit (28-perm Manager nav appearing/collapsing in place) |
| Role deletion degrades override to inherit (SET NULL) | ✅ | LIVE B12–B15 (delete override role → `role_id:null` on the assignment row) |
| Zero-override tenants untouched | ✅ | SUITE: 153/153 across the batch incl. every v1 business-modules suite; Step 13's stash-proven zero-new-failures regression gate (RECORD) for the wider ~57-baseline diff |
| JWT shape unchanged | ✅ | LIVE B3 (decoded payload exactly `{tid,eid,rid,oid,scope,jti,iat,exp}`, rid = base role) |
| Base role truth is the DB row, not the JWT rid (finding #6 fix) | ✅ | LIVE B8/B10: base-role flip Cashier→Manager applied to an ALREADY-ISSUED token on the next request |

### (9) v1 Step 10 regression matrix (15 items) ✅

| # | v1 item | Result | Evidence |
|---|---|---|---|
| 1 | Restaurant enable: atomic mode+flags, nav in place, POS layout unchanged | ✅ | SUITE pg-business-modules-toggle; P1 keying now industry-based — BROWSER both directions (below) |
| 2 | Disable with open data → warn+confirm counts; workers skip | ✅ | SUITE toggle+impact; worker gating SUITE pg-step9 |
| 3 | Re-enable → data visible | ✅ | SUITE toggle |
| 4 | saved_flags round-trip | ✅ | SUITE toggle (snapshot → restore → clear; repeated-disable keeps snapshot) |
| 5 | Bucket C never bare-enables; FBR launches config | ✅ | SUITE read/toggle; BROWSER "Needs setup"+"Set up" on Couriers/SMS/Aggregators |
| 6 | Platform lock blocks enable, greyed card | ✅ | SUITE toggle lock cases + outlet lock cases |
| 7 | depends_on both directions + enable preview | ✅ | SUITE toggle; BROWSER "Requires Restaurant" on Delivery Aggregators |
| 8 | Modeless-tenant first-mode backfill | ✅ | SUITE toggle case (a) — explicitly clears `tenant_modes` to re-create the modeless state post-D5 |
| 9 | Bucket D unreachable via new endpoints | ✅ | SUITE read |
| 10 | Legacy PUT: module flag 409, sub_toggle + Bucket D accepted | ✅ | LIVE E5 (`phase4_rentals` → 409 `MANAGED_BY_BUSINESS_MODULES`), E6r (`phase2_item_suggestions` → 200), E7 (`notifications` → 200); bundle flags also 409 (probe on `phase4_restaurant_kds` confirmed bundle-flag rejection) |
| 11 | action_history audit rows | ✅ | SUITE toggle/outlet/copy suites assert audit rows |
| 12 | Non-admin: no page, 403s; `manage_business_modules` can toggle | ✅ | SUITE v1 perm matrix (fresh in batch); LIVE neighborhood: delegation-perm probes C1–C6 |
| 13 | Role editor catalog; bogus string 400; guarded role GETs 403 non-holders | ✅ | LIVE C7 (400), C2 (403 for non-`manage_roles`), C8 (catalog) |
| 14 | roles_with_access shown; toggles write nothing to role_permissions | ✅ | BROWSER "Staff access:" lines; SUITE toggle assertion; RECORD Step 14 zero-diff proof across override assignment |
| 15 | Expired-tenant PUT blocked | ✅ | RECORD v1 VERIFICATION item 15 + `requireActiveSubscription` chain position untouched by v2 (verified by grep — no v2 commit touches plan-limits/subscription middleware) |

### (10) Prod read-only numbers (Supabase MCP, SELECT only) ✅

| Metric | Value | Expectation |
|---|---|---|
| Active tenants | 29 | 29 ✓ |
| schema_version | 136 on 29/29 (min=max) | v136 everywhere ✓ |
| `tenant_modes` rows | 10/10 on 29/29 | full materialization ✓ |
| `outlet_business_modules` rows (total) | **0** | Gate-2 migration inert ✓ |
| `tenant_business_modules.default_outlet_enabled` column | present 29/29 | v136 objects ✓ |
| Residual `view_reports` grants | **0** | D4 complete ✓ |
| Cashier roles with `view_sales_reports` | 29/29 | pristine posture ✓ |
| Cashier roles with financial/HR splits | 0 | ✓ |
| Appointments-mode tenants: Cashier + `view_customer_reports` | 7/7 (0 non-appointments tenants have it) | §8 #2 ruling ✓ |
| Roles with a PARTIAL split set | 0 | grandfather completeness ✓ |
| Field Rep roles with `execute_field_sales` | 6/6 tenants that have the role | S3 ✓ |
| Multi-outlet tenants (store outlets > 1) | 1 (`livetest1`, a test tenant) | no real customer sees per-outlet UI ✓ |
| **Gate-3 preconditions** | `employee_outlets` present 29/29; `employee_outlets.role_id` absent 29/29 (v137 pending); `roles` present (queried) | v137 will apply cleanly, lands inert ✓ |
| `POST /api/auth/kiosk-login` on prod | 404 | removal deployed ✓ |

### (11) Audit-disposition sweep — every finding accounted ✅

| Finding | Disposition | Step-15 evidence |
|---|---|---|
| S1 `pos_discount` | W0a | **LIVE**: order-level discount from a role without `pos_discount` → 403 `DISCOUNT_NOT_PERMITTED` on the running stack (reached through the shift + clock-in + server-price gates — the discount gate sits behind POS operational gates by design); line-level + promo-path + with-perm cases: SUITE pg-w0a 17/17 fresh (live line-level probe was blocked by zero stock at the probe outlet, not by gate order) |
| S2 outlet-conflict validation | Step 9 | LIVE A5/A6 + SUITE pg-step9 22/22 |
| S3 Field Rep over-reach | Step 2 | PROD-RO 6/6 `execute_field_sales`; catalog drift units fresh |
| S4 admin self-lockout | W0a | LIVE E1: stripping `all_access` from the last admin role → 400 `CANNOT_REMOVE_LAST_ADMIN` |
| S5 cost over-exposure | Steps 3–4 | LIVE D4/D5 |
| C1 employees guard | W0a | LIVE E2 (Cashier 403) / E3 (holder 200) |
| C2 Manager-page mutations (12 rulings) | Steps 3–4 | SUITE pg-step4 + ratification record (REPORT-PERMS header); Gate-1 COD-approve **revert to all_access** documented at REPORT-PERMS §9 #8 + `fulfillment.js` comment (RECORD, verified at Gate 2 walk) |
| C3 dashboard role inference | W0b | Fresh grep (inference removed, comment remains) + SUITE dashboard filtering; RECORD W0b browser |
| C4 default-role durability rule | Step 4 | Fresh grep: `view_reports` absent from `DEFAULT_ROLE_PERMISSIONS` (comment only) |
| C5 hardcoded role labels | W0b | BROWSER: account drawer shows backend `role_name` ("Administrator") |
| C6 `manage_employees` overload | Steps 3–4 | LIVE D1br (accounting 403 without `manage_finance`/financial split); catalog units fresh (perms registered) |
| C7 nav/route mismatches (4 pages) | W0b | RECORD W0b + frontend units fresh 199/199 (nav-config tests included) |
| C8 perm-refresh + roles_with_access | Step 14 + Step 2 | BROWSER "Staff access:" populated on Bucket C cards; LIVE B7 bootstrap effective-identity; BROWSER in-place effective-flag refresh on context switch; RECORD Step 14 C8 semantics note |
| §3 P1 POS redirect | W0b | **BROWSER both directions on one tenant**: golv_cafe (industry `cafe`) lands `/pos/restaurant` where Restaurant is effective-ON (Downtown) and keeps the RETAIL till where an outlet override turns Restaurant off (Airport) — see finding F-2; retail-tenant direction: RECORD Gate-0 prod spot-check (golv_general_retail kept retail till with module enabled) |
| §3 onboarding proxies | Step 11 | Fresh grep: proxies deleted, `CHECKLIST_STEP_SOURCE` reads the checklist payload |
| §3 truthless flags | Step 6b | RECORD Gate-1 (6 flags retired, `receipt_designer_v2` wired); flag→consumer drift unit fresh-green in 641 |
| §3 registry drift tests | Step 6b | SUITE: both drift tests in the fresh 641/644 unit run |
| §3 public rental booking page / recipe-costing tab | E7 | Rows present in the Deferred-to-v3 table ✓ |
| §2 78-endpoint coverage clusters | E7 | Row present; frozen baseline test fresh-green ✓ |
| §2 kiosk-login | RULED REMOVE, shipped separately | PROD-RO: `POST /api/auth/kiosk-login` → 404 |
| §4C preset operator roles | E8 | Row present ✓ |
| §4C unguarded trio | Steps 3–4 | SUITE pg-step4 (guards applied per ruling) |

**Unaccounted findings: none.**

---

## 2) Findings (all non-blocking)

- **F-1 (docs, trivial)**: `frontend/src/routes/CLAUDE.md:53` still says "front desk with `view_reports` can read" — the permission no longer exists. Fold into Step 16's docs sweep.
- **F-2 (document, don't change)**: on a restaurant-industry tenant, an outlet where the Restaurant module is override-OFF gets the **retail till** at `/pos` (outlet-effective `phase4_restaurant=false` fails POSRoute's flag check). This is the designed D1×P1 composition — module off at a location means restaurant surfaces off at that location — but it's a behavior a merchant may report as a bug ("my Airport branch lost the restaurant POS"). Step 16 should state it in the docs/card copy; no code change recommended.
- **F-3 (verification environment, for future verifiers)**: three integration files hook-timeout (10s) when other vitest processes run concurrently on this machine — run the batch alone before reading failures as real. Same session re-confirmed the Step 10/11/14 browser-pane limitation: screenshots time out with a Drawer/dropdown overlay open, and portal-rendered Drawers are invisible to the a11y tree (DOM queries still work).
- **F-4 (local-state hygiene, no action needed)**: local `golv_cafe` retains its deliberately-unreverted multi-outlet state (Downtown/Airport outlets, restaurant overrides at Main+Airport, Step 14's "Ovr Test" employee with a Cashier override at Downtown). This made it an ideal live fixture — the dormant overrides are real months-old rows, freshly enforced — but anyone expecting a pristine single-outlet cafe locally will be surprised. All Step-15 probe artifacts (7 temp employees, 4 temp roles, 1 shift, attendance sessions) were verified deleted; the tenant is back to its pre-Step-15 baseline.

## 3) Method notes

- Live probes ran 7 scripted rounds against the running dev stack; every intermediate "FAIL" was
  re-derived and each traced to a probe-targeting error, never to the product: Main-outlet 403 =
  a real dormant override (the gate being right); `cash-flow` 200 for Cashier = the RATIFIED
  mapping (`view_sales_reports`, "cashiers close shifts"); `phase4_restaurant_kds` 409 = correct
  bundle-flag lockdown (it is not a sub_toggle); `/api/rentals` 404 = the routes live at
  `/api/rental-items`; sales-POST 400s = the shift → clock-in → server-price gate ladder in front
  of the discount gate.
- No prod writes of any kind. Prod evidence is SELECT-only SQL plus one unauthenticated HTTP 404
  probe. The Wave-0 behavioral re-verifications ran against the local stack (whose code equals the
  deployed main for those paths — Wave 0 merged pre-Gate-1) because exercising them on prod would
  require creating roles/employees on real tenants.
- The "fresh signup per preset family" requirement is discharged by `pg-preset-engine` (mounts the
  REAL setup router; asserts full mode rows + correct enabled sets for retail, restaurant, and
  clinic families) — the same suite the D5-flip precondition work validated against a real prod
  provision on 2026-07-15.
