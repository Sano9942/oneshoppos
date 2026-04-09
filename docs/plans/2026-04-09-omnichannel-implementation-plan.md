# Omnichannel Phase 1+ Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn SanoPOS from a POS + marketplace system into a real omnichannel commerce platform with public storefront, BOPIS, ship-from-store, endless aisle, and unified customer history.

**Architecture:** Extend existing `web_orders` + fulfillment infrastructure. Add reservation/allocation engine. Public storefront lives inside existing React app at `/store/:tenantSlug/*`. Backend storefront APIs at `/api/storefront/*`. Migration v18 adds 7 new tables + extends 2 existing tables.

**Tech Stack:** Express 5, React 19, PostgreSQL, Vite 7, Tailwind v4, nanoid for token generation.

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

## Workstream 1: Schema Migration (v18) + Seed Data

### Task 1.1: Add migration v18 — new tables + column extensions

**Files:**
- Modify: `backend/migrate-pg.js` (append migration v18)
- Modify: `backend/schema-pg.sql` (add new tables for fresh installs)

**Step 1: Add migration v18 to migrate-pg.js**

Append after the v17 migration block. The migration creates:

1. `sales_channels` — seeded with pos, storefront, shopify, woocommerce, daraz, facebook, instagram, whatsapp
2. `channel_publications` — product-to-channel publication control
3. `inventory_reservations` — stock holds for carts and pre-fulfillment
4. `web_order_allocations` — outlet-level fulfillment assignment
5. `customer_addresses` — normalized delivery addresses
6. `storefront_carts` — persistent public carts
7. `storefront_cart_items` — normalized cart line items

Column extensions:
- `web_orders`: add `channel_id`, `delivery_method`, `pickup_outlet_id`, `fulfillment_outlet_id`, `customer_name_snapshot`, `customer_phone_snapshot`, `customer_email_snapshot`, `shipping_address_json`, `pickup_ready_at`, `picked_up_at`, `curbside_arrived_at`, `public_order_token`
- `returns`: add `web_order_id`

Backfill:
- Set `channel_id` on existing `web_orders` rows by matching `source` to `sales_channels.code`

**Step 2: Add new tables to schema-pg.sql**

Add the same 7 CREATE TABLE statements and ALTER TABLE extensions to the DDL file so fresh tenant provisioning includes them.

**Step 3: Run migration locally and verify**

Run: `node backend/migrate-pg.js`
Expected: Migration v18 applies successfully to public schema and all tenant schemas.

**Step 4: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat(omnichannel): add migration v18 — sales channels, reservations, allocations, storefront carts, customer addresses"
```

---

## Workstream 2: Public Storefront Read Layer

### Task 2.1: Create storefront route file with tenant resolution middleware

**Files:**
- Create: `backend/routes/storefront.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount storefront routes)

The storefront route file exposes public APIs under `/api/storefront/*`. It uses a pluggable tenant resolution middleware that:
1. Extracts `tenantSlug` from `req.query.tenant` OR `req.headers['x-tenant-slug']`
2. Resolves tenant from master DB
3. Attaches tenant DB to request

Pattern reference: `backend/routes/receipts.js` lines 1-26.

Mount in `registerAllRoutes.js` BEFORE `loadTenantAndPerms` (same position as receipts/webhooks).

**Endpoints to implement:**

- `GET /api/storefront/config` — tenant branding, currency, delivery methods, pickup config
- `GET /api/storefront/categories` — public category tree (categories with published products only)
- `GET /api/storefront/products` — paginated, filterable published product summaries
- `GET /api/storefront/products/:id` — product detail with variants, images, approved reviews
- `GET /api/storefront/pickup-locations` — active pickup-capable outlets

**Step 1: Create storefront.js with tenant resolution and config endpoint**

Implement the tenant resolution helper and `GET /api/storefront/config`. Config returns:
- company name, logo, currency from `company_profile`
- enabled delivery methods (hardcoded `['pickup', 'ship_to_customer']` for v1)
- pickup enabled flag

**Step 2: Add categories endpoint**

Query `categories` joined with `channel_publications` to return only categories containing at least one published product on the storefront channel.

**Step 3: Add products list endpoint**

Query published products with:
- `channel_publications` filter (storefront channel, `is_published = true`)
- Category filter, search, sort, pagination
- Storefront-safe serializer (no internal stock admin fields, no cost prices)

**Step 4: Add product detail endpoint**

Return product with variants, images (from `product_media`), approved reviews (from `product_reviews`), pickup availability per outlet.

**Step 5: Add pickup-locations endpoint**

Return active outlets with `name`, `address`, `phone`. Future-ready with `supports_curbside` flag.

**Step 6: Mount in registerAllRoutes.js**

Add: `app.use('/api/storefront', require('./routes/storefront')(deps));`
Mount BEFORE `loadTenantAndPerms` middleware (public, no auth).

**Step 7: Commit**

```bash
git add backend/routes/storefront.js backend/routes/registerAllRoutes.js
git commit -m "feat(omnichannel): add public storefront read APIs — config, categories, products, pickup locations"
```

### Task 2.2: Create frontend storefront route shell and browse pages

**Files:**
- Create: `frontend/src/pages/storefront/StorefrontLayout.jsx`
- Create: `frontend/src/pages/storefront/StorefrontHome.jsx`
- Create: `frontend/src/pages/storefront/StorefrontProducts.jsx`
- Create: `frontend/src/pages/storefront/StorefrontProductDetail.jsx`
- Modify: `frontend/src/routes/publicRoutes.jsx` (add `/store/:tenantSlug/*` routes)

**Step 1: Create StorefrontLayout**

A minimal public layout with:
- Tenant branding header (fetched from `/api/storefront/config`)
- Category navigation
- Cart icon with item count
- Outlet/context resolution from `:tenantSlug` path param

**Step 2: Create StorefrontHome**

Landing page showing featured/all products grid. Calls `GET /api/storefront/products`.

**Step 3: Create StorefrontProducts**

Category-filtered product listing with search, sort, pagination. Reuses product card component.

**Step 4: Create StorefrontProductDetail**

Product detail page — images, variants, pricing, reviews, add-to-cart, pickup availability.

**Step 5: Add routes to publicRoutes.jsx**

```jsx
{ path: '/store/:tenantSlug', element: <StorefrontLayout />, children: [
  { index: true, element: <StorefrontHome /> },
  { path: 'products', element: <StorefrontProducts /> },
  { path: 'products/:productId', element: <StorefrontProductDetail /> },
  { path: 'cart', element: <StorefrontCart /> },
  { path: 'checkout', element: <StorefrontCheckout /> },
  { path: 'order/:orderToken', element: <StorefrontOrderStatus /> },
]}
```

**Step 6: Commit**

```bash
git add frontend/src/pages/storefront/ frontend/src/routes/publicRoutes.jsx
git commit -m "feat(omnichannel): add storefront frontend — layout, browse, product detail pages"
```

---

## Workstream 3: Reservation and Allocation Engine

### Task 3.1: Create reservation service

**Files:**
- Create: `backend/services/reservation.js`

**Functions:**
- `createReservation({ cartToken, channelId, productId, variantId, outletId, qty, ttlMinutes })` — creates hold in `inventory_reservations`
- `convertReservations(cartToken, webOrderId)` — status `active` → `converted`
- `releaseReservations(cartToken)` — status `active` → `released`, restore stock
- `expireStaleReservations()` — bulk expire where `expires_at < NOW()` and status = `active`
- `getActiveReservationsForOutlet(outletId, productId, variantId)` — sum of held qty

All operations run inside transactions with `SELECT ... FOR UPDATE` on `outlet_stock` rows.

**Step 1: Implement createReservation**

Decrement `outlet_stock.quantity` and insert `inventory_reservations` row atomically.

**Step 2: Implement convertReservations**

Bulk update status from `active` to `converted` for a given `reservation_key` (cart token).

**Step 3: Implement releaseReservations**

Restore stock to `outlet_stock` and set status to `released`.

**Step 4: Implement expireStaleReservations**

Called by a periodic job. Finds all `active` reservations past `expires_at`, releases stock, sets status to `expired`.

**Step 5: Commit**

```bash
git add backend/services/reservation.js
git commit -m "feat(omnichannel): add inventory reservation service — create, convert, release, expire"
```

### Task 3.2: Create allocation service

**Files:**
- Create: `backend/services/allocation.js`

**Functions:**
- `allocateOrder(webOrderId, items, deliveryMethod, pickupOutletId)` — assigns fulfillment outlet per line item
- `getAllocationsForOrder(webOrderId)` — returns allocation details

**Allocation logic:**
- Pickup orders: allocate all items to `pickupOutletId`
- Ship-to-customer: allocate to outlet with highest stock for each item (simple v1 strategy)

**Step 1: Implement allocateOrder**

Insert `web_order_allocations` rows. For pickup, all go to the selected outlet. For shipping, query `outlet_stock` to find best outlet per item.

**Step 2: Implement getAllocationsForOrder**

Simple query joining allocations with outlet names.

**Step 3: Commit**

```bash
git add backend/services/allocation.js
git commit -m "feat(omnichannel): add fulfillment allocation service — pickup and ship-to-customer strategies"
```

### Task 3.3: Add reservation expiry worker

**Files:**
- Create: `backend/workers/reservation-worker-boss.js`
- Modify: `backend/boot/workers.js` (register worker)

pg-boss backed worker that runs `expireStaleReservations()` every 5 minutes.

**Step 1: Create worker following existing pg-boss pattern**

Reference: `backend/workers/cleanup-worker-boss.js`

**Step 2: Register in boot/workers.js**

Add `RESERVATION_WORKER_ENABLED=1` env var toggle.

**Step 3: Commit**

```bash
git add backend/workers/reservation-worker-boss.js backend/boot/workers.js
git commit -m "feat(omnichannel): add reservation expiry worker (pg-boss, 5-min cycle)"
```

---

## Workstream 4: Cart, Quote, and Checkout

### Task 4.1: Create cart service

**Files:**
- Create: `backend/services/storefront-cart.js`

**Functions:**
- `getOrCreateCart(cartToken, tenantDb)` — returns or creates `storefront_carts` row
- `addItem(cartId, productId, variantId, qty)` — upserts `storefront_cart_items`
- `updateItem(cartId, itemId, qty)` — updates quantity or removes if qty=0
- `removeItem(cartId, itemId)`
- `getCartWithItems(cartId)` — full cart with item details

Cart token is a nanoid stored in client cookie/localStorage.

**Step 1: Implement cart CRUD**

Standard insert/update/delete on `storefront_carts` + `storefront_cart_items`.

**Step 2: Commit**

```bash
git add backend/services/storefront-cart.js
git commit -m "feat(omnichannel): add storefront cart service — create, add, update, remove items"
```

### Task 4.2: Create quote service

**Files:**
- Create: `backend/services/quote.js`

**Functions:**
- `calculateQuote(cartItems, deliveryMethod, pickupOutletId, channelId, db)` — returns pricing breakdown

**Quote evaluates:**
1. Product publication check (must be published on channel)
2. Stock availability per outlet
3. Price list / base price resolution
4. Applicable promotions (shared logic with POS where possible)
5. Tax calculation
6. Delivery method validation
7. Pickup outlet availability (if pickup)

**Returns:**
```js
{
  items: [{ productId, variantId, qty, unitPrice, discount, tax, lineTotal }],
  subtotal, discountTotal, taxTotal, shippingTotal, grandTotal,
  deliveryMethod, pickupOutletId,
  availabilityErrors: [] // items that can't be fulfilled
}
```

**Step 1: Implement quote calculation**

Start with base price + tax. Promotion integration comes in Workstream 8.

**Step 2: Commit**

```bash
git add backend/services/quote.js
git commit -m "feat(omnichannel): add quote service — pricing, availability, tax calculation"
```

### Task 4.3: Add cart and checkout API endpoints to storefront routes

**Files:**
- Modify: `backend/routes/storefront.js`

**New endpoints:**

- `POST /api/storefront/cart` — create or get cart (returns cart token)
- `GET /api/storefront/cart/:token` — get cart with items
- `POST /api/storefront/cart/:token/items` — add item
- `PUT /api/storefront/cart/:token/items/:itemId` — update quantity
- `DELETE /api/storefront/cart/:token/items/:itemId` — remove item
- `POST /api/storefront/cart/:token/quote` — run quote engine on cart
- `POST /api/storefront/checkout` — atomic checkout (creates web_order + reservations + allocations)
- `GET /api/storefront/orders/:orderToken` — public order status lookup

**Checkout flow:**
1. Validate cart exists and has items
2. Run quote (final pricing)
3. Begin transaction
4. Generate `sf_<nanoid>` for `external_order_id`
5. Generate `public_order_token` (nanoid)
6. Insert `web_orders` with `source='storefront'`, `channel_id`, delivery method, customer snapshot
7. Insert `web_order_items`
8. Create inventory reservations (status: `converted` — immediate for checkout)
9. Create allocations
10. Delete cart
11. Commit transaction
12. Return order confirmation with `public_order_token`

**Step 1: Add cart endpoints**

**Step 2: Add quote endpoint**

**Step 3: Add checkout endpoint (atomic)**

**Step 4: Add order status endpoint**

**Step 5: Commit**

```bash
git add backend/routes/storefront.js
git commit -m "feat(omnichannel): add storefront cart, quote, and checkout APIs"
```

### Task 4.4: Create frontend cart and checkout pages

**Files:**
- Create: `frontend/src/pages/storefront/StorefrontCart.jsx`
- Create: `frontend/src/pages/storefront/StorefrontCheckout.jsx`
- Create: `frontend/src/pages/storefront/StorefrontOrderStatus.jsx`
- Create: `frontend/src/pages/storefront/useStorefrontCart.js` (cart state hook)

**Step 1: Create useStorefrontCart hook**

Manages cart token in localStorage, cart state, add/update/remove API calls.

**Step 2: Create StorefrontCart page**

Cart summary, quantity controls, quote display, proceed to checkout.

**Step 3: Create StorefrontCheckout page**

- Delivery method selection (pickup vs ship)
- Pickup outlet selector (if pickup)
- Shipping address form (if ship)
- Customer contact info (name, phone, email)
- Order summary from quote
- Place order button → calls checkout API

**Step 4: Create StorefrontOrderStatus page**

Public order tracking using `public_order_token`. Shows order status, items, pickup readiness.

**Step 5: Commit**

```bash
git add frontend/src/pages/storefront/
git commit -m "feat(omnichannel): add storefront frontend — cart, checkout, order status pages"
```

---

## Workstream 5: BOPIS and Curbside

### Task 5.1: Add pickup workflow endpoints

**Files:**
- Modify: `backend/routes/storefront.js` (public arrive endpoint)
- Modify: `backend/routes/orders.js` or `backend/routes/fulfillment.js` (staff endpoints)

**Endpoints:**

Public:
- `POST /api/storefront/orders/:orderToken/arrive` — curbside arrival signal

Staff (authenticated):
- `PUT /api/orders/:id/pickup-ready` — mark order ready for pickup
- `PUT /api/orders/:id/picked-up` — mark order as picked up

**Step 1: Add curbside arrival endpoint**

Sets `curbside_arrived_at = NOW()` on the web_order. No auth — uses order token.

**Step 2: Add staff pickup-ready endpoint**

Sets `pickup_ready_at = NOW()` and updates `fulfillment_status`. Requires auth + permission.

**Step 3: Add staff picked-up endpoint**

Sets `picked_up_at = NOW()` and updates `fulfillment_status = 'fulfilled'`. Requires auth + permission.

**Step 4: Commit**

```bash
git add backend/routes/storefront.js backend/routes/orders.js
git commit -m "feat(omnichannel): add BOPIS and curbside workflow endpoints"
```

### Task 5.2: Surface pickup orders in fulfillment UI

**Files:**
- Modify: `frontend/src/pages/redesign/FulfillmentRedesign.jsx` (or create a new tab)
- Modify: `backend/routes/fulfillment.js` (add pickup orders query)

**Step 1: Add pickup orders query to fulfillment route**

`GET /api/fulfillment/pickup-orders` — returns web_orders with `delivery_method = 'pickup'` and relevant statuses.

**Step 2: Add pickup tab/section to fulfillment UI**

Show pending pickups, ready pickups, arrived customers. Action buttons for mark-ready and mark-picked-up.

**Step 3: Commit**

```bash
git add backend/routes/fulfillment.js frontend/src/pages/redesign/FulfillmentRedesign.jsx
git commit -m "feat(omnichannel): surface pickup orders in fulfillment UI with status actions"
```

---

## Workstream 6: Ship-from-Store and Endless Aisle

### Task 6.1: Connect storefront shipping orders to picklists

**Files:**
- Modify: `backend/routes/fulfillment.js`

**Step 1: Extend picklist creation to include allocated web_orders**

When creating a picklist for an outlet, include `web_order_allocations` where `fulfillment_outlet_id` matches and `fulfillment_method = 'ship_to_customer'`.

**Step 2: Commit**

```bash
git add backend/routes/fulfillment.js
git commit -m "feat(omnichannel): connect storefront shipping orders to picklist flow"
```

### Task 6.2: Add endless aisle endpoint for POS

**Files:**
- Modify: `backend/routes/orders.js`

**Endpoint:**
- `POST /api/orders/endless-aisle` — creates routed web_order from POS

**Request body:**
```js
{
  items: [{ productId, variantId, qty }],
  customerId,
  deliveryMethod: 'ship_to_customer' | 'pickup',
  pickupOutletId, // if pickup
  shippingAddress, // if shipping
  customerContact: { name, phone, email }
}
```

**Behavior:**
1. Check cross-outlet availability
2. Create `web_order` with `source = 'pos_endless_aisle'`, `channel_id` = pos channel
3. Allocate to best outlet with stock
4. Create reservations
5. Return order confirmation

**Step 1: Implement endless-aisle endpoint**

**Step 2: Commit**

```bash
git add backend/routes/orders.js
git commit -m "feat(omnichannel): add endless aisle order creation from POS"
```

### Task 6.3: Add endless aisle UI in POS

**Files:**
- Create: `frontend/src/pages/redesign/pos/EndlessAisleModal.jsx`
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx` (add action)

**Step 1: Create EndlessAisleModal**

When a product has zero stock at current outlet but stock elsewhere, show a modal:
- Cross-outlet stock display
- Option to create a routed order (pickup at another store or ship to customer)
- Customer info capture

**Step 2: Wire into POSContext**

Add `handleEndlessAisle` action triggered when adding out-of-stock item or via explicit button.

**Step 3: Commit**

```bash
git add frontend/src/pages/redesign/pos/EndlessAisleModal.jsx frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat(omnichannel): add endless aisle modal and action in POS"
```

---

## Workstream 7: Online-Order Returns and Unified Customer History

### Task 7.1: Enable returns against web_orders

**Files:**
- Modify: `backend/routes/returns.js`

**Step 1: Extend return creation to accept `web_order_id`**

Allow `POST /api/returns` to optionally include `web_order_id` instead of `original_sale_id`. When present:
- Validate the web_order exists and belongs to this tenant
- Create return with `web_order_id` set
- Restore stock to the chosen outlet

**Step 2: Add web order lookup for returns**

`GET /api/returns/lookup-web-order?q=<orderNumber>` — staff can search web orders by order number or public token to initiate a return.

**Step 3: Commit**

```bash
git add backend/routes/returns.js
git commit -m "feat(omnichannel): enable returns against web orders with lookup"
```

### Task 7.2: Add unified customer order history

**Files:**
- Modify: `backend/routes/customers.js`

**Endpoint:**
- `GET /api/customers/:id/order-history` — merged view of POS sales + web orders

**Step 1: Implement order history aggregation**

Union query across `sales` and `web_orders` for a given `customer_id`, ordered by date descending. Returns:
```js
[{
  type: 'pos_sale' | 'web_order',
  id, orderNumber, channel, total, status, date,
  items: [...]
}]
```

**Step 2: Commit**

```bash
git add backend/routes/customers.js
git commit -m "feat(omnichannel): add unified customer order history across POS and web channels"
```

### Task 7.3: Add customer history UI

**Files:**
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx` (or customer detail component)

**Step 1: Add order history tab to customer detail**

Show merged timeline of POS sales and web orders with channel badges.

**Step 2: Commit**

```bash
git add frontend/src/pages/redesign/CustomersRedesign.jsx
git commit -m "feat(omnichannel): add unified order history tab to customer detail UI"
```

---

## Workstream 8: Omnichannel Promotions and Regression Hardening

### Task 8.1: Integrate promotions into quote service

**Files:**
- Modify: `backend/services/quote.js`
- Reference: `backend/routes/promotions.js` (existing promotion logic)

**Step 1: Wire promotion evaluation into quote**

The quote service should evaluate active promotions against the cart items using the same logic that POS uses. Extract shared promotion evaluation into a reusable function if not already separated.

**Step 2: Commit**

```bash
git add backend/services/quote.js
git commit -m "feat(omnichannel): integrate promotion evaluation into storefront quote service"
```

### Task 8.2: Add channel publication management UI

**Files:**
- Modify: `frontend/src/pages/redesign/ProductsRedesign.jsx` (or product edit form)

**Step 1: Add channel publication toggle**

In product edit, add a "Channels" section showing available channels with publish/unpublish toggles. Calls:
- `GET /api/products/:id/channels` — current publication state
- `PUT /api/products/:id/channels` — update publications

**Step 2: Add backend endpoints for channel publication**

In `backend/routes/products.js`:
- `GET /api/products/:id/channels`
- `PUT /api/products/:id/channels`

**Step 3: Commit**

```bash
git add backend/routes/products.js frontend/src/pages/redesign/ProductsRedesign.jsx
git commit -m "feat(omnichannel): add channel publication management for products"
```

### Task 8.3: Regression pass

**Verify these flows still work after all changes:**

1. Marketplace-imported `web_orders` (Shopify/Daraz) — create, view, fulfill
2. Picklist and loadsheet flows — create, pick, pack, dispatch
3. POS price-list behavior — correct prices applied per customer group
4. Parked sales — park, retrieve, complete
5. Public receipt page — view by invoice number
6. Returns against POS sales — still work with `original_sale_id`
7. Multichannel report — still aggregates correctly

**Run existing test suites:**
```bash
npx jest backend/tests/integration/ --runInBand
cd frontend && npx playwright test
```

**Step 1: Fix any regressions found**

**Step 2: Commit fixes if any**

---

## Workstream Summary and Commit Plan

| Workstream | Commits | Description |
|-----------|---------|-------------|
| WS1 | 1 | Migration v18 + schema DDL |
| WS2 | 2 | Storefront read APIs + frontend browse |
| WS3 | 3 | Reservation service + allocation service + expiry worker |
| WS4 | 3 | Cart service + quote service + checkout APIs + frontend cart/checkout |
| WS5 | 2 | BOPIS/curbside endpoints + fulfillment UI |
| WS6 | 3 | Ship-from-store picklists + endless aisle API + POS UI |
| WS7 | 3 | Web order returns + unified history API + history UI |
| WS8 | 3 | Promotions in quote + channel publication UI + regression pass |
| **Total** | **~20** | One branch, merge to main when complete |

## Dependencies

```
WS1 (schema) → WS2 (read layer) → WS3 (reservation/allocation) → WS4 (cart/checkout)
                                                                  → WS5 (BOPIS) depends on WS4
                                                                  → WS6 (ship/endless) depends on WS3
WS7 (returns/history) depends on WS1 only
WS8 (promotions/regression) runs last
```

WS7 can run in parallel with WS2-WS6 since it only depends on the schema migration.
