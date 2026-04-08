# Shopify Routes — Claude Guide

- **8 route files** + 1 webhook file (webhooks.js is signature-verified, no auth)
- **All non-webhook endpoints** require `manage_inventory` permission (some also require `manage_orders`)
- **Connection check**: Most endpoints verify `shopify_connections` row exists and `is_active = true`
- **Product mapping**: `shopify_product_map` links local products/variants to Shopify IDs
- **Location mapping**: `shopify_location_map` links outlets to Shopify locations
- **Crypto**: `shopify/crypto.js` handles secret encryption/decryption + event logging
- **Sync worker**: Background Shopify sync polling (disabled via `SHOPIFY_SYNC_WORKER_DISABLED=1`)
- **Reconciliation**: `inventory_reconciliation` table tracks stock discrepancies between local and Shopify
