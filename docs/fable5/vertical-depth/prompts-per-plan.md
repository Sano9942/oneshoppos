# MASTER EXECUTION CHECKLIST — follow top to bottom, one session per step

> **This is the only file you need to follow.** Every prompt is inlined and in final order — wiring, foundations, the reskin gate, vertical depth, growth. Open a fresh session, pick the model shown, paste the prompt, let it run, answer its pause-points, mark the step done, move to the next.
>
> **How to use (5 rules):**
> 1. **One step = one fresh session.** Use the model + effort in the step header.
> 2. **Strictly in order** is always safe. (Steps marked ⚡ *may* run in parallel with their neighbors if you want speed — skip parallelism if unsure.)
> 3. Every step **pauses for your approval** on schema migrations and named decision points — a step isn't done until you've answered its pauses and its verifier passed.
> 4. Git in every step: named branch, logical commits, push at end, **no PR** unless a prompt says otherwise.
> 5. When a session ends, have it tick its row in the tracker table at the bottom of this file.

---

## STEP 0 — Production health baseline · **any model (Sonnet fine)**

```
Run /check-services and report. Fix nothing — this is the baseline before a long execution program starts.
```

---

# PART A — RESCUE + WIRING (Steps 1–7)

## STEP 1 — 🚨 Commit the plan-01 fixes + close its open items · **Fable, effort high** — DO THIS FIRST

```
Effort: high.

Close out completion plan 01 (docs/fable5/completion/plans/01-cross-surface.md). It was EXECUTED on 2026-07-04 but its fixes are sitting UNCOMMITTED in the working tree of branch redesign/square. Read that plan, docs/fable5/completion/completion-spec.md, and the memory file cross_surface_traps_plan01 first.

STEP 1 — rescue the work (before anything else):
- Inspect git status/diff. The working tree mixes (a) plan-01 backend fixes (modified backend routes/services + untracked backend/services/tax-snapshot.js), (b) unrelated redesign/square frontend work (modified pages under frontend/src/pages/redesign/ etc.), and (c) new docs (docs/fable5/completion/, docs/fable5/vertical-depth/).
- Separate them: create branch fix/cross-surface-plan01 off main; bring ONLY the plan-01 backend fixes + tax-snapshot.js onto it (verify each file's diff belongs to plan 01 before including it — don't guess); commit in logical increments; push the branch. Leave the redesign frontend changes untouched on redesign/square; commit the docs/ folders on redesign/square or a docs branch (your call, state it).
- Run the backend test suite locally (.env.test) on the fix branch before pushing. Then merge fix/cross-surface-plan01 into main after showing me the final diff summary and getting my OK.

STEP 2 — finish plan 01's two OPEN items:
1. Pricing fork: services/quote.js:evaluatePromotions is missing slab_percent, brand scope, ORDER BY priority; price-list precedence inverted vs POS; field-rep UI uses base price. Unify onto one shared pricing/promo resolution (extend routes/promotions.js logic into a shared service the way tax-snapshot.js was extracted). Verify same customer+product+qty prices identically on POS, storefront quote, portal reorder, field-rep.
2. Folio-tax: rentals/rooms/treatment folios have NO tax linkage (rental_items, room rates, session fees). Produce the concrete proposal (schema columns + resolution chain through services/tax-snapshot.js + backfill stance) and STOP for my approval — do NOT apply. This decision gates Steps 18/19/20 later.

Pause-list: any schema/migration application, tax-chain changes beyond wiring the existing snapshot module, auth. No PR.
Verify: fresh-context verifier re-runs the plan-01 seam checks (pricing consistency across the 4 surfaces) on the wholesale test tenant (memory: wholesale_test_tenant).
Report: outcome first — what got committed where, pricing-fork result, the folio-tax proposal awaiting my decision.
```

## STEP 2 ⚡ — Wiring: core spine (completion 00) · **Opus, effort high**

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/00-core-spine.md. It was generated and approved. Read that file plus docs/fable5/completion/completion-spec.md for the rules before touching anything.

Scope this run to: the 2 P0 fixes + the full core-spine verification walkthrough + any wiring defects that walkthrough surfaces. DEFER all 8 P1 feature gaps — do not build them; list them back to me for a per-item decision.

THE TWO P0 FIXES (decisions already made — apply them):
1. AI insights chat is dead (ai_insights flag exists only in insights-ai.js + DashboardRedesign.jsx, never seeded). Add ai_insights: false to DEFAULT_FEATURE_FLAGS (middleware/feature-flags.js) so it becomes reachable and toggleable in the admin flags editor, default OFF. Confirm ANTHROPIC_API_KEY is set on Railway (report if you can't verify).
2. Three Reports→Inventory tabs 403 + duplicate stock-aging route. Delete the shadowing GATED stock-aging duplicate (reports/inventory.js:737 path, registered via reports/index.js:21) so the ungated Wave-3 stock-aging implementation (stock-aging.js:12, registered at reports/index.js:33) actually serves. For the two genuinely-premium tabs (stockout-risk, replenishment-smart), gate them CLIENT-SIDE in Reports.jsx on reports_inventory_health_plus so they don't render as 403-ing tabs.

THE VERIFICATION WALKTHROUGH (the bulk of the value): walk every row of the plan's checklist live on a general_retail test tenant — login → context → POS sale (cash + card + discount + park/retrieve) → return → product CRUD + variants → bulk import → adjustment/transfer → stock count → PO→GRN→payable → customer + loyalty + wallet → employees/roles/PIN re-auth → shift open/close z-report → EVERY report tab returns 200 → accounting reconcile → customer invoice AR → quotation→invoice convert → notifications → receipt email + public URL → setup wizard → action history. Fix any P0-class wiring defect you find (dead route, contract mismatch, wrong verb/path) the same way — pinpoint, then fix.

Also confirm the plan's "Confirm during execution" items: currency-401 fix actually deployed (dashboards show Rs not $), GET /api/sales list shape consumed by SalesHistoryRedesign, draft-orders 403 risk on non-retail presets, PLAN_LIMIT_REACHED modal path.

Cross-surface lens: for shared concerns (tax, stock, promotions, receipts) verify the POS path only — Plan 01 owns the full multi-surface diff. The v83 tax chain is PAUSE-LIST: verify only, don't change.

Scope: this plan only, P0 + verification. Schema change / new migration / auth-middleware change → STOP (pause-list). No adjacent refactors, no P1 builds.
Git: branch fix/completion-00 off main; commit logically; push; no PR. Local tests use .env.test. Don't write to production.
Verify: fresh-context verifier re-runs the walkthrough and confirms both P0s fixed + every checklist row passes live.
Close-out: update the plan register status + append any non-obvious wiring defect pattern to memory.
Report: outcome first — both P0 results, checklist pass/fail, the deferred P1 list, anything I must act on — then details.
```

## STEP 3 ⚡ — Wiring: restaurant (completion 02) · **Opus, effort high**

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/02-restaurant.md (generated + approved). Read it plus docs/fable5/completion/completion-spec.md first.

Scope: the 2 P0 fixes + the full restaurant verification walkthrough + any wiring defects it surfaces. DEFER both P1 gaps (bar-tab pre-auth, 3rd-party delivery) — they're owned by later depth plans (F04 / V03); just note them.

THE TWO P0 FIXES (apply — decisions obvious):
1. KDS station printer dropdown always empty: KdsStationSettingsModal.jsx:34 calls GET /api/printer-config which doesn't exist. Change it to GET /api/print/config (printer.js:123) and map the response shape.
2. Void/comp reason admin edits 404: VoidReasonsAdminRedesign.jsx:48 uses api.put on /api/restaurant/void-reasons/:id but the backend only registers app.patch (restaurant/void-comp.js:48). Switch to the PATCH pattern the same file already uses at lines 56/75.

VERIFICATION WALKTHROUGH: floor plan → open table → order w/ modifiers (min/max/price_delta) → send to kitchen → KDS bump/recall → fire course → split by seat (totals incl. tax sum to original) → void one line w/ manager-PIN + reason → tip pool distribute → pay-at-table → QR public menu shows an 86'd item gone → kiosk order lands in inbox/KDS → reservation from public page. Fix any P0-class defect found the same way.

Confirm-during-execution items: whether phase4_restaurant_fire_chits/_seats/_drive_thru gate any live surface (report dead flags, don't delete yet — V03 owns the drive-thru decision); restaurant order→stock decrement semantics are intentional; pay-at-table graceful when PAYMENT_GATEWAY unset.

Cross-surface lens: 86/menu-schedule availability identical on POS + QR menu + kiosk + inbox; tips→commission_earnings no double-count; split/comp receipts via shared utils/receipt.js. v83 tax chain PAUSE-LIST — verify only, report drift.

Scope discipline: schema/migration/auth → STOP. No P1 builds, no refactors.
Git: branch fix/completion-02 off main; commit; push; no PR. Local tests .env.test.
Verify: fresh-context verifier re-runs the walkthrough on the restaurant test tenant (memory: restaurant_test_tenant; cafe_test_tenant for counter mode).
Close-out: register + memory. Report: outcome first.
```

## STEP 4 ⚡ — Wiring: appointments + commissions (completion 03) · **Opus, effort high**

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/03-appointments-commissions.md (generated + approved). Read it plus completion-spec.md first.

0 confirmed P0s. Scope: verify the appointments + commissions spine live, resolve the Confirm-during-execution items, and TRIAGE (don't blind-fix) the booking-reminder SMS behavior. DEFER all 5 P1 gaps (no-show fees, class/group booking, prepaid packages, intake forms, calendar sync) — those are ALL owned by later depth plans (F04, F06, F02, F03, F06 respectively); just confirm and list.

Booking-reminder SMS: the plan flags that SMS is silently skipped but marked 'sent' — pre-documented behavior guarded by a unit test. Investigate whether it's intentional or a real bug BEFORE changing anything; REPORT the verdict, don't fix (Step 8 / F05 owns the fix and will read your verdict).

Confirm-during-execution: is utils/ics.js actually attached to booking confirmation emails or a dead util? booking-overlap check under concurrent public bookings (REPORT the race verdict — Step 9 / F06 owns the fix); gym "Class Bookings" portal label renders; commission earning behavior on returns/voids.

VERIFICATION on a fresh salon tenant (walks both modes): create service+staff → public booking as customer → reminder enqueued → reschedule → checkout at POS with staff commission attribution → earning approved → payroll (tier4/hr.js) picks it up → portal shows appointment history. Run the preset-skin checklist for salon/clinic + the booking surfaces of gym/photography/dental/vet/physio.

Cross-surface lens: cancellation from admin calendar / public page / portal must free the slot everywhere; one commission earning → one payout. Tax on service checkout: verify, report drift, don't re-fix.

Scope discipline: schema/migration/auth → STOP. No P1 builds this run.
Git: branch fix/completion-03 off main; commit; push; no PR. Local tests .env.test.
Verify: fresh-context verifier re-runs the salon walkthrough.
Close-out: register + memory. Report: outcome first — booking↔commission↔payroll chain proven? SMS verdict? overlap-race verdict? deferred P1 list.
```

## STEP 5 ⚡ — Wiring: wholesale (completion 04) · **Opus, effort high**

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/04-wholesale.md (generated + approved). Read it plus docs/fable5/completion/completion-spec.md first.

This plan found ZERO defects from code — your job is to PROVE it connects live, not to invent fixes. Walk the plan's full verification checklist on the wholesale test tenant (memory: wholesale_test_tenant); a row only counts done when it passes live with evidence. If the walkthrough surfaces a real P0-class wiring defect (dead route, contract mismatch, wrong verb/path, a flag-gated visible surface that 403s), pinpoint it to file:line and fix it — otherwise change nothing.

Also resolve the plan's "Confirm during execution" items (the real risk surface). Do P2 polish ONLY if cheap and directly adjacent. DEFER any P1 gaps — backorders/van-sales/POD are owned by depth plan V02 (Step 24); just list them.

Cross-surface lens per the plan; the deep tax/stock/pricing diff is owned by Plan 01 — confirm this vertical's paths match; report drift, don't re-fix.

Scope discipline: schema/migration/auth → STOP. No speculative refactors.
Git: branch fix/completion-04 off main; commit; push; no PR. Local tests .env.test.
Verify: fresh-context verifier re-runs the walkthrough.
Close-out: register + memory. Report: outcome first — provably connected end-to-end? any defect found?
```

## STEP 6 ⚡ — Wiring: growth surface P0-only (completion 11) · **Opus, effort high**

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/11-growth-surface.md (generated + approved). Read it plus completion-spec.md first.

Scope THIS run to: the 1 P0 + verification of the existing growth wiring. DEFER all 8 P1 build gaps (website builder, marketing automations, payment links, Google reviews, wallet passes, abandoned-cart, AI cataloging, receipt feedback) — they run AFTER the reskin as the final step of the whole program; just list them back.

THE P0 (decision baked in): marketplace background sync is decorative — marketplace-sync-worker-boss.js:63,69,107 log/heartbeat but never call DarazClient/MetaCommerceClient/GoogleMerchantClient. First, via read-only Supabase, check whether ANY live tenant actually has marketplace credentials configured. If none/negligible: do NOT build polling — make it honest (stop scheduling the dead jobs or label the hub + admin worker-status "manual sync only"). If real tenants depend on it: wire the three client calls inside withTenantContext() — backend only. Report which path and why.

Also log the comparison-doc correction the plan found: "Product reviews ❌" is wrong (full pipeline exists — products.js:1584-1735, storefront.js:254-328). Fix that row in docs/research/sanopos-vs-square-comparison.md; add Google-Reviews-collection as the real ❌ row.

VERIFICATION of existing surface: storefront browse→cart→checkout→order-in-inbox; review submit→moderate→display; email campaign to a 2-customer audience delivers; existing invoice payment-link paid via SanoPay sandbox (memory: sanopay_sandbox); integrations hub connect/disconnect round-trip (note /test is DB-only — label honestly).

Cross-surface lens: campaign bursts share email_queue/SMS adapters with transactional sends (check queue priority — report, F05 in Step 8 implements the priority hint); payment links share gateway webhook routing with billing/rooms/treatments. Stock/tax on storefront: verify, report drift.

Scope discipline: webhook signature verification (Meta/WhatsApp/Daraz) is security-adjacent → PROPOSE, don't implement. Schema/migration/auth → STOP. No P1 builds.
Git: branch fix/completion-11 off main; commit; push; no PR. Local tests .env.test.
Verify: fresh-context verifier re-runs the storefront + campaign + payment-link walkthrough.
Close-out: register + comparison doc + memory. Report: outcome first — which P0 path, pass/fail, deferred P1 list.
```

## STEP 7 — Wiring: treatment plans (completion 08) · **Opus, effort high** — after Step 4

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/08-treatment-plans.md (generated + approved). Read it plus completion-spec.md first. Run AFTER completion plan 03 (shared appointments availability engine — it ran as Step 4).

0 confirmed P0s. Scope: verify the clinical stack live + resolve Confirm-during-execution items. The one P1 (generic intake forms) is owned by depth plan F03 (Step 12) — confirm the gap, don't build it.

Confirm-during-execution: treatment_plan_templates schema parity between a fresh-provisioned tenant and a migrated one (known v46 schema-pg.sql drift — memory: followup_b15_schema_drift). If a migration is needed to fix drift, REPORT it with the exact DDL — don't apply (Step 19 / V05 sequences its migrations after this verdict). Session checkout at POS write path + tax chain (report drift). Deposit capture-on-settle behavior when a plan is cancelled mid-way (refund path).

VERIFICATION on a fresh dental_clinic tenant (spot-check veterinary pet-subject flow): patient → template→plan → chart marks → session via calendar → lab order → consent → deposit pre-auth → complete sessions → settle (nets deposit) → portal shows progress → clinical report tabs 200. Preset-skin checklist for dental/vet/physio.

Cross-surface lens: sessions vs bookings must not double-book a provider slot; folio/settle tax is the Step-1 folio-tax item; portal shows only own subject (vet portal must not leak other owners' pets).

Scope discipline: schema/migration/auth → STOP. Git: branch fix/completion-08 off main; commit; push; no PR.
Verify: fresh-context verifier re-runs the dental walkthrough.
Close-out: register + memory. Report: outcome first — clinical stack connected? schema drift verdict + DDL if any?
```

---

# PART B — FOUNDATION ENGINES (Steps 8–14)

## STEP 8 — F05 Customer notifications · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/F05-customer-notification-engine.md. Read it + docs/fable5/completion/completion-spec.md (its rules apply) before touching anything. Git: branch feat/f05-notifications off main; commit logically; push at end; no PR.

Order: schema first — show me the final migration diff (the plan has the DDL) and STOP for approval before applying. Then the engine (customer-notify.js + sms-templates.js, non-throwing contract), settings routes, and the FIRST CONSUMER: repair-ticket status notifications (this closes the repair vertical's notifications P0 — plan task 4).

The SMS-reminder fix (plan task 5): Step 4's session (completion 03) triaged the "SMS marked sent but never sent" behavior — read its verdict in the register/memory before changing booking-reminders.js, then route SMS through the engine and update the guarding unit test deliberately.

Do the plan's P1 consumer wiring (rental/room/appointment events) only if time allows; P0 + repair + SMS fix + settings UI is the bar. Implement the transactional-vs-campaign queue priority hint (don't build plan-11's queue work).

Pause-list: migration application, anything auth.
Verify: fresh-context verifier walks the plan's verification bar on a fresh repair_shop tenant with an SMS provider configured, including the failure-injection case.
Close-out: tick this step in the tracker + memory. Report: outcome first — engine live? repair notifications firing? SMS reminders now truthful?
```

## STEP 9 — F06 Scheduling activation · **Fable, effort high**

```
Effort: high (concurrency-critical: booking races + a revenue-attribution column four verticals will sit on).

Execute docs/fable5/vertical-depth/plans/F06-scheduling-engine-activation.md. Read it + completion-spec.md + Step 4's results (completion 03 verified the appointments engine you're extending and delivered the overlap-race verdict). Git: branch feat/f06-scheduling off main for backend; commit; push; no PR. Build the timetable/calendar UI minimally off main for now — the full-polish pass happens after the reskin merges (the reskin gate is Step 15); note any screens that will want re-checking post-merge.

Order: schema deltas (plan has the DDL — the 7 dead tables already exist, you're adding columns) → STOP for migration approval → the concurrency contract (advisory-lock fix for createAppointment/rescheduleAppointment + the locked class-booking service fn) → classes CRUD + 3 booking entry paths through ONE service fn → appointment→POS checkout link → timetable UI → then P1 waitlist/resources/segments.

Decision point: calendar sync = ship the per-employee ICS feed + DELETE the dead phase4_google_calendar_sync flag (plan task 10) — propose in your report, don't silently do it.

Pause-list: migration application, auth.
Verify: fresh-context verifier runs the plan's verification bar (fresh gym + fresh salon) INCLUDING the scripted parallel-booking races — exactly one winner each, on local PG.
Close-out: tracker + memory. Report: outcome first — dead schema now live? checkout link + commission attribution working? race provably fixed?
```

## STEP 10 — F02 Packages + billing hardening · **Opus, effort high** — after Step 9

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/F02-packages-passes-membership-billing.md. Read it + completion-spec.md first. Git: branch feat/f02-packages off main; commit; push; no PR.

Apply the feedback_audit_ledger_before_building rule: the credit balance is a ledger — write the reconciliation test (credits_used = Σ unreversed redemptions) BEFORE the UI, and copy the gift-card FOR UPDATE redemption shape exactly (routes/gift-cards.js:331-370).

Order: schema (STOP for migration approval) → entity + sell-at-POS + redeem/reverse with locking → portal tab → THEN the two billing hardening fixes: dunning worker (sandbox gateway, retry 1/3/7 days, auto-pause, notify via F05) and calendar-month computeNextPeriod (unit tests for month-end anchors; existing next_renewal_at values untouched).

Pause-list: migration application.
Verify: fresh-context verifier runs the plan's bar on a fresh gym tenant incl. the parallel-redeem race and the sandbox dunning sequence (memory: sanopay_sandbox).
Close-out: tracker + memory. Report: outcome first — pack loop working? dunning live? billing drift fixed? ledger reconciles?
```

## STEP 11 ⚡ — F04 Deposit engine · **Fable, effort high** — parallel-safe with Steps 9–10

```
Effort: high (live money paths + webhook routing).

Execute docs/fable5/vertical-depth/plans/F04-deposits-preauth-noshow.md. Read it + completion-spec.md first. Git: branch feat/f04-deposits off main; commit; push; no PR.

HARD GATE, in order: (1) extract services/deposit-engine.js with rooms + treatments re-implemented as adapters — ZERO behavior change, proven by existing tests + a live sandbox walkthrough of both BEFORE any new consumer. (2) The webhook dispatch change in routes/webhooks.js is security-adjacent: produce the diff + the payment_intents registry design and STOP for my approval before wiring. (3) Then the new consumers: rental pre-auth, appointment card-on-file no-show fees, ticket gateway deposits. (4) The hardening items are first-class scope: orphaned-hold sweep, cancel-releases-hold on every terminal status, double-capture idempotency, isEnabled() gating on every new button.

Pause-list: migration application, the webhook change (above), anything auth.
Verify: fresh-context verifier runs the plan's bar (fresh car_rental + fresh salon, sandbox gateway) incl. webhook replay and the gateway-off tenant check.
Close-out: tracker + memory. Report: outcome first — extraction behavior-identical? which consumers live? what needs my webhook approval?
```

## STEP 12 ⚡ — F03 Form builder · **Opus, effort high** — parallel-safe

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/F03-form-builder.md. Read it + completion-spec.md first. Git: branch feat/f03-forms off main; commit; push; no PR. Builder UI + portal tab: build functional off main; polish pass rides the post-reskin state (note screens to re-check).

Order: schema (STOP for migration approval) → routes + the three fill paths converging on ONE submit handler (portal / public token / staff — divergence here is the feedback_parallel_paths failure mode) → signature reuse from the consent flow → builder UI + shared FormResponsesPanel → auto-attach helper with the appointment example wired.

Before reusing the consent machinery, run the plan's hardening check: does consent_forms snapshot template text at sign time or reference the live template? If live-referenced, fix it with the same snapshot pattern (in scope) and tell me — it's a legal-exposure bug.

Public-token rules are non-negotiable: single-use, ≥128-bit random, 404 on bad token, no PII leakage.

Pause-list: migration application.
Verify: fresh-context verifier runs the plan's bar (fresh gym + dental spot-check) incl. template-edit-doesn't-mutate-old-responses and the expired-token 404.
Close-out: tracker + memory. Report: outcome first — builder + 3 fill paths live? consent-snapshot verdict?
```

## STEP 13 — F01 Kit/BOM engine · **Fable, effort xhigh** — after Step 1 merged

```
Effort: xhigh (every sales write path, under concurrency).

Execute docs/fable5/vertical-depth/plans/F01-kit-bom-engine.md. Read it + completion-spec.md + the cross_surface_traps_plan01 memory (trap 5 is your map of the non-POS sales writers) first. Requires Step 1's branch merged (tax-snapshot.js must be in main) — verify before starting. Git: branch feat/f01-kit-bom off main; commit; push; no PR.

Order: schema (STOP for migration approval) → component CRUD with cycle rejection → kit decrement inside the sales.js FOR UPDATE block with stable lock ordering → kit availability on POS + storefront (components reserved, not the kit) → production/disassembly runs → THEN the P0 hardening gate: every non-POS sales writer (holds settle, pay-at-table, quotation convert, storefront) either gets kit expansion or hard-rejects kits with a clear error — no silent third state. Then P1 costing (plate cost, theoretical-vs-actual) and combos via modifier groups.

Pause-list: migration application; do NOT silently fix quotation-convert's missing FOR UPDATE — coordinate with the Step-1/completion-01 notes; flag it in your report.
Verify: fresh-context verifier runs the plan's bar (fresh sweet_shop + restaurant test tenant) incl. the parallel last-kit race and the zero-component-kit rejection.
Close-out: tracker + memory. Report: outcome first — engine live on which paths, which paths reject kits, costing report reconciles?
```

## STEP 14 — F07 Batch/expiry/lot · **Fable, effort xhigh** — after Step 13

```
Effort: xhigh (the most dangerous cross-surface change in the program — every stock decrement path).

Execute docs/fable5/vertical-depth/plans/F07-batch-expiry-lot-engine.md. Read it + completion-spec.md + cross_surface_traps_plan01 first. Run AFTER F01 is merged (same code region in routes/sales.js) — verify before starting. Git: branch feat/f07-batches off main; commit; push; no PR.

The plan's P0 hardening gate is the law: before wiring consumeBatches into any decrement path, that path's base decrement must be correct — fix or explicitly exclude + document (coordinate with completion-01's notes on quotation-convert / pay-at-table). The invariant (Σ batch.remaining_qty = outlet_stock.quantity for tracked products) gets an integration test per wired path, and the drift-check report ships with v1.

Order: schema (STOP for migration approval) → GRN capture → consumeBatches choke point → path-by-path wiring with tests (sales → storefront → returns → transfers-preserving-identity → adjustments) → expiry worker + expiring-soon page → P1 rolls + POS batch pick.

Pause-list: migration application.
Verify: fresh-context verifier runs the plan's bar (fresh grocery + textile) incl. the FEFO-split sale, transfer-preserves-expiry, the parallel batch-drain race, and the untracked-product regression walkthrough.
Close-out: tracker + memory. Report: outcome first — invariant holds across which paths, anything excluded and why.
```

---

# PART C — 🚧 THE RESKIN GATE (Step 15) — finish this COMPLETELY before Step 16

> **Why here:** Steps 16–25 build heavy net-new UI (repair intake, gym timetable + check-in kiosk, hotel booking engine, salon history panels). If the Square reskin isn't merged first, all of that gets built in the old design and must be re-skinned a second time. **Do not start Step 16 until 15e is done.**
>
> The reskin has its own authoritative spec: `docs/fable5/redesign-spec.md` (phases, tokens, guardrails). These prompts drive its remaining phases. State so far: Phase 1 (foundation + dashboard) done; Phase 2 (back-office rollout) partially done — catalog, inventory, procurement, customers, finance clusters are committed on `redesign/square`.

## STEP 15a — Finish Phase 2: remaining back-office clusters · **Opus, effort high** — REPEAT this prompt in fresh sessions until Phase 2 is complete

```
Effort: high.

Continue the Square redesign on branch redesign/square. Read docs/fable5/redesign-spec.md top-to-bottom first — its locked decisions and §6 guardrails are law (frontend-only; no backend/schema/API changes; no behavior changes; light-only; commit+push redesign/square only, no PR, never touch main).

You are in Phase 2 (back-office rollout). Already tokenized (see git log on this branch): dashboard reference page, catalog, inventory, procurement+fulfillment, customers, finance clusters. 

First, derive the remaining Phase-2 work: list every *Redesign.jsx page + report/dashboard module NOT yet covered by the redesign commits (diff the cluster commits against pages/redesign/, pages/reports/, pages/dashboard/). Then tokenize the NEXT 1–2 logical clusters this session, following the exact per-cluster pattern of the previous commits (tokens + primitives + toolbar/drawer patterns + empty states; one commit per cluster, message style "redesign(<cluster>): tokenize …").

Beware the PS 5.1 encoding trap (memory: ps51_encoding_trap): never batch-edit source via PowerShell Get-Content/-replace — it mojibakes non-ASCII.

Verify per cluster with a fresh-context verifier subagent + Playwright walkthrough on the local squaretest tenant (memory: square_redesign_phase1 — squaretest / Administrator / 1234). Push so Vercel builds the branch preview.

Report: outcome first — which clusters done this session, the remaining-cluster list (so I know how many more sessions Phase 2 needs), preview link.
```

## STEP 15b — Phase 3: POS reskin · **Fable, effort xhigh** — after 15a fully done

```
Effort: xhigh (offline-critical surface, ~60 files with hardcoded colors).

Continue the Square redesign on branch redesign/square — Phase 3 (POS) per docs/fable5/redesign-spec.md §5. Read the spec first; §6 guardrails are law.

Replace visuals only across frontend/src/pages/redesign/POSRedesign.jsx + pos/ (~60 files): swap hardcoded colors for the new tokens, pill/flat styling, keep it fast and touch-friendly. DO NOT alter: the offline queue (utils/offlineQueue.js), checkout/api.raw status handling, keyboard shortcuts (F1–F10/Esc), receipt logic, cartMath. Byte-for-byte behavior-identical.

Verify: fresh-context verifier runs a full POS walkthrough on squaretest (sale cash+card, discount, park/retrieve, return/exchange, weighted item, variant picker, shortcuts overlay, receipt print/email) AND the offline flow (kill network → queue sale → restore → replay). Commit per logical chunk; push for the Vercel preview.

Report: outcome first — POS reskinned, offline verified, preview link.
```

## STEP 15c — Phase 4: Admin panel reskin · **Opus, effort high**

```
Effort: high.

Continue the Square redesign on branch redesign/square — Phase 4 (admin panel) per docs/fable5/redesign-spec.md §5. Read the spec first; guardrails are law.

Apply the design system to pages/admin/ (AdminLogin, AdminLayout, AdminDashboard, AdminTenantList/Detail, AdminActivity, AdminEmails, AdminSupportTickets, AdminDeadLetters, AdminTaxRates). Uses adminFetch + separate auth — presentation only, don't touch the auth stores.

Verify: fresh-context verifier walks the admin panel live (login → tenant list → tenant detail incl. billing section → activity → support → dead letters). Commit; push.
Report: outcome first + preview link.
```

## STEP 15d — Phase 5: Public + portals reskin · **Opus, effort high**

```
Effort: high.

Continue the Square redesign on branch redesign/square — Phase 5 (public + portals) per docs/fable5/redesign-spec.md §5. Read the spec first; guardrails are law.

Reskin: LandingPage, login/signup, reset-password, public receipt page, public booking page, QR menu/pay pages, customer portal (pages/portal/), manufacturer portal, storefront, field-rep PWA pages, kiosk + customer display. These have their own layouts/auth — reskin to match; don't merge their auth into the tenant scope. Keep the manufacturer portal visually distinct enough (it currently uses an indigo theme — adapt it to the new system, decide + state how).

Verify: fresh-context verifier walks each public surface live (portal login as a customer, storefront checkout, public booking, receipt URL, kiosk). Commit; push.
Report: outcome first — all public surfaces reskinned, preview links, anything that should be re-checked on mobile viewports.
```

## STEP 15e — 🔀 MERGE the reskin into main · **Opus, effort high** — the gate itself

```
Effort: high.

The Square redesign (branch redesign/square) is complete and I have approved the look. The redesign-spec's "never merge to main" rule is now superseded by this instruction: prepare and execute the merge of redesign/square into main.

Pre-merge checklist, in order:
1. Rebase or merge main INTO redesign/square first (main has moved: Steps 1–14 merged backend branches + docs). Resolve conflicts — expect them in frontend files the foundation steps touched minimally; backend conflicts should be near-zero (redesign never touched backend — verify with git diff main...redesign/square -- backend/ and flag ANY backend diff to me before proceeding).
2. Full verification on the merged branch: frontend unit tests, backend test suite (.env.test), and a fresh-context verifier Playwright pass over the core walkthrough (login → dashboard → POS sale incl. offline → reports → a foundation feature from Steps 8–14, e.g. a class booking + a package redemption) on squaretest.
3. Show me: the diffstat, any backend diffs (should be none), test results, and the preview link. STOP for my final go/no-go.
4. On my GO: merge to main, push, tag v-square-redesign-merged. Confirm the Vercel production deployment builds and the live smoke test passes (memory: shop_health_monitoring walkthrough or frontend/tests smoke subset).
5. Report deployment health; if production breaks, revert the merge commit immediately and report.

Do not delete the redesign/square branch.
```

---

# PART D — VERTICAL DEPTH (Steps 16–25) — only after Step 15e

> Net-new UI in these steps is now built directly in the merged Square design system on branches off `main`.

## STEP 16 — V06 Repair-shop depth (absorbs completion 05) · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V06-repair-shop-depth.md. Read it + docs/fable5/completion/completion-spec.md first, and confirm its foundation deps are merged: F05 (hard), F03 (soft — use it for per-repair-type checklists if merged, else the plan's ticket_types fallback). Git: branch feat/v06-repair-depth off main; commit; push; no PR.

PRE-FLIGHT (absorbed wiring plan): first walk docs/fable5/completion/plans/05-workflow-tickets.md's verification checklist live on a fresh repair_shop tenant (SMS provider configured) — prove the existing ticket spine connects before extending it. Fix any P0-class wiring defect it surfaces; report shared-concern drift rather than re-fixing completion-01 territory.

THEN execute the depth plan: P0s first (device intake schema → STOP for migration approval → intake flow + IMEI/serial history; parts-on-ticket schema → STOP → stock-semantics + itemized invoice rewrite; verify F05's repair notifications live), then P1 (estimates via quotations, custom statuses migration → STOP, warranty), then P2 (claim label) if cheap. The HARDEN section is first-class: verify current deposit-netting behavior BEFORE the invoice rewrite; activity-log coverage on all new mutations.

Decision point: device passcode storage — propose plaintext vs services/crypto.js encrypted (recommend crypto.js), STOP for my choice before building that field.

Pause-list: migrations, auth. Cross-surface lens per plan (parts = a NEW stock writer — FOR UPDATE + restock paths tested).
Verify: fresh-context verifier runs the plan's full verification bar (the RepairDesk demo walkthrough) incl. empty/error states.
Close-out: tick tracker (this step + completion 05) + memory. Report: outcome first — is repair now demo-able vs RepairDesk?
```

## STEP 17 — V07 Gym depth (absorbs completion 10) · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V07-gym-depth.md. Read it + completion-spec.md first; confirm F06 + F02 merged (hard deps), F03 for waivers. Git: branch feat/v07-gym-depth off main; commit; push; no PR.

PRE-FLIGHT (absorbed): walk docs/fable5/completion/plans/10-subscriptions.md's checklist live on a fresh gym tenant (sandbox gateway) first — prove membership billing connects. Fix P0-class wiring defects; report drift.

THEN the depth plan: P0 member check-in (schema → STOP for migration approval → lookup/check-in endpoints following the kiosk public-POST pattern from cross_surface_traps_plan01 traps 3+4 → check-in kiosk UI → front-desk widget), then P1 consumption: timetable (F06) with gym vocabulary + portal/public booking, dunning verified live at the door (status endpoint surfaces last-charge-failed), packs (F02) at check-in, waivers (F03) with unsigned flag, waitlist (F06). HARDEN items first-class: status truth derivation, member_code randomness + minimal public response, frozen-vs-expired mapping.

Pause-list: migrations, auth (the public kiosk path gets extra scrutiny — both allowlist layers verified).
Verify: fresh-context verifier runs the plan's bar (the Glofox demo) incl. the abuse checks (enumeration rate-limit, no PII).
Close-out: tracker (this step + completion 10) + memory. Report: outcome first — is a class-based studio now viable?
```

## STEP 18 — V10 Lodging depth (absorbs completion 07) · **Fable, effort high**

```
Effort: high (two-way availability sync + bed-inventory remodel + a live booking race).

Execute docs/fable5/vertical-depth/plans/V10-lodging-depth.md. Read it + completion-spec.md first. F05 is a soft dep; the Step-1 folio-tax decision applies to invoice/audit math — read that verdict. Git: branch feat/v10-lodging-depth off main; commit; push; no PR.

PRE-FLIGHT (absorbed): walk docs/fable5/completion/plans/07-room-management.md's checklist live on a fresh hotel tenant first. Fix P0-class wiring defects; report drift.

THEN the depth plan IN ITS STATED ORDER — task 1 is the createBooking race fix (advisory lock + single choke-point fn) BEFORE any new booking writer exists. Then: direct booking engine (public pages + deposit + unpaid-reservation TTL), iCal channel sync (export feeds + import worker + conflict dead-lettering; Booking.com API explicitly OUT — label the hub honestly), hostel beds via rooms.parent_room_id (schema → STOP for migration approval), then P1 guest registration (CNIC capture), group bookings, night audit + occupancy/ADR report. HARDEN items first-class: checkout-day-exclusive overlap math + back-to-back test, feed staleness, settle/capture idempotent ordering.

Decision points: unpaid-reservation TTL rule; confirm the folio-tax coordination.

Pause-list: migrations, auth, anything webhook-like in feed handling.
Verify: fresh-context verifier runs the plan's bar on fresh hotel + fresh hostel incl. the last-bed concurrency race and the conflicting-import dead-letter.
Close-out: tracker (this step + completion 07) + memory. Report: outcome first — is an OTA-dependent property now viable? is the hostel bed model real?
```

## STEP 19 — V09 Rentals depth (absorbs completion 06) · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V09-rentals-depth.md. Read it + completion-spec.md first; confirm F04 merged (hard dep) + F05; read the Step-1 folio-tax verdict (rental invoices are affected — coordinate the migrations). Git: branch feat/v09-rentals-depth off main; commit; push; no PR.

PRE-FLIGHT (absorbed): walk docs/fable5/completion/plans/06-rentals.md's checklist live on a fresh car_rental tenant first (spot-check equipment/furniture/party skins). Fix P0-class wiring defects; report drift.

THEN the depth plan: P0 car legal agreement (driver/CNIC/license schema → STOP for migration approval → readings + e-sign via services/contracts.js) and inspections (schema → STOP → checkout/return photo+checklist+ack flow feeding F04 deposit capture), then P1: deposit pre-auth verified end-to-end with damage capture, maintenance scheduling, online rental booking THROUGH the same locked service fn (never route-local availability), delivery scheduling for furniture/party. HARDEN items first-class: verify the availability-check-inside-lock ordering in rental-service.js:281-300 (reorder if check precedes lock), deposit-as-payment vs damage-as-line invoice math test, timeline includes reserved online bookings.

Pause-list: migrations, auth.
Verify: fresh-context verifier runs the plan's bar ("can a car legally leave the lot" demo) incl. the parallel-reserve race.
Close-out: tracker (this step + completion 06) + memory. Report: outcome first — is car_rental now viable?
```

## STEP 20 — V05 Clinical depth · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V05-clinical-depth.md. Read it + completion-spec.md first; confirm F03 + F05 merged; read Step 7's schema-drift verdict (completion 08) — if it reported needed DDL, sequence this plan's migrations after it. Git: branch feat/v05-clinical-depth off main; commit; push; no PR.

P0s in order: (1) clinic preset enablement — config change + backfill decision: propose new-signups-ON / existing-tenants-flags-OFF + announcement, STOP for my choice before applying (it changes live tenants' nav overnight). (2) Recall/continuing-care (schema → STOP for migration approval → auto-arm on plan/session completion → worker outreach via F05 → overdue-patients screen → book-from-recall loop). (3) Vet vaccinations (records table + recall specialization + printable card). Then P1: structured allergies/alerts with the red banner + prescribe-time warning, intake forms (F03 seeds + auto-attach), physio handout library, tooth-chart live confirm (extend the dental preset only if generic). HARDEN: recall-vs-session-reminder suppression rule; portal subject-scope re-check on every new endpoint; allergy-check limitation labeled in UI.

Pause-list: migrations, the preset/backfill change (above), auth, FBR/tax.
Verify: fresh-context verifier runs the plan's bar on fresh clinic + fresh veterinary + a dental tenant, incl. clock-shifted recall firing.
Close-out: tracker + memory. Report: outcome first — clinic viable as a clinical product? recall + vaccination loops live?
```

## STEP 21 — V04 Salon depth · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V04-salon-depth.md. Read it + completion-spec.md first; confirm F06 (hard), F02, F04, F05 merged. Git: branch feat/v04-salon-depth off main; commit; push; no PR.

P0: client service history (schema → STOP for migration approval → auto-created skeleton records at F06 checkout → last-visit panel IN THE BOOKING VIEW + customer Service History tab + photos). Then P1 consumption with salon vocabulary: SMS reminder rules seeded + verified truthful, packages (F02), waitlist (F06), no-show card-on-file (F04), rebooking prompt. HARDEN first-class: walk-in performed-by becomes a blocking pick (no default employee on service lines), re-run the parallel-public-booking race on THIS tenant, reminder-truth assertion, flag the formula-privacy question to me (don't build per-record visibility).

Decision point: salon flag seeding — propose whether loyalty/gift-cards seed ON for salon signups; STOP for my choice.

Pause-list: migrations, auth.
Verify: fresh-context verifier runs the plan's bar (the Fresha-aware-owner demo, end to end).
Close-out: tracker + memory. Report: outcome first — is the salon daily loop closed (book → remind → serve → checkout → attribute → rebook)?
```

## STEP 22 — V01 Retail depth · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V01-retail-depth.md. Read it + completion-spec.md first; confirm F01 + F07 merged (hard deps). Git: branch feat/v01-retail-depth off main; commit; push; no PR.

P0s: price-embedded barcode decode (backend authoritative + POS instant parse; config schema → STOP for migration approval), lane-scale WebSerial integration with manual fallback (frontend adapter, extensible like couriers/), and the preset flag-seeding decision — propose the exact seeder change for grocery/butcher/sweet/textile (which retail flags + kit_bom_engine + batch_expiry_tracking per preset) and STOP for my approval (it touches the signup path). Then P1: PLU pad (plu_code column → STOP), butcher disassembly + sweet-shop box workflows on F01 with preset vocabulary, textile roll polish on F07. P2 if cheap: shelf labels, exchange-flow depth (confirm live first), age-verification.

HARDEN first-class: decoded-price lines excluded from percentage promos by default (test the storewide-promo case), tare locked on decoded lines, cartMath unit tests at 4-decimal weights, offline-queue replay snapshots decoded prices.

Pause-list: migrations, the seeder change (above), auth.
Verify: fresh-context verifier runs the plan's bar on fresh grocery + fresh textile incl. the unmapped-scale-item error case.
Close-out: tracker + memory. Report: outcome first — can a supermarket lane actually run (scan-embedded, PLU, scale)?
```

## STEP 23 — V03 Food-service depth · **Opus, effort high**

```
Effort: high.

Execute docs/fable5/vertical-depth/plans/V03-food-service-depth.md. Read it + completion-spec.md first; confirm F01 merged (hard dep); F04 for the P2 bar-tab slot. Git: branch feat/v03-food-depth off main; commit; push; no PR.

P0: foodpanda adapter (services/marketplace pattern) + webhook → web_orders → the EXISTING online-inbox accept path → KDS, with auto-accept toggle, idempotency on platform order id (column check → STOP if migration needed), price-snapshot-from-payload rule, availability push for 86'd items, Careem as second adapter (stub-honest if no sandbox access — never a decorative green integration). SECURITY PAUSE: produce the webhook signature-verification + replay-window design and STOP for my approval before exposing the endpoint — do not ship it unverified like the Meta/Daraz handlers.

Then P1 on F01: recipes with restaurant vocabulary, plate cost + food-cost % in menu engineering, theoretical-vs-actual walked with real prep, combos in menu management + KDS handling. P2: bar-tab pre-auth via F04 slot; resolve the drive-thru flag question from Step 3's report (delete if dead — propose).

HARDEN first-class: aggregator sales decrement stock + recipes identically to POS (add this path to the sales-writer census), duplicate-webhook test, FBR-on-aggregator-sales decision → propose, STOP (FBR is pause-list).

Verify: fresh-context verifier runs the plan's bar on the cafe + restaurant test tenants using a recorded payload fixture, incl. the malformed-payload dead-letter case.
Close-out: tracker + memory. Report: outcome first — do foodpanda orders reach the kitchen with zero re-entry?
```

## STEP 24 — V02 Wholesale depth · **Fable, effort high**

```
Effort: high (rewrites the no-partial-fulfillment invariant + a credit-limit race fix).

Execute docs/fable5/vertical-depth/plans/V02-wholesale-depth.md. Read it + completion-spec.md + feedback_audit_ledger_before_building first. Step 5 (completion 04) already proved the Tier 0–2 stack. Git: branch feat/v02-wholesale-depth off main; commit; push; no PR.

P0 backorders: schema → STOP for migration approval → the shortfall-offer decision point implemented ONCE in the service layer and surfaced on all four order-taking surfaces (POS, storefront checkout, portal reorder, field PWA) → GRN-matching fulfillment loop through the standard sale path (stock lock, tax snapshot at conversion with the ORDER-time price snapshot, AR) → F05 notifications → statements show backorders as memo. Credit rule: fulfilled amount only counts toward the limit.

Then P1: van sales (outlets.outlet_type='van' → STOP for migration + the plan-limit exemption decision → load-out transfer → field-PWA van stock + sell-from-van → day-end reconcile), POD on loadsheet stops (signature+photo via the field.js R2 pipeline).

HARDEN first-class: the credit-limit race — lock the customer row FOR UPDATE for on-account sales AND grep every other on-account writer for the same fix; run the ledger audit (Σ invoices − Σ payments = balance) on the tenant after the whole walkthrough; MOQ not re-validated at fulfillment conversion.

Pause-list: migrations, the plan-limit exemption, auth.
Verify: fresh-context verifier runs the plan's bar on the wholesale test tenant incl. the four-surface backorder offer and the concurrent credit-sale race.
Close-out: tracker + memory. Report: outcome first — can a distributor short-fill an order end-to-end? van day reconciles?
```

## STEP 25 — V08 Photography depth (absorbs completion 09) · **Sonnet, effort medium**

```
Effort: medium.

Execute docs/fable5/vertical-depth/plans/V08-photography-depth.md. Read it + completion-spec.md first; confirm F03 merged. Git: branch feat/v08-photography-depth off main; commit; push; no PR.

PRE-FLIGHT (absorbed): walk docs/fable5/completion/plans/09-service-projects.md's checklist live on a fresh photography_studio tenant first (quote→project→contract→e-sign→milestone invoicing). Fix P0-class wiring defects; report drift.

THEN the depth plan (all P1): public inquiry form → CRM lead + staff notification (Turnstile reuse, public mount pattern), questionnaires via F03 (seeds + auto-attach on project), gallery v1 (client_visible/client_selected columns → STOP for migration approval → portal gallery grid served from R2 directly, selection → project activity + staff notify). HARDEN first-class: the portal IDOR test (client A cannot read client B's gallery/questionnaire — 404), R2-direct image serving (never through the Express proxy), spam status on leads.

Pause-list: migrations, auth.
Verify: fresh-context verifier runs the plan's bar (the closed Studio Ninja loop) incl. the cross-customer IDOR check.
Close-out: tracker (this step + completion 09) + memory. Report: outcome first.
```

---

# PART E — GROWTH (Step 26)

## STEP 26 — Plan the growth builds · **Fable, effort high** (planning session; builds get their own prompts after)

```
Effort: high. PLANNING ONLY — stop for my approval before building anything.

The whole depth program (vertical-depth ROADMAP waves 0–3) and the Square reskin are done and merged. The last remaining work is completion plan 11's deferred P1 growth builds. Read docs/fable5/completion/plans/11-growth-surface.md (the deferred list: website builder, marketing automations, payment links, Google reviews collection, wallet passes, abandoned-cart, AI cataloging, receipt feedback) + Step 6's execution report + docs/fable5/vertical-depth/plans/V08-photography-depth.md's P2 note (stage-based workflow automation rides the marketing-automations engine).

For each deferred item: assess against the current post-reskin, post-depth codebase (grep the reuse targets — much has changed since plan 11 was written), rank by revenue impact for our live tenant base (check production tenant mix via read-only Supabase), and produce a per-item recommendation: build now / build later / drop. For the greenlit set, write execution prompts in the style of docs/fable5/vertical-depth/prompts-per-plan.md (model rec per item: marketing automations → Fable; most others → Opus).

STOP after the recommendations + prompts. Do not build.
```

---

# Progress tracker (each session ticks its row)

| Step | What | Model | Status |
|---|---|---|---|
| 0 | /check-services baseline | any | ☐ |
| 1 | 🚨 Plan-01 rescue + pricing fork + folio-tax proposal | Fable | ☐ |
| 2 | completion 00 core spine | Opus | ☐ |
| 3 | completion 02 restaurant | Opus | ☐ |
| 4 | completion 03 appointments+commissions | Opus | ☐ |
| 5 | completion 04 wholesale | Opus | ☐ |
| 6 | completion 11 P0-only | Opus | ☐ |
| 7 | completion 08 treatment plans | Opus | ☐ |
| 8 | F05 notifications | Opus | ☐ |
| 9 | F06 scheduling activation | Fable | ☐ |
| 10 | F02 packages + billing | Opus | ☐ |
| 11 | F04 deposit engine | Fable | ☐ |
| 12 | F03 form builder | Opus | ☐ |
| 13 | F01 kit/BOM | Fable | ☐ |
| 14 | F07 batch/expiry | Fable | ☐ |
| 15a | 🚧 Reskin Phase 2 (repeat until done) | Opus | ☐ |
| 15b | 🚧 Reskin Phase 3 POS | Fable | ☐ |
| 15c | 🚧 Reskin Phase 4 admin | Opus | ☐ |
| 15d | 🚧 Reskin Phase 5 public/portals | Opus | ☐ |
| 15e | 🔀 Merge redesign/square → main | Opus | ☐ |
| 16 | V06 repair (+ completion 05) | Opus | ☐ |
| 17 | V07 gym (+ completion 10) | Opus | ☐ |
| 18 | V10 lodging (+ completion 07) | Fable | ☐ |
| 19 | V09 rentals (+ completion 06) | Opus | ☐ |
| 20 | V05 clinical | Opus | ☐ |
| 21 | V04 salon | Opus | ☐ |
| 22 | V01 retail | Opus | ☐ |
| 23 | V03 food service | Opus | ☐ |
| 24 | V02 wholesale | Fable | ☐ |
| 25 | V08 photography (+ completion 09) | Sonnet | ☐ |
| 26 | Growth planning → then its builds | Fable | ☐ |
