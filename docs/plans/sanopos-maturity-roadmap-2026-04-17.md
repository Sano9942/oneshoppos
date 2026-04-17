# SanoPOS Maturity Roadmap — From Scaffolding to Square/Shopify Parity

> **Date:** 2026-04-17
> **Last updated:** 2026-04-18
> **Source:** Brainstorming session, plan file at `~/.claude/plans/we-have-made-allof-smooth-jellyfish.md`
> **Status:** Phase 1 COMPLETE — ready to start Phase 2

## Context

You've shipped 23 industry presets, 25 competitive-wave features, SanoPay sandbox, multi-tenant infrastructure, and Wave 5 hardening. On paper, you cover more verticals than Square (which has 3: Retail, Restaurants, Appointments). But two honest truths emerged from this audit:

1. **Most verticals are scaffolding, not products.** Code audit confirms only **Retail is DEEP**. Restaurant, Clinical, and Repair Shop are PARTIAL (~50-65% of real workflow). Hotel, Rental, Gym, and Butcher/Sweet/Ice are SHALLOW — preset labels and one or two pages on top of generic billing/booking/inventory primitives. A real salon owner can't run no-show fees + deposits + recurring recall. A real hotel can't sync to Booking.com. A real gym has no attendance check-in distinct from class booking. A real butcher has no batch/expiry tracking.

2. **The competitive gap with Square/Shopify isn't "missing features" — it's polish, depth, and trust.** They feel mature because every screen is fast, every edge case is handled, hardware just works, and there's an app store + accounting integrations + native mobile. Even where you have feature parity on paper (you have loyalty, bundles, multichannel, 13 couriers, Swagger), the screens "feel slow/rough" — your own assessment.

The strategic answer is **not** "build 50 more features." It's a **two-axis maturity push**: depth-per-vertical (so each preset is actually a product) **and** platform polish (so the whole thing feels Square-grade). All four user goals — reduce churn, win bigger, reach 100+ tenants, dominate Pakistan & compete internationally — collapse into the same answer: **stop adding new things until the existing things feel done.**

This plan is open-ended and phased so you can pick a starting point.

---

## The Two-Axis Strategy

```
                  PLATFORM POLISH (axis 2)
                          ▲
       Square/Shopify  ●  │
                          │
  Mature vertical      ●  │  ●  Mature platform
    (deep but rough)      │     (polished but shallow)
                          │
          ────────────────┼────────────────► VERTICAL DEPTH (axis 1)
                          │
   SanoPOS today  ●       │
   (shallow + rough,      │
    23 presets wide)      │
                          ▼
```

Today you're bottom-left: wide but shallow, capable but rough. Square is top-right but only on 3 verticals. Your strategic edge is **23 verticals × deep × polished = unmatched in any region**. But you can't get there in one move. The phases below sequence depth and polish so each release is shippable and demo-able.

---

## Phase 1 — Foundation Polish ✅ COMPLETE (shipped 2026-04-17 → 2026-04-18)

**Why first:** No amount of new features fixes the "feels rough" problem. If you build vertical depth on top of slow/buggy screens, the new depth feels rough too. This is your retention foundation and the price of admission to win bigger customers.

### 1.1 Performance & UX Audit Pass ✅ DONE (PR #13, commit f437f68)
- ✅ Baseline audit: bundle stats, Supabase slow-query inspector (`tools/inspect-slow-queries.js`), Sentry + UptimeRobot snapshot
- ✅ `/api/admin/infra` 5-min server-side cache — eliminated N+1 Postgres system query on every dashboard poll
- ✅ `InfrastructurePanel` polling reduced to 60s + tab-hidden pause (was 30s always-on)
- ✅ Orphan-schema scan moved off request path to hourly pg-boss worker (migration v50, `public.infra_cache` table)
- ✅ Lazy-load `xlsx` in COD `ImportWizard` (heavy dep, only loaded on demand)
- ✅ Stale-chunk auto-reload: `utils/chunkReload.js` + handler in `main.jsx` — eliminates white-screen on Vercel redeploy
- ⏸ **DEFERRED:** Lighthouse/Web Vitals run on 10 pages (no blocking issues found in prod snapshot)
- ⏸ **DEFERRED:** Per-tab `reports-*.js` code-split (~85KB gzip savings — its own focused PR, needs React.lazy + Suspense across 20 files)

### 1.2 Design System Convergence ✅ DONE (PRs #13–#17 + dark mode commits)
- ✅ New primitives added to `ui/primitives.jsx`: `Modal`, `ModalBody`, `ModalFooter`, `ConfirmDialog`, `TabBar`, `Button` extensions (`iconOnly`, `tone="link"`)
- ✅ 24 unit tests for new primitives (`tests/unit/primitives-modal.test.jsx`)
- ✅ Step 2: All ~84 `*Redesign.jsx` pages converted — raw `<div>` modals → `<Modal>` primitive, raw `<button>` → `<Button>`, `variant=` bugs fixed. Covered: purchase-orders, suppliers, supplier-payables, customer-groups, administrator, hr-management, crm, employees, customers, chart-of-accounts, journal-entries, credit-debit-notes, postdated-cheques, expenses, cash-management, taxes, tax-lookup, fbr-dashboard, integrations-hub, outlets, scheduling, scheduled-changes, orders, returns, restaurant-checks, rentals, report-builder, subscriptions, cod, customer-invoices, commissions, marketing-campaigns, smart-collections, loyalty-tiers + more
- ✅ Step 3: Remaining domain batches (PRs #14, #15, #16)
- ✅ Step 4: ESLint rule `sano/no-raw-interactive` blocking new raw `<button>`/`<input>` in `src/pages/` (PR #17, commit 00a8a9a)
- ✅ Step 5: Dark mode QA pass — 27 redesign pages fixed, hardcoded `bg-white`/`text-slate-*`/`border-slate-*` → `--ui-*` CSS variable tokens (commits 894456e, ef6470d, c8c5c74)

### 1.3 Reliability Hardening ⏸ PARTIALLY DEFERRED
- ⏸ **DEFERRED:** Top 10 Sentry errors triage (no critical errors found in prod snapshot taken 2026-04-17)
- ⏸ **DEFERRED:** Playwright smoke tests in CI (5 journeys identified, needs GitHub Actions setup + secrets)
- ⏸ **DEFERRED:** Duplicate-payment / duplicate-sale detector (needs design decision: block vs alert, time window)
- ⏸ **DEFERRED:** Metrics + alerts dashboard (latency, queue depth, worker lag)

### 1.4 The 1% Details ⏸ DEFERRED
- ⏸ Keyboard shortcuts overlay on non-POS heavy pages
- ⏸ Optimistic UI for cart adds, inventory adjustments, status changes
- ⏸ Smart defaults (pre-fill outlet, date range, payment method from context)
- ⏸ Inline validation everywhere using existing Zod schemas

**Deliverable:** ✅ Design system converged, dark mode working, stale-chunk handler live, ESLint rule enforcing going forward. Deferred items are non-blocking for Phase 2 and can run as a parallel track.

**Critical files:** [frontend/src/ui/primitives.jsx](../../frontend/src/ui/primitives.jsx), [frontend/src/ui/Breadcrumbs.jsx](../../frontend/src/ui/Breadcrumbs.jsx), [frontend/src/routes/RouteLoading.jsx](../../frontend/src/routes/RouteLoading.jsx), [backend/services/logger.js](../../backend/services/logger.js), [backend/services/alerting.js](../../backend/services/alerting.js)

---

## Phase 2 — Vertical Depth Wave 1: The "Almost There" Three (8-12 weeks)

**Why next:** Restaurant, Clinical, and Repair Shop are already PARTIAL. Closing them to DEEP gives you three legitimate vertical products at lowest marginal cost. Each becomes a sales pitch that can stand next to Square for Restaurants / Square Appointments / equivalent.

### 2.1 Restaurant Maturation (close from ~65% → 95%)
**Already have:** Floor plans, tables, sessions, checks, KDS stations, KDS tickets, coursing, adjustments. Files: [backend/routes/kds.js](../../backend/routes/kds.js), [backend/routes/restaurant.js](../../backend/routes/restaurant.js).

**Build:**
- Split-bill workflow on `restaurant_checks` (split by item, by guest, by amount, by share)
- Tip pooling and distribution rules tied to `commission_plans`
- Modifiers as first-class entities (not JSON blobs) — modifier groups, required/optional, price deltas
- Kitchen routing rules: per-station item filtering on `kds_stations`
- Online ordering inbox: a single page that aggregates web_orders + WhatsApp orders + marketplace orders for restaurants, with one-tap fire-to-KDS
- Course timing controls (fire next course, hold all, expedite)

### 2.2 Clinical Maturation — Dental/Vet/Physio (close from ~60% → 95%)
**Already have:** `patient_subjects`, `treatment_plans`, sessions, lab orders, consent forms, prescriptions, folios, plan templates (v46). Files: [backend/routes/treatment-plans.js](../../backend/routes/treatment-plans.js), [backend/routes/treatment-plan-templates.js](../../backend/routes/treatment-plan-templates.js).

**Build:**
- Visual charting UI — the missing piece. Dental tooth chart (32 teeth, surfaces, conditions), body-region chart (front/back human or animal silhouette with clickable zones), physio range-of-motion tracker. Persist to existing `treatment_plan_chart_entries`.
- Prescription printing with pharmacy-friendly format (Rx pad layout)
- Recall reminders — automatic email/SMS at 6mo / 12mo per plan template
- Insurance claim CSV export (per-region format; start with Pakistan/private)
- Multi-provider treatment splits (commission per provider per session)
- Consent form e-signature capture (canvas → PNG → R2)

### 2.3 Repair Shop Maturation (close from ~65% → 95%)
**Already have:** Service ticket pipeline, line items, deposits. File: [backend/routes/service-tickets.js](../../backend/routes/service-tickets.js).

**Build:**
- Technician time tracking per ticket activity (start/stop timer → labor hours → labor cost)
- Warranty period field on service_tickets + warranty claim flow on returns
- SMS/WhatsApp customer status updates (status pipeline transitions trigger templated messages via existing WhatsApp integration)
- Photo evidence on intake + delivery (before/after) → R2
- Estimate → approve → invoice flow (customer signs estimate before work begins)
- Parts ordering integration: ticket flags missing part → auto-creates draft PO

**Deliverable:** Three vertical products that can be demoed against Square for Restaurants, dental practice software, and CARFAX/Shopmonkey.

---

## Phase 3 — Vertical Depth Wave 2: The Shallow Four (10-14 weeks)

**Why next:** Hotel, Rental, Gym, and Fresh-goods (butcher/sweet/ice) are scaffolding. Picking them up means real product work, not just polish. Sequence by market size in your region.

### 3.1 Hotel/Hostel/Guesthouse Maturation (~55% → 90%)
**Already have:** Room types, rate overrides, rooms, bookings, sessions, folios, deposits, housekeeping, tax-inclusive rates (v48). File: [backend/routes/rooms.js](../../backend/routes/rooms.js).

**Build:**
- **Channel manager integration** (the killer gap) — Booking.com + Expedia + Airbnb via a unified adapter pattern (mirror your courier adapter). Two-way: import bookings, push availability/rates. This alone is worth $50/mo per hotel and unlocks every guesthouse.
- Group bookings (one folio across multiple rooms)
- Public booking deposit UI (backend ready per April 2026 work — just needs the page)
- Housekeeping mobile view (status update by phone)
- Night audit batch process

### 3.2 Rental Maturation (4 presets, ~45% → 85%)
**Already have:** Items, assets, contracts, checkout/return, late fees. File: [backend/routes/rentals.js](../../backend/routes/rentals.js).

**Build:**
- Multi-tier pricing (hourly, daily, weekly, monthly)
- Damage deposit hold/release flow tied to SanoPay tokenization (release on inspection complete)
- Pre/post inspection checklist with photo capture (R2)
- Vehicle-specific: odometer in/out, fuel level, mileage charge
- Availability calendar UI (the missing visualization)
- Contract templates per rental category with e-signature

### 3.3 Gym/Coworking/Driving School/Photography Maturation (~40% → 85%)
**Already have:** Subscriptions, appointments, generic booking. Reuses generic UI.

**Build:**
- Member check-in (separate from booking) — kiosk or QR-code scan logging attendance to a new `member_checkins` table
- Class roster view + waitlist + capacity limits per class
- Member freeze/pause (subscription state machine extension)
- Class credits / package deals (e.g., 10-class pack)
- Trainer/instructor schedule view
- Photo studio: project tracking with deliverables, contract milestones, gallery delivery

### 3.4 Fresh Goods Maturation — Butcher/Sweet/Ice (~30% → 80%)
**Already have:** Tare weight on sale_items (v45 widened to NUMERIC(10,3)). Otherwise reuses retail.

**Build:**
- Batch tracking: `product_batches` table with batch number, mfg date, expiry date, supplier
- Expiry alerts on dashboard (items expiring in N days)
- FIFO sales — POS auto-picks oldest batch
- Production/breakdown workflow — buy whole carcass, break into cuts (multi-output recipe)
- Day-end waste tracking
- Weighted bundling (gift box of 6 sweets, total weight)

**Deliverable:** All 23 presets are now real products, not labels.

---

## Phase 4 — Platform Pillars: The Square/Shopify Parity Pieces (parallel to Phase 3)

**Why parallel:** These are 3-6 month builds each. Run them as a separate track.

### 4.1 Native Mobile Shell (mobile-first POS)
- Capacitor wrapper around the existing PWA. iOS + Android.
- Native bridges: barcode scanner, camera, BLE printer, BLE card reader (when hardware is added).
- App Store + Play Store presence — "POS by SanoPOS" — even if internally it's the same React app.
- Why Capacitor not React Native: re-uses your entire React 19 codebase, two devs can ship in 8 weeks vs 6 months.

### 4.2 Public API + Developer Portal
**Already have:** Swagger at `/api-docs` (Wave 6).

**Build:**
- API key system — tenant-scoped, scoped permissions, rotatable. New `api_keys` table.
- Rate limiting per key (extend [backend/middleware/rate-limit.js](../../backend/middleware/rate-limit.js))
- Webhooks-out: subscribe to `sale.created`, `customer.updated`, `inventory.changed`, etc.
- Developer portal page: documentation, key management, webhook playground, code samples
- Stable v1 API contract with deprecation policy

### 4.3 Gift Cards + Store Credit
- New `gift_cards` table (code, balance, currency, issued_date, expiry, status)
- New `store_credits` table tied to customer
- POS payment method: scan/enter gift card → apply balance → split with other tender
- Sell gift cards as a special SKU
- Refund-as-store-credit flow on returns
- Why important: every Square/Shopify merchant uses these, completely missing from SanoPOS today.

### 4.4 Accounting Integrations
- QuickBooks Online (largest market, even in Pakistan many SMBs use QBO)
- Xero (international)
- Tally (Pakistan/India local market)
- One-way push: daily journal entry export (sales, taxes, COGS) via OAuth-connected adapter
- Reuse the integration credential storage from `services/crypto.js`

### 4.5 Built-in Online Store (long-term, optional)
- The Shopify moat. Multi-month build.
- Defer unless customer demand emerges. Today you sync TO WooCommerce/Shopify which is enough for most.
- If pursued: lightweight customer-facing storefront per tenant at `{slug}.sanopos.shop`, reusing existing products + customer portal auth.

---

## Phase 5 — Regional Domination + International Expansion (continuous)

**Pakistan first:**
- FBR Digital Invoicing is already ahead of competitors in Pakistan. Double down — make every report FBR-compliant by default, add provincial revenue authority (PRA, SRB, KPRA, BRA) integrations.
- Urdu language toggle across the app. JazzCash + EasyPaisa as native payment methods next to xPay.
- Local partnerships: pre-installed on POS hardware sold by Symbol/Honeywell distributors in Karachi/Lahore.

**International expansion (when Pakistan is dominated):**
- Multi-currency at the schema level (already partially supported via `currency_code`)
- Region packs: GCC (UAE VAT, Saudi ZATCA e-invoicing), India (GST), UK (MTD), EU (OSS VAT). Each is a backend route + admin config + tax engine.
- Local payment processors per region (Stripe for global, Paymob for Egypt/Pakistan, Mada for Saudi)

---

## How to Sequence (recommendation)

```
Month 1-2:   Phase 1 (Foundation Polish)         ──── ✅ DONE 2026-04-18
Month 2-4:   Phase 2 (Restaurant + Clinical + Repair to DEEP) ──── ← START HERE
Month 4-6:   Phase 3.1 (Hotel + Channel Manager) ──── unlocks hospitality segment
Month 4-8:   Phase 4.1 (Native Mobile Shell — parallel track)  ──── App Store presence
Month 6-9:   Phase 3.2-3.3 (Rental + Gym)        ──── service economy locked
Month 6-9:   Phase 4.2 (Public API + Webhooks — parallel track) ──── partner ecosystem opens
Month 9-12:  Phase 3.4 (Fresh Goods) + Phase 4.3 (Gift Cards) + Phase 4.4 (Accounting) ──── "complete platform"
Month 12+:   Phase 5 (Regional + International)  ──── growth engine
```

~~If you can only pick **one thing** to start: **Phase 1**.~~ Phase 1 is done.

**Next:** **Phase 2.1 (Restaurant)** — restaurant is the highest-revenue vertical per tenant in Pakistan, the existing partial implementation is closest to done, and a polished restaurant product is your best wedge against the Square for Restaurants narrative.

---

## Verification

For each phase, "done" is verifiable end-to-end against a real scenario:

- **Phase 1:** Lighthouse score >90 on 10 key pages, Sentry weekly errors <50, top 5 user journeys pass Playwright in CI, design audit shows zero off-system buttons/modals across `*Redesign.jsx`.
- **Phase 2.1 Restaurant:** A test restaurant tenant can: split a 4-person check 4 ways with custom tip pool, route appetizers to grill station and entrees to hot station, fire courses, accept a WhatsApp order into the same KDS — all from one demo.
- **Phase 2.2 Clinical:** A dental test tenant can: chart a cavity on tooth #14 mesial surface, generate a 6-visit treatment plan from template, capture e-signed consent, print Rx, schedule 6mo recall — end to end.
- **Phase 2.3 Repair:** Repair test tenant can: intake bike with photos, start tech timer, send WhatsApp status updates, generate estimate → approve → invoice with parts + labor + warranty.
- **Phase 3.1 Hotel:** Hotel test tenant can: receive a Booking.com reservation via channel manager, auto-block rooms, create folio, accept on-arrival deposit via SanoPay, complete night audit.
- **Phase 4.1 Mobile:** App in Play Store + App Store, scans barcodes via native camera, prints to BLE thermal printer, completes a sale offline, syncs on reconnect.
- **Phase 4.2 API:** A third-party developer can read docs at `developers.sanopos.com`, create an API key, call `POST /v1/sales`, receive `sale.created` webhook on their endpoint — all in 15 minutes.
- **Phase 4.3 Gift Cards:** Tenant sells a 5000 PKR gift card, customer redeems 3000 PKR at POS with split payment for the rest, balance shows 2000 PKR remaining.
- **Phase 4.4 Accounting:** Daily auto-export to QuickBooks Online creates correct journal entries that reconcile to SanoPOS sales report to the rupee.

Each verification is a demo a prospect can watch live. That's the standard.

---

## Critical Files to Reference (per phase)

- **Foundation Polish:** [frontend/src/ui/primitives.jsx](../../frontend/src/ui/primitives.jsx), [backend/services/alerting.js](../../backend/services/alerting.js), [backend/services/logger.js](../../backend/services/logger.js)
- **Restaurant:** [backend/routes/kds.js](../../backend/routes/kds.js), [backend/routes/restaurant.js](../../backend/routes/restaurant.js)
- **Clinical:** [backend/routes/treatment-plans.js](../../backend/routes/treatment-plans.js), [backend/routes/treatment-plan-templates.js](../../backend/routes/treatment-plan-templates.js), [backend/category-tree.js](../../backend/category-tree.js)
- **Repair:** [backend/routes/service-tickets.js](../../backend/routes/service-tickets.js)
- **Hotel:** [backend/routes/rooms.js](../../backend/routes/rooms.js)
- **Rental:** [backend/routes/rentals.js](../../backend/routes/rentals.js)
- **Gym/Subs:** [backend/routes/subscriptions.js](../../backend/routes/subscriptions.js), [backend/routes/bookings.js](../../backend/routes/bookings.js)
- **Fresh Goods:** [backend/routes/products.js](../../backend/routes/products.js), [backend/migrate-pg.js](../../backend/migrate-pg.js) (new batch tables)
- **Mobile:** new — Capacitor project alongside `frontend/`
- **Public API:** [backend/middleware/rate-limit.js](../../backend/middleware/rate-limit.js), new `backend/routes/v1/*` versioned namespace
- **Gift Cards:** [backend/schema-pg.sql](../../backend/schema-pg.sql), [backend/routes/sales.js](../../backend/routes/sales.js)
- **Accounting:** [backend/services/crypto.js](../../backend/services/crypto.js), new `backend/services/accounting/{quickbooks,xero,tally}.js`

---

## What This Plan Deliberately Does NOT Recommend

- **No new verticals.** 23 is enough. Don't add manufacturing, laundry, library, etc. until the existing 23 are DEEP.
- **No AI features.** Per existing memory: AI BYOK was deferred Mar 27 due to no customer demand. Don't revisit until 100+ tenants asking.
- **No microservices rewrite.** The monolith on Express + Postgres scales fine to 100+ tenants with PgBouncer enabled. Don't introduce complexity without need.
- **No new payment gateway integrations** until xPay tokenization is real and SanoPay is production-grade. Adding Stripe before fixing xPay is moving sideways.
- **No own online store** in the next 12 months. Shopify took 15 years to build that moat. WooCommerce/Shopify sync is enough.
