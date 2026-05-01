# Courier Adapters — Claude Guide

## Overview

Adapter pattern for courier API integration. `index.js` exports `getAdapter(adapterKey, config)` — the sole entry point. It maps a courier slug string to a class and returns a constructed instance. Falls back to `GenericAdapter` for unrecognized keys.

`config` comes from the `courier_integrations` DB row. Shape: `{ api_key, api_secret, api_base_url?, config_json? }`. **Warning**: `config_json` is a TEXT column in the DB. `backend/routes/couriers.js` currently passes `courier.config_json` directly into adapters WITHOUT calling `JSON.parse()` first. Adapters access it like an object (e.g. `this.config.config_json?.cost_center`), so all nested fields will be `undefined` when the DB returns a raw JSON string. Callers should be aware that `config_json` may arrive as a raw string rather than a parsed object due to this missing parse in the route layer.

---

## Class hierarchy

```
BaseCourierAdapter          ← abstract; throws on all methods
├── GenericAdapter          ← manual-entry no-ops; never throws
│   ├── BykeaAdapter        ← overrides bookShipment to throw 501
│   └── PakPostAdapter      ← overrides bookShipment to throw 501; getTracking returns tracking_url
└── (all named adapters)    ← extend BaseCourierAdapter directly
```

---

## BaseCourierAdapter — method signatures

All three methods are abstract (throw `"Not implemented"`):

```js
async bookShipment(order, sender, receiver, options)
// order:    { id, total, items, ... }
// sender:   { name, phone, address, city }
// receiver: { name, phone, email, address, city }
// options:  { weight, cod_amount, pieces, length, width, height, service_code, service_type }
// returns:  { tracking_number, label_url, ...raw? }

async getTracking(trackingNumber)
// returns: { status, events: [{ status, location, timestamp, description }] }

async cancelShipment(trackingNumber)
// returns: { success, message? }
```

---

## GenericAdapter

Used when no real booking API exists and operators enter tracking numbers manually.

- `bookShipment` → `{ tracking_number: null, label_url: null, message: "Enter tracking number manually" }` — does not throw
- `getTracking` → `{ status: "unknown", events: [] }`
- `cancelShipment` → `{ success: true }`

---

## options fields

| Field | Used by | Notes |
|-------|---------|-------|
| `weight` | all | kg; defaults to `0.5` |
| `cod_amount` | all | `> 0` = COD service, `0` = prepaid |
| `pieces` | tcs, trax, callcourier, mnp, rider, swyft | parcel count; defaults to `1` |
| `length / width / height` | dhl, fedex | cm dimensions; defaults to `10` each |
| `service_code` | dhl | DHL product code; defaults to `"P"` |
| `service_type` | fedex | FedEx service type; defaults to `"FEDEX_INTERNATIONAL_PRIORITY"` |

---

## COD service type strings per adapter

| Adapter | COD | Prepaid |
|---------|-----|---------|
| `leopards` | `"COD"` | `"Overnight"` |
| `tcs` | `"COD"` | `"O"` |
| `blueex` | `"COD"` | `"Prepaid"` |
| `trax` | `"COD"` | `"Non COD"` |
| `callcourier` | `"7"` (ServiceTypeId) | `"1"` |
| `mnp` | `"COD"` | `"Non-COD"` |
| `rider` | `"COD"` | `"Non-COD"` |
| `swyft` | `"COD"` | `"Non-COD"` |
| `postex` | `"COD"` | `"Non COD"` |

DHL and FedEx have no COD concept in these adapters — `cod_amount` is not forwarded to their payloads.

---

## Auth patterns

| Adapter | Booking auth | Tracking auth |
|---------|-------------|--------------|
| `leopards` | `api_key` + `api_password` in JSON body | Same |
| `tcs` | `userName`/`password` in JSON body | `X-IBM-Client-Id: api_key` header only — `api_secret` not used for tracking |
| `blueex` | `Authorization: Bearer api_secret` | Same |
| `trax` | `Authorization: api_key` (raw, no Bearer prefix) | Same |
| `callcourier` | `loginId`/`password` in JSON body | No auth header — public tracking endpoint |
| `mnp` | `Authorization: Bearer api_key` | Same |
| `postex` | `token: api_key` header (lowercase `token`, not `Authorization`) | Same |
| `rider` | `Authorization: Bearer api_key` | Same |
| `swyft` | `Authorization: Bearer api_key` | Same |
| `dhl` | OAuth2 `client_credentials` via `_getAuthToken()` | Same |
| `fedex` | OAuth2 `client_credentials` via `_getAuthToken()` | Same |

**DHL/FedEx token gotcha**: `_getAuthToken()` is called on every `bookShipment` and `getTracking` — no caching. Each call adds an extra HTTP round-trip. Token expiry is never checked. DHL token endpoint: `POST https://api.dhl.com/ecs/v1/auth/accesstoken`. FedEx token endpoint: `POST https://apis.fedex.com/oauth/token`.

**Leopards gotcha**: `api_secret` is mapped to the field name `api_password` in the JSON body — not `api_secret`.

**TCS gotcha**: booking sends both `userName`/`password` in the body; tracking uses only `X-IBM-Client-Id: api_key` with no `api_secret` at all.

---

## config_json extra fields

Some adapters need fields beyond `api_key`/`api_secret`, stored in `config_json` on the `courier_integrations` row:

| Adapter | Field | Key | Default if missing |
|---------|-------|-----|--------------------|
| `tcs` | Cost center | `cost_center` | `""` |
| `postex` | Pickup address code | `pickup_address_code` | `"001"` |
| `postex` | Store address code | `store_address_code` | `"001"` |
| `dhl` | DHL account number | `account_number` | `""` — booking will fail at DHL |
| `fedex` | FedEx account number | `account_number` | `""` — booking will fail at FedEx |

---

## API base URLs

All adapters except `leopards`, `fedex`, `bykea`, and `pakpost` read `config.api_base_url` first, enabling sandbox/staging overrides.

| Adapter | Default base URL |
|---------|-----------------|
| `leopards` | `https://merchantapi.leopardscourier.com/api` (hardcoded in URL strings) |
| `tcs` | `https://apis.tcscourier.com` |
| `blueex` | `https://bilogia.blue-ex.com/api` |
| `trax` | `https://sonic.pk/api` — Trax is branded as sonic.pk |
| `callcourier` | `https://cod.callcourier.com.pk/api/CallCourier` |
| `mnp` | `https://api.mulphico.com/api/v1` |
| `postex` | `https://api.postex.pk/services/integration/api/order` |
| `rider` | `https://api.rider.pk/api/v1` |
| `swyft` | `https://api.swyft.pk/api/v2` |
| `dhl` | `https://api.dhl.com/ecs/v1` (booking); `https://api.dhl.com/track/shipments` (tracking — hardcoded, ignores `api_base_url`) |
| `fedex` | `https://apis.fedex.com` (hardcoded in all URL strings) |

---

## Booking endpoint paths

| Adapter | Booking endpoint |
|---------|-----------------|
| `leopards` | `POST /api/bookPacket/format/json/` |
| `tcs` | `POST /production/v1/cod/create-order` |
| `blueex` | `POST /logistic/order/add` |
| `trax` | `POST /shipment/book` |
| `callcourier` | `POST /SaveBooking` |
| `mnp` | `POST /shipment/create` |
| `postex` | `POST /v3/create-order` |
| `rider` | `POST /shipments` |
| `swyft` | `POST /shipments` |
| `dhl` | `POST /shipments` |
| `fedex` | `POST https://apis.fedex.com/ship/v1/shipments` |

---

## Tracking endpoint paths

| Adapter | Tracking endpoint | Method |
|---------|------------------|--------|
| `leopards` | `/api/trackBookedPacket/format/json/` | POST (sends `track_numbers` in body) |
| `tcs` | `/production/v1/track?consignmentNo=…` | GET |
| `blueex` | `/logistic/tracking/{trackingNumber}` | GET |
| `trax` | `/shipment/track?tracking_number=…` | GET |
| `callcourier` | `/GetPacketStatus?cn=…` | GET (no auth) |
| `mnp` | `/shipment/track/{trackingNumber}` | GET |
| `postex` | `/v1/track-order?trackingNumber=…` | GET |
| `rider` | `/shipments/track/{trackingNumber}` | GET |
| `swyft` | `/shipments/track?tracking_number=…` | GET |
| `dhl` | `https://api.dhl.com/track/shipments?trackingNumber=…` (hardcoded, ignores `api_base_url`) | GET |
| `fedex` | `https://apis.fedex.com/track/v1/trackingnumbers` | POST (sends body with `trackingInfo`) |

---

## bookShipment return shape

All adapters return `{ tracking_number, label_url, raw? }`. Specific quirks:

| Adapter | tracking_number source | label_url source |
|---------|----------------------|-----------------|
| `leopards` | `data.track_number \|\| data.slip_link` | `data.slip_link` |
| `tcs` | `data.bookingReply.consignmentNo` | `data.bookingReply.labelUrl` |
| `blueex` | `data.cn_number \|\| data.tracking_number` | `data.label_url` |
| `trax` | `data.tracking_number` | `data.label_url` |
| `callcourier` | `data.ABORTEFCN` (all caps) | always `null` |
| `mnp` | `data.tracking_number \|\| data.cn_number` | `data.label_url` |
| `postex` | `data.dist.trackingNumber` | `data.dist.labelUrl` |
| `rider` | `data.tracking_number \|\| data.cn_number` | `data.label_url` |
| `swyft` | `data.tracking_number` | `data.label_url` |
| `dhl` | `data.shipmentTrackingNumber` | `data.documents[0].url` |
| `fedex` | `data.output.transactionShipments[0].masterTrackingNumber.trackingNumber` | `data.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].url` |

---

## Error detection per adapter

Each adapter checks for errors differently before returning:

| Adapter | Failure condition |
|---------|-----------------|
| `leopards` | `!data.status \|\| data.status === 0` |
| `tcs` | `data.returnStatus?.status === "FAIL"` or non-2xx HTTP |
| `blueex` | `data.status === "error"` |
| `trax` | `!data.tracking_number` |
| `callcourier` | `!data.Response` (capital R) |
| `mnp` | `data.status === "error"` |
| `postex` | `!data.dist?.trackingNumber` |
| `rider` | `data.error` (truthy) |
| `swyft` | `!data.tracking_number` |
| `dhl` | non-2xx HTTP |
| `fedex` | non-2xx HTTP |

---

## cancelShipment support matrix

| Adapter | Behavior |
|---------|---------|
| `blueex` | Calls `POST /logistic/order/cancel` with `{ cn_number }` — returns `{ success, message }` |
| `trax` | Calls `POST /shipment/cancel` with `{ tracking_number }` — returns `{ success, message }` |
| `mnp` | Calls `POST /shipment/cancel` with `{ tracking_number }` — returns `{ success, message }` |
| `postex` | Calls `POST /v1/cancel-order` with `{ trackingNumber }` — success when `statusCode === "200"` (string) |
| `swyft` | Calls `POST /shipments/cancel` with `{ tracking_number }` — returns `{ success, message }` |
| `leopards` | Returns `{ success: false, message: "Contact Leopards support to cancel" }` |
| `tcs` | Returns `{ success: false, message: "Contact TCS support to cancel shipments" }` |
| `callcourier` | Returns `{ success: false, message: "Contact CallCourier support to cancel shipments" }` |
| `rider` | Returns `{ success: false, message: "Contact Rider support to cancel shipments" }` |
| `dhl` | Returns `{ success: false, message: "Contact DHL support to cancel shipments" }` |
| `fedex` | Returns `{ success: false, message: "Contact FedEx support to cancel shipments" }` |
| `bykea` | Returns `{ success: false, message: "Cancel via Bykea app/dashboard" }` |
| `pakpost` | Returns `{ success: false, message: "Contact Pakistan Post to cancel shipments" }` |

Cancel adapters that call APIs (`blueex`, `trax`, `mnp`, `swyft`, `postex`) wrap in `try/catch` and return `{ success: false, message: err.message }` on network error — they never throw from `cancelShipment`.

---

## Adapters that block booking (501)

`bykea` and `pakpost` extend `GenericAdapter` but override `bookShipment` to throw with `err.statusCode = 501` and `err.code = "COURIER_NO_BOOKING_API"`.

**bykea** — hyperlocal within-city delivery, no public booking API. Operators book via the Bykea app and enter the tracking number manually. The throw prevents a ghost `order_shipments` row with `tracking_number = null` and status `'booked'`. `getTracking` returns `{ status: "Track via Bykea app", events: [] }`.

**pakpost** — counter-booking only. `getTracking` returns a direct `tracking_url: "https://ep.gov.pk/track/{trackingNumber}"` field in addition to `status` and `events`. This is unique — other adapters return only `status` and `events`.

If a `courier_integrations` row has `supports_booking = false`, the route skips adapter booking anyway. These two adapters add a code-level safety net on top of that.

---

## Adding a new courier adapter

1. Create `<name>-adapter.js`. If the courier has a booking API, extend `BaseCourierAdapter`. If not, extend `GenericAdapter` and override `bookShipment` to throw `501 / COURIER_NO_BOOKING_API`.
2. Implement `bookShipment`, `getTracking`, `cancelShipment`.
3. Register in `index.js` `ADAPTERS` map with the adapter key matching the `courier_integrations.adapter_key` DB column (not `slug` — the relevant column is `adapter_key`).
4. Add a seed row to `courier_integrations` in `schema-pg.sql` and a migration.
5. If `config_json` extra fields are required, document them in the courier's row and handle with `this.config.config_json?.field || default`. **Note**: due to the missing `JSON.parse()` in the route layer, `config_json` may reach your adapter as a raw JSON string; access like `this.config.config_json?.field` will yield `undefined` in that case. Until the route layer is fixed, add a defensive parse: `const extra = typeof this.config.config_json === 'string' ? JSON.parse(this.config.config_json) : (this.config.config_json || {})`.

Standard `bookShipment` contract:
- Throw on booking failure (the route catches and returns 500 / passes status code from `err.statusCode`).
- Return `{ tracking_number, label_url }` at minimum; add `raw: data` for debugging.

Standard `cancelShipment` contract:
- Never throw — always return `{ success: bool, message: string }`. Wrap API calls in `try/catch`.

---

## No environment variables

These adapters read no `process.env` variables. All credentials come from `this.config` (the `courier_integrations` DB row, passed in via `getAdapter(key, config)`). Credential encryption/decryption is handled upstream by `services/crypto.js` before `config` reaches the adapter.
