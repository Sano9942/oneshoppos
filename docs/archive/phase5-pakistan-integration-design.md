# Phase 5 Pakistan-Specific Integration Depth Design

**Date:** 2026-04-10  
**Audience:** Product owner, implementation engineers, reviewers, future agents  
**Status:** Repo-specific design baseline for the next competitive wave  
**Companion sources:** `competitive-analysis-2.md`, `feature-development-references.md`, `docs/plans/sano-plan.md`

---

## 1. Purpose

This document defines **Phase 5** for SanoPOS after the current Phase 1 omnichannel foundations, Phase 2 operational depth, Phase 3 engagement and financial tooling, and Phase 4 new verticals.

Phase 5 is not a new product family. It is the wave that turns the current Pakistan-market foundations into a more production-ready operating surface by wiring real external providers into the systems already present in the repo.

The purpose of this design is to make Phase 5:

- aligned with the competitive analysis
- grounded in the actual repo state rather than stale roadmap wording
- explicit about which existing systems must be extended
- split into controlled internal cuts instead of one oversized integration project

Phase 5 in this design covers:

- shipping automation and labels
- COD reconciliation and courier settlement operations
- payment gateway expansion
- SMS provider delivery
- ERP and accounting exports

This document is based on:

- the current repo inspection of courier adapters, fulfillment, loadsheets, billing, invoice links, storefront checkout, webhooks, marketing, messaging, and integrations hub
- the current competitive phase definitions in `competitive-analysis-2.md`
- the curated reference mapping in `feature-development-references.md`
- the founder and Pakistan payment strategy notes in `docs/plans/sano-plan.md`

---

## 2. Scope Decision

### 2.1 What Phase 5 Covers

Phase 5 is one umbrella wave with five internal delivery cuts:

- `Phase 5A` Shipping Automation and Label Generation
- `Phase 5B` COD Reconciliation and Courier Settlement Operations
- `Phase 5C` Payment Gateway Expansion
- `Phase 5D` SMS Provider Layer
- `Phase 5E` ERP and Accounting Exports

### 2.2 Why Phase 5 Should Stay Umbrella-Shaped

The competitive roadmap already positions Phase 5 as Pakistan-specific integration depth. That positioning is still correct after repo review because the workstreams reuse the same existing foundations:

- integrations hub and encrypted provider credentials
- fulfillment and courier settings
- loadsheets and COD totals
- billing checkout and invoice payment links
- storefront checkout and order transaction tables
- marketing, reminders, and customer consent surfaces

The correct strategy is **one wave, five controlled cuts**, not five disconnected roadmap phases.

### 2.3 Delivery Order

The recommended execution order is fixed:

1. `Phase 5A` Shipping Automation and Label Generation
2. `Phase 5B` COD Reconciliation and Courier Settlement Operations
3. `Phase 5C` Payment Gateway Expansion
4. `Phase 5D` SMS Provider Layer
5. `Phase 5E` ERP and Accounting Exports

This order is recommended because:

- shipping automation unlocks the real value of the courier adapter layer already in the repo
- COD reconciliation depends on shipping, loadsheet, and courier event data being treated as first-class records
- payment expansion must support billing, invoice links, and storefront checkout, and storefront shipping/payment contracts still need alignment
- SMS delivery should consume the same provider and event patterns rather than becoming a standalone notification engine
- ERP exports are safest once payment, shipping, and COD records are stable enough to export

### 2.4 What Phase 5 Does Not Cover

Phase 5 does not include:

- POS terminal hardware integrations
- card vaulting or saved cards
- full bidirectional ERP sync
- full courier-aggregator marketplace behavior
- building a licensed payment rail or bank-like ledger
- replacing the current fulfillment, billing, or marketing systems with separate parallel products

---

## 3. Re-Research Summary

### 3.1 The Roadmap Direction Is Right, But The Repo Is Further Along Than The Phase Label Suggests

The roadmap text says Phase 5 is about additional couriers, payment gateways, ERP integrations, COD reconciliation, and SMS providers. That is directionally correct, but the repo inspection shows the implementation starting point is stronger than the roadmap implies:

- courier adapter classes already exist for 13 providers
- loadsheets and COD totals already exist
- billing checkout and invoice links already use a hosted-checkout style payment adapter
- storefront orders already have a transaction table
- the integrations hub already exists and can host new provider types
- SMS intent already exists in reminders, customer consent, and marketing schemas

Important design implication:

- Phase 5 should focus on **wiring, normalization, and operational depth**
- not on pretending the repo has no integration layer yet

### 3.2 Corrected Understanding After Fresh Validation

The re-check surfaced several corrections that the implementation should not miss:

- **Courier automation is the main gap, not courier count alone**. The repo already has many courier adapters, but route handlers still mostly do manual assignment and static tracking URLs.
- **COD reconciliation should extend loadsheets**, because `loadsheets`, `loadsheet_orders`, `total_cod`, and dispatched-order views already exist.
- **Payment work is split across three contexts**:
  - tenant billing via `payment_intents`
  - customer invoice links via `customer_invoice_payment_links`
  - storefront and order payments via `web_order_transactions`
- **Storefront checkout is not payment-ready**. It still creates unpaid orders and still uses a free-shipping placeholder in `backend/services/quote.js`.
- **SMS is only partially implemented**. Appointment reminders can mark a reminder as `sms`, and marketing schemas allow `sms`, but there is no actual SMS transport/provider adapter yet.
- **ERP/accounting work should be export-first**. The repo already has strong internal accounting and finance surfaces, so the first value is structured export and sync jobs, not deep bidirectional accounting ownership.

### 3.3 The Repo Also Has One Contract Risk That Phase 5 Should Explicitly Absorb

The storefront checkout frontend and backend appear to have request-shape drift:

- the storefront frontend uses one field naming style
- the storefront backend expects another

That mismatch is not the whole Phase 5 objective, but it matters because payment gateway rollout for storefront orders should not be planned on top of a shaky contract.

Important design implication:

- storefront contract alignment belongs inside Phase 5 shared foundations before storefront payment collection goes live

---

## 4. Reference Mapping

### 4.1 Vendor References

Use these vendor references directly when defining lifecycle, API shape, and provider behavior.

#### Shopify Shipping and Fulfillment

- Shopify CarrierService API: https://shopify.dev/docs/api/admin-rest/latest/resources/carrierservice
- Shopify Shipping Labels guide: https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/shipping-labels
- Shopify FulfillmentService API: https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentservice
- Shopify fulfillment integration example: https://github.com/Shopify/shopify-fulfillment-integration
- Shopify `active_shipping` reference: https://github.com/Shopify/active_shipping

#### Square Payments

- Square Web Payments SDK overview: https://developer.squareup.com/docs/web-payments/overview
- Square Web Payments quickstart: https://github.com/square/web-payments-quickstart
- Square Node SDK: https://github.com/square/square-nodejs-sdk
- Square Connect API examples: https://github.com/square/connect-api-examples

### 4.2 Open-Source GitHub References

Use these as architecture and workflow references only.

#### Pakistan and POS Workflow References

- OpenSourcePOS: https://github.com/opensourcepos/opensourcepos

Use OpenSourcePOS mainly for:

- tax and receipt workflow ideas
- COD and payment reconciliation workflow ideas
- operational settings and merchant configuration patterns

### 4.3 Internal Repo References

These repo documents should guide implementation framing and rollout order:

- `competitive-analysis-2.md`
- `feature-development-references.md`
- `docs/plans/sano-plan.md`

### 4.4 License Guidance For Phase 5

Several useful OSS references are under restrictive licenses or are not suitable for direct code reuse.

Practical rule for Phase 5:

- use official vendor docs and SDKs for API contracts
- use sample apps and OSS projects for workflow and UX study
- do **not** copy direct implementation code from restrictive OSS into SanoPOS

For Phase 5 specifically:

- Shopify and Square docs can guide request flow, webhooks, payment session patterns, and provider abstractions
- `opensourcepos/opensourcepos` should be treated as study-only workflow inspiration

---

## 5. Current Repo Baseline

### 5.1 Backend Foundations To Reuse

Primary backend bases:

- `backend/services/couriers/index.js`
- `backend/services/couriers/*.js`
- `backend/routes/couriers.js`
- `backend/routes/fulfillment.js`
- `backend/routes/billing.js`
- `backend/routes/customer-invoices.js`
- `backend/routes/storefront.js`
- `backend/routes/webhooks.js`
- `backend/routes/integrations/hub.js`
- `backend/routes/integrations/credentials.js`
- `backend/services/payment-gateway.js`
- `backend/services/marketing.js`
- `backend/services/booking-reminders.js`
- `backend/schema-pg.sql`
- `backend/migrate-pg.js`

### 5.2 Frontend Foundations To Reuse

Primary frontend bases:

- `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`
- `frontend/src/pages/redesign/FulfillmentRedesign.jsx`
- `frontend/src/pages/redesign/BillingRedesign.jsx`
- `frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx`
- `frontend/src/pages/storefront/StorefrontCheckout.jsx`
- `frontend/src/pages/storefront/useStorefrontCart.js`

### 5.3 Existing Systems Already In Repo

These are especially important for Phase 5:

- `courier_integrations` already stores provider metadata and credentials
- 13 courier adapters already implement `bookShipment`, `getTracking`, and `cancelShipment`
- `loadsheets` and `loadsheet_orders` already capture COD-oriented dispatch grouping
- `payment_intents` already drives tenant billing checkout
- `customer_invoice_payment_links` already drives hosted invoice links
- `web_order_transactions` already exists for order-level payment records
- `integration_settings` already stores provider credentials for non-courier integrations
- customer consent already includes `sms_consent` and `whatsapp_consent`
- appointment reminders can already schedule `sms`

### 5.4 Important Current Gaps

The repo also has specific operational gaps that Phase 5 must absorb:

- courier adapters are not yet wired into route-level shipment booking flows
- `backend/routes/couriers.js` still uses manual tracking-number assignment instead of adapter-driven booking
- `backend/services/quote.js` still sets `shippingTotal = 0`
- storefront checkout still creates unpaid orders with no gateway collection
- SMS delivery has no provider abstraction or delivery worker path
- integrations schemas and hub metadata do not yet model payment providers, SMS providers, or accounting providers as first-class categories

### 5.5 Core Phase 5 Design Principle

Phase 5 must **extend the current integration, fulfillment, billing, and messaging systems** instead of building disconnected subsystems.

That means:

- shipping builds on courier adapters plus fulfillment and loadsheets
- COD builds on loadsheets and dispatched-order lifecycle
- payments build on the current hosted-checkout adapter and webhook model
- SMS builds on current customer consent, reminders, and campaign intent
- accounting exports build on current internal accounting truth, not external-system-first modeling

---

## 6. Architecture By Cut

## 6.1 Phase 5A - Shipping Automation and Label Generation

### Goal

Turn the current courier layer from a configuration catalog into a real shipment automation surface.

### Core Behaviors

- quote courier rates where the provider supports it
- book shipments from fulfillment flows
- persist tracking number, label URL, and courier booking metadata
- support booking cancellation where the provider supports it
- refresh live tracking state where the provider supports it

### Reuse Path

- use `backend/services/couriers/getAdapter()`
- extend `backend/routes/couriers.js` and `backend/routes/fulfillment.js`
- keep manual fallback for providers with no public book/cancel API

### Non-Goals For v1

- universal carrier aggregation logic
- advanced rate shopping across every provider
- multi-package or customs-document workflows

## 6.2 Phase 5B - COD Reconciliation and Courier Settlement Operations

### Goal

Make COD a controlled finance-and-operations process rather than a static loadsheet total.

### Core Behaviors

- import courier remittance and settlement batches
- match remittance lines against loadsheet orders and web orders
- flag short remittance, missing remittance, and duplicate remittance
- track reconciliation status and finance review outcomes
- support manual review when provider data is partial

### Reuse Path

- extend `loadsheets` and `loadsheet_orders`
- reuse fulfillment dispatched-order and handover lifecycle
- surface COD review in the existing fulfillment area

### Non-Goals For v1

- full courier accounting automation
- bank-statement reconciliation inside Phase 5

## 6.3 Phase 5C - Payment Gateway Expansion

### Goal

Expand the current payment adapter so it can power more provider types and more transaction contexts.

### Required Contexts

Phase 5 payment work must support:

- tenant billing
- customer invoice links
- storefront checkout

### Core Behaviors

- keep hosted or redirected checkout as the default integration shape
- generalize xPay-oriented flows into provider-neutral internal processing
- support provider-specific webhooks with idempotent event handling
- store payment events and references per payment context
- align storefront checkout contracts before adding live payment collection

### Reuse Path

- keep `backend/services/payment-gateway.js` as the adapter entrypoint
- keep `backend/routes/webhooks.js` as the webhook aggregation area
- reuse `payment_intents`, `customer_invoice_payment_links`, and `web_order_transactions`

### Non-Goals For v1

- saved cards
- terminal card-present flows
- wallet ledger ownership by SanoPOS

## 6.4 Phase 5D - SMS Provider Layer

### Goal

Turn existing SMS intent into actual transactional delivery.

### Core Behaviors

- store SMS provider credentials in the integrations system
- support provider test and health checks
- send transactional SMS for reminders, order updates, and alerts
- persist provider message references and delivery status
- later allow marketing sends to reuse the same provider layer

### Reuse Path

- customer consent fields already exist
- marketing schemas already allow `sms`
- appointment reminders already create `sms` channel reminders
- integrations hub should become the provider-management surface

### Non-Goals For v1

- full two-way SMS inbox
- complex SMS campaign analytics beyond delivery success and failure

## 6.5 Phase 5E - ERP and Accounting Exports

### Goal

Let merchants export high-value accounting and settlement records into external systems without weakening SanoPOS as the source of truth.

### Core Behaviors

- create export jobs for QuickBooks and Xero
- export invoices, payments, COD settlements, and selected accounting summaries
- persist job results, retries, and per-record export status
- allow replay-safe re-export of failed items

### Reuse Path

- build on current accounting and finance records already inside SanoPOS
- extend integrations hub for provider connection and export status

### Non-Goals For v1

- full bidirectional sync
- external chart-of-accounts ownership
- external-system-driven mutation of internal accounting records

---

## 7. Delivery Model

### 7.1 Shared Foundations Before Any Cut

Before any cut starts, the implementation should align:

- provider metadata in integrations schemas and hub UI
- storefront checkout request and response contracts
- internal payment event handling so billing, invoice, and storefront flows can share infrastructure

### 7.2 Recommended Internal Cuts

- `5A1` adapter wiring, label persistence, tracking refresh, manual fallback
- `5A2` optional rate quote support and shipping-selection surfaces
- `5B1` settlement import, matching, discrepancy review
- `5B2` remittance approval workflow and reporting
- `5C1` provider-neutral billing and invoice-link expansion
- `5C2` storefront paid checkout rollout after contract alignment
- `5D1` transactional SMS provider abstraction
- `5D2` marketing SMS reuse
- `5E1` export jobs and mappings
- `5E2` operator-facing export status and retry tools

---

## 8. Key Guardrails

- Do not create a second payment engine next to the current billing and invoice-link systems.
- Do not create a second fulfillment subsystem next to loadsheets and dispatched-order workflows.
- Do not add storefront payment collection before fixing storefront contract drift.
- Do not promise fully automated courier support for providers that only support manual booking.
- Do not let ERP export requirements redefine SanoPOS internal accounting semantics.

---

## 9. Phase 5 Outcome

If implemented correctly, Phase 5 should make SanoPOS feel more operationally complete in the Pakistan market without changing its product identity.

The expected outcome is:

- courier automation becomes real where providers support it
- COD stops being only a dispatch total and becomes a reconcilable workflow
- payment gateway support expands across the right existing contexts
- SMS becomes an actual delivery channel instead of a planned channel
- external accounting exports become possible without ceding internal control
