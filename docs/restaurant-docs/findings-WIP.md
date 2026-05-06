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
| 🔴 Blocker | 2 | 11 | 0 |
| 🟡 Issue | 1 | 6 | 0 |
| 🔵 Polish | 12 | 3 | 0 |
| **Total** | **15** | **20** | **0** |

Last update: 2026-05-07 (Phase 3 flow 3.2 fix-it loop — W24 ✅ FIXED `29e540c` (frontend lowercase + backend validation + Sentry alert). Live-verified: sale `INV-2026-00004` Rs 1,200 with 15% tip wrote `tip_captures.id=2 tip_amount=180.00 tip_method='cash' server_id=1`. **W22** 🔴 next (smallest remaining: add `PUT /api/restaurant/checks/:id`). **W23** 🔴 after (architectural: add Pay-from-Checks-list action). After all three ship + verify, resume flow 3.2 step 5 (split + pay each child + tip pool).)

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

### W1 — Floor / Checks / KDS bounce to /dashboard on every navigation ✅ FIXED

**Status:** ✅ FIXED — auto-seed shipped in commit `119a466`, executed correctly after W7 retry shipped in `8f5c9ba`. Verified live on `sanoposlivetest1778021564659` 2026-05-07 — session.context now contains `{ scope_mode: "single_branch", active_outlet_id: 1, active_company_id: null }` after login; Floor Plan, Checks, KDS all load without bouncing.
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

### W2 — Menu Schedules crashes with React error #310 (rendered more hooks than previous render) ✅ FIXED

**Status:** ✅ FIXED — commit `119a466` hoisted the `useMemo` above the early-return block in `frontend/src/pages/redesign/restaurant/MenuSchedulesRedesign.jsx`. Verified live 2026-05-07 — page now renders the 7×24 weekly grid + editor pane cleanly, zero console errors. Five sibling restaurant files were grepped during the fix; none had the same hook-after-early-return pattern.
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

### W3 — Sidebar restaurant section invisible for ~1.5s after every navigation ✅ FIXED

**Status:** ✅ FIXED — commit `119a466` warm-caches resolved feature flags in `localStorage["sanopos_feature_flags_cache_v1"]`; `useFeatureFlags` now seeds initial state from cache (preserving `phase4_*` truth across reloads) and revalidates in background. `clearSession` also wipes the cache to prevent leakage between tenants on the same browser. Verified live 2026-05-07 — Restaurant section visible on first paint after login (initial DOM probe shows "Restaurant" group present, no 1.5s flicker).
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

### W4 — Sidebar nav links to restaurant routes are React-Router clickable but bounced (W1 cascade) ✅ FIXED

**Status:** ✅ FIXED — resolved automatically by W1 fix. Verified live 2026-05-07 — clicking Floor Plan from the sidebar now lands on `/restaurant/floor` instead of bouncing back to `/dashboard`.
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

### W7 — Transient 401 on `/api/context/bootstrap` during first render after login ✅ FIXED (in PresetContext path)

**Status:** ✅ FIXED — commit `8f5c9ba` adds a single 600ms-delayed retry on 401 inside PresetContext's bootstrap fetch (mirrors ContextSelect's existing transient-error retry pattern). Surfaced as a critical dependency during W1 verification: the original 401 was silently swallowed by `.catch()`, which meant the W1 `writeContext` call (in `.then()`) never fired. With the retry in place, the .then() runs and W1's auto-seed works as intended. Verified live 2026-05-07.

Note: this fix only addresses the PresetContext caller. Other callers of `/api/context/bootstrap` (ContextSelect, ContextSwitcher) had their own retry logic already. The Sentry-pollution side effect is also reduced since fewer 401s bubble up — but if any other early caller exists upstream of the PresetContext useEffect, it could still log a single 401 per session. Future work could move the retry into the `api.js` interceptor itself.
**Severity:** 🔵 POLISH (cosmetic console noise + Sentry pollution) → became 🔴-blocker-via-cascade because W1 depended on the .then() running
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

### W8 — Order Kiosks page crashes with React error #310 (rendered more hooks than previous render) ✅ FIXED

**Status:** ✅ FIXED — commit `9a737e8` (2026-05-08). Hoisted the `useMemo` above the `flagsLoading`/`!flags.phase4_restaurant_qr`/`!hasPerm` early-return block in `OrderKiosksRedesign.jsx`. Live-verified 2026-05-06T18:45 against `sanoposlivetest1778021564659`: `/order-kiosks` renders heading "Order Kiosks", outlet picker (Main Store), counter label input, "Launch counter kiosk" + "Launch table kiosk" buttons, "0 active kiosks / No active kiosks for this outlet" empty state. 0 console errors. Screenshot: `restaurant-walkthrough-fix-order-kiosks-loaded-2026-05-08.png`.

**Follow-up audit (2026-05-08, sister session):** ESLint `react-hooks/rules-of-hooks` swept all `redesign/**/*Redesign.jsx` for the same hook-after-early-return pattern and hardened five more files: `AdminLayout.jsx`, `KDSRedesign.jsx`, `ModifierGroupsRedesign.jsx`, `RestaurantChecksRedesign.jsx`, `RestaurantFloorRedesign.jsx` — each had its `Navigate` early-returns moved BELOW all `useState`/`useCallback`/`useEffect` hooks. Three unrelated cleanup fixes also landed in the same sweep: `InventoryRedesign.jsx` missing `API_BASE` import, `ReportsInventoryAnalytics.jsx:375` orphaned reference to undefined `p`, and a duplicate `kiosk: "Kiosk"` key in `Breadcrumbs.jsx` LABELS. Production build now succeeds with zero `react-hooks/rules-of-hooks` violations. The codebase-wide audit closes the structural footgun this finding flagged.
**Severity:** 🔴 BLOCKER
**Surfaces affected:** `/order-kiosks` (entire admin-side counter/table kiosk launcher)
**Found via:** Playwright walkthrough 2026-05-08, Phase 2 — Restaurant section sweep (resumption)

**Steps to reproduce:**
1. Sign in as Test Owner on `sanoposlivetest1778021564659`
2. Navigate to `/order-kiosks` (sidebar: Restaurant → Order Kiosks)
3. Page-level ErrorBoundary catches a thrown React error and shows "Something went wrong / This section encountered an error. You can try again or reload the page."

**Observed:** Identical "Something went wrong" card to W2. Reloading retriggers.

**Expected:** Counter/Table kiosk launcher renders — outlet picker + counter label input + "Launch counter kiosk" / "Launch table kiosk" buttons + active-kiosk table.

**Console error (raw):**
```
Error: Minified React error #310; visit https://react.dev/errors/310
  at xS [as useMemo]
  at re (https://sanopos.com/assets/OrderKiosksRoute-CG1cL1G-.js:1:2600)
```

**Source / root cause** (verified against code, not docs):
- `frontend/src/pages/redesign/OrderKiosksRedesign.jsx:40-82` — useState/useCallback/useEffect hooks declared unconditionally
- `frontend/src/pages/redesign/OrderKiosksRedesign.jsx:84-86` — three early returns AFTER the hook block:
  ```js
  if (flagsLoading) return null;
  if (!flags.phase4_restaurant_qr) return <Navigate to="/" replace />;
  if (!hasPerm("manage_restaurant")) return <Navigate to="/" replace />;
  ```
- `frontend/src/pages/redesign/OrderKiosksRedesign.jsx:164-169` — `useMemo(() => [...data.counters, ...data.tables])` called AFTER the early-return block
- First render: `flagsLoading=true` → bails at line 84 → useMemo never called.
- Second render after flags load: passes line 84 → useMemo called → hook count differs → React #310.

**Same bug class as W2 (Menu Schedules)**, but the W2 fix in commit `119a466` only audited `redesign/restaurant/*Redesign.jsx`. `OrderKiosksRedesign.jsx` lives in `redesign/` directly (not `redesign/restaurant/`), so it wasn't checked.

**Screenshots:**
- `restaurant-walkthrough-phase2-order-kiosks-react310-2026-05-06.png`

**Suggested fix:** Move the `useMemo` (line 164) before the early-return block (line 84). Easy, ~1 minute. Then grep ALL `redesign/**/*Redesign.jsx` for the same `useFeatureFlags` + early-return + later-hook pattern as a permanent audit (cheaper to write a lint rule than to keep finding these one-by-one).

**Possible permanent fix:** custom ESLint rule that flags any hook call below an early-return inside a flag-gated component, OR move the `flagsLoading` short-circuit to a parent wrapper component so child renders never see different hook counts.

---

### W9 — Six restaurant routes typo `req.context?.outlet_id` (snake_case) but middleware writes `req.context.outletId` (camelCase) ✅ FIXED

**Status:** ✅ FIXED — commit `9a737e8` (2026-05-08). All 6 sites updated: `restaurant.js:23, 114, 162`, `restaurant-inbox.js:24`, `kds.js:15, 79`. Replaced `req.context?.outlet_id` with `req.context?.outletId`. `node -c` syntax-checked all three files. Verified by `grep -nE "req\.context\?\.outlet_id|req\.context\.outlet_id" backend` returns no matches.

Live-verified 2026-05-06T18:45 against `sanoposlivetest1778021564659`:
- `/pos` (auto-redirected to `/pos/restaurant`) → console clean, 0 errors. Network: `GET /api/restaurant/floor-plans` returns **200** (was 400).
- Direct fetch with `x-outlet-id: 1` header but NO `?outlet_id=` query: status 200, body `{ floor_plans: [] }`. Confirms the `req.context.outletId` fallback path now works.
**Severity:** 🟡 ISSUE (functional latently — masked because frontend almost always passes `outlet_id` query)
**Surfaces affected:** any code path that hits restaurant/KDS/inbox routes WITHOUT `?outlet_id=` query — currently the POS Restaurant initial floor-plan fetch
**Found via:** Playwright walkthrough 2026-05-08, Phase 2 — Commerce/Catalog/Inventory sweep, observed 400 in console while opening `/pos/restaurant`

**Steps to reproduce:**
1. Sign in
2. Navigate to `/pos` (auto-redirects to `/pos/restaurant` for restaurant tenant)
3. Console shows: `Failed to load resource: the server responded with a status of 400 () @ https://api.sanopos.com/api/restaurant/floor-plans:0`
4. Network: `GET /api/restaurant/floor-plans` (no query) → `{ "error": "outlet_id required" }` 400

**Observed:** 400 swallowed silently; POS still loads with takeaway/delivery/drive-thru buttons. Error visible in console + Sentry.

**Expected:** Backend should fall back to `req.context.outletId` (set by `resolveContext` middleware from `x-outlet-id` header — verified populated correctly client-side post-W1 fix).

**Source / root cause** (verified against backend + frontend):
- `backend/middleware/tenant-auth.js:96` writes `req.context.outletId = decoded.oid` (camelCase)
- `backend/middleware/tenant-auth.js:296` writes `req.context.outletId = Number(outletId)` (camelCase)
- 6 restaurant-domain routes read the wrong property:
  - `backend/routes/restaurant.js:23` `req.context?.outlet_id` (snake_case, never matches)
  - `backend/routes/restaurant.js:114` (same)
  - `backend/routes/restaurant.js:162` (same)
  - `backend/routes/restaurant-inbox.js:24` (same)
  - `backend/routes/kds.js:15` (same)
  - `backend/routes/kds.js:79` (same)
- Remaining backend code uses `req.context.outletId` (camelCase) consistently — the 6 restaurant sites are the typo.
- Frontend `RestaurantFloorGrid.jsx:42` calls without `?outlet_id=` query → backend's "fall back to context" path fires → property doesn't exist → 400.

**Why this didn't surface earlier:** most restaurant routes are called WITH `?outlet_id=` query from the frontend (admin pages explicitly pass it). The POS restaurant variant initial-load is the rare site that omits the query and relies on context fallback.

**Console error (raw):**
```
Failed to load resource: the server responded with a status of 400 ()
@ https://api.sanopos.com/api/restaurant/floor-plans:0
```

**Suggested fix:** find/replace `req.context?.outlet_id` → `req.context?.outletId` across the 6 sites. Mechanical fix, no risk. Optional bonus: lint rule banning `req.context.outlet_id` in favor of `req.context.outletId`.

---

### W10 — Restaurant preset label drift: page heading says "Guests" but sidebar nav, breadcrumb, and Customer Groups link all say "Customers" ✅ FIXED

**Status:** ✅ FIXED — commit `9a737e8` (2026-05-08). Added a `translateNavLabel` helper in `AppLayoutRedesign.jsx` that consults `usePreset().labels.customer / customers / product / products` and rewrites group names + nav item names accordingly. Same helper inlined into `Breadcrumbs.jsx`. Replace order is plurals-then-singulars to avoid "Customer" inside "Customers" being substituted first. JSX parse-checked; existing layout unit tests still pass.

Live-verified 2026-05-06T18:46 against `sanoposlivetest1778021564659`:
- Sidebar group header now reads **"Guests"** (was "Customers"), with items **"Guests" / "Guest Groups" / "Guest Invoices"** (was Customers / Customer Groups / Customer Invoices).
- `/customers` page: breadcrumb says **"Guests"** and h1 heading says **"Guests"** — fully consistent now.
- All 15 sidebar group labels enumerated: Overview / Sell / **Guests** / Catalog / Inventory / Procurement / Fulfillment / Online Store / Restaurant / Finance / Insights / People / Compliance / Setup / Account.
**Severity:** 🔵 POLISH
**Surfaces affected:** sidebar nav (`Customers`, `Customer Groups`, `Customer Invoices`), breadcrumb on /customers, breadcrumb on /customer-groups, label inconsistency between page heading vs nav
**Found via:** Playwright walkthrough 2026-05-08, Phase 2 — Customers item

**Steps to reproduce:**
1. Sign in to restaurant tenant
2. Click Customers in sidebar — sidebar says "Customers" but page heading says "Guests"
3. Same for Customer Groups (sidebar shows "Customer Groups", page heading uses preset labels but nav doesn't)

**Observed:** Restaurant preset properly applies the `customer → Guest` label to page headings via `usePreset()`, but the sidebar nav config (`frontend/src/ui/nav-config.js`) hardcodes the English labels. Same for the breadcrumb's `LABELS` map (`frontend/src/ui/Breadcrumbs.jsx`).

**Expected (per `industry-config.js` `restaurant.labels.customer = "Guest"`):** sidebar should also localize via the preset; "Guests" / "Guest Groups" / "Guest Invoices" — at least for restaurant industry.

**Risk:** zero functional. Cognitive friction — restaurateurs see "Guests" on the page, "Customers" in nav, and have to bridge the gap themselves.

**Suggested fix:** make `nav-config.js` consume `usePreset().labels.customer` for the customer-related nav entries. Or accept the inconsistency and document it. Or remove the preset label override entirely and pick one canonical term.

---

### W11 — `*/1` inside JSDoc block comment closes the comment early; took out 3 restaurant workers ✅ FIXED

**Status:** ✅ FIXED — commit (next push) (2026-05-08)
**Severity:** 🔴 BLOCKER for Phase 3 (Phase 1+2 unaffected — original 14 workers ran fine)
**Surfaces affected:** `course-release-sweep`, `kds-load-snapshot`, `reservation-reminder-check` workers — all three never registered after Railway env vars were enabled
**Found via:** Phase 3 prep — sister Claude session enabled `COURSE_RELEASE_WORKER_ENABLED=1`, `KDS_SNAPSHOT_WORKER_ENABLED=1`, `RESERVATION_REMINDER_WORKER_ENABLED=1` on Railway and redeployed. Boot logs showed 14 workers register, then `[boss] Failed to start pg-boss: Unexpected token '*'` and the remaining workers never started.

**Actual root cause** (verified by `require()` in isolation, not docs):
- `backend/workers/course-release-worker-boss.js:9` JSDoc comment contains the literal text `` `*/1 * * * *` ``
- `*/` inside a JS block comment ends the comment. The `1 * * * *` after it was parsed as JavaScript code
- Result: `node -e "require('./workers/course-release-worker-boss')"` throws `SyntaxError: Unexpected token '*'` at the file's line 9, before any pg-boss code runs
- The two workers AFTER course-release in `boot/workers.js` (kds-snapshot, reservation-reminder) never even got their `require()` triggered — the chain's shared `.catch()` swallowed the SyntaxError and only logged `err.message`, masking the real source

**Repro (read-only):**
```sh
node -e "try { require('./backend/workers/course-release-worker-boss'); } catch (e) { console.log(e.message); console.log(e.stack.split(String.fromCharCode(10)).slice(0,3).join(String.fromCharCode(10))); }"
# → Unexpected token '*'
# → backend/workers/course-release-worker-boss.js:9
# →  * pg-boss schedules cron-style. This worker uses `*/1 * * * *`
```

**Why the diagnosis took two passes:**
- The error message `Unexpected token '*'` plus the cron string in the worker (`* * * * *`) made the cron parser look like the prime suspect. But local cron-parser tests showed `* * * * *` parses fine, and direct SQL on Supabase also accepted the schedule. Misdirection from a coincidence.
- The `boot/workers.js:390` `.catch()` only logged `err.message` (no `err.stack`), and ALL register-worker calls were in a single chain — so one failure killed every subsequent worker silently. There was no signal that the failure was at `require()` time, not in pg-boss.

**Fixes shipped:**
1. `backend/workers/course-release-worker-boss.js:9` — replaced `` `*/1 * * * *` `` with `"* * * * *"` in the comment so the comment doesn't self-terminate.
2. `backend/boot/workers.js` — wrapped each `register*Worker(...)` call in a `tryRegister(label, fn)` helper that catches per-worker, logs the `label` + full `err.stack`, and continues. Outer `.catch()` also upgraded to log `err.stack`. (Commit `5879ee8` shipped this resilience first; the actual code fix in this entry.)

**Verification (live, 2026-05-06T18:28:51 UTC, container `932cca09f57f`):**
- Boot logs:
  - `Course-release worker (pg-boss) registered — every minute`
  - `KDS load-snapshot worker (pg-boss) registered — every 15 min`
  - `Reservation reminder worker (pg-boss) registered — every 15 min`
- Supabase `pgboss.schedule` now has 3 new rows: `course-release-sweep` (cron `* * * * *`), `kds-load-snapshot` (`*/15 * * * *`), `reservation-reminder-check` (`*/15 * * * *`). All `timezone=UTC`, `updated_on=2026-05-06 18:28:51`.
- Bonus confirmation from the intermediate `5879ee8` deploy (container `7477a197ece1`): per-worker isolation worked exactly as intended — only `[boss] register course-release failed: SyntaxError: Unexpected token '*'` was logged at the right file:line, and kds-snapshot + reservation-reminder both registered cleanly afterwards. That's how the actual root cause was pinpointed in one boot cycle.

**Lessons / preventable recurrences:**
- Any JSDoc comment that wants to embed a cron expression containing `*/` should escape it (e.g. wrap in single-quoted double-asterisk) or use `*\/N` or just write it as `"* * * * *"`. Even safer: ESLint rule `no-irregular-whitespace` or a custom rule banning `*/` outside of comment delimiters.
- The chain-of-awaits-with-one-shared-catch pattern is a known footgun. The post-fix `tryRegister` isolation makes future single-worker failures self-identifying.

---

### W12 — Floor Plan "New Plan" button is a no-op; no plan/table create UI exists ✅ FIXED

**Status:** ✅ FIXED — commit `6151331` (2026-05-07)
**Severity:** 🔴 BLOCKER (gates Phase 3 flows 3.1, 3.2, 3.3, 3.6 — every flow that needs a table)
**Surfaces affected:** `/restaurant/floor` (Floor Plan page) — and by extension every restaurant flow that requires a seated table session
**Found via:** Phase 3 Playwright walkthrough 2026-05-07, flow 3.1 step 1

**Steps to reproduce:**
1. Log in as Test Owner on `sanoposlivetest1778021564659`
2. Sidebar → Restaurant → Floor Plan (lands on `/restaurant/floor` cleanly — W1 fix holds)
3. Click "New Plan" button (top-right of `PageShell`)
4. Nothing happens. No modal, no inline form, no toast, no navigation, no console error.

**Observed:** Click registers (button receives focus, `[active]` state in DOM), but produces zero visible effect.

**Expected:** Either a modal or an inline form to capture floor plan name, then `POST /api/restaurant/floor-plans` with `{ name, outlet_id }` and refresh `loadPlans()`.

**Console/network errors:** None. Console totally silent.

**Screenshot:** `restaurant-walkthrough-phase3-3.1-new-plan-noop-2026-05-07.png`

**Suspected root cause:**
- `frontend/src/pages/redesign/RestaurantFloorRedesign.jsx:76` — `<Button size="sm" onClick={() => {}}>` literally has an empty no-op handler. There is no `useState` for any "show new plan modal" flag, and no `<Modal>` for plan creation in the file (read in full — only the seat-session modal at line 114 exists).
- The same page (lines 91-112) also renders the table grid read-only — there is no "Add Table" CTA. So even if a plan were seeded by some other means (DB, API), the user couldn't add tables to it from the UI.

**Backend confirms the endpoints exist** (so this really is a missing-frontend-wiring bug, not an endpoint-not-implemented issue):
- `backend/routes/restaurant.js:42` — `POST /api/restaurant/floor-plans` (validated by `createFloorPlanSchema`)
- `backend/routes/restaurant.js:78` — `POST /api/restaurant/tables` (validated by `createTableSchema`)
- `backend/routes/restaurant.js:91` — `PUT /api/restaurant/tables/:id` (drag-to-reposition support)

**DB state confirms zero seed data:**
```sql
SELECT COUNT(*) FROM tenant_sanoposlivetest1778021564659.restaurant_floor_plans;  -- 0
SELECT COUNT(*) FROM tenant_sanoposlivetest1778021564659.restaurant_tables;       -- 0
SELECT COUNT(*) FROM tenant_sanoposlivetest1778021564659.restaurant_table_sessions; -- 0
```

**Why nothing in the codebase wires this:**
```
$ grep -r "api\.post.*floor-plans" frontend/src   # → 0 matches
```
Zero frontend callers ever POST to `/api/restaurant/floor-plans`. The wiring was never built.

**Suggested fix:**
1. In `RestaurantFloorRedesign.jsx`, add `const [showNewPlanModal, setShowNewPlanModal] = useState(false)` and `const [planName, setPlanName] = useState("")`.
2. Replace `onClick={() => {}}` at line 76 with `onClick={() => setShowNewPlanModal(true)}`.
3. Add a `<Modal>` block similar to the existing seat-session modal (lines 114-126) that captures plan name, calls `await api.post("/api/restaurant/floor-plans", { name: planName, outlet_id: readContext().active_outlet_id })`, then `loadPlans()` and closes.
4. Add an "Add Table" CTA inside the active-plan view that POSTs to `/api/restaurant/tables` with `{ floor_plan_id, label, capacity, shape, pos_x, pos_y }`. Without table-creation UI the floor plan is decorative.
5. Verify backend `createFloorPlanSchema` field shape (likely `{ name, outlet_id }`; read `backend/schemas/restaurant.js` before sending).

**Severity reasoning:** Without a floor plan and tables, the entire dine-in workflow (3.1, 3.2, 3.3, 3.6) cannot be exercised. Even 3.4 (online inbox → fire) is partially affected because acceptance flows that route to a table need a target table. This is not a polish issue — it's a brand-new restaurant tenant on day 1 cannot start using the product.

**Discovery surprise:** Phase 2 walkthrough on 2026-05-07 (morning) verified `/restaurant/floor` "renders Floor Plan title + '+ New Plan' CTA" and called it ✅ FIXED for W1. That verification looked at *render*, not at *function*. The button rendered, so W1 was closed. But W1 was about the auth-bounce; the button-does-nothing bug is a separate latent regression that no one clicked into until Phase 3. **Lesson:** verifying a page "loads" is not the same as verifying its primary CTA works. Phase 2 sweep should have included a quick "click each primary CTA, expect *something* (modal/nav/toast)" check.

**Fix shipped (commit `6151331`, 2026-05-07):**
- Replaced `onClick={() => {}}` at `RestaurantFloorRedesign.jsx:76` with `onClick={() => setShowPlanModal(true)}`
- Added `<Modal>` block using `Modal/ModalBody/ModalFooter` primitives — captures plan name, POSTs to `/api/restaurant/floor-plans` with `{ name, outlet_id: readContext().active_outlet_id }`, refreshes plans, auto-activates the new plan
- Added "Add Table" CTA inside the active-plan view + matching `<Modal>` — captures label/capacity/shape, POSTs to `/api/restaurant/tables` with auto-incremented `pos_x` (0, 100, 200, …) so tables don't stack at (0,0)
- Added `<EmptyState>` blocks for "no plans yet" and "no tables in this plan"

**Live verification (against `https://sanopos.com` tenant `sanoposlivetest1778021564659`):**
- Created plan "Main Floor" via the UI — DB row: `{ id:1, name:"Main Floor", outlet_id:1, is_active:true }` ✅
- Created tables T1, T2, T3, T4 via the UI — DB rows present with capacity=4, shape=square, pos_x=0/100/200/300 ✅
- After plan creation the "Add Table" CTA appeared and the per-plan empty state rendered ✅
- After 4 tables, all 4 cards render with their `Seat` CTA ready for flow 3.1 step 3
- Screenshot: `restaurant-walkthrough-w12-fixed-floor-with-4-tables-2026-05-07.png`

---

### W13 — Restaurant POS unconditionally requires `phase2_draft_orders`, but seed deliberately excludes it ✅ FIXED

**Status:** ✅ FIXED — commit `58cb791` (2026-05-07)
**Severity:** 🔴 BLOCKER (every restaurant tenant created via the standard signup wizard hits this on first attempt to send items to kitchen / fire a course)
**Surfaces affected:** `/pos/restaurant` — the entire restaurant POS check view. Triggered by `Send to Kitchen` and any `Fire C{n}` button
**Found via:** Phase 3 Playwright walkthrough 2026-05-07, flow 3.1 step 6

**Steps to reproduce:**
1. Create a fresh restaurant tenant (Cafe / Restaurant industry in signup wizard)
2. Go to `/pos/restaurant`, open shift, seat T1, add a Caesar Salad to seat 1 / course 1 (Appetizer)
3. Click `Fire C1`

**Observed:** Banner at top: `Feature disabled: phase2_draft_orders`. Console: `Failed to load resource: the server responded with a status of 403 () @ https://api.sanopos.com/api/draft-orders`. The fire-course request never reaches the kitchen; KDS stays empty.

**Expected:** Either the restaurant POS should not depend on `phase2_draft_orders`, or the flag should be ON for all restaurant tenants by default.

**Suspected root cause:**
- Frontend: `frontend/src/pages/redesign/pos/POSContext.jsx:405-415` — `ensureDraftOrder()` unconditionally `api.post("/api/draft-orders", { order_context, table_session_id, seat_count })`. Called from the restaurant cart flow (when items are added with seat/course context) and from `Send to Kitchen` / `Fire C{n}`.
- Backend: `backend/routes/draft-orders.js:4` — `requireFeature("phase2_draft_orders")` on every route, returns 403 when flag absent.
- Seed: `backend/services/retail-flag-preset.js` — `RESTAURANT_SEED_FLAGS` (10 flags) deliberately excludes `phase2_draft_orders` per `tests/unit/retail-flag-preset.test.js:65` ("RESTAURANT_SEED_FLAGS excludes retail-only POS flags that don't apply to F&B"). This is a stale assumption — Phase 2-R restaurant POS does need draft orders for the table-service flow because table sessions back checks via draft orders.

**Heal applied to test tenant** (so Phase 3 can continue):
```sql
INSERT INTO tenant_sanoposlivetest1778021564659.feature_flags (key, enabled)
VALUES ('phase2_draft_orders', true)
ON CONFLICT (key) DO UPDATE SET enabled = true;
```
Verified flag returned `true`. Awaiting 60s cache flush before retrying Fire C1.

**Suggested permanent fix:**
1. **Preferred:** Add `phase2_draft_orders` to `RESTAURANT_SEED_FLAGS` in `services/retail-flag-preset.js`. Update the unit test `retail-flag-preset.test.js:17` (10 → 11) and remove `phase2_draft_orders` from the exclusion list at line 65. Also add it to `MODE_REGISTRY.restaurant.feature_flags_to_enable` so existing tenants get it via mode reseed.
2. **Alternative:** Make `phase2_draft_orders` a default-enabled flag for `phase4_restaurant` tenants — change the route guard in `routes/draft-orders.js` to `requireAnyFeature(["phase2_draft_orders","phase4_restaurant"])`. Cheaper but couples two unrelated concerns.
3. Heal existing restaurant tenants on production via a one-shot admin script that flips the flag for every tenant where `phase4_restaurant=true`.

**Severity reasoning:** This blocks the kitchen-fire path on every brand-new restaurant signup. A restaurant cannot operate without sending tickets to the kitchen. Without the heal, no Phase 3 flow that touches the kitchen (3.1, 3.2, 3.4 — and 3.6 once items move from kiosk to fire) works.

**Surprise:** the test that documents the exclusion (`retail-flag-preset.test.js:56-70`) calls these "retail-only POS flags that don't apply to F&B" — but Phase 2-R then introduced the restaurant cart that *does* depend on this same flag's backing route. Whoever shipped Phase 2-R should have updated the seed; the test still passes because the assertion is about absence, not about whether the absence is correct.

**SECOND-LAYER FINDING (not just config):** after enabling the flag the call still fails — `400 outlet_id is required`. The restaurant POS `ensureDraftOrder()` POSTs `{ order_context, table_session_id, seat_count }` (POSContext.jsx:407-411), but the backend `/api/draft-orders` POST handler at `backend/routes/draft-orders.js:67-71` reads `{ outlet_id, customer_id, notes, items }` and rejects when `outlet_id` or `items` are missing. The two sides have **drifted contracts** — frontend speaks restaurant-cart, backend speaks retail-park-sale. This means even with `phase2_draft_orders=true` the restaurant fire-course path is non-functional in production.

The full fix surface is therefore:
1. **Seed update** (above) so restaurant tenants get the flag.
2. **Backend contract update** — `/api/draft-orders` POST must accept restaurant-mode payload: `order_context`, `table_session_id`, `seat_count`, with `outlet_id` derivable from `req.context.outletId` (or the table session's outlet) and `items` allowed empty (the restaurant POS creates an empty draft and adds items via a separate endpoint as the cart fills).
3. **OR** (cleaner): split into `/api/draft-orders/restaurant` (or similar) so the two flows don't share a shape. Mirror what the kiosk inbox does for `web_orders`.

Until both ship, no restaurant tenant can fire a course in production. This was masked in dev by the test suite because integration tests for `pg-phase21a-courses.test.js` (course-based ordering) probably create the draft order via direct DB INSERT, not through the live POS API path.

---

### W14 — Cart items never sync to draft order before fire/send/pay-at-table ✅ FIXED

**Status:** ✅ FIXED — commit `bd3003d` (2026-05-07)
**Severity:** 🔴 BLOCKER (downstream of W13; even with W13 shipped the kitchen never received items)
**Surfaces affected:** `/pos/restaurant` — `Send to Kitchen`, every `Fire C{n}`, and `Request QR` (pay-at-table) actions
**Found via:** Phase 3 Playwright walkthrough 2026-05-07, flow 3.1 step 6 (after W13 fix verified live)

**Steps to reproduce (pre-fix):**
1. Apply the W13 fix (`/api/draft-orders` POST accepts restaurant shape).
2. Open restaurant POS, seat T1, add Caesar Salad + Iced Tea to the cart.
3. Click `Fire C1`.

**Observed (pre-fix):**
- POST `/api/draft-orders` succeeds (W13 fix). DB shows `draft_orders.id=1` with `outlet_id=1, table_id=1, table_session_id=1, order_context='dine_in', seat_count=2, total='0.00'`. ✅
- `restaurant_course_fires` shows 1 row (the fire event recorded). ✅
- `draft_order_items` count = **0**. ❌
- `kds_tickets` count = **0**. ❌
- UI advances `Fire C1` → `Fire C2`, but the kitchen receives nothing.

**Expected:** items in the local cart should land in `draft_order_items` so they can actually be fired to KDS.

**Suspected root cause:**
- `frontend/src/pages/redesign/pos/restaurant/RestaurantActionBar.jsx:55-87` — `sendToKitchen()` and `fireNextCourse()` both did `await ensureDraftOrder()` (creates an empty draft) then immediately POSTed to `/api/restaurant/checks/:id/send-to-kitchen` or `.../fire-course`. Neither pushed the local cart to the backend.
- The cart only existed in React state (`useCart`) and was never persisted until `completeSale` (which runs at Pay time, not Fire time).
- The retail flow doesn't have this gap because retail's `parkSale` POSTs the full cart in one shot; restaurant's lazy-ensure-then-act pattern skipped the items entirely.

**Fix shipped:** `RestaurantActionBar.jsx` adds a `syncCartToDraft(draftId)` helper that PUTs `{ items: cart.map(...) }` to `/api/draft-orders/:id` before each fire/send/QR action. The existing PUT handler (`backend/routes/draft-orders.js:111-165`) deletes-and-rebuilds the items array + recomputes totals on every call, so calling it idempotently before each kitchen action keeps the backend in sync with whatever the cashier has on screen — including 86'd lines, qty bumps, course reassignments. Mapping is direct: cart `{id, variant_id, name, quantity, price, seat_number, course_name}` → PUT body shape.

**Live verification:** pending — awaiting Vercel redeploy to confirm Caesar Salad + Iced Tea round-trip from cart → draft_order_items → KDS ticket.

**Surprise:** this gap has lived since Phase 2-R shipped. Anyone testing the restaurant flow against a tenant that *did* have `phase2_draft_orders` enabled (e.g. via the manual heal we did for W13) would have hit this immediately — Fire C1 advances the course counter without firing anything. The integration tests for `pg-phase21a-courses.test.js` probably bypass this by INSERTing draft items directly via SQL, masking the live gap.

---

### W15 — Fresh restaurant tenants have zero KDS stations; Send-to-Kitchen silently routes zero tickets ✅ FIXED

**Status:** ✅ FIXED — commit `dc58973` (2026-05-07)
**Severity:** 🔴 BLOCKER
**Surfaces affected:** `/pos/restaurant` Send-to-Kitchen for any restaurant tenant signed up via the standard wizard
**Found via:** Phase 3 walkthrough flow 3.1 — Send-to-Kitchen click returned 200 and the UI showed "Sent" but the kitchen never received tickets

**Root cause:** `backend/services/restaurant-kds.js sendToKitchen()` resolves a station per item via `findMatchingRoutes` → `pickByStrategy`. With zero `kds_stations` rows for the outlet, every item gets `targetStation = null` and is skipped. The route returns `{ tickets: [] }` (200 OK). Tenant signup (`backend/routes/setup.js`) seeded categories + products + flags + roles + outlet but never seeded a default KDS station.

**Fix shipped:**
- `backend/routes/setup.js` — after outlet creation, when `industry_type` is `restaurant` or `cafe`, INSERT one row into `kds_stations` (`name='Main Kitchen', station_role='prep', balance_strategy='priority'`). Idempotent via `WHERE NOT EXISTS`.
- `frontend/src/pages/redesign/pos/restaurant/RestaurantActionBar.jsx` — `sendToKitchen()` now reads `result.tickets.length`. Zero tickets surfaces a clear `setError("No kitchen stations configured. Set one up in KDS settings before sending orders.")` instead of the bland success toast. Defense-in-depth so tenants who later delete all stations also see a clear error.

**Live test tenant healed via Supabase MCP** (`INSERT INTO kds_stations VALUES (1, 'Main Kitchen', 'prep', 'priority', true)`) so flow 3.1 walkthrough could proceed without waiting for a fresh signup.

**Verification:** Send-to-Kitchen on T2 created 2 `kds_tickets` rows (id=3 + id=4) routed to station_id=1 with correct table_label=T2, seat_label=S1, course_name=course_1/course_5, status='new'. KDS page rendered both, both bumped successfully (status='bumped', prep_seconds 52s + 64s).

---

### W16 — Cart not rehydrated when re-entering a seated table mid-service ✅ FIXED

**Status:** ✅ FIXED — commit `7a16c8e` (2026-05-07)
**Severity:** 🟡 ISSUE
**Surfaces affected:** `/pos/restaurant` — re-entering a seated table after navigating away (KDS, Sales History, browser refresh, shift change)
**Found via:** Phase 3 walkthrough flow 3.1 — after firing C1 on T1, navigated to /kds to bump tickets, returned to T1 → cart was empty even though `draft_order_items` had 2 rows

**Root cause:** `frontend/src/pages/redesign/pos/POSContext.jsx:386-394` — `openCheck()` always clears cart (`cartHook.setCart([])`). When a cashier comes back to a seated table mid-service, the local React state is reset and the existing draft items in the backend are not fetched. The backend has the data (`draft_order_items` rows tied to `table_session_id`); the frontend just never asked for them.

**Risk:** double-add. A cashier returning to a table sees an empty cart, doesn't realise items are already in the kitchen, and re-adds them — leading to duplicate orders.

**Fix shipped:**
- `backend/routes/draft-orders.js` — `GET /api/draft-orders` now accepts a `table_session_id` query param so the floor view can find the open draft by table session.
- `frontend/.../RestaurantFloorGrid.jsx` — `performOpen()` is now async; after `openCheck()` runs, it calls `GET /api/draft-orders?table_session_id=N&status=open,claimed` to find the latest draft, fetches its items via `GET /api/draft-orders/:id`, and seeds the local cart from `draft_order_items`. Each restored cart item carries its `kitchen_status` so future syncs can short-circuit.
- `frontend/.../RestaurantActionBar.jsx` — `syncCartToDraft()` short-circuits when every cart item is already `'sent'` or `'fired'`. Without this, re-clicking Send-to-Kitchen on a rehydrated cart would PUT-rebuild the items and re-fire them.

**Known follow-up (acceptable for this sitting):** if a cashier rehydrates THEN adds new items, the `syncCartToDraft` PUT does a full replace including the rehydrated items. The PUT handler delete-and-rebuilds, so the rehydrated items will get fresh ids and `kitchen_status='pending'` — but they're still tied to the same draft, so a subsequent fire would re-fire them. The cashier-visible behaviour is correct; the backend cleanliness needs an "additive PUT" or a dedicated "append items" endpoint as a wider refactor. Not launch-blocking; documented in the commit body.

**Verification:** pending live test on T3.

---

### W17 — Settle leaves table 'seated' and draft 'open' indefinitely ✅ FIXED

**Status:** ✅ FIXED — commit `7a16c8e` (2026-05-07)
**Severity:** 🟡 ISSUE
**Surfaces affected:** `/pos/restaurant` floor view — table never returns to "Tap to seat" after a successful sale; busser has no signal to clean up
**Found via:** Phase 3 walkthrough flow 3.1 — after Complete Sale on T2, floor view continued to show T2 as `SEATED 2 guests`. DB confirmed: `restaurant_table_sessions.status='seated'`, `draft_orders.status='open'`. The plan explicitly called this out at line 227: "table T1 should show 'dirty' status post-settle".

**Root cause:** `backend/routes/sales.js` POST `/api/sales` did not destructure `table_session_id` from the body and did nothing to transition the linked draft / session after the sale row was committed. The frontend was already passing both `draft_order_id` AND `table_session_id` in the payload (verified at `useCheckout.js:292,294`). Schema v61 widened `restaurant_table_sessions_status_check` to include `'dirty'` precisely for this transition; nothing was actually flipping the row.

**Fix shipped:**
- `backend/routes/sales.js` — destructure `table_session_id` alongside `draft_order_id`. After the sale INSERT, fire two best-effort UPDATEs: `draft_orders SET status='completed' WHERE id=$draft AND status IN ('open','claimed')` and `restaurant_table_sessions SET status='dirty' WHERE id=$session AND status NOT IN ('closed','dirty')`. Both `.catch()` log-only — failures don't roll back the sale.
- `frontend/.../RestaurantFloorGrid.jsx` — `STATUS_TONE.dirty` added (violet pill). `TableTile` now treats `dirty` as a third state separate from "seated" — renders a violet card with "Needs Bussing" pill and a "Clear Table" pill that PUTs `status='closed'` to release the table for the next party. Card click is a no-op for dirty tables so a server doesn't accidentally re-open the closed check.

**Verification:** pending live test on T3.

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

### W18 — No "Open Tab" / bar-tab CTA on Restaurant POS landing despite backend support

**Status:** OPEN
**Severity:** 🟡 ISSUE (functional gap — backend feature unreachable from UI)
**Surfaces affected:** Restaurant POS landing (`/pos/restaurant`); flow 3.2 (Walk-in tab) per `pre-launch-walkthrough-plan-2026-05-07.md` line 230
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 1

**Steps to reproduce:**
1. Login → `/pos/restaurant`
2. Inspect the action-bar buttons rendered above the floor.

**Observed:** Three walk-in CTAs render — `New Takeaway`, `New Delivery`, `New Drive-Thru`. Plus 4 table tiles (T1–T4). No "Open Tab" / "Bar Tab" / "Walk-in Tab" button. Per Restaurant POS landing button DOM scrape, the only buttons are the three takeout types and the four table tiles.

**Expected:** Per the script and per backend support, an "Open Tab" CTA that lets a cashier name a tab (e.g. "John W") and ring up items against it without seating a table — the canonical bar-tab pattern.

**Backend evidence the feature exists:**
- `backend/schemas/restaurant.js:79` exports `createTabSchema` (also documented in `backend/schemas/CLAUDE.md` "Restaurant schemas" section)
- `backend/routes/restaurant.js:366` mounts `POST /api/restaurant/tabs` with `validate(createTabSchema)`
- `backend/routes/restaurant.js:375` mounts `POST /api/restaurant/tabs/:id/close`
- `backend/schemas/restaurant.js:43` `createCheckSchema` has a `tab_id` branch alongside `table_session_id`
- `backend/schemas/restaurant.js:44` `order_context` enum includes `"bar"` and `"drive_thru"` values

**Frontend evidence the feature is unreachable:**
- `frontend/src/pages/redesign/pos/restaurant/RestaurantHeader.jsx:33-35` only maps `dine_in / takeout / delivery` — no `bar` or `drive_thru` mapping; the Drive-Thru CTA likely sets one of the existing 3 contexts
- Repo-wide grep `/api/restaurant/tabs` returns zero matches under `frontend/src` — no caller exists
- Repo-wide grep `tab_id` in frontend returns zero matches — `createCheckSchema`'s tab branch is never wired
- `RestaurantFloorGrid.jsx:177` `openTableCheck` is a *table-session* function, not a tab opener

**Console / network errors:** None — no broken state. Pure missing UI surface.

**Screenshot filename:** None taken (W18 is "absence of a button" — script reflects observed state).

**Suspected root cause:** Restaurant POS landing scaffolded with 3 fixed walk-in buttons + table tiles; bar-tab path was implemented backend-only and never wired into the action bar. Likely the "Walk-in Tab" pattern was punted to a later phase. No commit history check done.

**Impact / severity reasoning:** Bar-tab is a real restaurant pattern (cocktail bar, taproom, café counter where a guest leaves a card open and adds items over an hour). Today merchants must use "New Takeaway" (loses the bar-tab semantics: no name, no separate ledger, gets settled immediately) or seat them at a virtual table. **Not 🔴 launch-blocker** because there is a workaround (use Takeaway or a table) and the script explicitly allows the table fallback. **🟡 because** the backend feature exists, suggesting a UI gap that's mostly mechanical to close — a "+ Open Tab" button + a small modal capturing tab name → POST `/api/restaurant/tabs` → set `orderContext='bar'` + `tabId` → header maps `bar → "Tab: <name>"`.

**Suggested fix:** Add a fourth walk-in button "+ Open Tab" alongside Takeaway/Delivery/Drive-Thru in `RestaurantFloorGrid.jsx`'s top action row. Modal captures tab name. POST → `/api/restaurant/tabs` → use returned `tab.id` as `tab_id` for the next `createCheckSchema` POST. Extend `RestaurantHeader.jsx:33-35` to render `bar → "Tab: <tab_name>"`. Persist `tabId` in `POSContext` next to `tableSessionId`.

**Plan reconciliation:** Walkthrough flow 3.2 says "POS → Open Tab → tab name 'John W' → ... → Split bill by seat". Split-by-seat only makes sense on a seated entity. In practice the script conflates "walk-in tab" with the seat-split flow; in the real product, a bar-tab would have one seat (the named patron) and split-by-seat on a 1-seat tab is degenerate. So even with W18 fixed, the seat-split exercise would be done against a *table* with a tab attached, not a seatless bar-tab. **Walkthrough proceeds using T1 as the walk-in vehicle for "John W"** — exercises the same downstream spine (modifiers → multi-seat assign → split-by-seat → tip pool) without being blocked on W18.

---

### W19 — Restaurant header labels session_id as "Table N" instead of using table label

**Status:** OPEN
**Severity:** 🔵 POLISH (cosmetic; functional flow is unaffected)
**Surfaces affected:** `RestaurantHeader.jsx` — Restaurant POS check view header strip (and its collapsed variant). Visible from the moment a cashier seats a table until they leave the check.
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 1 (post-seat). Seated T1 (`table_id=1`, `label='T1'`) → header rendered `"Table 4"`. Verified via Supabase MCP that the seated session_id is 4 and the matching table is T1.

**Steps to reproduce:**
1. `/pos/restaurant` → tap any table tile (e.g. T1) → confirm Seat modal at 2 guests.
2. Land on the check view.
3. Inspect the dark header strip — top-left badge.

**Observed:** "Table 4" (= the `restaurant_table_sessions.id` from the just-created session row).

**Expected:** "Table T1" (or "T1") — the human-readable `restaurant_tables.label` of the seated table. A cashier doesn't think in session ids.

**Why this matters in production:** Today the test tenant happens to have session_ids 1–4 and tables T1–T4, so the misalignment looks innocuous. In production, `restaurant_table_sessions.id` is a SERIAL that monotonically grows forever — by the 5,000th seating on T1, the header will read `"Table 5000"` while the actual table is T1.

**Suspected root cause file:line:** `frontend/src/pages/redesign/pos/restaurant/RestaurantHeader.jsx:33` —
```jsx
const contextLabel =
  orderContext === "dine_in"   ? `Table ${tableSessionId ?? "—"}` :
  ...
```
The component comment on line 6 even says *"Shows table label + guest count + server name + elapsed time."* — the intent was always to show the label; the implementation just wired the wrong field. `usePOS()` provides `tableSessionId`, `seatCount`, `employee` from line 11 but does not currently expose `tableLabel`.

**Suggested fix (minimal):**
1. In `RestaurantFloorGrid.jsx:177-185`, the `openTableCheck` payload already has access to `table.label` (the floor-grid pre-loaded the table list). Add `tableLabel: table.label` to the `openCheck()` call alongside `tableSessionId`.
2. Add `tableLabel` to `POSContext` state (next to `tableSessionId`).
3. In `RestaurantHeader.jsx:11`, destructure `tableLabel`, then change line 33 to `\`Table ${tableLabel ?? tableSessionId ?? "—"}\``.
4. Same change in the collapsed-strip render (line ~52) and in the cart-collision confirm message (`RestaurantFloorGrid.jsx:341-342` — same `Table ${tableSessionId}` typo).

**Console / network errors:** None.

**Screenshot:** Skipped — header text rendered exactly as DOM-snapshotted (`Table 4`, `Guests: 2`, `Elapsed: 00:12`, `Server: Test Owner`).

---

### W20 — Restaurant cart merges adds by product_id alone, ignoring seat_number / course_name ✅ FIXED

**Status:** ✅ FIXED — commit `5978622` (2026-05-07), Vercel `dpl_8SiacA8Y6DPoJKAohVRCg9hTNFvR`, live-verified on `sanopos.com` against `sanoposlivetest1778021564659` (T1 / session 4): adding Grilled Chicken with Seat 1 then Seat 2 selected now produces TWO cart groups (Seat 1 · Course 3 — × 1 — Rs 1,200; Seat 2 · Course 3 — × 1 — Rs 1,200; total Rs 2,400). Pre-fix it was a single Seat 1 group with × 2. Bundle hashes flipped (`POSRestaurantRoute-CGb7lG-n` → `8hfWe1qh`). Screenshot: `restaurant-walkthrough-w20-fixed-2-seats-2-lines-2026-05-07.png`. Unit tests: 5 new W20 cases added to `cartMath.test.jsx`; full cart-related suite (44 tests across 5 files) passes locally.
**Severity:** 🔴 BLOCKER (breaks split-bill-by-seat flow at the data layer; you cannot get two same-product items onto two different seats from the UI)
**Surfaces affected:** Restaurant POS check view; flow 3.2 step 2-3 (assign first chicken to seat 1, second to seat 2). Also affects every restaurant flow where a cashier rings up the same item for multiple seats — which is most multi-guest tables ordering the same dish.
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2.

**Steps to reproduce:**
1. Seat any table (e.g. T1, 2 guests).
2. SeatCoursePicker shows `Seat 1` selected. Choose any course (e.g. C3 Entrée).
3. Search "grilled" → click Grilled Chicken (Sample). Cart now shows: `Seat 1 · Course 3 · Entrée — Grilled Chicken × 1 — Rs 1,200.00`. ✅ correct.
4. Switch SeatCoursePicker to `Seat 2` (no other change).
5. Search "grilled" → click Grilled Chicken (Sample) again.

**Observed:** Cart shows a single group `Seat 1 · Course 3 · Entrée — Grilled Chicken × 2 — Rs 2,400.00` (one cart line, qty bumped to 2). Seat 2 group is never created.

**Expected:** Cart shows two separate groups — `Seat 1 · Course 3 — × 1` and `Seat 2 · Course 3 — × 1` (each as its own line, since they belong to different guests). This is the canonical two-guests-same-dish pattern that flow 3.2 + split-by-seat depend on.

**Suspected root cause file:line:** `frontend/src/pages/redesign/pos/hooks/useCart.js:227` —
```js
const found = forceNewLine ? null : prev.find((x) => x.id === product.id);
if (found) {
  // increments existing line's quantity
  ...
}
// else: NEW line gets the seat overlay stamped on line 244
```
The merge predicate matches on `product.id` alone. The seat overlay (`overlay.seat_number`, `overlay.course_name`, set by `buildSeatCourseOverlay()` in `POSContext.jsx:425-431`) is only applied on the **first** add of a product. Subsequent adds of the same product collapse onto whatever seat/course the first add used, regardless of the SeatCoursePicker's current state.

**Why this is a 🔴 BLOCKER:**
- Split-bill-by-seat requires items per seat. If the cart can't represent "Grilled Chicken × 1 on Seat 1, Grilled Chicken × 1 on Seat 2", there is nothing for `splitCheckSchema` `split_type: "by_seat"` to split by — both chickens appear on the same seat group's bill.
- The data layer is correct (`draft_order_items` and `sale_items` both have `seat_number` and `course_name` columns; `cartGrouping.js` correctly groups by seat+course). The bug is purely in the cart-add merge predicate.
- Workaround for the walkthrough: bulk-scan mode `"new_line"` (`localStorage["pos_bulk_scan_mode_${deviceId}"] = "new_line"`, see `useCart.js:218-225`) bypasses the merge entirely — every add creates a fresh line. Not a real merchant workaround (forces every add to be a new line, breaking quantity-bumping for legitimate "same item, same seat" adds).

**Suggested fix (one-line for retail-safety):** change line 227's predicate to:
```js
const found = forceNewLine ? null
  : prev.find((x) => x.id === product.id
      && (x.seat_number ?? null) === (seatStamp ?? null)
      && (x.course_name ?? "main") === (courseStamp ?? "main"));
```
This preserves retail's "increment qty" behavior (where every line has `seat_number=null, course_name="main"` so all match) while letting restaurant lines split by the (seat, course) pair. Add a unit test in `frontend/tests/unit/pos-context-open-check.test.jsx` (or `cartMath`-adjacent) that asserts: `addToCart(p, {seat:1,course:"course_1"}); addToCart(p, {seat:2,course:"course_1"})` → 2 lines, not 1.

**Console / network errors:** None — the bug is purely in client-side cart state. No network call yet (no `ensureDraftOrder` until Send to Kitchen / Pay-at-Table per W14 plumbing).

**Screenshot:** `restaurant-walkthrough-phase3-3.2-cart-merged-into-seat1-2026-05-07.png` (will capture before un-blocking).

**Plan implication for flow 3.2:** Cannot exercise split-by-seat as scripted with this bug. Two options to keep the sitting moving:
1. Fix W20 first (~10 min change + test), live-verify, then resume 3.2 step 3 cleanly.
2. Use the `"new_line"` bulk-scan workaround for the walkthrough only — file W20 as found, and note the workaround in the session log so future reads know split-by-seat was exercised under non-default cart settings.

---

### W21 — SplitCheckModal posts to /split without first syncing cart items to the draft ✅ FIXED

**Status:** ✅ FIXED — commit `870fa0e` (2026-05-07), Vercel `dpl_3NTrWBtW2Tq35zgDJrz5wtu4THHr`, live-verified on `sanopos.com`. After re-entering T1 with cart in 2-seat state (Seat 1 + Seat 2 each with 1× Grilled Chicken), kebab → Split → By Seat → confirm now POSTs to `/api/restaurant/checks/6/split` and returns **200** with two child checks: `#7` (`split_parent_id=6, total=1200.00, table_session_id=4`) and `#8` (same shape, distinct `source_token_id`). Backend persists `split_strategy="by_item"` regardless of the requested `split_type` (canonical internal form — items end up assigned per child anyway; cosmetic). Bundle hashes flipped: `POSRestaurantRoute-8hfWe1qh → DVfJc7eg`. Screenshot: `restaurant-walkthrough-w21-fixed-split-by-seat-2026-05-07.png`. Modal exits to floor view on success per spec.
**Severity:** 🟡 ISSUE (UX trap; not a hard blocker if cashier always Sends-to-Kitchen first, but a real merchant who clicks Split immediately on a fresh check gets a baffling 400)
**Surfaces affected:** Restaurant POS check view → kebab → Split → "Split Check" modal in any of three modes (Equal / By Seat / By Item). Flow 3.2 step 4 ("Click 'Split bill by seat' → verify 2 separate checks").
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 4. Immediately after W20 verification — the very next click after confirming Seat 1 / Seat 2 cart lines.

**Steps to reproduce:**
1. Seat any table; add ≥1 item to ≥2 different seats so the cart shows two seat groups.
2. **Do NOT click Send to Kitchen / Fire C{n} / Pay first.**
3. Kebab menu → Split → choose "By Seat" → click Split.

**Observed:** Backend returns `400 {"error":"Need items on at least 2 seats to split"}` (request body: `{"split_type":"by_seat"}`). Toast/error surfaces via `setError`. Cart stays as-is, no checks split.

**Expected:** Either (a) the modal pre-syncs the cart to the draft so the persisted check actually has the items the user can see in the UI, or (b) the Split button is disabled until at least one item is on the server-side check, with a tooltip "Send to kitchen first to enable Split".

**Suspected root cause file:line:** `frontend/src/pages/redesign/pos/restaurant/SplitCheckModal.jsx:42-71`. The `submit()` handler resolves a `checkId` via `ensureDraftOrder()` (creates an empty draft if none exists) but **never** calls `syncCartToDraft(checkId)` before POSTing `/checks/:id/split`. Backend `restaurant-checks.splitCheck` reads `draft_order_items` from the DB, which is empty because the cart was never pushed. Lines 56-58 of the same file even contain a docstring acknowledging the issue for `by_item` mode (*"For 2-R.0 the user would typically Send to Kitchen first, then split"*) — the author knew but didn't add the sync call.

This is the same architectural class as W14 (`fix(restaurant): sync cart items to draft before fire/send/pay-at-table`, commit `bd3003d`): the W14 fix added `syncCartToDraft` before Send-to-Kitchen / Fire / Pay-at-Table, but the Split path was not in the audit and got left out.

**Fix path (single small change):**
1. Open `SplitCheckModal.jsx`. Find `submit()` line 42.
2. After resolving `checkId` (line 49), add `await syncCartToDraft(checkId);` (the same helper W14 introduced — pulled from `usePOS()` next to `ensureDraftOrder`).
3. No backend change. No new test needed (the helper already has its own; this just calls it). Optional: a unit test that mocks `usePOS` and asserts `syncCartToDraft` is called before `api.post('.../split', ...)`.

**Console / network errors:** `1 error` per Split attempt: `Failed to load resource: the server responded with a status of 400 () @ https://api.sanopos.com/api/restaurant/checks/5/split:0`. Response body: `{"error":"Need items on at least 2 seats to split"}`. Request body: `{"split_type":"by_seat"}`.

**Workaround for the walkthrough:** click Send to Kitchen first → that path already calls `syncCartToDraft`, so the items hit the DB. Then open Split → By Seat → confirm. This is the operator-intended flow anyway (fire the food, then split the bill once it's all in the kitchen pipeline), so flow 3.2 can proceed under this workaround.

**Plan implication for flow 3.2:** Use the Send-to-Kitchen-first workaround. File W21 as found. The downstream steps (close both checks separately, tip pool) don't depend on the order of operations.

---

### W22 — `/restaurant/checks` "Close check" button calls a non-existent PUT route

**Status:** OPEN
**Severity:** 🔴 BLOCKER (the only "close check" UI surface on the Checks list page is dead — every click 404s)
**Surfaces affected:** `/restaurant/checks` list page → "Close check" icon button on every row. Affects the post-split flow (need to close split children individually) and any other operational close-from-list scenario.
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 5. Immediately after W21 verified split: clicked "Close check" on row #7.

**Steps to reproduce:**
1. Have any open check on the Checks page (e.g. post-split children #7 + #8 from flow 3.2 step 4).
2. Click the "Close check" icon button on the row.

**Observed:** Toast "HTTP 404" (or `err.message`). Browser console: `PUT /api/restaurant/checks/7 → 404 (text/html)`. Check stays open.

**Expected:** Check transitions to `closed` status (or, ideally, opens a settlement flow that captures payment + tip — see W23 below).

**Suspected root cause file:line:** `frontend/src/pages/redesign/RestaurantChecksRedesign.jsx:92-98`:
```js
const closeCheck = async (checkId) => {
  try {
    await api.put(`/api/restaurant/checks/${checkId}`, { status: "closed" });
    ...
  } catch (err) { toast.error(err.message); }
};
```

The frontend PUTs to `/api/restaurant/checks/:id`. Backend grep of `routes/restaurant.js` shows **no PUT route for that path** — only `POST :id/send-to-kitchen`, `POST :id/fire-course`, `POST :id/split`, `POST :id/courses/{hold,expedite}`, `POST :id/print-bill`, `POST :id/payment-session`. The plain `PUT /:id` doesn't exist. Express returns a default 404 (HTML body, not JSON), confirming no handler is registered.

This appears to be either (a) a backend route that was never written, or (b) a frontend wiring against a planned route that didn't ship. There's no code path on the backend that flips `draft_orders.status='closed'` outside of the sales-completion path (W17 commit `7a16c8e` flips it via the sale insert).

**Suggested fix paths:**
- **Option A (smallest):** add `PUT /api/restaurant/checks/:id` accepting `{status}` to `routes/restaurant.js`. Just maps to `UPDATE draft_orders SET status = $1 WHERE id = $2` with permission gate. Useful for non-payment closures (e.g. void the whole check after manager approval, abandoned check at end of shift). Doesn't capture payment.
- **Option B (correct):** redirect this button to the proper settlement flow. Per W23, closing a check the cashier-friendly way means going through `POSCheckoutModal` (or pay-at-table) which captures payment + tip. The Checks list page should either open the POS check view for that check on click, or open a mini-settlement modal. This is more architectural work.

**Console / network errors:** `PUT /api/restaurant/checks/7 → 404` (Content-Type: text/html, default Express 404). One per click.

**Workaround for the walkthrough:** None directly available. The post-split children #7 + #8 cannot be closed via this button. Possible alternative: switch the active table-session draft to each child via DB or API, then use POS Pay; but POS Pay flows through POSContext.draftOrderId which is the *parent's* draftOrderId, not the child. See W23 for the broader gap.

---

### W23 — No UI path to pay/settle a split-child check (post-split, the children are orphans in the POS)

**Status:** OPEN
**Severity:** 🔴 BLOCKER (split-bill-by-seat is functionally incomplete — the children get created but cannot be paid through the cashier UI)
**Surfaces affected:** Restaurant POS settlement flow after a SplitCheckModal completion. Affects flow 3.2 step 5 ("close both checks separately, capture tip on each") and every restaurant flow that splits a bill before paying. Currently the only thing the cashier can *do* with split children is see them on the `/restaurant/checks` list (W22 makes even closing them broken).
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 5. Trying to identify where to go next after a successful split.

**Architectural gap:**
- After SplitCheckModal succeeds, `onSplitComplete` exits to the floor view (`SplitCheckModal.jsx:73-74`).
- The floor view's table tile re-opens *the* draft for the seated table session via `RestaurantFloorGrid.openTableCheck` — which uses the parent's `tableSessionId / table.session_id`. The split children inherit `table_session_id` but they are sibling rows, not the one resolved by `GET /api/restaurant/floor-plans/:id` per-table fetch.
- POSContext `draftOrderId` is set once at table-open and stays as the parent's id. The Pay button settles `draftOrderId`, which is the parent (now total Rs 0.00 after split items moved to children).
- `POSContext` has no concept of "switch to a different draft for this same table session". There is no UI affordance to choose between #7 and #8 after a split.
- The Checks list page (`/restaurant/checks`) shows the children but its row actions are: Hold a course / Expedite a course / Split check / Close check. Three are course-level operations that don't apply post-split, and the fourth is W22-broken. **No "Settle this check" / "Pay this check" / "Open in POS" button exists on the row.**

**Backend evidence settlement is possible:** `restaurant_payment_sessions` table exists (v61); `POST /api/restaurant/checks/:id/payment-session` route exists (per `routes/restaurant.js`, used by `PayAtTableQRModal.jsx:38`). So pay-at-table per-child *could* work — but the cashier UI never triggers it for split children. PayAtTableQRModal is opened from the action bar's Request QR button on the *currently-open* check, not from the Checks list.

**Plan implication for flow 3.2:** With both W22 and W23 open, **flow 3.2 step 5 cannot be exercised end-to-end via real-cashier clicks.** This is a launch-blocker for split-bill-by-seat — restaurants that intend to split bills cannot complete the workflow.

**Suggested fix paths:**
- **Option A (smallest, partial):** add a "Settle / Pay" button to each row on `/restaurant/checks` that opens the POS check view with `draftOrderId` pre-set to the row's id (and `table_session_id` etc. carried). POSContext would need a "set active draft" entry point.
- **Option B (correct):** after SplitCheckModal completes, route the cashier directly into a per-child settlement queue UI (one settlement modal per child, advancing one to the next). This matches restaurant operating reality: a split request is followed by paying each share.
- **Option C (defer):** scope split-by-seat down to "post-payment audit feature" only — it splits the *receipts* after a single payment. Then the children are reporting/audit rows, not standalone payable entities. Re-frames the data model rather than building UI.

**Workaround for the walkthrough:** None that exercises the script as written. Two alternatives:
1. Skip step 5 and document that this path is blocked. Continue to step 6 (Tip Pools UI) which doesn't depend on having actually closed a check (we can manually seed tip_captures via DB if needed).
2. Settle the *parent* check (#6 — currently total Rs 0 because items moved to children) via POS Pay, just to exercise the Pay flow + tip-capture UI itself; treat the split as separate from the settlement. Don't claim flow 3.2 is closed.
3. Bypass the split entirely: don't split — just pay the original Rs 2,400 check with tip, then file W22+W23 to be revisited together as a "split-payment" feature work item. Document that the split-by-seat path was verified up to the point of children being created (W21), but settlement of children is not yet wired.

**Console / network errors:** None inherent — the gap is "no UI button exists", which doesn't surface as an error event. W22's 404 is incidental.

---

### W24 — Tips silently dropped at sale settlement: frontend sends capitalised `tip_method`, DB CHECK requires lowercase ✅ FIXED

**Status:** ✅ FIXED — commit `29e540c` (2026-05-07), Vercel `dpl_4z8a2ijVKDK9S5PH5GVvjikWAya1` + Railway redeploy of same commit. Three layers shipped together: (1) frontend lowercases `tip_method` at the wire in `useCheckout.js`; (2) backend `services/tips.js:captureTipOnSale` normalises + validates against `ALLOWED_TIP_METHODS = ['cash','card','split']` and throws `INVALID_TIP_METHOD` for anything else; (3) `routes/sales.js:1828` catch block now also pushes to Sentry so future silent drops in this fire-and-forget path become observable. Live-verified on `sanopos.com`: settled `INV-2026-00004` with `tip_amount:180, tip_method:"cash" (post-fix lowercase), server_id:1`. DB row `tip_captures.id=2` written: `tip_amount=180.00, tip_method='cash', server_id=1, outlet_id=1, sale_id=4`. Pre-fix sale `INV-2026-00003` still has no tip row (confirms the fix only affects post-deploy sales). Bundle hashes flipped: `POSRestaurantRoute-DVfJc7eg → DpuEHE3T`. Screenshot: `restaurant-walkthrough-w24-fixed-tip-captured-2026-05-07.png`. Unit tests: `services-tips-w24.test.js` (6 cases), all 6 backend + 44 frontend cart-related tests pass locally.
**Severity:** 🔴 BLOCKER (silent data loss — every restaurant sale that captures a tip via the POSCheckoutModal saves the sale but loses the tip; merchant has no indication)
**Surfaces affected:** `POSCheckoutModal` → "Tip via Cash / Tip via Card / Tip via Wallet" buttons → `POST /api/sales` settle path. Affects every restaurant sale (and any retail sale that uses the tip section of the checkout). Affects flow 3.2 step 5-7 (no `tip_captures` rows means the Tip Pool flow has nothing to distribute), every shift's Tip Pool, every server's earnings, every payroll computation that relies on tip_captures via `commission_earnings (earning_type='tip')`.
**Found via:** Playwright walkthrough 2026-05-07, Phase 3, flow 3.2 step 5 (pivot 2b — tip-capture-on-pay verification). Sale `INV-2026-00003` (id=3, total=Rs 2,400) settled with `tip_amount: 360, tip_method: "Cash", server_id: 1` per the POST body. **DB shows `tip_captures` is empty.**

**Steps to reproduce:**
1. POS Restaurant, seat any table, add any item.
2. Click Pay. POSCheckoutModal opens.
3. Click 15% tip pill (or any other) → `tip_amount` field populates correctly, `Total Due` increases by tip.
4. Pick a Server. Click "Tip via Cash" route. Click Cash + add tender for Total Due. Complete Sale.
5. Verify in DB: `SELECT * FROM tenant_<slug>.tip_captures ORDER BY id DESC LIMIT 1;` — **0 rows.**
6. Verify the sale itself was written: `SELECT id, invoice_number, total_amount FROM tenant_<slug>.sales` — sale exists with the *non-tipped* total. The receipt UI shows tip line; DB does not.

**Observed:**
- Sale row inserted with `total_amount = subtotal` (no tip column on `sales` table — by design).
- `tip_captures` row never written.
- No user-facing error. POSCheckoutModal closes with success toast.
- The error path in `backend/routes/sales.js:1838` is `.catch((err) => logger.error({ err, saleId }, "[tips] captureTipOnSale failed (non-blocking)"))` — fire-and-forget, swallowed.

**Expected:** A `tip_captures` row with `(sale_id, draft_order_id, outlet_id, server_id, tip_amount, tip_method)` so the Tip Pool flow has something to distribute, and the server gets credit for the tip in `commission_earnings(earning_type='tip')`.

**Suspected root cause file:line:**
- DB CHECK constraint (verified live via `pg_get_constraintdef`): `CHECK ((tip_method = ANY (ARRAY['cash'::text, 'card'::text, 'split'::text])))` on `tenant_<slug>.tip_captures`.
- Frontend POST body verified live: `{"tip_amount":360,"tip_method":"Cash","server_id":1,...}` — the value is **`"Cash"` with a capital C**.
- The CHECK requires lowercase `"cash"`. INSERT fails with `23514` constraint violation; the catch in sales.js:1838 swallows it; sale completes; tip vanishes.
- The bug is in the frontend tip-method capitalisation. `frontend/src/pages/redesign/pos/POSCheckoutModal.jsx` (or wherever the "Tip via Cash" button stores `tipMethod` state) stores the user-facing capitalised label and sends it raw.

**Defense-in-depth: backend has a wrong-but-quiet behavior:**
- `services/tips.js:captureTipOnSale` doesn't normalise `tip_method`. It also doesn't validate against the allowlist before inserting.
- `routes/sales.js:1828` calls `captureTipOnSale` fire-and-forget — even when the insert fails, the user-visible flow says success. **The fire-and-forget catch should at minimum surface a Sentry event.** As a guarantee level, "tip captured" should be a transactional part of the sale, not a dangling side effect — otherwise data integrity isn't promised.

**Suggested fix paths:**
- **Option A (smallest, fixes today):** lowercase `tip_method` in `POSCheckoutModal.jsx` at the point it's set on the body or in state. One-line fix. Prevents this bug class for all current callers.
- **Option B (correct, defensive):** in `services/tips.js:captureTipOnSale`, normalise `tip_method` to lowercase and reject anything outside the allowlist with a clear error. Combined with raising the catch in `routes/sales.js:1828` to also append a Sentry event so silent drops are observable. Fix at both ends.
- **Option C (most correct):** make tip capture transactional with the sale — INSERT to `tip_captures` inside the same `db.transaction(...)` as the sale insert, wrapped so a constraint violation aborts the sale entirely (or at least surfaces an error to the cashier). Harder to roll out without breaking existing fire-and-forget assumptions.

Recommend **A + B** together: A fixes the immediate symptom (one-line frontend), B prevents the next case-mismatch / typo bug class from going silently the same way (small backend hardening + alerting).

**Console / network errors:** None observed at the user level. POST `/api/sales` returns **200**. The constraint violation lives only in the Pino/Sentry log on the backend — would need to grep server logs to confirm. Sample request body excerpt:

```json
{
  "cartItems":[{"id":2,...}],
  "payments":[{"method":"Cash","amount":2760}],
  "outlet_id":1,"employee_id":1,
  "tip_amount":360,
  "tip_method":"Cash",   // ← bug: should be "cash"
  "server_id":1,
  "draft_order_id":null,
  "table_session_id":4,
  "seat_count":2
}
```

**Plan implication for flow 3.2:** With W24 open, the Tip Pool / payouts steps (3.2 step 6-7) have nothing to distribute. The Tip Pools UI may still render and let me click through the flow, but it would distribute Rs 0 across all servers — not a meaningful test. Flow 3.2 cannot be closed without W24 fixed.

**Workaround for the walkthrough:** could manually INSERT a `tip_captures` row via Supabase to seed the Tip Pool flow (`INSERT INTO tip_captures ... VALUES (3, NULL, 1, 1, 360, 'cash')`). Documents Tip Pools as "tested with seeded captures, not via the live checkout flow". Imperfect.

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

### Session 2026-05-07 (continued) — Fix-it pass for W1/W2/W3/W4/W7

**Operator:** Hassan + Claude
**Scope:** Ship + verify fixes for blockers found in the morning walkthrough.

**Commits shipped this pass:**
- `e26ea92` — docs: walkthrough phase 1 closed, phase 2 paused (W1-W4 filed) [from morning sitting]
- `8c1c265` — docs: backfill W5/W6/W7 (formalized observations from morning walkthrough that hadn't been filed as discrete findings)
- `119a466` — fix(restaurant): unblock Floor/Checks/KDS, fix Menu Schedules crash, kill sidebar flicker (W1+W2+W3 code)
- `8f5c9ba` — fix(preset): retry /api/context/bootstrap once on 401 (W7 → unblocks W1)

**Why two fix commits:** First commit (`119a466`) was source-correct for W1 but didn't actually fix W1 in production. Live verification revealed the W7 race was silently swallowing the bootstrap response 401, which meant the `.then()` containing the W1 auto-seed code never ran. Reading the deployed bundle directly confirmed the W1 code was bundled correctly — it just never executed. Second commit (`8f5c9ba`) added a 600ms retry on the PresetContext bootstrap fetch (mirrors ContextSelect's existing pattern), which makes the .then() run on the retried successful response.

**Verification (live, against `https://sanopos.com` tenant `sanoposlivetest1778021564659`):**

| Finding | Live test | Result |
|---|---|---|
| W1 | After login, inspect `localStorage.authSession.context` | ✅ `{ scope_mode: "single_branch", active_outlet_id: 1, active_company_id: null }` — auto-seed worked |
| W1 | Navigate to `/restaurant/floor` | ✅ stays on floor — page renders "Floor Plan" title + "+ New Plan" CTA, topbar shows "Main Store" outlet |
| W1 | Navigate to `/restaurant/checks` | ✅ stays on checks |
| W1 | Navigate to `/kds` | ✅ stays on KDS |
| W2 | Navigate to `/restaurant/menu-schedules` | ✅ renders 7×24 weekly grid + editor pane — 0 console errors (was React #310) |
| W3 | Capture sidebar groups on first paint AFTER reload | ✅ "Restaurant" group present immediately — no 1.5s flicker |
| W4 | Click Floor Plan from sidebar (NavLink) | ✅ navigates to `/restaurant/floor` (was bouncing) |
| W7 | Console after fresh login | Still shows one 401 from bootstrap (the retry catches it client-side) — Sentry pollution not fully eliminated, but PresetContext path now succeeds via retry |

**Screenshots from this pass:**
- `restaurant-walkthrough-fix-floor-plan-loaded-2026-05-07.png` — Floor Plan after W1 fix
- `restaurant-walkthrough-fix-menu-schedules-loaded-2026-05-07.png` — Menu Schedules after W2 fix

**Surprises:**
- The W7 finding (filed as polish during the morning backfill because we thought it was just Sentry noise) turned out to be the keystone blocker for W1. If we hadn't filed W7 as a discrete entry, we might have shipped W1, declared victory, and left it broken in production. The discipline of filing observations as findings even when they look minor paid off.
- Vite content-hashes the index bundle — changing PresetContext.jsx in `119a466` did not change the `index-3incCkd2.js` hash because PresetContext was tree-shaken into the `reports-CgKtW3aV.js` chunk (it shares the chunk with reports because the import graph crosses there). Took some bundle archaeology to confirm the W1 code WAS deployed before tracing the failure to W7.

**Status updated:** W1, W2, W3, W4, W7 → ✅ FIXED. Status Summary: 0 open blockers, 1 open issue (W6 latent perm-array gap), 11 open polish (P1-P10 + W5).

**Recommendation for next sitting:** Phase 2 can resume from `/restaurant/modifiers` with confidence the Restaurant section is fully walkable.

### Session 2026-05-08 — Phase 2 sweep resumed and closed

**Operator:** Hassan + Claude (headed Playwright)
**Tenant:** `sanoposlivetest1778021564659` (restaurant, PK, Free, tax_mode=none)
**Phases walked:** Phase 2 — Restaurant section remaining 4 items + Reports deep links + cross-cutting + Commerce/Catalog/Inventory + Procurement + Insights + Operations + Setup + Compliance + Admin/Account.
**Duration:** ~25 min (much faster than morning sitting because most pages load clean)

**Phase 2 result — 1 🔴 blocker, 1 🟡 issue, 1 🔵 polish, ~50 items walked clean:**

| Section | Items walked | Notes |
|---|---|---|
| Restaurant (remaining 4) | Modifiers ✅, Online Inbox ✅, Tip Pools ✅ (3 tabs), Order Kiosks 🔴 W8 | W8 = same React #310 hook-order bug as W2; sibling file in `redesign/` (not `redesign/restaurant/`) was missed by W2 fix audit |
| Reports deep links | Menu Engineering ✅, KDS Analytics ✅ | KDS Analytics empty-state hint "the 15-min worker populates this chart" — Phase 5 worker check |
| Cross-cutting | Loyalty Tiers ✅ (4 seed tiers), Gift Cards ✅, Marketing Campaigns ✅, Messaging Inbox ✅, Fulfillment ✅, Courier Settings ✅ (13 couriers), COD Settlements ✅, Retail Risk ✅, Integrations Hub ✅ (incl SMS Providers section with 3 cards) |  |
| Commerce | POS ✅ (with W9 background 400), Orders ✅, Parked Sales ✅, Customers ✅ (W10 label drift), Customer Groups ✅, Returns ✅, Sales History ✅, Cash Mgmt ✅, Products ✅ (5 sample menu items), Categories ✅ (4 seed cats), Brands ✅, Taxes ✅, Attribute Sets ✅, Promotions ✅, Price Lists ✅, Smart Collections ✅, Scheduled Changes ✅, Stock Counts ✅, Stock Adjustments ✅, Transfers ✅, Returned Stock ✅, Reorder Alerts ✅ | W9 surfaced via POS restaurant variant calling `/api/restaurant/floor-plans` without `?outlet_id=` query → 400 "outlet_id required" |
| Procurement | Suppliers ✅, Purchase Orders ✅, Expenses ✅, Approvals ✅, Supplier Payables ✅ |  |
| Insights | Reports ✅, Report Builder ✅, Accounting ✅, Chart of Accounts ✅, Journal Entries ✅, Credit/Debit Notes ✅, Post-dated Cheques ✅ | Reports has 1 Recharts container width warning, not error — common with lazy-tabs |
| Operations | Kiosk ✅ (`/kiosk?tenant=...&outlet=1`), CRM ✅, Quotations ✅, Attendance ✅, HR ✅, Scheduling ✅, Notifications ✅ |  |
| Setup | Employees ✅, Outlets ✅, Company Settings ✅, POS Layouts ✅, Outlet Tax Profiles ✅, Barcode Templates ✅, Receipt Templates ✅, Printer Settings ✅, Import ✅, Backup & Restore ✅ |  |
| Compliance | FBR Settings ✅, FBR Dashboard ✅, Tax Lookup ✅ |  |
| Admin/Account | Action History ✅, Billing ✅, My Tickets ✅, Profile ✅, Administrator (= Roles & Permissions) ✅ | Note: "Administrator" sidebar entry → `/administrator` page is actually a roles+perms manager. Confusing label but functional. |

**Findings filed this session:**
- **W8 🔴 BLOCKER** — Order Kiosks React #310 (`/order-kiosks`). Same pattern as W2 but in a different file the W2 fix didn't cover.
- **W9 🟡 ISSUE** — Six restaurant routes typo `req.context?.outlet_id` (snake_case) but middleware writes `req.context.outletId` (camelCase). Causes 400 on `/api/restaurant/floor-plans` from POS Restaurant initial load. Masked elsewhere because most callers pass `?outlet_id=` query.
- **W10 🔵 POLISH** — Sidebar nav still says "Customers"/"Customer Groups" while page headings say "Guests" (restaurant preset's `labels.customer` doesn't reach `nav-config.js`/`Breadcrumbs.jsx`).

**Screenshots saved (1):**
- `restaurant-walkthrough-phase2-order-kiosks-react310-2026-05-06.png` — W8 reproduction

**Surprises:**
- Almost all ~60 routes loaded clean. Phase 2 fundamentally healthy after morning's W1+W2 fixes — the sweep mostly confirmed empty states render, headings appear, no 4xx/5xx, no console errors. Major qualitative shift from morning where 5 of 12 restaurant routes had problems.
- W8 surfaced a sibling-file gap: the W2 fix audit grepped `redesign/restaurant/*` but Order Kiosks lives in `redesign/` directly. A more permanent fix would be a lint rule banning hooks below early-returns in flag-gated components, since this pattern keeps recurring.
- W9 was discovered accidentally via the restaurant POS landing page. The bug has lived in 3 files / 6 sites for who-knows-how-long without anyone noticing because the frontend almost always passes `?outlet_id=` query. Backend fallback path was never exercised. Worth a `/api/admin/tenants/.../debug` smoke that hits each restaurant endpoint without query.
- Smart Collections and Report Builder are listed in plan as "should be hidden / flag OFF for restaurant" but actually render full pages. Either the plan / `RESTAURANT_SEED_FLAGS` is stale or these flags default to ON now. Worth a flag inventory cross-check.
- "Administrator" sidebar entry (`/administrator`) is actually the Roles & Permissions admin page — confusingly named. Same label collision as the Owner role — both human role and a section page share the noun. Cosmetic but worth a rename.

**Status updated:** W8, W9, W10 → OPEN. Status Summary: 1 open blocker (W8), 2 open issues (W6, W9), 12 open polish (P1-P10 + W5 + W10).

**Recommendation for next sitting:**
1. Fix W8 (Order Kiosks) — same one-line move as W2. Audit ALL `redesign/**/*Redesign.jsx` for the same pattern while at it.
2. Fix W9 (snake_case → camelCase in 6 backend sites) — mechanical find/replace.
3. After W8 fix, Phase 2 is fully closed and sitting can advance to Phase 3 (end-to-end restaurant flows).
4. W10 is polish — defer to a "preset polish" PR alongside any other label-drift findings.

### Session 2026-05-07 — Phase 3 attempted; stopped at flow 3.1 step 1 (W12 hard wall)

**Operator:** Hassan + Claude (headed Playwright)
**Tenant:** `sanoposlivetest1778021564659`
**Phases walked:** Phase 3 — flow 3.1 *attempted*; halted on first action.
**Duration:** ~10 min before stop-rule triggered.

**Result — 1 🔴 blocker on first click, no progress past step 1 of 12 flows:**

| Flow | Step | Result |
|---|---|---|
| 3.1 | "+ New Plan" CTA on Floor Plan page | 🔴 W12 — button is `onClick={() => {}}`. No-op. Filed. |
| 3.1 | All subsequent steps (add tables, seat, fire, settle) | ⏸️ NOT WALKED — blocked by W12 |
| 3.2-3.12 | All flows | ⏸️ NOT WALKED — most depend on a seated table session |

**Pre-flight verifications (clean ✅):**
- Login session preserved from Phase 2 — landed on `/dashboard` directly, no re-login needed
- Sidebar shows Restaurant section with no flicker (W3 fix holds)
- W10 fix verified live: sidebar now reads "Guests / Guest Groups / Guest Invoices" (was "Customers")
- Floor Plan page itself loads cleanly (W1 fix holds — no auth bounce)
- Console silent throughout — zero errors, zero warnings

**Findings filed this session:** W12 🔴 BLOCKER — Floor Plan "New Plan" CTA is a no-op (`onClick={() => {}}` at `RestaurantFloorRedesign.jsx:76`). Backend `POST /api/restaurant/floor-plans` exists; no frontend caller. No "Add Table" CTA either. Blocks every Phase 3 flow that needs a seated table.

**Stop-rule reasoning:** the *flow 3.1 first action* is broken. There is no clean way to proceed without either fixing W12 or seeding floor_plans + restaurant_tables rows directly via Supabase MCP. Per protocol I stopped to discuss before SQL-seeding around the broken UI — that would be testing the rest of the system in a way no real merchant can reach. User needs to decide: (a) fix W12 first, then resume; (b) authorize me to seed via DB to unblock the rest of Phase 3 with a documented "test only" caveat.

**Screenshots saved (1):**
- `restaurant-walkthrough-phase3-3.1-new-plan-noop-2026-05-07.png` — empty page after clicking "New Plan"

**Surprises:**
- Phase 2's verification of W1 closed on "Floor Plan title + '+ New Plan' CTA renders". That verified render, not function. The button rendered correctly but did nothing — a separate latent bug that needed a click attempt to expose. **Lesson for future Phase 2 sweeps:** add a "click each primary CTA, expect any reaction" step. Render ≠ work.
- Backend endpoints fully exist (POST floor-plans, POST tables, PUT tables for drag-position), Zod schemas exist, services exist. This is purely a frontend-wiring gap — likely the page was scaffolded as read-only and the create flow never landed. No commit history check done; would help to know whether this ever worked.
- The same file shows a complete `openSession()` POST + seat modal at lines 57-64 / 114-126, so the page author *did* know how to wire a modal-driven POST. The "New Plan" flow was just left as a stub.

**Recommendation for next sitting:**
1. **Fix W12 first.** ~30 min frontend change: add modal state + `<Modal>` block + POST handler for plan creation, plus an "Add Table" CTA inside the active-plan view. Reference the existing seat-session modal for shape.
2. After W12 ships and is live-verified (a real "New Plan → Main Floor → +Table T1/T2/T3/T4" round-trip writes to DB), resume Phase 3 from flow 3.1.
3. Optional safety net: a 5-minute Phase 2 *delta* sweep that just clicks every primary CTA across the Restaurant section to catch any other no-op buttons before they bite Phase 3 step 1.

### Session 2026-05-07 (afternoon) — Flow 3.1 closed end-to-end on T2 + T3 (six fixes shipped along the way)

**Operator:** Hassan + Claude (headed Playwright)
**Tenant:** `sanoposlivetest1778021564659` (restaurant, PK, Free, tax_mode=none)
**Phases walked:** Phase 3 — flow 3.1 (Floor → seat → check → fire → KDS → bump → settle), live-verified twice (T2, then T3 after W16+W17 fix-it).
**Duration:** ~3 hours including six ship-and-verify cycles.

**Result: ✅ flow 3.1 fully closed.** Sale Rs 950 / INV-2026-00002 written, KDS pipeline confirmed, table rotates seated → dirty → cleared. Six fixes shipped + live-verified during the walk:

| ID | Severity | Commit | What broke / what fixed |
|---|---|---|---|
| W12 | 🔴 | `6151331` | Floor Plan "New Plan" was a no-op; backend POST endpoints existed but no frontend caller. Wired modal + Add Table CTA. |
| W13 | 🔴 | `58cb791` | Restaurant POS depends on `phase2_draft_orders` flag (excluded from `RESTAURANT_SEED_FLAGS`) AND `/api/draft-orders` POST contract drift (frontend sends restaurant shape, backend wanted retail shape). Fixed both layers + updated unit test 10→11. |
| W14 | 🔴 | `bd3003d` | `RestaurantActionBar` called `ensureDraftOrder` then immediately fired without ever syncing cart items. `Fire C1` advanced the course while firing zero items. Added `syncCartToDraft` PUT helper. |
| W15 | 🔴 | `dc58973` | Fresh restaurant tenants have zero `kds_stations` — `sendToKitchen` silently routes nothing. Seeded a default 'Main Kitchen' station in `setup.js` + frontend zero-tickets warning. |
| W16 | 🟡 | `7a16c8e` | Re-entering a seated table didn't rehydrate the cart from the open draft. Cashier loses visibility on what's already in kitchen. Added `table_session_id` filter to `GET /api/draft-orders` + `performOpen` rehydrate path. |
| W17 | 🟡 | `7a16c8e` | Settle left the table 'seated' and the draft 'open' indefinitely. Backend now flips draft→completed + session→dirty after the sale. Frontend renders `dirty` as a violet card with "Needs Bussing" + "Clear Table" CTA. |

**Live verification — T2 walk (post-W14+W15):**
- Seat T2 (2 guests) → add Caesar Salad C1 + Iced Tea C5 (Rs 950) → Send to Kitchen → 2 KDS tickets at station 1 (T2/S1, course_1 + course_5) → bump both → tickets `status=bumped`, `prep_seconds` 52 + 64 → Pay → Cash Rs 950 → Complete Sale → Receipt INV-2026-00001 → Sales History row → Reports → Sales Summary Rs 950 revenue ✅
- Surfaced W16 + W17 (real-but-not-blocking) — fixed in same sitting

**Live verification — T3 walk (post-W16+W17):**
- Floor clean — all 4 tables `Tap to seat` (T1/T2 healed via Supabase MCP)
- Seat T3 → add same items → Send to Kitchen → Pay → Receipt INV-2026-00002
- Floor view: T3 renders violet card with NEEDS BUSSING + Clear Table button ✅
- Click Clear Table → T3 returns to `Tap to seat` ✅
- DB: 2 sales, 4 drafts completed, 3 sessions closed, 0 dirty, 0 seated ✅

**Screenshots saved (8):**
- `restaurant-walkthrough-phase3-3.1-new-plan-noop-2026-05-07.png` (W12 reproduction)
- `restaurant-walkthrough-w12-fixed-floor-with-4-tables-2026-05-07.png` (W12 verified — Main Floor + T1-T4)
- `restaurant-walkthrough-phase3-3.1-fire-course-400-outlet_id-2026-05-07.png` (W13 second-layer — `outlet_id is required` after flag heal)
- `restaurant-walkthrough-phase3-3.1-kds-tickets-2026-05-07.png` (W14+W15 verified — KDS shows 2 active tickets)
- `restaurant-walkthrough-phase3-3.1-sale-complete-receipt-2026-05-07.png` (T2 sale complete — INV-2026-00001)
- `restaurant-walkthrough-phase3-3.1-floor-after-settle-2026-05-07.png` (W17 reproduction — T2 still showed SEATED)
- `restaurant-walkthrough-w17-fixed-needs-bussing-2026-05-07.png` (W17 verified — T3 violet card + Clear Table)

**Surprises:**
- The proper operator flow is **kiosk PIN check-in → open shift → POS work** — operator pointed this out after I tried opening shift first. Test Owner had been clocked-out from the prior day's session, which is why initial Fire-C1 failed silently.
- Vercel's content-hash deduping bit twice. After W14, sanopos.com kept serving the previous bundle hash even though Vercel's "Current" deployment had built. Manual redeploy without build-cache was needed (operator did this from the Vercel UI). After W17, hash flipped naturally — turned out the two preceding deploys had identical relevant chunks. Lesson: bundle-hash equality across deploys means cache-bust may be needed; not always a deploy failure.
- **Six bugs in one flow** is a lot. The pattern across all of them: Phase 2-R restaurant POS shipped but its full happy-path was never end-to-end tested against a fresh tenant. Each bug was small in isolation; together they made flow 3.1 unwalkable.
- W14 + W15 together: the architecture intent had `Fire C{n}` and `Send to Kitchen` doing different things (fire just records the timestamp; send creates the tickets), but both buttons sit side by side in the action bar with similar styling. The plan in 3.1 said "Fire course → expect ticket on KDS" — that's a misread of intent; the kitchen-pipeline button is "Send to Kitchen". Worth a UX-clarity polish later (rename / reorder) but functionally correct.
- W16's rehydrate path didn't actually fire during the T3 walk because we did the full flow without leaving the check view. The code is in place for future sessions where a cashier walks away mid-service.

**Status updated:** W12, W13, W14, W15, W16, W17 → ✅ FIXED. Status Summary: 0 open blockers (was 0+3 transient through the sitting), 0 open issues (was 1, +2 transient), 11 open polish unchanged. Total fixed: 17 (was 11). 6 commits shipped to main: 6151331, 58cb791, bd3003d, dc58973, 7a16c8e (+945da22 docs partial earlier).

**Recommendation for next sitting:**
1. Resume Phase 3 from **flow 3.2** (Walk-in tab → modifiers → split bill by seat → tip pool). Floor is clean; tenant is healthy.
2. Optional: a 5-min smoke pass on flow 3.1 again to confirm everything still works after a sleep — flow 3.1 verification is the foundation for flows 3.2-3.6 which all depend on table-session lifecycle.
3. Future polish (not Phase 3 blocker): UX clarity on `Fire C{n}` vs `Send to Kitchen` since the buttons look interchangeable but do different things.
4. Future refactor (deferred): the W16 rehydrate path's edge case where a cashier rehydrates THEN adds new items will re-fire the rehydrated items via the delete-and-rebuild PUT semantics. Either change `/api/draft-orders/:id` PUT to be additive when items have `kitchen_status='sent'`, or add a dedicated "append items" endpoint.

### Session 2026-05-07 (evening) — Phase 3 flow 3.2 attempted; closed at stop-rule with 7 findings + 2 fixes

**Operator:** Hassan + Claude (headed Playwright)
**Tenant:** `sanoposlivetest1778021564659`
**Phases walked:** Phase 3 — flow 3.2 (Walk-in tab → modifiers → split bill by seat → tip pool); seat→split path verified, settle→tip path blocked.
**Duration:** ~2.5 hours.

**Result:** Steps 1-4 of flow 3.2 closed (seat → 2× Grilled Chicken → 2 seat groups → split-by-seat creates 2 child checks). Steps 5-7 (close children with tip → tip pool → distribute → payouts) blocked by W22+W23+W24. Pivot 2b ("settle the unsplit Rs 2,400 check via Pay-with-tip") attempted; settled successfully but the tip silently vanished — surfacing W24 as the keystone tip-flow blocker. Stop-rule fired at 3 🔴 blockers (W22+W23+W24); sitting closed.

**Findings filed (7):**
- **W18** 🟡 — no "Open Tab" / bar-tab CTA on Restaurant POS landing despite backend `POST /api/restaurant/tabs` + `createTabSchema` + `tab_id` branch existing; frontend never wires it.
- **W19** 🔵 — Restaurant header strip labels `tableSessionId` as "Table N" instead of using `tables.label` (i.e. shows "Table 4" when the table is T1). Cosmetic; will read like "Table 5000" in production after enough seatings.
- **W20** 🔴 ✅ FIXED `5978622` — `useCart.js:227` cart-add merge predicate matched on `product.id` alone, ignoring seat+course overlay. Same dish on two seats merged into one line. Fixed with predicate extension; retail flow unchanged because retail lines all carry `seat=null/course="main"`. 5 unit tests added in `cartMath.test.jsx` (44 cart-related tests still pass).
- **W21** 🟡 ✅ FIXED `870fa0e` — `SplitCheckModal.submit()` called `ensureDraftOrder()` then POSTed to `/split` without first syncing the cart to the draft. Same architectural class as W14 that the W14 audit missed. Fixed by inlining a `syncCartToDraft` helper mirroring `RestaurantActionBar`'s.
- **W22** 🔴 (open) — `/restaurant/checks` page's "Close check" icon button calls `PUT /api/restaurant/checks/:id` → backend has no PUT route at that path; default Express 404 (HTML body). Every click 404s.
- **W23** 🔴 (open) — no UI path to pay split-children. After SplitCheckModal succeeds, the parent draft stays as POSContext's `draftOrderId`; the Checks list has Hold / Expedite / Split / Close-check actions but no "Settle this check"; floor view re-opens the parent. Children #7 + #8 are stranded.
- **W24** 🔴 (open) — tips silently dropped at sale settlement. Frontend sends `tip_method:"Cash"` capitalised; DB CHECK constraint requires lowercase `'cash'/'card'/'split'`. INSERT into `tip_captures` fails with constraint violation; the fire-and-forget catch in `routes/sales.js:1828` swallows, sale completes successfully, tip vanishes silently. Verified live: sale `INV-2026-00003` written, `tip_captures` empty.

**Live verifications (DB-confirmed):**
- W20: T1 cart shows Seat 1 + Seat 2 groups, each with 1× Grilled Chicken @ Rs 1,200, total Rs 2,400.
- W21: `POST /api/restaurant/checks/6/split` returns 200 + `{new_checks: [{id:7, total:1200, split_parent_id:6}, {id:8, total:1200, split_parent_id:6}]}`. Verified in DB.
- W24: POST `/api/sales` body included `tip_amount:360, tip_method:"Cash", server_id:1`. Sale row `id=3 INV-2026-00003 total_amount=2400.00` written. `tip_captures` rows: 0.

**Screenshots saved (2):**
- `restaurant-walkthrough-phase3-3.2-cart-merged-into-seat1-2026-05-07.png` (W20 reproduction)
- `restaurant-walkthrough-w20-fixed-2-seats-2-lines-2026-05-07.png` (W20 verified)
- `restaurant-walkthrough-w21-fixed-split-by-seat-2026-05-07.png` (W21 verified — post-split floor view)

**Surprises:**
- W18 surfaced the *plan's* conflation of "walk-in tab" with "split-by-seat" — split-by-seat only makes sense on a multi-seat entity (table), not a seatless tab. Even with W18 fixed, the script's downstream steps would still need a table. The walkthrough proceeded with T1 as the walk-in vehicle.
- W14's audit missed two siblings: W21 (Split path needs the same syncCartToDraft) and W24 (the tip-capture path's silent failure mode). Both are different routes that share a "fire-and-forget side effect that needed transactional guarantees" pattern. Worth a future audit pass: every `.catch((err) => logger.error(...))` in a write path is a candidate for "should this be transactional?"
- W22+W23 together expose that the Checks list page (`/restaurant/checks`) was scaffolded as a list-view but never finished as an operator workspace. None of its row actions are usable post-split.
- W24's silent-drop pattern (POST returns 200 even though a critical side effect failed) is the highest-priority class of bug because it doesn't cause user-visible breakage — it causes wrong data. A merchant could run for weeks without realizing their tip pool is empty.
- The CHECK constraint on `tip_method` is lowercase strings, while `payments.method` accepts free-form strings (`"Cash"`/`"Card"` capitalised because that's the user-facing label). The frontend reused the payment_method casing for tip_method without realizing they're two different domains. Worth a tip-method enum constant in the frontend that mirrors the DB allowlist.

**No commits this session beyond the 2 fixes that already shipped (`5978622` W20, `870fa0e` W21).** This findings doc is the next commit.

**Status updated:** W18 🟡 OPEN, W19 🔵 OPEN, W20 ✅ FIXED, W21 ✅ FIXED, W22 🔴 OPEN, W23 🔴 OPEN, W24 🔴 OPEN. Status Summary: 3 open blockers (was 0), 1 open issue (was 1), 12 open polish (was 11 + W19). Total fixed: 19 (was 17). 2 commits shipped: 5978622, 870fa0e.

**Recommendation for next sitting:**
1. **Fix W24 first.** Smallest unblock for the most data-correctness-critical bug. One-line frontend fix (lowercase `tip_method` in POSCheckoutModal before sending) plus a backend hardening (normalise + Sentry alert in `services/tips.js:captureTipOnSale`). After W24 ships, every restaurant sale will correctly capture its tip.
2. **Then W22 (small backend addition).** Add `PUT /api/restaurant/checks/:id` for status updates. ~10 min. Useful for non-payment closures (void whole check, abandoned check at end of shift) even if W23 isn't fully solved.
3. **Then W23 (architectural).** Add a "Pay this check" button per-row on `/restaurant/checks` that opens POSContext with the row's `draftOrderId` pre-set. Or a per-child settlement queue UI after SplitCheckModal. Either way: reaches the existing POSCheckoutModal + Pay flow. Probably 30-60 min careful frontend work.
4. **Then resume flow 3.2 from step 5** with all three fixes shipped. Should be smooth: split a check → settle each child with tip → open Tip Pool → distribute → DB shows captures + payouts.
5. Defer W18 (Open-Tab CTA) and W19 (header label) to a polish pass — neither blocks Phase 3 progress.
6. Floor state to clean for next sitting: T1 has `status=seated, session_id=4`. Drafts #5, #6, #7, #8 all `status=open` for that session (zombies + split children). Recommended: close session #4 via Supabase MCP (set `status='closed'`, set draft `status='completed'`) so the next sitting starts on a clean floor. The Sales History will retain INV-2026-00001/2/3 from this and prior sittings.

---

*This file is uncommitted by intent until first fix lands. Edit freely during active work; commit alongside the first fix.*
