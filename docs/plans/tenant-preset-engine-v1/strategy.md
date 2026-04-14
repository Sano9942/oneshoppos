# Tenant Preset Engine v1 — Strategy & Implementation Specification

**Date:** 2026-04-13 (last updated 2026-04-15)
**Status:** v1 COMPLETE (M1-M4, 2026-04-14). v2 IN PROGRESS — M5, M6, M7 shipped 2026-04-14; M8, M9 shipped 2026-04-15.

---

## ⚡ Dev Infrastructure — SanoPay Sandbox (IMPORTANT FOR ALL FUTURE FEATURES)

**SanoPay sandbox is wired on BOTH local dev and Railway** for end-to-end payment testing. When building any feature that involves payments (checkouts, deposits, invoices, subscriptions, refunds), use the sandbox adapter — do NOT mock the payment layer in tests or require real xPay credentials.

| Mode | `PAYMENT_GATEWAY` env | Use case |
|------|----------------------|----------|
| `sandbox` | `sandbox` | Local dev + Railway testing. Simulates auth/capture/release/refund via `/api/sandbox/pay/:ref` + webhook simulator |
| `xpay` | `xpay` | Production only. Real xPay API calls. |
| `manual` | `manual` or unset | Fallback — admin manually records payments, no online flow |

**Key files to study when adding payment-touching features:**
- [`backend/services/payment-gateway.js`](../../../backend/services/payment-gateway.js) — adapter registry (`ADAPTERS` at line 221). `getPaymentAdapter()` dispatches on env var, so sandbox/xpay/manual all share the same code path. Never hardcode xPay.
- [`backend/routes/sandbox.js`](../../../backend/routes/sandbox.js) — hosted sandbox payment page + webhook simulator endpoint. Use this in integration tests to fire `authorized` / `captured` / `released` events without real HTTP callbacks.
- [`backend/routes/webhooks.js`](../../../backend/routes/webhooks.js) — single webhook endpoint. Adapter-agnostic: `verifyWebhook()` dispatches on the active provider. When adding a new payment context (like M9's room deposits), add a new lookup block here — do NOT create a separate `/api/webhooks/<provider>` route.
- [`backend/tests/integration/pg-sandbox-payment.test.js`](../../../backend/tests/integration/pg-sandbox-payment.test.js) — the canonical template for testing any payment-gateway flow. Copy this pattern for new payment-touching features.

**Why this matters:** Historically, features that touched payments (M8 invoice pay, M9 room deposits) skipped real end-to-end tests because the payment layer was too expensive to exercise. With the sandbox wired on both environments, there is no excuse — every new payment flow MUST have an integration test that drives it through `PAYMENT_GATEWAY=sandbox` with a simulated webhook. Doing so catches adapter-dispatch bugs, webhook-signature bugs, and state-machine bugs before they reach production.

**Rule of thumb:** If your feature writes a `gateway_ref` anywhere, or listens for a webhook, your PR needs at least one test that runs with `PAYMENT_GATEWAY=sandbox` and simulates the full lifecycle.
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
9. ~~**Execute Milestone 6** — Online booking page polish: confirmation email, share link UI, industry-aware labels, validation + rate limiting + time guards, `.ics` calendar download, integration + unit test coverage~~ Done (commit `760344b`, 29 new automated tests, no migration required)
10. ~~**Execute Milestone 7** — Rentals mode: `rentals` business mode + 4 asset-rental presets (car_rental, equipment_hire, furniture_rental, party_supplies_rental), 5 new tables, 18 endpoints, 3-tab UI with Gantt timeline, overdue worker + email, 41 new automated tests~~ Done 2026-04-14 (commits `2afaf2d` + `8f94816` test fixup + `6688a43` mode-flag reset hardening, migration v36, 21 files touched)
11. ~~**Execute Milestone 8** — Customer portal at `/portal/:tenantSlug`: email+password / email-OTP auth, preset-driven tabs, invoice pay (reuses `customer_invoice_payment_links` + existing webhook Context 2), self-service appointments (book/reschedule/cancel), profile + addresses editing, 8 new email templates, 34 new automated tests~~ Done 2026-04-15 (commit `cb41110`, migration v37 applied to public + all 3 tenant schemas on Railway, 30 files touched)
12. ~~**Execute Milestone 9** — Room Management mode: `room_management` business mode + 3 hospitality presets (hotel, guesthouse, hostel), 6 new tables (room_types, rooms, room_rate_overrides, room_bookings, guest_folios, folio_lines) + `sales.folio_id` column, ~25 endpoints, 5-tab UI (Rooms, Rates, Bookings, Calendar Gantt, Arrivals/Departures), POS "Charge to room" context picker, customer portal "My Stays" tab, adapter-agnostic deposit pre-auth via `payment-gateway.js` (works with sandbox, xpay, manual), overdue-checkout worker, 5 email templates, 57 new automated tests (37 unit + 20 integration)~~ Done 2026-04-15 (commits `b861755` + `f559fdd`, migration v38, 34 files touched)

**Preset Engine v1 is COMPLETE.** All 4 milestones delivered. 10 industry presets, 10 adaptation surfaces, 6 business modes, 23 country packs.

**Preset Engine v2 is IN PROGRESS.** M5, M6, M7, M8, M9 shipped between 2026-04-14 and 2026-04-15 — now at **20 presets, 8 business modes, ~45 industries covered**. Every appointment-based tenant has a public booking URL, rental businesses (car hire, equipment, furniture, party supplies) are fully supported with asset tracking + overdue alerts, every vertical has a customer portal at `/portal/:slug` for invoice pay, appointment self-service, and account management, and **hotels / guesthouses / hostels** are fully supported with room inventory, per-date rate overrides, guest folios (with POS charge-to-room), housekeeping status, and adapter-agnostic security deposits.

---

## 12. Preset Engine v2 Roadmap — Expanding Industry Coverage

### Current Coverage (v1 + M5 + M6 + M7 + M8 + M9)

| What | Count | Details |
|------|-------|---------|
| Industry presets | 20 | retail, grocery, wholesale, restaurant, cafe, salon, clinic, repair_shop, gym, photography_studio, butcher, sweet_shop, textile (M5), car_rental, equipment_hire, furniture_rental, party_supplies_rental (M7), **hotel, guesthouse, hostel** (M9) |
| Business modes | 8 | retail, restaurant, appointments, service_projects, subscriptions, workflow_tickets, rentals (M7), **room_management** (M9) |
| Country packs | 23 | PK, US, GB, CA, AU, IN, AE, SA, BD, NG, KE, GH, ZA, EG, DE, FR, NL, SG, MY, ID, PH, NZ, OTHER |
| Adaptation surfaces | 15 | Nav, labels, dashboard widgets, POS layout, onboarding, receipts, reports, POS search, sample data, clinic fields, unit vocabulary / weight-based selling (M5), public booking labels (M6), rental asset/contract UX (M7), portal labels + per-preset tab list (M8), **room inventory + rate calendar + folio UX** (M9) |
| Public customer-facing surfaces | 3 | Public receipt URL (v1), public booking page at `/book/:slug` with per-preset labels, share link UI, ICS download, confirmation email (M6), customer portal at `/portal/:slug` with preset-driven tabs, invoice pay, self-service appointments, profile/address editing (M8), **"My Stays" portal tab** with past/upcoming bookings and linked invoices (M9) |

The 20 presets now cover **~45 of 54 industries** (up from 42 — M9 adds 3 hospitality verticals on the new `room_management` mode). M9 ships a full hotel operating model: unique room inventory (not asset pool), per-date rate overrides (weekend/seasonal pricing), open-tab guest folios that accumulate room-night + POS charges during the stay, housekeeping status, overdue-checkout alerts, and adapter-agnostic deposit pre-auth (via `payment-gateway.js` — works with `sandbox`, `xpay`, or `manual`). The remaining ~9 industries need new operational capabilities (manufacturing, treatment plans) before we can add presets without them being hollow labels.

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
| ~~`rentals`~~ | ~~Car rental, equipment hire, party supplies, camera gear rental (~4 industries)~~ | ~~2 weeks~~ | **DONE M7 (2026-04-14)** — Asset register (items with serial numbers), check-out/return workflow, duration-based pricing (hourly/daily/weekly), deposit hold + release, overdue tracking, damage assessment on return |
| ~~`room_management`~~ | ~~Hotel, guesthouse, hostel (~3 industries)~~ | ~~2 weeks~~ | **DONE M9 (2026-04-15)** — Room inventory (type/floor/capacity — not product inventory), date-range availability calendar (not time-slot appointments), check-in/check-out status board, housekeeping status, rate calendar (seasonal/weekend pricing), guest folio (tab of charges across stay), adapter-agnostic deposit pre-auth |
| `manufacturing` | Small factory, bakery production, packaging unit (~2 industries) | 2 weeks | Bill of materials (BOM — recipe of inputs per output), work orders (produce X units of Y), input consumption tracking (deduct raw materials on production), cost roll-up (actual cost per unit produced) |
| `treatment_plans` | Dental clinic, veterinary, physiotherapy (~3 industries) | 2 weeks | Multi-visit treatment plan (plan → sessions → completion), per-tooth/per-area charting (dental), medical history timeline (richer than the 6 M4 clinic fields), lab order integration, consent forms |

**Tier 3: Platform Capabilities** — cross-cutting features that multiple industries need, not a single mode.

| Capability | Who Needs It | Effort | What to Build |
|-----------|-------------|--------|---------------|
| ~~Online booking page~~ | ~~Salon, clinic, gym, car wash, photography — any appointment-based business (~8 industries)~~ | ~~1 week~~ | **SHIPPED in M6 (2026-04-14).** Public page at `/book/:tenantSlug` with industry-aware labels, share-link card in admin UI, confirmation email, `.ics` download, 15-min min-notice + `max_advance_days` guards, rate limiting. Deposit collection deferred to future M6.5 (xPay hookup). |
| ~~Customer portal~~ | ~~B2B wholesale, service businesses, clinic patients — all verticals benefit~~ | ~~2 weeks~~ | **SHIPPED in M8 (2026-04-15).** Authenticated portal at `/portal/:tenantSlug` with email+password / email-OTP auth (separate JWT pipeline, scope=customer). Preset-driven tabs (invoices/orders/appointments/subscriptions/contracts/tickets/loyalty/wallet/profile) ANDed with tenant feature flags. Invoice pay reuses `customer_invoice_payment_links` + existing webhook Context 2 — no gateway changes. Self-service appointment book/reschedule/cancel with 15-min notice guard. Profile + saved addresses + marketing consent editing. Migration v37, 30 files touched, 34 new tests. |
| Multi-location intelligence | Franchise retail, chain restaurants, multi-branch wholesale | 2 weeks | Transfer optimization (suggest transfers from overstocked to understocked), consolidated reporting across outlets, central purchasing with per-outlet allocation. Tables exist (`outlet_stock`, `inventory_transfers`) but UX is single-branch focused |
| Own-fleet delivery | Restaurant (own delivery), grocery, any local delivery | 1-2 weeks | Driver assignment, route management, real-time tracking, proof of delivery. 13 third-party courier adapters exist, but not own-fleet dispatch |

### Priority Map — Industries Unlocked Per Effort

```
Effort →
  ┃
  ┃  ★ Weight-based selling      +5 industries  (2-3 days)  [SHIPPED M5]
  ┃  ★ Online booking page       +8 industries  (1 week)    [SHIPPED M6]
  ┃  ★ Rentals mode              +4 industries  (2 weeks)   [SHIPPED M7]
  ┃  ★ Customer portal           all verticals   (2 weeks)  [SHIPPED M8]
  ┃  ★ Room management           +3 industries  (2 weeks)   [SHIPPED M9]
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

#### Milestone 6: Online Booking Page — COMPLETE

> **Status:** Done — shipped 2026-04-14 (commit `760344b`). 220/221 unit tests passing (1 pre-existing unrelated failure), frontend build clean. Integration test authored (execution requires Postgres connectivity — same infra prerequisite as every other pg-batch test).
>
> **Migration:** None — pure code + config changes. All additions are backward-compatible (new email template, new endpoint, additive response field).
>
> **Context correction:** the v2 roadmap originally described the public booking stack as "API-only" needing ~1-2 weeks of frontend work. On inspection the scaffolding was already ~80% built: the wizard page at `/book/:tenantSlug`, the 3 public endpoints, the slot engine, and appointment creation all worked. M6's real scope was the missing polish — confirmation email, tenant share link, industry-aware labels, guardrails, calendar download, tests.

**Scope delivered (6 sections):**

- **A. Booking confirmation email** — `bookingConfirmation` template in `services/email-templates.js` + registered in `TEMPLATES`. `createAppointment` now enqueues the email when `source === "public"` and `customer_email` present (non-fatal, wrapped in try/catch so a Resend outage cannot fail a booking). Tenant + company profile + ICS URL threaded through via a new optional `options` arg so the service stays pure.
- **B. Tenant-facing share link UI** — "Public booking link" card added to `AppointmentServicesRedesign.jsx`: shows `{origin}/book/{slug}`, Copy button (with execCommand fallback for non-secure contexts), zero-dep QR via `api.qrserver.com`, and "Test booking page" link. Reads tenant slug from session via `readTenantSlug()`.
- **C. Industry-aware public page labels** — `public_booking_labels` added to salon (Stylist), clinic (Provider), gym (Trainer / Class), photography_studio (Photographer). New `DEFAULT_PUBLIC_BOOKING_LABELS` + `getPublicBookingLabels()` helper in `industry-config.js`. `GET /api/public/bookings/config` now returns a `labels` object; `PublicBookingPage.jsx` consumes `config.labels.booking_cta` / `staff_singular` / `service_singular` with safe fallbacks.
- **D. Validation + rate limiting + time guards** — `validate(publicBookingSchema)` applied to POST (schema already existed in `schemas/bookings.js`). New `publicBookingLimiter` in `middleware/rate-limit.js` — 10 bookings / 15 min / IP+tenant, skipped in test env. `createAppointment` enforces a 15-minute minimum notice and respects `booking_services.max_advance_days`; admin-sourced bookings bypass both (receptionist use case).
- **E. `.ics` calendar attachment** — new zero-dep `utils/ics.js` builder (RFC 5545 escaping, CRLF line endings, 75-octet line folding). New `GET /api/public/bookings/:id/ics?tenant={slug}` endpoint returns `text/calendar; charset=utf-8` with a single `VEVENT`; only works for rows where `source='public'`. Frontend confirmation screen gets an "Add to calendar" button; the ICS URL is also embedded in the confirmation email body.
- **F. Test coverage** — new `backend/tests/integration/public-bookings.test.js` (pg-batch pattern, 11 assertions across config/availability/POST/ICS including 409 overlap, past-date rejection, max-advance rejection, Zod validation). New `backend/tests/unit/utils-ics.test.js` (12 tests). 6 new preset-label tests in `industry-config.test.js`. Total: 29 new automated tests.

**What each appointment-based preset shows on the public page:**

| Preset | CTA | Staff Label | Service Label |
|--------|-----|-------------|---------------|
| salon | Book an appointment | Stylist | Service |
| clinic | Book a visit | Provider | Service |
| gym | Book a session | Trainer | Class |
| photography_studio | Book a session | Photographer | Package |
| (default — anything else) | Book an appointment | Staff | Service |

**Out of scope (explicitly deferred, documented in plan):** deposit collection via xPay, Google Calendar sync, customer self-reschedule, waitlists/classes, custom-domain white-labeling.

**Effort (actual):** ~half a day. The original 1-2 week estimate assumed the public page didn't exist; it did.

**Unlocks:** Salon, clinic, gym, car wash, photography, spa, driving school, veterinary — any tenant whose preset enables `appointments` mode now has a production-ready customer-facing booking URL.

#### Milestone 7: Rentals Mode — COMPLETE

> **Status:** Done — shipped 2026-04-14. 29/29 new rental unit tests passing, full preset+mode+rental suite 67/67 green, frontend build clean in 22.5s (RentalsRoute: 27.4 KB / 6.75 KB gzip). All 7 new/modified backend modules load cleanly.
>
> **Migration:** v36 — 5 new tables (`rental_assets`, `rental_contracts`, `rental_line_items`, `rental_returns`, `rental_overdue_alerts`) + `phase4_rentals` feature flag. `schema-pg.sql` kept in parity.
>
> **Pre-existing failures (untouched, unrelated to M7):** `services.test.js` payment-gateway env-ordering, `middleware.test.js` missing `beforeEach`.

**Scope delivered (21 files touched):**

| Layer | Files |
|-------|-------|
| Migration | `migrate-pg.js` v36 (5 tables + feature flag) + `schema-pg.sql` parity |
| Mode / preset config | `config/mode-registry.js`, `config/industry-config.js` (4 new presets) |
| Middleware | `middleware/feature-flags.js`, `middleware/permissions.js` |
| Backend core | `schemas/rentals.js`, `services/rental-service.js` (~20 functions), `routes/rentals.js` (18 endpoints), `routes/registerAllRoutes.js` |
| Worker + email | `services/email-templates.js`, `workers/rental-overdue-worker-boss.js`, `boot/workers.js`, `routes/admin/system.js` |
| Frontend | `ui/nav-config.js`, `ui/Breadcrumbs.jsx`, `pages/RentalsRoute.jsx`, `pages/redesign/RentalsRedesign.jsx` (~900 lines — 3 tabs + 6 modals + CSS-grid Gantt), `routes/appRoutes.jsx`, `pages/SetupWizard.jsx`, `pages/redesign/CompanySettingsRedesign.jsx`, `pages/redesign/DashboardOnboarding.jsx` |
| Tests | `tests/unit/rentals.test.js` (29 unit tests), `tests/integration/pg-rental-contracts.test.js` (12 integration tests — requires DATABASE_URL) |

**What M7 delivered vs. original plan:**

| Original Scope Item | Delivered |
|---------------------|-----------|
| A. `rental_assets` table (serial, condition, rates, deposit, status) | ✅ Migration v36 |
| B. `rental_contracts` table (asset, customer, dates, charges, damage) | ✅ Migration v36 + `rental_line_items` for multi-asset contracts |
| C. Rental check-out flow (asset → customer → duration → deposit) | ✅ Contract create modal in `RentalsRedesign.jsx` |
| D. Return flow (condition check → damage → final charge → deposit release) | ✅ Return modal + `rental_returns` table |
| E. Availability calendar per asset | ✅ CSS-grid Gantt in Timeline tab |
| F. Overdue tracking + alerts | ✅ `rental-overdue-worker-boss.js` + `rental_overdue_alerts` table + email template |
| G. New presets: `car_rental`, `equipment_hire` | ✅ Plus bonus: `furniture_rental`, `party_supplies_rental` (4 total vs 2 planned) |
| H. Mode: `rentals`, nav group "Rentals" (Items, Contracts, Timeline) | ✅ 3 tabs — bonus refinement from "Assets/Active Contracts/Returns/Calendar" to cleaner "Items/Contracts/Timeline" |

**Effort (actual):** ~1 day end-to-end (planned 2 weeks). Leverage from existing preset/mode machinery — new mode slotted in through `mode-registry.js` + `industry-config.js` without touching any other preset.

**Unlocks:** Car rental, equipment hire (tools/tents/sound), furniture rental, party supplies — any asset-rental business with serial-numbered inventory, duration-based pricing, and deposit tracking.

#### Milestone 8: Customer Portal — COMPLETE

> **Status:** Done — shipped 2026-04-15 (commit `cb41110`). 13/13 portal unit tests + 21/21 integration tests passing, frontend builds clean (portal chunks all <8KB uncompressed), migration v37 applied to public + 3 production tenant schemas (handicraft, khantoys, packagesmall) on Railway.
>
> **Migration v37:** 5 new columns on `customers` (`portal_password_hash`, `portal_enabled_at`, `portal_tokens_revoked_before`, `portal_last_login_at`, `portal_email_verified_at`), 3 new tables (`customer_portal_otps`, `customer_portal_reset_tokens`, `customer_portal_refresh_tokens`), partial unique index on `LOWER(email)` for portal-enabled customers, `appointments.source` CHECK broadened to include `'portal'`.
>
> **Env:** `CUSTOMER_PORTAL_JWT_SECRET` set on Railway (falls back to `JWT_SECRET` with boot warning if unset).

**Scope delivered:**
- A. **Auth** — email+password primary + email-OTP fallback ("Email me a code instead"). Signup → email-verify OTP → auto-login. Password reset via long-token email link (revokes all refresh tokens on reset). Separate JWT pipeline with `scope: "customer"` (staff tokens can't cross-auth). Refresh token rotation on every refresh, SHA-256 hashed in DB, `httpOnly; SameSite=None; Secure; Path=/api/portal/auth` cookie (cross-site `sanopos.com` → `api.sanopos.com`).
- B. **Preset-driven tabs** — new `portal_labels` + `portal_enabled_tabs` surfaces in `backend/config/industry-config.js`. Preset tab list ANDed with tenant feature flags (`customer_invoicing`, `phase4_appointments`, `subscription_billing`, `phase4_rentals`, `phase4_service_projects`). Salon shows appointments+invoices+loyalty; wholesale shows invoices+orders; rentals show contracts+invoices; gym shows subscriptions+appointments+invoices; etc.
- C. **Invoice pay** — `POST /api/portal/me/invoices/:id/pay` reuses `customer_invoice_payment_links` + the existing webhook Context 2 in `routes/webhooks.js`. **Zero webhook changes needed.** `PortalInvoicePaidPage` polls invoice status after return from gateway to handle webhook race.
- D. **Self-service appointments** — book/reschedule/cancel via `services/booking-services.js` with `source='portal'`. 15-minute minimum notice guard enforced at the route layer. Ownership check via `customer_id`. All three actions enqueue branded confirmation emails.
- E. **Profile + addresses** — whitelisted profile fields (name, mobile, address, city, DOB, gender, 3 consent toggles, preferred contact). Full CRUD on `customer_addresses`.
- F. **URL** — `/portal/:tenantSlug` (no subdomain in v1). Slug-scoped frontend auth store (`customerPortalSession:${slug}`) so one browser can be logged into multiple tenants.
- G. **Rate limits** — 3 new limiters: `customerPortalAuthLimiter` (10/15m tenant+IP), `customerPortalOtpLimiter` (5/15m email+IP to prevent enumeration), `customerPortalDataLimiter` (120/min per customer_id).
- H. **Emails** — 8 new templates (welcome, OTP login, password reset, email verify, appointment confirmation / rescheduled / cancelled, payment receipt) registered in `TEMPLATES` map.
- I. **Tests** — 2 unit files (13 tests: JWT signing/verification, OTP hashing, preset tabs across all 17 industries) + 2 integration files (21 tests: password flow, OTP flow, data scoping, sandbox-payment link creation, appointment lifecycle with ownership + 15-min notice rejection).

**Effort (actual):** ~1 day end-to-end (planned 2 weeks). Most of the work was reuse — auth middleware mirrors `routes/admin/auth.js`, payment flow uses the already-live `customer_invoice_payment_links` primitive, appointment lifecycle delegates to existing `booking-services.js`.

**Unlocks:** Every vertical benefits. B2B wholesale buyers check and pay invoices without calling the office; salon/clinic clients book and reschedule appointments 24/7; gym members see upcoming classes + active subscriptions; rental customers see open contracts; all customers update their own marketing consent + addresses.

**Out of scope (explicitly deferred):** portal subdomain (`portal.sanopos.com`), per-tenant custom domains, mobile PWA install prompt, in-portal staff chat, loyalty redemption from portal (view-only), wallet top-up from portal (pay-invoice is the only money-in path), storefront cart integration (orders remain read-only in portal), social login.

#### Milestone 9: Room Management Mode — COMPLETE

**Goal:** Support hotel/guesthouse/hostel businesses.

**Shipped 2026-04-15** — commits `b861755` (backend + POS + portal + deposits) + `f559fdd` (frontend + tests). Migration v38. 34 files touched. 57 new automated tests (37 unit + 20 integration), all passing.

**What shipped:**
- **6 new tables** — `room_types`, `rooms`, `room_rate_overrides`, `room_bookings`, `guest_folios`, `folio_lines` + `sales.folio_id` column + `room_bookings.deposit_payment_intent_id` / `deposit_status` for adapter-agnostic deposit tracking
- **Mode + 3 presets** — `room_management` mode in `MODE_REGISTRY`; `hotel`, `guesthouse`, `hostel` presets with Room/Guest/Bed labels and hospitality-specific onboarding steps (store, room, rate, employees, booking, checkin)
- **~25 endpoints** under `/api/room-types`, `/api/rooms`, `/api/room-bookings` — double-gated by `phase4_room_management` feature flag + `manage_rooms` permission
- **Rate model** — `resolveRateForDate()` pure function picks override rate if a row covers the date, else falls back to `room_types.base_rate`. `calculateStayTotal()` loops dates to return per-night breakdown. Rate UI has inline override editor with weekend/seasonal labels.
- **Folio lifecycle** — Check-in auto-opens a folio seeded with one `room_night` line per night at the resolved rate. POS sales route to the folio via `sales.folio_id`; `attachSaleToFolio()` runs inside the sale transaction so a sale only links if the folio line also writes successfully (cross-domain atomicity). Settlement generates a `customer_invoice` with deposit-applied line.
- **Deposit pre-auth** — `room-deposits.js` wraps the existing `payment-gateway.js` adapter registry. Same code path works under `PAYMENT_GATEWAY=sandbox` (local + Railway testing) and `PAYMENT_GATEWAY=xpay` (production). Webhook context added to `routes/webhooks.js` — single endpoint serves every adapter because `verifyWebhook()` dispatches upstream.
- **POS "Charge to room" picker** — Context-driven dropdown appears in `POSCheckoutModal` only when `hasMode("room_management")`. Selecting a folio bypasses payment entry, marks the sale `payment_method='charge_to_room'`, and closes with a confirmation toast.
- **5-tab UI** — Rooms (CRUD + housekeeping picker), Rates (per-date override table), Bookings (filter + actions + folio drawer), Calendar (CSS-grid Gantt), Arrivals/Departures (today's board). Route chunk 29.9 KB gzipped 7.14 KB.
- **Customer portal "My Stays" tab** — gated by `phase4_room_management`; lists past + upcoming bookings with folio totals and linked invoices. Reuses M8 portal auth.
- **Overdue-checkout worker** — `room-overdue-checkout-worker-boss.js`, daily 11 AM cron, `ROOM_OVERDUE_WORKER_ENABLED=1` gate, heartbeat exposed at `/api/admin/worker-status`.
- **5 email templates** — `room_booking_confirmation`, `room_deposit_received`, `room_checkin_reminder`, `room_folio_receipt`, `room_overdue_checkout`.

**Explicitly Out of Scope — Deferred to M9.1 / M10+:**

These features were scoped out of M9 to keep the milestone at ~2 weeks. Each is a legitimate hospitality-industry feature that we would build when customer demand materializes or when bundling with a later milestone.

| # | Deferred Feature | Why deferred | When to build |
|---|-----------------|--------------|---------------|
| 1 | **Channel manager** (Airbnb, Booking.com, Expedia sync) | Each provider is a multi-week integration project on its own. Would likely be its own milestone (M9.2 or beyond). | When a tenant onboards who explicitly needs multi-channel distribution, OR when we can bundle with a broader "marketplace integrations v2" push |
| 2 | **Dynamic / revenue-management pricing** (demand-based rate adjustment) | Requires a pricing algorithm + historical occupancy data we don't have yet. M9 shipped flat per-date overrides which cover 90% of small-hotel use cases. | When we have real occupancy data from 3+ hotel tenants to train reasonable pricing rules |
| 3 | **Group bookings** (one reservation covering multiple rooms under one folio) | Requires a `booking_groups` parent table and multi-room folio aggregation. UI gets significantly more complex. | When a guesthouse or hostel with function/event business signs up |
| 4 | **Housekeeping staff assignment dashboard** (assign rooms to cleaners, track progress) | M9 shipped per-room status pickers (clean/dirty/inspected/OOO). Full staff-assignment dashboard requires shift integration + mobile-friendly cleaner UI. | When a tenant has ≥ 10 rooms and reports housekeeping coordination pain |
| 5 | **Late-checkout automated fees** | Currently the overdue worker only emails staff. Auto-charging requires a configurable fee policy + a capture step against the deposit. | Bundle with M9.1 "hotel polish" when we have the first hotel tenant in production for ≥ 30 days |
| 6 | **Multi-property chain management** (one tenant owns several hotels, consolidated reporting) | SanoPOS multi-outlet already supports this via the `outlets` table, but there's no roll-up reporting layer. | When a 2nd-property tenant actually signs up |
| 7 | **Public reservation page at `/reserve/:tenantSlug`** | Would extend M6's public booking scaffolding. M9 shipped admin-created bookings only. Adding a public reserve page requires date-range picker, real-time availability query, and optional guest-payment handoff. | When a tenant asks for it, OR bundle with a broader "public storefront expansion" push |
| 8 | **Loyalty point redemption on stay** | Points already *earn* on the final invoice via the existing customer-invoicing path. Redemption at booking time requires a new discount line type on folios. | When loyalty usage is ≥ 10% on hotel invoices |
| 9 | **Length-of-stay discounts / advance-booking discounts / package deals** | Hotel-specific pricing rules (e.g. "stay 5 nights get 1 free"). Partially overlaps with Tier 4's promotions engine but needs hotel-specific rule types. | Bundle with a future "hotel promotions" milestone, or extend the existing promotions engine if overlap is clean |
| 10 | **Room blocks / maintenance holds** (take a room out of inventory for a period without booking it) | Currently the only way to block a room is to mark it `out_of_order` via housekeeping status, which doesn't integrate with availability queries. | Small extension — half-day task. Pick up whenever a tenant reports the need. |
| 11 | **Split folios / per-guest billing** (two guests share a room, split the final bill) | Current folio is 1:1 with booking. Splitting requires tracking which folio line belongs to which guest. | When a business hotel (corporate travel) signs up and requests it |
| 12 | **Tax-inclusive room rates vs. tax-added-at-checkout toggle** | M9 shipped rates stored as-is; tax handling inherits from the existing `tax_total` column on invoices. Regions that require inclusive pricing (e.g. PK 16% sales tax baked into displayed rate) need an explicit config. | Bundle with a future "FBR hotel integration" pass — FBR has specific hospitality rules |

**Build triggers for deferred items:** Do not build speculatively. Follow the table above — each deferred feature has a concrete signal (tenant sign-up, real-world usage data, pain reported) that justifies the work.

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
| M5 (weight selling) | 13 | 6 | ~35 |
| M6 (online booking) | 13 | 6 | ~38 (existing presets gain customer-facing entry) |
| M7 (rentals) | 17 | 7 | ~42 (4 asset-rental verticals activated) |
| M8 (customer portal) | 17 | 7 | ~42 (all verticals gain customer self-service) |
| **M9 (room management) — current** | **20** | **8** | **~45 (3 hospitality verticals activated)** |
| M10 (manufacturing) | 22 | 9 | ~47 |

The remaining ~7 industries (niche verticals like charity kitchen, medical lab, auction house) would need further assessment when demand materializes.

### Build Triggers

Not all milestones should be built speculatively. The decision framework:

| Milestone | Build When |
|-----------|-----------|
| ~~**M5 (weight selling)**~~ | ~~Before next marketing push — it's cheap and broadens the pitch~~ **DONE 2026-04-14** |
| ~~**M6 (online booking)**~~ | ~~When any appointment-based tenant asks "can my customers book online?"~~ **DONE 2026-04-14** — scaffolding was mostly already built, so shipped pre-emptively |
| ~~**M7 (rentals)**~~ | ~~When a rental business signs up or expresses interest~~ **DONE 2026-04-14** — built pre-emptively to unlock 4 verticals |
| ~~**M8 (customer portal)**~~ | ~~When 5+ tenants are active — it's a retention/stickiness play~~ **DONE 2026-04-15** — built pre-emptively; retention/stickiness benefit activates as tenant count grows |
| ~~**M9 (room management)**~~ | ~~Only when a hotel/guesthouse pays or commits~~ **DONE 2026-04-15** — built pre-emptively to unlock 3 hospitality verticals; 12 deferred sub-features listed in §12 Milestone 9 for demand-driven follow-up |
| **M10 (manufacturing)** | Only when a factory/production business pays or commits |

---

## 13. Relationship to Other Strategic Documents (unchanged)

| Document | Relationship |
|----------|-------------|
| `sano-plan.md` | Company structure and SanoPay strategy — this engine is the product foundation SanoPay builds on |
| `sanopos-54-industry-coverage-matrix.md` | Industry coverage analysis — this engine is the implementation of the "presets over verticals" strategy recommended there |
| `sano-vs-square-vs-shopify-gap-analysis.md` | Competitive gap analysis — closing restaurant/appointments/omnichannel gaps requires the preset engine to exist first |
| `square-complete-platform-research.md` | Square's mode system is the reference model for SanoPOS's preset/mode architecture |

---

## 14. Known Gaps — Queued for Next Session

Findings discovered while verifying M7 (2026-04-15). Not in M7 scope; tracked here to prevent loss.

### Gap 14.1 — Subscriptions nav is flag-gated only, missing mode gate

**Finding:** [frontend/src/ui/nav-config.js:162](../../../frontend/src/ui/nav-config.js#L162) defines the Subscriptions nav item with `requiredFlag: "subscription_billing"` but **no `requiredMode`**. Every other mode-isolated nav item (Restaurant, Appointments, Service Work, Rentals, Commissions) uses the `flag + mode` double-gate pattern established in M1 and reinforced in M7. Subscriptions is the lone exception.

**Impact:**
- `subscription_billing` is DEFAULT `true` in [backend/middleware/feature-flags.js:45](../../../backend/middleware/feature-flags.js#L45) — so every tenant inherits it regardless of preset.
- Retail-only / grocery / wholesale / restaurant / cafe / clinic / repair_shop tenants all see "Subscriptions" in their sidebar even though subscriptions is a vertical-specific feature only used by the `gym` preset.
- Violates the separation-of-concerns principle established in §4: *"Feature flags are for operations, modes are for identity."* Subscriptions is business identity (do you sell memberships?), not an operational toggle.

**Investigation results (completed 2026-04-15):**

| Check | Result |
|-------|--------|
| Does `subscriptions` mode exist in `MODE_REGISTRY`? | ✅ YES — `backend/config/mode-registry.js:30-35` — already maps to `subscription_billing` flag |
| Which presets opt into `subscriptions`? | Only `gym` — `industry-config.js:202` has `modes: ["subscriptions", "appointments"]` |
| What's the default flag state? | `subscription_billing: true` globally (the bug) |
| Does `reconcile-mode-flags.js` auto-heal drift? | ✅ YES — it uses `getFeatureFlagsForModes(VALID_MODES)` as source of truth |

**Proposed scope (call this M7.5 or bundle into M8):**

1. **Frontend nav gate (1 line)** — Add `requiredMode: "subscriptions"` to [nav-config.js:162](../../../frontend/src/ui/nav-config.js#L162). Brings Subscriptions in line with the Restaurant/Rentals/Appointments pattern.
2. **Default flag flip (1 line)** — Change `subscription_billing: true` → `false` in `DEFAULT_FEATURE_FLAGS`. New tenants no longer inherit the flag; the mode-enable path turns it on when `gym` preset (or explicit mode toggle) is selected.
3. **Backfill migration (~30 lines)** — For every active tenant with `subscription_billing=true` AND no `subscriptions` row in `tenant_modes`, decide whether to:
   - **Option A (safer):** INSERT `subscriptions` into `tenant_modes` to preserve existing access. Accept that tenants who aren't using it will still see the nav.
   - **Option B (cleaner):** INSERT only for tenants who actually have data in `customer_subscriptions` or `subscription_plans`. Disable the flag for the rest.
4. **Smoke test update** — `frontend/tests/smoke/m2-tickets-subscriptions.smoke.spec.js` likely asserts Subscriptions visibility; update to seed the mode first.
5. **Reconcile script verification** — Run `node backend/scripts/reconcile-mode-flags.js` in production after backfill to confirm data drift is zero.

**Risk if we ship nav gate without backfill:** Existing tenants using `/subscriptions` in production (e.g., if packagesmall or any gym tenant has real data) lose the nav link overnight until their `tenant_modes` is backfilled. **Do not ship #1 alone.**

**Effort estimate:** ~half a day. Two one-line edits + a careful backfill script + smoke test update + production reconcile run.

**Related observation:** This class of drift (flag default true but no matching mode row) should be audited across the full flag list. Commissions had the same shape before M1 gated it properly. A one-time audit script — *"find flags seeded `true` by default that correspond to a registered mode"* — would surface any remaining instances in a few lines.

### Gap 14.2 — Subscriptions "Service Work" group terminology ambiguity (minor)

While investigating 14.1, noticed that the "Service Work" sidebar group in `nav-config.js` bundles two different modes under one label: `service_projects` (Projects + Contracts) and `workflow_tickets` (Tickets). A tenant with only one of the two modes sees a group with partial children. This is functionally correct but visually inconsistent with the one-group-per-mode pattern used everywhere else.

**Proposed fix (low priority):** Split into two sidebar groups — "Service Projects" and "Service Tickets". One-line refactor in `nav-config.js`. Defer until a tenant reports confusion; currently no user impact.
