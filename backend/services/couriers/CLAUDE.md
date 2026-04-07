# Courier Adapters — Claude Guide

- **16 files**: `index.js`, `base-adapter.js`, `generic-adapter.js` + 13 courier adapters
- **Adapter pattern**: `BaseCourierAdapter` (abstract) → `GenericAdapter` (manual tracking) / specific adapters
- **Factory**: `getAdapter(key, config)` from `index.js` — returns adapter instance. Falls back to `GenericAdapter` for unknown keys
- **Interface**: `bookShipment(order, sender, receiver, options)`, `getTracking(trackingNumber)`, `cancelShipment(trackingNumber)`
- **GenericAdapter**: All methods return no-ops — tracking entered manually by staff
- **13 courier adapters**: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex (13 couriers pre-seeded in `courier_integrations` table)
- **Adding a new courier**: Create `<name>-adapter.js` extending `BaseCourierAdapter`, register in `index.js` ADAPTERS map
