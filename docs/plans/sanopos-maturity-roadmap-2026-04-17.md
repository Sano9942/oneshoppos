# SanoPOS Maturity Roadmap — From Scaffolding to Square/Shopify Parity

> **Date:** 2026-04-17
> **Last updated:** 2026-04-23
> **Source:** Brainstorming session, plan file at `~/.claude/plans/we-have-made-allof-smooth-jellyfish.md`
> **Status:** Phase 1 COMPLETE (with non-blocking deferrals). Phase 2.1 Restaurant Maturation COMPLETE. Phase 2-R.0 through 2-R.10 COMPLETE (Waves A–D shipped). Phase 2-G.0 through 2-G.17 COMPLETE (Waves 1–6 shipped, including 2-G.14 Shopify+Square import, 2-G.15 retail error states, 2-G.16 merchant home, 2-G.17 anti-theft). **Remaining in Phase 2:** 2.2 Clinical Maturation (6 items, none shipped) and 2.3 Repair Shop Maturation (6 items, none shipped).

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

### 2.1 Restaurant Maturation ✅ COMPLETE (shipped 2026-04-18)

**Status:** All 9 planned items (A1–C3) shipped across three merged feature branches. Backend + admin management UI for every feature is live. Two POS wiring gaps identified post-audit were closed on 2026-04-18.

**A — Restaurant depth** (merged to main as `feature/phase-2.1a-restaurant-depth`)
- ✅ **A1: Split-bill extensions** (commit 20804cc, migration v51) — split by item, by guest, by amount, evenly, merge back. Backend: [backend/routes/restaurant.js](../../backend/routes/restaurant.js) `POST /api/restaurant/checks/:id/split` + `POST /api/restaurant/checks/merge`. UI: RestaurantChecksRedesign split modal.
- ✅ **A2: First-class modifiers** (commit 8786c6b, migration v52) — `modifier_groups`, `modifier_options`, `product_modifier_group_links`. Groups with selection_type (single/multi), min/max, required. Attach flow validates on write. Backend: [backend/routes/modifiers.js](../../backend/routes/modifiers.js), [backend/services/modifiers.js](../../backend/services/modifiers.js). Admin UI: ModifierGroupsRedesign at `/restaurant/modifiers`.
- ✅ **A3: Course timing controls** (commit a455b70, migration v53) — fire course, hold all, expedite, release. Per-course state machine on `restaurant_checks`. Backend: `POST /api/restaurant/checks/:id/fire-course` + `/courses/hold` + `/courses/expedite`. UI: course actions on Checks page.

**B — Kitchen + online** (merged as `feature/phase-2.1b-kitchen-online`)
- ✅ **B1: KDS routing rules** (commit fc7e585, migration v54) — `kds_routes` table with priority + product/modifier matching. Auto-assigns tickets to the right station. Backend: [backend/routes/kds.js](../../backend/routes/kds.js) `/api/kds/routes` CRUD + `/preview`. UI: KDSRedesign routing tab.
- ✅ **B2: Online ordering inbox** (commit 87acbd6, migration v55) — single page aggregating web_orders + WhatsApp + marketplace orders. One-tap accept → auto-fires to KDS. Backend: [backend/routes/restaurant-inbox.js](../../backend/routes/restaurant-inbox.js) `/api/restaurant/inbox` + accept/reject. UI: RestaurantInboxRedesign at `/restaurant/inbox`.

**C — Server compensation** (merged as `feature/phase-2.1c-server-comp`)
- ✅ **C1: Tip capture on sale** (commit 703048a, migration v56) — `tip_captures` table, server attribution via table_session → server_id. Backend: `captureTipOnSale()` in [backend/services/tips.js](../../backend/services/tips.js) fires from `POST /api/sales` when `tip_amount > 0`.
- ✅ **C2: Tip pools + distribution rules** (commit 4b3f39b, migration v57) — `tip_pools`, `tip_distribution_rules`, `tip_payouts`. Pool open/close/distribute/void flow. Rules tied to `commission_plans` with role/hours/points bridge. Backend: [backend/routes/tips.js](../../backend/routes/tips.js).
- ✅ **C3: Tips UI + commission integration** (commit 51abb89) — TipPoolsRedesign at `/tips` (open/close/distribute/void), commission report filter by tip source.

**Post-audit wiring fixes** (2026-04-18)
- ✅ **Modifier picker wired into POS cart** — when a product with linked modifier groups is added (via search/tile/barcode), `POSModifierModal` pops up, validates min/max/required, applies price delta, stores modifiers snapshot on the cart line + sale payload. Plain products continue to add instantly with no extra tap. Files: new [frontend/src/pages/redesign/pos/POSModifierModal.jsx](../../frontend/src/pages/redesign/pos/POSModifierModal.jsx), [POSContext.jsx](../../frontend/src/pages/redesign/pos/POSContext.jsx) `addToCartWithModifiers`.
- ✅ **Tip + server fields at POS checkout** — restaurant-mode-gated section in `POSCheckoutModal`: 10/15/20% quick buttons + custom tip amount + tip method + server dropdown. Tip raises `remaining` so cashier collects total+tip; change recalculates. Each cart line is stamped with `staff_id = serverId` (v49) for server-attribution reports. Backend: [backend/services/tips.js](../../backend/services/tips.js) `captureTipOnSale` accepts explicit `server_id` override for direct dine-in without a table session; [backend/routes/sales.js](../../backend/routes/sales.js) forwards it.

**Sidebar entries live** (all gated on `phase4_restaurant` + mode=restaurant): Floor Plan, Checks, Modifiers, Online Inbox, KDS, Tip Pools.

**What's next:** see Phase 2.2 below — closes 10 remaining gaps vs Square for Restaurants / Toast / TouchBistro / Lightspeed so restaurant becomes a lead-with product.

### 2.2 Clinical Maturation — Dental/Vet/Physio (close from ~60% → 95%) ⏸ NOT STARTED
**Already have:** `patient_subjects`, `treatment_plans`, sessions, lab orders, consent forms, prescriptions, folios, plan templates (v46). Files: [backend/routes/treatment-plans.js](../../backend/routes/treatment-plans.js), [backend/routes/treatment-plan-templates.js](../../backend/routes/treatment-plan-templates.js).

**Build:**
- Visual charting UI — the missing piece. Dental tooth chart (32 teeth, surfaces, conditions), body-region chart (front/back human or animal silhouette with clickable zones), physio range-of-motion tracker. Persist to existing `treatment_plan_chart_entries`.
- Prescription printing with pharmacy-friendly format (Rx pad layout)
- Recall reminders — automatic email/SMS at 6mo / 12mo per plan template
- Insurance claim CSV export (per-region format; start with Pakistan/private)
- Multi-provider treatment splits (commission per provider per session)
- Consent form e-signature capture (canvas → PNG → R2)

### 2.3 Repair Shop Maturation (close from ~65% → 95%) ⏸ NOT STARTED
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

## Phase 2-R — Restaurant Tier-1 Parity (6-8 weeks)

> Numbering note: Phase 2's original plan used `2.1 Restaurant`, `2.2 Clinical`, `2.3 Repair`. Since 2.1 is now DONE and restaurant needs a second deepening pass, this follow-on is labeled **Phase 2-R** (restaurant) to avoid colliding with 2.2 Clinical above. Internal items are numbered 2-R.0 through 2-R.10.

**Why:** Phase 2.1 closed the core dine-in loop (split-bill, modifiers, courses, KDS routing, online inbox, tips + pools + commission). Audit against Square for Restaurants, Toast, TouchBistro, and Lightspeed (researched 2026-04-18) surfaced **one foundational gap** (no restaurant-native POS shell — 2-R.0) plus **10 feature gaps** (2-R.1–2-R.10) that keep SanoPOS from feeling Tier-1. Phase 2-R closes all of them so restaurant becomes a lead-with product, not just a mode toggle.

**Build order matters:** 2-R.0 ships first. Every other item in this phase lands inside the new shell — 86'ing items, manager-PIN voids, day-parting, menu engineering all surface inside `/pos/restaurant` instead of as disconnected pages.

**Source:** Competitive research + code audit on 2026-04-18. References: Square for Restaurants release notes, Toast 2026 drive-thru launch, TouchBistro/Lightspeed comparisons, restaurant365/Lavu on void-comp controls, TechRyde KDS guide 2026.

### 2-R.0 — Restaurant-Native POS Shell ✅ COMPLETE (shipped 2026-04-18)

**Status:** All 10 working-day milestones shipped across four sequentially-merged feature branches. New route `/pos/restaurant` is live, auto-redirects restaurant-mode tenants from `/pos`, and wraps the existing `POSContext` in a table-first workflow. Retail tenants see zero change. Two route-file corrections (route lives in `publicRoutes.jsx`, not `appRoutes.jsx`) and one backend patch (draft-orders INSERTs didn't persist `seat_number`/`course_name`/`kitchen_status` columns that already existed in schema) were identified during Track 1 exploration and fixed on Day 1.

**Track 1 — Foundation** (merged to main as `feature/2r0-foundation`, 5 commits)
- ✅ **Backend draft-orders seat/course persistence** (commit ad9201a) — patched INSERTs in [backend/routes/draft-orders.js](../../backend/routes/draft-orders.js) at lines 94, 136 to include `seat_number`, `course_name`, `kitchen_status` columns. No migration needed; columns already existed from v52-v57.
- ✅ **POSContext restaurant state** (commit fb41461) — additively extended [POSContext.jsx](../../frontend/src/pages/redesign/pos/POSContext.jsx) with `draftOrderId`, `orderContext`, `tableSessionId`, `seatCount`, `activeSeat`, `activeCourse`, plus methods `openCheck`, `closeCheck`, `ensureDraftOrder`. No existing exports touched.
- ✅ **useCart seat/course overlay** (commit 1a8937f) — `addToCart` in [useCart.js](../../frontend/src/pages/redesign/pos/hooks/useCart.js) now accepts optional `{ seat_number, course_name }` overlay; defaults to context's `activeSeat`/`activeCourse`. Retail call sites unchanged.
- ✅ **useCheckout forwards restaurant context** (commit 5e678bd) — `completeSale` in [useCheckout.js](../../frontend/src/pages/redesign/pos/hooks/useCheckout.js) now passes `draft_order_id`, `order_context`, `table_session_id`, `seat_count` to `POST /api/sales` when set. Backend already accepted `draft_order_id` at [routes/sales.js:445, 1007](../../backend/routes/sales.js).
- ✅ **Route scaffolding** (commit ee95558) — new route `/pos/restaurant` in [publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx) (NOT `appRoutes.jsx` as originally documented — `/pos` lives in `publicRoutes.jsx`). Mirrors `/pos` guard stack (auth only). New [POSRestaurantRoute.jsx](../../frontend/src/pages/POSRestaurantRoute.jsx) thin wrapper + [POSRestaurantRedesign.jsx](../../frontend/src/pages/redesign/POSRestaurantRedesign.jsx) shell. Breadcrumb label added.

**Track 2 — Floor + Check View** (merged as `feature/2r0-floor-check-view`, 4 commits)
- ✅ **RestaurantFloorGrid** (commit 665bd0e) — floor plan entry view. Ports plan loader + 10s polling + seat modal from [RestaurantFloorRedesign.jsx](../../frontend/src/pages/redesign/RestaurantFloorRedesign.jsx), restyled with POS hardcoded colors (#8066FF, slate-*). Sticky top row with 3 buttons: New Takeaway / Delivery / Drive-Thru — all 4 entry points call `openCheck(...)`.
- ✅ **RestaurantHeader + RestaurantCheckView shell** (commit caa55b0) — check view with auto-collapsing header (36px strip on scroll > 40px), menu grid reusing `POSSearchArea` + `posLayout` tiles, state machine in POSRestaurantRedesign (view: "floor" | "check").
- ✅ **RestaurantCartGrouped + SeatCoursePicker** (commit c16c3cc) — cart grouped by seat → course via `useMemo` in extracted pure function [cartGrouping.js](../../frontend/src/pages/redesign/pos/restaurant/cartGrouping.js) (TDD: Vitest unit tests written first). Seat (1..N) + Course (1..5 with labels Appetizer / Salad / Entrée / Dessert / Drinks) picker — dropdown on desktop, bottom sheet on portrait.
- ✅ **RestaurantActionBar + modal mounting** (commit 5ce5433) — sticky bottom bar pinned to viewport with Send to Kitchen, Fire Next Course, Pay + 3-dot More stub. All existing POS modals (POSOpeningGateModal, POSModifierModal, POSCheckoutModal, POSReceiptModal, POSParkedModal, POSSessionExpiredModal, POSLockScreen, POSDiscountModal, POSNoteModal, POSCloseShiftModal, POSRecentSalesPanel, POSShortcutsOverlay, POSReturnExchangeModal, EndlessAisleModal) mounted on the new shell — zero state duplication.

**Track 3 — Overflow + Guest Mode + Responsive** (merged as `feature/2r0-overflow-guest-mode`, 7 commits)
- ✅ **Backend table transfer support** (commit 3ddd9a7) — added `table_id` handling to `updateTableSession` in [backend/services/restaurant-floor.js](../../backend/services/restaurant-floor.js); validates destination table exists and moves `outlet_id` accordingly.
- ✅ **POSContext guest-mode state** (commit d031aae) — additive `showGuestMode` + `setShowGuestMode` + `setSeatCount` setters.
- ✅ **RestaurantOverflowMenu** (commit e4d532d) — popover from 3-dot: Split / Comp (disabled — "Available in 2-R.2") / Discount / Transfer Table / Add Seat / Note. Discount and Note reuse existing POSContext modal flags.
- ✅ **SplitCheckModal** (commit c4a02d5) — 3 modes (equal / by seat / by item). Calls existing `POST /api/restaurant/checks/:id/split`. Closes modal + returns to floor on success.
- ✅ **TransferTableModal** (commit d398650) — table-tile grid. Calls `PUT /api/restaurant/table-sessions/:id` with `{ table_id }`.
- ✅ **Portrait stack responsive** (commit 027adea) — viewport < 900px: cart stacks ON TOP of menu grid. Uses `window.matchMedia`; no new deps.
- ✅ **RestaurantGuestModeModal + Hand-to-guest handoff** (commit 162801d) — full-viewport overlay with tip preset (10/15/18/20% + custom), HTML5 signature canvas (pointer events → SVG path), receipt choice (print/email/SMS). Triggered from a "Hand to guest" button added to [POSCheckoutModal.jsx](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx) — button only renders when `hasMode('restaurant')` is true. Signature persisted in sale notes JSON.

**Track 4 — Redirect + QA + Tests** (merged as `feature/2r0-redirect-qa`, 7 commits)
- ✅ **POSRoute redirect** (commit 1266e70) — [POSRoute.jsx](../../frontend/src/pages/POSRoute.jsx) detects `hasMode('restaurant')` + `flags.phase4_restaurant` and redirects to `/pos/restaurant`. Shows `<RouteLoading />` while preset/flags bootstrap.
- ✅ **Defensive redirect** (commit c9721ba) — [POSRestaurantRedesign.jsx](../../frontend/src/pages/redesign/POSRestaurantRedesign.jsx) redirects retail tenants back to `/pos` if they land on `/pos/restaurant` without restaurant mode.
- ✅ **Kitchen-firing offline banner** (commit e57f4df) — Send to Kitchen / Fire Next Course disabled + banner "Kitchen firing requires connection" when offline in dine-in mode. Pay still works; takeaway/delivery queue to localStorage without `draft_order_id` as designed.
- ✅ **Cart-collision prompt** (commit 654f289) — switching tables or pressing Back with non-empty cart shows Save / Discard / Cancel confirm; Save uses existing `parkSale()` (feature-flagged `phase2_draft_orders` routes to `/api/draft-orders`).
- ✅ **Loading skeletons** (commit e725e7e) — inline pulsing placeholders on floor grid initial load and check view menu load.
- ✅ **Vitest unit coverage** (commit 089995b) — new [pos-context-open-check.test.jsx](../../frontend/tests/unit/pos-context-open-check.test.jsx) (216 LOC) covers openCheck/closeCheck/ensureDraftOrder state transitions.
- ✅ **Playwright smoke spec** (commit 590a466) — new [restaurant-shell.smoke.spec.js](../../frontend/tests/smoke/restaurant-shell.smoke.spec.js) (284 LOC) covering demo steps 1, 4, 6, 8, 10, 11, 13, 15.

**Data-model clarifications learned during build**
- ✅ `draft_order_items.seat_number`, `course_name`, `kitchen_status` already exist in schema ([schema-pg.sql:2859-2863](../../backend/schema-pg.sql)). The plan's initial assumption that a migration was needed turned out to be wrong — only the INSERT statements needed updating.
- ⚠ `draft_orders.order_context` enum at [schema-pg.sql:2828](../../backend/schema-pg.sql) does NOT include `'drive_thru'` (only `retail / dine_in / takeout / delivery / bar / online`). 2-R.0 maps the Drive-Thru UI button to `'takeout'` in the DB and surfaces "Drive-Thru" as a display label. Proper enum extension is deferred to **2-R.9**.
- ⚠ `restaurant_table_sessions.status` enum ([schema-pg.sql:2588](../../backend/schema-pg.sql)) is `('seated','ordering','served','check_requested','closed')` — no "dirty" housekeeping status exists today. Roadmap text was aspirational; 2-R.0 ships with `closed` only. "Dirty" housekeeping flow is a candidate for a later 2-R.x item.

**Final file tally:** 23 commits total, +2785 / -16 LOC, 25 files touched (14 new, 11 modified). Matching [plan file](../../../Users/HP/.claude/plans/docs-plans-sanopos-maturity-roadmap-202-clever-panda.md).

**Verification (demo script — all 15 steps passed):** A restaurant server at a terminal logs in → `/pos` auto-redirects to `/pos/restaurant` → floor plan grid loads with 10s polling → opens a fresh shift via `POSOpeningGateModal` → taps Table 5, seats 2 guests → adds 3 items across seat 1 course 1, seat 2 course 1, seat 1 course 2 — each goes through the modifier modal, lands in the correct seat+course group → taps "Fire Course 1" → KDS ticket created → adds more to course 2, fires → 3-dot → Split by seat → 2 checks → taps Pay on active check → POSCheckoutModal with tip + server dropdown (from 2.1 C1) → "Hand to guest" → full-viewport overlay, 18% tip preset, signature, email receipt → Done → sale completes with `draft_order_id` + signature in notes JSON → receipt prints → repeats for second split check → floor grid shows Table 5 session auto-closes.

**What it does NOT do** (explicit — these land in later 2-R.x items):
- No "86 this" on items (2-R.1). No Comp workflow with manager PIN (2-R.2). No pay-at-table QR (2-R.3). No reservations or waitlist (2-R.4). No KDS prep-time analytics (2-R.5). No day-parting (2-R.6). No fire-chit vs receipt printer split (2-R.7). No `sale_items.seat_number` persistence post-checkout (2-R.8). No `order_context = 'drive_thru'` enum (2-R.9). No menu engineering report (2-R.10).
- The "Comp" button in the overflow menu is intentionally rendered disabled with tooltip "Available in 2-R.2".

**What's next:** **Phase 2-R.1 — 86'd items / menu availability.** Highest daily-use operational gap and a blocker for 2-R.3 (pay-at-table requires availability gating so the guest QR menu doesn't show sold-out items).

---

### 2-R.0 — Original build spec (reference, for history)

The original scope notes from 2026-04-17 are preserved below. Any discrepancies between this original spec and the shipped work are resolved by the ✅ Track 1–4 sections above (which reflect what actually shipped).

**Why this first:** Today's POS (`/pos`) is a single retail-shaped screen — cart + search + sidebar. Restaurant tenants get the same screen plus 6 disconnected sidebar pages (Floor Plan, Checks, Modifiers, Inbox, KDS, Tip Pools). Square for Restaurants and Toast replace the retail POS with a **table-first workflow**: floor plan → table session → check with seats/courses → fire → pay, all on one screen. Without this shell, every Phase 2.2 feature lands in a disconnected page and the restaurant experience keeps feeling bolted-on.

**Build:**
- New page: [frontend/src/pages/redesign/POSRestaurantRedesign.jsx](../../frontend/src/pages/redesign/POSRestaurantRedesign.jsx) — reuses `POSContext`, `POSSearchArea`, `POSCartTable`, `POSCheckoutModal` (no duplication of state/logic) but wraps them in a restaurant shell.
- **Entry view: Floor plan** — table tiles colored by status (open / seated / awaiting_order / fired / needs_bill / dirty). Click table → opens/resumes `restaurant_table_session` → check view loads. Takeaway + Delivery + Drive-Thru buttons skip table selection.
- **Check view:** left rail = product search/grid (existing `POSSearchArea`), center = cart grouped by **seat + course** (not flat list), right rail = actions (Send to Kitchen, Fire Next Course, Add Seat, Split, Merge, Transfer Table, Park, Pay).
- **Per-item inline controls:** seat number selector, course number selector, "86 this" (Phase 2-R.1), modifier picker (already wired in 2.1 post-audit fix), notes.
- **Fire-to-kitchen button** next to Pay — so server doesn't leave the POS to send orders. Uses existing `POST /api/restaurant/checks/:id/send-to-kitchen` + `/fire-course`.
- **Split + merge inline** — no page detour. Opens the same modals the `/restaurant/checks` page uses, but invoked from the check view.
- **Route switching:** `/pos` detects `hasMode("restaurant")` and redirects to `/pos/restaurant`. Retail tenants see zero change. Add `pos_layout_mode="restaurant"` preset (already exists in `PresetContext`).
- **Keep all 6 sidebar pages** — they become the admin-side views for off-floor managers (configure modifiers, see all checks across tables, tune KDS routes, manage tip pools). The new `/pos/restaurant` is the server-facing workflow surface.
- **Auth + shift + attendance gating** unchanged — same `POSOpeningGateModal` runs before restaurant shell mounts.
- **Offline queue compatibility** — reuses `useOfflineQueue`; restaurant orders queue exactly like retail sales.

**What it does NOT do:**
- No new data model — rides entirely on existing `restaurant_floor_plans`, `restaurant_tables`, `restaurant_table_sessions`, `draft_orders` (with `order_context='dine_in'`), `kds_tickets`, `sale_items.staff_id` (v49).
- No duplicate POSContext — uses the same context to keep split-screen state coherent (offline sync, shift, session expiry, barcode scanner all still work).

**Verification (demo script):**
A restaurant server on a tablet logs in → `/pos/restaurant` loads floor plan → taps Table 5 → adds 3 items per seat (2 guests) with modifiers → taps "Fire Course 1" → KDS station picks up appetizers → back to check view, adds entrees to course 2 → "Fire Course 2" → guest asks to split → taps Split → assigns items per guest → both guests pay with tip + server dropdown → receipt prints → table auto-flips to "dirty" status for housekeeping.

**Critical files:**
- New: `frontend/src/pages/redesign/POSRestaurantRedesign.jsx`, `frontend/src/pages/redesign/pos/RestaurantFloorGrid.jsx`, `frontend/src/pages/redesign/pos/RestaurantCheckView.jsx`, `frontend/src/pages/redesign/pos/SeatCoursePicker.jsx`
- New route in [frontend/src/routes/appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx): `/pos/restaurant` with `manage_restaurant` perm + `phase4_restaurant` flag + mode gate
- Modified: [frontend/src/routes/appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx) — `HomeRedirect` + `/pos` redirect logic to auto-route restaurant tenants
- No backend changes required — existing endpoints cover every action in the shell.

**Implementation notes — layout constraints (locked 2026-04-18 from Petpooja + Toast Go research):**

Source: 2026-04-18 competitive research pass on Petpooja (55,000+ restaurants across India + Middle East + Canada + South Africa — closest analogue to Pakistan/SA market) and Toast Go 3 handheld POS UX. Insight: regional buyers operate **tablet-first, speed-first** — not desktop-first, floor-plan-first like Square. Building 2-R.0 as a pure Square clone would force a retrofit later. These five constraints lock that in upfront:

1. **Two entry paths, not one.** The shell opens with both a floor plan tile grid AND a prominent "Start new check" button row (Takeaway / Delivery / Drive-Thru). Counter-heavy tenants (cafés, sweet shops with restaurant mode on) tap "Start new check" and skip the floor plan entirely. Full-service restaurants tap a table tile. Both paths should reach the check view in ≤2 taps. Why: Petpooja's headline promise is "take orders, generate bills... within seconds" — floor-plan-first defeats that for ~half your restaurant tenants.

2. **Portrait-first responsive layout.** When viewport width < 900px (typical tablet portrait), the cart stacks ON TOP of the menu grid (not side-by-side). Header auto-collapses as items are added to give menu more room. Why: Toast Go 3 ships this exact pattern because servers carry tablets in portrait orientation. Pakistan/SA market is tablet-heavy.

3. **Sticky bottom action bar.** Fire to Kitchen / Pay / Hold buttons are pinned to the bottom of the viewport on every check view — always reachable with thumb regardless of cart length. Why: Toast locks Hold/Stay/Send at the bottom; servers don't scroll to find primary actions during service rush.

4. **Overflow menu for secondary actions.** Split / Comp / Discount / Transfer Table / Add Seat / Note live behind a single "More" button (3-dot icon) in the top-right of the check view, not in the right-rail action stack. Right rail keeps only Send to Kitchen, Fire Next Course, Pay. Why: Toast Go consolidates Service Charge / Split / Discount into overflow on small screens to keep the order grid dominant. Reduces top-row clutter without losing functionality.

5. **Guest-signature handoff mode.** A "Hand to guest" button in the checkout flow flips the tablet into guest mode: shows tip selector + signature canvas + email/SMS receipt choice in large-tap-target portrait layout. Server taps "Done" to return to operator mode. Reuses existing `POSCheckoutModal` (tip section already wired) + `POSEmailReceiptModal`. Why: Toast Go ships this; it's how guests tip and sign without the server typing for them.

**What these constraints do NOT change:** the build scope, file list, backend endpoints, or estimate. They are layout decisions that get baked into `POSRestaurantRedesign.jsx` and its sub-components from day 1, not features added later.

**Estimate:** ~2 weeks (10 working days) — most of the logic already lives in POSContext and the 6 sidebar pages. The new work is composition, floor-plan grid UI, seat/course grouping, and the route redirect. Layout constraints above are baked into the design from day 1; they don't change the estimate.

### 2-R.1 — 86'd items / menu availability (out-of-stock toggle)
**Why this first:** highest daily-use operational gap. Guest ordering a sold-out item is the #1 friction point competitors cite. Also blocks 2-R.3 (pay-at-table can't ship without this).
- `product_availability` state on products (`available`, `86d`, `low_stock`) + outlet-level override
- One-tap "86 this" from POS + KDS bump screen (Square-style) — propagates to online inbox + public QR menu instantly
- Auto-restore when inventory returns via scheduled check + manual un-86
- New endpoint: `PATCH /api/products/:id/availability` (feature-flag gated, permission `manage_products`)
- Feed exclusion: hide 86'd items from `/api/public/restaurant/menu/:token` and marketplace feeds
- Report: 86 history + top-86'd items

### 2-R.2 — Void + comp workflow with manager PIN approval
**Why:** per restaurant365 research, comps/voids are the #1 revenue leakage source — more than cash theft. Every Tier-1 POS requires manager PIN + reason codes. We only have a `void_reason` column with no flow.
- Separate `comps` from `voids` (comp = free item given to guest; void = remove from order)
- Mandatory reason codes table (`void_reasons`, `comp_reasons`) — customizable per tenant, seed defaults ("wrong order", "customer dissatisfied", "training", "employee meal", "birthday")
- Manager PIN modal on every void/comp > configurable threshold (default: any)
- Audit trail in `sale_item_adjustments` table: employee_id, manager_id, reason_code, amount, timestamp
- Report: voids + comps by employee, by shift, by reason — flags abnormal patterns (same employee voiding repeatedly)
- Immutable log (admin-only deletion via audit log)

### 2-R.3 — Pay-at-table (QR scan-to-pay)
**Why:** Claimed +15% table turnover, +20% dessert attach, -30% FOH labor (FoxiFood/Eat App research). Public menu endpoint already exists; only checkout + payment flow missing.
- Extend [backend/routes/public-restaurant.js](backend/routes/public-restaurant.js): `GET /public/restaurant/check/:token` (view bill), `POST /public/restaurant/check/:token/split` (split by seat/amount/evenly), `POST /public/restaurant/check/:token/tip`, `POST /public/restaurant/check/:token/pay` (gateway intent)
- Reuse SanoPay sandbox (per memory: sandbox live Apr 18) for card capture
- Optional SMS receipt (reuse email service)
- QR printing on check from KDS or floor: table-scoped token, rotates per session
- Guest-facing mobile web page (no app) — new `frontend/src/pages/public/RestaurantPayPage.jsx` under `/p/:tenant/check/:token`
- Server notification: "table 7 paid via QR" push to floor view

### 2-R.4 — Reservations + waitlist with SMS
**Why:** TouchBistro's native-reservations advantage is a stated differentiator vs Lightspeed. SevenRooms/Hostme prove POS-integrated SMS waitlist drives +2-turnover/night.
- New tables: `reservations` (date, time, party_size, guest_name, phone, table_id nullable, status, notes) + `waitlist_entries` (party_size, quoted_wait, joined_at, notified_at, seated_at, no_showed_at)
- Reservation page: calendar view + floor-plan-aware seating assignment
- Waitlist page: active queue sorted by wait time, one-tap "text now" (uses existing WhatsApp/SMS integration)
- SMS templates: `waitlist_added`, `waitlist_ready`, `reservation_confirmed`, `reservation_reminder` (24h before)
- Guest self-add via public page `/p/:tenant/waitlist` (QR at entrance)
- No-show tracking + blacklist flag on customer

### 2-R.5 — KDS prep-time analytics + load balancing
**Why:** Toast + TechRyde bake this in — it's how kitchens self-optimize. We capture `bumped_at` but don't compute anything.
- Compute `prep_time_seconds = bumped_at - fired_at` per ticket item, persist to `kds_ticket_metrics` table
- KDS top bar live metrics: current ticket count per station, avg prep time (rolling 30min), oldest ticket age
- Station load balancing extension to routing rules (b1 already ships priority + matching): add `balance_strategy` ('round_robin', 'least_loaded') on `kds_routes`
- Report: prep time by station, by item, by day-part — identifies bottlenecks
- Alert: ticket age > threshold → highlight red on KDS + optional push

### 2-R.6 — Day-parting / scheduled menus
**Why:** Breakfast/lunch/happy-hour pricing is standard Tier-1. Promotions exist but no menu-visibility windows.
- New `menu_schedules` table: schedule_name, day_of_week, start_time, end_time, timezone
- Product ↔ schedule link: `product_schedules` many-to-many
- Apply at `/api/products` list when `?context=pos` or `?context=menu`: exclude products whose schedules don't match current outlet time
- Admin UI: Menu Schedules page — drag to draw time blocks on a weekly grid, assign products
- Happy hour preset: price list auto-activation during schedule window (extends existing price-lists with time-of-day)

### 2-R.7 — Fire-chit vs guest-bill printer separation
**Why:** Single printer config today forces workarounds. Toast routes each station to its own chit printer + receipt printer to front.
- Extend `printer_config` to per-printer role: `role` in ('chit_station', 'receipt', 'expo')
- `kds_stations.printer_id` → auto-print chit to station printer when ticket fires
- `outlets.receipt_printer_id` → cashier receipt
- Optional expo printer: one summary per check
- Test mode: fire a dummy ticket to verify routing

### 2-R.8 — Seat numbers on items + "where does this go?" delivery
**Why:** Square Seat Management — server carrying 4 plates needs to know plate 1 → seat 2, plate 2 → seat 4. We already have `staff_id` (v49) but no seat.
- Add `seat_number INTEGER` to `sale_items` + `check_items`
- POS cart: after selecting table, show seat selector (1-N based on `restaurant_tables.seat_count`)
- Chit printout groups items by seat
- KDS ticket shows seat badge per item

### 2-R.9 — Drive-thru / takeaway mode
**Why:** Toast's 2026 flagship launch. Pakistan QSR (burgers, chicken, shawarma) has strong takeaway volume. Even without drive-thru lanes, a "takeaway" mode separates dine-in flow.
- New `order_type` enum on checks/sales: 'dine_in', 'takeaway', 'delivery', 'drive_thru'
- POS mode toggle: skip table selection for non-dine-in
- Drive-thru variant: vehicle tag field + lane ID (optional, enable via feature flag)
- Speed-of-Service report: order_entered → bumped → paid timing per order_type
- KDS ticket header shows order type badge

### 2-R.10 — Menu engineering (Boston Matrix) report
**Why:** Toast/Lightspeed stars/plowhorses/puzzles/dogs chart is how operators decide what to keep, promote, cut. Our item-wise report has data but not the classification.
- New report: `/api/reports/menu-engineering?from=X&to=Y`
- Compute per product: `sales_velocity` (units/day) + `contribution_margin` (price - cost)
- Classify into quadrants (high/low × high/low, thresholds = median)
- Frontend: scatter plot + table with "promote / rework / remove" recommendations
- Filter by category, outlet, day-part

### Deliverables
- All 6 sidebar entries (Floor Plan, Checks, Modifiers, Online Inbox, KDS, Tip Pools) feel complete and production-grade
- New sidebar entries: Reservations, Waitlist, Menu Schedules, Menu Engineering
- Restaurant preset demo script lands 10/10 against Square for Restaurants checklist
- Every gap flagged in the 2026-04-18 audit is closed

### Verification (demo script)
A test restaurant tenant can, in one session: reserve a 4-top for 7pm via online form → SMS confirmation → guest arrives, added to waitlist with SMS when late → host seats them at table 5 → server adds items with modifiers per seat → cashier tries to add a sold-out item, POS blocks it → mid-meal, manager comps one item with reason "birthday" (PIN required) → course 2 fires to grill station (least-loaded per routing rule) → guest scans QR on check, splits 4 ways with tip, pays via SanoPay → KDS shows 6m 12s avg prep time → end of night, owner opens Menu Engineering report and marks 2 items as "plowhorse" for rework.

### Critical files
- [backend/routes/restaurant.js](../../backend/routes/restaurant.js), [backend/routes/kds.js](../../backend/routes/kds.js), [backend/routes/public-restaurant.js](../../backend/routes/public-restaurant.js), [backend/routes/modifiers.js](../../backend/routes/modifiers.js)
- [frontend/src/pages/redesign/POSRedesign.jsx](../../frontend/src/pages/redesign/POSRedesign.jsx), [frontend/src/pages/redesign/pos/POSCheckoutModal.jsx](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx)
- New: `backend/routes/reservations.js`, `backend/routes/waitlist.js`, `backend/routes/menu-schedules.js`, `backend/routes/menu-engineering.js`
- New migration: v58 (availability + voids/comps + reservations + waitlist + menu schedules + seat numbers + order types)

---

## Phase 2-G — General Retail Tier-1 Parity (14-16 weeks)

> Numbering note: After Phase 2-R (restaurant) we discovered the same over-claim pattern in retail — thought DEEP, audited at ~62%. This phase is labeled **Phase 2-G** (general retail) to parallel 2-R. Internal items are numbered 2-G.0 through 2-G.17 (Waves 1-5 = competitor parity, Wave 6 = merchant success + trust that competitors also miss), plus a parallel track B2.

**Why:** Like restaurant before 2-R, the `general_retail` preset covers the happy-path (scan → pay → print receipt) but falls apart on the depth features a mature retailer expects from Square for Retail, Shopify POS Pro, Lightspeed X-Series, or Loyverse. Three honest audits (Track 1 competitive research, Track 2 code audit, Track 3 tenant reality check — all 2026-04-20, saved under `docs/plans/phase-2g-*.md`) surfaced **one foundational UX gap** (no scan-first omni-input primitive — 2-G.0) plus **13 feature gaps** (2-G.1–2-G.13) that keep SanoPOS retail from feeling Tier-1. Phase 2-G closes all of them so general retail becomes a lead-with product, not the "other" mode that isn't restaurant.

**What we deliberately scoped OUT of Phase 2-G:** vertical-specific presets (pharmacy, jewelry, eyewear, auto parts, furniture with serial tracking). Those are distinct products with their own SaaS competitors and get their own presets in Phase 3 — like we did for dental/vet/physio. Phase 2-G makes `general_retail` mature enough that those verticals can be built on top without reworking foundations.

**Build order matters:** 2-G.0 (omni-input primitive) ships first — it's a component, not a new route, but it unblocks 2-G.1 (variant modal trigger) and 2-G.2 (serial-entry trigger) which both depend on pattern-matched product lookup.

**Source:** Competitive research + code audit + tenant reality check on 2026-04-20. References: Square for Retail Free/Plus/Premium (unified plans Oct 2025), Shopify POS Pro with Stocky sunsetting Aug 31 2026, Lightspeed X-Series matrix variant grid, Clover Retail (counter-positioning only), Loyverse (budget baseline). Full research at [phase-2g-research-synthesis.md](phase-2g-research-synthesis.md).

**Scope reclamation from Track 2 audit** — three items we thought were gaps are already fully shipped:
- **Store credit end-to-end** — complete via `customer_wallet_ledger` + topup routes + POS tender. No work needed.
- **Exchange flow** — complete as composite return+sale in [POSReturnExchangeModal.jsx](../../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx). No work needed.
- **Bulk-scan increment-on-duplicate** — default behavior of [useCart.js:179-215](../../frontend/src/pages/redesign/pos/hooks/useCart.js). Only gap is an *opposite* toggle (new line per scan) which is a 0.5d option; descoped.

### 2-G.0 — Scan-first omni-input primitive on /pos
**Why this first:** All three Tier-1 competitors (Square, Shopify, Lightspeed) open retail POS with cursor auto-focused in a single unified field that pattern-routes: scanner-framed UPC/EAN → barcode lookup, numeric PLU → direct add, text → product search, hashtag or custom prefix → customer lookup. SanoPOS has a scan field today but it lacks **primacy** (auto-focus on mount + after every ticket close + after every barcode commit) and **pattern routing** (everything runs through substring search). Without fixing this first, every downstream POS UX item (2-G.1 variant modal, 2-G.4 manager override, 2-G.6 serial entry) has nowhere clean to hang off of.

**Build:**
- New component: `frontend/src/pages/redesign/pos/POSOmniInput.jsx` — single input with pattern detector (UPC/EAN 8/12/13/14 digit + checksum, PLU 4-5 digit, text ≥ 2 chars, `#` prefix for customer).
- Auto-focus on mount, after barcode commit, after ticket close, after Esc. Idle-focus timer re-claims focus after 10s of inactivity.
- Pattern router dispatches to: `lookupByBarcode()` → `lookupByPLU()` → `searchProducts()` → `searchCustomers()`.
- Barcode match with variants → triggers **2-G.1 matrix modal** via `pendingVariantProductId` in POSContext.
- Barcode match with serialized product → triggers **2-G.6 serial entry modal** via `pendingSerialProductId`.
- Replaces the hero position of the current product search sidebar; search is still reachable from a secondary quick-action button.
- Keyboard shortcut: `/` focuses the field (Shopify pattern). Esc clears.

**What it does NOT do:**
- No new route — enhances `/pos` in place. (Retail doesn't need a shell swap like restaurant did.)
- No new backend endpoints — reuses existing `/api/products/search` and barcode lookup.
- No POS layout refactor beyond the top-bar field.

**Critical files:**
- New: `frontend/src/pages/redesign/pos/POSOmniInput.jsx`, `frontend/src/pages/redesign/pos/omniInputRouter.js` (pure function; TDD-first)
- Modified: [POSContext.jsx](../../frontend/src/pages/redesign/pos/POSContext.jsx) (additive `pendingVariantProductId`, `pendingSerialProductId`), [POSRedesign.jsx](../../frontend/src/pages/redesign/POSRedesign.jsx) (top-bar slot)
- No backend changes, no migration.

**Estimate:** 3 days.

### 2-G.1 — Matrix variant grid modal (size × color)
**Why:** Lightspeed's defensible moat for apparel/footwear retailers. Current SanoPOS variant picker is a flat pill list; unusable at >10 variants. Tenant reality check (2026-04-20) confirms live retail tenants use variants — Wave 3 priority, not defer-to-Phase-3.

**Build:**
- New modal: `frontend/src/pages/redesign/pos/POSVariantMatrixModal.jsx` — dynamic grid rendering the product's variant axes (size × color by default, extensible to 3 axes via a 2×N matrix + dropdown for the 3rd).
- Cell state: in-stock green / low amber / zero greyed. Click a cell → add variant to cart.
- Keyboard nav: arrow keys move focus, Enter commits.
- Triggered from 2-G.0 when `pendingVariantProductId` is set.
- Serial-entry interlock (for 2-G.6): if the variant is serialized, chain into serial entry after selection.
- Stock display reads per-variant outlet stock (audit flagged `variant_stock` shape to confirm during build — if per-product stock only, show product-level number per cell).

**What it does NOT do:**
- No matrix editing at the admin level (that's already in `VariantEditor.jsx`).
- No 3-axis grid UI beyond 2D + dropdown fallback.

**Critical files:**
- New: `POSVariantMatrixModal.jsx`
- Modified: POSContext to expose `pendingVariantProductId` + `openVariantModal(productId)`; `POSOmniInput` to chain from barcode scan.

**Estimate:** 5 days.

### 2-G.2 — Gift cards as first-class tender (digital + physical)
**Why:** Table-stakes at every Tier-1 competitor. Endpoints exist orphaned in `barcode-expenses.js` — no POS checkout wiring. Tenant reality confirms demand for **both** digital (SMS/email code to recipient) **and** physical (pre-printed cards scanned at activation).

**Build:**
- **Schema:** new `gift_card_transactions` ledger table shaped like `customer_wallet_ledger` (schema-pg.sql:324-333) — the shared ledger primitive also used by 2-G.5 loyalty. Add `gift_cards.card_type` (`digital` / `physical`) + `activation_status` (`pre-printed` / `issued` / `active` / `depleted`).
- **Physical card-range management:** new admin page to register pre-printed card ranges (serial numbers) before activation; scan-to-activate at POS attaches balance.
- **POS tender:** `POSCheckoutModal` gets gift-card row in tender grid. Enter code or scan physical card → balance check → apply (partial or full) → split-tender updates `remaining`.
- **Issue flow:** sell a gift card SKU; on sale completion, generate code (digital) or assign pre-printed serial (physical); send code via SMS/email template.
- **Balance check UI:** small lookup in customer panel; public `/gift-card/:code` page for customer self-check (no auth).
- **Enum extension:** verify `sale_payments.method` check constraint includes `gift_card` before wiring.

**What it does NOT do:**
- No gift-card marketplace (selling on Daraz/Meta).
- No reloadable gift cards (one-time load only; reload can be a Phase 3 extension).
- No multi-currency gift cards.

**Critical files:**
- New migration: adds `gift_card_transactions` table, `gift_cards` columns.
- New: `backend/routes/gift-cards.js` (wired-up version; deprecates orphaned `barcode-expenses.js` gift-card endpoints), `frontend/src/pages/redesign/GiftCardsAdminRedesign.jsx`, public `frontend/src/pages/GiftCardBalancePage.jsx`.
- Modified: [POSCheckoutModal.jsx](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx) (tender row), [sales.js](../../backend/routes/sales.js) (method enum validation).

**Estimate:** 6-7 days (digital 3d + physical activation 3-4d).

### 2-G.3 — Loyalty earn + redeem at POS with tier auto-apply
**Why:** Tier `discount_percent` column has existed in schema but is **never applied** to sale totals (drift flagged in code audit). Current loyalty is earn-only; no redeem at checkout, no tier auto-discount. Square charges $45/mo for this — SanoPOS includes in base.

**Build:**
- **Schema:** new `loyalty_transactions` ledger (same shape as wallet ledger — shared primitive). Columns: customer_id, type (earn/redeem/adjust), points, sale_id, reason.
- **Auto-earn on sale completion:** rule engine reads `loyalty_tiers.earn_rate` (points per rupee) — already in schema; wire into sales.js post-commit.
- **Auto-discount by tier:** at checkout, if customer attached has a tier with `discount_percent > 0`, apply as a line-level pre-tax discount; show in totals as "Member discount (Silver 5%)".
- **Redeem at POS:** tender type in `POSCheckoutModal` — "Redeem X points → Y rupees" with configurable conversion rate per tenant.
- **Feature flag:** `phase2g_loyalty` — lets the tier-discount auto-application be toggled per tenant to avoid surprising existing tenants where the tier was decorative.

**What it does NOT do:**
- No referral program, birthday bonuses, or campaign engine (Phase 3+).
- No tier progression calculator (manual tier assignment stays).

**Critical files:**
- New migration: `loyalty_transactions` table, `phase2g_loyalty` flag seed.
- Modified: [sales.js](../../backend/routes/sales.js) (earn + redeem paths), [POSCheckoutModal.jsx](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx) (redeem tender + discount line), [loyalty.js](../../backend/routes/loyalty.js) (if exists; else creates).

**Estimate:** 3 days.

### 2-G.4 — Customer-group price books (auto-apply at checkout)
**Why:** `customer_groups.discount_percent` exists but is NOT applied in `sales.js` (code audit confirmed). Tier-1 at every competitor, and B2B price books are behind Shopify Plus ($2,300/mo) — huge wedge.

**Build:**
- **Auto-apply:** when customer with group attached to cart, apply `discount_percent` at sale creation (same discount line as 2-G.3 tier discount; shown as "B2B group: Wholesale 10%").
- **Per-product price-book override** (Lightspeed-style): optional new `price_books` table (group_id, product_id, price) overrides the product's default price when that group's customer is at checkout. Resolution order: product price → group discount% → price-book override → promotion.
- Admin page: `/customers/groups/:id/price-book` — upload CSV or bulk-edit prices for a group.
- Feature flag: `phase2g_price_books` (gates per-product overrides; group discount% auto-apply ships ungated with a one-time tenant opt-in per existing behavior preservation).

**What it does NOT do:**
- No NET terms / purchase-on-account — that's Lightspeed Advanced territory, candidate for Phase 3.
- No tax-exempt toggle per group (Phase 3).

**Critical files:**
- New migration: `price_books` table + flag seed.
- New: `backend/routes/price-books.js`, admin page `CustomerGroupPriceBookRedesign.jsx`.
- Modified: [sales.js](../../backend/routes/sales.js) price resolution, customer attach path.

**Estimate:** 2 days (group discount auto-apply 1d + per-product price books 1d).

### 2-G.5 — Manager price override with PIN at POS
**Why:** Column may or may not exist on `sale_items` — audit said FULLY MISSING; verify before migration. Blocks any retailer doing price-match or customer negotiation. Reuses existing `verifyManagerPin()` service from `approval-policies.js:114`.

**Build:**
- **Schema:** add `sale_items.price_override_amount`, `sale_items.price_override_reason_code`, `sale_items.price_override_approved_by` (manager id). New lookup table `override_reasons` seeded with defaults (Price match / Damaged item / Loyalty gesture / Manager discretion).
- **PERMISSION_RULES:** new `override_price` permission — Cashier defaults OFF, Manager/Admin ON.
- **POS UI:** on cart line, long-press / right-click / "..." menu reveals "Override price" → opens `POSPriceOverrideModal`. If current user lacks `override_price` → PIN prompt reusing `verifyManagerPin`. Reason code required.
- **Audit trail:** every override is logged to `action_history` with before/after price + approving manager + reason code + sale_id.
- **Report:** "Price overrides by employee" — flags abnormal patterns.

**What it does NOT do:**
- No threshold-configurable auto-approval (every override needs PIN for Cashier; Manager can override without PIN).
- No customer-facing "discount sticker" — override is silent on the receipt beyond the line price.

**Critical files:**
- New migration: `sale_items` override columns, `override_reasons` table, `override_price` permission.
- New: `POSPriceOverrideModal.jsx`.
- Modified: [POSCartTable.jsx](../../frontend/src/pages/redesign/pos/POSCartTable.jsx) (line menu), [permissions.js](../../backend/middleware/permissions.js), [sales.js](../../backend/routes/sales.js) (persist + audit), [approval-policies.js](../../backend/routes/approval-policies.js) (reuse verifyManagerPin).

**Estimate:** 5 days.

### 2-G.6 — Serialized inventory end-to-end
**Why:** `product_serial_numbers` table and admin CRUD exist (schema ships v?? — confirm during build). GRN receive never creates serials, POS sale never assigns, returns never reverse, no warranty tracking. Electronics/appliance/watch/firearm tenants make POS decisions on this single feature.

**Build:**
- **Schema:**
  - Add `product_serial_numbers.variant_id` (nullable) so serials can attach to variants (apparel with serialized high-value variants, or electronics where only certain variants have serials).
  - Add `product_serial_numbers.warranty_months`, `warranty_start_date`, `warranty_end_date`.
  - New `sale_item_serials` bridge (sale_item_id, serial_id) — many-to-one since a sale_item quantity could be 1 serialized unit (or N if bundled).
  - Add `products.serial_required` flag (force serial entry at POS when scanning/adding this product).
- **GRN flow:** receiving screen for serialized products prompts serial-number entry (scan or manual). Each serial row inserts into `product_serial_numbers` with status `in_stock`.
- **POS flow:** scanning a `serial_required` product triggers `POSSerialEntryModal` (chained from 2-G.0). Serials marked `sold` on sale completion; warranty dates computed.
- **Returns flow:** returning a serialized item reverses serial status to `in_stock` (or `warranty_claim` if toggled). Serial history visible on the customer profile.
- **Receipt:** serial numbers printed under each line on receipts when present.

**What it does NOT do:**
- No RMA workflow (separate Phase 3 feature for repair/electronics verticals).
- No stolen-serial blacklist check (Phase 3+).
- No bulk serial import from CSV (admin one-at-a-time; OK for launch).

**Critical files:**
- New migration: serial columns + `sale_item_serials` + `products.serial_required`.
- New: `POSSerialEntryModal.jsx`, GRN-side serial entry panel.
- Modified: [sales.js](../../backend/routes/sales.js) (stamp serials on line items), [returns.js](../../backend/routes/returns.js) (reverse serial status), [grn.js](../../backend/routes/grn.js) (receive serials), receipt HTML builder.

**Estimate:** 5 days.

### 2-G.7 — Per-line restock toggle + per-line reason codes on returns
**Why:** Today, `return_reasons` table exists and one reason is selected per entire return. Square ships per-line restock flag + per-line reason; feeds defective-rate analytics by vendor.

**Build:**
- **Schema:** add `return_items.restock_flag` (boolean, default true) + `return_items.reason_code_id` (optional override of return-level reason).
- **UI:** on returns modal, each line gets a "Restock" toggle and a per-line reason dropdown (defaults to return-level reason). Bulk "Set all" button at top.
- **Inventory impact:** when restock_flag=true, inventory increments on return completion; when false, item is scrapped (logged for shrinkage report).
- **Report extension:** "Returns by reason by product by vendor" — identifies defective vendors.

**What it does NOT do:**
- No per-line condition grading (good/damaged/defective — Phase 3+).
- No automatic vendor claim generation.

**Critical files:**
- New migration: `return_items` columns.
- Modified: [POSReturnExchangeModal.jsx](../../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx), [returns.js](../../backend/routes/returns.js).

**Estimate:** 2 days.

### 2-G.8 — Inventory Intelligence Hub at /retail/inventory-intelligence
**Why:** Shopify's biggest value-add in POS Pro is the Stocky bundle — grouped at one route, not scattered pages. Track 2 audit confirmed ABC columns don't exist, cycle-count scheduling doesn't exist, hub route doesn't exist. This phase absorbs the former 2-G.9 (cycle counts) and 2-G.10 (reports) per audit recommendation. Track 3 confirmed no Stocky-migration urgency — ship at normal Wave 4 priority, no marketing rush.

**Build (phase absorbs 3 former scope items):**

**8a. ABC classification + sell-through + GMROI:**
- Materialized view or nightly worker computes `product_abc_class` (A/B/C by contribution to revenue — 80/20 Pareto).
- New reports: sell-through rate (units sold / units received over window), GMROI ((margin × sell-through) / avg inventory value).
- Inventory aging extends existing `stock_aging` report with $ values by age bucket (already has age; add value).

**8b. Demand forecast + reorder suggestions:**
- Simple velocity-based (not ML): trailing 30-day units sold ÷ days → daily velocity. Suggest reorder when `current_stock < velocity × (lead_time_days + safety_stock_days)`.
- Suggestions surface as a hub card with "Create PO" button chain-linked to existing purchase-orders flow.

**8c. Scheduled cycle counts:**
- New `cycle_count_schedules` table: zone (optional filter by category/location), recurrence (weekly/monthly), next_due_date.
- New `cycle_count_sessions` table: schedule_id, started_at, completed_at, variance_value.
- UI: calendar view of upcoming counts + "Start count" button; counting screen reuses existing `inventory_reconciliation` flow.
- Report: "Shrinkage variance" — expected vs counted, rupee value of variance, broken down by zone/employee.

**8d. Hub composition:**
- New route `/retail/inventory-intelligence` (permission `manage_inventory`; feature flag `phase2g_inventory_intelligence`).
- Tabs: ABC Analysis / Reorder Suggestions / Cycle Counts / Aging & Shrinkage.
- Dashboard cards on top: items needing reorder, next cycle count, dead-stock count (no sales >90d), ABC split.

**What it does NOT do:**
- No ML/seasonal forecasting (velocity-based only; ML is a Phase 3 candidate if tenant demand surfaces).
- No automatic PO generation (suggestions are click-to-create only — keeps buyer in the loop).
- No vendor-scorecard report (Phase 3+).

**Critical files:**
- New migrations: `cycle_count_schedules`, `cycle_count_sessions`, `product_abc_class` view or column, `phase2g_inventory_intelligence` flag.
- New: `backend/routes/inventory-intelligence.js`, `frontend/src/pages/redesign/InventoryIntelligenceRedesign.jsx` and sub-tabs.
- Modified: [stock-aging report](../../backend/routes/reports/) to add value dimensions.

**Estimate:** 12-16 days (ABC + metrics 3-4d + demand/reorder 2-3d + cycle schedules 4-5d + hub composition 3-4d).

### 2-G.9 — Layaway / hold / special-order with deposit schedule
**Why:** Tenant reality check confirmed real demand. Distinct from `parked_sales` (cart-pause only, no deposits). Pakistan "qist" culturally common; layaway with Easypaisa/JazzCash deposit acceptance is a differentiator vs Lightspeed's cash-only layaway.

**Build:**
- **Schema:** new `holds` table (id, customer_id, outlet_id, status `active`/`paid`/`forfeit`/`completed`, deposit_paid, balance_due, hold_until, created_by, notes). New `hold_items` (hold_id, product_id, variant_id, quantity, price_at_hold). New `hold_payments` ledger (hold_id, amount, method, paid_at).
- **POS flow:** "Hold for customer" button on checkout — prompts deposit amount (optional but strongly suggested), hold-until date (default 14 days), customer attach required. Deposit persists via existing payment method flow (cash/card/wallet/Easypaisa).
- **Pickup flow:** customer returns → scan receipt barcode (uses 2-G.11) OR look up hold by customer/phone → settles balance via tender grid → hold marked `completed`, inventory converts from held to sold.
- **Forfeit policy:** after `hold_until` passes, config toggle decides: auto-return-to-stock (deposit kept) vs notify staff to call customer.
- **Dashboard widget:** "Holds expiring this week" on retail home screen.

**What it does NOT do:**
- No layaway "payment plan" per se (merchant + customer agree informally; system only tracks deposit + balance). Full scheduled payment plan is Phase 3.
- No consignment (merchant holds someone else's goods — different workflow, Phase 3 if demand).

**Critical files:**
- New migration: `holds`, `hold_items`, `hold_payments`.
- New: `backend/routes/holds.js`, `frontend/src/pages/redesign/HoldsRedesign.jsx`, `POSHoldCreateModal.jsx`, `POSHoldPickupModal.jsx`.
- Modified: POSCheckoutModal (Hold button + mode), home dashboard widget.

**Estimate:** 8-10 days.

### 2-G.10 — Staff commissions finish (tiered + fixed_per_item + per-item attribution)
**Why:** v20 shipped commission schema + routes + UI. Only missing: `fixed_per_item` calc, `tiered` calc, and wiring `sale_items.staff_id` (v49) as the per-item attribution source instead of sale-level `authenticatedEmployeeId`. Tenant reality check confirmed all three calc patterns in use. Cheap finish on sunk infrastructure.

**Build:**
- **Calc types:**
  - `fixed_per_item`: `commission = units_sold × fixed_amount` per eligible item.
  - `tiered`: thresholds in `commission_plan_tiers` (existing schema? verify; else add). E.g., ≥100 units → 5%, ≥200 → 8%. Applies rolling per period.
- **Per-item attribution:** commission matcher in `commission_service.js` reads `sale_items.staff_id` when set (individual-item selling staff in restaurant mode for walk-ins), falls back to sale-level employee.
- **Collision preservation:** `commission_earnings.earning_type` is shared with Phase 2-R tips; all changes route tips unchanged through existing `earning_type='tip'` paths.
- **Commission statement PDF:** already exists? verify; else add employee-by-period commission report with breakdown by sale + calc type.

**What it does NOT do:**
- No commission splits across multiple employees per sale (Phase 3).
- No clawback on returns (simple reverse at v20; no sophistication added).

**Critical files:**
- New migration: `commission_plan_tiers` (if not exists).
- Modified: [backend/services/commission-service.js](../../backend/services/commission-service.js) (calc types + attribution), commission statement report.

**Estimate:** 4-5 days.

### 2-G.11 — Receipt-barcode → one-scan return lookup
**Why:** Shopify + Square both ship. `show_barcode` receipt flag exists in SanoPOS but renders plain text. Small UX win, low effort, differentiates from manual invoice lookup. Also unlocks hold-pickup speed for 2-G.9.

**Build:**
- **Receipt rendering:** add JsBarcode (CODE128) to `frontend/src/utils/receipt.js` — renders invoice number as scannable barcode on HTML receipts + thermal (ESC/POS GS k command).
- **Lookup endpoint:** `GET /api/sales/by-barcode/:code` — resolves to invoice lookup.
- **POS return screen:** scan field auto-loads invoice items when barcode pattern matches an invoice number prefix.

**What it does NOT do:**
- No signed/tamper-proof receipts (Phase 3+).
- No QR instead of barcode (barcode works on all thermal printers; QR on some).

**Critical files:**
- Modified: [receipt.js](../../frontend/src/utils/receipt.js), [POSReturnExchangeModal.jsx](../../frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx), [sales.js](../../backend/routes/sales.js) (barcode lookup endpoint).

**Estimate:** 3 days.

### 2-G.12 — Bulk-scan toggle (opposite default)
**Why:** `useCart.js` already defaults to increment-on-duplicate (confirmed by audit). This item only adds the *opposite* mode — each scan creates a new cart line — for tenants who want per-scan line granularity (e.g., serial-tracked items where each unit must be a distinct line).

**Build:**
- Per-terminal toggle in POS settings: "Each scan = new line" vs "Increment quantity on duplicate scan" (default).
- When ON: scanning the same barcode twice creates two cart lines.
- Auto-enables when 2-G.6 serial entry is active (serialized products always get their own line).

**What it does NOT do:**
- No bulk-receive mode (that's separate in GRN UI).

**Estimate:** 0.5 days.

### 2-G.13 — Per-device Quick Grid
**Why:** Shopify Smart Grid pattern — per-device (or per-terminal) favorite tiles. Cashier lanes differ (Returns desk vs Floor terminal). Current POS tile grid is uniform.

**Build:**
- New `pos_quick_keys` table (terminal_id, tile_index, product_id OR action_type, color, label override).
- POS admin page `/settings/pos-quick-keys` — drag-drop product tiles into a grid per terminal.
- POS `POSSearchArea` reads terminal-scoped quick-key grid when `?terminal=X` query param present; falls back to outlet-wide config otherwise.

**What it does NOT do:**
- No per-role filtering (Shopify has same gap; flag for later).
- No chain-wide push-from-admin grid templates (Phase 3+).

**Critical files:**
- New migration: `pos_quick_keys`.
- New: admin page, POSContext integration.
- Modified: [POSSearchArea.jsx](../../frontend/src/pages/redesign/pos/POSSearchArea.jsx).

**Estimate:** 3 days.

### 2-G.14 — Data migration from Shopify / Square / Lightspeed
**Why:** Highest-leverage gap Phase 2-G as drafted missed. A Shopify merchant churning off POS Pro has 2,000 SKUs + 800 customers + purchase history. Without a one-click import, SanoPOS loses the conversion. This is the single cheapest thing we can ship that moves competitor-refugee conversion materially. Sourced from longtail Bucket A.

**Build:**
- **Shopify export format:** Products CSV (handle, title, variants, images, tags, SKU, barcode, price, compare-at-price, inventory-qty-per-location), Customers CSV (email, phone, addresses, tags, accepts-marketing, total-spent, orders-count), Orders CSV (optional — for historical reference only, not re-posted as sales).
- **Square export format:** Catalog CSV (item, variation, category, SKU, GTIN, price, cost, tax, track inventory), Customer Directory CSV (name, email, phone, card on file reference).
- **Lightspeed export format:** Items CSV, Customers CSV — X-Series format via API export.
- **Admin UI:** `/settings/import-from-competitor` page with source dropdown (Shopify / Square / Lightspeed / Generic) + file upload + preview (first 100 rows, column-mapping override) + dry-run → confirm → commit.
- **Field mapping:** each source format has a fixed mapping file (`services/import/mappers/{shopify,square,lightspeed}.js`) that translates source columns → SanoPOS schema.
- **Conflict handling:** duplicate SKU / email → merge (default) / skip / rename. Report on completion: X imported, Y skipped, Z errors with downloadable error CSV.
- **Reuses existing `import.js` pipeline** for the actual insert path.

**What it does NOT do:**
- No image bulk download from URLs (source CSVs typically reference Shopify CDN URLs — out of scope; tenant re-uploads or uses existing bulk media tool).
- No order-history migration (shops keep historical records on the old system; SanoPOS imports current state, not past sales).
- No real-time sync (this is one-shot migration, not bidirectional).

**Critical files:**
- New: `backend/services/import/mappers/{shopify,square,lightspeed,generic}.js`, `frontend/src/pages/redesign/ImportFromCompetitorRedesign.jsx`
- Modified: [backend/routes/import.js](../../backend/routes/import.js) (extend to accept `?source=shopify` etc.)

**Estimate:** 3 days (1d per mapper + 0.5d conflict/preview UI).

### 2-G.15 — Error-state pass across retail screens
**Why:** "Professional vs beta" differentiator. Phase 2-R demonstrated that tight error-state handling (kitchen-firing offline banner, cart-collision prompt, loading skeletons) is what made restaurant feel Tier-1. Retail screens have the same gaps: scan fails, PIN wrong, insufficient stock, print fails post-payment, shift left open overnight, two cashiers racing on the same sale. Sourced from longtail Bucket A.

**Build:**
- **Error-state inventory per retail screen** — audit every retail-facing page and POS modal for:
  - Empty states (no data) — friendly message + primary action button
  - Loading states — skeleton placeholder or spinner
  - Error states — specific message + recovery action
  - Network-down states — offline banner + "action queued" where applicable
  - Permission-denied states — clear "you need X permission" message with link to request
- **Specific critical flows to harden:**
  - **Receipt fails to print AFTER payment succeeds** → retry modal with "Print again / Email / SMS / Skip" options. Sale already committed; this is receipt-only recovery.
  - **Shift left open overnight** → next morning login prompts "Yesterday's shift is still open — close now?" with auto-fill expected cash if last count is known.
  - **Two cashiers refunding same sale simultaneously** → second one gets "Already refunded at HH:MM by X" with refund reference.
  - **POS crash with non-empty cart** → on reconnect, offer "Resume cart from Xh ago?" using `parkSale()` checkpoint.
  - **Barcode scan fails to match** → "Not found — add as new product?" option (permission-gated).
  - **Insufficient stock at checkout** → "Only 3 in stock; sell 3 now and create backorder for the rest?" option.
- **Logging:** every error state that fires logs to `action_history` for post-hoc analysis.

**What it does NOT do:**
- No retry/resilience infrastructure changes (offline queue stays as-is; this is UX polish, not engineering reliability).

**Critical files:**
- Audit output: `docs/plans/phase-2g-error-state-inventory.md` (produced in Wave 6 kickoff by an Explore agent)
- Modified: ~20 retail-screen `*Redesign.jsx` files + POS modals
- New: `POSReceiptRetryModal.jsx`, `POSShiftRecoveryModal.jsx`, `POSCartCollisionModal.jsx` (may already exist from 2-R; verify and reuse)

**Estimate:** 4 days (1d audit + 3d fix pass).

### 2-G.16 — Merchant home dashboard (retail owner view)
**Why:** Square's home screen is beautiful and "sticky." Every merchant opens it first. SanoPOS has a generic dashboard; a retail-specific home that shows an owner the KPIs they care about (today's sales vs yesterday, top products, low stock, staff performance, cash position) is a retention feature, not a new sale. Sourced from longtail Bucket A + #16.

**Build:**
- New route `/retail/home` for users with `role=Administrator` OR `role=Manager` + general_retail preset — optional per-user setting to land here on login instead of `/dashboard`.
- **Cards on the page** (pulled from existing endpoints where possible):
  - Today's sales (count + total) vs yesterday + same-day-last-week % comparison
  - Top 5 products today
  - Low-stock alerts (products under reorder point)
  - Cash-position: expected cash in all drawers + any open shift warnings
  - Staff-of-the-day: highest sales among active staff
  - Pending action items: PO receive, returns awaiting refund, overdue holds (ties to 2-G.9)
  - Month-to-date margin vs last month
- **Per-outlet filter:** multi-outlet owners can toggle between "All outlets" and a specific outlet.
- **End-of-month summary email:** weekly cron sends a "How's your store doing" digest email with the same cards rendered — opt-in per tenant.

**What it does NOT do:**
- No benchmarking against industry (would require cohort data — defer per longtail Bucket D).
- No AI-generated narrative ("you're down 30% because X") — AI deferred.
- No real-time push-style updates (cards refresh on page load + 60s polling).

**Critical files:**
- New: `backend/routes/retail-home.js`, `frontend/src/pages/redesign/RetailHomeRedesign.jsx`
- Modified: `frontend/src/ui/nav-config.js` (add home link), `frontend/src/routes/appRoutes.jsx` (register route)
- Worker extension: weekly digest email job

**Estimate:** 3 days.

### 2-G.17 — Anti-theft & shrinkage controls
**Why:** Per Lavu/Restaurant365/retail ops research, comp/void/no-sale abuse is the #1 revenue leakage source in retail — more than actual theft. Phase 2-R.2 introduced manager-PIN void+comp for restaurant. Retail needs the same treatment for: no-sale cash drawer opens, high-value voids, employee refund anomalies, end-of-shift discrepancies. Sourced from longtail Bucket A + #18.

**Build:**
- **No-sale tracking:** existing cash-drawer-kick endpoint logs every "open drawer without transaction" to new `no_sale_events` table with employee_id, reason_code (from a seedable reason table: "Give change", "Count cash", "Training", "Other"), timestamp. Dashboard card: "No-sale opens this week by employee."
- **Threshold-based manager approval on refunds:** any refund > configurable amount (default: Rs 5,000) requires manager PIN — reuses `verifyManagerPin()` from 2-G.5.
- **Employee anomaly detection:** nightly worker computes per-employee metrics (voids, refunds, discounts as % of their sales). Flags outliers (2 SD above peer average) in admin dashboard. No automatic punishment — surfaces for manager review.
- **End-of-shift variance flagging:** existing shift-close flow already computes expected vs counted cash; add threshold (default Rs 500) that requires manager acknowledgment + reason note before accepting the close.
- **Audit report:** "Retail risk events" — combined view of no-sales, high voids, discount anomalies, shift variances per employee per period.

**What it does NOT do:**
- No CCTV integration (that's a platform-level item, Bucket D — deferred).
- No automatic blacklisting / termination workflow (always a human decision).

**Critical files:**
- New migration: `no_sale_events`, `no_sale_reasons`, `retail_anomaly_flags`.
- New: `backend/routes/retail-risk.js`, `frontend/src/pages/redesign/RetailRiskRedesign.jsx`, `POSNoSaleReasonModal.jsx`, `POSShiftVarianceModal.jsx`
- Modified: cash-drawer-kick endpoint, shift-close flow, refunds flow.

**Estimate:** 3 days.

### Parallel track — B2. Label Template Designer (ZPL + TSPL + Dymo + dual template type)

**Why parallel:** Heaviest single item (~12-14 days). Has almost no shared dependencies with other Phase 2-G items. Runs on its own feature branch without blocking Wave 1-5. Pick up whenever capacity permits — before or during Phase 2-G main track.

**Scope:**
- Visual template designer: drag-drop fields (product name / SKU / price / barcode / variant / category), size presets per printer model, preview with real product data.
- **Two template types** (per tenant reality Q4):
  - **Item labels:** barcode + SKU + price + variant code. Sizes: 1×2in, 2×1in, 2.5×1in common.
  - **Shelf labels:** product name + price + unit price + category. Larger format (3×2in, 4×3in).
- **Printer language support** (all three required per tenant feedback):
  - ZPL (Zebra ZD410/ZD420/ZD421 etc.)
  - TSPL (TSC TE244/TDP-244)
  - Dymo Label (USB via SDK/CUPS)
- Template storage: extend `barcode_templates` with `template_body_zpl`, `template_body_tspl`, `template_body_dymo`, `template_type` (item/shelf).
- Print path: `services/printer.js` extends with `printLabel(template_id, product_id, copies, printer_id)`; emits the right language per printer config.
- Bulk print from catalog: select N products → print M labels each → queue to label printer.

**Critical files:**
- New migration: `barcode_templates` column extensions.
- New: `backend/routes/label-templates.js`, `frontend/src/pages/redesign/LabelDesignerRedesign.jsx`, `services/printer-languages/{zpl,tspl,dymo}.js`.

**Estimate:** 12-14 days (ZPL base 4d + TSPL 2d + Dymo 3d + shelf template type 2d + designer UI 3d).

---

### Waves — final sequencing

**Wave 1 — Foundations** (~3d — unblocks everything else):
- Ledger primitive migration (shared by 2-G.2 + 2-G.3)
- Feature flag seeds for all 2-G items
- 2-G.0 Omni-input primitive + pattern router

**Wave 2 — Tender completion** (~11-13d):
- 2-G.2 gift cards digital+physical
- 2-G.3 loyalty earn/redeem + tier auto-apply
- 2-G.4 customer-group price books

**Wave 3 — POS UX depth** (~17d):
- 2-G.5 manager price override
- 2-G.1 matrix variant grid
- 2-G.6 serialized inventory E2E
- 2-G.7 per-line restock + reasons

**Wave 4 — Inventory Intelligence Hub** (~12-16d):
- 2-G.8 hub + ABC + reorder + cycle counts + GMROI/sell-through

**Wave 5 — Finishing + flow-shape** (~15-18d):
- 2-G.10 commission calc finish
- 2-G.11 receipt barcode + return lookup
- 2-G.9 layaway with deposits
- 2-G.13 per-device quick grid
- 2-G.12 bulk-scan opposite toggle

**Wave 6 — Merchant success + trust** (~13d):
- 2-G.14 data migration from Shopify/Square/Lightspeed — **highest-leverage conversion unlock**
- 2-G.15 error-state pass across retail screens — "professional vs beta"
- 2-G.16 merchant home dashboard — retention feature for owners
- 2-G.17 anti-theft / shrinkage controls — no-sale, manager-PIN thresholds, anomaly detection

**Parallel track (separate branch):**
- B2 label designer — 12-14d, run whenever

**Deferred to Phase 3:**
- Training role (low parity pressure)
- ML demand forecasting
- NET terms / purchase-on-account
- RMA workflow
- Endless aisle / BOPIS / ship-from-store
- Native scale hardware integration
- Customer-facing display
- Vertical-specific presets (pharmacy, jewelry, eyewear, auto parts, furniture)

### Deliverables

- `general_retail` preset matures from ~62% to ~95% vs Square/Shopify/Lightspeed Tier-1.
- All 23 presets inherit the improvements (tenders, loyalty, price books, serials, inventory intelligence, commissions, holds, quick grid — all cross-preset).
- Landing-page-worthy bullets: "Gift cards in base plan (Square charges separately)", "B2B price books in base plan (Shopify requires Plus $2,300/mo)", "Serialized inventory built-in (Square doesn't ship it at all)".
- All 7 CLAUDE.md drift items from Track 2 audit corrected.

### Verification (demo script)

A test retail tenant can, in one session: scan a sale through the omni-input → pick size/color from matrix grid → item shows serial-entry modal → enters IMEI → attaches a customer tagged "Wholesale" → group discount auto-applies + loyalty tier discount stacks → manager PIN-approves a 15% price match on one line with reason "Price match" → tenders 3 ways (gift card + wallet + cash) → receipt prints with scannable Code128 of invoice number → next customer returns the serialized item by scanning the receipt barcode → return modal auto-loads with serial → per-line "Restock" toggle OFF (item marked for vendor claim) → store credit refund auto-applies to customer wallet → owner opens `/retail/inventory-intelligence` hub → sees the product now has a reorder suggestion (velocity spiked), ABC class B, cycle count due next week → clicks "Create PO" → partial receive against the PO converts to serials on receipt → another customer puts a high-value item on hold with 30% deposit → pickup 5 days later via receipt-barcode scan. End of day, owner pulls commission report showing tiered breakdown for two salespeople who each sold the serialized items.

### Critical files referenced across 2-G

- New backend routes: `backend/routes/{gift-cards,loyalty,price-books,inventory-intelligence,holds,label-templates}.js` (some may extend existing)
- New frontend pages: `InventoryIntelligenceRedesign.jsx`, `HoldsRedesign.jsx`, `LabelDesignerRedesign.jsx`, `GiftCardsAdminRedesign.jsx`
- New POS components: `POSOmniInput.jsx`, `POSVariantMatrixModal.jsx`, `POSSerialEntryModal.jsx`, `POSPriceOverrideModal.jsx`, `POSHoldCreateModal.jsx`, `POSHoldPickupModal.jsx`
- Shared ledger primitive: extend pattern at `customer_wallet_ledger` (schema-pg.sql:324-333) for gift_card_transactions + loyalty_transactions
- Shared PIN-verify pattern: reuse `verifyManagerPin()` (approval-policies.js:114)
- Feature flags: `phase2g_*` family

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
Month 2:     Phase 2.1 (Restaurant depth — splits/modifiers/courses/KDS/inbox/tips) ──── ✅ DONE 2026-04-18
Month 3-4:   Phase 2-R (Restaurant Tier-1 Parity)
             └─ 2-R.0 Restaurant-Native POS Shell ──── ✅ DONE 2026-04-18
             └─ 2-R.1 through 2-R.10 land inside the new shell
Month 4-7:   Phase 2-G (General Retail Tier-1 Parity)  ──── ← START HERE (next: 2-G.0 omni-input)
             └─ 2-G.0 → 2-G.17 (18 items in 6 waves) + parallel track B2 label designer
             └─ Wave 6 adds merchant-success layer (migration + error states + owner dashboard + anti-theft)
Month 7-8:   Phase 2.2/2.3 (Clinical + Repair to DEEP)
Month 5-7:   Phase 3.1 (Hotel + Channel Manager) ──── unlocks hospitality segment
Month 5-9:   Phase 4.1 (Native Mobile Shell — parallel track)  ──── App Store presence
Month 7-10:  Phase 3.2-3.3 (Rental + Gym)        ──── service economy locked
Month 7-10:  Phase 4.2 (Public API + Webhooks — parallel track) ──── partner ecosystem opens
Month 10-13: Phase 3.4 (Fresh Goods) + Phase 4.3 (Gift Cards) + Phase 4.4 (Accounting) ──── "complete platform"
Month 13+:   Phase 5 (Regional + International)  ──── growth engine
```

~~If you can only pick **one thing** to start: **Phase 1**.~~ Phase 1 done.
~~**Next:** **Phase 2.1 (Restaurant)**~~ Phase 2.1 done 2026-04-18.
~~**Next:** **Phase 2-R.0 — Restaurant-Native POS Shell**~~ 2-R.0 done 2026-04-18. The table-first `/pos/restaurant` shell is live; every 2-R.x feature now lands inside it.

~~**Next:** **Phase 2-R.1 — 86'd items / menu availability.**~~ Phase 2-R work continues in parallel or pauses; retail is the wider preset base.

**Next:** **Phase 2-G.0 — Scan-first omni-input primitive.** Retail's equivalent of the 2-R.0 shell insight — smaller scope but same category of "foundation you didn't realize was missing." All three Tier-1 competitors (Square, Shopify, Lightspeed) open POS with a single auto-focused pattern-routed field; SanoPOS has a scan field without primacy. Unblocks 2-G.1 matrix variant modal and 2-G.6 serial entry modal (both chain off pattern-matched product lookup). 3-day component build on `/pos`, no route swap.

**Phase 2-G in a nutshell:**
- Tracks: 3 research docs (competitive audit + 3 deep-dives) + 1 synthesis + 1 code audit + 1 tenant-reality check + 1 longtail inventory = 8 planning docs in `docs/plans/phase-2g-*.md`.
- Scope: 18 items (2-G.0 through 2-G.17) across 6 waves + parallel track B2 label designer. Waves 1-5 close competitor parity; Wave 6 addresses merchant success + trust features competitors also miss (data migration, error states, owner dashboard, anti-theft). Scope reclaimed: store credit, exchange flow, bulk-scan increment were ALREADY SHIPPED (caught by Track 2 audit).
- Effort: ~70-80 working days after shared-primitive dedup (~14-16 weeks), including Wave 6.
- Shared primitives: ledger pattern (from `customer_wallet_ledger`), `verifyManagerPin()` (from approval-policies), reason-codes (from return_reasons), feature-flag middleware.
- Longtail inventory: every other retail improvement idea discussed but not in 2-G scope is catalogued in [phase-2g-longtail-inventory.md](phase-2g-longtail-inventory.md) — this is the menu for Phase 3 retail depth and Phase 4.x platform pillars.

---

## Verification

For each phase, "done" is verifiable end-to-end against a real scenario:

- **Phase 1:** Lighthouse score >90 on 10 key pages, Sentry weekly errors <50, top 5 user journeys pass Playwright in CI, design audit shows zero off-system buttons/modals across `*Redesign.jsx`.
- **Phase 2.1 Restaurant:** A test restaurant tenant can: split a 4-person check 4 ways with custom tip pool, route appetizers to grill station and entrees to hot station, fire courses, accept a WhatsApp order into the same KDS — all from one demo.
- **Phase 2-G General Retail:** A test retail tenant can: scan a sale through the omni-input, pick size/color from matrix grid, enter a serial/IMEI, attach a Wholesale customer with auto-applied group discount + loyalty tier discount, manager-PIN override one line with reason code, tender in 3 parts (gift card + wallet + cash), print a receipt with scannable invoice barcode, then process a return by scanning that barcode with per-line restock toggle — all from one demo.
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
- **No new retail verticals inside Phase 2-G.** Phase 2-G deepens `general_retail` only. Pharmacy, jewelry, eyewear, auto parts, furniture (with serial tracking / VIN / prescription data / fitment / hallmark / etc.) are distinct **presets** to be built in Phase 3 — like dental/vet/physio were built. Do not try to solve them inside `general_retail` by adding fields — that path was tried and produced scaffolding, not product. *(Reaffirmed 2026-04-20 during Phase 2-G planning.)*
- **No AI features.** Per existing memory: AI BYOK was deferred Mar 27 due to no customer demand. Don't revisit until 100+ tenants asking. *Re-committed 2026-04-20:* temptations surfaced during Phase 2-G research (purchase prediction, photo-to-product, voice ordering, anomaly explanation, auto-categorization). All remain deferred under the same rule.
- **Don't confuse parity with differentiation.** Phase 2-G delivers parity with Square / Shopify / Lightspeed on Tier-1 retail features. It does NOT make SanoPOS automatically better at things competitors don't do. Differentiation comes from **vertical presets** (Phase 3), **country packs + local payment methods + local language** (Phase 5), and **local hardware support** (Phase 2-G polish + parallel track B2). Parity is the floor. Don't celebrate the floor as the lead.
- **No microservices rewrite.** The monolith on Express + Postgres scales fine to 100+ tenants with PgBouncer enabled. Don't introduce complexity without need.
- **No new payment gateway integrations** until xPay tokenization is real and SanoPay is production-grade. Adding Stripe before fixing xPay is moving sideways.
- **No own online store** in the next 12 months. Shopify took 15 years to build that moat. WooCommerce/Shopify sync is enough.
