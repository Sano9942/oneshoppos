# Integrations Routes — Claude Guide

All routes mount at `/api/integrations/*`. Feature flag `marketplace_integrations` is required on most routes (applied per-route, not injected centrally). The exception is `POST /api/integrations/:provider/send-test-sms`, which uses `requireFeature("phase5_sms_providers")` instead. Sub-modules receive `router` (not `app`) and `integrationDeps`.

## index.js — Orchestrator

Mounts 6 sub-modules onto a single Express router, then attaches it at `/api/integrations`. Injects `encryptSecret`, `decryptSecret`, `maskSecret` from `services/crypto.js` into `integrationDeps` (not in the outer `deps` object from the tenant middleware chain). Sub-module load order: hub → credentials → daraz → facebook → whatsapp → google-merchant.

## hub.js

- `GET /api/integrations/hub` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Returns unified integration dashboard:
  - `channels` — `integration_settings` rows where `category` is NOT `payment` or `sms`/`messaging_sms`
  - `couriers` — `courier_integrations` with capability flags (`supports_booking`, `supports_tracking`, `supports_cancellation`, `supports_labels`). `has_credentials` is `!!c.api_key`. Note: integration channel entries (in `channels`, `payment_providers`, `sms_providers`) use `has_credentials: !!i.is_active`, not a direct check for an API key or token.
  - `payment_providers` — `integration_settings` rows where `category = 'payment'`
  - `sms_providers` — `integration_settings` rows where `category = 'sms'` or `'messaging_sms'`
  - `shopify` — active `shopify_connections` row (or null)
  - `woocommerce` — the `integration_settings` row where `provider = 'woocommerce'` (or null)

Tables: `integration_settings`, `courier_integrations`, `shopify_connections`.

## credentials.js

Generic BYOK credential management. Credentials stored AES-256-GCM encrypted in `integration_settings`.

- `POST /api/integrations/connect` — `requirePerm("all_access")` + `requireFeature("marketplace_integrations")` + `validate(connectProviderSchema)`. Encrypts `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token` individually before storing. Uses `ON CONFLICT (provider) DO UPDATE SET` with COALESCE — only supplied fields overwrite existing values. Sets `is_active=true`, clears `last_error`.
- `POST /api/integrations/disconnect` — `requirePerm("all_access")` + `requireFeature("marketplace_integrations")` + `validate(disconnectProviderSchema)`. Sets `is_active=false`, NULLs all credential columns (`api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token`).
- `POST /api/integrations/test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. **Does NOT call the remote API** — only checks if credentials exist in the DB. Returns 404 `{ error: "Integration not configured" }` when no row exists in the DB at all. Returns `{ success: false, error: "No credentials configured" }` if a row exists but has no API key or oauth token. Returns `{ success: true, provider }` otherwise.
- `GET /api/integrations/:provider/status` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Returns masked config: `api_key_masked` via `maskSecret()`, never raw credentials. Parses `config_json` from string to object. Returns `{ connected: false, provider }` if provider not found.
- `POST /api/integrations/:provider/send-test-sms` — `requirePerm("all_access")` + `requireFeature("phase5_sms_providers")` (different feature flag). Uses `services/sms.js` (lazy-required). Requires `to` in body; `message` defaults to "Test message from SanoPOS".

Tables: `integration_settings`.

## daraz.js

Uses `DarazClient` from `services/marketplace/daraz-client`. All routes decrypt credentials on every request via `getDarazClient()` (no in-memory client cache).

- `POST /api/integrations/daraz/test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Calls `client.testConnection()`. Returns `{ success: false, error }` on failure (not 500).
- `POST /api/integrations/daraz/sync-products` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Reads active products (up to 100), calls `client.syncProducts()`, upserts successful mappings to `daraz_product_map` on conflict `daraz_item_id`. Returns `{ synced, failed, details }`.
- `POST /api/integrations/daraz/pull-orders` — `requirePerm("manage_orders")` + `requireFeature("marketplace_integrations")`. Accepts `?since=` in body. Deduplicates by checking `daraz_order_map` before import. Inserts to `web_orders` (source=`'daraz'`) + `daraz_order_map`. Updates `last_sync_at` on `integration_settings`. Returns `{ imported, skipped, total }`.
- `POST /api/integrations/daraz/push-inventory` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Reads `daraz_product_map JOIN products` with `WHERE dpm.daraz_sku IS NOT NULL` — rows with a null `daraz_sku` are excluded entirely (no fallback to `products.sku` for those rows). Calls `client.pushInventory(updates)`.

Tables: `integration_settings`, `products`, `daraz_product_map`, `web_orders`, `daraz_order_map`.

## facebook.js

Uses `MetaCommerceClient` from `services/marketplace/meta-commerce`. Authenticates via `oauth_token` + `config_json` (not `api_key`). Handles both Facebook Shop and Instagram Commerce (same provider key `'facebook'`).

- `POST /api/integrations/facebook/test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`.
- `POST /api/integrations/facebook/sync-products` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Upserts successful results to `facebook_product_map` on conflict `fb_product_id`. Returns `{ synced, failed, details }`.
- `POST /api/integrations/facebook/pull-orders` — `requirePerm("manage_orders")` + `requireFeature("marketplace_integrations")`. Deduplicates via `facebook_order_map`. Source can be `'facebook'` or `'instagram'` depending on `order.source`. Updates `last_sync_at` on `integration_settings`.
- `POST /api/integrations/facebook/push-inventory` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Uses `products.sku` (not a Facebook-specific SKU) for inventory updates. No filtering by `is_active` in the join (reads all mapped products).

Tables: `integration_settings`, `products`, `facebook_product_map`, `web_orders`, `facebook_order_map`.

## whatsapp.js

Uses `WhatsAppClient` from `services/marketplace/whatsapp-client`. Authenticates via `api_key` + `config_json`.

- `POST /api/integrations/whatsapp/test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`.
- `POST /api/integrations/whatsapp/send-template` — `requirePerm("manage_orders")` + `requireFeature("marketplace_integrations")`. Supports two templates: `order_confirmation` (requires `order_id`, looks up `web_orders`) and `shipping_update` (requires `tracking_number`). Logs sent message to `whatsapp_messages` — looks up `conversation_id` from `whatsapp_conversations` by `phone_number`. If no conversation exists, the `conversation_id` subquery returns NULL (no error thrown, silently logs with null FK).
- `GET /api/integrations/whatsapp/conversations` — `requirePerm("manage_orders")` + `requireFeature("marketplace_integrations")`. Last 50 conversations joined with customer name + message count subquery. Orders by `last_message_at DESC NULLS LAST`.

Tables: `integration_settings`, `web_orders`, `whatsapp_conversations`, `whatsapp_messages`, `customers`.

## google-merchant.js

Uses `GoogleMerchantClient` from `services/marketplace/google-merchant`. Authenticates via `oauth_token` + `config_json`. Provider key in DB is `'google_merchant'` (underscore, not hyphen).

- `POST /api/integrations/google-merchant/test` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`.
- `POST /api/integrations/google-merchant/sync-products` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Inserts successful products to `google_merchant_feed_log` (`ON CONFLICT DO NOTHING`). Updates `last_sync_at` on `integration_settings`.
- `GET /api/integrations/google-merchant/feed-status` — `requirePerm("manage_inventory")` + `requireFeature("marketplace_integrations")`. Calls `client.checkFeedStatus()`, updates `google_merchant_feed_log` rows with current status and disapproval reasons.

Tables: `integration_settings`, `products`, `google_merchant_feed_log`.

## Permission Summary

| Route | Permission | Feature Flag |
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

## Key Gotchas

- **`POST /test` is a DB-only check** — it never makes an outbound API call. It just confirms credentials are present in `integration_settings`. Don't rely on it to validate that the remote integration is working.
- **`POST /connect` COALESCE upsert** — if a provider is already connected and you send a partial body (e.g., only `api_key`), all other credentials are preserved via COALESCE. To clear a field you must `POST /disconnect` first.
- **`google_merchant` vs `google-merchant`** — the DB `provider` key uses underscore (`google_merchant`); the URL path uses hyphen (`/google-merchant/`). Don't mix them up in queries.
- **WhatsApp message logging with null conversation** — `whatsapp/send-template` logs the message even if no `whatsapp_conversations` row exists for the phone number. The `conversation_id` becomes NULL (assuming the FK is nullable). This is silent — no error is raised.
- **Facebook push-inventory uses `products.sku`** (not a Facebook-assigned SKU). Daraz push-inventory filters with `WHERE dpm.daraz_sku IS NOT NULL` — only mapped products with a non-null `daraz_sku` are pushed; there is no fallback to `products.sku` for rows where `daraz_sku` is null.
- **Webhook inbounds** (Meta, WhatsApp, Daraz webhooks) are handled in `routes/webhooks.js` (mounted before tenant middleware), not here. These routes are for outbound API calls only.
