# Courier Adapters — Claude Guide

- **16 files**: `index.js`, `base-adapter.js`, `generic-adapter.js` + 13 courier adapters
- **Adapter pattern**: `BaseCourierAdapter` (abstract, throws on all methods) → `GenericAdapter` (manual-entry no-ops) / specific adapters
- **Factory**: `getAdapter(adapterKey, config)` from `index.js` — returns adapter instance. Falls back to `GenericAdapter` for unknown keys. `config` comes from `courier_integrations` DB row.
- **Interface**: `bookShipment(order, sender, receiver, options)`, `getTracking(trackingNumber)`, `cancelShipment(trackingNumber)`
- **`config` shape**: `{ api_key, api_secret, api_base_url?, config_json? }` — maps to DB columns on `courier_integrations`

---

## GenericAdapter

- `bookShipment` → `{ tracking_number: null, label_url: null, message: "Enter tracking number manually" }` (no throw — returns shell response for manual entry)
- `getTracking` → `{ status: "unknown", events: [] }`
- `cancelShipment` → `{ success: true }` (silent success — cancel is a no-op)

---

## `bookShipment` options

All adapters read from `options`:
- `options.weight` — kg, defaults to `0.5`
- `options.cod_amount` — determines COD vs prepaid service type; `> 0` = COD
- `options.pieces` — parcel count, defaults to `1`
- `options.length / width / height` — cm dimensions (DHL, FedEx only)
- `options.service_code` — DHL product code (default `"P"`)
- `options.service_type` — FedEx service type (default `"FEDEX_INTERNATIONAL_PRIORITY"`)

COD detection: all adapters use `options.cod_amount > 0`. Service type string varies:

| Adapter | COD value | Prepaid value |
|---------|-----------|--------------|
| leopards | `"COD"` | `"Overnight"` |
| tcs | `"COD"` | `"O"` |
| blueex | `"COD"` | `"Prepaid"` |
| trax | `"COD"` | `"Non COD"` |
| callcourier | `"7"` (ServiceTypeId) | `"1"` |
| mnp | `"COD"` | `"Non-COD"` |
| rider | `"COD"` | `"Non-COD"` |
| swyft | `"COD"` | `"Non-COD"` |
| postex | `"COD"` | `"Non COD"` |

---

## Auth patterns per adapter

| Adapter | Booking auth | Tracking auth |
|---------|-------------|--------------|
| `leopards` | `api_key` + `api_password` in JSON body | Same |
| `tcs` | `userName`/`password` in JSON body | `X-IBM-Client-Id: api_key` header only (no api_secret) |
| `blueex` | `Authorization: Bearer api_secret` | Same |
| `trax` | `Authorization: api_key` (raw, no Bearer prefix) | Same |
| `callcourier` | `loginId`/`password` in JSON body | None (public tracking endpoint) |
| `mnp` | `Authorization: Bearer api_key` | Same |
| `postex` | `token: api_key` header | Same |
| `rider` | `Authorization: Bearer api_key` | Same |
| `swyft` | `Authorization: Bearer api_key` | Same |
| `dhl` | OAuth2 `client_credentials` (per-call token exchange) | Same |
| `fedex` | OAuth2 `client_credentials` (per-call token exchange) | Same (POST to tracking endpoint, not GET) |

**DHL/FedEx token gotcha**: `_getAuthToken()` is called on every `bookShipment` and `getTracking` — no caching. Each call costs an extra HTTP round-trip. Token expiry is not checked.

---

## `config_json` extra fields required

Some adapters need fields beyond `api_key`/`api_secret` stored in `config_json`:

| Adapter | Required `config_json` fields | Default if missing |
|---------|------------------------------|-------------------|
| `tcs` | `cost_center` | `""` |
| `postex` | `pickup_address_code`, `store_address_code` | `"001"` |
| `dhl` | `account_number` | `""` (booking will fail) |
| `fedex` | `account_number` | `""` (booking will fail) |

---

## Cancel support matrix

| Adapter | `cancelShipment` behavior |
|---------|--------------------------|
| `blueex` | Calls API `POST /logistic/order/cancel` — returns `{ success, message }` |
| `trax` | Calls API `POST /shipment/cancel` — returns `{ success, message }` |
| `mnp` | Calls API `POST /shipment/cancel` — returns `{ success, message }` |
| `postex` | Calls API `POST /cancel-order` — checks `statusCode === "200"` |
| `swyft` | Calls API `POST /shipments/cancel` — returns `{ success, message }` |
| `leopards` | Returns `{ success: false, message: "Contact Leopards support to cancel" }` |
| `tcs` | Returns `{ success: false, message: "Contact TCS support..." }` |
| `callcourier` | Returns `{ success: false, message: "Contact CallCourier support..." }` |
| `rider` | Returns `{ success: false, message: "Contact Rider support..." }` |
| `dhl` | Returns `{ success: false, message: "Contact DHL support..." }` |
| `fedex` | Returns `{ success: false, message: "Contact FedEx support..." }` |
| `bykea` | Returns `{ success: false, message: "Cancel via Bykea app/dashboard" }` |
| `pakpost` | Returns `{ success: false, message: "Contact Pakistan Post..." }` |

---

## Adapters that block booking (501)

`bykea` and `pakpost` extend `GenericAdapter` but **override `bookShipment` to throw** with `err.statusCode = 501` and `err.code = "COURIER_NO_BOOKING_API"`:

- **`bykea`** — hyperlocal within-city only, no public booking API. Operators book via the Bykea app/dashboard then enter tracking manually. The throw prevents a ghost `order_shipments` row with `tracking_number = null` and status `'booked'`.
- **`pakpost`** — counter-booking only. `getTracking` returns `tracking_url: "https://ep.gov.pk/track/{trackingNumber}"` (a direct URL, unlike other adapters which return events).

If a courier integration row has `supports_booking = false`, the route will skip adapter booking; these two adapters add a safety net at the code level as well.

---

## API base URLs (and `api_base_url` override)

All adapters except `leopards`, `bykea`, and `pakpost` support a `config.api_base_url` override for sandbox/staging:

| Adapter | Default base URL |
|---------|-----------------|
| `leopards` | `https://merchantapi.leopardscourier.com/api` (hardcoded) |
| `tcs` | `https://apis.tcscourier.com` |
| `blueex` | `https://bilogia.blue-ex.com/api` |
| `trax` | `https://sonic.pk/api` *(Trax is branded as sonic.pk)* |
| `callcourier` | `https://cod.callcourier.com.pk/api/CallCourier` |
| `mnp` | `https://api.mulphico.com/api/v1` |
| `postex` | `https://api.postex.pk/services/integration/api/order` |
| `rider` | `https://api.rider.pk/api/v1` |
| `swyft` | `https://api.swyft.pk/api/v2` |
| `dhl` | `https://api.dhl.com/ecs/v1` |
| `fedex` | `https://apis.fedex.com` (hardcoded) |

---

## Adding a new courier

1. Create `<name>-adapter.js` extending `BaseCourierAdapter` (or `GenericAdapter` if no booking API)
2. Implement `bookShipment`, `getTracking`, `cancelShipment`
3. Register in `index.js` ADAPTERS map with the courier's DB slug key
4. Add a seed row to `courier_integrations` in `schema-pg.sql` and a migration
5. If no booking API exists, throw `err.statusCode = 501, err.code = "COURIER_NO_BOOKING_API"` in `bookShipment`
