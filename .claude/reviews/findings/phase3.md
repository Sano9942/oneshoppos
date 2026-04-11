# Phase 3 review — Customer Engagement & Billing

## Summary
- Files reviewed: 32 (all in scope)
- Critical findings: 2
- High findings: 2
- Medium findings: 3
- Low/pattern findings: 2

---

## Critical findings

### C1 — Subscription renewal / scheduled campaign / invoice reminder workers query wrong schema (public instead of tenant)
**File**: `backend/workers/email-worker-boss.js:358–369` (subscription-renewal), `343–355` (campaign-scheduled-send), `292–340` (invoice-reminder)
**Seam**: Cross-phase with pre-existing code (multi-tenant DB routing architecture)
**Finding**: All three Phase 3 worker handlers construct a bare `db` shim: `{ query: (sql, params) => pool.query(sql, params) }`. This shim issues queries against the shared `pool` with no `search_path` set — all queries land on the `public` schema. But `customer_subscriptions`, `marketing_campaigns`, `marketing_campaign_deliveries`, `customer_invoices`, and `customer_invoice_reminders` all live in `tenant_<slug>` schemas, not public. Every renewal, scheduled campaign, and invoice reminder silently fails with "relation does not exist" OR returns undefined (when the worker handler swallows errors). **Every Phase 3 scheduled-worker feature is broken on every tenant.**

The pre-existing `billing-lifecycle-check` worker correctly reads from `public.tenants` and explicitly iterates tenant slugs. The Phase 3 additions did not follow this pattern.

**Reproduction**: Create a subscription for any tenant. Wait for the `subscription-renewal` pg-boss job to fire. The handler calls `processRenewal(db, boss, subscriptionId)` with a bare `pool.query` db shim → `SELECT … FROM customer_subscriptions WHERE id = $1` executes against `public` → no rows → worker logs "Subscription not found" → subscription never renews, no invoice created.

**Evidence**:
```js
// email-worker-boss.js:362 — subscription worker
const db = { query: (sql, params) => pool.query(sql, params) };
await processRenewal(db, boss, subscriptionId);
```

**Fix direction**: Either (a) use `forEachActiveTenant` pattern like `billing-lifecycle-check`, or (b) use the AsyncLocalStorage-aware `deps.db` proxy. Each job payload should include `tenant_slug` so the worker can set search_path before querying.

---

### C2 — Cancel subscription never removes pending pg-boss renewal job
**File**: `backend/services/subscriptions.js:97–103` (`cancelSubscription`)
**Seam**: In-phase
**Finding**: `cancelSubscription` only sets `status = 'cancelled'`. The pending `subscription-renewal` pg-boss job scheduled at creation (or last renewal) is NOT cancelled. When it fires, `processRenewal` checks `sub.status !== 'active'` and skips — so data integrity is preserved — but the job wastes resources and there is no `boss.cancel()`. Also because C1 means the worker never sees the subscription row anyway, the "protection" from the status check doesn't actually execute on tenant subscriptions.

---

## High findings

### H1 — processRenewal has no transaction wrapping — partial writes cause double-billing
**File**: `backend/services/subscriptions.js:27–92`
**Seam**: In-phase
**Finding**: Five sequential writes with no transaction: INSERT invoice, INSERT items, INSERT subscription_run, UPDATE customer_subscriptions, boss.send next renewal. If the server crashes between invoice insert and period update, the subscription's `current_period_end` stays at the old value. Next run finds it still active at the same `nextEnd`, creates a **duplicate invoice** → customer double-billed.
**Reproduction**: Kill the server process between `INSERT INTO customer_invoices` and `UPDATE customer_subscriptions SET current_period_start = $1`. Next run creates a second invoice for the same period.

---

### H2 — Campaign audience for SMS/WhatsApp channels ignores sms_consent / whatsapp_consent (compliance bypass)
**File**: `backend/services/marketing.js:122–125`
**Seam**: In-phase
**Finding**: `resolveAudience` correctly gates `has_email` on `email_consent = true` and `has_mobile` on `sms_consent = true`. But `enqueueCampaignSend` re-queries the audience filtering ONLY on `email IS NOT NULL AND email_consent = true` regardless of the campaign's channel. SMS/WhatsApp campaigns would either pull email-consented-only audience (wrong set) OR, when SMS delivery is wired up, send to customers without checking their SMS consent. The current implementation only delivers email for all channels (so the consent violation is latent), but the bypass path is in the code and will activate when SMS delivery is implemented.
**Reproduction**: Create a campaign with `channel = 'sms'`. POST `/api/marketing/campaigns/:id/send`. The audience query filters on email consent, not SMS consent.

---

## Medium findings

### M1 — V2: Phase 3 pg-boss queues piggyback on EMAIL_WORKER_ENABLED — no independent toggle, no schema-version guard
**File**: `backend/workers/email-worker-boss.js:217–220`
**Seam**: Cross-phase with pre-existing code
**Finding**: All four Phase 3 queues register inside `registerEmailWorker` whenever `EMAIL_WORKER_ENABLED=1`. No separate env var, no v21 migration check. Any tenant without v21 applied will have workers try to query missing tables — though in practice the C1 bug hides this because all queries already miss.

### M2 — V8: Consent column defaults to false — existing customers silently unsubscribed after v21 migration
**File**: `backend/migrate-pg.js:1585–1587`, `backend/schema-pg.sql:302–304`
**Seam**: Cross-phase with pre-existing code
**Finding**: v21 adds `email_consent BOOLEAN DEFAULT false`. All existing customers post-upgrade have `email_consent = false` with no backfill path. A tenant with 500+ existing customers loses their entire marketing list with no warning. Compliance-wise `false` is correct (explicit opt-in), but no migration comment / admin notification warns about this effect.

### M3 — V1: subscription_autocharge flag seeded and stored but never enforced
**File**: `backend/migrate-pg.js:1847`, `backend/routes/subscriptions.js`, `backend/services/subscriptions.js`
**Seam**: In-phase
**Finding**: `subscription_autocharge` is seeded in v21 and in `DEFAULT_FEATURE_FLAGS`. No route calls `requireFeature("subscription_autocharge")`. `processRenewal` always creates an invoice regardless of the `auto_charge` field or the flag state. The `auto_charge` column exists and is accepted on POST but has no behavior attached.

---

## Low / design drift patterns

### P1 — Audit log inserts are fire-and-forget (try/catch swallowing) outside mutation transactions
**Affected files**: `backend/routes/marketing.js:65,145,170`, `customer-invoices.js:122,233,260,377`, `subscriptions.js:164,177,191,204`, `messaging.js:132`
**Description**: Every Phase 3 mutation wraps the `INSERT INTO action_history` call in `try {} catch {}` that silently discards errors. Not inside the same transaction as the mutation. DB errors or schema mismatches cause audit records to be silently dropped while the mutation commits.
**Why it matters**: An audit log that can silently disappear is not a reliable audit trail.

### P2 — Invoice number generation uses non-atomic `MAX(id) + 1` — race condition under concurrent load
**Affected files**: `backend/services/customer-invoicing.js:10–15`
**Description**: `generateInvoiceNumber` runs `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM customer_invoices` without a row lock or sequence. Two concurrent invoice creations see the same MAX(id), generate the same `INV-XXXXXX` number. Actual id is unique (SERIAL) but `invoice_number` collides.
**Why it matters**: Duplicate invoice numbers fail regulatory requirements.

---

## Cross-phase observations
- `services/booking-reminders.js` (Phase 4): `processPendingReminders` exported with zero callers — dead code. (Map already flagged.)
- `routes/customer-invoices.js:354–358`: `provider` column populated at payment-link creation using `process.env.PAYMENT_GATEWAY || "manual"`. v25's extension of `customer_invoice_payment_links.provider` is additive — this seam is clean.

---

## Seams verified clean
- V3 (payment_gateway provider column): `customer-invoices.js` creates `customer_invoice_payment_links` rows, NOT `payment_intents`. No conflict with v25's `payment_intents.provider`.
- V4 (quotations converted_invoice_id): correctly set after invoice creation.
- V6 (messaging thread N+1): uses scalar subquery for `last_message`, no N+1.
- V6 (messaging feature flag on writes): both reads and writes gated by `requireFeature("customer_messaging")`.
- customers table ALTER TABLE: all new columns have defaults, pre-existing INSERTs unaffected.
- payment-gateway `createInvoiceCheckout` return shape matches Phase 1 caller. Clean.
- services/crypto.js: not touched. Clean.
- draft_orders: not touched. Clean.
