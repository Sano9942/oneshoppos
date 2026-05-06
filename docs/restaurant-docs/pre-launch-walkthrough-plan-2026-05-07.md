# Pre-Launch Walkthrough Plan — Restaurant — 2026-05-07

A live, end-to-end verification pass against production (`https://sanopos.com`) with Playwright + manual checks. Restaurant-vertical equivalent of the retail walkthrough plan ([docs/retail-docs/pre-launch-walkthrough-plan-2026-04-27.md](../retail-docs/pre-launch-walkthrough-plan-2026-04-27.md)).

Goal: catch what tests don't — UX breaks, layout issues, hidden gaps, "button does nothing" failures, real-world integration issues. Specifically restaurant flavors: floor plans, KDS, pay-at-table, kiosks, modifiers, reservations, day-parting, void/comp, tips.

This is **not** an automated test suite. It's a guided walkthrough where the script (Playwright) drives the obvious clicks, pauses for CAPTCHA / email verification, and the operator (you) watches for anomalies. Findings get logged to [findings-WIP.md](findings-WIP.md) inline.

## Scope

This walkthrough covers **`industry_type=restaurant`** (and a smaller cafe variant pass at the end — see Phase 7 cafe parity). Other mode-gated features (Appointments, Service Tickets, Projects/Contracts, Rentals, Rooms, Clinical) are explicitly **out of scope** (see "Out of Scope" section at the bottom). Super-admin panel walkthrough is out of scope for the merchant launch.

## Why This Exists

Code tests verify correctness. Click-throughs verify experience. Specifically catches:

- Screen-size / layout breakage (POS list-mode on mobile? KDS on a kitchen tablet?)
- "Button does nothing" — fire course, bump ticket, settle pay-at-table
- Loading states that never resolve (KDS polling stuck)
- Empty-state pages that look broken (KDS with zero stations / Reservations on day 1)
- Missing CTAs (no "+ Floor Plan" on a fresh tenant?)
- Onboarding gotchas (where do I configure modifiers? Why is my fire-to-KDS doing nothing?)
- Cross-feature flow breaks (Pay-at-Table completes but doesn't show in Sales History)
- Hidden/broken integrations (clicking "Mint kiosk" → blank modal)

## Prerequisites

Source-of-truth references this plan was derived from:
- [discovery-2026-05-07.md](discovery-2026-05-07.md) — full read-only code investigation; primary input
- [findings-WIP.md](findings-WIP.md) — active scratch log of bugs (B1, B2, I1 already fixed; P1–P10 polish open; B1.5 deferred)
- [../retail-docs/pre-launch-walkthrough-plan-2026-04-27.md](../retail-docs/pre-launch-walkthrough-plan-2026-04-27.md) — retail plan structure

Operator decisions before starting:
- [ ] Test tenant: **`sanoposlivetest1778021564659`** already exists on production (Phase 0 healed it; see findings-WIP healing log)
- [ ] Test inbox: `sano9942uae@hotmail.com` (already wired)
- [ ] Browser mode: headed (recommended for first run) vs headless
- [ ] Time budget: ~4-5 hours total, split across multiple sittings
- [ ] Cafe parity pass deferred to Phase 7 — separate fresh signup

## Known Blockers and Their Workarounds

| Blocker | Workaround |
|---|---|
| Turnstile CAPTCHA on signup (PR 9) | Test tenant already exists from Phase 0 — login flow only. If you sign up another tenant for cafe parity (Phase 7), pause script for manual solve. |
| Email verification (PR 8) | Already verified for `sanoposlivetest1778021564659`. New cafe signup will need it. |
| Sandbox payment gateway | `PAYMENT_GATEWAY=sandbox` is the current Railway setting. Pay-at-table uses sandbox; not real charges. |
| Restaurant-specific worker env vars | `COURSE_RELEASE_WORKER_ENABLED`, `RESERVATION_REMINDER_WORKER_ENABLED`, `KDS_SNAPSHOT_WORKER_ENABLED` may not be set on Railway — features will appear silently broken. Verify Railway env in Phase 5. |
| Real production data | Test tenant writes to real Supabase, sends real Resend emails, uses real R2 bucket. **DO NOT delete the test tenant** — it's the durable equivalent of `livetest1` for restaurant. |
| Tax mode = none | Test tenant declined GST registration → `tax_mode=none`. Some tax-related UI hidden. Acceptable for restaurant launch test. |

## Phase Plan

| Phase | Time | Outcome |
|---|---|---|
| 1. Login + dashboard | ~10 min | Logged in, dashboard verified, role text confirmed (I1), restaurant nav section visible |
| 2. Sidebar walkthrough | ~45-60 min | All ~70 nav items clicked, screenshots captured, restaurant items confirmed working post-B1 |
| 3. End-to-end restaurant flows | ~90-120 min | 12 cross-feature flows verified |
| 4. Public surfaces | ~20-30 min | 7 customer-facing surfaces verified |
| 5. Worker-driven flows | ~20-30 min | Restaurant workers (course-release, reservation-reminder, kds-snapshot) confirmed running on Railway |
| 6. Edge cases | ~30-45 min | Mobile/dark-mode/offline/permissions/cross-tenant + restaurant-specific stress tests |
| 7. Cafe parity pass | ~30-45 min | Fresh cafe signup; verify divergence (no floor plan widget, "Customer" not "Guest", different onboarding steps) |
| 8. Pre-launch decisions | varies | Operational readiness questions answered |
| 9. Cleanup / finalize | ~10 min | Delete cafe test tenant; **preserve** `sanoposlivetest1778021564659` |

---

## Phase 1 — Login + Dashboard

Acceptance: logged in as Test Owner, on the dashboard, restaurant nav section visible, role text fixed (I1), profile dropdown shows "Administrator".

- [ ] Navigate to `https://sanopos.com`
- [ ] Verify landing page renders (hero, features, pricing, login)
- [ ] Click "Sign In"
- [ ] Fill: store code `sanoposlivetest1778021564659`, name `Test Owner`, password `TestPass564659!`
- [ ] Land on `/context-select` (or dashboard)
- [ ] If context picker, select Main Store
- [ ] Land on dashboard

Verify on dashboard:
- [ ] KPI cards render (revenue likely 0; that's fine)
- [ ] Sidebar shows **Restaurant section** (Floor Plan, Checks, 86'd Items, Modifiers, Menu Schedules, Reservations, Waitlist, Online Inbox, Void/Comp Reasons, KDS, Tip Pools, Order Kiosks)
- [ ] Profile dropdown identifies role: should say **"Administrator"** (NOT "Cashier" — verifies I1 fix `2a322eb` is live)
- [ ] POS labels say "Menu Item" / "Guest" / "Order" (per restaurant preset, not retail's "Product" / "Customer" / "Sale")
- [ ] FBR prompt banner visible (PK + tax_mode=none + fbr_integration ON — see P9 — does it pester or sit quiet?)
- [ ] Onboarding checklist (if rendered): should show restaurant steps `["store","menu_item","floor_plan","shift","order"]`, NOT retail's 7-step list (verifies P4)
- [ ] Subscription banner: Free plan, no trial countdown
- [ ] Take screenshot: `restaurant-walkthrough-phase1-dashboard.png`

Findings to log:
- Login latency (auto-login from setup vs explicit credential login)
- Sidebar rendering on different viewports (1440 desktop, 820 tablet, 390 mobile)
- Whether profile dropdown shows Administrator (I1 verification) or Cashier (regression)
- Onboarding checklist content match restaurant preset (P4)

---

## Phase 2 — Sidebar Walkthrough

Acceptance: all ~70 nav items have been clicked, page loads verified, primary CTAs tested, screenshots captured at desktop+tablet+mobile.

For each item below: click → verify URL changes → wait for load → check console.errors → check network 4xx/5xx → take screenshots → try primary CTA (open form/modal) → close → log finding (only if anomalous; clean items get a single ✅).

Items pre-flagged with **🆕** are the routes that B1 just unblocked — these are highest-attention checks. If any of these still 500, that's either Railway hasn't redeployed yet OR a new bug at the same surface — verify table existence via Supabase before filing.

### Overview
- [ ] Dashboard — see Phase 1; just confirm it still loads cleanly here

### Restaurant section (12 items — discovery §2.1)
- [ ] **Floor Plan** (`/restaurant/floor`) — empty state on day 1; "+ Floor Plan" CTA opens form. After creating a plan, verify table-add CTA works
- [ ] **Checks** (`/restaurant/checks`) — empty state; once a check is opened in Phase 3, verify list populates with 10s polling
- [ ] **🆕 86'd Items** (`/restaurant/availability`) — should load. List of products with sold-out toggle. Should NOT 500 (B1)
- [ ] **Modifiers** (`/restaurant/modifiers`) — empty list; "+ Group" opens form
- [ ] **🆕 Menu Schedules** (`/restaurant/menu-schedules`) — should load. 7-col × 24-row weekly grid + editor. Should NOT 500 (B1)
- [ ] **🆕 Reservations** (`/restaurant/reservations`) — should load. Date picker + reservation list. Should NOT 500 (B1)
- [ ] **🆕 Waitlist** (`/restaurant/waitlist`) — should load. Empty state. Should NOT 500 (B1)
- [ ] **Online Inbox** (`/restaurant/inbox`) — empty state acceptable (P3 — verify it renders cleanly, not as a 500)
- [ ] **🆕 Void/Comp Reasons** (`/restaurant/void-reasons`) — should load with 10 seed reasons (Phase 0 heal seeded them). Should NOT 500 (B1)
- [ ] **KDS** (`/kds`) — 3-tab (tickets / routes / stations). Empty state; "+ Station" opens form
- [ ] **Tip Pools** (`/tips`) — 3-tab (pools / rules / payouts). Empty state
- [ ] **Order Kiosks** (`/order-kiosks`) — list view; "+ Counter Slot" / "+ Table Token" CTAs

### Reports — restaurant-specific (deep links; no sidebar entry per discovery §2.1 missing nav)
- [ ] **Menu Engineering** (`/reports/menu-engineering`) — likely empty data on a fresh tenant; page should render
- [ ] **KDS Analytics** (`/reports/kds-analytics`) — page should render; empty data acceptable

### Cross-cutting items ON for restaurant per `RESTAURANT_SEED_FLAGS`
- [ ] **Loyalty Tiers** (`/loyalty/tiers`) — pre-seeded tiers visible (Bronze/Silver/Gold/Platinum)
- [ ] **Gift Cards** (`/gift-cards`) — "+ Issue gift card" opens form
- [ ] **Marketing → Campaigns** (`/campaigns`) — "+ Campaign" form
- [ ] **Inbox** (`/messages`) — empty state, thread list
- [ ] **Fulfillment** (`/fulfillment`) — empty state, no errors
- [ ] **Courier Settings** (`/settings/couriers`) — 13 pre-seeded couriers visible
- [ ] **COD Settlements** (`/cod-settlements`) — empty state
- [ ] **SMS Providers** (probably under Integrations or Setup) — `phase5_sms_providers` ON; UI should expose provider config (inert until creds)
- [ ] **Retail Risk** (`/insights/risk` or similar) — `phase2g_risk_controls` ON

### Commerce / Catalog / Inventory (cross-vertical; should still render for restaurant)
- [ ] **POS** (new tab) — see Phase 3.1 for full POS test; just verify the tab opens here
- [ ] **Orders** — empty state
- [ ] **Parked Sales** — empty state
- [ ] **Customers** — empty state, "+ Customer" opens form
- [ ] **Customer Groups** — "+ Group" opens form
- [ ] **Returns** — search bar visible, look-up flow works
- [ ] **Sales History** — empty state, date filter works
- [ ] **Cash Management** — open shift CTA visible (you'll open one in Phase 3)
- [ ] **Products** — 5 sample menu items render: Caesar Salad, Garlic Bread, Iced Tea, Chocolate Cake, Grilled Chicken. "+ Product" opens form
- [ ] **Categories** — 4 seed categories: Appetizers, Main Course, Beverages, Desserts. Tree view, drag-drop works
- [ ] **Brands** — empty state, "+ Brand" works
- [ ] **Taxes** — `tax_mode=none` so probably hidden or empty; verify
- [ ] **Attribute Sets** — "+ Set" works
- [ ] **Promotions** — "+ Promotion" form
- [ ] **Price Lists** — "+ List" form
- [ ] **Smart Collections** — flag OFF; should be hidden or stubbed
- [ ] **Scheduled Changes** — flag OFF; hidden or stubbed
- [ ] **Inventory Audit / Stock Adjustments / Transfers / Returned Stock** — pages render; restaurants don't typically use these but UI should not break
- [ ] **Reorder Alerts / Intelligence** — `phase2g_inventory_intelligence` is OFF for restaurant; pages should be hidden

### Procurement
- [ ] **Suppliers** — "+ Supplier" form (food suppliers — useful for restaurants)
- [ ] **Purchase Orders** — "+ PO" opens form
- [ ] **Supplier Returns** — empty state
- [ ] **Expenses** — "+ Expense" form
- [ ] **Approvals** — `approvals` flag default OFF; should be hidden or empty

### Insights
- [ ] **Reports** — orchestrator with ~20 sub-tabs; restaurant-specific (Menu Engineering, KDS Analytics) reachable via tabs
- [ ] **Report Builder** — flag OFF by default; hidden or stubbed
- [ ] **Accounting / Chart of Accounts / Journal Entries / Credit/Debit Notes / Post-Dated Cheques** — `accounting_core` flag default state; verify

### Operations
- [ ] **Kiosk** (new tab) — employee clock-in PIN entry
- [ ] **CRM** — empty state
- [ ] **Quotations** — flag OFF; hidden
- [ ] **Attendance** — empty state, clock-in log empty
- [ ] **HR** — empty state
- [ ] **Scheduling** — flag default state
- [ ] **Notifications** — inbox renders, unread count

### Setup
- [ ] **Employees** — list shows Test Owner; "+ Employee" form (role, PIN, password)
- [ ] **Outlets** — Main Store visible; "+ Outlet" blocked on Free
- [ ] **Company Profile** — wizard data populated; tax stance shows "Not registered" (tax_mode=none)
- [ ] **Integrations** — providers visible
- [ ] **Barcode Templates** — "+ Template" form (ghost flag P2 from retail; flag is on or off — verify)
- [ ] **Receipt Templates** — "+ Template" form, v2 designer renders
- [ ] **Printer Settings** — "+ Printer" form, test print button (this matters for restaurants — KDS station printers)
- [ ] **Import Data** — 5 tabs (products/customers/suppliers/expenses/payments), file picker works
- [ ] **Backup & Restore** — "Trigger backup" CTA, history list

### Compliance
- [ ] **FBR Settings** — country=PK + `fbr_integration` ON, but tax_mode=none. Page should render without aggressively prompting (P9)
- [ ] **FBR Invoices** — appears only if FBR config completed
- [ ] **Tax Lookup** — search bar; flag default state

### Admin / Account
- [ ] **Action History** — empty state, date filter
- [ ] **Billing** — Free plan card visible, upgrade card shows monthly/annual/quarterly toggle
- [ ] **My Tickets** — empty state
- [ ] **Profile** — confirm role text "Administrator" (I1 verification, again)

Findings format per item (in [findings-WIP.md](findings-WIP.md), append as Wn):
- ✅ works as expected → no entry needed (only log anomalies)
- 🟡 minor (cosmetic, missing label, awkward UX, but functional) → file as Wn 🔵 Polish
- 🔴 broken (white screen, 500 error, click does nothing, modal won't close) → file as Wn 🔴 Blocker

---

## Phase 3 — End-to-End Restaurant Flows

These are cross-feature flows that exercise multiple subsystems. Bugs here are usually integration bugs, not UI bugs. Discovery §7 enumerates 12 flows; this phase verifies each one runs end-to-end.

For each flow, log: ✅ pass / 🟡 partial / 🔴 broken, screenshot of final state, any console/network errors.

### 3.1 Floor plan → table session → check → fire → KDS → bump → settle (cash)
- [ ] **Floor Plan** → "+ Floor Plan" → name "Main Floor" → save
- [ ] Add 4 tables: T1, T2, T3, T4
- [ ] Tap T1 → "Open table session" → guest count 2 → confirm
- [ ] Verify: `restaurant_table_sessions` row created (check via Supabase MCP)
- [ ] **Checks** → table T1 should now show an open check
- [ ] Add 1× Caesar Salad + 1× Iced Tea to the check
- [ ] Tag the salad as course "Appetizer" and the tea as "Drinks" (if UI supports)
- [ ] Click "Fire course → Appetizer" — verify ticket appears on KDS
- [ ] **KDS** → bump the appetizer ticket → status flips to bumped
- [ ] Cash settle the check → verify sale completes
- [ ] **Sales History** — sale appears with correct subtotal
- [ ] **Reports → Sales Summary** — revenue includes the sale
- [ ] **Floor Plan** — table T1 should show "dirty" status post-settle (if the dirty CHECK widening from B1 is plumbed in UI)

### 3.2 Walk-in tab → modifiers → split bill by seat → tip pool
- [ ] POS → "Open Tab" → tab name "John W"
- [ ] Add 2× Grilled Chicken with modifiers (e.g. spicy, no salad — if a modifier group is configured; if not, this becomes "configure modifiers first" prerequisite — note as a Phase 2 finding)
- [ ] Assign first chicken to seat 1, second to seat 2 (if seat-picker exists)
- [ ] Click "Split bill by seat" → verify 2 separate checks
- [ ] Cashier closes both checks separately, captures tip on each
- [ ] **Tip Pools** → open a pool, distribute by chosen rule, generate payouts
- [ ] Verify `tip_captures` rows linked to the pool
- [ ] Verify `tip_pool_payouts` rows generated

### 3.3 Reservation → seat → order → settle
- [ ] **Reservations** → "+ New reservation" → guest "Walk-in Test", date today, time +30min, party 2 → save
- [ ] Verify: `reservations` table row exists (B1 — table now exists; verify via Supabase)
- [ ] Wait for reservation time (or change reservation time to "now")
- [ ] Click "Seat" on the reservation → pick T2 → confirm
- [ ] Verify: table session opens for T2 with linked reservation
- [ ] Add items, fire, settle (standard flow as 3.1)

### 3.4 Online inbox → accept → fire → handoff
- [ ] **Order Kiosks** → mint a counter slot → copy the public URL
- [ ] Open the URL in a new browser tab → menu renders → add 1× Iced Tea → submit order
- [ ] Verify: order arrives in **Online Inbox**
- [ ] Click "Accept" → service should create a draft order + fire to KDS
- [ ] **KDS** → ticket appears
- [ ] Bump → verify ticket flips to bumped
- [ ] Settle the draft order via POS or Checks page

### 3.5 Counter Order Kiosk (today's commit `86c99f5` Order Kiosks feature)
- [ ] **Order Kiosks** → list shows the counter slot from 3.4
- [ ] Mint a fresh counter slot
- [ ] Open the public URL in incognito → menu renders, no auth prompt
- [ ] Add items → submit
- [ ] Verify: slot's `current_draft_order_id` rotated (next URL hit gets a fresh draft)
- [ ] Verify: web_orders row created with `source='kiosk'`

### 3.6 Table Order Kiosk
- [ ] **Order Kiosks** → "+ Table Token" → pick table T3 → mint
- [ ] Open the table URL in incognito → menu renders
- [ ] Add 1× Garlic Bread + 1× Caesar Salad → submit (NOT to inbox; submit attaches to existing dine_in draft)
- [ ] Verify: open draft on T3 has the items
- [ ] **Checks** → confirm the check on T3 reflects the diner's order
- [ ] Server fires from Checks → standard flow

### 3.7 QR menu (read-only browse)
- [ ] Open the same `/menu/:token?tenant=<slug>` URL — confirm menu items render
- [ ] Verify 86'd items hidden (test by 86ing one item via 3.9 first, then refresh kiosk URL)
- [ ] Verify pricing matches what the staff sees

### 3.8 Day-parting: lunch / dinner schedules
- [ ] **Menu Schedules** → "+ Schedule" → name "Lunch", time 11:00–15:00, days mon-sun → save
- [ ] Pin Iced Tea + Garlic Bread to the lunch schedule
- [ ] **Order Kiosks** → mint a counter slot → open kiosk URL → if outside lunch window, verify pinned items hidden; inside window, verify visible
- [ ] If currently outside the window: change schedule to current time +1 hour buffer; re-test
- [ ] Verify P7 behavior: products NOT pinned to any schedule remain always-available

### 3.9 86'd item
- [ ] **86'd Items** → toggle Iced Tea to sold out → reason "Walkthrough test", until end of day
- [ ] Verify: POS hides Iced Tea (or shows greyed with badge)
- [ ] Verify: kiosk URL hides Iced Tea
- [ ] Verify: QR menu hides Iced Tea
- [ ] Try to add Iced Tea to a check via API hack → should 422 with `is_sold_out`
- [ ] Try to mint a Pay-at-Table session for a check containing a now-86'd item → should refuse
- [ ] Un-86 → verify item returns to all surfaces

### 3.10 Comp/void with manager PIN
- [ ] POS → ring up 1× Chocolate Cake on a check
- [ ] Try to comp the line → modal asks for manager PIN
- [ ] Enter wrong PIN → reject
- [ ] Enter correct PIN (1234) → accept; comp recorded in `sale_item_adjustments`
- [ ] Settle the check → verify comp shows on receipt; sales total reflects comp
- [ ] **Audit trail** — `GET /api/restaurant/adjustments?sale_id=...` should show the comp row

### 3.11 Tip capture → pool → distribute → payout
- [ ] Make 3 cash sales with tips (varying amounts)
- [ ] **Tip Pools** → "+ Pool" for today → close at end of shift
- [ ] Distribute by chosen rule (e.g. evenly across servers, or by hours-worked)
- [ ] Verify: `tip_pool_payouts` rows generated per server
- [ ] Verify: payouts visible in Tip Pools UI

### 3.12 Menu engineering
- [ ] After several sales, **Reports → Menu Engineering** should categorize items
- [ ] If KDS_SNAPSHOT_WORKER_ENABLED is set and worker has run, KDS Analytics should also populate
- [ ] If neither populates, that's a worker-env or prep-time-data issue (Phase 5)

### Cross-flow concerns to verify (discovery §7 cross-flow)
- [ ] **Sale stock decrement for menu items** — verify whether `routes/sales.js` decrements `outlet_stock` on restaurant-mode sales. After 3.1, check Caesar Salad stock — should it have decremented from 100 → 99? File as finding either way.
- [ ] **Tax mode = none + FBR flag ON** (P9) — does the FBR flow attempt to fire on a sale despite tax_mode=none? Should not. Verify `fbr_invoices` queue stays empty.
- [ ] **Public menu tenant resolution** (discovery §7) — manually type `/menu/<token>` (no `?tenant=`) and verify it returns a clear 4xx, not a stack trace

---

## Phase 4 — Public Surfaces

Acceptance: 7 customer-facing surfaces walked end-to-end. Each verifies tenant slug resolution + auth model + happy path.

- [ ] **`/menu/:token` (counter mode)** — open URL minted in 3.5; browse → cart → submit → confirm landing page
- [ ] **`/menu/:token` (table mode)** — open URL from 3.6; verify only "Send to server" CTA (no final submit)
- [ ] **`/pay/:token`** — settle pay-at-table on a check from 3.1; complete sandbox checkout; webhook should land
- [ ] **`/reserve/:slug`** — open in incognito; pick date, view 30-min slots, submit a reservation; verify it lands in `reservations` table
- [ ] **`/receipt/:invoiceNumber`** — copy invoice from a 3.1 sale; open in incognito; verify receipt + tax breakdown render
- [ ] **`/portal/:tenantSlug`** — sign up a customer, verify portal tabs are restaurant-flavored: Orders, Loyalty, Profile (no Invoices per `PORTAL_ENABLED_TABS_BY_PRESET.restaurant`)
- [ ] **Customer storefront** (`/store/:slug`) — `general_retail` storefront; restaurants have it but feels weird (P5 observation). Verify it doesn't 500 at minimum.

Findings to log:
- Tenant slug presence in URLs (P6 — manually-typed `/menu/<token>` without `?tenant=` should fail gracefully)
- Mobile-viewport layout of all customer-facing pages
- Empty states (e.g. `/reserve/<slug>` on a day with no slots)

---

## Phase 5 — Worker-Driven Flows

Verify restaurant-specific workers are running on Railway. Use `mcp__claude_ai_Supabase__execute_sql` for direct DB checks; confirm Railway env vars via `railway variables` if accessible.

### Worker checklist (discovery §6)

| Worker | Env var | Verification |
|---|---|---|
| `course-release-worker-boss.js` | `COURSE_RELEASE_WORKER_ENABLED` | Hold a course in 3.1 → 30s wait → verify it auto-fires (released course writes `restaurant_course_fires.status='fired'`) |
| `reservation-reminder-worker-boss.js` | `RESERVATION_REMINDER_WORKER_ENABLED` | Reservation from 3.3 should get an SMS reminder T-2h before; if SMS provider not configured, expect silent skip |
| `kds-load-snapshot-worker-boss.js` | `KDS_SNAPSHOT_WORKER_ENABLED` | After 3.1's KDS bump, verify `kds_station_load_snapshots` has rows. If table empty after 24h, worker likely not enabled |
| `retail-digest-worker-boss.js` | `RETAIL_DIGEST_WORKER_ENABLED` | `retail_weekly_digest` flag is ON for restaurant. Wait until next Monday 08:00 UTC; verify email receipt; OR file as deferred |

### Admin worker status
- [ ] **`/admin/dashboard` Worker Status panel** (super-admin) — verify all restaurant workers show `lastPollAt` updating
- [ ] If a worker shows "stopped": is it env-disabled (Railway) or actually crashed (Sentry)?

### Notes
- Workers running on `setInterval` (not pg-boss) lose state on Railway restart and may show "stopped" 0–24h post-deploy — file as a finding only if it's been >24h since last deploy.
- Discovery §6 explicitly flagged 4 env vars to verify; if any are unset, file a finding.

---

## Phase 6 — Edge Cases

Real-world conditions that catch unique bugs.

### 6.1 Mobile Safari pass
- [ ] Open `https://sanopos.com` on iPhone Safari (or Chrome DevTools iOS emulation)
- [ ] Login → cookies/localStorage work
- [ ] Sidebar mobile drawer opens, restaurant section accessible
- [ ] POS — list-mode layout (not grid) renders correctly on mobile
- [ ] Floor Plan — touch interactions work (tap to open session)
- [ ] KDS — readable on a small screen
- [ ] PWA install prompt fires (or doesn't on iOS — by design)

### 6.2 Dark mode
- [ ] Profile dropdown → toggle dark mode
- [ ] Walk through Restaurant section pages → verify all respect theme
- [ ] POS specifically uses hardcoded colors per CLAUDE.md (verify if KDS / Floor Plan match)
- [ ] Public pages (kiosk, QR menu, public reservation, public receipt) — do they switch?

### 6.3 Offline POS (restaurant variant)
- [ ] POS open → DevTools → offline mode
- [ ] Try to open a check or fire a course offline → expected behavior?
- [ ] Reconnect → verify any queued changes sync

### 6.4 Session expired
- [ ] POS open → manually expire JWT in DevTools or wait
- [ ] Click any restaurant action → POSSessionExpiredModal should appear
- [ ] PIN re-auth → pending action retries

### 6.5 Permission roles — Manager-role restaurant access (B2 verification)
- [ ] **Employees** → "+ Employee" → name "Test Manager", role Manager, PIN 5555, password
- [ ] Logout → log in as Test Manager
- [ ] Verify Manager can: open checks, fire course, bump KDS, run void/comp, distribute tips
- [ ] Verify Manager **cannot** delete a void reason (`PATCH /api/restaurant/void-reasons/:id` requires `all_access`)
- [ ] Verify Manager perms count: 21 in DB (Phase 0 healed; B2 fix `0212ccc` deployed)

### 6.6 Cashier-role restaurant access
- [ ] Create Cashier-role employee
- [ ] Log in as Cashier — verify NO access to restaurant routes (cashier doesn't get `manage_restaurant`)
- [ ] Cashier should still see: POS + Customers + Returns + Sales History + basic reports

### 6.7 Cross-tenant isolation
- [ ] If a `livetest1` retail tenant still exists, verify restaurant tenant cannot see retail data and vice versa
- [ ] Try direct URL manipulation — does it leak?

### 6.8 KDS stress test
- [ ] Fire 10 tickets simultaneously → verify KDS handles them (no race conditions, all visible)
- [ ] Bump out of order → verify analytics still aggregate correctly
- [ ] Recall a bumped ticket → verify it returns to "new" state

### 6.9 Pay-at-Table edge cases
- [ ] Mint a payment session, then 86 an item from that check → next payment session attempt should refuse (`pay-at-table.js:57-67`)
- [ ] Open two payment sessions on the same check (should it block? or allow split-pay?)
- [ ] Diner abandons `/pay/:token` mid-flow → session expires per webhook timeout
- [ ] Network drop mid-payment — graceful recovery?

### 6.10 Day-parting boundary conditions
- [ ] Schedule active 11:00–15:00 — at exactly 11:00 first second, item should appear
- [ ] At 14:59:59, item should still appear; at 15:00:00, item disappears
- [ ] No schedule → item always appears (P7 — verify behavior matches expectation)

### 6.11 Timezone correctness on restaurant flows
- [ ] Restaurant tenant timezone is `Asia/Karachi`
- [ ] Make a sale → verify receipt shows local PK time
- [ ] Sales History dates show local timezone
- [ ] KDS ticket timestamps — local or UTC?
- [ ] Day-parting schedules — should be evaluated in tenant timezone, NOT UTC

### 6.12 Onboarding checklist (P4)
- [ ] Verify checklist actually surfaces restaurant-specific steps: store ✅, menu_item ✅, floor_plan ✅, shift ✅, order ✅
- [ ] Each "done" detection works: completing 3.1 should tick off menu_item, floor_plan, shift, order
- [ ] Action button URLs correct (e.g. floor_plan → `/restaurant/floor`)

### 6.13 Audit-flagged inconsistencies
Test gating leaks from discovery §8.2:
- [ ] **P2 — `routes/modifiers.js` and `routes/tips.js` lack `requireMode`**: manually flip `phase4_restaurant` ON for `livetest1` (retail) via admin → verify modifiers/tips routes activate without `tenant_modes.restaurant`. Document if reproducible.
- [ ] **P10 — Role 1 name mismatch**: confirm role 1 is named "Admin" (provisioner won), but profile dropdown shows "Administrator" (post-I1 fix on text column). Cosmetic; file as observation.

---

## Phase 7 — Cafe Parity Pass

Cafe is functionally a restaurant (same `mode: ["restaurant"]`, same flags) but with three documented UI differences (P5):
- `dashboard_widgets.floor_plan = false` (no floor view on cafe dashboard)
- `labels.customer = "Customer"` (NOT "Guest")
- `onboarding_steps` includes `employees` instead of `floor_plan`

### Steps
- [ ] Sign up a fresh tenant: pick **Cafe / Quick Service** in wizard, slug e.g. `cafetest1` (any slug)
- [ ] Complete signup + email verify + setup
- [ ] Log in to the new cafe tenant
- [ ] **Dashboard** — confirm NO floor plan widget tile
- [ ] **POS / Checks / etc.** — confirm labels say "Customer" not "Guest"
- [ ] **Onboarding checklist** — confirm `employees` step appears, NOT `floor_plan`
- [ ] **Sample products** — should be Hot Drinks / Cold Drinks / Bakery categories with espresso, cappuccino, iced latte, croissant, sandwich (NOT restaurant's appetizer/main/dessert)
- [ ] All 23 flags should match restaurant (cafe seeds same `RESTAURANT_SEED_FLAGS` per `setup.js:279`)
- [ ] **Cleanup**: delete this cafe tenant after Phase 7 (it's a one-time parity test, not a permanent test tenant)

---

## Phase 8 — Pre-Launch Operational Decisions

Not click-throughs — operational questions to answer before launch.

### 8.1 Browser compatibility
- [ ] Chrome desktop ✅ (assumed tested)
- [ ] Mobile Safari (iOS) — done in 6.1
- [ ] Android Chrome — verify on a kitchen tablet
- [ ] Edge desktop
- [ ] Firefox (low priority unless customer demands)

### 8.2 Sentry hookup verification
- [ ] Trigger intentional error from a restaurant route (e.g. POST to `/api/restaurant/checks/999/fire-course` for non-existent check)
- [ ] Verify error appears in Sentry within ~30s
- [ ] Verify tenant slug + employee context tagged

### 8.3 R2 image upload + display (menu items)
- [ ] Upload an image for Caesar Salad
- [ ] Verify renders on: product list, POS, kiosk, QR menu, public receipt
- [ ] If `R2_PUBLIC_URL` unset, image proxies through Railway — confirm acceptable load time

### 8.4 Email deliverability (restaurant flows)
- [ ] Welcome email (already received during signup)
- [ ] Reservation confirmation email (if implemented; SMS is the documented channel)
- [ ] Receipt email (`/api/email/send-receipt-v2`)
- [ ] Tip pool payout notification — does this exist?
- [ ] Any email landing in spam → DNS/SPF/DKIM review

### 8.5 SMS provider for reservations
- [ ] `phase5_sms_providers` is ON, but no provider configured for the test tenant
- [ ] Decision: launch without SMS reminders (silent skip), or wire a provider before launch?
- [ ] If wiring: which one (Twilio, Zong, Jazz)? Confirm cost-per-SMS.

### 8.6 Payment gateway decision (restaurant pay-at-table)
- [ ] Pay-at-table requires `PAYMENT_GATEWAY=sandbox|xpay`
- [ ] Currently `sandbox` on Railway. For real restaurant launch, decide:
  - Decision A: launch without pay-at-table; merchants settle via POS only — disable `phase4_restaurant_pay_at_table` flag
  - Decision B: wire xPay live, enable real pay-at-table
  - Decision C: keep sandbox for soft launch (5-10 friendly testers)

### 8.7 Backup/restore actually works
- [ ] Trigger backup → verify R2 file exists for the restaurant tenant
- [ ] Restore to a different test tenant slug → verify restaurant data integrity (floor plans, KDS stations, modifier groups, etc.)

### 8.8 Worker monitoring — restaurant workers in `/api/admin/worker-status`
- [ ] All 4 restaurant workers show `lastPollAt` updating (or env-disabled with note)
- [ ] No stuck queue depths

### 8.9 Rate limit smoke
- [ ] `publicRestaurantLimiter` on `/api/public/restaurant/*` — blast 121 requests in <60s, verify 429
- [ ] Pay-at-Table public endpoint rate limited via `webhookLimiter`

### 8.10 Restaurant-specific receipt templates
- [ ] Default receipt template renders correctly for restaurant sales (with seat numbers, course tags?)
- [ ] If restaurant needs a custom template, decide whether to ship a default or punt to merchants

### 8.11 KDS hardware setup documentation
- [ ] Is there documentation for setting up a kitchen tablet with KDS open in always-on mode?
- [ ] Network printer config for kitchen chits (`phase4_restaurant_fire_chits`) — documented?

### 8.12 Decisions to commit before launch
- [ ] Performance baseline — Lighthouse scores for POS / KDS / kiosk pages? Yes/No: ___
- [ ] Pay-at-Table launch decision (Phase 8.6): A/B/C
- [ ] SMS provider decision (Phase 8.5)
- [ ] Cafe presets parity sign-off
- [ ] FBR + tax_mode=none combination behavior (P9): is it acceptable that FBR Settings is visible even though merchant declined GST? Or hide it?

---

## Phase 9 — Cleanup

- [ ] Cafe test tenant from Phase 7 — delete via `/admin/tenants` (cascade-drops schema)
- [ ] **DO NOT** delete `sanoposlivetest1778021564659` — it's the durable equivalent of `livetest1` for restaurant
- [ ] Verify orphan-schema-scan worker cleans up cafe schema (or run manual `/api/admin/orphaned-schemas/cleanup`)
- [ ] Verify Resend has stopped sending emails to deleted cafe slug
- [ ] Final commit of `findings-WIP.md` covering all walkthrough phases

---

## Findings Log

Date started: 2026-05-07
Operator: Hassan (sanomerchandise@gmail.com)
Tenant slug used: `sanoposlivetest1778021564659` (industry=restaurant, country=PK, plan=Free)
Test inbox: sano9942uae@hotmail.com
Admin user: name `Test Owner`, password `TestPass564659!`, PIN `1234`
Plan: Free (1 outlet / 3 employees / 100 products caps)

### Resume instructions (for next sitting)

To pick up wherever you left off:

1. Log in at `https://sanopos.com/login`:
   - Store Code: `sanoposlivetest1778021564659`
   - Username: `Test Owner`
   - Password: `TestPass564659!`
2. Land on dashboard
3. Open `findings-WIP.md` — last walkthrough session log entry tells you which Phase + step you stopped at
4. **Cleanup at the very end (Phase 9)**: super-admin → `/admin/tenants` → delete the Phase-7 cafe tenant (not the restaurant one)

### State of `sanoposlivetest1778021564659` at walkthrough start (post-Phase-0)

Per [findings-WIP.md healing log](findings-WIP.md):
- Schema_version 85, all 9 missing tables created (B1 healed)
- Manager role: 21 perms (B2 healed)
- Owner employee: `role='Administrator'` (I1 healed)
- 5 sample menu items × 100 stock each
- 4 categories: Appetizers, Main Course, Beverages, Desserts
- 1 outlet: Main Store
- No shifts opened yet
- 23 feature flags ON (13 restaurant mode + 10 RESTAURANT_SEED_FLAGS) + `fbr_integration` from PK country pack

### Phase progress tracker

Update this table as phases close. Pattern: `✅ closed YYYY-MM-DD` or `🔄 in progress` or empty.

| Phase | Status | Date | Findings filed |
|---|---|---|---|
| 1. Login + dashboard | ✅ closed | 2026-05-07 | W3 (sidebar flicker, polish) — ✅ FIXED in 119a466 |
| 2. Sidebar walkthrough | ✅ closed | 2026-05-08 | Morning: W1✅ (119a466+8f5c9ba), W2✅ (119a466), W4✅ (auto with W1). Afternoon resume: W8✅ (next push) Order Kiosks React #310, W9✅ (next push) backend snake_case typo, W10✅ (next push) sidebar/breadcrumb label drift |
| 3. End-to-end flows | 🔄 in progress (4 of 12 closed) | 2026-05-08 | Flow 3.1 ✅ closed. Flow 3.2 ✅ closed (split + tip pool). Flow 3.3 ✅ closed (W25 `51e4b14`). Flow 3.4 ✅ closed (counter kiosk → /menu/:token → 1× Iced Tea → /restaurant/inbox `kioskK-17` → Accept → draft #19 + KDS ticket #12 `[external] kiosk #K-17` → bump → Pay-this-check rehydrate → INV-2026-00008 Rs 300). 0 findings filed in 3.4 — full pipeline worked first try. |
| 4. Public surfaces | | | |
| 5. Worker-driven flows | | | |
| 6. Edge cases | | | |
| 7. Cafe parity pass | | | |
| 8. Pre-launch decisions | | | |
| 9. Cleanup | | | |

**Pause reason (2026-05-07):** Phase 2 hit 2 independent 🔴 blockers in the first 5 Restaurant routes. Per the sitting's stop-rule (3+ blockers in Phase 2), pause until W1 + W2 ship and resume from `/restaurant/modifiers`. See `findings-WIP.md` Walkthrough Session Log entry 2026-05-07 for full detail.

**Unpause (2026-05-07):** Both blockers fixed and live-verified — `119a466` (W1+W2+W3+W4) + `8f5c9ba` (W7 retry that unblocks W1's auto-seed code path). Next sitting can resume Phase 2 from `/restaurant/modifiers` with confidence the Restaurant section is fully walkable.

**Phase 2 sweep close-out (2026-05-08):** All ~60 sidebar items walked. 1 🔴 (W8 Order Kiosks React #310 — same hook-order bug as W2 in a sibling file the W2 fix didn't audit), 1 🟡 (W9 backend snake_case typo on `req.context?.outlet_id` in 6 sites — masked because frontend usually passes `?outlet_id=` query, surfaced via POS Restaurant initial floor-plan fetch), 1 🔵 (W10 sidebar Customers vs page heading Guests label drift). Stop-rule didn't fire (1 blocker < 3). Phase 2 will be fully closed once W8 ships. Phase 3 can begin in parallel.

**Phase 3 flow 3.2 pause (2026-05-07 evening):** Walked seat → 2-seat cart (W20 fixed) → split-by-seat (W21 fixed). Stop-rule fired at step 5 with 3 🔴 blockers: W22 (`/restaurant/checks` Close-check button calls non-existent PUT route → 404), W23 (no UI path to pay split-children — POS context stays on parent draft), W24 (tips silently dropped at sale settlement: frontend sends `tip_method:"Cash"` capitalised, DB CHECK requires lowercase). 7 findings filed total this sitting (W18-W24); 2 fixed live (W20 `5978622`, W21 `870fa0e`). Sitting closed. Next sitting should fix W24 first (smallest unblock for the most critical data-correctness bug), then W22, then W23, then resume flow 3.2 from step 5.

**Phase 3 fix-it loop (2026-05-07 late evening):** Followed the recommended order. Shipped **W24 ✅ `29e540c`** (tip_method normalisation + backend validation + Sentry alert + 6-case unit test) and live-verified via `INV-2026-00004` Rs 1,200 + 15% tip → `tip_captures.id=2 tip_method='cash' tip_amount=180.00`. Then **W22 ✅ `4c65ec3`** (PUT /checks/:id route + Zod schema + frontend sends `cancelled`) live-verified via draft #9 close → `200 OK`, DB shows status='cancelled'. Then **W23 🔄 `1301f2b` + `a7cb54c`** (Pay button on /restaurant/checks + resumeCheck handler in POSRestaurantRedesign + cart-rehydrate patch from draft items). W23 partial verify only — Pay button rendered, click navigated to POS check view, but cart was empty. Patched `a7cb54c` to fetch GET /api/draft-orders/:id and seed cart; verification of that patch deferred. Sitting closed by user. Next sitting picks up: verify `a7cb54c` rehydrate, settle 2 split children with tips, run /tips pool flow, close 3.2 fully (Phase 3 = 2 of 12).

---

## Out of Scope

The following are deliberately excluded from this walkthrough — confirmed out of scope for restaurant launch. Do not pad the walkthrough with them; they should be revisited in their own dedicated walkthrough when those modes/features ship.

| Area | Why out of scope |
|---|---|
| Retail-only nav items (Holds & Layaway, Inventory Intelligence, Smart Collections, Scheduled Changes, Item Suggestions, Receipt Barcode Lookup) | Flags OFF for restaurant by design — confirmed in `RESTAURANT_SEED_FLAGS` exclusions |
| Appointments / Bookings nav group | Mode-gated; non-restaurant |
| Service Tickets nav group | Mode-gated; non-restaurant |
| Projects & Contracts nav group | Mode-gated; non-restaurant |
| Rentals nav group | Mode-gated; non-restaurant |
| Rooms (hotel/lodging) nav group | Mode-gated; non-restaurant |
| Clinical (Treatment Plans, Lab Orders) nav group | Mode-gated; non-restaurant |
| Subscriptions nav | Mode-gated (`requiredMode: subscriptions`) — restaurant doesn't have it |
| Commissions nav | Mode-gated (`requiredMode: commissions`) — surfaces in salon preset only |
| Mode-gated workers for non-restaurant verticals (rental-overdue, room-overdue, treatment-plan, booking-reminder) | Don't run for restaurant tenants |
| Super-admin panel walkthrough (10 admin pages) | Internal team surface, separate auth, not part of merchant launch |
| Marketplace background sync (Daraz, Meta, WhatsApp, Google Merchant) | Stubbed; "manual sync only" disclaimer is the launch story |
| Multi-day offline POS | Best-effort by design |
| AI Insights chat (`/api/insights/ask`) | Per `project-ai-deferred` memory — AI expansion deferred |
| Schema drift in `treatment_plan_templates`, `outlets` geofence cols, `leave_requests` partial-day cols, `company_profile` v77 cols | Filed as B1.5 in `findings-WIP.md`; deferred to a focused schema-sync session |

---

## Refresh Triggers

Refresh / re-run this walkthrough when:

- New restaurant-launch PR ships
- Major nav change in `nav-config.js` for the Restaurant section
- New flag added to `MODE_REGISTRY.restaurant` or `RESTAURANT_SEED_FLAGS`
- Any Phase 8 decision changes (payment gateway swap, SMS provider wired, FBR behavior change)
- Quarterly cadence as a "is anything still wired up?" check
- Before onboarding the first paying restaurant tenant
