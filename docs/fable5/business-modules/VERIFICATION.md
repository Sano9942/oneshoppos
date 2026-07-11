# Business Modules — Step 10 End-to-End Verification

> Fresh-context verifier run, 2026-07-11. Verifier did NOT build the feature; every claim below is
> observed live behavior, not implementation notes. Branch `feat/business-modules` @ `7c9ee39f`
> (backend dev server confirmed started AFTER the last code commit — serving current branch code).
>
> Stack: local Postgres `sanopos_dev` (48 tenant schemas, migration head v131), backend :5000,
> frontend :5173 (Vite). Test tenants: `golv_general_retail` (general_retail preset, modeless) and
> `golv_restaurant` (restaurant preset). Prod checks were READ-ONLY SELECTs via Supabase MCP —
> zero writes to prod. Both local tenants were restored to their exact pre-test snapshots
> afterwards (diff-verified empty), seeded test data/locks/employees/roles removed.

## VERDICT: **SHIP** (with two copy/doc-level notes, no functional fails)

All 15 matrix items pass functionally. Worst finding: **the disable-confirm dialog says
"Will also turn off: Delivery Aggregators" but the toggle deliberately does NOT turn the Bucket C
dependent off** — it returns it as `left_connected` (flag stays on, warning toast after the fact).
The behavior is the owner-approved Step 6 as-built decision (#4); the pre-confirm copy overstates
it. Cosmetic, one string. Second note: the matrix's item-10 wording ("rejects … a Bucket D flag")
does not match the ratified Step 2/6 contract (Bucket D = UNMANAGED stays writable via legacy PUT);
live behavior follows the contract, the matrix sentence is stale.

## Matrix results

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Retail tenant enables Restaurant → mode+13 flags atomic, nav in-place, restaurant API 200, POS layout unchanged | **PASS** | UI toggle on `golv_general_retail` → confirm dialog → single `POST /api/business-modules/restaurant/toggle` 200. DB after: `tenant_modes.restaurant=t` + all 13 bundle flags `t` (one action-history row lists all 13). Nav gained "Restaurant" group in-place, no logout (also gained "Rentals" from the item-8 drifted flag — consistent). `GET /api/restaurant/floor-plans` 200, `/api/kds/stations` 200. `GET /api/context/bootstrap` still `pos_layout_mode:"grid"`, `industry:general_retail` — till not reskinned. |
| 2 | Disable with open tab → warn+confirm with count, data intact, workers skip tenant | **PASS** | Seeded `restaurant_tabs` row (`status='open'`) on `golv_restaurant`. Disable dialog showed **"Open tabs: 1"** + "Will also turn off: Delivery Aggregators" + hide-not-delete copy. After confirm: all 13 flags `f`, `tenant_modes.restaurant` **enabled=false, row NOT deleted**, tab row intact, `saved_flags` snapshot written (all 13 keys true). Restaurant API → 403 `Mode not enabled: restaurant`. **Worker poll** (manual invocation of `kds-load-snapshot-worker-boss.snapshotForTenant` with an active `kds_stations` row): inserts **1** with module ON (baseline) → **0** with module OFF. |
| 3 | Re-enable → old data visible again | **PASS** | UI re-enable: 13 flags restored `t` from snapshot, mode `t`, `floor-plans` 200, seeded open tab still present. |
| 4 | saved_flags round-trip in UI (sub-toggle off → disable → re-enable → still off) | **PASS** | Appointments card on `golv_restaurant`: enable restored prior snapshot exactly (classes ON, waitlists/resources OFF — not blanket defaults). Turned classes OFF → disabled module (DB snapshot showed `phase4_appointments_classes:false`) → re-enabled → classes sub-toggle still `aria-checked=false` in UI and `f` in DB. |
| 5 | Bucket C never bare-enables; FBR card launches `/settings/fbr` | **PASS** | `POST .../fbr_digital_invoicing/toggle` → 409 `REQUIRES_SETUP` + `setup_route:"/settings/fbr"`; same for `marketplace_channels`. UI card has NO toggle, only "Set up" button + "Needs setup" badge; clicking it navigated to `/settings/fbr` ("FBR Settings" page). |
| 6 | Platform lock blocks enable, greyed card | **PASS** | Seeded global `public.platform_module_locks` row for `holds_layaway`. UI card: "Locked" badge, "This module is locked for your account. Contact support to enable it.", switch `disabled=true`. API enable → 403 `MODULE_LOCKED`; disable → 200 (always allowed). Lock row removed after. |
| 7 | depends_on both directions; enable-preview names prerequisites BEFORE the POST | **PASS** | API: `GET .../wholesale_van_sales/impact?direction=enable` → `prerequisites:[field_sales]`; enable → `also_enabled:["field_sales"]`; `POST .../field_sales/toggle {enabled:false}` → 409 `HAS_ENABLED_DEPENDENTS` naming `wholesale_van_sales`; with `{cascade:true}` → 200, `cascaded:[wholesale_van_sales]` (own snapshot written). UI: Van Sales click → network shows ONLY the impact GET, dialog "Will also enable: Field Sales (Mobile Reps)", POST fires only after confirm; both toggles then on. |
| 8 | Modeless-tenant first-mode backfill (drifted flag seeded first) | **PASS** | Seeded `phase4_rentals=t` with zero `tenant_modes` rows on `golv_general_retail`. Enabling Restaurant (first-ever mode write) backfilled `tenant_modes.rentals=t` in the same transaction; audit row literally says "modes backfilled: rentals". No 403s on any surface after. |
| 9 | Bucket D flags unreachable via new endpoints | **PASS** | `multi_company`, `notifications`, `phase4_restaurant_preauth`, `context_selection_required`, and an unknown key each → 404 "Unknown module" on BOTH `/impact` and `/toggle`. |
| 10 | Legacy PUT lockdown | **PASS** (see note) | `PUT /api/feature-flags/phase4_rentals` (module primary) → 409 `MANAGED_BY_BUSINESS_MODULES` (module_key rentals); `phase4_restaurant_kds` (bundle) → 409; `marketplace_integrations` (Bucket C primary) → 409; `phase2g_omni_input` (bundle flag of pos_addons) → 409; **sub_toggles** `phase2_pos_layouts` and `phase4_appointments_classes` → 200 (still writable). `multi_company` (Bucket D/UNMANAGED) → **200 accepted** — this matches the ratified Step 2 contract + Step 6 as-built note #2 (UNMANAGED stays writable), but contradicts the matrix's literal wording. Behavior correct per owner-approved design; matrix sentence stale. |
| 11 | action_history rows present | **PASS** | One `business_module_toggle` row per toggle with actor ("Owner"), direction, cascade/backfill info, and the full flags-changed list — verified on both tenants. |
| 12 | Non-admin: no page + 403s; custom `manage_business_modules`-only role CAN toggle | **PASS** | Cashier (fresh employee, role 3): nav has no "Business Modules" entry; direct URL `/settings/business-modules` redirects to `/dashboard`; API GET/POST → 403. Custom role `ModuleMgrVerif` with ONLY `manage_business_modules`: GET 200, toggle on/off 200; cannot edit role permissions (403 — no escalation path). |
| 13 | Role editor full catalog; bogus perm rejected; role GETs guarded | **PASS** | Role editor renders the full 29-permission catalog in 12 category groups (System/Inventory/Orders/Customers/Reporting/POS/Overrides/Restaurant/Services/Retail/Wholesale) incl. all previously-missing perms (manage_rentals, manage_rooms, override_price, …). `PUT /api/roles/:id/permissions` with `totally_bogus_perm` → 400 listing the unknown string. Cashier: `GET /api/roles` → 403; `GET /api/roles/1/permissions` (other role) → 403; own role → 200 (self-or-admin guard, required by AuthProvider boot — per Step 7 as-built). |
| 14 | Enable confirm shows staff roles; toggles write nothing to `role_permissions` | **PASS** | Both enable dialogs showed "Staff roles that will gain access: Administrator, Manager" (Restaurant, Appointments). `role_permissions` for roles 1–3 byte-identical before/after the full session's toggles on both tenants (diff empty). |
| 15 | Expired paid tenant blocked | **PASS** | `golv_restaurant` temporarily set `plan=pro, payment_status=expired`: GET (read) 200, toggle POST → 403 `SUBSCRIPTION_EXPIRED` with message + `billing_url:"/billing"` — acceptable UX (reads work, writes blocked with a clear next step). Restored after. |

### Prod read-only drift check (Supabase MCP, SELECT-only)

Checked all **29 active prod tenants**: flags among the 10 mode-primary pairs
(`phase4_restaurant`, `phase4_appointments`, `subscription_billing`, `phase4_rentals`,
`phase4_room_management`, `phase4_treatment_plans`, `phase4_workflow_tickets`,
`phase4_service_projects`, `phase2_commissions`, `wholesale_credit_controls`) that are enabled
WITHOUT their `tenant_modes` row.

- **Drifted tenants: 0 of 29.** No tenant has a mode-linked flag on without its mode row.
- **Modeless tenants (in `requireMode` fall-through today): 8** — `golv_butcher`,
  `golv_general_retail`, `golv_grocery`, `golv_sweet_shop`, `golv_textile`,
  `grocerywalktest1778451`, `livetest1`, `livetestauto`. These will cross the empty→enforcing
  transition on their first module enable — safely, since their drift count is zero; the Step 6
  backfill currently has **nothing to repair in prod** but remains the right guard for future drift.

## Findings (none blocking)

1. **Copy vs behavior on Bucket C dependents (should-fix, one string)**: the disable-confirm
   dialog lists Bucket C dependents under "Will also turn off: …", but the toggle intentionally
   leaves them connected (`left_connected` in the response; Step 6 as-built #4 — a C card can't be
   re-enabled by toggle, so zeroing it would be un-undoable). The post-toggle warning toast covers
   it after the fact; the pre-confirm line should say something like "stays connected — disconnect
   from its setup page" instead of "will also turn off". Frontend-only, `BusinessModulesRedesign.jsx`
   dialog copy.
2. **Matrix wording drift (doc-only)**: PLAN.md Step 10 item 10 says the legacy PUT "rejects …
   a Bucket D flag". Live behavior (and the ratified Step 2/6 contract) keeps Bucket D = UNMANAGED
   keys writable via the legacy PUT (`multi_company` → 200). No code change wanted; the matrix
   sentence should be aligned with the as-built contract at Step 11.
3. **Pre-existing, out of scope**: `POST /api/roles` on a seeded tenant fails with a misleading
   400 "Role name already exists" because the `roles` serial sequence was never advanced past the
   provisioner's explicit ids (the known SERIAL-pkey seed trap — any pkey violation hits the
   `err.constraint` branch). Reproduced on `golv_restaurant`; worked after a local
   `setval`. Not introduced by this branch — but "Add Role" in the new role editor will hit it on
   seeded tenants. Worth its own small fix later.
4. Observations, working as designed: enabling a module whose card has no extra roles and no deps
   (Wholesale/B2B Credit) skips the confirm dialog (as-built trigger rule #3); a bare sub-toggle
   disable with no dependents shows no dialog; `GET /api/business-modules` returns 50 modules
   (11 A + 30 B + 9 C) and 401s without a token; browser console clean throughout the walkthrough.

## Cleanup / restore confirmation

- `golv_general_retail`: tenant_modes emptied (back to modeless), seeded `phase4_rentals` +
  13 restaurant flag rows removed, `tenant_business_modules` emptied — **diff vs pre-test
  snapshot: empty**.
- `golv_restaurant`: modes (`restaurant=t`, `appointments=f`, `wholesale=f`), all flag rows, and
  all 5 `tenant_business_modules` rows restored to snapshot values — **diffs empty**; seeded open
  tab, KDS snapshot row, test employees (`VerifCashier`, `VerifModuleMgr`), test role
  (`ModuleMgrVerif`) all deleted.
- `public.platform_module_locks`: verifier lock removed (0 rows).
- `public.tenants`: `golv_restaurant` and `claimauditrestaurant` back to `free/active`.
- Prod: untouched (read-only SELECTs only).
- Audit rows in `action_history` from the test toggles were left in place (append-only audit trail).

## ERRATUM (2026-07-12, Wave 0 W0b)

**Matrix item 1's "POS layout unchanged / till not reskinned" PASS was a verification miss.**
The verifier checked the bootstrap payload (`pos_layout_mode:"grid"`, `industry:general_retail`
unchanged — true) but never navigated to `/pos` itself. `POSRoute.jsx` keyed its redirect on
`hasMode("restaurant") && flags.phase4_restaurant`, and `enabled_modes` comes from `tenant_modes`
— which the module toggle writes. So a retail tenant that enabled the Restaurant module WAS
silently redirected to `/pos/restaurant`, contradicting the gate-only decision and the shipped
card copy ("keeps your current POS layout"). Found by the PLAN-V2 audit (§3, P1); fixed in Wave 0
W0b by re-keying the redirect on the preset `industry_type` (`restaurant`/`cafe`) — verified
against all local golv_*/claimaudit* tenants and prod (read-only): every `phase4_restaurant`
tenant is industry restaurant|cafe. The card copy needed no change — the fix makes it true.
