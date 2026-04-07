# Courier Adapters — Claude Guide

- **Adapter pattern**: `BaseCourierAdapter` (abstract) → `GenericAdapter` (manual tracking) / `LeopardsAdapter` (Leopards Courier Pakistan API)
- **Factory**: `getAdapter(key, config)` from `index.js` — returns adapter instance. Falls back to `GenericAdapter` for unknown keys
- **Interface**: `bookShipment(order, sender, receiver, options)`, `getTracking(trackingNumber)`, `cancelShipment(trackingNumber)`
- **GenericAdapter**: All methods return no-ops — tracking entered manually by staff
- **LeopardsAdapter**: Calls `merchantapi.leopardscourier.com`. COD vs Overnight determined by `options.cod_amount > 0`. Cancellation not supported via API (returns `success: false`)
- **Adding a new courier**: Create `<name>-adapter.js` extending `BaseCourierAdapter`, register in `index.js` ADAPTERS map
