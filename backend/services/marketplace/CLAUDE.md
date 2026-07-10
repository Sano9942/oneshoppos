# Marketplace Clients — Claude Guide

Abstract base class plus platform adapters for two distinct pipelines that share this directory:

1. **Integrations Hub** (`routes/integrations/`) — Daraz, Meta Commerce, WhatsApp, Google Merchant. Gated by the `marketplace_integrations` feature flag. Credentials live in `integration_settings`, encrypted via `services/crypto.js` (AES-256-GCM). Outbound sync is **manual, triggered from the UI** — `workers/marketplace-sync-worker-boss.js` schedules no cron; it unschedules legacy polling crons on boot and reports `mode: "manual"`. Inbound webhooks (`POST /api/webhooks/{daraz,meta,whatsapp}`, mounted before tenant middleware) resolve the tenant by scanning active tenants for a matching `integration_settings` account id, then upsert `web_orders` (Daraz/Meta) or write the messaging inbox (WhatsApp). **Not signature-verified** — only `POST /api/webhooks/xpay` is HMAC-verified anywhere in the codebase; these POST handlers trust the payload (rate-limited only).

2. **Delivery aggregators** (`services/aggregator-orders.js`) — foodpanda, Careem. A separate, **signature-verified, fail-closed** webhook pipeline (`routes/webhooks.js` → `resolveTenantForStore()` → `normalizeOrder()` → `ingestOrder()` → auto-accept → `settleAggregatorSale()`). These two clients are consumed almost entirely for their `static normalizeOrder(payload)` method, not their instance methods — see below.

Do not conflate the two: Daraz/Meta/Google/WhatsApp sync outbound catalog+inventory and pull orders on demand; foodpanda/Careem push orders in via a dedicated verified webhook and the client's instance methods are honest stubs (real menu/availability APIs are rarely provisioned for PK vendors).

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

Every adapter overrides all four, or explicitly stubs the ones that don't apply (WhatsApp, and — deliberately — foodpanda/Careem when no live menu API is provisioned).

---

## Config shape (Integrations Hub adapters)

All four Hub adapters take one `config` object sourced from `integration_settings`:

| Adapter | `config.api_key` | `config.api_secret` | `config.oauth_token` | `config.store_url` | `config.config_json` |
|---|---|---|---|---|---|
| `DarazClient` | Lazada app key | app secret | access token (optional) | base URL (default `https://api.daraz.pk/rest`) | — |
| `MetaCommerceClient` | — | — | page access token | — | `catalog_id`, `commerce_account_id` |
| `WhatsAppClient` | Bearer token (note: `api_key`, not `oauth_token`) | — | — | — | `phone_number_id`, `business_account_id` |
| `GoogleMerchantClient` | — | — | OAuth bearer token | — | `merchant_id` |

Only `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token` are encrypted (via `services/crypto.js` / `routes/integrations/credentials.js`); `config_json` is stored as raw text — parse/serialize at the route layer, not in adapters.

Careem/foodpanda have a different, hand-rolled config (see their section) since they're driven by webhook + optional provisioned menu API, not OAuth.

---

## `daraz-client.js` — Daraz Seller Center (Lazada Open Platform)

**Auth — HMAC-SHA256 per request**, via `_sign(apiPath, params)`: sort param keys alphabetically → concatenate `key1value1key2value2...` → prepend `apiPath` → `HMAC-SHA256(appSecret, result).toUpperCase()`. Common params auto-added: `app_key`, `timestamp` (ms epoch), `sign_method: "sha256"`, `access_token` (empty string if unset).

- `testConnection()` — `GET /seller/get`; never throws
- `pullOrders(since)` — defaults to last 24h; `/orders/get` (limit 100, ASC), then **one extra call per order** to `/order/items/get`. N+1: 100 orders = 101 HTTP calls per poll.
- `syncProducts(products)` — POST `/product/create` per product, Lazada's nested `Request.Product.Skus.Sku[]` / `Request.Product.Attributes` shape. Per-item errors caught individually.
- `pushInventory(updates)` — single batch call to `/product/stock/sellable/update`.

**SKU fallback**: `syncProducts()` uses `product.sku || product.barcode || "SP-${id}"`. `pushInventory()` only sends whatever SKUs the caller supplies — `routes/integrations/daraz.js` pre-filters to rows with `daraz_sku IS NOT NULL` before calling it.

**Order shape**: `{ external_order_id, external_order_number, status, customer: { name, phone, address, city }, items: [{ sku, name, quantity, price, daraz_item_id }], total, payment_method, created_at }`

---

## `meta-commerce.js` — Facebook/Instagram Commerce

**Auth** — `access_token` appended as a query param on every request. Graph API `v19.0` hardcoded.

- `testConnection()` — `GET /me?fields=id,name`; never throws
- `syncProducts(products)` — throws if no `catalogId`. Price format: integer cents as string, `"${Math.round(price*100)} PKR"`.
- `pullOrders(since)` — throws if no `commerceAccountId`. Only fetches `FB_PROCESSING` state orders (hardcoded). `price_per_unit.amount` is in cents — divided by 100 on ingest. `source`: `"instagram"` if `channel === "INSTAGRAM"`, else `"facebook"`.
- `pushInventory(updates)` — batch POST `/{catalogId}/items_batch`, `method: "UPDATE"` per SKU.

**Order shape**: `{ external_order_id, external_order_number, status, source, items: [{ name, quantity, price, sku, fb_item_id }], total, created_at }`

---

## `whatsapp-client.js` — WhatsApp Business Cloud API

Not a marketplace. `syncProducts`/`pullOrders`/`pushInventory` are silent no-ops → `[]`, `[]`, `{ updated: 0 }`. Real surface is messaging.

**Auth** — `Authorization: Bearer <api_key>` (uses `config.api_key`, NOT `oauth_token` — inconsistent with the other three adapters). Graph API `v19.0` hardcoded. All send methods throw if `phoneNumberId` unset.

- `testConnection()` — `GET /{phoneNumberId}?fields=verified_name,display_phone_number`; never throws
- `sendTemplate(to, templateName, languageCode="en", components=[])` — pre-approved template send
- `sendTextMessage(to, text)` — free-form text, valid only within Meta's 24h customer-initiated window
- `sendOrderConfirmation(to, order)` — template `"order_confirmation"`
- `sendTrackingUpdate(to, trackingNumber, courierName)` — template `"shipping_update"`

Template names must be pre-approved in Meta Business Manager for the tenant's WABA, or sends fail.

---

## `google-merchant.js` — Google Merchant Center Content API

**Auth** — `Authorization: Bearer <oauth_token>`. Base URL `https://shoppingcontent.googleapis.com/content/v2.1`. Every method except `testConnection` throws if `merchantId` missing; `testConnection` returns `{ success: false, error }` instead of throwing.

- `testConnection()` — `GET /{merchantId}/accounts/{merchantId}`; never throws
- `syncProducts(products)` — POST per item. Hardcoded `targetCountry: "PK"`, `currency: "PKR"`, `contentLanguage: "en"`, `condition: "new"`, `channel: "online"`.
- `pushInventory(updates)` — upsert via POST (not PATCH). Per-item errors are **silently swallowed** — always returns `{ updated: updates.length }` regardless of actual success. Don't trust the return value for error detection.
- `pullOrders()` — always `[]` (Google drives traffic to your site, doesn't process orders).
- `checkFeedStatus()` — extra method, not on the base class, called by the 6h worker job. Returns `[{ offer_id, title, status, disapproval_issues: [{ code, description, detail, resolution }] }]`.

---

## `foodpanda-client.js` / `careem-client.js` — delivery aggregators (order-push, not catalog sync)

Structurally different from the four Hub adapters above: these are **webhook-first**. The platform POSTs each new order to our webhook; the client's `static normalizeOrder(payload)` is the real workhorse, converting the platform's payload into the internal `web_order` shape consumed by `services/aggregator-orders.js`. The instance methods (`testConnection`/`pullOrders`/`pushInventory`/`syncProducts`) are the outbound half and are deliberately honest about what's NOT available rather than faking success ("STUB-HONEST" — a full menu/availability API is partner-provisioned and PK tenants rarely have it).

**Config** (from `integration_settings`, `provider='foodpanda'|'careem'`): `api_key` (POS API bearer, encrypted), `webhook_secret` (HMAC secret the platform signs callbacks with, encrypted), `config_json: { store_id | vendor_code/branch_id, base_url?, menu_api?/api_provisioned? }`.

**Price rule (both clients)**: `normalizeOrder` takes price fields **from the payload**, never re-resolving the local product price. Aggregator menus commonly carry a markup — re-resolving would break reconciliation against the platform's payout.

**`testConnection()` modes** (both clients return one of these rather than a flat true/false):
- No `store_id`/`webhook_secret` configured → `{ success: false, mode: "manual" }` (Careem) or plain failure (foodpanda) — orders entered by hand
- `store_id` + `webhook_secret` set, no live menu API → `{ success: true, mode: "webhook_only" }` — inbound orders work, outbound availability push does not
- Menu API actually provisioned and reachable → `{ success: true, mode: "webhook+api" }` / `"webhook+menu_api"`

**`pullOrders`/`pushInventory`/`syncProducts`** — return empty/no-op results (`[]`, `{ updated: 0, skipped: n, reason: "no_menu_api" }`) whenever no menu API is provisioned, rather than fabricating success. `pullOrders` is a polling *fallback* only (webhook push is primary, retried by the platform on failure).

**`normalizeOrder(payload)` (static)** — defensive field aliasing across the platform's known payload variants; throws `{ code: "malformed_payload" }` if no order id can be resolved (caller dead-letters it). Returns:
```js
{ source, external_order_id, external_order_number, store_id, currency,
  subtotal, tax_total, discount_total, grand_total, ordered_at, expedition_type,
  customer: { name, phone },
  items: [{ sku, title, qty, unit_price, line_total, notes }] }
```

**Pipeline this feeds** (`services/aggregator-orders.js`): webhook (signature-VERIFIED, fail-closed, unlike the four Hub webhooks above) → `resolveTenantForStore()` → `normalizeOrder()` → `ingestOrder()` (idempotent on `source`+external id) → auto-accept → `online-inbox.acceptOnlineOrder()` (draft order + KDS ticket) → `settleAggregatorSale()`. `settleAggregatorSale` is a dedicated sales writer (not the pay-at-table settle path) because it must decrement stock + fire the kit-engine recipe consistently with POS; decrements here are **unconditional** (can go negative) since the order is already placed/paid on the platform and can't be rolled back.

---

## Error handling summary

| Adapter | `syncProducts` errors | `pushInventory` errors | `testConnection` throws? |
|---|---|---|---|
| Daraz | per-item catch → `{ success:false, error }` | single call; throws | never |
| Meta | per-item catch | throws on missing `catalogId` or API error | never |
| WhatsApp | no-op stub | no-op stub | never |
| Google Merchant | per-item catch | silently swallowed, still returns `{ updated: N }` | never |
| foodpanda / Careem | no-op (`[]`) — menu authored on platform's partner portal, out of scope | honest no-op when no menu API (`{ updated: 0, skipped, reason }`) | never (returns a `mode` field instead) |

No adapter writes to `external_sync_events`/`web_orders` directly — that happens at the route/service layer (`routes/integrations/*` for Hub adapters, `services/aggregator-orders.js` for foodpanda/Careem).

---

## Adding a new marketplace adapter

**Catalog-sync style (Daraz/Meta/Google pattern)**:
1. Create `services/marketplace/<name>-client.js` extending `BaseMarketplace`, implement all four base methods (stub any that don't apply as silent no-ops).
2. Register the route in `routes/integrations/index.js` — `hub.js` reads `integration_settings` generically, no per-adapter hub changes needed.
3. Sync stays manual (Integrations Hub UI) — `workers/marketplace-sync-worker-boss.js` has no cron to extend.
4. Gate routes with `requireFeature('marketplace_integrations')`. Store credentials via `services/crypto.js`.
5. Config convention: primary auth in `oauth_token` (OAuth) or `api_key` (static keys); secondary IDs in `config_json`.

**Order-push style (foodpanda/Careem pattern)** — for a new delivery aggregator:
1. Create the client with a `static normalizeOrder(payload)` and STUB-HONEST instance methods (see foodpanda/Careem section).
2. Add it to `AGGREGATOR_SOURCES` / `ADAPTERS` / `SIGNATURE_HEADERS` / `TIMESTAMP_HEADERS` in `services/aggregator-orders.js`.
3. Wire the signature-verified webhook route in `routes/webhooks.js` (fail-closed, unlike the Hub webhooks).
4. Never re-resolve local product price in `normalizeOrder` — take it from the payload.
