# Shopify Pages — Claude Guide

- **7 files** — Shopify integration UI, all driven by shared context
- **`ShopifyContext.jsx`** — `ShopifyProvider` + `useShopify()`. Manages: `config` (connection status), `status` (event stats), `outlets`, `mappingCounts`. Exposes `apiFetch` helper, `setError/setSuccess`, `loadAll()`
- **`ShopifyOverview.jsx`** — status dashboard: connection health, event stats summary
- **`ShopifySettings.jsx`** — connect/disconnect, credential input, push/pull config
- **`ShopifyImport.jsx`** — bulk product + inventory import with delete-import action
- **`ShopifyMappings.jsx`** — map Shopify locations to POS outlets, live Shopify location fetch
- **`ShopifyEvents.jsx`** — paginated webhook event log with search and filter
- **`ShopifyReconciliation.jsx`** — stock reconciliation between Shopify and POS, CSV export
