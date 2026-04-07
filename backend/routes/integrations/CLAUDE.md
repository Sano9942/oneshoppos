# Integrations Routes — Claude Guide

7 files. Mounted at `/api/integrations` via `registerAllRoutes.js`.

## Files
| File | Endpoints | Purpose |
|------|-----------|---------|
| `index.js` | — | Router mount point, applies `requireFeature('marketplace_integrations')` |
| `hub.js` | `GET /hub` | Central dashboard — all providers + courier + Shopify/Woo status |
| `credentials.js` | `POST /connect`, `POST /disconnect`, `POST /test`, `GET /:provider/status` | Generic BYOK credential management (AES-256-GCM encrypted) |
| `daraz.js` | `POST /daraz/test`, `POST /daraz/sync-products`, `POST /daraz/pull-orders`, `POST /daraz/push-inventory` | Daraz Seller API integration |
| `facebook.js` | `POST /facebook/test`, `POST /facebook/sync-products`, `POST /facebook/pull-orders`, `POST /facebook/push-inventory` | Facebook/Instagram Commerce |
| `google-merchant.js` | `POST /google-merchant/test`, `POST /google-merchant/sync-products`, `GET /google-merchant/feed-status` | Google Merchant Center feed |
| `whatsapp.js` | `POST /whatsapp/test`, `POST /whatsapp/send-template`, `GET /whatsapp/conversations` | WhatsApp Business API |

## Auth
All routes require `marketplace_integrations` feature flag + tenant auth.

## Credentials
Stored in `integration_settings` table. API keys encrypted via `services/crypto.js` (AES-256-GCM). Provider-specific mapping tables for product/order sync.
