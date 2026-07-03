# Integrations Routes — Claude Guide

All routes mount at `/api/integrations/*`. Every sub-module exports a single factory `(router, deps) => {}` — they receive the shared `router` instance (not `app`) and a `deps` object, and register their paths directly on it. `requireFeature("marketplace_integrations")` is applied per-route (not injected centrally), so grep each handler rather than assuming a blanket gate. The lone exception is `POST /:provider/send-test-sms`, gated by `requireFeature("phase5_sms_providers")` instead.

## index.js — Orchestrator

`module.exports = function mountIntegrationRoutes(app, deps)`. Creates one `Router()`, builds `integrationDeps` by spreading `deps` and adding `encryptSecret`, `decryptSecret`, `maskSecret` from `services/crypto.js`, then requires each sub-module in order: hub → credentials → daraz → facebook → whatsapp → google-merchant. Finally mounts the router at `/api/integrations`. This is the only file in the directory that touches `services/crypto.js` directly — every other file receives the crypto helpers already injected via `deps`.

## hub.js

`module.exports = function registerHubRoutes(router, deps)`

- `GET /hub` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Aggregates three tables into one dashboard payload:
  - `channels` — `integration_settings` rows where `category` is not `payment` and not `sms`/`messaging_sms`
  - `payment_providers` — `integration_settings` rows where `category = 'payment'`
  - `sms_providers` — `integration_settings` rows where `category` is `sms` or `messaging_sms`
  - All three use `has_credentials: !!i.is_active` — this checks the active flag, not whether an actual key/token is present
  - `couriers` — `courier_integrations` mapped with capability flags (`supports_booking`, `supports_tracking`, `supports_cancellation`, `supports_labels`); `has_credentials: !!c.api_key` here IS a real key-presence check (inconsistent with the channels/payment/sms convention above — don't assume the same semantics apply)
  - `shopify` — single active `shopify_connections` row or `null`
  - `woocommerce` — the `integration_settings` row where `provider = 'woocommerce'`, found via `.find()` on the already-fetched `integrations` array (no separate query)

Tables read: `integration_settings`, `courier_integrations`, `shopify_connections`.

## credentials.js

`module.exports = function registerCredentialRoutes(router, deps)`. Generic BYOK credential CRUD — provider-agnostic, used by every marketplace channel plus payment/SMS providers.

- `POST /connect` — `requirePerm("all_access")` + `requireFeature("marketplace_integrations")` + `validate(connectProviderSchema)` (schema in `schemas/integrations.js`). Encrypts `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token` individually via `encryptSecret()` before storing. `INSERT ... ON CONFLICT (provider) DO UPDATE SET ... COALESCE(...)` — only fields present in the request body overwrite existing values; omitted fields keep their old encrypted value. Sets `is_active = true`, clears `last_error`.
- `POST /disconnect` — `requirePerm("all_access")` + `requireFeature("marketplace_integrations")` + `validate(disconnectProviderSchema)`. Sets `is_active = false` and NULLs all four credential columns. To fully clear one credential field without killing others, you must disconnect then reconnect with only the fields you want — there's no partial-clear endpoint.
- `POST /test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. **DB-only check, no outbound API call.** 404 `{ error: "Integration not configured" }` if no row exists; `{ success: false, error: "No credentials configured" }` if a row exists but has neither `api_key` nor `oauth_token`; `{ success: true, provider }` otherwise. Each provider's own `/test` route (daraz.js, facebook.js, etc.) is the one that actually calls the remote API — don't confuse the two.
- `GET /:provider/status` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Returns `api_key_masked` via `maskSecret()` — raw credentials never leave this endpoint. Parses `config_json` (stored as text) into an object. `{ connected: false, provider }` if no row found.
- `POST /:provider/send-test-sms` — `requirePerm("all_access")` + `requireFeature("phase5_sms_providers")` — different flag from every other route in this directory. Lazy-`require`s `services/sms.js` inline (not imported at module top). Requires `to` in body; `message` defaults to `"Test message from SanoPOS"`.

Tables: `integration_settings`.

## daraz.js / facebook.js / whatsapp.js / google-merchant.js — marketplace channel adapters

Each file follows the identical shape: a local `getXClient()` helper does `SELECT * FROM integration_settings WHERE provider = '<key>' AND is_active = true`, throws if not connected, decrypts whatever credential the provider needs, and constructs the client from `services/marketplace/*`. **No caching — every route call re-queries and re-decrypts on each request.** `/test` routes catch errors and return `{ success: false, error }` via `res.json()` (200 status), not a 500 — this is deliberate so the frontend can render a "connection failed" state without treating it as a server error.

| File | Client | Provider key (DB) | Auth fields used |
|------|--------|--------------------|-------------------|
| `daraz.js` | `services/marketplace/daraz-client` | `daraz` | `api_key`, `api_secret`, `oauth_token`, `store_url` |
| `facebook.js` | `services/marketplace/meta-commerce` (`MetaCommerceClient`) | `facebook` | `oauth_token` + `config_json` (no `api_key`) |
| `whatsapp.js` | `services/marketplace/whatsapp-client` | `whatsapp` | `api_key` + `config_json` |
| `google-merchant.js` | `services/marketplace/google-merchant` (`GoogleMerchantClient`) | `google_merchant` (underscore) | `oauth_token` + `config_json` |

**`google_merchant` vs `google-merchant`**: the DB `provider` column value uses an underscore; the URL path segment uses a hyphen. Don't copy-paste one into the other's query/route string.

### daraz.js

- `POST /daraz/test` — `manage_inventory`. Calls `client.testConnection()`.
- `POST /daraz/sync-products` — `manage_inventory`. Reads up to 100 active products (optionally filtered by `product_ids` in body), calls `client.syncProducts()`, upserts successes into `daraz_product_map` (`ON CONFLICT (daraz_item_id) DO UPDATE SET last_synced_at = NOW()`). Returns `{ synced, failed, details }`.
- `POST /daraz/pull-orders` — `manage_orders`. Accepts `{ since }` in body. Dedupes against `daraz_order_map.daraz_order_id` before inserting into `web_orders` (source `'daraz'`) + `daraz_order_map`. Updates `integration_settings.last_sync_at`. Returns `{ imported, skipped, total }`.
- `POST /daraz/push-inventory` — `manage_inventory`. Query is `SELECT ... FROM daraz_product_map dpm JOIN products p ... WHERE dpm.daraz_sku IS NOT NULL` — **rows with a null `daraz_sku` are silently excluded**, there is no fallback to `products.sku` for them. `{ updated: 0, message: "No mapped products" }` short-circuit if nothing qualifies.

Tables: `integration_settings`, `products`, `daraz_product_map`, `web_orders`, `daraz_order_map`.

### facebook.js

Handles both Facebook Shop and Instagram Commerce under the single provider key `facebook` — `order.source` distinguishes them per-order (`'facebook'` or `'instagram'`) rather than a separate provider row.

- `POST /facebook/test` — `manage_inventory`.
- `POST /facebook/sync-products` — `manage_inventory`. Same product-read pattern as daraz. Upserts to `facebook_product_map` (`ON CONFLICT (fb_product_id) DO UPDATE SET last_synced_at = NOW()`).
- `POST /facebook/pull-orders` — `manage_orders`. Dedupes via `facebook_order_map.fb_order_id`. Inserts `web_orders` with `source = order.source || "facebook"`.
- `POST /facebook/push-inventory` — `manage_inventory`. **Unlike daraz, this uses `products.sku` directly** (no Facebook-specific SKU column check) and does **not** filter the join by `is_active` — all mapped products are pushed regardless of active status.

Tables: `integration_settings`, `products`, `facebook_product_map`, `web_orders`, `facebook_order_map`.

### whatsapp.js

- `POST /whatsapp/test` — `manage_inventory`.
- `POST /whatsapp/send-template` — `manage_orders`. Two supported templates: `order_confirmation` (requires `order_id`, looks up `web_orders`, 404 if missing) and `shipping_update` (requires `tracking_number`; `courier_name` optional, defaults `"Courier"`). Any other/missing combination → 400. After sending, logs to `whatsapp_messages` with `conversation_id` resolved via a `SELECT id FROM whatsapp_conversations WHERE phone_number = $1 LIMIT 1` subquery — **if no conversation row exists for that phone number, `conversation_id` is silently NULL; no error is raised.**
- `GET /whatsapp/conversations` — `manage_orders`. Last 50 rows, joined to `customers` for name and a `message_count` subquery against `whatsapp_messages`. Ordered `last_message_at DESC NULLS LAST`.

Tables: `integration_settings`, `web_orders`, `whatsapp_conversations`, `whatsapp_messages`, `customers`.

### google-merchant.js

- `POST /google-merchant/test` — `manage_inventory`.
- `POST /google-merchant/sync-products` — `manage_inventory`. Same product-read pattern. Successes inserted into `google_merchant_feed_log` with `ON CONFLICT DO NOTHING` (no update-on-conflict, unlike daraz/facebook's map tables) plus `feed_status = 'active'`. Updates `integration_settings.last_sync_at`.
- `GET /google-merchant/feed-status` — `manage_inventory`. Calls `client.checkFeedStatus()`, then updates each `google_merchant_feed_log` row (matched by `gmc_offer_id`) with current `feed_status`, `disapproval_reason` (JSON-stringified array or null), and `last_checked_at`.

Tables: `integration_settings`, `products`, `google_merchant_feed_log`.

## Permission / flag matrix

| Route | Permission | Feature flag |
|-------|-----------|--------------|
| `GET /hub` | `manage_inventory` | `marketplace_integrations` |
| `POST /connect`, `POST /disconnect` | `all_access` | `marketplace_integrations` |
| `POST /test`, `GET /:provider/status` | `manage_inventory` | `marketplace_integrations` |
| `POST /:provider/send-test-sms` | `all_access` | `phase5_sms_providers` |
| `/daraz/test`, `/daraz/sync-products`, `/daraz/push-inventory` | `manage_inventory` | `marketplace_integrations` |
| `/daraz/pull-orders` | `manage_orders` | `marketplace_integrations` |
| `/facebook/test`, `/facebook/sync-products`, `/facebook/push-inventory` | `manage_inventory` | `marketplace_integrations` |
| `/facebook/pull-orders` | `manage_orders` | `marketplace_integrations` |
| `/whatsapp/test` | `manage_inventory` | `marketplace_integrations` |
| `/whatsapp/send-template`, `/whatsapp/conversations` | `manage_orders` | `marketplace_integrations` |
| `/google-merchant/test`, `/google-merchant/sync-products`, `/google-merchant/feed-status` | `manage_inventory` | `marketplace_integrations` |

## Cross-file dependencies

- `services/crypto.js` — `encryptSecret`/`decryptSecret`/`maskSecret`, injected only in `index.js`, then flow through `deps` to every sub-module. Format: `enc:v1:{iv}:{tag}:{ciphertext}`.
- `services/marketplace/*` — one client class per channel (`daraz-client`, `meta-commerce`, `whatsapp-client`, `google-merchant`), each constructed fresh per-request inside the route's local `getXClient()` helper. There's a `services/marketplace/base.js`/shared client too — check there before adding a fifth adapter.
- `schemas/integrations.js` — `connectProviderSchema`, `disconnectProviderSchema` (Zod, used only in `credentials.js`). The channel-specific routes (daraz/facebook/whatsapp/google-merchant) do not use `validate()` at all — request bodies are read and checked manually.
- `services/sms.js` — used only by `credentials.js`'s `send-test-sms` route, lazy-required.

## Key gotchas (quick reference)

- `POST /test` (credentials.js) is DB-only; the per-provider `/test` routes (daraz/facebook/whatsapp/google-merchant) are the ones that call the live API.
- `POST /connect` COALESCE upsert preserves any credential field not included in the request body — partial updates never clear a field.
- `google_merchant` (DB) vs `/google-merchant/` (URL) — underscore vs hyphen, easy to typo.
- WhatsApp template send logs with a NULL `conversation_id` if no matching conversation exists — check for this when debugging "missing" message history.
- Daraz push-inventory drops rows with null `daraz_sku` (no `products.sku` fallback); Facebook push-inventory uses `products.sku` directly and skips the `is_active` filter entirely — these two behave differently even though they look like copies of each other.
- Inbound webhooks (Meta, WhatsApp, Daraz) are NOT handled here — see `routes/webhooks.js` (mounted before tenant middleware). Everything in this directory is outbound-only (sync, push, test, pull-orders which is triggered by the tenant, not pushed by the marketplace).
