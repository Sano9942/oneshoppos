# Phase 1+ Omnichannel Foundation Design

**Date:** 2026-04-09  
**Audience:** Product owner, implementation engineer, future agents  
**Status:** Design baseline for the first true omnichannel wave

---

## 1. Purpose

This document defines the **repo-specific design** for turning SanoPOS from a strong in-store and back-office POS into a real omnichannel commerce platform.

It combines:

1. Fresh vendor verification from official Shopify and Square docs
2. Fresh open-source verification from the referenced GitHub repos
3. Actual SanoPOS codebase reality as of this repo state

This design is authoritative for the first omnichannel implementation wave.

---

## 2. Baseline Corrections vs Earlier Research Notes

Several items previously listed as open gaps are now already present, at least partially, in the codebase.

### Already built in the current repo

- `web_orders`, `web_order_items`, `web_order_fulfillments` already exist in `backend/schema-pg.sql`
- fulfillment pick/pack/dispatch already exists in `backend/routes/fulfillment.js`
- loadsheets already exist in `backend/routes/fulfillment.js`
- marketplace order import paths already exist for Shopify, Daraz, Facebook/Instagram, and WhatsApp-linked flows
- multi-channel reporting already exists in `backend/routes/reports/multichannel.js`
- price lists already exist in `backend/routes/products.js`
- POS already consumes price lists in `frontend/src/pages/redesign/pos/POSContext.jsx`
- parked sales are already server-backed through `backend/routes/parked-sales.js`
- the integrations hub already exists in `backend/routes/integrations/*` and `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`

### Still genuinely missing

- customer-facing storefront and public catalog
- public cart and checkout flows
- outlet-aware inventory reservation/hold system
- explicit fulfillment allocation for omnichannel orders
- BOPIS workflow
- curbside workflow
- endless aisle workflow from POS
- in-store return of online orders
- unified customer order history across POS plus web plus marketplaces in one customer view
- omnichannel promotion evaluation shared by POS and storefront

### Important design implication

This is **not** a greenfield omnichannel build.  
The correct approach is to **extend and normalize existing order/fulfillment primitives**, not replace them.

---

## 3. Fresh External Verification

### Shopify, verified fresh

- Shopify Storefront API is the current official headless commerce API for browse, cart, and checkout flows: https://shopify.dev/docs/api/storefront/latest
- Shopify explicitly positions **Hydrogen** as the official React framework for headless storefronts: https://shopify.dev/docs/api/storefront/latest and https://github.com/Shopify/hydrogen
- Shopify documents **local pickup** for headless storefronts through the Storefront API: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/local-pickup
- Shopify still uses **FulfillmentOrder** as the core fulfillment-routing primitive for omnichannel operations: https://shopify.dev/docs/api/admin-rest/2025-07/resources/fulfillmentorder
- Shopify return management has moved toward newer **return processing** flows and should not be modeled on older refund-only assumptions: https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management and https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/migrate-to-return-processing
- Shopify **PriceList** remains the correct reference for contextual pricing: https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist
- Shopify **Discount Functions** remain the best reference for omnichannel automatic discount logic: https://shopify.dev/docs/api/functions/latest/discount
- Shopify POS **Draft Order API** exists, but in POS extensions it is contextual/read-only, so SanoPOS should keep its own server-side draft-cart implementation: https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis/contextual-apis/draft-order-api

### Square, verified fresh

- Square Checkout remains a hosted checkout and payment-link model, useful as a payments and remote-payment reference, not as the primary storefront architecture: https://developer.squareup.com/docs/checkout-api and https://developer.squareup.com/reference/square/checkout-api
- Square Online APIs center on hosted site customization and snippets, not a full headless storefront foundation comparable to Shopify Storefront API: https://developer.squareup.com/docs/online-api and https://developer.squareup.com/docs/snippets-api/overview

### Open-source verification

- Hydrogen is still the strongest official storefront reference: https://github.com/Shopify/hydrogen
- Shopify function examples remain the strongest official discount-function reference: https://github.com/Shopify/function-examples
- Medusa remains a strong Node/TypeScript commerce architecture reference: https://github.com/medusajs/medusa
- Saleor storefront remains a strong React storefront reference: https://github.com/saleor/storefront
- Square’s official SDK and examples remain valid secondary references: https://github.com/square/square-nodejs-sdk and https://github.com/square/connect-api-examples

### Architectural conclusion from fresh verification

For SanoPOS storefront and omnichannel design:

- **Shopify should be the primary product-model reference**
- **Square should be a secondary product and payments reference**
- **Hydrogen, Medusa, and Saleor should inform architecture and UX**

---

## 4. Product Goal

Build the first omnichannel wave that enables:

1. Public storefront per tenant
2. Buy online, pick up in store
3. Ship-from-store
4. Endless aisle from POS
5. In-store return of online orders
6. Shared promotion and customer-history logic across channels

This wave must fit the current multi-tenant Express + React + Postgres architecture.

---

## 5. Existing Repo Foundations to Reuse

### Backend

- `backend/schema-pg.sql`
- `backend/routes/orders.js`
- `backend/routes/fulfillment.js`
- `backend/routes/parked-sales.js`
- `backend/routes/products.js`
- `backend/routes/categories.js`
- `backend/routes/customers.js`
- `backend/routes/returns.js`
- `backend/routes/reports/multichannel.js`
- `backend/shopify/order-service.js`
- `backend/routes/integrations/*`

### Frontend

- `frontend/src/routes/publicRoutes.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/pages/LandingPage.jsx`
- `frontend/src/pages/redesign/FulfillmentRedesign.jsx`
- `frontend/src/pages/redesign/OrdersRedesign.jsx`
- `frontend/src/pages/redesign/CustomersRedesign.jsx`
- `frontend/src/pages/redesign/pos/POSContext.jsx`

### Reusable current concepts

- tenant-scoped public route resolution via `?tenant=<slug>`
- `web_orders` as the existing non-POS order ledger
- `picklists` and `loadsheets` as the current fulfillment execution layer
- `price_lists` as the current pricing override primitive
- `external_sync_events` as the current sync/event primitive

---

## 6. Target Architecture

### Core decision

Use the **existing frontend app** and **existing backend app**.

Do **not** introduce a separate storefront codebase in v1.

### Public storefront surface

- Frontend public routes under `/store/:tenantSlug/*`
- Backend public APIs under `/api/storefront/*`
- Public APIs resolve tenant using the same pattern already used by public receipts and public product-review submission

### Order-system boundary

- `sales` remains the canonical in-store POS sale record
- `web_orders` becomes the canonical non-POS order record for:
  - storefront orders
  - pickup orders
  - ship-to-customer orders
  - endless-aisle POS-created routed orders
  - marketplace orders already imported today

### Fulfillment-system boundary

- Existing `picklists` and `loadsheets` stay in place
- New omnichannel work feeds those existing fulfillment flows by assigning `web_orders` to fulfillment outlets

---

## 7. Required Data Model Additions

## 7.1 New tables

### `sales_channels`

Purpose:

- define first-class channels such as `pos`, `storefront`, `shopify`, `woocommerce`, `daraz`, `facebook`, `instagram`, `whatsapp`

Suggested minimum fields:

- `id`
- `code`
- `name`
- `type`
- `is_active`
- `is_public`
- `created_at`

### `channel_publications`

Purpose:

- control whether a product is published to a specific channel
- support storefront publication without overloading global product visibility

Suggested minimum fields:

- `id`
- `channel_id`
- `product_id`
- `variant_id`
- `is_published`
- `published_at`
- unique `(channel_id, product_id, variant_id)`

### `inventory_reservations`

Purpose:

- temporary stock holds for active carts and pre-fulfillment order commitments

Suggested minimum fields:

- `id`
- `reservation_key`
- `channel_id`
- `web_order_id` nullable
- `product_id`
- `variant_id`
- `outlet_id`
- `quantity`
- `status` (`active`, `converted`, `expired`, `released`)
- `expires_at`
- `created_at`
- `updated_at`

### `web_order_allocations`

Purpose:

- explicit assignment of each order line or order group to the outlet that will fulfill it

Suggested minimum fields:

- `id`
- `web_order_id`
- `web_order_item_id`
- `fulfillment_outlet_id`
- `fulfillment_method` (`pickup`, `ship_to_customer`)
- `status`
- `allocated_qty`
- `created_at`
- `updated_at`

### `customer_addresses`

Purpose:

- normalized reusable customer delivery addresses for storefront and future channel orders

Suggested minimum fields:

- `id`
- `customer_id`
- `label`
- `recipient_name`
- `phone`
- `address_line_1`
- `address_line_2`
- `city`
- `province`
- `postal_code`
- `country_code`
- `is_default`

### `storefront_carts`

Purpose:

- persist anonymous or authenticated public carts and their quote state

Suggested minimum fields:

- `id`
- `cart_token`
- `customer_id` nullable
- `channel_id`
- `pickup_outlet_id` nullable
- `delivery_method`
- `currency`
- `quote_payload`
- `expires_at`
- `created_at`
- `updated_at`

## 7.2 Existing table extensions

### `web_orders`

Add:

- `channel_id`
- `delivery_method`
- `pickup_outlet_id`
- `fulfillment_outlet_id`
- `customer_name_snapshot`
- `customer_phone_snapshot`
- `customer_email_snapshot`
- `shipping_address_json`
- `pickup_ready_at`
- `picked_up_at`
- `curbside_arrived_at`
- `public_order_token`

### `returns`

Add:

- `web_order_id` nullable

This is required for in-store return of online orders.

---

## 8. Public API Design

## 8.1 Storefront read APIs

### `GET /api/storefront/config`

Returns:

- tenant branding
- currency
- enabled delivery methods
- pickup configuration
- storefront feature toggles

### `GET /api/storefront/categories`

Returns:

- public category tree only
- categories with at least one published product

### `GET /api/storefront/products`

Supports:

- category filter
- search
- sort
- pagination
- outlet context for pickup availability

Returns:

- storefront-safe product summaries only

### `GET /api/storefront/products/:id`

Returns:

- storefront-safe product detail
- images
- variants
- approved reviews
- pickup availability by outlet

### `GET /api/storefront/pickup-locations`

Returns:

- active pickup-capable outlets
- address/phone/name
- future-ready flags for curbside and pickup windows

## 8.2 Quote and checkout APIs

### `POST /api/storefront/cart/quote`

Purpose:

- single source of truth for totals, promotion application, pickup/delivery availability, and reservation candidates

Must evaluate:

- product publication
- stock availability
- price list / promotions logic where applicable
- delivery method
- pickup outlet

### `POST /api/storefront/checkout`

Creates:

- `web_order`
- `web_order_items`
- `inventory_reservations`
- `web_order_allocations`

Must be atomic.

### `GET /api/storefront/orders/:token`

Purpose:

- public order-status view without login

### `POST /api/storefront/orders/:token/arrive`

Purpose:

- curbside arrival notification for pickup orders

Updates:

- `curbside_arrived_at`
- order/pickup operational status

---

## 9. Channel Workflows

## 9.1 Storefront order

1. customer browses published products
2. customer requests quote
3. system checks publication, pricing, stock, outlet availability
4. checkout creates order plus reservation plus allocation
5. order enters existing fulfillment workflows if shipping or store-prep is required

## 9.2 BOPIS

1. customer selects pickup outlet
2. quote confirms pickup availability from that outlet
3. checkout creates pickup order allocated to pickup outlet
4. outlet staff picks/prepares order
5. order is marked ready
6. customer arrives and order is marked picked up

## 9.3 Curbside

This is a BOPIS extension.

Additional step:

- customer sends arrival signal through public order page

## 9.4 Ship-from-store

1. storefront order is allocated to outlet with stock
2. allocation feeds current `picklists`
3. packed orders move into current dispatch and loadsheet flows

## 9.5 Endless aisle

1. cashier in POS cannot fulfill from current outlet
2. POS checks cross-outlet availability
3. cashier creates routed non-POS order in `web_orders`
4. allocation assigns another outlet
5. fulfillment proceeds through current omnichannel order flow

## 9.6 In-store return of online order

1. staff finds web order
2. return is created against `web_order_id`
3. stock is restored to chosen outlet
4. refund/store-credit policy is applied

---

## 10. Promotion and Pricing Model

### Current repo truth

- price lists already exist and are already used in POS
- promotions exist, but current omnichannel evaluation is not unified

### Design decision

- introduce a shared quote/evaluation path for storefront and future omnichannel order creation
- do not duplicate promotion logic separately in POS and storefront

### Reference choice

- Shopify Discount Functions is the best external reference for rule-based automatic discount evaluation

---

## 11. Security and Multi-Tenant Model

### Public access

Public storefront endpoints must:

- require tenant resolution from route slug or query param
- use tenant DB switching exactly like current public receipt/product-review flows
- never expose internal-only fields

### Staff operations

Existing authenticated routes continue to use:

- tenant JWT auth
- permissions
- context selection

### Sensitive boundaries

- no internal stock administration fields in public product payloads
- no raw integration payloads in public order endpoints
- public order tracking must use tokenized access, not sequential IDs

---

## 12. Design Principles for Implementation

- prefer extending `web_orders` over inventing a second online-order model
- prefer feeding existing fulfillment primitives over duplicating warehouse workflows
- treat reservations as the minimum required omnichannel stock-control layer
- keep storefront v1 inside the current frontend for speed and operational simplicity
- use Shopify as the primary omnichannel product-model reference
- use Square as a supporting remote-payment and operational product reference only

---

## 13. Out of Scope for This Wave

- separate standalone storefront application
- restaurant vertical
- appointments vertical
- service-business tooling
- banking/BNPL/financial-licensing features
- location-specific pricing as a full standalone subsystem
- full CMS/page-builder system

---

## 14. Final Recommendation

The correct starting point for SanoPOS is:

1. storefront-safe catalog publication
2. reservation and allocation infrastructure
3. checkout into `web_orders`
4. BOPIS and ship-from-store on top of current fulfillment
5. endless aisle and online-order returns

This gives the fastest path from “strong Pakistan POS” to “real omnichannel commerce platform” while preserving the current codebase’s strengths instead of bypassing them.
