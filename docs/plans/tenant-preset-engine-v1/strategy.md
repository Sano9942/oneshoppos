# Tenant Preset Engine v1 — Strategy & Implementation Specification

**Date:** 2026-04-13
**Status:** v1 COMPLETE (M1-M4, 2026-04-14). v2 IN PROGRESS — M5 shipped 2026-04-14.
**Author:** Hassan + Claude (session 2026-04-13)

---

## Source Documents

This specification was derived from analysis and discussion across these source files:

- [`docs/archive/sano-vs-square-vs-shopify-gap-analysis.md`](../archive/sano-vs-square-vs-shopify-gap-analysis.md) — Competitive benchmarking against Square Premium and Shopify POS Pro. Identified SanoPOS strengths (accounting, HR, loyalty, Pakistan-local) and strategic gaps (omnichannel retail, restaurant mode, appointments, marketing automation).
- [`docs/plans/sanopos-54-industry-coverage-matrix.md`](sanopos-54-industry-coverage-matrix.md) — Assessment of 54 industries: 28 Now, 20 Partial, 6 Not Yet. Concluded that building 54 mini-products is the wrong path; the correct model is a small number of business modes with industry presets as configuration.
- [`docs/plans/sano-plan.md`](sano-plan.md) — Founder-level company structure and SanoPay strategy. Confirmed the existing codebase has the right adapter-based architecture and that platform extensibility is the correct direction.

---

## 1. Strategic Direction

SanoPOS becomes a multi-vertical platform: **one codebase, many faces, no code forks per industry.**

The model follows Square's approach — one platform, multiple business modes, industry presets layered on top. The existing `feature_flags` + `requireFeature()` + `requiredFlag` sidebar system provides the foundation, but a cleaner separation is needed between "what kind of business this is" and "what operational toggles are active."

The dangerous path is building 54 disconnected industry products. The correct path is mapping all 54 industries to a small number of real operating models, then using configuration (not code forks) to make the platform feel purpose-built per merchant.

---

## 2. The Three-Layer Architecture

Three distinct layers govern how a tenant experiences SanoPOS:

| Layer | Purpose | Examples | Stored As |
|-------|---------|----------|-----------|
| **Industry Preset** | Merchant-facing identity — labels, nav groups, dashboard widgets, onboarding, sample data | salon, cafe, repair_shop, grocery, photography_studio | `industry_type` on `company_profile` |
| **Business Mode** | Operational capability — what screens and workflows are enabled | retail, restaurant, appointments, commissions, service_projects, subscriptions, workflow_tickets | `tenant_modes` table (one row per enabled mode) |
| **Country Pack** | Compliance, localization, payment/courier/tax provider availability | PK (Pakistan), US, UAE | `country_code` on `company_profile` |

These three layers must stay **separate from each other** and separate from feature flags.

### How They Interact

```
Industry Preset (salon, cafe, repair_shop)
    |
    v  determines default
Business Modes (appointments, commissions, retail)
    |
    v  determines what's visible
Nav / Labels / Dashboard / POS Layout
    |
    v  further filtered by
Permissions (role-based: what can this employee do?)
    |
    v  further filtered by
Feature Flags (only for: external deps, plan tier, operational toggles)
```

A tenant picking "Salon" during setup would:

1. Set `industry_type = 'salon'`, `business_model = 'service_appointment'` on `company_profile`
2. Enable modes: `['appointments', 'commissions']` in `tenant_modes`
3. Feature flags: untouched (those stay for FBR, AI, marketplace, etc.)
4. Nav shows: appointments, services, calendar, commissions — because those modes are enabled
5. Labels show: "Service" not "Product", "Client" not "Customer"

Later, if the salon owner wants to add retail inventory, they enable the `retail_inventory` mode from settings. No flag hunting.

---

## 3. Modes Replace Flags for Business Identity

### The Problem With the Current Approach

The current `feature_flags` table (65+ flags) is serving two distinct purposes:

1. **Operational toggles** — things like `fbr_integration`, `ai_insights`, `marketplace_integrations` that depend on external config, API keys, or plan tier. These are genuinely "is this capability available?"
2. **Industry/mode gating** — things like `phase4_restaurant`, `phase4_appointments`, `phase2_commissions` that control whether a business type's screens show up. These aren't really "flags" — they're what kind of business this tenant is.

Using boolean flags for business identity creates problems at scale:

- **No single source of truth** — "is this a restaurant?" is scattered across 3-4 independent booleans
- **Invalid combinations** — nothing prevents all mode-flags being true simultaneously on a retail tenant
- **Hard to reason about** — debugging requires reading 65 flags to understand what a tenant is
- **Hard to extend** — every new capability means a new flag, new nav-config entry, new default, new setup-time write
- **Flag bloat** — 65 flags exist today; with 6 modes and 15 presets, you'd need 30+ more

### The Solution: Separate Modes from Flags

**Modes** (new concept) — a `tenant_modes` table where each row represents an enabled business capability:

| Current Flag | Becomes Mode | Part Of |
|-------------|-------------|---------|
| `phase4_restaurant` | `restaurant` | restaurant mode |
| `phase4_restaurant_kds` | (included in `restaurant`) | restaurant mode |
| `phase4_restaurant_qr` | (included in `restaurant`) | restaurant mode |
| `phase4_restaurant_preauth` | (included in `restaurant`) | restaurant mode |
| `phase4_appointments` | `appointments` | appointments mode |
| `phase4_appointments_waitlists` | (included in `appointments`) | appointments mode |
| `phase4_appointments_classes` | (included in `appointments`) | appointments mode |
| `phase2_commissions` | `commissions` | commissions mode |
| `phase4_service_projects` | `service_projects` | service_projects mode |
| `phase4_service_contracts` | (included in `service_projects`) | service_projects mode |

**Feature flags** (existing, kept) handle only:

| Flag | Why It Stays a Flag |
|------|-------------------|
| `fbr_integration` | Requires external FBR API key + config |
| `ai_insights` | Requires `ANTHROPIC_API_KEY` |
| `marketplace_integrations` | Requires external credentials |
| `multi_company` | Plan-tier gate |
| `backup_restore` | Operational toggle |
| `accounting_core` | Plan-tier / operational |
| `phase5_shipping_automation` | External courier dependency |
| All `ui_redesign_*` flags | Dead flags (22 of them — cleanup separately) |

### Nav-Config Migration

`nav-config.js` items get a new `requiredMode` field alongside existing `requiredFlag`:

```js
// Before
{ name: "Floor Plan", path: "/restaurant/floor-plan", requiredFlag: "phase4_restaurant", requiredPerm: "manage_restaurant" }

// After
{ name: "Floor Plan", path: "/restaurant/floor-plan", requiredMode: "restaurant", requiredPerm: "manage_restaurant" }
```

Nav filtering in `AppLayoutRedesign.jsx` checks both (backward compatible):

```js
const nav = useMemo(() =>
  SHOPIFY_NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(it =>
      (!it.requiredMode || enabledModes.has(it.requiredMode)) &&
      (!it.requiredFlag || Boolean(flags[it.requiredFlag])) &&
      (!it.requiredPerm || hasPerm(it.requiredPerm))
    ),
  })).filter(g => g.items.length),
  [enabledModes, flags, hasPerm],
);
```

### Incremental Migration Path

**Phase 1 (v1 ship):** Both `requiredMode` and `requiredFlag` coexist. New presets write modes. Existing tenants keep working through their flags.

**Phase 2 (cleanup, later):** Migrate existing tenants' mode-related flags to `tenant_modes` rows. Remove deprecated flags from `DEFAULT_FEATURE_FLAGS`. Remove `requiredFlag` from nav items that moved to modes.

---

## 4. Six Core Business Modes

These are the operational capability packs — not separate apps, but workflow sets that can be enabled independently:

| Mode | What It Unlocks | Status in Repo |
|------|----------------|----------------|
| `retail` | Scan/sell, inventory, stock control, purchasing — **implicit default for all tenants** | Strong — live and complete |
| `restaurant` | Floor plans, tables, sessions, checks, coursing, KDS, kitchen queue, QR ordering | Exists — Phase 4 tables (migration v21), UI built |
| `appointments` | Booking services, appointment calendar, staff assignment, availability, reminders | Exists — Phase 4 tables (migration v22), UI built |
| `service_projects` | Quotations, projects, contracts, milestone invoicing | Exists — Phase 4 tables (migration v22), UI built |
| `subscriptions` | Recurring billing, memberships, renewal tracking | Partial — tables exist (migration v20), UX thin |
| `workflow_tickets` | Intake, status board, job tracking, assigned staff, deposits, final invoice | Not yet — needs new `service_tickets` table and status-board UX |

### Industry-to-Mode Mapping

Many industries map to the same mode set:

| Industries | Primary Mode(s) |
|-----------|----------------|
| General retail, grocery, electronics, pharmacy, bookstore, hardware, cosmetics, pet shop, furniture, jewelry, auto parts, wholesale, convenience store | `retail` (default) |
| Restaurant, bakery, cafe, juice bar, fast food, food truck, ice cream parlor | `restaurant` |
| Salon, barbershop, spa, clinic, driving school, car wash | `appointments` |
| Photography studio, event venue | `service_projects` + `appointments` |
| Gym, fitness studio, tuition center, coworking | `subscriptions` + `appointments` |
| Repair shop, tailor, laundry, printing/copy shop | `workflow_tickets` |
| Sweet shop, butcher, dry fruits, textile, atta chakki | `retail` (with weight/meter UX later) |

---

## 5. Current Core Module Status

Before building the preset engine, this is what exists:

| # | Core Module | Status | Notes |
|---|-------------|--------|-------|
| 1 | Tenant & Location | **Strong** | company_profile, outlets, employees, roles, permissions, feature flags |
| 2 | Catalog | **Strong** | products, variants, categories, brands, taxes, units, price lists, bundles |
| 3 | Customer | **Strong** | customers, groups, ledger, wallet, loyalty, segmentation, notes, blacklist |
| 4 | Sales & Checkout | **Strong** | POS, cart, discounts, returns, exchanges, parked sales, receipts, cash shifts |
| 5 | Inventory & Procurement | **Strong** | stock, transfers, adjustments, counts, POs, GRN, suppliers, payables, reorder |
| 6 | Scheduling / Resource | **Exists** | booking_services, appointments, calendar — Phase 4 tables + UI exist |
| 7 | Order / Workflow | **Partial** | service_projects + contracts exist, no generic ticket/intake/status-board |
| 8 | Billing & Recurring | **Partial** | quotations, customer_invoices, subscription tables exist, UX thin |
| 9 | Reporting & Dashboard | **Strong** | 14 report files, dashboard widgets, AI insights |
| 10 | Integration | **Strong** | payment adapter, 13 couriers, marketplace hub, FBR, email/SMS |

**8 out of 10 modules are already strong or functional.** The two partial modules (workflow tickets, recurring billing) are needed for later presets, not the first 3.

---

## 6. Agreed Build Order

### Milestone 1: Tenant Preset Engine v1 + 3 Presets — COMPLETE

> **Status:** Done — deployed to production 2026-04-14, all acceptance tests passing.
>
> **Commits:** `3fec8c5` (core engine), `706e82d` (plan doc), `4a99f8f` (adaptation surfaces)
>
> **Migration:** v31 applied to public schema + all 3 active tenant schemas (packagesmall, khantoys, handicraft)

**Scope (all delivered):**

1. **Migration v31** — Added `industry_type`, `business_model`, `country_code`, `industry_preset_version` columns to `company_profile`. Created `tenant_modes` table.
2. **Backend preset config** — `backend/config/industry-config.js` (preset definitions) + `backend/config/mode-registry.js` (mode → feature flag mapping). Source of truth for labels, nav groups, dashboard widgets, POS mode.
3. **Setup flow changes** — 5-step setup wizard with business-type picker as Step 1. Backend `POST /api/setup/complete` accepts `industry_type`, seeds `tenant_modes` and enables corresponding feature flags.
4. **Bootstrap API extension** — `GET /api/context/bootstrap` returns `preset: { industry_type, business_model, labels, dashboard_widgets, onboarding_steps, pos_layout_mode, enabled_modes }`.
5. **Frontend nav filtering** — `AppLayoutRedesign.jsx` checks `requiredMode` alongside `requiredPerm` and `requiredFlag`. Nav items for Restaurant, Appointments, Service Work, and Commissions have `requiredMode` set.
6. **Label context** — `PresetContext.jsx` provides `label()` hook consumed by DashboardTopProducts, DashboardRecentSales, InventoryRedesign (Products page), CustomersRedesign, and DashboardOnboarding.
7. **3 preset configs** — retail, restaurant, salon/services — with exact mode lists, nav groups, labels, and onboarding steps.
8. **POS layout toggle** — Grid/list view toggle in POS search results, defaulting from preset's `pos_layout_mode`. Persists in localStorage.
9. **Onboarding steps** — Driven by preset config via `ALL_STEPS` map. Restaurant shows "Add your first menu item", "Set up your floor plan", "Make your first order".
10. **Settings page** — Industry type dropdown in Company Settings. Backend `PUT /api/company-profile` re-derives modes and flags on change (DELETE old → seed new).
11. **Dashboard widget adaptation** — Inventory alerts hidden for salon preset via `dashboard_widgets` config.

**What each preset enables:**

| Preset | Modes Enabled | Key Labels | POS Mode |
|--------|--------------|------------|----------|
| **Retail** | (none extra — retail is implicit default) | Product, Customer, Sale | `grid` |
| **Restaurant** | `restaurant` | Menu Item, Guest, Order | `list` |
| **Salon/Services** | `appointments`, `commissions` | Service, Client, Appointment | `list` |

**V1 acceptance test — PASSED (production, 2026-04-14):**

| Test | Result |
|------|--------|
| New tenant selects "Restaurant / Cafe" in setup wizard | Completed setup, redirected to dashboard |
| Onboarding shows "Add your first menu item", "Set up your floor plan", "Make your first order" | Confirmed — all 3 restaurant-specific steps visible |
| Restaurant nav group visible (Floor Plan, Checks, KDS) | Confirmed — all 3 items in sidebar |
| Appointments, Commissions, Service Work nav groups hidden | Confirmed — none visible |
| Existing tenant `packagesmall` fully unaffected | Confirmed — all nav groups, dashboard, data intact |
| Migration v31 idempotent on re-run | Confirmed — "up to date" on second run |
| Unit tests (19 tests across 3 new files + 49 existing middleware tests) | All 68 passing |

### Milestone 2: Deepen Partial Core Modules — COMPLETE

> **Status:** Done — deployed to production 2026-04-14, all 6 smoke tests passing.
>
> **Commits:** `15a4f82` (M2 implementation), `ddc0178` (column fix + smoke tests)
>
> **Migration:** v32 applied to public schema + all 3 active tenant schemas (packagesmall, khantoys, handicraft)
>
> **Railway:** `SUBSCRIPTION_GRACE_WORKER_ENABLED=1` set, worker registered and running hourly.

**Deliverable A — Workflow/Ticket Engine (built from scratch):**

1. **Migration v32** — `service_tickets` table (ticket_number, customer, outlet, assigned_to, status machine, deposit tracking, invoice link) + `service_ticket_activities` table (activity log with 5 types). Feature flag `phase4_workflow_tickets` seeded.
2. **Backend** — `schemas/service-tickets.js` (3 Zod schemas), `services/service-tickets.js` (7 functions: create, update, get, list, generateInvoiceFromTicket, logActivity, generateTicketNumber), `routes/service-tickets.js` (6 endpoints).
3. **Status machine** — `intake → approved → in_progress → on_hold → completed → invoiced → cancelled`. Invoice generation gated on `completed` status. Deposit tracked on ticket, deducted on final invoice.
4. **Invoice generation** — `POST /api/service-tickets/:id/generate-invoice` creates `customer_invoices` + `customer_invoice_items` row inside a transaction, links back via `final_invoice_id`, transitions to `invoiced`.
5. **Mode + permissions** — `workflow_tickets` mode in `mode-registry.js`, `manage_tickets` permission added to Manager role + PERMISSION_RULES, nav item in "Service Work" group.
6. **Frontend** — `ServiceTicketsRedesign.jsx` with list view (filterable by status/search), detail view (description, deposit card, activity timeline, action buttons), and create modal (title, description, customer, assigned_to, expected date, deposit amount/method, notes).

**Deliverable B — Subscription Billing Polish (enhanced existing):**

1. **Cancel reason** — `cancel_reason TEXT` column on `customer_subscriptions`. Cancel endpoint accepts `{ cancel_reason }`. Frontend shows cancel reason modal before cancelling.
2. **Detail view** — `GET /api/customer-subscriptions/:id` returns plan + customer + period info. Frontend inline detail view with plan info, period dates, days remaining, cancel reason.
3. **Renewal history** — `GET /api/customer-subscriptions/:id/renewals` returns `subscription_runs` JOIN `customer_invoices`. Frontend table shows period, amount, invoice number, status.
4. **By-customer endpoint** — `GET /api/customer-subscriptions/by-customer/:customerId` for customer detail page integration.
5. **Churn stats** — `GET /api/subscriptions/stats` returns active_count, churned_this_month, churn_rate %. Frontend widget at top of subscriptions list.
6. **Grace period** — `grace_period_end TIMESTAMPTZ` column set 7 days after renewal. `subscription-grace-worker-boss.js` hourly cron transitions `active → past_due` (unpaid past grace) and `past_due → expired` (7 more days). `past_due` and `expired` status badges added to frontend.
7. **Email templates** — `subscription_renewal_admin` (admin notification) and `subscription_renewal_due` (customer reminder) added to email-templates.js + TEMPLATES registry.

**M2 acceptance test — PASSED (production, 2026-04-14):**

| Test | Result |
|------|--------|
| Ticket lifecycle: create with deposit → approve → in_progress → complete → generate invoice | PASS |
| Ticket: add note, verify in activity timeline | PASS |
| Ticket: cannot generate invoice from non-completed status (400) | PASS |
| Subscription: cancel with reason → verify reason persisted via detail endpoint | PASS |
| Subscription: detail + renewals + by-customer endpoints return correct data | PASS |
| Subscription: churn stats endpoint returns valid counts + rate | PASS |

### Milestone 3: More Presets — COMPLETE

> **Status:** Done — all 7 presets added, unit tests passing (21/21), frontend builds clean.
>
> **Migration:** None needed — pure config changes, no DB schema changes.

**Scope (all delivered):**

1. **7 new presets** added to `backend/config/industry-config.js` — grocery, cafe, clinic, repair_shop, gym, wholesale, photography_studio
2. **Bug fix** — Added `phase4_workflow_tickets` to `ALL_MODE_FLAGS` in `company-profile.js` (was missing, caused stale flag when switching away from repair_shop)
3. **Setup wizard redesign** — Step 1 changed from 3 flat cards to categorized grid (Retail / Food & Bev / Services) with 10 options
4. **Company Settings** — `INDUSTRY_OPTIONS` dropdown updated with all 10 presets
5. **Onboarding steps** — Added `ticket` ("Create your first job ticket" → `/service-tickets`) and `membership` ("Set up your first membership plan" → `/subscriptions`)
6. **Unit tests** — 7 new preset-specific test cases validating modes, labels, widgets, and onboarding steps

**What each new preset enables:**

| Preset | Modes | Key Labels | POS |
|--------|-------|------------|-----|
| **Grocery** | (none — base retail) | Product/Customer/Sale | grid |
| **Cafe** | `restaurant` | Menu Item/Customer/Order | list |
| **Clinic** | `appointments` | Service/Patient/Visit | list |
| **Repair Shop** | `workflow_tickets` | Service/Customer/Repair | list |
| **Gym** | `subscriptions`, `appointments` | Plan/Member/Enrollment | list |
| **Wholesale** | (none — base retail) | Product/Buyer/Invoice | grid |
| **Photography Studio** | `service_projects`, `appointments` | Package/Client/Session | list |

### Milestone 4: Deepen Preset Adaptation Surfaces — COMPLETE

> **Status:** Done — all 6 features delivered 2026-04-14, 25/25 unit tests passing, frontend builds clean.
>
> **Commits:** `f591f8c` (M4-C), `db3a2a8` (M4-A), `493d5d6` (M4-D+E), `2563b4b` (M4-B), `ba843b5` (M4-F), `dbcb99d` (supporting changes)
>
> **Migration:** v33 (clinic patient extension columns) — needs deployment to production.

**Feature C — Country Pack System:**

1. **New file** `backend/config/country-packs.js` — 23 country configs (currency, timezone, default tax, cash denominations, compliance features, available couriers, regions)
2. **New file** `backend/routes/country-packs.js` — public API: `GET /api/country-packs` (summary list), `GET /api/country-packs/:code` (full details)
3. **Setup wizard refactor** — Frontend fetches from API instead of hardcoded `COUNTRY_DATA`/`COUNTRY_DENOMS`. Auto-fills currency, timezone, denominations, and default tax on country selection.
4. **Setup backend** — Accepts `country_code`, resolves via `getCountryCodeFromName()` for backward compat. Auto-seeds compliance features (e.g. `fbr_integration` for PK) and default tax from country pack.

**Feature A — Receipt Wording Adaptation:**

1. Labels flow from `PresetContext` → `POSContext` → `receipt.js` (browser popup), `POSReceiptModal` (screen), and `printer.js` (thermal ESC/POS)
2. Clinic receipts say "Patient:", salon says "Client:", wholesale says "Buyer:" — all driven from `industry-config.js` labels
3. Backend `POST /api/print/receipt` accepts `labels` in body, falls back to `getPresetLabels(industry_type)` from company profile

**Feature D — Per-Preset Report Defaults:**

1. Added `visible_report_groups` to each preset — `null` = show all, array = show only listed groups
2. Service presets (salon, clinic, gym, photography) hide Procurement, Inventory, Operations, Multi-Channel
3. Restaurant/cafe hide Procurement and Multi-Channel; retail/grocery/wholesale show all
4. Reports sidebar filters by `sidebarGroups`; direct URL access to hidden tabs still works (no data gating)

**Feature E — Preset-Aware POS Search Defaults:**

1. Added `pos_search_config` to each preset — `{ show_barcode, show_sku, show_price }`
2. Service presets hide barcode + SKU (keep price); restaurant/cafe hide all three; retail/grocery/wholesale show all
3. `POSSearchArea.jsx` conditionally renders search fields based on config; adapts grid columns to visible field count

**Feature B — Sample Data Seeding Per Preset:**

1. **New file** `backend/seeds/preset-seed-data.js` — 10 seed configs with 2-4 categories + 3-5 sample products each
2. Called during setup transaction after outlet creation. All samples labeled "(Sample)" with 100 initial stock
3. Guard: skips if products already exist. Non-fatal: seeding failure logs but doesn't abort setup

**Feature F — Clinic Patient Extension:**

1. **Migration v33** — 6 nullable columns on `customers`: `blood_group`, `allergies`, `medical_notes`, `emergency_contact_name`, `emergency_contact_phone`, `insurance_id`
2. Backend `POST/PUT /api/customers` accepts and returns medical fields
3. Frontend shows "Medical Information" section (blood group dropdown, allergies, emergency contacts, insurance ID, medical notes) only when `industry_type === "clinic"`
4. Detail view shows medical info card with red-highlighted allergies

---

## 7. Database Changes

### New Columns on `company_profile`

```sql
ALTER TABLE company_profile
  ADD COLUMN industry_type TEXT DEFAULT 'general_retail',
  ADD COLUMN business_model TEXT DEFAULT 'buy_sell',
  ADD COLUMN country_code TEXT DEFAULT 'PK',
  ADD COLUMN industry_preset_version INTEGER DEFAULT 1;
```

### New Table: `tenant_modes`

```sql
CREATE TABLE IF NOT EXISTS tenant_modes (
  mode TEXT NOT NULL PRIMARY KEY,
  enabled BOOLEAN DEFAULT true,
  enabled_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Existing Tables: No Changes

- `feature_flags` — untouched, backward compatible
- `company_profile` existing columns — untouched
- Nav-config — additive only (`requiredMode` added, `requiredFlag` kept)

---

## 8. Key Files Involved

### Backend

| File | Change |
|------|--------|
| `backend/schema-pg.sql` | Add columns + new table |
| `backend/migrate-pg.js` | New migration (v31) |
| `backend/routes/setup.js` | Accept industry_type, write company_profile + tenant_modes |
| `backend/routes/auth.js` | Extend bootstrap response with preset data |
| New: `backend/config/industry-config.js` | Mode registry + preset definitions (source of truth) |
| New: `backend/config/mode-registry.js` | What each mode unlocks (nav items, labels, permissions) |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/pages/SetupWizard.jsx` | Add business-type picker step |
| `frontend/src/ui/nav-config.js` | Add `requiredMode` to relevant items |
| `frontend/src/components/AppLayoutRedesign.jsx` | Add mode-based filtering to nav |
| New: `frontend/src/contexts/PresetContext.jsx` | Provide labels, modes, preset data to app |
| `frontend/src/hooks/useFeatureFlags.js` | Possibly extend to also return enabled modes, or create separate `useModes` hook |

---

## 9. What NOT to Do

- **Don't "complete all 10 core modules first"** — 8 of 10 are already strong; waiting creates endless scope with no ship date
- **Don't build the preset engine abstractly** — it must ship with 3 real presets or it has no teeth
- **Don't scatter industry-specific if/else checks across pages** — all adaptation flows through the preset config and mode system
- **Don't make the config a god object** — keep preset config, mode registry, and country pack as three separate concerns
- **Don't make business_model permanently single-value** — tenants start with one default but can enable more modes over time
- **Don't try to handle every adaptation surface on day one** — start with 5 surfaces (nav, labels, dashboard widgets, POS mode, onboarding), add more later

### V1 Adaptation Surfaces (ship with engine)

1. Sidebar nav visibility (which groups/items show)
2. Labels (Product vs Menu Item vs Service)
3. Dashboard widgets (which cards appear)
4. POS layout mode (retail vs restaurant vs service)
5. Onboarding checklist (what steps to show)

### Later Adaptation Surfaces (all delivered in M4)

- ~~Receipt wording adaptation~~ — M4-A
- ~~Sample data seeding per preset~~ — M4-B
- ~~Country pack integration~~ — M4-C
- ~~Per-preset report defaults~~ — M4-D
- ~~Preset-aware search/filter defaults~~ — M4-E
- Clinic patient extension (bonus) — M4-F

---

## 10. Design Principles

1. **The industry should not create the foundation. The foundation should let the industry appear naturally.**
2. **One platform, many faces** — presets are configuration, not code forks.
3. **Modes are additive** — a tenant starts with one preset's default modes and can enable more over time.
4. **Feature flags are for operations, modes are for identity** — never conflate "what kind of business" with "what toggle is on."
5. **Backend is source of truth** — the frontend keeps only display options for the setup picker; computed config comes from the backend bootstrap API.
6. **Incremental migration** — existing tenants keep working through their current flags until explicitly migrated to modes.

---

## 11. Next Steps

1. ~~**Enter plan mode** — Create a detailed design document from this specification~~ Done
2. ~~**Create implementation plan** — File-by-file changes, migration script, test plan~~ Done (`docs/plans/2026-04-13-preset-engine-m1-completion.md`)
3. ~~**Execute Milestone 1** — Tenant Preset Engine v1 with retail, restaurant, salon presets~~ Done (deployed 2026-04-14)
4. ~~**Review and ship** — Acceptance test all 3 preset paths end-to-end~~ Done (production E2E verified)
5. ~~**Execute Milestone 2** — Workflow/ticket engine + recurring billing polish~~ Done (deployed 2026-04-14, 6/6 smoke tests passing)
6. ~~**Execute Milestone 3** — Additional presets (grocery, cafe, clinic, repair shop, gym, wholesale, photography studio)~~ Done (21/21 unit tests passing, frontend builds clean)
7. ~~**Execute Milestone 4** — Deepen preset adaptation surfaces (country packs, receipt labels, report defaults, POS search, sample data, clinic extension)~~ Done (25/25 unit tests passing, 6 features delivered 2026-04-14)
8. ~~**Execute Milestone 5** — Weight-based selling + POS label polish + 3 new presets (butcher, sweet_shop, textile)~~ Done (26/26 unit tests passing, migration v34 deployed to all 3 production tenants, commit `c3fa47d`)

**Preset Engine v1 is COMPLETE.** All 4 milestones delivered. 10 industry presets, 10 adaptation surfaces, 6 business modes, 23 country packs.

**Preset Engine v2 is IN PROGRESS.** M5 shipped 2026-04-14 — now at 13 presets and ~35 industries covered.

---

## 12. Preset Engine v2 Roadmap — Expanding Industry Coverage

### Current Coverage (v1 + M5)

| What | Count | Details |
|------|-------|---------|
| Industry presets | 13 | retail, grocery, wholesale, restaurant, cafe, salon, clinic, repair_shop, gym, photography_studio, **butcher, sweet_shop, textile** (M5) |
| Business modes | 6 | retail, restaurant, appointments, service_projects, subscriptions, workflow_tickets |
| Country packs | 23 | PK, US, GB, CA, AU, IN, AE, SA, BD, NG, KE, GH, ZA, EG, DE, FR, NL, SG, MY, ID, PH, NZ, OTHER |
| Adaptation surfaces | 11 | Nav, labels, dashboard widgets, POS layout, onboarding, receipts, reports, POS search, sample data, clinic fields, **unit vocabulary / weight-based selling** (M5) |

The 13 presets now cover **~35 of 54 industries**. The remaining ~19 industries need new operational capabilities (rentals, room management, customer portal, online booking, manufacturing) before we can add presets without them being hollow labels.

### What's Missing — Three Tiers

**Tier 1: Small Extensions** — 80% of the workflow exists, one missing piece makes the preset incomplete.

| Feature | Industries It Unlocks | Effort | What to Build |
|---------|----------------------|--------|---------------|
| Weight/unit-based selling | Atta chakki, butcher, sweet shop, textile, dry fruits (~5 industries) | 2-3 days | `sell_by_weight` flag on products, decimal quantity input + unit label (kg/m/lb), POS tare weight field |
| Walk-in service assignment on POS | Car wash, laundry, tailoring (~3 industries) | 2-3 days | Time estimate per service, staff picker at checkout for walk-in services (not appointment-based — immediate assignment) |
| Recurring auto-charge wiring | Coworking, tuition center (~2 industries) | 3-5 days | `subscription_autocharge` tables exist but no payment gateway wiring — needs Stripe/JazzCash recurring billing integration |

**Tier 2: New Modes** — genuinely new operational concepts that don't map to any existing mode.

| New Mode | Industries It Unlocks | Effort | What to Build |
|----------|----------------------|--------|---------------|
| `rentals` | Car rental, equipment hire, party supplies, camera gear rental (~4 industries) | 2 weeks | Asset register (items with serial numbers), check-out/return workflow, duration-based pricing (hourly/daily/weekly), deposit hold + release, overdue tracking, damage assessment on return |
| `room_management` | Hotel, guesthouse, hostel (~3 industries) | 2 weeks | Room inventory (type/floor/capacity — not product inventory), date-range availability calendar (not time-slot appointments), check-in/check-out status board, housekeeping status, rate calendar (seasonal/weekend pricing), guest folio (tab of charges across stay) |
| `manufacturing` | Small factory, bakery production, packaging unit (~2 industries) | 2 weeks | Bill of materials (BOM — recipe of inputs per output), work orders (produce X units of Y), input consumption tracking (deduct raw materials on production), cost roll-up (actual cost per unit produced) |
| `treatment_plans` | Dental clinic, veterinary, physiotherapy (~3 industries) | 2 weeks | Multi-visit treatment plan (plan → sessions → completion), per-tooth/per-area charting (dental), medical history timeline (richer than the 6 M4 clinic fields), lab order integration, consent forms |

**Tier 3: Platform Capabilities** — cross-cutting features that multiple industries need, not a single mode.

| Capability | Who Needs It | Effort | What to Build |
|-----------|-------------|--------|---------------|
| Online booking page | Salon, clinic, gym, car wash, photography — any appointment-based business (~8 industries) | 1 week | Public tenant-branded booking page. `public-bookings.js` routes exist (API-only) but no consumer-facing UI. Needs: service catalog display, staff availability picker, payment collection, confirmation email, calendar sync |
| Customer portal | B2B wholesale, service businesses, clinic patients — all verticals benefit | 2 weeks | Authenticated customer login (separate from employee login), view invoices/appointments/orders, pay outstanding balance, download receipts. Currently all customer interaction is staff-mediated |
| Multi-location intelligence | Franchise retail, chain restaurants, multi-branch wholesale | 2 weeks | Transfer optimization (suggest transfers from overstocked to understocked), consolidated reporting across outlets, central purchasing with per-outlet allocation. Tables exist (`outlet_stock`, `inventory_transfers`) but UX is single-branch focused |
| Own-fleet delivery | Restaurant (own delivery), grocery, any local delivery | 1-2 weeks | Driver assignment, route management, real-time tracking, proof of delivery. 13 third-party courier adapters exist, but not own-fleet dispatch |

### Priority Map — Industries Unlocked Per Effort

```
Effort →
  ┃
  ┃  ★ Weight-based selling      +5 industries  (2-3 days)
  ┃  ★ Online booking page       +8 industries  (1 week)
  ┃  ★ Rentals mode              +4 industries  (2 weeks)
  ┃  ○ Customer portal           all verticals   (2 weeks)
  ┃  ○ Room management           +3 industries  (2 weeks)
  ┃  ○ Treatment plans           +3 industries  (2 weeks)
  ┃  ○ Manufacturing             +2 industries  (2 weeks)
  ┃
  ★ = high ROI (most industries per day of effort)
  ○ = build when customers ask
```

### Proposed Milestones (v2)

#### Milestone 5: Quick Wins — Weight-Based Selling + POS Label Polish — COMPLETE

> **Status:** Done — shipped 2026-04-14 (commit `c3fa47d`). 26/26 unit tests passing, sales-decimal-quantity integration test passing, frontend builds clean.
>
> **Migration:** v34 (widen `sale_items.quantity` to `NUMERIC(10,3)`, add `gross_weight` + `tare_weight`) applied to public + 3 production tenant schemas on 2026-04-14.
>
> **Bonus fix bundled in the same commit:** the SanoPay sandbox migration was authored as a duplicate `version: 32` and silently skipped by the runner. Re-numbered to v35 so `sale_payments.gateway_ref` and `returns.gateway_refund_ref` actually land on production.

**Scope delivered:**
- A. Decimal quantity (`NUMERIC(10,3)`) accepted end-to-end — `schemas/sales.js`, `routes/sales.js`, POS cart, receipts
- B. Unit vocabulary per preset — `WEIGHTED_UNITS` + `DEFAULT_UNIT_VOCABULARY` + `getUnitVocabulary()` in `backend/config/industry-config.js`; ProductFormPage dropdown driven by `preset.unit_vocabulary`
- C. Inline `WeightedQtyCell` in `POSCartTable` with optional tare input; non-weighted items keep the existing +/- button UX
- D. Hardcoded POS strings migrated to `usePreset()` labels — `POSSearchArea`, `POSSidebar`, `POSCheckoutModal`
- E. 3 new presets added: `butcher`, `sweet_shop`, `textile` (all retail mode + weight selling; wired into SetupWizard + CompanySettings)
- F. Receipt rendering (`utils/receipt.js`) shows decimal qty and gross/tare/net breakdown row when weighted
- G. Stock deduction uses `Math.ceil()` for weighted items (v1 keeps `outlet_stock` as INTEGER; upgrade to NUMERIC deferred)

**Known limitation (in scope for v2 later):** `return_items.quantity` and `stock_adjustments.quantity` remain INTEGER. Returning a weighted item will truncate the return quantity. Widening these is explicitly deferred.

**Effort (actual):** ~1 day

#### Milestone 6: Online Booking Page

**Goal:** Give every appointment-based preset a public booking URL they can share with customers.

**Scope:**
- A. Public tenant-branded booking page at `/{tenant-slug}/book` or `book.sanopos.com/{slug}`
- B. Service catalog display (from existing `booking_services` table)
- C. Staff + time slot availability picker (from existing `booking_availability_rules`)
- D. Customer self-registration + booking confirmation email
- E. Optional deposit collection via payment gateway
- F. Calendar embed / share link for WhatsApp/Instagram bio

**Effort:** ~1-2 weeks. Routes exist (`public-bookings.js`), this is primarily frontend.

**Unlocks:** Salon, clinic, gym, car wash, photography, spa, driving school, veterinary (~8 industries gain a customer-facing entry point)

#### Milestone 7: Rentals Mode

**Goal:** New business mode for asset-based businesses.

**Scope:**
- A. `rental_assets` table (serial number, condition, daily/hourly/weekly rate, deposit amount, current status)
- B. `rental_contracts` table (asset, customer, check-out date, expected return, actual return, charges, damage notes)
- C. Rental check-out flow (select asset → customer → duration → deposit → contract)
- D. Return flow (condition check → damage assessment → final charge → deposit release)
- E. Availability calendar per asset
- F. Overdue tracking + alerts
- G. New presets: `car_rental`, `equipment_hire`
- H. Mode: `rentals`, nav group: "Rentals" (Assets, Active Contracts, Returns, Calendar)

**Effort:** ~2 weeks

#### Milestone 8: Customer Portal

**Goal:** Give customers their own login to view history, pay invoices, book appointments.

**Scope:**
- A. Customer authentication (separate from employee auth — email/phone + OTP or password)
- B. Customer dashboard: order history, upcoming appointments, outstanding invoices, loyalty balance
- C. Pay invoice online (via existing payment gateway)
- D. Book/reschedule appointments (connects to booking engine)
- E. Download receipts + invoices
- F. Tenant-branded portal at `portal.sanopos.com/{slug}` or `/{slug}/portal`

**Effort:** ~2 weeks. Benefits every vertical — B2B wholesale buyers check invoices, salon clients book appointments, clinic patients see visit history.

#### Milestone 9: Room Management Mode (if hotel demand exists)

**Goal:** Support hotel/guesthouse/hostel businesses.

**Scope:**
- A. `rooms` table (room number, type, floor, capacity, rate, status)
- B. `room_bookings` table (guest, room, check-in, check-out, rate, folio)
- C. Availability calendar (date-range, not time-slot)
- D. Check-in/check-out status board
- E. Guest folio (charges during stay — minibar, room service, laundry)
- F. Housekeeping status tracking
- G. Seasonal/weekend rate calendar
- H. New presets: `hotel`, `guesthouse`
- I. Mode: `room_management`

**Effort:** ~2 weeks

#### Milestone 10: Manufacturing Mode (if factory demand exists)

**Goal:** Support small production/assembly businesses.

**Scope:**
- A. `bill_of_materials` table (output product → input items + quantities)
- B. `work_orders` table (produce X units of Y, status, start/complete dates)
- C. Input consumption tracking (deduct raw materials from inventory on production)
- D. Cost roll-up (actual production cost per unit)
- E. Production dashboard (active work orders, material availability, output tracking)
- F. New presets: `small_factory`, `bakery_production`
- G. Mode: `manufacturing`

**Effort:** ~2 weeks

### Coverage Projection

| After Milestone | Presets | Modes | Industries Covered (of 54) |
|----------------|---------|-------|---------------------------|
| v1 (M1-M4) | 10 | 6 | ~30 |
| **M5 (weight selling) — current** | **13** | **6** | **~35** |
| M6 (online booking) | 13 | 6 | ~38 (existing presets gain customer-facing entry) |
| M7 (rentals) | 15 | 7 | ~42 |
| M8 (customer portal) | 15 | 7 | ~42 (all verticals gain customer self-service) |
| M9 (room management) | 17 | 8 | ~45 |
| M10 (manufacturing) | 19 | 9 | ~47 |

The remaining ~7 industries (niche verticals like charity kitchen, medical lab, auction house) would need further assessment when demand materializes.

### Build Triggers

Not all milestones should be built speculatively. The decision framework:

| Milestone | Build When |
|-----------|-----------|
| ~~**M5 (weight selling)**~~ | ~~Before next marketing push — it's cheap and broadens the pitch~~ **DONE 2026-04-14** |
| **M6 (online booking)** | When any appointment-based tenant asks "can my customers book online?" |
| **M7 (rentals)** | When a rental business signs up or expresses interest |
| **M8 (customer portal)** | When 5+ tenants are active — it's a retention/stickiness play |
| **M9 (room management)** | Only when a hotel/guesthouse pays or commits |
| **M10 (manufacturing)** | Only when a factory/production business pays or commits |

---

## 13. Relationship to Other Strategic Documents (unchanged)

| Document | Relationship |
|----------|-------------|
| `sano-plan.md` | Company structure and SanoPay strategy — this engine is the product foundation SanoPay builds on |
| `sanopos-54-industry-coverage-matrix.md` | Industry coverage analysis — this engine is the implementation of the "presets over verticals" strategy recommended there |
| `sano-vs-square-vs-shopify-gap-analysis.md` | Competitive gap analysis — closing restaurant/appointments/omnichannel gaps requires the preset engine to exist first |
| `square-complete-platform-research.md` | Square's mode system is the reference model for SanoPOS's preset/mode architecture |
