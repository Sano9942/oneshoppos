# SanoPay Sandbox Implementation Plan

**Date:** 2026-04-14
**Audience:** Founder, implementation engineers, future agents
**Status:** Implementation-ready technical plan
**Companion files:** `sano-plan.md` (business/legal strategy), `CLAUDE.md`, `backend/CLAUDE.md`

---

## 1. Purpose

This document answers a product-engineering question:

How should SanoPOS build and integrate payment processing so that all payment-dependent features can be developed, tested, and shipped — without waiting for live xPay, Bank Alfalah, JazzCash, or easypaisa partner access?

The answer is: **build a SanoPay Sandbox adapter** that simulates the full payment lifecycle internally, enabling every blocked feature to work end-to-end. Later, swap the sandbox adapter for a real provider adapter — no POS/storefront/billing code changes required.

This plan is specific to the actual SanoPOS codebase, referencing exact files, line numbers, database tables, and adapter patterns that already exist.

---

## 2. The Problem: One Gate Blocking 10+ Features

The codebase has a single boolean gate that blocks nearly all payment-dependent functionality:

```js
// backend/services/payment-gateway.js:180
function isEnabled() {
  const adapter = getPaymentAdapter();
  return adapter.isEnabled();
}
```

When `PAYMENT_GATEWAY` is unset or `"manual"`, `isEnabled()` returns `false`. This single check blocks:

- Storefront checkout payments
- Payment link generation for invoices
- Tenant billing/upgrade checkout
- POS card payment processing
- Subscription auto-charge renewals
- Gateway-initiated refunds
- Customer wallet online top-up
- Inventory reservation release on payment confirmation

The infrastructure behind this gate is **already built**. The adapter pattern exists. The webhook handler exists. The database tables exist. The downstream flows are wired. The only missing piece is an adapter that says "yes, I'm enabled" and simulates payment events.

---

## 3. What's Already Built (Infrastructure Audit)

### 3.1 Payment Gateway Adapter (`backend/services/payment-gateway.js`)

The adapter pattern is production-ready:

- `BasePaymentAdapter` — abstract base with `isEnabled()`, `createCheckout()`, `verifyWebhook()`
- `ManualAdapter` — default fallback, `isEnabled()` returns `false`
- `XPayAdapter` — real xPay implementation with HMAC-SHA256 webhook verification
- `ADAPTERS` registry — map of provider keys to adapter classes
- Factory: `getPaymentAdapter(providerName)` — reads `PAYMENT_GATEWAY` env var
- Backwards-compatible module API: `createCheckout()`, `createInvoiceCheckout()`, `verifyWebhook()`, `isEnabled()`

To add a new provider, you:

1. Create a class extending `BasePaymentAdapter`
2. Register it in the `ADAPTERS` map
3. Set `PAYMENT_GATEWAY` env var to the adapter key

This is explicitly documented in the file header.

### 3.2 Webhook Handler (`backend/routes/webhooks.js`)

The xPay webhook handler at `POST /api/webhooks/xpay` already processes three payment contexts:

1. **Platform billing** (lines 46–48): looks up `payment_intents` by `gateway_ref`, activates tenant subscription
2. **Invoice payment links** (lines 54–75): looks up `customer_invoice_payment_links` by `gateway_ref`, records payment, recomputes balance
3. **Storefront checkout** (lines 79–103): looks up `storefront_payment_sessions` by `provider_ref`, marks order as paid

It also handles:

- Idempotency via `payment_webhook_events` table (provider + event_id unique constraint)
- `payment.completed`, `payment.failed`, `payment.cancelled` event types
- Confirmation email enqueue on successful billing payment
- Tenant plan activation (plan, limits, expiry dates, grace period)

### 3.3 Database Tables (All Exist)

| Table | Schema | Purpose | Status |
|-------|--------|---------|--------|
| `payment_intents` | public | Platform billing checkout tracking | Ready (migration v11) |
| `payment_records` | public | Platform billing payment history | Ready (migration v7) |
| `payment_webhook_events` | public | Webhook idempotency | Ready (migration v24) |
| `plan_pricing` | public | Platform subscription pricing tiers | Seeded (pro/monthly 8000 PKR, pro/annual 80000 PKR) |
| `customer_invoice_payment_links` | tenant | Invoice payment link tracking | Ready (migration v20) |
| `customer_invoice_payments` | tenant | Invoice payment records | Ready (migration v20) |
| `storefront_payment_sessions` | tenant | Storefront checkout payment tracking | Ready (migration v18) |
| `web_order_transactions` | tenant | Storefront payment transaction log | Ready (migration v18) |
| `customer_wallet_ledger` | tenant | Customer wallet balance tracking | Ready (migration v16) |
| `customer_subscriptions` | tenant | Recurring subscription tracking (has `auto_charge` and `gateway_token` columns) | Ready (migration v20) |

### 3.4 Feature Flags (All Exist)

| Flag | Default | Purpose |
|------|---------|---------|
| `payment_links` | `false` | Gates invoice payment link generation |
| `subscription_billing` | `true` | Gates subscription management |
| `subscription_autocharge` | `false` | Gates automatic subscription charging |
| `phase5_payment_gateways` | depends on tenant | Gates multi-gateway features |
| `customer_invoicing` | depends on tenant | Gates customer invoice module |

---

## 4. The Two Billing Worlds

**This is architecturally critical.** SanoPOS has two completely separate payment flows that must never be mixed:

### 4.1 Platform Billing — Tenant Pays SANO

- **What:** SanoPOS subscription fees — SANO's revenue
- **Flow:** Tenant clicks "Upgrade" → `POST /api/billing/create-checkout` → gateway redirect → webhook confirms → tenant activated
- **Tables:** `public.payment_intents`, `public.payment_records`, `public.plan_pricing`, `public.tenants`
- **Route:** `backend/routes/billing.js:195-230`
- **Webhook path:** `webhooks.js:46-176` (platform billing branch)
- **Money destination:** SANO's company bank account

### 4.2 Merchant Payments — Tenant's Customer Pays Tenant

- **What:** POS sales, storefront orders, invoice payments, payment links — tenant's commerce revenue
- **Flow:** Customer checks out → payment session created → gateway redirect → webhook confirms → order/invoice marked paid
- **Tables:** `tenant_*.storefront_payment_sessions`, `tenant_*.customer_invoice_payment_links`, `tenant_*.web_order_transactions`, `tenant_*.sale_payments`
- **Routes:** `backend/routes/storefront.js:810-864`, `backend/routes/customer-invoices.js:319-366`
- **Webhook paths:** `webhooks.js:54-75` (invoice links), `webhooks.js:79-103` (storefront)
- **Money destination:** Tenant's bank/wallet via partner rail (NOT SANO's account)

### 4.3 Why Separation Matters

| Concern | Platform Billing | Merchant Payments |
|---------|-----------------|-------------------|
| **Revenue owner** | SANO | Tenant |
| **Regulatory risk** | Low (SaaS subscription) | Higher (payment processing) |
| **Fund custody** | SANO collects its own fee | SANO must NEVER hold these funds |
| **Provider** | Can use xPay/Stripe directly | Should use partner rails (Bank Alfalah, JazzCash, easypaisa) |
| **Database schema** | Public schema (cross-tenant) | Tenant schema (per-tenant) |

The sandbox adapter must simulate both contexts but keep them in separate tables, routes, and ledgers. This separation is already built into the webhook handler — it checks `payment_intents` first (platform), then falls back to `customer_invoice_payment_links` (merchant), then `storefront_payment_sessions` (merchant).

---

## 5. Features Blocked by Missing Payment Adapter

### 5.1 POS Card Payment (Label-Only, No Processing)

**Current state:**

- POS checkout modal (`frontend/src/pages/redesign/pos/POSCheckoutModal.jsx:40-63`) renders 4 payment methods: Cash, Card, Credit, Wallet
- When "Card" is selected, it's recorded to `sale_payments.payment_method = 'card'` but **never routed to a payment processor**
- No card tokenization, no 3D-Secure flow, no decline/retry logic
- Card payment is metadata-only — indistinguishable from cash in the backend

**What's missing:**

- Gateway charge initiation when `payment_method = 'card'`
- Payment confirmation before sale is finalized
- Original transaction reference stored for potential refund
- Card payment reconciliation reporting

**What sandbox unblocks:**

- Simulated card charge → confirmation → sale finalized
- Transaction reference stored in `sale_payments` for refund tracing
- Card payment reporting becomes meaningful

### 5.2 Storefront Checkout (Blocks at "Payments Not Configured")

**Current state:**

- Full storefront checkout flow exists: cart → address → shipping → order creation
- `POST /api/storefront/checkout` creates `web_orders` with `payment_status = 'pending'` and returns `payment_enabled: paymentGateway.isEnabled()` (line 799)
- `POST /api/storefront/orders/:orderToken/pay` (line 810-864) is the payment initiation endpoint — it checks `paymentGateway.isEnabled()` at line 821 and throws `"Online payments not configured"` when false
- Order creation succeeds but payment step is dead — orders stay `payment_status = 'pending'` indefinitely

**What's missing:**

- Payment session creation at checkout
- Customer redirect to payment page
- Webhook confirmation that marks order as `'paid'`
- Inventory release if payment fails or is abandoned

**What sandbox unblocks:**

- Full checkout → pay → confirm → order completed flow
- `storefront_payment_sessions` populated with sandbox references
- `web_order_transactions` populated with sandbox transaction records
- Inventory reservation release on payment failure

### 5.3 Payment Links for Invoices (Code Built, Double-Gated)

**Current state:**

- `POST /api/customer-invoices/:id/payment-link` (line 319-366) is **fully implemented**
- Generates unique `link_token`, calls `paymentGateway.createInvoiceCheckout()`, stores `customer_invoice_payment_links` record
- **Double-gated:** requires both `requireFeature("payment_links")` AND `paymentGateway.isEnabled()` at line 322
- Returns error: `"Online payments are not configured. Set PAYMENT_GATEWAY env var."`
- Frontend UI (`CustomerInvoicesRedesign.jsx:242`) conditionally shows payment link button — currently hidden

**What's missing:**

- An enabled gateway to generate checkout URLs
- Frontend display of the payment link button
- Link expiration enforcement (7-day TTL is set in DB but not enforced)
- Link analytics (click tracking, conversion rate)

**What sandbox unblocks:**

- Payment links generate working sandbox checkout URLs
- Customers can "pay" via sandbox page → webhook confirms → invoice balance updated
- Full B2B invoice payment flow works end-to-end

### 5.4 Tenant Billing Checkout (Intent Created, Can't Pay)

**Current state:**

- `POST /api/billing/create-checkout` (line 195-230) creates a `payment_intents` record and calls `paymentGateway.createCheckout()`
- **Gated** by `paymentGateway.isEnabled()` at line 202 — throws `"Online payments are not configured. Contact support to subscribe."`
- `GET /api/billing/status` returns `payment_enabled: paymentGateway.isEnabled()` at line 158
- Frontend (`BillingRedesign.jsx:93-95`) disables "Pay Now" button when `payment_enabled` is false
- Currently tenants can only upgrade via manual admin payment recording

**What's missing:**

- A working checkout URL for tenant subscription payment
- Webhook confirmation that activates the tenant's plan

**What sandbox unblocks:**

- Full self-service upgrade flow: tenant clicks "Pay Now" → sandbox payment page → webhook confirms → plan activated → confirmation email sent
- Payment history populated with real records
- End-to-end subscription lifecycle testing (trial → pay → active → renew)

### 5.5 Subscription Auto-Charge (Field Exists, Never Fires)

**Current state:**

- `customer_subscriptions.auto_charge` column exists (boolean, default false)
- `customer_subscriptions.gateway_token` column exists (text, for stored payment method reference)
- `subscription_autocharge` feature flag exists (default false)
- Subscription renewal worker (`services/subscriptions.js:processRenewal`) fires on schedule but **never initiates a payment**
- Renewal creates a new period but does not charge the customer
- `auto_charge` field is accepted in subscription creation but completely ignored in renewal

**What's missing:**

- Renewal worker calling `paymentGateway.createCheckout()` with stored `gateway_token`
- Webhook confirmation that extends the subscription period
- Failed charge retry logic (dunning)
- Payment method storage for subscription customers

**What sandbox unblocks:**

- Renewal worker can simulate charges against sandbox
- Dunning flow (retry on failure) can be built and tested
- Subscription lifecycle: create → trial → auto-charge → renew → failed → retry → cancelled

### 5.6 Refunds to Card (Recorded, Never Sent to Gateway)

**Current state:**

- `POST /api/returns` (line 155-293) accepts `refund_method` enum: `[cash, card, credit, store_credit]`
- When `refund_method = 'card'`, the return is **recorded** but no gateway refund is initiated
- No capture of original `sale_payments` transaction reference to refund against
- Only `cash` and `store_credit` refund methods actually work end-to-end
- `BasePaymentAdapter` has no `refund()` method defined

**What's missing:**

- `refund()` method on `BasePaymentAdapter`
- Lookup of original payment transaction reference from `sale_payments`
- Gateway refund API call
- Partial refund support
- Refund status tracking (pending → completed → failed)

**What sandbox unblocks:**

- Simulated refund processing via sandbox adapter
- Original transaction reference linked to refund
- Refund status confirmation via webhook
- Full return → refund → confirmation flow

### 5.7 Customer Wallet Online Top-Up (Admin Manual Only)

**Current state:**

- `customer_wallet_ledger` tracks credit/debit entries
- `POST /api/customers/:id/wallet/topup` adds credit — but only via admin action
- Wallet payment method works at POS (`POSCheckoutModal.jsx:81-97`) — balance checked and debited
- No customer-facing self-service top-up

**What's missing:**

- Customer-facing wallet top-up via payment link/checkout
- Payment confirmation webhook that credits wallet balance
- Top-up amount selection UI

**What sandbox unblocks:**

- Customer self-service wallet top-up flow
- Payment → webhook → wallet credit → confirmation
- Wallet top-up reporting

### 5.8 Inventory Reservation Release (No Payment Confirmation Signal)

**Current state:**

- Storefront checkout creates `storefront_cart_reservations` and decrements `outlet_stock`
- Orders created with `payment_status = 'pending'` immediately on checkout
- **No payment confirmation signal** to finalize or release the reservation
- If customer abandons after checkout but before payment, inventory is locked indefinitely
- Reservation expiry worker exists (`RESERVATION_WORKER_ENABLED=1`) but runs on time-based TTL only

**What's missing:**

- Payment confirmation webhook triggering reservation finalization
- Payment failure/cancellation webhook triggering reservation release (stock restore)
- Cart expiration with automatic stock restoration on payment abandonment

**What sandbox unblocks:**

- Checkout → payment → reservation finalized flow
- Checkout → payment failure → reservation released → stock restored flow
- Checkout → payment abandoned → TTL expires → stock restored flow

### 5.9 BNPL / Installments (Nothing Built)

**Current state:**

- No BNPL gateway integration
- No installment plan support
- No partial payment or deposit flows for orders
- `draft_orders` has no `deposit_amount` or `payment_plan` columns

**What sandbox unblocks:**

- Not directly — this requires new schema, new UI, new adapter methods
- However, sandbox provides the foundation: once the adapter boundary exists, a BNPL adapter can be added alongside sandbox/xpay

### 5.10 Restaurant Card Preauthorization (Feature Flag Exists, No Implementation)

**Current state:**

- `phase4_restaurant_preauth` feature flag exists
- Restaurant checks and tabs are built (`services/restaurant-checks.js`)
- `openTab()` function exists but has no card preauth flow
- No hold/capture pattern for restaurant tabs

**What's missing:**

- `preauthorize()` method on payment adapter
- `capturePreauth()` method on payment adapter
- Tab → preauth hold → add items → close tab → capture final amount flow

**What sandbox unblocks:**

- Simulated preauth hold on sandbox
- Tab lifecycle with hold → capture pattern

---

## 6. SanoPay Sandbox Architecture

### 6.1 Design Principles

1. **Same adapter interface** — SandboxAdapter extends `BasePaymentAdapter`, same as XPayAdapter
2. **Same webhook events** — sandbox fires the exact same event types (`payment.completed`, `payment.failed`, `payment.cancelled`) that real gateways fire
3. **Internal payment page** — no external dependency, no API keys, no network calls
4. **Both billing contexts** — works for platform billing AND merchant payments
5. **Developer-controlled outcomes** — buttons to simulate success, failure, cancellation, partial refund
6. **Signature verification** — uses a local HMAC secret so webhook verification path is exercised
7. **No real money** — sandbox payment page clearly labeled as simulation, no fund claims

### 6.2 New Adapter: SandboxAdapter

Location: `backend/services/payment-gateway.js` (add to existing file)

```
class SandboxAdapter extends BasePaymentAdapter {
  isEnabled()           → true when PAYMENT_GATEWAY=sandbox
  createCheckout()      → returns URL to internal sandbox payment page
  verifyWebhook()       → validates sandbox HMAC signature
  refund()              → simulates refund (new method on BasePaymentAdapter)
  preauthorize()        → simulates preauth hold (future, for restaurant tabs)
  capturePreauth()      → simulates preauth capture (future)
}
```

Registration:

```js
const ADAPTERS = {
  manual: ManualAdapter,
  xpay: XPayAdapter,
  sandbox: SandboxAdapter,  // ← new
};
```

### 6.3 Sandbox Payment Page

Location: new route at `POST /api/sandbox/pay/:reference` + frontend page

This is an **internal-only** page that simulates the gateway checkout experience:

**Displays:**
- Amount and currency
- Payment reference
- Payment context (billing / invoice / storefront / wallet)
- Tenant name (if applicable)

**Actions:**
- "Pay Successfully" → fires `payment.completed` webhook event
- "Fail Payment" → fires `payment.failed` webhook event
- "Cancel" → fires `payment.cancelled` webhook event

**How it works:**

1. `SandboxAdapter.createCheckout()` returns `{APP_URL}/sandbox/pay/{reference}` as `checkout_url`
2. User/customer is redirected to the sandbox payment page
3. Developer clicks an outcome button
4. Sandbox page calls `POST /api/sandbox/simulate-webhook` with the chosen outcome
5. That endpoint constructs the same webhook payload format and internally calls the existing webhook handler logic
6. Existing webhook handler processes it identically to a real xPay/Stripe/Bank Alfalah webhook

**Critical design decision:** The sandbox payment page fires events through the **same webhook processing path** that real gateways use. This means:

- Idempotency via `payment_webhook_events` is exercised
- Platform billing → tenant activation flow is exercised
- Invoice payment → balance recomputation is exercised
- Storefront payment → order confirmation is exercised
- Email enqueue on payment confirmation is exercised

### 6.4 Environment Configuration

**Development / Sandbox:**

```env
PAYMENT_GATEWAY=sandbox
SANDBOX_WEBHOOK_SECRET=dev-sandbox-secret-change-in-prod
```

No other keys required. No xPay, no Stripe, no Bank Alfalah credentials.

**xPay Sandbox (later, after xPay grants sandbox access):**

```env
PAYMENT_GATEWAY=xpay
XPAY_ENV=sandbox
XPAY_BASE_URL=https://api.test.xpaycheckout.com
XPAY_API_KEY=your_sandbox_api_key
XPAY_WEBHOOK_SECRET=your_sandbox_webhook_secret
```

**xPay Production (later, after xPay live approval):**

```env
PAYMENT_GATEWAY=xpay
XPAY_BASE_URL=https://api.xpaycheckout.com
XPAY_API_KEY=your_live_api_key
XPAY_WEBHOOK_SECRET=your_live_webhook_secret
```

**Bank Alfalah (later, after partnership):**

```env
PAYMENT_GATEWAY=bankalfalah
ALFA_BASE_URL=https://...
ALFA_MERCHANT_ID=...
ALFA_API_KEY=...
ALFA_WEBHOOK_SECRET=...
```

### 6.5 Adapter Interface Extension

The current `BasePaymentAdapter` needs two new methods for full coverage:

```js
class BasePaymentAdapter {
  // Existing
  isEnabled()                          → boolean
  createCheckout(opts)                 → { checkout_url, gateway_ref }
  verifyWebhook(headers, rawBody)      → { valid, event_type, transaction_id, status, amount, raw }

  // New — needed for refunds
  refund({ transaction_id, amount, reason })  → { refund_id, status }

  // Future — needed for restaurant preauth
  preauthorize({ amount, currency, reference })  → { preauth_ref, status }
  capturePreauth({ preauth_ref, amount })        → { capture_ref, status }
}
```

---

## 7. Implementation Build Order

### Phase 1: Sandbox Adapter + Payment Page (Keystone)

**Goal:** Get `paymentGateway.isEnabled()` to return `true` and simulate the full payment lifecycle.

**Tasks:**

1. Add `SandboxAdapter` class to `backend/services/payment-gateway.js`
2. Register `sandbox` in the `ADAPTERS` map
3. Add `refund()` method to `BasePaymentAdapter` (throws "Not implemented" by default)
4. Implement `refund()` in `SandboxAdapter`
5. Create sandbox payment page route at `backend/routes/sandbox.js`
6. Create sandbox webhook simulation endpoint at `POST /api/sandbox/simulate-webhook`
7. Create minimal frontend sandbox payment page (can be a simple server-rendered HTML page — no React needed)
8. Mount sandbox routes in `registerAllRoutes.js` (only when `PAYMENT_GATEWAY=sandbox`)
9. Set `PAYMENT_GATEWAY=sandbox` and `SANDBOX_WEBHOOK_SECRET` in dev `.env`

**Result:** `isEnabled()` returns `true`. Every gate opens.

### Phase 2: Storefront Checkout Flow (Highest User-Facing Value)

**Goal:** Full storefront checkout → payment → order confirmed flow.

**Current state:** 90% built. The checkout creates the order and returns `payment_enabled`. The pay endpoint exists but is gated.

**Tasks:**

1. With sandbox enabled, `POST /api/storefront/orders/:orderToken/pay` now passes the `isEnabled()` check
2. Verify the full flow: checkout → redirect to sandbox payment page → click "Pay Successfully" → webhook fires → order marked paid
3. Test failure path: click "Fail Payment" → order stays pending → inventory reservation released
4. Test cancellation path: click "Cancel" → order stays pending
5. Verify `web_order_transactions` populated correctly

**Estimated new code:** Minimal — mostly testing and verifying existing code works when gate opens.

### Phase 3: Payment Links for Invoices (Already Built)

**Goal:** Invoice payment links generate working URLs and process payments.

**Current state:** Code fully written. Double-gated by feature flag + gateway check.

**Tasks:**

1. Enable `payment_links` feature flag for test tenant
2. With sandbox enabled, `POST /api/customer-invoices/:id/payment-link` now passes both gates
3. Verify: create link → customer visits sandbox URL → clicks "Pay" → webhook fires → invoice balance updated
4. Verify frontend shows "Generate Payment Link" button in invoice detail
5. Test link expiration (7-day TTL)

**Estimated new code:** Minimal — feature flag toggle + frontend button visibility fix.

### Phase 4: Tenant Billing Checkout (SANO's Own Revenue)

**Goal:** Self-service tenant upgrade via sandbox payment.

**Current state:** Fully built. Gated by `isEnabled()`.

**Tasks:**

1. With sandbox enabled, `POST /api/billing/create-checkout` now passes the gate
2. Verify: tenant clicks "Upgrade to Pro" → redirect to sandbox payment page → click "Pay" → webhook fires → tenant plan activated → confirmation email enqueued
3. Verify `BillingRedesign.jsx` shows "Pay Now" button when `payment_enabled: true`
4. Test the full lifecycle: free trial → pay → active → plan expiry → renew
5. Verify payment history populated in billing dashboard

**Estimated new code:** Minimal — mostly testing.

### Phase 5: POS Card Payment → Gateway Bridge

**Goal:** POS card payments route through the payment adapter.

**Current state:** Card is a label in the checkout modal. No gateway call.

**Tasks:**

1. Add payment intent creation when `payment_method = 'card'` in POS checkout
2. Store `gateway_ref` in `sale_payments` for refund tracing
3. Create sandbox flow: cashier selects "Card" → sandbox confirms → sale finalized
4. Handle card payment failure: sale not finalized, show error to cashier
5. Consider UX: POS card payment should be faster than storefront redirect — may need inline confirmation rather than page redirect

**Design decision:** POS card payment UX differs from storefront. Options:

- **Option A:** Redirect to sandbox payment page (consistent but slow for POS)
- **Option B:** Inline confirmation via API call (faster but different code path)
- **Option C:** Polling-based confirmation (POS shows "Waiting for payment..." while customer taps card)

For sandbox, Option A works. For production with real card terminals, Option C is more realistic.

**Estimated new code:** ~50-80 lines backend + ~30-50 lines frontend.

### Phase 6: Refund-to-Gateway

**Goal:** Card refunds route through the payment adapter.

**Current state:** `refund_method = 'card'` is accepted and recorded but never sent to gateway.

**Tasks:**

1. Add `refund()` method to `BasePaymentAdapter` (done in Phase 1)
2. In `routes/returns.js`, when `refund_method = 'card'`:
   - Look up original sale's `sale_payments` for the card payment record
   - Extract `gateway_ref` / transaction reference
   - Call `paymentGateway.refund({ transaction_id, amount, reason })`
   - Store refund reference in return record
3. Handle refund failure (gateway decline)
4. Handle partial refund (refund amount < original payment amount)
5. Add refund confirmation webhook event type

**Estimated new code:** ~40-60 lines backend.

### Phase 7: Subscription Auto-Charge

**Goal:** Subscription renewal worker charges customers via gateway.

**Current state:** `auto_charge` field exists, renewal worker fires, but no charge.

**Tasks:**

1. Enable `subscription_autocharge` feature flag for test tenant
2. In `services/subscriptions.js:processRenewal`, when `auto_charge = true`:
   - Look up customer's stored `gateway_token` (payment method reference)
   - Call `paymentGateway.createCheckout()` with stored reference
   - On webhook confirmation, extend subscription period
3. Build dunning flow: on payment failure, retry with exponential backoff
4. After N failed retries, pause or cancel subscription
5. Notify customer on failed charge (email via `enqueueEmail`)

**Design decision:** Auto-charge can work two ways:

- **Redirect model:** Send customer a payment link email each renewal (simpler, no stored payment method needed)
- **Tokenized model:** Charge stored payment method automatically (requires PCI tokenization via partner)

For v1 with sandbox, redirect model is simpler and safer. Tokenized model requires partner support.

**Estimated new code:** ~60-100 lines backend.

### Phase 8: Customer Wallet Online Top-Up

**Goal:** Customers can top up their wallet via payment link.

**Current state:** Wallet works at POS (topup is admin-only via `POST /api/customers/:id/wallet/topup`).

**Tasks:**

1. Create `POST /api/customers/:id/wallet/topup-link` route
2. Generate payment link → sandbox checkout → webhook confirms → wallet credited
3. Add wallet top-up webhook event type handling
4. Create customer-facing top-up UI (or extend payment link page)

**Estimated new code:** ~50-70 lines backend + ~20-30 lines frontend.

---

## 8. Webhook Event Flow (How Sandbox Simulates Real Gateways)

This is the most important architectural detail. The sandbox must produce **identical events** to what real gateways produce, so the downstream code path is fully exercised.

### 8.1 Event Types

| Event | Meaning | Triggered By |
|-------|---------|-------------|
| `payment.completed` | Customer paid successfully | Sandbox "Pay Successfully" button |
| `payment.failed` | Payment declined or errored | Sandbox "Fail Payment" button |
| `payment.cancelled` | Customer cancelled checkout | Sandbox "Cancel" button |
| `refund.completed` | Refund processed successfully | Sandbox refund simulation |
| `refund.failed` | Refund declined | Sandbox refund failure simulation |

### 8.2 Webhook Payload Format

The sandbox should produce the same payload shape as xPay:

```json
{
  "event_type": "payment.completed",
  "session_id": "sandbox_1713100800000",
  "transaction_id": "sandbox_txn_1713100800000",
  "status": "completed",
  "amount": 8000,
  "currency": "PKR",
  "reference_id": "billing-intent-42",
  "sandbox": true
}
```

The `sandbox: true` field is for logging/debugging only — it should not change processing behavior.

### 8.3 Webhook Processing Path

```
Sandbox "Pay" button clicked
  → POST /api/sandbox/simulate-webhook
    → constructs webhook payload
    → signs with SANDBOX_WEBHOOK_SECRET (HMAC-SHA256)
    → internally calls the same webhook processing logic
      → payment_webhook_events idempotency check
      → payment_intents lookup (billing) OR
      → customer_invoice_payment_links lookup (invoices) OR
      → storefront_payment_sessions lookup (storefront)
      → downstream effects (tenant activation, invoice balance, order status)
```

### 8.4 Sandbox vs Real Gateway — What Changes

| Aspect | Sandbox | Real Gateway (xPay/Bank Alfalah) |
|--------|---------|--------------------------------|
| `checkout_url` | Internal `/sandbox/pay/:reference` | External `https://api.xpay.pk/...` |
| `gateway_ref` | `sandbox_` + timestamp | Real session/transaction ID |
| Webhook origin | Internal API call | External HTTP POST from gateway |
| Signature | SANDBOX_WEBHOOK_SECRET | Real gateway webhook secret |
| Money moves | No | Yes |
| PCI concerns | None | Partner handles |
| Everything else | **Identical** | **Identical** |

---

## 9. Future Provider Adapters

Once the sandbox proves the adapter boundary works, adding real providers requires only:

### 9.1 xPay (Already Partially Built)

- Adapter exists at `XPayAdapter` in `payment-gateway.js`
- **Needs update:** current hardcoded URL `https://api.xpay.pk/v1/checkout/session` may be outdated
- xPay's current docs show `https://api.xpaycheckout.com` (live) and `https://api.test.xpaycheckout.com` (sandbox)
- Update adapter to use `XPAY_BASE_URL` env var instead of hardcoded URL
- Add `refund()` method using xPay refund API
- Request xPay sandbox access (requires contacting xPay support)

### 9.2 Bank Alfalah (Recommended First Live Partner)

Per `sano-plan.md` Section 13, Bank Alfalah is the strongest first partner because:

- Public fintech partnership history (bSecure, Paymob, SnappRetail)
- Digital merchant signup path
- Hosted/redirected checkout integration
- Pay-by-link support
- Refund/chargeback merchant portal

Adapter implementation:

```
class BankAlfalahAdapter extends BasePaymentAdapter {
  isEnabled()       → checks ALFA_API_KEY
  createCheckout()  → Alfa Payment Gateway API
  verifyWebhook()   → Alfa webhook signature verification
  refund()          → Alfa refund API
}
```

### 9.3 JazzCash (Recommended Second Partner)

Per `sano-plan.md` Section 14, JazzCash covers wallet and mobile payment acceptance.

```
class JazzCashAdapter extends BasePaymentAdapter {
  isEnabled()       → checks JAZZCASH_MERCHANT_ID
  createCheckout()  → JazzCash Online Payment Gateway
  verifyWebhook()   → JazzCash webhook verification
  refund()          → JazzCash reversal API
}
```

### 9.4 easypaisa (Recommended Third Partner)

Per `sano-plan.md` Section 15, easypaisa has strong merchant gateway documentation.

```
class EasypaisaAdapter extends BasePaymentAdapter {
  isEnabled()       → checks EP_MERCHANT_ID
  createCheckout()  → easypaisa Online Payment Gateway
  verifyWebhook()   → easypaisa webhook verification
  refund()          → easypaisa reversal API
}
```

### 9.5 Per-Tenant Provider Selection (Future)

Eventually, different tenants may use different payment providers:

```
tenant A → xPay
tenant B → Bank Alfalah
tenant C → JazzCash
tenant D → easypaisa
```

This requires:

- `integration_settings` table entry per tenant for payment provider config
- `getPaymentAdapter()` to accept tenant context and look up tenant-specific provider
- Encrypted credentials per tenant via `services/crypto.js` (AES-256-GCM, already used for Shopify/marketplace credentials)

---

## 10. What the Sandbox Does NOT Do

To keep scope clean and legally safe:

1. **No real money** — sandbox payment page is clearly labeled as simulation
2. **No fund custody** — SANO never holds customer funds, even in simulation
3. **No wallet issuance claims** — customer wallet is store credit, not e-money
4. **No PCI data** — sandbox never collects card numbers, CVV, or sensitive payment data
5. **No settlement claims** — sandbox does not simulate fund settlement to tenant bank accounts
6. **No regulatory claims** — sandbox page should not display "Powered by SanoPay" or claim licensed status

The sandbox is a **development and testing tool**, not a public-facing payment product.

---

## 11. Testing Strategy

### 11.1 Integration Tests

Each payment flow should have a test in `backend/tests/integration/`:

- `pg-sandbox-billing.test.js` — platform billing checkout → webhook → tenant activation
- `pg-sandbox-storefront.test.js` — storefront checkout → payment → order confirmed
- `pg-sandbox-invoice-links.test.js` — invoice payment link → payment → balance updated
- `pg-sandbox-refunds.test.js` — return with card refund → gateway refund → confirmation

Test pattern: use `SandboxAdapter` directly, call `createCheckout()`, simulate webhook, verify downstream effects.

### 11.2 E2E Tests (Playwright)

Add Playwright specs for:

- Storefront checkout with sandbox payment flow
- Billing upgrade with sandbox payment flow
- Invoice payment link with sandbox payment flow

These can run against the dev server with `PAYMENT_GATEWAY=sandbox`.

### 11.3 Webhook Idempotency Tests

Verify that:

- Same webhook event processed twice → second is no-op
- Payment completed → duplicate completion → no double-activation
- Failed → completed (status progression) → works correctly

---

## 12. Security Considerations

### 12.1 Sandbox Routes Must Be Dev-Only in Production

The sandbox payment page and webhook simulation endpoint should be:

- **Option A:** Only mounted when `PAYMENT_GATEWAY=sandbox` (recommended for v1)
- **Option B:** Gated by `NODE_ENV !== 'production'`
- **Option C:** Protected by admin auth + feature flag

Option A is cleanest — if production uses `PAYMENT_GATEWAY=xpay`, sandbox routes simply don't exist.

### 12.2 Webhook Signature Verification

Even for sandbox, webhook payloads must be HMAC-signed and verified. This ensures:

- The verification code path is exercised
- No unsigned payloads can trigger payment events
- Transition to real gateway is seamless

### 12.3 No Card Data Collection

The sandbox payment page must NEVER collect or display:

- Card numbers
- CVV/CVC
- Expiry dates
- Bank account numbers

It should only show amount, reference, and action buttons.

---

## 13. Migration Path: Sandbox → Production

When a real payment partner is ready:

1. **Change one env var:** `PAYMENT_GATEWAY=xpay` (or `bankalfalah`, `jazzcash`, etc.)
2. **Add partner credentials:** `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET`
3. **Sandbox routes automatically unmount** (they only mount when `PAYMENT_GATEWAY=sandbox`)
4. **No code changes** in billing.js, storefront.js, customer-invoices.js, webhooks.js, returns.js, subscriptions.js, or any frontend file
5. **Test in partner's sandbox environment** before going live

The adapter boundary is the **only thing that changes**. Everything above it — routes, frontend, database tables, webhook handler, email notifications — stays identical.

---

## 14. Relationship to sano-plan.md

This implementation plan maps directly to `sano-plan.md` stages:

| sano-plan.md Stage | This Plan Phase | Notes |
|--------------------|-----------------|----|
| Stage 0: Incorporate | — | Business/legal, not code |
| Stage 1: Partner deck | — | Business, not code |
| Stage 2: Partner outreach | — | Business, not code |
| **Stage 3: Build SanoPay v1** | **Phases 1-8** | This entire plan IS Stage 3 |
| Stage 4: Pilot merchants | After Phase 2 | Storefront checkout ready for pilot |
| Stage 5: Expand rails | Add new adapters | Bank Alfalah, JazzCash, easypaisa adapters |
| Stage 6: Evaluate regulated expansion | Much later | Only after significant payment volume |

The key insight from `sano-plan.md` Section 9.1:

> SanoPay v1 should be defined as: a merchant payments orchestration and acceptance layer for Pakistan, built on top of licensed bank and wallet rails, integrated into SanoPOS and also usable by external merchants.

The sandbox **is** SanoPay v1 internally. The adapter boundary **is** the orchestration layer. The sandbox adapter **is** the first "rail" — a simulated one. Later adapters (xPay, Bank Alfalah, JazzCash) are additional rails plugged into the same boundary.

---

## 15. Tenant Test Mode — Sandbox as a Product Feature

The sandbox is not just a development tool. It becomes a **product feature** that tenants use to test their own payment setup before going live with real customers.

### 15.1 Two Audiences, One Sandbox

| Audience | Purpose | When |
|----------|---------|------|
| **SANO developers** | Build and test every payment-dependent feature without partner access | Now (development) |
| **Tenants** | Test their storefront checkout, payment links, and invoice flows before going live | After first real payment partner is active |

### 15.2 How Tenants Use Test Mode

When a tenant signs up and starts configuring their store — products, categories, pricing, storefront — they need to verify their checkout flow works before exposing it to real customers.

With sandbox/test mode enabled for a tenant:

1. Tenant sets up their storefront (products, shipping, pricing)
2. Tenant creates a test order through their own storefront
3. Tenant walks through the checkout as if they were a customer
4. Tenant sees a clear label: **"This is a test payment — no real money will be charged"**
5. Tenant clicks "Pay Successfully" (or "Fail Payment" to test error handling)
6. Tenant sees the order confirmed, inventory decremented, receipt generated
7. Tenant gains confidence their setup works before going live

This is exactly what Stripe does with test mode. Every Stripe merchant gets test API keys alongside live keys. They toggle between test and live. Test mode processes everything identically but no money moves.

### 15.3 What Tenants Can Test in Sandbox Mode

- **Storefront checkout flow** — full cart → address → shipping → payment → order confirmed
- **Payment link generation** — create a payment link for an invoice, open it, simulate payment
- **Invoice payment flow** — customer receives invoice email → clicks "Pay Now" → simulated payment → balance updated
- **Refund flow** — process a return with card refund → simulated refund confirmation
- **Receipt generation** — verify receipt layout, email delivery, and public receipt page after payment
- **Inventory impact** — confirm stock decrements on successful payment and restores on failure/cancellation
- **Email notifications** — verify order confirmation, payment receipt, and shipping notification emails fire correctly

### 15.4 Per-Tenant Payment Mode (Future Architecture)

Right now the sandbox is a **global** setting (`PAYMENT_GATEWAY=sandbox` env var on the server). For tenant-facing test mode, the architecture evolves to per-tenant provider selection:

```
Tenant A → live mode (Bank Alfalah) — real customer payments
Tenant B → test mode (sandbox)      — testing their setup
Tenant C → live mode (JazzCash)     — real customer payments
Tenant D → test mode (sandbox)      — new tenant, not ready yet
```

**Implementation path:**

1. Add `payment_provider` and `payment_mode` columns to `integration_settings` (or a new `merchant_payment_config` table)
2. `getPaymentAdapter()` accepts tenant context and reads tenant-specific config
3. Encrypted credentials per tenant stored via `services/crypto.js` (AES-256-GCM — already used for Shopify/marketplace credentials)
4. Admin toggle in tenant settings: "Test Mode" ↔ "Live Mode"
5. Storefront pages show a clear "TEST MODE" banner when sandbox is active

This is not needed for v1 — the global `PAYMENT_GATEWAY` env var is sufficient during development. Per-tenant mode becomes relevant when:

- Multiple tenants exist with different payment provider preferences
- Tenants need self-service test/live toggling
- SANO onboards a tenant and wants them to test before activating live payments

### 15.5 The Sandbox Never Goes Away

When production payment providers are active, the sandbox does not get removed. It becomes the **permanent test mode** available to every tenant:

| Stage | Global Mode | Tenant Mode |
|-------|-------------|-------------|
| **Development (now)** | `PAYMENT_GATEWAY=sandbox` globally | All tenants use sandbox |
| **First partner live** | `PAYMENT_GATEWAY=bankalfalah` globally | New tenants default to sandbox, switch to live after setup |
| **Per-tenant mode (later)** | Global setting removed | Each tenant has own `payment_mode: test/live` and `payment_provider: sandbox/bankalfalah/jazzcash` |

The sandbox adapter is infrastructure, not scaffolding. It stays in the `ADAPTERS` registry permanently.

### 15.6 Sandbox Transaction Labeling

All sandbox transactions should be clearly labeled in the database and UI:

- `payment_intents.provider = 'sandbox'` — distinguishes test from real payments
- `web_order_transactions.gateway = 'sandbox'` — test orders are filterable
- `sale_payments.gateway_ref` prefixed with `sandbox_` — easy to identify
- Reports and dashboards should offer a toggle: "Include test transactions" / "Live only"
- Export/accounting reports should **exclude** sandbox transactions by default

This prevents confusion when a tenant switches from test to live mode — their test orders don't pollute real revenue reports.

---

## 16. Summary

| What | Detail |
|------|--------|
| **Problem** | 10+ features blocked by `paymentGateway.isEnabled() → false` |
| **Solution** | SandboxAdapter that returns `isEnabled() → true` and simulates payment lifecycle |
| **Architecture** | Same adapter interface as xPay, same webhook events, same downstream processing |
| **Two billing worlds** | Platform billing (SANO's revenue) and merchant payments (tenant's commerce) — separate tables, routes, ledgers |
| **Build order** | 8 phases: adapter → storefront → invoices → billing → POS → refunds → subscriptions → wallet |
| **What changes later** | Only the adapter class and env vars — no route/frontend/database changes |
| **What doesn't change** | Every route, frontend page, database table, webhook handler, email flow |
| **Timeline dependency** | Zero external dependency — can start building today |
| **Regulatory safety** | No real money, no fund custody, no wallet issuance, no PCI data |

---

## 17. Recommended First Action

Set these env vars in development:

```env
PAYMENT_GATEWAY=sandbox
SANDBOX_WEBHOOK_SECRET=dev-sandbox-secret-local
```

Build the `SandboxAdapter` class. The moment `isEnabled()` returns `true`, nine features come alive.
