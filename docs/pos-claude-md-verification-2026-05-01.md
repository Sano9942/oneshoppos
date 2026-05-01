# POS CLAUDE.md Verification - 2026-05-01

This note records a code-first recheck of:

`frontend/src/pages/redesign/pos/CLAUDE.md`

The check was done against the actual files under `frontend/src/pages/redesign/pos`, without relying on the guide itself.

## Verdict

The guide is partly true, but it is stale in several places. It is useful for orientation, but should not be treated as fully authoritative for development decisions.

## Confirmed Accurate

- The POS folder has 62 code files when excluding `CLAUDE.md` itself.
- `POSContext.jsx` imports and composes these 8 hooks:
  - `useShiftGate`
  - `useCart`
  - `useReceipt`
  - `useCustomerDisplay`
  - `useLoyaltyWallet`
  - `useFolioCharging`
  - `useOfflineQueue`
  - `useCheckout`
- `useCheckout.js` uses `api.raw('/api/sales')` for sale submission, with `pendingSaleRef` and `sessionExpired` handling.
- `omniInputRouter.js` is a pure classifier and supports `noop`, `barcode`, `plu`, `customer`, and `text`.
- `useShiftGate.js` hardcodes opening denominations as:

```js
[5000, 1000, 500, 100, 50, 20, 10]
```

## Stale Or Inaccurate

- `CLAUDE.md` says `POSContext.jsx` is about 400 lines, but the actual file is 1019 lines.
- `CLAUDE.md` says the `restaurant/` subdirectory has 12 files, but it actually has 15 files.
- `CLAUDE.md` says `POSOmniInput` replaces `POSSearchArea`, but actual code still renders `POSOmniInput` inside `POSSearchArea` only when `phase2g_omni_input` is enabled. The older search inputs still exist below it.
- The modal table is not fully accurate. Some components described as context-only are actually prop-based, including:
  - `POSCartCollisionModal.jsx`
  - `POSCartResumeModal.jsx`
  - `POSShiftRecoveryModal.jsx`
  - `POSNoSaleReasonModal.jsx`
  - `POSReceiptRetryModal.jsx`

## Useful Code References

- `frontend/src/pages/redesign/pos/POSContext.jsx`
- `frontend/src/pages/redesign/pos/POSSearchArea.jsx`
- `frontend/src/pages/redesign/pos/omniInputRouter.js`
- `frontend/src/pages/redesign/pos/hooks/useCheckout.js`
- `frontend/src/pages/redesign/pos/hooks/useShiftGate.js`
- `frontend/src/pages/redesign/pos/restaurant/`

## Recommendation

Before using `frontend/src/pages/redesign/pos/CLAUDE.md` as an implementation guide, update it against the current code. The broad architecture notes are mostly useful, but the line counts, restaurant file count, search input description, and some modal ownership details are outdated.

---

# Level 4 CLAUDE.md Checks

This section records one-by-one checks of the Level 4 `CLAUDE.md` files from the project pyramid.

## `backend/routes/admin/CLAUDE.md`

Rechecked code-first against actual files in `backend/routes/admin/`.

### Verdict

Mostly true and useful. The guide matches the current module structure, route split, shared dependency object, admin mount order, and most route-level behavior. It has a few important overstatements.

### Confirmed Accurate

- `backend/index.js` mounts admin routes before the tenant middleware chain.
- `backend/routes/admin/index.js` registers 8 domain modules:
  - `auth.js`
  - `tenants.js`
  - `monitoring.js`
  - `billing.js`
  - `operations.js`
  - `compliance.js`
  - `messaging.js`
  - `system.js`
- `tenantDbManager.init(db)` is called in `backend/routes/admin/index.js` before routes are registered.
- The shared `deps` object includes `db`, `masterDb`, `jwt`, `jwtDefaults`, `tenantDbManager`, `requireAllowedIp`, `requireSuperAdmin`, `authLimiter`, `bcrypt`, `BCRYPT_ROUNDS`, `provision`, `PLAN_DEFAULTS`, `auditLog`, `logAdminAction`, and `logSecurityEvent`.
- `helpers.js` supports `ADMIN_ALLOWED_IPS`, CIDR matching, `/32` host matching, Bearer-token super-admin auth, `TOKEN_EXPIRED`, and the listed logging helpers.
- `POST /api/admin/auth/login` uses `requireAllowedIp` plus `authLimiter`, lowercases email, checks `super_admins`, signs a super-admin JWT, calls `masterDb.init(db)`, and logs success/failure.
- `GET /api/announcements/active` is public and does not use `requireAllowedIp` or `requireSuperAdmin`.
- `messaging.js` registers `DELETE /api/admin/email-queue/purge-deleted` before `DELETE /api/admin/email-queue/:id`, avoiding Express route-order problems.
- `monitoring.js` uses `SUM(total)` from `sales` for revenue stats, not `total_amount`.
- `system.js` has `X-Infra-Cache` behavior for orphaned schemas and backup/verify/history routes.

### Stale Or Inaccurate

- The guide says every route requires both `requireAllowedIp` and `requireSuperAdmin` except `GET /api/announcements/active`. That is not quite true: `POST /api/admin/auth/login` uses `requireAllowedIp` and `authLimiter`, but not `requireSuperAdmin`, because it is the route that creates the admin token.
- The cross-cutting note says all mutations call `logAdminAction()`. That is too broad. Some mutation routes do not call it, including the tax/compliance mutations in `backend/routes/admin/compliance.js`, `POST /api/admin/email-queue/:id/retry`, `PUT /api/admin/announcements/:id`, and `POST /api/admin/backup/verify`.

### Useful Code References

- `backend/index.js`
- `backend/routes/admin/index.js`
- `backend/routes/admin/helpers.js`
- `backend/routes/admin/auth.js`
- `backend/routes/admin/tenants.js`
- `backend/routes/admin/monitoring.js`
- `backend/routes/admin/billing.js`
- `backend/routes/admin/operations.js`
- `backend/routes/admin/compliance.js`
- `backend/routes/admin/messaging.js`
- `backend/routes/admin/system.js`

## `backend/routes/integrations/CLAUDE.md`

Rechecked code-first against actual files in `backend/routes/integrations/`.

### Verdict

Mostly true and useful. The guide matches the router-based module structure, the 6 sub-module load order, credential encryption flow, and most provider-specific route behavior. A few claims need tightening.

### Confirmed Accurate

- `index.js` creates a single Express `Router`, injects `encryptSecret`, `decryptSecret`, and `maskSecret` from `services/crypto.js`, and mounts the router at `/api/integrations`.
- Sub-module load order is:
  - `hub`
  - `credentials`
  - `daraz`
  - `facebook`
  - `whatsapp`
  - `google-merchant`
- Sub-modules receive `router` and the expanded `integrationDeps`, not the top-level `app`.
- `hub.js` uses `requirePerm("manage_inventory")` and `requireFeature("marketplace_integrations")`.
- `credentials.js` encrypts credential fields individually, uses `ON CONFLICT (provider) DO UPDATE`, preserves missing credential fields with `COALESCE`, sets `is_active=true`, and clears `last_error`.
- `POST /api/integrations/test` is DB-only and does not call a remote provider API.
- `GET /api/integrations/:provider/status` returns masked credentials and does not return raw API secrets.
- Daraz, Facebook, WhatsApp, and Google Merchant route permissions and feature gates mostly match the guide.
- Google Merchant uses DB provider key `google_merchant`, while the URL path is `/google-merchant`.
- Facebook push-inventory uses `products.sku`, not a Facebook-specific SKU.
- Webhook inbound handling is outside this folder, in `routes/webhooks.js`.

### Stale Or Inaccurate

- The opening statement says `marketplace_integrations` is required on every route. That is not fully true: `POST /api/integrations/:provider/send-test-sms` uses `requireFeature("phase5_sms_providers")` instead.
- In `hub.js`, integration entries use `has_credentials: !!i.is_active`, not a direct check for an API key/token. Courier entries do use `has_credentials: !!c.api_key`.
- `POST /api/integrations/test` returns a 404 `{ error: "Integration not configured" }` when no row exists. The guide only mentions the no-credentials and success cases.
- The Daraz push-inventory note says it uses `daraz_sku` if set and falls back to `products.sku`, but the query filters with `WHERE dpm.daraz_sku IS NOT NULL`. That means rows with null `daraz_sku` are excluded before the fallback can help.

### Useful Code References

- `backend/routes/integrations/index.js`
- `backend/routes/integrations/hub.js`
- `backend/routes/integrations/credentials.js`
- `backend/routes/integrations/daraz.js`
- `backend/routes/integrations/facebook.js`
- `backend/routes/integrations/whatsapp.js`
- `backend/routes/integrations/google-merchant.js`

## `backend/routes/reports/CLAUDE.md`

Rechecked code-first against actual files in `backend/routes/reports/`.

### Verdict

Mostly true at the architecture level. The guide correctly describes the reports folder layout, helper injection pattern, tenant-route mounting, and many route groups. Some route-level and feature-gate details are stale.

### Confirmed Accurate

- `index.js` initializes helpers with `helpersInit(db)` and registers the main report modules:
  - `dashboard`
  - `sales`
  - `inventory`
  - `analytics`
  - `purchasing`
  - `finance`
  - `staff`
  - `shifts`
  - `governance`
- `index.js` also mounts the extra modules: `fbr-export`, `stock-aging`, `multichannel`, `clinical`, `kds-analytics`, and `menu-engineering`.
- `index.js` returns `processPendingReportSchedules` from `governance.js`, and `registerAllRoutes.js` consumes that returned function.
- `helpers.js` exports the listed shared helpers, including `pgWhere`, `buildReportFilterParts`, `parsePaging`, `applyUtcDateFilter`, `applyLocalDateFilter`, `toCsvLines`, and the bound `getDescendantLeafIds`.
- `sales-summary` has a try/catch around `sale_items.tax_rate_at_sale` for older installs.
- Profit sales routes in `sales.js` are gated with `requireFeature("reports_profit_layer")`.
- `fbr-export.js` uses `from`/`to`, requires `all_access`, reads sale item tax snapshot columns, and returns JSON for the frontend to download.
- `stock-aging.js` has its own route file and gates with `requireAnyPerm(["view_reports", "manage_inventory"])`.
- `clinical.js`, `kds-analytics.js`, and `menu-engineering.js` use the expected feature and permission gates. KDS and menu engineering also use `requireMode("restaurant")`.
- `multichannel.js` uses `from`/`to` params and aggregates POS, Shopify, and WooCommerce channels.

### Stale Or Inaccurate

- The guide says `revenue-leaks` is gated by `reports_profit_layer`, but in actual `analytics.js`, `/api/reports/revenue-leaks` is ungated. The gated profit-layer route is `/api/reports/discount-leakage`.
- The guide says the `reports_exceptions` route name varies and to check line 654. In the current code it is specifically `GET /api/reports/exceptions`.
- `inventory.js` has duplicate route definitions for some paths. For example, `/api/reports/dead-stock`, `/api/reports/forecast-demand`, and `/api/reports/replenishment-smart` exist as ungated routes earlier and gated `reports_inventory_health_plus` routes later. Because Express uses registration order, the earlier ungated definitions may shadow the later gated versions.
- The guide lists `GET /api/reports/schedule-runs`, but current `governance.js` uses `GET /api/reports/schedules/:id/runs` for schedule-specific runs. Other schedule/run routes also exist below that section, so verify governance routes directly before editing.
- The guide says schedule read-only routes use `requireAnyPerm(["view_reports","manage_employees"])`. Current `GET /api/reports/schedules` uses `requirePerm("manage_employees")`, while saved views use `requireAnyPerm`.
- `stock-aging` is mounted both from `stock-aging.js` and also appears as a gated route inside `inventory.js`; the standalone `stock-aging.js` route is registered after `inventory.js`, so the earlier inventory route may win if paths collide.

### Useful Code References

- `backend/routes/reports/index.js`
- `backend/routes/reports/helpers.js`
- `backend/routes/reports/sales.js`
- `backend/routes/reports/inventory.js`
- `backend/routes/reports/analytics.js`
- `backend/routes/reports/governance.js`
- `backend/routes/reports/fbr-export.js`
- `backend/routes/reports/stock-aging.js`
- `backend/routes/reports/multichannel.js`
- `backend/routes/reports/clinical.js`
- `backend/routes/reports/kds-analytics.js`
- `backend/routes/reports/menu-engineering.js`

## `backend/routes/shopify/CLAUDE.md`

Rechecked code-first against actual files in `backend/routes/shopify/`.

### Verdict

Mostly true. The guide accurately captures the Shopify module structure, shared helper closures, connection flow, sync/event routes, import routes, webhook handling, and most permissions. A few mapping and reconciliation details are stale.

### Confirmed Accurate

- Shopify routes are regular tenant-context routes mounted under `/api/integrations/shopify/*` and `/api/integrations/mappings/*`.
- `index.js` builds local helper closures for `maskSecret`, `getActiveShopifyConnection`, and `resolveImportCategoryId`.
- Sub-module load order is:
  - `config`
  - `health`
  - `sync`
  - `orders`
  - `import`
  - `mappings`
  - `webhooks`
  - `reconciliation`
- `config.js` masks secrets on read, keeps an existing token when token is omitted on update, deactivates other connections first, and encrypts token/webhook secret.
- `health.js` has status, verify, live locations, live validation, webhook setup, and UAT checklist routes with the expected permissions.
- `sync.js` uses `external_sync_events`, has retry/process/retry-failed/push-inventory routes, and `processPendingShopifyInventoryEvents` is callback-based.
- `orders.js` pulls recent orders, creates a sync run, and writes inbound `external_sync_events` with idempotency key `inbound_order_{shopify_order_id}`.
- `import.js` imports products from Shopify, syncs inventory from mappings, and includes `DELETE /api/integrations/shopify/import/products`.
- `backend/index.js` includes `DELETE /api/integrations/shopify/import/products` in `ensureCriticalRoutesRegistered()`, so removing it can fail server boot.
- `webhooks.js` implements unauthenticated public `POST /api/integrations/shopify/webhooks/orders-create`, guarded by `webhookLimiter`, HMAC verification, shop-domain check, replay-window validation, and idempotency checks.
- Global `express.json` captures `req.rawBody` for `/api/integrations/shopify/webhooks/*`.
- `GET /api/integrations/shopify/webhooks/setup` lists additional Shopify topics that do not have matching route handlers in this folder.

### Stale Or Inaccurate

- The guide says all mapping routes use `manage_inventory`, but customer mapping routes use `manage_orders`:
  - `GET /api/integrations/mappings/customers`
  - `PUT /api/integrations/mappings/customers/:customerId`
- The guide says `GET /api/integrations/mappings/customers/:customerId` exists. Current code has `GET /api/integrations/mappings/customers` for listing all customer mappings, plus `PUT /api/integrations/mappings/customers/:customerId`.
- The guide says `PUT /api/integrations/mappings/locations/:id`; current code uses `PUT /api/integrations/mappings/locations/:outletId`.
- `mappings.js` also has `POST /api/integrations/mappings/products/auto`, which the guide does not mention.
- The guide says reconciliation `:id/fix` calls `adjustShopifyInventory` and creates a notification. Current code creates an `approval_requests` row and returns `approval_request_id`; it does not call `adjustShopifyInventory` or `createNotification` in that route.
- `reconciliation.js` destructures `canApproveReconciliationRequest`, `createNotification`, and `adjustShopifyInventory`, but these are not actually used by the current `:id/fix` implementation.

### Useful Code References

- `backend/routes/shopify/index.js`
- `backend/routes/shopify/config.js`
- `backend/routes/shopify/health.js`
- `backend/routes/shopify/sync.js`
- `backend/routes/shopify/orders.js`
- `backend/routes/shopify/import.js`
- `backend/routes/shopify/mappings.js`
- `backend/routes/shopify/webhooks.js`
- `backend/routes/shopify/reconciliation.js`
- `backend/index.js`

## `backend/routes/tier4/CLAUDE.md`

Rechecked code-first against actual files in `backend/routes/tier4/`.

### Verdict

Mostly true. The guide accurately describes the Tier 4 router composition, factory pattern, feature gates, permissions, and most route behavior across notifications, company profile, accounting, HR, CRM, and approvals. A few details are stale or overstated.

### Confirmed Accurate

- `index.js` composes the 6 sub-routers in this order:
  - `notifications`
  - `company-profile`
  - `accounting`
  - `hr`
  - `crm`
  - `approvals`
- All modules export factory functions that receive `deps` or destructured `deps`.
- Notification routes use `requireFeature("notifications")` and no explicit `requirePerm`.
- Notification queries use the `is_read` column.
- `company-profile.js` has public `GET /api/company-profile/currency`, tenant-aware lookup via `?tenant=`, JSON parsing for `cash_denominations`, and fallback denominations.
- `PUT /api/company-profile` supports `tax_mode`, cache invalidation, and industry preset reseeding of modes/feature flags.
- Company logo upload uses multer memory storage, upload validation, and R2 upload.
- Accounting routes use `accounting_core`, with the expected permission split between report-style routes, notes/cheques, COA, and journal entries.
- Accounting uses `from`/`to` for many financial routes, while `cashflow/daily` uses `date_from`/`date_to`.
- Credit/debit note route factory, COA routes, cheques, journal entries, and trial balance behavior broadly match the guide.
- HR routes use `advanced_hr` + `all_access`, and payroll generation does the heavy per-employee calculation described.
- CRM routes use `crm_quotations` + `manage_orders`, and quotation email uses `nodemailer` directly with tenant `email_config`.
- `POST /api/quotations/:id/convert` requires accepted quotations before conversion.
- Approval status casing matches the guide: POs use `Draft`/`Approved`, transfers use lowercase `draft`/`approved`.
- Reconciliation approval supports `push_to_shopify` and `pull_from_shopify`; `pull_from_shopify` updates `outlet_stock`.

### Stale Or Inaccurate

- The notification guide says `PUT /api/notifications/read-all` is registered before `PUT /api/notifications/:id/read`. Actual code registers `/:id/read` first and `read-all` after it. The stated Express conflict is also not accurate for these exact paths because `/:id/read` would match `/read-all/read`, not `/read-all`.
- `company-profile.js` destructures `COMPANY_UPLOADS_DIR`, but the current logo upload path uses R2 via `uploadToR2`; `COMPANY_UPLOADS_DIR` is not actually used in this file.
- The guide says `company-profile.js` imports from `middleware/feature-flags` and `middleware/tenant-auth`, which is true, but it specifically calls `invalidateModeCache()`, `invalidateFeatureFlagCache()`, and `invalidateCompanyProfileCache(req.tenantId)`; it does not call tenant-scoped feature flag invalidation with an ID here.
- Accounting `GET /api/accounting/coa/next-code/:type` is registered after `GET /api/accounting/coa/:id`. This is okay because the paths have different segment counts, but it is worth checking before adding any new `/api/accounting/coa/*` routes.

### Useful Code References

- `backend/routes/tier4/index.js`
- `backend/routes/tier4/notifications.js`
- `backend/routes/tier4/company-profile.js`
- `backend/routes/tier4/accounting.js`
- `backend/routes/tier4/hr.js`
- `backend/routes/tier4/crm.js`
- `backend/routes/tier4/approvals.js`

## `backend/services/couriers/CLAUDE.md`

Rechecked code-first against actual files in `backend/services/couriers/` and the calling route in `backend/routes/couriers.js`.

### Verdict

Mostly true and unusually detailed. The guide accurately describes the adapter classes, method contracts, most auth patterns, base URLs, endpoint paths, return shapes, cancellation behavior, and the manual-booking safety adapters. There is one important integration bug/drift around `config_json`.

### Confirmed Accurate

- `index.js` exports `getAdapter(adapterKey, config)` and falls back to `GenericAdapter` for unknown adapter keys.
- `BaseCourierAdapter` stores `config` and throws `"Not implemented"` from `bookShipment`, `getTracking`, and `cancelShipment`.
- `GenericAdapter` returns manual-entry no-op responses and does not throw.
- `BykeaAdapter` and `PakPostAdapter` extend `GenericAdapter` and override `bookShipment` to throw `501` with `code = "COURIER_NO_BOOKING_API"`.
- `PakPostAdapter.getTracking()` returns a unique `tracking_url` field.
- Named API adapters extend `BaseCourierAdapter`.
- COD/prepaid service strings, auth headers/body fields, endpoint paths, and return-shape details mostly match the code.
- DHL and FedEx fetch OAuth tokens on each booking/tracking call and do not cache tokens.
- API-backed cancel implementations wrap network calls in `try/catch` and return `{ success: false, message }` on failures rather than throwing.
- The adapters do not read `process.env`; credentials come from `this.config`.
- `routes/couriers.js` skips adapter booking when `courier.supports_booking` is false, matching the guide's note.

### Stale Or Inaccurate

- The guide says the adapter slug should match `courier_integrations.slug`, but the actual schema and route use `courier_integrations.adapter_key`. There is no `slug` column in the shown `courier_integrations` schema.
- `config_json` is a TEXT column in `schema-pg.sql`, and `backend/routes/couriers.js` passes `courier.config_json` directly into adapters without parsing it. The adapters access it like an object, for example `this.config.config_json?.cost_center` or `?.account_number`. If the DB returns a string, those fields will be `undefined` and defaults will be used silently.
- Because of that `config_json` issue, guide claims about extra fields such as TCS `cost_center`, PostEx address codes, DHL `account_number`, and FedEx `account_number` are only true if `config_json` has already been parsed before adapter construction. The current route path does not parse it.
- The guide says `config` shape is `{ api_key, api_secret, api_base_url?, config_json? }`, which is correct structurally, but current callers may pass `config_json` as a raw JSON string rather than an object.

### Useful Code References

- `backend/services/couriers/index.js`
- `backend/services/couriers/base-adapter.js`
- `backend/services/couriers/generic-adapter.js`
- `backend/services/couriers/bykea-adapter.js`
- `backend/services/couriers/pakpost-adapter.js`
- `backend/services/couriers/tcs-adapter.js`
- `backend/services/couriers/postex-adapter.js`
- `backend/services/couriers/dhl-adapter.js`
- `backend/services/couriers/fedex-adapter.js`
- `backend/routes/couriers.js`
- `backend/schema-pg.sql`

## `backend/services/marketplace/CLAUDE.md`

Rechecked code-first against actual files in `backend/services/marketplace/`, plus the related integration routes, webhook route, worker, schema, and crypto helper.

### Verdict

Mostly true for the adapter implementations themselves. The guide accurately documents the base class and the Daraz, Meta Commerce, WhatsApp, and Google Merchant client behavior. The main stale parts are in the surrounding system claims: the worker is scheduled but does not actually call the clients yet, and the marketplace webhooks are not HMAC-verified in current code.

### Confirmed Accurate

- The folder contains the expected marketplace client files: `base-marketplace.js`, `daraz-client.js`, `meta-commerce.js`, `whatsapp-client.js`, and `google-merchant.js`.
- `BaseMarketplace` stores `config` and all four base methods throw `"Not implemented"`.
- Daraz request signing uses sorted params, `apiPath + sorted`, HMAC-SHA256 with the app secret, uppercase hex, and common params including `app_key`, `timestamp`, `sign_method`, and `access_token`.
- Daraz `testConnection()`, `pullOrders()`, `syncProducts()`, and `pushInventory()` match the documented endpoints and return shapes, including the N+1 order-items fetch in `pullOrders()`.
- Meta Commerce uses Graph API `v19.0`, appends `access_token` as a query param, reads `catalog_id` and `commerce_account_id` from `config.config_json`, fetches only `FB_PROCESSING` orders, divides item cents by 100, and detects Instagram by `channel === "INSTAGRAM"`.
- WhatsApp extends `BaseMarketplace`, uses `config.api_key` as the bearer token, reads phone/business IDs from `config.config_json`, implements the template/text send helpers, and stubs marketplace methods as no-ops.
- Google Merchant uses Content API `v2.1`, bearer `oauth_token`, `merchant_id` from `config.config_json`, hardcoded Pakistan/PKR product fields, no order pulling, and an extra `checkFeedStatus()` method.
- Adapter error handling matches the guide: test methods catch and return `{ success: false, error }`, product sync uses per-item catches where documented, and Google inventory update failures are swallowed per item.
- The `/api/integrations` marketplace routes use `requireFeature("marketplace_integrations")`, and credentials are saved through `routes/integrations/credentials.js` with secret fields encrypted by `services/crypto.js`.
- `integration_settings.config_json` is a `TEXT` field, and the Facebook, WhatsApp, and Google integration routes parse it before constructing their clients.
- The marketplace clients do not write directly to `external_sync_events`.

### Stale Or Inaccurate

- The overview says inbound Daraz, Meta, and WhatsApp webhooks are HMAC-verified. Current `backend/routes/webhooks.js` only HMAC-verifies xPay payment webhooks. Meta and WhatsApp webhook GET routes check verify tokens, while POST `/api/webhooks/meta`, POST `/api/webhooks/whatsapp`, and POST `/api/webhooks/daraz` do not verify HMAC signatures.
- The worker description overstates behavior. `workers/marketplace-sync-worker-boss.js` schedules `marketplace-order-poll` and `marketplace-feed-check`, but the handlers currently only find tenants/integrations and log placeholder messages. They do not call `DarazClient.pullOrders()`, `MetaCommerceClient.pullOrders()`, or `GoogleMerchantClient.checkFeedStatus()`.
- The credential encryption statement should be narrower: `api_key`, `api_secret`, `oauth_token`, and `oauth_refresh_token` are encrypted by `credentials.js`, but `config_json` is stored as raw text.
- The Daraz SKU fallback note is too broad. `syncProducts()` uses `product.sku || product.barcode || SP-{id}`, but `pushInventory()` only sends the `sku` values supplied by its caller; the current Daraz route builds those from `daraz_product_map.daraz_sku || products.sku` after filtering out rows where `daraz_sku IS NULL`.
- The Google Merchant section says all methods except `testConnection()` throw when `merchantId` is missing. `syncProducts()`, `pushInventory()`, and `checkFeedStatus()` do; `pullOrders()` does not check `merchantId` and always returns `[]`.
- Daraz route construction does not pass `config_json` into `DarazClient`, which is fine for the current client but means the general config table is not uniformly passed to all adapters.
- The “register the adapter in `routes/integrations/<name>.js` and `routes/integrations/hub.js`” guidance is partly stale. `hub.js` reads rows from `integration_settings` generically; new route registration belongs in `routes/integrations/index.js`, while `hub.js` only needs changes for special hub display behavior.
- The “primary auth token goes in `oauth_token` or `api_key`” convention is accurate, but actual validation accepts `config_json` only as a string (`backend/schemas/integrations.js`), matching the `TEXT` schema rather than a JSONB object.

### Useful Code References

- `backend/services/marketplace/base-marketplace.js`
- `backend/services/marketplace/daraz-client.js`
- `backend/services/marketplace/meta-commerce.js`
- `backend/services/marketplace/whatsapp-client.js`
- `backend/services/marketplace/google-merchant.js`
- `backend/routes/integrations/index.js`
- `backend/routes/integrations/credentials.js`
- `backend/routes/integrations/daraz.js`
- `backend/routes/integrations/facebook.js`
- `backend/routes/integrations/whatsapp.js`
- `backend/routes/integrations/google-merchant.js`
- `backend/routes/integrations/hub.js`
- `backend/routes/webhooks.js`
- `backend/workers/marketplace-sync-worker-boss.js`
- `backend/services/crypto.js`
- `backend/schemas/integrations.js`
- `backend/schema-pg.sql`

## `backend/tests/unit/CLAUDE.md`

Rechecked code-first against actual files in `backend/tests/unit/`, then compared against the guide.

### Verdict

Mostly true and useful as a test-suite map. It accurately captures the major files, test subjects, mocking patterns, and many regression-specific assertions. A few opening generalizations are stale, and one route-test pattern is described too broadly.

### Confirmed Accurate

- Unit tests are run with Vitest from the backend package; `backend/package.json` has `test:unit` as `vitest run tests/unit`.
- The folder contains the listed unit test files, including middleware, services, timezone, admin route, worker, industry config, rooms, rentals, treatment, schema, pricing, import mapper, anomaly, and Dockerfile regression tests.
- `middleware.test.js` covers validation, permissions, plan limits, active subscription checks, feature flags, upload validation, image magic-byte detection, and tenant-auth JWT behavior.
- `services.test.js` covers alerting, payment gateway behavior, FBR payload/backoff helpers, and email sender/from-address behavior.
- `utils.test.js`, `tz.test.js`, `utils-ics.test.js`, schema tests, and service-focused tests match the guide's described subjects and expected assertions.
- `routes-orders-transactions.test.js` and `routes-admin-worker-status.test.js` mount real mini Express apps with `supertest`.
- `routes-admin-monitoring-infra-cache.test.js` verifies `X-Infra-Cache` miss/hit/force behavior and uses `vi.resetModules()` to isolate module-level cache.
- `workers-email-worker-boss.test.js` uses `vi.hoisted()` plus `vi.mock()` for Resend/templates/subscription/marketing dependencies while exercising real tenant-context behavior.
- The require-cache pattern is real in `middleware.test.js`, `services.test.js`, and `tenant-auth-employee-email.test.js`.
- `dockerfile-pg-dump.test.js` reads `backend/Dockerfile` directly and checks that `postgresql-client` is installed in the production stage.

### Stale Or Inaccurate

- The guide says unit tests use Vitest with ESM imports. That is only partly true. Several files use CommonJS `require()` directly or via `createRequire()`, including `dockerfile-pg-dump.test.js`, `inventory-intelligence.test.js`, `pricing-service.test.js`, `tenant-auth-employee-email.test.js`, and multiple mixed ESM/CJS tests.
- The guide says there are no Express tests except `routes-orders-transactions.test.js`, `routes-admin-worker-status.test.js`, and `routes-admin-monitoring-infra-cache.test.js`, and that those mount mini-Express apps. Current code only mounts real Express apps in `routes-orders-transactions.test.js` and `routes-admin-worker-status.test.js`. The infra-cache test uses a minimal app object stub and calls the handler directly, not Express or `supertest`.
- The command `npx vitest run backend/tests/unit/` may work from the repo root if dependencies resolve, but the backend package's documented script is `npm run test:unit` from `backend/`, which runs `vitest run tests/unit`.
- The `anomaly-worker.test.js` section misses a current assertion: it also tests that refunds from the returns aggregate can flag a `refunds_pct` anomaly.
- `routes-admin-monitoring-infra-cache.test.js` appears twice in the guide: once in its main section and once again as “See above.”

### Useful Code References

- `backend/package.json`
- `backend/tests/unit/middleware.test.js`
- `backend/tests/unit/services.test.js`
- `backend/tests/unit/utils.test.js`
- `backend/tests/unit/tz.test.js`
- `backend/tests/unit/routes-orders-transactions.test.js`
- `backend/tests/unit/routes-admin-worker-status.test.js`
- `backend/tests/unit/routes-admin-monitoring-infra-cache.test.js`
- `backend/tests/unit/workers-email-worker-boss.test.js`
- `backend/tests/unit/workers-tenant-job-context.test.js`
- `backend/tests/unit/anomaly-worker.test.js`
- `backend/tests/unit/dockerfile-pg-dump.test.js`

## `frontend/src/auth/CLAUDE.md`

Rechecked code-first against actual files in `frontend/src/auth/`, plus current callers that touch the same auth storage helpers.

### Verdict

Mostly true for the four auth files themselves. The guide is a good map of `AuthProvider`, the fetch interceptor, login/logout flows, and the three storage helper modules. A few strict claims are stale because other frontend files still access auth-related localStorage directly, and customer portal storage is not used only by `PortalAuthProvider`.

### Confirmed Accurate

- `frontend/src/auth/` contains 4 implementation files: `AuthProvider.jsx`, `authStore.js`, `adminAuthStore.js`, and `customerPortalStore.js`.
- `AuthProvider.jsx` exports `AuthProvider` and `useAuth()`.
- The `useAuth()` value includes `session`, `employee`, `permissions`, `isAuthenticated`, `isBootstrapping`, `login`, `logout`, `refreshPermissions`, `refreshAccessToken`, `hasPerm`, `authHeaders`, `token`, impersonation fields, subscription fields, `tenantPlan`, and `company`.
- `login()` uses `/api/auth/mt-login` with `credentials: "include"` in multi-tenant mode when a tenant slug is supplied, and `/api/auth/login` for the single-tenant flow.
- `logout()` posts to `/api/auth/logout` best-effort, sends `{ type: "AUTH_LOGOUT" }` to the service worker when controlled, then clears the local session.
- The fetch interceptor injects `x-employee-id`, MT bearer token from live `readToken()`, and context headers from `readContext()`.
- The interceptor skips non-API URLs, unauthenticated users, and public auth endpoints for signup, forgot password, and reset password.
- The interceptor implements the offline write guard, silent token refresh on `401 TOKEN_EXPIRED`, failed request ID tracking from `X-Request-Id`, and subscription-expiry detection.
- `_refreshPromise` is a module-level refresh lock, and `window._nativeFetch` is used to avoid refresh recursion.
- `authStore.js` uses `authSession`, validates `employee.id` and `employee.role_id`, writes backward-compatible `currentEmployee`, and exposes context/token helpers.
- `adminAuthStore.js` uses `adminSession` and does not validate required fields.
- `customerPortalStore.js` uses slug-scoped `customerPortalSession:${slug}` keys and exposes read/write/clear/token/customer helpers.

### Stale Or Inaccurate

- The boot sequence in the guide omits a real step: for an existing normal session, `AuthProvider` also calls `/api/auth/me` best-effort to refresh `session.company` before writing the refreshed session. This happens outside the impersonation verification path.
- The guide says all auth data reads/writes should go through `authStore.js` and never access localStorage directly. Current code still has direct auth-related localStorage access outside this folder, including `CurrencyContext.jsx` reading `"authSession"` and `ImpersonationBanner.jsx` reading `"adminSession"` and removing `"authSession"`/`"currentEmployee"`.
- The guide says `customerPortalStore.js` is used exclusively by `PortalAuthProvider` in `pages/portal/`. Current `frontend/src/api/portalApi.js` also imports and uses `readPortalSession`, `writePortalSession`, and `clearPortalSession` for bearer-token injection, refresh, and logout.
- The `authHeaders(extra?)` description should be read conditionally: when no authenticated employee exists it returns only the passed `extra` headers, and it only includes `Authorization` in multi-tenant mode when a token is present.
- The boot-sequence billing step is conditional on multi-tenant mode and a refreshed session token; it is not attempted for single-tenant sessions.

### Useful Code References

- `frontend/src/auth/AuthProvider.jsx`
- `frontend/src/auth/authStore.js`
- `frontend/src/auth/adminAuthStore.js`
- `frontend/src/auth/customerPortalStore.js`
- `frontend/src/api/portalApi.js`
- `frontend/src/contexts/CurrencyContext.jsx`
- `frontend/src/ui/ImpersonationBanner.jsx`

## `frontend/src/components/CLAUDE.md`

Rechecked code-first against actual files in `frontend/src/components/`, plus `api.js` and `RouteLoading.jsx` for referenced behavior.

### Verdict

Accurate and useful. The guide matches the current component count, guard behavior, layout shell, notification dropdown, context switcher, plan-limit modal, and route-loading details. Only one wording detail is slightly overstated.

### Confirmed Accurate

- `frontend/src/components/` contains 7 implementation files: `AppLayoutRedesign.jsx`, `ContextSwitcher.jsx`, `NotificationBell.jsx`, `PlanLimitModalInterceptor.jsx`, `RequireAuth.jsx`, `RequireContext.jsx`, and `RequirePerm.jsx`.
- `RequireAuth.jsx` shows `"Loading session..."`, redirects unauthenticated users to `/login` with `state: { from: location }`, and renders `children || <Outlet />`.
- `RequirePerm.jsx` returns `null` during boot, passes through when `perm` is falsy or allowed, and otherwise redirects to `/access-denied` with `{ from: location.pathname, redirectTo }`.
- `RequireContext.jsx` waits for `useFeatureFlags`, passes through when `context_selection_required` is off, validates `all_branches` only for `all_access`, and redirects invalid/missing context to `/context-select`.
- `ContextSwitcher.jsx` fetches `/api/context/bootstrap` with raw `fetch` and `authHeaders()`, validates outlet IDs against the allowed outlet list, gates “All Branches” with `all_access`, writes context via `writeContext()`, and links to `/context-select`.
- `NotificationBell.jsx` polls `/api/notifications/count` every 60 seconds, loads full rows only when open, supports the listed notification type metadata, caps the badge at `99+`, and uses the documented read/read-all endpoints.
- `PlanLimitModalInterceptor.jsx` listens for `PLAN_LIMIT_EVENT` from `api.js`, is mounted once in `AppLayoutRedesign`, displays usage details when present, hardcodes `8000 PKR/month` per outlet, and navigates to `/billing`.
- `AppLayoutRedesign.jsx` filters `SHOPIFY_NAV_GROUPS` by permission, feature flag, and mode, hides empty groups, resolves `__STOREFRONT__` with `readTenantSlug()`, supports `newTab` anchors, uses prefix active matching, and includes `AnnouncementBanner`, `Breadcrumbs`, page `ErrorBoundary`, `Suspense`, `SupportWidget`, and `PlanLimitModalInterceptor`.
- The `Suspense` fallback in `AppLayoutRedesign.jsx` matches the pill-style markup in `frontend/src/routes/RouteLoading.jsx`.

### Stale Or Inaccurate

- The ContextSwitcher note says context writes update state and localStorage “atomically.” Current code calls `writeContext(next)` and then `setCtx(next)` as separate operations. The behavior is still synchronized for normal UI use, but it is not literally atomic.

### Useful Code References

- `frontend/src/components/AppLayoutRedesign.jsx`
- `frontend/src/components/ContextSwitcher.jsx`
- `frontend/src/components/NotificationBell.jsx`
- `frontend/src/components/PlanLimitModalInterceptor.jsx`
- `frontend/src/components/RequireAuth.jsx`
- `frontend/src/components/RequireContext.jsx`
- `frontend/src/components/RequirePerm.jsx`
- `frontend/src/api.js`
- `frontend/src/routes/RouteLoading.jsx`

## `frontend/src/contexts/CLAUDE.md`

Rechecked code-first against actual files in `frontend/src/contexts/`, plus `frontend/src/main.jsx` for provider nesting.

### Verdict

Accurate and useful. The guide matches the three React context files, their exports, default values, provider nesting, fetch behavior, toast behavior, and preset bootstrap logic. Only one `presetLoaded` description needs a small nuance.

### Confirmed Accurate

- `frontend/src/contexts/` contains 3 implementation files: `CurrencyContext.jsx`, `PresetContext.jsx`, and `ToastContext.jsx`.
- `main.jsx` wraps the app as `CurrencyProvider` > `ToastProvider` > `AuthProvider` > `PresetProvider`, matching the guide's provider-order note.
- `CurrencyContext.jsx` exports `CurrencyProvider` and `useCurrency()`, defaults to `$`, `USD`, `[100, 50, 20, 10, 5, 1]`, and exposes `fmt()` plus `refresh()`.
- In multi-tenant mode, `CurrencyProvider` reads `localStorage["authSession"].tenant_slug`, appends `?tenant=...`, uses raw `fetch`, silently skips when no slug exists, and swallows fetch errors.
- `ToastContext.jsx` exports `ToastProvider` and `useToast()`, supports `toast`, `success`, `error`, and `warning`, keeps at most 3 toasts, auto-dismisses after 4000ms, and throws if `useToast()` is used outside the provider.
- Toast color classes and fixed bottom-right rendering match the guide.
- `PresetContext.jsx` exports `PresetProvider`, `usePreset()`, `WEIGHTED_UNITS`, `DEFAULT_UNIT_VOCABULARY`, `isWeightedUnit()`, and `DEFAULT_PRESET`.
- `PresetProvider` waits for `AuthProvider` bootstrapping to finish, then calls `api.get("/api/context/bootstrap")` once an employee is available, uses a cancellation flag, and sets `presetLoaded = true` on success or failure.
- `hasMode()` fails open before preset load and checks `preset.enabled_modes` after load.
- `label(key)` returns `preset.labels[key] || key`.

### Stale Or Inaccurate

- The guide says `presetLoaded` is `false` until the first `/api/context/bootstrap` completes. More precisely, if bootstrapping is done but there is no authenticated employee, `PresetProvider` sets `presetLoaded` back to `false` and does not attempt the bootstrap fetch.

### Useful Code References

- `frontend/src/contexts/CurrencyContext.jsx`
- `frontend/src/contexts/PresetContext.jsx`
- `frontend/src/contexts/ToastContext.jsx`
- `frontend/src/main.jsx`

## `frontend/src/pages/CLAUDE.md`

Rechecked code-first against the actual `frontend/src/pages/` tree, selected key pages, route files, and route registration files, then compared against the guide.

### Verdict

Partly true and useful as a broad orientation guide, but several absolute conventions are stale. The guide is strongest for subdirectory responsibilities and special-page warnings. It is weaker for exact counts, “never” rules, and some route-wrapper descriptions.

### Confirmed Accurate

- `pages/` contains the top-level page tree plus subdirectories for `admin`, `dashboard`, `portal`, `public`, `redesign`, `reports`, `shopify`, and `storefront`.
- Most active tenant UI lives under `frontend/src/pages/redesign/`, and many top-level `*Route.jsx` files delegate to corresponding redesign components.
- `Reports.jsx` is not legacy; `ReportsRedesign.jsx` wraps it and exports `ReportsTabStandaloneRedesign`, while `Reports.jsx` exports `ReportTabStandalone`.
- `POSRoute.jsx` waits for preset and feature flags, then redirects restaurant tenants with `phase4_restaurant` to `/pos/restaurant`; otherwise it renders `POSRedesign`.
- `DashboardRedesign.jsx` is role-aware, uses `all_access` for admin and `view_reports` without `all_access` for manager, and refreshes by bumping a key every 60 seconds.
- `BillingRedesign.jsx` polls `/api/billing/status` every 2 seconds up to 15 attempts after a gateway redirect.
- `ProductFormPage.jsx` is a standalone page under `redesign/`, not a `*Redesign.jsx` wrapper target.
- `CustomersRedesign.jsx` uses a clinical preset set containing `clinic`, `dental_clinic`, `veterinary`, and `physiotherapy`.
- Admin pages use the separate admin auth path and mostly use `adminFetch`; `AdminTaxRates.jsx` defines a local admin fetch helper.
- Portal pages use `portalApi` and `PortalAuthProvider` rather than the main app `useAuth` flow. `PortalLayout` fetches portal config and passes `enabledTabs` through outlet context.
- `public/` and `storefront/` pages use raw public `fetch()` calls with `API_BASE` instead of `api.js`.
- `StorefrontCart.jsx` instantiates its own `useStorefrontCart(tenantSlug)`, and `useStorefrontCart.js` stores anonymous cart tokens under `sf_cart_<tenantSlug>`.

### Stale Or Inaccurate

- The guide says all active tenant pages are `*Redesign.jsx` files in `redesign/`. Current active tenant routes also include wrapper files with logic such as `POSRoute.jsx`, direct redesign imports from `appRoutes.jsx`, and standalone `redesign/ProductFormPage.jsx`.
- The guide says all `redesign/` API calls use `api.js` and never raw `fetch()`. Current `frontend/src/pages/redesign/restaurant/VoidReasonsAdminRedesign.jsx` uses raw `fetch()` for void-reason mutations.
- The guide says redesign timestamps should use date utilities and never raw `new Date()` except `KioskRedesign`. Many redesign files still use raw `new Date()` or locale date formatting, including appointments, billing, contracts, rentals, room management, scheduling, POS components/hooks, and others.
- `IntegrationsHubRedesign.jsx` has 13 entries in `PROVIDER_META`, not 12. It includes Daraz, Shopify, WooCommerce, Facebook, Instagram, WhatsApp, Google Merchant, xPay, JazzCash, Easypaisa, Zong SMS, Jazz SMS, and Twilio.
- The guide says `POSRedesign.jsx` mounts all 12 modals. Current `POSRedesign.jsx` imports and mounts more than 20 modal/error-state components, including receipt retry, shift recovery, cart collision/resume, barcode miss, insufficient stock, and endless aisle modals.
- The guide says `*Route.jsx` wrappers lazy-load the corresponding redesign files. The route tree lazy-loads many route wrapper modules, but the wrapper files themselves generally use static imports of redesign components.
- The guide says every `*Route.jsx` file is a 5-line thin wrapper. Many are thin, but `POSRoute.jsx` and `ReportsRoute.jsx` contain meaningful routing/standalone-tab logic and should not be treated as disposable boilerplate.
- The feature-flag table has drift: for example, `KioskOrderingRedesign.jsx` checks `phase4_restaurant_qr`, not `phase4_restaurant`, and several restaurant admin subpages use more specific flags such as `phase4_restaurant_86`, `phase4_restaurant_reservations`, `phase4_restaurant_day_parting`, and `phase4_restaurant_void_comp`.
- Portal pages are not exclusively `portalApi`: `PortalAppointments.jsx` also uses raw public `fetch()` for booking config and availability.

### Useful Code References

- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/routes/publicRoutes.jsx`
- `frontend/src/pages/POSRoute.jsx`
- `frontend/src/pages/ReportsRoute.jsx`
- `frontend/src/pages/Reports.jsx`
- `frontend/src/pages/redesign/ReportsRedesign.jsx`
- `frontend/src/pages/redesign/POSRedesign.jsx`
- `frontend/src/pages/redesign/DashboardRedesign.jsx`
- `frontend/src/pages/redesign/BillingRedesign.jsx`
- `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`
- `frontend/src/pages/redesign/CustomersRedesign.jsx`
- `frontend/src/pages/redesign/restaurant/VoidReasonsAdminRedesign.jsx`
- `frontend/src/pages/admin/AdminLogin.jsx`
- `frontend/src/pages/admin/AdminTaxRates.jsx`
- `frontend/src/pages/portal/PortalLayout.jsx`
- `frontend/src/pages/portal/PortalAppointments.jsx`
- `frontend/src/pages/storefront/useStorefrontCart.js`

## `frontend/src/routes/CLAUDE.md`

Rechecked code-first against `frontend/src/routes/`, plus `frontend/src/main.jsx` and `PortalLayout.jsx` for wrapper behavior.

### Verdict

Mostly accurate and useful. The guide matches the route split, path tables, app/admin nesting, route permissions, report deep-links, and loading fallback. The main nuance is around portal isolation wording.

### Confirmed Accurate

- `frontend/src/routes/` contains `appRoutes.jsx`, `publicRoutes.jsx`, `adminRoutes.jsx`, `RouteLoading.jsx`, and `CLAUDE.md`.
- `publicRoutes.jsx` defines `HomeRedirect`, public auth/marketing routes, protected POS routes, public storefront routes, booking/menu/pay/reservation routes, and portal nested routes.
- `HomeRedirect` waits during bootstrapping, redirects authenticated users to `/context-select`, skips the setup check in multi-tenant mode, and otherwise renders `LandingPagePreview`.
- `/pos`, `/pos/restaurant`, and `/kiosk` in `publicRoutes.jsx` are wrapped with `RequireAuth`, `Suspense`, and a page-level `ErrorBoundary` where documented.
- `/store/:tenantSlug` has the documented nested storefront routes: index, `products`, `products/:productId`, `cart`, `checkout`, and `order/:orderToken`.
- `/portal/:tenantSlug` has the documented nested portal routes and renders `PortalLayout`.
- `appRoutes.jsx` nests app routes under `RequireAuth > RequireContext > AppLayoutRedesign`.
- `wrap(Component)` and `perm(permString, element)` are implemented as described.
- The permission map and placeholder routes largely match the actual route entries.
- The 19 report deep-links and their `tabId` values match the current `appRoutes.jsx`.
- `ReportTabStandaloneRoute` is loaded from the named export in `pages/ReportsRoute.jsx` via `.then(...)`.
- `adminRoutes.jsx` defines `/admin/login` plus the documented nested `/admin` routes, with admin auth handled inside `AdminLayout`.
- `RouteLoading.jsx` is the centered white `"Loading..."` card described in the guide.

### Stale Or Inaccurate

- The guide says routes are split by access level and all `lazy()`-loaded unless noted. Several route-level components are intentionally not lazy because they are imported directly or defined inline, including `HomeRedirect`, `SetupWizard`, `AccessDenied`, `ContextSelect`, `RequireAuth`, `RequireContext`, `RequirePerm`, `AppLayoutRedesign`, `PlaceholderPage`, and `RouteLoading`.
- The guide says the portal uses `PortalAuthProvider` and not the main `AuthProvider`. Functionally portal auth is separate and portal pages use `PortalAuthProvider`, but `main.jsx` still wraps the entire app, including public routes, in the main `AuthProvider`. The safer statement is: portal pages do not use the main app auth/session flow.
- `RouteLoading.jsx` is used by `publicRoutes.jsx` as well as by the `wrap()` helpers in `appRoutes.jsx` and `adminRoutes.jsx`.

### Useful Code References

- `frontend/src/routes/publicRoutes.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/routes/adminRoutes.jsx`
- `frontend/src/routes/RouteLoading.jsx`
- `frontend/src/main.jsx`
- `frontend/src/pages/portal/PortalLayout.jsx`

## `frontend/src/types/CLAUDE.md`

Rechecked code-first against `frontend/src/types/`, `frontend/tsconfig.json`, and current source references.

### Verdict

Partly true. The guide accurately describes the two TypeScript files and the compiler setup, but the `AuthEmployee` shape is stale relative to the actual `AuthProvider` session structure. The files are currently reference-only and appear unused by the app source.

### Confirmed Accurate

- `frontend/src/types/` contains 2 TypeScript files: `api.ts` and `auth.ts`.
- `frontend/tsconfig.json` uses `allowJs: true` and `noEmit: true`.
- `api.ts` exports `ApiOk<T>`, `ApiError`, `ApiResponse<T>`, and runtime callable `isApiError()`.
- `isApiError()` returns true when `res.error` is a string.
- `auth.ts` exports `AuthEmployee` and `JwtPayload`.
- `JwtPayload` is documented as reference-only; no frontend source currently decodes JWTs using this type.

### Stale Or Inaccurate

- `AuthEmployee` is described as the employee object stored in `AuthProvider`, but current `AuthProvider` stores `permissions` and `token` on the session object, not inside `session.employee`. The actual employee object from login is assigned as `employee: data.employee`.
- `AuthEmployee.token` is required in the type, but single-tenant login sessions do not store a token at all, and multi-tenant sessions store it at `session.token`.
- `AuthEmployee.permissions` is required in the type, but current sessions store permissions at `session.permissions`.
- The guide says to import and call `isApiError()` directly, but current source search found no imports or calls of `ApiOk`, `ApiError`, `ApiResponse`, `AuthEmployee`, `JwtPayload`, or `isApiError`.

### Useful Code References

- `frontend/src/types/api.ts`
- `frontend/src/types/auth.ts`
- `frontend/src/auth/AuthProvider.jsx`
- `frontend/tsconfig.json`

## `frontend/src/ui/CLAUDE.md`

Rechecked code-first against actual files in `frontend/src/ui/`.

### Verdict

Mostly true and useful for primitives and global UI helpers. The guide accurately describes most component APIs and behaviors, but a few count/style claims are stale.

### Confirmed Accurate

- `frontend/src/ui/` contains 13 implementation files plus `CLAUDE.md`.
- `primitives.jsx` exports the documented named primitives: `PageShell`, `SectionCard`, `Button`, `Input`, `Select`, `Badge`, `TableToolbar`, `BulkActionBar`, `EmptyState`, `Skeleton`, `Modal`, `ModalBody`, `ModalFooter`, `ConfirmDialog`, and `TabBar`.
- `PageShell` uses `title`, `subtitle`, `right`, and `children`; `SectionCard` has no `title` prop.
- `Modal` supports Escape close, first-focus behavior, focus restore, backdrop close, and `sm`/`md`/`lg`/`xl` width classes.
- `ErrorBoundary` is a named export, reports to Sentry only when `SENTRY_DSN` is set, has page/global render modes, and shows stack details only in dev.
- `AnnouncementBanner.jsx` fetches `/api/announcements/active`, uses sessionStorage dismissal, and supports `info`, `warning`, and `maintenance` styles.
- `ImpersonationBanner.jsx` reads `adminSession` directly, uses `window._nativeFetch || window.fetch`, clears `authSession` and `currentEmployee`, tries `window.close()`, then falls back to `/admin`.
- `SubscriptionBanner.jsx` reads auth subscription state, hides for `active`/`null`, shows trial only at 7 days or less, and hides entirely for `tenantPlan === "free"`.
- `SupportWidget.jsx` uses a floating `?` button, supports `bug`, `feature_request`, and `question`, limits attachments to 3 files at 5MB each, uploads screenshots first, and submits `last_req_id` from `window.__lastFailedReqId`.
- `PwaInstallPrompt.jsx` listens for `beforeinstallprompt`, persists dismissal in `localStorage["pwa_install_dismissed"]`, and renders the documented install/not-now card.
- `MultiOutletEnabledBanner.jsx` checks `/api/billing/status`, uses `multi_outlet_flags_seeded` plus `max_outlets >= 2`, dismisses via sessionStorage, and links to `/settings/security`.

### Stale Or Inaccurate

- The guide says `nav-config.js` exports 18 nav groups, but current `SHOPIFY_NAV_GROUPS` has 19 groups. The listed group names include all 19.
- The guide says all UI files use CSS custom property classes except POS. That is too broad: several files in `ui/` use fixed Tailwind colors, including `AnnouncementBanner.jsx`, `PwaInstallPrompt.jsx`, `MultiOutletEnabledBanner.jsx`, `SubscriptionBanner.jsx`, `StarRating.jsx`, and parts of `SupportWidget.jsx`.
- `StarPicker` does not maintain hover state for all stars. It highlights selected stars via `value`, and the individual unselected star under the pointer gets `hover:text-yellow-300`.
- `ErrorBoundary.jsx` passes `variant="secondary"` to `Button`, but `Button` supports `tone`, not `variant`; this prop is not interpreted by the primitive.

### Useful Code References

- `frontend/src/ui/primitives.jsx`
- `frontend/src/ui/nav-config.js`
- `frontend/src/ui/ErrorBoundary.jsx`
- `frontend/src/ui/AnnouncementBanner.jsx`
- `frontend/src/ui/ImpersonationBanner.jsx`
- `frontend/src/ui/SubscriptionBanner.jsx`
- `frontend/src/ui/SupportWidget.jsx`
- `frontend/src/ui/PwaInstallPrompt.jsx`
- `frontend/src/ui/MultiOutletEnabledBanner.jsx`
- `frontend/src/ui/StarRating.jsx`
- `frontend/src/ui/tokens.css`

## `frontend/src/utils/CLAUDE.md`

Rechecked code-first against all implementation files in `frontend/src/utils/`, then compared the guide and spot-checked active call sites for receipt, queue, theme, date, CSV, and error-log behavior.

### Verdict

Mostly accurate and useful. The guide closely matches the current utility exports, IndexedDB queue schema, receipt rendering pipeline, public receipt sharing helpers, theme storage, and POS recovery logging. The stale parts are narrow but worth fixing because they overstate invalid-date handling and chunk-reload precision.

### Confirmed Accurate

- `frontend/src/utils/` contains 10 implementation files plus `CLAUDE.md`: `categoryTree.js`, `chunkReload.js`, `csvExport.js`, `dates.js`, `errorLog.js`, `offlineQueue.js`, `paperSizes.js`, `publicReceipt.js`, `receipt.js`, and `theme.js`.
- `dates.js` exports UTC and local parsers/formatters, plus backward-compatible `fmtDateTime`, `fmtDate`, and `fmtTime` aliases to the UTC variants. Empty inputs return `null` from parsers and `"—"` from formatters.
- `csvExport.js` has a single `downloadCsv(headers, rows, filename)` export, no-ops on empty rows, quote-escapes values, creates a Blob URL, clicks an anchor, and revokes the URL.
- `offlineQueue.js` is backed by IndexedDB via `idb`, database `sanopos_pos`, store `sales_queue`, keyPath `idempotency_key`, indexes `by_employee`, `by_state`, and `by_queued_at`.
- Offline queue rows carry `type`, `sync_state`, retry/error timestamps, and payload data; legacy rows without `type` normalize to `"sale"` on read.
- `MAX_QUEUED = 50` and `WARN_THRESHOLD = 40` are exported, and the 50-item cap is shared across sale and return rows.
- Queue helpers match the guide: `getQueue`, type-scoped getters, state filtering, enqueue helpers, sync state transitions, localStorage migration, and deprecated `dequeue()`.
- `receipt.js` re-exports `PAPER_SIZES` and `pxForChars`, formats payment method labels, builds receipt sections, renders browser popup receipts, lazy-loads `jsbarcode`/`qrcode`, and posts hardware print jobs to `/api/print/receipt`.
- `buildReceiptSections()` is used by `POSReceiptModal` and receipt retry flows; `printToHardware()` is used by `useReceipt.printSlip`, which arms the retry modal on hardware failure rather than directly opening the browser fallback.
- `paperSizes.js` defines the 48/42/32/30 character widths and calculates popup pixels with `Math.round(chars * 7.1)`.
- `publicReceipt.js` builds absolute `/receipt/:invoiceNumber` URLs, appends `?tenant=` in multi-tenant mode when a slug exists, and builds WhatsApp share URLs with encoded text.
- `categoryTree.js` sorts by `path_label || name`, filters leaf categories, blocks current category descendants in `parentOptions()`, and returns `path_label || name || ""` from `indentLabel()`.
- `theme.js` stores `sanopos_theme`, applies `document.documentElement.dataset.theme`, toggles light/dark, and is initialized at app boot from `frontend/src/App.jsx`.
- `errorLog.js` is best-effort and posts to `/api/action-history` through `api.post`, swallowing all failures; POS recovery call sites use it for receipt retry, shift recovery, refund/cart collisions, barcode misses, and insufficient-stock flows.

### Stale Or Inaccurate

- The guide says `parseDbDate()` and `parseLocalDate()` return `null` on invalid input. They only return `null` for empty inputs or invalid native `Date` objects; invalid strings still produce an `Invalid Date` object, so formatters can display `"Invalid Date"` rather than `"—"`.
- The guide says `looksLikeChunkLoadFailure()` returns false for genuine network errors, but the actual matcher includes `"failed to fetch"`, which can also match real network failures. The 30-second sessionStorage guard limits reload loops, but the detection is broader than documented.
- `theme.js` does not validate theme values. `getTheme()` defaults to `"light"` when unset, but `setTheme(theme)` persists and applies whatever string callers pass.
- The guide says `initTheme()` is called at app boot in `main.jsx`; current code calls it from `frontend/src/App.jsx` before rendering the app component.
- The guide's `printToHardware()` fallback wording is slightly outdated for current POS behavior: `useReceipt.printSlip()` sets `retryPrompt` on failure, and `buildReceiptHtml()` is exposed separately through `printBrowserFallback()` or used by retry actions.
- The top note says "No React dependencies except `errorLog.js` (uses `api.js`)"; none of the utility files import React. `errorLog.js` imports the shared API client, not React.

### Useful Code References

- `frontend/src/utils/dates.js`
- `frontend/src/utils/csvExport.js`
- `frontend/src/utils/offlineQueue.js`
- `frontend/src/utils/receipt.js`
- `frontend/src/utils/paperSizes.js`
- `frontend/src/utils/publicReceipt.js`
- `frontend/src/utils/categoryTree.js`
- `frontend/src/utils/theme.js`
- `frontend/src/utils/chunkReload.js`
- `frontend/src/utils/errorLog.js`
- `frontend/src/App.jsx`
- `frontend/src/auth/AuthProvider.jsx`
- `frontend/src/pages/redesign/pos/hooks/useReceipt.js`
- `frontend/src/pages/redesign/pos/POSReceiptModal.jsx`
- `frontend/src/pages/redesign/pos/POSReceiptRetryModal.jsx`
- `frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js`

## backend/middleware/CLAUDE.md

Rechecked code-first against the nine implementation files in `backend/middleware/`, plus current route/index usage.

### Verdict

Mostly accurate and useful. The guide matches the current middleware exports, auth/context behavior, rate limiters, Zod body validation, and upload validation helpers. The stale parts are narrow.

### Confirmed Accurate

- `tenant-auth.js` exports `init`, employee/JWT auth middleware, tenant resolution, company profile loading, context resolution, and company-profile cache invalidation.
- `loadTenantAndPerms()` decodes bearer JWTs, backfills `x-employee-id`, loads permissions with one retry, checks token revocation, restricts kiosk tokens, and returns explicit 401/403/503 codes for the documented cases.
- `permissions.js` exports `requirePerm`, `requireAnyPerm`, `requireContextOutlet`, default role permissions, and the global `PERMISSION_RULES` array.
- `feature-flags.js` has 60-second caches for feature flags and modes, returns 403 for disabled flags/modes, and exposes notification helpers.
- `rate-limit.js` exports global, auth, webhook, review, public booking, and customer portal limiters with the documented 429 body and `Retry-After` header.
- `upload-validation.js` now includes both file-filter allowlists and magic-byte helpers for JPEG, PNG, GIF, WebP, BMP, and TIFF.

### Stale Or Inaccurate

- The application-order block says `requestId` is first and then `globalLimiter`; `backend/index.js` currently applies `globalLimiter` before `requestId`.
- The guide says all middleware requires `init(deps)` "where noted"; only `tenant-auth.js` and `feature-flags.js` expose `init()`.
- `DEFAULT_ROLE_PERMISSIONS.Manager` is described as 17 permissions but lists 21, and the code currently has 21 entries.

### Useful Code References

- `backend/index.js`
- `backend/middleware/tenant-auth.js`
- `backend/middleware/permissions.js`
- `backend/middleware/feature-flags.js`
- `backend/middleware/rate-limit.js`
- `backend/middleware/upload-validation.js`
- `backend/middleware/validate.js`

## backend/routes/CLAUDE.md

Rechecked code-first against `backend/routes/registerAllRoutes.js`, the route tree, and representative route usage.

### Verdict

Useful for orientation, but several broad architectural claims are stale or too absolute. The subdirectory summaries mostly agree with the deeper audits, including their already-recorded caveats.

### Confirmed Accurate

- `registerAllRoutes.js` mounts public routes before tenant auth, then the tenant/auth/context/subscription middleware chain, then tenant-scoped domain routes.
- Public pre-tenant route modules include webhooks, receipts, gift-card balance, storefront, public restaurant/pay/reservations/bookings, customer portal, setup, country packs, and optional sandbox routes.
- `reports/index.js` returns `processPendingReportSchedules`, and `orders.js` feeds Shopify route dependencies with Shopify inventory/order helpers.
- Customer portal routes are mounted before tenant middleware and use the separate portal auth/public tenant resolution path.
- Validation is not universal; routes opt into `validate(schema)` where implemented.

### Stale Or Inaccurate

- `registerAllRoutes.js` is not a pure orchestrator and is not about 607 lines. It is currently 674 lines and contains inline route logic for health checks and feature flags, plus middleware wiring, outlet-assignment enforcement, restore guard, and reports telemetry.
- The guide says all data-returning GET endpoints require `requirePerm` or `requireAnyPerm`. Several authenticated tenant GETs rely on the shared auth/session chain or route-specific logic rather than explicit per-route permission middleware, and public GETs intentionally have no employee auth.
- The admin summary repeats stale claims from the deeper admin audit: admin login itself is IP-limited but does not require super-admin auth, and not every mutation logs `admin_activity_log`.
- The route inventory is broad but not exhaustive for current route behavior; for example `registerAllRoutes.js` itself defines `/api/feature-flags` routes.

### Useful Code References

- `backend/routes/registerAllRoutes.js`
- `backend/index.js`
- `backend/routes/webhooks.js`
- `backend/routes/storefront.js`
- `backend/routes/customer-portal/auth.js`
- `backend/routes/admin/index.js`
- `backend/routes/reports/index.js`
- `backend/routes/shopify/index.js`

## backend/schemas/CLAUDE.md

Rechecked code-first against all files in `backend/schemas/` and current route imports.

### Verdict

Mostly accurate. The guide is a good schema map, but a few global wording claims are broader than the implementation.

### Confirmed Accurate

- `backend/schemas/` currently has 43 implementation files plus `CLAUDE.md`, and the implementation files use Zod.
- Core schema exports for auth, sales, returns, inventory, products, customers, employees, purchase orders, orders, admin, billing, integrations, shifts, attendance, restaurant, rooms, rentals, treatment plans, and customer portal match the guide at a high level.
- `scheduled-changes.js` exports the product/variant allowlists and uses a field allowlist to protect worker-side SQL interpolation.
- `customer-portal.js` uses camelCase exports, while most core schemas use PascalCase names.

### Stale Or Inaccurate

- The top-level pattern says optional/passthrough fields use `.passthrough()`, but many schemas simply define optional fields without `.passthrough()`, and several update schemas intentionally use strict or partial object shapes.
- The customer portal section says routes are `routes/customer-portal.js`; actual route files live under `backend/routes/customer-portal/`.
- The guide describes `.superRefine()` as the cross-field pattern when dynamic paths are needed, but some current schemas still use `.refine()` for cross-field checks where a static path is enough.

### Useful Code References

- `backend/schemas/auth.js`
- `backend/schemas/sales.js`
- `backend/schemas/scheduled-changes.js`
- `backend/schemas/customer-portal.js`
- `backend/schemas/treatment-plans.js`
- `backend/routes/customer-portal/auth.js`
- `backend/middleware/validate.js`

## backend/services/CLAUDE.md

Rechecked code-first against the service inventory, key infrastructure services, route call sites, workers, and the deeper courier/marketplace audits.

### Verdict

Mostly useful and directionally accurate. A few statements inherit stale details from the deeper adapter sections.

### Confirmed Accurate

- `logger.js`, `alerting.js`, `boss.js`, `crypto.js`, `email.js`, `payment-gateway.js`, `printer.js`, `fbr.js`, and `catalog-scheduler.js` match the documented roles.
- `email.enqueueEmail(db, opts)` keeps the `db` argument only for backward-compatible signature shape and uses shared pg-boss internally.
- `booking-reminders.js` only sends email reminders and still marks SMS-channel rows as sent when no email is sent.
- `restaurant-checks.js` does not export `addItemToCheck` or `closeCheck`, and `restaurant-floor.js` has no `closeTableSession`.
- `subscriptions.processRenewal`, `customer-invoicing.scheduleReminders`, and `marketing.enqueueCampaignSend` require tenant slug context for queued jobs.

### Stale Or Inaccurate

- The marketplace summary says inbound Daraz/Meta/WhatsApp webhooks are HMAC-verified. The current `backend/routes/webhooks.js` marketplace webhook handlers are mounted before tenant middleware but are not HMAC-verified.
- The courier summary says adapter config comes from a decrypted DB row; the deeper courier audit found current route code passes raw `courier.config_json` text into adapters while adapters expect nested object config.
- The marketplace summary repeats the broad Daraz SKU fallback claim; actual `pushInventory()` only sends caller-supplied SKUs, and the current Daraz route filters mapped rows to `daraz_sku IS NOT NULL` before using `daraz_product_map.daraz_sku || products.sku`.

### Useful Code References

- `backend/services/email.js`
- `backend/services/boss.js`
- `backend/services/payment-gateway.js`
- `backend/services/booking-reminders.js`
- `backend/services/catalog-scheduler.js`
- `backend/routes/webhooks.js`
- `backend/routes/couriers.js`
- `backend/services/couriers/index.js`
- `backend/services/marketplace/daraz-client.js`

## backend/tests/CLAUDE.md

Rechecked code-first against `backend/tests/`, helper files, `backend/package.json`, and current test imports.

### Verdict

Partly accurate but stale in important runner/helper details. The high-level split between Vitest unit/integration tests and Postgres-focused integration coverage is still useful.

### Confirmed Accurate

- `backend/package.json` uses Vitest for `test`, `test:unit`, `test:integration`, and unit coverage.
- Current tree contains `backend/tests/helpers/`, `backend/tests/integration/`, and `backend/tests/unit/`.
- `createTestApp-pg.js` creates isolated Postgres schemas and exports `createTestApp`, `DEFAULT_FEATURE_FLAGS`, and `PERMISSION_RULES`.
- Unit coverage includes middleware, services, worker helpers, schemas, pricing, printer, import mappers, treatment, room, rental, and retail preset tests.
- `vitest-setup.js` loads backend env files before tests.

### Stale Or Inaccurate

- The guide says unit tests use ESM imports. Many current unit tests are CommonJS-style `require()` tests running under Vitest globals.
- Several legacy integration tests import `../helpers/createTestApp`, but the current helpers directory only contains `createTestApp-pg.js`; that makes those guide entries risky unless a compatibility helper exists outside the listed tree.
- `globalTeardown.js` is described as Jest global teardown, but the active backend test script/config shown in `backend/package.json` and `backend/vitest.config.js` are Vitest-based.
- The guide calls `reports_accuracy.test.js` the only integration file using Jest syntax; it currently uses `describe`/`it` globals and CommonJS requires, which Vitest can also provide.

### Useful Code References

- `backend/package.json`
- `backend/vitest.config.js`
- `backend/tests/helpers/createTestApp-pg.js`
- `backend/tests/helpers/vitest-setup.js`
- `backend/tests/helpers/globalTeardown.js`
- `backend/tests/integration/reports_accuracy.test.js`
- `backend/tests/unit/middleware.test.js`

## backend/workers/CLAUDE.md

Rechecked code-first against `backend/workers/`, `backend/boot/workers.js`, and related services.

### Verdict

Useful for individual pg-boss worker behavior, but the top-level framing is too absolute. The current worker system mixes pg-boss workers with inline interval pollers from `boot/workers.js`.

### Confirmed Accurate

- `tenant-job-context.js` exposes `withTenantContext()` and `assertSafeSlug()`, sets tenant search path, and resets/releases in `finally`.
- Email, FBR, cleanup, reservation, marketplace, orphan-schema, course-release, KDS snapshot, ABC, anomaly, retail digest, hold expiry, shift auto-close, subscription grace, rental overdue, room overdue, treatment plan, and reservation reminder worker files exist.
- Marketplace sync handlers are currently stubs that log intent without calling marketplace clients.
- Orphan-schema scan is default-on unless `ORPHAN_SCHEMA_SCAN_WORKER_ENABLED=0` and performs a boot-time warmup.
- Booking reminders are implemented as a `boot/workers.js` interval poller calling `services/booking-reminders.processPendingReminders()`.

### Stale Or Inaccurate

- The guide opens with "All workers are pg-boss backed unless noted as legacy." `boot/workers.js` also starts non-pg-boss `setInterval` workers for sync cleanup, report cleanup, stale attendance sessions, Shopify sync, report schedules, catalog scheduling, and booking reminders.
- The guide says every worker must call `boss.createQueue()` before `boss.work()` or `boss.schedule()`, but several current worker files call `boss.schedule()`/`boss.work()` directly without a visible `createQueue()` call.
- The guide says KDS snapshot, ABC, anomaly, and retail digest have no dedicated toggle; `boot/workers.js` currently gates them with `KDS_SNAPSHOT_WORKER_ENABLED`, `ABC_WORKER_ENABLED`, `ANOMALY_WORKER_ENABLED`, and `RETAIL_DIGEST_WORKER_ENABLED`.
- The guide says KDS snapshot is registered when the KDS feature is active; current boot code registers it only by env toggle, not by a feature-active check.

### Useful Code References

- `backend/boot/workers.js`
- `backend/workers/tenant-job-context.js`
- `backend/workers/email-worker-boss.js`
- `backend/workers/marketplace-sync-worker-boss.js`
- `backend/workers/orphan-schema-scan-worker-boss.js`
- `backend/workers/kds-load-snapshot-worker-boss.js`
- `backend/workers/abc-worker-boss.js`
- `backend/workers/anomaly-worker-boss.js`
- `backend/services/booking-reminders.js`

## frontend/src/CLAUDE.md

Rechecked code-first against top-level frontend files, route files, providers, and the deeper `frontend/src/*` audits.

### Verdict

Mostly useful as a source-root orientation guide. Several stale details repeat issues already found in deeper frontend sections.

### Confirmed Accurate

- The app is React 19 with Vite 7 and Tailwind 4 per `frontend/package.json`.
- `main.jsx` wraps `App` in `ErrorBoundary`, `CurrencyProvider`, `ToastProvider`, `AuthProvider`, and `PresetProvider`, initializes Sentry when configured, installs stale chunk handlers, and registers the service worker in production.
- `App.jsx` composes `publicRoutes`, `appRoutes`, and `adminRoutes` under `BrowserRouter`, renders impersonation/subscription/PWA banners, and redirects `*` to `/`.
- `api.js` exports `api.get`, `post`, `put`, `del`, `upload`, and `raw`; non-raw JSON methods throw enriched errors on non-OK responses and dispatch the plan-limit event.
- `config.js` is the only implementation file under `frontend/src` that reads `import.meta.env` directly.

### Stale Or Inaccurate

- The guide says `initTheme()` is called at boot in `main.jsx`; current code calls it in `frontend/src/App.jsx`.
- The guide says `nav-config.js` exports 18 nav groups; current `SHOPIFY_NAV_GROUPS` has 19 groups.
- The guide says all routes are lazy-loaded unless noted. Deeper route audit found direct/imported route components in `publicRoutes.jsx` as well as lazy-loaded ones.
- The raw `fetch()` exception list is too narrow. In addition to storefront/public pages, `CurrencyContext`, and `useFeatureFlags`, current code has portal API/raw public flows and some manual fetches such as `ContextSwitcher`.
- The UI section says all non-POS UI components use CSS custom property classes, but several `frontend/src/ui/` files still use fixed Tailwind colors.
- Utility details repeat stale findings from `frontend/src/utils/CLAUDE.md`: invalid date handling, theme validation/init location, and chunk failure matching are broader/different than described.

### Useful Code References

- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `frontend/src/config.js`
- `frontend/src/routes/publicRoutes.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/ui/nav-config.js`
- `frontend/src/contexts/CurrencyContext.jsx`
- `frontend/src/components/ContextSwitcher.jsx`
- `frontend/src/utils/theme.js`

## frontend/tests/CLAUDE.md

Rechecked code-first against `frontend/tests/`, helpers, Playwright config, and `frontend/package.json`.

### Verdict

Partly accurate, but the file counts and smoke-test conventions are stale. The production E2E/test-tenant warning remains accurate and important.

### Confirmed Accurate

- Playwright config uses `testDir: "./tests"`, `testMatch: "*.spec.js"`, `baseURL: "https://sanopos.com"`, storage state `./tests/auth.json`, and `globalSetup: "./tests/global-setup.js"`.
- `global-setup.js` logs into `sanopos.com`, writes `auth.json`, and writes `token.json` from `localStorage.authSession`.
- `helpers/auth.js` currently hardcodes tenant `packagesmall`, username `hassan`, password `Danish11`, PIN `2580`, and backend `https://api.sanopos.com`.
- `helpers/api.js` reads `tests/token.json`, sends bearer auth plus outlet/scope headers, and exposes `ensurePOSReady()`.
- Unit tests live in `frontend/tests/unit/`, use Vitest/testing-library patterns, and `setup.js` imports `@testing-library/jest-dom` and `fake-indexeddb/auto`.

### Stale Or Inaccurate

- The guide says there are 28 E2E spec files; the current top-level `frontend/tests/*.spec.js` count is 33.
- The guide says there are 17 smoke specs; the current `frontend/tests/smoke/*.spec.js` count is 24.
- The guide says all smoke specs call `skipIfFlagOff`; currently most smoke specs do not contain `skipIfFlagOff` and rely on other checks/cleanup patterns.
- The guide says all E2E specs hit production only. That is true for configured Playwright base URL and many hardcoded URLs, but unit tests also live under `frontend/tests/` and do not hit a server.
- The onboarding warning says tenants must be deleted manually; unlike smoke tests, those specs still have no shared cleanup helper documented or detected in their guide section.

### Useful Code References

- `frontend/playwright.config.js`
- `frontend/package.json`
- `frontend/tests/global-setup.js`
- `frontend/tests/helpers/auth.js`
- `frontend/tests/helpers/api.js`
- `frontend/tests/setup.js`
- `frontend/tests/smoke/helpers/featureFlags.js`
- `frontend/tests/smoke/helpers/cleanup.js`

## backend/CLAUDE.md

Rechecked code-first against backend boot files, route registration, middleware, database helpers, worker boot code, and the current backend inventory.

### Verdict

Useful as a top-level backend orientation guide, but stale in several precise counts and too absolute about webhook security, tenant-route permissions, and worker behavior. The deeper backend `CLAUDE.md` audits in this report should be trusted over repeated broad claims here.

### Confirmed Accurate

- The backend is Node/Express with Postgres, and `backend/package.json` uses Express 5, pg, pg-boss, Vitest, Sentry, Zod, multer, and related infrastructure packages.
- `backend/index.js` loads env, initializes Sentry when configured, boots the multi-tenant proxy when `MULTI_TENANT=1`, calls `tenantAuth.init()` and `featureFlags.init()`, mounts admin routes before tenant middleware, registers tenant/public routes through `registerAllRoutes.js`, verifies critical routes, starts the HTTP server, and then calls `boot/workers.startAll()`.
- The early middleware order in `index.js` is broadly as documented: `helmet`, `cors`, `express.json` with `rawBody` capture for `/api/webhooks/*` and Shopify webhooks, malformed JSON 400 handler, `/uploads`, optional `/r2/*key`, `compression`, `cookieParser`, `globalLimiter`, then `requestId`.
- `ensureCriticalRoutesRegistered()` checks the 4 documented routes: product bulk import/delete/status and Shopify import-product delete.
- `db-pg.js` exports `query`, `transaction`, `getClient`, `end`, and `pool`, uses a pg pool max of 20, and intentionally does not load dotenv itself.
- `tenant-db-proxy-pg.js` uses AsyncLocalStorage and proxies `query`, `transaction`, and `getClient`; `tenant-db-manager-pg.js` has a 60-second tenant cache and scoped DB handles that set `search_path`.
- Middleware export summaries for `tenant-auth.js`, `permissions.js`, `feature-flags.js`, `plan-limits.js`, `rate-limit.js`, `validate.js`, `upload-validation.js`, `request-id.js`, and `customer-auth.js` are mostly accurate.
- `registerAllRoutes.js` mounts public/pre-tenant routes first, then auth/tenant/context/subscription middleware, then tenant-scoped modules, and returns Shopify/report worker callbacks.
- `frontend`-irrelevant generated or historical backend files listed under "do not read" are reasonable exclusions for normal implementation work.

### Stale Or Inaccurate

- `backend/index.js` is not a `~293-line orchestrator`; it is currently 319 lines and contains inline R2 proxy, Swagger mounting, error handling, critical-route verification, and boot assertions.
- The guide says `registerAllRoutes.js` registers tenant routes after a simple middleware chain where route-level permissions/features/validation happen at steps 16-20. Actual code also includes global outlet-assignment enforcement, a `PERMISSION_RULES` middleware, restore guard, reports telemetry, and inline `/api/feature-flags` routes before most tenant modules.
- The guide says pre-tenant webhook routes are "signature-verified." Only `/api/webhooks/xpay` verifies through `paymentGateway.verifyWebhook`; Meta, WhatsApp, and Daraz webhook POST handlers are rate-limited but not HMAC/signature verified in `routes/webhooks.js`.
- `schema-pg.sql` is not `~3,788 lines, 244 tables`; the current file is 4,463 lines, and a `CREATE TABLE` count finds 271 table declarations.
- `migrate-pg.js` current migration list goes through version 84, not version 49.
- The route convention says all data-returning GET endpoints require `requirePerm` or `requireAnyPerm`. Current code has authenticated tenant GETs that rely on shared auth/session or other route logic, public GETs by design, and a global `PERMISSION_RULES` layer for only selected route patterns.
- The "all workers use pg-boss" statement is stale. `boot/workers.js` also starts inline `setInterval` pollers for sync cleanup, report cleanup, stale attendance sessions, Shopify sync, report schedules, scheduled catalog changes, and booking reminders.
- The worker table is incomplete: current worker boot also includes orphan-schema scan, reservation, subscription grace, hold expiry, course release, KDS snapshot, ABC, anomaly, retail digest, shift auto-close, reservation reminder, and booking reminder workers.
- The guide says each worker exposes `global.__<name>WorkerStatus` and `queueDepth` is a real `SELECT COUNT(*)`. Current `worker-status` reads many globals when present, but some boot pollers set simple status objects, and `routes/admin/system.js` just returns `status.queueDepth || 0`; it does not compute queue depth itself.
- The "Adding a new route" example says to add one `app.use('/api/<prefix>', require('./routes/<domain>')(deps))` line. Most current backend route files are invoked as `require("./domain")(app, deps)` and register their own paths directly.
- The encryption note says courier adapters receive pre-decrypted config from the route layer, but the deeper courier audit found current courier route integration passes raw `courier.config_json` text into adapters while adapters expect nested object config.

### Useful Code References

- `backend/index.js`
- `backend/routes/registerAllRoutes.js`
- `backend/routes/webhooks.js`
- `backend/boot/workers.js`
- `backend/package.json`
- `backend/db-pg.js`
- `backend/tenant-db-proxy-pg.js`
- `backend/tenant-db-manager-pg.js`
- `backend/migrate-pg.js`
- `backend/schema-pg.sql`
- `backend/middleware/tenant-auth.js`
- `backend/middleware/permissions.js`
- `backend/middleware/feature-flags.js`
- `backend/middleware/plan-limits.js`
- `backend/routes/admin/system.js`

## frontend/CLAUDE.md

Rechecked code-first against frontend package/config files, app entry/composition, route arrays, API clients, auth interceptor, contexts, Playwright config, and current test inventory.

### Verdict

Mostly useful for frontend orientation and conventions. The app composition, API client, env-reader, route-array, and test-runner descriptions are broadly right, but some "always/never" rules and test details are stale against the current codebase.

### Confirmed Accurate

- `frontend/package.json` is React 19, Vite 7, Tailwind CSS v4, React Router 7, Vitest, Playwright, Testing Library, Sentry, lucide-react, Recharts, xlsx, and idb.
- `vite.config.js` uses `@vitejs/plugin-react`, `@tailwindcss/vite`, the `@shared` alias, jsdom Vitest setup, and manual chunks for Recharts, xlsx, and reports.
- `src/main.jsx` wraps `App` in `ErrorBoundary`, `CurrencyProvider`, `ToastProvider`, `AuthProvider`, and `PresetProvider`, initializes Sentry when configured, installs stale chunk reload handlers, and registers `/sw.js` in production.
- `src/App.jsx` renders `ImpersonationBanner`, `BrowserRouter`, `SubscriptionBanner`, `PwaInstallPrompt`, `publicRoutes`, `appRoutes`, `adminRoutes`, and a catch-all redirect to `/`.
- `src/api.js` exports `api.get`, `post`, `put`, `del`, `upload`, and `raw`; JSON methods throw enriched errors on non-OK responses, while `raw()` returns the `Response`.
- `api.js` dispatches `sanopos:plan-limit-reached` when a 403 response body has `code: "PLAN_LIMIT_REACHED"`.
- `src/config.js` is the only implementation file currently reading `import.meta.env` directly.
- `AuthProvider.jsx` globally patches `window.fetch` for API calls, injects employee/JWT/context headers, blocks offline write calls, refreshes expired MT tokens once, and intentionally reads the token live rather than using it as the interceptor effect dependency.
- `publicRoutes.jsx`, `appRoutes.jsx`, and `adminRoutes.jsx` contain the route definitions; `appRoutes` wraps the main app shell in `RequireAuth > RequireContext > AppLayoutRedesign`, and admin auth is handled inside the admin UI path.
- Playwright config targets `https://sanopos.com`, uses `./tests/auth.json`, one Chromium project, and `globalSetup: "./tests/global-setup.js"`.

### Stale Or Inaccurate

- `App.jsx` is not composition-only in the strict sense: it imports and calls `initTheme()` at module load and calls `useAuth()` to decide whether to render `ImpersonationBanner`.
- The `api.js` note says all paths must include `/api/` because the fetch interceptor matches `/api/`. `api.js` itself does not enforce the prefix; the interceptor checks absolute `${API}/api/` or relative `/api/` URLs.
- The raw `fetch()` exception list is incomplete. Current raw fetch usage also appears in admin pages, `NotificationBell`, `ContextSwitcher`, `AuthProvider`, `publicRoutes` setup status, portal appointment public booking flows, `utils/receipt.js`, and at least one redesign restaurant admin file.
- The guide says admin pages use `adminFetch` from `AdminLogin.jsx`; many do, but `AdminDashboard.jsx` still has several direct `fetch()` calls and `AdminTaxRates.jsx` defines a local `adminFetch`.
- The UI section says all shared components use CSS custom-property classes except POS. `primitives.jsx` still contains fixed Tailwind colors in `Badge`, `BulkActionBar`, toast colors, and modal backdrop styling.
- The tests section says unit tests cover `auth_guards`, contexts, layout, primitives, and dental chart, and that no POSContext hook unit tests exist. Current `frontend/tests/unit/` has 18 test files, including POS/offline/omni/loyalty tests and `pos-context-open-check.test.jsx`.
- The guide says E2E specs are `frontend/tests/*.spec.js`; current `frontend/tests/` contains 52 spec files total when including smoke specs, with 24 smoke specs under `frontend/tests/smoke/`.
- The login-form gotcha is stale: `helpers/auth.js` looks for a store-code placeholder matching `aceshardware`, then employee placeholder `/employee name/i`, password placeholder `/password/i`, and a Sign In button.

### Useful Code References

- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `frontend/src/config.js`
- `frontend/src/auth/AuthProvider.jsx`
- `frontend/src/routes/publicRoutes.jsx`
- `frontend/src/routes/appRoutes.jsx`
- `frontend/src/routes/adminRoutes.jsx`
- `frontend/src/pages/admin/AdminLogin.jsx`
- `frontend/src/pages/admin/AdminDashboard.jsx`
- `frontend/src/pages/admin/AdminTaxRates.jsx`
- `frontend/src/api/portalApi.js`
- `frontend/src/hooks/useFeatureFlags.js`
- `frontend/playwright.config.js`
- `frontend/tests/helpers/auth.js`
- `frontend/tests/unit/`
- `frontend/tests/smoke/`

## CLAUDE.md

Rechecked code-first against the root workspace, split frontend/backend package files, root operational scripts, deployment configs, top-level app boot files, current file/test inventories, and selected source files behind the broad claims.

### Verdict

Useful as a broad project map, but it should not be treated as authoritative without checking code. It explicitly tells readers to "Trust CLAUDE.md", which conflicts with this verification effort and with the guide's own top note saying code is the source of truth. Several stale counts and "all" statements repeat drift already captured in deeper audits.

### Confirmed Accurate

- The repo is a split frontend/backend project with no root `package.json`; active package scripts live in `backend/package.json` and `frontend/package.json`.
- The high-level stack is accurate: backend is Node/Express 5/Postgres via `backend/db-pg.js`; frontend is React 19, Vite 7, and Tailwind CSS 4.
- `backend/schema-pg.sql` is the active DDL source of truth, and `backend/migrate-pg.js` currently contains migrations through version 84.
- `backend/db-pg.js` has the documented pool shape and exports `query`, `transaction`, `getClient`, `end`, and `pool`; the pool max is 20.
- `backend/jwt-auth.js` exports the 6 documented helpers: `signAccessToken`, `signRefreshToken`, `verifyAccessToken`, `verifyRefreshToken`, `hashToken`, and `defaults`.
- `backend/category-tree.js` exports 17 helpers and includes `resolveInheritedField()`.
- Admin routes are mounted before tenant middleware, and `routes/webhooks.js` is also registered before tenant auth.
- Root local startup scripts match the guide's local dev shape: `START-FRESH.bat` starts backend and Vite, `START-ADMIN.bat` seeds a local super-admin, and `START-PROD.bat` intentionally starts against production via `backend/scripts/dev-prod.js`.
- Deployment config files exist as described: `backend/railway.toml`, `backend/start.sh`, and `frontend/vercel.json`.
- The broad frontend composition and API-client statements agree with the deeper `frontend/CLAUDE.md` audit: `main.jsx` wires providers, `App.jsx` composes the route arrays, `api.js` exports the shared API methods, and `AuthProvider` patches API `fetch()` calls.
- Current Playwright config uses `https://sanopos.com`, `frontend/tests/auth.json`, one Chromium project, and `frontend/tests/global-setup.js`.

### Stale Or Inaccurate

- The "Trust CLAUDE.md" rule is unsafe. Multiple audited guides contain stale counts and broad claims; code should remain the source of truth.
- The guide says SQLite archives exist at both `backend/archive/` and `backend/legacy/`; `backend/archive/` exists, but `backend/legacy/` does not in the current tree.
- `backend/index.js` is not about 293 lines; it is currently 319 lines and includes inline R2 proxy, Swagger docs, error handling, critical-route verification, and boot assertions.
- `backend/schema-pg.sql` is not 244 tables. Current count is 4,463 lines and 271 `CREATE TABLE` declarations.
- `registerAllRoutes.js` is not "orchestrator only." It includes health checks, feature-flag routes, middleware wiring, outlet-assignment enforcement, restore guard, and report telemetry.
- The webhook lifecycle note says pre-tenant webhooks are signature-verified. Only xPay verifies through the payment gateway path; Meta, WhatsApp, and Daraz POST handlers are not HMAC/signature verified in current `routes/webhooks.js`.
- The backend route/service/test inventories are stale in several places: current counts include 151 backend route JS files, 43 schema JS files, 17 reports route JS files, 9 Shopify route JS files, and 7 tier4 route JS files.
- The root guide repeats the stale worker framing from lower-level guides. `boot/workers.js` mixes pg-boss workers with inline interval pollers, and the worker-status endpoint reads `status.queueDepth || 0` from globals rather than computing every queue depth itself.
- The guide says all admin mutations log to `admin_activity_log`; the deeper admin audit found multiple mutation routes that do not call `logAdminAction()`.
- Test inventory is stale: current counts are 138 backend integration test files, 32 backend unit test files, 18 frontend unit test files, 28 top-level frontend Playwright specs, and 24 smoke specs.
- The Jest exception note is stale. Backend scripts use Vitest, and `reports_accuracy.test.js` uses CommonJS plus global `describe`/`it`, which Vitest can run; there is no active Jest script in `backend/package.json`.
- `verify-audit.sh` is stale and risky as guidance: it calls `npx jest`, references `frontend/tests/live` and `playwright.config.live.js`, and describes expected suites that do not match current package scripts.
- The permission section says Manager has 17 permissions, but `DEFAULT_ROLE_PERMISSIONS.Manager` currently has 21.
- The statement that all data-returning GET routes require `requirePerm` or `requireAnyPerm` is too broad; public GETs exist, and some authenticated tenant GETs rely on shared auth/session or route-specific logic.
- Root package scripts in both frontend and backend reference `../tools/api-parity-audit.js`, but that file is absent; current `tools/` only contains `inspect-slow-queries.js`.
- The frontend route/API guidance repeats stale lower-level caveats: raw `fetch()` exceptions are broader than listed, and `App.jsx` is not purely composition-only because it calls `initTheme()` and uses `useAuth()`.

### Useful Code References

- `CLAUDE.md`
- `backend/package.json`
- `frontend/package.json`
- `backend/index.js`
- `backend/routes/registerAllRoutes.js`
- `backend/routes/webhooks.js`
- `backend/boot/workers.js`
- `backend/db-pg.js`
- `backend/migrate-pg.js`
- `backend/schema-pg.sql`
- `backend/jwt-auth.js`
- `backend/category-tree.js`
- `backend/middleware/permissions.js`
- `backend/routes/admin/system.js`
- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/api.js`
- `frontend/src/auth/AuthProvider.jsx`
- `frontend/playwright.config.js`
- `docker-compose.yml`
- `START-FRESH.bat`
- `START-ADMIN.bat`
- `START-PROD.bat`
- `verify-audit.sh`
- `tools/`
