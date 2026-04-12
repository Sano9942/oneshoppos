# Integrations Routes — Claude Guide

7 files. Mounted at `/api/integrations` via `registerAllRoutes.js`.

## Files
| File | Endpoints | Purpose |
|------|-----------|---------|
| `index.js` | — | Router mount point; injects `encryptSecret`/`decryptSecret`/`maskSecret` from `services/crypto.js` into deps. Each sub-module independently calls `requireFeature('marketplace_integrations')` per-route (not injected centrally) |
| `hub.js` | `GET /hub` | Central dashboard — response shape: `{ channels, couriers, payment_providers, sms_providers, shopify, woocommerce }`. Requires both `requirePerm("manage_inventory")` AND `requireFeature("marketplace_integrations")` |
| `credentials.js` | `POST /connect`, `POST /disconnect`, `POST /test`, `GET /:provider/status`, `POST /:provider/send-test-sms` | Generic BYOK credential management. Uses `validate(connectProviderSchema)` + `validate(disconnectProviderSchema)` from `schemas/integrations`. `POST /test` only checks DB for stored credentials — does not call the remote API |
| `daraz.js` | `POST /daraz/test`, `POST /daraz/sync-products`, `POST /daraz/pull-orders`, `POST /daraz/push-inventory` | Daraz Seller API. Mapping tables: `daraz_product_map`, `daraz_order_map` |
| `facebook.js` | `POST /facebook/test`, `POST /facebook/sync-products`, `POST /facebook/pull-orders`, `POST /facebook/push-inventory` | Facebook/Instagram Commerce. Mapping tables: `facebook_product_map`, `facebook_order_map` |
| `google-merchant.js` | `POST /google-merchant/test`, `POST /google-merchant/sync-products`, `GET /google-merchant/feed-status` | Google Merchant Center feed. Audit table: `google_merchant_feed_log` |
| `whatsapp.js` | `POST /whatsapp/test`, `POST /whatsapp/send-template`, `GET /whatsapp/conversations` | WhatsApp Business API. Tables: `whatsapp_conversations`, `whatsapp_messages` |

## Auth (permission levels vary by endpoint)
| Permission | Endpoints |
|------------|-----------|
| `all_access` + `marketplace_integrations` | `POST /connect`, `POST /disconnect` |
| `manage_inventory` + `marketplace_integrations` | `POST /test`, `GET /:provider/status`, `POST /daraz/test`, `POST /daraz/sync-products`, `POST /daraz/push-inventory`, `POST /facebook/test`, `POST /facebook/sync-products`, `POST /facebook/push-inventory`, all google-merchant, `POST /whatsapp/test` |
| `manage_orders` + `marketplace_integrations` | `POST /daraz/pull-orders`, `POST /facebook/pull-orders`, `POST /whatsapp/send-template`, `GET /whatsapp/conversations` |
| `phase5_sms_providers` + `all_access` | `POST /:provider/send-test-sms` |

## Credentials
Stored in `integration_settings` table (`category` field: `'marketplace'`, `'sms'`, etc.). API keys encrypted via `services/crypto.js` (AES-256-GCM). Provider-specific mapping tables for product/order sync.
