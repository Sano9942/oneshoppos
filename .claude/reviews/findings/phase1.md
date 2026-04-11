# Phase 1 review — Omnichannel

## Summary
- Files reviewed: 18
- Critical findings: 3
- High findings: 2
- Medium findings: 2
- Low/pattern findings: 2

---

## Critical findings

### C1 — EndlessAisleModal sends a completely different body than `/api/orders/endless-aisle` expects
**File**: `frontend/src/pages/redesign/pos/EndlessAisleModal.jsx:58` and `backend/routes/orders.js:1063`
**Seam**: cross-phase with pre-existing code (POS modal → orders route)
**Finding**: The modal POSTs `{ product_id, variant_id, source_outlet_id, delivery_method, customer_id, customer_name, customer_phone, customer_email, shipping_address (string), shipping_city, note }`. The backend destructures `{ items, customerId, deliveryMethod, pickupOutletId, shippingAddress, customerContact }`. None of the top-level field names match. `items` (an array) vs `product_id/variant_id` (single fields); `customerContact.name/phone/email` vs flat `customer_name/phone/email`; `pickup_outlet_id` vs `pickupOutletId` (camelCase); `shipping_address` is a plain string in the frontend but the backend stores `JSON.stringify(shippingAddress)` which expects an object. The modal's `delivery_method` value `"pickup_at_store"` is also not the `"pickup"` string the backend validates against.
**Reproduction**: From POS with an out-of-stock product, open EndlessAisle, choose "Pick Up at Store" and submit — backend responds 400 (`items array is required`).

---

### C2 — `/api/storefront/config` returns camelCase keys; storefront frontend reads snake_case keys
**File**: `backend/routes/storefront.js:23` and `frontend/src/pages/storefront/StorefrontLayout.jsx:80`, `StorefrontCheckout.jsx:13`
**Seam**: in-phase frontend↔backend contract mismatch
**Finding**: Backend response is `{ companyName, logoUrl, currency, currencySymbol, ... }`. `StorefrontLayout.jsx:80-81` reads `config?.company_name` and `config?.logo_url` (snake_case) — both `undefined`. `StorefrontCheckout.jsx:13` reads `config?.currency_symbol` (undefined), hardcoding "Rs" fallback. Every storefront page shows the raw slug as store name, no logo, and "Rs" regardless of configured currency.
**Reproduction**: Navigate to `/store/:slug` — title shows slug, no logo, "Rs" currency.

---

### C3 — `services/quote.js` queries `courier_integrations.flat_shipping_rate` — a Phase 5 (v25) column — from Phase 1 code
**File**: `backend/services/quote.js:199`
**Seam**: cross-phase with Phase 5 (v25 column dependency in Phase 1 service)
**Finding**: `calculateQuote()` queries `SELECT flat_shipping_rate FROM courier_integrations`. This column is added by v25 (Phase 5 migration). On any schema at version 18–24, the query throws `column "flat_shipping_rate" does not exist`, making ALL storefront checkouts with a courier selected completely broken. No try/catch fallback.
**Reproduction**: Any storefront checkout with `deliveryMethod = "ship_to_customer"` and a non-null `courier_id` on schema v18–24 — 500 error.

---

## High findings

### H1 — `createReservation` / `releaseReservations` are exported but never called — reservation lifecycle is dead code
**File**: `backend/services/reservation.js:14` and `backend/services/storefront-cart.js`
**Seam**: in-phase design gap
**Finding**: `createReservation` is defined to decrement `outlet_stock` and insert an `active` reservation when an item is added to a cart. It is never called anywhere. `releaseReservations` is also never called. Only `expireStaleReservations` runs (from the worker), but with no active reservations to expire it's a no-op. **The entire reservation system never holds stock during cart browsing — defeating the purpose of reservations.**
**Reproduction**: Two concurrent storefront sessions add the last unit of the same product to cart; both see it as available until one submits checkout.
**Evidence**: Grep across all backend files — `createReservation` only appears in `services/reservation.js`. Zero callers. `services/storefront-cart.js:addItem()` does a stock check but never calls `createReservation`.

---

### H2 — Reservation worker not reported by `GET /api/admin/worker-status`
**File**: `backend/routes/admin/system.js:10-12` and `backend/workers/reservation-worker-boss.js:14`
**Seam**: in-phase monitoring gap
**Finding**: The `worker-status` endpoint reads only `__emailWorkerStatus`, `__fbrWorkerStatus`, `__cleanupWorkerStatus`. The reservation worker sets `global.__reservationWorkerStatus` but it is never read. Super-admin cannot tell whether the reservation expiry worker is running or stuck.

---

## Medium findings

### M1 — `schema-pg.sql` has `picklist_items.allocation_id REFERENCES web_order_allocations(id)` baked into static snapshot — fresh installs fail
**File**: `backend/schema-pg.sql:1736`
**Seam**: cross-phase with pre-existing code
**Finding**: The static DDL snapshot for `picklist_items` (v16 section) includes `allocation_id INTEGER REFERENCES web_order_allocations(id)`. But `web_order_allocations` is defined later (v18 section, line 1828). Postgres processes CREATE TABLE sequentially — fresh schema apply will fail with `relation "web_order_allocations" does not exist`. The v18 conditional guard in `migrate-pg.js` works for upgrade paths but the snapshot itself is broken for fresh installs.
**Reproduction**: Run `node backend/migrate-pg.js` against an empty DB — migration v1 applies schema-pg.sql and fails.

---

### M2 — `convertReservations` lacks transaction/row lock (TOCTOU gap)
**File**: `backend/services/reservation.js:45-52`
**Seam**: in-phase (currently dead code per H1, but must be fixed if wired up)
**Finding**: Plain UPDATE without transaction or SELECT-FOR-UPDATE. Concurrent expiry worker can mark reservations `expired` between convertReservations' WHERE check and the UPDATE.

---

## Low / design drift patterns

### P1 — Storefront frontend uses raw `fetch()` instead of `api.js` throughout
**Affected files**: All 6 files under `frontend/src/pages/storefront/`
**Description**: Storefront uses `fetch(${API_BASE}/api/storefront/...)` directly, bypassing `api.js`. The auth header bypass is intentional (storefront is unauthenticated), but the error normalization and global interceptor hooks are lost.

### P2 — Quote service does not integrate with `resolvePriceForContext` — price lists silently ignored for storefront
**Affected files**: `backend/services/quote.js:149-153`
**Description**: `calculateQuote()` uses simple `(variant.price ?? product.price)` fallback. `resolvePriceForContext()` exists in the same file, supports price lists + outlet pricing + customer group pricing, and is exported — but never called. Phase 2 price lists silently do not apply to storefront orders.

---

## Cross-phase observations
- `backend/routes/orders.js:1087` (endless aisle): looks up `sales_channels WHERE code = 'pos'` but no such channel is seeded (only 'storefront'). Would set `channelId = null` on all endless aisle orders.
- `storefront_payment_sessions` (used in `/pay` endpoint) is defined in v25 but queried by Phase 1's `storefront.js:852`. `/pay` endpoint fails on schema v18–24.
- `services/quote.js:resolvePriceForContext()` queries Phase 2 (v19) tables but is exported — could be called before v19 applied. Currently harmless because never called from `calculateQuote`.

---

## Seams verified clean
- V1 — `web_orders.active_shipment_id` not written by Phase 1: confirmed, expected.
- V3 — `allocation_id` FK migration ordering fixed in v18; only the static snapshot is broken (flagged as M1).
- V4 — Public route tenant resolution: all handlers use `resolvePublicTenantDb`. Tokens use `crypto.randomUUID()` (128-bit). Clean.
- V6 — Quote tax/promo: multi-tax handled correctly. The `flat_shipping_rate` v25 dependency is C3.
- V7 — Reservation lifecycle: transactions + FOR UPDATE locks are correct IN the functions. Gap is that the functions aren't called (H1).
- V8 — Endless Aisle channel_id: flagged via cross-phase observation.
