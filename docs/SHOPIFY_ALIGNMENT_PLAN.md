# Shopify Alignment Plan (Before API Integration)

## Execution Status Update (As of February 24, 2026 - latest update)

This plan has been partially executed. The status below reflects what is completed vs remaining.

### Completed

1. Data model alignment
- Product parity columns added (`description_html`, `compare_at_price`, `product_type`, `vendor`, `tags`, `status`).
- Variant parity columns added (`weight`, `weight_unit`, `compare_at_price`).
- Mapping/sync/order staging tables added (`shopify_product_map`, `shopify_location_map`, `shopify_customer_map`, `shopify_order_map`, `web_orders`, `web_order_items`, `web_order_transactions`, `web_order_fulfillments`, `external_sync_events`, `inventory_reconciliation`, `shopify_connections`, `shopify_sync_runs`).
- Retry/backoff and stock policy tracking fields added via follow-up migrations:
  - `external_sync_events.attempt_count`, `next_retry_at`, `last_attempt_at`
  - `web_orders.stock_applied`, `stock_applied_at`, `stock_policy_note`
  - `inventory_reconciliation.resolution_status`, `resolution_note`, `resolved_by`, `resolved_at`

2. Orders staging module
- `/orders` now uses a real page (`Orders.jsx`) instead of placeholder.
- Backend staging APIs implemented:
  - list/detail/create web orders
  - order status updates
  - transactions and fulfillments append

3. Mapping and reconciliation APIs
- Product/location/customer mapping routes implemented.
- Live Shopify product mapping suggestions and apply endpoints implemented.
- Live reconciliation endpoints implemented (Shopify quantities fetch + run/read/resolve flows).
- Reconciliation corrective-action approval endpoints implemented:
  - `POST /api/reconciliation/inventory/:id/request-fix`
  - `POST /api/reconciliation/inventory/:id/approve-fix`

4. Integration page and routing
- `/integrations/shopify` route added with permission guard.
- Setup menu includes Shopify Integration page.
- Page supports connection config, verify, live location fetch, queue processing, sync event monitoring, per-event retry, mapping review controls, and reconciliation corrective-action request flow.

5. Sync plumbing
- Outbound inventory sync enqueue integrated into major stock-changing flows:
  - sale, void, return, transfer, adjustment, PO receive, supplier return
- Background worker processes pending outbound inventory events with retry/backoff and dead-letter behavior.
- Retry scheduling now includes jitter and queue-health metrics are exposed in status API/UI.

6. Webhook security baseline
- Raw-body based HMAC verification for Shopify webhook route.
- Replay-window check added.
- Idempotency duplicate protection retained.
- Timing-safe signature compare added.

7. Inbound stock policy
- Stock apply/reverse policy implemented for web orders based on payment/order status transitions.
- Policy is idempotent and persisted per order (`stock_applied` state).

8. Readiness and operations APIs
- Added live validation endpoint (`/api/integrations/shopify/live-validation`).
- Added webhook production setup endpoint (`/api/integrations/shopify/webhooks/setup`).
- Added runtime UAT checklist endpoint (`/api/integrations/shopify/uat-checklist`).
- Added reconciliation audit endpoint (`/api/reconciliation/inventory/:id/audit`).

### Partially Complete

1. Product parity UX
- Backend supports many Shopify parity fields.
- Full frontend inventory/media management UX for all parity fields is not fully complete.

2. Reconciliation governance
- Corrective actions are approval-gated (request + approve/reject).
- Requester/approver separation is enforced.
- Remaining governance controls are mostly policy-level (for example mandatory reason templates and multi-stage thresholds).

### Not Yet Completed

1. Comprehensive automated tests
- Unit/integration/E2E automation for Shopify connector is partially added:
  - utility-level tests
  - mocked Shopify API + webhook integration tests
  - real-store integration/E2E remains pending until credentials are available.

2. Full operational tooling
- No dedicated alerting/escalation dashboard for connector failures yet.

## Objective
Prepare OneShopPOS to be Shopify-ready internally before connecting real Shopify APIs.

This phase ensures:
- Data model parity for Shopify entities
- Orders workflow for website-origin orders
- Inventory/payment/fulfillment state consistency
- Mapping + reconciliation foundations

---

## Scope

### In Scope
- Product schema parity expansion
- Web Orders module under existing `Orders` menu
- Internal mapping tables (product, customer, location, order)
- Internal APIs for aligned workflows
- Permissions alignment
- Reconciliation and idempotency foundations
- Frontend pages for orders/mappings/reconciliation

### Out of Scope (next phase)
- Live Shopify OAuth/token flow
- Live Shopify webhooks
- Live outbound Shopify inventory updates

---

## Phase 1 - Database Alignment

Create migrations (`migrate41.js` onward).

## 1) Product parity

### Alter `products`
- `description_html TEXT`
- `compare_at_price REAL DEFAULT 0`
- `product_type TEXT`
- `vendor TEXT`
- `tags TEXT` (JSON string or comma list)
- `status TEXT DEFAULT 'active'` (values: `active`, `draft`, `archived`)

### Alter `product_variants`
- `weight REAL DEFAULT 0`
- `weight_unit TEXT DEFAULT 'kg'`
- `compare_at_price REAL DEFAULT 0`

### New table: `product_media`
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `product_id INTEGER NOT NULL REFERENCES products(id)`
- `variant_id INTEGER NULL REFERENCES product_variants(id)`
- `url TEXT NOT NULL`
- `alt_text TEXT`
- `position INTEGER DEFAULT 0`
- `created_at TEXT DEFAULT (datetime('now','localtime'))`

Indexes:
- `idx_product_media_product_id`
- `idx_product_media_variant_id`

## 2) External identity mappings

### `shopify_product_map`
- `id`
- `product_id` (FK)
- `variant_id` (nullable FK)
- `shopify_product_id TEXT`
- `shopify_variant_id TEXT`
- `shopify_inventory_item_id TEXT`
- `is_active INTEGER DEFAULT 1`
- `last_verified_at TEXT`

Constraints:
- unique local mapping (`product_id`,`variant_id`)
- unique external mapping (`shopify_product_id`,`shopify_variant_id`)

### `shopify_location_map`
- `id`
- `outlet_id` (FK)
- `shopify_location_id TEXT`
- `shopify_location_name TEXT`
- UNIQUE(`outlet_id`,`shopify_location_id`)

### `shopify_customer_map`
- `id`
- `customer_id` (FK)
- `shopify_customer_id TEXT UNIQUE`
- `last_synced_at TEXT`

### `shopify_order_map`
- `id`
- `web_order_id` (FK nullable until row exists)
- `sale_id` (FK nullable)
- `shopify_order_id TEXT UNIQUE`
- `shopify_order_number TEXT`
- `last_synced_at TEXT`

## 3) Website orders staging module

### `web_orders`
- `id`
- `source TEXT NOT NULL DEFAULT 'shopify'`
- `external_order_id TEXT NOT NULL`
- `external_order_number TEXT`
- `customer_id INTEGER NULL REFERENCES customers(id)`
- `outlet_id INTEGER NULL REFERENCES outlets(id)`
- `currency TEXT DEFAULT 'PKR'`
- `subtotal REAL DEFAULT 0`
- `discount_total REAL DEFAULT 0`
- `tax_total REAL DEFAULT 0`
- `shipping_total REAL DEFAULT 0`
- `grand_total REAL DEFAULT 0`
- `payment_status TEXT DEFAULT 'pending'`
- `fulfillment_status TEXT DEFAULT 'unfulfilled'`
- `order_status TEXT DEFAULT 'open'`
- `ordered_at TEXT`
- `raw_payload TEXT`
- `created_at TEXT DEFAULT (datetime('now','localtime'))`
- `updated_at TEXT DEFAULT (datetime('now','localtime'))`

Constraint:
- UNIQUE(`source`,`external_order_id`)

### `web_order_items`
- `id`
- `web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE`
- `product_id INTEGER NULL REFERENCES products(id)`
- `variant_id INTEGER NULL REFERENCES product_variants(id)`
- `sku TEXT`
- `barcode TEXT`
- `title TEXT`
- `qty INTEGER NOT NULL`
- `unit_price REAL DEFAULT 0`
- `discount REAL DEFAULT 0`
- `tax REAL DEFAULT 0`
- `line_total REAL DEFAULT 0`

### `web_order_transactions`
- `id`
- `web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE`
- `external_txn_id TEXT`
- `gateway TEXT`
- `kind TEXT`
- `status TEXT`
- `amount REAL DEFAULT 0`
- `processed_at TEXT`
- `raw_payload TEXT`

### `web_order_fulfillments`
- `id`
- `web_order_id INTEGER NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE`
- `external_fulfillment_id TEXT`
- `status TEXT`
- `carrier TEXT`
- `tracking_number TEXT`
- `tracking_url TEXT`
- `fulfilled_at TEXT`
- `raw_payload TEXT`

## 4) Sync and reconciliation foundations

### `external_sync_events`
- `id`
- `direction TEXT NOT NULL` (`inbound`,`outbound`)
- `entity_type TEXT NOT NULL` (`order`,`inventory`,`customer`,`product`)
- `idempotency_key TEXT NOT NULL UNIQUE`
- `status TEXT NOT NULL` (`pending`,`processed`,`failed`,`ignored`)
- `error_message TEXT`
- `payload TEXT`
- `created_at TEXT DEFAULT (datetime('now','localtime'))`
- `processed_at TEXT`

### `inventory_reconciliation`
- `id`
- `product_id INTEGER NULL`
- `variant_id INTEGER NULL`
- `outlet_id INTEGER NULL`
- `external_location_id TEXT`
- `local_qty REAL DEFAULT 0`
- `external_qty REAL DEFAULT 0`
- `diff REAL DEFAULT 0`
- `status TEXT DEFAULT 'mismatch'`
- `checked_at TEXT DEFAULT (datetime('now','localtime'))`

---

## Phase 2 - Backend Internal APIs (No Shopify calls yet)

## 1) Orders APIs (`/api/orders`)

- `GET /api/orders`
  - filters: `source`, `order_status`, `payment_status`, `fulfillment_status`, `date_from`, `date_to`, `search`
- `GET /api/orders/:id`
- `POST /api/orders`
  - create internal web order row (source `shopify` or other)
- `PUT /api/orders/:id/status`
  - update `order_status`, `payment_status`, `fulfillment_status`
- `POST /api/orders/:id/transactions`
- `POST /api/orders/:id/fulfillments`
- `POST /api/orders/:id/convert-to-sale` (optional in phase 2)

## 2) Product parity APIs

Extend existing product/variant endpoints to accept new fields.

Add media endpoints:
- `POST /api/products/:id/media`
- `GET /api/products/:id/media`
- `DELETE /api/products/:id/media/:mediaId`

## 3) Mapping APIs

- `GET /api/integrations/mappings/products`
- `PUT /api/integrations/mappings/products/:id`
- `POST /api/integrations/mappings/products/auto`
- `GET /api/integrations/mappings/locations`
- `PUT /api/integrations/mappings/locations/:outletId`
- `GET /api/integrations/mappings/customers`
- `PUT /api/integrations/mappings/customers/:customerId`

## 4) Reconciliation APIs

- `POST /api/reconciliation/inventory/run` (internal compare run, external placeholder)
- `GET /api/reconciliation/inventory`
- `POST /api/reconciliation/inventory/:id/resolve` (manual resolution status)

## 5) Permissions (RBAC)

Use:
- `manage_orders`: orders + fulfillment + transaction mutation
- `manage_inventory`: products/media/mappings
- `view_reports`: reconciliation read
- optional `manage_integrations`: integration admin actions

---

## Phase 3 - Frontend Alignment

## 1) Use existing `Orders` menu for web order workflows

Replace placeholder route/page with real `Orders.jsx`:
- List table with:
  - external order number
  - source
  - ordered date
  - customer
  - payment status
  - fulfillment status
  - grand total
  - mapping health badge
- Detail drawer:
  - line items
  - shipping/discount/tax breakdown
  - transaction history
  - fulfillment timeline

Actions:
- update statuses
- append fulfillment update
- resolve mapping
- optional convert-to-sale

## 2) Inventory UI updates

Update `Inventory.jsx` forms/table for:
- compare-at price
- status
- vendor/product type
- tags
- weight/unit
- product media attachments/URLs

## 3) Mapping UI

Create:
- `ProductMapping.jsx`
- `LocationMapping.jsx`
- `CustomerMapping.jsx`

Features:
- filter unmapped
- manual map editor
- auto-map helpers by barcode/SKU/name/mobile/email

## 4) Reconciliation UI

Create `Reconciliation.jsx`:
- run check button
- mismatch list
- severity/age filters
- resolution workflow

---

## Phase 4 - Internal Business Rules

Standardize statuses now (before Shopify API):

### Payment status
- `pending`
- `authorized`
- `paid`
- `partially_refunded`
- `refunded`
- `voided`
- `failed`

### Fulfillment status
- `unfulfilled`
- `partial`
- `fulfilled`
- `restocked`
- `cancelled`

### Order status
- `open`
- `closed`
- `cancelled`
- `on_hold`

## Stock movement policy (for web orders)

Default policy:
- Deduct stock when `payment_status` becomes `paid` and `order_status` is `open`.
- Reverse stock on cancellation/refund depending on fulfillment state.

## Mapping failure policy

If line item mapping fails:
- Mark line/order as `needs_mapping`
- Do not mutate stock
- Show in Orders exception queue

## Idempotency policy

Every imported or generated sync-like event gets unique `idempotency_key`.

---

## Phase 5 - Testing Plan

## Backend tests
- migrations apply correctly
- order creation/status transitions
- fulfillment/transaction append logic
- mapping resolution logic
- stock movement policy for web orders
- idempotency uniqueness and duplicate handling

## Frontend tests
- Orders page filters/detail/actions
- mapping pages CRUD
- inventory parity fields CRUD
- reconciliation dashboard rendering/actions
- role-based route and button guards

## E2E scenarios
1. Create mock external order payload -> appears in Orders.
2. Mapped items move stock per rule.
3. Unmapped item blocks stock movement and raises exception.
4. Fulfillment update reflected in order lifecycle.
5. Status transitions persisted and auditable.

---

## Suggested Execution Sequence

1. Migrations and schema updates
2. Backend orders + mapping + reconciliation endpoints
3. Replace Orders placeholder with full Orders module
4. Extend Inventory fields/media
5. Add mapping and reconciliation pages
6. Add tests and regression run
7. Update docs and rollout notes

---

## Verification Performed So Far

1. Code/syntax checks
- Backend `node --check` passed for updated Shopify-related files.
- Frontend ESLint passed for changed Shopify integration UI and route wiring files.

2. Migration execution checks
- `migrate41.js`, `migrate42.js`, `migrate43.js`, `migrate44.js`, and `migrate45.js` executed successfully.
- Schema presence was verified after migration.

## Verification Not Yet Performed

1. Live Shopify verification
- No fully documented end-to-end run using a real Shopify store token/domain for all flows.

2. Webhook production simulation
- No captured real Shopify webhook payload/signature replay test artifacts documented yet.

3. Regression test suite
- Full project regression run (all E2E tests after Shopify connector changes) not yet documented as complete.

## Remaining Work Checklist

1. Add key rotation + migration process for encrypted Shopify secrets across environments.
2. Add queue batching/coalescing for higher throughput.
3. Expand inbound stock policy to cover edge cases (partial fulfills/restock nuanced transitions) with explicit rules/tests.
4. Add reconciliation corrective-action approval controls and stricter audit workflows.
5. Complete parity UI for product media/weight/status/tags management.
6. Expand automated tests to include full API integration coverage and real-store E2E artifacts.
7. Execute `docs/SHOPIFY_LIVE_RUNBOOK.md` once credentials are available and publish evidence in docs.

---

## Next 2-Week Delivery Sprint

### Week 1 (Backend Completion)

1. Day 1
- Secret encryption-at-rest for Shopify credentials.
- Config migration notes and secure key handling documentation.

2. Day 2
- Queue reliability upgrade:
  - retry counters
  - exponential backoff scheduling
  - dead-letter terminal state

3. Day 3
- Finalize inbound order stock policy by payment/fulfillment transitions.
- Ensure idempotent handling for duplicate and out-of-order webhook updates.

4. Day 4
- Live reconciliation implementation against Shopify quantities (location/item mapped).
- Add actionable mismatch status lifecycle.

5. Day 5
- Backend automated tests for:
  - webhook HMAC + replay window
  - idempotency
  - queue retry/backoff
  - stock delta correctness

### Week 2 (Frontend + Validation + Go-Live Prep)

1. Day 6
- Shopify Integration UI enhancements:
  - failed queue triage
  - retry controls
  - clearer error and mapping conflict handling

2. Day 7
- Complete parity UI in Inventory for remaining Shopify-aligned fields/media.

3. Day 8
- Dashboard Sync Control Center widget implementation.

4. Day 9
- Real-store UAT with Shopify staging store:
  - outbound stock flows
  - inbound order flows
  - reconciliation checks

5. Day 10
- Full regression execution and documentation.
- Final production readiness checklist and rollout steps.

---

## Suggested Dashboard Enhancements

Add a "Sync Control Center" widget on Dashboard (internal now, Shopify-live later):
- Pending web orders
- Orders needing mapping
- Reconciliation mismatches
- Failed sync/event queue count

This gives operations immediate visibility before external API rollout.
