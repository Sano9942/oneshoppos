# Services — Claude Guide

- **31 files** — core business services, all imported by route handlers via `deps` or direct `require()`
- **`crypto.js`** — AES-256-GCM encryption for integration credentials (`INTEGRATION_SECRET_KEY` env var)
- **`email.js`** — unified `sendEmail()` (immediate via Resend) + `enqueueEmail()` (pg-boss queue). `resolveFrom()` picks sender: tenant emails from `slug@sanopos.com`, platform from `noreply@sanopos.com`
- **`email-templates.js`** — `TEMPLATES` registry maps email type → `{ subject, html }` builder. `wrapEmailHtml(title, body)` renders branded shell. To add a new email type, add here AND register in `TEMPLATES`
- **`boss.js`** — pg-boss singleton factory: `getBoss()` (lazy-init, promise-deduplicated), `shutdownBoss()`. Auto-prunes after 7 days. Throws if `DATABASE_URL` unset
- **`fbr.js`** — FBR Digital Invoicing: `buildInvoicePayload`, `postToFbr`, `enqueueFbrInvoice` (DB row first, then pg-boss fire-and-forget). Exponential backoff: 60s→5m→15m→1h→4h
- **`payment-gateway.js`** — adapter pattern: `createCheckout()`, `verifyWebhook()`, `isEnabled()`. Default mode is `"manual"` (throws on `createCheckout`). Gate payment UI behind `isEnabled()`
- **`alerting.js`** — in-memory sliding-window alerts: `recordError`, `recordDbPressure`, `recordHealthCheckFailure`. Sends to `ALERT_EMAIL`. State resets on restart (by design)
- **`printer.js`** — factory: `makePrinterService(db)` → `{ printReceipt, printerStatus }`. Supports USB and TCP. 3s connection timeout. Paper width from DB drives layout
- **`catalog-scheduler.js`** — `applyScheduledChange(db, change)`. Called by `boot/workers.js` scheduled-catalog worker per pending row. Validates `entity_type` + `field_name` against allowlist imported from `schemas/scheduled-changes.js` (defense in depth: route validates on write, service re-validates on apply), then runs target UPDATE + status update inside one `db.transaction()`. Non-throwing — returns `{status, reason}` so caller can loop over many rows without one bad row killing the batch. Security-critical: column name is interpolated into the UPDATE string, allowlist is the only thing preventing SQL injection
- **`logger.js`** — Pino singleton. `LOG_LEVEL` env var. Use `.child({ component })` for sub-loggers. Never create multiple instances
- **`contracts.js`** — contract lifecycle: `createContract`, `signContract`, `voidContract`. Tables: `contracts`, `contract_templates`, `contract_signers`. Supports project-linked contracts and multi-signer flows
- **`projects.js`** — service project lifecycle: `createProject`, `updateProject`, `addMilestone`, `logActivity`. Tables: `service_projects`, `project_milestones`, `project_activity_log`
- **`subscriptions.js`** — recurring subscription lifecycle: `computeNextPeriod`, `processRenewal`, `cancelSubscription`. Enqueues renewal jobs via pg-boss. Table: `customer_subscriptions`
- **`customer-invoicing.js`** — B2B invoice lifecycle: `generateInvoiceNumber` (INV-000001 format), `computeInvoiceTotals` (pure), `createInvoice`, `markInvoicePaid`, `sendInvoiceReminder`. Table: `customer_invoices`
- **`project-billing.js`** — links invoices/subscriptions to projects: `attachInvoiceToProject`, `getProjectBillingSummary`. Delegates activity logging to `projects.js`
- **`allocation.js`** — fulfillment allocation: `allocateOrder`, `getAllocationsForOrder`. Pickup → fixed outlet; ship-to-customer → highest-stock outlet. Table: `web_order_allocations`. Runs inside `db.transaction()`
- **`quote.js`** — storefront pricing engine: `calculateQuote`, `resolvePriceForContext`. Validates stock, resolves channel pricing, applies tax, validates delivery method. Called before order creation
- **`reservation.js`** — inventory reservation for omnichannel: `createReservation`, `releaseReservation`, `expireStaleReservations`. Uses `SELECT ... FOR UPDATE` on `outlet_stock` to prevent oversell. Restores stock on release/expiry
- **`storefront-cart.js`** — anonymous/authenticated cart for omnichannel storefront: `getOrCreateCart`, `addItem`, `updateItem`, `removeItem`, `getCartWithItems`. Table: `storefront_carts`
- **`public-tenant-context.js`** — shared public tenant resolver (extracted from storefront): `resolvePublicTenantDb(req, deps)`. Used by storefront, QR ordering, and public booking routes. MT-aware (reads `tenant` query param or `x-tenant-slug` header)
- **`marketing.js`** — campaign audience resolution + delivery: `resolveAudience` (filter rules → customer IDs), `enqueueCampaignSend`. Supports group, tag, and custom filter types
- **`messaging.js`** — generic messaging inbox: `findOrCreateThread`, `addMessage`. Tables: `message_threads`, `message_entries`. Auto-resolves customer from WhatsApp mobile number
- **`sms.js`** — SMS delivery via adapter pattern: `sendSms(db, { to, body, type })`. `BaseSmsAdapter` base class + ADAPTERS registry. Config via `integration_settings` (category `'sms'`)
- **`approval-policy.js`** — policy lookup + manager PIN enforcement for POS approval flows (`actionType`: discount/return/void). Called by `routes/approval-policies.js`
- **`restaurant-checks.js`** — restaurant check lifecycle (seats, splits, coursing, tabs): `createRestaurantCheck`, `addItemToCheck`, `splitCheck`, `closeCheck`. Uses `draft_orders` with `order_context != 'retail'`. QR public tokens for dine_in/bar contexts
- **`restaurant-floor.js`** — floor plan + table session service: `getFloorPlans`, `getFloorPlanWithTables`, `createTableSession`, `closeTableSession`. Tables: `restaurant_floor_plans`, `restaurant_floor_sections`, `restaurant_tables`
- **`restaurant-kds.js`** — Kitchen Display System: `getStations`, `createStation`, `sendToKitchen`, `getTickets`, `bumpTicket`. Tables: `kds_stations`, `kds_tickets`
- **`booking-services.js`** — appointment CRUD: `createAppointment`, `rescheduleAppointment`, `cancelAppointment`. Checks overlap via `booking-availability.js`. Auto-sets status to `'pending'` if service `requires_confirmation`
- **`booking-availability.js`** — slot availability engine: `getAvailableSlots`, `checkOverlap`. Reads staff schedules + existing appointments. Tables: `booking_services`, `booking_staff_assignments`
- **`booking-reminders.js`** — reminder scheduler: `processPendingReminders(db, boss)`. Polls `appointment_reminders` where `status='pending'` and `scheduled_for <= NOW()`, sends email or SMS, marks sent
- **`phase4-polling.js`** — shared long-poll helper for Phase 4 surfaces (KDS, floor plan, booking calendar): `getChangesSince(db, table, since, outletId)`. Returns rows with `updated_at > since`

## Subdirectories

- **`couriers/`** (16 files) — courier adapter pattern. See `couriers/CLAUDE.md`
- **`marketplace/`** (5 files) — marketplace API clients for integrations hub:
  - `base-marketplace.js` — abstract base class with common HTTP, retry, rate-limit logic
  - `daraz-client.js` — Daraz Seller Center API (Open Platform SDK)
  - `meta-commerce.js` — Facebook/Instagram Commerce API (catalog + orders)
  - `whatsapp-client.js` — WhatsApp Business Cloud API (templates + conversations)
  - `google-merchant.js` — Google Merchant Center Content API (product feed + diagnostics)
