# Services — Claude Guide

Business logic, external API clients, and infrastructure services, imported by route handlers via `deps` or direct `require()`. Routes handle HTTP concerns; services own domain logic, DB writes, and external API calls.

---

## Shared Core (the ONE implementation every caller must funnel through)

These are the load-bearing services — every writer elsewhere in the codebase that touches stock, tax, or business-module state is expected to funnel through them rather than hand-rolling the same logic again.

### `stock-ledger.js`
Exports `decrementStock`/`incrementStock` — the single home for "move on-hand stock" semantics, extracted from the POS sale path so every other writer (quotation-convert, inventory transfer, supplier return, PO receive, stock count) shares identical behavior instead of drifting. **Must be called inside the caller's own transaction** — takes a row lock on the authoritative stock row, gates on availability, and writes all relevant stock tables when a variant is present (variant-level outlet stock, the variant rollup, and the outlet-level stock table). Table-selection rule: the variant-level outlet-stock row is authoritative when one exists for that outlet; otherwise falls back to the variant rollup (for outlets not yet backfilled per-outlet). Batch/expiry handling is on by default — decrement uses first-expired-first-out consumption via `batch-stock.js`, increment prefers the batch a sale originally drew from. Callers with different batch semantics (transfers preserving batch identity, GRN creating a fresh lot, stock-count correction) opt out and drive the batch ledger themselves in the same transaction. Throws a typed insufficient-stock error on the availability gate failure, carrying product/variant id, available, and requested quantity.

### `tax-snapshot.js`
Exports `resolveTaxSnapshot(db, { items, taxMode, taxInclusive, outletId, tenantId })` — the single source of truth for the per-line tax cascade every sale writer applies (POS, storefront, layaway settle, pay-at-table, quotation convert, manual orders). Cascade order: outlet tax-profile match (when enabled and the outlet is known) → product's assigned tax rate → legacy direct tax rate on the product → category-tree inherited tax → zero. A tax mode of "none" overrides everything to zero. Read-only — safe to call outside a transaction. Returns a per-line `{ rate, amount, hsCode }` plus aggregate totals. The frozen snapshot this produces on `sale_items` is what every downstream report and tax filing reads — never re-resolved live.

### `business-modules.js`
The module toggle engine behind `routes/business-modules.js` — see `backend/CLAUDE.md` for the behavioral summary. Key exports: `toggleModule` (atomic flag+mode transaction: snapshots disabled flags for exact restore on re-enable, cascades dependent flags without disconnecting dependents that should stay connected, checks the platform-level lock table, backfills any drifted mode row before the very first mode row is written for a tenant since that write flips mode enforcement from fall-through to strict for every mode, writes an audit row, invalidates both flag and mode caches), `computeImpact` (confirm-dialog preview), `loadLiveFlags`/`loadLiveModes` (deliberately uncached — settings pages must see fresh state), `rejectCatalogManagedFlagWrites` (the lockdown middleware on the legacy flag-PUT route once a flag becomes module-managed).

Per-outlet additions: `resolveOutletStates` / `setOutletModuleState` / `getDisabledOutletIds` / `computeChecklists`, plus bulk loaders for active outlets, outlet overrides, and module defaults. Resolution rule: `effective(outlet) = companyEnabled AND (override ?? default_outlet_enabled ?? TRUE)`. Only outlet-scoped cards participate — tenant-scoped, device-scoped, and hybrid-scoped cards are tenant-wide and reject any outlet-level operation. A sparse state (no row at all for a tenant/card pair) means default-enabled — never assume the row exists. A company-level disable never touches outlet override rows; they lie dormant and reappear on re-enable, the same hide-not-delete philosophy as the flag snapshot. Every read in this path is a bulk query (one query for outlets, one for all overrides, one for all defaults, one batched query for all checklists) — never per-card or per-outlet; keep new work inside that budget. The worker-facing disabled-outlet-ids helper is deliberately a deny-list that ignores company-level state, since worker callers already gate on the tenant flag and this composes with that. The impact-preview query builder is conservative by design: any impact query containing a join, group-by, having, union, or `OR` falls back to a tenant-wide count rather than risk scoping it wrong.

### `outlet-copy.js`
The "copy settings from another outlet" logic used when creating a new outlet. A single allowlist doubles as a column-classification contract (which columns are outlet-scoped vs. copied vs. stamped vs. skipped), drift-tested so a new migration column can't be silently dropped from consideration. Copyable tables: outlet business-module state, POS layouts, outlet product visibility, price-list assignments, tip-pool distribution rules, KDS stations. Tax profiles, floor plans, devices, kiosk tokens, and staff schedules deliberately never copy. Runs inside the caller's own outlet-creation transaction.

### `preset-apply.js`
Exports `applyPreset(db, industryType)` / `expectedFlagsForPreset(...)` — the shared tenant industry-preset seeding logic. Clears the tenant's mode rows and re-derives feature flags for the new preset. This is the one code path used both by the tenant-side company-profile update (when `industry_type` changes) and the super-admin "reapply preset"/flag-drift repair tooling — fix preset-seeding bugs here, not inline in either caller.

---

## Core Infrastructure Services

### `logger.js`
Pino singleton. Export: default logger instance. Use `.child({ component })` for sub-loggers. Controlled by an env-configurable log level. Never create multiple instances — always require this one.

### `alerting.js`
In-memory sliding-window alert system. Exports: `recordError`, `recordDbPressure`, `recordHealthCheckFailure`. Fires an alert email on threshold breaches. State resets on restart — by design, not a bug.

### `boss.js`
pg-boss singleton factory. Exports: `getBoss()` (lazy-init, promise-deduplicated), `shutdownBoss()`. Requires a database connection string. Completed jobs are archived, then deleted after a retention window. Call `shutdownBoss()` on process shutdown. Use `getBoss()` everywhere — never construct the job-queue client directly.

### `crypto.js`
AES-256-GCM encryption for all integration credentials. Exports: `encryptSecret(plainText)`, `decryptSecret(storedText)`, `maskSecret(stored)`. Stored format: `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. If no encryption key is configured, encryption degrades gracefully to plaintext pass-through; decryption returns plaintext directly when the stored value doesn't carry the `enc:v1:` prefix (legacy rows).

### `email.js`
Unified email service. Exports: `sendEmail({ type, to, tenant, data, subject, html })` (fires immediately), `enqueueEmail({ type, to, tenant, data, subject, html }, boss)` (queues with limited retries), `resolveFrom(type, tenant)`. Tenant-to-customer email types send from a tenant-branded address; every other type sends from the platform address.

### `email-templates.js`
A registry mapping email type string to a `{ subject, html }` builder function. A shared wrapper renders the branded HTML shell. To add a new email type, add the builder here and register it in the map.

### `payment-gateway.js`
Adapter pattern for payment processing. Exports: `createCheckout()`, `createInvoiceCheckout()`, `verifyWebhook()`, `isEnabled()`, `refund()`, `processInlinePayment()`, `tokenize()`, `chargeSavedInstrument()`, `getPaymentAdapter()`, `BasePaymentAdapter`, `ADAPTERS`. The active adapter is chosen by env config (manual/no gateway is the default). `isEnabled()` checks for a live gateway API key specifically, not just that a gateway name is configured — always gate payment UI behind `isEnabled()`. The manual adapter throws on checkout creation.

### `meta-webhook.js`
Inbound-webhook verification for the two Meta-signed channels (Facebook/Instagram Commerce + WhatsApp Cloud API). Exports `verifySignature`, `verifyHandshake`, `resolveAppSecret`, `resolveVerifyToken`, `META_PROVIDERS`, `SIGNATURE_HEADER`, `signBody` (test helper). Contract: `x-hub-signature-256` = `sha256=` + **hex** HMAC-SHA256 of the raw body — **not** the base64 digest used by `aggregator-orders.js` and `shopify/utils.js`; the three verifiers are not interchangeable. The secret is **app-level** (`META_APP_SECRET`, with an optional `WHATSAPP_APP_SECRET` override) because Meta signs with *our* app's secret, not the tenant's — which is what allows verification to run before tenant resolution. Returns `{ ok, reason }`; an unconfigured secret returns `no_app_secret_configured` and callers must fail closed. No replay window: Meta sends no signed timestamp. Consumed by `routes/webhooks.js` (the request gate) and `routes/integrations/credentials.js` (the activation guard).

### `printer.js`
Factory export: `makePrinterService(db)` → `{ printReceipt, printerStatus, printTest, printToNetwork, openDrawer }`. Supports USB (ESC/POS) and raw TCP socket printing. Paper width read from DB config drives receipt layout.

### `fbr.js`
Tax-authority digital-invoicing client. Exports: `buildInvoicePayload`, `buildCreditNotePayload` (returns), `buildDebitNotePayload` (voids), `postToFbr`, `enqueueFbrInvoice`, `validateConnection`, `getNextRetryDelay`, plus the URL and backoff-delay tables. `enqueueFbrInvoice` writes a DB row first, then queues a background job. Exponential backoff across a fixed number of attempts. Called by the FBR route file and the FBR background worker.

### `catalog-scheduler.js`
Applies one pending scheduled catalog change per call. Export: `applyScheduledChange(db, change)`. Validates the target entity type and field name against an allowlist — **security-critical**, since the column name is interpolated into the UPDATE string and the allowlist is the only injection guard. Non-throwing — returns a status/reason object so a batch loop can continue past a bad row. Called by the scheduled-catalog worker.

### `geo.js`
Pure geometry helpers, no external dependencies. Computes distance between two lat/lng points. Used by the field-sales route to flag a wholesale field-rep check-in as out-of-geofence against a customer's stored location.

### `sms.js`
SMS delivery adapter pattern. Exports: `sendSms`, `testProvider`, `getSmsAdapter`, `resolveProvider`, `BaseSmsAdapter`, `ADAPTERS`. Includes a generic HTTP adapter (covering a couple of common local carrier gateways) plus a Twilio adapter. Persists sent messages to a provider-message log table. Configured via the shared integration-settings table.

### `manager-pin.js`
PIN-based manager-approval verification for void/comp overrides at the POS. Reuses the same PIN-hashing algorithm as employee auth, with a plaintext fallback for employees not yet migrated to hashed PINs. Hard refusal when the request is running under an impersonated super-admin session — an impersonator can never self-approve an irreversible floor action.

### `phase4-polling.js`
Long-poll helper shared by real-time surfaces (KDS, floor plan, booking calendar): `getChangesSince(db, table, since, outletId)`. **Security note**: the table name is interpolated directly into SQL — callers must never pass untrusted input.

---

## Business Domain Services

### `aggregator-orders.js`
Delivery-aggregator order-ingestion pipeline (foodpanda/Careem-style platforms): resolves the tenant for the incoming store id, normalizes the platform payload via the adapter's own static normalizer, ingests it idempotently on source plus external order id, auto-accepts, hands off to the online-inbox acceptance flow, then settles the sale through a dedicated writer. This webhook path is signature-verified and fail-closed, unlike the Integrations-Hub channel webhooks. The settlement writer decrements stock unconditionally (can go negative) since the order is already paid on the platform and can't be rolled back from this side.

### `credit.js` / `backorder.js`
Wholesale AR/credit-limit gate (`credit.js`) and split-shipment/backorder logic (`backorder.js`) for the B2B distribution path — checked by the sales/order-capture flow when a wholesale customer exceeds their credit limit or an order can only be partially fulfilled from on-hand stock.

### `embedded-barcode.js`
Exports `normalizeScheme(...)` — decode-scheme normalizer for price/weight-embedded barcodes used by grocery/deli scales. The scheme is stored on the company profile as JSON; consumed by the POS scan route to interpret embedded-price barcodes.

### `admin-login-alert.js` / `admin-totp.js`
Super-admin panel security helpers, used only by the admin auth routes. The login-alert module fires a non-blocking email on a login from an unrecognized IP. The TOTP module wraps 2FA secret/QR generation and recovery-code issuance.

### `lifecycle-events.js`
Exports `recordLifecycleEvent(...)` — an append-only tenant lifecycle audit trail (signup, suspend/activate/delete, payment recorded, upgrade approved, bulk-lifecycle actions). Called by the admin tenant and billing routes in addition to (not instead of) the general audit log — check this table when tracing a tenant's full history.

### `batch-stock.js`
First-expired-first-out batch/expiry ledger underneath `stock-ledger.js`. Exports `consumeBatches`, `returnToBatch`, `transferBatches`, `receiveBatch`, `adjustBatches`, `roundQty`. Most callers should go through `stock-ledger.js` rather than calling this directly, except the handful of writers with different batch semantics noted above.

### `kit-engine.js`
BOM/recipe engine for kit (assembled-at-sale) and assembled (assembled-at-production) products. Exports `getBomType(db, productId)` — returns kit, assembled, or null. Consumed by the quotation-convert route (hard-rejects kits, since a quotation can't safely explode a bill of materials) and the recipe-costing report (treats kit vs. assembled consumption differently).

---

## Payments & Billing

Covered above under Core Infrastructure and Shared Core: `payment-gateway.js` (adapter), `subscriptions.js` (recurring billing lifecycle — see Customer Finance below), `customer-invoicing.js` (B2B invoicing — see Customer Finance below).

---

## Vertical-Specific Services

### Bookings / Appointments
- **`booking-services.js`** — `createAppointment`, `rescheduleAppointment`, `cancelAppointment`. Public bookings enforce a minimum-notice guard and enqueue a confirmation email (non-fatal). Admin-created bookings bypass the time guard. Auto-schedules a reminder ahead of the appointment.
- **`booking-availability.js`** — `getAvailableSlots`, `checkOverlap`. Slot granularity is a fixed 15-minute increment.
- **`booking-reminders.js`** — `processPendingReminders(db, boss)`. SMS-channel reminders are documented as intentionally unimplemented today — only email actually dispatches, though the row still gets marked sent; don't "fix" this without also updating the guarding unit test.

### Restaurant
- **`restaurant-checks.js`** — check lifecycle: create, list open checks, seat assignment, split by item/seat, fire course, open/close tab, recalculate totals.
- **`restaurant-floor.js`** — floor plan + table sessions: list/get/create/update floor plans, open/update table sessions. Closing a session is an update to `status: "closed"`, not a separate close function.
- **`restaurant-kds.js`** — kitchen display: stations, send-to-kitchen, tickets, bump, recall (resets a bumped ticket back to new).
- **`modifiers.js`** — modifier groups + options, product links, draft-order-item attach flow. The summed price delta is baked into the draft order line's price on attach, so downstream total recalculation needs no special handling. Group constraint validation (min/max select, required, selection type) runs in this service rather than via schema validation.
- **`menu-schedule-resolver.js`** — day-parting resolver. Menu schedules are restrictions, not allowlists: a product with zero schedule rows is always available; a product with one or more rows is only available inside those windows. Cached briefly per outlet since the public QR menu endpoint can be hit at high rate.
- **`tips.js`** — per-sale tip capture/lookup plus end-of-shift tip pooling (open/close/distribute/void a pool). A shared link column ties the two halves together; distribution writes both a payout table and a commission-earnings row as the single source of truth for payroll.

### Rentals
- **`rental-service.js`** — full rental lifecycle: items, assets, contracts, status transitions (confirm/checkout/return/complete/cancel), availability, overdue detection, invoice generation. Also exports `generateContractNumber`, `computeLateFee`.

### Rooms / Hotel
- **`room-service.js`** — room types, rooms, rate overrides, availability, the full booking lifecycle (create → confirm → check-in → check-out, cancel, no-show), folio management (open, add line, attach a sale, settle). Also exports `resolveRateForDate`, `calculateStayTotal`.
- **`room-deposits.js`** — gateway pre-auth deposit flow: create pre-auth, handle the deposit webhook, capture on checkout, find a booking by payment intent. Works alongside `payment-gateway.js`; captured on guest checkout.

### Treatment Plans (Clinical)
- **`treatment-plan-service.js`** — patient subjects, plan CRUD with status transitions, sessions (start/complete/no-show/cancel), charting, lab orders, a folio sub-system. Worker-facing exports: overdue plans, upcoming sessions needing a reminder.
- **`treatment-plan-deposits.js`** — gateway pre-auth deposit for treatment plans, structurally parallel to `room-deposits.js` but settles on plan completion rather than on checkout.

### Projects / Contracts
- **`projects.js`** — service project lifecycle: create/update/get/list, milestones, activity log.
- **`contracts.js`** — contract lifecycle: create, update, send, sign, get, log a contract event. Supports project-linked contracts and multi-signer flows.
- **`project-billing.js`** — links invoices/subscriptions to projects: attach an invoice, get a project billing summary. Delegates activity logging to `projects.js`.

### Customer Finance
- **`customer-invoicing.js`** — B2B invoices: invoice-number generation, pure total computation, balance recompute, quotation-to-invoice conversion, batch invoice creation (with an idempotency guard), reminder scheduling (throws if no tenant slug is supplied — required for job context).
- **`subscriptions.js`** — recurring subscription lifecycle: compute next billing period, process renewal, cancel, pause, resume. Renewal processing requires a tenant slug. Renewal jobs deduplicate in the job queue via a per-subscription-per-date key. Interval lengths are fixed day counts (monthly/quarterly/yearly), not calendar-aware month/year arithmetic.

### Omnichannel / Storefront
- **`quote.js`** — storefront pricing engine: `calculateQuote`, `resolvePriceForContext`. Price-list cascade: outlet → channel → customer → customer group → customer's assigned price list → base price. Also evaluates active promotions and accepts a courier id for flat shipping-rate lookup.
- **`storefront-cart.js`** — anonymous/authenticated cart: get-or-create, add/update/remove item, get cart with items. Carts expire after a week. Adding an existing product/variant increments quantity rather than duplicating the line. Delegates to `moq.js` and `product-visibility.js` before allowing an add.
- **`moq.js`** — minimum order quantity + case-pack increment enforcement. Shared by the storefront cart (portal and public storefront) and field-rep order capture; POS is intentionally never gated, since a cashier is transacting face-to-face with the buyer. Returns an ok flag plus a violations array for one item or a batch.
- **`product-visibility.js`** — customer-group catalog visibility. Products marked fully visible are seen by everyone; restricted products are visible only to customers whose group is explicitly linked. Ungrouped/anonymous buyers see only the fully-visible catalog by design.
- **`reservation.js`** — inventory reservation: create, convert, release, expire stale reservations, list active reservations for an outlet. Uses a row lock to prevent oversell. A short default time-to-live. Stock keys are sorted before locking to avoid deadlocks. No partial fulfillment — an outlet must have the full requested quantity or the reservation is rejected.
- **`allocation.js`** — fulfillment allocation: allocate an order, get allocations for an order. Pickup routes to a fixed outlet; ship routes to the highest-stock outlet. Runs inside a transaction. No partial fulfillment.
- **`public-tenant-context.js`** — shared public tenant resolver: `resolvePublicTenantDb(req, deps)`. Multi-tenant-aware (reads a tenant query param or header). Used by storefront, QR ordering, and public booking routes.

### Marketing / Messaging
- **`marketing.js`** — campaign audience resolution + delivery: resolve an audience from filter rules (or preview-only mode returning a count and sample), enqueue a campaign send (requires a tenant slug). Filter types include group, tag, loyalty tier, city, birth month, days since last purchase, min/max spend, has-email, has-mobile.
- **`messaging.js`** — generic messaging inbox: find-or-create a thread, add a message. Auto-resolves a customer from an inbound WhatsApp mobile number. Inbound messages increment the unread count; outbound replies reset it.

### Retail / Pricing
- **`pricing.js`** — customer-group + loyalty-tier price resolution. Looks up group-scoped price-list overrides and returns data the sales route uses to rewrite cart prices and stack discounts. Group and tier discounts stack additively; per-product overrides and group-level auto-discount are each independently flag-gated.
- **`retail-flag-preset.js`** — feature-flag preset seeding for new tenants at wizard completion, split into a general-retail set and a restaurant-tuned subset. Called during tenant provisioning, not on every request.
- **`inventory-intelligence.js`** — ABC Pareto classification (with a stable tie-break), sales velocity, GMROI, a lead-time resolution priority chain, and reorder-quantity suggestion. Backs the inventory-intelligence route.

### Service Tickets
- **`service-tickets.js`** — repair/service ticket lifecycle: generate a ticket number, create/update/get/list tickets, generate an invoice directly from a resolved ticket, log activity.

### Approvals / Policy
- **`approval-policy.js`** — policy evaluation: evaluate a policy, record an approval event. Action types include manual discount, discount code, return, unverified return, void, tax edit, order cancel, and custom sale.

### Customer Portal
- **`online-inbox.js`** — customer-facing message inbox for the self-service portal.

### Other Domain Services (quick reference)
- **`commission-calc.js`** — sales commission computation, feeds payroll generation and tip-pool payout distribution.
- **`class-bookings.js`** — gym/fitness class scheduling, sitting alongside `booking-services.js` for the fixed-schedule (as opposed to appointment) booking shape.
- **`client-service-records.js`** — per-customer service history (the salon "who performed this service" history writer).
- **`deposit-engine.js`** — shared deposit/pre-auth math underneath `room-deposits.js` and `treatment-plan-deposits.js`.
- **`forms.js`** — reusable form builder/renderer; snapshots submitted field definitions so a later template edit doesn't retroactively change historical submissions.
- **`members.js`** — gym/membership status derivation — the single source of truth for active/expired/frozen status.
- **`packages.js`** — service package/bundle billing plus dunning.
- **`promo-engine.js`** — promotions/discount evaluation, including wholesale slab-percent tier rules; writes an audit snapshot of the applied promotion.
- **`recall-service.js`** — clinical recall engine — due/overdue patient recall computation.
- **`room-channel-sync.js`** — OTA/iCal channel sync for lodging; writes to a dead-letter table on conflict.
- **`room-night-audit.js`** — nightly room/folio audit job logic for lodging.
- **`waitlist.js`** — restaurant/booking waitlist management.
- **`sms-templates.js`** — template registry for `sms.js` sends, parallel to `email-templates.js`.
- **`customer-notify.js`** — shared customer notification dispatch point — the single call site other services should use instead of hand-rolling a notification insert.
- **`ai.js`** — AI provider wrapper backing the insights chat route and the auto-SKU/description-generation fast-entry features. Requires an API key.

---

## Subdirectory Modules (see their own CLAUDE.md)

### `couriers/`
Adapter pattern for courier API integration. Single entry point: `index.js` exports `getAdapter(adapterKey, config)` — maps a slug string to a class instance, falling back to a generic manual-entry adapter for unrecognized keys. Config comes from a courier config row via `routes/couriers.js`, which decrypts credentials and parses the config JSON column before handing it to the adapter — adapters never touch environment variables or decrypt anything themselves.

Class hierarchy: an abstract base class (every method throws) → the generic no-op adapter (never throws) → two adapters that override booking specifically to reject it, since those couriers have no public booking API and must be booked manually. A dozen named adapters implement real booking/tracking/cancel against their carrier's API — each with its own auth pattern, COD-vs-prepaid service string convention, and failure-detection quirks (some couriers return HTTP 200 with an error flag buried in the body). See `couriers/CLAUDE.md` for the full per-adapter reference before adding a new one.

### `marketplace/`
An abstract base class plus platform adapters split across two structurally different pipelines that share a folder. The Integrations Hub adapters (Daraz, Facebook/Instagram commerce, WhatsApp, Google Merchant) do manual, UI-triggered catalog sync and order pull, gated by the marketplace-integrations feature flag, with credentials in the shared integration-settings table. The delivery-aggregator adapters (foodpanda, Careem) are webhook-first — their real workhorse is a static payload normalizer, and their instance methods are honest stubs reporting real (usually absent) automation capability rather than faking success. Don't conflate the two pipelines: one pulls catalog/orders on demand, the other pushes orders in via a verified webhook. See `marketplace/CLAUDE.md` for the full config shape and auth pattern per adapter.

### `import/mappers/`
Import mappers for bulk data ingestion. `index.js` is the entry point; per-platform files map an external export format (e.g. a competing POS/e-commerce platform's product or customer export) to the internal schema shape. Used by `routes/import.js`.

---

## Key Conventions and Gotchas

### Encryption format
All integration credentials are stored as `enc:v1:{iv_b64}:{tag_b64}:{ciphertext_b64}`. Always call `decryptSecret()` before passing config to any adapter. Courier and marketplace credentials follow the same convention as Shopify. Courier adapters specifically receive pre-decrypted credentials and an already-parsed config object — decryption and JSON parsing both happen in the route layer, never inside the adapter.

### pg-boss usage
Always get the shared instance via `getBoss()` from `boss.js` — never construct a job-queue client directly. Some `boss.send` calls intentionally run outside the enclosing transaction — this is correct, not an oversight. Renewal-style jobs use a singleton key to deduplicate across concurrent workers.

### Adapter pattern (couriers + marketplace + payment + SMS)
All four adapter layers share the same shape: an abstract base class with throwing stubs, concrete adapters extending it, and a factory function mapping a key to an instance. Never call an abstract method on the base class directly.

### Non-throwing services
`booking-reminders.js`, `catalog-scheduler.js`, and every courier adapter's cancel-shipment method are intentionally non-throwing — they return status objects so batch loops can continue past one bad row. Don't change this behavior.

### Tenant-slug-required params
Subscription renewal processing, invoice reminder scheduling, and campaign-send enqueueing all throw if a tenant slug is omitted — it's required for background-job context.

### No environment variables in courier/marketplace adapters
Courier and marketplace adapters read zero environment variables. All configuration flows in through the constructor from the DB row.

### Google Merchant push-inventory silent failures
The Google Merchant client's inventory push swallows per-item errors and always reports every item as updated, even when some failed. Don't rely on the return value for error detection.

### Wholesale services intentionally skip POS
`moq.js` and the field-sales geofencing in `geo.js` both apply to portal/storefront/field-rep flows, never to POS — a cashier transacts face-to-face with the buyer and doesn't need programmatic enforcement.
