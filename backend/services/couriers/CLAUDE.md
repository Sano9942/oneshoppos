# Courier Adapters — Claude Guide

## Overview

Adapter pattern for courier/delivery API integration. `index.js` exports `getAdapter(adapterKey, config)` and `ADAPTERS` — `getAdapter` is the sole entry point, mapping a courier slug string to a class and returning a constructed instance. An unrecognized key falls back to `GenericAdapter`.

Consumer: `backend/routes/couriers.js` is the only route file that calls `getAdapter()` (test-connection, ship-order, cancel-shipment, get-tracking call sites). It builds the adapter config via a local `buildCourierAdapterConfig(row)` helper, which:
- `decryptSecret()`s `api_key`/`api_secret` (AES-256-GCM, format `enc:v1:{iv}:{tag}:{ciphertext}`; passes plaintext through untouched for legacy rows)
- parses the `config_json` `TEXT` column into an object (handles both a JSON string and an already-parsed object, falls back to `{}` on error)

So every adapter always receives **decrypted credentials and an already-parsed `config_json` object** on `this.config` — adapters never touch `process.env`, call `decryptSecret`, or `JSON.parse` themselves. That's entirely the route's job.

---

## Class hierarchy

```
BaseCourierAdapter          — abstract; every method throws "Not implemented"
├── GenericAdapter          — manual-entry no-ops; never throws
│   ├── BykeaAdapter        — overrides bookShipment to throw 501 (hyperlocal, no public API)
│   └── PakPostAdapter      — overrides bookShipment to throw 501 (counter-booking only)
└── 11 named adapters extend BaseCourierAdapter directly:
    leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, dhl, fedex
```

---

## Interface every adapter implements (`base-adapter.js`)

```js
async bookShipment(order, sender, receiver, options)
// order:    { id, total, items, ... }
// sender:   { name, phone, address, city }
// receiver: { name, phone, email, address, city }
// options:  { weight, cod_amount, pieces, length, width, height, service_code, service_type }
// resolves: { tracking_number, label_url, raw? } — throws on failure

async getTracking(trackingNumber)
// resolves: { status, events: [{ status, location, timestamp, description }] }

async cancelShipment(trackingNumber)
// resolves: { success, message? } — must NEVER throw (wrap the API call in try/catch)
```

Constructor just does `this.config = config` — no other logic in the base class.

`GenericAdapter` is the manual-courier fallback: `bookShipment` resolves `{ tracking_number: null, label_url: null, message: "Enter tracking number manually" }` (never throws), `getTracking` resolves `{ status: "unknown", events: [] }`, `cancelShipment` always resolves `{ success: true }`.

---

## What differs per adapter

### `options` fields actually consumed
- `weight`, `cod_amount` — every real adapter (`weight` defaults `0.5`; `cod_amount` truthy selects the COD service string)
- `pieces` — tcs, trax, callcourier, mnp, rider, swyft (defaults `1`)
- `length`/`width`/`height` — dhl, fedex only (centimeters; default `10` each)
- `service_code` — dhl only (defaults `"P"`)
- `service_type` — fedex only (defaults `"FEDEX_INTERNATIONAL_PRIORITY"`)

### COD vs prepaid service strings (differ per courier — copy exactly, don't guess)
leopards: `"COD"`/`"Overnight"` (field `consignment_type`) · tcs: `"COD"`/`"O"` (field `services`) · blueex: `"COD"`/`"Prepaid"` (`shipping_type`) · trax: `"COD"`/`"Non COD"` (`service_type`) · callcourier: `"7"`/`"1"` (numeric `ServiceTypeId` — 7=COD, 1=Overnight) · mnp/rider/swyft: `"COD"`/`"Non-COD"` (`service_type`) · postex: `"COD"`/`"Non COD"` (`invoiceDivision`). DHL and FedEx have no COD concept at all — `cod_amount` never enters either payload.

### Auth pattern per adapter
| Adapter | Auth |
|---|---|
| leopards | `api_key`/`api_secret` sent as `api_key`/`api_password` fields in the JSON body — not a header |
| tcs | Booking: `userName`/`password` fields in body. Tracking: `X-IBM-Client-Id: api_key` header only — `api_secret` plays no role in tracking |
| blueex | `Authorization: Bearer {api_secret}` (note: secret, not key) |
| trax | `Authorization: {api_key}` — raw value, no `Bearer` prefix |
| callcourier | `loginId`/`password` fields in the JSON body; the tracking endpoint (`GetPacketStatus`) has no auth at all |
| mnp, rider, swyft | `Authorization: Bearer {api_key}` |
| postex | `token: {api_key}` header — lowercase custom header name, not `Authorization` |
| dhl, fedex | OAuth2 client_credentials via a private `_getAuthToken()` method — **fetches a brand-new token on every single call, no caching, no expiry tracking.** Every `bookShipment`/`getTracking` costs an extra round trip to the carrier's auth endpoint first. |

### `config_json` extra fields read (beyond `api_key`/`api_secret`)
- tcs: `cost_center` → `costCenterCode` (default `""`)
- postex: `pickup_address_code`, `store_address_code` (both default `"001"`)
- dhl, fedex: `account_number` (default `""` — booking will fail carrier-side if unset)

### Base URLs — overridable via `config.api_base_url`, except
`leopards` (hardcoded to `merchantapi.leopardscourier.com`), `fedex` (hardcoded to `apis.fedex.com` on every call), and DHL's *tracking* endpoint specifically (`api.dhl.com/track/shipments` is hardcoded — only DHL's booking endpoint honors `api_base_url`). Bykea and PakPost have no base URL at all — no API exists for either.

### Response field extraction (`bookShipment` → `tracking_number`/`label_url`)
Every adapter's response JSON shape is different — read the source for the exact path, but two are notably irregular: **callcourier** reads `data.ABORTEFCN` for the tracking number (an unusual all-caps key) and never returns a `label_url`; **postex** nests everything under `data.dist.*`; **dhl**/**fedex** nest several levels deep (e.g. `data.output.transactionShipments[0].masterTrackingNumber.trackingNumber`).

### Failure detection on booking (varies — `!res.ok` alone does not cover it)
Most adapters must also inspect the parsed body even when the HTTP status is 200: leopards (`!data.status`), tcs (`data.returnStatus?.status === "FAIL"`), blueex/mnp (`data.status === "error"`), trax/swyft (`!data.tracking_number`), callcourier (`!data.Response`), postex (`!data.dist?.trackingNumber`), rider (`data.error` truthy). Only dhl and fedex rely solely on HTTP status (`!res.ok`).

### `cancelShipment` support
Adapters with a real cancel API (wrapped in try/catch, resolve `{ success: false, message }` on network failure rather than throwing): blueex, trax, mnp, postex (success check is `data.statusCode === "200"` — compared as a **string**, not a number), swyft. Everyone else — leopards, tcs, callcourier, rider, dhl, fedex, bykea, pakpost — has no cancel API and always resolves a static "contact support to cancel" message.

### Adapters that block booking entirely (501)
`bykea` and `pakpost` extend `GenericAdapter` but override `bookShipment` to throw an `Error` with `err.statusCode = 501` and `err.code = "COURIER_NO_BOOKING_API"`. This exists so the booking route never persists a ghost `order_shipments` row (`tracking_number = null`, `status = 'booked'`) that would falsely mark an order shipped and fire a "Tracking: N/A" notification SMS. Both couriers are meant to be booked manually (Bykea app / PakPost counter) with the tracking number entered by hand via the manual-ship action afterward. If `courier_integrations.supports_booking = false` is already set on the row, the route skips adapter booking before even calling `getAdapter` — the 501 throw is a code-level safety net layered on top of that flag, not the primary gate. `pakpost.getTracking` additionally returns a `tracking_url` field (`https://ep.gov.pk/track/{trackingNumber}`, tracking page at ep.gov.pk) that no other adapter provides.

---

## Adding a new courier adapter

1. Create `<name>-adapter.js`. Extend `BaseCourierAdapter` if a real booking/tracking API exists; extend `GenericAdapter` (overriding `bookShipment` to throw the 501/`COURIER_NO_BOOKING_API` error) if it doesn't.
2. Implement all three interface methods. `cancelShipment` must never throw — wrap the API call in try/catch and resolve `{ success: false, message }` on error instead.
3. Register the class in `index.js`'s `ADAPTERS` map — the key must match `courier_integrations.adapter_key` in the DB.
4. Add a seed row to `courier_integrations` (`schema-pg.sql` + a migration).
5. For any config field beyond `api_key`/`api_secret`, read `this.config.config_json?.field ?? default` — the route layer (`buildCourierAdapterConfig`) guarantees `config_json` is already a parsed object by the time the adapter sees it, so there's no need to re-parse or defend against a raw string.
6. Update this file's per-adapter tables (auth pattern, COD service strings, base URL override behavior, failure detection, cancel support).
