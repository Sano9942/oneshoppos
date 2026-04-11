# Phase 5 review — Pakistan Integration Depth

## Summary
- Files reviewed: 14
- Critical findings: 2
- High findings: 3
- Medium findings: 2
- Low/pattern findings: 2

---

## Critical findings

### C1 — `encrypted_config_json` never read by adapters; booking routes still use plaintext credential columns
**File**: `backend/routes/couriers.js:270–275` and `backend/services/couriers/leopards-adapter.js:5–8`
**Seam**: Cross-phase with pre-existing code (v5/v17 courier_integrations rows)
**Finding**: v25 adds `encrypted_config_json` to `courier_integrations` with NULL default, described as "secure credential storage." However, the booking route builds adapter config from `courier.api_key`, `courier.api_secret`, `courier.api_base_url`, `courier.config_json` — it **never reads `encrypted_config_json` and never calls `decryptSecret`**. The Leopards adapter (and every real adapter) reads from `this.config.api_key` / `this.config.api_secret` — the pre-v17 plaintext columns. The encrypted column is added and never used. Tenants who save credentials into it via future UI will find bookings silently use stale or empty `api_key` values.
**Reproduction**: Save courier credentials in `encrypted_config_json` but leave `api_key` empty. Attempt `POST /api/orders/:id/shipments/book`. Adapter receives `api_key: null`, throws "credentials not configured."
**Evidence**:
```js
// routes/couriers.js:270–275 — never reads encrypted_config_json
const adapter = getAdapter(courier.adapter_key, {
  api_key: courier.api_key,       // OLD plaintext column
  api_secret: courier.api_secret,
  api_base_url: courier.api_base_url,
  config_json: courier.config_json,
});
```

---

### C2 — COD settlement auto-match joins on `web_orders.active_shipment_id` which is NULL for all pre-Phase-5 orders
**File**: `backend/routes/fulfillment.js` (COD auto-match endpoint)
**Seam**: Cross-phase with Phase 1 (storefront) and pre-existing orders
**Finding**: v25 adds `web_orders.active_shipment_id` (NULL default, no backfill). COD settlement auto-match joins `cod_settlement_lines` to `web_orders` via `active_shipment_id` or `tracking_number`. For all orders created before v25 — including Phase 1 storefront orders which set `tracking_number` directly but never create `order_shipments` rows — `active_shipment_id` is NULL. The auto-match returns zero rows for these orders, silently failing to match the bulk of existing data.
**Reproduction**: Import a COD batch CSV for orders shipped via the legacy `POST /api/orders/:id/ship` route. Run auto-match. All lines remain `unmatched` even when tracking numbers match.

---

## High findings

### H1 — pakpost and bykea stubs return apparent success instead of throwing
**File**: `backend/services/couriers/pakpost-adapter.js:9–14` and `backend/services/couriers/bykea-adapter.js:9–16`
**Seam**: in-phase
**Finding**: Both stubs override `bookShipment` to return `{ tracking_number: null, label_url: null, message: "..." }` — a non-throwing success-shaped response. The booking route inserts an `order_shipments` row with `status: 'booked'` and null tracking, then updates `web_orders.shipping_provider_status = 'booked'`. **Order appears fully shipped in the UI with no tracking number.** SMS to customer says "Tracking: N/A".
**Reproduction**: `POST /api/orders/:id/shipments/book` with courier_id pointing to PakPost or Bykea. No error. Order silently marked shipped with null tracking.

---

### H2 — `web_order_transactions` new columns not populated by non-webhook inserts
**File**: `backend/routes/orders.js:576`
**Seam**: Cross-phase with pre-existing code
**Finding**: v25 adds `provider_ref`, `payment_context`, `webhook_event_id` to `web_order_transactions`. `routes/orders.js:576` INSERT lists: `web_order_id, external_txn_id, gateway, kind, status, amount, processed_at, raw_payload` — none of the new columns. Any POS-created or admin-created transaction has all three new columns NULL. A subsequent xPay webhook for the same order inserts a **second** transaction row via `webhooks.js:94` rather than updating the existing one — transaction rows accumulate.
(Note: `billing.js` was correctly updated to populate `provider`; the `payment_intents.provider` gap is narrower than the map suggested.)

---

### H3 — SMS feature flag `phase5_sms_providers` not checked in `notifyCustomerSms` (billing/plan enforcement gap)
**File**: `backend/routes/couriers.js:8–30`
**Seam**: in-phase
**Finding**: `notifyCustomerSms` calls `sms.sendSms(db, ...)` directly without checking `phase5_sms_providers`. The flag is only enforced at the SMS configuration endpoint in `credentials.js:96`. A tenant with an `integration_settings` SMS row (possibly seeded or pre-existing) can receive SMS notifications on every shipment booking regardless of the feature flag — **lower-tier tenants can get SMS for free**.

---

## Medium findings

### M1 — `phase5_payment_gateways` flag seeded but never gates any route
**File**: `backend/migrate-pg.js:2666` / `backend/middleware/feature-flags.js:85`
**Seam**: in-phase
**Finding**: Flag is seeded and registered in `DEFAULT_FEATURE_FLAGS` but grep finds zero `requireFeature("phase5_payment_gateways")` calls. Storefront `/pay` endpoint and webhooks are not gated. Toggling the flag has no effect.

### M2 — `getLabel` method missing from base adapter interface and all adapters
**File**: `backend/services/couriers/base-adapter.js`
**Seam**: in-phase
**Finding**: `BaseCourierAdapter` defines `bookShipment`, `getTracking`, `cancelShipment` — **no `getLabel`**. No adapter implements it. No route calls it. But v25 adds `supports_labels` to `courier_integrations` and the flag is used in the GET response. Any frontend that shows a "Get Label" button based on `supports_labels = true` will have no working endpoint.

---

## Low / design drift patterns

### P1 — Booking route passes plaintext credential fields to adapters in 3 locations
**Affected files**: `backend/routes/couriers.js` (lines 150–155, 270–275, 391–396)
**Description**: Three locations (test-booking, book, cancel) pass `api_key`, `api_secret`, `config_json` (plaintext columns) directly. The `services/crypto.js` `decryptSecret` function used by all other integrations (Shopify, Daraz, Facebook, etc.) is not imported. Creates a permanent split between the "secure credential storage" documentation and actual behavior.

### P2 — Interface naming drift: adapter methods named `bookShipment`/`getTracking`/`cancelShipment` but docs describe them as `book`/`track`/`cancel`
**Affected files**: `backend/services/couriers/base-adapter.js`, all 13 adapters, CLAUDE.md
**Description**: Docs (including interconnection map section 5) say `book`/`track`/`cancel`. Real code uses `bookShipment`/`getTracking`/`cancelShipment`. Developers following CLAUDE.md to add a new adapter would implement `book()` and find it falls through to `BaseCourierAdapter.bookShipment()` which throws "Not implemented."

---

## Cross-phase observations
- `routes/orders.js:576`: Phase 1 / pre-phase scope, but duplicate transaction accumulation is flagged here.
- `services/booking-reminders.js` (Phase 4): dead code confirmed.
- `routes/storefront.js`: the `/api/storefront/orders/:orderToken/pay` endpoint has no frontend consumer (per map section 7). The `storefront_payment_sessions` insert on the backend is correct and sets `provider`.

---

## Seams verified clean
- V2 (payment_intents.provider): `billing.js:240` correctly populates `provider`. The remaining gap is only on the non-payment_intents paths, not `payment_intents` itself.
- V6 (loadsheets extension): all 6 new columns use `ADD COLUMN IF NOT EXISTS` with appropriate defaults.
- V8 (SMS service architecture): `services/sms.js` correctly implements the adapter pattern with `resolveProvider`, decrypts via crypto.js, persists to `sms_provider_messages`, fails gracefully.
- V9 (webhook event dedup): `webhooks.js:35–43` uses `ON CONFLICT (provider, event_id) DO NOTHING`. Idempotency correct.
- V10 (shipping automation feature flag gating): all 4 Phase 5 booking routes have `requireFeature("phase5_shipping_automation")`.
- v25 DDL ordering: `active_shipment_id REFERENCES order_shipments(id)` added after `order_shipments` is created. Safe.
