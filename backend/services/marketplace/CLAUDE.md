# Marketplace Clients — Claude Guide

This directory holds one abstract base class plus platform adapters split across two structurally different pipelines that happen to share a folder:

1. **Integrations Hub** (`daraz-client.js`, `meta-commerce.js`, `whatsapp-client.js`, `google-merchant.js`) — catalog sync + order pull for `routes/integrations/`, gated by the `marketplace_integrations` feature flag. Credentials live in `integration_settings`, encrypted via `services/crypto.js`. Outbound sync is manual, UI-triggered — `workers/marketplace-sync-worker-boss.js` schedules no cron for these adapters. Inbound webhooks (`POST /api/webhooks/{daraz,meta,whatsapp}`, mounted before tenant middleware) resolve the tenant by scanning active tenants for a matching `integration_settings` account id, then upsert `web_orders` (Daraz/Meta) or the messaging inbox (WhatsApp). **Not signature-verified** — of every webhook in the codebase, only `POST /api/webhooks/xpay` is HMAC-verified; these trust the payload (rate-limited only).

2. **Delivery aggregators** (`foodpanda-client.js`, `careem-client.js`) — order-push webhooks for `services/aggregator-orders.js`. This pipeline IS signature-verified and fail-closed (`routes/webhooks.js` → `resolveTenantForStore()` → `normalizeOrder()` → `ingestOrder()` → auto-accept → `settleAggregatorSale()`). These two clients are consumed almost entirely for their `static normalizeOrder(payload)` method — their instance methods are honest stubs, not real integrations.

Don't conflate the two: Daraz/Meta/Google/WhatsApp sync outbound catalog+inventory and pull orders on demand; foodpanda/Careem push orders in via a verified webhook, and their client instance methods report their real (usually absent) automation capability rather than faking success.

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

Every adapter overrides all four, or explicitly stubs the ones that don't apply (WhatsApp is not a marketplace at all; foodpanda/Careem stub whichever outbound capability isn't provisioned for that tenant).

---

## Config shape (Integrations Hub adapters)

All four Hub adapters read one `config` object sourced from an `integration_settings` row:

| Adapter | `config.api_key` | `config.api_secret` | `config.oauth_token` | `config.store_url` | `config.config_json` |
|---|---|---|---|---|---|
| `DarazClient` | Lazada app key | app secret | access token (optional) | base URL, default `https://api.daraz.pk/rest` | — |
| `MetaCommerceClient` | — | — | page access token | — | `catalog_id`, `commerce_account_id` |
| `WhatsAppClient` | bearer token (note: uses `api_key`, NOT `oauth_token` — inconsistent with the other three) | — | — | — | `phone_number_id`, `business_account_id` |
| `GoogleMerchantClient` | — | — | OAuth bearer token | — | `merchant_id` |

Only `api_key`/`api_secret`/`oauth_token` are encrypted (`services/crypto.js`, applied at the route layer). `config_json` is stored as raw text and parsed at the route layer, not inside the adapter constructor.

Careem/foodpanda have a different, hand-rolled config shape (see their section below) since they're driven by webhook + an optional provisioned menu API, not OAuth.

---

## `daraz-client.js` — Daraz Seller Center (Lazada Open Platform)

**Auth**: HMAC-SHA256 per request via `_sign(apiPath, params)` — sort param keys alphabetically, concatenate `key1value1key2value2...`, prepend `apiPath`, then `HMAC-SHA256(appSecret, result).toUpperCase()`. Common params auto-injected on every call: `app_key`, `timestamp` (ms epoch), `sign_method: "sha256"`, `access_token` (empty string if unset).

- `testConnection()` — `GET /seller/get`; catches and returns `{ success: false, error }`, never throws.
- `pullOrders(since)` — defaults to last 24h. `GET /orders/get` (limit 100, sorted ASC by created_at), then **one extra request per order** to `/order/items/get` to fetch line items — N+1: 100 orders in a poll = 101 HTTP calls.
- `syncProducts(products)` — `POST /product/create` per product using Lazada's nested `Request.Product.Skus.Sku[]` / `Request.Product.Attributes` shape. Per-item try/catch — one bad product doesn't abort the batch.
- `pushInventory(updates)` — single batched call to `/product/stock/sellable/update`.

SKU fallback in `syncProducts`: `product.sku || product.barcode || "SP-${id}"`. `pushInventory` only sends whatever SKUs the caller passes in — the route layer (`routes/integrations/daraz.js`) is responsible for pre-filtering to rows with a mapped `daraz_sku`.

**Order shape returned by `pullOrders`**: `{ external_order_id, external_order_number, status, customer: { name, phone, address, city }, items: [{ sku, name, quantity, price, daraz_item_id }], total, payment_method, created_at }`.

---

## `meta-commerce.js` — Facebook/Instagram Commerce

**Auth**: `access_token` appended as a query-string param on every request (not a header). Graph API version `v19.0` is hardcoded in `baseUrl`.

- `testConnection()` — `GET /me?fields=id,name`; never throws.
- `syncProducts(products)` — throws up front if `catalogId` isn't configured. Price format is unusual: integer cents rendered as a string, e.g. `"${Math.round(price*100)} PKR"`.
- `pullOrders(since)` — throws if `commerceAccountId` missing. Hardcoded to only fetch `state=FB_PROCESSING` orders. `price_per_unit.amount` arrives in cents — divided by 100 on ingest. `source` is `"instagram"` when `channel === "INSTAGRAM"`, else `"facebook"`.
- `pushInventory(updates)` — one batched `POST /{catalogId}/items_batch` with `method: "UPDATE"` per SKU.

**Order shape**: `{ external_order_id, external_order_number, status, source, items: [{ name, quantity, price, sku, fb_item_id }], total, created_at }`.

---

## `whatsapp-client.js` — WhatsApp Business Cloud API

Not a marketplace — `syncProducts`/`pullOrders`/`pushInventory` are silent no-ops returning `[]` / `[]` / `{ updated: 0 }`. Its real surface is outbound messaging.

**Auth**: `Authorization: Bearer <api_key>` — this adapter uses `config.api_key` for the bearer token, NOT `config.oauth_token` like Meta/Google (a config-shape inconsistency worth remembering when wiring credentials). Graph API `v19.0` hardcoded. Every send method throws first if `phoneNumberId` is unset.

- `testConnection()` — `GET /{phoneNumberId}?fields=verified_name,display_phone_number`; never throws.
- `sendTemplate(to, templateName, languageCode="en", components=[])` — sends a pre-approved WhatsApp template.
- `sendTextMessage(to, text)` — free-form text; only deliverable inside Meta's 24h customer-initiated session window.
- `sendOrderConfirmation(to, order)` — wraps `sendTemplate` with the `"order_confirmation"` template.
- `sendTrackingUpdate(to, trackingNumber, courierName)` — wraps `sendTemplate` with `"shipping_update"`.

Template names must already be approved in Meta Business Manager for the tenant's WABA or the send call fails.

---

## `google-merchant.js` — Google Merchant Center Content API

**Auth**: `Authorization: Bearer <oauth_token>`. Base URL is `https://shoppingcontent.googleapis.com/content/v2.1`. Every method except `testConnection` throws synchronously if `merchantId` is missing; `testConnection` instead returns `{ success: false, error }`.

- `testConnection()` — `GET /{merchantId}/accounts/{merchantId}`; never throws.
- `syncProducts(products)` — one `POST` per product (Merchant Center product upsert). Hardcodes `targetCountry: "PK"`, `currency: "PKR"`, `contentLanguage: "en"`, `condition: "new"`, `channel: "online"`.
- `pushInventory(updates)` — upserts via `POST` (not `PATCH`) per item. **Per-item errors are silently swallowed in a try/catch that does nothing** — the function always resolves `{ updated: updates.length }` regardless of how many actually failed. Don't trust the return value as a success signal.
- `pullOrders()` — always returns `[]`. Google Merchant only drives shopping traffic to your own storefront; it never processes orders itself.
- `checkFeedStatus()` — extra method not on `BaseMarketplace`, polled by a 6-hour worker job. Returns `[{ offer_id, title, status, disapproval_issues: [{ code, description, detail, resolution }] }]`.

---

## `foodpanda-client.js` / `careem-client.js` — delivery aggregators (order-push, not catalog sync)

Structurally different from the four Hub adapters above: these are **webhook-first**. The platform POSTs each new order to our webhook, and the client's `static normalizeOrder(payload)` is the real workhorse — it converts the platform's order payload into the internal `web_order` shape consumed by `services/aggregator-orders.js`. The instance methods (`testConnection` / `pullOrders` / `pushInventory` / `syncProducts`) are the outbound half, and are deliberately honest about what ISN'T available rather than faking a green integration — a full menu/availability API is partner-provisioned and PK tenants rarely have live access to it.

**Config** (from `integration_settings`, `provider='foodpanda'` or `'careem'`): `api_key` (POS API bearer token, encrypted), `webhook_secret` (HMAC secret the platform signs callbacks with, encrypted), `config_json: { store_id | vendor_code/branch_id, base_url?, menu_api?/api_provisioned? }`.

**Price rule (both clients, deliberate)**: `normalizeOrder` takes every price field from the payload itself and never re-resolves the local product price. Aggregator menus commonly carry a markup over the in-store price — re-resolving locally would break daily reconciliation against the platform's payout.

**`testConnection()` modes** — both clients return a `mode` field describing real capability rather than a flat boolean:
- No `store_id`/`webhook_secret` configured → orders are entered manually (Careem reports `{ success: false, mode: "manual" }`; foodpanda reports a plain failure with an explanatory message).
- `store_id` + `webhook_secret` set but no live menu API → `{ success: true, mode: "webhook_only" }` — inbound orders work, outbound availability push does not.
- Menu API actually provisioned and reachable → `{ success: true, mode: "webhook+api" }` (Careem) / `"webhook+menu_api"` (foodpanda).

**`pullOrders` / `pushInventory` / `syncProducts`** — return empty/no-op results (`[]`, or `{ updated: 0, skipped: n, reason: "no_menu_api" }`) whenever no menu API is provisioned, instead of fabricating success. `pullOrders` on both is a polling *fallback* only — the webhook push is primary and the platform itself retries failed webhook deliveries.

**`normalizeOrder(payload)` (static, both clients)** — defensively aliases across each platform's known payload field-name variants (e.g. foodpanda: `p.token ?? p.code ?? p.orderId ?? p.order_id ?? p.id`). Throws an error tagged `code: "malformed_payload"` if no order id can be resolved at all, so the caller can dead-letter it. Returns:

```js
{ source, external_order_id, external_order_number, store_id, currency,
  subtotal, tax_total, discount_total, grand_total, ordered_at, expedition_type,
  customer: { name, phone },
  items: [{ sku, title, qty, unit_price, line_total, notes }] }
```

**Pipeline this feeds** (`services/aggregator-orders.js`): webhook (signature-verified, fail-closed — unlike the four Hub webhooks) → `resolveTenantForStore()` → `normalizeOrder()` → `ingestOrder()` (idempotent on `source` + external order id) → auto-accept → `online-inbox.acceptOnlineOrder()` (creates draft order + KDS ticket) → `settleAggregatorSale()`. `settleAggregatorSale` is a dedicated sales writer, separate from the pay-at-table settle path, because it must decrement stock and fire kit-engine recipe consumption consistently with POS; its decrements are **unconditional** (can go negative) since the order is already placed and paid on the aggregator platform and can't be rolled back from our side.

---

## Error handling summary

| Adapter | `syncProducts` errors | `pushInventory` errors | `testConnection` throws? |
|---|---|---|---|
| Daraz | per-item try/catch → `{ success:false, error }` | single call; lets errors throw | never |
| Meta | per-item try/catch | throws on missing `catalogId` or API error | never |
| WhatsApp | no-op stub (not applicable) | no-op stub (not applicable) | never |
| Google Merchant | per-item try/catch | silently swallowed — always resolves `{ updated: N }` | never |
| foodpanda / Careem | no-op `[]` — menu is authored on the platform's partner portal, out of scope | honest no-op when no menu API: `{ updated: 0, skipped, reason }` | never — returns a descriptive `mode` field instead |

No adapter here writes directly to `web_orders` / `external_sync_events` — that persistence happens one layer up, at the route/service layer (`routes/integrations/*` for the four Hub adapters, `services/aggregator-orders.js` for foodpanda/Careem).

---

## Adding a new marketplace adapter

**Catalog-sync style (Daraz/Meta/Google pattern)** — for a new outbound-sync channel:
1. Create `services/marketplace/<name>-client.js` extending `BaseMarketplace`; implement all four base methods (stub any that don't apply as silent no-ops, following the WhatsApp pattern).
2. Wire it into `routes/integrations/index.js` — `hub.js` reads `integration_settings` generically, so no per-adapter Hub route change should be needed.
3. Keep sync manual (Integrations Hub UI-triggered) — `workers/marketplace-sync-worker-boss.js` has no cron loop to extend for this style.
4. Gate every route with `requireFeature('marketplace_integrations')`. Store credentials via `services/crypto.js`.
5. Config convention: primary auth goes in `oauth_token` (OAuth flows) or `api_key` (static keys); secondary IDs (catalog id, merchant id, account id) go in `config_json`.

**Order-push style (foodpanda/Careem pattern)** — for a new delivery aggregator:
1. Create the client with a `static normalizeOrder(payload)` plus honest stub instance methods (mirror the foodpanda/Careem section above).
2. Register it in `AGGREGATOR_SOURCES` / `ADAPTERS` / `SIGNATURE_HEADERS` / `TIMESTAMP_HEADERS` in `services/aggregator-orders.js`.
3. Wire a signature-verified webhook route in `routes/webhooks.js` — fail-closed, unlike the four Hub webhooks.
4. Never re-resolve local product price inside `normalizeOrder` — always take it from the incoming payload.
