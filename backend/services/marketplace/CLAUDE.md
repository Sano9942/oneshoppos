# Marketplace Clients — Claude Guide

- **5 files** — marketplace API clients for the Integrations Hub (`routes/integrations/`). Each wraps a third-party platform's REST API
- **`base-marketplace.js`** — abstract base: `testConnection()`, `syncProducts(products)`, `pullOrders(since)`, `pushInventory(updates)` — all throw "Not implemented"
- **Feature flag**: all marketplace routes + workers gated on `marketplace_integrations` flag per tenant
- **Credential storage**: API keys live in `integration_settings` encrypted via `services/crypto.js` (AES-256-GCM)
- **Polling cadence**: `workers/marketplace-sync-worker-boss.js` (pg-boss, `MARKETPLACE_SYNC_WORKER_ENABLED=1`) — `marketplace-order-poll` every 10 min, `marketplace-feed-check` every 6 hours (Google Merchant)
- **Webhook delivery**: inbound webhooks hit `/api/webhooks/{daraz,meta,whatsapp}` (before tenant middleware, HMAC-verified)

---

## Config shape per client

All clients receive a `config` object from `integration_settings`. Required fields vary:

| Client | `api_key` | `api_secret` | `oauth_token` | `store_url` | `config_json` fields |
|--------|-----------|-------------|---------------|-------------|---------------------|
| `DarazClient` | app_key | app_secret | access_token (optional) | base URL (default `https://api.daraz.pk/rest`) | — |
| `MetaCommerceClient` | — | — | page access token | — | `catalog_id` (sync/inventory), `commerce_account_id` (orders) |
| `WhatsAppClient` | access token | — | — | — | `phone_number_id` (required for all sends), `business_account_id` |
| `GoogleMerchantClient` | — | — | OAuth bearer token | — | `merchant_id` (required for all ops) |

---

## `daraz-client.js`

- Auth: **Lazada Open Platform HMAC-SHA256 signature** per request — sorted params concatenated with API path, `HMAC(appSecret, apiPath+sortedParams).toUpperCase()`. Appended as `sign` query param alongside `app_key`, `timestamp`, `sign_method`, `access_token`.
- `pullOrders(since)` — defaults to last 24h; fetches order list then makes a **separate API call per order** to get items (`/order/items/get`). **N+1 pattern**: 100 orders = 101 API calls per poll cycle.
- `syncProducts(products)` — product create via `/product/create` with Lazada XML-in-JSON payload format; per-product errors caught, returns `[{ product_id, success, daraz_item_id }]`
- `pushInventory(updates)` — batch SKU quantity update via `/product/stock/sellable/update`; single call for all updates

---

## `meta-commerce.js`

- Auth: `access_token` appended as query param to every request. Graph API version: `v19.0` (hardcoded).
- `pullOrders(since)` — only fetches orders in **`FB_PROCESSING` state** (hardcoded). Orders in `CREATED`, `IN_TRANSIT`, etc. are never pulled.
- `pullOrders` price normalization: Meta returns `price_per_unit.amount` in **cents** — divided by 100. Different from Daraz which returns full units.
- `pullOrders` source detection: `order.channel === "INSTAGRAM"` → `source: "instagram"`, else `source: "facebook"`
- `syncProducts` — requires `config_json.catalog_id`; throws if missing. Price format: `"${Math.round(price * 100)} PKR"` (cents string).
- `pushInventory` — batch update via `/{catalogId}/items_batch` POST with `method: "UPDATE"` per SKU; sets `availability` + `inventory` count
- `testConnection` — calls `/me?fields=id,name`; never throws, returns `{ success, name/error }`

---

## `whatsapp-client.js`

**Not a marketplace** — extends `BaseMarketplace` but `syncProducts`, `pullOrders`, `pushInventory` are **silent no-ops** (return `[]`/`{ updated: 0 }`). The real interface is messaging-only:

- Auth: `Authorization: Bearer api_key` header. Graph API version `v19.0` (hardcoded).
- `testConnection()` — fetches `/{phoneNumberId}?fields=verified_name,display_phone_number`; throws if `phone_number_id` not configured
- `sendTemplate(to, templateName, languageCode, components)` — sends a pre-approved WhatsApp template message
- `sendTextMessage(to, text)` — free-form text (only valid within 24h customer-initiated window)
- `sendOrderConfirmation(to, order)` — calls `sendTemplate` with `"order_confirmation"` template; params: order ID + `"PKR {total}"`
- `sendTrackingUpdate(to, trackingNumber, courierName)` — calls `sendTemplate` with `"shipping_update"` template

All send methods require `config_json.phone_number_id` — throw if missing.

---

## `google-merchant.js`

- Auth: `Authorization: Bearer oauth_token` header. Base URL: `https://shoppingcontent.googleapis.com/content/v2.1`.
- All operations require `config_json.merchant_id` (throws if missing, except `testConnection` which returns `{ success: false }`).
- `syncProducts(products)` — per-product POST to `/{merchantId}/products`. Hardcoded: `targetCountry: "PK"`, `currency: "PKR"`, `contentLanguage: "en"`, `condition: "new"`, `channel: "online"`.
- `pushInventory(updates)` — **upsert via POST** (not PATCH) — re-sends minimal product payload with updated `availability` field. Per-update errors are silently swallowed.
- **`checkFeedStatus()`** — extra method not on base class; called by the 6-hour marketplace-feed-check worker. Fetches up to 250 product statuses (`maxResults=250`), returns `[{ offer_id, title, status, disapproval_issues[] }]`. Each disapproval issue has `{ code, description, detail, resolution }`.
- `pullOrders()` — **always returns `[]`** (Google Merchant sends traffic to your site, doesn't process orders)

---

## Error handling (actual behavior)

- `DarazClient.syncProducts` / `MetaCommerceClient.syncProducts` — per-item try/catch, accumulates `{ product_id, success: false, error }` in results array. Caller sees partial failures.
- `GoogleMerchantClient.pushInventory` — per-item errors silently swallowed; always returns `{ updated: updates.length }` even if all updates failed.
- No client writes directly to `external_sync_events` — that's handled at a higher layer in the route/worker.
- `testConnection()` on all clients never throws — always returns `{ success: bool, error?: string }`.
