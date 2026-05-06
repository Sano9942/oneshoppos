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
| 🔴 Blocker | 2 | 0 | 0 |
| 🟡 Issue | 1 | 0 | 0 |
| 🔵 Polish | 9 | 0 | 0 |
| **Total** | **12** | **0** | **0** |

Last update: 2026-05-07 (initial population from discovery report).

---

## 🔴 BLOCKERS

### B1 — Schema drift: 6 tables missing on fresh tenants

**Status:** OPEN
**Severity:** 🔴 Launch-blocker
**Surfaces affected:** Void/Comp (manager PIN), Day-parting (menu schedules), Reservations admin, Reservations public form, Waitlist, Pay-at-Table

**Root cause:**
- `backend/tenant-provisioner-pg.js:78-93` runs `schema-pg.sql` to create tables, then INSERTs `schema_version` rows for ALL `MIGRATIONS` (1..N) marking them applied.
- Migration runner (`backend/migrate-pg.js`) checks `schema_version` and skips applied versions.
- `schema-pg.sql` is missing 6 tables that v59 (Phase 2-R Wave B) and v61 add:
  - `void_reason_codes`
  - `sale_item_adjustments`
  - `menu_schedules`
  - `menu_schedule_products`
  - `reservations`
  - `waitlist_entries`
  - `restaurant_payment_sessions`
- Result: every fresh tenant marks v59/v61 as applied but never gets the tables.

**Live verification (via Supabase MCP, project `tpjewvfoqtskscmwjtjj`):**
- `sanoposlivetest1778021564659.schema_version MAX(version) = 85` ✅
- `to_regclass('tenant_sanoposlivetest1778021564659.void_reason_codes') = NULL` ❌
- `to_regclass('tenant_sanoposlivetest1778021564659.menu_schedules') = NULL` ❌
- `to_regclass('tenant_sanoposlivetest1778021564659.reservations') = NULL` ❌
- `to_regclass('tenant_sanoposlivetest1778021564659.waitlist_entries') = NULL` ❌

**Affected routes (will all 500 on a fresh restaurant tenant):**
- `backend/routes/restaurant/void-comp.js` — reads `void_reason_codes`, writes `sale_item_adjustments`
- `backend/routes/restaurant/menu-schedules.js` — reads/writes `menu_schedules`, `menu_schedule_products`
- `backend/routes/restaurant/reservations.js` — reads/writes `reservations`
- `backend/routes/public-reservations.js`
- `backend/routes/restaurant/waitlist.js` — reads/writes `waitlist_entries`
- `backend/routes/restaurant/pay-at-table.js` — writes `restaurant_payment_sessions`, references `sale_item_adjustments`

**Fix path:**
1. Add the missing CREATE TABLE statements to `backend/schema-pg.sql` so fresh provisioners create them.
2. For existing tenants like `sanoposlivetest1778021564659`: run the CREATE TABLE statements manually against their schema, OR delete v59/v61 rows from `schema_version` and re-run migrations.
3. Verify via `to_regclass(...)` query for each table.
4. Re-test the affected routes return 200 (or expected 4xx, not 500).

**Source:** `discovery-2026-05-07.md` §8.1.A

---

### B2 — Manager role missing 13 perms

**Status:** OPEN
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

### I1 — Owner employee `role` text column says "Cashier"

**Status:** OPEN
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

## Healing log (out-of-band changes to live test tenant)

> Record any DDL or DML run directly against `tenant_sanoposlivetest1778021564659` outside the migration runner. Future tenants get the same state via the migration / setup fixes, but the live test tenant predates them and needs manual catch-up.

(empty so far — entries appended as fixes ship)

---

## Walkthrough session log

> Append a dated entry per Playwright walkthrough session. Each entry: date, scope (which sections of the plan), findings IDs added (W1, W2, ...), commit refs of any fixes shipped that session.

(empty so far — first session expected after blockers B1 + B2 fixed)

---

*This file is uncommitted by intent until first fix lands. Edit freely during active work; commit alongside the first fix.*
