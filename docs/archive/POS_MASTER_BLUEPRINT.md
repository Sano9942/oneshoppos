# SanoPOS Complete Production Blueprint (Retail POS Hardening + Card Terminal + Pilot Rollout)

## Summary
This plan hardens your existing SanoPOS into a production-grade retail POS for real stores, using your current architecture (React + Express + SQLite), while staying SaaS-ready for later migration.  
It is decision-complete for: scope, data model, APIs, edge cases, security/compliance, testing, rollout, and go-live gates.

Primary outcome: one pilot-ready outlet deployment with stable sales/returns/shifts, integrated core hardware, card terminal flow, controlled offline queue-and-sync, and measurable operational reliability.

## Locked Decisions
- Plan focus: Production hardening first.
- Business model: General retail POS.
- Payment scope: Cash + card terminal.
- Tenancy direction: Single-tenant now, SaaS-ready patterns enforced.
- Offline: Queue-and-sync lite (not full offline-first).
- Rollout: Pilot-first with explicit go/no-go gates.
- Compliance target: PCI-aligned app controls (not formal certification in this phase).
- Hardware target: Barcode scanner + receipt printer + cash drawer + card terminal.
- Receipt channels: Print required, PDF available, SMS/Email optional.

## Current Baseline (from repo)
- Core POS workflows exist: sales, returns/exchange, shifts, kiosk attendance, outlet context checks.
- RBAC and outlet-assignment enforcement are present.
- Test baseline is strong (integration + unit + E2E) with mature shift/POS coverage.
- POS redesign state management already supports gates, recent sales, parked sales, checkout, and return modal.
- SaaS conversion intent exists in docs; architecture already uses DB dependency injection in route registration.

## Scope
In scope:
- Transaction integrity hardening across sales/returns/shifts/payments.
- Card terminal integration with safe failure handling.
- Offline queue-lite for controlled checkout continuity.
- Core hardware support and receipt unification.
- Security/audit hardening aligned to PCI patterns.
- Operational rollout plan with monitoring, runbooks, and pilot governance.

Out of scope for this roadmap:
- Full multi-tenant runtime cutover.
- Formal PCI certification project.
- Restaurant/table-service workflows.
- Advanced hardware fleet (scale/customer display) beyond core devices.

## Target Architecture Additions
1. Checkout Orchestration Layer
- Introduce a server-side �transaction orchestration� flow that owns checkout state transitions and idempotency.
- Move critical ordering logic from UI assumptions into backend-validated flow contracts.

2. Payment Abstraction Layer
- Add provider-agnostic terminal payment module (uthorize, capture, cancel, status).
- Keep card details out of app storage and logs; store provider references only.

3. Offline Queue Lite
- Local queue for pending sales when connectivity drops.
- Strict constraints: cash-only allowed offline; card requires online terminal confirmation.
- Deterministic sync with idempotency keys and conflict resolution rules.

4. Hardware Adapter Layer
- Encapsulate printer/drawer/scan behaviors behind adapter interfaces.
- Support graceful fallback and operator prompts for manual recovery.

## Public API / Interface Changes
New or extended backend interfaces:
1. POST /api/checkout/session
- Input: outlet, employee, cart snapshot, customer, discounts, note.
- Output: checkout_session_id, normalized totals, validation flags.

2. POST /api/checkout/session/:id/payments
- Input: payment intents (cash, card_terminal), split allocations.
- Output: accepted tenders, due/overpay state, required next actions.

3. POST /api/checkout/session/:id/complete
- Input: idempotency key, terminal reference(s), receipt preference.
- Output: committed sale id, invoice number, receipt artifacts.

4. POST /api/payments/terminal/intents
- Input: amount, currency, outlet, operator.
- Output: provider intent id, status, timeout window.

5. POST /api/payments/terminal/intents/:id/cancel
- Output: canceled/terminal-finalized status with reason.

6. GET /api/payments/terminal/intents/:id/status
- Output: authoritative provider status for reconciliation/retry UI.

7. POST /api/offline/sales/enqueue
- Input: signed local payload + idempotency key.
- Output: queue acceptance token.

8. POST /api/offline/sales/sync
- Input: batch queued payloads.
- Output: per-item results (committed, duplicate, ejected_conflict, 
eeds_manual_review).

9. GET /api/receipts/:sale_id
- Output: print payload + PDF URL + delivery status.

Frontend contract changes:
- POS context uses checkout session lifecycle (draft -> payment_pending -> payment_authorized -> committed).
- New terminal state UI (waiting, pproved, declined, 	imeout, canceled).
- New offline queue badge + retry panel + manual conflict review screen.

## Data Model / Migration Plan
Add tables:
- checkout_sessions
- checkout_session_items
- payment_intents
- payment_attempts
- device_registry
- eceipt_jobs
- offline_sales_queue
- offline_sync_events
- udit_events (if existing audit table is insufficient)

Add/adjust columns:
- sales.idempotency_key (unique by outlet/day scope or global depending strategy)
- sales.checkout_session_id
- sale_payments.payment_reference (terminal/provider reference)
- cash_shifts.reconciliation_status (open/closed/review_required)
- eturns.reference_sale_item_hash (optional stronger anti-fraud linkage)

Indexes:
- Fast lookups for outlet/date, idempotency key, payment intent status, queue state, and shift reconciliation queries.

Compatibility:
- Backward-compatible migrations only.
- Existing endpoints remain functional during transition, then gradually routed through orchestration.
- Feature flags control staged activation by outlet.

## Implementation Phases

## Phase 0: Spec Lock + Risk Register
- Produce a single POS_MASTER_BLUEPRINT.md in repo docs.
- Define canonical transaction state machine and failure semantics.
- Finalize pilot outlet profile (devices, staff count, expected TPS, peak windows).
- Exit gate: all open decisions resolved and signed off.

## Phase 1: Transaction Integrity Hardening
- Centralize checkout commit path server-side with DB transaction boundaries.
- Enforce idempotency for complete endpoint.
- Validate totals server-side from item lines, discounts, tax rules.
- Enforce shift-open + attendance-clocked-in checks at final commit.
- Exit gate: deterministic commits under retries and concurrent requests.

## Phase 2: Card Terminal Integration
- Implement provider adapter and terminal intent lifecycle.
- Add timeout/cancel/retry policies and reconciliation endpoint.
- Ensure partial/split tender correctness (cash + card).
- Block completion when card is unresolved unless explicit fallback rule triggers.
- Exit gate: simulated and real device flows pass for success/decline/timeout.

## Phase 3: Offline Queue-and-Sync Lite
- Add local queue on frontend for temporary offline sale capture.
- Allow offline commit only for configured tender types (default: cash-only).
- Implement sync endpoint with idempotency and conflict tagging.
- Add operator review workflow for rejected/conflicted items.
- Exit gate: recovery from 30-60 min outage without double posting.

## Phase 4: Hardware and Receipt Workflow
- Integrate printer + cash drawer trigger + scanner compatibility checks.
- Add printable payload standard and PDF generator path.
- Add optional SMS/Email receipt dispatch with retry and status.
- Add �hardware degraded mode� prompts and fallback actions.
- Exit gate: end-to-end sale can print reliably and recover from print failure.

## Phase 5: Security and Compliance Hardening
- Remove sensitive data exposure from logs/events/errors.
- Add strict audit trails for sale edits, voids, returns, shifts, and overrides.
- Tighten RBAC for void/refund/discount override thresholds.
- Add session controls and optional forced PIN change policies.
- Create PCI-aligned control checklist mapped to implementation evidence.
- Exit gate: security checklist and audit traceability complete.

## Phase 6: Observability, Runbooks, and Pilot Readiness
- Metrics: checkout latency, payment success rate, queue depth, sync lag, shift variance rate.
- Alerts: payment intent stuck, queue growth, receipt failures, repeated reconciliation mismatches.
- Runbooks: terminal down, internet down, printer down, shift mismatch, duplicate sale dispute.
- Pilot config rollout using feature flags by outlet.
- Exit gate: operations can run one full business day via runbooks only.

## Phase 7: Pilot Rollout and Expansion Gate
- Run pilot at one outlet for 2-4 weeks.
- Weekly quality review against acceptance KPIs.
- Fix criticals before enabling second outlet.
- Post-pilot decision document for scale-up sequence.
- Exit gate: all mandatory KPIs met for 2 consecutive weeks.

## Test Plan and Acceptance Scenarios
Unit:
- Money math precision, discount/tax stacking, rounding invariants.
- Idempotency key behavior.
- Payment intent state transitions.
- Offline conflict classifier.

Integration:
- Sale commit with concurrent retries.
- Split tender and card fallback paths.
- Shift open/close reconciliation with returns mixed in.
- Outlet assignment and RBAC deny paths.
- Receipt generation + delivery job retries.

E2E:
- Open day -> clock-in -> open shift -> sell (cash/card) -> return/exchange -> close shift.
- Card decline then cash fallback.
- Internet loss during checkout then queue/sync recovery.
- Printer unavailable then manual fallback and receipt reprint.
- Manager override and audit evidence visible.

Non-functional:
- Load test checkout peak (target transactions/minute for pilot).
- Soak test queue sync after prolonged outage.
- Recovery test for backend restart mid-payment intent polling.

UAT:
- Cashier SOP validation using your User_Manual.md daily sequence.
- Manager reconciliation and variance handling.
- Auditor trace test from invoice to payment to shift to logs.

## Rollout and Monitoring Gates
Gate A (internal QA): 0 critical defects, all P0/P1 tests green.
Gate B (pilot start): runbooks published, alerting active, support ownership defined.
Gate C (pilot continue): weekly KPI thresholds met.
Gate D (expand): no unresolved reconciliation defects, no duplicate-posting incidents, payment success and checkout latency within target.

Core pilot KPIs:
- Checkout success rate.
- Card authorization success/decline ratio by reason.
- Duplicate transaction rate.
- Offline queue max age and sync success.
- Shift variance frequency and median variance.

## Assumptions and Defaults
- Currency and denominations continue to be configurable per business profile.
- Existing SQLite stack remains for this hardening cycle.
- Card processing uses terminal token/reference model; no PAN storage in app.
- Offline queue supports controlled outage windows, not indefinite offline mode.
- Existing route surfaces remain available until orchestration flow fully adopted.
- Pilot geography/timezone behavior continues to use existing timezone utility approach.
- Existing strong test culture is retained and expanded, not replaced.

## Deliverables
- docs/POS_MASTER_BLUEPRINT.md with architecture, flows, schemas, SOPs.
- API contract document for new checkout/payment/offline endpoints.
- Migration scripts and compatibility notes.
- Test matrix and execution scripts per phase.
- Pilot runbook pack and KPI dashboard definition.
