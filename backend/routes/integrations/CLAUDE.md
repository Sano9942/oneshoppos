# Integrations Routes — Claude Guide

All routes mount at `/api/integrations/*`. Every sub-module exports a single factory `(router, deps) => {}` — they receive the shared `router` instance (not `app`) and register their paths directly on it. `requireFeature("marketplace_integrations")` is applied per-route (not injected centrally), so grep each handler rather than assuming a blanket gate. The one exception is `POST /:provider/send-test-sms`, gated by `requireFeature("phase5_sms_providers")` instead.

Inbound webhooks (Meta, Daraz, WhatsApp) live in `routes/webhooks.js` (mounted before tenant middleware), not here — this directory is outbound-only (sync, push, test, pull-orders — all tenant-triggered, none of it is a marketplace pushing data in).

## index.js — orchestrator

`module.exports = function mountIntegrationRoutes(app, deps)`. Creates one `Router()`, builds `integrationDeps` by spreading `deps` and adding `encryptSecret`, `decryptSecret`, `maskSecret` from `services/crypto.js`, then requires each sub-module in a fixed order: hub → credentials → daraz → facebook → whatsapp → google-merchant. Mounts the router at `/api/integrations`. This is the only file that touches `services/crypto.js` directly — every other file gets the crypto helpers already injected via `deps`.

## hub.js

`GET /hub` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Aggregates a dashboard payload from three tables in one call:
- `channels` / `payment_providers` / `sms_providers` — all sourced from `integration_settings`, split by `category` (`payment`, `sms`/`messaging_sms`, else channel). All three set `has_credentials: !!i.is_active` — this reflects the active flag, **not** whether a real key/token is actually present.
- `couriers` — from `courier_integrations`, with capability flags (`supports_booking`, `supports_tracking`, `supports_cancellation`, `supports_labels`). Here `has_credentials: !!c.api_key` **is** a genuine key-presence check — inconsistent with the channels/payment/sms convention above, don't assume they mean the same thing.
- `shopify` — the single active `shopify_connections` row, or `null`.
- `woocommerce` — found via `.find()` on the already-fetched `integration_settings` rows (`provider === 'woocommerce'`), no separate query.

## credentials.js

Generic BYOK credential CRUD, provider-agnostic — used by every marketplace channel plus payment/SMS providers.

- `POST /connect` — `requirePerm("all_access")` + `requireFeature("marketplace_integrations")` + `validate(connectProviderSchema)`. Encrypts `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token`, `webhook_secret` individually via `encryptSecret()`. `INSERT ... ON CONFLICT (provider) DO UPDATE SET ... COALESCE(...)` — only fields present in the request body overwrite existing values; omitted fields keep their prior encrypted value (there's no way to partial-clear a single field — you must disconnect then reconnect with only what you want). Connecting `foodpanda` or `careem` also force-flips the `delivery_aggregators` feature flag on and invalidates that tenant's flag cache — a real side-effecting gate, not decorative.
- `POST /disconnect` — `requirePerm("all_access")` + same flag. Sets `is_active = false` and NULLs `api_key`/`api_secret`/`oauth_token`/`oauth_refresh_token`.
- `POST /test` — `requirePerm("manage_inventory")`. **DB-only check — no outbound API call.** 404 if no row exists; `{ success: false }` if a row exists but has neither `api_key` nor `oauth_token`; otherwise `{ success: true, verified: false }` with a message pointing at the channel's own `/test` route for a real check.
- `GET /:provider/status` — `requirePerm("manage_inventory")`. Returns `api_key_masked` via `maskSecret()` — raw credentials never leave this endpoint. Parses `config_json` (stored as text) into JSON.
- `POST /:provider/send-test-sms` — `requirePerm("all_access")` + `requireFeature("phase5_sms_providers")` (different flag from everything else here). Lazy-`require`s `services/sms.js` inline. `message` defaults to `"Test message from SanoPOS"`.

## daraz.js / facebook.js / whatsapp.js / google-merchant.js — channel adapters

Same shape in each file: a local `getXClient()` helper runs `SELECT * FROM integration_settings WHERE provider = '<key>' AND is_active = true`, throws if not connected, decrypts whichever credential the provider needs, and constructs a client from `services/marketplace/*`. **No caching** — every route re-queries and re-decrypts per request. `/test` routes catch errors and return `{ success: false, error }` with a 200 status (deliberate — lets the frontend show a "connection failed" state without an error toast), unlike the other routes in these files which `res.status(500)` on failure.

| File | Client | DB provider key | Credentials used |
|------|--------|------------------|-------------------|
| daraz.js | `services/marketplace/daraz-client` | `daraz` | `api_key`, `api_secret`, `oauth_token`, `store_url` |
| facebook.js | `services/marketplace/meta-commerce` (`MetaCommerceClient`) | `facebook` | `oauth_token` + `config_json` (no `api_key`) |
| whatsapp.js | `services/marketplace/whatsapp-client` | `whatsapp` | `api_key` + `config_json` |
| google-merchant.js | `services/marketplace/google-merchant` (`GoogleMerchantClient`) | `google_merchant` (underscore) | `oauth_token` + `config_json` |

**`google_merchant` vs `/google-merchant/`**: DB column value uses an underscore, URL path segment uses a hyphen — easy to typo one into the other's query.

### daraz.js
- `/daraz/sync-products` (`manage_inventory`) — reads up to 100 active products (optional `product_ids` filter), calls `client.syncProducts()`, upserts successes into `daraz_product_map` (`ON CONFLICT (daraz_item_id) DO UPDATE SET last_synced_at = NOW()`).
- `/daraz/pull-orders` (`manage_orders`) — dedupes against `daraz_order_map.daraz_order_id`, inserts into `web_orders` (source `'daraz'`) + `daraz_order_map`, updates `integration_settings.last_sync_at`.
- `/daraz/push-inventory` (`manage_inventory`) — joins `daraz_product_map` to `products` with `WHERE dpm.daraz_sku IS NOT NULL` — **rows with a null `daraz_sku` are silently excluded**, no fallback to `products.sku`.

Tables: `integration_settings`, `products`, `daraz_product_map`, `web_orders`, `daraz_order_map`.

### facebook.js
Covers both Facebook Shop and Instagram Commerce under the single provider key `facebook` — `web_orders.source` (`'facebook'`/`'instagram'`) distinguishes them per-order rather than a separate provider row.
- `/facebook/sync-products`, `/facebook/pull-orders` — same pattern as daraz, upserting `facebook_product_map` (`ON CONFLICT (fb_product_id) DO UPDATE SET last_synced_at = NOW()`) and `facebook_order_map`.
- `/facebook/push-inventory` — **unlike daraz, uses `products.sku` directly** (no channel-specific SKU column) and does **not** filter by `is_active` — all mapped products push regardless of active status. This behaves differently from daraz's push-inventory despite the near-identical code shape.

Tables: `integration_settings`, `products`, `facebook_product_map`, `web_orders`, `facebook_order_map`.

### whatsapp.js
- `/whatsapp/send-template` (`manage_orders`) — two supported templates: `order_confirmation` (needs `order_id`, looks up `web_orders`, 404 if missing) and `shipping_update` (needs `tracking_number`; `courier_name` defaults `"Courier"`). Anything else → 400. Logs to `whatsapp_messages` with `conversation_id` resolved via `SELECT id FROM whatsapp_conversations WHERE phone_number = $1 LIMIT 1` — **if no conversation row exists for that phone number, `conversation_id` is silently NULL, no error raised.** Check for this when a message seems to have vanished from history.
- `/whatsapp/conversations` (`manage_orders`, GET) — last 50 rows, joined to `customers`, with a `message_count` subquery against `whatsapp_messages`, ordered `last_message_at DESC NULLS LAST`.

Tables: `integration_settings`, `web_orders`, `whatsapp_conversations`, `whatsapp_messages`, `customers`.

### google-merchant.js
- `/google-merchant/sync-products` — successes inserted into `google_merchant_feed_log` with `ON CONFLICT DO NOTHING` (no update-on-conflict, unlike daraz/facebook's map tables).
- `/google-merchant/feed-status` (GET) — calls `client.checkFeedStatus()`, then updates each `google_merchant_feed_log` row (matched by `gmc_offer_id`) with `feed_status`, `disapproval_reason` (JSON-stringified array or null), `last_checked_at`.

Tables: `integration_settings`, `products`, `google_merchant_feed_log`.

## Permission / flag matrix

| Route | Permission | Feature flag |
|-------|-----------|--------------|
| `GET /hub` | `manage_inventory` | `marketplace_integrations` |
| `POST /connect`, `POST /disconnect` | `all_access` | `marketplace_integrations` |
| `POST /test`, `GET /:provider/status` | `manage_inventory` | `marketplace_integrations` |
| `POST /:provider/send-test-sms` | `all_access` | `phase5_sms_providers` |
| `/daraz/*`, `/facebook/*`, `/google-merchant/*` sync/push/test | `manage_inventory` | `marketplace_integrations` |
| `/daraz/pull-orders`, `/facebook/pull-orders` | `manage_orders` | `marketplace_integrations` |
| `/whatsapp/test`, `/google-merchant/*` | `manage_inventory` | `marketplace_integrations` |
| `/whatsapp/send-template`, `/whatsapp/conversations` | `manage_orders` | `marketplace_integrations` |

## Cross-file dependencies

- `services/crypto.js` — `encryptSecret`/`decryptSecret`/`maskSecret`, AES-256-GCM, format `enc:v1:{iv}:{tag}:{ciphertext}`. Injected only in `index.js`, then flows through `deps` to every sub-module — no other file requires `crypto.js` itself.
- `services/marketplace/*` — one client class per channel (`daraz-client`, `meta-commerce`, `whatsapp-client`, `google-merchant`), each constructed fresh per-request inside the route's local `getXClient()`/`getMetaClient()`/`getGmcClient()` helper. A `services/marketplace/base.js` shared-client base also exists — check it before adding a fifth adapter.
- `schemas/integrations.js` — `connectProviderSchema`, `disconnectProviderSchema`, used only by `credentials.js`. The channel-specific files (daraz/facebook/whatsapp/google-merchant) don't use `validate()` at all — bodies are read and checked manually.
- `services/sms.js` — used only by `credentials.js`'s `send-test-sms` route, lazy-required inline.

## Key gotchas (quick reference)

- `POST /test` in credentials.js is DB-only; the per-provider `/test` routes are what actually call the live API.
- `POST /connect`'s COALESCE upsert means partial updates never clear a field you omit.
- `google_merchant` (DB value) vs `/google-merchant/` (URL segment) — underscore vs hyphen.
- WhatsApp template send silently NULLs `conversation_id` when no conversation row exists for the phone number.
- Daraz push-inventory drops rows with null `daraz_sku`; Facebook push-inventory uses `products.sku` directly and skips the `is_active` filter — these look like copies of each other but behave differently.
- `hub.js`'s `has_credentials` means two different things depending on section: active-flag check for channels/payment/sms, real key-presence check for couriers.
