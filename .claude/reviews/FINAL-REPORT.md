# Phases 1–5 Final Cross-Batch Review Report

**Review date:** 2026-04-11
**Branch reviewed:** `omnichannel-phase1` (fast-forward merged into main)
**Commit range:** `b1b2763^..35f9874` (~68 phase commits, ~30 bug-fix commits after merge)
**Methodology:** 4-step cross-batch review — (1) interconnection map, (2) targeted reviewer prompts, (3) 5 parallel phase reviewers, (4) cross-phase synthesis pass

> **Active fix plan:** [fix-plan.md](fix-plan.md) — read this for current decisions, live production verifications, and commit progress. This report is a frozen snapshot of the review; `fix-plan.md` is the living document.

---

## TL;DR

- **11 unique critical bugs**, **11 unique high bugs**, **9 medium**, **7 cross-phase patterns**
- **9 of 10 map blind spots** confirmed and verified with file/line details; 1 partial miss (quotations in tier4/crm.js)
- **Two architectural fixes unlock everything else**:
  1. **Pattern A** — Phase 3 and Phase 4 background workers all bypass multi-tenant DB routing, making subscription renewals, scheduled campaigns, invoice reminders, AND appointment reminders silently non-functional on every tenant
  2. **Pattern D** — Phase 1 code references Phase 5 (v25) columns and tables, breaking Phase 1 on any schema <v25; Phase 5 extended pre-existing tables without updating existing INSERT paths

Everything else is domain-local and can be fixed in parallel once those two are resolved.

---

## Artifact index

All review artifacts live under `.claude/reviews/`:

| File | What it is |
|---|---|
| [interconnection-map.md](.claude/reviews/interconnection-map.md) | Full 9-section map of cross-phase seams (54KB) |
| [interconnection-map-summary.md](.claude/reviews/interconnection-map-summary.md) | Top findings summary from the map |
| [findings/phase1.md](.claude/reviews/findings/phase1.md) | Phase 1 (Omnichannel) reviewer findings |
| [findings/phase2.md](.claude/reviews/findings/phase2.md) | Phase 2 (Operations + 2b) reviewer findings |
| [findings/phase3.md](.claude/reviews/findings/phase3.md) | Phase 3 (Customer Engagement) reviewer findings |
| [findings/phase4.md](.claude/reviews/findings/phase4.md) | Phase 4 (Restaurant + Booking + Service Workspace) findings |
| [findings/phase5.md](.claude/reviews/findings/phase5.md) | Phase 5 (Pakistan) reviewer findings |
| [findings/cross-phase-synthesis.md](.claude/reviews/findings/cross-phase-synthesis.md) | Step 4 synthesis: patterns, contradictions, fix ordering |
| [phaseN-files.txt](.claude/reviews/) | Scope file lists per phase |
| [_reviewer-prompt-*.md](.claude/reviews/) | Prompts used for the 5 reviewers (kept for audit) |

---

## The 11 critical bugs (deduplicated)

### Cross-phase patterns that collapse multiple critical findings

**Pattern A — Workers query wrong schema** — CRITICAL, affects 3+ phases
- Phase 3 C1: subscription-renewal, campaign-scheduled-send, invoice-reminder workers in `email-worker-boss.js:217-369` use bare `{ query: pool.query }` shim instead of tenant-scoped DB. Every campaign, subscription renewal, and invoice reminder silently fails on every tenant.
- Phase 4 C1: `services/booking-reminders.js:processPendingReminders` is exported but never called AND would have the same bug if it were.
- Phase 1 H2: reservation worker not registered in `/api/admin/worker-status`.
- **Fix:** One helper `withTenantContext(slug, fn)` + require every queue payload to include `tenant_slug`. Unblocks all four features.

**Pattern D — Earlier-phase code depends on v25 schema** — CRITICAL, affects Phases 1 & 5
- Phase 1 C3: `services/quote.js:199` queries `courier_integrations.flat_shipping_rate` (v25 column). Every storefront checkout with a courier selected throws 500 on schema v18–v24.
- Phase 1 cross-phase: `/api/storefront/orders/:orderToken/pay` queries `storefront_payment_sessions` (v25 table). Completely broken pre-v25.
- Phase 5 C2: `web_orders.active_shipment_id` is NULL for all pre-v25 orders; COD auto-match JOINs silently return zero matches.
- Phase 5 H2: `web_order_transactions` new columns not populated by non-webhook inserts in `routes/orders.js:576`.
- **Fix:** Add `ADD COLUMN IF NOT EXISTS` guards in v18 for the columns Phase 1 needs, OR fold the dependent Phase 1 code into v25. Then sweep every INSERT path for the 4 extended tables.

### Single-phase critical bugs

**Phase 1 C1** — EndlessAisleModal sends wrong body shape to `/api/orders/endless-aisle` — every endless-aisle order attempt from POS returns 400. Frontend/backend field names don't match at all.

**Phase 1 C2** — `/api/storefront/config` returns `companyName`/`logoUrl`/`currencySymbol` (camelCase); storefront frontend reads `company_name`/`logo_url`/`currency_symbol` (snake_case). Every storefront page shows the raw slug, no logo, wrong currency.

**Phase 2 C1** — `POST /api/draft-orders/:id/complete` returns the pre-UPDATE `draft` object. Response shows `status: "claimed"` after successful complete. Clients see inconsistent state.

**Phase 2 C2** — `POST /api/approvals/pos-authorize` has NO feature flag gate AND no `deleted_at IS NULL` filter on employee PIN lookup. Any tenant regardless of `phase2_pos_approvals`, and soft-deleted managers can still authorize.

**Phase 2 C3** — SQL injection in scheduled catalog worker: `backend/boot/workers.js:232` interpolates `change.field_name` (user-supplied) directly into UPDATE SQL. Any `all_access` user can pass `field_name = "deleted_at"` to mass-soft-delete products.

**Phase 3 C2** — Subscription cancel doesn't remove pending pg-boss renewal job. Mitigated by Phase 3 C1 (the job never runs anyway) but stale jobs accumulate.

**Phase 4 C2** — QR ordering completely broken: `routes/public-restaurant.js:17` queries `WHERE source_token_id = $1` but no code path ever sets `source_token_id`. Every QR menu request returns 404.

**Phase 4 C3** — KDS ticket/item JOIN creates one ticket per item but joins all items by `course_name`, so every ticket displays all items for that course. Kitchen sees every item 3× on every ticket in a 3-item course.

**Phase 5 C1** — `courier_integrations.encrypted_config_json` is added in v25 but NO adapter code reads it. `routes/couriers.js` still passes plaintext `api_key`/`api_secret` fields. The "secure credential storage" column is dead.

---

## The 11 high bugs

- **Pattern B (Flags seeded but never consumed)** — 7 flags across Phases 3/4/5: `subscription_autocharge`, `phase4_appointments_waitlists`, `phase4_appointments_classes`, `phase4_google_calendar_sync`, `phase4_contract_ai`, `phase4_restaurant_preauth`, `phase5_payment_gateways`. Each is a billing lever with no enforcement.
- **Pattern E (Multi-step flows without transactions)** — Phase 1 M2, Phase 2 M1, Phase 3 H1 (double-billing risk on crash), Phase 4 H2, Phase 4 H3.
- **Phase 1 H1** — `createReservation`/`releaseReservations` are exported but never called. The entire reservation system is dead code — no stock is held during cart browsing.
- **Phase 1 H2** — Reservation worker not registered in admin worker-status.
- **Phase 2 H1** — `smart-collections.js` uses `p.created_at` which doesn't exist on `products`.
- **Phase 2 H2** — Report builder ORDER BY on aggregate alias fails silently for customer_analysis dataset.
- **Phase 3 H2** — Campaign audience ignores `sms_consent`/`whatsapp_consent` (compliance bypass, latent until SMS delivery is wired up).
- **Phase 5 H1** — PakPost and Bykea adapter stubs return `{tracking_number: null}` instead of throwing. Orders appear "shipped" with null tracking.
- **Phase 5 H3** — `notifyCustomerSms` doesn't check `phase5_sms_providers` — billing/plan enforcement gap.

---

## Map coverage

- **9/10 blind spots confirmed and verified** with file/line details
- **1 genuine miss: #6 quotations tier4/crm.js** — Nobody verified that `routes/tier4/crm.js` quotation SELECTs return `converted_invoice_id` (v21), `project_id`, `estimate_status`, `approved_at`, `approved_by` (v24). Reason: tier4/ is pre-existing, outside every phase's scope boundary.
- **1 partial miss: #10 token entropy** — Public route auth bypass was checked, but `source_token_id` entropy wasn't verified. Moot until Phase 4 C2 is fixed.

---

## Contradictions resolved

1. **web_orders.active_shipment_id**: Phase 1 said "clean — expected." Phase 5 correctly called it a bug. Shared responsibility: Phase 1 should write the column when it writes `tracking_number`, AND Phase 5 auto-match should fall back to `tracking_number` join.
2. **draft_orders INSERT omission**: No substantive contradiction. v22 defaults make the structural concern benign. The real Phase 2 C1 is unrelated (stale draft object in complete response).
3. **payment_intents.provider**: Map was stale — Phase 5 H2 correctly verified that `billing.js` was updated. The actual gap is on `web_order_transactions` non-webhook inserts, not `payment_intents`.

---

## Fix ordering (sequencing graph)

**Fix these first, in order:**
1. **Phase 1 M1** (schema-pg.sql static snapshot FK ordering) — blocks every fresh install test
2. **Phase 2 C3** (SQL injection) — independent, immediate
3. **Pattern D** (v25 column gaps) — blocks Pattern A; otherwise workers hit different error classes
4. **Pattern A** (worker tenant routing) — unblocks Phase 3 C1, Phase 4 C1, Phase 1 H2 simultaneously

**Then fix these in parallel (no cross-dependencies):**
- Phase 1 C1, C2 (frontend/backend contract fixes)
- Phase 2 C1 (draft-orders complete stale state), C2 (pos-authorize gate + filter)
- Phase 4 C2 (source_token_id), C3 (KDS ticket JOIN) — fix C3 first within this pair
- Phase 5 C1 (encrypted_config_json) — unblocks P1 couriers.js cleanup
- Phase 1 H1 + M2 together (reservation wiring + TOCTOU)
- Pattern B (feature flag audit script)
- Pattern E (transaction wrapping across 5 spots)
- Pattern C (SQL column allowlist helper for the 2 sites)

---

## Recommended next actions

1. **Read** the full [synthesis report](.claude/reviews/findings/cross-phase-synthesis.md) and individual [phase findings](.claude/reviews/findings/).
2. **Decide** whether to fix Pattern A + Pattern D first (highest leverage) or triage by phase.
3. **Audit** the missed seam #6 (quotations tier4) manually — one grep of `routes/tier4/crm.js` for SELECT shape is enough.
4. **Consider** adding a CI check that cross-references `DEFAULT_FEATURE_FLAGS` keys against `requireFeature` call sites — this would have caught Pattern B before it shipped.
