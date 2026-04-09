# Phase 1+ Omnichannel Foundation Implementation Plan

**Companion design:** `docs/2026-04-09-phase1-plus-omnichannel-design.md`  
**Goal:** Deliver the first true omnichannel wave on the existing SanoPOS stack

---

## Summary

Implement omnichannel in eight workstreams, using the current React frontend, Express backend, Postgres schema, and existing `web_orders` plus fulfillment infrastructure.

This plan assumes:

- we keep `sales` for completed POS sales
- we keep `web_orders` for all non-POS and routed omnichannel orders
- we add reservation and allocation primitives rather than replacing fulfillment
- we correct stale roadmap assumptions before coding

---

## Key Changes

## 1. Baseline Reconciliation and Schema Changes

### Deliverables

- align docs and implementation assumptions with current repo reality
- add migrations for:
  - `sales_channels`
  - `channel_publications`
  - `inventory_reservations`
  - `web_order_allocations`
  - `customer_addresses`
  - `storefront_carts`
- extend:
  - `web_orders`
  - `returns`

### Required behavior

- preserve existing marketplace-imported orders
- preserve current fulfillment tables and routes
- preserve current price-list and parked-sales behavior

### Implementation notes

- schema source of truth remains `backend/schema-pg.sql`
- migration path goes through `backend/migrate-pg.js`
- `sales_channels` must be seeded with at least:
  - `pos`
  - `storefront`
  - `shopify`
  - `woocommerce`
  - `daraz`
  - `facebook`
  - `instagram`
  - `whatsapp`

## 2. Public Storefront Read Layer

### Deliverables

- frontend public route set under `/store/:tenantSlug/*`
- backend public storefront routes under `/api/storefront/*`
- storefront browse experience using current frontend app

### Public APIs

- `GET /api/storefront/config`
- `GET /api/storefront/categories`
- `GET /api/storefront/products`
- `GET /api/storefront/products/:id`
- `GET /api/storefront/pickup-locations`

### Required behavior

- tenant-scoped public access using the existing public-tenant resolution pattern
- published products only
- approved reviews only
- storefront-safe response shapes only

### Implementation notes

- reuse category-tree and product media patterns where possible
- do not reuse internal admin payloads directly
- add a dedicated storefront serializer layer

## 3. Reservation and Allocation Engine

### Deliverables

- inventory hold logic for active carts and newly created orders
- outlet-level fulfillment allocation logic

### Required behavior

- quote determines candidate outlet availability
- checkout creates reservations and allocations atomically
- reservations can expire, release, convert, and be audited
- allocations determine which outlet fulfills each web order line

### Defaults to lock

- reservation TTL: 15 minutes for anonymous carts
- checkout converts reservations from `active` to `converted`
- expired carts release reservations automatically
- pickup orders default allocation to selected pickup outlet
- ship-to-customer orders allocate to best eligible outlet with stock

### Compatibility note

- current direct stock-application behavior for marketplace orders stays intact until storefront checkout is live

## 4. Checkout and Storefront Order Creation

### Deliverables

- `POST /api/storefront/cart/quote`
- `POST /api/storefront/checkout`
- `GET /api/storefront/orders/:token`

### Required behavior

- one quote engine for pricing, discounts, taxes, and availability
- checkout writes:
  - `web_orders`
  - `web_order_items`
  - `inventory_reservations`
  - `web_order_allocations`
- public order lookup uses `public_order_token`, never raw ID

### Defaults to lock

- storefront orders use channel `storefront`
- `delivery_method` values:
  - `pickup`
  - `ship_to_customer`
- checkout stores customer contact/address snapshot on the order even if customer profile changes later

## 5. BOPIS and Curbside

### Deliverables

- pickup-enabled checkout flow
- pickup-ready status transition
- curbside arrival signal

### Required APIs

- `POST /api/storefront/orders/:token/arrive`
- internal status transitions on `web_orders`
- fulfillment readiness surfaced in existing fulfillment/order screens

### Required behavior

- pickup orders are visible to store staff
- pickup orders become ready after internal prep
- curbside arrival creates an operational signal without changing payment state
- pickup completion records `picked_up_at`

### Defaults to lock

- BOPIS uses existing fulfillment staff surfaces where feasible
- curbside is a workflow overlay on BOPIS, not a separate order type

## 6. Ship-from-Store and Endless Aisle

### Deliverables

- allocated storefront shipping orders flow through current picklist/loadsheet process
- POS endless-aisle action creates routed `web_order` records

### Required behavior

- shipping orders from storefront become picklist candidates for the assigned outlet
- POS can create a routed order when current outlet lacks stock
- endless-aisle order uses `web_orders`, not `sales`

### Defaults to lock

- endless aisle is initiated from POS but fulfilled through omnichannel order infrastructure
- no attempt to force endless-aisle orders through current POS sale posting

## 7. Online-Order Returns and Unified Customer History

### Deliverables

- `returns.web_order_id`
- online-order return lookup in staff flows
- unified order-history read model for customers

### Required behavior

- in-store staff can locate and process storefront orders for return
- stock is restored to the chosen outlet
- customer history merges:
  - POS sales
  - storefront orders
  - marketplace orders where linked

### Defaults to lock

- return policy logic is simple in v1 and should not block base support
- unified history is read-model aggregation first, not a full event-sourcing redesign

## 8. Omnichannel Promotions and Final Regression Hardening

### Deliverables

- shared promotion evaluation between storefront quote and future omnichannel order paths
- regression pass across existing order, fulfillment, pricing, and public endpoints

### Required behavior

- same promotion should calculate the same outcome regardless of POS or storefront path where applicable
- current POS price-list behavior must continue unchanged
- current marketplace order ingestion and reporting must continue unchanged

### Defaults to lock

- promotion unification starts with quote/shared service behavior, not a full no-code promotion rebuild

---

## Public APIs, Interfaces, and Types

### New backend route group

- `backend/routes/storefront.js`

### New logical frontend modules

- storefront route config under `publicRoutes.jsx`
- storefront pages/components under public page/component structure

### New or extended backend data contracts

- storefront product summary payload
- storefront product detail payload
- quote request/response payload
- checkout request/response payload
- public order-status payload
- allocation and reservation internal service contracts

### Required internal service boundaries

- storefront serializer layer
- quote service
- reservation service
- allocation service

---

## Test Plan

## Backend tests

- public storefront endpoints require valid tenant context and reject missing tenant
- public storefront endpoints return only published products
- quote rejects unpublished, invalid, or unavailable items
- checkout is atomic across order, items, reservations, and allocations
- reservation expiry releases stock correctly
- pickup orders allocate to selected outlet
- ship-to-customer orders allocate to fulfillment outlet
- returns can reference `web_order_id`
- customer-history aggregation merges channels without duplicate order rows

## Frontend and E2E tests

- browse storefront by tenant slug
- add to cart and quote totals
- complete pickup order
- complete shipping order
- trigger curbside arrival
- create endless-aisle order from POS
- fulfill storefront order in current fulfillment UI
- process return for storefront order in staff workflow

## Regression tests

- marketplace-imported `web_orders` still appear and function
- current picklist and loadsheet flows remain stable
- current price-list flows in POS remain stable
- current parked-sales flows remain stable
- current public receipt and review flows remain stable

---

## Assumptions

- Storefront v1 stays inside the current frontend app.
- Public backend access uses the same tenant-resolution pattern already used by public receipt and product-review routes.
- `web_orders` remains the single non-POS order ledger.
- Existing fulfillment routes are extended, not replaced.
- Shopify is the primary external product-model reference for this wave.
- Square is a secondary reference and is not the architectural base for the storefront.
- The first implementation wave excludes restaurant, appointments, service-business tooling, banking, BNPL, and full CMS/page-builder work.
