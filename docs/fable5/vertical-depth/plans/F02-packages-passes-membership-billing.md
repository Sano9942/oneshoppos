# F02 — Packages / Session Passes + Membership-Billing Hardening

**Covers:** the single missing package/pass entity (cross-cutting observation #3 in [../README.md](../README.md)) — n-session packs with a credit balance, sold once and redeemed over time — plus hardening of the existing recurring-membership billing engine it sits next to (dunning, calendar-month billing).
**Modes/flags:** new flag `packages_passes` (default OFF; enabled by salon/gym/physio presets — V04/V07/V05 decide seeding). Billing hardening lives under existing `subscription_billing`.
**Surfaces:** POS (sell + redeem) · public booking (redeem) · portal ("My Packages") · admin
**Closes findings rows:**
- [05-salon](../findings/05-salon.md) → "Packages / session packs / memberships" (P1)
- [08-gym](../findings/08-gym.md) → "Session packs (n-class/PT passes with balance)" (P1), "Failed-payment dunning" (P1 partial)
- [06-clinical](../findings/06-clinical.md) → physio session bundles (folded into its "needs" list; consumed by V05)
**Depends on:** F06 (appointment↔sale link + class bookings are the redemption points; the pass entity itself has no dependency and can be built in parallel, redemption wiring lands after F06).
**Consumed by:** V04 (salon), V05 (physio), V07 (gym).
**Branch:** backend + schema off `main`; new portal tab + POS redemption UI ride `redesign/square`.
**Model:** **Opus, effort high.** The design below is fully specified including the locking pattern; execution is consuming it. Apply [[feedback_audit_ledger_before_building]] — the credit balance is a ledger; audit reconciliation (credits_total − Σredemptions = remaining) in tests before UI.

---

## Design

A package is a purchasable entitlement: N credits, valid for services in scope, expiring after X days. Redemption decrements credits instead of charging money at the redemption point.

### Schema (pause-list at execution)

```sql
CREATE TABLE package_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),        -- 10-class pass, 5 facials
  validity_days INTEGER,                               -- NULL = never expires
  service_scope TEXT NOT NULL DEFAULT 'any'
    CHECK (service_scope IN ('any','listed')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE package_template_services (               -- scope='listed'
  package_template_id INTEGER NOT NULL REFERENCES package_templates(id) ON DELETE CASCADE,
  booking_service_id INTEGER NOT NULL REFERENCES booking_services(id),
  PRIMARY KEY (package_template_id, booking_service_id)
);
CREATE TABLE customer_packages (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  package_template_id INTEGER NOT NULL REFERENCES package_templates(id),
  sale_id INTEGER REFERENCES sales(id),                -- how it was bought
  credits_total INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used <= credits_total),
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','expired','refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE package_redemptions (
  id SERIAL PRIMARY KEY,
  customer_package_id INTEGER NOT NULL REFERENCES customer_packages(id),
  credits INTEGER NOT NULL DEFAULT 1,
  appointment_id INTEGER REFERENCES appointments(id),
  class_session_booking_id INTEGER REFERENCES class_session_bookings(id),
  sale_id INTEGER REFERENCES sales(id),
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  reversed_at TIMESTAMPTZ                              -- cancellation gives the credit back
);
```

Invariant (test-enforced): `credits_used = Σ redemptions.credits WHERE reversed_at IS NULL`, updated in the same transaction as the redemption row, `SELECT … FOR UPDATE` on `customer_packages`.

## Tasks

### P0 — the entity + sale + redemption loop
1. Schema above + `packages_passes` flag. PAUSE for approval.
2. `routes/packages.js` — template CRUD (manager+), `POST /api/customers/:id/packages` (sell — normally invoked from the POS sale path), `GET /api/customers/:id/packages` (balances), `POST /api/packages/:id/redeem` + `/reverse`. Redeem = transaction: lock package row FOR UPDATE → check status/expiry/scope/remaining → insert redemption → bump credits_used → flip status to `exhausted` when full.
3. **Sell at POS** — package templates surface as a sellable tile (dedicated section in POS search, like gift cards); sale line type `package` on `sale_items` (follow the gift-card sale-line precedent in `routes/sales.js` — grep `gift_card` in the sale insert path); on sale commit, insert `customer_packages` (requires customer on the sale — reject anonymous).
4. **Redeem at checkout** — POS: when a customer with an active in-scope package checks out a matching service line, offer "pay with package" → line price 0 + redemption row linked to `sale_id` (+ `appointment_id` when F06's checkout link is live). Commission attribution unchanged — the redeemed service still carries its provider.
5. **Portal "My Packages" tab** — remaining credits + history; extend `PORTAL_ENABLED_TABS_BY_PRESET` for salon/gym/physio (`industry-config.js:729+`), respecting completion-01's flag-defaults-merge lesson (portal must merge `DEFAULT_FEATURE_FLAGS`, [[cross_surface_traps_plan01]] trap 2).

### P1 — membership billing hardening (existing engine)
6. **Dunning worker** — `workers/subscription-dunning-worker-boss.js` (new, standard worker checklist in backend/CLAUDE.md): failed `subscription_runs` (`charge_status='failed'`) → retry at +1d/+3d/+7d via `paymentGateway.chargeSavedInstrument`, notify member each attempt (via F05 once landed; `enqueueEmail` directly until then), auto-`pause` the subscription + notify after final failure. Admin "failed payments" list on the subscriptions page.
7. **Calendar-month billing** — `services/subscriptions.js:computeNextPeriod` uses `INTERVAL_DAYS = { monthly: 30 … }` (subscriptions.js:7-17). Change to calendar-anchored (add months, clamp day-of-month: Jan 31 → Feb 28). **Migration note:** existing `next_renewal_at` values stay as-is; only future computations change. Guard with unit tests for month-end anchors.
8. Class/appointment cancellation → automatic redemption reversal (hook into F06 cancellation paths).

### P2
9. Package gifting/transfer between customers (admin action + activity log).
10. Low-balance nudge ("1 credit left — rebook") via F05.

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| Balance ledger w/ lock | `routes/gift-cards.js` redeem transaction | gift-cards.js:331-370 (`FOR UPDATE`, validate, debit, ledger) — copy this exact shape |
| Sellable non-product line at POS | gift-card sale-line handling in `routes/sales.js` | grep `gift_card` sales.js:1581 |
| Recurring charge | `services/payment-gateway.js:chargeSavedInstrument` | payment-gateway.js:96,327 |
| Renewal job dedupe | pg-boss `singletonKey` pattern | services/CLAUDE.md subscriptions notes |
| Worker scaffold | any `workers/*-worker-boss.js` + backend/CLAUDE.md checklist | e.g. `subscription-grace` (SaaS-level twin) |

## Harden what's built

- **P0 — billing drift**: `subscriptions.js:7` `monthly: 30` days. Failure: a gym member enrolled on the 1st is billed on the 31st, 30th, 29th… — 12.17 charges per year, and by month 7 the "monthly" charge lands mid-month; owners reconcile against calendar months and see phantom extra revenue then complaints. (Task 7 fixes.)
- **P0 — failed charge is a silent dead end**: `services/subscriptions.js:processRenewal` records `charge_status='failed'` + `error` on `subscription_runs` and stops — no retry, no member notification, no status change (findings [08-gym](../findings/08-gym.md) partial row; confirmed no dunning worker in `workers/`). Failure: expired card → member trains free indefinitely while dashboard shows "active"; owner discovers at month-end. (Task 6 fixes.)
- **P1 — pause/resume vs renewal race**: `pauseSubscription` and the renewal job are independent writers to the same row; a pause landing between job schedule and job execution can still charge. Executor: renewal job must re-read status FOR UPDATE and skip if not `active` (verify current code before assuming — [[feedback_verify_before_fixing]]).
- **P1 — refunding a package sale**: `routes/returns.js` has no concept of a package line; refunding the sale would leave an active `customer_packages` row. Define: return of a package line requires zero redemptions (else block with error) and flips status to `refunded`.

## Cross-surface lens
- **Pricing:** a package-redeemed line is price 0 but must still snapshot tax correctly (zero-amount line through `tax-snapshot.js`) — confirm zero lines don't break FBR payload builders (`services/fbr.js` buildInvoicePayload).
- **Auth/visibility:** portal shows only own packages (customer-auth scoping — mirror `customer-portal/treatments.js` pattern).
- **Notifications:** dunning + low-balance ride F05; until F05 lands, direct `enqueueEmail`.
- **Reports:** liability view (outstanding unredeemed credits × value) is a P2 accounting question — flag to user, don't invent revenue-recognition policy.

## Verification bar
- Test tenant: fresh `gym` (+ spot-check salon labels).
- Walkthrough: create 10-class template → sell at POS to a member → portal shows 10 remaining → redeem at a class booking (post-F06) and at a plain POS service checkout → balance 8 → cancel one class → reversal → 9 → expire via clock-shift → status `expired`, redemption rejected with clear error → refund attempt on partially-used package blocked.
- Concurrency: two parallel redeems on a 1-credit package — exactly one succeeds (scripted).
- Billing hardening: sandbox-gateway member with failing token → 3 dunning attempts on schedule → auto-pause + notification logged ([[sanopay_sandbox]]).
- Ledger audit: `credits_used` reconciles with redemption rows after the whole walkthrough.
