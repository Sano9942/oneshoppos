# Marketplace Clients — Claude Guide

- **5 files** — marketplace API clients for the Integrations Hub (`routes/integrations/`). Each wraps a third-party marketplace platform's REST API
- **`base-marketplace.js`** — abstract base class defining the interface: `testConnection()`, `syncProducts()`, `pullOrders()`, `pushInventory()` (all throw "Not implemented"). Concrete clients extend this and implement the methods
- **`daraz-client.js`** — Daraz Seller Center API (Open Platform SDK). Order polling, product feed push, inventory updates
- **`meta-commerce.js`** — Facebook/Instagram Commerce API. Catalog feed + order ingestion across both platforms (shared Graph API)
- **`whatsapp-client.js`** — WhatsApp Business Cloud API. Template messages, conversation webhooks, message status tracking
- **`google-merchant.js`** — Google Merchant Center Content API. Product feed push + diagnostics
- **Credential storage**: all marketplace API keys live in `integration_settings.encrypted_config_json` as AES-256-GCM ciphertext (`enc:v1:{iv}:{tag}:{cipher}`). Decrypted at call time via `services/crypto.js:decrypt(secret)`
- **Polling cadence**: driven by `workers/marketplace-sync-worker-boss.js` (pg-boss, `MARKETPLACE_SYNC_WORKER_ENABLED=1`). Two jobs: `marketplace-order-poll` (every 10 minutes) + `marketplace-feed-check` (every 6 hours, for Google Merchant)
- **Webhook delivery**: inbound webhooks hit `/api/webhooks/{daraz,meta,whatsapp}` (mounted before tenant middleware) and are HMAC-verified before being written to `web_orders` / `external_sync_events`
- **Feature flag**: all marketplace routes + workers gated on `marketplace_integrations` flag per tenant
- **Error handling**: API failures are non-fatal — clients log to `external_sync_events` with `status='failed'`, and the worker retries on the next poll cycle with exponential backoff
