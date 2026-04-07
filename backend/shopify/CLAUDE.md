# Shopify Client — Claude Guide

- **4 files** — Shopify API client, crypto, order sync service, utilities
- **`client.js`** — GraphQL API client. `shopifyGraphqlRequest(connection, query, vars, retries)` with 3 retries. Key exports: `verifyConnection`, `fetchShopifyLocations`, `adjustShopifyInventory`, `fetchShopifyVariantCatalog`, `fetchRecentOrders`. API version from connection row, defaults `"2025-10"`. Use `toGid(type, value)` for Shopify GIDs
- **`crypto.js`** — AES-256-GCM for access tokens. `encryptShopifySecret` / `decryptShopifySecret`. Format: `enc:v1:<iv>:<tag>:<ciphertext>`. Plain text returned as-is if no `SHOPIFY_SECRET_KEY`. **Always set this key in production**
- **`order-service.js`** — factory: `createOrderService(db, getActiveShopifyConnection)`. `upsertWebOrderFromShopifyPayload` maps Shopify orders to local `web_orders`. Stock policy: `shouldApplyWebOrderStock` (paid/authorized), `shouldReverseWebOrderStock` (refunded/cancelled)
- **`utils.js`** — retry delays with jitter (1m→5m→15m→1h→4h), webhook timestamp validation (10-min max age, missing = valid), `isRetryableInventoryEventStatus`, `decryptShopifyConnectionSecrets`
