# Wave 0 (W0b) — Frontend Correctness Fixes: Verification Report

Branch: `fix/audit-wave0` · Date: 2026-07-12 · Spec: PLAN-V2.md Step W0b (AUDIT §3 P1 + §4B C3/C5/C7)

## P1 — POS redirect keyed on industry, not tenant_modes

**Data check (required before re-keying):** all 48 local tenants (golv_* + claimaudit*) plus prod
(read-only Supabase SELECTs) show the same invariant — every tenant with `phase4_restaurant=true`
+ mode `restaurant` has `industry_type ∈ {restaurant, cafe}` (`golv_restaurant`, `golv_cafe`,
`claimauditrestaurant`, `claimauditcafe`, prod `cafetestphase8`, `sanoposlivetest1778021564659`),
and no other industry carries the flag. `pos_layout_mode` was rejected as the key — it does NOT
discriminate (restaurant="list" but so are salon/clinic/gym/rentals; cafe="counter").
`industry_type` comes from `company_profile` via the preset bootstrap and only changes via the
wizard / an explicit industry change — the module toggle never touches it.

**Fix:** `POSRoute.jsx` now redirects on `industry_type ∈ {restaurant, cafe} && flags.phase4_restaurant`
(previously `hasMode("restaurant")`, which the Business-Modules toggle also sets). Flag check
retained so a restaurant that disables its Restaurant module falls back to the retail till.

**Browser proof (local dev servers on the fix branch):**
- `golv_restaurant` (industry restaurant): `/pos` → **redirects to `/pos/restaurant`** ✓
- `golv_general_retail` (industry general_retail) with the Restaurant module **enabled via
  `POST /api/business-modules/restaurant/toggle`** (all 13 flags on + mode row written):
  `/pos` → **stays on `/pos` and renders the retail till** (cart, F-key bar, park/hold) ✓
- Module then disabled and the tenant restored to its exact pre-test state (0 tenant_modes,
  0 tenant_business_modules, 0 phase4_restaurant% flag rows — verified counts).

**Card copy:** `config/business-modules.js` Restaurant card already says "enabling this on a
non-restaurant business keeps your current POS layout — the till itself is not reskinned."
That copy was FALSE before this fix and is TRUE after it — no copy change needed.

**Erratum filed** in v1 `VERIFICATION.md`: matrix item 1's "POS layout unchanged" PASS checked the
bootstrap payload but never navigated `/pos` — a verification miss.

## C3 — Dashboard: permission gating, no role inference

`DashboardRedesign.jsx` no longer derives `isManager` from `view_reports`. Widget gates now:
- **all_access**: PlanUsageBanner, MultiOutletEnabledBanner, FBRPromptBanner, DashboardOnboarding
  (their pages + `/api/billing/*` are all_access), BackupStatusCard (already was).
- **view_reports**: InsightCards, KPI cards (full view), retail merchant cards, wholesale A/R,
  outlet ranking, exceptions/risk, trends, contribution, top products, inventory alerts, team
  attendance. NOTE: default Cashier holds `view_reports` (and can already open `/reports`), so
  Cashiers now see report widgets — permission-honest; PLAN-V2 Step 4 re-sweeps when
  `view_reports` splits.
- **manage_field_sales**: FieldSummaryCards (matches `routes/field.js` guard).
- **DashboardQuickActions** is perm-driven per shortcut: POS (all), Reports + Cash Management
  (`view_reports`), Add Product (`manage_inventory`), Employees (`all_access`).

**Browser proof:** Cashier (role 3) on `golv_general_retail`: dashboard shows NO plan-usage /
onboarding / FBR / multi-outlet banners and no backup card; quick actions = Open POS, Reports,
Cash Management only (no Add Product, no Employees); report widgets present per its real
`view_reports` perm.

## C5 — Account drawer shows the backend role name

- Backend: `role_name` added to the `employee` payload of `/api/auth/login`, `/api/auth/mt-login`
  (roles join added), and `/api/auth/me` — data addition only, no guard changes.
- Frontend: `AppLayoutRedesign.jsx` AccountDrawer uses `employee.role_name`, falling back to the
  old id map only for sessions cached before this shipped.

**Browser proof:** employee on custom role "Shift Lead" (role_id 4) — account drawer shows
**"Shift Lead"** (old code labeled every custom role "Cashier").

## C7 — Nav/route guard alignment (4 pages)

Route wrappers added to match the nav guards (audit's ruling: align route to nav):
- `/attribute-sets` → `perm("manage_inventory")`
- `/receipt-templates` → `perm("manage_inventory")`
- `/recalls` → `perm("manage_treatment_plans")`
- `/handouts` → `perm("manage_treatment_plans")`
(`/vaccination-card/:subjectId` stays open — reached from customer detail, read-only, no nav entry.)

**Browser proof:** "Shift Lead" (view_reports only): nav shows no Catalog group; direct URL
`/attribute-sets` bounces away from the page (never renders).

## Kiosk-login disposition (report only — owner rules at Gate 0)

`POST /api/auth/kiosk-login` (auth.js:616):
- **Zero frontend callers** anywhere (main app, kiosk pages, portals, tests). The shipped kiosk
  (`KioskRedesign.jsx:198`) uses stateless `POST /api/attendance/pin-checkin` per event — no JWT.
- It is the **sole issuer** of the `kiosk` JWT scope (`tenant-auth.js:120` restricts that scope to
  attendance/auth paths — that branch is dead too if this endpoint goes).
- `docs/archive/INTENTIONAL_BACKEND_ONLY_APIS.md` (2026-03-09) already classified it
  "backend_only_by_design".
- Root `CLAUDE.md` still documents it as "Kiosk login: PIN-only (POST /api/auth/kiosk-login)" —
  stale; the real kiosk flow never calls it.

**Recommendation: REMOVE** (in a later step, per plan): dead code that mints working credentials
from a 4-digit PIN (rate-limited, but an unnecessary authenticated attack surface), unused by the
deliberately-stateless kiosk. Removal also deletes `KioskLoginSchema` + the dead kiosk-scope
branch, and CLAUDE.md's kiosk-login line should be corrected at the same time.

## Tests

- Frontend unit: 173/173 green (`frontend/tests/unit/`, includes auth_guards + layout suites).
- Backend: W0a suite still green (no backend guard changes here; `role_name` is additive).
- All temp test data (W0b Admin/Cashier/ShiftLead/RestMgr employees, Shift Lead role, module
  toggle state) removed; both tenants diff-clean vs pre-test. Toggle audit rows left in
  `action_history` (append-only by design).
