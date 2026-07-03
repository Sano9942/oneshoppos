# Courier Adapters — Claude Guide

## Overview

Adapter pattern for courier/delivery API integration. `index.js` exports `getAdapter(adapterKey, config)` — the sole entry point, mapping a courier slug to a class and returning a constructed instance. Unrecognized keys fall back to `GenericAdapter`.

Consumer: `backend/routes/couriers.js` — the only route file that calls `getAdapter()`. It reads `courier_integrations` rows and constructs adapters at four call sites: courier test-connection, ship-order, cancel-shipment, get-tracking.

`config` passed to `getAdapter` is built from the `courier_integrations` DB row: `{ api_key, api_secret, api_base_url, config_json }`. **Gotcha**: `config_json` is a TEXT column. `routes/couriers.js` passes `courier.config_json` straight through at every `getAdapter()` call site (ship, cancel, track) WITHOUT `JSON.parse()`. The only place the route casts it to jsonb is on the update/PATCH write path, not on read. So adapters accessing `this.config.config_json?.field` will get `undefined` if the DB driver returns a raw JSON string instead of a parsed object — verify at the call site before assuming it's parsed.

Credential decryption (`services/crypto.js`) happens upstream in the route layer — adapters always receive already-decrypted `api_key`/`api_secret`.

---

## Class hierarchy

```
BaseCourierAdapter          — abstract; every method throws "Not implemented"
├── GenericAdapter          — manual-entry no-ops; never throws
│   ├── BykeaAdapter        — overrides bookShipment to throw 501 (hyperlocal, no API)
│   └── PakPostAdapter      — overrides bookShipment to throw 501; getTracking adds tracking_url
└── (all 11 named adapters) — extend BaseCourierAdapter directly:
    leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, dhl, fedex
```

---

## BaseCourierAdapter interface (`base-adapter.js`)

Every adapter must implement three async methods:

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
// resolves: { success, message? } — must NEVER throw
```

Constructor takes `config` and stores it as `this.config` — no other constructor logic.

---

## GenericAdapter (`generic-adapter.js`)

Used for couriers with no API integration — operator enters the tracking number by hand.

- `bookShipment` → `{ tracking_number: null, label_url: null, message: "Enter tracking number manually" }` — does not throw
- `getTracking` → `{ status: "unknown", events: [] }`
- `cancelShipment` → `{ success: true }`

---

## `options` fields by adapter

| Field | Used by | Notes |
|-------|---------|-------|
| `weight` | all | kg; defaults to `0.5` |
| `cod_amount` | all | `> 0` selects the COD service string, `0`/absent selects prepaid |
| `pieces` | tcs, trax, callcourier, mnp, rider, swyft | parcel count; defaults to `1` |
| `length` / `width` / `height` | dhl, fedex | cm dimensions; default `10` each |
| `service_code` | dhl | DHL product code; defaults to `"P"` |
| `service_type` | fedex | FedEx service type; defaults to `"FEDEX_INTERNATIONAL_PRIORITY"` |

---

## COD vs prepaid service strings

| Adapter | COD | Prepaid |
|---------|-----|---------|
| leopards | `"COD"` | `"Overnight"` |
| tcs | `"COD"` | `"O"` |
| blueex | `"COD"` | `"Prepaid"` |
| trax | `"COD"` | `"Non COD"` |
| callcourier | `"7"` (ServiceTypeId) | `"1"` |
| mnp | `"COD"` | `"Non-COD"` |
| rider | `"COD"` | `"Non-COD"` |
| swyft | `"COD"` | `"Non-COD"` |
| postex | `"COD"` | `"Non COD"` |

DHL and FedEx have no COD concept — `cod_amount` is never forwarded into their payloads.

---

## Auth patterns

| Adapter | Booking auth | Tracking auth |
|---------|-------------|--------------|
| leopards | `api_key` + `api_secret` (as `api_password`) in JSON body | same |
| tcs | `userName`/`password` in JSON body | `X-IBM-Client-Id: api_key` header only — `api_secret` unused |
| blueex | `Authorization: Bearer api_secret` | same |
| trax | `Authorization: api_key` (raw value, no `Bearer` prefix) | same |
| callcourier | `loginId`/`password` in JSON body | no auth header — public endpoint |
| mnp | `Authorization: Bearer api_key` | same |
| postex | `token: api_key` header (lowercase, not `Authorization`) | same |
| rider | `Authorization: Bearer api_key` | same |
| swyft | `Authorization: Bearer api_key` | same |
| dhl | OAuth2 client_credentials via `_getAuthToken()` | same |
| fedex | OAuth2 client_credentials via `_getAuthToken()` | same |

**Leopards gotcha**: `config.api_secret` is sent in the JSON body under the key `api_password`, not `api_secret`.

**TCS gotcha**: booking uses both `userName`/`password`; tracking uses only `X-IBM-Client-Id: api_key` — `api_secret` plays no role in tracking at all.

**DHL/FedEx gotcha**: `_getAuthToken()` runs on every `bookShipment`/`getTracking` call — no token caching, no expiry check. Each call costs an extra round trip. DHL token endpoint: `POST https://api.dhl.com/ecs/v1/auth/accesstoken`. FedEx token endpoint: `POST https://apis.fedex.com/oauth/token`.

---

## `config_json` extra fields

Beyond `api_key`/`api_secret`, some adapters read extra fields from `config.config_json`:

| Adapter | Field | Key | Default if missing |
|---------|-------|-----|--------------------|
| tcs | Cost center | `cost_center` | `""` |
| postex | Pickup address code | `pickup_address_code` | `"001"` |
| postex | Store address code | `store_address_code` | `"001"` |
| dhl | DHL account number | `account_number` | `""` — booking fails at DHL |
| fedex | FedEx account number | `account_number` | `""` — booking fails at FedEx |

Remember the parsing gotcha above — if `config_json` arrives as a raw string, all of these resolve to the default, not silently to the real value.

---

## API base URLs

Every adapter except `leopards`, `fedex`, and DHL's tracking endpoint reads `config.api_base_url` first (sandbox/staging override). Bykea/PakPost have no base URL at all (no API).

| Adapter | Default base URL |
|---------|-----------------|
| leopards | `https://merchantapi.leopardscourier.com/api` (hardcoded, ignores `api_base_url`) |
| tcs | `https://apis.tcscourier.com` |
| blueex | `https://bilogia.blue-ex.com/api` |
| trax | `https://sonic.pk/api` — Trax is branded as sonic.pk |
| callcourier | `https://cod.callcourier.com.pk/api/CallCourier` |
| mnp | `https://api.mulphico.com/api/v1` |
| postex | `https://api.postex.pk/services/integration/api/order` |
| rider | `https://api.rider.pk/api/v1` |
| swyft | `https://api.swyft.pk/api/v2` |
| dhl | `https://api.dhl.com/ecs/v1` (booking); `https://api.dhl.com/track/shipments` (tracking — hardcoded, ignores `api_base_url`) |
| fedex | `https://apis.fedex.com` (hardcoded everywhere) |

---

## Booking endpoints

| Adapter | Endpoint |
|---------|----------|
| leopards | `POST /api/bookPacket/format/json/` |
| tcs | `POST /production/v1/cod/create-order` |
| blueex | `POST /logistic/order/add` |
| trax | `POST /shipment/book` |
| callcourier | `POST /SaveBooking` |
| mnp | `POST /shipment/create` |
| postex | `POST /v3/create-order` |
| rider | `POST /shipments` |
| swyft | `POST /shipments` |
| dhl | `POST /shipments` |
| fedex | `POST https://apis.fedex.com/ship/v1/shipments` |

## Tracking endpoints

| Adapter | Endpoint | Method |
|---------|---------|--------|
| leopards | `/api/trackBookedPacket/format/json/` (sends `track_numbers` in body) | POST |
| tcs | `/production/v1/track?consignmentNo=…` | GET |
| blueex | `/logistic/tracking/{trackingNumber}` | GET |
| trax | `/shipment/track?tracking_number=…` | GET |
| callcourier | `/GetPacketStatus?cn=…` (no auth) | GET |
| mnp | `/shipment/track/{trackingNumber}` | GET |
| postex | `/v1/track-order?trackingNumber=…` | GET |
| rider | `/shipments/track/{trackingNumber}` | GET |
| swyft | `/shipments/track?tracking_number=…` | GET |
| dhl | `https://api.dhl.com/track/shipments?trackingNumber=…` (hardcoded) | GET |
| fedex | `https://apis.fedex.com/track/v1/trackingnumbers` (sends `trackingInfo` in body) | POST |

---

## `bookShipment` return shape

Contract is always `{ tracking_number, label_url, raw? }`. Field sourcing per adapter:

| Adapter | `tracking_number` from | `label_url` from |
|---------|------------------------|-------------------|
| leopards | `data.track_number \|\| data.slip_link` | `data.slip_link` |
| tcs | `data.bookingReply.consignmentNo` | `data.bookingReply.labelUrl` |
| blueex | `data.cn_number \|\| data.tracking_number` | `data.label_url` |
| trax | `data.tracking_number` | `data.label_url` |
| callcourier | `data.ABORTEFCN` (all caps, unusual name) | always `null` |
| mnp | `data.tracking_number \|\| data.cn_number` | `data.label_url` |
| postex | `data.dist.trackingNumber` | `data.dist.labelUrl` |
| rider | `data.tracking_number \|\| data.cn_number` | `data.label_url` |
| swyft | `data.tracking_number` | `data.label_url` |
| dhl | `data.shipmentTrackingNumber` | `data.documents[0].url` |
| fedex | `data.output.transactionShipments[0].masterTrackingNumber.trackingNumber` | `data.output.transactionShipments[0].pieceResponses[0].packageDocuments[0].url` |

## `getTracking` return shape

Contract is `{ status, events: [{ status, location, timestamp, description }] }`. `pakpost` uniquely adds a `tracking_url` field alongside `status`/`events`. `bykea` returns a static `"Track via Bykea app"` status with empty events (no real API).

---

## Error detection (booking failure)

| Adapter | Failure condition |
|---------|-------------------|
| leopards | `!data.status \|\| data.status === 0` |
| tcs | `data.returnStatus?.status === "FAIL"`, or non-2xx HTTP |
| blueex | `data.status === "error"` |
| trax | `!data.tracking_number` |
| callcourier | `!data.Response` (capital R) |
| mnp | `data.status === "error"` |
| postex | `!data.dist?.trackingNumber` |
| rider | `data.error` truthy |
| swyft | `!data.tracking_number` |
| dhl | non-2xx HTTP only |
| fedex | non-2xx HTTP only |

---

## `cancelShipment` support matrix

Adapters that call a real cancel API (wrapped in try/catch, never throw — return `{ success: false, message: err.message }` on network error instead):

| Adapter | Endpoint | Success check |
|---------|----------|---------------|
| blueex | `POST /logistic/order/cancel` `{ cn_number }` | `data.status === "success"` |
| trax | `POST /shipment/cancel` `{ tracking_number }` | `data.success` |
| mnp | `POST /shipment/cancel` `{ tracking_number }` | `data.status === "success"` |
| postex | `POST /v1/cancel-order` `{ trackingNumber }` | `data.statusCode === "200"` (string, not number) |
| swyft | `POST /shipments/cancel` `{ tracking_number }` | `data.success` |

Adapters with no cancel API — always return a static `{ success: false, message: "Contact <courier> support/app to cancel shipments" }`: `leopards`, `tcs`, `callcourier`, `rider`, `dhl`, `fedex`, `bykea` (message references the Bykea app), `pakpost`.

---

## Adapters that block booking (501)

`bykea` and `pakpost` extend `GenericAdapter` but override `bookShipment` to throw an `Error` with `err.statusCode = 501` and `err.code = "COURIER_NO_BOOKING_API"`.

- **bykea** — hyperlocal within-city courier, no public booking API. The throw prevents the route from persisting a ghost `order_shipments` row (`tracking_number = null`, status `'booked'`) that would falsely mark the order shipped and fire a "Tracking: N/A" notification. Operators book via the Bykea app and enter the tracking number manually.
- **pakpost** — counter-booking only. Same 501 rationale. `getTracking` adds `tracking_url: "https://ep.gov.pk/track/{trackingNumber}"`.

If a `courier_integrations` row already has `supports_booking = false`, the route skips adapter booking before even calling `getAdapter` — these two adapters' 501 throws are a code-level safety net on top of that flag, not the primary gate.

---

## No environment variables

None of these adapters read `process.env`. All credentials and config flow in through the constructor argument (`this.config`), sourced from the `courier_integrations` row. Decryption happens in `routes/couriers.js` before construction, not in the adapter.

---

## Adding a new courier adapter

1. Create `<name>-adapter.js`. Extend `BaseCourierAdapter` if a real booking API exists; extend `GenericAdapter` (and override `bookShipment` to throw 501/`COURIER_NO_BOOKING_API`) if not.
2. Implement `bookShipment`, `getTracking`, `cancelShipment` per the contracts above. `cancelShipment` must never throw.
3. Register the class in `index.js`'s `ADAPTERS` map — the key must match `courier_integrations.adapter_key` (not `slug`).
4. Add a seed row to `courier_integrations` (`schema-pg.sql` + migration).
5. If extra config fields are needed beyond `api_key`/`api_secret`, read them from `this.config.config_json?.field ?? default`, and defensively handle the string-vs-object gotcha:
   ```js
   const extra = typeof this.config.config_json === "string"
     ? JSON.parse(this.config.config_json)
     : (this.config.config_json || {});
   ```
6. Update this file's tables (auth pattern, base URL, endpoints, error detection, cancel behavior).
