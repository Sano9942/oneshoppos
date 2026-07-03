# backend/shopify/ — Claude Guide

Low-level Shopify Admin GraphQL client + supporting pure-function utilities. **Distinct from `backend/routes/shopify/`**, which contains the actual route handlers/business logic that call into these modules. Nothing here touches `req`/`res` or mounts routes.

---

## `client.js` — Shopify Admin GraphQL client

Exports: `verifyConnection`, `fetchShopifyLocations`, `adjustShopifyInventory`, `fetchShopifyVariantCatalog`, `fetchShopifyProductsFull`, `fetchInventoryLevel`, `fetchInventoryLevelsBatch`, `fetchRecentOrders`

- All requests go through a single internal `shopifyGraphqlRequest(connection, query, variables, _retries = 3)` — POSTs to `https://{shop_domain}/admin/api/{api_version}/graphql.json` using `connection.access_token` (must already be decrypted — see `crypto.js` below) and `connection.api_version` (defaults to `"2025-10"` if unset on the row).
- **Throttling**: if Shopify's cost-based rate limiter reports `THROTTLED`, the request auto-retries recursively (up to 3 times) with a 1–2s delay based on requested query cost. Exhausting retries throws.
- **Response parsing is defensive**: handles non-JSON bodies, wrong content-type, and empty bodies with distinct error messages including a truncated body preview (`previewBody`, 180 chars) — useful when Shopify returns an HTML error page instead of JSON (e.g. during an outage).
- GraphQL `errors[]` array is treated as a hard failure (throws joined error messages) even on HTTP 200.
- **ID conversion**: `toGid(type, value)` converts numeric/plain IDs to Shopify's `gid://shopify/{type}/{id}` format; already-prefixed `gid://` values pass through unchanged. Used internally for inventory item/location IDs — callers pass plain IDs, not GIDs.
- **Pagination**: `fetchShopifyVariantCatalog` and `fetchShopifyProductsFull` cursor-paginate via `pageInfo.hasNextPage`/`endCursor`, capped by `maxItems` (default 500 / 10000 respectively). `fetchShopifyProductsFull` adds a deliberate 500ms delay between pages to stay inside Shopify's leaky-bucket rate limit — don't remove this if you increase page size.
- **Barcode/SKU coercion**: both catalog-fetching functions explicitly `String()`-coerce `sku`/`barcode` fields — Shopify/JSON.parse can interpret a purely numeric barcode as an integer and silently drop leading zeros. Preserve this pattern in any new fetcher that touches SKU/barcode.
- `fetchRecentOrders` returns normalized order + line-item shape (lowercased `financial_status`/`fulfillment_status`, computed `total_tax` per line from `taxLines`) — this is the shape `order-service.js` and `routes/shopify/` expect.
- No retry/backoff for plain network errors — only the throttle-specific path retries. Callers should wrap in their own try/catch for transient network failures.

## `crypto.js` — Shopify secret wrapper

Exports: `encryptShopifySecret(plainText)`, `decryptShopifySecret(storedText)`, `logShopifyEvent(level, event, details)`

- Thin wrapper around the generalized `services/crypto.js` (AES-256-GCM, `enc:v1:{iv}:{tag}:{ciphertext}` format) — do not reimplement encryption here; this file exists only to give Shopify call sites a domain-named import.
- Both functions return `""` on empty/falsy input rather than throwing — safe to call on possibly-unset connection fields.
- `logShopifyEvent` — structured JSON console logger (`{ ts, area: "shopify_connector", event, ...details }`), routes to `console.error`/`console.warn`/`console.log` by level. Not wired to Pino (`services/logger.js`) — if you need request-correlated logging, use `req.log` in the route layer instead.

## `order-service.js` — web-order upsert + stock policy

Exports (factory): `createOrderService(db, getActiveShopifyConnection)` → `{ upsertWebOrderFromShopifyPayload, applyWebOrderStockPolicy }`

- **Factory pattern, not a plain module** — must be called with a tenant-scoped `db` and a `getActiveShopifyConnection` callback (both injected, so this file has no direct DB/connection imports of its own). Was extracted from `routes/orders.js` so `routes/shopify/*` could reuse the same logic without a require-cycle — keep it dependency-free of route-layer code.
- **`upsertWebOrderFromShopifyPayload(payload)`** — idempotent upsert into `web_orders`/`web_order_items` keyed on `(source='shopify', external_order_id)` via `ON CONFLICT`. After upserting, always attempts `applyWebOrderStockPolicy` — a stock-policy failure here does NOT throw back to the caller; it's captured as `{ error: message }` in the returned `stock_policy` field, so the order upsert itself always "succeeds" even if stock couldn't be applied.
- **`applyWebOrderStockPolicy(webOrderId)`** — the interesting logic:
  - Decides apply vs. reverse vs. no-op based on `payment_status`/`order_status` via two pure predicates, `shouldApplyWebOrderStock` and `shouldReverseWebOrderStock` (paid/authorized → apply; refunded/voided/cancelled → reverse; already in the target state → no-op).
  - Resolves target outlet via `resolveWebOrderOutletId` — uses `order.outlet_id` if set, else falls back to the Shopify connection's `default_location_id` mapped through `shopify_location_map`. Throws if neither resolves.
  - Resolves each line item to a `product_id`/`variant_id` via `resolveWebOrderItemMapping` — tries direct IDs, then SKU lookup on `product_variants`, then barcode lookup on `product_variants`, then barcode lookup on `products` (in that priority order). **If any item is unmappable, the whole operation throws** and stamps `stock_policy_note` on the order — no partial stock application.
  - Actual stock mutation runs inside `db.transaction(...)`, upserting into `outlet_stock` via `ON CONFLICT(product_id, outlet_id) DO UPDATE ... quantity = outlet_stock.quantity + delta` — `delta` is signed by direction (`-qty` on apply, `+qty` on reverse).
  - Idempotent by design: re-calling on an already-applied or already-reversed order returns a `noop_*` action string instead of double-adjusting stock.

## `utils.js` — Shopify domain helper functions (pure, no I/O)

Exports: `baseRetryDelayMinutes`, `retryDelayMinutesWithJitter`, `evaluateWebhookTimestampWindow`, `isRetryableInventoryEventStatus`, `canApproveReconciliationRequest`, `buildWebhookIdempotencyKey`, `verifyWebhookSignature`, `maskSecret`, `getActiveShopifyConnection`

- **Retry backoff schedule** (`baseRetryDelayMinutes`): attempt 1→1min, 2→5min, 3→15min, 4→60min, 5+→240min. `retryDelayMinutesWithJitter` adds random jitter (0–5min at the top tier, scaled down for smaller delays) to avoid thundering-herd retries.
- **`evaluateWebhookTimestampWindow(triggeredAtHeader, nowMs, maxAgeMs=10min, futureSkewMs=5min)`** — replay-attack guard for webhook timestamps. Missing header is treated as `ok: true` (fail-open on absence, not on staleness) — only rejects when a timestamp is present but outside the window or unparseable.
- **`verifyWebhookSignature({ rawBody, providedHmac, webhookSecret })`** — HMAC-SHA256 over the raw body, base64-encoded, compared via `crypto.timingSafeEqual` (constant-time). Returns a structured `{ ok, reason }` rather than throwing — reasons: `no_secret_configured`, `missing_signature`, `invalid_signature`. **Length-checks buffers before `timingSafeEqual`** (which throws on mismatched lengths) — don't remove that guard.
- **`buildWebhookIdempotencyKey({ webhookId, payload, nowMs })`** — prefers Shopify's `X-Shopify-Webhook-Id` header value (`shopify_webhook_{id}`); falls back to a synthesized key from order id + `updated_at`/`created_at` when the header is absent.
- **`isRetryableInventoryEventStatus(status)`** — whitelist check: `failed`, `dead_letter`, `retry`, `failed_mapping` (case-insensitive).
- **`canApproveReconciliationRequest({ requesterEmployeeId, approverEmployeeId })`** — simple segregation-of-duties check: both IDs must be present and must differ (self-approval blocked).
- **`maskSecret(secret, decryptFn)`** — for displaying credentials in admin UIs. Takes an **injected** decrypt function (keeps this file DB/crypto-import-free); if decryption fails, falls back to masking the raw (possibly still-encrypted) string rather than throwing. Returns `"********"` for short secrets (≤8 chars), else `"{first4}...{last4}"`.
- **`getActiveShopifyConnection(db, decryptFn)`** — fetches the single `is_active = true` row from `shopify_connections` (highest `id` wins if multiple, though the schema intends only one active connection per tenant), decrypts `access_token` and `webhook_secret` via the injected `decryptFn`. Returns `null` if no active connection. This is the canonical way to load a usable (decrypted) connection object — prefer it over querying `shopify_connections` directly.

---

## Cross-file dependencies

- `client.js` has no dependency on the other three files in this directory — it's a pure GraphQL transport layer, callable standalone given a `connection` object.
- `order-service.js` depends on nothing else in this directory (its two injected params come from the route layer) but is itself depended on by `routes/orders.js` and `routes/shopify/index.js`/`routes/shopify/reconciliation.js`.
- `crypto.js` wraps `services/crypto.js` — do not call `services/crypto.js` directly from Shopify code; always go through `crypto.js`'s domain-named exports for consistency and easier auditing of Shopify-specific decrypt call sites.
- `utils.js`'s `getActiveShopifyConnection` is the injection target typically passed as the second argument to `order-service.js`'s `createOrderService(db, getActiveShopifyConnection)` factory — check `routes/shopify/index.js` for the actual wiring.
- Connection objects flowing into `client.js` functions must already have `access_token` decrypted (i.e., passed through `utils.js:getActiveShopifyConnection` or an equivalent decrypt step first) — `client.js` never decrypts anything itself.
