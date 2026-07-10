# Courier Adapters — Claude Guide

## Overview

Adapter pattern for courier/delivery API integration. `index.js` exports `getAdapter(adapterKey, config)` — the sole entry point, mapping a courier slug to a class and returning a constructed instance. Unrecognized keys fall back to `GenericAdapter`.

Consumer: `backend/routes/couriers.js` — the only route file that calls `getAdapter()`, at four call sites (test-connection, ship-order, cancel-shipment, get-tracking). It builds the adapter config via `buildCourierAdapterConfig(row)`, which:
- `decryptSecret()`s `api_key`/`api_secret` (AES-256-GCM, format `enc:v1:{iv}:{tag}:{ciphertext}`; passes through untouched for legacy plaintext rows)
- parses `config_json` (a `TEXT` column) into an object via a local `parseCourierConfigJson()` helper — handles both a JSON string and an already-parsed object, falls back to `{}` on error

So adapters always receive **decrypted credentials and an already-parsed `config_json` object** by the time they see `this.config`. Adapters never touch `process.env` or call `decryptSecret`/`JSON.parse` themselves — that's entirely the route's job.

---

## Class hierarchy

```
BaseCourierAdapter          — abstract; every method throws "Not implemented"
├── GenericAdapter          — manual-entry no-ops; never throws
│   ├── BykeaAdapter        — overrides bookShipment to throw 501 (hyperlocal, no API)
│   └── PakPostAdapter      — overrides bookShipment to throw 501 (counter-booking only)
└── (11 named adapters extend BaseCourierAdapter directly)
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

Constructor just stores `this.config = config` — no other logic. `GenericAdapter` is the fallback for couriers with no API: `bookShipment` returns a null tracking number + "enter manually" message, `getTracking` returns `{ status: "unknown", events: [] }`, `cancelShipment` always succeeds.

---

## What differs per adapter

### `options` fields actually used
- `weight`, `cod_amount` — every adapter (weight defaults `0.5`, `cod_amount` truthy selects the COD service string)
- `pieces` — tcs, trax, callcourier, mnp, rider, swyft (defaults `1`)
- `length`/`width`/`height` — dhl, fedex only (cm; default `10` each)
- `service_code` — dhl only (defaults `"P"`)
- `service_type` — fedex only (defaults `"FEDEX_INTERNATIONAL_PRIORITY"`)

### COD vs prepaid service strings (differ per courier — copy exactly, don't guess)
leopards: `"COD"`/`"Overnight"` · tcs: `"COD"`/`"O"` · blueex: `"COD"`/`"Prepaid"` · trax: `"COD"`/`"Non COD"` · callcourier: `"7"`/`"1"` (numeric `ServiceTypeId`) · mnp/rider/swyft: `"COD"`/`"Non-COD"` · postex: `"COD"`/`"Non COD"`. DHL and FedEx have no COD concept — `cod_amount` never enters their payloads.

### Auth pattern per adapter
| Adapter | Auth |
|---|---|
| leopards | `api_key` + `api_secret` sent as `api_password` in the JSON body (not a header) |
| tcs | Booking: `userName`/`password` in body. Tracking: `X-IBM-Client-Id: api_key` header only — `api_secret` plays no role in tracking |
| blueex | `Authorization: Bearer {api_secret}` |
| trax | `Authorization: {api_key}` — raw value, no `Bearer` prefix |
| callcourier | `loginId`/`password` in JSON body; tracking endpoint has no auth at all |
| mnp, rider, swyft | `Authorization: Bearer {api_key}` |
| postex | `token: {api_key}` header — lowercase key name, not `Authorization` |
| dhl, fedex | OAuth2 client_credentials via `_getAuthToken()` — **fetches a fresh token on every single call, no caching, no expiry check.** Each `bookShipment`/`getTracking` costs an extra round trip to the auth endpoint. |

### `config_json` extra fields read (beyond `api_key`/`api_secret`)
- tcs: `cost_center` → `costCenterCode` (default `""`)
- postex: `pickup_address_code`, `store_address_code` (both default `"001"`)
- dhl, fedex: `account_number` (default `""` — booking will fail at the carrier if unset)

### Base URLs — all overridable via `config.api_base_url` EXCEPT
`leopards` (hardcoded `merchantapi.leopardscourier.com`), `fedex` (hardcoded `apis.fedex.com` everywhere), and DHL's *tracking* endpoint specifically (`api.dhl.com/track/shipments`, hardcoded — only DHL's booking endpoint honors `api_base_url`). Bykea/PakPost have no base URL — no API exists.

### Response field extraction (`bookShipment` → `tracking_number`/`label_url`)
Every adapter's JSON response shape is different — see source for exact paths, but two are notably odd: **callcourier** reads `data.ABORTEFCN` (unusual all-caps key, no `label_url` ever); **postex** nests everything under `data.dist.*`; **dhl/fedex** nest several levels deep (`data.output.transactionShipments[0]...`).

### Failure detection on booking (varies — don't assume `!res.ok` covers it)
Most adapters check the parsed body even on HTTP 200: leopards (`!data.status`), tcs (`data.returnStatus?.status === "FAIL"`), blueex/mnp (`data.status === "error"`), trax/swyft (`!data.tracking_number`), callcourier (`!data.Response`), postex (`!data.dist?.trackingNumber`), rider (`data.error` truthy). Only dhl and fedex rely solely on HTTP status.

### `cancelShipment` support
Real cancel API (wrapped try/catch, returns `{ success:false, message }` on network error instead of throwing): blueex, trax, mnp, postex (success check is `data.statusCode === "200"` — **string**, not number), swyft. Everyone else (leopards, tcs, callcourier, rider, dhl, fedex, bykea, pakpost) has no cancel API and always returns a static "contact support" message.

### Adapters that block booking entirely (501)
`bykea` and `pakpost` extend `GenericAdapter` but override `bookShipment` to throw `Error` with `err.statusCode = 501`, `err.code = "COURIER_NO_BOOKING_API"`. This exists so the route never persists a ghost `order_shipments` row (`tracking_number = null`, `status = 'booked'`) that would falsely mark an order shipped and fire a "Tracking: N/A" notification. Both are meant to be booked manually (Bykea app / PakPost counter) with the tracking number entered by hand afterward. If `courier_integrations.supports_booking = false` is already set on the row, the route skips adapter booking before even calling `getAdapter` — the 501 throw is a code-level safety net on top of that flag, not the primary gate. `pakpost.getTracking` additionally returns a `tracking_url` field (`https://ep.gov.pk/track/{trackingNumber}`) that no other adapter provides.

---

## Adding a new courier adapter

1. Create `<name>-adapter.js`. Extend `BaseCourierAdapter` if a real API exists; extend `GenericAdapter` (override `bookShipment` to throw 501/`COURIER_NO_BOOKING_API`) if not.
2. Implement all three methods per the interface above. `cancelShipment` must never throw — wrap in try/catch and return `{ success: false, message }`.
3. Register the class in `index.js`'s `ADAPTERS` map — the key must match `courier_integrations.adapter_key`.
4. Add a seed row to `courier_integrations` (`schema-pg.sql` + a migration).
5. For extra config fields beyond `api_key`/`api_secret`, read from `this.config.config_json?.field ?? default` — the route layer (`buildCourierAdapterConfig`) guarantees `config_json` is already a parsed object by the time the adapter sees it, so no need to re-parse or defend against a raw string here.
6. Update this file's per-adapter tables (auth pattern, COD string, base URL, failure detection, cancel support).
