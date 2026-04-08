# Payment Integration — Design

**Date:** 2026-03-30
**Status:** Approved
**Branch:** `feature/payment-integration`

---

## Problem

Payments are fully manual — admin records each payment in the admin panel. This doesn't scale for self-service signups. The trial system (Phase 1) creates urgency to pay, but there's no way for tenants to actually pay online.

## Decision

Fully automated one-time payments via redirect checkout. Gateway-abstracted (xPay first, Stripe later). No auto-recurring — tenant pays manually each month via a "Pay Now" button.

---

## 1. Payment Flow

```
Tenant clicks "Pay Now" on /billing
  │
  ├─ Frontend: POST /api/billing/create-checkout
  │   Body: { plan: "pro", cycle: "monthly" }
  │
  ├─ Backend: calculates amount (PKR 8,000 × outlet_count from tenant record)
  │   Creates a pending payment_intents row
  │   Calls gateway adapter to create checkout session
  │   Returns { checkout_url, payment_intent_id }
  │
  ├─ Frontend: window.location.href = checkout_url
  │   (tenant leaves SanoPOS → gateway hosted page)
  │
  ├─ Tenant pays via JazzCash / EasyPaisa / card / bank
  │
  ├─ Gateway redirects back to: sanopos.com/billing?payment=success&intent=xxx
  │   (or ?payment=cancelled)
  │
  ├─ Gateway sends webhook: POST /api/webhooks/xpay
  │   Backend verifies signature (HMAC)
  │   Looks up payment_intents row by gateway_ref
  │   If confirmed:
  │     → payment_intents.status = 'completed'
  │     → tenants.payment_status = 'active'
  │     → tenants.plan_expires_at = NOW() + 30 days (or 365 for annual)
  │     → Insert payment_records row
  │     → Send "payment confirmed" email
  │
  └─ Frontend: on mount, detect ?payment=success in URL
      Poll /api/billing/status every 2s for up to 30s
      When payment_status changes to 'active' → success toast
      Timeout → "Payment is being processed, check back shortly"
```

### Key Principles

- **Webhook is source of truth** — never activate based on redirect URL alone (user could fabricate it)
- **Idempotent** — if webhook fires twice, check `payment_intents.status`; if already `completed`, return 200 without reprocessing
- **Gateway-abstracted** — billing routes call a gateway adapter, never talk to xPay directly

---

## 2. Payment Model

- **One-time payments** — tenant pays when due, no auto-recurring
- **30 days from payment** — pay on March 30 → active until April 29. Period drifts with late payments.
- **Per-outlet pricing** — PKR 8,000/month × number of outlets on the tenant record
- **Manual outlet expansion** — customer contacts support, admin bumps `max_outlets`, next payment reflects new count

---

## 3. Paid Subscription Expiry

Same state machine as trial expiry, with different email tone:

```
active (paid) + plan_expires_at approaching
  │
  ├─ 7 days before: Send "renewal_due" email (24h dedup)
  │
  ▼ plan_expires_at reached
  │
  ├─ payment_status = 'grace'
  ├─ grace_ends_at = plan_expires_at + 7 days
  ├─ Send "renewal_overdue" email
  │
  ▼ grace_ends_at reached
  │
  ├─ payment_status = 'expired'
  ├─ Send "account_locked" email (existing template — works for both trial and paid)
  │
  └─ WRITE-LOCKED (same as trial expiry)
```

### Email Tone Distinction

| Scenario | Email tone |
|----------|-----------|
| Trial expiry | "Your trial ended, subscribe to continue" — prospect language |
| Paid expiry | "Your subscription is due, renew to continue" — existing customer language |

Detection: check if `payment_records` exist for the tenant. If yes → renewal language. If no → trial/first-time language.

---

## 4. Database Changes

### New table: `payment_intents` (public schema)

```sql
CREATE TABLE payment_intents (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency_code   TEXT DEFAULT 'PKR',
  plan            TEXT NOT NULL,
  cycle           TEXT NOT NULL,
  outlet_count    INTEGER DEFAULT 1,
  status          TEXT DEFAULT 'pending',  -- pending | completed | failed | cancelled
  gateway         TEXT NOT NULL,           -- 'xpay' | 'stripe' | 'manual'
  gateway_ref     TEXT,                    -- gateway's transaction/session ID
  gateway_data    JSONB,                   -- raw webhook payload for debugging
  return_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

### Existing tables — no changes

- `tenants` — already has `payment_status`, `plan_expires_at`, `grace_ends_at`
- `payment_records` — stays as clean payment ledger (confirmed payments only)
- `upgrade_requests` — stays for manual upgrade requests (still useful as fallback)

### Migration v11

---

## 5. Gateway Adapter

```javascript
// services/payment-gateway.js

class PaymentGateway {
  // Create a hosted checkout session
  async createCheckout({ amount, currency, reference, returnUrl, cancelUrl })
    // Returns: { checkout_url, gateway_ref }

  // Verify webhook signature
  async verifyWebhook(headers, rawBody)
    // Returns: { valid, event_type, transaction_id, status, amount }

  // Poll payment status (fallback if webhook delayed)
  async getPaymentStatus(gateway_ref)
    // Returns: { status, amount, gateway_data }
}
```

Start with xPay adapter. Add Stripe adapter later. Billing routes call the adapter interface — never import xPay SDK directly.

**Configuration:** Gateway selection and credentials via environment variables:
- `PAYMENT_GATEWAY=xpay` (or `stripe`, or `manual`)
- `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (future)

When `PAYMENT_GATEWAY` is not set or set to `manual`, the "Pay Now" button is hidden and payments remain admin-only. This lets you deploy the code before having xPay credentials.

---

## 6. Backend Files

### New files

| File | Purpose |
|------|---------|
| `services/payment-gateway.js` | Gateway adapter interface + xPay implementation |
| `routes/webhooks.js` | `POST /api/webhooks/xpay` — signature verify + payment processing |

### Modified files

| File | Changes |
|------|---------|
| `routes/billing.js` | Add `POST /api/billing/create-checkout`, `GET /api/billing/payment-history` |
| `routes/registerAllRoutes.js` | Mount webhook route BEFORE tenant middleware (no auth) |
| `workers/email-worker.js` | Add paid expiry checks: active→grace transition + renewal warning emails |
| `services/email-templates.js` | Add `renewal_due`, `renewal_overdue` templates |
| `migrate-pg.js` | Migration v11: `payment_intents` table |
| `master-db-pg.js` | Add `payment_intents` DDL to master schema init |

### Webhook route placement

Mounted in `registerAllRoutes.js` BEFORE `loadTenantAndPerms` — webhooks have no auth token, no tenant context. They identify the tenant via `payment_intents.tenant_id` lookup.

### Webhook processing logic

```
POST /api/webhooks/xpay
  │
  ├─ Verify HMAC signature (reject if invalid)
  ├─ Parse event type + transaction ID
  ├─ Look up payment_intents by gateway_ref
  ├─ If not found → 404 (unknown transaction)
  ├─ If already completed → 200 (idempotent, no-op)
  │
  ├─ If payment confirmed:
  │   ├─ UPDATE payment_intents SET status = 'completed', completed_at = NOW(), gateway_data = $payload
  │   ├─ Calculate period: 30 days (monthly) or 365 days (annual)
  │   ├─ UPDATE tenants SET payment_status = 'active', plan_expires_at = NOW() + period, plan = $plan
  │   ├─ INSERT INTO payment_records (same fields as admin record-payment)
  │   ├─ Enqueue "payment_confirmed" email
  │   └─ Return 200
  │
  ├─ If payment failed/cancelled:
  │   ├─ UPDATE payment_intents SET status = 'failed'/'cancelled'
  │   └─ Return 200
```

---

## 7. Frontend Changes

### Modified: `pages/redesign/BillingRedesign.jsx`

**Pay Now button** — visible when:
- `payment_status` is `trial` (last 7 days), `grace`, or `expired`
- OR `payment_status` is `active` and `plan_expires_at` is within 7 days (upcoming renewal)
- AND `PAYMENT_GATEWAY` is configured (new field in billing status response: `payment_enabled: true/false`)

**Payment return handling** — on mount:
- Check URL for `?payment=success&intent=xxx`
- Show "Verifying payment..." spinner
- Poll `/api/billing/status` every 2s for up to 30s
- When `payment_status` changes to `active` → success toast, clear URL params
- Timeout → "Payment is being processed, check back shortly"

**Payment history section** — table at bottom:
- Date, amount, plan, cycle, payment method
- From `GET /api/billing/payment-history`

### No changes to:
- AuthProvider (subscription detection already works)
- SubscriptionBanner (already shows correct states)
- SignupPage / LandingPage (already correct from Phase 1)
- Admin panel (admin `record-payment` still works as manual fallback)

---

## 8. Files Touched Summary

### Backend (8 files)

| File | Changes |
|------|---------|
| `services/payment-gateway.js` | NEW — gateway adapter + xPay implementation |
| `routes/webhooks.js` | NEW — xPay webhook handler |
| `routes/billing.js` | Add create-checkout, payment-history, payment_enabled flag |
| `routes/registerAllRoutes.js` | Mount webhook route before tenant middleware |
| `workers/email-worker.js` | Add paid subscription expiry transitions + renewal emails |
| `services/email-templates.js` | Add renewal_due, renewal_overdue, payment_confirmed templates |
| `migrate-pg.js` | Migration v11: payment_intents table |
| `master-db-pg.js` | Add payment_intents DDL |

### Frontend (1 file)

| File | Changes |
|------|---------|
| `pages/redesign/BillingRedesign.jsx` | Pay Now button, payment return handling, payment history |

---

## 9. Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `PAYMENT_GATEWAY` | Railway | `xpay`, `stripe`, or unset (manual-only) |
| `XPAY_API_KEY` | Railway | xPay merchant API key |
| `XPAY_WEBHOOK_SECRET` | Railway | HMAC secret for webhook verification |

When `PAYMENT_GATEWAY` is not set, the system works exactly as today (manual admin payments). This is the deploy-before-configure safety net.

---

## 10. Future (out of scope)

- **Stripe adapter** — same interface, different gateway. Add when targeting international customers.
- **Auto-recurring payments** — stored payment tokens, auto-charge. Add when market demands it.
- **Self-service outlet expansion** — "Add outlet" button triggers additional payment. Needs payment gateway first.
- **Annual discount** — PKR 80,000/yr. Add to plan_pricing when volume justifies.
- **Payment invoices/receipts** — PDF generation for tenant's own accounting. Nice-to-have.
