# Omnichannel Phase 1+ Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn SanoPOS from a POS + marketplace system into a real omnichannel commerce platform with public storefront, BOPIS, ship-from-store, endless aisle, and unified customer history.

**Architecture:** Extend existing `web_orders` + fulfillment infrastructure. Add reservation/allocation engine. Public storefront lives inside existing React app at `/store/:tenantSlug/*`. Backend storefront APIs at `/api/storefront/*`. Migration v18 adds 7 new tables + extends 2 existing tables.

**Tech Stack:** Express 5, React 19, PostgreSQL, Vite 7, Tailwind v4, nanoid for token generation.

---

## Implementation Status

> **Branch:** `omnichannel-phase1` — 21 commits, 30 files changed (+5,464 / -22 lines)
>
> **Last updated:** 2026-04-09

| WS | Status | Commits | Description |
|----|--------|---------|-------------|
| 1 | ✅ Done | `22eb50b` | Migration v18 + schema DDL |
| 2 | ✅ Done | `056637a`, `e341de8` | Storefront read APIs + frontend browse |
| 3 | ✅ Done | `e240153`, `ad9b89b`, `ed23642` | Reservation + allocation + expiry worker |
| 4 | ✅ Done | `40e16d8`, `91ca51c`, `4647f69`, `9a495e1` | Cart + quote + checkout APIs + frontend |
| 5 | ✅ Done | `58d7372`, `6a91d31` | BOPIS/curbside endpoints + fulfillment UI |
| 6 | ✅ Done | `7688d6f`, `c91406b`, `2128c47` | Endless aisle + ship-from-store picklists |
| 7 | ✅ Done | `7a9e861`, `3d9c23e`, `7c213d0` | Web order returns + unified history |
| 8 | ⚠️ Partial | `36c38b7`, `e4f89d2` | Promotions + channel publication done; **regression testing remains** |

### Regression Verification (completed locally)

| Check | Result |
|-------|--------|
| Frontend build (`vite build`) | ✅ Passes |
| Backend module loading (all new services) | ✅ All load cleanly |
| Backend unit tests (125 tests) | ✅ 125/125 pass |
| Frontend unit tests | ⚠️ Pre-existing failures (setup.js config issue, not caused by our changes) |

### What Remains Before Merge

1. **Run migration v18 against a test database** — verify all 7 tables create, column extensions apply, backfill runs
2. **Manual smoke test** of storefront browse/cart/checkout flow end-to-end
3. **Verify existing flows still work** (regression checklist below):
   - [ ] Marketplace-imported web_orders (Shopify/Daraz) — create, view, fulfill
   - [ ] Picklist and loadsheet flows — create, pick, pack, dispatch
   - [ ] POS price-list behavior — correct prices applied per customer group
   - [ ] Parked sales — park, retrieve, complete
   - [ ] Public receipt page — view by invoice number
   - [ ] Returns against POS sales — still work with `original_sale_id`
   - [ ] Multichannel report — still aggregates correctly
4. **Run full integration test suite** against test DB: `npx jest backend/tests/integration/ --runInBand`
5. **Run E2E Playwright tests** against staging: `cd frontend && npx playwright test`

---

## Confirmed Design Decisions

| Decision | Choice |
|----------|--------|
| `source` vs `channel_id` | Keep `source`, add `channel_id` alongside, backfill from source values |
| Storefront `external_order_id` | Generate `sf_<nanoid>` — column stays NOT NULL |
| Cart items storage | Separate `storefront_cart_items` table (normalized) |
| Storefront URL pattern | Path-based `/store/:tenantSlug/*` now, subdomain-ready later |
| Tenant resolution | Pluggable — extract slug from path param (storefront) or query param (legacy) |

---

## Workstream 1: Schema Migration (v18) + Seed Data — ✅ DONE

### Task 1.1: Add migration v18 — new tables + column extensions

**Commit:** `22eb50b`

**Files changed:**
- `backend/migrate-pg.js` — added v18 migration block (195 lines)
- `backend/schema-pg.sql` — added 7 CREATE TABLE + ALTER TABLE extensions (153 lines)

**What was built:**

7 new tables: `sales_channels` (seeded with 8 channels: pos, storefront, shopify, woocommerce, daraz, facebook, instagram, whatsapp), `channel_publications`, `inventory_reservations`, `web_order_allocations`, `customer_addresses`, `storefront_carts`, `storefront_cart_items`

Column extensions: 12 new columns on `web_orders` (channel_id, delivery_method, pickup/fulfillment outlets, customer snapshots, shipping address JSON, pickup/curbside timestamps, public_order_token) and 1 on `returns` (web_order_id)

Backfill: existing `web_orders` rows get `channel_id` set by matching `source` to `sales_channels.code`

16 indexes including partial indexes for active reservations and non-null web_order returns.

---

## Workstream 2: Public Storefront Read Layer — ✅ DONE

### Task 2.1: Create storefront route file with tenant resolution middleware

**Commit:** `056637a`

**Files changed:**
- Created: `backend/routes/storefront.js` (255 lines initially, grew to 909 with WS4/WS5 additions)
- Modified: `backend/routes/registerAllRoutes.js` (+3 lines — mount before auth middleware)

**Endpoints implemented:**
- `GET /api/storefront/config` — tenant branding, currency, delivery methods
- `GET /api/storefront/categories` — public category tree (published products only)
- `GET /api/storefront/products` — paginated, filterable published product summaries
- `GET /api/storefront/products/:id` — product detail with variants, images, approved reviews, pickup availability
- `GET /api/storefront/pickup-locations` — active pickup-capable outlets

Tenant resolution via `resolveStorefrontDb()` — reads `?tenant=` or `x-tenant-slug` header.

### Task 2.2: Create frontend storefront route shell and browse pages

**Commit:** `e341de8`

**Files created:**
- `frontend/src/pages/storefront/StorefrontLayout.jsx` — public layout with header, category nav, cart icon, `StorefrontContext`
- `frontend/src/pages/storefront/StorefrontHome.jsx` — hero + featured products + category cards
- `frontend/src/pages/storefront/StorefrontProducts.jsx` — category filter, search, sort, pagination, responsive grid
- `frontend/src/pages/storefront/StorefrontProductDetail.jsx` — image gallery, variants, reviews, pickup availability

**Files modified:**
- `frontend/src/routes/publicRoutes.jsx` — added `/store/:tenantSlug` nested routes

---

## Workstream 3: Reservation and Allocation Engine — ✅ DONE

### Task 3.1: Create reservation service

**Commit:** `e240153`

**File created:** `backend/services/reservation.js` (165 lines)

**Functions:**
- `createReservation()` — SELECT ... FOR UPDATE on outlet_stock, decrement, insert reservation with TTL
- `convertReservations()` — active → converted, sets web_order_id
- `releaseReservations()` — restore stock atomically, sorted keys to prevent deadlocks
- `expireStaleReservations()` — fault-isolated per-reservation processing, re-checks status under lock
- `getActiveReservationsForOutlet()` — SUM aggregation with COALESCE

### Task 3.2: Create allocation service

**Commit:** `ad9b89b`

**File created:** `backend/services/allocation.js` (92 lines)

**Functions:**
- `allocateOrder()` — pickup → specified outlet; ship → highest-stock outlet per item
- `getAllocationsForOrder()` — join with outlet names

### Task 3.3: Add reservation expiry worker

**Commit:** `ed23642`

**Files:**
- Created: `backend/workers/reservation-worker-boss.js` (63 lines) — pg-boss, `*/5 * * * *` cron
- Modified: `backend/boot/workers.js` — registered with `RESERVATION_WORKER_ENABLED=1` toggle

Multi-tenant aware: iterates active tenants via master DB. Heartbeat: `global.__reservationWorkerStatus`.

---

## Workstream 4: Cart, Quote, and Checkout — ✅ DONE

### Task 4.1: Create cart service

**Commit:** `40e16d8`

**File created:** `backend/services/storefront-cart.js` (186 lines)

**Functions:** `getOrCreateCart`, `addItem` (upserts with price fetch), `updateItem`, `removeItem`, `getCartWithItems` (joined with product details + computed subtotal)

### Task 4.2: Create quote service

**Commit:** `91ca51c`

**File created:** `backend/services/quote.js` (337 lines)

**Evaluates:** publication check, stock availability (per-outlet for pickup, cross-outlet for shipping), price resolution (variant override → product base), tax calculation (category → tax rate), delivery validation. Returns full pricing breakdown with availability errors.

**Updated in WS8** (`36c38b7`): Added promotion evaluation — same logic as POS `POST /api/promotions/quote`. Supports all 5 promo types. Per-item discount distribution proportional to subtotal share.

### Task 4.3: Add cart and checkout API endpoints to storefront routes

**Commit:** `4647f69`

**File modified:** `backend/routes/storefront.js`

**Endpoints:**
- `POST /api/storefront/cart` — create/get cart
- `GET /api/storefront/cart/:token` — get cart with items
- `POST /api/storefront/cart/:token/items` — add item
- `PUT /api/storefront/cart/:token/items/:itemId` — update quantity
- `DELETE /api/storefront/cart/:token/items/:itemId` — remove item
- `POST /api/storefront/cart/:token/quote` — run quote, save to cart
- `POST /api/storefront/checkout` — **atomic checkout** (web_order + items + stock decrement + converted reservations + allocations + cart delete, single transaction)
- `GET /api/storefront/orders/:orderToken` — public order status

### Task 4.4: Create frontend cart and checkout pages

**Commit:** `9a495e1`

**Files created:**
- `frontend/src/pages/storefront/useStorefrontCart.js` — cart hook with localStorage token persistence
- `frontend/src/pages/storefront/StorefrontCart.jsx` — item list, qty controls, proceed to checkout
- `frontend/src/pages/storefront/StorefrontCheckout.jsx` — delivery method, pickup/shipping forms, contact info, live quote, place order
- `frontend/src/pages/storefront/StorefrontOrderStatus.jsx` — progress timeline, items, "I've Arrived" button, 30s auto-refresh

**Files modified:**
- `frontend/src/routes/publicRoutes.jsx` — added cart, checkout, order routes
- `frontend/src/pages/storefront/StorefrontLayout.jsx` — cart icon links to cart page

---

## Workstream 5: BOPIS and Curbside — ✅ DONE

### Task 5.1: Add pickup workflow endpoints

**Commit:** `58d7372`

**Endpoints added:**

Public (storefront.js):
- `POST /api/storefront/orders/:orderToken/arrive` — curbside arrival signal (idempotent)

Staff (orders.js):
- `PUT /api/orders/:id/pickup-ready` — sets `pickup_ready_at`, status → `ready_for_pickup`
- `PUT /api/orders/:id/picked-up` — sets `picked_up_at`, status → `fulfilled`/`closed`

### Task 5.2: Surface pickup orders in fulfillment UI

**Commit:** `6a91d31`

**Backend:** `GET /api/fulfillment/pickup-orders` — filterable by outlet and status (pending/ready/arrived/completed)

**Frontend:** New "Pickup Orders" tab in FulfillmentRedesign with status badges, action buttons (Mark Ready, Mark Picked Up), timestamp trail, status dropdown filter.

---

## Workstream 6: Ship-from-Store and Endless Aisle — ✅ DONE

### Task 6.1: Connect storefront shipping orders to picklists

**Commit:** `c91406b`

**File modified:** `backend/routes/fulfillment.js` (+195 lines)

- Picklist creation accepts `include_shipping_allocations: true` to pull in allocated shipping orders
- `GET /api/fulfillment/shipping-orders` — pending ship-to-customer allocations per outlet
- Dispatch advances allocation status to `shipped`
- Cancel reverts allocations to `pending`
- Added `allocation_id` column to `picklist_items` (schema + migration)

### Task 6.2: Add endless aisle endpoint for POS

**Commit:** `7688d6f`

**File modified:** `backend/routes/orders.js` (+288 lines)

`POST /api/orders/endless-aisle` — atomic endpoint that: validates items, resolves prices, checks cross-outlet stock, creates web_order (source=`pos_endless_aisle`), inserts items, allocates to best outlet, decrements stock with FOR UPDATE locks, creates converted reservations. Single transaction.

### Task 6.3: Add endless aisle UI in POS

**Commit:** `2128c47`

**Files:**
- Created: `frontend/src/pages/redesign/pos/EndlessAisleModal.jsx` (244 lines) — product info, delivery method, customer info, shipping address, submit
- Modified: `frontend/src/pages/redesign/pos/POSContext.jsx` (+9 lines) — `endlessAisleProduct`, `handleEndlessAisle`, `closeEndlessAisle`
- Modified: `frontend/src/pages/redesign/POSRedesign.jsx` — mounted modal

---

## Workstream 7: Online-Order Returns and Unified Customer History — ✅ DONE

### Task 7.1: Enable returns against web_orders

**Commit:** `7a9e861`

**File modified:** `backend/routes/returns.js` (+80 lines)

- `POST /api/returns` now accepts optional `web_order_id` — validates web order, checks items against `web_order_items`, creates return with `web_order_id` set, restores stock. Existing `original_sale_id` flow unchanged.
- `GET /api/returns/lookup-web-order?q=` — search by external_order_id, order number, or public token

### Task 7.2: Add unified customer order history

**Commit:** `3d9c23e`

**File modified:** `backend/routes/customers.js` (+58 lines)

`GET /api/customers/:id/order-history` — UNION ALL across `sales` + `web_orders`, joined with `sales_channels`. Pagination, excludes voided sales. Requires `view_reports` or `manage_customers`.

### Task 7.3: Add customer history UI

**Commit:** `7c213d0`

**File modified:** `frontend/src/pages/redesign/CustomersRedesign.jsx` (+104 lines)

New "Order History" tab with date, order number, channel badges (POS gray, Storefront blue, Shopify green, Daraz orange, etc.), total, status. Pagination.

---

## Workstream 8: Omnichannel Promotions and Regression Hardening — ⚠️ PARTIAL

### Task 8.1: Integrate promotions into quote service — ✅ DONE

**Commit:** `36c38b7`

**File modified:** `backend/services/quote.js`

Added `evaluatePromotions()` — mirrors POS promotion logic (all 5 types: percent, fixed, threshold_percent, threshold_fixed, bxgy). Per-item discount distribution proportional to subtotal share. `appliedPromotions` array in response.

### Task 8.2: Add channel publication management UI — ✅ DONE

**Commit:** `e4f89d2`

**Backend** (`backend/routes/products.js` +56 lines):
- `GET /api/products/:id/channels` — current publication state across all channels
- `PUT /api/products/:id/channels` — update publications (upsert/unpublish)

**Frontend** (`frontend/src/pages/redesign/ProductFormPage.jsx` +58 lines):
- "Sales Channels" section in product edit sidebar with toggle switches per channel

### Task 8.3: Regression pass — ⬜ REMAINING

**Automated checks completed:**
- ✅ Frontend builds cleanly
- ✅ All backend service modules load without errors
- ✅ Backend unit tests: 125/125 pass
- ⚠️ Frontend unit tests: pre-existing setup.js failures (not our changes)

**Manual regression checklist (must be done against live or staging DB):**
- [ ] Run migration v18 against a test database
- [ ] Marketplace-imported `web_orders` (Shopify/Daraz) — create, view, fulfill
- [ ] Picklist and loadsheet flows — create, pick, pack, dispatch
- [ ] POS price-list behavior — correct prices applied per customer group
- [ ] Parked sales — park, retrieve, complete
- [ ] Public receipt page — view by invoice number
- [ ] Returns against POS sales — still work with `original_sale_id`
- [ ] Multichannel report — still aggregates correctly
- [ ] **New:** Storefront browse → cart → checkout → order status (end-to-end)
- [ ] **New:** BOPIS: checkout with pickup → mark ready → customer arrive → mark picked up
- [ ] **New:** Endless aisle: out-of-stock in POS → create routed order
- [ ] **New:** Channel publication: publish/unpublish product on storefront
- [ ] **New:** Web order return: lookup web order → process return

**Integration test suite:**
```bash
npx jest backend/tests/integration/ --runInBand
```

**E2E tests:**
```bash
cd frontend && npx playwright test
```

---

## Files Created/Modified Summary

### New Files (14)
| File | Lines | Purpose |
|------|-------|---------|
| `backend/routes/storefront.js` | 909 | All public storefront APIs (read + cart + checkout) |
| `backend/services/reservation.js` | 165 | Inventory hold/release/expire |
| `backend/services/allocation.js` | 92 | Fulfillment outlet routing |
| `backend/services/storefront-cart.js` | 186 | Cart CRUD |
| `backend/services/quote.js` | 337 | Pricing + tax + promotions |
| `backend/workers/reservation-worker-boss.js` | 63 | pg-boss expiry worker |
| `frontend/.../StorefrontLayout.jsx` | 207 | Public layout + context |
| `frontend/.../StorefrontHome.jsx` | 175 | Landing page |
| `frontend/.../StorefrontProducts.jsx` | 236 | Product listing |
| `frontend/.../StorefrontProductDetail.jsx` | 278 | Product detail |
| `frontend/.../StorefrontCart.jsx` | 214 | Cart page |
| `frontend/.../StorefrontCheckout.jsx` | 462 | Checkout flow |
| `frontend/.../StorefrontOrderStatus.jsx` | 342 | Order tracking |
| `frontend/.../useStorefrontCart.js` | 199 | Cart state hook |
| `frontend/.../EndlessAisleModal.jsx` | 244 | POS endless aisle |

### Modified Files (12)
| File | Delta | Changes |
|------|-------|---------|
| `backend/migrate-pg.js` | +195 | Migration v18 |
| `backend/schema-pg.sql` | +153 | DDL for fresh installs |
| `backend/routes/registerAllRoutes.js` | +3 | Storefront mount |
| `backend/routes/orders.js` | +288 | Pickup endpoints + endless aisle |
| `backend/routes/fulfillment.js` | +195 | Picklist + pickup + shipping |
| `backend/routes/returns.js` | +80 | Web order returns |
| `backend/routes/customers.js` | +58 | Unified history |
| `backend/routes/products.js` | +56 | Channel publications |
| `backend/boot/workers.js` | +6 | Reservation worker registration |
| `frontend/.../FulfillmentRedesign.jsx` | +152 | Pickup orders tab |
| `frontend/.../CustomersRedesign.jsx` | +104 | Order history tab |
| `frontend/.../ProductFormPage.jsx` | +58 | Channel toggles |

---

## Dependencies

```
WS1 (schema) → WS2 (read layer) → WS3 (reservation/allocation) → WS4 (cart/checkout)
                                                                  → WS5 (BOPIS) depends on WS4
                                                                  → WS6 (ship/endless) depends on WS3
WS7 (returns/history) depends on WS1 only
WS8 (promotions/regression) runs last
```

WS7 can run in parallel with WS2-WS6 since it only depends on the schema migration.
