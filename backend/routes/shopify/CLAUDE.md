# Shopify Routes — Claude Guide

Routes here mount under `/api/integrations/shopify/*` and `/api/integrations/mappings/*`, after tenant middleware (full `req.employee`, `req.company`, `deps.db` context) — with the single exception of the inbound order webhook, which has no auth.

## index.js — Orchestrator

Builds three shared closures and injects them (plus everything from the outer `deps`) into every sub-module as `localDeps`:

- **`maskSecret(secret)`** — wraps `shopify/utils.maskSecret` with `deps.decryptShopifySecret`. Used so config responses never leak a raw token.
- **`getActiveShopifyConnection()`** — async; queries `shopify_connections WHERE is_active=true` and decrypts `access_token`/`webhook_secret` via `shopify/utils.getActiveShopifyConnection`. Returns `null` if no active connection. Nearly every route calls this first and returns 400 if null.
- **`resolveImportCategoryId(productTypeName)`** — finds a leaf category (no children) by case-insensitive name match; returns `null` on 0 or 2+ matches. Used during product import to auto-assign a category from Shopify's `product_type`.

Sub-module load order: `config` → `health` → `sync` → `orders` → `import` → `mappings` → `webhooks` → `reconciliation`. Order has no functional effect (each module just calls `app.get/post/...` directly on the shared `app`), but keep it if adding a new sub-module.

Dependencies expected on the outer `deps` object (passed through from `registerAllRoutes.js`): `db`, `requirePerm`, `requireAnyPerm`, `requireFeature`, `encryptShopifySecret`, `decryptShopifySecret`, `webhookLimiter`, `logShopifyEvent`, `verifyConnection`, `fetchShopifyLocations`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchShopifyProductsFull`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`, `upsertWebOrderFromShopifyPayload`, `processPendingShopifyInventoryEvents`, `enqueueInventorySyncEvents`, `buildWebhookIdempotencyKey`, `verifyWebhookSignature`, `evaluateWebhookTimestampWindow`, `isRetryableInventoryEventStatus`, `canApproveReconciliationRequest`, `createNotification`, `adjustShopifyInventory`. Most of these live in the sibling `backend/shopify/` directory (`client.js`, `crypto.js`, `order-service.js`, `utils.js`) — this directory only consumes them as injected deps, never imports them directly (the two exceptions below).

**Note**: `index.js` and `reconciliation.js` each independently `require("../../shopify/utils")` and build their own local `getActiveShopifyConnection()` wrapper rather than sharing one — same underlying implementation, constructed twice.

## config.js — Connection Configuration

Routes: `requireAnyPerm(["manage_inventory", "manage_integrations"])` — `manage_integrations` was added as the PLAN-V2 delegation perm for credential surfaces; `manage_inventory` kept for the existing Manager-facing Shopify settings page.

- `GET /config` — returns masked config, never the raw token: `{ connected, config: { id, shop_domain, api_version, webhook_secret_masked, default_location_id, is_active, last_sync_at, last_error } }`.
- `PUT /config` — upserts `shopify_connections` via `ON CONFLICT(shop_domain)`. If `access_token` is omitted and a row already exists for that domain, keeps the existing encrypted token (doesn't clobber it with null). Deactivates every other row first inside the same transaction — only one `is_active=true` connection at a time. Encrypts `access_token` and `webhook_secret` with `encryptShopifySecret` before storing. `api_version` defaults to `"2025-10"` if not supplied.
- `POST /disconnect` — sets `is_active=false` on whatever is currently active.

## health.js — Status & UAT

- `GET /status` — `requireAnyPerm(["manage_inventory","manage_orders"])`. Aggregates connection state + `external_sync_events` counts (total/processed/failed/pending) + latest `shopify_sync_runs` row + outbound-inventory queue health (dead_letter, retry_due, backlog, oldest_backlog_minutes).
- `POST /verify` — `manage_inventory`. Live API call via `verifyConnection(conn)`. Returns `{ ok, shop }`.
- `GET /locations/live` — `manage_inventory`. Live API call via `fetchShopifyLocations(conn)`.
- `POST /live-validation` — `manage_inventory`. Combined live check: connection + locations + up to 5 sampled mapped-product inventory levels via `fetchInventoryLevel`. Returns per-check `ok` flags plus sample rows.
- `GET /webhooks/setup` — `manage_inventory`. Returns a callback URL (prefers `APP_PUBLIC_BASE_URL` env var, else derives from `req.protocol`/`req.get("host")`) plus a list of "required topics": `orders/create`, `orders/updated`, `orders/cancelled`, `refunds/create`. **Informational only** — does not call Shopify's webhook-registration API. See webhooks.js gotcha below: only `orders/create` is actually handled.
- `GET /uat-checklist` — `requireAnyPerm(["manage_inventory","manage_orders"])`. Six-item pass/fail checklist (connection, location mapping exists, product mapping exists, outbound processed, inbound processed, zero dead-letters) — a fast go-live gate.

## sync.js — Sync Operations

- `GET /events` — `requireAnyPerm(["manage_inventory","manage_orders"])`. Filters `external_sync_events` by `status`, `entity_type`, `direction`, `search` (ILIKE on idempotency_key/error_message). Limit capped at 200.
- `POST /sync/retry-event/:id` — `manage_inventory`. Resets one event to `pending`. Only outbound `entity_type='inventory'` events are retryable, gated by `isRetryableInventoryEventStatus(status)`.
- `POST /sync/process-pending` — `manage_inventory`. Creates a `shopify_sync_runs` row, then calls `processPendingShopifyInventoryEvents(limit, callback)` — **callback-based, not promise/async**. Body: `{ limit }` (max 100, default 25).
- `POST /sync/retry-failed` — `manage_inventory`. Bulk-resets outbound inventory events in `failed|dead_letter|retry|failed_mapping` back to `pending`. Body: `{ limit }` (max 500, default 100).
- `POST /sync/push-inventory` — `manage_inventory`. Body: `{ rows, process_now }`. Enqueues via `enqueueInventorySyncEvents` (also callback-based), then if `process_now` and something was queued, immediately calls `processPendingShopifyInventoryEvents(50, ...)`. Both are external callback-style functions — don't `await` them directly; the response is sent from inside the innermost callback.

## orders.js — Order Pull

- `POST /sync/pull-orders` — `manage_orders` (the only top-level connection route using this perm instead of `manage_inventory`/`manage_integrations`). Fetches the last 10 orders via `fetchRecentOrders(conn, 10)`, and for each calls `upsertWebOrderFromShopifyPayload(orderPayload)` (same helper the webhook uses). Deduplicates via `idempotency_key = inbound_order_{shopify_order_id}` and `ON CONFLICT (idempotency_key) DO NOTHING` on `external_sync_events`. Creates/updates a `shopify_sync_runs` row (`direction='inbound'`, `run_type='manual_pull_orders'`). Per-order failures are caught individually and recorded as `failed` events — one bad order doesn't abort the batch.

## import.js — Product & Inventory Import

- `POST /import/products` — `manage_inventory`. Pulls up to 10,000 products via `fetchShopifyProductsFull(conn, 10000)`. Skips any Shopify product whose variants all lack both barcode and SKU. Matching order per variant: (1) existing `shopify_product_map.shopify_variant_id`, (2) local `barcode`, (3) local `sku`. Category is auto-resolved from `product_type` via `resolveImportCategoryId` — silently stays `null` on no/ambiguous match. Writes/updates `products`, `shopify_product_map` (upsert on `(shopify_product_id, shopify_variant_id)`), `shopify_product_metadata` (upsert on `product_id`), and seeds `outlet_stock` per location mapping (falls back to the first outlet if unmapped). Map/metadata/stock writes are fire-and-forget (`.catch(() => {})`) — a failure there won't fail the whole row, only the product/variant loop's own INSERT/UPDATE errors get pushed into `errors[]`. Returns `{ created, updated, skipped, errors }`.
- `POST /import/inventory` — `manage_inventory`. Syncs Shopify inventory levels into `outlet_stock` for existing `shopify_product_map` + `shopify_location_map` rows only (400 if none exist). Per-mapping fetch failures are collected into `errors[]`, not fatal to the batch.
- `DELETE /import/products` — `manage_inventory`. Deletes every product reachable via `shopify_product_map.product_id`, cascading manual deletes across `inventory_reconciliation`, `shopify_product_metadata`, `shopify_product_map`, `outlet_stock`, `product_variants`, `stock_adjustments`, then `products`, in chunks of 400 IDs (no 999-param SQLite-style limit in Postgres, but still batched for safety). **Checked by `ensureCriticalRoutesRegistered()` at server boot — removing or renaming it crashes startup.**

## mappings.js — Product, Location & Customer Mappings

Product + location routes: `manage_inventory`. Customer routes: `manage_orders`.

**Product mappings**
- `GET /api/integrations/mappings/products` — all `shopify_product_map` rows joined to `products`/`product_variants`.
- `PUT /api/integrations/mappings/products/:id` — upsert by numeric `id` via `ON CONFLICT(id)`. Edit-by-row-id, not create-by-product-id.
- `POST /api/integrations/mappings/products/auto` — generates a candidate list from **local DB only** (no Shopify API call) — all products+variants for the UI to eyeball.
- `POST /api/integrations/mappings/products/auto-live` — live variant catalog fetch (`fetchShopifyVariantCatalog(conn, limit)`, limit capped 10,000), matched against local products/variants by exact barcode then exact SKU (case-insensitive), excluding already-correctly-mapped pairs. Returns suggestions only — writes nothing.
- `POST /api/integrations/mappings/products/apply-suggestions` — applies a suggestions array (as returned by `auto-live`). Detects conflicts (another local product/variant already claims that `shopify_variant_id`) and skips them into a `conflicts[]` array rather than overwriting.

**Location mappings**
- `GET /api/integrations/mappings/locations` — joined to `outlets`.
- `PUT /api/integrations/mappings/locations/:outletId` — param is `:outletId`, not `:id`. Deletes any existing mapping row for that outlet then inserts fresh (delete+insert inside a transaction, not a true upsert — `shopify_location_map` has no unique constraint being relied on here).

**Customer mappings** (`manage_orders`)
- `GET /api/integrations/mappings/customers` — list only, joined to `customers`. No single-customer GET.
- `PUT /api/integrations/mappings/customers/:customerId` — upsert on `ON CONFLICT(shopify_customer_id)`.

## webhooks.js — Inbound Webhook

- `POST /webhooks/orders-create` — **no auth middleware**, only `webhookLimiter`. The sole public/unauthenticated route in the directory. Verification chain, in order:
  1. Loads the active connection; 400 if none.
  2. If `x-shopify-shop-domain` header present, must case-insensitively match `conn.shop_domain`, else 403.
  3. `verifyWebhookSignature({ rawBody, providedHmac: x-shopify-hmac-sha256, webhookSecret: conn.webhook_secret })` — HMAC-SHA256 over the raw body. Missing signature, missing configured secret, or mismatch all return 401 with a differentiated error message (`missing_signature` / `no_secret_configured` / generic invalid).
  4. `evaluateWebhookTimestampWindow(x-shopify-triggered-at, Date.now())` — rejects (401) requests outside the allowed replay window; logs a `webhook_replay_window_reject` event via `logShopifyEvent`.
  5. Idempotency check against `external_sync_events.idempotency_key` (built by `buildWebhookIdempotencyKey({ webhookId, payload })`) — duplicates return `200 { success: true, duplicate: true }` immediately without reprocessing.
  6. Calls `upsertWebOrderFromShopifyPayload(payload)`, then records the outcome (processed/failed) into `external_sync_events` and updates `shopify_connections.last_sync_at`/`last_error`.

**Gotcha (API versioning/rate limits)**: this directory has no explicit Shopify API version constant of its own — `api_version` is stored per-connection in `shopify_connections` (default `"2025-10"`, set in `config.js`) and passed to the `backend/shopify/client.js` functions on every call. There's no rate-limit backoff logic visible in this directory — retry/backoff for the Admin API (if any) lives in `backend/shopify/client.js`, not here.

**Gotcha**: only the `orders/create` topic is actually implemented. `GET /webhooks/setup` (health.js) advertises `orders/updated`, `orders/cancelled`, `refunds/create` as "required topics" for the merchant to configure in Shopify admin, but no route handlers exist for them — if Shopify sends those webhooks they will 404.

**Gotcha**: `rawBody` is captured globally by `express.json` at server boot specifically for `/api/webhooks/*` and `/api/integrations/shopify/webhooks/*` paths (see `backend/index.js`/`backend/CLAUDE.md` middleware chain step 3). Never add a body-parser to this route — `req.rawBody` must remain the exact bytes Shopify signed, or HMAC verification always fails.

## reconciliation.js — Inventory Reconciliation

Has its own local `getActiveShopifyConnection()` built directly from `shopify/utils` (re-derived here rather than reused from `index.js`'s closure — both do the same thing, just constructed independently in this file).

- `GET /reconciliation` — `requireAnyPerm(["view_inventory_reports","manage_inventory"])` (the D4 permission split retired the old blanket `view_reports`). Filters by `?status=` and `?resolution_status=`. Joins `products`/`outlets`. Remaps `local_qty`→`pos_qty`, `external_qty`→`shopify_qty` in the JSON response (frontend-facing naming, doesn't match the DB columns).
- `POST /reconciliation` — `manage_inventory`. Full live reconciliation run: pulls all active `shopify_product_map` × `shopify_location_map` combos, sums local `outlet_stock`, batches (50 at a time, grouped by location) calls to `fetchInventoryLevelsBatch`, computes `diff = local_qty - external_qty`, and **replaces the entire `inventory_reconciliation` table** (`DELETE FROM inventory_reconciliation` then bulk insert, all inside one transaction) — a full-table replace on every run, not an incremental update. Per-location batch fetch failures produce `status='error'` rows rather than aborting the whole run. Note the Shopify GID prefix handling: remote levels are keyed by `gid://shopify/InventoryItem/{id}`, not the bare numeric id.
- `PUT /reconciliation/:id` — `manage_inventory`. Updates `resolution_status` (`open|resolved|ignored`) + `resolution_note`; clearing back to `open` nulls `resolved_at`.
- `POST /reconciliation/:id/fix` — `manage_inventory` **+ `requireFeature("approvals")`** (the only feature-flag-gated route in the whole directory). Doesn't touch inventory itself — creates an `approval_requests` row (`request_type='reconciliation_fix'`) with a JSON `notes` snapshot of the diff; actual stock adjustment happens elsewhere once approved.
- `POST /reconciliation/bulk` — `manage_inventory`. Body: `{ ids, action: "ignore"|"fix", mode }`. For `action="fix"`, `mode` must be `pos_wins` or `shopify_wins`: `shopify_wins` overwrites local `outlet_stock.quantity` with the Shopify-side value for each row; `pos_wins` changes nothing locally (relies on the normal outbound sync to eventually push POS values to Shopify). All wrapped in one transaction. Note the mixed placeholder styles in this handler: the read of rows for `shopify_wins` uses `= ANY($1::int[])`, while the final resolution-status UPDATE builds its own `$2, $3, ...` positional list from the same `ids` array — both work, just inconsistent within the same function.

`logActionHistory(req, actionType, description)` — local fire-and-forget helper (defined only in this file) reading `x-employee-id` header, resolving the employee name, and inserting into `action_history`. Swallows errors silently.

## Key Tables

| Table | Purpose |
|-------|---------|
| `shopify_connections` | One row per Shopify store; only one `is_active=true` at a time. `access_token`/`webhook_secret` AES-256-GCM encrypted. |
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
| `config` GET/PUT, `disconnect` | `requireAnyPerm(["manage_inventory","manage_integrations"])` |
| Import, sync operations, most mapping routes | `manage_inventory` |
| `sync/pull-orders`, `mappings/customers` (GET+PUT) | `manage_orders` |
| `status`, `events`, `uat-checklist` | `requireAnyPerm(["manage_inventory","manage_orders"])` |
| `reconciliation` GET | `requireAnyPerm(["view_inventory_reports","manage_inventory"])` |
| `reconciliation/:id/fix` | `manage_inventory` + `requireFeature("approvals")` |
| `webhooks/orders-create` | none — HMAC signature-verified instead |

## Cross-File Dependencies

Everything Shopify-API-specific (live Admin API calls, credential encryption, webhook HMAC/idempotency helpers, order upsert logic) is injected via `deps` from the sibling `backend/shopify/` directory (`client.js`, `crypto.js`, `order-service.js`, `utils.js`) rather than required directly — the two exceptions are `index.js` and `reconciliation.js`, which both `require("../../shopify/utils")` for `getActiveShopifyConnection`/`maskSecret` directly instead of going through the injected closure. Notable per-function origins:
- Live Shopify Admin API calls: `verifyConnection`, `fetchShopifyLocations`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchShopifyProductsFull`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`.
- Order ingestion: `upsertWebOrderFromShopifyPayload`, used by both the webhook and the manual order-pull route.
- Credential + webhook crypto: `encryptShopifySecret`/`decryptShopifySecret`, `verifyWebhookSignature`, `buildWebhookIdempotencyKey`, `evaluateWebhookTimestampWindow`.
- Queue/enqueue helpers (`processPendingShopifyInventoryEvents`, `enqueueInventorySyncEvents`, `isRetryableInventoryEventStatus`) are callback-style, not promise-based — don't `await` them; wrap in a `Promise` if async/await is needed in new code.

This directory does not document the internals of `backend/shopify/` itself — treat those four files as an external dependency boundary.
