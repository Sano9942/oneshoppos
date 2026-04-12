# Shopify Routes — Claude Guide

- **9 files**: config, health, sync, orders, import, mappings, reconciliation, webhooks (signature-verified, no auth), index (orchestrator)
- **Permissions**: most endpoints use `manage_inventory`; `orders.js` uses `manage_orders` only; `health.js` status/events/uat-checklist endpoints use `requireAnyPerm(["manage_inventory","manage_orders"])`; reconciliation GET uses `requireAnyPerm(["view_reports","manage_inventory"])`
- **Connection check**: Most endpoints call `getActiveShopifyConnection()` (from `index.js`) to verify `shopify_connections` row exists and `is_active = true`
- **Product mapping**: `shopify_product_map` links local products/variants to Shopify IDs; `shopify_product_metadata` stores additional Shopify attributes
- **Customer mapping**: `shopify_customer_map` + `GET/PUT /api/integrations/mappings/customers/:customerId` (in `mappings.js`)
- **Location mapping**: `shopify_location_map` links outlets to Shopify locations
- **Route layer uses `shopify/utils.js`** for `maskSecret`/`getActiveShopifyConnection`; `shopify/crypto.js` handles underlying encryption; `logShopifyEvent` injected via `deps`
- **Sync/audit tables**: `external_sync_events`, `shopify_sync_runs` tracked by sync.js, health.js, orders.js, webhooks.js
- **Sync worker**: Background Shopify sync polling (disabled via `SHOPIFY_SYNC_WORKER_DISABLED=1`)
- **Reconciliation**: `inventory_reconciliation` table tracks stock discrepancies. `POST /reconciliation/:id/fix` requires `requireFeature("approvals")` — the only Shopify route with a feature flag gate. `POST /reconciliation/bulk` and `PUT /reconciliation/:id` also available
- **Webhooks**: only `POST /api/integrations/shopify/webhooks/orders-create` is implemented. Other topics (orders/updated, orders/cancelled, refunds/create) listed in `/health/webhooks/setup` are recommendations for Shopify admin config, not implemented routes
- **import.js extras**: `DELETE /api/integrations/shopify/import/products` (bulk delete Shopify-imported products), `POST /api/integrations/shopify/import/inventory` (sync inventory from Shopify)
- **Mapping extras**: `POST /mappings/products/auto-live`, `POST /mappings/products/apply-suggestions` (batch mapping endpoints in `mappings.js`)
