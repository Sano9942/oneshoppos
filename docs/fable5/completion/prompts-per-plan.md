# Per-Plan Execution Prompts (Prompt B, filled in)

> Paste-in execution prompts for each completion plan, with the model recommendation and decisions already baked in. Companion to [completion-prompt.md](completion-prompt.md) (the generic Prompt A/B templates) and the register in [README.md](README.md). Rules: [completion-spec.md](completion-spec.md).
>
> **Model logic:** the hard cross-surface reasoning is concentrated in Plan 01, so **Fable runs once (Plan 01)**; every other plan is Opus/Sonnet because its work is pinpointed fixes + live confirmation. If you later greenlight a specific cross-cutting *build* (marketing automations, exchanges, bundles) during the free-Fable window, route that individual build to Fable — but the plan runs below don't need it.

---

## Model & sequence at a glance

| Order | Plan | Model | Why |
|---|---|---|---|
| 1 | 01 cross-surface | **Fable** (xhigh) | The seams — tax/stock/pricing/visibility consistency across every surface. Only irreducibly-hard run. Pauses for auth/tax approvals. |
| 1 (parallel) | 00 core-spine | **Opus** (high) | 2 pinpointed P0s + broad verification. No reasoning edge needed. Independent of 01. |
| 3 | 02 restaurant | **Opus** | 2 one-line P0 contract fixes in a live vertical + walkthrough. |
| 4 | 04, 05, 06, 07, 09, 10 | **Opus / Sonnet** | Zero-defect verticals — live confirmation only. `05` after `01`. Others parallelizable. |
| 5 | 03 appointments+commissions | **Opus** | 0 P0; verify booking↔commission↔payroll; 5 P1 deferred. |
| 6 | 08 treatment-plans | **Opus** | After 03 (shared engine). 0 P0; verify clinical stack. |
| 7 | 11 growth | **Opus now / Fable later** | 1 backend P0 + verify → Opus. 8 P1 new-UI builds deferred until after the reskin. |

**Decisions already baked into the prompts:** ai_insights → `DEFAULT_FEATURE_FLAGS` default-off (Plan 00) · report tabs → delete gated stock-aging dup + client-side gate the 2 power-ups (Plan 00) · onboarding_steps → WIRE SetupWizard to preset payload (Plan 01) · kiosk outlets 401 → narrow public id+name endpoint, propose+approve (Plan 01) · marketplace-sync → check creds then wire-or-mark-honest (Plan 11).

---

## Plan 00 — Core spine (Opus, effort high)

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/00-core-spine.md. It was generated and approved. Read that file plus docs/fable5/completion/completion-spec.md for the rules before touching anything.

Scope this run to: the 2 P0 fixes + the full core-spine verification walkthrough + any wiring defects that walkthrough surfaces. DEFER all 8 P1 feature gaps — do not build them; list them back to me for a per-item decision.

THE TWO P0 FIXES (decisions already made — apply them):
1. AI insights chat is dead (`ai_insights` flag exists only in insights-ai.js + DashboardRedesign.jsx, never seeded). Add `ai_insights: false` to DEFAULT_FEATURE_FLAGS (middleware/feature-flags.js) so it becomes reachable and toggleable in the admin flags editor, default OFF (it needs ANTHROPIC_API_KEY + incurs cost). Confirm ANTHROPIC_API_KEY is set on Railway (report if you can't verify).
2. Three Reports→Inventory tabs 403 + duplicate stock-aging route. Delete the shadowing GATED stock-aging duplicate (reports/inventory.js:737 path, registered via reports/index.js:21) so the ungated Wave-3 stock-aging implementation (stock-aging.js:12, registered at reports/index.js:33) actually serves. For the two genuinely-premium tabs (stockout-risk, replenishment-smart), gate them CLIENT-SIDE in Reports.jsx on `reports_inventory_health_plus` so they don't render as 403-ing tabs. One consistent decision: base stock-aging works for all; the two power-ups hide behind the flag.

THE VERIFICATION WALKTHROUGH (the bulk of the value): walk every row of the plan's checklist live on a general_retail test tenant — login → context → POS sale (cash + card + discount + park/retrieve) → return → product CRUD + variants → bulk import → adjustment/transfer → stock count → PO→GRN→payable → customer + loyalty + wallet → employees/roles/PIN re-auth → shift open/close z-report → EVERY report tab returns 200 → accounting reconcile → customer invoice AR → quotation→invoice convert → notifications → receipt email + public URL → setup wizard → action history. Fix any P0-class wiring defect you find (dead route, contract mismatch, wrong verb/path) the same way — pinpoint, then fix.

Also confirm the plan's "Confirm during execution" items: currency-401 fix actually deployed (dashboards show Rs not $), GET /api/sales list shape consumed by SalesHistoryRedesign, draft-orders 403 risk on non-retail presets, PLAN_LIMIT_REACHED modal path.

Cross-surface lens: for shared concerns (tax, stock, promotions, receipts) verify the POS path only — Plan 01 owns the full multi-surface diff. The v83 tax chain is PAUSE-LIST: verify only, don't change; if you find drift, report it for Plan 01, don't fix here.

P2 polish: optional and only if cheap and directly adjacent (e.g. accept both date-param spellings server-side, swap inline CSV Blob code for downloadCsv). Skip anything that expands scope.

Scope: this plan only, P0 + verification. If any fix needs a schema change, a new migration, or an auth-middleware change, STOP and tell me — pause-list. No adjacent refactors, no P1 builds.
Autonomy: run the P0 fixes + walkthrough + verification autonomously through reversible steps. Pause only for pause-list items or a genuine block. Don't commit or push. Don't write to production. Local tests use local Postgres (.env.test).
Verify: a fresh-context verifier subagent re-runs the walkthrough and confirms both P0s are fixed and every checklist row passes live before you claim done.
Close-out: update the plan register status + append any non-obvious wiring defect pattern to memory (one file + MEMORY.md pointer).
Report: outcome first — both P0 results, which checklist rows passed vs any new defects found, the deferred P1 list for my decision, and anything I need to act on (e.g. ANTHROPIC_API_KEY) — then details.
```

---

## Plan 01 — Cross-surface seams (Fable, effort xhigh)

```
Effort: xhigh (this touches tax, auth, and multi-tenant routing — subtle bugs here are expensive).

Execute completion plan docs/fable5/completion/plans/01-cross-surface.md. It was generated and approved. Read that file plus docs/fable5/completion/completion-spec.md for the rules before touching anything.

THE MAIN EVENT (why this plan runs on you, not a cheaper model): the cross-surface consistency verification, not the three P0 patches. Do this first and thoroughly:
- Tax (v83 chain): diff EACH of the 9 write paths in the plan's map (sales, storefront quote, draft-orders, orders, customer-invoicing, restaurant-checks, rental-service, room-service, treatment-plan-service) against sales.js's resolution. POS+quote were fixed in P8/P13; rentals/rooms/treatment folios were NEVER audited — that's the real risk. tax_mode + per-line tax_rate_at_sale/tax_amount_at_sale must be identical for the same cart on every surface.
  → The v83 tax architecture is PAUSE-LIST: verify only. If you find drift, produce the evidence + a proposed fix and STOP for my approval — do not change tax logic this run.
- Stock decrement: confirm exactly-once decrement across POS / storefront (reservation+allocation) / field-rep / returns restock / GRN / transfers; no oversell under FOR UPDATE; reservation TTL expires.
- Pricing + promotions: same customer+product → same price on POS, storefront, portal reorder, field-rep. Same promo priority everywhere.
- Catalog visibility + MOQ: restricted products hidden on portal/storefront/field for ungrouped buyers, POS sees all; MOQ rejects on the 3 gated paths, POS bypasses.
Apply the mandatory cross-surface lens per [[feedback_parallel_paths]] — the recurring bug here is one path fixed, another still broken.

THE THREE P0 FIXES (decisions already made — apply them):
1. Repair-shop portal Tickets tab (customer-portal/data.js): map `tickets` → `phase4_workflow_tickets` (not phase4_service_projects). Then AUDIT all 10 tab→flag mappings in TAB_FEATURE_FLAGS against the presets that actually enable each tab, and fix any other mismatches you find the same way.
2. Preset onboarding_steps dead config — DECISION: WIRE it, don't delete. Drive SetupWizard's step list from the preset payload (via the setup-status / context bootstrap response) so a hotel/clinic/rental tenant gets its preset's onboarding, not the hardcoded retail steps 1–5. This is presentation/config wiring only — no schema. Note the redesign collision: the logic change is orthogonal to styling and merges into redesign/square cleanly; land it off `main`.
3. Kiosk outlets 401 (D3) — PAUSE-LIST (tenant routing/auth). DECISION on mechanism: do NOT add the full /api/outlets to PUBLIC_TENANT_PARAM_PATHS (that would expose full outlet objects publicly). Instead add a NARROW public read-only endpoint returning outlet id + name only, mirroring the existing company-profile/currency public path, and point KioskRedesign at it. Implement the concrete diff, but STOP and show it to me for approval before treating it as final — do not commit it as settled.

Scope: this plan only. If any fix needs a schema change, a new migration, or a change to the v83 tax chain or auth middleware beyond the narrow kiosk endpoint, STOP and tell me — pause-list. No adjacent refactors.
Autonomy: run the verification + the two non-pause-list fixes (tickets tab, onboarding wiring) autonomously through reversible steps. Pause for: the kiosk auth mechanism approval, any tax-chain change, or a genuine block. Don't commit or push. Don't write to production. Local tests use local Postgres (.env.test).
Verify: a fresh-context verifier subagent runs the Playwright walkthrough on test tenants — reuse [[wholesale_test_tenant]] (visibility/MOQ/pricing) + [[cafe_test_tenant]] (kiosk) + a general_retail tenant (tax-inclusive cart priced identically on POS vs storefront vs portal). Confirm each seam row passes live before claiming done.
Close-out: update the plan register status + append any non-obvious cross-surface trap to memory (one file + MEMORY.md pointer).
Report: outcome first — which seams are now proven-consistent vs which had drift, the 3 P0 results, and exactly what needs my approval (kiosk mechanism, any tax drift) — then details.
```

---

## Plan 02 — Restaurant (Opus, effort high)

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/02-restaurant.md (generated + approved). Read it plus docs/fable5/completion/completion-spec.md first.

Scope: the 2 P0 fixes + the full restaurant verification walkthrough + any wiring defects it surfaces. DEFER both P1 gaps (bar-tab pre-auth, 3rd-party delivery) — list them back to me.

THE TWO P0 FIXES (apply — decisions obvious):
1. KDS station printer dropdown always empty: KdsStationSettingsModal.jsx:34 calls GET /api/printer-config which doesn't exist. Change it to GET /api/print/config (printer.js:123) and map the response shape — that route returns a single printer_config row, not a list; adapt what the modal expects.
2. Void/comp reason admin edits 404: VoidReasonsAdminRedesign.jsx:48 uses api.put on /api/restaurant/void-reasons/:id but the backend only registers app.patch (restaurant/void-comp.js:48). Switch line 48 to the PATCH pattern the same file already uses correctly at lines 56/75.

VERIFICATION WALKTHROUGH: floor plan → open table → order w/ modifiers (min/max/price_delta) → send to kitchen → KDS bump/recall → fire course → split by seat (totals incl. tax sum to original) → void one line w/ manager-PIN + reason → tip pool distribute → pay-at-table → QR public menu shows an 86'd item gone → kiosk order lands in inbox/KDS → reservation from public page. Fix any P0-class defect found the same way.

Confirm-during-execution items: whether phase4_restaurant_fire_chits/_seats/_drive_thru gate any live surface (delete dead flags from mode-registry if not); restaurant order→stock decrement semantics are intentional; pay-at-table graceful when PAYMENT_GATEWAY unset.

Cross-surface lens: 86/menu-schedule availability must resolve identically on POS + QR menu + kiosk + inbox; tips→commission_earnings must not double-count against payroll; split/comp receipts render via the shared utils/receipt.js. The v83 tax chain is PAUSE-LIST — verify split-check totals use it, but if you find drift, report it for Plan 01, don't change tax logic.

Scope discipline: this plan only. Schema/migration/auth change → STOP (pause-list). No P1 builds, no refactors.
Autonomy: run fixes + walkthrough autonomously; pause only for pause-list items or a genuine block. Don't commit/push. Don't write to production. Local tests use .env.test.
Verify: fresh-context verifier subagent re-runs the walkthrough on [[restaurant_test_tenant]] (and [[cafe_test_tenant]] for counter mode) and confirms both P0s fixed + rows pass live.
Close-out: update the register + append any non-obvious defect pattern to memory.
Report: outcome first — both P0 results, walkthrough pass/fail, deferred P1 list — then details.
```

---

## Zero-defect verticals — reusable (Opus / Sonnet)

Fill `[PLAN FILE]` and `[TEST TENANT]` each run. **Run `05` only after `01` lands** (depends on its portal-tab fix). The rest are independent — parallelizable.

Fill-ins: `04-wholesale.md` → `[[wholesale_test_tenant]]` · `05-workflow-tickets.md` → fresh `repair_shop` (after 01) · `06-rentals.md` → fresh `car_rental` (spot-check equipment/furniture/party) · `07-room-management.md` → fresh `hotel` · `09-service-projects.md` → fresh `photography_studio` · `10-subscriptions.md` → fresh `gym`.

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/[PLAN FILE] (generated + approved). Read it plus docs/fable5/completion/completion-spec.md first.

This plan found ZERO defects from code — your job is to PROVE it connects live, not to invent fixes. Walk the plan's full verification checklist on a [TEST TENANT] tenant; a row only counts done when it passes live with evidence. If the walkthrough surfaces a real P0-class wiring defect (dead route, contract mismatch, wrong verb/path, a flag-gated visible surface that 403s), pinpoint it to file:line and fix it — otherwise change nothing.

Also resolve the plan's "Confirm during execution" items (they're the real risk surface here). Do the plan's P2 polish ONLY if cheap and directly adjacent; skip anything that expands scope. DEFER any P1 gaps — list them back to me.

Apply the cross-surface lens the plan specifies, but the deep tax/stock/pricing diff is owned by Plan 01 — here just confirm this vertical's paths match; report drift, don't re-fix it.

Scope discipline: schema/migration/auth change → STOP (pause-list). No speculative refactors.
Autonomy: run the walkthrough + any surfaced fix autonomously; pause only for pause-list items or a genuine block. Don't commit/push. Don't write to production. Local tests use .env.test.
Verify: fresh-context verifier subagent re-runs the walkthrough and confirms every checklist row passes live.
Close-out: update the register status + append any non-obvious lesson to memory.
Report: outcome first — is this vertical provably connected end-to-end? any defect found? the deferred P1 list — then details.
```

---

## Plan 03 — Appointments + Commissions (Opus, effort high)

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/03-appointments-commissions.md (generated + approved). Read it plus completion-spec.md first.

0 confirmed P0s. Scope: verify the appointments + commissions spine live, resolve the Confirm-during-execution items, and TRIAGE (don't blind-fix) the booking-reminder SMS behavior. DEFER all 5 P1 gaps (no-show fees, class/group booking, prepaid packages, intake forms, calendar sync) — list them back to me for a per-item decision.

Booking-reminder SMS: the plan flags that SMS is silently skipped but marked 'sent' — this is pre-documented behavior guarded by a unit test. Investigate whether it's intentional or a real bug BEFORE changing anything; report your finding, don't fix blind.

Confirm-during-execution: is utils/ics.js actually attached to booking confirmation emails or a dead util? booking-overlap check under concurrent public bookings; gym "Class Bookings" portal label renders; commission earning behavior on returns/voids (reversal row vs orphaned earning?).

VERIFICATION on a fresh salon tenant (walks both modes): create service+staff → public booking as customer → reminder enqueued → reschedule → checkout at POS with staff commission attribution → earning approved → payroll (tier4/hr.js) picks it up → portal shows appointment history. Run the preset-skin checklist for salon/clinic + the booking surfaces of gym/photography/dental/vet/physio.

Cross-surface lens: cancellation from admin calendar / public page / portal must free the slot everywhere; one commission earning → one payout (POS sales + tip pools both write commission_earnings). Tax on service checkout is Plan 01's diff — verify, report drift, don't re-fix.

Scope discipline: schema/migration/auth → STOP. No P1 builds this run.
Autonomy: run verification + the SMS triage autonomously; pause for pause-list items or a genuine block. Don't commit/push. Don't write to production. Local tests use .env.test.
Verify: fresh-context verifier subagent re-runs the salon walkthrough.
Close-out: update the register + memory.
Report: outcome first — is the booking↔commission↔payroll chain provably connected? the SMS triage verdict? the deferred P1 list — then details.
```

---

## Plan 08 — Treatment plans (Opus, effort high — run AFTER 03)

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/08-treatment-plans.md (generated + approved). Read it plus completion-spec.md first. Run this AFTER plan 03 (shared appointments availability engine).

0 confirmed P0s. Scope: verify the clinical stack live + resolve Confirm-during-execution items. The one P1 (generic intake forms) is SHARED with plan 03 — coordinate: decide whether it's closed here (extend clinical docs) or in 03 (booking-time forms), don't duplicate. Defer it either way and report the recommendation.

Confirm-during-execution: treatment_plan_templates schema parity between a fresh-provisioned tenant and a migrated one (known v46 schema-pg.sql drift — see [[followup_b15_schema_drift]]); session checkout at POS write path + tax chain (treatment folios were NEVER audited in Plan 01's tax diff — flag drift to 01); deposit capture-on-settle behavior when a plan is cancelled mid-way (refund path).

VERIFICATION on a fresh dental_clinic tenant (spot-check veterinary pet-subject flow): patient → template→plan → chart marks → session via calendar → lab order → consent → deposit pre-auth → complete sessions → settle (nets deposit) → portal shows progress → clinical report tabs 200. Run the preset-skin checklist for dental/vet/physio.

Cross-surface lens: sessions vs bookings must not double-book a provider slot (03 owns availability); folio/settle tax is Plan 01's diff; portal shows only own subject (vet portal must not leak other owners' pets).

Scope discipline: schema/migration/auth → STOP (note: the schema-drift confirm may surface a needed migration — report it, don't apply). No P1 build this run.
Autonomy: run verification autonomously; pause for pause-list items or a block. Don't commit/push. Don't write to production. Local tests use .env.test.
Verify: fresh-context verifier subagent re-runs the dental walkthrough.
Close-out: update the register + memory.
Report: outcome first — clinical stack connected? schema drift present? intake-forms recommendation (03 vs 08)? — then details.
```

---

## Plan 11 — Growth (Opus now for P0+verify; big builds deferred)

```
Effort: high.

Execute completion plan docs/fable5/completion/plans/11-growth-surface.md (generated + approved). Read it plus completion-spec.md first.

Scope THIS run to: the 1 P0 + verification of the existing growth wiring. DEFER all 8 P1 build gaps (website builder, marketing automations, payment links, Google reviews, wallet passes, abandoned-cart, AI cataloging, receipt feedback) — they're new consumer UI that collides with the redesign; list them back to me for a per-item decision AFTER the reskin.

THE P0 (decision baked in): marketplace background sync is decorative — marketplace-sync-worker-boss.js:63,69,107 log/heartbeat but never call DarazClient/MetaCommerceClient/GoogleMerchantClient. First, via read-only Supabase, check whether ANY live tenant actually has marketplace credentials configured. DECISION: if none/negligible, do NOT build polling — make it honest instead: stop scheduling the dead jobs (or clearly label the hub + admin worker-status as "manual sync only") so the dashboard doesn't show a green worker doing nothing. If real tenants depend on it, wire the three client calls inside withTenantContext() — backend only, off main. Report which path you took and why.

Also log the comparison-doc correction the plan found: "Product reviews ❌" is wrong (full pipeline exists — products.js:1584-1735, storefront.js:254-328). Fix that row in docs/research/sanopos-vs-square-comparison.md, and add the Google-Reviews-collection gap as the real ❌ row.

VERIFICATION of existing surface: storefront browse→cart→checkout→order-in-inbox; review submit→moderate→display; email campaign to a 2-customer audience delivers; existing invoice payment-link paid via SanoPay sandbox ([[sanopay_sandbox]]); integrations hub connect/disconnect round-trip (note /test is DB-only — label honestly).

Cross-surface lens: campaign bursts share email_queue/SMS adapters with receipts+password-resets (a burst must not starve transactional sends — check queue priority); payment links share gateway webhook routing with billing/rooms/treatments. Stock/tax on storefront are Plan 01's diff — verify, report drift.

Scope discipline: webhook signature verification (Meta/WhatsApp/Daraz) is security-adjacent → PROPOSE, don't implement (pause-list). Schema/migration/auth → STOP. No P1 builds this run.
Autonomy: run verification + the P0 decision autonomously; pause for pause-list items or a block. Don't commit/push. Don't write to production. Local tests use .env.test.
Verify: fresh-context verifier subagent re-runs the storefront + campaign + payment-link walkthrough.
Close-out: update the register + the comparison doc + memory.
Report: outcome first — which P0 path you took, existing growth surface pass/fail, the deferred P1 list for post-reskin decisions — then details.
```
