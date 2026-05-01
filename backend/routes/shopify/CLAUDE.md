# Shopify Routes — Claude Guide

All routes in this directory mount under `/api/integrations/shopify/*` and `/api/integrations/mappings/*`. Mounted after tenant middleware — have full `req.employee`, `req.company`, `deps.db` context.

## index.js — Orchestrator

Creates three shared closures injected into all sub-modules via `localDeps`:
- **`maskSecret(secret)`** — wraps `shopify/utils.maskSecret` with `deps.decryptShopifySecret`
- **`getActiveShopifyConnection()`** — async; queries `shopify_connections WHERE is_active=true` and decrypts `access_token`/`webhook_secret`. Returns `null` if no active connection. Most routes call this first and return 400 if null.
- **`resolveImportCategoryId(productTypeName)`** — finds a leaf category by name (case-insensitive); returns `null` if 0 or 2+ matches. Used during product import to auto-assign categories.

Sub-module load order: config → health → sync → orders → import → mappings → webhooks → reconciliation.

Dependencies from outer `deps`: `db`, `requirePerm`, `requireAnyPerm`, `requireFeature`, `encryptShopifySecret`, `decryptShopifySecret`, `webhookLimiter`, `logShopifyEvent`, `verifyConnection`, `fetchShopifyLocations`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchShopifyProductsFull`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`, `upsertWebOrderFromShopifyPayload`, `processPendingShopifyInventoryEvents`, `enqueueInventorySyncEvents`, `buildWebhookIdempotencyKey`, `verifyWebhookSignature`, `evaluateWebhookTimestampWindow`, `isRetryableInventoryEventStatus`, `canApproveReconciliationRequest`, `createNotification`, `adjustShopifyInventory`.

## config.js — Connection Configuration

Permission: `manage_inventory` on all routes.

- **`GET /api/integrations/shopify/config`** — returns masked config (never returns raw token). Response: `{ connected, config: { id, shop_domain, api_version, webhook_secret_masked, default_location_id, is_active, last_sync_at, last_error } }`.
- **`PUT /api/integrations/shopify/config`** — upserts `shopify_connections`. If token not provided and row exists, keeps existing encrypted token. Uses `ON CONFLICT(shop_domain)` upsert. Deactivates all other connections first (only one active at a time). Encrypts token + webhook_secret via `encryptShopifySecret`.
- **`POST /api/integrations/shopify/disconnect`** — sets `is_active=false` on all active connections.

## health.js — Status & UAT

- **`GET /api/integrations/shopify/status`** — `requireAnyPerm(["manage_inventory","manage_orders"])`. Returns connection info + event stats from `external_sync_events` + last run from `shopify_sync_runs` + queue health (dead_letter, retry_due, backlog, oldest_backlog_minutes for outbound inventory events).
- **`POST /api/integrations/shopify/verify`** — `requirePerm("manage_inventory")`. Calls `verifyConnection(conn)` (live API call). Returns `{ ok, shop }`.
- **`GET /api/integrations/shopify/locations/live`** — `requirePerm("manage_inventory")`. Calls `fetchShopifyLocations(conn)` (live API). Returns Shopify locations array.
- **`POST /api/integrations/shopify/live-validation`** — `requirePerm("manage_inventory")`. End-to-end check: verifies connection + locations + fetches live inventory level for up to 5 mapped products. Returns `{ ok, checks: { shop_connection, locations, mapped_inventory_sample } }`.
- **`GET /api/integrations/shopify/webhooks/setup`** — `requirePerm("manage_inventory")`. Returns callback URL info and list of required topics (`orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`). Does NOT register webhooks — just instructions for manual setup in Shopify admin. `APP_PUBLIC_BASE_URL` env var used for callback URL base.
- **`GET /api/integrations/shopify/uat-checklist`** — `requireAnyPerm(["manage_inventory","manage_orders"])`. Returns 6-item checklist: active connection, location mapping exists, product mapping exists, outbound processed, inbound processed, no dead letters.

## sync.js — Sync Operations

- **`GET /api/integrations/shopify/events`** — `requireAnyPerm(["manage_inventory","manage_orders"])`. Filterable by `status`, `entity_type`, `direction`, `search`. Reads from `external_sync_events`. Limit 200 max.
- **`POST /api/integrations/shopify/sync/retry-event/:id`** — `requirePerm("manage_inventory")`. Resets single event to `pending`. Only outbound inventory events are retryable; rejects if `isRetryableInventoryEventStatus()` returns false.
- **`POST /api/integrations/shopify/sync/process-pending`** — `requirePerm("manage_inventory")`. Creates a `shopify_sync_runs` row then calls `processPendingShopifyInventoryEvents(limit, callback)` — note: callback-based (not async/await). Body: `{ limit }` (max 100).
- **`POST /api/integrations/shopify/sync/retry-failed`** — `requirePerm("manage_inventory")`. Bulk-resets `failed|dead_letter|retry|failed_mapping` outbound inventory events to `pending`. Body: `{ limit }` (max 500).
- **`POST /api/integrations/shopify/sync/push-inventory`** — `requirePerm("manage_inventory")`. Body: `{ rows, process_now }`. Calls `enqueueInventorySyncEvents` then optionally processes immediately.

## orders.js — Order Pull

- **`POST /api/integrations/shopify/sync/pull-orders`** — `requirePerm("manage_orders")` (only route with this perm). Fetches last 10 Shopify orders via `fetchRecentOrders(conn, 10)`, calls `upsertWebOrderFromShopifyPayload()` for each. Creates `shopify_sync_runs` row. Uses `ON CONFLICT(idempotency_key) DO NOTHING` for deduplication. Idempotency key: `inbound_order_{shopify_order_id}`.

## import.js — Product & Inventory Import

- **`POST /api/integrations/shopify/import/products`** — `requirePerm("manage_inventory")`. Fetches up to 10,000 products from Shopify via `fetchShopifyProductsFull`. Matches variants by barcode or SKU. Creates/updates `products`, `product_variants`, `outlet_stock`, `shopify_product_map`, `shopify_product_metadata`. Category auto-resolved via `resolveImportCategoryId()` (requires exact leaf match). Returns `{ created, updated, skipped, errors }`.
- **`POST /api/integrations/shopify/import/inventory`** — `requirePerm("manage_inventory")`. Syncs inventory levels from Shopify into `outlet_stock`. Reads `shopify_product_map` + `shopify_location_map` to find which products/outlets to sync.
- **`DELETE /api/integrations/shopify/import/products`** — `requirePerm("manage_inventory")`. Deletes products that were imported from Shopify (identified via `shopify_product_map`). Also removes `shopify_product_map` rows. **This route is checked by `ensureCriticalRoutesRegistered()` at boot** — removing it crashes the server.

## mappings.js — Product, Location & Customer Mappings

Permission: `manage_inventory` on product and location mapping routes. Customer mapping routes use `manage_orders` instead (see below).

**Product mappings:**
- `GET /api/integrations/mappings/products` — list all `shopify_product_map` rows joined with `products` and `product_variants`.
- `PUT /api/integrations/mappings/products/:id` — upsert mapping by ID with `ON CONFLICT(id)`.
- `POST /api/integrations/mappings/products/auto-live` — fetches live Shopify variant catalog (`fetchShopifyVariantCatalog`), auto-matches to local products/variants by barcode/SKU, creates/updates mappings in batch.
- `POST /api/integrations/mappings/products/apply-suggestions` — applies a batch of suggested mappings from the frontend (array of `{ local_product_id, local_variant_id, shopify_product_id, shopify_variant_id, shopify_inventory_item_id }`).

**Location mappings:**
- `GET /api/integrations/mappings/locations` — list `shopify_location_map` joined with `outlets`.
- `PUT /api/integrations/mappings/locations/:outletId` — upsert location mapping (param is `:outletId`, not `:id`).

**Customer mappings** (permission: `manage_orders`):
- `GET /api/integrations/mappings/customers` — list all Shopify customer mappings (no GET by individual customer ID).
- `PUT /api/integrations/mappings/customers/:customerId` — upsert `shopify_customer_map`.

**Auto-mapping:**
- `POST /api/integrations/mappings/products/auto` — auto-match local products to Shopify products by barcode/SKU using locally-cached data (distinct from `auto-live` which fetches from Shopify API live).

## webhooks.js — Inbound Webhook

- **`POST /api/integrations/shopify/webhooks/orders-create`** — NO auth middleware (public endpoint), guarded by `webhookLimiter`. Signature-verified via `verifyWebhookSignature` (HMAC-SHA256 on `rawBody` vs `conn.webhook_secret`). Checks shop domain header matches configured domain. Validates replay window via `evaluateWebhookTimestampWindow`. Deduplicates via `ON CONFLICT(idempotency_key)` on `external_sync_events`. Calls `upsertWebOrderFromShopifyPayload` on success. Returns 200 immediately on duplicate (idempotent).

**Gotcha**: Only `orders/create` topic is implemented. The `GET /webhooks/setup` endpoint lists `orders/updated`, `orders/cancelled`, `refunds/create` as "required topics" — but those endpoints don't exist yet. Shopify will call them but nothing will process them.

**Gotcha**: `rawBody` is captured by the global `express.json` middleware at server boot for `/api/integrations/shopify/webhooks/*` — don't bypass this by adding json middleware to individual routes.

## reconciliation.js — Inventory Reconciliation

Tables: `inventory_reconciliation`, `action_history`.

- **`GET /api/integrations/shopify/reconciliation`** — `requireAnyPerm(["view_reports","manage_inventory"])`. Accepts `?status=` and `?resolution_status=`. Joins `products` and `outlets`. Maps `local_qty` → `pos_qty`, `external_qty` → `shopify_qty` in response.
- **`POST /api/integrations/shopify/reconciliation`** — `requirePerm("manage_inventory")`. Runs a live check: fetches inventory levels from Shopify via `fetchInventoryLevelsBatch`, compares with `outlet_stock`, inserts/updates `inventory_reconciliation`. Records action history.
- **`PUT /api/integrations/shopify/reconciliation/:id`** — `requirePerm("manage_inventory")`. Updates `resolution_status`, `notes`.
- **`POST /api/integrations/shopify/reconciliation/:id/fix`** — `requirePerm("manage_inventory")` + **`requireFeature("approvals")`** (only feature-flagged route in all of shopify/). Creates an `approval_requests` row and returns `{ approval_request_id }`. Does NOT call `adjustShopifyInventory` or `createNotification` directly — the approval flow handles the actual inventory adjustment after approval.
- **`POST /api/integrations/shopify/reconciliation/bulk`** — `requirePerm("manage_inventory")`. Bulk action on multiple reconciliation rows.

`logActionHistory(req, actionType, description)` — fire-and-forget local helper; reads `x-employee-id` header, looks up employee name, inserts into `action_history`.

## Key Tables

| Table | Purpose |
|-------|---------|
| `shopify_connections` | One row per Shopify store. One `is_active=true` at a time. Token+secret AES-256-GCM encrypted. |
| `shopify_product_map` | Maps local `product_id`/`variant_id` → `shopify_product_id`/`shopify_variant_id`/`shopify_inventory_item_id` |
| `shopify_product_metadata` | Extra Shopify attributes (product type, tags, etc.) |
| `shopify_location_map` | Maps local `outlet_id` → `shopify_location_id` |
| `shopify_customer_map` | Maps local `customer_id` → `shopify_customer_id` |
| `external_sync_events` | Audit + queue table for all sync operations (inbound/outbound). Statuses: `pending`, `retry`, `processed`, `failed`, `dead_letter`, `failed_mapping`. |
| `shopify_sync_runs` | One row per manual or background sync run. Tracks `processed_count`, `failed_count`, `direction`, `run_type`. |
| `inventory_reconciliation` | Discrepancy records from reconciliation scans. `diff = local_qty - external_qty`. |

## Permission Summary

| Route | Permission |
|-------|-----------|
| Most config/import/sync routes | `manage_inventory` |
| `sync/pull-orders` | `manage_orders` |
| `mappings/customers` (GET + PUT) | `manage_orders` |
| `status`, `events`, `uat-checklist` | `requireAnyPerm(["manage_inventory","manage_orders"])` |
| `reconciliation` GET | `requireAnyPerm(["view_reports","manage_inventory"])` |
| `reconciliation/:id/fix` | `manage_inventory` + `requireFeature("approvals")` |
| webhooks endpoint | No auth — signature-verified only |
