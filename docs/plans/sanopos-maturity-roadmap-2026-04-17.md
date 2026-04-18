# SanoPOS Maturity Roadmap — From Scaffolding to Square/Shopify Parity

> **Date:** 2026-04-17
> **Last updated:** 2026-04-18
> **Source:** Brainstorming session, plan file at `~/.claude/plans/we-have-made-allof-smooth-jellyfish.md`
> **Status:** Phase 1 COMPLETE, Phase 2.1 COMPLETE, Phase 2-R.0 COMPLETE — ready to start 2-R.1

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
             └─ 2-R.1 through 2-R.10 land inside the new shell ──── ← START HERE (next: 2-R.1 86'd items)
Month 4-5:   Phase 2.2/2.3 (Clinical + Repair to DEEP)
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

**Next:** **Phase 2-R.1 — 86'd items / menu availability.** Highest daily-use operational gap — today a cashier can sell a sold-out dish because inventory doesn't block restaurant items. Also blocks 2-R.3 (pay-at-table can't ship without availability gating on the public guest QR menu). One-tap "86 this" from POS + KDS, auto-exclude from public menu, auto-restore when inventory returns.

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
