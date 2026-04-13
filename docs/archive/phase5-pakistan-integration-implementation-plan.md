# Phase 5 Pakistan-Specific Integration Depth — Revised Implementation Plan

**Date:** 2026-04-10  
**Audience:** Implementation engineers, future agents, reviewers  
**Status:** Execution plan aligned to actual repo state after fresh codebase audit  
**Companion design doc:** `docs/plans/phase5-pakistan-integration-design.md`

---

## 1. Summary

This plan turns the Phase 5 design into an implementation sequence against the current SanoPOS codebase.

Phase 5 includes:

- shipping automation and label generation
- COD reconciliation and courier settlement operations
- payment gateway expansion
- SMS provider delivery

This plan intentionally **extends existing systems** instead of introducing parallel engines.

### What Changed From The Original Plan

This revised plan reflects a fresh audit of every system Phase 5 touches. Key changes:

1. **Consolidated to one migration (v25)** instead of five. Each migration runs across every tenant schema — fewer migrations means faster rollout, fewer failure points, simpler rollback.
2. **Dropped Phase 5E (ERP/accounting exports)** — no customer demand, premature complexity. Can be added later as a standalone cut when a tenant actually needs QuickBooks/Xero export.
3. **Dropped rate quote support (original 5A2)** — zero courier adapters implement `getRates()`, and most Pakistan couriers (Leopards, TCS, BlueEx, Trax, PostEx, Call Courier, M&P, Rider, Swyft) have no public rate API. Use configurable flat shipping rates instead.
4. **Added explicit pre-work tasks** — the storefront contract drift (`"shipping"` vs `"ship_to_customer"`) and payment gateway refactor are real blockers, not vague "shared foundations."
5. **Payment gateway refactor is now an explicit early task** — the current `payment-gateway.js` is 138 lines of functional code hardcoded to xPay. The courier layer uses a proper class-based adapter factory. Payment must match that pattern before expansion.
6. **SMS scope reduced to transactional only** — `booking-reminders.js` does not exist in the repo. Marketing SMS reuse is deferred.

### Delivery Sequence

- `Pre-work` Contract fixes and adapter refactors
- `Phase 5A` Shipping Automation and Label Generation (flat rates, no live quotes)
- `Phase 5B` COD Reconciliation and Courier Settlement Operations
- `Phase 5C` Payment Gateway Expansion
- `Phase 5D` SMS Provider Layer (transactional only)

---

## 2. Implementation Principles

- Reuse existing repo primitives before adding new abstractions.
- Keep all Phase 5 work feature-flagged until each workstream is stable.
- Use additive migrations only.
- Do not create a second fulfillment engine, second payment engine, second messaging engine, or second accounting source of truth.
- Preserve manual fallback paths for providers with incomplete APIs.
- Treat webhooks as source of truth wherever providers support them.
- Make each cut independently testable before moving to the next one.
- One migration (v25) for all Phase 5 schema work. If a later cut needs unforeseen columns, use v26 as overflow — not one migration per cut.

---

## 3. Current Repo Baseline (Verified Apr 10 2026)

This section records the actual state found during audit so future implementers do not need to re-check.

### Courier Adapters (16 files in `backend/services/couriers/`)

| Capability | State |
|-----------|-------|
| `bookShipment()` | 11 real (Leopards, TCS, BlueEx, Trax, PostEx, CallCourier, M&P, Rider, Swyft, DHL, FedEx), 2 stubs (Bykea, PakPost) |
| `getTracking()` | Same 11 real, same 2 stubs |
| `cancelShipment()` | All 13 return stub responses — no courier API supports it |
| `getRates()` | Does not exist on `BaseCourierAdapter` or any adapter |
| Factory | `getAdapter(key, config)` in `index.js` — falls back to GenericAdapter |

### Fulfillment (`backend/routes/fulfillment.js` — 966 lines)

- Full Pick/Pack/Dispatch/Loadsheet workflow operational
- Dispatch endpoint (line ~385) already calls `adapter.bookShipment()` — **courier automation is partially wired**
- `loadsheets` tracks `total_cod` (NUMERIC 12,2)
- `loadsheet_orders` tracks `is_cod` (BOOLEAN) and `cod_amount` (NUMERIC 12,2)
- No reconciliation status, no settlement import

### Payment Gateway (`backend/services/payment-gateway.js` — 138 lines)

- Functional pattern, not class-based (unlike courier adapters)
- `createCheckout()` reads `process.env.PAYMENT_GATEWAY` on every call
- Only xPay implemented. Manual mode throws on `createCheckout()`
- `verifyWebhook()` only handles `gateway === "xpay"`
- `createInvoiceCheckout()` is a thin wrapper around `createCheckout()`
- **Not extensible without refactor** — no registry, no factory

### Storefront Contract Drift

| Field | Frontend sends | Backend expects |
|-------|---------------|-----------------|
| `delivery_method` | `"shipping"` | `"ship_to_customer"` |

Frontend file: `StorefrontCheckout.jsx` line 204 uses value `"shipping"`.
Backend file: `storefront.js` line 541 checks `=== "ship_to_customer"`.
Quote service: `quote.js` line 15 documents `'ship_to_customer'`.

This mismatch means **storefront shipping orders silently fail validation**.

### Quote Service (`backend/services/quote.js` — 422 lines)

- `shippingTotal = 0` hardcoded at line 192 — `// v1 free shipping placeholder`
- No courier rate lookup, no shipping method selection
- Core pricing logic (tax, promotions, stock check) is solid

### Integration Settings

- `integration_settings` table has `category` column (default `'marketplace'`)
- Hub returns marketplace + courier + Shopify + WooCommerce categories
- No `payment`, `sms`, or `accounting` provider categories yet

### SMS State

- `customers.sms_consent` column exists
- `marketing.js` checks `sms_consent = true` in audience resolution
- **No SMS transport, no provider adapter, no delivery worker**
- `booking-reminders.js` does not exist (design doc assumed it did)

### Migration Version

- Current: **v24** (confirmed in `migrate-pg.js`)

---

## 4. Public Interfaces And Data Contracts

### Shipping Automation

- extend `GET /api/couriers` — add capability flags
- extend `PUT /api/couriers/:id` — add flat shipping rate config
- add `POST /api/couriers/:id/test-booking` — connectivity test
- add `POST /api/orders/:id/shipments/book` — book via adapter
- add `POST /api/orders/:id/shipments/:shipmentId/cancel` — cancel attempt
- add `POST /api/orders/:id/tracking/refresh` — pull latest from adapter
- extend `GET /api/orders/:id/tracking` — return persisted events
- extend `GET /api/fulfillment/dispatched-orders` — include shipment state
- extend `GET /api/fulfillment/loadsheets/:id` — include reconciliation state

### COD Reconciliation

- add `GET /api/fulfillment/cod/settlements` — list batches
- add `POST /api/fulfillment/cod/settlements/import` — import remittance CSV/paste
- add `GET /api/fulfillment/cod/settlements/:id` — batch detail with match state
- add `POST /api/fulfillment/cod/settlements/:id/match` — run matching
- add `POST /api/fulfillment/cod/settlements/:id/resolve` — resolve discrepancy
- add `POST /api/fulfillment/cod/settlements/:id/approve` — finance sign-off

### Payment Gateway Expansion

- keep `POST /api/billing/create-checkout`
- keep `GET /api/billing/payment-history`
- keep `POST /api/customer-invoices/:id/payment-link`
- refactor `backend/services/payment-gateway.js` to class-based adapter factory
- extend webhook routing in `POST /api/webhooks/:provider`
- add storefront payment session creation only after contract alignment

### SMS Provider Layer

- extend integrations hub connect/disconnect/status for SMS providers
- add `POST /api/integrations/:provider/send-test-sms`
- add internal SMS send service consumed by notifications and order updates

---

## 5. Schema — Migration v25

Single migration covering all Phase 5 schema additions.

### Files To Modify

- `backend/schema-pg.sql`
- `backend/migrate-pg.js`
- `backend/middleware/feature-flags.js`

### New Tables

**`order_shipments`** — durable shipment record per booking attempt

```
id, web_order_id (FK), courier_id (FK), tracking_number, label_url,
booking_ref, booking_payload (JSONB), booking_response (JSONB),
status (draft|booked|in_transit|delivered|cancelled|failed),
booked_at, cancelled_at, delivered_at,
last_tracking_refresh_at, last_tracking_payload (JSONB),
shipping_cost (NUMERIC 12,2), created_at
```

**`shipment_tracking_events`** — tracking event log

```
id, shipment_id (FK), event_status, event_description,
event_location, event_timestamp, raw_payload (JSONB), created_at
```

**`cod_settlement_batches`** — imported courier remittance batches

```
id, courier_id (FK), batch_ref, import_source (csv|manual|api),
total_lines, total_amount (NUMERIC 12,2),
matched_count, matched_amount (NUMERIC 12,2),
unmatched_count, short_amount (NUMERIC 12,2),
status (imported|matching|review|approved|rejected),
imported_by (FK), approved_by (FK),
imported_at, approved_at, created_at
```

**`cod_settlement_lines`** — individual remittance lines

```
id, batch_id (FK), courier_tracking_number, courier_order_ref,
remitted_amount (NUMERIC 12,2), courier_fee (NUMERIC 12,2),
match_status (unmatched|matched|short|over|duplicate),
matched_order_id (FK nullable), matched_loadsheet_order_id (FK nullable),
expected_amount (NUMERIC 12,2), difference (NUMERIC 12,2),
resolution_note, resolved_by (FK nullable), resolved_at, created_at
```

**`payment_webhook_events`** — idempotent webhook log across all payment contexts

```
id, provider, event_id (UNIQUE per provider), event_type,
payment_context (billing|invoice|storefront),
context_ref, raw_payload (JSONB), processed_at, created_at
```

**`storefront_payment_sessions`** — storefront checkout payment tracking

```
id, web_order_id (FK), provider, provider_ref,
amount (NUMERIC 12,2), currency_code (default 'PKR'),
status (pending|completed|failed|expired),
return_url, created_at, completed_at
```

**`sms_provider_messages`** — SMS delivery log

```
id, provider, recipient_phone, message_type (transactional|marketing),
message_body, provider_ref, delivery_status (queued|sent|delivered|failed),
failure_reason, cost (NUMERIC 8,4), sent_at, delivered_at, created_at
```

### Column Extensions

**`courier_integrations`** — add:

```
supports_booking BOOLEAN DEFAULT false,
supports_tracking BOOLEAN DEFAULT false,
supports_cancellation BOOLEAN DEFAULT false,
supports_labels BOOLEAN DEFAULT false,
provider_category TEXT DEFAULT 'domestic',
flat_shipping_rate NUMERIC(10,2),
encrypted_config_json TEXT,
last_healthcheck_at TIMESTAMPTZ,
last_healthcheck_status TEXT
```

**`loadsheets`** — add:

```
reconciliation_status TEXT DEFAULT 'pending'
  CHECK (reconciliation_status IN ('pending','in_progress','reconciled','disputed')),
reconciled_at TIMESTAMPTZ,
reconciled_by INTEGER REFERENCES employees(id),
expected_cod NUMERIC(12,2),
received_cod NUMERIC(12,2),
cod_difference NUMERIC(12,2)
```

**`web_orders`** — add:

```
active_shipment_id INTEGER REFERENCES order_shipments(id),
shipping_provider_status TEXT
```

**`payment_intents`** — add:

```
provider TEXT,
provider_status TEXT,
last_event_at TIMESTAMPTZ
```

**`customer_invoice_payment_links`** — add:

```
provider TEXT,
completed_at TIMESTAMPTZ,
raw_completion_payload JSONB
```

**`web_order_transactions`** — add:

```
provider_ref TEXT,
payment_context TEXT,
webhook_event_id INTEGER REFERENCES payment_webhook_events(id)
```

### Feature Flags

Seed in migration:

- `phase5_shipping_automation`
- `phase5_cod_reconciliation`
- `phase5_payment_gateways`
- `phase5_sms_providers`

### Indexes

- `order_shipments(web_order_id)`
- `order_shipments(tracking_number)`
- `shipment_tracking_events(shipment_id)`
- `cod_settlement_lines(batch_id)`
- `cod_settlement_lines(courier_tracking_number)`
- `payment_webhook_events(provider, event_id)` UNIQUE
- `sms_provider_messages(provider_ref)`

---

## 6. Pre-Work — Contract Fixes And Adapter Refactors

### Task 0A: Fix Storefront Contract Drift

**Goal:** Eliminate the `"shipping"` vs `"ship_to_customer"` mismatch so storefront shipping orders work.

**Files:**

- Modify: `frontend/src/pages/storefront/StorefrontCheckout.jsx`

**Change:** Replace `"shipping"` enum value with `"ship_to_customer"` in the frontend radio button and all conditional checks. The backend and quote service already use `"ship_to_customer"` — the frontend is the outlier.

**Required outcomes:**

- frontend sends `delivery_method: "ship_to_customer"` to backend
- all frontend conditional rendering uses `"ship_to_customer"`
- no backend changes needed

### Task 0B: Refactor Payment Gateway To Class-Based Adapter Pattern

**Goal:** Make `payment-gateway.js` extensible to multiple providers using the same pattern as the courier adapter layer.

**Files:**

- Modify: `backend/services/payment-gateway.js`

**Change:** Refactor from functional if/else dispatch to:

1. `BasePaymentAdapter` class with `createCheckout()`, `verifyWebhook()`, `isEnabled()` interface
2. `XPayAdapter` class extending base (move existing xPay logic)
3. `ManualAdapter` class extending base (throws on checkout, returns `isEnabled: false`)
4. `getPaymentAdapter(providerName)` factory function
5. Preserve existing `module.exports` API so callers (`billing.js`, `customer-invoices.js`, `webhooks.js`) do not need changes

**Required outcomes:**

- existing xPay + manual behavior is identical
- adding a new provider means adding one class file + one registry entry
- all existing callers continue working without modification

### Task 0C: Extend Integration Hub For New Provider Categories

**Goal:** Make the integrations hub aware of payment, SMS, and courier-capability metadata.

**Files:**

- Modify: `backend/routes/integrations/hub.js`
- Modify: `backend/routes/integrations/credentials.js`
- Modify: `backend/schemas/integrations.js`
- Modify: `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`

**Required outcomes:**

- hub API returns provider categories: `marketplace`, `courier`, `payment`, `sms`
- credentials endpoints accept `category` parameter
- frontend hub page shows tabbed/grouped view including payment and SMS sections
- courier capability flags (`supports_booking`, `supports_tracking`, etc.) appear in courier detail

---

## 7. Phase 5A — Shipping Automation And Label Generation

### Task 1: Wire Courier Adapters Into Fulfillment With Shipment Persistence

**Goal:** Turn the existing adapter library into a persistent, auditable shipment-booking surface.

**Files:**

- Modify: `backend/routes/couriers.js` — add `POST /:id/test-booking`, expose capability flags
- Modify: `backend/routes/fulfillment.js` — wire shipment booking through `order_shipments` table
- Modify: `backend/routes/orders.js` — add tracking refresh + shipment endpoints
- Modify: `backend/services/couriers/index.js` — no structural changes, just verify adapter returns match `order_shipments` column expectations

**Required outcomes:**

- `POST /api/orders/:id/shipments/book` calls `adapter.bookShipment()` and persists result to `order_shipments`
- tracking number, label URL, booking ref, and raw response are stored
- `web_orders.active_shipment_id` points to the latest booking
- providers without booking APIs (Bykea, PakPost, GenericAdapter) keep manual tracking entry path
- `POST /api/couriers/:id/test-booking` validates credentials by attempting a test booking or health ping

### Task 2: Add Tracking Refresh And Shipment Lifecycle

**Goal:** Make shipment state queryable and refreshable from courier APIs.

**Files:**

- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/fulfillment.js`
- Modify: `frontend/src/pages/redesign/FulfillmentRedesign.jsx`

**Required outcomes:**

- `POST /api/orders/:id/tracking/refresh` calls `adapter.getTracking()` and appends events to `shipment_tracking_events`
- `GET /api/orders/:id/tracking` returns persisted events without hitting the courier API
- fulfillment dispatched-orders view shows shipment status from `order_shipments`
- cancellation attempt via `POST /api/orders/:id/shipments/:shipmentId/cancel` calls adapter where supported, updates `order_shipments.status`

### Task 3: Replace Free Shipping Placeholder With Configurable Flat Rates

**Goal:** Replace `shippingTotal = 0` in the quote service with courier-based flat rates.

**Files:**

- Modify: `backend/services/quote.js`
- Modify: `backend/routes/storefront.js` — expose available shipping methods
- Modify: `frontend/src/pages/storefront/StorefrontCheckout.jsx` — shipping method selector

**Required outcomes:**

- `courier_integrations.flat_shipping_rate` drives shipping cost when delivery method is `ship_to_customer`
- quote service reads the selected courier's flat rate (or tenant default) instead of hardcoded 0
- storefront checkout shows available couriers with their flat rates when shipping is selected
- free shipping remains the fallback when no courier has a configured rate
- pickup orders are unaffected (shipping = 0)

---

## 8. Phase 5B — COD Reconciliation And Courier Settlement Operations

### Task 4: Add COD Settlement Import And Matching

**Goal:** Convert existing loadsheet and COD totals into a reconcilable operations workflow.

**Files:**

- Modify: `backend/routes/fulfillment.js`
- Modify: `frontend/src/pages/redesign/FulfillmentRedesign.jsx`

**Required outcomes:**

- `POST /api/fulfillment/cod/settlements/import` accepts CSV or pasted settlement data → creates `cod_settlement_batches` + `cod_settlement_lines`
- `POST /api/fulfillment/cod/settlements/:id/match` matches lines against `loadsheet_orders` by tracking number, then `web_orders` by order ref
- unmatched, short-remitted, over-remitted, and duplicate lines are flagged in `match_status`
- `GET /api/fulfillment/cod/settlements` lists batches with summary totals

### Task 5: Add COD Review, Approval, And Reporting

**Goal:** Make COD discrepancies a finance-reviewed workflow.

**Files:**

- Modify: `backend/routes/fulfillment.js`
- Modify: `backend/routes/reports/finance.js` (if exists, else create report query)
- Modify: `frontend/src/pages/redesign/FulfillmentRedesign.jsx`

**Required outcomes:**

- `POST /api/fulfillment/cod/settlements/:id/resolve` allows per-line resolution with notes
- `POST /api/fulfillment/cod/settlements/:id/approve` marks batch approved, updates `loadsheets.reconciliation_status`
- loadsheet detail view exposes reconciliation status, expected vs received COD, and difference
- settlement views are exportable (CSV)

---

## 9. Phase 5C — Payment Gateway Expansion

### Task 6: Generalize Payment Provider Handling

**Goal:** Expand the refactored payment adapter to support more providers across billing and invoice contexts.

**Files:**

- Modify: `backend/services/payment-gateway.js` (already refactored in Task 0B — add new adapter stubs)
- Modify: `backend/routes/billing.js`
- Modify: `backend/routes/customer-invoices.js`
- Modify: `backend/routes/webhooks.js`

**Required outcomes:**

- billing `create-checkout` passes provider selection to adapter factory
- invoice payment links use the same adapter factory
- webhook routing dispatches to correct adapter's `verifyWebhook()` by provider name
- `payment_webhook_events` table receives all webhook events for idempotency
- `payment_intents.provider` and `customer_invoice_payment_links.provider` are populated
- xPay behavior is unchanged — this task generalizes infrastructure, not adds new providers

### Task 7: Add Storefront Payment Support

**Goal:** Enable paid storefront checkout through the existing order and transaction tables.

**Files:**

- Modify: `backend/routes/storefront.js`
- Modify: `frontend/src/pages/storefront/StorefrontCheckout.jsx`
- Modify: `frontend/src/pages/storefront/StorefrontOrderStatus.jsx` (if exists)

**Prerequisite:** Task 0A (contract alignment) must be complete.

**Required outcomes:**

- storefront checkout can create a `storefront_payment_sessions` record and redirect to gateway
- payment completion via webhook records transaction in `web_order_transactions`
- unpaid/COD/manual fallback remains possible when no provider is configured
- `web_orders.payment_status` updates to `paid` on successful gateway completion

---

## 10. Phase 5D — SMS Provider Layer

### Task 8: Add SMS Provider Abstraction

**Goal:** Turn SMS consent infrastructure into actual delivery capability.

**Files:**

- Create: `backend/services/sms.js` — provider adapter (start with one Pakistan provider: e.g., Zong, Jazz, or generic HTTP-to-SMS gateway)
- Modify: `backend/routes/integrations/credentials.js` — SMS provider credential storage
- Modify: `backend/routes/integrations/hub.js` — SMS provider status
- Modify: `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx` — SMS section

**Required outcomes:**

- `sms.js` exports `sendSms({ to, body, type })` — resolves configured provider, sends, persists to `sms_provider_messages`
- integrations hub supports SMS provider connection, credential storage, and test send
- `POST /api/integrations/:provider/send-test-sms` validates credentials with a real delivery
- delivery status (queued/sent/delivered/failed) is persisted

### Task 9: Connect SMS To Existing Notification Flows

**Goal:** Wire SMS delivery into order updates and transactional notifications.

**Files:**

- Modify: `backend/routes/orders.js` or `backend/routes/fulfillment.js` — send SMS on status change
- Modify: `backend/services/email.js` (optional — for unified `sendNotification` orchestration)

**Required outcomes:**

- order shipped / order delivered triggers SMS to customer when `sms_consent = true` and SMS provider is configured
- customer consent is always respected — no SMS without `sms_consent = true`
- SMS failures are logged, not thrown — order flow is never blocked by SMS failure
- marketing SMS reuse is **deferred** — this task is transactional only

---

## 11. Test Plan

### Backend Integration Coverage

- courier test booking via adapter (mock adapter + at least one real adapter in CI if credentials available)
- manual fallback shipment creation for adapters without booking APIs
- shipment persistence: booking → tracking refresh → cancellation
- label URL and tracking event storage and retrieval
- COD settlement import (CSV parse, idempotent re-import)
- COD matching against loadsheet orders and web orders
- COD discrepancy detection (short, over, unmatched, duplicate)
- COD approval workflow
- payment gateway adapter factory returns correct adapter by provider name
- billing checkout across xPay and manual providers
- invoice payment-link completion across xPay and manual providers
- webhook idempotency via `payment_webhook_events`
- storefront payment session creation and completion
- SMS provider send, delivery status persistence, consent enforcement
- SMS failure does not block calling flow

### Frontend Coverage

- integrations hub shows payment, SMS, and courier-capability sections
- fulfillment UI shows shipment booking button (real adapters) vs manual entry (generic)
- fulfillment UI shows COD reconciliation status on loadsheets
- storefront checkout sends `"ship_to_customer"` (not `"shipping"`)
- storefront checkout shows shipping method + cost selector
- storefront checkout handles paid and unpaid flows

### Regression Coverage

- existing integrations tests
- existing billing tests
- existing fulfillment and loadsheet tests
- existing invoice-link tests
- existing storefront checkout tests
- existing courier adapter tests

---

## 12. Assumptions And Defaults

- Phase 5 is one umbrella phase with four active cuts (5A–5D) and one deferred cut (5E).
- Migration v25 is the single schema migration. Use v26 only for unforeseen overflow.
- Reuse `integration_settings` and the integrations hub for payment and SMS provider credentials.
- Reuse `web_order_transactions` for storefront payment recording.
- Shipping cost uses configurable flat rates per courier, not live API rate quotes.
- SMS scope is transactional delivery only. Marketing SMS reuse is deferred.
- ERP/accounting exports (original 5E) are deferred until customer demand materializes.
- Payment scope is hosted or redirect checkout first.
- Additional courier count is not the primary success metric — wiring real automation into the existing adapter layer is.
- `cancelShipment()` remains best-effort — no Pakistan courier currently supports API cancellation.
