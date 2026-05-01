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
Unified email service. Exports: `sendEmail({ type, to, tenant, data, subject, html })`, `enqueueEmail({ type, to, tenant, data, subject, html }, boss)`, `resolveFrom(type, tenant)`. `sendEmail` fires immediately via Resend. `enqueueEmail` inserts into pg-boss queue (3 retries × 60s). **Gotcha**: the `db` param accepted by `enqueueEmail` is completely ignored — emails always enqueue to the public schema pg-boss regardless of which DB is passed. Tenant→Customer emails (`receipt`, `digest` types) send from `slug@sanopos.com`; all other types send from `noreply@sanopos.com`.

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

---

## Subdirectory Modules

### `couriers/`
Adapter pattern for courier API integration. Single entry point: `index.js` exports `getAdapter(adapterKey, config)` — maps a slug string to a class instance. Config nominally comes from the `courier_integrations` DB row, but `routes/couriers.js` passes `courier.config_json` as raw text into adapters; adapters expect a nested object but may receive an unparsed string. Decryption of credentials via `services/crypto.js` is expected to happen upstream, but verify the route layer before assuming config is already parsed and decrypted.

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
- `google-merchant.js` — Content API v2.1. `pullOrders()` always returns `[]` (Google sends traffic to your site, doesn't process orders). `pushInventory` silently swallows per-update errors but always returns `{ updated: N }`. Extra method `checkFeedStatus()` (not on base class) — called by 6-hour worker job.

**Background sync**: `workers/marketplace-sync-worker-boss.js` — `marketplace-order-poll` every 10 min, `marketplace-feed-check` every 6h (Google only). Both worker handlers are currently stubs; they schedule jobs and log intent but do not call DarazClient, MetaCommerceClient, or GoogleMerchantClient. Inbound webhooks: `POST /api/webhooks/{daraz,meta,whatsapp}` mounted before tenant middleware. Only `POST /api/webhooks/xpay` is HMAC-verified; Meta and WhatsApp GET handlers check verify tokens but their POST handlers, and the Daraz POST handler, are not HMAC-verified. See `marketplace/CLAUDE.md` for full config shape per adapter.

### `import/mappers/`
Import mappers for bulk data ingestion. `index.js` is the entry point; `shopify.js` and `square.js` map platform-specific export formats to internal schema shape. Used by `routes/import.js`.

---

## Domain Service Modules

### Bookings / Appointments
- **`booking-services.js`** — `createAppointment`, `rescheduleAppointment`, `cancelAppointment`. Public bookings add 15-min minimum notice guard and enqueue `booking_confirmation` email (non-fatal). Admin bookings bypass time guards. Auto-schedules 1-hour-before reminder.
- **`booking-availability.js`** — `getAvailableSlots`, `checkOverlap`. Slot granularity hardcoded to 15-minute increments.
- **`booking-reminders.js`** — `processPendingReminders(db, boss)`. **Known bug**: SMS channel silently skipped — only email is implemented, but `status='sent'` still fires for SMS rows.

### Restaurant
- **`restaurant-checks.js`** — check lifecycle: `createRestaurantCheck`, `getOpenChecks`, `assignSeat`, `splitCheckByItem`, `splitCheckBySeat`, `fireCourse`, `openTab`, `closeTab`, `recalcCheckTotals`. Note: `addItemToCheck` and `closeCheck` do NOT exist.
- **`restaurant-floor.js`** — floor plan + table sessions: `getFloorPlans`, `getFloorPlanWithTables`, `createFloorPlan`, `updateFloorPlan`, `openTableSession`, `updateTableSession`. Closing a table session uses `updateTableSession({ status: "closed" })` — `closeTableSession` does NOT exist.
- **`restaurant-kds.js`** — KDS: `getStations`, `createStation`, `updateStation`, `sendToKitchen`, `getTickets`, `bumpTicket`, `recallTicket` (resets bumped → `'new'`).

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
- **`customer-invoicing.js`** — B2B invoices: `generateInvoiceNumber` (INV-000001), `computeInvoiceTotals` (pure), `recomputeBalance`, `convertQuotationToInvoice`, `createBatchInvoices`, `scheduleReminders`. `scheduleReminders` requires `tenantSlug` (throws if omitted). `createBatchInvoices` has 24h idempotency guard.
- **`subscriptions.js`** — recurring subscription lifecycle: `computeNextPeriod`, `processRenewal`, `cancelSubscription`, `pauseSubscription`, `resumeSubscription`. `processRenewal` requires `tenantSlug`. Renewal jobs use `singletonKey` (`${subscriptionId}:${date}`) in pg-boss to deduplicate. INTERVAL_DAYS: monthly=30, quarterly=90, yearly=365 (not calendar months/years).

### Omnichannel / Storefront
- **`quote.js`** — storefront pricing engine: `calculateQuote`, `resolvePriceForContext`. Price-list cascade: outlet → channel → customer → customer_group → customer.price_list_id → base. Also evaluates active promotions and accepts `courierId` for flat shipping rate lookup.
- **`storefront-cart.js`** — anonymous/authenticated cart: `getOrCreateCart`, `addItem`, `updateItem`, `removeItem`, `getCartWithItems`. Cart expires after 7 days. `addItem` upserts — same product+variant increments quantity.
- **`reservation.js`** — inventory reservation: `createReservation`, `convertReservations`, `releaseReservations`, `expireStaleReservations`, `getActiveReservationsForOutlet`. Uses `SELECT ... FOR UPDATE` to prevent oversell. Default TTL 15 minutes. `releaseReservations` sorts stock keys before locking to prevent deadlocks. No partial fulfillment — outlet must have full quantity or 400 is thrown.
- **`allocation.js`** — fulfillment allocation: `allocateOrder`, `getAllocationsForOrder`. Pickup → fixed outlet; ship → highest-stock outlet. Runs inside `db.transaction()`. No partial fulfillment.
- **`public-tenant-context.js`** — shared public tenant resolver: `resolvePublicTenantDb(req, deps)`. MT-aware (reads `tenant` query param or `x-tenant-slug` header). Used by storefront, QR ordering, and public booking routes.

### Marketing / Messaging
- **`marketing.js`** — campaign audience resolution + delivery: `resolveAudience` (filter rules → customer IDs, or `previewOnly` → count+sample), `enqueueCampaignSend` (requires `tenantSlug`). Filter types: group, tag, loyalty_tier, city, birth_month, last_purchase_days, min_spend, max_spend, has_email, has_mobile.
- **`messaging.js`** — generic messaging inbox: `findOrCreateThread`, `addMessage`. Auto-resolves customer from WhatsApp mobile number. Inbound increments `unread_count`, outbound replies reset it to 0.
- **`sms.js`** — SMS delivery adapter pattern. Exports: `sendSms`, `testProvider`, `getSmsAdapter`, `resolveProvider`, `BaseSmsAdapter`, `ADAPTERS`. Adapters: `GenericHttpAdapter` (keys: `generic`, `zong_sms`, `jazz_sms`) + `TwilioAdapter`. Persists to `sms_provider_messages` table.

### Retail / Pricing
- **`pricing.js`** — price resolution utilities for POS and storefront contexts.
- **`retail-flag-preset.js`** — feature flag preset seeding for new retail tenants. Called during tenant wizard setup.
- **`modifiers.js`** — product modifier group/option management for restaurant and retail.
- **`menu-schedule-resolver.js`** — resolves active menu/price schedule for a given datetime. Used by restaurant routes.
- **`tips.js`** — tip calculation helpers for POS and service contexts.

### Service Tickets
- **`service-tickets.js`** — repair/service ticket lifecycle: `generateTicketNumber`, `createTicket`, `updateTicket`, `getTicket`, `listTickets`, `generateInvoiceFromTicket`, `logActivity`. Supports direct invoice generation from a resolved ticket.

### Approvals / Policy
- **`approval-policy.js`** — policy evaluation: `evaluatePolicy`, `recordApprovalEvent`. Action types: `manual_discount`, `discount_code`, `return`, `unverified_return`, `void`, `tax_edit`, `order_cancel`, `custom_sale`.

### Customer Portal
- **`online-inbox.js`** — customer-facing message inbox for the self-service portal.

### Infrastructure / Utilities
- **`phase4-polling.js`** — long-poll helper for real-time surfaces (KDS, floor plan, booking calendar): `getChangesSince(db, table, since, outletId)`. **Security note**: `table` name is interpolated directly into SQL — callers must never pass untrusted input.
- **`manager-pin.js`** — PIN validation for manager-approval flows in POS.

---

## Key Conventions and Gotchas

### Encryption format
All integration credentials stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to any adapter. Courier adapters receive pre-decrypted config — decryption happens in the route layer, not in the adapter.

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
