# Marketplace Clients — Claude Guide

Abstract base class plus platform adapters for the Integrations Hub (`routes/integrations/`). Gated by the `marketplace_integrations` feature flag per tenant. Credentials live in `integration_settings`, encrypted via `services/crypto.js` (AES-256-GCM). Background sync: `workers/marketplace-sync-worker-boss.js` (`MARKETPLACE_SYNC_WORKER_ENABLED=1`) is **MANUAL-ONLY — it schedules no cron**. It unschedules the legacy `marketplace-order-poll`/`marketplace-feed-check` crons on boot and reports `mode: "manual"`; outbound sync (pull orders / sync products / feed check) runs only when a tenant triggers it from the Integrations Hub. Inbound webhooks (`POST /api/webhooks/{daraz,meta,whatsapp}`, mounted before tenant middleware) **are wired** as of WS3: they resolve the tenant (scan active tenants, match the payload's account id against the provider's active `integration_settings`), then Daraz/Meta upsert `web_orders` (+ `daraz_order_map`/`facebook_order_map`) and WhatsApp writes the tenant messaging inbox. They are still **not signature-verified** — only `POST /api/webhooks/xpay` is HMAC-verified; Meta/WhatsApp GET handlers check verify tokens, but the Meta/WhatsApp/Daraz POST handlers trust the payload (rate-limited only).

---

## Base class — `base-marketplace.js`

```js
class BaseMarketplace {
  constructor(config) { this.config = config; }
  async testConnection()        // throws "Not implemented"
  async syncProducts(products)  // throws "Not implemented"
  async pullOrders(since)       // throws "Not implemented"
  async pushInventory(updates)  // throws "Not implemented"
}
```

Every adapter must override all four or explicitly stub the ones that don't apply (see WhatsApp).

---

## Config shape

All adapters receive one `config` object sourced from `integration_settings`:

| Adapter | `config.api_key` | `config.api_secret` | `config.oauth_token` | `config.store_url` | `config.config_json` |
|---|---|---|---|---|---|
| `DarazClient` | Lazada app key | app secret | access token (optional) | base URL (default `https://api.daraz.pk/rest`) | — |
| `MetaCommerceClient` | — | — | page access token | — | `catalog_id`, `commerce_account_id` |
| `WhatsAppClient` | Bearer token (note: `api_key`, not `oauth_token`) | — | — | — | `phone_number_id`, `business_account_id` |
| `GoogleMerchantClient` | — | — | OAuth bearer token | — | `merchant_id` |

Only `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token` are encrypted (via `services/crypto.js` / `credentials.js`); `config_json` is stored as raw text. The Zod schema in `schemas/integrations.js` validates `config_json` as a string, matching the TEXT column — serialize/parse at the route layer, not in adapters.

---

## `daraz-client.js` — Daraz Seller Center (Lazada Open Platform)

**Auth — HMAC-SHA256 per request**, via `_sign(apiPath, params)`:
1. Sort param keys alphabetically, concatenate as `key1value1key2value2...`
2. Prepend `apiPath`
3. `HMAC-SHA256(appSecret, result).toUpperCase()` → `sign`

Common params auto-added: `app_key`, `timestamp` (ms epoch), `sign_method: "sha256"`, `access_token` (empty string if unset).

**Methods**
- `testConnection()` — `GET /seller/get`; never throws, returns `{ success, seller }`
- `pullOrders(since)` — defaults to last 24h; `/orders/get` (limit 100, offset 0, ASC), then **one extra call per order** to `/order/items/get`. N+1: 100 orders = 101 HTTP calls per poll.
- `syncProducts(products)` — POST `/product/create` per product, Lazada's nested XML-in-JSON shape (`Request.Product.Skus.Sku[]`, `Request.Product.Attributes`). Per-item errors caught → `[{ product_id, success, daraz_item_id }]`.
- `pushInventory(updates)` — single batch call to `/product/stock/sellable/update`, `Request.Product.Skus.Sku[]` of `{ SellerSku, Quantity }`.

**SKU fallback**: `syncProducts()` uses `product.sku || product.barcode || "SP-${product.id}"`. `pushInventory()` only sends whatever SKUs the caller supplies — `routes/integrations/daraz.js` pre-filters to rows with `daraz_sku IS NOT NULL` (`daraz_product_map.daraz_sku || products.sku`) before calling it. No broad fallback inside the push path itself.

**Order shape from `pullOrders`**:
```js
{ external_order_id, external_order_number, status, customer: { name, phone, address, city },
  items: [{ sku, name, quantity, price, daraz_item_id }], total, payment_method, created_at }
```

---

## `meta-commerce.js` — Facebook/Instagram Commerce

**Auth** — `access_token` appended as a query param on every request. Graph API `v19.0` hardcoded in `baseUrl`.

**Constructor**: `config.oauth_token` → `accessToken`; `config.config_json.catalog_id` → `catalogId`; `config.config_json.commerce_account_id` → `commerceAccountId`.

**Methods**
- `testConnection()` — `GET /me?fields=id,name`; never throws
- `syncProducts(products)` — throws if no `catalogId`. POST `/{catalogId}/products` per item. Price format: integer cents as string, `"${Math.round(price*100)} PKR"`. Per-item errors caught → `[{ product_id, success, fb_product_id }]`.
- `pullOrders(since)` — throws if no `commerceAccountId`. Only fetches `FB_PROCESSING` state orders (hardcoded). `price_per_unit.amount` is in cents — divided by 100 on ingest. Source: `channel === "INSTAGRAM"` → `"instagram"`, else `"facebook"`.
- `pushInventory(updates)` — batch POST `/{catalogId}/items_batch`, `method: "UPDATE"` per SKU with `availability` + `inventory`. Throws if no `catalogId`.

**Order shape from `pullOrders`**:
```js
{ external_order_id, external_order_number, status, source,
  items: [{ name, quantity, price, sku, fb_item_id }], total, created_at }
```

---

## `whatsapp-client.js` — WhatsApp Business Cloud API

Not a marketplace. `syncProducts`/`pullOrders`/`pushInventory` are silent no-ops → `[]`, `[]`, `{ updated: 0 }`. Real surface is messaging only.

**Auth** — `Authorization: Bearer <api_key>` (uses `config.api_key`, not `oauth_token`). Graph API `v19.0` hardcoded.

**Constructor**: `config.api_key` → `accessToken`; `config.config_json.phone_number_id` → `phoneNumberId`; `config.config_json.business_account_id` → `businessAccountId`. All send methods throw if `phoneNumberId` unset.

**Methods**
- `testConnection()` — `GET /{phoneNumberId}?fields=verified_name,display_phone_number`; never throws
- `sendTemplate(to, templateName, languageCode="en", components=[])` — pre-approved template via `POST /{phoneNumberId}/messages`
- `sendTextMessage(to, text)` — free-form text; valid only within Meta's 24h customer-initiated window
- `sendOrderConfirmation(to, order)` — template `"order_confirmation"`, body params `[order.id, "PKR {total}"]`
- `sendTrackingUpdate(to, trackingNumber, courierName)` — template `"shipping_update"`, body params `[trackingNumber, courierName]`

Template names `order_confirmation` and `shipping_update` must be pre-approved in Meta Business Manager for the tenant's WhatsApp account, or sends fail.

---

## `google-merchant.js` — Google Merchant Center Content API

**Auth** — `Authorization: Bearer <oauth_token>`. Base URL `https://shoppingcontent.googleapis.com/content/v2.1`.

**Constructor**: `config.oauth_token` → `accessToken`; `config.config_json.merchant_id` → `merchantId`. Every method except `testConnection` throws if `merchantId` missing; `testConnection` returns `{ success: false, error }` instead.

**Methods**
- `testConnection()` — `GET /{merchantId}/accounts/{merchantId}`; never throws
- `syncProducts(products)` — POST `/{merchantId}/products` per item. Hardcoded: `targetCountry: "PK"`, `currency: "PKR"`, `contentLanguage: "en"`, `condition: "new"`, `channel: "online"`. → `[{ product_id, success, gmc_offer_id }]`.
- `pushInventory(updates)` — **upsert via POST** (not PATCH), minimal payload (`offerId`, `availability`, `channel`, `contentLanguage`, `targetCountry`). Per-item errors are **silently swallowed** — always returns `{ updated: updates.length }` regardless of actual success.
- `pullOrders()` — always `[]`. Google Merchant drives traffic to your site; it doesn't process orders.
- `checkFeedStatus()` — extra method, not on the base class. Called by the 6h worker job. `GET /{merchantId}/productstatuses?maxResults=250` →
  ```js
  [{ offer_id, title, status, disapproval_issues: [{ code, description, detail, resolution }] }]
  ```

---

## Error handling summary

| Adapter | `syncProducts` errors | `pushInventory` errors | `testConnection` throws? |
|---|---|---|---|
| Daraz | per-item catch → `{ success:false, error }` | single call; throws | never |
| Meta | per-item catch | throws on missing `catalogId` or API error | never |
| WhatsApp | no-op stub | no-op stub | never |
| Google Merchant | per-item catch | silently swallowed, still returns `{ updated: N }` | never |

No adapter writes to `external_sync_events` directly — that happens at the route/worker layer.

---

## Adding a new marketplace adapter

1. Create `services/marketplace/<name>-client.js` extending `BaseMarketplace`.
2. Implement all four base methods; stub any that don't apply as silent no-ops (WhatsApp pattern).
3. Add extra methods (e.g. `checkFeedStatus`) for non-standard polling needs.
4. Register the route in `routes/integrations/index.js` — `hub.js` reads `integration_settings` generically and needs no per-adapter changes.
5. Add a webhook handler in `routes/webhooks.js` if the platform pushes events (verify HMAC/signature if the platform supports it — most current handlers don't).
6. Sync is manual (Integrations Hub) — `workers/marketplace-sync-worker-boss.js` schedules no cron, so there's no poll loop to extend. If the platform pushes, wire the inbound handler in `routes/webhooks.js` (step 5) instead.
7. Gate all routes with `requireFeature('marketplace_integrations')`.
8. Store credentials via `services/crypto.js` — never raw in DB.

**Config convention**: primary auth goes in `oauth_token` (OAuth flows) or `api_key` (static keys). Secondary IDs (catalog/merchant/phone number) go in `config_json`.
