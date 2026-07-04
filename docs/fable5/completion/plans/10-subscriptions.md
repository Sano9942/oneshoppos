# 10 — Subscriptions mode

**Covers:** mode `subscriptions` + preset `gym` (booking surface in plan 03)
**Modes/flags in scope:** `subscription_billing`
**Surfaces touched:** admin app · POS (enrollment/renewal payment) · customer portal (subscriptions tab)
**Branch strategy:** backend/wiring off `main`.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Plan/membership catalog | `SubscriptionsRedesign` | `/api/subscriptions*` | `subscriptions.js` (mode `subscriptions` + flag `subscription_billing`) | plan (price, interval) persists; gym "Plans" vocab | ☐ |
| Enroll member | subscriptions page / POS | create endpoint | `services/subscriptions.js` (`computeNextPeriod`) | period math: monthly=30d, quarterly=90d, yearly=365d (fixed-day, not calendar — verify UX copy matches) | ☐ |
| Renewal | (worker) | — | `processRenewal` via pg-boss (`singletonKey` = `${subscriptionId}:${date}`) | renewal invoice generated once (no dupes across worker restarts); requires `tenantSlug` | ☐ |
| Pause / resume / cancel | subscription detail | endpoints | `pauseSubscription`/`resumeSubscription`/`cancelSubscription` | period end honored; no renewal after cancel | ☐ |
| Renewal payment | POS / portal | invoice payment | `customer-invoicing.js` | payment clears renewal invoice; overdue state visible | ☐ |
| Portal: my memberships | `PortalDashboard` subscriptions tab (label "My Memberships") | `customer-portal/data.js` (tab → `subscription_billing`, mapping correct — `data.js:31`) | — | member sees plan, next renewal, pay CTA | ☐ |
| Attendance gate (gym) | kiosk / POS | — | — | expired membership visible at check-in (if designed — confirm) | ☐ |

## Defects (P0) — confirmed broken wiring
- None confirmed from this run's tool results.

## Feature-parity gaps (P1)
- **Subscriptions** ✅ §7 at parity. Only checklist proof needed.

## Polish & consistency (P2)
- Interval semantics (30/90/365 days vs calendar months) surfaced honestly in UI copy.
- Member/Enrollment vocab through POS + receipts.

## Confirm during execution
- Renewal worker enabled in prod (env toggle) and heartbeat visible in `/api/admin/worker-status`.
- Failed-renewal dunning: what happens when a renewal invoice stays unpaid (grace? suspend?) — map actual behavior.
- Proration on mid-period cancel (likely none — confirm and document).

## Cross-surface lens (mandatory)
- **Invoicing** → renewal invoices share the AR engine (balance recompute, statements).
- **Tax** → subscription invoices in the 01 diff.
- **Portal** → membership state consistent with admin view after pause/cancel.

## Verification bar (execution)
- Test tenant: fresh `gym` signup.
- Walkthrough: plan → enroll → force a renewal (short interval / manual trigger) → pay → pause → resume → cancel → portal reflects each state.
- Done = rows ☑ + verifier confirms.

## Preset-skin checklist
- `gym` — [ ] labels (Plan/Member/Enrollment) [ ] dashboard (appointments_today for classes) [ ] onboarding membership step (01-D2) [ ] portal tabs (subscriptions "My Memberships"/invoices/appointments "Class Bookings"/profile)
