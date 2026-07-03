# Shopify Routes — Claude Guide

All routes here mount under `/api/integrations/shopify/*` and `/api/integrations/mappings/*`, after tenant middleware (full `req.employee`, `req.company`, `deps.db` context) — with the single exception of the inbound order webhook, which has no auth.

## index.js — Orchestrator

Builds three shared closures and injects them (plus everything from the outer `deps`) into every sub-module as `localDeps`:

- **`maskSecret(secret)`** — wraps `shopify/utils.maskSecret` with `deps.decryptShopifySecret`. Used so config responses never leak a raw token.
- **`getActiveShopifyConnection()`** — async; queries `shopify_connections WHERE is_active=true` and decrypts `access_token`/`webhook_secret` via `shopify/utils.getActiveShopifyConnection`. Returns `null` if no active connection. Nearly every route calls this first and returns 400 if null.
- **`resolveImportCategoryId(productTypeName)`** — finds a leaf category (no children) by case-insensitive name match; returns `null` on 0 or 2+ matches. Used during product import to auto-assign a category from Shopify's `product_type`.

Sub-module load order: `config` → `health` → `sync` → `orders` → `import` → `mappings` → `webhooks` → `reconciliation`. Order has no functional effect (each module just calls `app.get/post/...` directly), but keep it if adding a new sub-module for consistency.

Dependencies expected on the outer `deps` object (passed through from `registerAllRoutes.js`): `db`, `requirePerm`, `requireAnyPerm`, `requireFeature`, `encryptShopifySecret`, `decryptShopifySecret`, `webhookLimiter`, `logShopifyEvent`, `verifyConnection`, `fetchShopifyLocations`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchShopifyProductsFull`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`, `upsertWebOrderFromShopifyPayload`, `processPendingShopifyInventoryEvents`, `enqueueInventorySyncEvents`, `buildWebhookIdempotencyKey`, `verifyWebhookSignature`, `evaluateWebhookTimestampWindow`, `isRetryableInventoryEventStatus`, `canApproveReconciliationRequest`, `createNotification`, `adjustShopifyInventory`. Most of these are implemented in `backend/shopify/client.js`, `backend/shopify/crypto.js`, `backend/shopify/order-service.js`, `backend/shopify/utils.js` and wired into `deps` upstream — this directory only consumes them.

## config.js — Connection Configuration

All routes: `requirePerm("manage_inventory")`.

- `GET /api/integrations/shopify/config` — returns masked config, never the raw token: `{ connected, config: { id, shop_domain, api_version, webhook_secret_masked, default_location_id, is_active, last_sync_at, last_error } }`.
- `PUT /api/integrations/shopify/config` — upserts `shopify_connections` via `ON CONFLICT(shop_domain)`. If `access_token` omitted and a row already exists for that domain, keeps the existing encrypted token (does not clobber it with null). Deactivates every other row first — only one `is_active=true` connection at a time. Encrypts `access_token` and `webhook_secret` with `encryptShopifySecret` before storing.
- `POST /api/integrations/shopify/disconnect` — sets `is_active=false` on whatever is currently active.

## health.js — Status & UAT

- `GET /.../status` — `requireAnyPerm(["manage_inventory","manage_orders"])`. Aggregates connection state + `external_sync_events` counts (total/processed/failed/pending) + latest `shopify_sync_runs` row + outbound-inventory queue health (dead_letter, retry_due, backlog, oldest_backlog_minutes).
- `POST /.../verify` — `manage_inventory`. Live API call via `verifyConnection(conn)`. Returns `{ ok, shop }`.
- `GET /.../locations/live` — `manage_inventory`. Live API call via `fetchShopifyLocations(conn)`.
- `POST /.../live-validation` — `manage_inventory`. Combined live check: connection + locations + up to 5 sampled mapped-product inventory levels via `fetchInventoryLevel`. Returns per-check `ok` flags plus sample rows.
- `GET /.../webhooks/setup` — `manage_inventory`. Returns a callback URL (prefers `APP_PUBLIC_BASE_URL` env var, else derives from `req.protocol`/`req.get("host")`) and a list of "required topics": `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`. This is informational only — it does NOT call Shopify's webhook-registration API. See the webhooks.js gotcha below: only `orders/create` is actually handled.
- `GET /.../uat-checklist` — `requireAnyPerm(["manage_inventory","manage_orders"])`. Six-item pass/fail checklist (connection, location mapping exists, product mapping exists, outbound processed, inbound processed, zero dead-letters) — useful as a fast go-live gate.

## sync.js — Sync Operations

- `GET /.../events` — `requireAnyPerm([...])`. Filters `external_sync_events` by `status`, `entity_type`, `direction`, `search` (ILIKE on idempotency_key/error_message). Limit capped at 200.
- `POST /.../sync/retry-event/:id` — `manage_inventory`. Resets one event to `pending`. Only outbound `entity_type='inventory'` events are retryable, gated by `isRetryableInventoryEventStatus(status)`.
- `POST /.../sync/process-pending` — `manage_inventory`. Creates a `shopify_sync_runs` row, then calls `processPendingShopifyInventoryEvents(limit, callback)` — **callback-based, not promise/async**. Body: `{ limit }` (max 100, default 25).
- `POST /.../sync/retry-failed` — `manage_inventory`. Bulk-resets outbound inventory events in `failed|dead_letter|retry|failed_mapping` back to `pending`. Body: `{ limit }` (max 500, default 100).
- `POST /.../sync/push-inventory` — `manage_inventory`. Body: `{ rows, process_now }`. Enqueues via `enqueueInventorySyncEvents` (also callback-based), then if `process_now` and something was queued, immediately calls `processPendingShopifyInventoryEvents(50, ...)`. Both `enqueueInventorySyncEvents` and `processPendingShopifyInventoryEvents` are the same external, callback-style functions used elsewhere in this file — don't try to `await` them directly.

## orders.js — Order Pull

- `POST /.../sync/pull-orders` — the only route in this directory using `manage_orders` for a top-level connection route. Fetches the last 10 orders via `fetchRecentOrders(conn, 10)`, and for each calls `upsertWebOrderFromShopifyPayload(orderPayload)` (same helper the webhook uses). Deduplicates via `idempotency_key = inbound_order_{shopify_order_id}` and `ON CONFLICT (idempotency_key) DO NOTHING` on `external_sync_events`. Creates/updates a `shopify_sync_runs` row (`direction='inbound'`, `run_type='manual_pull_orders'`).

## import.js — Product & Inventory Import

- `POST /.../import/products` — `manage_inventory`. Pulls up to 10,000 products via `fetchShopifyProductsFull(conn, 10000)`. Skips any Shopify product whose variants all lack both barcode and SKU. Matching order per variant: (1) existing `shopify_product_map.shopify_variant_id`, (2) local `barcode`, (3) local `sku`. Category is auto-resolved from `product_type` via `resolveImportCategoryId` — silently stays `null` on no/ambiguous match. Writes/updates `products`, `shopify_product_map` (upsert on `(shopify_product_id, shopify_variant_id)`), `shopify_product_metadata` (upsert on `product_id`), and seeds `outlet_stock` per location mapping (falls back to the first outlet if unmapped). Map/metadata/stock writes are fire-and-forget (`.catch(() => {})`) — a failure there won't fail the whole row. Returns `{ created, updated, skipped, errors }`.
- `POST /.../import/inventory` — `manage_inventory`. Syncs Shopify inventory levels into `outlet_stock` for existing `shopify_product_map` + `shopify_location_map` rows only (400 if none exist). Per-mapping fetch failures are collected into `errors[]`, not fatal to the batch.
- `DELETE /.../import/products` — `manage_inventory`. Deletes every product reachable via `shopify_product_map.product_id`, cascading manual deletes across `inventory_reconciliation`, `shopify_product_metadata`, `shopify_product_map`, `outlet_stock`, `product_variants`, `stock_adjustments`, then `products`, in chunks of 400 IDs. **This route is checked by `ensureCriticalRoutesRegistered()` at server boot — removing or renaming it crashes startup.**

## mappings.js — Product, Location & Customer Mappings

Product + location routes: `manage_inventory`. Customer routes: `manage_orders`.

**Product mappings**
- `GET /api/integrations/mappings/products` — all `shopify_product_map` rows joined to `products`/`product_variants`.
- `PUT /api/integrations/mappings/products/:id` — upsert by numeric `id` via `ON CONFLICT(id)`. This is an edit-by-row-id endpoint, not create-by-product-id.
- `POST /api/integrations/mappings/products/auto` — generates candidate list from **local DB only** (no Shopify API call) — just all products+variants for the UI to eyeball.
- `POST /api/integrations/mappings/products/auto-live` — live variant catalog fetch (`fetchShopifyVariantCatalog(conn, limit)`, limit capped 10,000), matched against local products/variants by exact barcode then exact SKU (case-insensitive), excluding already-correctly-mapped pairs. Returns suggestions only — does not write anything.
- `POST /api/integrations/mappings/products/apply-suggestions` — applies a suggestions array (as returned by `auto-live`). Detects conflicts (another local product/variant already claims that `shopify_variant_id`) and skips them into a `conflicts[]` array rather than overwriting.

**Location mappings**
- `GET /api/integrations/mappings/locations` — joined to `outlets`.
- `PUT /api/integrations/mappings/locations/:outletId` — param is `:outletId`, not `:id`. Deletes any existing mapping row for that outlet then inserts fresh (delete+insert inside a transaction, not a true upsert — so `shopify_location_map` has no unique constraint being relied on here).

**Customer mappings** (`manage_orders`)
- `GET /api/integrations/mappings/customers` — list only, joined to `customers`. No single-customer GET.
- `PUT /api/integrations/mappings/customers/:customerId` — upsert on `ON CONFLICT(shopify_customer_id)`.

## webhooks.js — Inbound Webhook

- `POST /api/integrations/shopify/webhooks/orders-create` — **no auth middleware**, only `webhookLimiter`. This is the sole public/unauthenticated route in the directory. Verification chain, in order:
  1. Loads the active connection; 400 if none.
  2. If `x-shopify-shop-domain` header present, must case-insensitively match `conn.shop_domain`, else 403.
  3. `verifyWebhookSignature({ rawBody, providedHmac: x-shopify-hmac-sha256, webhookSecret: conn.webhook_secret })` — HMAC-SHA256 over the raw body. Missing signature, missing configured secret, or mismatch all return 401 with a differentiated error message.
  4. `evaluateWebhookTimestampWindow(x-shopify-triggered-at, Date.now())` — rejects (401) requests outside the allowed replay window; logs a `webhook_replay_window_reject` event via `logShopifyEvent`.
  5. Idempotency check against `external_sync_events.idempotency_key` (built by `buildWebhookIdempotencyKey({ webhookId, payload })`) — duplicates return `200 { success: true, duplicate: true }` immediately without reprocessing.
  6. Calls `upsertWebOrderFromShopifyPayload(payload)`, then records the outcome (processed/failed) into `external_sync_events` and updates `shopify_connections.last_sync_at`/`last_error`.

**Gotcha**: only the `orders/create` topic is actually implemented. The `GET /.../webhooks/setup` endpoint (health.js) advertises `orders/updated`, `orders/cancelled`, `refunds/create` as "required topics" for the merchant to configure in Shopify admin, but no route handlers exist for them — if Shopify sends those webhooks they will 404.

**Gotcha**: `rawBody` is captured globally by `express.json` at server boot specifically for `/api/webhooks/*` and `/api/integrations/shopify/webhooks/*` paths (see `backend/CLAUDE.md` middleware chain, step 3). Do not add a body-parser to this route — `req.rawBody` must remain the exact bytes Shopify signed, or HMAC verification will always fail.

## reconciliation.js — Inventory Reconciliation

Has its own local `getActiveShopifyConnection()` built directly from `shopify/utils` (re-derived here rather than reused from `index.js`'s closure — both do the same thing, just constructed independently in this file).

- `GET /api/integrations/shopify/reconciliation` — `requireAnyPerm(["view_reports","manage_inventory"])`. Filters by `?status=` and `?resolution_status=`. Joins `products`/`outlets`. Remaps `local_qty`→`pos_qty`, `external_qty`→`shopify_qty` in the JSON response (frontend-facing naming, doesn't match the DB columns).
- `POST /api/integrations/shopify/reconciliation` — `manage_inventory`. Full live reconciliation run: pulls all active `shopify_product_map` × `shopify_location_map` combos, sums local `outlet_stock`, batches (50 at a time, grouped by location) calls to `fetchInventoryLevelsBatch`, computes `diff = local_qty - external_qty`, and **replaces the entire `inventory_reconciliation` table** (`DELETE FROM inventory_reconciliation` then bulk insert, all inside one transaction) — this is a full-table replace on every run, not an incremental update. Per-location batch fetch failures produce `status='error'` rows rather than aborting the whole run.
- `PUT /api/integrations/shopify/reconciliation/:id` — `manage_inventory`. Updates `resolution_status` (`open|resolved|ignored`) + `resolution_note`; clearing back to `open` nulls `resolved_at`.
- `POST /api/integrations/shopify/reconciliation/:id/fix` — `manage_inventory` **+ `requireFeature("approvals")`** (the only feature-flag-gated route in this whole directory). Does not touch inventory itself — just creates an `approval_requests` row (`request_type='reconciliation_fix'`) with a JSON `notes` snapshot of the diff; actual stock adjustment happens elsewhere once approved.
- `POST /api/integrations/shopify/reconciliation/bulk` — `manage_inventory`. Body: `{ ids, action: "ignore"|"fix", mode }`. For `action="fix"`, `mode` must be `pos_wins` or `shopify_wins`: `shopify_wins` overwrites local `outlet_stock.quantity` with the Shopify-side value for each row; `pos_wins` changes nothing locally (relies on the normal outbound sync to eventually push POS values to Shopify). All wrapped in one transaction.

`logActionHistory(req, actionType, description)` — local fire-and-forget helper reading `x-employee-id` header, resolving the employee name, and inserting into `action_history`. Swallows errors silently.

## Key Tables

| Table | Purpose |
|-------|---------|
| `shopify_connections` | One row per Shopify store; only one `is_active=true` at a time. `access_token`/`webhook_secret` AES-256-GCM encrypted via `services/crypto.js`/`shopify/crypto.js`. |
| `shopify_product_map` | Local `product_id`/`variant_id` ↔ `shopify_product_id`/`shopify_variant_id`/`shopify_inventory_item_id`. Unique on `(shopify_product_id, shopify_variant_id)`. |
| `shopify_product_metadata` | Extra Shopify attributes (handle, status, product_type, vendor, tags). Unique on `product_id`. |
| `shopify_location_map` | Local `outlet_id` ↔ `shopify_location_id`. No enforced unique constraint — `mappings.js` does delete+insert instead of upsert. |
| `shopify_customer_map` | Local `customer_id` ↔ `shopify_customer_id`. Unique on `shopify_customer_id`. |
| `external_sync_events` | Cross-directional audit/queue log. Statuses: `pending`, `retry`, `processed`, `failed`, `dead_letter`, `failed_mapping`. Deduped via `idempotency_key`. |
| `shopify_sync_runs` | One row per manual or background sync run (`direction`, `run_type`, `processed_count`, `failed_count`). |
| `inventory_reconciliation` | Snapshot from the latest reconciliation scan only — fully replaced each run. `diff = local_qty - external_qty`. |

## Permission Summary

| Route(s) | Permission |
|----------|-----------|
| Connection config, import, sync, most mapping routes | `manage_inventory` |
| `sync/pull-orders` | `manage_orders` |
| `mappings/customers` (GET + PUT) | `manage_orders` |
| `status`, `events`, `uat-checklist` | `requireAnyPerm(["manage_inventory","manage_orders"])` |
| `reconciliation` GET | `requireAnyPerm(["view_reports","manage_inventory"])` |
| `reconciliation/:id/fix` | `manage_inventory` + `requireFeature("approvals")` |
| `webhooks/orders-create` | none — HMAC signature-verified instead |

## Cross-File Dependencies

- `backend/shopify/utils.js` — `maskSecret`, `getActiveShopifyConnection` (both re-implemented/wrapped in `index.js` and again independently in `reconciliation.js`).
- `backend/shopify/client.js` — the live Shopify Admin API calls injected as `deps`: `verifyConnection`, `fetchShopifyLocations`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchShopifyProductsFull`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`.
- `backend/shopify/order-service.js` — `upsertWebOrderFromShopifyPayload`, used by both the webhook and the manual order-pull route.
- `backend/shopify/crypto.js` / `backend/services/crypto.js` — `encryptShopifySecret`/`decryptShopifySecret`, and the webhook HMAC helpers (`verifyWebhookSignature`, `buildWebhookIdempotencyKey`, `evaluateWebhookTimestampWindow`).
- Queue/enqueue helpers (`processPendingShopifyInventoryEvents`, `enqueueInventorySyncEvents`, `isRetryableInventoryEventStatus`) are callback-style, not promise-based — don't `await` them; wrap in a `Promise` if async/await is needed in new code.
