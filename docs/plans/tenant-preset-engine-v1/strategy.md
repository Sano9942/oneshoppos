# Tenant Preset Engine v1 — Strategy & Implementation Specification

**Date:** 2026-04-13
**Status:** Agreed — ready for design doc and implementation plan
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

### Later Adaptation Surfaces (not in v1)

- Receipt wording adaptation
- Sample data seeding per preset
- Country pack integration
- Per-preset report defaults
- Preset-aware search/filter defaults

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

---

## 12. Relationship to Other Strategic Documents

| Document | Relationship |
|----------|-------------|
| `sano-plan.md` | Company structure and SanoPay strategy — this engine is the product foundation SanoPay builds on |
| `sanopos-54-industry-coverage-matrix.md` | Industry coverage analysis — this engine is the implementation of the "presets over verticals" strategy recommended there |
| `sano-vs-square-vs-shopify-gap-analysis.md` | Competitive gap analysis — closing restaurant/appointments/omnichannel gaps requires the preset engine to exist first |
| `square-complete-platform-research.md` | Square's mode system is the reference model for SanoPOS's preset/mode architecture |
