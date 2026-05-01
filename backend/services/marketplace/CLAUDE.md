# Marketplace Clients — Claude Guide

## Overview

Five files — abstract base class plus four platform adapters for the Integrations Hub (`routes/integrations/`). Gated by the `marketplace_integrations` feature flag per tenant. Credentials live in `integration_settings`, encrypted via `services/crypto.js` (AES-256-GCM). The background worker is `workers/marketplace-sync-worker-boss.js` (`MARKETPLACE_SYNC_WORKER_ENABLED=1`): `marketplace-order-poll` every 10 minutes, `marketplace-feed-check` every 6 hours (Google only). Both worker handlers are currently stubs — they find tenants/integrations and log placeholder messages but do NOT call `DarazClient.pullOrders()`, `MetaCommerceClient.pullOrders()`, or `GoogleMerchantClient.checkFeedStatus()`. Inbound webhooks hit `/api/webhooks/{daraz,meta,whatsapp}` — mounted before tenant middleware. Only `POST /api/webhooks/xpay` is HMAC-verified; Meta and WhatsApp GET handlers check verify tokens, but the Meta, WhatsApp, and Daraz POST handlers in `routes/webhooks.js` are NOT HMAC-verified.

---

## Base class — `base-marketplace.js`

```js
class BaseMarketplace {
  constructor(config) { this.config = config; }
  async testConnection()           // must override — throw "Not implemented"
  async syncProducts(products)     // must override — throw "Not implemented"
  async pullOrders(since)          // must override — throw "Not implemented"
  async pushInventory(updates)     // must override — throw "Not implemented"
}
```

All four methods are abstract — calling them on the base class throws. Every adapter must override all four or explicitly stub the ones that don't apply.

---

## Config shape

All adapters receive a single `config` object from `integration_settings`. Fields used:

| Adapter | `config.api_key` | `config.api_secret` | `config.oauth_token` | `config.store_url` | `config.config_json` fields |
|---------|-----------------|--------------------|--------------------|-------------------|-----------------------------|
| `DarazClient` | Lazada app key | app secret | access token (optional) | base URL (default `https://api.daraz.pk/rest`) | — |
| `MetaCommerceClient` | — | — | page access token | — | `catalog_id`, `commerce_account_id` |
| `WhatsAppClient` | Bearer access token | — | — | — | `phone_number_id`, `business_account_id` |
| `GoogleMerchantClient` | — | — | OAuth bearer token | — | `merchant_id` |

---

## `daraz-client.js` — Daraz Seller Center (Lazada Open Platform)

**Auth pattern — HMAC-SHA256 per request**

Every call goes through `_sign(apiPath, params)`:
1. Sort all param keys alphabetically
2. Concatenate as `key1value1key2value2...`
3. Prepend `apiPath`
4. `HMAC-SHA256(appSecret, result).toUpperCase()` → append as `sign`

Common params added automatically: `app_key`, `timestamp` (ms epoch), `sign_method: "sha256"`, `access_token` (empty string if not set).

**Methods**

- `testConnection()` — `GET /seller/get`; returns `{ success, seller: name }`; never throws
- `pullOrders(since)` — defaults to last 24 hours; fetches `/orders/get` (limit 100, offset 0, sort ASC), then makes **one extra API call per order** to `/order/items/get`. **N+1 pattern**: 100 orders = 101 HTTP calls per poll cycle.
- `syncProducts(products)` — POST to `/product/create` per product using Lazada XML-in-JSON nested format (`Request.Product.Skus.Sku[]`, `Request.Product.Attributes`). Per-product errors are caught; returns `[{ product_id, success, daraz_item_id }]`.
- `pushInventory(updates)` — single batch call to `/product/stock/sellable/update` with `Request.Product.Skus.Sku[]` of `{ SellerSku, Quantity }` entries.

**SKU fallback**: `syncProducts()` uses `product.sku || product.barcode || "SP-${product.id}"` as the Daraz seller SKU. `pushInventory()` only sends the SKU values supplied by its caller; the Daraz route (`routes/integrations/daraz.js`) filters to `daraz_sku IS NOT NULL` before calling `pushInventory` — there is no broad client-side fallback in the inventory push path.

**Order shape returned by `pullOrders`**:
```js
{
  external_order_id,       // String(order.order_id)
  external_order_number,
  status,                  // first element of order.statuses[]
  customer: { name, phone, address, city },
  items: [{ sku, name, quantity, price, daraz_item_id }],
  total,
  payment_method,
  created_at,
}
```

---

## `meta-commerce.js` — Facebook/Instagram Commerce

**Auth pattern** — `access_token` appended as query param to every request URL. Graph API version: `v19.0` (hardcoded in `baseUrl`).

**Constructor fields from config**:
- `config.oauth_token` → `this.accessToken`
- `config.config_json.catalog_id` → `this.catalogId`
- `config.config_json.commerce_account_id` → `this.commerceAccountId`

**Methods**

- `testConnection()` — `GET /me?fields=id,name`; never throws; returns `{ success, name/error }`
- `syncProducts(products)` — throws if `catalogId` missing. POST to `/{catalogId}/products` per product. Price format: `"${Math.round(price * 100)} PKR"` (integer cents as string). Per-product errors caught; returns `[{ product_id, success, fb_product_id }]`.
- `pullOrders(since)` — throws if `commerceAccountId` missing. Only fetches orders in **`FB_PROCESSING` state** (hardcoded). Price normalization: `price_per_unit.amount` is in **cents** — divided by 100 on ingest. Source detection: `channel === "INSTAGRAM"` → `source: "instagram"`, else `source: "facebook"`.
- `pushInventory(updates)` — batch POST to `/{catalogId}/items_batch` with `method: "UPDATE"` per SKU, setting `availability` ("in stock"/"out of stock") and `inventory` count. Throws if `catalogId` missing.

**Order shape returned by `pullOrders`**:
```js
{
  external_order_id,       // order.id
  external_order_number,   // same as order.id
  status,                  // order.order_status.state
  source,                  // "instagram" or "facebook"
  items: [{ name, quantity, price, sku, fb_item_id }],
  total,                   // computed from items
  created_at,
}
```

---

## `whatsapp-client.js` — WhatsApp Business Cloud API

**Not a marketplace**. Extends `BaseMarketplace` but `syncProducts`, `pullOrders`, and `pushInventory` are **silent no-ops** returning `[]`, `[]`, and `{ updated: 0 }` respectively. The real API is messaging-only.

**Auth pattern** — `Authorization: Bearer api_key` header. Graph API version: `v19.0` (hardcoded).

**Constructor fields from config**:
- `config.api_key` → `this.accessToken` (note: uses `api_key`, not `oauth_token`)
- `config.config_json.phone_number_id` → `this.phoneNumberId`
- `config.config_json.business_account_id` → `this.businessAccountId`

All send methods throw if `phoneNumberId` is not set.

**Methods**

- `testConnection()` — `GET /{phoneNumberId}?fields=verified_name,display_phone_number`; returns `{ success, phone, name/error }`; never throws
- `sendTemplate(to, templateName, languageCode = "en", components = [])` — sends a pre-approved template message via `POST /{phoneNumberId}/messages`
- `sendTextMessage(to, text)` — free-form text message (only valid within 24h customer-initiated window per Meta policy)
- `sendOrderConfirmation(to, order)` — calls `sendTemplate` with template name `"order_confirmation"`, body params: `[order.id, "PKR {total}"]`
- `sendTrackingUpdate(to, trackingNumber, courierName)` — calls `sendTemplate` with template name `"shipping_update"`, body params: `[trackingNumber, courierName]`

The template names `"order_confirmation"` and `"shipping_update"` must be pre-approved in the Meta Business Manager for the tenant's WhatsApp account.

---

## `google-merchant.js` — Google Merchant Center Content API

**Auth pattern** — `Authorization: Bearer oauth_token` header. Base URL: `https://shoppingcontent.googleapis.com/content/v2.1`.

**Constructor fields from config**:
- `config.oauth_token` → `this.accessToken`
- `config.config_json.merchant_id` → `this.merchantId`

All methods except `testConnection` throw if `merchantId` is missing. `testConnection` returns `{ success: false, error }` instead of throwing.

**Methods**

- `testConnection()` — `GET /{merchantId}/accounts/{merchantId}`; returns `{ success, name/error }`; never throws
- `syncProducts(products)` — POST to `/{merchantId}/products` per product. Hardcoded values: `targetCountry: "PK"`, `currency: "PKR"`, `contentLanguage: "en"`, `condition: "new"`, `channel: "online"`. Returns `[{ product_id, success, gmc_offer_id }]`.
- `pushInventory(updates)` — **upsert via POST** (not PATCH) — resends a minimal product payload with only `offerId`, `availability`, `channel`, `contentLanguage`, `targetCountry`. Per-update errors are **silently swallowed**; always returns `{ updated: updates.length }` even if all updates fail.
- `pullOrders()` — **always returns `[]`**. Google Merchant sends traffic to your site; it does not process orders.
- `checkFeedStatus()` — **extra method, not on base class**. Called by the 6-hour `marketplace-feed-check` worker. Fetches `/{merchantId}/productstatuses?maxResults=250`. Returns:
  ```js
  [{ offer_id, title, status, disapproval_issues: [{ code, description, detail, resolution }] }]
  ```

---

## Error handling

| Adapter | `syncProducts` errors | `pushInventory` errors | `testConnection` throws? |
|---------|-----------------------|-----------------------|--------------------------|
| Daraz | Per-item catch → `{ success: false, error }` in results | Single call; throws on failure | Never — returns `{ success: false }` |
| Meta | Per-item catch → `{ success: false, error }` in results | Throws on missing `catalogId` or API error | Never |
| WhatsApp | No-op stub | No-op stub | Never |
| Google Merchant | Per-item catch → `{ success: false, error }` in results | Per-item errors silently swallowed | Never |

No adapter writes directly to `external_sync_events` — that is handled at the route/worker layer.

---

## Adding a new marketplace adapter

1. Create `services/marketplace/<name>-client.js` extending `BaseMarketplace`
2. Implement all four base methods (`testConnection`, `syncProducts`, `pullOrders`, `pushInventory`); stub any that don't apply as silent no-ops
3. Add extra methods (e.g. `checkFeedStatus`) if the platform has non-standard polling needs
4. Register the new route in `routes/integrations/index.js` (not `hub.js`); `hub.js` only needs changes for special hub display behavior — it reads rows from `integration_settings` generically and does not require per-adapter registration
5. Add a webhook handler in `routes/webhooks.js` if the platform sends push events
6. Extend `workers/marketplace-sync-worker-boss.js` to include the new platform in poll/feed-check loops
7. Gate all routes with `requireFeature('marketplace_integrations')`
8. Store credentials in `integration_settings` via `services/crypto.js` — never raw in DB

**Config convention**: primary auth token goes in `oauth_token` (for OAuth flows) or `api_key` (for static keys). Extra IDs (catalog, merchant, phone number) go in `config_json`. Note: the Zod schema in `backend/schemas/integrations.js` validates `config_json` as a string (matching the TEXT DB column), not as a JSON object — serialise/parse at the route layer. Only `api_key`, `api_secret`, `oauth_token`, and `oauth_refresh_token` are encrypted by `credentials.js`; `config_json` is stored as raw text.
