# OneShopPOS <-> Shopify Inventory Sync Plan

## Current Implementation Status (As of February 26, 2026 - latest update)

This document started as a plan. The following items are now implemented in code.

### Latest Hands-on Progress (2026-02-26)

Additional integration fixes completed after the prior update:

1. Mapping UX and behavior fixes
- Added explicit Location Mapping UI in `ShopifyIntegration.jsx`.
- Changed backend location mapping save behavior to replace existing mapping(s) per outlet (single active mapping target per outlet update action).

2. Product suggestion and apply fixes
- Fixed `auto-live` backend query bug (`pv.barcode` reference on schemas without that column).
- Increased live suggestion search limit support to large catalogs (up to 10,000 variants).
- Updated frontend suggestion request to use higher limit.
- Fixed apply-suggestions handling for product-level rows (`variant_id = NULL`) to avoid unique-constraint failures.
- Prevented already-mapped local rows from being repeatedly re-suggested.
- Cleared frontend suggestion list after successful apply.

3. Reconciliation approval workflow updates
- Improved UI feedback when reconciliation fix request is already pending.
- Kept requester/approver segregation for normal users.
- Added allowed exception: `all_access` Administrator can self-approve or self-reject reconciliation fix requests.

4. Outbound queue reason normalization
- Added mapping from internal reason labels to Shopify-supported reason enums before calling `inventoryAdjustQuantities`.
- Result: retrying outbound events with internal reasons now succeeds (processed) instead of staying in retry due to invalid reason errors.

5. Current verified live state
- Connection: active.
- Location mapping: active.
- Product mapping: active.
- Reconciliation: active (rows generated and resolved/matched).
- Outbound events: at least one processed successfully.
- Inbound webhook processing: still pending full production validation.

### Implemented

1. Database foundations
- Migration `migrate41.js` applied:
  - product parity fields (`description_html`, `compare_at_price`, `product_type`, `vendor`, `tags`, `status`)
  - mapping and sync foundation tables (`shopify_product_map`, `shopify_location_map`, `shopify_customer_map`, `shopify_order_map`, `external_sync_events`, `inventory_reconciliation`, plus web order tables)
- Migration `migrate42.js` applied:
  - `shopify_connections`
  - `shopify_sync_runs`
- Migration `migrate43.js` applied:
  - `external_sync_events.attempt_count`
  - `external_sync_events.next_retry_at`
  - `external_sync_events.last_attempt_at`
- Migration `migrate44.js` applied:
  - `web_orders.stock_applied`
  - `web_orders.stock_applied_at`
  - `web_orders.stock_policy_note`
- Migration `migrate45.js` applied:
  - `inventory_reconciliation.resolution_status`
  - `inventory_reconciliation.resolution_note`
  - `inventory_reconciliation.resolved_by`
  - `inventory_reconciliation.resolved_at`

2. Backend Shopify connector APIs
- Connection/config:
  - `GET /api/integrations/shopify/config`
  - `PUT /api/integrations/shopify/config`
  - `POST /api/integrations/shopify/disconnect`
  - `POST /api/integrations/shopify/verify`
- Monitoring:
  - `GET /api/integrations/shopify/status`
  - `GET /api/integrations/shopify/events`
- Sync execution:
  - `POST /api/integrations/shopify/sync/push-inventory`
  - `POST /api/integrations/shopify/sync/pull-orders`
  - `POST /api/integrations/shopify/sync/process-pending`
  - `POST /api/integrations/shopify/sync/retry-failed`
  - `POST /api/integrations/shopify/sync/retry-event/:id`
- Webhook ingest:
  - `POST /api/integrations/shopify/webhooks/orders-create`

3. Live Shopify client integration
- Added `backend/shopify/client.js` with real Shopify Admin GraphQL calls:
  - shop verification
  - live locations fetch
  - inventory adjustment mutation (`inventoryAdjustQuantities`)
  - live variant catalog fetch for mapping suggestions

4. Auto outbound inventory sync hooks
- Outbound sync events are now enqueued after successful stock mutations in:
  - sale checkout
  - sale void
  - returns
  - stock adjustments
  - transfers
  - purchase order receive (GRN flow)
  - supplier returns
- Background worker now processes pending outbound events every 30s (can be disabled with `SHOPIFY_SYNC_WORKER_DISABLED=1`).
- Retry/backoff and dead-letter states are now implemented (`pending`/`retry`/`processed`/`failed_mapping`/`dead_letter`).

5. Product/location mapping enhancements
- Live auto-suggestion endpoint added:
  - `POST /api/integrations/mappings/products/auto-live`
  - matching logic: exact barcode first, then exact SKU
- Bulk apply endpoint added:
  - `POST /api/integrations/mappings/products/apply-suggestions`
- Conflict-aware apply behavior implemented:
  - skips conflicting rows
  - returns conflict report (`applied`, `skipped`, `conflicts[]`)

6. Frontend integration center
- Added/extended `ShopifyIntegration.jsx`:
  - save/disconnect connection
  - verify connection
  - fetch live locations
  - push inventory (manual)
  - pull orders (manual)
  - process pending queue
  - retry failed events (bulk + single event retry)
  - sync event filters (status/entity/direction/search)
  - generate/apply live mapping suggestions
  - approve/reject suggestion rows before apply
  - conflict report panel after apply
  - sync event monitoring panel

7. Webhook security hardening
- Raw-body capture added for Shopify webhook route.
- HMAC validation now uses raw body.
- Timing-safe HMAC comparison implemented.
- Replay window check added via `x-shopify-triggered-at`.
- Idempotency key check remains enforced through `external_sync_events`.

8. Inbound order stock policy
- Central stock policy now applies/reverses stock for web orders based on payment/order status transitions.
- Policy execution is wired into:
  - Shopify webhook order ingest
  - manual web order create (`POST /api/orders`)
  - manual web order status update (`PUT /api/orders/:id/status`)
- Policy is idempotent via persisted `web_orders.stock_applied`.

9. Live reconciliation completion
- Reconciliation now fetches live Shopify inventory quantities for mapped item/location pairs.
- Added row-level resolution endpoint:
  - `POST /api/reconciliation/inventory/:id/resolve`
- Shopify integration UI now includes:
  - Run Live Reconciliation
  - reconciliation result table
  - Resolve/Ignore actions
  - corrective-action approval flow:
    - `POST /api/reconciliation/inventory/:id/request-fix`
    - `POST /api/reconciliation/inventory/:id/approve-fix`
    - UI actions changed to `Request Push` / `Request Pull`

10. Live validation + production readiness APIs
- Added `POST /api/integrations/shopify/live-validation`:
  - verifies connection
  - fetches live locations
  - validates a mapped inventory sample against Shopify levels
- Added `GET /api/integrations/shopify/webhooks/setup`:
  - returns callback URL and required webhook topics for Shopify admin setup
- Added `GET /api/integrations/shopify/uat-checklist`:
  - returns readiness checklist and connector stats from current DB state
- Shopify integration UI now exposes buttons/panels for all 3 readiness flows.

11. Queue/ops hardening
- Retry delay now uses backoff + jitter (`retryDelayMinutesWithJitter`) to reduce retry stampedes.
- Structured connector logs added for retry queue and webhook replay/duplicate cases.
- `/api/integrations/shopify/status` now returns `queue_health`:
  - `dead_letter`, `retry_due`, `backlog`, `oldest_backlog_minutes`
- Integration UI adds queue-health visibility card.

12. Governance/audit improvements
- Reconciliation approval action reasons now persist structured JSON metadata:
  - mode, requester/approver employee IDs, pre-fix local/external qty + diff, decision timestamp.
- Added `GET /api/reconciliation/inventory/:id/audit` for per-row audit trail
  (row + related approval requests + approval actions).

13. Product parity UI progress
- Inventory create/edit now supports Shopify-aligned product fields already in schema:
  - `description_html`, `compare_at_price`, `product_type`, `vendor`, `tags`, `status`
- Variant generation/edit now includes Shopify-aligned variant fields:
  - `compare_at_price`, `weight`, `weight_unit`
- Inventory CSV export now includes these fields.
- Bulk import upsert now accepts and persists these fields.

14. Import from Shopify (Inbound Product + Inventory Pull) — added 2026-02-26
- Added `fetchShopifyProductsFull(connection, maxItems = 2000)` in `backend/shopify/client.js`:
  - GraphQL paginated query (pageSize = 50 products per request, up to 100 variants per product)
  - Fetches: product id, title, descriptionHtml, productType, vendor, tags, status, and per-variant: id, sku, barcode, price, compareAtPrice, weight, weightUnit, inventoryItem.id, inventoryLevels per location with available quantities
  - Loops with cursor pagination until `hasNextPage = false` or `maxItems` reached
- Added `POST /api/integrations/shopify/import/products` (requires `manage_inventory`):
  - Calls `fetchShopifyProductsFull` then upserts each barcoded variant into `products` table
  - Uses `INSERT OR IGNORE ... ON CONFLICT(barcode) DO UPDATE` — safe for repeated runs
  - Seeds `outlet_stock` per Shopify inventory_level using location map (outlet_id fallback to default outlet)
  - Upserts `shopify_product_map` linking local product_id to Shopify product/variant/inventory_item IDs
  - Returns `{ created, updated, skipped, errors }`
- Added `POST /api/integrations/shopify/import/inventory` (requires `manage_inventory`):
  - Cross-joins `shopify_product_map × shopify_location_map` to get all mapped pairs
  - Fetches live Shopify `available` quantity per inventoryItemId + locationId
  - Sets `outlet_stock.quantity` absolutely (not delta) — Shopify is treated as source of truth
  - Returns `{ synced, failed, errors }`
- Added "Import from Shopify" card in `ShopifyIntegration.jsx`:
  - "Import Products from Shopify" button — runs full product + inventory seeding
  - "Sync Inventory Levels from Shopify" button — re-pulls live quantities for already-mapped products
  - Result panels for each action showing created/updated/skipped/synced/failed counts
  - Both buttons disabled when not connected

### Import from Shopify — Field-by-Field Reference Table

| Field | Shopify Source | Imported to POS | Notes |
|---|---|---|---|
| name | `product.title` | `products.name` | Always imported |
| barcode | `variant.barcode` | `products.barcode` | **Primary lookup key** — variants without barcode are skipped |
| sku | `variant.sku` or `inventoryItem.sku` | `products.barcode` (secondary) | Used when barcode not set; still requires non-empty for upsert |
| price | `variant.price` | `products.price` | Imported as REAL |
| compare_at_price | `variant.compareAtPrice` | `products.compare_at_price` | Imported (0 if not set) |
| description | `product.descriptionHtml` | `products.description_html` | HTML preserved |
| product_type | `product.productType` | `products.product_type` | Imported as text |
| vendor | `product.vendor` | `products.vendor` | Imported as text |
| tags | `product.tags` | `products.tags` | Comma-joined string |
| status | `product.status` | `products.status` | Lowercased (active/draft/archived) |
| outlet_stock | `inventoryLevel.quantities[available]` | `outlet_stock.quantity` | Seeded per mapped location |
| shopify_product_id | `product.id` | `shopify_product_map.shopify_product_id` | GID format |
| shopify_variant_id | `variant.id` | `shopify_product_map.shopify_variant_id` | GID format |
| shopify_inventory_item_id | `inventoryItem.id` | `shopify_product_map.shopify_inventory_item_id` | GID format |
| weight | `variant.weight` + `variant.weightUnit` | **NOT written** | Fetched but dropped — no `weight` column in `products` table |
| cost_price | n/a | `products.cost_price` = 0 | Shopify API does not expose cost price — must set manually |
| gst / tax | n/a | `products.gst` = 0, `products.tax_id` = NULL | No tax data in Shopify product API — must assign manually |
| category_id | n/a | `products.category_id` = NULL | No direct Shopify equivalent — assign manually after import |
| brand_id | n/a | `products.brand_id` = NULL (if column exists) | No direct Shopify equivalent — assign manually |
| images / media | n/a | **NOT imported** | Shopify images not fetched — upload manually |
| stock (products.stock) | n/a | `products.stock` = 0 | `products.stock` is legacy field; real stock lives in `outlet_stock` |

### Import Limits

| Parameter | Value |
|---|---|
| Max products imported per call | 2,000 |
| GraphQL page size | 50 products per request |
| Max variants per product (per query) | 100 |
| Max inventory levels per variant (per query) | 10 |
| Variants without barcode | Skipped (not imported) |
| Products without any barcoded variants | Skipped entirely |
| Safe to re-run | Yes — upsert by barcode is idempotent |

### After-Import Manual Steps

After running "Import Products from Shopify", complete these fields manually in POS Inventory:

1. **cost_price** — Shopify does not expose cost. Set via product edit or bulk import CSV.
2. **tax / GST** — Assign appropriate tax rate via the tax_id field on each product.
3. **category_id** — Map products to POS categories.
4. **brand_id** — Assign brand if applicable.
5. **product images** — Upload via Inventory edit (not fetched from Shopify).
6. **weight** — Set shipping weight if needed for labels (column exists on `product_variants` not `products`).
7. **min/max stock quantities** — Set reorder thresholds manually if applicable.

### Tests Executed

1. Syntax and static checks
- `node --check backend/index.js`
- `node --check backend/shopify/client.js` (includes new `fetchShopifyProductsFull`)
- `node --check backend/routes/registerAllRoutes.js` (includes new import routes)
- `node --check backend/migrate41.js`
- `node --check backend/migrate42.js`
- `node --check backend/migrate43.js`
- `node --check backend/migrate44.js`
- `node --check backend/migrate45.js`
- `node backend/shopify_utils_test.js`
- `node backend/shopify_mock_integration_test.js`
- ESLint on changed frontend files (including `ShopifyIntegration.jsx`, `App.jsx`, `AppLayout.jsx`, `Orders.jsx`) — 0 warnings/errors

2. Migration execution
- `migrate41.js` executed successfully.
- `migrate42.js` executed successfully.
- `migrate43.js` executed successfully.
- `migrate44.js` executed successfully.
- `migrate45.js` executed successfully.

### Tests Not Yet Executed

1. Live Shopify E2E
- Real token/domain verification against production or staging Shopify store.
- Real inventory mutation verification in Shopify Admin after POS sale/void/adjustment.
- Real webhook delivery test from Shopify admin webhook subscriptions.

2. Automated test coverage
- Unit tests for Shopify client methods.
- Integration tests for webhook signature + replay-window behavior (mock-level implemented).
- Queue retry/backoff tests (utility-level implemented).
- Automated idempotency duplicate-event tests.
- Full API integration tests for:
  - `/api/integrations/shopify/live-validation`
  - `/api/integrations/shopify/webhooks/setup`
  - `/api/integrations/shopify/uat-checklist`
  - `/api/reconciliation/inventory/:id/audit`

3. Full regression
- Full POS/backend E2E suite after connector changes.

### Remaining Work (Priority)

1. Security/compliance
- Add key rotation workflow/documentation for `SHOPIFY_SECRET_KEY`.
- Ensure all existing plaintext connection rows are rotated to encrypted values in all environments.

2. Queue reliability
- Add batching/coalescing for inventory adjustments by location/item where safe.

3. Inbound order stock behavior
- Expand policy to include more fulfillment-specific scenarios (partial fulfill/restock nuances) and formal test matrix coverage.

4. Mapping workflow quality
- Expand duplicate mapping prevention beyond variant-level conflicts and add stronger cross-entity validations.

5. Reconciliation completion
- Requester/approver segregation enforced for reconciliation fixes (same employee cannot approve/reject own request).
- Remaining: expanded audit metadata and stricter approval-policy controls.

6. Operations/observability
- Add connector health dashboard cards and alerting for failed sync events.
- Add structured logs for Shopify API errors and rate-limit responses.

7. Credential onboarding and go-live operations
- Runbook added: `docs/SHOPIFY_LIVE_RUNBOOK.md`
- Env template added: `backend/.env.shopify.example`

8. Import from Shopify — known gaps (post-import manual work)
- **DONE**: Product + inventory import built (see item 14 above).
- **Remaining gap**: `weight` / `weight_unit` fetched from Shopify but silently dropped — `products` table has no weight column. Weight lives on `product_variants`. If single-variant products need shipping weight in POS, add `weight` + `weight_unit` columns to `products` and write them on import.
- **Remaining gap**: `cost_price` is always 0 on import — Shopify Admin GraphQL does not expose cost price in product queries. Populate via separate bulk import CSV or manual edit after Shopify import.
- **Remaining gap**: Webhook-based automatic inbound product/inventory sync not yet implemented. Currently manual (button-click). Webhook automation is a future phase.
- **Remaining gap**: Product images not fetched. Shopify `images` field not included in `fetchShopifyProductsFull` query. Add image URL storage + fetch if needed.
- **Remaining gap**: Import limit is 2,000 products. For stores with more than 2,000 products, increase `maxItems` parameter or implement paginated batch import with progress tracking.

## Goal
Build reliable bi-directional inventory sync between OneShopPOS and Shopify so stock updates from either side propagate correctly with auditability, retries, and conflict safety.

## Scope

- In scope:
  - Shopify app connection (offline access token)
  - Product/variant and location mapping
  - Outbound sync: POS stock changes -> Shopify inventory adjustments
  - Inbound sync: Shopify order webhooks -> POS stock deductions
  - Idempotency, retries, logs, and reconciliation
  - Admin UI for setup and monitoring
- Out of scope (phase 2+):
  - Full order import into POS
  - Returns/refund full parity automation
  - Price/catalog sync (real-time push)
  - Webhook-driven automatic product/inventory import (manual button flow is now built; auto-trigger is phase 2)

## Architecture Decisions

1. Sync model: bi-directional
2. Inventory API: Shopify Admin GraphQL (`inventoryAdjustQuantities`)
3. POS source timing:
   - POS stock updates remain immediate locally
   - Shopify sync is async queue worker
4. Inbound trigger:
   - Shopify webhook `orders/create` (or `orders/paid`, pick one and keep consistent)
5. Conflict strategy:
   - Delta-based adjustments and nightly reconciliation report
6. Idempotency:
   - Inbound: dedupe on Shopify event id
   - Outbound: dedupe using local event UUID

## Data Model Changes (new migration, e.g. `migrate41.js`)

Add tables:

1. `shopify_connections`
- `id`, `shop_domain` UNIQUE, `access_token_enc`, `webhook_secret_enc`
- `default_location_id` (shopify location), `is_active`, `created_at`, `updated_at`

2. `shopify_location_map`
- `id`, `outlet_id` FK -> `outlets`, `shopify_location_id`, `shopify_location_name`
- UNIQUE(`outlet_id`, `shopify_location_id`)

3. `shopify_product_map`
- `id`, `product_id` FK -> `products`, `variant_id` nullable FK -> `product_variants`
- `shopify_product_id`, `shopify_variant_id`, `shopify_inventory_item_id`
- `is_active`, `last_verified_at`
- UNIQUE on local side and Shopify side identifiers

4. `shopify_sync_events`
- `id`, `direction` (`inbound`/`outbound`)
- `event_type` (e.g. `order_create`, `pos_sale`, `adjustment`)
- `idempotency_key` UNIQUE
- `status` (`pending`,`processed`,`failed`,`ignored`)
- `request_payload`, `result_payload`, `error_message`
- `created_at`, `processed_at`

5. `shopify_inventory_queue`
- `id`, `event_id` FK -> `shopify_sync_events`
- `shopify_inventory_item_id`, `shopify_location_id`
- `delta` (signed int), `reason`, `reference_type`, `reference_id`
- `attempt_count`, `next_retry_at`, `locked_at`, `status`
- indexes on status/retry time

6. `shopify_reconciliation_snapshots` (optional in MVP, recommended)
- row per SKU/location comparison result

## Backend Implementation Plan (`backend/index.js` + helper modules)

### A) New helper modules (recommended even with monolith)
Create `backend/shopify/`:

1. `client.js`
- GraphQL request helper
- shop connection load + token decrypt
- safe logging

2. `idempotency.js`
- create/find event by idempotency key
- mark processed/failed

3. `queue.js`
- enqueue inventory delta jobs
- fetch due jobs
- mark success/failure with backoff

4. `reconcile.js`
- compare POS stock vs Shopify stock by mapping

### B) New API routes
Add:

1. `POST /api/integrations/shopify/connect`
- Input: shop domain + auth code/token path (depends on OAuth flow)
- Save encrypted token, activate connection

2. `GET /api/integrations/shopify/status`
- connection status, last sync, failed job count

3. `GET /api/integrations/shopify/locations`
- fetch Shopify locations and mapped outlets

4. `PUT /api/integrations/shopify/location-map`
- upsert outlet <-> shopify location map

5. `GET /api/integrations/shopify/mappings`
- list current product/variant mappings

6. `POST /api/integrations/shopify/mappings/auto`
- attempt auto-map by barcode/SKU

7. `PUT /api/integrations/shopify/mappings/:id`
- manual mapping correction

8. `POST /api/integrations/shopify/webhooks/orders-create`
- verify HMAC
- dedupe by event id
- process order lines -> local stock decrement

9. `POST /api/integrations/shopify/sync/retry-failed`
- admin retry failed outbound jobs

10. `GET /api/integrations/shopify/sync/events`
- paginated event/audit list

11. `POST /api/integrations/shopify/reconcile/run`
- run reconciliation, return mismatch summary

### C) Permission gates
Use `requirePerm`:

- Setup/config routes: `manage_employees` or dedicated `manage_integrations`
- Manual retry/reconcile: `manage_inventory`
- Webhook route: no session perm, but strict HMAC validation required

### D) Hook outbound enqueue into existing flows
Inside existing successful stock-changing transactions:

- sale checkout
- sale void
- returns
- stock adjustments
- transfers
- GRN receive
- supplier return

For each stock mutation:

1. Resolve mapped Shopify inventory item + location
2. Write `shopify_sync_events` outbound record
3. Enqueue queue row with signed delta

### E) Worker loop
Add background worker in backend process:

- poll `shopify_inventory_queue` every N seconds
- lock next due jobs
- batch by location when possible
- call GraphQL `inventoryAdjustQuantities`
- update queue/event status
- exponential backoff (e.g. 1m, 5m, 15m, 1h, max)

## Frontend Plan (`frontend/src/pages/`)

Create page: `ShopifyIntegration.jsx`

Sections:

1. Connection
- connect/disconnect, status badge, last sync time

2. Location Mapping
- table: POS outlet -> Shopify location select

3. Product Mapping
- filter/search unmapped
- auto-map button
- manual mapping modal

4. Sync Monitor
- queue stats
- failed events list
- retry failed button

5. Reconciliation
- run reconciliation
- mismatches table with "apply fix" actions (phase 2)

Routing/UI integration:

- Add route `/integrations/shopify`
- Add nav item under Setup/Administrator
- protect route with permission

## Security Plan

1. Encrypt Shopify tokens and webhook secret in DB
2. Verify webhook HMAC before processing payload
3. Reject old/replayed webhooks with idempotency table
4. Redact tokens from logs and API responses

## Failure Modes + Handling

1. Shopify API timeout/rate limit
- retry with backoff + jitter

2. Missing product mapping
- event marked `failed_mapping`, visible in UI

3. Stock mismatch drift
- surfaced by reconciliation report

4. Partial order line processing
- per-line result logging, not silent success

## Testing Plan

### Unit / integration

1. HMAC verification tests
2. Idempotency tests (duplicate webhook/event)
3. Queue retry/backoff tests
4. Mapping resolver tests
5. Delta sign correctness tests per flow

### End-to-end scenarios

1. POS sale decrements Shopify mapped variant stock
2. POS void restores Shopify stock
3. Shopify order webhook decrements POS outlet stock
4. Duplicate Shopify webhook does not double-decrement
5. Unmapped SKU generates failed event (no silent drop)
6. Reconciliation detects intentional mismatch

### Regression checks

- Existing e2e suite must still pass for POS core behavior
- Add new e2e file for Shopify sync mocked calls

## Rollout Plan

1. Phase 1: Read-only setup + mapping UI
2. Phase 2: Outbound POS -> Shopify (feature-flagged)
3. Phase 3: Inbound webhook Shopify -> POS (feature-flagged)
4. Phase 4: Reconciliation + auto-repair helpers

Feature flags:

- `shopify_sync_outbound`
- `shopify_sync_inbound`
- `shopify_reconciliation`

## Suggested File-Level Work Breakdown

1. `backend/migrate41.js`
2. `backend/index.js` (routes + integration hooks)
3. `backend/shopify/client.js`
4. `backend/shopify/queue.js`
5. `backend/shopify/idempotency.js`
6. `backend/shopify/reconcile.js`
7. `frontend/src/pages/ShopifyIntegration.jsx`
8. `frontend/src/App.jsx` (route)
9. `frontend/src/components/AppLayout.jsx` (nav + permission)
10. `docs/SHOPIFY_SYNC_PLAN.md`
11. `docs/TESTING.md` update after tests

---

## Shopify Alignment Status (Done vs Remaining)

This section maps your research fields to current OneShopPOS readiness.

### 1) PRODUCTS

Shopify fields you listed:
- Product title
- Description
- Variants
- SKU
- Barcode
- Price
- Compare-at price
- Images
- Weight
- Tags
- Product type
- Vendor
- Inventory levels
- Status (active/draft)

Current OneShopPOS status:

- Done/available now:
  - Title/name
  - Variants
  - SKU (variant-level; partial at product-level)
  - Barcode
  - Price
  - Vendor/Supplier linkage (conceptual equivalent)
  - Inventory levels (local/outlet stock)

- Partially available (needs alignment):
  - Status handling (exists in some modules but not standardized for Shopify product publish state)
  - Product type and tags (can be approximated via categories/metadata but not Shopify-ready)

- Missing (must add for parity):
  - Compare-at price
  - Product image/media model
  - Weight (shipping-grade)
  - Canonical Shopify identifier storage per product/variant/inventory item

### 2) INVENTORY

Shopify fields you listed:
- Inventory item ID
- Available quantity
- Location-based stock
- Adjustments
- Transfers
- Inventory tracking

Current OneShopPOS status:

- Done/available now:
  - Available quantity
  - Location-based stock (outlet_stock)
  - Adjustments
  - Transfers
  - Inventory tracking and audit records

- Missing for Shopify integration:
  - Inventory item ID mapping (`shopify_inventory_item_id`)
  - Shopify location mapping (`shopify_location_id` <-> `outlet_id`)
  - Sync queue + retry worker + idempotency and reconciliation

### 3) ORDERS

Shopify fields you listed:
- Order number
- Line items
- Quantity
- Discounts
- Taxes
- Shipping charges
- Customer info
- Payment status
- Fulfillment status
- Refunds
- Transactions

Current OneShopPOS status:

- Done/available now:
  - Order/sale number (internal)
  - Line items
  - Quantity
  - Discounts
  - Taxes
  - Customer linkage
  - Refund/returns support
  - Payment transactions (sale payments)

- Partial/missing for Shopify parity:
  - Shipping charges (not first-class in POS sale model)
  - External payment status mapping from Shopify
  - Fulfillment status tracking model
  - External order ID linkage (`shopify_order_id`) and webhook ingestion

### 4) CUSTOMERS

Shopify fields you listed:
- Name
- Email
- Phone
- Address
- Order history
- Tags
- Total spent

Current OneShopPOS status:

- Done/available now:
  - Name, email, phone/mobile, address
  - Order history
  - Total spent (derived/reporting)

- Missing for Shopify parity:
  - Customer tags model
  - External customer mapping (`shopify_customer_id`)
  - Merge/conflict rules for duplicate identity resolution

### 5) PAYMENTS

Shopify fields you listed:
- Payment transactions
- Payment status
- Refund info
- (processing stays in Shopify)

Current OneShopPOS status:

- Done/available now:
  - Payment transaction records
  - Refund records in returns workflows

- Missing for Shopify parity:
  - Inbound payment status mapping from Shopify orders/transactions
  - Settlement/reconciliation against Shopify transaction lifecycle

### 6) FULFILLMENTS

Shopify fields you listed:
- Fulfillment status
- Tracking numbers
- Carrier info

Current OneShopPOS status:

- Mostly missing:
  - No dedicated fulfillment entity
  - No tracking/carrier data model
  - No webhook/state mapping for shipped/partial/delivered

### 7) LOCATIONS

Shopify fields you listed:
- Multi-location support
- Warehouse vs retail store split

Current OneShopPOS status:

- Done/available now:
  - Multi-outlet support
  - Transfer and stock handling between outlets

- Missing for Shopify parity:
  - Explicit mapping table between POS outlets and Shopify locations
  - Per-location conflict and fallback rules for sync

## Final Readiness Conclusion

OneShopPOS is strongly prepared at the operational core (inventory, sales, customers, outlets), but not yet Shopify-perfect.

Before enabling production bi-directional sync, complete:

1. Shopify connection + mapping layer
2. Outbound queue + inbound webhooks with idempotency
3. Reconciliation engine
4. Schema extensions for missing parity fields (media, compare-at, fulfillment, external IDs, tags)

---

## Next 2-Week Execution Sprint

### Week 1

1. Day 1
- Add encryption-at-rest for `shopify_connections.access_token` and `webhook_secret`.
- Add key management/env fallback notes in docs.

2. Day 2
- Implement queue retry metadata (`attempt_count`, `next_retry_at`) and dead-letter status.
- Add manual retry endpoint for failed events.

3. Day 3
- Implement strict stock movement policy for inbound Shopify orders by payment/fulfillment state.
- Add duplicate-safe idempotency guards for order updates/cancellations.

4. Day 4
- Implement live reconciliation pull from Shopify inventory by mapped location/item.
- Store mismatch snapshots with actionable statuses.

5. Day 5
- Add backend automated tests:
  - webhook signature/replay window
  - idempotency duplicate handling
  - queue retry and failure transitions

### Week 2

1. Day 6
- Extend `ShopifyIntegration.jsx` with failed-event triage panel (filter, retry single, retry all).
- Add mapping conflict review UI before apply.

2. Day 7
- Add inventory/product parity UI completion (media/status/tags/weight/compare-at).
- Add validation and role-guarded actions.

3. Day 8
- Add connector health cards to Dashboard (pending, failed, last sync, mismatch count).
- Add error surfacing for ops with clear remediation actions.

4. Day 9
- Run full integration validation with real Shopify test store:
  - sale, void, return, transfer, adjustment, PO receive, supplier return
  - webhook inbound flow and replay protections

5. Day 10
- Run full regression (backend + frontend + E2E).
- Publish test evidence and final go-live checklist in docs.
