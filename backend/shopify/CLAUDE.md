# backend/shopify/ — Claude Guide

Low-level Shopify Admin GraphQL client + supporting pure-function utilities. **Distinct from `backend/routes/shopify/`**, which holds the actual route handlers/business logic that call into these modules. Nothing here touches `req`/`res` or mounts routes.

---

## `client.js` — Shopify Admin GraphQL client

Exports: `verifyConnection`, `fetchShopifyLocations`, `adjustShopifyInventory`, `fetchShopifyVariantCatalog`, `fetchShopifyProductsFull`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchRecentOrders`

- All requests funnel through one internal (unexported) `shopifyGraphqlRequest(connection, query, variables, _retries = 3)` — POSTs to `https://{shop_domain}/admin/api/{api_version}/graphql.json` using `connection.access_token` (must already be decrypted — see `crypto.js` below) and `connection.api_version` (defaults to `"2025-10"` if unset on the row). An internal `sanitizeShopDomain()` strips protocol/trailing slash/path from the stored domain before building the URL.
- **Throttling**: if Shopify's cost-based limiter reports `THROTTLED` in `extensions.cost.throttleStatus` (HTTP 200, not a 429), the call retries recursively up to 3 times with a 1–2s delay based on requested query cost (`>500` → 2s, else 1s). Exhausting retries throws `"Shopify API throttled: too many retries"`.
- **Response parsing is defensive**: distinguishes empty body, non-JSON body, and wrong content-type, each with its own error message including a 180-char body preview (`previewBody`, internal) — useful when Shopify returns an HTML error page instead of JSON during an outage.
- A non-empty GraphQL `errors[]` array is a hard failure (joined messages thrown) even on HTTP 200.
- **ID conversion**: internal `toGid(type, value)` builds `gid://shopify/{type}/{id}` from a plain/numeric ID; already-prefixed `gid://` values pass through unchanged. Callers of the exported functions pass plain IDs — GID conversion happens internally, transparently.
- **Pagination**: `fetchShopifyVariantCatalog` (cap 500) and `fetchShopifyProductsFull` (cap 10000) cursor-paginate via `pageInfo.hasNextPage`/`endCursor`. `fetchShopifyProductsFull` adds a deliberate 500ms delay between pages (page size 10) to stay inside Shopify's leaky-bucket rate limit — don't remove this if you increase page size or item cap.
- **Barcode/SKU coercion**: every catalog fetcher explicitly `String()`-coerces `sku`/`barcode` — a purely numeric barcode (e.g. `"002590"`) can be parsed as an integer by `JSON.parse` and silently lose leading zeros. Preserve this pattern in any new fetcher touching SKU/barcode fields.
- `fetchRecentOrders` returns a normalized shape (lowercased `financial_status`/`fulfillment_status`, per-line `total_tax` summed from `taxLines`) — this is the shape `order-service.js` and `routes/shopify/` expect; don't change it without updating both.
- No retry/backoff for plain network errors — only the throttle path retries. Wrap calls in your own try/catch for transient network failures (DNS, timeout, connection reset).

## `crypto.js` — Shopify secret wrapper

Exports: `encryptShopifySecret(plainText)`, `decryptShopifySecret(storedText)`, `logShopifyEvent(level, event, details)`

- Thin wrapper around the generalized `services/crypto.js` (AES-256-GCM, `enc:v1:{iv}:{tag}:{ciphertext}` format) — don't reimplement encryption here; this file exists only to give Shopify call sites a domain-named import.
- Both encrypt/decrypt functions return `""` on falsy input rather than throwing — safe to call on possibly-unset connection fields.
- `logShopifyEvent` is a structured JSON console logger (`{ ts, area: "shopify_connector", event, ...details }`) writing to `console.log`/`warn`/`error` based on the `level` argument — not wired to Pino (`services/logger.js`). Use `req.log` in the route layer if you need request-correlated structured logging instead.

## `order-service.js` — web-order upsert + stock policy

Exports (factory): `createOrderService(db, getActiveShopifyConnection)` → `{ upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy }`

- **Factory, not a plain module** — takes a tenant-scoped `db` and a `getActiveShopifyConnection` callback as injected params, so the file has no direct DB/connection imports of its own. Extracted from `routes/orders.js` so `routes/shopify/*` could reuse the same logic without a require-cycle — keep it free of route-layer imports.
- **`upsertWebOrderFromShopifyPayload(payload)`** — idempotent upsert into `web_orders`/`web_order_items` keyed on `(source='shopify', external_order_id)` via `ON CONFLICT`. Always attempts `applyWebOrderStockPolicy` afterward; a stock-policy failure does **not** throw back to the caller — it's captured as `{ error: message }` in the returned `stock_policy` field, so the order upsert always "succeeds" even when stock can't be applied.
- **`applyWebOrderStockPolicy(webOrderId)`**:
  - Decides apply / reverse / no-op from `payment_status`/`order_status` via two pure predicates: `shouldApplyWebOrderStock` (paid/partially_paid/authorized, and not cancelled) and `shouldReverseWebOrderStock` (refunded/partially_refunded/voided/failed, or cancelled/canceled). Already-in-target-state calls return a `noop_already_applied`/`noop_already_reversed`/`noop_state_not_actionable` action instead of double-adjusting.
  - Resolves the outlet via `resolveWebOrderOutletId` — uses `order.outlet_id` if already set, else falls back through the active Shopify connection's `default_location_id` mapped through `shopify_location_map`. Throws if neither resolves, and stamps the failure message onto `web_orders.stock_policy_note`.
  - Resolves each line item to `product_id`/`variant_id` via `resolveWebOrderItemMapping`, in priority order: direct IDs on the payload → SKU match on `product_variants` → barcode match on `product_variants` → barcode match on `products`. **Any unmappable item aborts the whole operation** (throws, no partial stock application) and records a note on the order.
  - The actual stock mutation runs inside `db.transaction(...)`, upserting into `outlet_stock` via `ON CONFLICT(product_id, outlet_id) DO UPDATE ... quantity = outlet_stock.quantity + delta`, where `delta` is signed by direction (negative on apply, positive on reverse). This does **not** go through the shared `services/stock-ledger.js` — it's a direct `outlet_stock` upsert, separate from the POS/transfer/PO stock-movement path.

## `utils.js` — pure Shopify domain helpers (plus one DB-query function)

Exports: `baseRetryDelayMinutes`, `retryDelayMinutesWithJitter`, `evaluateWebhookTimestampWindow`, `isRetryableInventoryEventStatus`, `canApproveReconciliationRequest`, `buildWebhookIdempotencyKey`, `verifyWebhookSignature`, `maskSecret`, `getActiveShopifyConnection`

- **Retry backoff schedule** (`baseRetryDelayMinutes`): attempt 1→1min, 2→5min, 3→15min, 4→60min, 5+→240min. `retryDelayMinutesWithJitter` adds random jitter on top (0–5min at the top tier, scaled down for smaller delays) to avoid thundering-herd retries when many events fail at once.
- **`evaluateWebhookTimestampWindow(triggeredAtHeader, nowMs, maxAgeMs=10min, futureSkewMs=5min)`** — replay-attack guard. A missing header returns `ok: true` (fails **open** on absence, not on staleness); only rejects when a timestamp is present but unparseable or outside the window.
- **`verifyWebhookSignature({ rawBody, providedHmac, webhookSecret })`** — HMAC-SHA256 over the raw body, base64-encoded, compared via `crypto.timingSafeEqual`. Returns a structured `{ ok, reason }` rather than throwing (`no_secret_configured`, `missing_signature`, `invalid_signature`). **Length-checks both buffers before calling `timingSafeEqual`** (which throws on mismatched lengths) — don't remove that guard.
- **`buildWebhookIdempotencyKey({ webhookId, payload, nowMs })`** — prefers Shopify's webhook-id header (`shopify_webhook_{id}`); falls back to a synthesized key from order id + `updated_at`/`created_at` when the header is absent.
- **`isRetryableInventoryEventStatus(status)`** — case-insensitive whitelist: `failed`, `dead_letter`, `retry`, `failed_mapping`.
- **`canApproveReconciliationRequest({ requesterEmployeeId, approverEmployeeId })`** — segregation-of-duties check: both IDs must be present and must differ (blocks self-approval).
- **`maskSecret(secret, decryptFn)`** — for admin UI display. Takes an injected decrypt function (keeps this file crypto-import-free); falls back to masking the raw string if decryption throws, rather than propagating the error. Returns `"********"` for secrets ≤8 chars, else `"{first4}...{last4}"`.
- **`getActiveShopifyConnection(db, decryptFn)`** — the one function here that hits the DB. Fetches the highest-`id` row from `shopify_connections WHERE is_active = true` (schema intends only one active connection per tenant), decrypts `access_token`/`webhook_secret` via the injected `decryptFn`. Returns `null` if none active. Prefer this over querying `shopify_connections` directly from route handlers.

---

## Cross-file dependencies

- `client.js` has no dependency on the other files here — it's a pure GraphQL transport layer, callable standalone given a `connection` object with a decrypted `access_token`.
- `order-service.js` doesn't import anything else in this directory (its two params are injected by the caller) but is itself imported by `routes/orders.js` and `routes/shopify/*`.
- `crypto.js` wraps `services/crypto.js` — always go through `crypto.js`'s domain-named exports from Shopify code, never call `services/crypto.js` directly, for consistent auditing of Shopify-specific decrypt sites.
- `utils.js:getActiveShopifyConnection` is the typical `getActiveShopifyConnection` argument passed into `order-service.js`'s `createOrderService(db, getActiveShopifyConnection)` factory — check `routes/shopify/index.js` for the actual wiring.
- Any connection object passed into `client.js` functions must already have `access_token` decrypted (via `utils.js:getActiveShopifyConnection` or an equivalent decrypt step) — `client.js` never decrypts anything itself.
