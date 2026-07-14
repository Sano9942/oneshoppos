# Services — Claude Guide

This directory contains all business logic services imported by route handlers via `deps` or direct `require()`. Routes handle HTTP concerns; services own domain logic, DB writes, and external API calls.

---

## Core Infrastructure Services

### `logger.js`
Pino singleton. Export: default logger instance. Use `.child({ component })` for sub-loggers. Controlled by `LOG_LEVEL` env var. Never create multiple instances — always require this one.

### `alerting.js`
In-memory sliding-window alert system. Exports: `recordError`, `recordDbPressure`, `recordHealthCheckFailure`. Fires to `ALERT_EMAIL` via Resend on threshold breaches. State resets on restart — by design, not a bug.

### `boss.js`
pg-boss singleton factory. Exports: `getBoss()` (lazy-init, promise-deduplicated), `shutdownBoss()`. Requires `DATABASE_URL`. Job retention: completed jobs archived after 24h, deleted after 7 days. Call `shutdownBoss()` on SIGTERM. Use `getBoss()` everywhere — never construct `PgBoss` directly.

### `crypto.js`
AES-256-GCM encryption for all integration credentials. Exports: `encryptSecret(plainText)`, `decryptSecret(storedText)`, `maskSecret(stored)`. Key source: `INTEGRATION_SECRET_KEY` (preferred) → `SHOPIFY_SECRET_KEY` fallback → SHA-256 of raw value if neither is hex/base64. Stored format: `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. If no key is configured, `encryptSecret` returns plaintext and `decryptSecret` returns stored value as-is (graceful degradation). `decryptSecret` returns plaintext directly when value doesn't start with `enc:v1:`.

### `email.js`
Unified email service. Exports: `sendEmail({ type, to, tenant, data, subject, html })`, `enqueueEmail({ type, to, tenant, data, subject, html }, boss)`, `resolveFrom(type, tenant)`. `sendEmail` fires immediately via Resend. `enqueueEmail` inserts into pg-boss queue (3 retries × 60s). **Gotcha**: the `db` param accepted by `enqueueEmail` is completely ignored — emails always enqueue to the public schema pg-boss regardless of which DB is passed. Tenant→customer emails (`receipt`, `digest` types) send from `slug@sanopos.com`; all other types send from `noreply@sanopos.com`.

### `email-templates.js`
`TEMPLATES` registry maps email type string → `{ subject, html }` builder function. `wrapEmailHtml(title, body)` renders the branded shell. To add a new email type: add the builder here AND register it in `TEMPLATES`.

### `payment-gateway.js`
Adapter pattern for payment processing. Exports: `createCheckout()`, `createInvoiceCheckout()`, `verifyWebhook()`, `isEnabled()`, `refund()`, `processInlinePayment()`, `tokenize()`, `chargeSavedInstrument()`, `getPaymentAdapter()`, `BasePaymentAdapter`, `ADAPTERS`. Active adapter selected by `PAYMENT_GATEWAY` env var (`manual` default, `xpay`, `sandbox`). **Gotcha**: `isEnabled()` checks `!!process.env.XPAY_API_KEY`, not just the `PAYMENT_GATEWAY` var — always gate payment UI behind `isEnabled()`. `manual` adapter throws on `createCheckout`. Sandbox adapter requires `SANDBOX_WEBHOOK_SECRET`.

### `printer.js`
Factory export: `makePrinterService(db)` → `{ printReceipt, printerStatus, printTest, printToNetwork }`. Supports USB (ESC/POS) and TCP raw socket. Timeouts: 3s printer-builder, 2s TCP status ping, 5s `printToNetwork` socket. Paper width read from DB drives layout.

### `fbr.js`
FBR Digital Invoicing client. Exports: `buildInvoicePayload`, `buildCreditNotePayload` (returns), `buildDebitNotePayload` (voids), `postToFbr`, `enqueueFbrInvoice`, `validateConnection`, `getNextRetryDelay`, `FBR_URLS`, `BACKOFF_DELAYS`. `enqueueFbrInvoice` writes a DB row first, then fires pg-boss. Exponential backoff: 60s → 5m → 15m → 1h → 4h (5 attempts total). Called by `routes/fbr.js` and `workers/fbr-worker-boss.js`.

### `catalog-scheduler.js`
Applies one pending scheduled change per call. Export: `applyScheduledChange(db, change)`. Validates `entity_type` + `field_name` against an allowlist from `schemas/scheduled-changes.js` — **security-critical**: column name is interpolated into the UPDATE string; the allowlist is the only SQL injection guard. Non-throwing — returns `{ status, reason }` so a batch loop can continue past bad rows. Called by the scheduled-catalog worker in `boot/workers.js`.

### `geo.js`
Pure geometry helpers, no external dependencies. Computes distance between two lat/lng points (haversine). Used by `routes/field.js` to flag a wholesale field-rep check-in as out-of-geofence against the customer's stored shop location.

### `sms.js`
SMS delivery adapter pattern. Exports: `sendSms`, `testProvider`, `getSmsAdapter`, `resolveProvider`, `BaseSmsAdapter`, `ADAPTERS`. Adapters: `GenericHttpAdapter` (keys: `generic`, `zong_sms`, `jazz_sms`) + `TwilioAdapter`. Persists to `sms_provider_messages`. Configured via `integration_settings` (`category = 'sms'`).

### `manager-pin.js`
PIN-based manager-approval verification for void/comp overrides at POS. Reuses the bcrypt algorithm from `routes/employees.js`, with a plaintext `pin_code` fallback for employees not yet migrated to hashed PINs. Hard refusal when `req.isImpersonating === true` — an impersonating super-admin can never self-approve an irreversible floor action.

### `phase4-polling.js`
Long-poll helper shared by real-time surfaces (KDS, floor plan, booking calendar): `getChangesSince(db, table, since, outletId)`. **Security note**: `table` name is interpolated directly into SQL — callers must never pass untrusted input.

---

## Shared Money/Stock Writers

These are the load-bearing "one true implementation" services — every sale/return/transfer/conversion writer in `routes/` is expected to funnel through them rather than hand-rolling stock or tax math. If you're adding a new place that moves stock or resolves tax, start here.

### `stock-ledger.js`
Exports `decrementStock`/`incrementStock` — the single home for "move on-hand stock" semantics, extracted verbatim from the POS sale path (`routes/sales.js`) so every other writer (quotation-convert, inventory transfer, supplier return, PO receive, stock count) shares identical behavior instead of drifting. **Must be called inside the caller's `deps.db.transaction(...)`** — takes a `SELECT ... FOR UPDATE` lock on the authoritative stock row, gates on `available >= qty`, and writes all three stock tables when a variant is present (`variant_outlet_stock`, `product_variants.stock` rollup, `outlet_stock`). Table-selection rule: `variant_outlet_stock` is authoritative when a row exists for that outlet; otherwise falls back to the `product_variants.stock` rollup (pre-v65 tenants not yet backfilled per-outlet). Batch handling defaults on (`manageBatch: true`) — decrement uses FEFO via `batch-stock.js:consumeBatches`, increment prefers the batch the sale drew from via `returnToBatch`. Pass `manageBatch: false` for callers with different batch semantics (transfers must preserve batch identity via `batchStock.transferBatches`, GRN creates a fresh lot via `batchStock.receiveBatch`, stock-count correction is bidirectional via `batchStock.adjustBatches`) and drive the ledger yourself in the same transaction. Throws a typed `insufficient_stock` error (`statusCode: 400`) with `product_id`/`variant_id`/`available`/`requested` on the gate failure.

### `tax-snapshot.js`
Exports `resolveTaxSnapshot(db, { items, taxMode, taxInclusive, outletId, tenantId })` — the single source of truth for the v83 per-line tax cascade every sale writer applies (POS, storefront, layaway settle, pay-at-table, quotation convert, manual orders). Cascade order: outlet_tax_profiles match (when `phase2_outlet_tax` flag on and outlet known) → `products.tax_id` → `taxes.rate` → `products.gst` (legacy direct rate) → category-tree inherited tax_id → 0. `tax_mode='none'` overrides everything to 0. Read-only — safe to call outside a transaction. Returns per-line `{ rate, amount, hsCode }` plus `taxTotal`/`gross`/`subtotal`/`taxInclusive`.

### `batch-stock.js`
FEFO (first-expired-first-out) batch/expiry ledger underneath `stock-ledger.js`. Exports `consumeBatches`, `returnToBatch`, `transferBatches`, `receiveBatch`, `adjustBatches`, `roundQty`. Backs `product_batches`/`stock_batches` for the F07 batch/expiry feature — most callers should go through `stock-ledger.js` rather than calling this directly, except the three explicit `manageBatch:false` cases noted above.

### `kit-engine.js`
BOM/recipe engine for kit (assembled-at-sale) and assembled (assembled-at-production, via `stock_conversion_lines`) products. Exports `getBomType(db, productId)` — returns `'kit' | 'assembled' | null`, consumed by `routes/tier4/crm.js` (quotation-convert hard-rejects kits) and the reports layer (`recipe-costing.js` treats kit vs assembled consumption differently).

### `business-modules.js`
The module toggle engine behind `routes/business-modules.js` — see `backend/CLAUDE.md` for the full behavioral summary. Key exports: `toggleModule` (atomic flag+mode transaction: saved_flags snapshot/restore, depends_on cascade with Bucket C dependents left connected, platform-lock check, first-mode-row backfill, action_history audit, cache invalidation), `computeImpact` (confirm-dialog preview), `loadLiveFlags`/`loadLiveModes` (deliberately uncached — settings pages must see fresh state), `rejectCatalogManagedFlagWrites` (the legacy `PUT /api/feature-flags/:key` lockdown middleware). Gotchas: repeated disable keeps the existing saved_flags snapshot (double-click guard); the snapshot is cleared once consumed by re-enable; writing the tenant's FIRST `tenant_modes` row flips `requireMode` from fall-through to enforcing for every mode, so the service backfills enabled=true rows for any drifted mode first.

**v2 per-outlet additions (PLAN-V2 Steps 8–11).** `resolveOutletStates` / `setOutletModuleState` / `getDisabledOutletIds` / `computeChecklists`, plus the bulk loaders `loadActiveOutlets` / `loadOutletOverrides` / `loadModuleDefaults`. Rules worth knowing before touching them:
- **Resolution**: `effective(outlet) = companyEnabled AND (override ?? default_outlet_enabled ?? TRUE)`. Only `scope:"outlet"` cards participate — tenant/device/**hybrid** are tenant-wide in v2 and 409 `TENANT_SCOPED` on any outlet operation.
- **Sparse is legal**: no `tenant_business_modules` row at all ⇒ default TRUE. Never assume the row exists.
- **A company disable never touches override rows** — they lie dormant and reappear on re-enable (same hide-not-delete philosophy as saved_flags). This is structural: the company toggle path never writes `outlet_business_modules`.
- **Query budget is a contract**: every read is bulk (one query for outlets, one for all overrides, one for all defaults, one batched EXISTS for all checklists) — never per-card or per-outlet. An integration test asserts the GET query count; keep new work inside it.
- **`getDisabledOutletIds` is a worker DENY-list and deliberately ignores company state** — worker callers already gate on the tenant feature flag, and it composes with that. Its fast path returns `[]` so callers add no SQL filter at all.
- **`scopeImpactSql` is conservative by design**: any impact query containing a join/group-by/having/union/**or** falls back to a tenant-wide count (`tenant_wide: true`) rather than risk a wrong scoped one — `or` is on that list because AND binds tighter, so appending `AND outlet_id = $1` to `WHERE a OR b` would silently count other outlets.

### `preset-apply.js`
Exports `applyPreset(db, industryType)` / `expectedFlagsForPreset(...)` — the shared tenant industry-preset seeding logic. Clears `tenant_modes`, re-derives feature flags for the new preset. This is the **one code path** used both by the tenant-side `PUT /api/company-profile` (industry_type change) and the super-admin "reapply preset"/flag-drift repair tooling in `routes/admin/tenants.js` — fix mode-seeding bugs here, not inline in either caller.

### `lifecycle-events.js`
Exports `recordLifecycleEvent(...)` — append-only tenant lifecycle audit trail (signup, suspend/activate/delete, payment recorded, upgrade approved, bulk-lifecycle actions). Called by `routes/admin/tenants.js` and `routes/admin/billing.js` in addition to (not instead of) `logAdminAction`/`tenant_audit_log` — check this table when tracing a tenant's full history.

### `embedded-barcode.js`
Exports `normalizeScheme(...)` — decode-scheme normalizer for V01 grocery/deli price/weight-embedded barcodes (e.g. `2{5-digit PLU}{5-digit weight/price}`). Scheme is stored on `company_profile.barcode_scheme` (JSON) via `routes/tier4/company-profile.js`; consumed by the POS scan route to interpret embedded-price barcodes at checkout.

### `admin-login-alert.js` / `admin-totp.js`
Super-admin panel security helpers, used only by `routes/admin/auth.js`. `admin-login-alert.js` exports `isNewLoginIp`/`alertNewLoginIp` — fires a non-blocking email on a login from an unrecognized IP. `admin-totp.js` wraps 2FA secret/QR generation and recovery-code issuance for the super-admin TOTP enrollment flow.

### `aggregator-orders.js`
Delivery-aggregator (foodpanda/Careem) order-ingestion pipeline: `resolveTenantForStore()` → `normalizeOrder()` (delegates to the platform client's static method — see `marketplace/CLAUDE.md`) → `ingestOrder()` (idempotent on source+external id) → auto-accept → `online-inbox.acceptOnlineOrder()` → `settleAggregatorSale()`. This webhook path is **signature-verified and fail-closed**, unlike the four Integrations-Hub webhooks (Daraz/Meta/WhatsApp) which are not signature-verified. `settleAggregatorSale` is a dedicated sales writer (distinct from the pay-at-table settle path) so stock decrements + kit-engine recipe consumption stay consistent with POS; decrements here are unconditional (can go negative) since the order is already paid on the platform and can't be rolled back.

### `credit.js` / `backorder.js`
Wholesale AR/credit-limit gate (`credit.js`) and split-shipment/backorder logic (`backorder.js`) for the B2B wedge — checked by the sales/order-capture path when a wholesale customer exceeds their credit limit or an order can only be partially fulfilled from on-hand stock.

---

## Subdirectory Modules

### `couriers/`
Adapter pattern for courier API integration. Single entry point: `index.js` exports `getAdapter(adapterKey, config)` — maps a slug string to a class instance. Config comes from the `courier_integrations` DB row via `routes/couriers.js`, which (as of WS3 C2) builds the adapter config through `buildCourierAdapterConfig(row)`: it `decryptSecret()`s `api_key`/`api_secret` and `JSON.parse`s `config_json` (a TEXT column) into an object before handing it over. So adapters receive **decrypted credentials and a parsed config object** — `this.config.config_json?.cost_center` (TCS), PostEx address codes, DHL/FedEx `account_number` resolve correctly. Credentials are encrypted on write (`PUT /api/couriers/:id`) and back-filled for legacy rows by migration v127.

**Class hierarchy**: `BaseCourierAdapter` (abstract, all methods throw) → named adapters; `GenericAdapter` (manual-entry no-ops, never throws) → `BykeaAdapter`, `PakPostAdapter`.

**Three methods on every adapter**:
- `bookShipment(order, sender, receiver, options)` → `{ tracking_number, label_url, raw? }` — throws on failure
- `getTracking(trackingNumber)` → `{ status, events: [...] }`
- `cancelShipment(trackingNumber)` → `{ success, message }` — never throws; wraps API calls in try/catch

**Adapters with real booking APIs**: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, dhl, fedex. **Booking blocked (501)**: bykea (hyperlocal, manual entry via app), pakpost (counter-booking only). **No env vars** — all credentials come from `this.config`. DHL/FedEx fetch OAuth tokens on every call (no caching). See `couriers/CLAUDE.md` for per-adapter auth patterns, error detection logic, and COD service type strings.

### `marketplace/`
Five files — abstract base + four platform adapters for the Integrations Hub. Gated by `marketplace_integrations` feature flag. Credentials in `integration_settings`, encrypted via `services/crypto.js`.

**Base class** (`base-marketplace.js`): four abstract methods — `testConnection()`, `syncProducts(products)`, `pullOrders(since)`, `pushInventory(updates)` — all throw "Not implemented".

**Adapters**:
- `daraz-client.js` — HMAC-SHA256 signed requests. N+1 pattern on `pullOrders`: one extra API call per order to fetch items. `pushInventory()` only sends caller-supplied SKUs; the Daraz route (`routes/integrations/daraz.js`) filters mapped rows to `daraz_sku IS NOT NULL` before calling `pushInventory`, using `daraz_product_map.daraz_sku || products.sku` — there is no broad client-side fallback to `barcode || "SP-${id}"` in the inventory push path.
- `meta-commerce.js` — Graph API v19.0, access token as query param. Price format in `syncProducts`: integer cents as string (`"PKR 1000"`). `pullOrders` only fetches `FB_PROCESSING` state orders; prices in response are in cents (÷100 on ingest).
- `whatsapp-client.js` — Not a marketplace; `syncProducts`/`pullOrders`/`pushInventory` are silent no-ops returning `[]`/`[]`/`{ updated: 0 }`. Real methods: `sendTemplate`, `sendTextMessage`, `sendOrderConfirmation`, `sendTrackingUpdate`. Uses `api_key` (not `oauth_token`) as bearer token.
- `google-merchant.js` — Content API v2.1. `pullOrders()` always returns `[]` (Google sends traffic to your site, doesn't process orders). `pushInventory` silently swallows per-update errors but always returns `{ updated: N }`. Extra method `checkFeedStatus()` (not on base class) — called by the 6-hour worker job.

**Background sync**: `workers/marketplace-sync-worker-boss.js` — `marketplace-order-poll` every 10 min, `marketplace-feed-check` every 6h (Google only). Both worker handlers are currently stubs; they schedule jobs and log intent but do not call `DarazClient`, `MetaCommerceClient`, or `GoogleMerchantClient`. Inbound webhooks: `POST /api/webhooks/{daraz,meta,whatsapp}` mounted before tenant middleware. Only `POST /api/webhooks/xpay` is HMAC-verified; Meta and WhatsApp GET handlers check verify tokens but their POST handlers, and the Daraz POST handler, are not HMAC-verified. See `marketplace/CLAUDE.md` for full config shape per adapter.

### `import/mappers/`
Import mappers for bulk data ingestion. `index.js` is the entry point; `shopify.js` and `square.js` map platform-specific export formats to internal schema shape. Used by `routes/import.js`.

---

## Domain Service Modules

### Bookings / Appointments
- **`booking-services.js`** — `createAppointment`, `rescheduleAppointment`, `cancelAppointment`. Public bookings add a 15-min minimum notice guard and enqueue `booking_confirmation` email (non-fatal). Admin bookings bypass time guards. Auto-schedules a 1-hour-before reminder.
- **`booking-availability.js`** — `getAvailableSlots`, `checkOverlap`. Slot granularity hardcoded to 15-minute increments.
- **`booking-reminders.js`** — `processPendingReminders(db, boss)`. **Known bug**: SMS channel silently skipped — only email is implemented, but `status='sent'` still fires for SMS rows; this is intentionally documented behavior, don't "fix" without updating the guarding unit test.

### Restaurant
- **`restaurant-checks.js`** — check lifecycle: `createRestaurantCheck`, `getOpenChecks`, `assignSeat`, `splitCheckByItem`, `splitCheckBySeat`, `fireCourse`, `openTab`, `closeTab`, `recalcCheckTotals`. Note: `addItemToCheck` and `closeCheck` do NOT exist.
- **`restaurant-floor.js`** — floor plan + table sessions: `getFloorPlans`, `getFloorPlanWithTables`, `createFloorPlan`, `updateFloorPlan`, `openTableSession`, `updateTableSession`. Closing a table session uses `updateTableSession({ status: "closed" })` — `closeTableSession` does NOT exist.
- **`restaurant-kds.js`** — KDS: `getStations`, `createStation`, `updateStation`, `sendToKitchen`, `getTickets`, `bumpTicket`, `recallTicket` (resets bumped → `'new'`).
- **`modifiers.js`** — modifier groups + options, product links, draft-order-item attach flow. Summed `price_delta` is baked into `draft_order_items.price` on attach, so downstream total recalculation needs no special handling. Group constraint validation (`min_select`, `max_select`, `is_required`, `selection_type`) runs in this service, not via Zod.
- **`menu-schedule-resolver.js`** — day-parting resolver. Menu schedules are restrictions, not allowlists: a product with zero schedule rows is always available; products with one or more schedule rows are only available within those windows. Per-outlet 60s cache (`invalidateMenuScheduleCache()` on writes) because the public QR menu endpoint can be hit at high rate.
- **`tips.js`** — per-sale tip capture/lookup (`captureTipOnSale`, `listTipsForShift`) plus end-of-shift tip pooling (`openTipPool`, `closeTipPool`, `distributeTipPool`, `voidTipPool`). `tip_captures.pool_id` links the two halves; `distributeTipPool` writes `tip_pool_payouts` + `commission_earnings` (`earning_type='tip'`) as the single source of truth for payroll.

### Rentals
- **`rental-service.js`** — full rental lifecycle: items, assets, contracts, status transitions (`confirmContract`, `checkoutContract`, `returnContract`, `completeContract`, `cancelContract`), availability, overdue detection, invoice generation. Also exports `generateContractNumber`, `computeLateFee`.

### Rooms / Hotel
- **`room-service.js`** — room types, rooms, rate overrides, availability, full booking lifecycle (`createBooking` → `confirmBooking` → `checkInBooking` → `checkOutBooking`, `cancelBooking`, `markNoShow`), folio management (`openFolio`, `addFolioLine`, `attachSaleToFolio`, `settleFolio`). Also exports `resolveRateForDate`, `calculateStayTotal`.
- **`room-deposits.js`** — gateway pre-auth deposit flow: `createDepositPreAuth`, `handleDepositWebhook`, `captureDepositOnCheckout`, `findBookingByIntent`. Works alongside `payment-gateway.js`; captured on guest checkout.

### Treatment Plans (Clinical)
- **`treatment-plan-service.js`** — patient subjects, plan CRUD with status transitions, sessions (`startSession`, `completeSession`, `markSessionNoShow`, `cancelSession`), charting, lab orders, folio sub-system. Worker-called exports: `getOverduePlans`, `getUpcomingSessionsNeedingReminder`.
- **`treatment-plan-deposits.js`** — gateway pre-auth deposit for treatment plans: `createDepositPreAuth`, `handleDepositWebhook`, `captureDepositOnSettle`, `findPlanByIntent`. Settles on plan completion (not checkout — contrast with `room-deposits.js`).

### Projects / Contracts
- **`projects.js`** — service project lifecycle: create/update/get/list projects, milestones, activity log. Tables: `service_projects`, `project_milestones`, `project_activities` (NOT `project_activity_log`), `project_files`.
- **`contracts.js`** — contract lifecycle: `createContract`, `updateContract`, `sendContract`, `signContract`, `getContract`, `logContractEvent`. Supports project-linked contracts and multi-signer flows.
- **`project-billing.js`** — links invoices/subscriptions to projects: `attachInvoiceToProject`, `getProjectBillingSummary`. Delegates activity logging to `projects.js`.

### Customer Finance
- **`customer-invoicing.js`** — B2B invoices: `generateInvoiceNumber` (INV-000001), `computeInvoiceTotals` (pure), `recomputeBalance`, `convertQuotationToInvoice`, `createBatchInvoices`, `scheduleReminders`. `scheduleReminders` requires `tenantSlug` (throws if omitted). `createBatchInvoices` has a 24h idempotency guard.
- **`subscriptions.js`** — recurring subscription lifecycle: `computeNextPeriod`, `processRenewal`, `cancelSubscription`, `pauseSubscription`, `resumeSubscription`. `processRenewal` requires `tenantSlug`. Renewal jobs use `singletonKey` (`${subscriptionId}:${date}`) in pg-boss to deduplicate. INTERVAL_DAYS: monthly=30, quarterly=90, yearly=365 (not calendar months/years).

### Omnichannel / Storefront
- **`quote.js`** — storefront pricing engine: `calculateQuote`, `resolvePriceForContext`. Price-list cascade: outlet → channel → customer → customer_group → customer.price_list_id → base. Also evaluates active promotions and accepts `courierId` for flat shipping rate lookup.
- **`storefront-cart.js`** — anonymous/authenticated cart: `getOrCreateCart`, `addItem`, `updateItem`, `removeItem`, `getCartWithItems`. Cart expires after 7 days. `addItem` upserts — same product+variant increments quantity. Delegates to `moq.js` and `product-visibility.js` before allowing an add.
- **`moq.js`** — minimum order quantity + case-pack increment enforcement. Shared by the storefront cart (portal + public storefront) and `/api/sales` for field-rep order capture (gated by `field_visit_uuid`); POS is intentionally never gated — cashiers are in person with the buyer. Defaults (`min_order_qty=0`, `order_increment=1`) preserve pre-v95 behavior. Returns `{ ok, violations: [...] }` for one item or an array of items.
- **`product-visibility.js`** — customer-group catalog visibility (Option C/C2). `products.visibility='all'` is visible to everyone; `'restricted'` is visible only to customers whose `customer_group_id` appears in `customer_group_products`. Ungrouped/anonymous buyers see only `'all'` rows by design — a forgotten new buyer sees a partial catalog, never private-label SKUs.
- **`reservation.js`** — inventory reservation: `createReservation`, `convertReservations`, `releaseReservations`, `expireStaleReservations`, `getActiveReservationsForOutlet`. Uses `SELECT ... FOR UPDATE` to prevent oversell. Default TTL 15 minutes. `releaseReservations` sorts stock keys before locking to prevent deadlocks. No partial fulfillment — outlet must have full quantity or 400 is thrown.
- **`allocation.js`** — fulfillment allocation: `allocateOrder`, `getAllocationsForOrder`. Pickup → fixed outlet; ship → highest-stock outlet. Runs inside `db.transaction()`. No partial fulfillment.
- **`public-tenant-context.js`** — shared public tenant resolver: `resolvePublicTenantDb(req, deps)`. MT-aware (reads `tenant` query param or `x-tenant-slug` header). Used by storefront, QR ordering, and public booking routes.

### Marketing / Messaging
- **`marketing.js`** — campaign audience resolution + delivery: `resolveAudience` (filter rules → customer IDs, or `previewOnly` → count+sample), `enqueueCampaignSend` (requires `tenantSlug`). Filter types: group, tag, loyalty_tier, city, birth_month, last_purchase_days, min_spend, max_spend, has_email, has_mobile.
- **`messaging.js`** — generic messaging inbox: `findOrCreateThread`, `addMessage`. Auto-resolves customer from WhatsApp mobile number. Inbound increments `unread_count`, outbound replies reset it to 0.
- **`sms.js`** — see Core Infrastructure Services above.

### Retail / Pricing
- **`pricing.js`** — customer-group + loyalty-tier price resolution. Fetches group/tier info for a customer, looks up group-scoped `price_list_items` overrides, and returns data the sales route needs to rewrite cart prices and stack discounts. Group and tier discounts stack additively (10% + 5% = 15%); per-product overrides and group-level auto-discount are both flag-gated.
- **`retail-flag-preset.js`** — feature flag preset seeding for new tenants at wizard completion. `RETAIL_SEED_FLAGS` (general retail), `RESTAURANT_SEED_FLAGS` (restaurant/cafe — subset of retail tuned for F&B). Called during tenant provisioning/wizard, not on every request.
- **`inventory-intelligence.js`** — ABC Pareto classification (with stable tie-break), sales velocity, GMROI, lead-time resolution priority chain, reorder quantity suggestion. Backs `/api/inventory-intelligence`.

### Service Tickets
- **`service-tickets.js`** — repair/service ticket lifecycle: `generateTicketNumber`, `createTicket`, `updateTicket`, `getTicket`, `listTickets`, `generateInvoiceFromTicket`, `logActivity`. Supports direct invoice generation from a resolved ticket.

### Approvals / Policy
- **`approval-policy.js`** — policy evaluation: `evaluatePolicy`, `recordApprovalEvent`. Action types: `manual_discount`, `discount_code`, `return`, `unverified_return`, `void`, `tax_edit`, `order_cancel`, `custom_sale`.

### Customer Portal
- **`online-inbox.js`** — customer-facing message inbox for the self-service portal.

### Other domain services (quick reference)
- **`commission-calc.js`** — sales commission computation, feeds `hr.js` payroll generation and `tip-pool` payout distribution.
- **`class-bookings.js`** — gym/fitness class scheduling (V07), sits alongside `booking-services.js` for the fixed-schedule (vs. appointment) booking shape.
- **`client-service-records.js`** — per-customer service history (salon V04 "walk-in performed-by" history writer).
- **`deposit-engine.js`** — shared deposit/pre-auth math underneath `room-deposits.js` and `treatment-plan-deposits.js`.
- **`forms.js`** — reusable form builder/renderer (F03); snapshots submitted field definitions (`fields_snapshot`) so a later form-template edit doesn't retroactively change historical submissions.
- **`members.js`** — gym/membership status derivation (V07) — `deriveMemberStatus` is the single source of truth for active/expired/frozen.
- **`packages.js`** — service package/bundle billing (F02) plus dunning.
- **`promo-engine.js`** — promotions/discount evaluation, including wholesale `slab_percent` tier rules; writes the `sale_promotion_applications` audit snapshot.
- **`recall-service.js`** — clinical recall engine (V05) — due/overdue patient recall computation.
- **`room-channel-sync.js`** — OTA/iCal channel sync for lodging (V10); writes `channel_sync_dead_letters` on conflict.
- **`room-night-audit.js`** — nightly room/folio audit job logic for lodging.
- **`waitlist.js`** — restaurant/booking waitlist management.
- **`sms-templates.js`** — template registry for `sms.js` sends (parallel to `email-templates.js`).
- **`customer-notify.js`** — shared customer notification dispatch point (F05) — single call site other services should use instead of hand-rolling a notification insert.
- **`ai.js`** — Claude API wrapper backing `/api/insights/ask` (chat) and the auto-SKU/description-generation fast-entry features. Requires `ANTHROPIC_API_KEY`.

---

## Key Conventions and Gotchas

### Encryption format
All integration credentials stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to any adapter. Courier and WooCommerce credentials are AES-256-GCM encrypted like Shopify/marketplace (WS3 C2 closed the plaintext gap). Courier adapters receive pre-decrypted config with a parsed `config_json` object — decryption + JSON parse happen in the route layer (`routes/couriers.js:buildCourierAdapterConfig`), not in the adapter.

### pg-boss usage
- Always get the shared instance via `getBoss()` from `boss.js` — never construct `PgBoss` directly
- `boss.send` in `subscriptions.js` intentionally runs outside the transaction — this is correct
- Renewal jobs use `singletonKey` to deduplicate in pg-boss across concurrent workers

### Adapter pattern (couriers + marketplace + payment + SMS)
All adapter layers share the same pattern: abstract base class with throwing stubs, concrete adapters extend it, a factory function maps keys to instances. Never call abstract methods on the base directly.

### Non-throwing services
`booking-reminders.js`, `catalog-scheduler.js`, and `cancelShipment` on all courier adapters are intentionally non-throwing — they return status objects so batch loops can continue. Don't change this behavior.

### `tenantSlug` required params
`subscriptions.processRenewal`, `customer-invoicing.scheduleReminders`, and `marketing.enqueueCampaignSend` all throw if `tenantSlug` is omitted — it is required for pg-boss job context.

### No env vars in courier/marketplace adapters
Courier and marketplace adapters read zero `process.env` variables. All config flows in through the constructor from the DB row.

### Google Merchant `pushInventory` silent failures
`google-merchant.js:pushInventory` swallows per-item errors and always returns `{ updated: N }` even if all updates fail. Do not rely on the return value for error detection.

### Wholesale services intentionally skip POS
`moq.js` and the field-sales geofencing in `geo.js` both apply to portal/storefront/field-rep flows, never to POS — cashiers transact face-to-face with the buyer and don't need programmatic enforcement.
