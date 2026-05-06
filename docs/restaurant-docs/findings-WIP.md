# Restaurant Pre-Launch — Findings (WIP)

> **Working document.** Active scratch log for restaurant pre-launch issues. Every finding here either gets fixed (→ ✅ FIXED with commit hash) or moved to a deferred / known-issue section.
>
> **Test tenant for all live verification:** `sanoposlivetest1778021564659` on `https://sanopos.com` (Owner: Test Owner / TestPass564659! / PIN 1234). DO NOT delete — equivalent of `livetest1` for the restaurant track.
>
> **Source of initial findings:** `docs/restaurant-docs/discovery-2026-05-07.md` (read-only code investigation completed 2026-05-07). Items below are pre-populated from that report. Subsequent findings will be appended via Playwright walkthrough sessions.
>
> **Status conventions:**
> - 🔴 **BLOCKER** — must fix before merchant onboarding
> - 🟡 **ISSUE** — should fix before walkthrough phase, not launch-blocking on its own
> - 🔵 **POLISH** — quality-of-experience, ship when convenient
> - ✅ **FIXED** — landed on production, includes commit hash
> - ⏸️ **DEFERRED** — known limitation, decision recorded
>
> **Date format:** ISO `YYYY-MM-DD`. **Operator:** Hassan unless noted.

---

## Status Summary

| Severity | Open | Fixed | Deferred |
|---|---|---|---|
| 🔴 Blocker | 3 | 2 | 0 |
| 🟡 Issue | 2 | 1 | 0 |
| 🔵 Polish | 13 | 0 | 0 |
| **Total** | **18** | **3** | **0** |

Last update: 2026-05-07 (post-walkthrough W5/W6/W7 backfill — observations caught during Phase 1+2 but not initially formalized: W5 confirms P10 live, W6 latent perm-array gap for Owner, W7 transient 401 on /api/context/bootstrap).

---

## 🔴 BLOCKERS

### B1 — Schema drift: tables + columns + constraints missing on fresh tenants ✅ FIXED

**Status:** ✅ FIXED — commit `449b6a6` (2026-05-07)
**Severity:** 🔴 Launch-blocker
**Surfaces affected:** Void/Comp (manager PIN), Day-parting (menu schedules), Reservations admin, Reservations public form, Waitlist, Pay-at-Table, KDS routing, KDS analytics, table-session housekeeping ('dirty' status), admin infra panel

**Scope expanded during fix-it session 2026-05-07** after source verification revealed broader drift than the discovery report's 7 tables. Final scope landed:

**Tables added to `backend/schema-pg.sql` (8):**
- `sale_item_adjustments` (v59)
- `void_reason_codes` + 10 default reason rows (v59)
- `menu_schedules` + `menu_schedule_products` (v59)
- `kds_station_load_snapshots` (v60) — initially missed by discovery
- `restaurant_payment_sessions` (v61)
- `reservations` (v61)
- `waitlist_entries` (v61)
- `public.infra_cache` (v50, public-schema-qualified) — initially missed by discovery

**Column additions also synced:**
- `outlets.timezone` (v59)
- `kds_stations.printer_id`, `balance_strategy`, `target_prep_seconds`, `last_assigned_at` + balance_strategy CHECK (v59)
- `printer_config.purpose` + purpose CHECK (v59)
- `kds_tickets.fired_at`, `bumped_at`, `recalled_at`, `prep_seconds` + 2 indexes (v60)
- `restaurant_table_sessions.status` CHECK widened to include 'dirty' (v61)

**Root cause:** `backend/tenant-provisioner-pg.js:88-94` INSERTs `schema_version` rows for ALL migrations (1..N), so the migration runner skips re-applying them. When `schema-pg.sql` was missing those migrations' end-state, fresh tenants got the schema_version row saying "applied" while the tables/columns/constraints didn't exist.

**Live test tenant** (`sanoposlivetest1778021564659`) was healed out-of-band — see Healing log below for full DDL trail and per-step verification.

**Out-of-scope (filed as B1.5 below for follow-up):** `treatment_plan_templates`, outlets geofence cols, leave_requests partial-day cols, company_profile v77 onboarding cols.

**Source:** `discovery-2026-05-07.md` §8.1.A; expanded scope verified against migrate-pg.js v50, v59, v60, v61

---

### B1.5 — Non-restaurant schema drift (deferred from B1)

**Status:** OPEN — scoped out of Phase 0 session 2026-05-07
**Severity:** 🟡 functional outside the restaurant vertical
**Scope note:** Deferred from Phase 0 session 2026-05-07. Fix in next focused schema-sync session covering full v1..v85 audit. Discovery (2026-05-07) did not catch these because it only audited restaurant surface area; B1's source-verification pass surfaced them.

Each item is `to_regclass`/`information_schema.columns` NULL on a fresh tenant for the same root cause as B1 — provisioner pre-stamps `schema_version` so the migration is skipped, but `schema-pg.sql` doesn't have the equivalent DDL.

| Item | Source | Severity guess | Used by |
|---|---|---|---|
| `treatment_plan_templates` table | v46 — `migrate-pg.js:3872` (CREATE TABLE) + `:3890` (idx_treatment_plan_templates_archived) | functional (clinic preset only) | `routes/treatment-plan-templates.js`, treatment-plan worker reminders |
| `outlets.latitude`, `outlets.longitude`, `outlets.geofence_radius_meters` (NUMERIC(10,7), NUMERIC(10,7), INTEGER) | v19 — `migrate-pg.js:1227` | functional | `routes/attendance.js` (4 refs — PIN-checkin geofence enforcement) |
| `leave_requests.partial_day` (BOOLEAN), `start_time` (TIME), `end_time` (TIME), `schedule_impact_status` (TEXT) | v19 — `migrate-pg.js:1230` | functional | `routes/tier4/hr.js` (3 refs — partial-day leave + scheduling overlap detection) |
| `company_profile.multi_outlet_flags_seeded` (BOOLEAN DEFAULT false) | v77 — `migrate-pg.js:5623` | functional | `routes/outlets.js` (5 refs — gates the 5-flag seed when 2nd outlet is created; without it `seedMultiOutletFlags` re-fires on every outlet POST) |
| `company_profile.test_receipt_printed_at` (TIMESTAMPTZ) | v77 — `migrate-pg.js:5624` | functional | `routes/printer.js` (3 refs — onboarding "test print" marker) |
| `company_profile.fbr_banner_dismissed` (BOOLEAN DEFAULT false) | v77 — `migrate-pg.js:5625` | cosmetic | `routes/tier4/company-profile.js` (1 ref — dismissable FBR banner) |

**Fix path:** dedicated schema-sync session — read each migration version v1..v85 in `migrate-pg.js`, audit cumulative end-state vs `schema-pg.sql`, ALTER TABLE / CREATE TABLE for each gap, heal existing tenants. The B1 session healed only the restaurant-relevant subset.

**Source:** verified against migrate-pg.js source during B1 source-verification pass; agent's full-scope drift inventory referenced internally in this session.

---

### B2 — Manager role missing 13 perms ✅ FIXED

**Status:** ✅ FIXED — commit `0212ccc` (2026-05-07)
**Severity:** 🔴 Launch-blocker (functional lockout for non-admins)
**Surfaces affected:** Every restaurant route gated by `manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`

**Root cause:**
- `backend/routes/setup.js:22-34` hardcodes a stale 8-perm Manager list:
  ```js
  Manager: ['manage_inventory','manage_orders','view_reports','manage_employees',
            'pos_discount','void_sales','pos_park','pos_void']  // 8 perms
  ```
- `backend/middleware/permissions.js:37-68` defines the canonical 21-perm Manager list including all the Phase 4 vertical perms.
- `ensureDefaultRolePermissions(db)` runs once per boot against the public pool, never per-tenant — so back-fill never happens for tenant schemas.
- Setup wizard wins; every fresh tenant gets the 8-perm Manager.

**Live verification (`SELECT name, COUNT(rp.permission)` on tenant schema):**
- Admin (id=1): 10 perms ✅
- **Manager (id=2): 8 perms** ❌ — missing 13 (`manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans`)
- Cashier (id=3): 3 perms

**Effect:** any non-Admin restaurant employee gets 403 on every restaurant route. Cashier can't open checks; Manager can't fire courses, run KDS, manage void/comp, run tip pools.

**Fix path (preferred — single source of truth):**
1. Replace the hardcoded `ROLE_PERMISSIONS` object in `setup.js:22-34` with an import from `middleware/permissions.js` `DEFAULT_ROLE_PERMISSIONS`.
2. Heal the live tenant: INSERT the 13 missing perm rows into `tenant_sanoposlivetest1778021564659.role_permissions` for `role_id=2`.
3. Verify by logging in as a Manager-role test employee and hitting a restaurant route.

**Source:** `discovery-2026-05-07.md` §8.1.B

---

## 🟡 ISSUES

### I1 — Owner employee `role` text column says "Cashier" ✅ FIXED

**Status:** ✅ FIXED — commit `2a322eb` (2026-05-07)
**Severity:** 🟡 Cosmetic-to-medium (depends on UI surfaces reading the text column)

**Root cause:**
- `backend/tenant-provisioner-pg.js:118-121` INSERTs employee with `role_id` only — no value for the legacy `role` text column. Defaults to whatever the column default is (apparently "Cashier").
- `backend/routes/setup.js:343-353` UPDATEs `name` + `pin_hash` only on existing employee rows — leaves the `role` text column from provisioner.
- `backend/routes/setup.js:355-363` only INSERTs the text column when creating fresh — but provisioner already ran, so we're on the UPDATE path.

**Live verification:** owner employee row has `role_id=1` (correct, Admin) but `role='Cashier'` (wrong).

**Effect:** middleware uses `role_id` for permissions — functionally fine. But anywhere the UI surfaces `employee.role` text directly (profile dropdown, employee list, audit trails) shows "Cashier" for the actual administrator.

**Fix path:** either drop the legacy text column (it's superseded by `role_id`), or make provisioner + setup pair set it consistently. Lower priority — ship alongside B1+B2 if possible.

**Source:** `discovery-2026-05-07.md` §8.1.C

---

## 🔵 POLISH / NON-BLOCKING

### P1 — Sample products have no FBR HS code / tax rate inheritance

**Status:** OPEN | **Source:** discovery §8.2.D

`backend/seeds/preset-seed-data.js:137-153` inserts sample products with `name, price, category_id` only — no `hs_code`, no `tax_rate_override`. Tenant's `tax_mode='none'` makes this moot today, but if owner later flips tax_mode or moves to FBR, samples need cleanup.

---

### P2 — `routes/modifiers.js` and `routes/tips.js` lack `requireMode` check

**Status:** OPEN | **Source:** discovery §8.2.E

Both gate on `requireFeature("phase4_restaurant")` only (`modifiers.js:20-21`, `tips.js:21-22`) without `requireMode("restaurant")`. Defense-in-depth gap: an admin manually flipping `phase4_restaurant` ON for a retail tenant would activate modifiers/tips without `tenant_modes.restaurant`. Not a launch blocker.

---

### P3 — `routes/restaurant-inbox.js` empty-state risk

**Status:** OPEN | **Source:** discovery §8.2.F

If no `web_orders` rows of type `kiosk` / `daraz` / `shopify` exist, inbox page renders empty. Verify in walkthrough that empty state renders cleanly, not as a 500.

---

### P4 — Onboarding checklist may not surface restaurant-specific steps

**Status:** OPEN | **Source:** discovery §8.2.G

`industry-config.js:51` defines `restaurant.onboarding_steps = ["store","menu_item","floor_plan","shift","order"]`. The dashboard onboarding widget reads `usePreset().onboarding_steps`, but the per-step rendering (label, "done" detection, action button URL) lives elsewhere. Verify "menu_item" and "floor_plan" steps render with restaurant-appropriate copy and link to `/inventory` (or future menu builder) and `/restaurant/floor`.

---

### P5 — Cafe vs restaurant divergence

**Status:** OPEN | **Source:** discovery §8.2.H

Cafe is functionally a restaurant (same `mode: ["restaurant"]`, same flags via `setup.js:279`) but with three UI differences:
- `dashboard_widgets.floor_plan = false` (no floor view on cafe dashboard)
- `labels.customer = "Customer"` (not "Guest")
- `onboarding_steps` includes `employees` instead of `floor_plan`

Cafe walkthrough should be a separate signup at minimum to confirm UI text differences.

---

### P6 — Public restaurant menu requires `?tenant=` query everywhere

**Status:** OPEN | **Source:** discovery §8.2.I

`/menu/:token`, `/pay/:token`, `/reserve/:slug` all need the slug. Without it, `resolvePublicTenantDb` returns 4xx. The OrderKiosks launcher includes the slug, but printed QR codes pointing to URLs without slug will break. Walkthrough should verify QR codes generated from `kiosk-tokens` always carry `?tenant=`.

---

### P7 — Day-parting "no schedule = always available"

**Status:** OPEN | **Source:** discovery §8.2.J

When `phase4_restaurant_day_parting` is ON but no schedules exist, `filterAvailableProducts` returns the full menu. Once schedules exist, products NOT pinned to any schedule remain always-available; only pinned products are restricted. Worth verifying expectation matches behaviour.

---

### P8 — Pay-at-table requires `PAYMENT_GATEWAY=sandbox` to actually complete

**Status:** OPEN | **Source:** discovery §8.2.K

`pay-at-table.js:96` calls `paymentGateway.getPaymentAdapter("sandbox")` directly. Even if `PAYMENT_GATEWAY` env var is unset/`manual`, sandbox adapter still works by name — but webhook completion path requires sandbox webhook flow wired. Walkthrough should confirm Railway has sandbox payment env vars set.

---

### P9 — FBR + tax_mode=none combination

**Status:** OPEN | **Source:** discovery §8.2.L

Test tenant has `tax_mode='none'` but country pack PK auto-enabled `fbr_integration`. Walkthrough should verify FBR sidebar items don't aggressively prompt the merchant to set up FBR (since they declined GST). `frontend/src/ui/FBRPromptBanner.jsx` is opt-in (props-driven), but sidebar still shows FBR items.

---

### P10 — Role 1 name mismatch: provisioner says 'Admin', setup.js says 'Administrator'

**Status:** OPEN | **Source:** surfaced during B2 fix-it session 2026-05-07

`backend/tenant-provisioner-pg.js` creates role id=1 with name `'Admin'` (and seeds it with `all_access` via its own `ALL_PERMISSIONS` array). `backend/routes/setup.js` then attempts `INSERT (1, 'Administrator', ...) ON CONFLICT (id) DO NOTHING` — the conflict no-ops, leaving the row at `'Admin'`.

**Live verification (`SELECT name FROM roles WHERE id = 1`):** `'Admin'` ✅ (provisioner won)

**Effect:** functionally fine — provisioner already seeded `all_access`, and middleware uses `role_id` for permission resolution. But:
- `DEFAULT_ROLE_PERMISSIONS.Administrator` (newly imported in B2 fix `0212ccc`) doesn't match the live role name during seed. Setup wizard's seed loop iterates `Object.keys(DEFAULT_ROLE_PERMISSIONS)` = `['Administrator', 'Manager', 'Cashier']` and joins on role.name; for role 1, that join misses (no `Administrator` row). Manager + Cashier match correctly because both files agree on those names.
- UI surfaces that display `role.name` will show "Admin" rather than "Administrator" — fine, consistent, but worth a note.

**Fix path (low priority):** pick one canonical name. Either:
- Update `tenant-provisioner-pg.js:104-105` to use `'Administrator'` (matches setup.js + DEFAULT_ROLE_PERMISSIONS), OR
- Update `setup.js` + `middleware/permissions.js` to use `'Admin'` (matches provisioner + the legacy livetest1 retail tenant)

Provisioner runs first and wins via ON CONFLICT, so the fix should land in provisioner and align everything to `'Administrator'`. Cross-check: existing tenants (livetest1, sanoposlivetest1778021564659) already have `'Admin'` as the role name — would need a UPDATE statement during the heal.

**Severity:** 🔵 Polish. Functionally correct today, cosmetic only, but creates dead-code paths in the seed loop that obscure intent.

---

## Walkthrough findings (Wn)

### W1 — Floor / Checks / KDS bounce to /dashboard on every navigation

**Status:** OPEN
**Severity:** 🔴 BLOCKER
**Surfaces affected:** `/restaurant/floor`, `/restaurant/checks`, `/kds` (any restaurant page that gates on `readContext()?.active_outlet_id`)
**Found via:** Playwright walkthrough 2026-05-07, Phase 2 — Restaurant section sweep

**Steps to reproduce:**
1. Sign in as Test Owner on `sanoposlivetest1778021564659` (Free plan, single Main Store outlet)
2. Land on dashboard
3. Click sidebar → Restaurant → Floor Plan (or Checks, or KDS)
4. URL flips to `/restaurant/floor` for ~3s, then redirects back to `/dashboard`. No error, no toast, nothing.

**Observed:** Hard redirect to `/dashboard` (or `/`) within 3 seconds. Console clean. Network clean. From the operator's perspective, the link "does nothing".

**Expected:** Floor Plan page renders with empty state and "+ Floor Plan" CTA.

**Source / root cause** (verified against code, not docs):
- `frontend/src/pages/redesign/RestaurantFloorRedesign.jsx:26` — `if (!readContext()?.active_outlet_id) return <Navigate to="/" replace />;`
- `frontend/src/pages/redesign/RestaurantChecksRedesign.jsx:27` — same gate
- `frontend/src/pages/redesign/KDSRedesign.jsx:53` — same gate
- `frontend/src/auth/authStore.js:37-40` — `readContext()` reads `session.context`
- Live `localStorage.authSession` keys: `["employee","permissions","loadedAt","token","tenant_slug","tenant","company"]` — **no `context` key**
- Free-plan single-outlet tenants never visit `/context-select` at boot, so the session never gets a `context.active_outlet_id` written. The gate was correct in spirit (don't try to load floor data for an unscoped admin) but Floor/Checks/KDS are the merchant's primary surfaces — bouncing them silently is the opposite of helpful.

**Console / network errors:** None — `useFeatureFlags` resolves cleanly, no 4xx/5xx, no React errors. The `<Navigate replace />` is silent.

**Screenshots:**
- `restaurant-walkthrough-phase2-floor-plan-deep-link-2026-05-07.png` (the resulting /dashboard after bounce)

**Suggested fix paths (for the fix-it session, not this walkthrough):**
1. Drop the `active_outlet_id` gate entirely — let the page render with an empty state if no outlet is selected, or use the `primary_outlet_id` from `/api/context/bootstrap` as a fallback.
2. Make `loadCompanyProfile`/`resolveContext` middleware include the active outlet id in the session bootstrap response and write it client-side (single-outlet tenants don't have a "context choice" to make).
3. Replace `Navigate to="/"` with an inline empty-state CTA: "Pick an outlet to manage tables".

Pre-existing live tenants like `livetest1` work because they went through `/context-select` historically and have a `context` key. New tenants (single outlet on Free) skip that step entirely. The bug is invisible until you sign up fresh.

---

### W2 — Menu Schedules crashes with React error #310 (rendered more hooks than previous render)

**Status:** OPEN
**Severity:** 🔴 BLOCKER
**Surfaces affected:** `/restaurant/menu-schedules` (and likely any page following the same conditional-hook order pattern)
**Found via:** Playwright walkthrough 2026-05-07, Phase 2 — 🆕 Menu Schedules check

**Steps to reproduce:**
1. Sign in
2. Navigate to `/restaurant/menu-schedules`
3. Page-level ErrorBoundary catches a thrown React error and shows "Something went wrong / This section encountered an error. You can try again or reload the page."

**Observed:** "Something went wrong" card. Reloading just retriggers the same error.

**Expected:** 7-day × 24-hour weekly grid with editor pane, even if empty.

**Console error:**
```
Error: Minified React error #310; visit https://react.dev/errors/310
  at MenuSchedulesRedesign (... MenuSchedulesRoute-Ceirh_xz.js)
```
React error #310 = "Rendered more hooks than during the previous render" — i.e. hooks called conditionally.

**Source / root cause** (verified against code, not docs):
- `frontend/src/pages/redesign/restaurant/MenuSchedulesRedesign.jsx:64-66` — three early returns AFTER the initial useState/useCallback/useEffect block:
  ```js
  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_day_parting) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;
  ```
- `frontend/src/pages/redesign/restaurant/MenuSchedulesRedesign.jsx:68-73` — `useMemo` called AFTER those conditional returns:
  ```js
  const filtered = useMemo(
    () => selectedOutletId
      ? schedules.filter(...)
      : schedules,
    [schedules, selectedOutletId]
  );
  ```
- First render: `flagsLoading=true` → early return at line 64 → `useMemo` never runs.
- Second render after flags load: passes through line 64 → `useMemo` runs.
- React tracks hooks by call order; total hook count differs across renders → React #310.

**Screenshots:**
- `restaurant-walkthrough-phase2-menu-schedules-react310-2026-05-07.png`

**Suggested fix:** Move the `useMemo` before the early-return block (and apply the same lint rule to all `redesign/restaurant/*Redesign.jsx` files — there's a 1% chance Reservations/Waitlist/86 dodge it only because they happen not to use further hooks after the gate; worth a follow-up grep). Easy fix; low risk.

---

### W3 — Sidebar restaurant section invisible for ~1.5s after every navigation

**Status:** OPEN
**Severity:** 🔵 POLISH (UX flicker, not functional)
**Surfaces affected:** every page with the sidebar (so: every authenticated page after Phase 0 nav-config regroup `25def3a`)
**Found via:** Playwright walkthrough 2026-05-07, Phase 1 + Phase 2

**Steps to reproduce:**
1. Sign in
2. Land on dashboard. Sidebar shows: Overview / Sell / Customers / Catalog / Inventory / Procurement / Fulfillment / Online Store / Finance / Insights / People / Compliance / Setup / Account.
3. **No "Restaurant" group between Online Store and Finance.**
4. Wait ~1.5 seconds.
5. "Restaurant" group appears with Floor Plan / Checks / 86'd Items / Modifiers / Menu Schedules / Reservations / Waitlist / Online Inbox / Void/Comp Reasons / KDS / Tip Pools / Order Kiosks.

**Observed:** First paint of every navigation hides restaurant items. Verified via `performance.now()`-bracketed eval — initial groups list lacks "Restaurant"; settled groups list 1.5s later includes it.

**Expected:** Restaurant items visible on first paint.

**Source / root cause** (verified against code, not docs):
- `frontend/src/components/AppLayoutRedesign.jsx:88-100` — sidebar filter applies `(!it.requiredFlag || Boolean(flags[it.requiredFlag]))` synchronously
- `frontend/src/hooks/useFeatureFlags.js:6-24` — `DEFAULT_FLAGS` is fail-closed (every restaurant `phase4_*` key absent → falsy)
- `frontend/src/hooks/useFeatureFlags.js:27` — initial state is `setFlags(DEFAULT_FLAGS)` → all restaurant phase4_* flags read as `false` until the `/api/feature-flags` fetch resolves
- `flagsLoading` state exists but is NOT consumed by `AppLayoutRedesign` — only the resolved `flags` object. The sidebar nav doesn't wait for the flag fetch.
- Result: until the network round-trip completes, every restaurant nav item is filtered out.

**Console / network errors:** None.

**Screenshots:**
- `restaurant-walkthrough-phase1-dashboard-2026-05-07.png` (initial paint, no Restaurant section)
- `restaurant-walkthrough-phase1-sidebar-restaurant-section-2026-05-07.png` (post-settle, Restaurant section visible)

**Why this is polish-only:** the merchant who knows the section exists can wait 1-2s. But for a brand-new restaurant tenant who clicked through onboarding and lands on the dashboard, the first impression is "where are my tables?" — which directly contradicts the wizard they just completed.

**Suggested fix:** either (a) make `AppLayoutRedesign` render skeleton groups while `flagsLoading=true` instead of an empty/incomplete sidebar, or (b) seed the `useFeatureFlags` initial state from `localStorage["lastKnownFlags"]` updated each successful fetch (warm-cache pattern), or (c) inline-render the `flagsLoading` spinner in the sidebar nav area.

---

### W4 — Sidebar nav links to restaurant routes are React-Router clickable but bounced (W1 cascade)

**Status:** OPEN
**Severity:** 🔵 POLISH (downstream of W1)
**Surfaces affected:** Restaurant sidebar links (Floor Plan, Checks, KDS specifically)
**Found via:** Playwright walkthrough 2026-05-07, Phase 2 — sidebar click + hard-nav both reproduce

**Steps to reproduce:**
1. Click the Floor Plan sidebar link
2. URL stays at `/dashboard` — **the `<NavLink>` click registers but the route guard immediately fires Navigate-back**
3. Same with hard-nav directly to `/restaurant/floor`

**Observed:** Sidebar entry exists, looks live, click does nothing visible. Identical UX to a broken link.

**Expected:** Restaurant pages load.

**Suspected root cause:** This is the surface symptom of W1; not a separate bug. Worth flagging because the merchant experiences "the sidebar lies to me" before they understand it's an outlet-context bug.

**Suggested fix:** Resolved by W1 fix.

---

### W5 — P10 confirmed live: provisioner role name "Admin" wins over setup.js "Administrator"

**Status:** OPEN (live confirmation of pre-existing P10)
**Severity:** 🔵 POLISH
**Surfaces affected:** anywhere code joins on role.name or matches `DEFAULT_ROLE_PERMISSIONS` keys by name
**Found via:** Playwright walkthrough 2026-05-07, Phase 1 — `/api/context/bootstrap` response inspection

**Live verification:** GET `/api/context/bootstrap` for `sanoposlivetest1778021564659` returns:
```json
"employee": { "id": 1, "name": "Test Owner", "role_id": 1, "role_name": "Admin" }
```

Confirms P10 is live: provisioner-set role name `"Admin"` persists despite setup.js seeding `"Administrator"`. Functionally fine because:
- Profile dropdown text "Administrator" is hardcoded by `role_id` in `frontend/src/components/AppLayoutRedesign.jsx` ProfileDropdown (verified by reading source line ~50-70 area), NOT by reading the role.name DB column
- Permissions resolve via `role_id`, not `role.name`
- No surface visibly shows "Admin" today

**No new fix path needed** — supersedes nothing; just records that P10's "what is the live state" question is answered. Same fix path applies (pick canonical name in provisioner + heal existing tenants).

---

### W6 — Owner's `permissions` array lacks literal Phase 4 perms; `hasPerm("all_access")` short-circuit is the only thing keeping Restaurant routes accessible

**Status:** OPEN
**Severity:** 🟡 ISSUE (latent — depends on whether any code does `permissions.includes("manage_restaurant")` instead of `hasPerm("manage_restaurant")`)
**Surfaces affected:** any route or component that bypasses `hasPerm()` and reads the `permissions` array directly
**Found via:** Playwright walkthrough 2026-05-07, Phase 1 — `/api/auth/me` response inspection

**Live verification:** GET `/api/auth/me` for the Owner returns:
```json
"permissions": [
  "all_access","manage_customers","manage_employees","manage_inventory","manage_orders",
  "pos_discount","pos_park","pos_void","view_reports","void_sales"
]
```

10 perms only. **None of `manage_restaurant`, `manage_kds`, `manage_tips`, `override_void_comp`, `override_price`, `manage_gift_cards`, `manage_bookings`, `manage_projects`, `manage_contracts`, `manage_tickets`, `manage_rentals`, `manage_rooms`, `manage_treatment_plans` are present.**

The Owner can still hit restaurant routes today because:
- `frontend/src/auth/AuthProvider.jsx:159` — `hasPerm = (perm) => permissions.includes("all_access") || permissions.includes(perm)`
- The `all_access` short-circuit makes the missing literal perms irrelevant for the gate.

**Risk:** any code path that reads `useAuth().permissions` directly (rather than via `hasPerm()`) will fail for the Owner on Phase 4 features. Examples to grep for: `permissions.includes(`, `perms.includes(`, `permissions.indexOf(`. Not yet audited.

**Compare with B2 fix:** B2 added the 13 Phase 4 perms to the **Manager** role explicitly via `DEFAULT_ROLE_PERMISSIONS.Manager`. The Admin role gets `all_access` + 9 baseline perms via `tenant-provisioner-pg.js`'s own `ALL_PERMISSIONS` array — which does NOT include the Phase 4 perms. B2's import of `DEFAULT_ROLE_PERMISSIONS` doesn't help the Admin row because the role_name mismatch (W5) means the seed loop never matches `id=1` to a `DEFAULT_ROLE_PERMISSIONS.Administrator` entry.

**Fix path:** either (a) make the Admin perm list include the Phase 4 perms explicitly, or (b) keep relying on the `all_access` short-circuit and add a lint rule / grep-check in CI that bans direct `permissions.includes(...)` outside `AuthProvider`. Option (b) is the cheaper fix but option (a) is more honest about what the Admin actually has.

**Source citations:**
- `backend/tenant-provisioner-pg.js` — `ALL_PERMISSIONS` array seeded for role_id=1
- `backend/middleware/permissions.js` — `DEFAULT_ROLE_PERMISSIONS.Administrator` (newly relevant after B2 import in `0212ccc`)
- `frontend/src/auth/AuthProvider.jsx:157-159` — `hasPerm` definition

---

### W7 — Transient 401 on `/api/context/bootstrap` during first render after login

**Status:** OPEN
**Severity:** 🔵 POLISH (cosmetic console noise + Sentry pollution)
**Surfaces affected:** every authenticated session — fires once per fresh login
**Found via:** Playwright walkthrough 2026-05-07, Phase 1 — console inspection after login

**Steps to reproduce:**
1. Clear localStorage
2. Log in
3. Land on /dashboard
4. Console shows: `[ERROR] Failed to load resource: the server responded with a status of 401 () @ https://api.sanopos.com/api/context/bootstrap:0`
5. The bootstrap call retries successfully a moment later (preset loads correctly — verified by checking that restaurant labels arrive)

**Observed:** Single 401 logged then ignored. PresetContext sets `presetLoaded=true` regardless (per `frontend/src/contexts/PresetContext.jsx:93-96` catch-and-continue) so user never sees a problem.

**Expected:** No 401. The first bootstrap call should already have headers attached.

**Source / root cause** (verified against code, not docs):
- `frontend/src/contexts/PresetContext.jsx:54-98` — explicitly waits for `!isBootstrapping && employee?.id` before calling `api.get("/api/context/bootstrap")`. The comment at line 71-77 even calls this race out: "the auth fetch interceptor is wired in an AuthProvider useEffect, and child useEffects run before parent useEffects in React. Without this guard, the first /api/context/bootstrap call goes through unpatched fetch and 401s."
- The guard prevents PresetContext's call from racing — but **something else is calling `/api/context/bootstrap` before the interceptor is wired**. Likely culprit: `ContextSwitcher.jsx` or `RequireContext.jsx`. Did not source-verify the actual caller this session.

**Console error (raw):**
```
Failed to load resource: the server responded with a status of 401 ()
@ https://api.sanopos.com/api/context/bootstrap:0
```

**Why it's polish-only:** PresetContext recovers silently. But every fresh login pollutes Sentry with a 401 that is operationally meaningless, which trains operators to ignore Sentry 401s — bad signal hygiene.

**Fix path:** grep for all `/api/context/bootstrap` callers, identify the early one, apply the same `isBootstrapping` guard PresetContext uses. Or: serve `/api/context/bootstrap` as a public endpoint when called without auth (server returns a stub) — riskier.

---

## Healing log (out-of-band changes to live test tenant)

> Record any DDL or DML run directly against `tenant_sanoposlivetest1778021564659` outside the migration runner. Future tenants get the same state via the migration / setup fixes, but the live test tenant predates them and needs manual catch-up.

### 2026-05-07 — B1 + B2 + I1 fixes shipped, live tenant healed

Run via Supabase MCP against project `tpjewvfoqtskscmwjtjj`. Each step verified with a follow-up SELECT before proceeding.

**B1 heal — column additions (v59 + v60 + v61 CHECK):**

```sql
-- v59: outlets.timezone
ALTER TABLE tenant_sanoposlivetest1778021564659.outlets ADD COLUMN IF NOT EXISTS timezone TEXT;

-- v59: kds_stations columns + balance_strategy CHECK
ALTER TABLE tenant_sanoposlivetest1778021564659.kds_stations
  ADD COLUMN IF NOT EXISTS printer_id INTEGER REFERENCES tenant_sanoposlivetest1778021564659.printer_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS balance_strategy TEXT NOT NULL DEFAULT 'priority',
  ADD COLUMN IF NOT EXISTS target_prep_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;
ALTER TABLE tenant_sanoposlivetest1778021564659.kds_stations DROP CONSTRAINT IF EXISTS kds_stations_balance_strategy_check;
ALTER TABLE tenant_sanoposlivetest1778021564659.kds_stations ADD CONSTRAINT kds_stations_balance_strategy_check CHECK (balance_strategy IN ('priority','round_robin','least_loaded'));

-- v59: printer_config.purpose + CHECK
ALTER TABLE tenant_sanoposlivetest1778021564659.printer_config ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'receipt';
ALTER TABLE tenant_sanoposlivetest1778021564659.printer_config DROP CONSTRAINT IF EXISTS printer_config_purpose_check;
ALTER TABLE tenant_sanoposlivetest1778021564659.printer_config ADD CONSTRAINT printer_config_purpose_check CHECK (purpose IN ('receipt','fire_chit','guest_bill','expo'));

-- v60: kds_tickets timing columns + 2 indexes
ALTER TABLE tenant_sanoposlivetest1778021564659.kds_tickets
  ADD COLUMN IF NOT EXISTS fired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bumped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prep_seconds INTEGER;
CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_bumped ON tenant_sanoposlivetest1778021564659.kds_tickets(station_id, bumped_at) WHERE bumped_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kds_tickets_fired_at ON tenant_sanoposlivetest1778021564659.kds_tickets(fired_at) WHERE fired_at IS NOT NULL;

-- v61: restaurant_table_sessions status CHECK widened to include 'dirty'
ALTER TABLE tenant_sanoposlivetest1778021564659.restaurant_table_sessions DROP CONSTRAINT IF EXISTS restaurant_table_sessions_status_check;
ALTER TABLE tenant_sanoposlivetest1778021564659.restaurant_table_sessions ADD CONSTRAINT restaurant_table_sessions_status_check CHECK (status IN ('seated','ordering','served','check_requested','closed','dirty'));
```

Verify (information_schema.columns + pg_get_constraintdef): all 10 columns present, dirty CHECK live ✅

**B1 heal — 8 new tables (full DDL bodies in commit `449b6a6`'s schema-pg.sql additions; same DDL run with explicit `tenant_sanoposlivetest1778021564659.` schema qualifier):**

- `sale_item_adjustments` + 2 indexes (v59)
- `void_reason_codes` + 10 default reason rows via INSERT ... ON CONFLICT (code) DO NOTHING (v59)
- `menu_schedules` + `menu_schedule_products` + idx_menu_schedule_products_product (v59)
- `kds_station_load_snapshots` + idx_kds_load_snapshots_station_time (v60)
- `restaurant_payment_sessions` + idx_rps_status_expires + idx_rps_table_session (v61)
- `reservations` + 3 indexes (idx_reservations_start, _status, _table) (v61)
- `waitlist_entries` + idx_waitlist_status_position (v61)

`public.infra_cache` was confirmed already present in `public` schema (`to_regclass('public.infra_cache')` returns `infra_cache`) — likely landed via a previous migrate-pg.js run against public schema, no separate heal needed.

Verify (`to_regclass` for each): all 8 tables present, void_reason_codes seed count = 10 ✅

**B2 heal — Manager perm backfill:**

```sql
INSERT INTO tenant_sanoposlivetest1778021564659.role_permissions (role_id, permission)
SELECT 2, perm FROM unnest(ARRAY[
  'manage_inventory', 'manage_orders', 'view_reports', 'manage_employees',
  'pos_discount', 'void_sales', 'pos_park', 'pos_void',
  'manage_restaurant', 'manage_kds', 'manage_bookings', 'manage_projects',
  'manage_contracts', 'manage_tickets', 'manage_rentals', 'manage_rooms',
  'manage_treatment_plans', 'manage_tips', 'override_void_comp',
  'manage_gift_cards', 'override_price'
]) AS perm
ON CONFLICT (role_id, permission) DO NOTHING;
```

Inserted all 21 canonical Manager perms; the 8 already-present rows were skipped via ON CONFLICT.

Verify (`SELECT COUNT(...) FROM role_permissions WHERE role_id = 2`): Manager 8 → 21 perms ✅

**I1 heal — owner role text:**

```sql
UPDATE tenant_sanoposlivetest1778021564659.employees SET role = 'Administrator' WHERE id = 1 AND role_id = 1;
```

Verify (`SELECT id, name, role, role_id FROM employees`): `{id:1, name:"Test Owner", role:"Administrator", role_id:1}` ✅

**Note on role-name inconsistency** (surfaced during B2 verification, non-blocking): provisioner inserts role id=1 with `name='Admin'`; setup.js's `roleDefs` then INSERTs (1,'Administrator') with `ON CONFLICT (id) DO NOTHING` so the 'Admin' name persists. `DEFAULT_ROLE_PERMISSIONS.Administrator` therefore doesn't match by name during seed — but provisioner already seeds Admin role with `all_access` via its own `ALL_PERMISSIONS` array (10 perms incl. all_access), so functionally OK. Filed mentally as a follow-up; does not block walkthrough.

---

## Walkthrough session log

> Append a dated entry per Playwright walkthrough session. Each entry: date, scope (which sections of the plan), findings IDs added (W1, W2, ...), commit refs of any fixes shipped that session.

### Session 2026-05-07 — Phase 1 + partial Phase 2 (paused on blockers)

**Operator:** Hassan (with Claude in headed Playwright)
**Tenant:** `sanoposlivetest1778021564659` (restaurant, PK, Free, tax_mode=none)
**Phases walked:** Phase 1 (full) + Phase 2 — Restaurant section (partial, 5 of 12 items)
**Duration:** ~75 min before pausing

**Phase 1 result — clean ✅ with one polish item:**
- Login flow worked (clean creds → land on /dashboard)
- KPI cards / onboarding checklist / profile dropdown all render
- Onboarding checklist correctly shows restaurant steps (Set up your store / Add your first menu item / Set up your floor plan / Open a shift / Make your first order) — verifies P4 expectation
- Profile dropdown shows "Administrator" role text — verifies I1 fix `2a322eb` shipped (note: from source, `AppLayoutRedesign.jsx` ProfileDropdown hardcodes role text by `role_id`, not reading the DB `role` text column — but the visual outcome is correct)
- POS labels via `/api/context/bootstrap` confirmed restaurant-flavored: Menu Item / Guest / Order
- FBR sidebar items render but no aggressive prompt banner — P9 looks OK (no FBR banner pestering despite `fbr_integration` ON + `tax_mode=none`)
- Filed: **W3** (sidebar restaurant section flickers in after ~1.5s)

**Phase 2 result — paused after 3 blockers, only 5 of 12 Restaurant items walked:**

| 🆕 Route | Result | Notes |
|---|---|---|
| `/restaurant/availability` (86'd Items) | ✅ clean empty state | B1 heal verified live |
| `/restaurant/menu-schedules` | 🔴 React #310 — page crashes | W2 |
| `/restaurant/reservations` | ✅ clean empty state | B1 heal verified live |
| `/restaurant/waitlist` | ✅ clean empty state | B1 heal verified live |
| `/restaurant/void-reasons` | ✅ 10 seed reasons render | B1 heal verified live |

| Other Restaurant items | Result |
|---|---|
| `/restaurant/floor` (Floor Plan) | 🔴 W1 — bounces to /dashboard |
| `/restaurant/checks` (Checks) | 🔴 W1 — bounces to /dashboard |
| `/kds` (KDS) | 🔴 W1 — bounces to /dashboard |
| Modifiers / Online Inbox / Tip Pools / Order Kiosks | ⏸️ NOT WALKED — paused |

**Findings IDs filed this session:** W1 (🔴 BLOCKER, Floor/Checks/KDS bounce — missing context.active_outlet_id on Free single-outlet tenants), W2 (🔴 BLOCKER, Menu Schedules React #310 — useMemo after conditional return), W3 (🔵 POLISH, sidebar restaurant section invisible for ~1.5s on every nav due to fail-closed flag default), W4 (🔵 POLISH, sidebar restaurant links appear broken — surface symptom of W1).

**Why we paused:** the constraint was "stop if 3+ 🔴 blockers in Phase 2." We hit exactly 3 (W1 affects 3 routes but it's one root cause; W2 is independent). The restaurant section is the heart of merchant operations — continuing the cross-vertical sweep before fixing Floor/Checks/KDS would log a lot of noise without progressing the launch readiness picture.

**Screenshots saved (8):**
- `restaurant-walkthrough-phase1-landing-2026-05-07.png` — public landing page
- `restaurant-walkthrough-phase1-dashboard-2026-05-07.png` — first paint of dashboard (no Restaurant section)
- `restaurant-walkthrough-phase1-dashboard-settled-2026-05-07.png` — same dashboard after settle (still doesn't catch Restaurant — folded below fold)
- `restaurant-walkthrough-phase1-sidebar-restaurant-section-2026-05-07.png` — Restaurant nav items after sidebar scroll, post-settle
- `restaurant-walkthrough-phase1-profile-dropdown-2026-05-07.png` — confirms "Administrator" role label
- `restaurant-walkthrough-phase2-floor-plan-deep-link-2026-05-07.png` — W1 reproduction (floor URL → /dashboard bounce)
- `restaurant-walkthrough-phase2-availability-loaded-2026-05-07.png` — 🆕 86'd Items empty state
- `restaurant-walkthrough-phase2-menu-schedules-react310-2026-05-07.png` — W2 reproduction
- `restaurant-walkthrough-phase2-reservations-loaded-2026-05-07.png` — 🆕 Reservations empty state
- `restaurant-walkthrough-phase2-waitlist-loaded-2026-05-07.png` — 🆕 Waitlist empty state
- `restaurant-walkthrough-phase2-void-reasons-loaded-2026-05-07.png` — 🆕 Void/Comp Reasons with 10 seeds

**Surprises:**
- The 5 🆕 routes that B1 was specifically meant to unblock — 4 of 5 work flawlessly. Only Menu Schedules has its own independent bug (W2), unrelated to B1. So B1's fix shipped well; W2 is a separate hook-order regression.
- Yesterday's `25def3a refactor(nav): regroup sidebar` did NOT remove restaurant items from the config (verified by reading the diff). The flicker (W3) has been latent since `useFeatureFlags` shipped — the regroup just changed the section grouping, the timing bug was always there.
- Free-tier tenants entirely skip `/context-select` and so never get a `context.active_outlet_id` written to their session. Three restaurant pages depended on that being set. This is the single highest-leverage bug to fix for restaurant launch — it makes the platform feel broken to a brand-new restaurant signup the moment they click Floor Plan.

**Recommendation for next sitting:** stop the walkthrough until W1 + W2 land. Both are small frontend fixes:
- W1: drop the `active_outlet_id` gate or fall back to `primary_outlet_id`
- W2: move `useMemo` before the early-return block in `MenuSchedulesRedesign.jsx`

After those ship, the next walkthrough sitting can resume Phase 2 from the unwalked Restaurant items (Modifiers, Online Inbox, Tip Pools, Order Kiosks) and proceed cross-vertical.

---

*This file is uncommitted by intent until first fix lands. Edit freely during active work; commit alongside the first fix.*
